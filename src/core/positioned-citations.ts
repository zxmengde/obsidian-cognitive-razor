import type { UrlCitation } from '../types';
import { normalizeExternalHttpUrl } from './url-utils';

/** Mask fenced/inline code without changing Provider UTF-16 offsets. */
function codeMask(text: string): Uint8Array {
    const mask = new Uint8Array(text.length);
    let offset = 0;
    let fence: { marker: string; length: number } | undefined;
    for (const line of text.split('\n')) {
        const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) {
            mask.fill(1, offset, offset + line.length + 1);
            if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !line.slice(match[0].length).trim()) fence = undefined;
        } else if (match) {
            fence = { marker: match[1][0], length: match[1].length };
            mask.fill(1, offset, offset + line.length + 1);
        }
        offset += line.length + 1;
    }
    for (let i = 0; i < text.length; i++) {
        if (mask[i] || text[i] !== '`' || text[i - 1] === '\\') continue;
        let length = 1;
        while (text[i + length] === '`') length++;
        const marker = '`'.repeat(length);
        let end = text.indexOf(marker, i + length);
        while (end >= 0 && (mask[end] || text[end - 1] === '`' || text[end + length] === '`')) end = text.indexOf(marker, end + length);
        if (end >= 0) { mask.fill(1, i, end + length); i = end + length - 1; }
        else i += length - 1;
    }
    return mask;
}

interface InlineLink { start: number; end: number; url: string }

/** Conservative inline-link recognition; unrecognized Markdown is left alone. */
function inlineLinks(text: string): InlineLink[] {
    const links: InlineLink[] = [];
    const mask = codeMask(text);
    const opener = /(?<!!)(?<!\\)\[((?:\\.|[^\]\\\n])*)\]\(/g;
    for (const match of text.matchAll(opener)) {
        const start = match.index;
        if (mask[start]) continue;
        let cursor = start + match[0].length;
        while (text[cursor] === ' ' || text[cursor] === '\t') cursor++;
        let destination = '';
        if (text[cursor] === '<') {
            const end = text.indexOf('>', ++cursor);
            if (end < 0 || /\n/.test(text.slice(cursor, end))) continue;
            destination = text.slice(cursor, end); cursor = end + 1;
        } else {
            let depth = 0;
            while (cursor < text.length) {
                const char = text[cursor];
                if (/\s/.test(char) || (char === ')' && depth === 0)) break;
                if (char === '\\' && cursor + 1 < text.length) { destination += text[cursor + 1]; cursor += 2; continue; }
                if (char === '(') depth++;
                if (char === ')') depth--;
                destination += char; cursor++;
            }
            if (depth !== 0) continue;
        }
        // Optional quoted link title. Do not guess malformed or multiline links.
        const tail = /^(?:[ \t]+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))?[ \t]*\)/.exec(text.slice(cursor));
        if (!tail) continue;
        const end = cursor + tail[0].length;
        const url = normalizeExternalHttpUrl(destination);
        if (url && !mask.subarray(start, end).some(Boolean)) links.push({ start, end, url });
    }
    return links;
}

/** Deduplicate only at the annotated claim; never remove existing report text. */
export function insertPositionedCitationLinks(report: string, citations?: UrlCitation[]): string {
    const links = inlineLinks(report);
    const positioned = (citations ?? [])
        .filter(citation => Number.isSafeInteger(citation.startIndex) && Number.isSafeInteger(citation.endIndex)
            && citation.startIndex! >= 0 && citation.endIndex! > citation.startIndex! && citation.endIndex! <= report.length)
        .sort((a, b) => b.endIndex! - a.endIndex! || b.startIndex! - a.startIndex!);
    const used = new Set<string>();
    let output = report;
    for (const citation of positioned) {
        const url = normalizeExternalHttpUrl(citation.url);
        if (!url) continue;
        const start = citation.startIndex!;
        const end = citation.endIndex!;
        const key = `${start}:${end}:${url}`;
        if (used.has(key)) continue;
        used.add(key);
        const alreadyLinked = links.some(link => link.url === url && (
            (link.start < end && link.end > start)
            || (link.start >= end && /^[ \t]*$/.test(report.slice(end, link.start)))
            || (link.end <= end && /^[ \t]*$/.test(report.slice(link.end, end)))
        ));
        if (alreadyLinked) continue;
        const label = (citation.title?.trim() || url).replace(/[\\[\]]/g, '\\$&');
        output = `${output.slice(0, end)} [${label}](${url})${output.slice(end)}`;
    }
    return output;
}
