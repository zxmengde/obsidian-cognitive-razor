/**
 * StatusBadge 格式化函数
 * 
 * 状态格式显示 (Requirements 5.5):
 * - 正常: [CR: running/pending ⏳] 例如 [CR: 1/3 ⏳]
 * - 暂停: [CR: ⏸️ n] 例如 [CR: ⏸️ 3]
 * - 有失败: [CR: running/pending ⚠️failed] 例如 [CR: 1/3 ⚠️1]
 * - 离线: [CR: 📴]
 * - 空闲: [CR: ✓]
 */

import type { QueueStatus } from "../types";

export interface StatusBadgeFormatResult {
  text: string;
  icon: string;
}

/**
 * 格式化状态徽章文本
 * 
 * 根据 Requirements 5.5 和设计文档 section 8.5.3 定义的格式：
 * - 正常: [CR: running/pending ⏳] 例如 [CR: 1/3 ⏳]
 * - 暂停: [CR: ⏸️ n] 例如 [CR: ⏸️ 3]
 * - 有失败: [CR: running/pending ⚠️failed] 例如 [CR: 1/3 ⚠️1]
 * - 离线: [CR: 📴]
 * - 空闲: [CR: ✓]
 * 
 * @param status 队列状态
 * @param isOffline 是否离线（可选，默认 false）
 * @returns 格式化的状态文本
 */
export function formatStatusBadgeText(status: QueueStatus, isOffline: boolean = false): StatusBadgeFormatResult {
  // 离线状态
  if (isOffline) {
    return { text: "[CR: OFFLINE]", icon: "plug-zap" };
  }

  const { running, pending, failed, paused } = status;
  const activeCount = running + pending;

  // 空闲状态：没有活动任务且没有失败任务
  if (activeCount === 0 && failed === 0) {
    return { text: "[CR: IDLE]", icon: "check" };
  }

  // 暂停状态：队列暂停且有活动任务
  if (paused && activeCount > 0) {
    return { text: `[CR: ${activeCount} PAUSED]`, icon: "pause" };
  }

  // 有失败任务的状态
  if (failed > 0) {
    if (activeCount > 0) {
      // 有活动任务且有失败：[CR: running/pending ⚠️failed]
      return { text: `[CR: ${running}/${pending} FAIL ${failed}]`, icon: "alert-triangle" };
    } else {
      // 只有失败任务，没有活动任务
      return { text: `[CR: FAIL ${failed}]`, icon: "alert-triangle" };
    }
  }

  // 正常状态：有活动任务，无失败
  // [CR: running/pending ⏳]
  return { text: `[CR: ${running}/${pending}]`, icon: "loader-2" };
}
