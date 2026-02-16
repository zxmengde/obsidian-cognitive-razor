/**
 * VerifyOrchestrator：核查管线编排器
 *
 * 独立的核查管线编排器。
 * 管线流程：Snapshot → Verify → 追加报告
 *
 * 所有错误通过 ResultMonad 返回，不抛出未捕获异常。
 *
 * @see 需求 2.5, 2.8, 27.3
 */

import type { TFile } from "obsidian";
import type { OrchestratorDeps } from "./orchestrator-deps";
import {
    type ILogger,
    type TaskRecord,
    type TaskType,
    type CRType,
    type PluginSettings,
    type PipelineContext,
    type PipelineStage,
    type Result,
    CognitiveRazorError,
    ok,
    err,
    toErr,
} from "../types";
import { extractFrontmatter } from "./frontmatter-utils";
import { TaskFactory } from "./task-factory";
import { generateUUID } from "../data/validators";
import { formatCRTimestamp } from "../utils/date-utils";
import { validatePrerequisites as sharedValidatePrerequisites, resolveProviderIdForTask, buildVerificationReportMarkdown } from "./orchestrator-utils";

// ============================================================================
// 类型定义
// ============================================================================

/** 管线事件类型 */
type VerifyPipelineEventType =
    | "stage_changed"
    | "task_completed"
    | "task_failed"
    | "pipeline_completed"
    | "pipeline_failed";

/** 管线事件 */
export interface VerifyPipelineEvent {
    type: VerifyPipelineEventType;
    pipelineId: string;
    stage: PipelineStage;
    context: PipelineContext;
    timestamp: string;
}

/** 管线事件监听器 */
type VerifyPipelineEventListener = (event: VerifyPipelineEvent) => void;

// ============================================================================
// VerifyOrchestrator
// ============================================================================

export class VerifyOrchestrator {
    private deps: OrchestratorDeps;
    private logger: ILogger;

    /** 活跃管线上下文 */
    private pipelines: Map<string, PipelineContext> = new Map();
    /** 事件监听器 */
    private listeners: VerifyPipelineEventListener[] = [];
    /** taskId → pipelineId 映射 */
    private taskToPipeline: Map<string, string> = new Map();
    /** 队列事件取消订阅 */
    private unsubscribeQueue?: () => void;

    constructor(deps: OrchestratorDeps) {
        this.deps = deps;
        this.logger = deps.logger;

        // 订阅任务队列事件
        this.subscribeToTaskQueue();

        this.logger.debug("VerifyOrchestrator", "核查管线编排器初始化完成");
    }

    // ========================================================================
    // 公开方法
    // ========================================================================

    /**
     * 启动核查管线（手动触发）
     *
     * 流程：读取笔记 → 创建快照 → 入队 Verify 任务 → 追加报告
     *
     * @param filePath 目标笔记路径
     * @returns 管线 ID
     */
    startVerifyPipeline(filePath: string): Result<string> {
        // 前置校验：检查 Provider 和模板是否可用
        const prereqResult = this.validatePrerequisites("verify");
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

        const context: PipelineContext = {
            kind: "verify",
            pipelineId,
            nodeId: generateUUID(), // 临时 ID，后续从 frontmatter 读取
            type: "Entity", // 临时类型，后续从 frontmatter 读取
            stage: "idle",
            userInput: file.basename,
            filePath,
            createdAt: now,
            updatedAt: now,
        };

        this.pipelines.set(pipelineId, context);

        this.logger.info("VerifyOrchestrator", `启动 Verify 管线: ${pipelineId}`, { filePath });

        // 异步执行核查流程
        void this.executeVerifyPipeline(context, file);

        return ok(pipelineId);
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
                    this.logger.warn("VerifyOrchestrator", `取消任务失败: ${taskId}`, {
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

        this.logger.info("VerifyOrchestrator", `管线已取消: ${pipelineId}`);

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
    subscribe(listener: VerifyPipelineEventListener): () => void {
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
            if (ctx.kind === "verify") {
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
                void this.handleTaskCompleted(event.taskId);
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

        this.logger.debug("VerifyOrchestrator", `任务完成: ${taskId}`, {
            pipelineId,
            taskType: task.taskType,
        });

        // Verify 管线只处理 verify 类型任务
        if (task.taskType === "verify") {
            await this.handleVerifyCompleted(context, task);
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

        this.logger.error("VerifyOrchestrator", `管线失败: ${pipelineId}`, undefined, {
            taskId,
            error: context.error,
        });
    }

    // ========================================================================
    // 私有方法 — Verify 任务完成处理
    // ========================================================================

    /**
     * Verify 任务完成：追加报告到笔记末尾并完成管线
     *
     * 遵循需求 27.3：调用 LLM 进行事实核查并将报告追加到笔记末尾
     */
    private async handleVerifyCompleted(
        context: PipelineContext,
        task: TaskRecord,
    ): Promise<void> {
        const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;

        if (!result) {
            context.stage = "failed";
            context.error = { code: "E310_INVALID_STATE", message: "Verify 结果缺失" };
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

        context.verificationResult = result;

        this.logger.info("VerifyOrchestrator", `Verify 完成: ${context.pipelineId}`, {
            overall_assessment: result.overall_assessment,
            issueCount: Array.isArray(result.issues) ? result.issues.length : 0,
        });

        // 追加报告到笔记末尾
        const filePath = context.filePath;
        if (filePath) {
            const appendResult = await this.appendVerificationReportToNote(
                filePath,
                result,
                task.id,
                context.nodeId,
            );
            if (!appendResult.ok) {
                context.stage = "failed";
                context.error = { code: appendResult.error.code, message: appendResult.error.message };
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
        }

        this.completePipeline(context);
    }

    // ========================================================================
    // 私有方法 — 管线核心逻辑
    // ========================================================================

    /**
     * 执行核查管线（异步）
     *
     * 流程：读取笔记 → 解析 frontmatter → 创建快照 → 入队 Verify 任务
     */
    private async executeVerifyPipeline(
        context: PipelineContext,
        file: TFile,
    ): Promise<void> {
        try {
            // 1. 读取笔记内容
            const content = await this.deps.noteRepository.readByPath(file.path);

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

            // 3. 创建快照（Verify 会追加报告到笔记末尾，先创建快照保证可撤销）
            const snapshotResult = await this.deps.undoManager.createSnapshot(
                context.filePath!,
                content,
                context.pipelineId,
                context.nodeId,
            );
            if (snapshotResult.ok) {
                context.snapshotId = snapshotResult.value;
            }

            // 4. 二次校验（类型已确定后再次检查 Provider 和模板）
            const prereqResult = this.validatePrerequisites("verify", context.type);
            if (!prereqResult.ok) {
                context.stage = "failed";
                context.error = { code: prereqResult.error.code, message: prereqResult.error.message };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }

            // 5. 入队 Verify 任务
            const startResult = await this.startVerifyTask(context);
            if (!startResult.ok) {
                context.stage = "failed";
                context.error = { code: startResult.error.code, message: startResult.error.message };
                this.publishEvent({
                    type: "pipeline_failed",
                    pipelineId: context.pipelineId,
                    stage: "failed",
                    context,
                    timestamp: formatCRTimestamp(),
                });
                return;
            }
        } catch (error) {
            this.logger.error("VerifyOrchestrator", "Verify 管线执行失败", error as Error, {
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
     * 入队 Verify 任务
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

        this.logger.info("VerifyOrchestrator", `启动 Verify 任务: ${context.pipelineId}`, {
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
            this.deps.promptManager, this.logger, "VerifyOrchestrator", conceptType,
        );
    }

    /**
     * 获取任务对应的 Provider ID
     */
    private getProviderIdForTask(taskType: TaskType): string {
        return resolveProviderIdForTask(this.getSettings(), taskType, this.logger, "VerifyOrchestrator");
    }

    /**
     * 追加验证报告到笔记末尾
     * 委托给 orchestrator-utils 共享的 buildVerificationReportMarkdown（DRY）
     */
    private async appendVerificationReportToNote(
        filePath: string,
        result: Record<string, unknown>,
        snapshotTaskId: string,
        nodeId?: string,
    ): Promise<Result<void>> {
        try {
            const existing = await this.deps.noteRepository.readByPathIfExists(filePath);
            if (existing === null) {
                return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`, { filePath });
            }

            // 追加前创建快照（保证可撤销）
            const snapshotResult = await this.deps.undoManager.createSnapshot(
                filePath,
                existing,
                snapshotTaskId,
                nodeId,
            );
            if (!snapshotResult.ok) {
                return err(snapshotResult.error.code, snapshotResult.error.message, snapshotResult.error.details);
            }

            const report = buildVerificationReportMarkdown(result);
            const separator = existing.endsWith("\n") ? "\n" : "\n\n";
            const next = `${existing}${separator}${report}\n`;

            await this.deps.noteRepository.writeAtomic(filePath, next);

            this.logger.info("VerifyOrchestrator", `验证报告已追加: ${filePath}`);

            return ok(undefined);
        } catch (error) {
            return toErr(error, "E302_PERMISSION_DENIED", "追加 Verify 报告失败");
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
    private publishEvent(event: VerifyPipelineEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.error("VerifyOrchestrator", "事件监听器执行失败", error as Error);
            }
        }
    }
}
