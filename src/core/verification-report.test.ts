import { describe, expect, it } from 'vitest';
import { makeVerificationReportBlock } from './verification-report';
import { stripVerifyReport } from './semantic-index-text';
import { formatCRTimestamp } from '../utils/date-utils';

describe('optional verification report presentation', () => {
    it('keeps the previous expanded format as the exact default', () => {
        const at = 1700000000000;
        expect(makeVerificationReportBlock('  报告\n第二行  ', at)).toBe(`## 事实核查报告\n\n报告\n第二行\n\n> 核查时间: ${formatCRTimestamp(new Date(at))}`);
    });
    it('quotes every line in an Obsidian collapsed callout without losing markdown or blank lines', () => {
        const report = makeVerificationReportBlock('## 依据\n\n- [来源](https://example.test)\n> 原文', 0, 'collapsed');
        expect(report).toContain('> [!info]- 事实核查报告\n> ## 依据\n> \n> - [来源](https://example.test)\n> > 原文');
        expect(report.split('\n').every(line => line.startsWith('> '))).toBe(true);
        const bounded = `原文\n<!-- cognitive-razor:verify-report -->\n${report}\n<!-- /cognitive-razor:verify-report -->\n结尾`;
        expect(stripVerifyReport(bounded)).toBe('原文\n\n结尾');
    });
});
