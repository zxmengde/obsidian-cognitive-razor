import { describe, expect, it } from 'vitest';
import { insertPositionedCitationLinks as insert } from './positioned-citations';
const url = 'https://example.test/paper';
const citation = (startIndex: number, endIndex: number, source = url) => ({ url: source, title: 'Full paper title', startIndex, endIndex });

describe('local positioned citation deduplication', () => {
    it('preserves the existing short link instead of appending the same URL and full title', () => {
        const report = `证据：[example.test](${url})`;
        expect(insert(report, [citation(0, report.length)])).toBe(report);
    });
    it.each([`[来源](${url})`, `[来源](<${url}> "题名")`, `[含\\[括号\\]标题](${url})`])('recognizes an adjacent existing link: %s', link => {
        const report = `结论 ${link}`;
        expect(insert(report, [citation(0, 2)])).toBe(report);
    });
    it('recognizes balanced URL parentheses without changing the original link', () => {
        const report = '[paper](https://example.test/paper_(one))';
        expect(insert(report, [citation(0, report.length, 'https://example.test/paper_(one)')])).toBe(report);
    });
    it('does not globally deduplicate the same source across independent claims', () => {
        const first = `第一条 [source](${url})`;
        const report = `${first}\n\n第二条。`;
        const result = insert(report, [citation(first.length + 2, report.length - 1)]);
        expect(result).toBe(`${first}\n\n第二条 [Full paper title](${url})。`);
    });
    it('retains different sources at the same range but deduplicates identical annotations', () => {
        const result = insert('结论。', [citation(0, 2), citation(0, 2, 'https://example.test/other'), citation(0, 2)]);
        expect(result.match(/\]\(https:\/\/example.test\/paper\)/g)).toHaveLength(1);
        expect(result).toContain('](https://example.test/other)');
    });
    it.each(['`[code](https://example.test/paper)`', '```md\n[code](https://example.test/paper)\n```', '![image](https://example.test/paper)', 'https://example.test/paper'])('does not mistake code, images or bare URLs for an existing citation: %s', existing => {
        const report = `${existing} 结论`;
        expect(insert(report, [citation(0, report.length)])).toBe(`${report} [Full paper title](${url})`);
    });
    it('uses original Unicode/whitespace positions for multiple and overlapping annotations', () => {
        const report = '\n\n😀甲。乙。';
        const result = insert(report, [citation(2, 5), citation(2, 7, 'https://example.test/other')]);
        expect(result).toBe(`\n\n😀甲 [Full paper title](${url})。乙 [Full paper title](https://example.test/other)。`);
    });
    it('rejects invalid positions and unsafe destinations while retaining report text', () => {
        expect(insert('正文', [citation(0, 200), citation(-1, 2), citation(0, 2, 'javascript:alert(1)')])).toBe('正文');
    });
});
