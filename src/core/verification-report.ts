import type { PluginSettings } from '../types';
import { formatCRTimestamp } from '../utils/date-utils';

/** Formatting is captured with the completed stage, so recovery never reformats it. */
export function makeVerificationReportBlock(
    report: string,
    at = Date.now(),
    presentation: PluginSettings['verifyReportPresentation'] = 'expanded',
): string {
    const body = report.trim() || '（报告内容为空）';
    const timestamp = formatCRTimestamp(new Date(at));
    if (presentation === 'collapsed') {
        return `> [!info]- 事实核查报告\n${`${body}\n\n核查时间: ${timestamp}`.split('\n').map(line => `> ${line}`).join('\n')}`;
    }
    return `## 事实核查报告\n\n${body}\n\n> 核查时间: ${timestamp}`;
}
