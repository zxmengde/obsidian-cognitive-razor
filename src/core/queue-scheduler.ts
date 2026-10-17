import type { Result, TaskRecord } from "../types";

/** Runtime callbacks required by the queue scheduler. */
export interface QueueSchedulerHost {
  isDisposed(): boolean;
  isPaused(): boolean;
  hasTaskRunner(): boolean;
  usesDurableStart(): boolean;
  concurrency(): number;
  activeCount(): number;
  nextPendingTask(): TaskRecord | undefined;
  startImmediately(task: TaskRecord): void;
  startDurably(taskId: string): Promise<Result<boolean>>;
  onSchedulingError(cause: unknown): void;
}

/**
 * Owns FIFO scheduling and concurrency admission only. Task state commits and
 * execution lifetimes stay behind the host callbacks.
 */
export class QueueScheduler {
  private scheduling = false;
  private disposed = false;

  constructor(private readonly host: QueueSchedulerHost) {}

  request(): void {
    if (!this.canSchedule() || this.scheduling) return;
    if (!this.host.usesDurableStart()) {
      this.scheduling = true;
      try {
        this.scheduleImmediately();
      } catch (cause) {
        this.host.onSchedulingError(cause);
      } finally {
        this.scheduling = false;
      }
      return;
    }

    this.scheduling = true;
    void this.scheduleDurably().then(
      (shouldReschedule) => this.finishPass(shouldReschedule),
      (cause) => {
        this.host.onSchedulingError(cause);
        this.finishPass(false);
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.scheduling = false;
  }

  private scheduleImmediately(): void {
    while (this.canSchedule() && this.host.activeCount() < this.host.concurrency()) {
      const task = this.host.nextPendingTask();
      if (!task) return;
      this.host.startImmediately(task);
      // A host callback must consume the selected task. Stop if it did not;
      // otherwise one malformed callback could spin the scheduler forever.
      if (task.state === "pending") return;
    }
  }

  private async scheduleDurably(): Promise<boolean> {
    while (this.canSchedule() && this.host.activeCount() < this.host.concurrency()) {
      const task = this.host.nextPendingTask();
      if (!task) return false;
      const started = await this.host.startDurably(task.id);
      if (!started.ok) {
        this.host.onSchedulingError(started.error);
        return false;
      }
      if (!started.value) continue;
    }
    return this.canSchedule() && this.host.activeCount() < this.host.concurrency() && !!this.host.nextPendingTask();
  }

  private finishPass(shouldReschedule: boolean): void {
    this.scheduling = false;
    if (shouldReschedule) this.request();
  }

  private canSchedule(): boolean {
    return !this.disposed
      && !this.host.isDisposed()
      && !this.host.isPaused()
      && this.host.hasTaskRunner();
  }
}
