/**
 * ImageInsertOrchestrator：图片插入管线编排器
 *
 * 独立的图片插入管线编排器。
 * 管线流程：生成图片描述 → 调用图像 API → 保存附件 → 插入链接
 *
 * 实际执行由 TaskRunner.executeImageGenerate() 完成（包含完整的
 * 描述生成 → API 调用 → 保存 → 插入链接流程），本编排器负责：
 * 1. 前置校验（Provider 可用性、文件存在性）
 * 2. 构建类型安全的 ImageGeneratePayload 并入队
 * 3. 跟踪管线状态，订阅任务完成/失败事件
 * 4. 通过事件通知 UI 层更新
 *
 * 所有错误通过 ResultMonad 返回，不抛出未捕获异常。
 *
 * @see 需求 2.7, 2.8, 27.2
 */

import type { OrchestratorDeps } from "./orchestrator-deps";
import {
    type ILogger,
    type TaskRecord,
    type ImageGeneratePayload,
    type CRFrontmatter,
    type PluginSettings,
    type Result,
    CognitiveRazorError,
    ok,
    err,
    toErr,
} from "../types";
import { TaskFactory } from "./task-factory";
import { generateUUID } from "../data/validators";
import { formatCRTimestamp } from "../utils/date-utils";

// ============================================================================
// 类型定义
// ============================================================================

/** 图片管线阶段 */
type ImagePipelineStage =
    | "idle"
    | "enqueued"
    | "generating"
    | "completed"
    | "failed";

/** 图片管线上下文 */
export interface ImagePipelineContext {
    pipelineId: string;
    filePath: string;
    cursorPosition: { line: number; ch: number };
    userDescription?: string;
    stage: ImagePipelineStage;
    taskId?: string;
    createdAt: string;
    updatedAt: string;
    error?: { code: string; message: string };
    result?: {
        localPath: string;
        altText: string;
    };
}

/** 管线事件类型 */
type ImagePipelineEventType =
    | "stage_changed"
    | "task_completed"
    | "task_failed"
    | "pipeline_completed"
    | "pipeline_failed";

/** 管线事件 */
export interface ImagePipelineEvent {
    type: ImagePipelineEventType;
    pipelineId: string;
    stage: ImagePipelineStage;
    context: ImagePipelineContext;
    timestamp: string;
}

/** 管线事件监听器 */
type ImagePipelineEventListener = (event: ImagePipelineEvent) => void;

/** startImagePipeline 参数 */
export interface ImagePipelineOptions {
    filePath: string;
    cursorPosition: { line: number; ch: number };
    userPrompt: string;
    contextBefore: string;
    contextAfter: string;
    frontmatter?: CRFrontmatter;
}

// ============================================================================
// ImageInsertOrchestrator
// ============================================================================

export class ImageInsertOrchestrator {
    private deps: OrchestratorDeps;
    private logger: ILogger;

    /** 活跃管线上下文 */
    private pipelines: Map<string, ImagePipelineContext> = new Map();
    /** 事件监听器 */
    private listeners: ImagePipelineEventListener[] = [];
    /** taskId → pipelineId 映射 */
    private taskToPipeline: Map<string, string> = new Map();
    /** 队列事件取消订阅 */
    private unsubscribeQueue?: () => void;

    constructor(deps: OrchestratorDeps) {
        this.deps = deps;
        this.logger = deps.logger;

        // 订阅任务队列事件
        this.subscribeToTaskQueue();

        this.logger.debug("ImageInsertOrchestrator", "图片插入管线编排器初始化完成");
    }

    // ========================================================================
    // 公开方法
    // ========================================================================

    /**
     * 启动图片插入管线
     *
     * 流程：前置校验 → 构建 payload → 入队 image-generate 任务
     * TaskRunner 执行时完成：生成图片描述 → 调用图像 API → 保存附件 → 插入链接
     *
     * @param options 管线选项
     * @returns 管线 ID
     */
    startImagePipeline(options: ImagePipelineOptions): Result<string> {
        try {
            const settings = this.getSettings();

            // 前置校验：图片生成功能是否启用
            if (!settings.imageGeneration?.enabled) {
                return err("E310_INVALID_STATE", "图片生成功能未启用");
            }

            // 前置校验：文件是否存在
            const file = this.deps.noteRepository.getFileByPath(options.filePath);
            if (!file) {
                return err("E301_FILE_NOT_FOUND", `文件不存在: ${options.filePath}`);
            }

            const pipelineId = this.generatePipelineId();
            const now = formatCRTimestamp();

            // 构建类型安全的 ImageGeneratePayload
            const payload: ImageGeneratePayload = {
                filePath: options.filePath,
                cursorPosition: options.cursorPosition,
                userPrompt: options.userPrompt,
                contextBefore: options.contextBefore,
                contextAfter: options.contextAfter,
                frontmatter: options.frontmatter ?? {
                    cruid: "",
                    type: "Entity",
                    name: file.basename,
                    status: "Draft",
                } as CRFrontmatter,
            };

            // 入队 image-generate 任务
            const taskId = this.deps.taskQueue.enqueue(
                TaskFactory.create<"image-generate">({
                    nodeId: options.frontmatter?.cruid || options.filePath,
                    taskType: "image-generate",
                    payload,
                    providerRef: this.getProviderIdForTask(),
                    maxAttempts: settings.maxRetryAttempts ?? 3,
                })
            );

            // 创建管线上下文
            const context: ImagePipelineContext = {
                pipelineId,
                filePath: options.filePath,
                cursorPosition: options.cursorPosition,
                userDescription: options.userPrompt,
                stage: "enqueued",
                taskId,
                createdAt: now,
                updatedAt: now,
            };

            this.pipelines.set(pipelineId, context);
            this.taskToPipeline.set(taskId, pipelineId);

            this.logger.info("ImageInsertOrchestrator", "图片插入管线已启动", {
                pipelineId,
                taskId,
                filePath: options.filePath,
            });

            this.publishEvent({
                type: "stage_changed",
                pipelineId,
                stage: "enqueued",
                context,
                timestamp: now,
            });

            return ok(pipelineId);
        } catch (error) {
            this.logger.error("ImageInsertOrchestrator", "启动图片插入管线失败", error as Error);
            // 需求 34.3：锁冲突时使用用户友好的 i18n 提示
            if (error instanceof CognitiveRazorError && error.code === "E320_TASK_CONFLICT") {
                const msg = this.deps.i18n.t("workbench.notifications.conceptLocked");
                return err("E320_TASK_CONFLICT", msg);
            }
            return toErr(error, "E500_INTERNAL_ERROR", "启动图片插入管线失败");
        }
    }

    /**
     * 兼容旧接口：直接入队图片生成任务
     *
     * @param payload 图片生成载荷
     * @returns 任务 ID
     */
    execute(payload: ImageGeneratePayload): Result<string> {
        const result = this.startImagePipeline({
            filePath: payload.filePath,
            cursorPosition: payload.cursorPosition,
            userPrompt: payload.userPrompt,
            contextBefore: payload.contextBefore ?? "",
            contextAfter: payload.contextAfter ?? "",
            frontmatter: payload.frontmatter,
        });

        if (!result.ok) {
            return result;
        }

        // 返回 taskId 以保持旧接口兼容
        const context = this.pipelines.get(result.value);
        return ok(context?.taskId ?? result.value);
    }

    /**
     * 取消管线
     */
    cancelPipeline(pipelineId: string): Result<void> {
        const context = this.pipelines.get(pipelineId);
        if (!context) {
            return err("E310_INVALID_STATE", `管线不存在: ${pipelineId}`);
        }

        // 如果任务已入队，尝试取消
        if (context.taskId) {
            this.deps.taskRunner.abort(context.taskId);
            this.taskToPipeline.delete(context.taskId);
        }

        this.pipelines.delete(pipelineId);

        this.logger.info("ImageInsertOrchestrator", "图片插入管线已取消", { pipelineId });
        return ok(undefined);
    }

    /**
     * 获取管线上下文
     */
    getContext(pipelineId: string): ImagePipelineContext | undefined {
        return this.pipelines.get(pipelineId);
    }

    /**
     * 获取所有活跃管线
     */
    getActivePipelines(): ImagePipelineContext[] {
        return Array.from(this.pipelines.values()).filter(
            (ctx) => ctx.stage !== "completed" && ctx.stage !== "failed"
        );
    }

    /**
     * 订阅管线事件
     */
    subscribe(listener: ImagePipelineEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            const idx = this.listeners.indexOf(listener);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this.unsubscribeQueue?.();
        this.pipelines.clear();
        this.taskToPipeline.clear();
        this.listeners.length = 0;
        this.logger.debug("ImageInsertOrchestrator", "图片插入管线编排器已释放");
    }

    // ========================================================================
    // 私有方法
    // ========================================================================

    /**
     * 订阅任务队列事件
     */
    private subscribeToTaskQueue(): void {
        this.unsubscribeQueue = this.deps.taskQueue.subscribe((event) => {
            const taskId = event.taskId;
            if (!taskId) return;

            if (event.type === "task-completed") {
                this.handleTaskCompleted(taskId);
            } else if (event.type === "task-failed") {
                this.handleTaskFailed(taskId);
            } else if (event.type === "task-started") {
                this.handleTaskStarted(taskId);
            }
        });
    }

    /**
     * 处理任务开始执行
     */
    private handleTaskStarted(taskId: string): void {
        const pipelineId = this.taskToPipeline.get(taskId);
        if (!pipelineId) return;

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        const now = formatCRTimestamp();
        context.stage = "generating";
        context.updatedAt = now;

        this.publishEvent({
            type: "stage_changed",
            pipelineId,
            stage: "generating",
            context,
            timestamp: now,
        });
    }

    /**
     * 处理任务完成
     */
    private handleTaskCompleted(taskId: string): void {
        const pipelineId = this.taskToPipeline.get(taskId);
        if (!pipelineId) return;

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        const now = formatCRTimestamp();

        // 从任务队列获取任务结果
        const task = this.deps.taskQueue.getTask(taskId);
        if (task?.result) {
            const result = task.result as unknown as Record<string, unknown>;
            context.result = {
                localPath: (result.localPath as string) ?? "",
                altText: (result.altText as string) ?? "",
            };
        }

        context.stage = "completed";
        context.updatedAt = now;

        this.logger.info("ImageInsertOrchestrator", "图片插入管线完成", {
            pipelineId,
            taskId,
            localPath: context.result?.localPath,
        });

        this.publishEvent({
            type: "pipeline_completed",
            pipelineId,
            stage: "completed",
            context,
            timestamp: now,
        });

        // 清理映射
        this.taskToPipeline.delete(taskId);
    }

    /**
     * 处理任务失败
     */
    private handleTaskFailed(taskId: string): void {
        const pipelineId = this.taskToPipeline.get(taskId);
        if (!pipelineId) return;

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        const now = formatCRTimestamp();

        // 从任务队列获取错误信息
        const task = this.deps.taskQueue.getTask(taskId);
        const lastError = task?.errors?.[task.errors.length - 1];

        context.stage = "failed";
        context.updatedAt = now;
        context.error = {
            code: lastError?.code ?? "E500_INTERNAL_ERROR",
            message: lastError?.message ?? "图片生成任务失败",
        };

        this.logger.error("ImageInsertOrchestrator", "图片插入管线失败", undefined, {
            pipelineId,
            taskId,
            error: context.error,
        });

        this.publishEvent({
            type: "pipeline_failed",
            pipelineId,
            stage: "failed",
            context,
            timestamp: now,
        });

        // 清理映射
        this.taskToPipeline.delete(taskId);
    }

    /**
     * 获取设置
     */
    private getSettings(): PluginSettings {
        return this.deps.settingsStore.getSettings();
    }

    /**
     * 获取图片生成任务的 Provider ID
     */
    private getProviderIdForTask(): string {
        const settings = this.getSettings();
        const taskConfig = settings.taskModels?.["image-generate"];
        return taskConfig?.providerId || settings.defaultProviderId || "";
    }

    /**
     * 生成管线 ID
     */
    private generatePipelineId(): string {
        return `img-${generateUUID().slice(0, 8)}`;
    }

    /**
     * 发布管线事件
     */
    private publishEvent(event: ImagePipelineEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.error("ImageInsertOrchestrator", "事件监听器执行失败", error as Error);
            }
        }
    }
}
