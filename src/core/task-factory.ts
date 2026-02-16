import type { TaskRecord, TaskType, TaskPayloadMap } from "../types";

/**
 * 类型安全的任务创建参数
 *
 * 使用泛型 T 约束 taskType 与 payload 的对应关系，
 * 确保编译期捕获类型不匹配错误。
 */
export interface CreateQueueTaskParams<T extends TaskType = TaskType> {
    nodeId: string;
    taskType: T;
    payload: TaskPayloadMap[T];
    maxAttempts: number;
    providerRef?: string;
    promptRef?: string;
    typeLockKey?: string;
}

/**
 * 任务创建工厂
 *
 * 通过泛型参数将 TaskType 与对应的 Payload 类型绑定，
 * 消除 Record<string, unknown> 和 any 类型断言。
 */
export class TaskFactory {
    static create<T extends TaskType>(
        params: CreateQueueTaskParams<T>
    ): Omit<TaskRecord, "id" | "created" | "updated"> {
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
