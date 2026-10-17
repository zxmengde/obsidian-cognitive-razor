import type {ResponsesReplayItem} from '../types/provider';

/** Active workflow continuation state, not a durable model cache. Opaque
 * reasoning stays in the workflow artifact and never belongs in UI/logs. */
export const MAX_RESPONSES_REPLAY_BYTES = 1_000_000;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const pick = (v: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => v[k] !== undefined).map(k => [k, v[k]]));
const sizeOk = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length <= MAX_RESPONSES_REPLAY_BYTES;
function annotation(v: unknown): Record<string, unknown> | undefined {
  if (!record(v) || v.type !== 'url_citation' || !str(v.url)) return undefined;
  if (!str(v.title) || !Number.isSafeInteger(v.start_index) || !Number.isSafeInteger(v.end_index)) return undefined;
  if (['start_index', 'end_index'].some(k => v[k] !== undefined && (!Number.isSafeInteger(v[k]) || (v[k] as number) < 0))) return undefined;
  return pick(v, ['type', 'url', 'title', 'start_index', 'end_index']);
}
function messagePart(v: unknown): Record<string, unknown> | undefined {
  if (!record(v) || v.type !== 'output_text' || !str(v.text)) return undefined;
  if (!Array.isArray(v.annotations) || v.annotations.length > 128) return undefined;
  const annotations = (v.annotations as unknown[] | undefined)?.map(annotation);
  if (annotations?.some(v => !v)) return undefined;
  return {type: 'output_text', text: v.text, ...(annotations ? {annotations} : {})};
}
function replayItem(v: unknown): ResponsesReplayItem | undefined {
  if (!record(v) || !str(v.id) || !v.id || (v.status !== undefined && v.status !== 'completed')) return undefined;
  if (v.type === 'message') {
    if (v.role !== 'assistant' || v.status !== 'completed' || !Array.isArray(v.content) || !v.content.length || v.content.length > 32
      || (v.phase !== undefined && v.phase !== null && v.phase !== 'commentary' && v.phase !== 'final_answer')) return undefined;
    const content = v.content.map(messagePart);
    if (content.some(v => !v)) return undefined;
    return {...pick(v, ['type', 'id', 'role', 'status', 'phase']), content};
  }
  if (v.type === 'reasoning') {
    // Stateless replay needs the provider's opaque state. An id alone is not a
    // substitute when a gateway did not return encrypted continuation data.
    if (v.content !== undefined && (!Array.isArray(v.content) || v.content.length !== 0)) return undefined;
    if (!str(v.encrypted_content) || !v.encrypted_content || !Array.isArray(v.summary) || v.summary.length > 32) return undefined;
    if (v.summary.some(s => !record(s) || s.type !== 'summary_text' || !str(s.text))) return undefined;
    return {...pick(v, ['type', 'id', 'status', 'encrypted_content']),
      ...(v.content !== undefined ? {content: []} : {}),
      summary: v.summary.map(s => pick(s as Record<string, unknown>, ['type', 'text']))};
  }
  if (v.type === 'web_search_call') {
    const a = v.action;
    if (v.status !== 'completed' || !record(a)) return undefined;
    let action: Record<string, unknown>;
    if (a.type === 'search') {
      if (a.query !== undefined && !str(a.query)) return undefined;
      if (a.queries !== undefined && (!Array.isArray(a.queries) || !a.queries.every(str))) return undefined;
      if (a.sources !== undefined && (!Array.isArray(a.sources) || a.sources.length > 128
        || a.sources.some(s => !record(s) || s.type !== 'url' || !str(s.url)))) return undefined;
      action = {...pick(a, ['type', 'query', 'queries']), ...(Array.isArray(a.sources) ? {sources: a.sources.map(s => pick(s as Record<string, unknown>, ['type', 'url']))} : {})};
    } else if (a.type === 'open_page') {
      if (a.url !== undefined && a.url !== null && !str(a.url)) return undefined;
      action = pick(a, ['type', 'url']);
    } else if (a.type === 'find_in_page') {
      if (!str(a.url) || !str(a.pattern)) return undefined;
      action = pick(a, ['type', 'url', 'pattern']);
    } else return undefined;
    return {...pick(v, ['type', 'id', 'status']), action};
  }
  return undefined;
}
export function readResponsesReplayOutput(value: unknown): ResponsesReplayItem[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 128) return undefined;
  const items = value.map(replayItem);
  if (items.some(v => !v) || !items.some(v => v?.type === 'message') || !sizeOk(items)) return undefined;
  return JSON.parse(JSON.stringify(items)) as ResponsesReplayItem[];
}
export function replayVisibleText(items: ResponsesReplayItem[]): string {
  const messages = items.filter(i => i.type === 'message');
  const finals = messages.filter(i => i.phase === 'final_answer');
  return (finals.length ? finals : messages.filter(i => i.phase !== 'commentary'))
    .flatMap(i => (i.content as Array<{text: string}>).map(p => p.text)).join('');
}
export function readResponsesOutputHistory(value: unknown, history: Array<{role: string; content: string}> | undefined): ResponsesReplayItem[][] | undefined {
  if (!Array.isArray(history) || history.some(turn => !record(turn) || !str(turn.content)) || !history.length || history.length % 2 || !Array.isArray(value) || value.length !== history.length / 2 || value.length > 16) return undefined;
  const turns = value.map(readResponsesReplayOutput);
  if (turns.some((items, i) => !items || history[i * 2]?.role !== 'user' || history[i * 2 + 1]?.role !== 'assistant'
    || replayVisibleText(items) !== history[i * 2 + 1].content) || !sizeOk(turns)) return undefined;
  return turns as ResponsesReplayItem[][];
}
export function buildResponsesReplayInput(history: Array<{role: string; content: string}> | undefined, outputs: unknown, currentUser: string): Array<Record<string, unknown>> | undefined {
  const turns = readResponsesOutputHistory(outputs, history);
  if (!turns || !history) return undefined;
  return [...turns.flatMap((items, i) => [{role: 'user', content: history[i * 2].content}, ...items]), {role: 'user', content: currentUser}];
}
