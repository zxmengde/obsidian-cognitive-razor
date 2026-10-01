import { err, ok } from "../types/result";
import type { Result } from "../types/result";
import type { TaskRecord, TaskState } from "../types/task";

/**
 * Pure state transitions shared by every queue execution path.
 *
 * Runtime concerns such as persistence, logging, execution tokens and aborts
 * stay in TaskQueue. This module only decides whether a task transition is
 * valid and returns the next task record without mutating its input.
 */
export type QueueTaskAction = {
  type: "start";
  at: number;
};

export interface QueueTaskTransition {
  previousState: TaskState;
  task: TaskRecord;
}

export function reduceQueueTask(task: TaskRecord, action: QueueTaskAction): Result<QueueTaskTransition> {
  if (!Number.isFinite(action.at)) return err("E101_INVALID_INPUT", "任务状态时间必须是有限数字");
  if (action.type !== "start") return err("E101_INVALID_INPUT", "未知的队列状态转换");
  if (task.state !== "pending") return err("E310_INVALID_STATE", "只有待处理任务可以启动");

  return ok({
    previousState: task.state,
    task: {
      ...task,
      state: "running",
      startedAt: action.at,
      finishedAt: undefined,
      updatedAt: action.at,
    } as TaskRecord,
  });
}

/** Stable business identity. A task ID is only a scheduling attempt ID. */
export function queueTaskIdentity(task: Pick<TaskRecord, "workflowId" | "stageId">): string | undefined {
  if (!task.workflowId || !task.stageId) return undefined;
  return `${task.workflowId}\u0000${task.stageId}`;
}
