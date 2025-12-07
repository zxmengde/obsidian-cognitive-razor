/**
 * 命令工具模块
 * 
 * 提供命令 ID 验证和常量定义，不依赖 obsidian 包
 * 用于属性测试和其他需要独立验证命令的场景
 */

/**
 * 命令 ID 前缀
 * 遵循 Requirements 9.1：命令 ID 格式为 cognitive-razor:<action>-<target>
 */
export const COMMAND_PREFIX = "cognitive-razor";

/**
 * 核心命令 ID 常量
 * 遵循 Requirements 9.2, 9.3, 9.4
 */
export const COMMAND_IDS = {
  /** 创建概念命令 ID */
  CREATE_CONCEPT: `${COMMAND_PREFIX}:create-concept`,
  /** 打开队列命令 ID */
  OPEN_QUEUE: `${COMMAND_PREFIX}:open-queue`,
  /** 暂停队列命令 ID */
  PAUSE_QUEUE: `${COMMAND_PREFIX}:pause-queue`,
  /** 打开工作台命令 ID */
  OPEN_WORKBENCH: `${COMMAND_PREFIX}:open-workbench`,
  /** 从选中文本创建概念命令 ID */
  CREATE_CONCEPT_FROM_SELECTION: `${COMMAND_PREFIX}:create-concept-from-selection`,
  /** 清空已完成任务命令 ID */
  CLEAR_COMPLETED_TASKS: `${COMMAND_PREFIX}:clear-completed-tasks`,
  /** 重试失败任务命令 ID */
  RETRY_FAILED_TASKS: `${COMMAND_PREFIX}:retry-failed-tasks`,
  /** 生成笔记内容命令 ID */
  ENRICH_NOTE: `${COMMAND_PREFIX}:enrich-note`,
  /** 增量改进笔记命令 ID */
  IMPROVE_NOTE: `${COMMAND_PREFIX}:improve-note`,
  /** 检查重复概念命令 ID */
  CHECK_DUPLICATES: `${COMMAND_PREFIX}:check-duplicates`,
  /** 撤销上次操作命令 ID */
  UNDO_LAST_OPERATION: `${COMMAND_PREFIX}:undo-last-operation`,
  /** 切换工作台显示命令 ID */
  TOGGLE_WORKBENCH: `${COMMAND_PREFIX}:toggle-workbench`,
  /** 切换队列视图显示命令 ID */
  TOGGLE_QUEUE_VIEW: `${COMMAND_PREFIX}:toggle-queue-view`,
  /** 打开操作历史命令 ID */
  OPEN_UNDO_HISTORY: `${COMMAND_PREFIX}:open-undo-history`,
} as const;

/**
 * 核心命令快捷键配置
 * 遵循 A-UCD-05 多输入一致
 */
export const CORE_COMMAND_HOTKEYS = {
  [COMMAND_IDS.CREATE_CONCEPT]: {
    modifiers: ["Mod", "Shift"] as const,
    key: "n",
  },
  [COMMAND_IDS.OPEN_QUEUE]: {
    modifiers: ["Mod", "Shift"] as const,
    key: "q",
  },
  [COMMAND_IDS.PAUSE_QUEUE]: {
    modifiers: ["Mod", "Shift"] as const,
    key: "p",
  },
} as const;

/**
 * 获取核心命令 ID 列表
 * 返回 Requirements 9.1-9.4 定义的核心命令
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
 * @param commandId 命令 ID
 * @returns 是否符合格式
 */
export function isValidCommandId(commandId: string): boolean {
  // 格式：cognitive-razor:<action>-<target>
  // action 和 target 都是小写字母和连字符组成
  const pattern = /^cognitive-razor:[a-z]+(-[a-z]+)*$/;
  return pattern.test(commandId);
}

/**
 * 验证快捷键配置
 * @param hotkey 快捷键配置
 * @returns 是否有效
 */
export function isValidHotkey(hotkey: {
  modifiers: readonly string[];
  key: string;
}): boolean {
  const validModifiers = ["Mod", "Ctrl", "Meta", "Shift", "Alt"];
  
  // 验证修饰键
  for (const mod of hotkey.modifiers) {
    if (!validModifiers.includes(mod)) {
      return false;
    }
  }
  
  // 验证按键非空
  if (!hotkey.key || hotkey.key.length === 0) {
    return false;
  }
  
  return true;
}

/**
 * 命令定义接口（用于测试）
 */
export interface CommandDefinitionBase {
  /** 命令 ID（格式：cognitive-razor:<action>-<target>） */
  id: string;
  /** 命令名称 */
  name: string;
  /** 命令图标 */
  icon?: string;
  /** 快捷键 */
  hotkeys?: Array<{
    modifiers: Array<"Mod" | "Ctrl" | "Meta" | "Shift" | "Alt">;
    key: string;
  }>;
}

/**
 * 验证命令定义
 * @param cmd 命令定义
 * @returns 验证结果
 */
export function validateCommandDefinition(cmd: CommandDefinitionBase): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // 验证命令 ID
  if (!isValidCommandId(cmd.id)) {
    errors.push(`Invalid command ID format: ${cmd.id}`);
  }
  
  // 验证命令名称
  if (!cmd.name || cmd.name.length === 0) {
    errors.push("Command name is required");
  }
  
  // 验证快捷键（如果有）
  if (cmd.hotkeys) {
    for (let i = 0; i < cmd.hotkeys.length; i++) {
      const hotkey = cmd.hotkeys[i];
      if (!isValidHotkey(hotkey)) {
        errors.push(`Invalid hotkey at index ${i}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
