/**
 * CreateOrchestrator：创建管线编排器
 *
 * 独立的创建管线编排器。
 * 管线流程：Define → Tag → Stub → Write → Index → Deduplicate
 *
 * 所有错误通过 ResultMonad 返回，不抛出未捕获异常。
 */

import type { App, TFile } from "obsidian";
import type { CreateOrchestratorDeps } from "./orchestrator-deps";
import {
    type ILogger,
    type TaskRecord,
    type TaskType,
    type CRType,
    type CRFrontmatter,
    type PluginSettings,
    type PipelineContext,
    type PipelineStage,
    type StandardizedConcept,
    type Result,
    ok,
    err,
    toErr,
} from "../types";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { createConceptSignature, generateFilePath, sanitizeFileName } from "./naming-utils";
import { mapStandardizeOutput } from "./standardize-mapper";
import {
    validatePrerequisites as sharedValidatePrerequisites,
    resolveProviderIdForTask,
    buildVerificationReportMarkdown,
    generatePipelineId as sharedGeneratePipelineId,
    resolvePipelineIdFromTask,
    markPipelineFailed,
    markPipelineCompleted,
    appendVerificationReport,
    renderContentToMarkdown as sharedRenderContentToMarkdown,
    maybeStartAutoVerifyOrComplete as sharedMaybeStartAutoVerifyOrComplete,
    startVerifyTask as sharedStartVerifyTask,
    publishEvent as sharedPublishEvent,
    cancelPipelineTasks as sharedCancelPipelineTasks,
    getActivePipelinesFrom,
    handleLockConflictError,
    getActiveState as sharedGetActiveState,
    restorePipelinesForKind,
} from "./orchestrator-utils";
import { TaskFactory } from "./task-factory";
import { generateUUID } from "../data/validators";
import { extractJsonFromResponse } from "../data/validator";
import { formatCRTimestamp } from "../utils/date-utils";

// ============================================================================
// 类型定义
// ============================================================================

/** 管线事件类型 */
type PipelineEventType =
    | "stage_changed"
    | "task_completed"
    | "task_failed"
    | "confirmation_required"
    | "pipeline_completed"
    | "pipeline_failed";

/** 管线事件 */
export interface CreatePipelineEvent {
    type: PipelineEventType;
    pipelineId: string;
    stage: PipelineStage;
    context: PipelineContext;
    timestamp: string;
}

/** 管线事件监听器 */
type CreatePipelineEventListener = (event: CreatePipelineEvent) => void;

/** 创建管线预设选项（用于 Expand 等场景） */
export interface CreatePresetOptions {
    parents?: string[];
    targetPathOverride?: string;
    sources?: string;
}

// ============================================================================
// CreateOrchestrator
// ============================================================================

export class CreateOrchestrator {
    private deps: CreateOrchestratorDeps;
    private logger: ILogger;

    /** 活跃管线上下文 */
    private pipelines: Map<string, PipelineContext> = new Map();
    /** 事件监听器 */
    private listeners: CreatePipelineEventListener[] = [];
    /** taskId → pipelineId 映射 */
    private taskToPipeline: Map<string, string> = new Map();
    /** 队列事件取消订阅 */
    private unsubscribeQueue?: () => void;

    constructor(deps: CreateOrchestratorDeps) {
        this.deps = deps;
        this.logger = deps.logger;

        // 订阅任务队列事件
        this.subscribeToTaskQueue();

        this.logger.debug("CreateOrchestrator", "创建管线编排器初始化完成");
    }

    // ========================================================================
    // 公开方法
    // ========================================================================

    /**
     * 直接 Define（不入队）
     *
     * 直接调用 ProviderManager.chat，不进入任务队列，
     * 立即返回结果给 UI 用于用户确认。
     *
     * @param userInput 用户输入的概念
     * @returns Define 结果（包含类型置信度与标准命名）
     */
    async defineDirect(userInput: string): Promise<Result<StandardizedConcept>> {
        try {
            // 前置校验
            const prerequisiteCheck = this.validatePrerequisites("define");
            if (!prerequisiteCheck.ok) {
                return prerequisiteCheck as Result<StandardizedConcept>;
            }

            // 基础输入校验与清理，防止超长或恶意指令
            const suspicious = [/ignore\s+previous\s+instructions/i, /system\s*:/i, /\[INST\]/i, /<\|im_start\|>/i];
            if (typeof userInput !== "string" || userInput.trim().length === 0) {
                return err("E101_INVALID_INPUT", "输入不能为空");
            }
            if (userInput.length > 10000) {
                return err("E101_INVALID_INPUT", "输入过长，请缩短后重试（最大 10000 字符）");
            }
            for (const pattern of suspicious) {
                if (pattern.test(userInput)) {
                    return err("E101_INVALID_INPUT", "输入包含可疑指令，请检查后重试");
                }
            }
            const sanitizedInput = userInput.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();

            this.logger.info("CreateOrchestrator", "开始直接标准化", {
                userInput: userInput.substring(0, 50),
                event: "STANDARDIZE_DIRECT_START",
            });

            // 获取 Provider 配置
            const settings = this.getSettings();
            const taskConfig = settings.taskModels["define"];
            const providerId = taskConfig.providerId;

            // 构建 prompt
            let prompt: string;
            try {
                prompt = this.deps.promptManager.build("define", { CTX_INPUT: sanitizedInput });
            } catch (error) {
                this.logger.error("CreateOrchestrator", "构建标准化提示词失败", error as Error, {
                    event: "STANDARDIZE_DIRECT_ERROR",
                });
                return toErr(error, "E500_INTERNAL_ERROR", "构建标准化提示词失败");
            }

            // 直接调用 API
            const chatResult = await this.deps.providerManager.chat({
                providerId,
                model: taskConfig.model,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: sanitizedInput },
                ],
                temperature: taskConfig.temperature,
                topP: taskConfig.topP,
                maxTokens: taskConfig.maxTokens,
            });

            if (!chatResult.ok) {
                this.logger.error("CreateOrchestrator", "标准化 API 调用失败", undefined, {
                    errorCode: chatResult.error.code,
                    errorMessage: chatResult.error.message,
                    event: "STANDARDIZE_DIRECT_ERROR",
                });
                return err(chatResult.error.code, chatResult.error.message);
            }

            // 解析响应
            try {
                const content = chatResult.value.content.trim();
                // 尝试提取 JSON（可能被 markdown 代码块包裹）
                const rawParsed = extractJsonFromResponse(content);

                // 转换字段名：API 返回下划线命名，需要转换为驼峰式
                const parsed: StandardizedConcept = mapStandardizeOutput(rawParsed);

                this.logger.info("CreateOrchestrator", "直接标准化完成", {
                    primaryType: parsed.primaryType,
                    event: "STANDARDIZE_DIRECT_SUCCESS",
                });

                return ok(parsed);
            } catch (parseError) {
                this.logger.error("CreateOrchestrator", "解析标准化结果失败", parseError as Error, {
                    response: chatResult.value.content.substring(0, 200),
                    event: "STANDARDIZE_DIRECT_PARSE_ERROR",
                });
                return err("E210_MODEL_OUTPUT_PARSE_FAILED", "解析标准化结果失败", parseError);
            }
        } catch (error) {
            this.logger.error("CreateOrchestrator", "直接标准化失败", error as Error);
            return err("E500_INTERNAL_ERROR", "直接标准化失败", error);
        }
    }

    /**
     * 启动创建管线（使用已标准化的数据）
     *
     * @param standardizedData 标准化结果
     * @param selectedType 用户选择的知识类型
     * @param options 预设选项（Expand 场景使用）
     * @returns 管线 ID
     */
    startCreatePipeline(
        standardizedData: StandardizedConcept,
        selectedType: CRType,
        options?: CreatePresetOptions,
    ): Result<string> {
        try {
            // 前置校验 tag 任务
            const prerequisiteCheck = this.validatePrerequisites("tag");
            if (!prerequisiteCheck.ok) {
                return prerequisiteCheck as Result<string>;
            }

            // 在 tag 之前检查重复名称/路径，避免浪费 API 调用
            const duplicateCheck = this.checkDuplicateByName(
                standardizedData,
                selectedType,
                options?.targetPathOverride,
            );
            if (!duplicateCheck.ok) {
                this.logger.warn("CreateOrchestrator", "重复名称检查失败，管线未启动", {
                    type: selectedType,
                    error: duplicateCheck.error,
                    targetPathOverride: options?.targetPathOverride,
                });
                return duplicateCheck as Result<string>;
            }

            const pipelineId = this.generatePipelineId();
            const nodeId = this.generateNodeId();
            const now = formatCRTimestamp();

            // 创建管线上下文，直接设置标准化数据
            const context: PipelineContext = {
                kind: "create",
                pipelineId,
                nodeId,
                type: selectedType,
                stage: "tagging", // 直接进入 tagging 阶段
                userInput: standardizedData.standardNames[selectedType].chinese,
                standardizedData: {
                    standardNames: standardizedData.standardNames,
                    typeConfidences: standardizedData.typeConfidences,
                    primaryType: selectedType,
                    coreDefinition: standardizedData.coreDefinition,
                },
                parents: options?.parents,
                targetPathOverride: options?.targetPathOverride,
                sources: options?.sources,
                filePath: options?.targetPathOverride,
                createdAt: now,
                updatedAt: now,
            };

            this.pipelines.set(pipelineId, context);

            this.logger.info("CreateOrchestrator", `启动创建管线: ${pipelineId}`, {
                nodeId,
                selectedType,
                chinese: standardizedData.standardNames[selectedType].chinese,
                targetPathOverride: options?.targetPathOverride,
                parents: options?.parents,
            });

            // 创建 tag 任务
            const settings = this.getSettings();
            let taskId: string;
            try {
                taskId = this.deps.taskQueue.enqueue(
                    TaskFactory.create({
                        nodeId,
                        taskType: "tag",
                        maxAttempts: settings.maxRetryAttempts,
                        providerRef: this.getProviderIdForTask("tag"),
                        payload: {
                            pipelineId,
                            standardizedData: context.standardizedData,
                            conceptType: selectedType,
                            userInput: context.userInput,
                        },
                    }),
                );
            } catch (error) {
                this.pipelines.delete(pipelineId);
                // 需求 34.3：锁冲突时使用用户友好提示
                const lockMsg = handleLockConflictError(error);
                if (lockMsg) {
                    return err("E320_TASK_CONFLICT", lockMsg) as Result<string>;
                }
                return toErr(error, "E500_INTERNAL_ERROR", "创建任务失败") as Result<string>;
            }

            // 记录任务到管线的映射
            this.taskToPipeline.set(taskId, pipelineId);

            // 发布事件
            this.publishEvent({
                type: "stage_changed",
                pipelineId,
                stage: "tagging",
                context,
                timestamp: now,
            });

            return ok(pipelineId);
        } catch (error) {
            this.logger.error("CreateOrchestrator", "启动管线失败", error as Error);
            return err("E500_INTERNAL_ERROR", "启动管线失败", error);
        }
    }

    /**
     * startCreatePipelineWithStandardized 的别名（向后兼容）
     */
    startCreatePipelineWithStandardized(
        standardizedData: StandardizedConcept,
        selectedType: CRType,
    ): Result<string> {
        return this.startCreatePipeline(standardizedData, selectedType);
    }

    /**
     * startCreatePipelineWithPreset 的别名（向后兼容）
     */
    startCreatePipelineWithPreset(
        standardizedData: StandardizedConcept,
        selectedType: CRType,
        options?: CreatePresetOptions,
    ): Result<string> {
        return this.startCreatePipeline(standardizedData, selectedType, options);
    }

    /**
     * 确认创建：生成 Stub → 入队 Write 任务
     *
     * @param pipelineId 管线 ID
     */
    async confirmCreate(pipelineId: string): Promise<Result<void>> {
        const context = this.pipelines.get(pipelineId);
        if (!context) {
            return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
        }

        if (context.stage !== "review_draft") {
            return err("E310_INVALID_STATE", `管线状态不正确: ${context.stage}，期望: review_draft`);
        }

        try {
            this.logger.info("CreateOrchestrator", `用户确认创建: ${pipelineId}`);

            // 1. 生成 Stub 文件（仅含 frontmatter，NoteState: Stub）
            const stubResult = await this.createStubFile(context);
            if (!stubResult.ok) {
                context.stage = "failed";
                context.error = { code: stubResult.error.code, message: stubResult.error.message };
                return stubResult as Result<void>;
            }

            // 2. 更新阶段为 writing
            context.stage = "writing";
            context.updatedAt = formatCRTimestamp();

            // 3. 创建 write 任务
            const settings = this.getSettings();
            let taskId: string;
            try {
                taskId = this.deps.taskQueue.enqueue(
                    TaskFactory.create({
                        nodeId: context.nodeId,
                        taskType: "write",
                        maxAttempts: settings.maxRetryAttempts,
                        providerRef: this.getProviderIdForTask("write"),
                        payload: {
                            pipelineId,
                            standardizedData: context.standardizedData,
                            conceptType: context.type,
                            coreDefinition: context.standardizedData?.coreDefinition,
                            enrichedData: context.enrichedData,
                            embedding: context.embedding,
                            filePath: context.filePath,
                            userInput: context.userInput,
                            sources: context.sources,
                        },
                    }),
                );
            } catch (error) {
                context.stage = "failed";
                // 需求 34.3：锁冲突时使用用户友好提示
                const lockMsg = handleLockConflictError(error);
                if (lockMsg) {
                    context.error = { code: "E320_TASK_CONFLICT", message: lockMsg };
                    return err("E320_TASK_CONFLICT", lockMsg) as Result<void>;
                }
                const converted = toErr(error, "E500_INTERNAL_ERROR", "创建任务失败");
                context.error = { code: converted.error.code, message: converted.error.message };
                return converted as Result<void>;
            }

            this.taskToPipeline.set(taskId, pipelineId);

            // 发布事件
            this.publishEvent({
                type: "stage_changed",
                pipelineId,
                stage: "writing",
                context,
                timestamp: context.updatedAt,
            });

            return ok(undefined);
        } catch (error) {
            this.logger.error("CreateOrchestrator", "确认创建失败", error as Error);
            return err("E500_INTERNAL_ERROR", "确认创建失败", error);
        }
    }

    /**
     * 确认写入（Create 管线的最终写入）
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

            this.logger.info("CreateOrchestrator", `确认写入: ${pipelineId}`);

            return await this.confirmCreateWrite(context);
        } catch (error) {
            this.logger.error("CreateOrchestrator", "确认写入失败", error as Error);
            context.stage = "failed";
            context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
            return err("E500_INTERNAL_ERROR", "确认写入失败", error);
        }
    }

    /**
     * 更新标准化数据（用户修改类型/名称）
     */
    updateStandardizedData(
        pipelineId: string,
        updates: Partial<PipelineContext["standardizedData"]>,
    ): Result<PipelineContext> {
        const edits = updates || {};
        const context = this.pipelines.get(pipelineId);
        if (!context) {
            return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
        }

        if (!context.standardizedData) {
            return err("E310_INVALID_STATE", "标准化结果尚未生成，无法更新");
        }

        // 合并名称、别名、类型
        const merged: NonNullable<PipelineContext["standardizedData"]> = {
            ...context.standardizedData,
            ...edits,
            standardNames: {
                ...context.standardizedData.standardNames,
                ...(edits.standardNames || {}),
            },
            typeConfidences: edits.typeConfidences ?? context.standardizedData.typeConfidences ?? {},
        };

        // 设置主要类型（优先用户选择）
        if (edits.primaryType) {
            merged.primaryType = edits.primaryType as CRType;
            context.type = edits.primaryType as CRType;
        } else if (merged.typeConfidences) {
            const primaryType = Object.entries(merged.typeConfidences)
                .sort(([, a], [, b]) => b - a)[0]?.[0] as CRType | undefined;
            if (primaryType) {
                merged.primaryType = primaryType;
                context.type = primaryType;
            }
        }

        context.standardizedData = merged;
        context.updatedAt = formatCRTimestamp();

        this.publishEvent({
            type: "stage_changed",
            pipelineId,
            stage: context.stage,
            context,
            timestamp: context.updatedAt,
        });

        return ok(context);
    }

    /**
     * 构建写入预览
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

        if (!["review_changes", "saving", "checking_duplicates"].includes(context.stage)) {
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
        sharedCancelPipelineTasks(pipelineId, this.taskToPipeline, this.deps.taskQueue, this.logger, "CreateOrchestrator");

        // 更新状态
        context.stage = "failed";
        context.error = { code: "E310_INVALID_STATE", message: "用户取消" };
        context.updatedAt = formatCRTimestamp();

        this.logger.info("CreateOrchestrator", `管线已取消: ${pipelineId}`);

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
        return getActivePipelinesFrom(this.pipelines);
    }

    /**
     * 订阅管线事件
     */
    subscribe(listener: CreatePipelineEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * 恢复持久化的管线状态（委托共享实现）
     */
    restorePipelines(
        pipelines: Map<string, PipelineContext>,
        taskToPipeline: Map<string, string>,
    ): void {
        restorePipelinesForKind("create", this.pipelines, this.taskToPipeline, pipelines, taskToPipeline);
    }

    /**
     * 获取活跃管线和任务映射（委托共享实现）
     */
    getActiveState(): {
        pipelines: Map<string, PipelineContext>;
        taskToPipeline: Map<string, string>;
    } {
        return sharedGetActiveState(this.pipelines, this.taskToPipeline);
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
        const pipelineId = resolvePipelineIdFromTask(taskId, this.taskToPipeline, this.deps.taskQueue);
        if (!pipelineId) return;

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        const task = this.deps.taskQueue.getTask(taskId)!;

        this.logger.debug("CreateOrchestrator", `任务完成: ${taskId}`, {
            pipelineId,
            taskType: task.taskType,
        });

        // 根据任务类型更新管线状态并触发下一步
        switch (task.taskType) {
            case "tag":
                await this.handleTagCompleted(context, task);
                break;
            case "write":
                await this.handleWriteCompleted(context, task);
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
        const pipelineId = resolvePipelineIdFromTask(taskId, this.taskToPipeline, this.deps.taskQueue);
        if (!pipelineId) return;

        const context = this.pipelines.get(pipelineId);
        if (!context) return;

        const task = this.deps.taskQueue.getTask(taskId);
        markPipelineFailed(
            context,
            task?.errors?.[0]?.code || "E500_INTERNAL_ERROR",
            task?.errors?.[0]?.message || "任务执行失败",
            (e) => this.publishEvent(e as CreatePipelineEvent),
            this.logger,
            "CreateOrchestrator",
            { taskId },
        );
    }

    // ========================================================================
    // 私有方法 — 各阶段任务完成处理
    // ========================================================================

    /**
     * Tag 任务完成：自动确认创建
     */
    private async handleTagCompleted(
        context: PipelineContext,
        task: TaskRecord,
    ): Promise<void> {
        const result = (task.result || task.payload?.result) as PipelineContext["enrichedData"];
        if (!result) {
            context.stage = "failed";
            context.error = { code: "E310_INVALID_STATE", message: "丰富结果缺失" };
            this.publishEvent({
                type: "pipeline_failed",
                pipelineId: context.pipelineId,
                stage: "failed",
                context,
                timestamp: formatCRTimestamp(),
            });
            return;
        }

        context.enrichedData = result;

        // 进入等待创建确认阶段（自动确认）
        context.stage = "review_draft";
        context.updatedAt = formatCRTimestamp();

        this.logger.info("CreateOrchestrator", `自动确认创建并生成内容: ${context.pipelineId}`);
        const confirmResult = await this.confirmCreate(context.pipelineId);
        if (!confirmResult.ok) {
            context.stage = "failed";
            context.error = { code: confirmResult.error.code, message: confirmResult.error.message };
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
     * Write 任务完成：进入 indexing 阶段
     */
    private async handleWriteCompleted(
        context: PipelineContext,
        task: TaskRecord,
    ): Promise<void> {
        const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
        if (result?.content) {
            context.generatedContent = result.content as unknown as Record<string, unknown>;
        } else if (result) {
            // 如果没有 content 字段，整个 result 就是内容
            context.generatedContent = result;
        }

        // 生成文件路径（如果 Stub 阶段未生成）
        if (!context.filePath && context.standardizedData) {
            const fileName = sanitizeFileName(context.standardizedData.standardNames[context.type].chinese);
            context.filePath = `${fileName}.md`;
        }

        // write 完成后，执行 index
        context.stage = "indexing";
        context.updatedAt = formatCRTimestamp();

        this.publishEvent({
            type: "stage_changed",
            pipelineId: context.pipelineId,
            stage: "indexing",
            context,
            timestamp: context.updatedAt,
        });

        // 直接执行 embedding（不进入队列）
        await this.executeEmbeddingDirect(context);
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
            this.logger.warn("CreateOrchestrator", "Verify 结果缺失，跳过报告追加", {
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
     * 执行创建写入（Stub → Draft）
     */
    private async confirmCreateWrite(context: PipelineContext): Promise<Result<void>> {
        const composed = await this.composeWriteContent(context);
        if (!composed.ok) {
            context.stage = "failed";
            context.error = { code: composed.error.code, message: composed.error.message };
            return composed as Result<void>;
        }

        const { targetPath, newContent } = composed.value;
        context.filePath = targetPath;

        await this.deps.noteRepository.writeAtomic(targetPath, newContent);

        this.logger.info("CreateOrchestrator", `文件已写入 (Stub → Draft): ${targetPath}`, {
            pipelineId: context.pipelineId,
            fileSize: newContent.length,
            statusTransition: "Stub → Draft",
        });

        if (context.embedding) {
            const upsertResult = await this.deps.vectorIndex.upsert({
                uid: context.nodeId,
                type: context.type,
                embedding: context.embedding,
                updated: formatCRTimestamp(),
            });
            if (!upsertResult.ok) {
                this.logger.warn("CreateOrchestrator", "向量索引更新失败，继续流程", {
                    pipelineId: context.pipelineId,
                    error: upsertResult.error,
                });
            }
        }

        context.stage = "checking_duplicates";
        context.updatedAt = formatCRTimestamp();
        if (context.embedding) {
            const detectResult = await this.deps.duplicateManager.detect(
                context.nodeId,
                context.type,
                context.embedding,
            );
            if (!detectResult.ok) {
                this.logger.warn("CreateOrchestrator", "重复检测失败，继续流程", {
                    pipelineId: context.pipelineId,
                    error: detectResult.error,
                });
            }
        }

        await this.maybeStartAutoVerifyOrComplete(context);
        return ok(undefined);
    }

    /**
     * 直接执行 embedding（不进入队列）
     */
    private async executeEmbeddingDirect(context: PipelineContext): Promise<void> {
        try {
            this.logger.info("CreateOrchestrator", `直接执行 index: ${context.pipelineId}`);

            // 构建嵌入文本
            const embeddingText = this.buildEmbeddingText(context);

            // 获取 Provider 配置和任务模型配置
            const settings = this.getSettings();
            const taskConfig = settings.taskModels["index"];
            const providerId = taskConfig?.providerId || this.getProviderIdForTask("index");
            const embeddingModel = this.deps.vectorIndex.getEmbeddingModel();
            const embeddingDimension = this.deps.vectorIndex.getEmbeddingDimension();

            // 直接调用 embedding API
            const embedResult = await this.deps.providerManager.embed({
                providerId,
                model: embeddingModel,
                input: embeddingText,
                dimensions: embeddingDimension,
            });

            if (!embedResult.ok) {
                throw new Error(`Embedding 失败: ${embedResult.error.message}`);
            }

            // 保存 embedding 结果
            context.embedding = embedResult.value.embedding;
            context.updatedAt = formatCRTimestamp();

            this.logger.info("CreateOrchestrator", `Embedding 完成: ${context.pipelineId}`, {
                tokensUsed: embedResult.value.tokensUsed,
            });

            // Create 管线 embedding 完成后自动写入
            await this.autoConfirmWrite(context);
        } catch (error) {
            this.logger.error("CreateOrchestrator", "直接执行 embedding 失败", error as Error);
            context.stage = "failed";
            context.error = {
                code: "E500_INTERNAL_ERROR",
                message: error instanceof Error ? error.message : String(error),
            };
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
     * 自动确认写入（无需 UI 交互）
     */
    private async autoConfirmWrite(context: PipelineContext): Promise<void> {
        this.logger.info("CreateOrchestrator", `自动写入（无需确认）: ${context.pipelineId}`);

        // 直接进入写入确认阶段
        context.stage = "review_changes";
        context.updatedAt = formatCRTimestamp();

        // 直接调用 confirmWrite 逻辑
        const writeResult = await this.confirmWrite(context.pipelineId);

        if (!writeResult.ok) {
            context.stage = "failed";
            context.error = { code: writeResult.error.code, message: writeResult.error.message };
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
     * 根据设置决定是否自动 Verify 或直接完成（委托共享实现）
     */
    private async maybeStartAutoVerifyOrComplete(context: PipelineContext): Promise<void> {
        return sharedMaybeStartAutoVerifyOrComplete(
            context,
            { noteRepository: this.deps.noteRepository, taskQueue: this.deps.taskQueue },
            (e) => this.publishEvent(e as CreatePipelineEvent),
            this.taskToPipeline,
            (t) => this.validatePrerequisites(t, context.type),
            (t) => this.getProviderIdForTask(t),
            (ctx) => this.completePipeline(ctx),
            this.getSettings(),
            this.logger,
            "CreateOrchestrator",
        );
    }

    /**
     * 启动 Verify 任务（委托共享实现，修复 E320 行为漂移）
     */
    private async startVerifyTask(context: PipelineContext): Promise<Result<void>> {
        return sharedStartVerifyTask(
            context,
            { noteRepository: this.deps.noteRepository, taskQueue: this.deps.taskQueue },
            (e) => this.publishEvent(e as CreatePipelineEvent),
            this.taskToPipeline,
            (t) => this.getProviderIdForTask(t),
            this.getSettings().maxRetryAttempts,
            this.logger,
            "CreateOrchestrator",
        );
    }

    /**
     * 完成管线
     */
    private completePipeline(context: PipelineContext): void {
        markPipelineCompleted(context, (e) => this.publishEvent(e as CreatePipelineEvent));
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
     * 委托给 orchestrator-utils 共享实现（DRY）
     */
    private validatePrerequisites(taskType: TaskType, conceptType?: CRType): Result<void> {
        const settings = this.getSettings();
        const providerId = this.getProviderIdForTask(taskType);
        return sharedValidatePrerequisites(
            settings, taskType, providerId,
            this.deps.promptManager, this.logger, "CreateOrchestrator", conceptType,
        );
    }

    /**
     * 检查是否存在同类型同名的笔记
     */
    private checkDuplicateByName(
        standardizedData: StandardizedConcept,
        type: CRType,
        targetPathOverride?: string,
    ): Result<void> {
        const settings = this.getSettings();
        const normalizedOverride =
            targetPathOverride && targetPathOverride.trim().length > 0
                ? targetPathOverride.endsWith(".md")
                    ? targetPathOverride
                    : `${targetPathOverride}.md`
                : undefined;
        const signature = createConceptSignature(
            {
                standardName: standardizedData.standardNames[type],
                aliases: [],
                coreDefinition: standardizedData.coreDefinition,
            },
            type,
        );

        // 生成目标文件路径
        const targetPath = normalizedOverride
            ? normalizedOverride
            : generateFilePath(signature.standardName, settings.directoryScheme, type);

        // 检查文件是否已存在
        const file = this.deps.noteRepository.getFileByPath(targetPath);
        if (file) {
            this.logger.warn("CreateOrchestrator", "检测到同类型同名笔记", {
                type,
                name: signature.standardName,
                path: targetPath,
                event: "DUPLICATE_NAME_DETECTED",
            });

            return err(
                "E320_TASK_CONFLICT",
                `已存在同类型同名的笔记：${signature.standardName}\n路径：${targetPath}\n\n请修改概念名称或检查是否为重复创建。`,
                {
                    type,
                    name: signature.standardName,
                    path: targetPath,
                },
            );
        }

        return ok(undefined);
    }

    /**
     * 获取任务对应的 Provider ID
     * 委托给 orchestrator-utils 共享实现（DRY）
     */
    private getProviderIdForTask(taskType: TaskType): string {
        return resolveProviderIdForTask(this.getSettings(), taskType, this.logger, "CreateOrchestrator");
    }

    /**
     * 创建 Stub 文件（仅含 frontmatter）
     */
    private async createStubFile(context: PipelineContext): Promise<Result<string>> {
        try {
            if (!context.standardizedData) {
                return err("E310_INVALID_STATE", "缺少标准化数据，无法创建 Stub");
            }

            const settings = this.getSettings();
            const signature = createConceptSignature(
                {
                    standardName: context.standardizedData.standardNames[context.type],
                    aliases: context.enrichedData?.aliases || [],
                    coreDefinition: context.standardizedData.coreDefinition,
                },
                context.type,
            );

            // 生成目标路径
            const { targetPath, targetName } = this.resolveCreateTarget(context, signature.standardName);
            context.filePath = targetPath;

            // 确保目录存在
            await this.deps.noteRepository.ensureDirForPath(targetPath);

            // 生成仅含 frontmatter 的 Stub 内容
            const frontmatter = generateFrontmatter({
                cruid: context.nodeId,
                type: context.type,
                name: targetName,
                parents: context.parents ?? [],
                status: "Stub",
                aliases: context.enrichedData?.aliases,
                tags: context.enrichedData?.tags,
            });
            const stubContent = generateMarkdownContent(frontmatter, ""); // 无正文

            // 原子写入 Stub 文件
            await this.deps.noteRepository.writeAtomic(targetPath, stubContent);

            this.logger.info("CreateOrchestrator", `Stub 文件已创建: ${targetPath}`, {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                status: "Stub",
            });

            return ok(targetPath);
        } catch (error) {
            this.logger.error("CreateOrchestrator", "创建 Stub 文件失败", error as Error);
            return err("E302_PERMISSION_DENIED", "创建 Stub 文件失败", error);
        }
    }

    /**
     * 解析创建目标路径
     */
    private resolveCreateTarget(
        context: PipelineContext,
        signatureStandardName: string,
    ): { targetPath: string; targetName: string } {
        const settings = this.getSettings();
        const hasOverride = !!context.targetPathOverride && context.targetPathOverride.trim().length > 0;

        const targetPath = hasOverride
            ? context.targetPathOverride!.endsWith(".md")
                ? context.targetPathOverride!
                : `${context.targetPathOverride!}.md`
            : context.filePath ||
              generateFilePath(signatureStandardName, settings.directoryScheme, context.type);

        const targetName = hasOverride
            ? (targetPath.split("/").pop() || signatureStandardName).replace(/\.md$/i, "") || signatureStandardName
            : signatureStandardName;

        return { targetPath, targetName };
    }

    /**
     * 组合写入内容（Create 管线专用）
     */
    private async composeWriteContent(context: PipelineContext): Promise<Result<{
        targetPath: string;
        previousContent: string;
        newContent: string;
    }>> {
        if (!context.standardizedData || !context.generatedContent) {
            return err("E310_INVALID_STATE", "缺少生成内容或标准化数据");
        }

        const settings = this.getSettings();
        const signature = createConceptSignature(
            {
                standardName: context.standardizedData.standardNames[context.type],
                aliases: context.enrichedData?.aliases || [],
                coreDefinition: context.standardizedData.coreDefinition,
            },
            context.type,
        );

        const { targetPath, targetName } = this.resolveCreateTarget(context, signature.standardName);
        context.filePath = targetPath;

        await this.deps.noteRepository.ensureDirForPath(targetPath);

        const previousContent = (await this.deps.noteRepository.readByPathIfExists(targetPath)) ?? "";

        const markdownBody = this.renderContentToMarkdown(context, targetName);

        const definition =
            context.generatedContent && typeof context.generatedContent === "object"
                ? typeof (context.generatedContent as Record<string, unknown>).definition === "string"
                    ? ((context.generatedContent as Record<string, unknown>).definition as string)
                    : undefined
                : undefined;
        const frontmatter = generateFrontmatter({
            cruid: context.nodeId,
            type: context.type,
            name: targetName,
            definition,
            parents: context.parents ?? [],
            status: "Draft",
            aliases: context.enrichedData?.aliases,
            tags: context.enrichedData?.tags,
        });

        const fullContent = generateMarkdownContent(frontmatter, markdownBody);

        return ok({
            targetPath,
            previousContent,
            newContent: fullContent,
        });
    }

    /**
     * 渲染内容为 Markdown（委托共享实现）
     */
    private renderContentToMarkdown(context: PipelineContext, standardName: string): string {
        const settings = this.getSettings();
        return sharedRenderContentToMarkdown(
            context, standardName, this.deps.contentRenderer, "zh",
        );
    }

    /**
     * 构建嵌入文本
     */
    private buildEmbeddingText(context: PipelineContext): string {
        const parts: string[] = [];

        if (context.standardizedData) {
            const currentName = context.standardizedData.standardNames[context.type];
            parts.push(currentName.chinese);
            parts.push(currentName.english);
            if (context.standardizedData.coreDefinition) {
                parts.push(context.standardizedData.coreDefinition);
            }
        }

        parts.push(`类型: ${context.type}`);

        if (context.enrichedData?.tags) {
            parts.push(`标签: ${context.enrichedData.tags.join(", ")}`);
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
        await appendVerificationReport(
            this.deps.noteRepository, filePath, result,
            this.logger, "CreateOrchestrator",
        );
    }

    /**
     * 生成管线 ID
     */
    private generatePipelineId(): string {
        return sharedGeneratePipelineId();
    }

    /**
     * 生成节点 ID (UUID v4)
     */
    private generateNodeId(): string {
        return generateUUID();
    }

    /**
     * 发布事件
     */
    private publishEvent(event: CreatePipelineEvent): void {
        sharedPublishEvent(this.listeners, event, this.logger, "CreateOrchestrator");
    }
}
