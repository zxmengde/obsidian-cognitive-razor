import type { PluginSettings, TaskType } from '../types';
import { resolveTaskModelSnapshot } from '../core/task-model-resolver';

/** Read-only projection of the runtime resolver; never migrates stored values. */
export function taskSettingsSummary(settings: PluginSettings, taskType: TaskType) {
    const resolved = resolveTaskModelSnapshot(settings, taskType);
    const task = settings.taskModels[taskType];
    const provider = resolved.providerSnapshot;
    const customized = Boolean(task.providerId || task.model.trim()
        || Object.values(task.parameters ?? {}).some(value => value !== undefined)
        || Object.values(task.capabilities ?? {}).some(value => value !== undefined)
        || [task.temperature, task.topP, task.reasoning_effort, task.maxTokens, task.embeddingDimension].some(value => value !== undefined));
    const source = taskType === 'cards' ? 'independent' : customized ? 'customized' : 'inherited';
    const issue = !resolved.providerId || !provider || !resolved.model
        ? 'unconfigured'
        : !provider.enabled ? 'disabled'
        : (taskType === 'index' ? provider.embeddingApiFormat === 'disabled' : provider.apiFormat === 'disabled')
            ? 'protocolDisabled' : undefined;
    return { resolved, source, issue };
}
