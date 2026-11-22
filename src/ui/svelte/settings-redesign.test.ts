import * as obsidian from "obsidian";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SettingDefinitionGroup, SettingDefinitionItem } from "obsidian";
import type { SemanticIndexPort } from "../../app/settings-application";
import { I18n } from "../../core/i18n";
import { ProviderManager } from "../../core/provider-manager";
import { buildTaskChatRequest } from "../../core/task-execution-support";
import { resolveTaskModelSnapshot } from "../../core/task-model-resolver";
import { DEFAULT_SETTINGS, SettingsStore } from "../../data/settings-store";
import type { PluginSettings } from "../../types";
import { taskSettingsSummary } from "../settings-summaries";
import {
  cloneDefaults,
  closeSettingsPage,
  createSettingsEnvironment,
  findButton,
  findRow,
  hostTab,
  openSettingsPage,
  openTaskPage,
  settle,
  type SettingsBundle,
  type SettingsEnvironment,
} from "./settings-test-support";

const i18n = new I18n();
/** 原生设置行文字：「服务」「任务模型」等设置页 key。 */
const N = (key: string) => i18n.t(`settings.native.${key}`);
const LOC = (key: string) => i18n.t(`settings.locations.${key}`);
const TASK_NAMES = ["定义", "标记", "撰写", "核查", "合并", "记忆卡片", "语义索引"];

/** 基础夹具：一个默认服务、一个单独设置写作任务的服务。 */
function baseSettings(): PluginSettings {
  const settings = cloneDefaults();
  settings.providers.daily = {
    apiKey: "", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings",
    defaultChatModel: "chat-main", defaultEmbedModel: "embed-main", parameters: { temperature: 0.7 }, capabilities: { temperature: true },
  };
  settings.providers.research = { ...settings.providers.daily, defaultChatModel: "reasoning-model" };
  settings.defaultProviderId = "daily";
  settings.taskModels.write = { providerId: "research", model: "reasoning-model", parameters: { topP: 0.9, maxTokens: null } };
  settings.enableSemanticIndexing = true;
  settings.enableDuplicateDetection = true;
  return settings;
}

/** 语义索引替身：与 SemanticIndexPort 的调用一一对应，结果形状与真实返回一致。 */
function fakeIndex() {
  return {
    scanSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { eligible: 3, indexed: 2, missing: 1, missingNotes: [{ cruid: "missing-one", name: "缺失笔记", path: "C/缺失.md", type: "entity", status: "draft" }] } })),
    inspectVectorFiles: vi.fn(async () => ({ ok: true as const, value: { indexedEntries: 2, physicalFiles: 3, orphanFiles: [{ path: "vectors/orphan.json", mtime: 1, size: 1 }], missingEntries: [], staleEntries: [], invalidEntries: [] } })),
    cleanupOrphanedVectorFiles: vi.fn(async () => ({ ok: true as const, value: { deleted: 1, skipped: 0, failed: 0 } })),
    embedMissingSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { eligible: 3, indexed: 1, skipped: 0, failed: 0 } })),
    embedOneSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { indexed: 1, failed: 0 } })),
    rebuildSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { indexed: 3, skipped: 0, failed: 0 } })),
    rebuildDuplicatePairs: vi.fn(async () => ({ ok: true as const, value: 2 })),
    cancelSemanticIndexRebuild: vi.fn(),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(options: { settings?: PluginSettings; failFirstSave?: boolean; saveDelay?: () => Promise<void>; index?: ReturnType<typeof fakeIndex> } = {}) {
  const index = options.index ?? fakeIndex();
  const env: SettingsEnvironment = await createSettingsEnvironment({
    settings: options.settings ?? baseSettings(),
    semanticIndex: index as unknown as SemanticIndexPort,
    failFirstSave: options.failFirstSave,
    saveDelay: options.saveDelay,
  });
  const mounted: Array<() => Promise<void>> = [];
  let finished = false;
  return {
    ...env,
    index,
    /** 在设置页之外挂载 Svelte 组件（位置编辑、弹窗等），并与设置页共享上下文。 */
    mount(component: SettingsBundle["LocationsEditor"], props: Record<string, unknown>): HTMLElement {
      const target = document.body.appendChild(document.createElement("div"));
      const { destroy } = env.bundle.mountSvelteComponent(target, component, props, env.context());
      mounted.push(async () => { await destroy(); target.remove(); });
      env.bundle.flushSync();
      return target;
    },
    settle: () => settle(env.bundle),
    flush: () => env.bundle.flushSync(),
    /** 点击顶层行的入口，打开子页并返回其容器。 */
    openPage: (name: string) => openSettingsPage(env, name),
    /** 打开「任务模型 › 任务」页；parameters 为真时再进入「能力与参数」。 */
    openTask: (name: string, parameters = false) => openTaskPage(env, name, parameters),
    closePage: () => closeSettingsPage(env),
    cleanup: async () => {
      if (finished) return;
      finished = true;
      for (const unmount of mounted.splice(0).reverse()) await unmount();
      document.querySelectorAll('[role="dialog"], .modal-container').forEach((node) => node.remove());
      await env.cleanup();
    },
  };
}

/** 在已打开的页面容器中点击某一行的入口，返回新打开的子页容器。 */
async function openNested(h: Harness, container: HTMLElement, name: string): Promise<HTMLElement> {
  const row = findRow(container, name);
  row.querySelector<HTMLElement>('[role="button"]')!.click();
  await h.settle();
  const opened = hostTab(h).openedPage;
  if (!opened) throw new Error(`Nested page did not open: ${name}`);
  return opened.containerEl;
}

function setField(element: HTMLInputElement | HTMLSelectElement, value: string, event: "change" | "input" = "change"): void {
  element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true }));
}

function rowNames(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".setting-item"))
    .map((row) => row.querySelector(":scope > .setting-item-info > .setting-item-name")?.firstChild?.textContent?.trim() ?? "");
}

/** Svelte 按钮的文字带前导空格，比较前去掉空白。 */
function hasButton(root: ParentNode, label: string): boolean {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).some((button) => button.textContent?.trim() === label);
}

function hasRow(root: ParentNode, name: string): boolean {
  return rowNames(root).includes(name);
}

function displayValue(row: HTMLElement): string | null | undefined {
  return row.querySelector(".cr-mock-display-value")?.textContent;
}

function checkbox(row: HTMLElement): HTMLInputElement {
  return row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

function toggle(row: HTMLElement): void {
  const box = checkbox(row);
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

function slider(row: HTMLElement): HTMLInputElement {
  return row.querySelector<HTMLInputElement>('input[type="range"]')!;
}

function sliderChange(row: HTMLElement, value: number): void {
  const input = slider(row);
  input.value = String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterAll(async () => {
  document.body.replaceChildren();
});

describe("approved settings information architecture", () => {
  it("has no provider output-mode choice or per-task output override", async () => {
    const h = await harness();
    try {
      for (const [index, taskType] of (["define", "tag", "write", "verify"] as const).entries()) {
        for (const parameters of [false, true]) {
          const task = await h.openTask(TASK_NAMES[index], parameters);
          expect(task.querySelector(`#tmc-${taskType}-structured`)).toBeNull();
          expect(task.textContent).not.toContain("结构化输出");
        }
      }
      const modalSource = readFileSync("src/ui/svelte/modals/ProviderModal.svelte", "utf8");
      expect(modalSource).not.toContain("pm-structured-output");
      expect(modalSource).not.toContain("formStructuredOutput");
      expect(h.save).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("propagates real UI edits through persisted settings and reload into the actual request payload", async () => {
    const h = await harness();
    const request = vi.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 200, text: "", json: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } } as never);
    try {
      let task = await h.openTask("撰写");
      // 设置变化会重绘页内的行，每次都重新查询控件。
      const change = async (selector: string, value: string) => {
        setField(task.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!, value);
        await h.settle();
      };
      await change("#tmc-write-provider", "daily");
      await change("#tmc-write-model", "ui-selected-model");
      task = await h.openTask("撰写", true);
      await change("#tmc-write-temp-mode", "set");
      await change("#tmc-write-temp", "0.25");
      await change("#tmc-write-max-tokens-mode", "set");
      await change("#tmc-write-max-tokens", "512");

      const saved = (h.save.mock.calls.at(-1) as unknown as [PluginSettings])[0];
      const reloaded = new SettingsStore({ loadData: async () => structuredClone(saved), saveData: vi.fn() } as never);
      expect((await reloaded.loadSettings()).ok).toBe(true);
      expect(reloaded.getSettings()).toEqual(h.store.getSettings());
      const manager = new ProviderManager(reloaded, { debug() {}, info() {}, warn() {}, error() {} });
      try {
        expect((await manager.chat(buildTaskChatRequest("write", "<system_instructions>policy</system_instructions>synthetic input", resolveTaskModelSnapshot(reloaded.getSettings(), "write")))).ok).toBe(true);
        const body = JSON.parse((request.mock.calls[0][0] as { body: string }).body);
        expect(body).toMatchObject({ model: "ui-selected-model", temperature: 0.25, max_tokens: 512 });
      } finally { manager.dispose(); }
      expect(h.probe).not.toHaveBeenCalled();
    } finally { request.mockRestore(); await h.cleanup(); }
  });

  it("runs the forced-service probe with the write task parameters and saves nothing", async () => {
    const h = await harness();
    try {
      const before = structuredClone(h.store.getSettings().taskModels);
      const result = await h.bundle.probeServiceWithTask(h.application, "daily", "write", "initial");
      expect((h.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: "daily", taskType: "write", taskConfig: { providerId: "daily", model: "reasoning-model" } });
      expect(result?.target).toMatchObject({ scope: "write", providerId: "daily", model: "reasoning-model", temporaryProvider: true });
      expect(h.store.getSettings().taskModels).toEqual(before);
      expect(h.save).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("retains location preview and original configuration after save failure, then retries once", async () => {
    const h = await harness({ failFirstSave: true });
    try {
      const editor = h.mount(h.bundle.LocationsEditor, {});
      findButton(editor, LOC("edit")).click(); h.flush();
      setField(editor.querySelector<HTMLInputElement>("#cr-location-root")!, "New/Root", "input");
      h.flush();
      findButton(editor, LOC("preview")).click(); h.flush();
      findButton(editor, LOC("save")).click(); await h.settle();
      expect(h.store.getSettings().cardsSourceRoot).toBe(DEFAULT_SETTINGS.cardsSourceRoot);
      expect(editor.querySelector(".cr-locations__preview")).toBeTruthy();
      expect(editor.querySelector('[role="alert"]')?.textContent).toBe(LOC("saveFailed"));

      findButton(editor, LOC("save")).click(); await h.settle();
      expect(h.store.getSettings().cardsSourceRoot).toBe("New/Root");
      expect(h.save).toHaveBeenCalledTimes(2);
    } finally { await h.cleanup(); }
  });

  it("tests the actual index task snapshot and invalidates the displayed result after edits", async () => {
    const h = await harness();
    try {
      await h.application.updateTaskModel("index", { providerId: "research", model: "actual-embed", parameters: { embeddingDimension: 256 } });
      await h.settle();
      const task = await h.openTask("语义索引");
      const button = () => findButton(task, N("taskProbeRun"));
      button().click();
      await vi.waitFor(() => { h.flush(); expect(task.querySelector(".cr-provider-probe-status")).not.toBeNull(); });
      expect(h.probe).toHaveBeenCalledOnce();
      expect((h.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: "research", taskType: "index", taskConfig: { providerId: "research", model: "actual-embed", embeddingDimension: 256 } });
      expect(task.querySelector(".cr-provider-probe-status__target")?.textContent?.replace(/\s+/g, " ")).toContain("research · actual-embed · 请求维度: 256");
      expect(task.querySelector(".cr-provider-probe-status__capabilities")?.textContent).toContain(i18n.t("settings.provider.probe.status.disabled"));

      await h.application.updateTaskModel("index", { model: "changed-embed" }); await h.settle();
      expect(task.querySelector(".cr-provider-probe-status")).toBeNull();

      h.probe.mockResolvedValueOnce({ ok: false, error: { code: "E211_MODEL_SCHEMA_VIOLATION", message: "Synthetic" } } as never);
      button().click();
      await vi.waitFor(() => { h.flush(); expect(task.querySelector(".cr-provider-probe-status")).not.toBeNull(); });
      expect(task.querySelector(".cr-provider-probe-status__target")?.textContent).toContain("changed-embed");
      expect(task.querySelector(".cr-provider-probe-status")?.textContent).toContain(i18n.t("settings.redesign.testOutcomes.failed"));
    } finally { await h.cleanup(); }
  });

  it("drops a service probe result once the service configuration changes", async () => {
    const h = await harness();
    try {
      const row = () => findRow(h.tab.containerEl, "daily");
      row().querySelector<HTMLButtonElement>('button[aria-label="测试连接 daily"]')!.click();
      await vi.waitFor(() => {
        h.flush();
        expect(row().querySelector(".cr-service-probe .cr-provider-probe-status")).not.toBeNull();
      });
      await h.application.updateProvider("daily", { defaultChatModel: "changed-chat" });
      await h.settle();
      expect(row().querySelector(".cr-service-probe .cr-provider-probe-status")).toBeNull();
    } finally { await h.cleanup(); }
  });

  it("makes model inheritance explicit and never persists an empty specified draft", async () => {
    const h = await harness();
    try {
      const cards = await h.openTask("记忆卡片");
      const mode = () => cards.querySelector<HTMLSelectElement>("#tmc-cards-model-mode")!;
      expect(mode().value).toBe("inherit");
      expect(cards.querySelector("#tmc-cards-model")).toBeNull();

      setField(mode(), "specified"); await h.settle();
      expect(h.store.getSettings().taskModels.cards.model).toBe("chat-main");

      setField(cards.querySelector<HTMLInputElement>("#tmc-cards-model")!, ""); await h.settle();
      expect(h.store.getSettings().taskModels.cards.model).toBe("chat-main");
      expect(cards.querySelector('[role="alert"]')).toBeTruthy();

      setField(mode(), "inherit"); await h.settle();
      expect(h.store.getSettings().taskModels.cards.model).toBe("");
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("leaves seven custom paths intact until conversion is previewed and confirmed", async () => {
    const h = await harness();
    try {
      const custom = { directoryScheme: { domain: "Old/A", issue: "Old/B", theory: "Different/C", entity: "D", mechanism: "E" }, cardsSourceRoot: "Original", cardsTargetRoot: "Decks" };
      await h.application.updateSettings(custom); await h.settle();
      h.save.mockClear();

      const editor = h.mount(h.bundle.LocationsEditor, {});
      expect(editor.textContent).toContain(LOC("custom"));
      expect(editor.textContent).toContain(LOC("outsideExample"));
      expect(h.store.getSettings()).toMatchObject(custom);

      findButton(editor, LOC("edit")).click(); h.flush();
      expect(editor.querySelector<HTMLInputElement>("#cr-location-domain")?.value).toBe("Old/A");
      setField(editor.querySelector<HTMLSelectElement>("#cr-location-mode")!, "unified"); h.flush();
      findButton(editor, LOC("preview")).click(); h.flush();
      expect(editor.querySelectorAll(".cr-locations__preview .setting-item")).toHaveLength(7);
      expect(h.store.getSettings()).toMatchObject(custom);
      expect(h.save).not.toHaveBeenCalled();

      findButton(editor, LOC("save")).click(); await h.settle();
      expect(h.store.getSettings().directoryScheme.domain).toBe("Original/1-领域");
      expect(h.store.getSettings().cardsTargetRoot).toBe("Decks");
      expect(h.save).toHaveBeenCalledOnce();
      expect(editor.textContent).toContain("Original/5-机制/笔记.md → Decks/5-机制/笔记-decks.md");
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it.each(["", "x", "prefix-test-only-suffix"])("never shows the saved credential in the service list (%s)", async (key) => {
    const h = await harness();
    try {
      expect((await h.application.updateProvider("daily", { apiKey: key })).ok).toBe(true);
      await h.settle();
      const row = findRow(h.tab.containerEl, "daily");
      expect(row.querySelector("input")).toBeNull();
      expect(row.innerHTML).not.toContain("••••");
      if (key.length > 3) expect(row.textContent).not.toContain(key);
      expect(h.store.getSettings().providers.daily.apiKey).toBe(key);
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("lists all seven tasks as pages with their resolved values, without opening any editor", async () => {
    const h = await harness();
    try {
      const before = structuredClone(h.store.getSettings());
      const models = await h.openPage(N("taskModels"));
      const rows = Array.from(models.querySelectorAll<HTMLElement>(".setting-item"));
      expect(rows.map((row) => row.querySelector(":scope > .setting-item-info > .setting-item-name")?.firstChild?.textContent)).toEqual(TASK_NAMES);
      const valueOf = (name: string) => displayValue(findRow(models, name));
      expect(valueOf("定义")).toBe("daily · chat-main");
      expect(valueOf("撰写")).toBe("research · reasoning-model");
      expect(valueOf("记忆卡片")).toBe("daily · chat-main");
      expect(findRow(models, "撰写").dataset.status).toBeUndefined();
      expect(findRow(h.tab.containerEl, N("taskModels")).querySelector(".cr-mock-display-value")?.textContent).toBe("1 项单独设置");
      expect(h.store.getSettings()).toEqual(before);
      expect(h.save).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
      await h.closePage();
    } finally { await h.cleanup(); }
  });

  it("warns about a missing default only on the task-model entry and shows inheriting tasks as waiting", async () => {
    const settings = baseSettings();
    settings.defaultProviderId = "";
    const h = await harness({ settings });
    try {
      const defaultRow = findRow(h.tab.containerEl, N("defaultService"));
      expect(defaultRow.textContent).toContain(N("defaultServiceMissing"));
      expect(findRow(h.tab.containerEl, N("taskModels")).dataset.status).toBe("warning");
      expect(h.tab.containerEl.querySelectorAll('[data-status="warning"]')).toHaveLength(1);
      expect(h.store.getSettings().defaultProviderId).toBe("");
      expect(h.store.getSettings().taskModels.write.providerId).toBe("research");

      const models = await h.openPage(N("taskModels"));
      expect(displayValue(findRow(models, "定义"))).toBe(N("taskWaitingDefault"));
      expect(findRow(models, "定义").dataset.status).toBeUndefined();
      expect(displayValue(findRow(models, "撰写"))).toBe("research · reasoning-model");
      await h.closePage();

      await h.application.updateSettings({ defaultProviderId: "daily" });
      await h.settle();
      expect(findRow(h.tab.containerEl, N("defaultService")).textContent).not.toContain(N("defaultServiceMissing"));
      expect(findRow(h.tab.containerEl, N("taskModels")).dataset.status).toBeUndefined();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("builds the default-service warning into the definitions output itself", async () => {
    const settings = baseSettings();
    settings.defaultProviderId = "";
    const h = await harness({ settings });
    try {
      const definitions = h.bundle.buildSettingDefinitions({
        i18n,
        settingsApplication: h.application,
        maintenance: new h.bundle.MaintenanceController(h.application, i18n),
        mount: () => () => undefined,
        sveltePage: () => { throw new Error("not opened"); },
        taskState: new h.bundle.TaskPageState(),
        refresh: () => undefined,
        openServiceEditor: () => undefined,
        openTaskProbe: () => undefined,
        openServiceMenu: () => undefined,
        confirm: async () => false,
        onRuntimeChange: () => () => undefined,
        serviceProbes: new Map(),
        exportSettings: () => undefined,
        pickSettingsFile: async () => undefined,
      } as never);
      // 默认服务行的说明直接来自构建结果，而不是渲染后才拼出的文字。
      const models = definitions.find((item): item is SettingDefinitionGroup => "heading" in item && item.heading === N("models"));
      const defaultService = models?.items?.[0] as SettingDefinitionItem & { desc?: string };
      expect(defaultService.desc).toContain(N("defaultServiceMissing"));
      expect(JSON.stringify(definitions)).not.toContain("[object");
    } finally { await h.cleanup(); }
  });

  it("keeps unavailable inherited tasks individually visible and shows the one first-screen warning", async () => {
    const h = await harness();
    try {
      await h.application.updateProvider("daily", { enabled: false });
      await h.settle();
      expect(h.tab.containerEl.querySelectorAll('[data-status="warning"]')).toHaveLength(1);
      expect(findRow(h.tab.containerEl, N("taskModels")).dataset.status).toBe("warning");

      const models = await h.openPage(N("taskModels"));
      expect(models.querySelectorAll(".setting-item")).toHaveLength(7);
      expect(findRow(models, "记忆卡片").textContent).toContain(i18n.t("settings.redesign.disabled"));
      expect(findRow(models, "记忆卡片").dataset.status).toBe("warning");
      expect(displayValue(findRow(models, "语义索引"))).toContain("embed-main");
      expect(findRow(models, "撰写").dataset.status).toBeUndefined();
      await h.closePage();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("starts without example providers and resolves ordinary tasks from a single default without replacing overrides", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(settings.providers).toEqual({}); expect(settings.defaultProviderId).toBe("");
    settings.defaultProviderId = "one";
    settings.providers.one = { enabled: true, apiKey: "", apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings", defaultChatModel: "chat", defaultEmbedModel: "embed" };
    for (const task of ["define", "tag", "write", "verify", "merge"] as const) {
      expect(taskSettingsSummary(settings, task)).toMatchObject({ source: "inherited", resolved: { providerId: "one", model: "chat" } });
    }
    expect(taskSettingsSummary(settings, "index").resolved.model).toBe("embed");
    settings.taskModels.define.providerId = "old-assignment";
    expect(taskSettingsSummary(settings, "define")).toMatchObject({ source: "customized", issue: "unconfigured", resolved: { providerId: "old-assignment" } });
    settings.taskModels.cards = { providerId: "one", model: "chat" };
    expect(taskSettingsSummary(settings, "cards")).toMatchObject({ source: "customized", issue: undefined, resolved: { providerId: "one", model: "chat" } });
    expect(Object.keys(settings.providers)).toEqual(["one"]);
  });

  it("previews all seven location fields before an atomic save and cancels without writes", async () => {
    const h = await harness();
    try {
      const editor = h.mount(h.bundle.LocationsEditor, {});
      expect(editor.querySelectorAll(".cr-locations__path")).toHaveLength(5);
      findButton(editor, LOC("edit")).click(); h.flush();
      expect(editor.querySelectorAll('input[type="text"]')).toHaveLength(7);

      setField(editor.querySelector<HTMLInputElement>("#cr-location-root")!, "Example/Knowledge", "input");
      findButton(editor, LOC("preview")).click(); h.flush();
      expect(editor.querySelectorAll(".cr-locations__preview .setting-item")).toHaveLength(7);
      expect(editor.querySelector(".cr-locations__preview")?.textContent).toContain("Example/Knowledge/1-领域");
      expect(h.store.getSettings().cardsSourceRoot).toBe(DEFAULT_SETTINGS.cardsSourceRoot);
      expect(h.save).not.toHaveBeenCalled();

      findButton(editor, LOC("cancel")).click(); h.flush();
      expect(editor.querySelector(".cr-locations__preview")).toBeNull();
      expect(editor.querySelector("#cr-location-root")).toBeNull();
      expect(h.save).not.toHaveBeenCalled();

      findButton(editor, LOC("edit")).click(); h.flush();
      setField(editor.querySelector<HTMLInputElement>("#cr-location-root")!, "Example/Knowledge", "input");
      findButton(editor, LOC("preview")).click(); h.flush();
      findButton(editor, LOC("save")).click(); await h.settle();
      expect(h.store.getSettings().directoryScheme.domain).toBe("Example/Knowledge/1-领域");
      expect(h.store.getSettings().cardsSourceRoot).toBe("Example/Knowledge");
      expect(editor.querySelector("#cr-locations-edit")).toBeTruthy();
      expect(h.save).toHaveBeenCalledOnce();
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("writes slider values through the seconds conversion and reads them back", async () => {
    const h = await harness();
    try {
      const execution = await h.openPage(i18n.t("settings.redesign.execution"));
      const timeout = findRow(execution, i18n.t("settings.advanced.queue.taskTimeout"));
      expect(slider(timeout).min).toBe("30");
      expect(slider(timeout).max).toBe("3600");
      expect(slider(timeout).value).toBe(String(h.store.getSettings().taskTimeoutMs / 1000));

      sliderChange(timeout, 90); await h.settle();
      expect(h.store.getSettings().taskTimeoutMs).toBe(90000);
      expect(slider(findRow(execution, i18n.t("settings.advanced.queue.taskTimeout"))).value).toBe("90");

      sliderChange(findRow(execution, i18n.t("settings.concurrency.name")), 3); await h.settle();
      expect(h.store.getSettings().concurrency).toBe(3);
      expect(h.save).toHaveBeenCalledTimes(2);
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("persists both 3600-second timeout controls as milliseconds across settings reload", async () => {
    const h = await harness();
    try {
      const execution = await h.openPage(i18n.t("settings.redesign.execution"));
      for (const key of ["taskTimeout", "networkTimeout"] as const) {
        const label = i18n.t(`settings.advanced.queue.${key}`);
        sliderChange(findRow(execution, label), 3600); await h.settle();
        expect(slider(findRow(execution, label)).value).toBe("3600");
      }
      const saved = (h.save.mock.lastCall as unknown as [PluginSettings])[0];
      const reloaded = new SettingsStore({ loadData: async () => saved, saveData: async () => undefined } as never);
      expect((await reloaded.loadSettings()).ok).toBe(true);
      expect(reloaded.getSettings()).toMatchObject({ taskTimeoutMs: 3_600_000, providerTimeoutMs: 3_600_000 });
      expect(h.save).toHaveBeenCalledTimes(2);

      // 直接经标签页的控件接口往返，与原生控件读写的路径相同。
      await h.tab.setControlValue("taskTimeoutSeconds", 1800); await h.settle();
      expect(h.tab.getControlValue("taskTimeoutSeconds")).toBe(1800);
      expect(h.store.getSettings().taskTimeoutMs).toBe(1_800_000);
      await h.tab.setControlValue("queuePageSize", "100"); await h.settle();
      expect(h.store.getSettings().queuePageSize).toBe(100);
      expect(h.tab.getControlValue("queuePageSize")).toBe("100");
    } finally { await h.cleanup(); }
  });

  it("persists toggle changes made through the native switches", async () => {
    const h = await harness();
    try {
      const before = h.store.getSettings().enableAutoVerify;
      toggle(findRow(h.tab.containerEl, i18n.t("settings.product.autoVerify")));
      await h.settle();
      expect(h.store.getSettings().enableAutoVerify).toBe(!before);
      expect(checkbox(findRow(h.tab.containerEl, i18n.t("settings.product.autoVerify"))).checked).toBe(!before);

      const execution = await h.openPage(i18n.t("settings.redesign.execution"));
      const keepalive = i18n.t("settings.advanced.queue.streamingKeepalive");
      const previous = h.store.getSettings().enableStreamingKeepalive;
      toggle(findRow(execution, keepalive)); await h.settle();
      expect(h.store.getSettings().enableStreamingKeepalive).toBe(!previous);
      expect(h.save).toHaveBeenCalledTimes(2);
    } finally { await h.cleanup(); }
  });

  it("disables dependent generation settings and shows the threshold only when both features are on", async () => {
    const h = await harness();
    const autoVerify = i18n.t("settings.product.autoVerify");
    const semantic = i18n.t("settings.product.semanticIndex");
    const related = i18n.t("settings.product.relatedNotes");
    const threshold = i18n.t("settings.similarityThreshold.name");
    try {
      expect(rowNames(h.tab.containerEl)).toEqual(expect.arrayContaining([autoVerify, semantic, related, threshold]));
      expect(checkbox(findRow(h.tab.containerEl, related)).disabled).toBe(false);

      toggle(findRow(h.tab.containerEl, semantic)); await h.settle();
      expect(h.store.getSettings().enableSemanticIndexing).toBe(false);
      expect(checkbox(findRow(h.tab.containerEl, related)).disabled).toBe(true);
      expect(hasRow(h.tab.containerEl, threshold)).toBe(false);

      toggle(findRow(h.tab.containerEl, semantic)); await h.settle();
      expect(checkbox(findRow(h.tab.containerEl, related)).disabled).toBe(false);
      sliderChange(findRow(h.tab.containerEl, threshold), 0.82); await h.settle();
      expect(h.store.getSettings().similarityThreshold).toBe(0.82);

      toggle(findRow(h.tab.containerEl, related)); await h.settle();
      expect(h.store.getSettings().enableDuplicateDetection).toBe(false);
      expect(hasRow(h.tab.containerEl, threshold)).toBe(false);
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("shows transport only within enabled streaming controls and persists the explicit selection", async () => {
    const h = await harness();
    const transportName = i18n.t("settings.advanced.queue.streamingTransport");
    try {
      const execution = await h.openPage(i18n.t("settings.redesign.execution"));
      expect(hasRow(execution, transportName)).toBe(false);
      toggle(findRow(execution, i18n.t("settings.advanced.queue.streamingKeepalive"))); await h.settle();
      const select = findRow(execution, transportName).querySelector<HTMLSelectElement>("select")!;
      expect(select.value).toBe("node-http");
      setField(select, "renderer-fetch"); await h.settle();
      expect(h.store.getSettings().streamingTransport).toBe("renderer-fetch");

      toggle(findRow(execution, i18n.t("settings.advanced.queue.streamingKeepalive"))); await h.settle();
      expect(hasRow(execution, transportName)).toBe(false);
      expect(h.store.getSettings().streamingTransport).toBe("renderer-fetch");
    } finally { await h.cleanup(); }
  });

  it("opens a dedicated task page with parameters one level deeper and writes nothing", async () => {
    const h = await harness();
    try {
      const taskPage = await h.openTask("撰写");
      expect(rowNames(taskPage).slice(1)).toEqual([
        i18n.t("settings.taskDetails.provider"), i18n.t("settings.taskDetails.model"),
        i18n.t("settings.taskDetails.advanced"), i18n.t("settings.product.taskProbe"),
      ]);
      expect(taskPage.querySelector("[data-parameter]")).toBeNull();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
      await h.closePage();
      expect(hostTab(h).openedPage).toBeUndefined();
    } finally { await h.cleanup(); }
  });

  it("keeps cards and index editing exclusively on AI and models", async () => {
    const h = await harness();
    try {
      const notesGroup = Array.from(h.tab.containerEl.querySelectorAll<HTMLElement>(".setting-group"))
        .find((group) => group.querySelector(".setting-item-heading")?.textContent === N("notes"))!;
      expect(rowNames(notesGroup)).toEqual([N("locations")]);
      expect(notesGroup.querySelector(".cr-task-overview")).toBeNull();

      const cards = await h.openTask("记忆卡片");
      expect(cards.querySelectorAll(".cr-task-overview")).toHaveLength(1);
      expect(cards.textContent).toContain(i18n.t("settings.taskDetails.defaultProviderHint"));
      expect(cards.querySelector<HTMLSelectElement>("#tmc-cards-model-mode")?.value).toBe("inherit");
      expect(cards.querySelector("#tmc-cards-model")).toBeNull();
      expect(h.save).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("rejects an invalid output limit in place without persisting it", async () => {
    const h = await harness();
    try {
      const write = await h.openTask("撰写", true);
      setField(write.querySelector<HTMLSelectElement>("#tmc-write-max-tokens-mode")!, "set"); await h.settle();
      setField(write.querySelector<HTMLInputElement>("#tmc-write-max-tokens")!, "0"); await h.settle();
      expect(write.querySelector('[role="alert"]')).toBeTruthy();
      expect(h.store.getSettings().taskModels.write.model).toBe("reasoning-model");
      expect(h.store.getSettings().taskModels.write.parameters?.maxTokens).toBeNull();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  // 任务页草稿保存在设置会话内的任务页状态中，离开再返回仍在；关闭设置页后丢弃。
  it("keeps an uncommitted task draft when its page is left and reopened", async () => {
    const h = await harness();
    try {
      const models = await h.openPage(N("taskModels"));
      const write = await openNested(h, models, "撰写");
      const model = write.querySelector<HTMLInputElement>("#tmc-write-model")!;
      model.value = "uncommitted-model";
      model.dispatchEvent(new Event("input", { bubbles: true }));
      await h.closePage();
      const reopenedModels = await h.openPage(N("taskModels"));
      const reopened = await openNested(h, reopenedModels, "撰写");
      expect(reopened.querySelector<HTMLInputElement>("#tmc-write-model")?.value).toBe("uncommitted-model");
      expect(h.store.getSettings().taskModels.write.model).toBe("reasoning-model");
      h.tab.hide();
      h.tab.display();
      const afterClose = await h.openTask("撰写");
      expect(afterClose.querySelector<HTMLInputElement>("#tmc-write-model")?.value).toBe("reasoning-model");
    } finally { await h.cleanup(); }
  });

  it("does not move focus after the settings tab is disposed while a section intent is pending", async () => {
    const h = await harness({ settings: cloneDefaults() });
    const outside = document.body.appendChild(document.createElement("button"));
    try {
      outside.focus();
      await h.cleanup();
      h.bundle.intent.requestSettingsSection("connections");
      await h.settle();
      expect(document.activeElement).toBe(outside);
    } finally {
      h.bundle.intent.clearSettingsSection();
      outside.remove();
    }
  });

  it("retains in-flight task saves and retries a failed save from the save-failure row", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = await harness({ failFirstSave: true, saveDelay: () => gate });
    try {
      const models = await h.openPage(N("taskModels"));
      const write = await openNested(h, models, "撰写");
      const model = write.querySelector<HTMLInputElement>("#tmc-write-model")!;
      setField(model, "changed-model"); h.flush();
      expect(h.application.getSaveState().status).toBe("saving");
      // 保存进行中，其它会改变状态的控件全部锁定。
      await h.closePage();
      expect(checkbox(findRow(h.tab.containerEl, i18n.t("settings.product.semanticIndex"))).disabled).toBe(true);

      release();
      await vi.waitFor(() => expect(h.application.getSaveState().status).toBe("save-failed"));
      await h.settle();
      const failure = findRow(h.tab.containerEl, i18n.t("settings.save.failed"));
      findButton(failure, i18n.t("settings.save.retry")).click();
      await vi.waitFor(() => expect(h.application.getSaveState().status).toBe("saved"));
      expect(h.store.getSettings().taskModels.write.model).toBe("changed-model");
      expect(h.store.getSettings().taskModels.cards.model).toBe("");
      expect(h.save).toHaveBeenCalledTimes(2);
      expect(h.probe).not.toHaveBeenCalled();
    } finally { release(); await h.cleanup(); }
  });

  it("reveals only the repair matching an explicit inspection and keeps cleanup behind confirmation", async () => {
    const h = await harness();
    try {
      const page = await h.openPage(N("maintenance"));
      const scanMissing = i18n.t("settings.advanced.semanticIndexing.scanMissing");
      const embedMissing = i18n.t("settings.advanced.semanticIndexing.embedMissing");
      const scanVectors = i18n.t("settings.advanced.semanticIndexing.scanVectorFiles");
      const cleanup = i18n.t("settings.advanced.semanticIndexing.cleanupVectorFiles");
      expect(page.querySelector(".cr-maintenance-results")).toBeNull();
      expect(hasButton(page, embedMissing)).toBe(false);

      findButton(page, scanMissing).click(); await h.settle();
      await vi.waitFor(() => { h.flush(); expect(hasButton(page, embedMissing)).toBe(true); });
      expect(h.index.scanSemanticIndex).toHaveBeenCalledOnce();
      expect(h.index.embedMissingSemanticIndex).not.toHaveBeenCalled();
      expect(hasButton(page, cleanup)).toBe(false);

      findButton(page, scanVectors).click(); await h.settle();
      await vi.waitFor(() => { h.flush(); expect(hasButton(page, cleanup)).toBe(true); });
      findButton(page, cleanup).click(); h.flush();
      const dialog = document.querySelector<HTMLElement>(".modal-container");
      expect(dialog).toBeTruthy();
      expect(h.index.cleanupOrphanedVectorFiles).not.toHaveBeenCalled();
      findButton(dialog!, i18n.t("common.cancel")).click(); h.flush();
      expect(document.querySelector(".modal-container")).toBeNull();

      findButton(page, cleanup).click(); h.flush();
      findButton(document.querySelector<HTMLElement>(".modal-container")!, i18n.t("settings.advanced.semanticIndexing.cleanupVectorFilesConfirm")).click();
      await vi.waitFor(() => expect(h.index.cleanupOrphanedVectorFiles).toHaveBeenCalledWith([{ path: "vectors/orphan.json", mtime: 1, size: 1 }]));
      expect(h.index.rebuildSemanticIndex).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it("runs one maintenance action at a time and disables the others while it runs", async () => {
    const index = fakeIndex();
    const h = await harness({ index });
    let releaseScan!: () => void;
    try {
      const page = await h.openPage(N("maintenance"));
      index.inspectVectorFiles.mockImplementationOnce(() => new Promise((resolve) => {
        releaseScan = () => resolve({ ok: true as const, value: { indexedEntries: 0, physicalFiles: 0, orphanFiles: [], missingEntries: [], staleEntries: [], invalidEntries: [] } } as never);
      }));
      findButton(page, i18n.t("settings.advanced.semanticIndexing.scanVectorFiles")).click();
      // 检查向量文件要先经异步的语义索引获取，等替身真正被调用后再放行。
      await vi.waitFor(() => expect(releaseScan).toBeDefined());
      h.flush();
      expect(findButton(page, i18n.t("settings.advanced.semanticIndexing.scanMissing")).disabled).toBe(true);
      expect(findButton(page, i18n.t("settings.advanced.semanticIndexing.rebuildDuplicates")).disabled).toBe(true);

      releaseScan(); await h.settle();
      await vi.waitFor(() => { h.flush(); expect(findButton(page, i18n.t("settings.advanced.semanticIndexing.scanMissing")).disabled).toBe(false); });
    } finally {
      releaseScan?.();
      await h.cleanup();
    }
  });

  it("retains failed-save feedback across navigation and retries the same mutation", async () => {
    const h = await harness({ failFirstSave: true });
    try {
      setField(findRow(h.tab.containerEl, N("defaultService")).querySelector<HTMLSelectElement>("select")!, "research"); await h.settle();
      expect(h.application.getSaveState().status).toBe("save-failed");
      expect(findRow(h.tab.containerEl, i18n.t("settings.save.failed"))).toBeTruthy();

      const maintenance = await h.openPage(N("maintenance"));
      expect(findRow(maintenance, i18n.t("settings.save.failed"))).toBeTruthy();
      await h.closePage();

      findButton(findRow(h.tab.containerEl, i18n.t("settings.save.failed")), i18n.t("settings.save.retry")).click();
      await vi.waitFor(() => expect(h.application.getSaveState().status).toBe("saved"));
      expect(h.store.getSettings().defaultProviderId).toBe("research");
      expect(h.save).toHaveBeenCalledTimes(2);
    } finally { await h.cleanup(); }
  });

  it("opens and cancels provider editing without persisting or probing", async () => {
    const h = await harness();
    try {
      findRow(h.tab.containerEl, "daily").querySelector<HTMLElement>(`[aria-label="${N("editService")}"]`)!.click();
      h.flush();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.querySelector("#pm-chat-model")).toBeTruthy();
      expect(dialog.querySelector<HTMLDetailsElement>(".cr-provider-disclosure:last-of-type")?.open).toBe(false);
      findButton(dialog, i18n.t("common.cancel")).click();
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
      expect(h.save).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

describe("read-only task summary", () => {
  it("resolves inheritance for Cards and preserves disabled assignments", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultProviderId = "daily";
    settings.providers.daily = { enabled: true, apiKey: "", apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings", defaultChatModel: "chat", defaultEmbedModel: "embed" };
    const before = structuredClone(settings);
    expect(taskSettingsSummary(settings, "define")).toMatchObject({ source: "inherited", resolved: { providerId: "daily", model: "chat" } });
    expect(taskSettingsSummary(settings, "index").resolved.model).toBe("embed");
    expect(taskSettingsSummary(settings, "cards")).toMatchObject({ source: "inherited", issue: undefined, resolved: { providerId: "daily", model: "chat" } });
    expect(settings).toEqual(before);
    settings.providers.daily.enabled = false;
    expect(taskSettingsSummary(settings, "define").issue).toBe("disabled");
    settings.taskModels.write.parameters = { topP: null };
    expect(taskSettingsSummary(settings, "write").source).toBe("customized");
  });
});

describe("display preferences do not change task execution", () => {
  it("paginates history, excludes folded history from selection and retains unresolved summary while filtering", async () => {
    const h = await harness();
    const target = document.body.appendChild(document.createElement("div"));
    let queue: { destroy: () => Promise<void> } | undefined;
    const mountQueue = (props: Record<string, unknown>) => {
      queue = h.bundle.mountSvelteComponent(target, h.bundle.QueueHost, props);
      h.flush();
    };
    try {
      await h.application.updateSettings({ queuePageSize: 25, queueDefaultFilter: "all" });
      const tasks = Array.from({ length: 63 }, (_, i) => ({ id: `task-${i}`, noteTitle: `任务 ${i}`, stageId: "verify", state: i < 60 ? "completed" : i < 62 ? "failed" : "interrupted", payload: {} }));
      const props = { context: { i18n, settingsApplication: h.application, application: { queue: {} } }, tasks, status: { total: 63, pending: 0, running: 0, completed: 60, failed: 2, interrupted: 1, cancelled: 0, paused: false } };
      mountQueue(props);
      expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(3);
      const selectAll = target.querySelector<HTMLInputElement>(".cr-queue-select-all input")!;
      selectAll.checked = true; selectAll.dispatchEvent(new Event("change", { bubbles: true })); h.flush();
      expect(target.textContent).toContain("删除选中 (3)");
      const history = target.querySelector<HTMLDetailsElement>(".cr-queue-history")!;
      history.querySelector("summary")!.click(); h.flush();
      expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(28);
      selectAll.checked = true; selectAll.dispatchEvent(new Event("change", { bubbles: true })); h.flush();
      expect(target.textContent).toContain("删除选中 (63)");
      const more = Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.includes("显示更多"))!;
      more.click(); h.flush();
      expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(53);
      await h.application.updateSettings({ queuePageSize: 100, queueDefaultFilter: "failed" }); h.flush();
      expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(63);
      await queue!.destroy(); mountQueue(props);
      expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(2);
      expect(target.textContent).toContain("需要处理 · 3 项");
      const filter = target.querySelector<HTMLSelectElement>(".cr-queue-select-label select")!;
      filter.value = "active"; filter.dispatchEvent(new Event("change", { bubbles: true })); h.flush();
      expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(0);
      expect(target.textContent).toContain("需要处理 · 3 项");
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.ensure).not.toHaveBeenCalled();
    } finally {
      if (queue) await queue.destroy();
      target.remove();
      await h.cleanup();
    }
  });

  it("restores only the three display options without resetting models or directories", async () => {
    const h = await harness();
    try {
      await h.application.updateSettings({ verifyReportPresentation: "collapsed", queueDefaultFilter: "failed", queuePageSize: 25 });
      const before = h.store.getSettings();
      const row = findRow(h.tab.containerEl, N("resetDisplay"));
      findButton(row, i18n.t("settings.displayPreferences.reset")).click();
      await h.settle();
      expect(h.store.getSettings()).toEqual({ ...before, verifyReportPresentation: "expanded", queueDefaultFilter: "all", queuePageSize: 50 });
    } finally { await h.cleanup(); }
  });

  it("configures an Anthropic Messages provider in ProviderModal with protocol-first order and persists capabilities", async () => {
    const h = await harness();
    try {
      findButton(h.tab.containerEl, N("addService")).click(); h.flush();
      const modal = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      const fieldIds = Array.from(modal.querySelectorAll<HTMLElement>("#pm-provider-id, #pm-api-format, #pm-base-url, #pm-api-key")).map((el) => el.id);
      expect(fieldIds).toEqual(["pm-provider-id", "pm-api-format", "pm-base-url", "pm-api-key"]);

      const setVal = (selector: string, value: string) => {
        setField(modal.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!, value);
        h.flush();
      };
      setVal("#pm-provider-id", "claude");
      setVal("#pm-api-format", "anthropic-messages");
      expect(modal.querySelector<HTMLInputElement>("#pm-base-url")?.placeholder).toBe("https://api.anthropic.com/v1");
      expect(modal.querySelector<HTMLInputElement>("#pm-chat-model")?.placeholder).toBe("claude-sonnet-4-5");
      setVal("#pm-base-url", "http://127.0.0.1:18899");
      setVal("#pm-chat-model", "claude-sonnet-4-5");
      setVal("#pm-embedding-api-format", "disabled");

      // 展开高级默认值，启用原生网络搜索、推理与提示词缓存。
      Array.from(modal.querySelectorAll<HTMLDetailsElement>(".cr-provider-disclosure")).forEach((d) => { d.open = true; });
      h.flush();
      modal.querySelector<HTMLElement>('[role="switch"][aria-label="原生网络搜索"]')!.click();
      modal.querySelector<HTMLElement>('[role="switch"][aria-label="推理强度"]')!.click();
      modal.querySelector<HTMLElement>('[role="switch"][aria-label="提示词缓存优化"]')!.click();
      h.flush();
      setVal("#pm-thinking-budget", "2048");
      setVal("#pm-max-tokens", "8192");

      Array.from(modal.querySelectorAll("button")).find((button) => button.textContent?.trim() === "保存")!.click();
      await h.settle();
      await vi.waitFor(() => expect(h.store.getSettings().providers.claude).toBeDefined());
      expect(h.store.getSettings().providers.claude).toMatchObject({
        apiFormat: "anthropic-messages",
        embeddingApiFormat: "disabled",
        defaultChatModel: "claude-sonnet-4-5",
        capabilities: { nativeWebSearch: true, reasoning: true, promptCaching: true, responseContinuation: false },
        parameters: { thinkingBudget: 2048, maxTokens: 8192 },
      });
      expect(findRow(h.tab.containerEl, "claude").textContent).toContain(i18n.t("modals.providerConfig.apiFormats.anthropicMessages"));
    } finally { await h.cleanup(); }
  });
});
