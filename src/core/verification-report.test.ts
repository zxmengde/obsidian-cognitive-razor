import { describe, expect, it } from 'vitest';
import { makeVerificationReportBlock } from './verification-report';
import { stripVerifyReport } from './semantic-index-text';
import { formatCRTimestamp } from '../utils/date-utils';

describe('optional verification report presentation', () => {
    it.each(['expanded', 'collapsed'] as const)('owns a single known report title in %s presentation', presentation => {
        for (const title of ['## 认识论审计报告:', '# 事实核查报告：', '## 认识论审计报告 ##']) {
            const report = makeVerificationReportBlock(`${title}\n\n总体评估: [建议修改]\n### 证据\n正文`, 0, presentation);
            expect(report.match(/事实核查报告/g)).toHaveLength(1);
            expect(report).not.toContain('认识论审计报告');
            expect(report).toContain('总体评估: [建议修改]');
            expect(report).toContain('### 证据');
        }
    });
    it.each(['## 自定义审计标题\n正文', '```md\n## 事实核查报告\n```', '正文\n## 认识论审计报告:\n这是正文中的标题', '## 事实核查报告: 自定义副标题\n正文'])('preserves custom and non-leading headings: %s', body => {
        expect(makeVerificationReportBlock(body, 0)).toContain(body);
    });
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
