/**
 * Orchestrator 共享工具函数
 *
 * 提取自 Create/Amend/Merge/Verify 四个编排器中重复的
 * validatePrerequisites 和 getProviderIdForTask 逻辑。
 *
 * DRY 原则：消除 4 处 ~90% 相同的前置校验代码。
 */

import type { ILogger, TaskType, CRType, PluginSettings, Result, PipelineContext, CRFrontmatter } from "../types";
import { ok, err, CognitiveRazorError, toErr } from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import type { PromptManager } from "./prompt-manager";
import type { TaskQueue } from "./task-queue";
import type { NoteRepository } from "./note-repository";
import type { ContentRenderer } from "./content-renderer";
import type { I18n } from "./i18n";
import type { VectorIndex } from "./vector-index";
import type { ProviderManager } from "./provider-manager";
import type { DuplicateManager } from "./duplicate-manager";
import { TaskFactory } from "./task-factory";

/**
 * 校验任务前置条件：Provider 配置 + 模板加载
 *
 * @param settings - 当前插件设置
 * @param taskType - 任务类型
 * @param providerId - 已解析的 Provider ID
 * @param promptManager - 模板管理器
 * @param logger - 日志实例
 * @param callerName - 调用方名称（用于日志）
 * @param conceptType - 可选的概念类型（影响模板解析）
 */
export function validatePrerequisites(
    settings: PluginSettings,
    taskType: TaskType,
    providerId: string,
    promptManager: PromptManager,
    logger: ILogger,
    callerName: string,
    conceptType?: CRType,
): Result<void> {
    // 1. 检查 Provider 是否配置
    if (!providerId) {
        logger.error(callerName, "Provider 未配置", undefined, {
            taskType,
            event: "PREREQUISITE_CHECK_FAILED",
        });
        return err("E401_PROVIDER_NOT_CONFIGURED", `任务 ${taskType} 未配置 Provider，请在设置中配置 Provider`);
    }

    // 检查 Provider 是否存在且启用
    const providerConfig = settings.providers[providerId];
    if (!providerConfig) {
        logger.error(callerName, "Provider 不存在", undefined, {
            taskType,
            providerId,
            event: "PREREQUISITE_CHECK_FAILED",
        });
        return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 不存在，请在设置中重新配置`);
    }

    if (!providerConfig.enabled) {
        logger.error(callerName, "Provider 已禁用", undefined, {
            taskType,
            providerId,
            event: "PREREQUISITE_CHECK_FAILED",
        });
        return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 已禁用，请在设置中启用`);
    }

    if (!providerConfig.apiKey) {
        logger.error(callerName, "Provider API Key 未配置", undefined, {
            taskType,
            providerId,
            event: "PREREQUISITE_CHECK_FAILED",
        });
        return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 的 API Key 未配置`);
    }

    // 2. 检查模板是否已加载
    const templateId = promptManager.resolveTemplateId(taskType, conceptType);
    if (!promptManager.hasTemplate(templateId)) {
        logger.error(callerName, "模板未加载", undefined, {
            taskType,
            templateId,
            event: "PREREQUISITE_CHECK_FAILED",
        });
        return err("E404_TEMPLATE_NOT_FOUND", `模板 "${templateId}" 未加载，请检查 prompts 目录`);
    }

    logger.debug(callerName, "前置校验通过", {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_PASSED",
    });

    return ok(undefined);
}

/**
 * 解析任务对应的 Provider ID
 *
 * 优先级：任务特定配置 > 默认 Provider > 第一个启用的 Provider
 */
export function resolveProviderIdForTask(
    settings: PluginSettings,
    taskType: TaskType,
    logger: ILogger,
    callerName: string,
): string {
    // 优先使用任务特定的 providerId
    const taskModel = settings.taskModels[taskType];
    if (taskModel?.providerId && taskModel.providerId.trim() !== "") {
        return taskModel.providerId;
    }

    // 回退到默认 Provider
    if (settings.defaultProviderId && settings.defaultProviderId.trim() !== "") {
        return settings.defaultProviderId;
    }

    // 如果都没有，返回第一个启用的 Provider
    const firstProvider = Object.keys(settings.providers).find(
        (id) => settings.providers[id].enabled,
    );

    if (firstProvider) {
        logger.warn(callerName, `任务 ${taskType} 未配置 Provider，使用第一个可用 Provider: ${firstProvider}`);
        return firstProvider;
    }

    logger.error(callerName, `任务 ${taskType} 未配置 Provider，且没有可用的 Provider`);
    return "";
}


/**
 * 构建验证报告 Markdown（共享实现）
 *
 * 匹配 executeVerify 返回的 JSON schema：
 * overall_assessment, confidence_score, issues, verified_claims,
 * recommendations, requires_human_review
 *
 * DRY 原则：替代 Create/Amend/Merge/Verify 四处重复实现。
 */
export function buildVerificationReportMarkdown(result: Record<string, unknown>): string {
    const now = formatCRTimestamp();
    const lines: string[] = [];

    lines.push("## 事实核查报告\n");

    // 总体评估
    const assessment = result.overall_assessment;
    if (typeof assessment === "string" && assessment) {
        const label = assessment === "pass" ? "✅ 通过"
            : assessment === "needs_review" ? "⚠️ 需要审查"
            : assessment === "fail" ? "❌ 未通过"
            : assessment;
        lines.push(`**总体评估**: ${label}`);
    }

    // 置信度
    const score = result.confidence_score;
    if (typeof score === "number") {
        lines.push(`**置信度**: ${(score * 100).toFixed(0)}%`);
    }

    // 是否需要人工审查
    const humanReview = result.requires_human_review;
    if (typeof humanReview === "boolean" && humanReview) {
        lines.push(`**需要人工审查**: 是`);
    }

    lines.push("");

    // 已验证声明
    const claims = result.verified_claims;
    if (Array.isArray(claims) && claims.length > 0) {
        lines.push("### 已验证声明\n");
        for (const claim of claims) {
            if (typeof claim === "string") {
                lines.push(`- ✅ ${claim}`);
            }
        }
        lines.push("");
    }

    // 问题列表
    const issues = result.issues;
    if (Array.isArray(issues) && issues.length > 0) {
        lines.push("### 发现的问题\n");
        for (const issue of issues) {
            if (typeof issue === "object" && issue !== null) {
                const i = issue as Record<string, unknown>;
                const verdict = i.verdict === "false" ? "❌"
                    : i.verdict === "suspect" ? "⚠️"
                    : "❓";
                lines.push(`- ${verdict} ${i.claim || ""}`);
                if (i.correction) {
                    lines.push(`  - **修正**: ${i.correction}`);
                }
                if (i.source) {
                    lines.push(`  - **来源**: ${i.source}`);
                }
                if (i.notes) {
                    lines.push(`  - ${i.notes}`);
                }
            }
        }
        lines.push("");
    }

    // 建议
    const recs = result.recommendations;
    if (Array.isArray(recs) && recs.length > 0) {
        lines.push("### 建议\n");
        for (const rec of recs) {
            if (typeof rec === "string") {
                lines.push(`- ${rec}`);
            }
        }
        lines.push("");
    }

    lines.push(`> 核查时间: ${now}\n`);

    return lines.join("\n");
}


// ============================================================================
// H-01: 编排器管线生命周期共享函数
// ============================================================================

/**
 * 生成管线 ID
 *
 * 5 个编排器完全相同的实现，统一提取。
 */
export function generatePipelineId(): string {
    return `pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 从 taskId 解析 pipelineId
 *
 * 优先从 taskToPipeline 映射查找，回退到 task.payload.pipelineId。
 * 如果找到但映射中不存在，自动补充映射。
 */
export function resolvePipelineIdFromTask(
    taskId: string,
    taskToPipeline: Map<string, string>,
    taskQueue: TaskQueue,
): string | undefined {
    const task = taskQueue.getTask(taskId);
    if (!task) return undefined;

    const pipelineId =
        taskToPipeline.get(taskId) ||
        (typeof (task.payload as Record<string, unknown>)?.pipelineId === "string"
            ? ((task.payload as Record<string, unknown>).pipelineId as string)
            : undefined);
    if (!pipelineId) return undefined;

    if (!taskToPipeline.has(taskId)) {
        taskToPipeline.set(taskId, pipelineId);
    }

    return pipelineId;
}


/** 管线事件发布回调类型 */
export type PublishEventFn = (event: {
    type: string;
    pipelineId: string;
    stage: string;
    context: PipelineContext;
    timestamp: string;
}) => void;

/**
 * 处理管线失败（统一 4 个编排器的 handleTaskFailed 核心逻辑）
 *
 * 设置 context.stage = "failed"，填充错误信息，发布事件，记录日志。
 */
export function markPipelineFailed(
    context: PipelineContext,
    errorCode: string,
    errorMessage: string,
    publishEvent: PublishEventFn,
    logger: ILogger,
    callerName: string,
    extra?: Record<string, unknown>,
): void {
    context.stage = "failed";
    context.error = { code: errorCode, message: errorMessage };
    context.updatedAt = formatCRTimestamp();

    publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt,
    });

    logger.error(callerName, `管线失败: ${context.pipelineId}`, undefined, {
        ...extra,
        error: context.error,
    });
}


/**
 * 标记管线完成（统一 completePipeline 核心逻辑）
 */
export function markPipelineCompleted(
    context: PipelineContext,
    publishEvent: PublishEventFn,
): void {
    context.stage = "completed";
    context.updatedAt = formatCRTimestamp();

    publishEvent({
        type: "pipeline_completed",
        pipelineId: context.pipelineId,
        stage: "completed",
        context,
        timestamp: context.updatedAt,
    });
}

/**
 * 追加验证报告到笔记末尾（统一 4 个编排器的实现）
 */
export async function appendVerificationReport(
    noteRepository: NoteRepository,
    filePath: string,
    result: Record<string, unknown>,
    logger: ILogger,
    callerName: string,
): Promise<void> {
    try {
        const currentContent = await noteRepository.readByPathIfExists(filePath);
        if (currentContent === null) {
            logger.warn(callerName, "文件不存在，无法追加报告", { filePath });
            return;
        }

        const report = buildVerificationReportMarkdown(result);
        const separator = currentContent.endsWith("\n") ? "\n" : "\n\n";
        const newContent = `${currentContent}${separator}${report}`;
        await noteRepository.writeAtomic(filePath, newContent);

        logger.info(callerName, `验证报告已追加: ${filePath}`);
    } catch (error) {
        logger.error(callerName, "追加验证报告失败", error as Error, { filePath });
    }
}


// ============================================================================
// R3: 编排器 DRY 共享函数（第三轮审计提取）
// ============================================================================

/**
 * 渲染内容为 Markdown（共享实现）
 *
 * 提取自 Create/Amend 两个编排器中 100% 相同的 renderContentToMarkdown。
 * DRY 原则：消除 2 处完全重复的渲染逻辑。
 */
export function renderContentToMarkdown(
    context: PipelineContext,
    standardName: string,
    contentRenderer: ContentRenderer,
    language: string,
): string {
    const title = language === "en"
        ? (context.standardizedData?.standardNames[context.type].english || standardName)
        : standardName;

    return contentRenderer.renderNoteMarkdown({
        title,
        type: context.type,
        content: context.generatedContent,
        language,
    });
}

/** startVerifyTask 所需的依赖接口（ISP：最小依赖） */
export interface StartVerifyTaskDeps {
    noteRepository: NoteRepository;
    taskQueue: TaskQueue;
    i18n: I18n;
}

/**
 * 启动 Verify 任务（共享实现）
 *
 * 提取自 Create/Amend/Merge/Verify 四个编排器中几乎相同的 startVerifyTask。
 * 修复行为漂移：Create 原先缺少 E320_TASK_CONFLICT i18n 处理，现已统一。
 *
 * @param context - 管线上下文
 * @param deps - 最小依赖（noteRepository + taskQueue + i18n）
 * @param publishEvent - 事件发布回调
 * @param taskToPipeline - taskId → pipelineId 映射
 * @param getProviderIdForTask - Provider 解析回调
 * @param maxRetryAttempts - 最大重试次数
 * @param logger - 日志实例
 * @param callerName - 调用方名称
 */
export async function startVerifyTask(
    context: PipelineContext,
    deps: StartVerifyTaskDeps,
    publishEvent: PublishEventFn,
    taskToPipeline: Map<string, string>,
    getProviderIdForTask: (taskType: TaskType) => string,
    maxRetryAttempts: number,
    logger: ILogger,
    callerName: string,
): Promise<Result<void>> {
    const filePath = context.filePath;
    if (!filePath) {
        return err("E310_INVALID_STATE", "缺少文件路径，无法执行 Verify");
    }

    const currentContent = await deps.noteRepository.readByPathIfExists(filePath);
    if (currentContent === null) {
        return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`, { filePath });
    }

    context.stage = "verifying";
    context.updatedAt = formatCRTimestamp();

    publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "verifying",
        context,
        timestamp: context.updatedAt,
    });

    logger.info(callerName, `启动 Verify 任务: ${context.pipelineId}`, {
        filePath,
    });

    try {
        const taskId = deps.taskQueue.enqueue(
            TaskFactory.create({
                nodeId: context.nodeId,
                taskType: "verify",
                maxAttempts: maxRetryAttempts,
                providerRef: getProviderIdForTask("verify"),
                payload: {
                    pipelineId: context.pipelineId,
                    filePath,
                    currentContent,
                    conceptType: context.type,
                    standardizedData: context.standardizedData,
                },
            }),
        );
        taskToPipeline.set(taskId, context.pipelineId);
        return ok(undefined);
    } catch (error) {
        // 需求 34.3：锁冲突时使用用户友好的 i18n 提示（统一所有编排器行为）
        if (error instanceof CognitiveRazorError && error.code === "E320_TASK_CONFLICT") {
            const msg = deps.i18n.t("workbench.notifications.conceptLocked");
            return err("E320_TASK_CONFLICT", msg);
        }
        return toErr(error, "E500_INTERNAL_ERROR", "Verify 任务创建失败");
    }
}

/**
 * 根据设置决定是否自动 Verify 或直接完成（共享实现）
 *
 * 提取自 Create/Amend/Merge 三个编排器中仅 logger 名称不同的实现。
 * DRY 原则：消除 3 处 ~22 行的重复逻辑。
 *
 * @param context - 管线上下文
 * @param deps - startVerifyTask 所需依赖
 * @param publishEvent - 事件发布回调
 * @param taskToPipeline - taskId → pipelineId 映射
 * @param validatePrereqs - 前置校验回调
 * @param getProviderIdForTask - Provider 解析回调
 * @param completePipeline - 管线完成回调
 * @param settings - 当前设置
 * @param logger - 日志实例
 * @param callerName - 调用方名称
 */
export async function maybeStartAutoVerifyOrComplete(
    context: PipelineContext,
    deps: StartVerifyTaskDeps,
    publishEvent: PublishEventFn,
    taskToPipeline: Map<string, string>,
    validatePrereqs: (taskType: TaskType, conceptType?: CRType) => Result<void>,
    getProviderIdForTask: (taskType: TaskType) => string,
    completePipeline: (ctx: PipelineContext) => void,
    settings: PluginSettings,
    logger: ILogger,
    callerName: string,
): Promise<void> {
    if (!settings.enableAutoVerify) {
        completePipeline(context);
        return;
    }

    const prereqResult = validatePrereqs("verify", context.type);
    if (!prereqResult.ok) {
        logger.warn(callerName, "Verify 前置校验失败，跳过自动校验并结束管线", {
            pipelineId: context.pipelineId,
            error: prereqResult.error,
        });
        completePipeline(context);
        return;
    }

    const startResult = await startVerifyTask(
        context, deps, publishEvent, taskToPipeline,
        getProviderIdForTask, settings.maxRetryAttempts, logger, callerName,
    );
    if (!startResult.ok) {
        logger.warn(callerName, "启动 Verify 失败，跳过自动校验并结束管线", {
            pipelineId: context.pipelineId,
            error: startResult.error,
        });
        completePipeline(context);
    }
}

// ============================================================================
// R5 轮次共享函数：消除编排器层微观重复
// ============================================================================

/**
 * 通用事件发布（DRY：消除 5 个编排器中完全相同的 publishEvent 方法）
 *
 * @param listeners - 事件监听器集合
 * @param event - 要发布的事件
 * @param logger - 日志实例
 * @param callerName - 调用方名称（用于日志）
 */
export function publishEvent<T>(
    listeners: Iterable<(event: T) => void>,
    event: T,
    logger: ILogger,
    callerName: string,
): void {
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            logger.error(callerName, "事件监听器执行失败", error as Error);
        }
    }
}

/**
 * 取消管线关联的所有任务（DRY：消除 4 个编排器中相同的取消逻辑）
 *
 * @param pipelineId - 管线 ID
 * @param taskToPipeline - 任务→管线映射
 * @param taskQueue - 任务队列
 * @param logger - 日志实例
 * @param callerName - 调用方名称
 */
export function cancelPipelineTasks(
    pipelineId: string,
    taskToPipeline: Map<string, string>,
    taskQueue: TaskQueue,
    logger: ILogger,
    callerName: string,
): void {
    for (const [taskId, pid] of taskToPipeline.entries()) {
        if (pid === pipelineId) {
            try {
                taskQueue.cancel(taskId);
            } catch (error) {
                logger.warn(callerName, `取消任务失败: ${taskId}`, {
                    pipelineId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            taskToPipeline.delete(taskId);
        }
    }
}

/**
 * 获取所有活跃管线（DRY：消除 5 个编排器中相同的过滤逻辑）
 *
 * @param pipelines - 管线 Map
 * @returns 未完成且未失败的管线列表
 */
export function getActivePipelinesFrom<T extends { stage: string }>(
    pipelines: Map<string, T>,
): T[] {
    return Array.from(pipelines.values()).filter(
        (ctx) => ctx.stage !== "completed" && ctx.stage !== "failed",
    );
}

/**
 * 持久化管线状态（DRY：消除 Amend/Merge 中相同的 savePipelineState 方法）
 *
 * @param orchestrator - 实现了 getActiveState 的编排器实例
 * @param pipelineStateStore - 管线状态存储
 * @param logger - 日志实例
 * @param callerName - 调用方名称
 */
export async function savePipelineState(
    orchestrator: {
        getActiveState(): {
            pipelines: Map<string, PipelineContext>;
            taskToPipeline: Map<string, string>;
        };
    },
    pipelineStateStore: {
        persistFromOrchestrators(orchestrators: {
            getActiveState(): {
                pipelines: Map<string, PipelineContext>;
                taskToPipeline: Map<string, string>;
            };
        }[]): Promise<unknown>;
    },
    logger: ILogger,
    callerName: string,
): Promise<void> {
    try {
        await pipelineStateStore.persistFromOrchestrators([orchestrator]);
    } catch (error) {
        logger.warn(callerName, "持久化管线状态失败", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * 处理锁冲突错误（DRY：消除 4 个编排器中相同的 E320_TASK_CONFLICT 处理模式）
 *
 * @param error - 捕获的错误
 * @param i18n - 国际化实例
 * @returns 如果是锁冲突则返回 i18n 消息，否则返回 null
 */
export function handleLockConflictError(
    error: unknown,
    i18n: I18n,
): string | null {
    if (error instanceof CognitiveRazorError && error.code === "E320_TASK_CONFLICT") {
        return i18n.t("workbench.notifications.conceptLocked");
    }
    return null;
}

// ============================================================================
// R6 轮次共享函数：消除编排器层深层重复
// ============================================================================

/**
 * 从 Frontmatter 构建嵌入文本（DRY：消除 Amend/Merge 中完全相同的实现）
 *
 * @param frontmatter - 笔记 frontmatter
 * @returns 用于 embedding 的文本
 */
export function buildEmbeddingText(frontmatter: CRFrontmatter): string {
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

/** refreshEmbeddingAndDuplicates 所需的最小依赖接口（ISP） */
export interface RefreshEmbeddingDeps {
    vectorIndex: Pick<VectorIndex, "getEmbeddingModel" | "getEmbeddingDimension" | "delete" | "upsert">;
    providerManager: Pick<ProviderManager, "embed">;
    duplicateManager: Pick<DuplicateManager, "clearPendingPairsByNodeId" | "detect">;
}

/**
 * 重算 Embedding 并触发去重检测（DRY：消除 Amend/Merge 中 ~80 行完全相同的实现）
 *
 * @param context - 管线上下文（会更新 embedding 和 updatedAt）
 * @param embeddingText - 用于 embedding 的文本
 * @param providerId - Provider ID
 * @param deps - 最小依赖
 * @param logger - 日志实例
 * @param callerName - 调用方名称
 */
export async function refreshEmbeddingAndDuplicates(
    context: PipelineContext,
    embeddingText: string,
    providerId: string,
    deps: RefreshEmbeddingDeps,
    logger: ILogger,
    callerName: string,
): Promise<void> {
    const embeddingModel = deps.vectorIndex.getEmbeddingModel();
    const embeddingDimension = deps.vectorIndex.getEmbeddingDimension();

    const embedResult = await deps.providerManager.embed({
        providerId,
        model: embeddingModel,
        input: embeddingText,
        dimensions: embeddingDimension,
    });

    if (!embedResult.ok) {
        logger.warn(callerName, "Embedding 重算失败，已移除旧向量避免陈旧结果", {
            pipelineId: context.pipelineId,
            nodeId: context.nodeId,
            error: embedResult.error,
        });

        // 移除旧向量
        const deleteResult = await deps.vectorIndex.delete(context.nodeId);
        if (!deleteResult.ok && deleteResult.error.code !== "E311_NOT_FOUND") {
            logger.warn(callerName, "移除旧向量失败", {
                pipelineId: context.pipelineId,
                nodeId: context.nodeId,
                error: deleteResult.error,
            });
        }

        // 清理旧重复对
        const clearResult = await deps.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
        if (!clearResult.ok) {
            logger.warn(callerName, "清理旧重复对失败", {
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
    const clearResult = await deps.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
    if (!clearResult.ok) {
        logger.warn(callerName, "清理旧重复对失败", {
            pipelineId: context.pipelineId,
            nodeId: context.nodeId,
            error: clearResult.error,
        });
    }

    // 更新向量索引
    const upsertResult = await deps.vectorIndex.upsert({
        uid: context.nodeId,
        type: context.type,
        embedding: context.embedding,
        updated: context.updatedAt,
    });
    if (!upsertResult.ok) {
        logger.warn(callerName, "更新向量索引失败", {
            pipelineId: context.pipelineId,
            nodeId: context.nodeId,
            error: upsertResult.error,
        });
    }

    // 去重检测
    const detectResult = await deps.duplicateManager.detect(context.nodeId, context.type, context.embedding);
    if (!detectResult.ok) {
        logger.warn(callerName, "去重检测失败", {
            pipelineId: context.pipelineId,
            nodeId: context.nodeId,
            error: detectResult.error,
        });
    }
}

/**
 * 获取活跃管线状态快照（DRY：消除 4 个编排器中完全相同的 getActiveState 实现）
 *
 * @param pipelines - 管线 Map
 * @param taskToPipeline - 任务→管线映射
 * @returns 仅包含活跃管线的快照
 */
export function getActiveState(
    pipelines: Map<string, PipelineContext>,
    taskToPipeline: Map<string, string>,
): { pipelines: Map<string, PipelineContext>; taskToPipeline: Map<string, string> } {
    const activePipelines = new Map<string, PipelineContext>();
    for (const [id, ctx] of pipelines) {
        if (ctx.stage !== "completed" && ctx.stage !== "failed") {
            activePipelines.set(id, ctx);
        }
    }
    const activeTaskMap = new Map<string, string>();
    for (const [taskId, pipelineId] of taskToPipeline) {
        if (activePipelines.has(pipelineId)) {
            activeTaskMap.set(taskId, pipelineId);
        }
    }
    return { pipelines: activePipelines, taskToPipeline: activeTaskMap };
}

/**
 * 恢复持久化的管线状态（DRY：消除 4 个编排器中结构相同的 restorePipelines 实现）
 *
 * @param kind - 管线类型过滤（"create" | "amend" | "merge" | "verify"）
 * @param targetPipelines - 目标管线 Map（编排器的 this.pipelines）
 * @param targetTaskMap - 目标任务映射（编排器的 this.taskToPipeline）
 * @param pipelines - 来源管线 Map
 * @param taskToPipeline - 来源任务映射
 */
export function restorePipelinesForKind(
    kind: string,
    targetPipelines: Map<string, PipelineContext>,
    targetTaskMap: Map<string, string>,
    pipelines: Map<string, PipelineContext>,
    taskToPipeline: Map<string, string>,
): void {
    for (const [id, ctx] of pipelines) {
        if (ctx.kind === kind) {
            targetPipelines.set(id, ctx);
        }
    }
    for (const [taskId, pipelineId] of taskToPipeline) {
        if (targetPipelines.has(pipelineId)) {
            targetTaskMap.set(taskId, pipelineId);
        }
    }
}
