/** Mask fenced/inline code without changing Provider UTF-16 offsets. */
export function markdownCodeMask(text: string): Uint8Array {
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


/** Obsidian comments and HTML comments are literal text even with stale metadata. */
export function markdownLiteralMask(text: string): Uint8Array {
    const mask = markdownCodeMask(text);
    const comments = /<!--|%%/g;
    for (const match of text.matchAll(comments)) {
        if (mask[match.index]) continue;
        const endMarker = match[0] === "<!--" ? "-->" : "%%";
        const end = text.indexOf(endMarker, match.index + match[0].length);
        mask.fill(1, match.index, end < 0 ? text.length : end + endMarker.length);
    }
    return mask;
}
