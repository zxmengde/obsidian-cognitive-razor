import { Plugin } from "obsidian";
import { err, ok } from "../types";
import type { ILogger, PluginSettings, ProviderConfig, Result, TaskModelConfig, TaskType } from "../types";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TASK_MODEL_CONFIGS,
  TASK_TYPES,
  cloneSettings,
  isRecord,
  isValidProviderId,
  mergeSettings,
  mergeTaskOverrides,
  normalizeSettings,
  settingsEqual,
} from "./settings-codec";
import type { SettingsUpdate } from "./settings-codec";

export { DEFAULT_SETTINGS, DEFAULT_TASK_TIMEOUT_MS, TASK_TYPES, isValidProviderId } from "./settings-codec";
export type { SettingsUpdate } from "./settings-codec";

export class SettingsStore {
  private settings = cloneSettings(DEFAULT_SETTINGS);
  private readonly listeners = new Set<(settings: PluginSettings) => void>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private logger?: ILogger;
  private pendingListenerErrors: Error[] = [];

  constructor(private readonly plugin: Plugin, logger?: ILogger) {
    this.logger = logger;
  }

  setLogger(logger: ILogger): void {
    this.logger = logger;
    const pending = this.pendingListenerErrors.splice(0);
    for (const error of pending) {
      this.logListenerError(error);
    }
  }

  async loadSettings(): Promise<Result<void>> {
    return this.enqueueMutation(async () => {
      try {
        const raw = await this.plugin.loadData();
        // Obsidian yields null when data.json is absent. undefined means the
        // existing file was unreadable or not valid JSON; keep memory intact.
        if (raw === null) {
          this.settings = cloneSettings(DEFAULT_SETTINGS);
          this.notifyListeners();
          return ok(undefined);
        }
        if (raw === undefined) {
          return err(
            "E101_INVALID_INPUT",
            "设置文件暂时无法读取或不是有效 JSON；已保留当前内存中的配置，未覆盖磁盘",
          );
        }

        const normalized = normalizeSettings(raw);
        if (!normalized.ok) {
          // Do not replace a good in-memory snapshot with defaults; a later
          // unrelated save would otherwise wipe providers and API keys on disk.
          return normalized;
        }

        this.settings = normalized.value;
        this.notifyListeners();
        return ok(undefined);
      } catch (error) {
        return err("E500_INTERNAL_ERROR", "读取设置失败", error);
      }
    });
  }

  getSettings(): PluginSettings {
    return cloneSettings(this.settings);
  }

  async updateSettings(partial: SettingsUpdate): Promise<Result<void>> {
    if (!isRecord(partial)) {
      return err("E101_INVALID_INPUT", "设置更新必须是对象");
    }

    return this.enqueueMutation(() => this.updateSettingsInQueue(partial));
  }

  exportSettings(): string {
    const exported = cloneSettings(this.settings);
    for (const provider of Object.values(exported.providers)) {
      provider.apiKey = "";
    }
    return JSON.stringify(exported, null, 2);
  }

  async importSettings(json: string): Promise<Result<void>> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return err("E101_INVALID_INPUT", "导入内容不是有效 JSON");
    }

    return this.enqueueMutation(async () => {
      const normalized = normalizeSettings(parsed);
      if (!normalized.ok) {
        return normalized;
      }
      return this.persist(normalized.value);
    });
  }

  async resetToDefaults(): Promise<Result<void>> {
    return this.enqueueMutation(() => this.persist(cloneSettings(DEFAULT_SETTINGS)));
  }

  subscribe(listener: (settings: PluginSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async resetTaskModel(taskType: TaskType): Promise<Result<void>> {
    return this.updateSettings({
      taskModels: {
        [taskType]: { ...DEFAULT_TASK_MODEL_CONFIGS[taskType] },
      } as PluginSettings["taskModels"],
    });
  }

  async updateTaskModel(taskType: TaskType, updates: Partial<TaskModelConfig>): Promise<Result<void>> {
    return this.enqueueMutation(() => {
      const current = this.settings.taskModels[taskType];
      const next = { ...current, ...updates };
      // UI edits carry only the changed leaf. Merge after previous saves have
      // finished; undefined removes that override so the Provider is inherited.
      if (isRecord(updates.parameters)) {
        next.parameters = mergeTaskOverrides(current.parameters, updates.parameters);
      }
      if (isRecord(updates.capabilities)) {
        next.capabilities = mergeTaskOverrides(current.capabilities, updates.capabilities);
      }
      return this.updateSettingsInQueue({ taskModels: { [taskType]: next } });
    });
  }

  isTaskModelDefault(taskType: TaskType): boolean {
    return JSON.stringify(this.settings.taskModels[taskType]) ===
      JSON.stringify(DEFAULT_TASK_MODEL_CONFIGS[taskType]);
  }

  async addProvider(id: string, config: ProviderConfig): Promise<Result<void>> {
    const normalizedId = id.trim();
    if (!isValidProviderId(normalizedId)) {
      return err("E101_INVALID_INPUT", "Provider ID 不能为空、包含控制字符或使用保留名称");
    }

    return this.enqueueMutation(async () => {
      if (Object.hasOwn(this.settings.providers, normalizedId)) {
        return err("E310_INVALID_STATE", `Provider 已存在: ${normalizedId}`);
      }
      return this.updateSettingsInQueue({
        providers: { [normalizedId]: config },
        defaultProviderId: this.settings.defaultProviderId ||
          (config.enabled && config.apiFormat !== "disabled" ? normalizedId : ""),
      });
    });
  }

  async updateProvider(id: string, updates: Partial<ProviderConfig>): Promise<Result<void>> {
    return this.enqueueMutation(async () => {
      if (!Object.hasOwn(this.settings.providers, id)) {
        return err("E311_NOT_FOUND", `Provider 不存在: ${id}`);
      }
      const current = this.settings.providers[id];

      return this.updateSettingsInQueue({
        providers: { [id]: { ...current, ...updates } },
      });
    });
  }

  async removeProvider(id: string): Promise<Result<void>> {
    return this.enqueueMutation(async () => {
      if (!Object.hasOwn(this.settings.providers, id)) {
        return err("E311_NOT_FOUND", `Provider 不存在: ${id}`);
      }

      const next = cloneSettings(this.settings);
      delete next.providers[id];
      if (next.defaultProviderId === id) {
        next.defaultProviderId = "";
      }
      for (const taskType of TASK_TYPES) {
        if (next.taskModels[taskType].providerId === id) {
          next.taskModels[taskType].providerId = "";
        }
      }
      return this.persist(next);
    });
  }

  /** Execute an update while the mutation queue is already held. */
  private async updateSettingsInQueue(partial: SettingsUpdate): Promise<Result<void>> {
    const merged = mergeSettings(this.settings, partial);
    if (!merged.ok) {
      return merged;
    }
    if (settingsEqual(this.settings, merged.value)) {
      return ok(undefined);
    }
    return this.persist(merged.value);
  }

  private enqueueMutation(operation: () => Promise<Result<void>>): Promise<Result<void>> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async persist(settings: PluginSettings): Promise<Result<void>> {
    try {
      const snapshot = cloneSettings(settings);
      await this.plugin.saveData(snapshot);
      this.settings = snapshot;
      this.notifyListeners();
      return ok(undefined);
    } catch (error) {
      return err("E500_INTERNAL_ERROR", "保存设置失败", error);
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(cloneSettings(this.settings));
      } catch (error) {
        // Persistence already succeeded, so isolate the listener without hiding the fault.
        const cause = error instanceof Error ? error : new Error(String(error));
        if (this.logger) {
          this.logListenerError(cause);
        } else {
          this.pendingListenerErrors.push(cause);
        }
      }
    }
  }

  private logListenerError(error: Error): void {
    try {
      this.logger?.error("SettingsStore", "设置监听器执行失败", error);
    } catch {
      // Diagnostics must never change the result of the settings mutation.
    }
  }
}
