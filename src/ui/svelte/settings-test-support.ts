/**
 * 设置页测试的共享装配（仅测试使用，不进入插件产物）。
 *
 * 设置定义和 Svelte 子页面依赖 .svelte 文件，vitest 直接导入会失败，所以与原测试一样
 * 用 esbuild 打成一个包再求值。包内的 obsidian 指向 __mocks__/obsidian.ts，因此包内的
 * 原生设置对象、菜单与弹窗状态需要从包内导出的 obs 读取，而不是测试顶部的 import。
 */
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { vi, type Mock } from "vitest";
import type { SettingsApplication as SettingsApplicationType, SemanticIndexPort } from "../../app/settings-application";
import { SettingsApplication } from "../../app/settings-application";
import { I18n } from "../../core/i18n";
import { DEFAULT_SETTINGS, SettingsStore } from "../../data/settings-store";
import type { PluginSettings } from "../../types";

/** 包内的 Svelte 组件对外是不透明值，只在 mountSvelteComponent 中使用。 */
type SvelteComponent = Parameters<typeof import("../bridge/mount").mountSvelteComponent>[1];

export interface SettingsBundle {
  CRSettingTab: typeof import("./settings-tab").CRSettingTab;
  readControlValue: typeof import("./settings-tab").readControlValue;
  controlUpdate: typeof import("./settings-tab").controlUpdate;
  buildSettingDefinitions: typeof import("../settings/settings-definitions").buildSettingDefinitions;
  taskEntryState: typeof import("../settings/settings-definitions").taskEntryState;
  definitionsStructureKey: typeof import("../settings/settings-definitions").definitionsStructureKey;
  MaintenanceController: typeof import("../settings/maintenance-controller").MaintenanceController;
  probeService: typeof import("../settings/service-probes").probeService;
  probeServiceWithTask: typeof import("../settings/service-probes").probeServiceWithTask;
  TaskProbeModal: typeof import("../settings/task-probe-modal").TaskProbeModal;
  SvelteSettingPage: typeof import("../settings/svelte-setting-page").SvelteSettingPage;
  TaskPageState: typeof import("../settings/task-page-state").TaskPageState;
  intent: typeof import("../settings-intent");
  mountSvelteComponent: typeof import("../bridge/mount").mountSvelteComponent;
  settingsContextMap: typeof import("../bridge/context").settingsContextMap;
  flushSync: () => void;
  ProviderModal: SvelteComponent;
  LocationsEditor: SvelteComponent;
  MaintenanceResults: SvelteComponent;
  /** 工作台的队列列表包装，用于验证显示偏好只影响展示。 */
  QueueHost: SvelteComponent;
  /** 包内的 obsidian 模拟模块；菜单、弹窗等全局记录只存在于这一份实例中。 */
  obs: typeof import("../../../__mocks__/obsidian");
}

const ENTRY = `
export { mount, unmount, flushSync } from "svelte";
export * from "./src/ui/svelte/settings-tab";
export {
  buildSettingDefinitions, taskEntryState, definitionsStructureKey, serviceSignature, enabledChatServiceIds,
} from "./src/ui/settings/settings-definitions";
export { MaintenanceController } from "./src/ui/settings/maintenance-controller";
export { probeService, probeServiceWithTask, probeDraft } from "./src/ui/settings/service-probes";
export { TaskProbeModal } from "./src/ui/settings/task-probe-modal";
export { SvelteSettingPage } from "./src/ui/settings/svelte-setting-page";
export { TaskPageState } from "./src/ui/settings/task-page-state";
export { mountSvelteComponent } from "./src/ui/bridge/mount";
export { settingsContextMap } from "./src/ui/bridge/context";
export * as intent from "./src/ui/settings-intent";
export * as obs from "obsidian";
export { default as ProviderModal } from "./src/ui/svelte/modals/ProviderModal.svelte";
export { default as LocationsEditor } from "./src/ui/svelte/settings/LocationsEditor.svelte";
export { default as MaintenanceResults } from "./src/ui/svelte/settings/MaintenanceResults.svelte";
export { default as QueueHost } from "queue-host";
`;

const QUEUE_HOST = `<script>
  import Queue from "./src/ui/svelte/workbench/QueueSection.svelte";
  import { setWorkbenchContext } from "./src/ui/bridge/context";
  let { context, tasks, status } = $props();
  setWorkbenchContext(context);
</script>
<Queue {tasks} {status} />`;

let bundlePromise: Promise<SettingsBundle> | undefined;

/** 一次性打包设置相关模块；同一测试文件内复用。 */
export function loadSettingsBundle(): Promise<SettingsBundle> {
  bundlePromise ??= buildBundle();
  return bundlePromise;
}

async function buildBundle(): Promise<SettingsBundle> {
  // 原生设置与 Obsidian 的 DOM 扩展依赖 empty()；只在缺失时补齐，清理时不删除，避免影响同进程的其他测试。
  if (!("empty" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  }
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "SettingsTestBundle",
    conditions: ["svelte", "browser"],
    mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [
      {
        name: "queue-host",
        setup(builder) {
          builder.onResolve({ filter: /^queue-host$/ }, ({ path }) => ({ path, namespace: "test-host" }));
          builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({
            resolveDir: process.cwd(),
            contents: compile(QUEUE_HOST, { filename: "QueueHost.svelte", css: "injected" }).js.code,
          }));
        },
      },
      sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } }),
    ],
  });
  return new Function(`${result.outputFiles[0].text}; return SettingsTestBundle;`)() as SettingsBundle;
}

export interface SettingsEnvironmentOptions {
  settings: PluginSettings;
  semanticIndex?: SemanticIndexPort;
  /** 第一次保存写盘失败；之后的保存正常。 */
  failFirstSave?: boolean;
  /** 保存写盘前等待的门闸，用于制造进行中的保存。 */
  saveDelay?: () => Promise<void>;
}

export interface SettingsEnvironment {
  bundle: SettingsBundle;
  i18n: I18n;
  store: SettingsStore;
  application: SettingsApplicationType;
  tab: InstanceType<SettingsBundle["CRSettingTab"]>;
  save: Mock;
  probe: Mock;
  ensure: Mock;
  reset: Mock;
  /** 宿主错误上报记录（reportHostError 的调用参数）。 */
  reported: unknown[][];
  /** 设置页之外挂载 Svelte 子树时使用的上下文，与原生子页面相同。 */
  context(): Map<unknown, unknown>;
  cleanup(): Promise<void>;
}

/**
 * 装配一个真实的设置标签页：真实 SettingsStore / SettingsApplication，探针与语义索引用替身。
 * 标签页挂到 body 并渲染一次，行为与宿主打开设置页一致。
 */
export async function createSettingsEnvironment(options: SettingsEnvironmentOptions): Promise<SettingsEnvironment> {
  const bundle = await loadSettingsBundle();
  const i18n = new I18n();
  let failNext = options.failFirstSave ?? false;
  const save = vi.fn(async () => {
    await options.saveDelay?.();
    if (failNext) {
      failNext = false;
      throw new Error("synthetic disk failure");
    }
  });
  const store = new SettingsStore({ loadData: async () => structuredClone(options.settings), saveData: save } as never);
  await store.loadSettings();
  const probe = vi.fn(async () => ({ ok: true as const, value: { chat: true, embedding: true } }));
  const ensure = vi.fn(async () => options.semanticIndex ?? ({} as SemanticIndexPort));
  const reset = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const application = new SettingsApplication({
    settingsStore: store,
    providerProbe: { probe } as never,
    ensureSemanticIndex: ensure,
    resetRuntimeData: reset,
  });
  const reported: unknown[][] = [];
  const disposers: Array<() => void> = [];
  const plugin = {
    getI18n: () => i18n,
    getSettingsApplication: () => application,
    register: (dispose: () => void) => { disposers.push(dispose); },
    reportHostError: (...args: unknown[]) => { reported.push(args); },
  };
  const tab = new bundle.CRSettingTab({} as never, plugin as never);
  document.body.appendChild(tab.containerEl);
  tab.display();
  return {
    bundle, i18n, store, application, tab, save, probe, ensure, reset, reported,
    context: () => bundle.settingsContextMap({ app: {} as never, i18n, settingsApplication: application }),
    cleanup: async () => {
      for (const dispose of disposers.splice(0)) dispose();
      tab.containerEl.remove();
      application.dispose();
    },
  };
}

/** 测试用：拿到一份可修改的默认设置副本。 */
export function cloneDefaults(): PluginSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

/** 给 vitest 的断言用：一次宏任务后刷新 Svelte 状态。 */
export async function settle(bundle: SettingsBundle): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  bundle.flushSync();
}

/**
 * 找到原生设置行（按名称精确匹配）。名称后面可能跟着「默认」「已停用」等徽标，
 * 所以只比较名称本身的文本节点。
 */
export function findRow(root: ParentNode, name: string): HTMLElement {
  const row = Array.from(root.querySelectorAll<HTMLElement>(".setting-item"))
    .find((element) => element.querySelector(":scope > .setting-item-info > .setting-item-name")?.firstChild?.textContent?.trim() === name);
  if (!row) throw new Error(`Missing setting row: ${name}`);
  return row;
}

/** 找到按钮（按可见文字精确匹配）。 */
export function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((element) => element.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

/** 宿主侧的标签页操作面（由 __mocks__/obsidian.ts 的 SettingTab 提供）。 */
export interface HostSettingTab {
  containerEl: HTMLElement;
  openedPage: { title: string; containerEl: HTMLElement; page?: unknown } | undefined;
  openPage(definition: unknown): unknown;
  closePage(): void;
}

export function hostTab(env: SettingsEnvironment): HostSettingTab {
  return env.tab as unknown as HostSettingTab;
}

/** 像用户一样点击页面行的入口按钮，返回打开的子页容器。 */
export async function openSettingsPage(env: SettingsEnvironment, name: string): Promise<HTMLElement> {
  const row = findRow(env.tab.containerEl, name);
  row.querySelector<HTMLElement>('[role="button"]')!.click();
  await settle(env.bundle);
  const opened = hostTab(env).openedPage;
  if (!opened) throw new Error(`Settings page did not open: ${name}`);
  return opened.containerEl;
}

/** 在已打开的页面容器中点击某一行的入口，返回新打开的子页容器。 */
export async function openNestedPage(env: SettingsEnvironment, container: HTMLElement, name: string): Promise<HTMLElement> {
  findRow(container, name).querySelector<HTMLElement>('[role="button"]')!.click();
  await settle(env.bundle);
  const opened = hostTab(env).openedPage;
  if (!opened) throw new Error(`Nested page did not open: ${name}`);
  return opened.containerEl;
}

/**
 * 打开「任务模型 › 某任务」页；with parameters 时再进入「能力与参数」。
 * 返回的容器在设置变化后会被重绘替换其中的行，断言前要重新查询元素。
 */
export async function openTaskPage(env: SettingsEnvironment, taskName: string, parameters = false): Promise<HTMLElement> {
  const models = await openSettingsPage(env, env.i18n.t("settings.native.taskModels"));
  const task = await openNestedPage(env, models, taskName);
  return parameters ? openNestedPage(env, task, env.i18n.t("settings.taskDetails.advanced")) : task;
}

/** 返回上一级（关闭当前子页）。 */
export async function closeSettingsPage(env: SettingsEnvironment): Promise<void> {
  hostTab(env).closePage();
  await settle(env.bundle);
}
