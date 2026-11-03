/**
 * 任务队列的纯投影逻辑。
 *
 * QueueSection 原先把筛选、分组、选择计数和渲染混在一个组件里；这里只保留
 * 与 DOM 无关的计算，便于单独测试，也让界面部分只负责展示与转发事件。
 */
import type { TaskRecord, TaskStageId, TaskState } from '../types';
import { isUncertainTask } from '../core/task-uncertainty';

export type QueueFilter = 'all' | 'active' | TaskState;
export type StageFilter = 'all' | TaskStageId;

export interface QueueGroups {
  /** 符合当前筛选的任务，顺序沿用队列快照。 */
  filtered: TaskRecord[];
  /** 未结束的任务；筛选不是 all 时，它就是全部筛选结果。 */
  primary: TaskRecord[];
  /** 已完成与已取消；只有未筛选时才单独分组。 */
  history: TaskRecord[];
}

export interface QueueSelectionView {
  selectedTasks: TaskRecord[];
  selectedActive: TaskRecord[];
  selectedFailed: TaskRecord[];
  selectedRemovable: TaskRecord[];
}

/** 按状态与阶段筛选，顺序不变。 */
export function filterQueueTasks(
  tasks: TaskRecord[],
  stateFilter: QueueFilter,
  stageFilter: StageFilter,
): TaskRecord[] {
  return tasks.filter((task) => {
    const stateMatches = stateFilter === 'all'
      || (stateFilter === 'active' && (task.state === 'pending' || task.state === 'running'))
      || task.state === stateFilter;
    return stateMatches && (stageFilter === 'all' || task.stageId === stageFilter);
  });
}

/** 主列表与历史分开；显式筛选时历史为空，结果只出现在主列表。 */
export function groupQueueTasks(filtered: TaskRecord[], stateFilter: QueueFilter): QueueGroups {
  const isHistory = (task: TaskRecord) => task.state === 'completed' || task.state === 'cancelled';
  return {
    filtered,
    primary: stateFilter === 'all' ? filtered.filter((task) => !isHistory(task)) : filtered,
    history: stateFilter === 'all' ? filtered.filter(isHistory) : [],
  };
}

/** 需要人工处理的项：失败与结果未知。 */
export function countAttention(tasks: TaskRecord[]): number {
  return tasks.filter((task) => task.state === 'failed' || task.state === 'interrupted').length;
}

/** 需要人工确认的项：结果未知的失败与中断。 */
export function countUncertain(tasks: TaskRecord[]): number {
  return tasks.filter((task) => (task.state === 'failed' || task.state === 'interrupted') && isUncertainTask(task)).length;
}

/** 批量重试只接受可安全重发的失败；卡片任务与结果未知的项排除在外。 */
export function countRetryableFailed(tasks: TaskRecord[]): number {
  return tasks.filter((task) => (task.localSavePending || task.stageId !== 'cards') && task.state === 'failed' && !isUncertainTask(task)).length;
}

/** 选择状态的任务分类；未包含在 tasks 里的 id 会被忽略。 */
export function viewQueueSelection(tasks: TaskRecord[], selectedIds: ReadonlySet<string>): QueueSelectionView {
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));
  return {
    selectedTasks,
    selectedActive: selectedTasks.filter((task) => task.state === 'pending' || task.state === 'running'),
    selectedFailed: selectedTasks.filter((task) => (task.localSavePending || task.stageId !== 'cards') && task.state === 'failed' && !isUncertainTask(task)),
    selectedRemovable: selectedTasks.filter((task) => task.state !== 'running' && !task.localSavePending),
  };
}

/** 已选是否覆盖当前可选择的全部任务。 */
export function isEveryTaskSelected(selectableTasks: TaskRecord[], selectedIds: ReadonlySet<string>): boolean {
  return selectableTasks.length > 0 && selectableTasks.every((task) => selectedIds.has(task.id));
}

/** 勾选全部时返回需要加入与需要移除的 id；取消全选时加入为空。 */
export function toggleAllSelection(
  selectableTasks: TaskRecord[],
  selectedIds: ReadonlySet<string>,
): { add: string[]; remove: string[] } {
  if (isEveryTaskSelected(selectableTasks, selectedIds)) return { add: [], remove: selectableTasks.map((task) => task.id) };
  return { add: selectableTasks.filter((task) => !selectedIds.has(task.id)).map((task) => task.id), remove: [] };
}
