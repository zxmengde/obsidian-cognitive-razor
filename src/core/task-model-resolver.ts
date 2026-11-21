import type { PluginSettings, ResolvedTaskConfig, TaskType, ModelParameters } from "../types";
import { DEFAULT_MODEL_CAPABILITIES } from "../types";
import { suppressChatSampling } from "./provider-request-builders";

export function resolveTaskModelSnapshot(settings: PluginSettings, taskType: TaskType, providerRef?: string): ResolvedTaskConfig {
  const task = settings.taskModels[taskType];
  const providerId = providerRef || task.providerId || settings.defaultProviderId;
  const provider = settings.providers[providerId];
  const capabilities = {
    ...DEFAULT_MODEL_CAPABILITIES,
    ...provider?.capabilities,
    ...task.capabilities,
  };
  // 响应 ID 续接只用于 Responses；提示词缓存支持 Responses 与 Anthropic Messages。
  if (provider && provider.apiFormat !== "openai-responses") {
    if (provider.apiFormat !== "anthropic-messages") {
      capabilities.promptCaching = false;
    }
    capabilities.responseContinuation = false;
  }
  const parameters: ModelParameters = { ...(provider?.parameters ?? {}) };
  // 任务参数用 undefined 继承、具体值覆盖、null 明确省略。
  for (const [key, value] of Object.entries(task.parameters ?? {})) {
    if (value === null) delete parameters[key as keyof ModelParameters];
    else if (value !== undefined) Object.assign(parameters, { [key]: value });
  }
  const model = task.model.trim() || (taskType === "index" ? provider?.defaultEmbedModel : provider?.defaultChatModel)?.trim() || "";
  const reasoningEffort = capabilities.reasoning ? parameters.reasoning_effort : undefined;
  const thinkingBudget = provider?.apiFormat === "gemini-generative-language" ? undefined : (capabilities.reasoning ? parameters.thinkingBudget : undefined);
  const samplingSuppressed = taskType !== "index" && suppressChatSampling(provider?.apiFormat, model, reasoningEffort, thinkingBudget);
  return {
    providerId,
    providerSnapshot: provider ? JSON.parse(JSON.stringify(provider)) : undefined,
    model,
    capabilities,
    configuredSampling: { temperature: parameters.temperature, topP: parameters.topP },
    temperature: capabilities.temperature && !samplingSuppressed ? parameters.temperature : undefined,
    topP: capabilities.topP && !samplingSuppressed ? parameters.topP : undefined,
    reasoningEffort,
    // Gemini 用 thinkingLevel 控制思考，不受 reasoning 开关限制。思考预算留在设置里，不进入请求。
    thinkingLevel: provider?.apiFormat === "gemini-generative-language" || capabilities.reasoning ? parameters.thinkingLevel : undefined,
    thinkingBudget,
    maxTokens: parameters.maxTokens,
    embeddingDimension: taskType === "index" ? parameters.embeddingDimension : undefined,
  };
}
