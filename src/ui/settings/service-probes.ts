import type { SettingsApplication } from "../../app/settings-application";
import type { ProviderProbeAttemptReason, ProviderProbeRequest } from "../../core/model-gateway";
import { resolveTaskModelSnapshot } from "../../core/task-model-resolver";
import type { ProviderConfig, TaskType } from "../../types";
import { toProviderProbeReadModel, type ProviderProbeReadModel } from "../provider-probe-result";

/** 可按服务临时测试参数的聊天任务；嵌入任务只在任务页按实际配置测试。 */
export const TEMPORARY_PROBE_TASKS = ["define", "tag", "write", "verify"] as const;
export type TemporaryProbeTask = typeof TEMPORARY_PROBE_TASKS[number];

async function probe(
  settingsApplication: SettingsApplication,
  request: ProviderProbeRequest,
  config: ProviderConfig,
  signal?: AbortSignal,
  temporaryProvider = false,
): Promise<ProviderProbeReadModel | undefined> {
  const result = await settingsApplication.testProvider(request, signal);
  if (signal?.aborted) return undefined;
  return toProviderProbeReadModel(result, config, {
    scope: request.taskType ?? "connection",
    ...(temporaryProvider ? { temporaryProvider: true } : {}),
    providerId: request.providerId,
    model: request.taskConfig?.model ?? config.defaultChatModel,
    ...(request.taskType === "index" && request.taskConfig?.embeddingDimension !== undefined
      ? { requestedDimensions: request.taskConfig.embeddingDimension } : {}),
  });
}

/** 测试已保存服务的聊天与嵌入接口。结果绑定发起时的配置副本，请求途中修改设置不影响解释。 */
export function probeService(
  settingsApplication: SettingsApplication,
  id: string,
  attemptReason: ProviderProbeAttemptReason,
  signal?: AbortSignal,
): Promise<ProviderProbeReadModel | undefined> {
  const current = settingsApplication.getSettings().providers[id];
  if (!current) return Promise.resolve(undefined);
  const config = { ...current };
  return probe(settingsApplication, { providerId: id, configOverride: config, attemptReason }, config, signal);
}

/** 强制使用此服务、按所选任务的参数测试；不改变保存的任务配置。 */
export function probeServiceWithTask(
  settingsApplication: SettingsApplication,
  id: string,
  taskType: Exclude<TaskType, "index">,
  attemptReason: ProviderProbeAttemptReason,
  signal?: AbortSignal,
): Promise<ProviderProbeReadModel | undefined> {
  const settings = settingsApplication.getSettings();
  const current = settings.providers[id];
  if (!current) return Promise.resolve(undefined);
  // 与真实任务执行使用同一解析器；保留任务覆盖，只强制目标服务。
  const snapshot = resolveTaskModelSnapshot(settings, taskType, id);
  return probe(settingsApplication, {
    providerId: snapshot.providerId,
    configOverride: snapshot.providerSnapshot,
    taskType,
    attemptReason,
    taskConfig: snapshot,
  }, snapshot.providerSnapshot ?? { ...current }, signal, true);
}

/** 服务编辑框内测试尚未保存的草稿配置。 */
export function probeDraft(
  settingsApplication: SettingsApplication,
  request: ProviderProbeRequest,
  signal?: AbortSignal,
): Promise<ProviderProbeReadModel | undefined> {
  const config = request.configOverride;
  if (!config) return Promise.resolve(undefined);
  return probe(settingsApplication, request, config, signal);
}
