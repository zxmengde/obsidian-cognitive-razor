import { isUncertainTask } from '../core/task-uncertainty';
import type { TaskRecord } from '../types';
import { taskFailureDiagnostics } from '../data/task-failure-diagnostics';
import { toSafeErrorFeedback } from './error-feedback';

/** Only allowlisted error-code text and finite timestamps reach the queue UI. */
export function queueTaskFeedback(task: TaskRecord, fallback: string) {
    if (task.state !== 'failed' && task.state !== 'interrupted') return undefined;
    const uncertain = isUncertainTask(task);
    // Older queue records used the lock code for these exact local conflicts.
    // Map only known local messages; never show arbitrary persisted error text.
    const snapshotConflict = task.error?.code === 'E320_TASK_CONFLICT' && [
        'Draft 笔记已被修改，未覆盖用户内容',
        '核查期间笔记已修改，未覆盖用户内容',
    ].includes(task.error.message);
    const feedback = toSafeErrorFeedback({ code: task.error?.code === 'E322_LOCAL_RESULT_UNAVAILABLE' ? task.error.code
        : uncertain ? 'E206_PROVIDER_REQUEST_UNCERTAIN' : snapshotConflict ? 'E321_NOTE_SNAPSHOT_CHANGED' : task.error?.code }, fallback);
    if (task.localSavePending) return {
        ...feedback, uncertain: false,
        message: '任务请求已结束，但本地状态保存失败',
        details: '检查磁盘权限和可用空间后重试保存；会保存已有结果，不会再次请求模型',
        elapsedSeconds: undefined, upstreamStatus: undefined, requestTimeoutMs: undefined,
    };
    if (task.error?.code === 'E322_LOCAL_RESULT_UNAVAILABLE') return {
        ...feedback, uncertain: true,
        elapsedSeconds: undefined, upstreamStatus: undefined, requestTimeoutMs: undefined,
    };
    const { startedAt, finishedAt } = task;
    const elapsed = typeof startedAt === 'number' && typeof finishedAt === 'number'
        && Number.isFinite(startedAt) && Number.isFinite(finishedAt) && startedAt >= 0 && finishedAt >= startedAt
        ? (finishedAt - startedAt) / 1000 : undefined;
    const elapsedSeconds = elapsed !== undefined && Number.isSafeInteger(Math.ceil(elapsed)) ? Math.ceil(elapsed) : undefined;
    const diagnostic = taskFailureDiagnostics({ kind: 'upstream-http', status: task.error?.upstreamStatus, timeoutMs: task.error?.requestTimeoutMs });
    return { ...feedback, uncertain, elapsedSeconds, ...diagnostic };
}
