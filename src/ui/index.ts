/**
 * UI 组件导出
 */

export { WorkbenchPanel, WORKBENCH_VIEW_TYPE } from "./workbench-panel";
export type { RecentOperation } from "./workbench-panel";

// StandardizedConcept 类型从 types.ts 导出
export type { StandardizedConcept } from "../types";

// export { QueueView, QUEUE_VIEW_TYPE } from "./queue-view"; // 已废除，功能已整合到 WorkbenchPanel

export { DiffView, SimpleDiffView } from "./diff-view";
export type { DiffType, DiffItem, DiffData } from "./diff-view";

export { StatusBadge } from "./status-badge";

export { UndoNotification } from "./undo-notification";
export type { UndoNotificationOptions } from "./undo-notification";

export { CommandDispatcher } from "./command-dispatcher";
export type { CommandHandler, CommandDefinition } from "./command-dispatcher";

export {
  TextInputModal,
  SelectModal,
  ConfirmModal,
  ProviderConfigModal
} from "./modals";

// Modal 类型从 types.ts 导出
export type {
  TextInputModalOptions,
  SelectOption,
  SelectModalOptions,
  ConfirmModalOptions,
  ProviderConfigModalOptions
} from "../types";
