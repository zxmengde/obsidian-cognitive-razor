import type { FileStorage } from "../data/file-storage";
import {
  ok,
  err,
} from "../types";
import type {
  ILogger,
  QueueStateFile,
  Result,
  TaskType,
  TaskError,
} from "../types";

/** 校验字符串是否为合法 TaskType */
const VALID_TASK_TYPES = new Set<string>(["define", "tag", "write", "index", "verify"]);
function isTaskType(v: unknown): v is TaskType {
  return typeof v === "string" && VALID_TASK_TYPES.has(v);
}

export class TaskQueueStore {
  private readonly fileStorage: FileStorage;
  private readonly logger: ILogger;
  private readonly queuePath: string;

  private lastPersistedContent: string | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(fileStorage: FileStorage, logger: ILogger, queuePath: string) {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.queuePath = queuePath;
  }

  async load(): Promise<Result<{ state: QueueStateFile; migrated: boolean } | null>> {
    try {
      const exists = await this.fileStorage.exists(this.queuePath);
      if (!exists) {
        return ok(null);
      }

      const readResult = await this.fileStorage.read(this.queuePath);
      if (!readResult.ok) {
        this.logger.warn("TaskQueueStore", "读取队列状态失败，使用空队列", {
          error: readResult.error,
          path: this.queuePath,
        });
        return ok(null);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(readResult.value) as unknown;
      } catch (parseError) {
        this.logger.warn("TaskQueueStore", "解析队列状态失败，使用空队列", {
          error: parseError,
          path: this.queuePath,
        });
        return ok(null);
      }

      const normalized = this.normalizeQueueState(parsed);
      return ok(normalized);
    } catch (error) {
      this.logger.error("TaskQueueStore", "加载队列状态失败", error as Error, {
        path: this.queuePath,
      });
      return err("E500_INTERNAL_ERROR", "加载队列状态失败", error);
    }
  }

  save(state: QueueStateFile): Promise<void> {
    const content = JSON.stringify(state, null, 2);
    this.lastPersistedContent = content;

    this.saveChain = this.saveChain
      .then(async () => {
        const writeResult = await this.fileStorage.atomicWrite(this.queuePath, content);
        if (!writeResult.ok) {
          this.logger.error("TaskQueueStore", "保存队列状态失败", undefined, {
            path: this.queuePath,
            error: writeResult.error,
          });
        } else {
          this.logger.debug("TaskQueueStore", "队列状态已持久化", {
            path: this.queuePath,
            pendingTasks: state.pendingTasks.length,
          });
        }
      })
      .catch((error) => {
        this.logger.error("TaskQueueStore", "保存队列状态异常", error as Error, {
          path: this.queuePath,
        });
      });

    return this.saveChain;
  }

  getLastPersistedContent(): string | null {
    return this.lastPersistedContent;
  }

  getQueuePath(): string {
    return this.queuePath;
  }

  private normalizeQueueState(raw: unknown): { state: QueueStateFile; migrated: boolean } | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const obj = raw as Record<string, unknown>;
    const paused = typeof obj.paused === "boolean" ? obj.paused : false;
    const version = obj.version === "2.0.0" || obj.version === "1.0.0" ? obj.version : "1.0.0";

    /** 将原始任务数组映射为标准化的 PendingTask 格式 */
    const mapTasks = (tasks: Record<string, unknown>[]) =>
      tasks.map((t) => ({
        id: String(t.id),
        nodeId: String(t.nodeId),
        taskType: isTaskType(t.taskType) ? t.taskType : "define",
        attempt: typeof t.attempt === "number" ? t.attempt : 0,
        maxAttempts: typeof t.maxAttempts === "number" ? t.maxAttempts : 1,
        providerRef: typeof t.providerRef === "string" ? t.providerRef : undefined,
        promptRef: typeof t.promptRef === "string" ? t.promptRef : undefined,
        payload: t.payload && typeof t.payload === "object" && !Array.isArray(t.payload)
          ? (t.payload as Record<string, unknown>)
          : undefined,
        created: typeof t.created === "string" ? t.created : undefined,
        updated: typeof t.updated === "string" ? t.updated : undefined,
        errors: Array.isArray(t.errors) ? (t.errors as TaskError[]) : undefined,
      }));

    const filterValidTasks = (arr: unknown[]) =>
      arr
        .filter((t) => t && typeof t === "object")
        .map((t) => t as Record<string, unknown>)
        .filter((t) => typeof t.id === "string" && typeof t.nodeId === "string" && typeof t.taskType === "string");

    if (Array.isArray(obj.pendingTasks)) {
      return {
        state: { version, pendingTasks: mapTasks(filterValidTasks(obj.pendingTasks)), paused },
        migrated: false,
      };
    }

    if (Array.isArray(obj.tasks)) {
      const validTasks = filterValidTasks(obj.tasks)
        .filter((t) => t.state === "Pending" || t.state === "Running");
      return {
        state: { version: "2.0.0", pendingTasks: mapTasks(validTasks), paused },
        migrated: true,
      };
    }

    return {
      state: { version: "2.0.0", pendingTasks: [], paused },
      migrated: true,
    };
  }
}
