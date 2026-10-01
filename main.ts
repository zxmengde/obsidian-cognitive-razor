import { Plugin } from "obsidian";
import { PluginRuntime } from "./src/app/plugin-runtime";
import { SettingsApplication } from "./src/app/settings-application";
import { SettingsStore } from "./src/data/settings-store";
import { I18n } from "./src/core/i18n";
import { ProviderConnection } from "./src/core/provider-connection";
import type { WorkbenchApplication } from "./src/app/workbench-application";
import { WorkbenchView, VIEW_TYPE_CR_WORKBENCH } from "./src/ui/svelte/workbench-view";
import { CRSettingTab } from "./src/ui/svelte/settings-tab";
import { CommandDispatcher } from "./src/ui/command-dispatcher";
import { showError } from "./src/ui/feedback";
import { InMemoryExternalCallLedger } from "./src/core/external-call-ledger";
import { reportHostDiagnostic } from "./src/data/logger";
import { backupAndClearPluginData } from "./src/data/runtime-data-maintenance";
import { err } from "./src/types";
import type { Result } from "./src/types";

/**
 * The Obsidian host stays intentionally small. Settings and entry points are
 * available immediately; operational services are created by ensureRuntime().
 */
export default class CognitiveRazorPlugin extends Plugin {
  private settingsStore!: SettingsStore;
  private settingsApplication!: SettingsApplication;
  private readonly externalCallLedger = new InMemoryExternalCallLedger();

  private readonly i18n = new I18n();
  private runtime: PluginRuntime | undefined;
  private runtimePromise: Promise<PluginRuntime> | undefined;
  private unloading = false;
  private resettingRuntimeData = false;

  async onload(): Promise<void> {
    this.unloading = false;
    this.settingsStore = new SettingsStore(this);
    const result = await this.settingsStore.loadSettings();
    if (!result.ok) {
      // Keep the store's own explanation (unreadable file, memory preserved)
      // instead of collapsing it into the generic code description.
      showError(
        `${this.i18n.messages.host.settingsLoadFailed}：${result.error.message}`,
        this.i18n.messages.host.settingsLoadFailed,
      );
    }
    this.settingsApplication = new SettingsApplication({
      settingsStore: this.settingsStore,
      providerProbe: new ProviderConnection(this.settingsStore, this.externalCallLedger),
      rebuildSemanticNote: async (path) => (await this.ensureRuntime()).rebuildSemanticNote(path),
      ensureSemanticIndex: async () => (await this.ensureRuntime()).getSemanticIndexPort(),
      resetRuntimeData: () => this.backupAndResetRuntimeData(),
    });

    this.addSettingTab(new CRSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_CR_WORKBENCH, (leaf) => new WorkbenchView(leaf, this));
    new CommandDispatcher(this).registerAllCommands();
  }

  async onExternalSettingsChange(): Promise<void> {
    const result = await this.settingsStore.loadSettings();
    if (!result.ok) {
      showError(
        `${this.i18n.messages.host.externalSettingsInvalid}：${result.error.message}`,
        this.i18n.messages.host.externalSettingsInvalid,
      );
    }
  }

  async onunload(): Promise<void> {
    this.unloading = true;
    this.settingsApplication?.dispose?.();

    const initializing = this.runtimePromise;
    let runtime = this.runtime;
    try {
      if (!runtime && initializing) {
        try {
          runtime = await initializing;
        } catch {
          // ensureRuntime() already released a partially initialized runtime.
          runtime = undefined;
        }
      }
      if (runtime) {
        try {
          await runtime.dispose();
        } catch (error) {
          this.reportHostError("Plugin", "运行时收尾失败", error);
        }
      }
    } finally {
      this.runtime = undefined;
      this.runtimePromise = undefined;
    }
  }

  getI18n(): I18n {
    return this.i18n;
  }

  private async backupAndResetRuntimeData(): Promise<Result<void>> {
    this.resettingRuntimeData = true;
    try {
      // Mounted workbenches own references to this runtime's services. Close
      // them before disposal so reopening cannot reuse a stopped application.
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_CR_WORKBENCH);
      const initializing = this.runtimePromise;
      if (initializing) {
        try {
          await initializing;
        } catch {
          // Startup already disposed any partial runtime.
        }
      }
      if (this.runtime) {
        await this.runtime.dispose();
      }
      this.runtime = undefined;
      this.runtimePromise = undefined;
      const cleared = await backupAndClearPluginData(
        this.app.vault,
        this.manifest.dir ?? "",
        this.settingsStore.getSettings(),
      );
      return cleared;
    } catch (cause) {
      return err("E500_INTERNAL_ERROR", "备份并重置运行数据失败", cause);
    } finally {
      this.resettingRuntimeData = false;
    }
  }

  reportHostError(module: string, message: string, error?: unknown): void {
    const logger = this.runtime?.logger;
    if (logger) {
      const normalized = error instanceof Error
        ? error
        : new Error(typeof error === "string" ? error : "Unknown error");
      logger.error(module, message, normalized);
      return;
    }
    const isSilent = this.settingsStore?.getSettings?.().logLevel === "silent";
    reportHostDiagnostic(module, message, error, !isSilent);
  }

  getSettingsApplication(): SettingsApplication {
    if (!this.settingsApplication) {
      throw new Error("设置应用尚未就绪");
    }
    return this.settingsApplication;
  }

  async ensureWorkbenchApplication(): Promise<WorkbenchApplication> {
    const runtime = await this.ensureRuntime();
    return runtime.getWorkbenchApplication();
  }

  async ensureRuntime(): Promise<PluginRuntime> {
    if (this.runtime?.isReady) {
      return this.runtime;
    }
    if (this.runtimePromise) {
      return this.runtimePromise;
    }
    if (this.unloading) {
      throw new Error("插件正在卸载");
    }
    if (this.resettingRuntimeData) {
      throw new Error("插件正在重置运行数据");
    }

    const runtime = new PluginRuntime(
      this.app,
      this.manifest.dir ?? "",
      this.settingsStore,
      this.i18n,
      this.externalCallLedger,
    );
    const initializationRef: { promise?: Promise<PluginRuntime> } = {};
    const initialization = (async () => {
      try {
        await runtime.start();
        if (this.unloading || this.resettingRuntimeData) {
          throw new Error(this.unloading ? "插件正在卸载" : "插件正在重置运行数据");
        }
        this.settingsApplication?.setLogger(runtime.logger);
        this.runtime = runtime;
        return runtime;
      } catch (error) {
        this.reportHostError("Plugin", "插件运行时启动失败", error);
        await runtime.dispose();
        throw error;
      } finally {
        // The promise only coordinates startup. Once it settles, future
        // callers use the ready runtime (or start a fresh one after failure).
        if (this.runtimePromise === initializationRef.promise) {
          this.runtimePromise = undefined;
        }
      }
    })();
    initializationRef.promise = initialization;
    this.runtimePromise = initialization;
    return initialization;
  }

  async openWorkbench(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CR_WORKBENCH);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      throw new Error("无法创建 Cognitive Razor 工作台视图");
    }
    await leaf.setViewState({ type: VIEW_TYPE_CR_WORKBENCH, active: true });
    workspace.revealLeaf(leaf);
  }
}
