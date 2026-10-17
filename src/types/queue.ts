/**
 * 队列系统类型定义
 */

import type { TaskRecord } from "./task";

/** 队列状态 */
export interface QueueStatus {
    paused: boolean;
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    interrupted: number;
}

/** 队列事件 */
export type QueueEvent =
    | { type: "task-added" | "task-started" | "task-failed" | "task-cancelled"; taskId: string }
    | { type: "task-completed"; task: TaskRecord }
    | { type: "task-retried"; taskId: string; task: TaskRecord }
    | { type: "task-removed"; taskId: string; task: TaskRecord }
    | { type: "tasks-cancelled"; taskIds: string[] }
    | { type: "tasks-retried"; taskIds: string[] }
    | { type: "tasks-removed"; taskIds: string[] }
    | { type: "queue-paused" | "queue-resumed" };

/** 队列事件监听器 */
export type QueueEventListener = (event: QueueEvent) => void;
