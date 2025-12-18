import type { FileStorage } from "../data/file-storage";
import {
  ILogger,
  PipelineContext,
  Result,
  ok,
  err,
} from "../types";

export interface PipelineStateFile {
  version: "1.0.0";
  pipelines: Record<string, PipelineContext>;
  taskToPipeline: Record<string, string>;
}

export class PipelineStateStore {
  private readonly fileStorage: FileStorage;
  private readonly logger: ILogger;
  private readonly path: string;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(fileStorage: FileStorage, logger: ILogger, path: string = "data/pipeline-state.json") {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.path = path;
  }

  async load(): Promise<Result<PipelineStateFile | null>> {
    try {
      const exists = await this.fileStorage.exists(this.path);
      if (!exists) {
        return ok(null);
      }

      const readResult = await this.fileStorage.read(this.path);
      if (!readResult.ok) {
        return readResult as Result<PipelineStateFile | null>;
      }

      const parsed = JSON.parse(readResult.value) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return ok(null);
      }

      const obj = parsed as Record<string, unknown>;
      const pipelinesRaw = obj.pipelines && typeof obj.pipelines === "object" ? (obj.pipelines as Record<string, unknown>) : {};
      const taskToPipelineRaw = obj.taskToPipeline && typeof obj.taskToPipeline === "object" ? (obj.taskToPipeline as Record<string, unknown>) : {};

      const pipelines: Record<string, PipelineContext> = {};
      for (const [pipelineId, ctx] of Object.entries(pipelinesRaw)) {
        if (!ctx || typeof ctx !== "object") continue;
        pipelines[pipelineId] = ctx as PipelineContext;
      }

      const taskToPipeline: Record<string, string> = {};
      for (const [taskId, pipelineId] of Object.entries(taskToPipelineRaw)) {
        if (typeof pipelineId !== "string") continue;
        taskToPipeline[taskId] = pipelineId;
      }

      return ok({
        version: "1.0.0",
        pipelines,
        taskToPipeline,
      });
    } catch (error) {
      this.logger.error("PipelineStateStore", "加载管线状态失败", error as Error, {
        path: this.path,
      });
      return err("E500_INTERNAL_ERROR", "加载管线状态失败", error);
    }
  }

  async save(state: PipelineStateFile): Promise<Result<void>> {
    const content = JSON.stringify(state, null, 2);

    this.saveChain = this.saveChain
      .then(async () => {
        const writeResult = await this.fileStorage.atomicWrite(this.path, content);
        if (!writeResult.ok) {
          this.logger.error("PipelineStateStore", "保存管线状态失败", undefined, {
            path: this.path,
            error: writeResult.error,
          });
        }
      })
      .catch((error) => {
        this.logger.error("PipelineStateStore", "保存管线状态异常", error as Error, {
          path: this.path,
        });
      });

    await this.saveChain;
    return ok(undefined);
  }
}
