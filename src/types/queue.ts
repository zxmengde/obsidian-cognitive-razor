/**
 * 队列系统类型定义
 */

import type { TaskState } from "./task";

/** 队列状态 */
export interface QueueStatus {
    paused: boolean;
    pending: number;
    running: number;
    completed: number;
    failed: number;
}

/** 队列事件类型 */
type QueueEventType =
    | "task-added" | "task-started" | "task-completed"
    | "task-failed" | "task-cancelled"
    | "queue-paused" | "queue-resumed";

/** 队列事件 */
export interface QueueEvent {
    type: QueueEventType;
    taskId?: string;
    timestamp: string;
}

/** 队列事件监听器 */
export type QueueEventListener = (event: QueueEvent) => void;

/** 任务结果 */
export interface TaskResult {
    taskId: string;
    state: TaskState;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; timestamp: string; attempt: number };
}

