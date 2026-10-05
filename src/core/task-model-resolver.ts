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
    // enableWebSearch is retained as a legacy provider declaration. An
    // explicit capabilities.nativeWebSearch value always wins over it.
    ...(provider?.capabilities?.nativeWebSearch === undefined && provider?.enableWebSearch !== undefined
      ? { nativeWebSearch: provider.enableWebSearch }
      : {}),
    ...task.capabilities,
  };
  const parameters: ModelParameters = { ...(provider?.parameters ?? {}) };
  // Legacy task fields remain valid input and mean "specified value".
  for (const key of ["temperature", "topP", "reasoning_effort", "maxTokens", "embeddingDimension"] as const) {
    const value = task[key];
    if (value !== undefined) Object.assign(parameters, { [key]: value });
  }
  // New overrides provide all three states: undefined/inherit, value/set,
  // null/explicitly omit.
  for (const [key, value] of Object.entries(task.parameters ?? {})) {
    if (value === null) delete parameters[key as keyof ModelParameters];
    else if (value !== undefined) Object.assign(parameters, { [key]: value });
  }
  const model = task.model.trim() || (taskType === "index" ? provider?.defaultEmbedModel : provider?.defaultChatModel)?.trim() || "";
  const reasoningEffort = capabilities.reasoning ? parameters.reasoning_effort : undefined;
  const samplingSuppressed = taskType !== "index" && suppressChatSampling(provider?.apiFormat, model, reasoningEffort);
  return {
    providerId,
    providerSnapshot: provider ? JSON.parse(JSON.stringify(provider)) : undefined,
    model,
    capabilities,
    configuredSampling: { temperature: parameters.temperature, topP: parameters.topP },
    temperature: capabilities.temperature && !samplingSuppressed ? parameters.temperature : undefined,
    topP: capabilities.topP && !samplingSuppressed ? parameters.topP : undefined,
    reasoningEffort,
    thinkingLevel: capabilities.reasoning ? parameters.thinkingLevel : undefined,
    thinkingBudget: capabilities.reasoning ? parameters.thinkingBudget : undefined,
    maxTokens: parameters.maxTokens,
    embeddingDimension: taskType === "index" ? parameters.embeddingDimension : undefined,
  };
}
