/** Shared prerequisite validation for workflow entry points. */

import type { ILogger, PluginSettings, Result, TaskType } from "../types";
import { err } from "../types";
import type { PromptManager } from "./prompt-manager";
import { resolveAvailableProvider } from "./provider-config";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

export function validatePrerequisites(
    settings: PluginSettings,
    taskType: TaskType,
    promptManager: PromptManager,
    logger: ILogger,
    callerName: string,
): Result<void> {
    const providerId = resolveTaskModelSnapshot(settings, taskType).providerId;
    const providerResult = resolveAvailableProvider(settings, providerId);
    if (!providerResult.ok) {
        logger.error(callerName, "Provider 不可用", undefined, {
            taskType,
            providerId,
            errorCode: providerResult.error.code,
            event: "PREREQUISITE_CHECK_FAILED",
        });
        return providerResult;
    }

    if (taskType !== "write" && taskType !== "index") {
        const templateId = promptManager.resolveTemplateId(taskType);
        if (!promptManager.hasTemplate(templateId)) {
            logger.error(callerName, "模板未加载", undefined, {
                taskType,
                templateId,
                event: "PREREQUISITE_CHECK_FAILED",
            });
            return err("E404_TEMPLATE_NOT_FOUND", `模板 "${templateId}" 未加载，请检查 prompts 目录`);
        }
    }

    logger.debug(callerName, "前置校验通过", {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_PASSED",
    });
    return { ok: true, value: undefined };
}
