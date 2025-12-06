/**
 * UI 组件导出
 */

export { WorkbenchPanel, WORKBENCH_VIEW_TYPE } from "./workbench-panel";
export type { RecentOperation } from "./workbench-panel";

export { QueueView, QUEUE_VIEW_TYPE } from "./queue-view";

export { DiffView, SimpleDiffView } from "./diff-view";
export type { DiffType, DiffItem, DiffData } from "./diff-view";

export { StatusBadge } from "./status-badge";

export { CommandDispatcher } from "./command-dispatcher";
export type { CommandHandler, CommandDefinition } from "./command-dispatcher";
