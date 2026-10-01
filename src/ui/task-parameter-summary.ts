import type { ModelCapabilities, ModelParameters, ProviderConfig, ResolvedTaskConfig, TaskModelConfig } from '../types';
import type { TaskParameterInputs } from './task-model-parameters';

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
    protocolIssue?: 'geminiOnly' | 'effortNotGemini' | 'thinkingConflict';
}

export function taskParameterInputs(
    key: TaskParameterKey,
    config: TaskModelConfig,
    provider?: ProviderConfig,
): TaskParameterInputs {
    return {
        // Undefined modern overrides inherit, just as the runtime resolver does.
        hasOverride: config.parameters?.[key] !== undefined,
        override: config.parameters?.[key],
        legacy: key in config ? config[key as keyof TaskModelConfig] : undefined,
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
    const hasTaskValue = (input.hasOverride && input.override !== null) || input.legacy !== undefined;
    const configuredValue = omitted ? undefined : input.override ?? input.legacy ?? input.provider;
    const value = resolved[SNAPSHOT_KEYS[key]];
    const capability = key === 'temperature' || key === 'topP' ? key
        : key === 'reasoning_effort' || key === 'thinkingLevel' || key === 'thinkingBudget' ? 'reasoning' : undefined;
    const unsupported = capability !== undefined && !resolved.capabilities[capability];
    const format = resolved.providerSnapshot?.apiFormat;
    let protocolIssue: TaskParameterSummary['protocolIssue'];
    if (value !== undefined && format) {
        if ((key === 'thinkingLevel' || key === 'thinkingBudget') && format !== 'gemini-generative-language') protocolIssue = 'geminiOnly';
        else if (key === 'reasoning_effort' && format === 'gemini-generative-language') protocolIssue = 'effortNotGemini';
        else if ((key === 'thinkingLevel' || key === 'thinkingBudget') && resolved.thinkingLevel !== undefined && resolved.thinkingBudget !== undefined) protocolIssue = 'thinkingConflict';
    }
    return {
        value, configuredValue, omitted, unsupported, protocolIssue,
        source: omitted || hasTaskValue ? 'task' : input.provider !== undefined ? 'provider' : 'none',
    };
}

export function taskCapabilitySource(
    key: keyof ModelCapabilities,
    config: TaskModelConfig,
    provider?: ProviderConfig,
): ParameterSource {
    if (config.capabilities?.[key] !== undefined) return 'task';
    if (provider?.capabilities?.[key] !== undefined || (key === 'nativeWebSearch' && provider?.enableWebSearch !== undefined)) return 'provider';
    return 'none';
}
