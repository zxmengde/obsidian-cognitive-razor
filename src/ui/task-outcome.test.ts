import { describe, expect, it, vi } from "vitest";
import { I18n } from "../core/i18n";
import type { QueueEvent, TaskRecord } from "../types";
import { describeTaskOutcome, notifyTaskOutcomes, taskDisplayName } from "./task-outcome";

const i18n = new I18n();

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    nodeId: "node-1",
    stageId: "tag",
    payload: { filePath: "C-知识库/间隔重复.md" },
    state: "failed",
    createdAt: 1,
    updatedAt: 2,
    attempt: 1,
    ...overrides,
  } as TaskRecord;
}

function queueOf(tasks: TaskRecord[], events: QueueEvent[]) {
  const listeners = new Set<(event: QueueEvent) => void>();
  return {
    getSnapshot: () => ({ tasks }),
    subscribe(listener: (event: QueueEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event: QueueEvent) {
      for (const listener of listeners) listener(event);
    },
    events,
  };
}

describe("task outcome notices", () => {
  it("names the note from the title, the concept or the file path", () => {
    expect(taskDisplayName(task({ noteTitle: "间隔重复" }), i18n)).toBe("间隔重复");
    expect(taskDisplayName(task({
      payload: { concept: { name: { chinese: "间隔重复", english: "Spaced repetition" } } },
    } as Partial<TaskRecord>), i18n)).toBe("间隔重复");
    expect(taskDisplayName(task(), i18n)).toBe("间隔重复");
  });

  it("reports a failure with its stage and the safe reason", () => {
    const notice = describeTaskOutcome(
      task({ error: { code: "E401_PROVIDER_NOT_CONFIGURED", kind: "known", message: "private" } }),
      [],
      i18n,
    );
    expect(notice?.level).toBe("error");
    expect(notice?.message).toContain("间隔重复");
    expect(notice?.message).toContain(i18n.messages.workbench.stages.tag);
    expect(notice?.message).toContain("Provider 未配置");
  });

  it("warns instead of claiming a failure when the request outcome is unknown", () => {
    const notice = describeTaskOutcome(
      task({ state: "interrupted", error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN", kind: "uncertain", message: "x" } }),
      [],
      i18n,
    );
    expect(notice?.level).toBe("warning");
    expect(notice?.message).toContain("结果未知");
    expect(notice?.message).not.toContain("失败");
  });

  it("announces completion only once the whole workflow has no task left to run", () => {
    const finished = task({ id: "stage-2", state: "completed", workflowId: "wf-1", stageId: "verify" });
    const stillRunning = task({ id: "stage-3", state: "running", workflowId: "wf-1", stageId: "tag" });

    expect(describeTaskOutcome(finished, [finished, stillRunning], i18n)).toBeUndefined();
    expect(describeTaskOutcome(finished, [finished], i18n)?.level).toBe("success");
  });

  it("ignores tasks that are still pending, running or cancelled", () => {
    for (const state of ["pending", "running", "cancelled"] as const) {
      expect(describeTaskOutcome(task({ state }), [], i18n)).toBeUndefined();
    }
  });

  it("looks the failed row up from the snapshot, because task-failed only names the id", () => {
    const failed = task({ error: { code: "E401_PROVIDER_NOT_CONFIGURED", kind: "known", message: "private" } });
    const queue = queueOf([failed], []);
    const notices: string[] = [];
    const stop = notifyTaskOutcomes(queue, i18n, (notice) => notices.push(notice.message));

    queue.emit({ type: "task-failed", taskId: failed.id });
    queue.emit({ type: "task-started", taskId: failed.id });

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("间隔重复");
    stop();
  });

  it("does not notify for a task that is no longer in the queue", () => {
    const queue = queueOf([], []);
    const notify = vi.fn();
    const stop = notifyTaskOutcomes(queue, i18n, notify);

    queue.emit({ type: "task-failed", taskId: "removed" });

    expect(notify).not.toHaveBeenCalled();
    stop();
  });
});
