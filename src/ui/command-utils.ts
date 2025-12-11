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
export const COMMAND_IDS = {
  CREATE_CONCEPT: `${COMMAND_PREFIX}:create-concept`,
  OPEN_QUEUE: `${COMMAND_PREFIX}:open-queue`,
  PAUSE_QUEUE: `${COMMAND_PREFIX}:pause-queue`,
  OPEN_WORKBENCH: `${COMMAND_PREFIX}:open-workbench`,
  CREATE_CONCEPT_FROM_SELECTION: `${COMMAND_PREFIX}:create-concept-from-selection`,
  CLEAR_COMPLETED_TASKS: `${COMMAND_PREFIX}:clear-completed-tasks`,
  RETRY_FAILED_TASKS: `${COMMAND_PREFIX}:retry-failed-tasks`,
  ENRICH_NOTE: `${COMMAND_PREFIX}:enrich-note`,
  CHECK_DUPLICATES: `${COMMAND_PREFIX}:check-duplicates`,
  UNDO_LAST_OPERATION: `${COMMAND_PREFIX}:undo-last-operation`,
  TOGGLE_WORKBENCH: `${COMMAND_PREFIX}:toggle-workbench`,
  TOGGLE_QUEUE_VIEW: `${COMMAND_PREFIX}:toggle-queue-view`,
  OPEN_UNDO_HISTORY: `${COMMAND_PREFIX}:open-undo-history`,
} as const;

/**
 * 获取核心命令 ID 列表
 */
export function getCoreCommandIds(): string[] {
  return [
    COMMAND_IDS.CREATE_CONCEPT,
    COMMAND_IDS.OPEN_QUEUE,
    COMMAND_IDS.PAUSE_QUEUE,
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
