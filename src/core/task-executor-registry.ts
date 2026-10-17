import { err } from "../types";
import type {
  QueueTaskType,
  Result,
  TaskExecutionContext,
  TaskRecord,
} from "../types";
import { getStageRole } from "./stage-catalog";

export type TaskExecutorResult = Record<string, unknown>;
export type TaskExecutor = (
  task: TaskRecord,
  signal: AbortSignal,
  context: TaskExecutionContext,
) => Promise<Result<TaskExecutorResult>>;

/** Executor dispatch is derived from the concrete stage identity. */
export class TaskExecutorRegistry {
  private readonly executors = new Map<QueueTaskType, TaskExecutor>();

  register(taskType: QueueTaskType, executor: TaskExecutor): void {
    if (this.executors.has(taskType)) {
      throw new Error(`Task executor already registered: ${taskType}`);
    }
    this.executors.set(taskType, executor);
  }

  async execute(
    task: TaskRecord,
    signal: AbortSignal,
    context: TaskExecutionContext,
  ): Promise<Result<TaskExecutorResult>> {
    const role = getStageRole(task.stageId);
    const executor = this.executors.get(role);
    if (!executor) {
      return err("E310_INVALID_STATE", `未注册阶段执行器: ${task.stageId}`, {
        stageId: task.stageId,
        role,
        taskId: task.id,
      });
    }
    return executor(task, signal, context);
  }
}
