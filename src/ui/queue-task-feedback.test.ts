import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../types';
import { taskFailureDiagnostics } from '../data/task-failure-diagnostics';
import { queueTaskFeedback } from './queue-task-feedback';

const task: TaskRecord = { id: 'synthetic', nodeId: 'synthetic', stageId: 'core', payload: {}, state: 'interrupted', createdAt: 1, updatedAt: 61000, startedAt: 1000, finishedAt: 61000, attempt: 1,
    error: { code: 'E206_PROVIDER_REQUEST_UNCERTAIN', kind: 'uncertain', message: 'Authorization: Bearer synthetic-secret; private note content' } };

describe('safe queue failure presentation', () => {
    it('explains a changed note and retained result instead of suggesting waiting for a lock', () => {
        const feedback = queueTaskFeedback({ ...task, state: 'failed', error: { code: 'E321_NOTE_SNAPSHOT_CHANGED', kind: 'known', message: 'private note' } }, 'fallback');
        expect(feedback?.message).toContain('笔记');
        expect(feedback?.message).toContain('修改');
        expect(feedback?.details).toContain('结果已保留');
        expect(feedback?.details).toContain('不会再次请求模型');
        expect(feedback?.details).not.toContain('等待当前任务');
        expect(JSON.stringify(feedback)).not.toContain('private note');
    });
    it('recognizes exact legacy snapshot messages without exposing arbitrary E320 text', () => {
        const make = (message: string) => queueTaskFeedback({ ...task, state: 'failed', error: { code: 'E320_TASK_CONFLICT', kind: 'known', message } }, 'fallback');
        expect(make('核查期间笔记已修改，未覆盖用户内容')?.details).toContain('结果已保留');
        expect(make('Draft 笔记已被修改，未覆盖用户内容')?.details).toContain('不会再次请求模型');
        expect(make('核查期间笔记已修改，未覆盖用户内容 secret')?.message).not.toContain('secret');
        expect(make('other')?.details).toContain('等待当前任务');
    });
    it('carries only allowlisted upstream status or local timeout, never headers or response bodies', () => {
        expect(taskFailureDiagnostics({ kind: 'upstream-http', status: 524, timeoutMs: 180000, headers: { Authorization: 'private' }, rawResponse: 'private' })).toEqual({ upstreamStatus: 524 });
        expect(taskFailureDiagnostics({ timeoutMs: 60000, rawError: 'private' })).toEqual({ requestTimeoutMs: 60000 });
        expect(taskFailureDiagnostics({ kind: 'upstream-http', status: '524', timeoutMs: Infinity })).toEqual({});
        expect(taskFailureDiagnostics({ kind: 'untrusted', status: 524, timeoutMs: -1 })).toEqual({});
        expect(queueTaskFeedback({ ...task, error: { ...task.error!, upstreamStatus: 524 } }, 'fallback')).toMatchObject({ upstreamStatus: 524, elapsedSeconds: 60 });
    });
    it('shows elapsed time and uncertainty without exposing raw error content or guessing the timeout limit', () => {
        const result = queueTaskFeedback(task, 'safe fallback');
        expect(result).toMatchObject({ uncertain: true, elapsedSeconds: 60 });
        expect(result?.message).toContain('无法确认');
        expect(JSON.stringify(result)).not.toMatch(/Authorization|synthetic-secret|private note/);
        expect(task.error?.message).toContain('private note');
    });
    it('uses only known error descriptions and safe fallback for unknown codes', () => {
        expect(queueTaskFeedback({ ...task, state: 'failed', error: { code: 'E401_PROVIDER_NOT_CONFIGURED', kind: 'known', message: 'private' } }, 'safe fallback')?.details).toContain('默认服务');
        expect(queueTaskFeedback({ ...task, state: 'failed', error: { code: 'private unknown', kind: 'known', message: 'private' } }, 'safe fallback')?.message).toBe('safe fallback');
        expect(queueTaskFeedback({ ...task, state: 'running' }, 'safe fallback')).toBeUndefined();
    });
    it.each([[undefined, 61000], [1000, undefined], [NaN, 61000], [1000, Infinity], [61000, 1000], [-1, 1000]])('omits invalid or missing elapsed times (%s, %s)', (startedAt, finishedAt) => {
        expect(queueTaskFeedback({ ...task, startedAt, finishedAt }, 'safe fallback')?.elapsedSeconds).toBeUndefined();
    });
});
