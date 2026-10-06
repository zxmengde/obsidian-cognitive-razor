import type { TaskRecord } from '../types';

/** Treat either persisted marker as uncertain; inconsistent old records must not replay silently. */
export function isUncertainTask(task: Pick<TaskRecord, 'error'>): boolean {
    return task.error?.kind === 'uncertain' || task.error?.code === 'E206_PROVIDER_REQUEST_UNCERTAIN'
        || task.error?.code === 'E322_LOCAL_RESULT_UNAVAILABLE';
}
