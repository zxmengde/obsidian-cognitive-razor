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

  /**
   * 加载管线状态文件
   *
   * 文件不存在时返回 null；文件损坏时清空状态并记录警告（需求 33.5）
   */
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
        // 文件损坏：清空状态并记录警告（需求 33.5）
        this.logger.warn("PipelineStateStore", "管线状态文件格式无效，已清空", {
          path: this.path,
        });
        await this.clear();
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
      // JSON 解析失败等异常：清空状态并记录警告（需求 33.5）
      this.logger.warn("PipelineStateStore", "管线状态文件损坏，已清空", {
        path: this.path,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.clear();
      return ok(null);
    }
  }

  /**
   * 保存完整管线状态
   */
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

  /**
   * 清空管线状态文件（损坏恢复用）
   *
   * @see 需求 33.5
   */
  async clear(): Promise<Result<void>> {
    const emptyState: PipelineStateFile = {
      version: "1.0.0",
      pipelines: {},
      taskToPipeline: {},
    };
    return this.save(emptyState);
  }

  /**
   * 从多个 Orchestrator 收集活跃管线状态并持久化
   *
   * 仅持久化处于 review_changes 阶段的管线（需求 33.1）
   * 管线完成或取消后自动从文件中移除（需求 33.4）
   */
  async persistFromOrchestrators(
    orchestrators: Array<{
      getActiveState(): {
        pipelines: Map<string, PipelineContext>;
        taskToPipeline: Map<string, string>;
      };
    }>,
  ): Promise<Result<void>> {
    const allPipelines: Record<string, PipelineContext> = {};
    const allTaskToPipeline: Record<string, string> = {};

    for (const orch of orchestrators) {
      const state = orch.getActiveState();
      for (const [id, ctx] of state.pipelines) {
        // 仅持久化处于 Diff 确认阶段的管线（需求 33.1）
        if (ctx.stage === "review_changes") {
          allPipelines[id] = ctx;
        }
      }
      for (const [taskId, pipelineId] of state.taskToPipeline) {
        if (allPipelines[pipelineId]) {
          allTaskToPipeline[taskId] = pipelineId;
        }
      }
    }

    return this.save({
      version: "1.0.0",
      pipelines: allPipelines,
      taskToPipeline: allTaskToPipeline,
    });
  }

  /**
   * 从文件恢复管线状态到各 Orchestrator
   *
   * @see 需求 33.2
   */
  async restoreToOrchestrators(
    orchestrators: Array<{
      restorePipelines(
        pipelines: Map<string, PipelineContext>,
        taskToPipeline: Map<string, string>,
      ): void;
    }>,
  ): Promise<Result<number>> {
    const loadResult = await this.load();
    if (!loadResult.ok) {
      return err(loadResult.error.code, loadResult.error.message);
    }

    const state = loadResult.value;
    if (!state || Object.keys(state.pipelines).length === 0) {
      return ok(0);
    }

    const pipelines = new Map<string, PipelineContext>();
    const taskToPipeline = new Map<string, string>();

    for (const [id, ctx] of Object.entries(state.pipelines)) {
      pipelines.set(id, ctx);
    }
    for (const [taskId, pipelineId] of Object.entries(state.taskToPipeline)) {
      taskToPipeline.set(taskId, pipelineId);
    }

    // 分发到各 Orchestrator（每个 Orchestrator 的 restorePipelines 会按 kind 过滤）
    for (const orch of orchestrators) {
      orch.restorePipelines(pipelines, taskToPipeline);
    }

    const count = pipelines.size;
    this.logger.info("PipelineStateStore", `已恢复 ${count} 条管线状态`, {
      pipelineIds: Array.from(pipelines.keys()),
    });

    return ok(count);
  }
}
