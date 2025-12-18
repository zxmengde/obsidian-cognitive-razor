import { TaskQueue } from "./task-queue";
import { ImageGeneratePayload, Result, ok, err, ILogger } from "../types";
import { SettingsStore } from "../data/settings-store";

export class ImageInsertOrchestrator {
  constructor(
    private taskQueue: TaskQueue,
    private settingsStore: SettingsStore,
    private logger: ILogger
  ) {}

  execute(payload: ImageGeneratePayload): Result<string> {
    try {
      const settings = this.settingsStore.getSettings();
      const taskId = this.taskQueue.enqueue({
        nodeId: payload.frontmatter?.cruid || payload.filePath,
        taskType: "image-generate",
        state: "Pending",
        attempt: 0,
        maxAttempts: settings.maxRetryAttempts ?? 3,
        payload: payload as unknown as Record<string, unknown>,
        providerRef: settings.defaultProviderId
      });
      this.logger.info("ImageInsertOrchestrator", "图片生成任务已入队", { taskId, filePath: payload.filePath });
      return ok(taskId);
    } catch (error) {
      this.logger.error("ImageInsertOrchestrator", "创建图片生成任务失败", error as Error);
      return err("E500_INTERNAL_ERROR", "创建图片生成任务失败", error);
    }
  }
}
