import type { PluginSettings } from '../types';
import { formatCRTimestamp } from '../utils/date-utils';

/** 插件写入的核查报告块边界；报告只在这对标记之间替换或剥离。 */
export const VERIFY_START = "<!-- cognitive-razor:verify-report -->";
export const VERIFY_END = "<!-- /cognitive-razor:verify-report -->";

/** Removes the plugin-owned Verify projection from semantic text. */
export function stripVerifyReport(body: string): string {
  const start = body.indexOf(VERIFY_START);
  if (start < 0) return body;
  const end = body.indexOf(VERIFY_END, start + VERIFY_START.length);
  const stripped = end < 0 ? body.slice(0, start) : `${body.slice(0, start)}${body.slice(end + VERIFY_END.length)}`;
  return stripped.replace(/\n{3,}/g, "\n\n");
}

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
