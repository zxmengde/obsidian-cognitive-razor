/** Wikilinks stay compact; URL-encoded Markdown preserves names containing
 * wikilink delimiters without changing either the display name or filename. */
function encodeInternalPath(path: string): string {
  return path.split("/").map(part => encodeURIComponent(part)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

/** Keep destination spans so a repair preserves angle syntax and link titles. */
function markdownDestination(text: string): { start: number; end: number; raw: string; label: string; rest: string } | undefined {
  const opener = /^\[((?:\\.|[^\\\]\n])*)\]\(/.exec(text);
  if (!opener) return undefined;
  let cursor = opener[0].length;
  while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  const angled = text[cursor] === "<";
  if (angled) cursor++;
  const start = cursor;
  if (angled) {
    cursor = text.indexOf(">", cursor);
    if (cursor < 0 || /\n/.test(text.slice(start, cursor))) return undefined;
  } else {
    let depth = 0;
    while (cursor < text.length) {
      const character = text[cursor];
      if (/\s/.test(character) || (character === ")" && depth === 0)) break;
      if (character === "\\" && cursor + 1 < text.length) { cursor += 2; continue; }
      if (character === "(") depth++;
      if (character === ")") depth--;
      cursor++;
    }
    if (depth !== 0) return undefined;
  }
  const end = cursor;
  if (angled) cursor++;
  const tail = /^(?:[ \t]+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))?[ \t]*\)/.exec(text.slice(cursor));
  if (!tail) return undefined;
  return { start, end, raw: text.slice(start, end), label: opener[1], rest: text.slice(cursor + tail[0].length) };
}

export function renderInternalNoteLink(path: string, displayName?: string): string {
  const label = displayName ?? path.replace(/\.md$/i, "");
  if (!/[[\]#^|%]/.test(`${path}${label}`)) {
    const target = displayName === undefined ? path.replace(/\.md$/i, "") : path;
    return displayName === undefined ? `[[${target}]]` : `[[${target}|${label}]]`;
  }
  const destination = encodeInternalPath(path);
  const text = label.replace(/[\\[\]*_`]/g, char => `\\${char}`);
  return `[${text}](${destination})`;
}

/** Properties parse the complete Wiki value, unlike the body Markdown parser.
 * Raw brackets preserve both their target and visible name in a parent field.
 * Keep existing URL encoding for filename characters that act as Wiki subpaths. */
export function renderParentNoteLink(path: string): string {
  return /[#^|%]/.test(path) ? renderInternalNoteLink(path) : `[[${path.replace(/\.md$/i, "")}]]`;
}

/** Repair only a complete parsed link, retaining its display and subpath.
 * URL fragments are separate from encoded filename characters. */
export function rewriteInternalNoteLink(text: string, newPath: string): string | undefined {
  const embedded = text.startsWith("!");
  const linkText = embedded ? text.slice(1) : text;
  const parsed = parseInternalNoteLink(linkText);
  if (!parsed?.target || parsed.rest) return undefined;
  const prefix = embedded ? "!" : "";
  const replacementPath = /\.md$/i.test(parsed.target) ? newPath : newPath.replace(/\.md$/i, "");
  if (linkText.startsWith("[[")) {
    const inner = linkText.slice(2, -2);
    const rawTarget = inner.split("|")[0].split("#")[0].trim();
    const leading = inner.slice(0, inner.length - inner.trimStart().length);
    const suffix = inner.slice(leading.length + rawTarget.length);
    if (!/[[\]#^|%]/.test(replacementPath)) return `${prefix}[[${leading}${replacementPath}${suffix}]]`;
    const alias = inner.includes("|") ? inner.slice(inner.indexOf("|") + 1) : undefined;
    const heading = inner.split("|")[0].split("#").slice(1).join("#");
    const rendered = renderInternalNoteLink(newPath, alias);
    const fragment = heading ? `#${encodeURIComponent(heading).replace(/%5E/gi, "^")}` : "";
    return `${prefix}${rendered.slice(0, -1)}${fragment})`;
  }
  const destination = markdownDestination(linkText);
  if (!destination) return undefined;
  const hash = destination.raw.indexOf("#");
  const fragment = hash < 0 ? "" : destination.raw.slice(hash);
  return `${prefix}${linkText.slice(0, destination.start)}${encodeInternalPath(newPath)}${fragment}${linkText.slice(destination.end)}`;
}

/** Prefer native Properties syntax when aliases/subpaths are unambiguous. */
export function rewriteParentNoteLink(text: string, newPath: string): string | undefined {
  const rewritten = rewriteInternalNoteLink(text, newPath);
  if (!rewritten || rewritten.startsWith("[[") || rewritten.startsWith("!") || /[#^|%]/.test(newPath)) return rewritten;
  const destination = markdownDestination(rewritten);
  if (!destination) return rewritten;
  const label = destination.label.replace(/\\([\\[\]*_`])/g, "$1");
  const hash = destination.raw.indexOf("#");
  let subpath = hash < 0 ? "" : destination.raw.slice(hash + 1);
  try { subpath = decodeURIComponent(subpath); } catch { /* Preserve an existing literal fragment. */ }
  // A literal pipe is data in a Markdown fragment/label, but a Wiki delimiter.
  // Keep the existing Markdown representation rather than change its meaning.
  if (label.includes("|") || subpath.includes("|")) return rewritten;
  const target = newPath.replace(/\.md$/i, "");
  return `[[${target}${subpath ? `#${subpath}` : ""}${label === target ? "" : `|${label}`}]]`;
}

/** Read a list's leading internal link, including old unescaped bracketed
 * wikilinks. The remainder belongs to the field-specific description parser. */
export function parseInternalNoteLink(text: string): { target: string; explicitPath: boolean; rest: string } | undefined {
  if (text.startsWith("[[")) {
    let brackets = 0;
    for (let index = 2; index < text.length - 1; index++) {
      if (text[index] === "[") brackets++;
      else if (text[index] === "]" && brackets > 0) brackets--;
      else if (text[index] === "]" && text[index + 1] === "]") {
        const raw = text.slice(2, index);
        const target = raw.split("|")[0].split("#")[0].trim();
        return { target, explicitPath: /\.md$/i.test(target) || (target.includes("/") && raw.includes("|")), rest: text.slice(index + 2) };
      }
    }
    // Older links allowed a literal unmatched [ in the title. Preserve that
    // exact legacy format; newly generated names use escaped Markdown links.
    const legacy = /^\[\[([^\]]+)\]\]/.exec(text);
    if (legacy) {
      const target = legacy[1].split("|")[0].split("#")[0].trim();
      return { target, explicitPath: /\.md$/i.test(target) || (target.includes("/") && legacy[1].includes("|")), rest: text.slice(legacy[0].length) };
    }
    return undefined;
  }
  const destination = markdownDestination(text);
  if (!destination) return undefined;
  try {
    const target = decodeURIComponent(destination.raw.split("#")[0].replace(/\\(.)/g, "$1"));
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("/")) return undefined;
    return { target, explicitPath: target.includes("/") || /\.md$/i.test(target), rest: destination.rest };
  } catch { return undefined; }
}
