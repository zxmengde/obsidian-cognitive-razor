/**
 * AmendOrchestrator：修订管线编排器
 *
 * 独立的修订管线编排器。
 * 管线流程：Snapshot → Amend → Diff 确认 → Write → Index → Deduplicate
 *
 * 所有错误通过 ResultMonad 返回，不抛出未捕获异常。
 *
 * @see 需求 2.3, 2.8, 26.1
 */

import type { TFile } from "obsidian";
import type { OrchestratorDeps } from "./orchestrator-deps";
import {
    type ILogger,
    type TaskRecord,
    type TaskType,
    type CRType,
    type CRFrontmatter,
    type PluginSettings,
    type PipelineContext,
    type PipelineStage,
    type Result,
    CognitiveRazorError,
    ok,
    err,
    toErr,
} from "../types";
import { extractFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { TaskFactory } from "./task-factory";
import { generateUUID } from "../data/validators";
import { formatCRTimestamp } from "../utils/date-utils";
import { validatePrerequisites as sharedValidatePrerequisites, resolveProviderIdForTask, buildVerificationReportMarkdown } from "./orchestrator-utils";

// ============================================================================
// 类型定义
// ============================================================================

/** 管线事件类型 */
type AmendPipelineEventType =
    | "stage_changed"
    | "task_completed"
    | "task_failed"
    | "confirmation_required"
    | "pipeline_completed"
    | "pipeline_failed";

/** 管线事件 */
export interface AmendPipelineEvent {
    type: AmendPipelineEventType;
    pipelineId: string;
    stage: PipelineStage;
    context: PipelineContext;
    timestamp: string;
}

/** 管线事件监听器 */
type AmendPipelineEventListener = (event: AmendPipelineEvent) => void;

// ============================================================================
// AmendOrchestrator
// ============================================================================

export class AmendOrchestrator {
    private deps: OrchestratorDeps;
    private logger: ILogger;

    /** 活跃管线上下文 */
    private pipelines: Map<string, PipelineContext> = new Map();
    /** 事件监听器 */
    private listeners: AmendPipelineEventListener[] = [];
    /** taskId → pipelineId 映射 */
    private taskToPipeline: Map<string, string> = new Map();
    /** 队列事件取消订阅 */
    private unsubscribeQueue?: () => void;

    constructor(deps: OrchestratorDeps) {
        this.deps = deps;
        this.logger = deps.logger;

        // 订阅任务队列事件
        this.subscribeToTaskQueue();

        this.logger.debug("AmendOrchestrator", "修订管线编排器初始化完成");
    }

    // ========================================================================
    // 公开方法
    // ========================================================================

    /**
     * 启动修订管线
     *
     * 流程：读取笔记 → 创建快照 → 入队 Amend 任务
     *
     * @param filePath 目标笔记路径
     * @param instruction 修订指令
     * @returns 管线 ID
     */
    startAmendPipeline(filePath: string, instruction: string): Result<string> {
        // 前置校验
        const prereqResult = this.validatePrerequisites("amend");
        if (!prereqResult.ok) {
            return prereqResult as Result<string>;
        }

        // 获取文件
        const file = this.deps.noteRepository.getFileByPath(filePath);
        if (!file) {
            return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`);
        }

        const pipelineId = this.generatePipelineId();
        const now = formatCRTimestamp();

        // 临时 nodeId 和 type，后续从 frontmatter 读取
        const nodeId = generateUUID();

        const context: PipelineContext = {
            kind: "amend",
            pipelineId,
            nodeId,
            type: "Entity", // 临时类型，后续从 frontmatter 读取
            stage: "idle",
            userInput: instruction,
            filePath,
            createdAt: now,
            updatedAt: now,
        };

        this.pipelines.set(pipelineId, context);

        this.logger.info("AmendOrchestrator", `启动修订管线: ${pipelineId}`, {
            filePath,
            instruction: instruction.substring(0, 100),
        });

        // 异步执行修订流程
        void this.executeAmendPipeline(context, file, instruction);

        return ok(pipelineId);
    }

    /**
     * 确认写入（用户在 Diff 预览后确认）
     *
     * 流程：冲突检测 → 写入文件 → 重算 Embedding → 去重检测
     *
     * @param pipelineId 管线 ID
     */
    async confirmWrite(pipelineId: string): Promise<Result<void>> {
        const context = this.pipelines.get(pipelineId);
        if (!context) {
            return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
        }

        if (context.stage !== "review_changes") {
            return err("E310_INVALID_STATE", `管线状态不正确: ${context.stage}，期望: review_changes`);
        }

        try {
            context.stage = "writing";
            context.updatedAt = formatCRTimestamp();

            this.logger.info("AmendOrchestrator", `用户确认写入: ${pipelineId}`);

            return await this.confirmAmendWrite(context);
        } catch (error) {
            this.logger.error("AmendOrchestrator", "确认写入失败", error as Error);
            context.stage = "failed";
            context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
            return err("E500_INTERNAL_ERROR", "确认写入失败", error);
        }
    }

    /**
     * 构建写入预览（供 DiffView 使用）
     */
    async buildWritePreview(pipelineId: string): Promise<Result<{
        targetPath: string;
        newContent: string;
        previousContent: string;
    }>> {
        const context = this.pipelines.get(pipelineId);
        if (!context) {
            return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
        }

        if (!["review_changes", "saving"].includes(context.stage)) {
            return err("E310_INVALID_STATE", `当前阶段不支持预览: ${context.stage}`);
        }

        return this.composeWriteContent(context);
    }

    /**
     * 取消管线
     */
    cancelPipeline(pipelineId: string): Result<void> {
        const context = this.pipelines.get(pipelineId);
        if (!context) {
            return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
        }

        // 取消所有关联的任务
        for (const [taskId, pid] of this.taskToPipeline.entries()) {
            if (pid === pipelineId) {
                try {
                    this.deps.taskQueue.cancel(taskId);
                } catch (error) {
                    this.logger.warn("AmendOrchestrator", `取消任务失败: ${taskId}`, {
                        pipelineId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                this.taskToPipeline.delete(taskId);
            }
        }

        context.stage = "failed";
        context.error = { code: "E310_INVALID_STATE", message: "用户取消" };
        context.updatedAt = formatCRTimestamp();

        // 管线取消时移除持久化记录（需求 33.4）
        void this.savePipelineState();

        this.logger.info("AmendOrchestrator", `管线已取消: ${pipelineId}`);

        return ok(undefined);
    }

    /**
     * 获取管线上下文
     */
    getContext(pipelineId: string): PipelineContext | undefined {
        return this.pipelines.get(pipelineId);
    }

    /**
     * 获取所有活跃管线
     */
    getActivePipelines(): PipelineContext[] {
        return Array.from(this.pipelines.values()).filter(
            (ctx) => ctx.stage !== "completed" && ctx.stage !== "failed",
        );
    }

    /**
     * 订阅管线事件
     */
    subscribe(listener: AmendPipelineEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * 恢复持久化的管线状态
     */
    restorePipelines(
        pipelines: Map<string, PipelineContext>,
        taskToPipeline: Map<string, string>,
    ): void {
        for (const [id, ctx] of pipelines) {
            if (ctx.kind === "amend") {
                this.pipelines.set(id, ctx);
            }
        }
        for (const [taskId, pipelineId] of taskToPipeline) {
            if (this.pipelines.has(pipelineId)) {
                this.taskToPipeline.set(taskId, pipelineId);
            }
        }
    }

    /**
     * 获取活跃管线和任务映射（用于持久化）
     */
    getActiveState(): {
        pipelines: Map<string, PipelineContext>;
        taskToPipeline: Map<string, string>;
    } {
        const activePipelines = new Map<string, PipelineContext>();
        for (const [id, ctx] of this.pipelines) {
            if (ctx.stage !== "completed" && ctx.stage !== "failed") {
                activePipelines.set(id, ctx);
            }
        }
        const activeTaskMap = new Map<string, string>();
        for (const [taskId, pipelineId] of this.taskToPipeline) {
            if (activePipelines.has(pipelineId)) {
                activeTaskMap.set(taskId, pipelineId);
            }
        }
        return { pipelines: activePipelines, taskToPipeline: activeTaskMap };
    }

    /**
     * 释放资源
     */
    dispose(): void {
        if (this.unsubscribeQueue) {
            this.unsubscribeQueue();
            this.unsubscribeQueue = undefined;
        }
    }

    // ========================================================================
    // 私有方法 — 任务队列事件处理
    // ========================================================================

    /**
     * 订阅任务队列事件
     */
    private subscribeToTaskQueue(): void {
        this.unsubscribeQueue?.();
        this.unsubscribeQueue = this.deps.taskQueue.subscribe((event) => {
            if (event.type === "task-completed" && event.taskId) {
                this.handleTaskCompleted(event.taskId);
            } else if (event.type === "task-failed" && event.taskId) {
                this.handleTaskFailed(event.taskId);
            }
        });
    }

    /**
     * 处理任务完成事件
     */
    private async handleTaskCompleted(taskId: string): Promise<void> {
        const task = this.deps.taskQueue.getTask(taskId);
        if (!task) return;

        const pipelineId =
            this.taskToPipeline.get(taskId) ||
            (typeof (task.payload as Record<string, unknown>)?.pipelineId === "string"
                ? ((task.payload as Record<string, unknown>).pipelineId as string)
                : undefined);
        if (!pipelineId) return;

        if (!this.taskToPipeline.has(taskId)) {
            this.taskToPipeline.set(taskId, pipelineId);
        }

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        this.logger.debug("AmendOrchestrator", `任务完成: ${taskId}`, {
            pipelineId,
            taskType: task.taskType,
        });

        // 根据任务类型更新管线状态
        switch (task.taskType) {
            case "amend":
                await this.handleAmendCompleted(context, task);
                break;
            case "verify":
                await this.handleVerifyCompleted(context, task);
                break;
        }
    }

    /**
     * 处理任务失败事件
     */
    private handleTaskFailed(taskId: string): void {
        const task = this.deps.taskQueue.getTask(taskId);
        const pipelineId =
            this.taskToPipeline.get(taskId) ||
            (typeof (task?.payload as Record<string, unknown>)?.pipelineId === "string"
                ? ((task!.payload as Record<string, unknown>).pipelineId as string)
                : undefined);
        if (!pipelineId) return;

        if (!this.taskToPipeline.has(taskId)) {
            this.taskToPipeline.set(taskId, pipelineId);
        }

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        context.stage = "failed";
        context.error = {
            code: task?.errors?.[0]?.code || "E500_INTERNAL_ERROR",
            message: task?.errors?.[0]?.message || "任务执行失败",
        };
        context.updatedAt = formatCRTimestamp();

        this.publishEvent({
            type: "pipeline_failed",
            pipelineId,
            stage: "failed",
            context,
            timestamp: context.updatedAt,
        });

        this.logger.error("AmendOrchestrator", `管线失败: ${pipelineId}`, undefined, {
            taskId,
            error: context.error,
        });
    }

    // ========================================================================
    // 私有方法 — 各阶段任务完成处理
    // ========================================================================

    /**
     * Amend 任务完成：生成新内容并进入 Diff 确认阶段
     */
    private async handleAmendCompleted(
        context: PipelineContext,
        task: TaskRecord,
    ): Promise<void> {
        const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
        if (!result) {
            context.stage = "failed";
            context.error = { code: "E310_INVALID_STATE", message: "Amend 结果缺失" };
            context.updatedAt = formatCRTimestamp();
            this.publishEvent({
                type: "pipeline_failed",
                pipelineId: context.pipelineId,
                stage: "failed",
                context,
                timestamp: context.updatedAt,
            });
            return;
        }

        if (!context.previousContent || !context.filePath) {
            context.stage = "failed";
            context.error = { code: "E310_INVALID_STATE", message: "缺少修订前内容或文件路径" };
            context.updatedAt = formatCRTimestamp();
            this.publishEvent({
                type: "pipeline_failed",
                pipelineId: context.pipelineId,
                stage: "failed",
                context,
                timestamp: context.updatedAt,
            });
            return;
        }

        const extracted = extractFrontmatter(context.previousContent);
        if (!extracted) {
            context.stage = "failed";
            context.error = { code: "E500_INTERNAL_ERROR", message: "无法解析目标笔记的 frontmatter" };
            context.updatedAt = formatCRTimestamp();
            this.publishEvent({
                type: "pipeline_failed",
                pipelineId: context.pipelineId,
                stage: "failed",
                context,
                timestamp: context.updatedAt,
            });
            return;
        }

        context.generatedContent = result;

        const file = this.deps.noteRepository.getFileByPath(context.filePath);
        const fallbackName = extracted.frontmatter.name?.trim()
            || file?.basename
            || "Unnamed Concept";

        const updatedFrontmatter: CRFrontmatter = {
            ...extracted.frontmatter,
            name: fallbackName,
            parents: extracted.frontmatter.parents ?? [],
            updated: formatCRTimestamp(),
        };

        // 如果 Amend 结果包含新的 definition，更新 frontmatter
        const nextDefinition = typeof result.definition === "string"
            ? result.definition.trim()
            : undefined;
        if (nextDefinition) {
            updatedFrontmatter.definition = nextDefinition;
        }

        // 渲染新内容
        context.newContent = generateMarkdownContent(
            updatedFrontmatter,
            this.renderContentToMarkdown(context, updatedFrontmatter.name),
        );

        // 进入 Diff 确认阶段
        context.stage = "review_changes";
        context.updatedAt = formatCRTimestamp();

        // 持久化管线状态（需求 33.1：Diff 确认阶段持久化）
        void this.savePipelineState();

        this.publishEvent({
            type: "confirmation_required",
            pipelineId: context.pipelineId,
            stage: "review_changes",
            context,
            timestamp: context.updatedAt,
        });
    }

    /**
     * Verify 任务完成：追加报告并完成管线
     */
    private async handleVerifyCompleted(
        context: PipelineContext,
        task: TaskRecord,
    ): Promise<void> {
        const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
        if (!result) {
            this.logger.warn("AmendOrchestrator", "Verify 结果缺失，跳过报告追加", {
                pipelineId: context.pipelineId,
            });
            this.completePipeline(context);
            return;
        }

        context.verificationResult = result;

        // 追加报告到笔记末尾
        if (context.filePath) {
            await this.appendVerificationReportToNote(context.filePath, result);
        }

        this.completePipeline(context);
    }

    // ========================================================================
    // 私有方法 — 管线核心逻辑
    // ========================================================================

    /**
     * 执行修订管线（异步）
     *
     * 流程：读取笔记 → 解析 frontmatter → 创建快照 → 入队 Amend 任务
     */
    private async executeAmendPipeline(
        context: PipelineContext,
        file: TFile,
        instruction: string,
    ): Promise<void> {
        try {
            // 1. 读取笔记内容
            const content = await this.deps.noteRepository.readByPath(file.path);
            context.previousContent = content;

            // 2. 解析 frontmatter 获取 nodeId 和 type
            const extracted = extractFrontmatter(content);
            if (!extracted) {
                context.stage = "failed";
                context.error = { code: "E500_INTERNAL_ERROR", message: "无法解析目标笔记的 frontmatter" };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }

            context.nodeId = extracted.frontmatter.cruid;
            context.type = extracted.frontmatter.type;

            // 3. 创建快照（需求 31.2：Amend 操作前为目标概念创建快照）
            const snapshotResult = await this.deps.undoManager.createSnapshot(
                context.filePath!,
                content,
                context.pipelineId,
                context.nodeId,
            );
            if (!snapshotResult.ok) {
                // 需求 31.5：快照创建失败时中止破坏性操作
                context.stage = "failed";
                context.error = { code: snapshotResult.error.code, message: snapshotResult.error.message };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }
            context.snapshotId = snapshotResult.value;

            this.logger.info("AmendOrchestrator", "修订快照已创建", {
                pipelineId: context.pipelineId,
                snapshotId: context.snapshotId,
            });

            // 4. 入队 amend 任务
            context.stage = "writing";
            context.updatedAt = formatCRTimestamp();

            this.publishEvent({
                type: "stage_changed",
                pipelineId: context.pipelineId,
                stage: "writing",
                context,
                timestamp: context.updatedAt,
            });

            const settings = this.getSettings();
            let taskId: string;
            try {
                taskId = this.deps.taskQueue.enqueue(
                    TaskFactory.create({
                        nodeId: context.nodeId,
                        taskType: "amend",
                        maxAttempts: settings.maxRetryAttempts,
                        providerRef: this.getProviderIdForTask("amend"),
                        payload: {
                            pipelineId: context.pipelineId,
                            currentContent: content,
                            instruction,
                            conceptType: context.type,
                        },
                    }),
                );
            } catch (error) {
                context.stage = "failed";
                // 需求 34.3：锁冲突时使用用户友好的 i18n 提示
                if (error instanceof CognitiveRazorError && error.code === "E320_TASK_CONFLICT") {
                    const msg = this.deps.i18n.t("workbench.notifications.conceptLocked");
                    context.error = { code: "E320_TASK_CONFLICT", message: msg };
                } else {
                    context.error = { code: "E500_INTERNAL_ERROR", message: "创建修订任务失败" };
                }
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }

            this.taskToPipeline.set(taskId, context.pipelineId);
        } catch (error) {
            this.logger.error("AmendOrchestrator", "修订管线执行失败", error as Error, {
                pipelineId: context.pipelineId,
            });
            context.stage = "failed";
            context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
            this.publishEvent({
                type: "pipeline_failed",
                pipelineId: context.pipelineId,
                stage: "failed",
                context,
                timestamp: formatCRTimestamp(),
            });
        }
    }

    /**
     * 确认修订写入
     *
     * 流程：组合内容 → 冲突检测 → 写入 → 重算 Embedding → 去重 → 可选 Verify
     */
    private async confirmAmendWrite(context: PipelineContext): Promise<Result<void>> {
        const composed = await this.composeWriteContent(context);
        if (!composed.ok) {
            context.stage = "failed";
            context.error = { code: composed.error.code, message: composed.error.message };
            return composed as Result<void>;
        }

        const { targetPath, previousContent, newContent } = composed.value;
        context.filePath = targetPath;

        // 冲突检测：若 Diff 预览后文件被外部修改，避免覆盖用户改动（需求 26.3）
        const currentContent = await this.deps.noteRepository.readByPathIfExists(targetPath);
        if (currentContent !== null && currentContent !== previousContent) {
            const message = `检测到文件在确认写入前已被修改：${targetPath}\n请重新生成预览（Diff）后再确认写入，以避免覆盖改动。`;
            context.stage = "failed";
            context.error = { code: "E320_TASK_CONFLICT", message };
            return err("E320_TASK_CONFLICT", message, { targetPath });
        }

        // 快照应在 executeAmendPipeline 中创建；若缺失则补齐（兼容旧流程）
        if (!context.snapshotId) {
            const snapshotResult = await this.deps.undoManager.createSnapshot(
                targetPath,
                previousContent,
                context.pipelineId,
                context.nodeId,
            );
            if (snapshotResult.ok) {
                context.snapshotId = snapshotResult.value;
            }
        }

        await this.deps.noteRepository.writeAtomic(targetPath, newContent);

        // 语义变更后必须重算 embedding 并触发去重（避免陈旧向量）
        context.stage = "indexing";
        context.updatedAt = formatCRTimestamp();
        await this.refreshEmbeddingAndDuplicates(context, newContent);

        await this.maybeStartAutoVerifyOrComplete(context);
        return ok(undefined);
    }

    /**
     * 组合写入内容（Amend 管线专用）
     */
    private async composeWriteContent(context: PipelineContext): Promise<Result<{
        targetPath: string;
        previousContent: string;
        newContent: string;
    }>> {
        if (!context.filePath) {
            return err("E310_INVALID_STATE", "缺少文件路径");
        }
        if (context.previousContent === undefined || context.newContent === undefined) {
            return err("E310_INVALID_STATE", "缺少预览内容");
        }

        await this.deps.noteRepository.ensureDirForPath(context.filePath);

        const normalized = extractFrontmatter(context.newContent);
        if (!normalized) {
            return err("E500_INTERNAL_ERROR", "无法解析生成的 frontmatter");
        }

        const normalizedFrontmatter: CRFrontmatter = {
            ...normalized.frontmatter,
            parents: normalized.frontmatter.parents ?? [],
            updated: formatCRTimestamp(),
        };

        const normalizedContent = generateMarkdownContent(normalizedFrontmatter, normalized.body);

        return ok({
            targetPath: context.filePath,
            previousContent: context.previousContent,
            newContent: normalizedContent,
        });
    }

    /**
     * 重算 Embedding 并触发去重检测
     */
    private async refreshEmbeddingAndDuplicates(context: PipelineContext, newContent: string): Promise<void> {
        const extracted = extractFrontmatter(newContent);
        const embeddingText = extracted
            ? this.buildEmbeddingTextFromFrontmatter(extracted.frontmatter)
            : newContent;

        const settings = this.getSettings();
        const taskConfig = settings.taskModels["index"];
        const providerId = taskConfig?.providerId || this.getProviderIdForTask("index");
        const embeddingModel = this.deps.vectorIndex.getEmbeddingModel();
        const embeddingDimension = this.deps.vectorIndex.getEmbeddingDimension();

        const embedResult = await this.deps.providerManager.embed({
            providerId,
            model: embeddingModel,
            input: embeddingText,
            dimensions: embeddingDimension,
        });

        if (!embedResult.ok) {
            this.logger.warn("AmendOrchestrator", "Embedding 重算失败，已移除旧向量避免陈旧结果", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: embedResult.error,
            });

            // 移除旧向量
            const deleteResult = await this.deps.vectorIndex.delete(context.nodeId);
            if (!deleteResult.ok && deleteResult.error.code !== "E311_NOT_FOUND") {
                this.logger.warn("AmendOrchestrator", "移除旧向量失败", {
                    pipelineId: context.pipelineId,
                    nodeId: context.nodeId,
                    error: deleteResult.error,
                });
            }

            // 清理旧重复对
            const clearResult = await this.deps.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
            if (!clearResult.ok) {
                this.logger.warn("AmendOrchestrator", "清理旧重复对失败", {
                    pipelineId: context.pipelineId,
                    nodeId: context.nodeId,
                    error: clearResult.error,
                });
            }

            context.embedding = undefined;
            return;
        }

        context.embedding = embedResult.value.embedding;
        context.updatedAt = formatCRTimestamp();

        // 清理旧重复对
        const clearResult = await this.deps.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
        if (!clearResult.ok) {
            this.logger.warn("AmendOrchestrator", "清理旧重复对失败", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: clearResult.error,
            });
        }

        // 更新向量索引
        const upsertResult = await this.deps.vectorIndex.upsert({
            uid: context.nodeId,
            type: context.type,
            embedding: context.embedding,
            updated: context.updatedAt,
        });
        if (!upsertResult.ok) {
            this.logger.warn("AmendOrchestrator", "更新向量索引失败", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: upsertResult.error,
            });
        }

        // 去重检测
        const detectResult = await this.deps.duplicateManager.detect(context.nodeId, context.type, context.embedding);
        if (!detectResult.ok) {
            this.logger.warn("AmendOrchestrator", "去重检测失败", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: detectResult.error,
            });
        }
    }

    /**
     * 根据设置决定是否自动 Verify 或直接完成
     */
    private async maybeStartAutoVerifyOrComplete(context: PipelineContext): Promise<void> {
        const settings = this.getSettings();
        if (!settings.enableAutoVerify) {
            this.completePipeline(context);
            return;
        }

        const prereqResult = this.validatePrerequisites("verify", context.type);
        if (!prereqResult.ok) {
            this.logger.warn("AmendOrchestrator", "Verify 前置校验失败，跳过自动校验并结束管线", {
                pipelineId: context.pipelineId,
                error: prereqResult.error,
            });
            this.completePipeline(context);
            return;
        }

        const startResult = await this.startVerifyTask(context);
        if (!startResult.ok) {
            this.logger.warn("AmendOrchestrator", "启动 Verify 失败，跳过自动校验并结束管线", {
                pipelineId: context.pipelineId,
                error: startResult.error,
            });
            this.completePipeline(context);
        }
    }

    /**
     * 启动 Verify 任务
     */
    private async startVerifyTask(context: PipelineContext): Promise<Result<void>> {
        const filePath = context.filePath;
        if (!filePath) {
            return err("E310_INVALID_STATE", "缺少文件路径，无法执行 Verify");
        }

        const currentContent = await this.deps.noteRepository.readByPathIfExists(filePath);
        if (currentContent === null) {
            return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`, { filePath });
        }

        context.stage = "verifying";
        context.updatedAt = formatCRTimestamp();

        this.publishEvent({
            type: "stage_changed",
            pipelineId: context.pipelineId,
            stage: "verifying",
            context,
            timestamp: context.updatedAt,
        });

        this.logger.info("AmendOrchestrator", `启动 Verify 任务: ${context.pipelineId}`, {
            filePath,
        });

        const settings = this.getSettings();
        try {
            const taskId = this.deps.taskQueue.enqueue(
                TaskFactory.create({
                    nodeId: context.nodeId,
                    taskType: "verify",
                    maxAttempts: settings.maxRetryAttempts,
                    providerRef: this.getProviderIdForTask("verify"),
                    payload: {
                        pipelineId: context.pipelineId,
                        filePath,
                        currentContent,
                        conceptType: context.type,
                        standardizedData: context.standardizedData,
                    },
                }),
            );
            this.taskToPipeline.set(taskId, context.pipelineId);
            return ok(undefined);
        } catch (error) {
            // 需求 34.3：锁冲突时使用用户友好的 i18n 提示
            if (error instanceof CognitiveRazorError && error.code === "E320_TASK_CONFLICT") {
                const msg = this.deps.i18n.t("workbench.notifications.conceptLocked");
                return err("E320_TASK_CONFLICT", msg);
            }
            return toErr(error, "E500_INTERNAL_ERROR", "Verify 任务创建失败");
        }
    }

    /**
     * 完成管线
     */
    private completePipeline(context: PipelineContext): void {
        context.stage = "completed";
        context.updatedAt = formatCRTimestamp();

        // 管线完成时移除持久化记录（需求 33.4）
        void this.savePipelineState();

        this.publishEvent({
            type: "pipeline_completed",
            pipelineId: context.pipelineId,
            stage: "completed",
            context,
            timestamp: context.updatedAt,
        });
    }

    // ========================================================================
    // 私有方法 — 辅助工具
    // ========================================================================

    /**
     * 持久化管线状态到文件
     *
     * 收集当前 Orchestrator 的活跃管线状态并通过 PipelineStateStore 保存。
     * 仅保存处于 review_changes 阶段的管线（需求 33.1）。
     * 管线完成或取消后，因不再处于 review_changes，自动从文件中移除（需求 33.4）。
     */
    private async savePipelineState(): Promise<void> {
        try {
            await this.deps.pipelineStateStore.persistFromOrchestrators([this]);
        } catch (error) {
            this.logger.warn("AmendOrchestrator", "持久化管线状态失败", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * 获取设置
     */
    private getSettings(): PluginSettings {
        return this.deps.settingsStore.getSettings();
    }

    /**
     * 前置校验：检查 Provider 和模板是否可用
     */
    private validatePrerequisites(taskType: TaskType, conceptType?: CRType): Result<void> {
        const settings = this.getSettings();
        const providerId = this.getProviderIdForTask(taskType);
        return sharedValidatePrerequisites(
            settings, taskType, providerId,
            this.deps.promptManager, this.logger, "AmendOrchestrator", conceptType,
        );
    }

    /**
     * 获取任务对应的 Provider ID
     */
    private getProviderIdForTask(taskType: TaskType): string {
        return resolveProviderIdForTask(this.getSettings(), taskType, this.logger, "AmendOrchestrator");
    }

    /**
     * 渲染内容为 Markdown
     */
    private renderContentToMarkdown(context: PipelineContext, standardName: string): string {
        const settings = this.getSettings();
        const language = settings.language || "zh";

        const title = language === "en"
            ? (context.standardizedData?.standardNames[context.type].english || standardName)
            : standardName;

        return this.deps.contentRenderer.renderNoteMarkdown({
            title,
            type: context.type,
            content: context.generatedContent,
            language,
        });
    }

    /**
     * 从 Frontmatter 构建嵌入文本
     */
    private buildEmbeddingTextFromFrontmatter(frontmatter: CRFrontmatter): string {
        const parts: string[] = [];

        if (frontmatter.name) {
            parts.push(frontmatter.name);
        }

        if (frontmatter.aliases && frontmatter.aliases.length > 0) {
            parts.push(...frontmatter.aliases);
        }

        if (frontmatter.definition) {
            parts.push(frontmatter.definition);
        }

        parts.push(`类型: ${frontmatter.type}`);

        if (frontmatter.tags && frontmatter.tags.length > 0) {
            parts.push(`标签: ${frontmatter.tags.join(", ")}`);
        }

        return parts.join("\n");
    }

    /**
     * 追加验证报告到笔记末尾
     * 委托给 orchestrator-utils 共享的 buildVerificationReportMarkdown（DRY）
     */
    private async appendVerificationReportToNote(
        filePath: string,
        result: Record<string, unknown>,
    ): Promise<void> {
        try {
            const currentContent = await this.deps.noteRepository.readByPathIfExists(filePath);
            if (currentContent === null) {
                this.logger.warn("AmendOrchestrator", "文件不存在，无法追加报告", { filePath });
                return;
            }

            const report = buildVerificationReportMarkdown(result);
            const separator = currentContent.endsWith("\n") ? "\n" : "\n\n";
            const newContent = `${currentContent}${separator}${report}`;
            await this.deps.noteRepository.writeAtomic(filePath, newContent);

            this.logger.info("AmendOrchestrator", `验证报告已追加: ${filePath}`);
        } catch (error) {
            this.logger.error("AmendOrchestrator", "追加验证报告失败", error as Error, { filePath });
        }
    }

    /**
     * 生成管线 ID
     */
    private generatePipelineId(): string {
        return `pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * 发布事件
     */
    private publishEvent(event: AmendPipelineEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.error("AmendOrchestrator", "事件监听器执行失败", error as Error);
            }
        }
    }
}
