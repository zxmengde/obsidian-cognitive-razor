import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings-store';
import { resolveTaskModelSnapshot } from '../core/task-model-resolver';
import { describeTaskParameter, taskCapabilitySource, taskParameterInputs } from './task-parameter-summary';

function fixture() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.research = {
        apiKey: '', enabled: true, apiFormat: 'openai-responses', embeddingApiFormat: 'openai-embeddings',
        defaultChatModel: 'chat', defaultEmbedModel: 'embed', capabilities: { temperature: true, reasoning: true },
        parameters: { temperature: 0.7, topP: 0.9, maxTokens: 4096 },
    };
    settings.defaultProviderId = 'research';
    return settings;
}

describe('task parameter presentation', () => {
    it('shows Gemini 4 sampling as saved but unsent', () => {
        const settings = fixture();
        settings.providers.research.apiFormat = 'gemini-generative-language';
        settings.providers.research.defaultChatModel = 'gemini-4-argon';
        expect(describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: undefined, configuredValue: 0.7, samplingSuppressed: true });
    });

    it('distinguishes task overrides from inherited provider values', () => {
        const settings = fixture();
        settings.taskModels.write = { providerId: '', model: '', parameters: { temperature: 0 } };
        let summary = describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write'));
        expect(summary).toMatchObject({ value: 0, configuredValue: 0, source: 'task', omitted: false });
        settings.taskModels.write.parameters = { temperature: 0.2 };
        summary = describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write'));
        expect(summary).toMatchObject({ value: 0.2, source: 'task' });
        delete settings.taskModels.write.parameters;
        summary = describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write'));
        expect(summary).toMatchObject({ value: 0.7, source: 'provider' });
    });

    it('shows explicitly omitted parameters even when the provider has a value', () => {
        const settings = fixture();
        settings.taskModels.write = { providerId: '', model: '', parameters: { maxTokens: null } };
        expect(describeTaskParameter('maxTokens', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: undefined, configuredValue: undefined, source: 'task', omitted: true });
    });

    it('retains unsupported saved values without claiming they are sent', () => {
        const settings = fixture();
        settings.taskModels.write.parameters = { topP: 0.5 };
        const before = structuredClone(settings);
        expect(describeTaskParameter('topP', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: undefined, configuredValue: 0.5, source: 'task', unsupported: true });
        expect(settings).toEqual(before);
        settings.taskModels.write.capabilities = { topP: true };
        expect(describeTaskParameter('topP', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: 0.5, unsupported: false });
    });

    it('does not label protocol-rejected reasoning as silently omitted', () => {
        const settings = fixture();
        settings.taskModels.write.parameters = { thinkingLevel: 'HIGH' };
        expect(describeTaskParameter('thinkingLevel', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: 'HIGH', unsupported: false, protocolIssue: 'geminiOnly' });
        settings.providers.research.apiFormat = 'gemini-generative-language';
        settings.providers.research.capabilities = { temperature: true, reasoning: false };
        settings.taskModels.write.parameters = { thinkingLevel: 'HIGH', thinkingBudget: 1024, reasoning_effort: null };
        expect(describeTaskParameter('thinkingLevel', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: 'HIGH', unsupported: false, protocolIssue: undefined });
        expect(describeTaskParameter('thinkingBudget', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: undefined, configuredValue: 1024 });
        settings.providers.research.capabilities = { temperature: true, reasoning: true };
        settings.taskModels.write.parameters.reasoning_effort = 'medium';
        expect(describeTaskParameter('reasoning_effort', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ protocolIssue: 'effortNotGemini' });
    });

    it('does not invent embedding values and shows actual inherited Cards parameters', () => {
        const settings = fixture();
        expect(describeTaskParameter('embeddingDimension', settings.taskModels.index, resolveTaskModelSnapshot(settings, 'index')))
            .toMatchObject({ value: undefined, configuredValue: undefined, source: 'none' });
        const cards = resolveTaskModelSnapshot(settings, 'cards');
        expect(cards).toMatchObject({ providerId: 'research', model: 'chat' });
        expect(describeTaskParameter('temperature', settings.taskModels.cards, cards)).toMatchObject({ value: 0.7, source: 'provider' });
    });

    it('respects explicit task and provider capabilities', () => {
        const settings = fixture();
        settings.providers.research.capabilities!.nativeWebSearch = true;
        expect(taskCapabilitySource('nativeWebSearch', settings.taskModels.write, settings.providers.research)).toBe('provider');
        settings.taskModels.write.capabilities = { nativeWebSearch: false };
        expect(taskCapabilitySource('nativeWebSearch', settings.taskModels.write, settings.providers.research)).toBe('task');
        expect(taskCapabilitySource('responseContinuation', settings.taskModels.write, settings.providers.research)).toBe('none');
    });

    it('treats an undefined override as inheritance', () => {
        const settings = fixture();
        settings.taskModels.write = { providerId: '', model: '', parameters: { temperature: undefined } };
        expect(taskParameterInputs('temperature', settings.taskModels.write, settings.providers.research)).toMatchObject({ hasOverride: false });
        expect(describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: 0.7, source: 'provider' });
    });
});


it.each([undefined, 'high'])("shows retained sampling and actual omission for exact 6.1 effort %s", (effort) => {
  const settings = fixture();
  settings.providers.research.defaultChatModel = 'gpt-6.1-sol';
  settings.providers.research.capabilities!.topP = true;
  settings.providers.research.parameters!.reasoning_effort = effort;
  const before = structuredClone(settings);
  const resolved = resolveTaskModelSnapshot(settings, 'write');
  expect(describeTaskParameter('temperature', settings.taskModels.write, resolved))
    .toMatchObject({ value: undefined, configuredValue: 0.7, source: 'provider', samplingSuppressed: true });
  expect(describeTaskParameter('topP', settings.taskModels.write, resolved))
    .toMatchObject({ value: undefined, configuredValue: 0.9, samplingSuppressed: true });
  expect(settings).toEqual(before);
  settings.providers.research.defaultChatModel = 'custom-alias';
  delete settings.providers.research.parameters!.reasoning_effort;
  expect(describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
    .toMatchObject({ value: 0.7, samplingSuppressed: false });
});

it.each(['none', 'minimal'])("shows the same pre-dispatch unsupported effort %s as the runtime", (effort) => {
    const settings = fixture();
    settings.providers.research.defaultChatModel = 'gpt-6.1-sol';
    settings.providers.research.parameters!.reasoning_effort = effort;
    expect(describeTaskParameter('reasoning_effort', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
        .toMatchObject({ value: effort, protocolIssue: 'unsupportedEffort', omitted: false });
    settings.providers.research.defaultChatModel = 'custom-alias';
    expect(describeTaskParameter('reasoning_effort', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')).protocolIssue).toBeUndefined();
});
