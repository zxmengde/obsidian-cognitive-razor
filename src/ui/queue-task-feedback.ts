import { isUncertainTask } from '../core/task-uncertainty';
import type { TaskRecord } from '../types';
import { taskFailureDiagnostics } from '../data/task-failure-diagnostics';
import { toSafeErrorFeedback } from './error-feedback';

/** Only allowlisted error-code text and finite timestamps reach the queue UI. */
export function queueTaskFeedback(task: TaskRecord, fallback: string) {
    if (task.state !== 'failed' && task.state !== 'interrupted') return undefined;
    const uncertain = isUncertainTask(task);
    const feedback = toSafeErrorFeedback({ code: uncertain ? 'E206_PROVIDER_REQUEST_UNCERTAIN' : task.error?.code }, fallback);
    const { startedAt, finishedAt } = task;
    const elapsed = typeof startedAt === 'number' && typeof finishedAt === 'number'
        && Number.isFinite(startedAt) && Number.isFinite(finishedAt) && startedAt >= 0 && finishedAt >= startedAt
        ? (finishedAt - startedAt) / 1000 : undefined;
    const elapsedSeconds = elapsed !== undefined && Number.isSafeInteger(Math.ceil(elapsed)) ? Math.ceil(elapsed) : undefined;
    const diagnostic = taskFailureDiagnostics({ kind: 'upstream-http', status: task.error?.upstreamStatus, timeoutMs: task.error?.requestTimeoutMs });
    return { ...feedback, uncertain, elapsedSeconds, ...diagnostic };
}
