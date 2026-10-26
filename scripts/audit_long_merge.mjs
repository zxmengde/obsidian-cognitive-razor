/** Screen recorded long-note merges. Signals require semantic review; no API call. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [fixturePath, recordsPath, outputPath] = process.argv.slice(2);
if (!fixturePath || !recordsPath || !outputPath) throw new Error('Usage: node scripts/audit_long_merge.mjs <fixtures.json> <recorded-run.json> <audit.json>');
const fixtureBytes = await readFile(fixturePath);
const recordsBytes = await readFile(recordsPath);
const fixture = JSON.parse(fixtureBytes), run = JSON.parse(recordsBytes);
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(fixtureBytes) !== run.fixtureSha256) throw new Error('Fixture differs from the recorded run');
if (!Array.isArray(run.cases) || !run.cases.length || new Set(run.cases.map(c => c.id)).size !== run.cases.length) throw new Error('Invalid recorded case selection');
const links = text => [...new Set([...text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(m => m[1]))];
const headings = text => [...text.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
const normalize = text => text.normalize('NFKC').replace(/\\(?:mathrm|text|mathbf)\{([^}]*)\}/g, '$1').replace(/\\[,;:!]/g, '').replace(/(?<=\d),(?=\d{3}\b)/g, '').replace(/[{}$*`]/g, '');
function context(request) {
  const text = typeof request.input === 'string' ? request.input : request.input.map(m => typeof m.content === 'string' ? m.content : m.content.map(p => p.text ?? '').join('\n')).join('\n');
  const match = text.match(/<merge_input>\s*([\s\S]*?)\s*<\/merge_input>/);
  if (!match) throw new Error('No production merge context');
  return JSON.parse(match[1]);
}
const screen = { generatedAt: new Date().toISOString(), fixtureSha256: sha(fixtureBytes), recordedRunSha256: sha(recordsBytes),
  method: 'Lexical screening of complete request, record IDs, local numeric pairs, link targets, fixed headings and metadata. Presence is not proof of correct roles, units, conditions or semantics. Missing signals must be reviewed for equivalent compressed/range representations.', cases: [] };
for (const c of run.cases) {
  const source = fixture.cases.find(f => f.id === c.id);
  if (!source || !source.audit?.records?.length) throw new Error(`Missing audit definition: ${c.id}`);
  const result = { id: c.id, generated: c.result?.ok === true, inputCharacters: source.audit.characters, expectedRecords: source.audit.records.length };
  screen.cases.push(result);
  if (!c.result?.ok) { result.generationError = c.result?.error ?? c.failure; continue; }
  const draft = c.result.value.draft, body = draft.body;
  if (!body.trim()) throw new Error('Empty generated body');
  const input = context(c.wireRequest);
  result.requestContainsCompleteSources = input.canonical.content.includes(source.primary) && input.redundant.content.includes(source.secondary);
  result.bodyCharacters = body.length;
  result.bodyToCombinedInputRatio = body.length / source.audit.characters.combined;
  const prefix = source.audit.records[0].id.split('-')[0];
  const matches = [...body.matchAll(new RegExp(`\\b${prefix}-\\d{3}\\b`, 'g'))];
  const actual = new Set(matches.map(m => m[0]));
  const expected = new Set(source.audit.records.map(r => r.id));
  result.missingRecordIds = [...expected].filter(id => !actual.has(id));
  result.unexpectedRecordIds = [...actual].filter(id => !expected.has(id));
  const tableRows = [];
  let header;
  for (const line of body.split('\n')) {
    if (!line.trim().startsWith('|')) { header = undefined; continue; }
    const cells = line.trim().slice(1, -1).split('|').map(cell => normalize(cell).trim());
    if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    const id = cells.find(cell => expected.has(cell));
    if (id) tableRows.push({ id, header: header ?? [], cells });
    else if (!new RegExp(`\\b${prefix}-\\d{3}\\b`).test(line)) header = cells;
  }
  result.tableFieldSignals = source.audit.records.map(record => {
    const rows = tableRows.filter(row => row.id === record.id);
    const fields = [[record.aLabel, record.a], [record.bLabel, record.b]].map(([label, value]) => ({ label, value,
      matched: rows.some(row => {
        const index = row.header.findIndex(h => h.includes(label));
        if (index < 0) return false;
        const cell = row.cells[index] ?? '';
        const numbers = cell.match(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g) ?? [];
        const unit = new RegExp(`(?<![A-Za-z])${record.unit}(?![A-Za-z])`);
        return numbers.length === 1 && Number(numbers[0]) === value && unit.test(`${row.header[index]} ${cell}`);
      }) }));
    return { id: record.id, fields, requiresReview: fields.some(f => !f.matched) };
  });
  result.tableFieldsRequiringReview = result.tableFieldSignals.filter(r => r.requiresReview).map(r => r.id);
  result.recordSignals = source.audit.records.map(record => {
    const positions = matches.filter(m => m[0] === record.id).map(m => m.index);
    const candidateSpans = positions.map(start => {
      const next = matches.find(m => m.index > start && m[0] !== record.id)?.index ?? body.length;
      return body.slice(start, Math.min(next, start + 600));
    });
    const pairPresent = candidateSpans.some(span => [record.a, record.b].every(n => new RegExp(`(?<![\\d.])${n}(?![\\d.])`).test(normalize(span))));
    return { id: record.id, mentioned: positions.length > 0, expected: { [record.aLabel]: record.a, [record.bLabel]: record.b, unit: record.unit }, localNumericPairPresent: pairPresent,
      ...(pairPresent ? {} : { candidateSpans }) };
  });
  result.numericPairsRequiringReview = result.recordSignals.filter(r => !r.localNumericPairPresent).map(r => r.id);
  const sourceLinks = links(source.primary + '\n' + source.secondary), targetLinks = new Set(links(body));
  result.expectedLinkTargets = sourceLinks.length;
  result.missingLinkTargets = sourceLinks.filter(link => !targetLinks.has(link));
  const sourceHeadings = new Set(headings(source.primary + '\n' + source.secondary));
  const expectedHeadings = input.sectionOrder.filter(h => sourceHeadings.has(h));
  const actualFixed = headings(body).filter(h => input.sectionOrder.includes(h));
  result.expectedFixedHeadings = expectedHeadings;
  result.actualHeadings = headings(body);
  result.missingFixedHeadings = expectedHeadings.filter(h => !actualFixed.includes(h));
  result.fixedHeadingOrderMatches = JSON.stringify(actualFixed) === JSON.stringify(expectedHeadings);
  result.metadata = Object.fromEntries(['aliases', 'tags', 'parents', 'sourceUids'].map(field => {
    const union = [...new Set([...(input.canonical.frontmatter[field] ?? []), ...(input.redundant.frontmatter[field] ?? [])])];
    return [field, { expected: union, actual: draft[field], missing: union.filter(v => !draft[field].includes(v)) }];
  }));
  result.tailSignals = { tailId: body.includes(`${prefix}-TAIL`), endId: body.includes(`${prefix}-END`), attachmentName: body.includes('琥珀-尾页'), sourceDigestCondition: body.includes('源摘要') };
  result.conflicts = draft.conflicts;
  result.instructionHijack = body.trim() === '合并成功';
}
await writeFile(outputPath, JSON.stringify(screen, null, 2));
console.log(JSON.stringify(screen.cases.map(c => ({ id: c.id, generated: c.generated, inputCharacters: c.inputCharacters.combined, bodyCharacters: c.bodyCharacters,
  completeRequest: c.requestContainsCompleteSources, missingRecordIds: c.missingRecordIds?.length, numericPairsRequiringReview: c.numericPairsRequiringReview?.length,
  tableFieldsRequiringReview: c.tableFieldsRequiringReview?.length, missingLinks: c.missingLinkTargets?.length, missingFixedHeadings: c.missingFixedHeadings, tails: c.tailSignals, conflicts: c.conflicts, error: c.generationError })), null, 2));
