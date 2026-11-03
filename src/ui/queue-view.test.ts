import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../types';
import {
  countAttention,
  countRetryableFailed,
  countUncertain,
  filterQueueTasks,
  groupQueueTasks,
  isEveryTaskSelected,
  toggleAllSelection,
  viewQueueSelection,
} from './queue-view';

function task(id: string, state: TaskRecord['state'], stageId: TaskRecord['stageId'] = 'core', extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id, nodeId: id, stageId, payload: {}, state, createdAt: 1, updatedAt: 1, attempt: 1, ...extra } as TaskRecord;
}

const UNCERTAIN = { code: 'E206_PROVIDER_REQUEST_UNCERTAIN', kind: 'uncertain' as const, message: 'unknown' };

describe('queue projections', () => {
  const tasks = [
    task('pending', 'pending'),
    task('running', 'running', 'narrative'),
    task('failed', 'failed', 'core'),
    task('unknown', 'interrupted', 'core', { error: UNCERTAIN }),
    task('card-failed', 'failed', 'cards'),
    task('done', 'completed', 'core'),
    task('cancelled', 'cancelled', 'core'),
  ];

  it('filters by state and stage without reordering the snapshot', () => {
    expect(filterQueueTasks(tasks, 'all', 'all').map(t => t.id)).toEqual(tasks.map(t => t.id));
    expect(filterQueueTasks(tasks, 'active', 'all').map(t => t.id)).toEqual(['pending', 'running']);
    expect(filterQueueTasks(tasks, 'failed', 'all').map(t => t.id)).toEqual(['failed', 'card-failed']);
    expect(filterQueueTasks(tasks, 'all', 'narrative').map(t => t.id)).toEqual(['running']);
    expect(filterQueueTasks(tasks, 'failed', 'narrative')).toEqual([]);
  });

  it('splits unfinished work from history only when nothing is filtered', () => {
    const all = groupQueueTasks(filterQueueTasks(tasks, 'all', 'all'), 'all');
    expect(all.primary.map(t => t.id)).toEqual(['pending', 'running', 'failed', 'unknown', 'card-failed']);
    expect(all.history.map(t => t.id)).toEqual(['done', 'cancelled']);

    const completedOnly = groupQueueTasks(filterQueueTasks(tasks, 'completed', 'all'), 'completed');
    expect(completedOnly.primary.map(t => t.id)).toEqual(['done']);
    expect(completedOnly.history).toEqual([]);
  });

  it('counts attention, uncertainty and safe bulk retries separately', () => {
    const primary = groupQueueTasks(tasks, 'all').primary;
    expect(countAttention(primary)).toBe(3);
    expect(countUncertain(primary)).toBe(1);
    // Card tasks are regenerated from their note, never retried from the queue.
    expect(countRetryableFailed(tasks)).toBe(1);
  });

  it('classifies the current selection for each batch action', () => {
    const view = viewQueueSelection(tasks, new Set(['pending', 'running', 'failed', 'unknown', 'card-failed', 'done']));
    expect(view.selectedActive.map(t => t.id)).toEqual(['pending', 'running']);
    expect(view.selectedFailed.map(t => t.id)).toEqual(['failed']);
    expect(view.selectedRemovable.map(t => t.id)).toEqual(['pending', 'failed', 'unknown', 'card-failed', 'done']);
    expect(viewQueueSelection(tasks, new Set(['deleted'])).selectedTasks).toEqual([]);
  });

  it('toggles every selectable task without touching ids outside that list', () => {
    const selectable = [tasks[0], tasks[2]];
    expect(isEveryTaskSelected(selectable, new Set())).toBe(false);
    const first = toggleAllSelection(selectable, new Set(['out-of-scope']));
    expect(first.add).toEqual(['pending', 'failed']);
    expect(first.remove).toEqual([]);
    expect(isEveryTaskSelected(selectable, new Set(['pending', 'failed', 'out-of-scope']))).toBe(true);
    const second = toggleAllSelection(selectable, new Set(['pending', 'failed', 'out-of-scope']));
    expect(second.add).toEqual([]);
    expect(second.remove).toEqual(['pending', 'failed']);
    expect(isEveryTaskSelected([], new Set())).toBe(false);
  });
});
