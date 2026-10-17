import type { PluginSettings } from '../types';
import { formatCRTimestamp } from '../utils/date-utils';

/** Formatting is captured with the completed stage, so recovery never reformats it. */
export function makeVerificationReportBlock(
    report: string,
    at = Date.now(),
    presentation: PluginSettings['verifyReportPresentation'] = 'expanded',
): string {
    // Only the known leading report title belongs to this wrapper. Unknown
    // custom headings, internal sections and fenced examples remain untouched.
    const content = report.trim().replace(/^#{1,6}[ \t]+(?:认识论审计报告|事实核查报告)[：:]?[ \t]*(?:#+[ \t]*)?(?:\r?\n|$)/, '').trim();
    const body = content || '（报告内容为空）';
    const timestamp = formatCRTimestamp(new Date(at));
    if (presentation === 'collapsed') {
        return `> [!info]- 事实核查报告\n${`${body}\n\n核查时间: ${timestamp}`.split('\n').map(line => `> ${line}`).join('\n')}`;
    }
    return `## 事实核查报告\n\n${body}\n\n> 核查时间: ${timestamp}`;
}
