/**
 * 命令工具模块
 * 
 * 提供命令 ID 验证和常量定义，不依赖 obsidian 包
 */

/**
 * 命令 ID 前缀
 * 遵循 Requirements 9.1：命令 ID 格式为 cognitive-razor:<action>-<target>
 */
const COMMAND_PREFIX = "cognitive-razor";

/**
 * 核心命令 ID 常量
 * 遵循 Requirements 9.2, 9.3, 9.4
 */
/**
 * 核心命令 ID 常量
 * 
 * 遵循设计文档第 12 章：命令系统
 * 至少需要：
 * - 打开 Workbench
 * - 创建概念
 * - 对当前笔记启动 Amend（修订）
 * - 对当前重复对启动 Merge
 */
export const COMMAND_IDS = {
  // 核心命令（设计文档第 12 章）
  CREATE_CONCEPT: `${COMMAND_PREFIX}:create-concept`,
  OPEN_WORKBENCH: `${COMMAND_PREFIX}:open-workbench`,
  IMPROVE_NOTE: `${COMMAND_PREFIX}:improve-note`,
  MERGE_DUPLICATES: `${COMMAND_PREFIX}:merge-duplicates`,
  EXPAND_CURRENT_NOTE: `${COMMAND_PREFIX}:expand-current-note`,
  INSERT_IMAGE: `${COMMAND_PREFIX}:insert-image`,
  VERIFY_CURRENT_NOTE: `${COMMAND_PREFIX}:verify-current-note`,
  RETRY_FAILED: `${COMMAND_PREFIX}:retry-failed`,

  // 重要功能（阶段 2）
  VIEW_DUPLICATES: `${COMMAND_PREFIX}:view-duplicates`,
  RESUME_QUEUE: `${COMMAND_PREFIX}:resume-queue`,
  CLEAR_QUEUE: `${COMMAND_PREFIX}:clear-queue`,
  VIEW_OPERATION_HISTORY: `${COMMAND_PREFIX}:view-operation-history`,
  
  // 队列管理（已整合到工作台）
  PAUSE_QUEUE: `${COMMAND_PREFIX}:pause-queue`,
} as const;

/**
 * 获取核心命令 ID 列表
 * 
 * 遵循设计文档第 12 章：命令系统
 */
export function getCoreCommandIds(): string[] {
  return [
    COMMAND_IDS.OPEN_WORKBENCH,
    COMMAND_IDS.CREATE_CONCEPT,
    COMMAND_IDS.IMPROVE_NOTE,
    COMMAND_IDS.MERGE_DUPLICATES,
    COMMAND_IDS.EXPAND_CURRENT_NOTE,
  ];
}

/**
 * 验证命令 ID 格式
 * 遵循 Requirements 9.1：命令 ID 格式为 cognitive-razor:<action>-<target>
 */
export function isValidCommandId(commandId: string): boolean {
  const pattern = /^cognitive-razor:[a-z]+(-[a-z]+)*$/;
  return pattern.test(commandId);
}
