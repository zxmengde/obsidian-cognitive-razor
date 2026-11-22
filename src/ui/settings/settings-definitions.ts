import type { ButtonComponent, SettingDefinition, SettingDefinitionItem, SettingDefinitionPage, SettingPage } from "obsidian";
import type { Component } from "svelte";
import type { SettingsApplication } from "../../app/settings-application";
import type { I18n } from "../../core/i18n";
import type { ProviderProbeReadModel } from "../provider-probe-result";
import { DEFAULT_SETTINGS } from "../../data/settings-store";
import type { PluginSettings, ProviderConfig, TaskType } from "../../types";
import { taskSettingsSummary } from "../settings-summaries";
import { locationDraft } from "../settings-locations";
import type { MaintenanceController } from "./maintenance-controller";
import type { NativeConfirmOptions } from "./native-confirm";
import { probeService } from "./service-probes";
import { buildTaskPage } from "./task-definitions";
import type { TaskPageState } from "./task-page-state";
import ProviderProbeStatus from "../svelte/settings/ProviderProbeStatus.svelte";
import LocationsEditor from "../svelte/settings/LocationsEditor.svelte";
import MaintenanceResults from "../svelte/settings/MaintenanceResults.svelte";

/** 设置页展示顺序：常用聊天阶段在前，卡片与嵌入在后。 */
export const SETTINGS_TASKS: TaskType[] = ["define", "tag", "write", "verify", "merge", "cards", "index"];

/** 控件键与设置字段不同的虚拟键：界面用秒和字符串，存储仍是毫秒和数字。 */
export const VIRTUAL_CONTROL_KEYS = {
  taskTimeoutSeconds: "taskTimeoutSeconds",
  providerTimeoutSeconds: "providerTimeoutSeconds",
  queuePageSize: "queuePageSize",
} as const;

export interface ServiceProbeRecord {
  /** 发起测试时的服务配置签名；配置变化后旧结果不再展示。 */
  signature: string;
  result: ProviderProbeReadModel;
}

/** 设置页定义所需的宿主能力。由原生设置标签页实现，测试中可替换。 */
export interface SettingsDefinitionsHost {
  i18n: I18n;
  settingsApplication: SettingsApplication;
  maintenance: MaintenanceController;
  /** 把 Svelte 组件挂到原生设置行内，返回同步清理函数。 */
  mount<T extends Record<string, unknown>>(target: HTMLElement, component: Component<T>, props: T): () => void;
  sveltePage<T extends Record<string, unknown>>(title: string, component: Component<T>, props: () => T): SettingPage;
  /** 任务页草稿与探针；同一次设置会话内跨刷新与导航保留。 */
  taskState: TaskPageState;
  /** 只改了页内草稿、设置本身没变时，请求按最新状态重绘当前页。 */
  refresh(): void;
  openServiceEditor(mode: "add" | "edit", id?: string): void;
  openTaskProbe(id: string): void;
  openServiceMenu(id: string, anchor: HTMLElement): void;
  confirm(options: NativeConfirmOptions): Promise<boolean>;
  /** 维护控制器、重建、保存状态任一变化时通知，用于原位刷新按钮。 */
  onRuntimeChange(listener: () => void): () => void;
  serviceProbes: Map<string, ServiceProbeRecord>;
  exportSettings(): void;
  pickSettingsFile(): Promise<string | undefined>;
}

export function serviceSignature(id: string, config: ProviderConfig | undefined): string {
  return JSON.stringify({ id, config });
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 直接把说明写进 descEl。设置页常在独立窗口，跨文档的 DocumentFragment
 * 过不了宿主 setDesc 的类型判断，会被转成 "[object DocumentFragment]"。
 */
function describe(descEl: HTMLElement, ...lines: string[]): void {
  const doc = descEl.ownerDocument;
  descEl.replaceChildren(...lines.map((line) => el(doc, "div", undefined, line)));
}

export function enabledChatServiceIds(settings: PluginSettings): string[] {
  return Object.keys(settings.providers).filter((id) => settings.providers[id]?.enabled && settings.providers[id]?.apiFormat !== "disabled");
}

/**
 * 每个任务在设置页上的展示状态。没有默认服务时，沿用默认的任务统一显示「等待默认服务」，
 * 警告只留给「任务模型」入口一处，避免首屏重复七条同样的提醒。
 */
export function taskEntryState(settings: PluginSettings, taskType: TaskType, i18n: I18n) {
  const summary = taskSettingsSummary(settings, taskType);
  const waitingDefault = summary.source === "inherited" && !settings.defaultProviderId;
  const value = waitingDefault
    ? i18n.t("settings.native.taskWaitingDefault")
    : summary.resolved.providerId && summary.resolved.model
      ? `${summary.resolved.providerId} · ${summary.resolved.model}`
      : summary.resolved.providerId || i18n.t("settings.native.modelUnset");
  const desc = [i18n.t(`settings.redesign.${summary.source}`), summary.issue && !waitingDefault ? i18n.t(`settings.redesign.${summary.issue}`) : undefined]
    .filter(Boolean).join(" · ");
  return { summary, value, desc, warning: Boolean(summary.issue) && !waitingDefault };
}

function labelOf(i18n: I18n, config: ProviderConfig): string {
  const key = config.apiFormat === "disabled" ? "disabled"
    : config.apiFormat === "openai-responses" ? "openaiResponses"
      : config.apiFormat === "gemini-generative-language" ? "geminiGenerativeLanguage"
        : config.apiFormat === "anthropic-messages" ? "anthropicMessages"
          : "openaiChatCompletions";
  return i18n.t(`modals.providerConfig.apiFormats.${key}`);
}

/** 用于判断是否需要整页重绘：只包含会改变定义结构或展示文字的设置。 */
export function definitionsStructureKey(settings: PluginSettings): string {
  return JSON.stringify({
    providers: settings.providers,
    defaultProviderId: settings.defaultProviderId,
    taskModels: settings.taskModels,
    directoryScheme: settings.directoryScheme,
    cardsSourceRoot: settings.cardsSourceRoot,
    cardsTargetRoot: settings.cardsTargetRoot,
  });
}

export function buildSettingDefinitions(host: SettingsDefinitionsHost): SettingDefinitionItem[] {
  const { i18n, settingsApplication: app, maintenance } = host;
  const t = (key: string) => i18n.t(key);
  const n = (key: string) => i18n.t(`settings.native.${key}`);
  const settings = app.getSettings();
  const current = () => app.getSettings();
  const locked = () => app.getSemanticIndexRebuildState().status === "running" || app.getSaveState().status === "saving";
  const serviceIds = Object.keys(settings.providers);
  const chatServiceIds = enabledChatServiceIds(settings);

  // ---- 保存失败：只在失败时出现，带重试 ----
  const saveFailed: SettingDefinition = {
    name: t("settings.save.failed"),
    searchable: false,
    visible: () => app.getSaveState().status === "save-failed",
    render: (setting) => {
      const state = app.getSaveState();
      setting.setClass("cr-setting-save-failed");
      setting.setName(t("settings.save.failed"));
      setting.setDesc(state.error?.message ?? "");
      if (state.retryable !== false) {
        setting.addButton((button) => button.setButtonText(t("settings.save.retry")).setCta().onClick(() => void app.retryLastSave()));
      } else {
        setting.setDesc(t("settings.save.reapply"));
      }
    },
  };

  // ---- 服务 ----
  const serviceRow = (id: string): SettingDefinition => {
    const config = settings.providers[id];
    const isDefault = id === settings.defaultProviderId;
    const chat = config.apiFormat !== "disabled"
      ? i18n.format("settings.native.serviceChat", { model: config.defaultChatModel || n("modelUnset") }) : n("serviceNoChat");
    const embedding = config.embeddingApiFormat !== "disabled"
      ? i18n.format("settings.native.serviceEmbedding", { model: config.defaultEmbedModel || n("modelUnset") }) : n("serviceNoEmbedding");
    const summary = [labelOf(i18n, config), chat, embedding].join(" · ");
    return {
      name: id,
      desc: summary,
      aliases: [n("services"), t("settings.provider.testConnection"), config.defaultChatModel, config.defaultEmbedModel].filter(Boolean),
      render: (setting) => {
        const doc = setting.settingEl.ownerDocument;
        setting.setClass("cr-service-row");
        if (!config.enabled) setting.settingEl.classList.add("is-disabled");
        setting.setName(id);
        if (isDefault) setting.nameEl.appendChild(el(doc, "span", "cr-service-badge", n("serviceDefault")));
        if (!config.enabled) setting.nameEl.appendChild(el(doc, "span", "cr-service-badge cr-service-badge--muted", n("serviceDisabled")));
        const probeEl = el(doc, "div", "cr-service-probe");
        describe(setting.descEl, summary);
        setting.descEl.appendChild(probeEl);

        let cleanupProbe: (() => void) | undefined;
        const showProbe = (record: ServiceProbeRecord | undefined, retry: () => void) => {
          cleanupProbe?.();
          cleanupProbe = undefined;
          probeEl.replaceChildren();
          if (!record || record.signature !== serviceSignature(id, app.getSettings().providers[id])) return;
          cleanupProbe = host.mount(probeEl, ProviderProbeStatus, { result: record.result, i18n, onretry: retry, retrying: false });
        };
        let testButton: ButtonComponent | undefined;
        let controller: AbortController | undefined;
        const run = async (reason: "initial" | "manual-retry") => {
          if (controller) return;
          const signature = serviceSignature(id, app.getSettings().providers[id]);
          controller = new AbortController();
          testButton?.setDisabled(true).setButtonText(n("testing"));
          host.serviceProbes.delete(id);
          showProbe(undefined, () => undefined);
          try {
            const result = await probeService(app, id, reason, controller.signal);
            if (result && !controller.signal.aborted) {
              host.serviceProbes.set(id, { signature, result });
              showProbe(host.serviceProbes.get(id), () => void run("manual-retry"));
            }
          } finally {
            controller = undefined;
            testButton?.setDisabled(!app.getSettings().providers[id]?.enabled).setButtonText(n("testService"));
          }
        };
        setting.addButton((button) => {
          testButton = button;
          button.setButtonText(n("testService")).setDisabled(!config.enabled).onClick(() => void run("initial"));
          button.buttonEl.setAttribute("aria-label", `${n("testService")} ${id}`);
        });
        setting.addExtraButton((button) => button.setIcon("pencil").setTooltip(n("editService")).onClick(() => host.openServiceEditor("edit", id)));
        setting.addExtraButton((button) => {
          button.setIcon("more-horizontal").setTooltip(n("moreActions"));
          button.extraSettingsEl.setAttribute("aria-label", `${n("moreActions")} ${id}`);
          button.onClick(() => host.openServiceMenu(id, button.extraSettingsEl));
        });
        showProbe(host.serviceProbes.get(id), () => void run("manual-retry"));
        return () => { controller?.abort("service row removed"); cleanupProbe?.(); };
      },
    };
  };

  const services: SettingDefinitionItem = {
    type: "list",
    heading: n("services"),
    cls: "cr-services",
    emptyState: n("servicesEmpty"),
    addItem: { name: n("addService"), action: () => host.openServiceEditor("add") },
    onDelete: (index) => {
      const id = serviceIds[index];
      if (!id) return;
      void host.confirm({
        title: t("confirmDialogs.deleteProvider.title"),
        message: i18n.format("confirmDialogs.deleteProvider.message", { id }),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        danger: true,
      }).then((confirmed) => { if (confirmed) void app.removeProvider(id); });
    },
    items: serviceIds.map(serviceRow),
  };

  // ---- 模型 ----
  const defaultOptions: Record<string, string> = { "": n("defaultServiceNone") };
  for (const id of chatServiceIds) defaultOptions[id] = `${id} · ${settings.providers[id].defaultChatModel || n("modelUnset")}`;
  if (settings.defaultProviderId && !(settings.defaultProviderId in defaultOptions)) {
    defaultOptions[settings.defaultProviderId] = i18n.format("settings.native.unavailableOption", { id: settings.defaultProviderId });
  }
  const defaultMissing = chatServiceIds.length > 0 && !settings.defaultProviderId;
  const defaultService: SettingDefinition = {
    name: n("defaultService"),
    desc: serviceIds.length === 0
      ? `${n("defaultServiceDesc")} ${n("defaultServiceNeedsService")}`
      : defaultMissing ? `${n("defaultServiceDesc")} ${n("defaultServiceMissing")}` : n("defaultServiceDesc"),
    aliases: ["默认模型", "默认聊天模型"],
    control: {
      type: "dropdown",
      key: "defaultProviderId",
      options: defaultOptions,
      disabled: () => serviceIds.length === 0,
    },
  };

  const taskStates = SETTINGS_TASKS.map((taskType) => ({ taskType, ...taskEntryState(settings, taskType, i18n) }));
  const customizedCount = taskStates.filter((task) => task.summary.source === "customized").length;
  const taskModels: SettingDefinitionPage = {
    type: "page",
    name: n("taskModels"),
    desc: n("taskModelsDesc"),
    displayValue: customizedCount === 0 ? n("taskModelsAllInherited") : i18n.format("settings.native.taskModelsCustomized", { count: customizedCount }),
    // 唯一的首屏提醒：有任务无法运行时标在这里。
    status: serviceIds.length > 0 && taskStates.some((task) => task.summary.issue) ? "warning" : null,
    items: [{ type: "group", items: taskStates.map((task) => buildTaskPage(host, task.taskType, task)) }],
  };

  // ---- 笔记与卡片 ----
  const draft = locationDraft(settings);
  const locations: SettingDefinitionPage = {
    type: "page",
    name: n("locations"),
    desc: n("locationsDesc"),
    displayValue: draft.mode === "unified"
      ? i18n.format("settings.native.locationsValue", { source: settings.cardsSourceRoot, target: settings.cardsTargetRoot })
      : n("locationsCustom"),
    page: () => host.sveltePage(n("locations"), LocationsEditor, () => ({})),
  };

  // ---- 生成与检索 ----
  const generation: SettingDefinitionItem = {
    type: "group",
    heading: n("generation"),
    items: [
      { name: t("settings.product.autoVerify"), desc: t("settings.redesign.autoVerifyCost"), control: { type: "toggle", key: "enableAutoVerify" } },
      { name: t("settings.product.semanticIndex"), desc: t("settings.advanced.semanticIndexing.enabledDesc"), control: { type: "toggle", key: "enableSemanticIndexing", disabled: locked } },
      {
        name: t("settings.product.relatedNotes"),
        desc: t("settings.advanced.semanticIndexing.duplicatesDesc"),
        aliases: ["重复笔记", "去重"],
        control: { type: "toggle", key: "enableDuplicateDetection", disabled: () => !current().enableSemanticIndexing || locked() },
      },
      {
        name: t("settings.similarityThreshold.name"),
        desc: t("settings.similarityThreshold.desc"),
        visible: () => current().enableSemanticIndexing && current().enableDuplicateDetection,
        control: { type: "slider", key: "similarityThreshold", min: 0, max: 1, step: 0.01, disabled: locked, displayFormat: (value) => value.toFixed(2) },
      },
    ],
  };

  // ---- 显示 ----
  const display: SettingDefinitionItem = {
    type: "group",
    heading: n("display"),
    items: [
      {
        name: t("settings.displayPreferences.report"),
        desc: t("settings.displayPreferences.reportDesc"),
        control: { type: "dropdown", key: "verifyReportPresentation", options: { expanded: t("settings.displayPreferences.expanded"), collapsed: t("settings.displayPreferences.collapsed") } },
      },
      {
        name: t("settings.displayPreferences.filter"),
        desc: t("settings.displayPreferences.filterDesc"),
        control: { type: "dropdown", key: "queueDefaultFilter", options: Object.fromEntries(["all", "active", "failed"].map((value) => [value, t(`settings.displayPreferences.filters.${value}`)])) },
      },
      {
        name: t("settings.displayPreferences.pageSize"),
        desc: t("settings.displayPreferences.pageSizeDesc"),
        control: { type: "dropdown", key: VIRTUAL_CONTROL_KEYS.queuePageSize, options: { "25": "25", "50": "50", "100": "100" } },
      },
      {
        name: n("resetDisplay"),
        desc: n("resetDisplayDesc"),
        render: (setting) => {
          setting.setName(n("resetDisplay")).setDesc(n("resetDisplayDesc"));
          setting.addButton((button) => button.setButtonText(t("settings.displayPreferences.reset")).onClick(() => void app.updateSettings({
            verifyReportPresentation: DEFAULT_SETTINGS.verifyReportPresentation,
            queueDefaultFilter: DEFAULT_SETTINGS.queueDefaultFilter,
            queuePageSize: DEFAULT_SETTINGS.queuePageSize,
          })));
        },
      },
    ],
  };

  // ---- 高级：执行与诊断 ----
  const seconds = (value: number) => i18n.format("settings.native.secondsFormat", { value });
  const execution: SettingDefinitionPage = {
    type: "page",
    name: t("settings.redesign.execution"),
    desc: n("executionDesc"),
    items: [{
      type: "group",
      items: [
        {
          name: t("settings.advanced.queue.logLevel"),
          desc: t("settings.advanced.queue.logLevelDesc"),
          control: { type: "dropdown", key: "logLevel", options: Object.fromEntries(["silent", "debug", "info", "warn", "error"].map((value) => [value, t(`settings.advanced.queue.logLevels.${value}`)])) },
        },
        { name: t("settings.concurrency.name"), desc: t("settings.concurrency.desc"), control: { type: "slider", key: "concurrency", min: 1, max: 10, step: 1 } },
        { name: t("settings.advanced.queue.taskTimeout"), desc: t("settings.advanced.queue.taskTimeoutDesc"), control: { type: "slider", key: VIRTUAL_CONTROL_KEYS.taskTimeoutSeconds, min: 30, max: 3600, step: 30, displayFormat: seconds } },
        { name: t("settings.advanced.queue.networkTimeout"), desc: t("settings.advanced.queue.networkTimeoutDesc"), control: { type: "slider", key: VIRTUAL_CONTROL_KEYS.providerTimeoutSeconds, min: 10, max: 3600, step: 10, displayFormat: seconds } },
        { name: t("settings.advanced.queue.streamingKeepalive"), desc: t("settings.advanced.queue.streamingKeepaliveDesc"), control: { type: "toggle", key: "enableStreamingKeepalive" } },
        {
          name: t("settings.advanced.queue.streamingTransport"),
          desc: t("settings.advanced.queue.streamingTransportDesc"),
          visible: () => current().enableStreamingKeepalive,
          control: { type: "dropdown", key: "streamingTransport", options: { "node-http": t("settings.advanced.queue.streamingNode"), "renderer-fetch": t("settings.advanced.queue.streamingRenderer") } },
        },
        { name: t("settings.advanced.queue.providerMaxAttempts"), desc: t("settings.advanced.queue.providerMaxAttemptsDesc"), control: { type: "slider", key: "providerMaxAttempts", min: 1, max: 3, step: 1 } },
      ],
    }],
  };

  // ---- 高级：维护与备份 ----
  /** 维护按钮随运行状态原位更新，不整页重绘。 */
  const bindButton = (button: ButtonComponent, state: () => { disabled: boolean; text: string }): (() => void) => {
    const apply = () => {
      const next = state();
      button.setDisabled(next.disabled).setButtonText(next.text);
    };
    apply();
    return host.onRuntimeChange(apply);
  };
  const actionRow = (name: string, desc: string, label: string, run: () => void, extra: { running?: () => boolean; disabled?: () => boolean; aliases?: string[] } = {}): SettingDefinition => ({
    name,
    desc,
    ...(extra.aliases ? { aliases: extra.aliases } : {}),
    render: (setting) => {
      setting.setName(name).setDesc(desc);
      let cleanup: (() => void) | undefined;
      setting.addButton((button) => {
        button.onClick(run);
        cleanup = bindButton(button, () => ({
          disabled: (extra.disabled?.() ?? false) || maintenance.isRunning(),
          text: extra.running?.() ? n("working") : label,
        }));
      });
      return cleanup;
    },
  });
  const ms = () => maintenance.getState();
  const semanticOff = () => !current().enableSemanticIndexing;

  const hasMaintenanceResult = () => {
    const state = ms();
    const rebuild = app.getSemanticIndexRebuildState().status;
    return Boolean(state.indexStatus || state.vectorReport || state.duplicateRebuildFeedback || state.missingEmbedFeedback || state.vectorCleanupFeedback)
      || ["completed", "partial", "cancelled", "failed"].includes(rebuild);
  };
  let notePath = "";
  const maintenancePage: SettingDefinitionPage = {
    type: "page",
    name: n("maintenance"),
    desc: n("maintenanceDesc"),
    items: [
      { ...saveFailed },
      {
        type: "group",
        heading: t("settings.redesign.indexChecks"),
        items: [
          actionRow(t("settings.advanced.semanticIndexing.scanMissing"), `${t("settings.advanced.semanticIndexing.scanMissingDesc")} ${t("settings.redesign.checksNoApi")}`,
            t("settings.advanced.semanticIndexing.scanMissing"), () => void maintenance.scanSemanticIndex(),
            { running: () => ms().indexScanRunning, disabled: semanticOff }),
          actionRow(t("settings.advanced.semanticIndexing.vectorMaintenance"), t("settings.advanced.semanticIndexing.vectorMaintenanceDesc"),
            t("settings.advanced.semanticIndexing.scanVectorFiles"), () => void maintenance.scanVectorFiles(),
            { running: () => ms().vectorScanRunning }),
          {
            name: n("maintenanceResults"),
            searchable: false,
            // 没有结果时整行隐藏，避免组内出现空白行。
            visible: () => hasMaintenanceResult(),
            render: (setting) => {
              setting.setClass("cr-setting-block");
              setting.infoEl.remove();
              setting.controlEl.remove();
              const target = el(setting.settingEl.ownerDocument, "div", "cr-setting-block__body");
              setting.settingEl.appendChild(target);
              return host.mount(target, MaintenanceResults, {
                controller: maintenance,
                settingsApplication: app,
                i18n,
                onCleanupRequest: () => void host.confirm({
                  title: t("settings.advanced.semanticIndexing.cleanupVectorFilesConfirmTitle"),
                  message: t("settings.advanced.semanticIndexing.cleanupVectorFilesConfirmMessage"),
                  confirmLabel: t("settings.advanced.semanticIndexing.cleanupVectorFilesConfirm"),
                  cancelLabel: t("common.cancel"),
                  danger: true,
                }).then((confirmed) => { if (confirmed) void maintenance.cleanupVectorFiles(); }),
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.redesign.targetedMaintenance"),
        items: [
          {
            name: t("cards.rebuildNote"),
            desc: t("settings.redesign.rebuildNoteCost"),
            render: (setting) => {
              setting.setName(t("cards.rebuildNote")).setDesc(t("settings.redesign.rebuildNoteCost"));
              let button: ButtonComponent | undefined;
              setting.addText((text) => {
                text.setPlaceholder(t("cards.notePlaceholder")).setValue(notePath).onChange((value) => {
                  notePath = value;
                  button?.setDisabled(!notePath.trim() || semanticOff() || maintenance.isRunning());
                });
                text.inputEl.setAttribute("aria-label", t("cards.rebuildNote"));
              });
              let cleanup: (() => void) | undefined;
              setting.addButton((component) => {
                button = component;
                component.onClick(() => void maintenance.rebuildSpecifiedNote(notePath));
                cleanup = bindButton(component, () => ({ disabled: !notePath.trim() || semanticOff() || maintenance.isRunning(), text: t("cards.rebuildNote") }));
              });
              return cleanup;
            },
          },
          actionRow(t("settings.advanced.semanticIndexing.rebuildDuplicates"), t("settings.advanced.semanticIndexing.rebuildDuplicatesDesc"),
            t("settings.advanced.semanticIndexing.rebuildDuplicates"), () => void maintenance.rebuildDuplicatePairs(),
            { running: () => ms().duplicateRebuildRunning, disabled: () => semanticOff() || !current().enableDuplicateDetection }),
        ],
      },
      {
        type: "group",
        heading: t("settings.redesign.fullRebuild"),
        items: [{
          name: t("settings.advanced.semanticIndexing.rebuild"),
          desc: `${t("settings.redesign.rebuildCost")} ${t("settings.redesign.rebuildCancellation")}`,
          aliases: ["重建索引", "向量"],
          render: (setting) => {
            const doc = setting.settingEl.ownerDocument;
            setting.setName(t("settings.advanced.semanticIndexing.rebuild"));
            const progressEl = el(doc, "div", "cr-setting-progress");
            progressEl.setAttribute("role", "status");
            progressEl.setAttribute("aria-live", "polite");
            describe(setting.descEl, t("settings.redesign.rebuildCost"), t("settings.redesign.rebuildCancellation"));
            setting.descEl.appendChild(progressEl);
            let cleanup: (() => void) | undefined;
            setting.addButton((button) => {
              button.onClick(() => {
                const state = app.getSemanticIndexRebuildState();
                if (state.status === "running") {
                  if (!state.cancelRequested) app.cancelSemanticIndexRebuild();
                  return;
                }
                void host.confirm({
                  title: t("settings.advanced.semanticIndexing.rebuildConfirmTitle"),
                  message: t("settings.advanced.semanticIndexing.rebuildConfirmMessage"),
                  confirmLabel: t("settings.advanced.semanticIndexing.rebuildConfirm"),
                  cancelLabel: t("common.cancel"),
                }).then((confirmed) => { if (confirmed && app.getSemanticIndexRebuildState().status !== "running") void app.rebuildSemanticIndex(); });
              });
              cleanup = bindButton(button, () => {
                const state = app.getSemanticIndexRebuildState();
                const progress = state.progress;
                progressEl.textContent = progress
                  ? i18n.format(`settings.advanced.semanticIndexing.rebuildPhases.${progress.phase}`, { completed: progress.completed, total: progress.total, failed: progress.failed })
                  : "";
                if (state.status === "running") {
                  // 提交与刷新重复项阶段不可取消。
                  return { text: t("common.cancel"), disabled: state.cancelRequested || (progress !== undefined && progress.phase !== "scanning" && progress.phase !== "embedding") };
                }
                return { text: t("settings.advanced.semanticIndexing.rebuild"), disabled: semanticOff() || maintenance.isRunning() };
              });
            });
            return cleanup;
          },
        }],
      },
      {
        type: "group",
        heading: t("settings.redesign.settingsBackup"),
        items: [
          {
            name: t("settings.importExport.export"),
            desc: t("settings.importExport.exportDesc"),
            render: (setting) => {
              setting.setName(t("settings.importExport.export")).setDesc(t("settings.importExport.exportDesc"));
              setting.addButton((button) => button.setButtonText(t("settings.importExport.export")).onClick(() => { maintenance.clearImportError(); host.exportSettings(); }));
            },
          },
          {
            name: t("settings.importExport.import"),
            desc: t("settings.importExport.importDesc"),
            render: (setting) => {
              const doc = setting.settingEl.ownerDocument;
              setting.setName(t("settings.importExport.import"));
              const errorEl = el(doc, "div", "mod-warning");
              errorEl.setAttribute("role", "alert");
              describe(setting.descEl, t("settings.importExport.importDesc"));
              setting.descEl.appendChild(errorEl);
              const apply = () => { errorEl.textContent = maintenance.getState().importError ?? ""; };
              apply();
              setting.addButton((button) => button.setButtonText(t("settings.importExport.import")).onClick(async () => {
                maintenance.clearImportError();
                const json = await host.pickSettingsFile();
                if (json !== undefined) await maintenance.importSettings(json);
              }));
              return host.onRuntimeChange(apply);
            },
          },
        ],
      },
      {
        type: "group",
        heading: n("dangerZone"),
        cls: "cr-danger-zone",
        items: [{
          name: t("settings.importExport.reset"),
          desc: n("resetDesc"),
          aliases: ["重置", "备份"],
          render: (setting) => {
            const doc = setting.settingEl.ownerDocument;
            setting.setName(t("settings.importExport.reset"));
            const details = el(doc, "details", "cr-setting-details");
            details.appendChild(el(doc, "summary", undefined, t("settings.redesign.resetRecoveryTitle")));
            for (const key of ["resetBackupLocation", "resetInterruptedRecovery", "resetManualRecovery"]) details.appendChild(el(doc, "p", undefined, t(`settings.redesign.${key}`)));
            describe(setting.descEl, t("settings.redesign.resetScope"));
            setting.descEl.appendChild(details);
            setting.addButton((button) => button.setButtonText(`${t("settings.importExport.reset")}…`).setDestructive().onClick(() => void host.confirm({
              title: t("confirmDialogs.resetSettings.title"),
              message: t("confirmDialogs.resetSettings.message"),
              confirmLabel: t("settings.importExport.reset"),
              cancelLabel: t("common.cancel"),
              danger: true,
            }).then((confirmed) => { if (confirmed) void app.resetAndStart(); })));
          },
        }],
      },
    ],
  };

  return [
    saveFailed,
    services,
    { type: "group", heading: n("models"), items: [defaultService, taskModels] },
    { type: "group", heading: n("notes"), items: [locations] },
    generation,
    display,
    { type: "group", heading: n("advanced"), items: [execution, maintenancePage] },
  ];
}

