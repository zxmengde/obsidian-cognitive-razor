import { describe, expect, it } from 'vitest';
import { taskFailureDiagnostics } from './task-failure-diagnostics';

describe('safe wrapped transport diagnostics', () => {
    it('reads nested wrappers without preserving bodies or task IDs', () => {
        expect(taskFailureDiagnostics({ taskId: 'private', details: { details: { kind: 'upstream-http', status: 524, rawResponse: 'private' } } })).toEqual({ upstreamStatus: 524 });
        expect(taskFailureDiagnostics({ details: { timeoutMs: 60000 } })).toEqual({ requestTimeoutMs: 60000 });
    });
    it('rejects arbitrary branches, nonallowlisted values, cycles and excessive nesting', () => {
        const cycle: { details?: unknown } = {}; cycle.details = cycle;
        let deep: unknown = { kind: 'upstream-http', status: 524 };
        for (let i = 0; i < 8; i++) deep = { details: deep };
        for (const value of [cycle, deep, { rawResponse: { kind: 'upstream-http', status: 524 } }, { status: 524 }, { kind: 'upstream-http', status: 200 }, { timeoutMs: Infinity }, { timeoutMs: -1 }]) expect(taskFailureDiagnostics(value)).toEqual({});
    });
});
