/**
 * MergeOrchestrator：合并管线编排器
 *
 * 独立的合并管线编排器。
 * 管线流程：Snapshot → Merge → Diff 确认 → Write → Parents 引用重写 → 删除被合并笔记 → 清理索引
 *
 * 所有错误通过 ResultMonad 返回，不抛出未捕获异常。
 *
 * @see 需求 2.4, 2.8, 26.2
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
    type DuplicatePair,
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
type MergePipelineEventType =
    | "stage_changed"
    | "task_completed"
    | "task_failed"
    | "confirmation_required"
    | "pipeline_completed"
    | "pipeline_failed";

/** 管线事件 */
export interface MergePipelineEvent {
    type: MergePipelineEventType;
    pipelineId: string;
    stage: PipelineStage;
    context: PipelineContext;
    timestamp: string;
}

/** 管线事件监听器 */
type MergePipelineEventListener = (event: MergePipelineEvent) => void;

// ============================================================================
// MergeOrchestrator
// ============================================================================

export class MergeOrchestrator {
    private deps: OrchestratorDeps;
    private logger: ILogger;

    /** 活跃管线上下文 */
    private pipelines: Map<string, PipelineContext> = new Map();
    /** 事件监听器 */
    private listeners: MergePipelineEventListener[] = [];
    /** taskId → pipelineId 映射 */
    private taskToPipeline: Map<string, string> = new Map();
    /** 队列事件取消订阅 */
    private unsubscribeQueue?: () => void;

    constructor(deps: OrchestratorDeps) {
        this.deps = deps;
        this.logger = deps.logger;

        // 订阅任务队列事件
        this.subscribeToTaskQueue();

        this.logger.debug("MergeOrchestrator", "合并管线编排器初始化完成");
    }

    // ========================================================================
    // 公开方法
    // ========================================================================

    /**
     * 启动合并管线
     *
     * 流程：确定主/被合并笔记 → 读取内容 → 创建双快照 → 入队 Merge 任务
     *
     * @param pair 重复对
     * @param keepNodeId 保留的笔记 nodeId
     * @param finalFileName 合并后的文件名（不含扩展名）
     * @returns 管线 ID
     */
    startMergePipeline(
        pair: DuplicatePair,
        keepNodeId: string,
        finalFileName: string,
    ): Result<string> {
        // 确定主笔记和被删除笔记
        const isKeepA = keepNodeId === pair.nodeIdA;
        const keepId = isKeepA ? pair.nodeIdA : pair.nodeIdB;
        const deleteId = isKeepA ? pair.nodeIdB : pair.nodeIdA;

        const nameA = this.deps.cruidCache?.getName(pair.nodeIdA) || pair.nodeIdA;
        const nameB = this.deps.cruidCache?.getName(pair.nodeIdB) || pair.nodeIdB;

        const keepPath = this.deps.cruidCache?.getPath(keepId);
        const deletePath = this.deps.cruidCache?.getPath(deleteId);
        if (!keepPath || !deletePath) {
            return err("E301_FILE_NOT_FOUND", "无法定位合并笔记文件（可能已被移动或删除）", {
                keepNodeId: keepId,
                deleteNodeId: deleteId,
                keepPath: keepPath || null,
                deletePath: deletePath || null,
            });
        }

        const keepNote = { nodeId: keepId, name: this.deps.cruidCache?.getName(keepId) || keepId, path: keepPath };
        const deleteNote = { nodeId: deleteId, name: this.deps.cruidCache?.getName(deleteId) || deleteId, path: deletePath };

        // 前置校验
        const prereqResult = this.validatePrerequisites("merge", pair.type);
        if (!prereqResult.ok) {
            return prereqResult as Result<string>;
        }

        const pipelineId = this.generatePipelineId();
        const now = formatCRTimestamp();

        const context: PipelineContext = {
            kind: "merge",
            pipelineId,
            nodeId: keepNote.nodeId,
            type: pair.type,
            stage: "idle",
            userInput: `合并 ${nameA} 和 ${nameB}`,
            mergePairId: pair.id,
            deleteFilePath: deleteNote.path,
            deleteNoteName: deleteNote.name,
            deleteNodeId: deleteNote.nodeId,
            createdAt: now,
            updatedAt: now,
        };

        this.pipelines.set(pipelineId, context);

        this.logger.info("MergeOrchestrator", `启动合并管线: ${pipelineId}`, {
            keepNodeId,
            deleteNodeId: deleteNote.nodeId,
            pairId: pair.id,
            finalFileName,
        });

        // 异步执行合并流程
        void this.executeMergePipeline(context, pair, keepNote, deleteNote, finalFileName);

        return ok(pipelineId);
    }

    /**
     * 确认写入（用户在 Diff 预览后确认）
     *
     * 流程：冲突检测 → 写入文件 → Parents 引用重写 → 删除被合并笔记 → 清理索引 → 重算 Embedding → 去重
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

            this.logger.info("MergeOrchestrator", `用户确认写入: ${pipelineId}`);

            return await this.confirmMergeWrite(context);
        } catch (error) {
            this.logger.error("MergeOrchestrator", "确认写入失败", error as Error);
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
                    this.logger.warn("MergeOrchestrator", `取消任务失败: ${taskId}`, {
                        pipelineId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                this.taskToPipeline.delete(taskId);
            }
        }

        // 回退 duplicate pair 的 merging 状态
        if (context.mergePairId) {
            void this.deps.duplicateManager.abortMerge(context.mergePairId);
        }

        context.stage = "failed";
        context.error = { code: "E310_INVALID_STATE", message: "用户取消" };
        context.updatedAt = formatCRTimestamp();

        // 管线取消时移除持久化记录（需求 33.4）
        void this.savePipelineState();

        this.logger.info("MergeOrchestrator", `管线已取消: ${pipelineId}`);

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
    subscribe(listener: MergePipelineEventListener): () => void {
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
            if (ctx.kind === "merge") {
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

        this.logger.debug("MergeOrchestrator", `任务完成: ${taskId}`, {
            pipelineId,
            taskType: task.taskType,
        });

        // 根据任务类型更新管线状态
        switch (task.taskType) {
            case "merge":
                await this.handleMergeCompleted(context, task);
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

        this.logger.error("MergeOrchestrator", `管线失败: ${pipelineId}`, undefined, {
            taskId,
            error: context.error,
        });
    }

    // ========================================================================
    // 私有方法 — 各阶段任务完成处理
    // ========================================================================

    /**
     * Merge 任务完成：构建合并内容并进入 Diff 确认阶段
     */
    private async handleMergeCompleted(
        context: PipelineContext,
        task: TaskRecord,
    ): Promise<void> {
        const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
        if (!result) {
            context.stage = "failed";
            context.error = { code: "E310_INVALID_STATE", message: "Merge 结果缺失" };
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

        if (!context.previousContent) {
            context.stage = "failed";
            context.error = { code: "E310_INVALID_STATE", message: "缺少合并前内容" };
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

        context.generatedContent = (result.content as Record<string, unknown>) || result;

        const buildResult = this.buildMergedContent(
            result,
            context.previousContent,
            context.type,
            context.deleteNoteName || "",
        );

        if (!buildResult.ok) {
            context.stage = "failed";
            context.error = { code: buildResult.error.code, message: buildResult.error.message };
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

        context.newContent = buildResult.value;
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
            this.logger.warn("MergeOrchestrator", "Verify 结果缺失，跳过报告追加", {
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
     * 执行合并管线（异步）
     *
     * 流程：读取两篇笔记 → 创建双快照（需求 31.1） → 入队 Merge 任务
     */
    private async executeMergePipeline(
        context: PipelineContext,
        pair: DuplicatePair,
        keepNote: { nodeId: string; name: string; path: string },
        deleteNote: { nodeId: string; name: string; path: string },
        finalFileName: string,
    ): Promise<void> {
        try {
            // 1. 读取两篇笔记内容
            const keepFile = this.deps.noteRepository.getFileByPath(keepNote.path);
            const deleteFile = this.deps.noteRepository.getFileByPath(deleteNote.path);

            if (!keepFile) {
                context.stage = "failed";
                context.error = { code: "E301_FILE_NOT_FOUND", message: `主笔记不存在: ${keepNote.path}` };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }

            if (!deleteFile) {
                context.stage = "failed";
                context.error = { code: "E301_FILE_NOT_FOUND", message: `被合并笔记不存在: ${deleteNote.path}` };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }

            const keepContent = await this.deps.noteRepository.readByPath(keepNote.path);
            const deleteContent = await this.deps.noteRepository.readByPath(deleteNote.path);

            context.previousContent = keepContent;
            context.deleteContent = deleteContent;
            context.filePath = keepNote.path;

            // 2. 创建双快照（需求 31.1：Merge 操作前为主概念和被合并概念各创建快照）
            context.stage = "saving";
            context.updatedAt = formatCRTimestamp();

            const keepSnapshotResult = await this.deps.undoManager.createSnapshot(
                keepNote.path,
                keepContent,
                context.pipelineId,
                keepNote.nodeId,
            );
            if (!keepSnapshotResult.ok) {
                // 需求 31.5：快照创建失败时中止破坏性操作
                context.stage = "failed";
                context.error = { code: keepSnapshotResult.error.code, message: keepSnapshotResult.error.message };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }
            context.snapshotId = keepSnapshotResult.value;

            const deleteSnapshotResult = await this.deps.undoManager.createSnapshot(
                deleteNote.path,
                deleteContent,
                `merge-delete-${context.pipelineId}`,
                deleteNote.nodeId,
            );
            if (!deleteSnapshotResult.ok) {
                context.stage = "failed";
                context.error = { code: deleteSnapshotResult.error.code, message: deleteSnapshotResult.error.message };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }

            this.logger.info("MergeOrchestrator", "合并快照已创建", {
                pipelineId: context.pipelineId,
                keepSnapshotId: context.snapshotId,
            });

            // 3. 入队 merge 任务
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
                        taskType: "merge",
                        maxAttempts: settings.maxRetryAttempts,
                        providerRef: this.getProviderIdForTask("merge"),
                        payload: {
                            pipelineId: context.pipelineId,
                            keepName: keepNote.name,
                            deleteName: deleteNote.name,
                            keepContent,
                            deleteContent,
                            conceptType: pair.type,
                            finalFileName,
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
                    context.error = { code: "E500_INTERNAL_ERROR", message: "创建合并任务失败" };
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
            this.logger.error("MergeOrchestrator", "合并管线执行失败", error as Error, {
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
     * 确认合并写入
     *
     * 流程：组合内容 → 冲突检测 → 写入 → Parents 引用重写 → 删除被合并笔记 → 清理索引 → 重算 Embedding → 去重 → 可选 Verify
     */
    private async confirmMergeWrite(context: PipelineContext): Promise<Result<void>> {
        const composed = await this.composeWriteContent(context);
        if (!composed.ok) {
            context.stage = "failed";
            context.error = { code: composed.error.code, message: composed.error.message };
            return composed as Result<void>;
        }

        const { targetPath, previousContent, newContent } = composed.value;
        context.filePath = targetPath;

        // 冲突检测：若 Diff 预览后主笔记被外部修改，避免覆盖用户改动（需求 26.3）
        const currentKeep = await this.deps.noteRepository.readByPathIfExists(targetPath);
        if (currentKeep !== null && currentKeep !== previousContent) {
            const message = `检测到主笔记在确认写入前已被修改：${targetPath}\n请重新生成预览（Diff）后再确认写入，以避免覆盖改动。`;
            context.stage = "failed";
            context.error = { code: "E320_TASK_CONFLICT", message };
            return err("E320_TASK_CONFLICT", message, { targetPath });
        }

        // 冲突检测：若被删笔记在确认写入前被外部修改，避免误删用户改动
        if (context.deleteFilePath && context.deleteContent) {
            const currentDelete = await this.deps.noteRepository.readByPathIfExists(context.deleteFilePath);
            if (currentDelete !== null && currentDelete !== context.deleteContent) {
                const message = `检测到被合并笔记在确认写入前已被修改：${context.deleteFilePath}\n请重新生成预览（Diff）后再确认写入，以避免误删改动。`;
                context.stage = "failed";
                context.error = { code: "E320_TASK_CONFLICT", message };
                return err("E320_TASK_CONFLICT", message, { deleteFilePath: context.deleteFilePath });
            }
        }

        // 快照已在 executeMergePipeline 中创建；若缺失则补齐（兼容旧流程）
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

            // 为被删除笔记创建快照
            if (context.deleteFilePath && context.deleteContent) {
                await this.deps.undoManager.createSnapshot(
                    context.deleteFilePath,
                    context.deleteContent,
                    `merge-delete-${context.mergePairId ?? context.pipelineId}`,
                    context.deleteNodeId,
                );
            }
        }

        // 写入合并后的内容
        await this.deps.noteRepository.writeAtomic(targetPath, newContent);

        // Parents 引用重写：在删除前先将其他笔记的 parents 引用从被合并笔记重写到主笔记
        const keepTitle = this.getNoteTitleFromPath(targetPath);
        const deleteTitle = context.deleteFilePath
            ? this.getNoteTitleFromPath(context.deleteFilePath)
            : (context.deleteNoteName?.trim() || "");

        if (deleteTitle && keepTitle && deleteTitle !== keepTitle) {
            const updateParentsResult = await this.rewriteParentsAcrossVault({
                pipelineId: context.pipelineId,
                fromTitle: deleteTitle,
                toTitle: keepTitle,
                skipPaths: [targetPath, context.deleteFilePath],
            });
            if (!updateParentsResult.ok) {
                // 回退 duplicate pair 的 merging 状态，避免卡死
                if (context.mergePairId) {
                    await this.deps.duplicateManager.abortMerge(context.mergePairId);
                }
                context.stage = "failed";
                context.error = { code: updateParentsResult.error.code, message: updateParentsResult.error.message };
                return updateParentsResult as Result<void>;
            }
        }

        // 删除被合并的笔记
        if (context.deleteFilePath) {
            await this.deps.noteRepository.deleteByPathIfExists(context.deleteFilePath);
        }

        // 清理被合并笔记的向量索引
        if (context.deleteNodeId) {
            await this.deps.vectorIndex.delete(context.deleteNodeId);
        }

        // 语义变更后必须重算 embedding 并触发去重（避免陈旧向量）
        context.stage = "indexing";
        context.updatedAt = formatCRTimestamp();
        await this.refreshEmbeddingAndDuplicates(context, newContent);

        // 去重记录清理
        if (context.mergePairId) {
            await this.deps.duplicateManager.completeMerge(context.mergePairId, context.nodeId);
        }

        await this.maybeStartAutoVerifyOrComplete(context);
        return ok(undefined);
    }

    /**
     * 组合写入内容（Merge 管线专用）
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
     * 构建合并后的完整 Markdown 内容
     */
    private buildMergedContent(
        mergeResult: Record<string, unknown>,
        previousContent: string,
        type: CRType,
        deleteNoteName: string,
    ): Result<string> {
        const extracted = extractFrontmatter(previousContent);
        if (!extracted) {
            return err("E500_INTERNAL_ERROR", "无法解析原始笔记的 frontmatter");
        }

        const frontmatter = extracted.frontmatter;

        const mergedName = (mergeResult.merged_name as { chinese?: string; english?: string }) || {};
        const content = mergeResult.content as Record<string, unknown> | undefined;
        if (!content) {
            return err("E211_MODEL_SCHEMA_VIOLATION", "合并结果缺少内容信息");
        }

        const updatedFrontmatter: CRFrontmatter = {
            ...frontmatter,
            updated: formatCRTimestamp(),
        };

        const nextDefinition = typeof content.definition === "string" ? content.definition.trim() : undefined;
        if (nextDefinition) {
            updatedFrontmatter.definition = nextDefinition;
        }

        // 合并后：将被合并笔记标题加入 aliases，便于链接重定向
        if (deleteNoteName && deleteNoteName.trim()) {
            const nextAliases = new Set<string>(updatedFrontmatter.aliases ?? []);
            nextAliases.add(deleteNoteName.trim());
            updatedFrontmatter.aliases = Array.from(nextAliases);
        }

        const body = this.buildMergeBody(mergedName, content, type, mergeResult);

        return ok(generateMarkdownContent(updatedFrontmatter, body));
    }

    /**
     * 构建合并正文 Markdown
     */
    private buildMergeBody(
        mergedName: { chinese?: string; english?: string },
        content: Record<string, unknown>,
        type: CRType,
        mergeResult: Record<string, unknown>,
    ): string {
        const sections: string[] = [];
        const settings = this.getSettings();
        const language = settings.language || "zh";
        const cn = mergedName.chinese || "合并后的概念";
        const en = mergedName.english || "";

        // 根据语言设置选择标题
        if (language === "zh") {
            sections.push(`# ${cn}`);
        } else {
            sections.push(`# ${en || cn}`);
        }
        sections.push("");

        const rationale = mergeResult.merge_rationale as string;
        if (rationale) {
            sections.push("## 合并说明");
            sections.push(rationale);
            sections.push("");
        }

        const structured = this.deps.contentRenderer.renderStructuredContentMarkdown({
            type,
            content,
            language,
        });
        if (structured) {
            sections.push(structured);
            sections.push("");
        }

        const preservedA = mergeResult.preserved_from_a as string[] | undefined;
        const preservedB = mergeResult.preserved_from_b as string[] | undefined;
        if ((preservedA && preservedA.length > 0) || (preservedB && preservedB.length > 0)) {
            sections.push("## 整合的见解");
            if (preservedA && preservedA.length > 0) {
                sections.push("### 来自概念 A");
                preservedA.forEach((insight) => sections.push(`- ${insight}`));
            }
            if (preservedB && preservedB.length > 0) {
                sections.push("### 来自概念 B");
                preservedB.forEach((insight) => sections.push(`- ${insight}`));
            }
            sections.push("");
        }

        return sections.join("\n");
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
            this.logger.warn("MergeOrchestrator", "Embedding 重算失败，已移除旧向量避免陈旧结果", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: embedResult.error,
            });

            // 移除旧向量
            const deleteResult = await this.deps.vectorIndex.delete(context.nodeId);
            if (!deleteResult.ok && deleteResult.error.code !== "E311_NOT_FOUND") {
                this.logger.warn("MergeOrchestrator", "移除旧向量失败", {
                    pipelineId: context.pipelineId,
                    nodeId: context.nodeId,
                    error: deleteResult.error,
                });
            }

            // 清理旧重复对
            const clearResult = await this.deps.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
            if (!clearResult.ok) {
                this.logger.warn("MergeOrchestrator", "清理旧重复对失败", {
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
            this.logger.warn("MergeOrchestrator", "清理旧重复对失败", {
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
            this.logger.warn("MergeOrchestrator", "更新向量索引失败", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: upsertResult.error,
            });
        }

        // 去重检测
        const detectResult = await this.deps.duplicateManager.detect(context.nodeId, context.type, context.embedding);
        if (!detectResult.ok) {
            this.logger.warn("MergeOrchestrator", "去重检测失败", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: detectResult.error,
            });
        }
    }

    /**
     * Parents 引用重写：将 Vault 中所有引用被合并笔记的 parents 链接重写为主笔记
     */
    private async rewriteParentsAcrossVault(params: {
        pipelineId: string;
        fromTitle: string;
        toTitle: string;
        skipPaths: Array<string | undefined>;
    }): Promise<Result<{ updatedCount: number }>> {
        const fromLink = `[[${params.fromTitle}]]`;
        const toLink = `[[${params.toTitle}]]`;
        const skip = new Set(params.skipPaths.filter((p): p is string => typeof p === "string" && p.length > 0));

        const candidates: Array<{
            file: TFile;
            nodeId: string;
            previousContent: string;
            nextContent: string;
        }> = [];

        const files = this.deps.noteRepository.listMarkdownFiles();
        for (const file of files) {
            if (skip.has(file.path)) {
                continue;
            }

            let content: string;
            try {
                // eslint-disable-next-line no-await-in-loop
                content = await this.deps.noteRepository.read(file);
            } catch (error) {
                this.logger.warn("MergeOrchestrator", "扫描 parents 引用时读取文件失败", {
                    path: file.path,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }

            const extracted = extractFrontmatter(content);
            if (!extracted) {
                continue;
            }

            const parents = extracted.frontmatter.parents ?? [];
            if (!parents.includes(fromLink)) {
                continue;
            }

            // 替换引用并去重
            const nextParents: string[] = [];
            const seen = new Set<string>();
            for (const p of parents) {
                const next = p === fromLink ? toLink : p;
                if (!next) continue;
                if (seen.has(next)) continue;
                seen.add(next);
                nextParents.push(next);
            }

            const unchanged =
                nextParents.length === parents.length &&
                nextParents.every((value, index) => value === parents[index]);
            if (unchanged) {
                continue;
            }

            const nextFrontmatter: CRFrontmatter = {
                ...extracted.frontmatter,
                parents: nextParents,
                updated: formatCRTimestamp(),
            };
            const nextContent = generateMarkdownContent(nextFrontmatter, extracted.body);

            candidates.push({
                file,
                nodeId: extracted.frontmatter.cruid,
                previousContent: content,
                nextContent,
            });
        }

        if (candidates.length === 0) {
            return ok({ updatedCount: 0 });
        }

        // 先为所有受影响的笔记创建快照，再执行批量写入
        for (const item of candidates) {
            // eslint-disable-next-line no-await-in-loop
            const snapshotResult = await this.deps.undoManager.createSnapshot(
                item.file.path,
                item.previousContent,
                `merge-parents-${params.pipelineId}`,
                item.nodeId,
            );
            if (!snapshotResult.ok) {
                return err(
                    snapshotResult.error.code,
                    `更新 parents 引用前创建快照失败: ${item.file.path}`,
                    snapshotResult.error,
                );
            }
        }

        let updatedCount = 0;
        for (const item of candidates) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await this.deps.noteRepository.writeAtomic(item.file.path, item.nextContent);
                updatedCount += 1;
            } catch (error) {
                this.logger.error("MergeOrchestrator", "更新 parents 引用失败", error as Error, {
                    path: item.file.path,
                    pipelineId: params.pipelineId,
                });
                return err("E302_PERMISSION_DENIED", `更新 parents 引用失败: ${item.file.path}`, error);
            }
        }

        this.logger.info("MergeOrchestrator", "已完成 Merge 的 parents 引用重写", {
            pipelineId: params.pipelineId,
            from: fromLink,
            to: toLink,
            updatedCount,
        });

        return ok({ updatedCount });
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
            this.logger.warn("MergeOrchestrator", "Verify 前置校验失败，跳过自动校验并结束管线", {
                pipelineId: context.pipelineId,
                error: prereqResult.error,
            });
            this.completePipeline(context);
            return;
        }

        const startResult = await this.startVerifyTask(context);
        if (!startResult.ok) {
            this.logger.warn("MergeOrchestrator", "启动 Verify 失败，跳过自动校验并结束管线", {
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

        this.logger.info("MergeOrchestrator", `启动 Verify 任务: ${context.pipelineId}`, {
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
            this.logger.warn("MergeOrchestrator", "持久化管线状态失败", {
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
            this.deps.promptManager, this.logger, "MergeOrchestrator", conceptType,
        );
    }

    /**
     * 获取任务对应的 Provider ID
     */
    private getProviderIdForTask(taskType: TaskType): string {
        return resolveProviderIdForTask(this.getSettings(), taskType, this.logger, "MergeOrchestrator");
    }

    /**
     * 从路径提取笔记标题（不含 .md 扩展名）
     */
    private getNoteTitleFromPath(path: string): string {
        const fileName = path.split("/").pop() || path;
        return fileName.endsWith(".md") ? fileName.slice(0, -".md".length) : fileName;
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
                this.logger.warn("MergeOrchestrator", "文件不存在，无法追加报告", { filePath });
                return;
            }

            const report = buildVerificationReportMarkdown(result);
            const separator = currentContent.endsWith("\n") ? "\n" : "\n\n";
            const newContent = `${currentContent}${separator}${report}`;
            await this.deps.noteRepository.writeAtomic(filePath, newContent);

            this.logger.info("MergeOrchestrator", `验证报告已追加: ${filePath}`);
        } catch (error) {
            this.logger.error("MergeOrchestrator", "追加验证报告失败", error as Error, { filePath });
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
    private publishEvent(event: MergePipelineEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.error("MergeOrchestrator", "事件监听器执行失败", error as Error);
            }
        }
    }
}
