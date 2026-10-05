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
    it('uses actual resolved values and distinguishes inherited, legacy and modern sources', () => {
        const settings = fixture();
        settings.taskModels.write = { providerId: '', model: '', temperature: 0.2, parameters: { temperature: 0 } };
        let summary = describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write'));
        expect(summary).toMatchObject({ value: 0, configuredValue: 0, source: 'task', omitted: false });
        delete settings.taskModels.write.parameters;
        summary = describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write'));
        expect(summary).toMatchObject({ value: 0.2, source: 'task' });
        delete settings.taskModels.write.temperature;
        summary = describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write'));
        expect(summary).toMatchObject({ value: 0.7, source: 'provider' });
    });

    it('shows explicitly omitted parameters as omitted even with provider and legacy values', () => {
        const settings = fixture();
        settings.taskModels.write = { providerId: '', model: '', maxTokens: 100, parameters: { maxTokens: null } };
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
        settings.taskModels.write.parameters = { thinkingLevel: 'HIGH', thinkingBudget: 1024, reasoning_effort: null };
        expect(describeTaskParameter('thinkingLevel', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ protocolIssue: 'thinkingConflict' });
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

    it('respects explicit task capabilities and the provider legacy web search declaration', () => {
        const settings = fixture();
        settings.providers.research.enableWebSearch = true;
        expect(taskCapabilitySource('nativeWebSearch', settings.taskModels.write, settings.providers.research)).toBe('provider');
        settings.taskModels.write.capabilities = { nativeWebSearch: false };
        expect(taskCapabilitySource('nativeWebSearch', settings.taskModels.write, settings.providers.research)).toBe('task');
        expect(taskCapabilitySource('responseContinuation', settings.taskModels.write, settings.providers.research)).toBe('none');
    });

    it('treats undefined modern override as inheritance without hiding legacy values', () => {
        const settings = fixture();
        settings.taskModels.write = { providerId: '', model: '', temperature: 0.3, parameters: { temperature: undefined } };
        expect(taskParameterInputs('temperature', settings.taskModels.write, settings.providers.research)).toMatchObject({ hasOverride: false, legacy: 0.3 });
        expect(describeTaskParameter('temperature', settings.taskModels.write, resolveTaskModelSnapshot(settings, 'write')))
            .toMatchObject({ value: 0.3, source: 'task' });
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
