import type { ModelCapabilities, ModelParameters, ProviderConfig, ResolvedTaskConfig, TaskModelConfig } from '../types';
import type { TaskParameterInputs } from './task-model-parameters';
import { suppressChatSampling, unsupportedOpenAIReasoningEffort } from '../core/provider-request-builders';

export type TaskParameterKey = keyof ModelParameters;
export type ParameterSource = 'task' | 'provider' | 'none';

const SNAPSHOT_KEYS = {
    temperature: 'temperature', topP: 'topP', reasoning_effort: 'reasoningEffort',
    thinkingLevel: 'thinkingLevel', thinkingBudget: 'thinkingBudget',
    maxTokens: 'maxTokens', embeddingDimension: 'embeddingDimension',
} as const;

/** Read-only presentation of the actual resolver result, never a second resolver. */
export interface TaskParameterSummary {
    value: number | string | undefined;
    configuredValue: unknown;
    source: ParameterSource;
    omitted: boolean;
    unsupported: boolean;
    samplingSuppressed: boolean;
    protocolIssue?: 'geminiOnly' | 'effortNotGemini' | 'thinkingConflict' | 'unsupportedEffort';
}

export function taskParameterInputs(
    key: TaskParameterKey,
    config: TaskModelConfig,
    provider?: ProviderConfig,
): TaskParameterInputs {
    return {
        // undefined 与运行时一致，表示继承服务参数。
        hasOverride: config.parameters?.[key] !== undefined,
        override: config.parameters?.[key],
        provider: provider?.parameters?.[key],
    };
}

export function describeTaskParameter(
    key: TaskParameterKey,
    config: TaskModelConfig,
    resolved: ResolvedTaskConfig,
): TaskParameterSummary {
    const input = taskParameterInputs(key, config, resolved.providerSnapshot);
    const omitted = input.hasOverride && input.override === null;
    const hasTaskValue = input.hasOverride && input.override !== null;
    const configuredValue = omitted ? undefined : input.override ?? input.provider;
    const value = resolved[SNAPSHOT_KEYS[key]];
    const format = resolved.providerSnapshot?.apiFormat;
    const capability = key === 'temperature' || key === 'topP' ? key
        : key === 'thinkingLevel' && format === 'gemini-generative-language' ? undefined
        : key === 'reasoning_effort' || key === 'thinkingLevel' || key === 'thinkingBudget' ? 'reasoning' : undefined;
    const unsupported = capability !== undefined && !resolved.capabilities[capability];
    const samplingSuppressed = (key === 'temperature' || key === 'topP') && configuredValue !== undefined && !omitted
        && suppressChatSampling(format, resolved.model, resolved.reasoningEffort);
    let protocolIssue: TaskParameterSummary['protocolIssue'];
    if (value !== undefined && format) {
        if (key === 'reasoning_effort' && unsupportedOpenAIReasoningEffort(format, resolved.model, resolved.reasoningEffort)) protocolIssue = 'unsupportedEffort';
        else if ((key === 'thinkingLevel' || key === 'thinkingBudget') && format !== 'gemini-generative-language') protocolIssue = 'geminiOnly';
        else if (key === 'reasoning_effort' && format === 'gemini-generative-language') protocolIssue = 'effortNotGemini';
        else if ((key === 'thinkingLevel' || key === 'thinkingBudget') && resolved.thinkingLevel !== undefined && resolved.thinkingBudget !== undefined) protocolIssue = 'thinkingConflict';
    }
    return {
        value, configuredValue, omitted, unsupported, samplingSuppressed, protocolIssue,
        source: omitted || hasTaskValue ? 'task' : input.provider !== undefined ? 'provider' : 'none',
    };
}

export function taskCapabilitySource(
    key: keyof ModelCapabilities,
    config: TaskModelConfig,
    provider?: ProviderConfig,
): ParameterSource {
    if (config.capabilities?.[key] !== undefined) return 'task';
    if (provider?.capabilities?.[key] !== undefined) return 'provider';
    return 'none';
}
