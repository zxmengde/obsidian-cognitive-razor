import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { I18n } from "../../core/i18n";
import { generateFrontmatter, generateMarkdownContent } from "../../core/frontmatter-utils";
import { CR_TYPES } from "../../types";
import { DEFAULT_SETTINGS, SettingsStore } from "../../data/settings-store";
import { resolveTaskModelSnapshot } from "../../core/task-model-resolver";

// Compile the actual components with the production compiler and exercise DOM
// events, including propagation to ModalShell's window listener.
let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  ConfirmModal: unknown;
  CreateHost: unknown;
  TaskModelCard: unknown;
  TaskModelHost: unknown;
};
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as ConfirmModal } from "./src/ui/components/ConfirmModal.svelte"; export { default as TaskModelCard } from "./src/ui/svelte/settings/TaskModelCard.svelte"; export { default as CreateHost } from "test-host"; export { default as TaskModelHost } from "task-model-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "KeyboardTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "test-host", setup(builder) {
      builder.onResolve({ filter: /^(test-host|task-model-host)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ resolveDir: process.cwd(), contents: compile(
        path === "task-model-host"
          ? '<script>import TaskModelCard from "./src/ui/svelte/settings/TaskModelCard.svelte"; import { resolveTaskModelSnapshot } from "./src/core/task-model-resolver"; let { store, i18n, update } = $props(); let settings = $state(store.getSettings()); const unsubscribe = store.subscribe(value => settings = value); $effect(() => () => unsubscribe());</script><TaskModelCard taskType="write" config={settings.taskModels.write} providers={settings.providers} defaultProviderId={settings.defaultProviderId} resolved={resolveTaskModelSnapshot(settings, "write")} isDefault={false} {i18n} onUpdate={update} onReset={() => {}} />'
          : '<script>import Create from "./src/ui/svelte/workbench/CreateSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, activeFile = null } = $props(); setWorkbenchContext(context);</script><Create {activeFile} />',
        { filename: "TestHost.svelte", css: "injected" },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return KeyboardTestUI;`)();
});
afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "empty"); });

function openTaskParameters(target: HTMLElement): HTMLDetailsElement {
  const details = target.querySelector<HTMLDetailsElement>(".cr-task-model-card__advanced")!;
  expect(details.open).toBe(false);
  details.querySelector("summary")!.click();
  ui.flushSync();
  expect(details.open).toBe(true);
  return details;
}

describe("keyboard interaction safety", () => {
  it("preserves both task parameter edits when the earlier save is still in progress", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.provider = {
      apiKey: "test", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled",
      defaultChatModel: "model", defaultEmbedModel: "", capabilities: { temperature: true, topP: true },
    };
    settings.defaultProviderId = "provider";
    settings.taskModels.write = { providerId: "provider", model: "model", parameters: { temperature: 0.7, topP: 1 } };
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saveCount = 0;
    const store = new SettingsStore({ loadData: async () => settings, saveData: async () => {
      if (++saveCount === 1) await saveGate;
    } } as never);
    await store.loadSettings();
    const update = vi.fn((type, partial) => store.updateTaskModel(type, partial));
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelHost, { target, props: { store, i18n: new I18n(), update } });
    try {
      ui.flushSync();
      openTaskParameters(target);
      const changeNumber = (selector: string, value: string) => {
        const element = target.querySelector(selector)!.closest(".cr-task-model-card__field")!.querySelector<HTMLInputElement>('input[type="number"]')!;
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        ui.flushSync();
      };
      changeNumber("#tmc-write-temp", "0.8");
      await Promise.resolve();
      changeNumber("#tmc-write-topp", "0.9");
      releaseSave();
      await Promise.all(update.mock.results.map((result) => result.value));
      expect(store.getSettings().taskModels.write.parameters).toEqual({ temperature: 0.8, topP: 0.9 });
    } finally { releaseSave(); await ui.unmount(instance); target.remove(); }
  });

  it("switches a legacy task parameter back to the provider value when inherit is selected", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.provider = { apiKey: "test", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled", defaultChatModel: "model", defaultEmbedModel: "", parameters: { maxTokens: 2048 } };
    settings.taskModels.write = { providerId: "provider", model: "model", maxTokens: 100 };
    const store = new SettingsStore({ loadData: async () => settings, saveData: async () => undefined } as never);
    await store.loadSettings();
    const target = document.body.appendChild(document.createElement("div"));
    const onUpdate = vi.fn(async (type, partial) => store.updateTaskModel(type, partial));
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "write", config: store.getSettings().taskModels.write,
      providers: settings.providers, defaultProviderId: "provider", resolved: resolveTaskModelSnapshot(store.getSettings(), "write"), isDefault: false,
      i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync();
      openTaskParameters(target);
      const select = target.querySelector('#tmc-write-max-tokens')!.closest('.cr-task-model-card__field')!.querySelector('select')!;
      select.value = 'inherit';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onUpdate).toHaveBeenCalledOnce();
      await onUpdate.mock.results[0].value;
      expect(resolveTaskModelSnapshot(store.getSettings(), "write").maxTokens).toBe(2048);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each([0, 1])("Enter activates only the focused dialog button (%s)", async (buttonIndex) => {
    const target = document.body.appendChild(document.createElement("div"));
    const onconfirm = vi.fn();
    const oncancel = vi.fn();
    const instance = ui.mount(ui.ConfirmModal, { target, props: {
      title: "删除", message: "删除数据？", confirmLabel: "确定", cancelLabel: "取消", danger: true, onconfirm, oncancel,
    } });
    try {
      ui.flushSync();
      const button = target.querySelectorAll("button")[buttonIndex];
      button.focus();
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      // happy-dom does not synthesize the browser's default button click.
      if (!event.defaultPrevented) button.click();
      expect(onconfirm).toHaveBeenCalledTimes(buttonIndex);
      expect(oncancel).toHaveBeenCalledTimes(1 - buttonIndex);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("shows an English-only Define candidate so users can identify what they create", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.CreateHost, { target, props: { context: {
      i18n: new I18n(), app: { vault: { on: () => ({}), offref() {} } }, application: { queue: { subscribe: () => () => undefined }, create: { define: async () => ({ ok: true, value: {
        coreDefinition: "", candidates: Object.fromEntries(CR_TYPES.map((type) => [type, {
          name: { chinese: "", english: `${type} English Name` }, confidence: 0.8,
        }])),
      } }) } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      const input = target.querySelector("input")!;
      input.value = "concept";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      ui.flushSync();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(target.querySelectorAll('[role="row"]')).toHaveLength(5));
      expect(target.textContent).toContain("entity English Name");
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("waits for Chinese IME composition to finish before submitting Define", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const define = vi.fn(async () => ({ ok: false, error: { code: "E101_INVALID_INPUT" } }));
    const instance = ui.mount(ui.CreateHost, { target, props: { context: {
      i18n: new I18n(), app: { vault: { on: () => ({}), offref() {} } }, application: { queue: { subscribe: () => () => undefined }, create: { define } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      const input = target.querySelector("input")!;
      input.value = "知识";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      ui.flushSync();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
      expect(define).not.toHaveBeenCalled();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(define).toHaveBeenCalledOnce();
    } finally { await ui.unmount(instance); target.remove(); }
  });
});


describe("card generation entry", () => {
  it.each([false, true])("shows the card action only for a CR node (%s)", async (isNode) => {
    const target = document.body.appendChild(document.createElement("div"));
    const start = vi.fn(async () => ({ ok: true, value: "D-习题库/测试-decks.md" }));
    const content = isNode ? generateMarkdownContent(generateFrontmatter({ cruid: "node", type: "entity", name: "测试" }), "正文") : "普通笔记";
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: "C-知识库/测试.md", extension: "md" }, context: {
      i18n: new I18n(), app: { vault: { cachedRead: async () => content, on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined }, cards: { start } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const cardButton = Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.includes("生成记忆卡片"));
      expect(!!cardButton).toBe(isNode);
      expect(target.textContent).not.toContain("重建当前笔记向量");
      if (cardButton) {
        cardButton.click();
        expect(start).toHaveBeenCalledWith("C-知识库/测试.md");
        await vi.waitFor(() => expect(target.textContent).toContain("D-习题库/测试-decks.md"));
      }
    } finally { await ui.unmount(instance); target.remove(); }
  });
});


describe("task parameter progressive disclosure", () => {
  it.each([
    ["write", "temp"], ["write", "topp"], ["write", "max-tokens"], ["index", "dimension"],
  ] as const)("keeps empty specified %s/%s local until a real valid value is entered", async (taskType, id) => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultProviderId = "provider";
    settings.providers.provider = {
      apiKey: "", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings",
      defaultChatModel: "model", defaultEmbedModel: "embed", capabilities: { temperature: true, topP: true },
    };
    const onUpdate = vi.fn();
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType, config: settings.taskModels[taskType], providers: settings.providers, defaultProviderId: "provider",
      resolved: resolveTaskModelSnapshot(settings, taskType), isDefault: true, i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync();
      expect(target.querySelector("#tmc-" + taskType + "-provider")).not.toBeNull();
      expect(onUpdate).not.toHaveBeenCalled();
      const details = openTaskParameters(target);
      const nested = details.querySelector<HTMLDetailsElement>("details");
      if (nested) expect(nested.open).toBe(false);
      const mode = target.querySelector<HTMLSelectElement>(`#tmc-${taskType}-${id}-mode`)!;
      mode.value = "set";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      const input = target.querySelector<HTMLInputElement>(`#tmc-${taskType}-${id}`)!;
      expect(input.value).toBe("");
      expect(onUpdate).not.toHaveBeenCalled();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(input.getAttribute("aria-invalid")).toBe("true");
      input.value = id === "temp" || id === "topp" ? "0" : "512";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      expect(onUpdate).toHaveBeenCalledOnce();
      const key = { temp: "temperature", topp: "topP", "max-tokens": "maxTokens", dimension: "embeddingDimension" }[id];
      expect(onUpdate).toHaveBeenCalledWith(taskType, { parameters: { [key]: id === "temp" || id === "topp" ? 0 : 512 } });
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("keeps unsupported saved values visible and makes protocol rejection explicit", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.research = {
      apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled",
      defaultChatModel: "model", defaultEmbedModel: "", capabilities: { reasoning: true },
      parameters: { temperature: 0.7 },
    };
    settings.taskModels.write = { providerId: "research", model: "", parameters: { topP: 0.9, thinkingLevel: "HIGH" } };
    const onUpdate = vi.fn();
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "write", config: settings.taskModels.write, providers: settings.providers, defaultProviderId: "research",
      resolved: resolveTaskModelSnapshot(settings, "write"), isDefault: false, i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync(); openTaskParameters(target);
      const topP = target.querySelector('[data-parameter="topP"]')!;
      expect(topP.textContent).toContain("当前不发送");
      expect(topP.textContent).toContain("0.9");
      expect(topP.textContent).toContain(new I18n().t("settings.taskDetails.fromTask"));
      expect(topP.querySelector<HTMLInputElement>("input")!.value).toBe("0.9");
      expect(target.querySelector('[data-parameter="thinkingLevel"]')!.textContent).toContain("发送前拒绝请求");
      expect(onUpdate).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("keeps Cards service and model independent of global defaults", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultProviderId = "research";
    settings.providers.research = { apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "inherited-model", defaultEmbedModel: "" };
    const target = document.body.appendChild(document.createElement("div"));
    const onUpdate = vi.fn();
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "cards", config: settings.taskModels.cards, providers: settings.providers, defaultProviderId: "research",
      resolved: resolveTaskModelSnapshot(settings, "cards"), isDefault: true, i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync();
      expect(target.querySelector<HTMLSelectElement>("#tmc-cards-provider")!.value).toBe("");
      expect(target.querySelector<HTMLInputElement>("#tmc-cards-model")!.value).toBe("");
      expect(target.querySelector<HTMLInputElement>("#tmc-cards-model")!.placeholder).not.toContain("inherited-model");
      expect(target.textContent).toContain("不继承服务的默认模型");
      expect(onUpdate).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("updates inherited previews without saving an empty specified draft when the default provider changes", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.A = { apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "A-model", defaultEmbedModel: "", capabilities: { temperature: true } };
    settings.providers.B = { ...settings.providers.A, defaultChatModel: "B-model", parameters: { temperature: 0.6 } };
    settings.defaultProviderId = "A";
    const store = new SettingsStore({ loadData: async () => settings, saveData: async () => undefined } as never);
    await store.loadSettings();
    const update = vi.fn((type, partial) => store.updateTaskModel(type, partial));
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelHost, { target, props: { store, i18n: new I18n(), update } });
    try {
      ui.flushSync(); openTaskParameters(target);
      const mode = target.querySelector<HTMLSelectElement>("#tmc-write-temp-mode")!;
      mode.value = "set";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      expect(target.querySelector<HTMLInputElement>("#tmc-write-temp")!.value).toBe("");
      expect(update).not.toHaveBeenCalled();
      await store.updateSettings({ defaultProviderId: "B" });
      ui.flushSync();
      const row = target.querySelector('[data-parameter="temperature"]')!;
      expect(row.textContent).toContain("0.6");
      expect(row.textContent).toContain("B");
      expect(target.querySelector<HTMLInputElement>("#tmc-write-temp")!.value).toBe("");
      expect(store.getSettings().taskModels.write.parameters?.temperature).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
      mode.value = "inherit";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      await update.mock.results[0].value;
      ui.flushSync();
      expect(target.querySelector("#tmc-write-temp")).toBeNull();
      expect(resolveTaskModelSnapshot(store.getSettings(), "write").temperature).toBe(0.6);
      mode.value = "omit";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      await update.mock.results[1].value;
      ui.flushSync();
      expect(store.getSettings().taskModels.write.parameters?.temperature).toBeNull();
      expect(resolveTaskModelSnapshot(store.getSettings(), "write").temperature).toBeUndefined();
      expect(row.textContent).toContain(new I18n().t("settings.taskDetails.omitted"));
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each(["provider", "model"] as const)("labels resolved parameters as blocked when the %s is unavailable", async (missing) => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.research = { apiKey: "", enabled: missing !== "provider", apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: missing === "model" ? "" : "model", defaultEmbedModel: "" };
    settings.taskModels.write = { providerId: "research", model: "", parameters: { maxTokens: 42 } };
    const target = document.body.appendChild(document.createElement("div"));
    const i18n = new I18n();
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "write", config: settings.taskModels.write, providers: settings.providers, defaultProviderId: "research",
      resolved: resolveTaskModelSnapshot(settings, "write"), isDefault: false, i18n, onUpdate: vi.fn(), onReset() {},
    } });
    try {
      ui.flushSync(); openTaskParameters(target);
      const overview = target.querySelector(".cr-task-model-card__overview")!;
      expect(overview.querySelector('[role="status"]')!.textContent).toContain(i18n.t(`settings.taskDetails.${missing}Unavailable`));
      const row = target.querySelector('[data-parameter="maxTokens"]')!;
      expect(row.textContent).toContain("42");
      expect(row.textContent).toContain(i18n.t("settings.taskDetails.resolvedOnly"));
    } finally { await ui.unmount(instance); target.remove(); }
  });

});
