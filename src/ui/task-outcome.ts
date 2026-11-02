import type { I18n } from "../core/i18n";
import type { QueueEvent, TaskRecord } from "../types";
import { toSafeErrorFeedback } from "./error-feedback";
import { stageLabel } from "./stage-labels";

/**
 * Outcome notifications for durable tasks.
 *
 * Long stages run while the user is reading or editing elsewhere, so a finished
 * or failed task has to reach them without reopening the workbench. Only the
 * last task of a workflow produces a "completed" notice; per-stage completion
 * would produce six notices for one note.
 */
export interface TaskOutcomeNotice {
  level: "success" | "error" | "warning";
  message: string;
}

/** Latest task name the queue shows for a record; shared with the queue list. */
export function taskDisplayName(task: TaskRecord, i18n: I18n): string {
  const t = i18n.messages;
  if (task.noteTitle?.trim()) return task.noteTitle;
  const payload = task.payload;
  if ("concept" in payload && payload.concept) return payload.concept.name.chinese || payload.concept.name.english;
  if ("filePath" in payload && payload.filePath) {
    return (payload.filePath.split("/").pop() || payload.filePath).replace(/\.md$/, "");
  }
  return t.workbench.queueStatus.unnamedNote;
}

function isActiveWorkflowTask(task: TaskRecord, workflowId: string | undefined): boolean {
  return workflowId !== undefined
    && task.workflowId === workflowId
    && (task.state === "pending" || task.state === "running");
}

/** Describes the notice for one terminal task, or undefined when nothing should pop up. */
export function describeTaskOutcome(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  i18n: I18n,
): TaskOutcomeNotice | undefined {
  const t = i18n.messages;
  const name = taskDisplayName(task, i18n);

  if (task.state === "completed") {
    // Later stages of the same workflow continue on their own; only the last
    // one means the note is ready.
    if (tasks.some((other) => other.id !== task.id && isActiveWorkflowTask(other, task.workflowId))) {
      return undefined;
    }
    if (task.stageId === "cards") {
      const path = "targetPath" in task.payload ? task.payload.targetPath : task.filePath;
      return { level: "success", message: i18n.format("cards.completed", { path: path ?? "" }) };
    }
    return { level: "success", message: i18n.format("workbench.notifications.taskCompleted", { name }) };
  }

  if (task.state === "failed" || task.state === "interrupted") {
    const stage = stageLabel(task.stageId, t);
    if (task.state === "interrupted") {
      return {
        level: "warning",
        message: i18n.format("workbench.notifications.taskUncertain", { name, stage }),
      };
    }
    const reason = toSafeErrorFeedback({ code: task.error?.code }, t.workbench.notifications.unknownFailure).message;
    return {
      level: "error",
      message: i18n.format("workbench.notifications.taskFailed", { name, stage, reason }),
    };
  }

  return undefined;
}

/** Subscribes once per runtime; returns the unsubscribe handle. */
export function notifyTaskOutcomes(
  queue: {
    getSnapshot(): { tasks: TaskRecord[] };
    subscribe(listener: (event: QueueEvent) => void): () => void;
  },
  i18n: I18n,
  notify: (notice: TaskOutcomeNotice) => void,
): () => void {
  return queue.subscribe((event) => {
    if (event.type !== "task-completed" && event.type !== "task-failed") return;
    // task-failed only names the id; the row carrying the error is in the snapshot.
    const tasks = queue.getSnapshot().tasks;
    const task = event.type === "task-completed"
      ? event.task
      : tasks.find((candidate) => candidate.id === event.taskId);
    if (!task) return;
    const notice = describeTaskOutcome(task, tasks, i18n);
    if (notice) notify(notice);
  });
}
