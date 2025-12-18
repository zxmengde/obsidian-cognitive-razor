import type { TaskRecord, TaskType } from "../types";

export interface CreateQueueTaskParams {
  nodeId: string;
  taskType: TaskType;
  payload: Record<string, unknown>;
  maxAttempts: number;
  providerRef?: string;
  promptRef?: string;
  typeLockKey?: string;
}

export class TaskFactory {
  static create(params: CreateQueueTaskParams): Omit<TaskRecord, "id" | "created" | "updated"> {
    return {
      nodeId: params.nodeId,
      taskType: params.taskType,
      state: "Pending",
      attempt: 0,
      maxAttempts: params.maxAttempts,
      providerRef: params.providerRef,
      promptRef: params.promptRef,
      typeLockKey: params.typeLockKey,
      payload: params.payload,
    };
  }
}

