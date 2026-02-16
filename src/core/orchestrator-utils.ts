/**
 * Orchestrator 共享工具函数
 *
 * 提取自 Create/Amend/Merge/Verify 四个编排器中重复的
 * validatePrerequisites 和 getProviderIdForTask 逻辑。
 *
 * DRY 原则：消除 4 处 ~90% 相同的前置校验代码。
 */

import type { ILogger, TaskType, CRType, PluginSettings, Result } from "../types";
import { ok, err } from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import type { PromptManager } from "./prompt-manager";

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
