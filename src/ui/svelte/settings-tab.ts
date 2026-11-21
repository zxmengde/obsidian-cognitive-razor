import { App, Menu, PluginSettingTab, type SettingDefinitionItem, type SettingPage } from "obsidian";
import type { Component } from "svelte";
import type CognitiveRazorPlugin from "../../../main";
import type { SettingsApplication } from "../../app/settings-application";
import type { PluginSettings, ProviderConfig } from "../../types";
import { mountSvelteComponent } from "../bridge/mount";
import { settingsContextMap } from "../bridge/context";
import { onSettingsSection } from "../settings-intent";
import { MaintenanceController } from "../settings/maintenance-controller";
import { confirmNative } from "../settings/native-confirm";
import { probeDraft } from "../settings/service-probes";
import type { ProviderProbeRequest } from "../../core/model-gateway";
import { SvelteSettingPage } from "../settings/svelte-setting-page";
import { TaskProbeModal } from "../settings/task-probe-modal";
import {
  buildSettingDefinitions,
  definitionsStructureKey,
  enabledChatServiceIds,
  VIRTUAL_CONTROL_KEYS,
  type ServiceProbeRecord,
  type SettingsDefinitionsHost,
} from "../settings/settings-definitions";
import ProviderModal from "./modals/ProviderModal.svelte";

/** 原生控件读写的设置值；虚拟键在这里与存储单位互换。 */
export function readControlValue(settings: PluginSettings, key: string): unknown {
  switch (key) {
    case VIRTUAL_CONTROL_KEYS.taskTimeoutSeconds: return settings.taskTimeoutMs / 1000;
    case VIRTUAL_CONTROL_KEYS.providerTimeoutSeconds: return settings.providerTimeoutMs / 1000;
    case VIRTUAL_CONTROL_KEYS.queuePageSize: return String(settings.queuePageSize);
    default: return (settings as unknown as Record<string, unknown>)[key];
  }
}

export function controlUpdate(key: string, value: unknown): Partial<PluginSettings> {
  switch (key) {
    case VIRTUAL_CONTROL_KEYS.taskTimeoutSeconds: return { taskTimeoutMs: Number(value) * 1000 };
    case VIRTUAL_CONTROL_KEYS.providerTimeoutSeconds: return { providerTimeoutMs: Number(value) * 1000 };
    case VIRTUAL_CONTROL_KEYS.queuePageSize: return { queuePageSize: Number(value) as PluginSettings["queuePageSize"] };
    default: return { [key]: value } as Partial<PluginSettings>;
  }
}

/**
 * Cognitive Razor 设置页：Obsidian 1.13 原生声明式设置。
 *
 * 宿主负责布局、搜索索引、子页面导航与控件外观；这里只声明设置项、
 * 把控件读写接到 SettingsApplication，并在设置变化时刷新。
 */
export class CRSettingTab extends PluginSettingTab {
  private readonly maintenance: MaintenanceController;
  private readonly host: SettingsDefinitionsHost;
  private readonly serviceProbes = new Map<string, ServiceProbeRecord>();
  /** 本次设置会话内保留的任务页；关闭设置页时卸载。 */
  private readonly keptPages = new Map<string, SvelteSettingPage<Record<string, unknown>>>();
  private readonly runtimeListeners = new Set<() => void>();
  private readonly unsubscribers: Array<() => void> = [];
  private structureKey: string;
  private saveFailed: boolean;
  /** 打开中的 Svelte 子页面数量；期间整页重绘会丢掉草稿，推迟到关闭后再做。 */
  private openSveltePages = 0;
  private pendingUpdate = false;
  private updateScheduled = false;

  constructor(app: App, private readonly plugin: CognitiveRazorPlugin) {
    super(app, plugin);
    this.icon = "brain-circuit";
    // 行内挂载的 Svelte 状态与标记使用插件令牌，令牌定义在 .cr-scope 上。
    this.containerEl.classList.add("cr-scope");
    const settingsApplication = this.settingsApplication;
    this.maintenance = new MaintenanceController(settingsApplication, plugin.getI18n());
    this.host = this.createHost();
    this.structureKey = definitionsStructureKey(settingsApplication.getSettings());
    this.saveFailed = settingsApplication.getSaveState().status === "save-failed";
    this.unsubscribers.push(
      settingsApplication.subscribeSettings((settings) => {
        const key = definitionsStructureKey(settings);
        if (key !== this.structureKey) {
          this.structureKey = key;
          this.scheduleUpdate();
        } else {
          this.refreshInPlace();
        }
      }),
      settingsApplication.subscribeSaveState((state) => {
        const failed = state.status === "save-failed";
        if (failed !== this.saveFailed || failed) {
          this.saveFailed = failed;
          this.scheduleUpdate();
        } else {
          this.refreshInPlace();
        }
      }),
      settingsApplication.subscribeSemanticIndexRebuildState(() => this.refreshInPlace()),
      this.maintenance.subscribe(() => this.refreshInPlace()),
      onSettingsSection((section) => { if (section === "connections") this.focusServices(); }),
    );
    plugin.register(() => this.dispose());
  }

  private get settingsApplication(): SettingsApplication {
    return this.plugin.getSettingsApplication();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return buildSettingDefinitions(this.host);
  }

  getControlValue(key: string): unknown {
    return readControlValue(this.settingsApplication.getSettings(), key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // 保存失败由设置页顶部的失败行展示并提供重试，这里不再另行提示。
    await this.settingsApplication.updateSettings(controlUpdate(key, value));
  }

  hide(): void {
    // 与旧设置页卸载时一致：离开设置页即取消仍可取消的语义索引重建。
    this.settingsApplication.cancelSemanticIndexRebuild();
    this.releaseKeptPages();
    super.hide();
  }

  private releaseKeptPages(): void {
    for (const page of this.keptPages.values()) page.destroy();
    this.keptPages.clear();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.runtimeListeners.clear();
    this.releaseKeptPages();
    this.maintenance.dispose();
  }

  // ---- 刷新 ----

  private refreshInPlace(): void {
    for (const listener of this.runtimeListeners) listener();
    if (this.containerEl.isConnected) this.refreshDomState();
  }

  private scheduleUpdate(): void {
    if (this.openSveltePages > 0) {
      this.pendingUpdate = true;
      this.refreshInPlace();
      return;
    }
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    queueMicrotask(() => {
      this.updateScheduled = false;
      this.updatePreservingFocus();
    });
  }

  /** 整页重绘会替换 DOM；按「第几行的第几个控件」把焦点放回去，键盘用户不会丢位置。 */
  private updatePreservingFocus(): void {
    const doc = this.containerEl.ownerDocument;
    const active = doc.activeElement;
    let position: { row: number; control: number } | undefined;
    if (active && this.containerEl.contains(active)) {
      const rows = Array.from(this.containerEl.querySelectorAll(".setting-item"));
      const row = active.closest(".setting-item");
      if (row) {
        const controls = Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE));
        position = { row: rows.indexOf(row), control: Math.max(0, controls.indexOf(active as HTMLElement)) };
      }
    }
    this.update();
    for (const listener of this.runtimeListeners) listener();
    if (!position || position.row < 0) return;
    const row = this.containerEl.querySelectorAll(".setting-item")[position.row];
    const controls = row ? Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    (controls[position.control] ?? controls[0])?.focus();
  }

  // ---- 定义宿主 ----

  private createHost(): SettingsDefinitionsHost {
    return {
      i18n: this.plugin.getI18n(),
      settingsApplication: this.settingsApplication,
      maintenance: this.maintenance,
      mount: (target, component, props) => {
        const { destroy } = mountSvelteComponent(target, component, props, this.svelteContext());
        return () => { void destroy().catch((error: unknown) => this.reportError(error)); };
      },
      sveltePage: <T extends Record<string, unknown>>(title: string, component: Component<T>, props: () => T, keepAliveKey?: string): SettingPage => {
        const cached = keepAliveKey ? this.keptPages.get(keepAliveKey) : undefined;
        if (cached) return cached;
        const page = new SvelteSettingPage(title, component, props, this.svelteContext(), {
          keepAlive: keepAliveKey !== undefined,
          onOpen: () => { this.openSveltePages++; },
          onClose: () => {
            this.openSveltePages = Math.max(0, this.openSveltePages - 1);
            if (this.openSveltePages === 0 && this.pendingUpdate) {
              this.pendingUpdate = false;
              this.scheduleUpdate();
            }
          },
          onError: (error) => this.reportError(error),
        });
        if (keepAliveKey) this.keptPages.set(keepAliveKey, page as unknown as SvelteSettingPage<Record<string, unknown>>);
        return page;
      },
      openServiceEditor: (mode, id) => this.openServiceEditor(mode, id),
      openTaskProbe: (id) => new TaskProbeModal(this.app, id, this.settingsApplication, this.plugin.getI18n()).open(),
      openServiceMenu: (id, anchor) => this.openServiceMenu(id, anchor),
      confirm: (options) => confirmNative(this.app, options),
      onRuntimeChange: (listener) => {
        this.runtimeListeners.add(listener);
        return () => { this.runtimeListeners.delete(listener); };
      },
      serviceProbes: this.serviceProbes,
      exportSettings: () => this.exportSettings(),
      pickSettingsFile: () => this.pickSettingsFile(),
    };
  }

  private svelteContext(): Map<unknown, unknown> {
    return settingsContextMap({ app: this.app, i18n: this.plugin.getI18n(), settingsApplication: this.settingsApplication });
  }

  private reportError(error: unknown): void {
    this.plugin.reportHostError("SettingsTab", "设置页面收尾失败", error);
  }

  // ---- 服务操作 ----

  private openServiceEditor(mode: "add" | "edit", id?: string): void {
    const doc = this.containerEl.ownerDocument;
    const target = doc.body.appendChild(doc.createElement("div"));
    target.className = "cr-scope";
    let destroy: (() => Promise<void>) | undefined;
    const close = () => {
      const pending = destroy;
      destroy = undefined;
      if (pending) void pending().catch((error: unknown) => this.reportError(error)).finally(() => target.remove());
    };
    const settingsApplication = this.settingsApplication;
    destroy = mountSvelteComponent(target, ProviderModal, {
      mode,
      providerId: id ?? "",
      currentConfig: id ? settingsApplication.getSettings().providers[id] : undefined,
      i18n: this.plugin.getI18n(),
      ontest: (request: ProviderProbeRequest, signal?: AbortSignal) => probeDraft(settingsApplication, request, signal),
      onsave: async (nextId: string, config: ProviderConfig) => {
        const result = mode === "add"
          ? await settingsApplication.addProvider(nextId, config)
          : await settingsApplication.updateProvider(nextId, config);
        if (result.ok) close();
        return result;
      },
      oncancel: close,
    }, this.svelteContext()).destroy;
  }

  /** 删除由原生列表的删除按钮提供，菜单只放其余操作。 */
  private openServiceMenu(id: string, anchor: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const n = (key: string) => i18n.t(`settings.native.${key}`);
    const settingsApplication = this.settingsApplication;
    const settings = settingsApplication.getSettings();
    const config = settings.providers[id];
    if (!config) return;
    const menu = new Menu();
    if (settings.defaultProviderId !== id && enabledChatServiceIds(settings).includes(id)) {
      menu.addItem((item) => item.setTitle(n("setDefault")).setIcon("star").onClick(() => void settingsApplication.updateSettings({ defaultProviderId: id })));
    }
    menu.addItem((item) => item
      .setTitle(n(config.enabled ? "disable" : "enable"))
      .setIcon(config.enabled ? "circle-off" : "circle-check")
      .onClick(() => void settingsApplication.updateProvider(id, { enabled: !config.enabled })));
    menu.addItem((item) => item
      .setTitle(n("taskProbe"))
      .setIcon("flask-conical")
      .setDisabled(!config.enabled || config.apiFormat === "disabled")
      .onClick(() => new TaskProbeModal(this.app, id, settingsApplication, i18n).open()));
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
  }

  /** 工作台的「打开设置」落到服务区：等原生页面渲染出服务组后滚动并聚焦。 */
  private focusServices(attempt = 0): void {
    const group = this.containerEl.isConnected ? this.containerEl.querySelector<HTMLElement>(".cr-services") : null;
    if (!group) {
      if (attempt < 30) window.setTimeout(() => this.focusServices(attempt + 1), 50);
      return;
    }
    group.scrollIntoView({ block: "start" });
    // 已有服务时先给连接测试，没有时给添加按钮。
    const target = group.querySelector<HTMLElement>(".cr-service-row button") ?? group.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
  }

  // ---- 备份 ----

  private exportSettings(): void {
    const doc = this.containerEl.ownerDocument;
    const view = doc.defaultView ?? window;
    const blob = new view.Blob([this.settingsApplication.exportSettings()], { type: "application/json" });
    const url = view.URL.createObjectURL(blob);
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = "cognitive-razor-settings.json";
    anchor.click();
    view.URL.revokeObjectURL(url);
  }

  private pickSettingsFile(): Promise<string | undefined> {
    const doc = this.containerEl.ownerDocument;
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(undefined); return; }
        // 读取失败交给导入校验报告，与选择无效文件一致。
        file.text().then(resolve, () => resolve(""));
      };
      input.click();
    });
  }
}

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
