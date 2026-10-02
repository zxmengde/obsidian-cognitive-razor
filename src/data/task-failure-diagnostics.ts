import type { TaskError } from '../types/task';

/** Follow only bounded error-detail wrappers; persist numeric allowlisted diagnostics. */
export function taskFailureDiagnostics(details: unknown): Pick<TaskError, 'upstreamStatus' | 'requestTimeoutMs'> {
    const seen = new Set<object>();
    for (let depth = 0; depth < 8; depth++) {
        if (!details || typeof details !== 'object' || Array.isArray(details) || seen.has(details)) return {};
        seen.add(details);
        const value = details as Record<string, unknown>;
        if (value.kind === 'upstream-http' && typeof value.status === 'number' && [408, 502, 503, 504, 524].includes(value.status)) return { upstreamStatus: value.status };
        if (typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0) return { requestTimeoutMs: value.timeoutMs };
        details = value.details;
    }
    return {};
}
