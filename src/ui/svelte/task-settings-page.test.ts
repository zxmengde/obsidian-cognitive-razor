import { afterAll, describe, expect, it, vi } from "vitest";
import { I18n } from "../../core/i18n";
import { resolveTaskModelSnapshot } from "../../core/task-model-resolver";
import type { PluginSettings, TaskType } from "../../types";
import { cloneDefaults, createSettingsEnvironment, openTaskPage, settle, type SettingsEnvironment } from "./settings-test-support";

// 任务模型页由原生声明式设置渲染；这里像用户一样进入「任务模型 › 任务 › 能力与参数」操作真实控件。
const i18n = new I18n();
const TASK_NAMES: Record<TaskType, string> = { define: "定义", tag: "标记", write: "撰写", verify: "核查", merge: "合并", cards: "记忆卡片", index: "语义索引" };

async function environment(settings: PluginSettings, saveDelay?: () => Promise<void>) {
  const env = await createSettingsEnvironment({ settings, saveDelay });
  const update = vi.spyOn(env.application, "updateTaskModel");
  return { env, update };
}

/** 设置变化会重绘子页的行，元素必须在每次断言前重新查询。 */
function select(page: HTMLElement, selector: string): HTMLSelectElement {
  const element = page.querySelector<HTMLSelectElement>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

async function change(env: SettingsEnvironment, element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(env.bundle);
}

function parameterRow(page: HTMLElement, key: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`[data-parameter="${key}"]`);
  if (!row) throw new Error(`Missing parameter row: ${key}`);
  return row;
}

afterAll(() => { document.body.replaceChildren(); });

describe("task model settings page", () => {
  it("preserves both task parameter edits when the earlier save is still in progress", async () => {
    const settings = cloneDefaults();
    settings.providers.provider = {
      apiKey: "test", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled",
      defaultChatModel: "model", defaultEmbedModel: "", capabilities: { temperature: true, topP: true },
    };
    settings.defaultProviderId = "provider";
    settings.taskModels.write = { providerId: "provider", model: "model", parameters: { temperature: 0.7, topP: 1 } };
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saveCount = 0;
    const { env, update } = await environment(settings, () => (++saveCount === 1 ? saveGate : Promise.resolve()));
    try {
      const page = await openTaskPage(env, "撰写", true);
      const temperature = page.querySelector<HTMLInputElement>("#tmc-write-temp")!;
      temperature.value = "0.8";
      temperature.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      const topP = page.querySelector<HTMLInputElement>("#tmc-write-topp")!;
      topP.value = "0.9";
      topP.dispatchEvent(new Event("change", { bubbles: true }));
      releaseSave();
      await Promise.all(update.mock.results.map((result) => result.value));
      expect(env.store.getSettings().taskModels.write.parameters).toEqual({ temperature: 0.8, topP: 0.9 });
    } finally { releaseSave(); await env.cleanup(); }
  });

  it("switches a custom task parameter back to the provider value when inherit is selected", async () => {
    const settings = cloneDefaults();
    settings.providers.provider = { apiKey: "test", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled", defaultChatModel: "model", defaultEmbedModel: "", parameters: { maxTokens: 2048 } };
    settings.taskModels.write = { providerId: "provider", model: "model", parameters: { maxTokens: 100 } };
    const { env, update } = await environment(settings);
    try {
      const page = await openTaskPage(env, "撰写", true);
      await change(env, select(page, "#tmc-write-max-tokens-mode"), "inherit");
      expect(update).toHaveBeenCalledOnce();
      await update.mock.results[0].value;
      expect(resolveTaskModelSnapshot(env.store.getSettings(), "write").maxTokens).toBe(2048);
    } finally { await env.cleanup(); }
  });

  it.each([
    ["write", "temp"], ["write", "topp"], ["write", "max-tokens"], ["index", "dimension"],
  ] as const)("keeps empty specified %s/%s local until a real valid value is entered", async (taskType, id) => {
    const settings = cloneDefaults();
    settings.defaultProviderId = "provider";
    settings.providers.provider = {
      apiKey: "", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings",
      defaultChatModel: "model", defaultEmbedModel: "embed", capabilities: { temperature: true, topP: true },
    };
    const { env, update } = await environment(settings);
    try {
      // 首屏只有服务、模型与探针；参数在下一级页面。
      const task = await openTaskPage(env, TASK_NAMES[taskType]);
      expect(task.querySelector(`#tmc-${taskType}-provider`)).not.toBeNull();
      expect(task.querySelector(`#tmc-${taskType}-${id}-mode`)).toBeNull();
      const page = await openTaskPage(env, TASK_NAMES[taskType], true);
      await change(env, select(page, `#tmc-${taskType}-${id}-mode`), "set");
      const input = () => page.querySelector<HTMLInputElement>(`#tmc-${taskType}-${id}`)!;
      expect(input().value).toBe("");
      expect(update).not.toHaveBeenCalled();
      await change(env, input(), "");
      expect(update).not.toHaveBeenCalled();
      expect(input().getAttribute("aria-invalid")).toBe("true");
      await change(env, input(), id === "temp" || id === "topp" ? "0" : "512");
      expect(update).toHaveBeenCalledOnce();
      const key = { temp: "temperature", topp: "topP", "max-tokens": "maxTokens", dimension: "embeddingDimension" }[id];
      expect(update).toHaveBeenCalledWith(taskType, { parameters: { [key]: id === "temp" || id === "topp" ? 0 : 512 } });
    } finally { await env.cleanup(); }
  });

  it("keeps unsupported saved values visible and makes protocol rejection explicit", async () => {
    const settings = cloneDefaults();
    settings.providers.research = {
      apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled",
      defaultChatModel: "model", defaultEmbedModel: "", capabilities: { reasoning: true },
      parameters: { temperature: 0.7 },
    };
    settings.taskModels.write = { providerId: "research", model: "", parameters: { topP: 0.9, thinkingLevel: "HIGH" } };
    const { env, update } = await environment(settings);
    try {
      const page = await openTaskPage(env, "撰写", true);
      const topP = parameterRow(page, "topP");
      expect(topP.textContent).toContain("当前不发送");
      expect(topP.textContent).toContain("0.9");
      expect(topP.textContent).toContain(i18n.t("settings.taskDetails.fromTask"));
      expect(topP.querySelector<HTMLInputElement>("input")!.value).toBe("0.9");
      expect(parameterRow(page, "thinkingLevel").textContent).toContain("发送前拒绝请求");
      expect(update).not.toHaveBeenCalled();
    } finally { await env.cleanup(); }
  });

  it("shows retained sampling as unsent for the exact default reasoning model", async () => {
    const settings = cloneDefaults();
    settings.defaultProviderId = "research";
    settings.providers.research = {
      apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled",
      defaultChatModel: "gpt-6.1-sol", defaultEmbedModel: "", capabilities: { temperature: true, topP: true, reasoning: true },
      parameters: { temperature: 0.2, topP: 0.9 },
    };
    const { env, update } = await environment(settings);
    try {
      const page = await openTaskPage(env, "撰写", true);
      for (const [key, value] of [["temperature", "0.2"], ["topP", "0.9"]]) {
        const row = parameterRow(page, key);
        expect(row.textContent).toContain("当前模型/推理设置不支持此采样参数，未发送");
        expect(row.textContent).toContain(`已配置的值 ${value}`);
        // 未发送时不显示为生效值。
        expect(row.querySelector(".cr-task-value")).toBeNull();
      }
      expect(update).not.toHaveBeenCalled();
    } finally { await env.cleanup(); }
  });

  it("shows Cards inherited service and model without persisting placeholder values", async () => {
    const settings = cloneDefaults();
    settings.defaultProviderId = "research";
    settings.providers.research = { apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "inherited-model", defaultEmbedModel: "" };
    const { env, update } = await environment(settings);
    try {
      const page = await openTaskPage(env, "记忆卡片");
      expect(select(page, "#tmc-cards-provider").value).toBe("");
      expect(page.querySelector("#tmc-cards-model")).toBeNull();
      expect(select(page, "#tmc-cards-model-mode").value).toBe("inherit");
      expect(page.textContent).toContain("inherited-model");
      expect(page.textContent).toContain("继承服务默认模型：inherited-model");
      expect(update).not.toHaveBeenCalled();
      expect(env.save).not.toHaveBeenCalled();
    } finally { await env.cleanup(); }
  });

  it("updates inherited previews without saving an empty specified draft when the default provider changes", async () => {
    const settings = cloneDefaults();
    settings.providers.A = { apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "A-model", defaultEmbedModel: "", capabilities: { temperature: true } };
    settings.providers.B = { ...settings.providers.A, defaultChatModel: "B-model", parameters: { temperature: 0.6 } };
    settings.defaultProviderId = "A";
    const { env, update } = await environment(settings);
    try {
      const page = await openTaskPage(env, "撰写", true);
      await change(env, select(page, "#tmc-write-temp-mode"), "set");
      expect(page.querySelector<HTMLInputElement>("#tmc-write-temp")!.value).toBe("");
      expect(update).not.toHaveBeenCalled();
      await env.store.updateSettings({ defaultProviderId: "B" });
      await settle(env.bundle);
      const row = parameterRow(page, "temperature");
      expect(row.textContent).toContain("0.6");
      expect(row.textContent).toContain("B");
      expect(page.querySelector<HTMLInputElement>("#tmc-write-temp")!.value).toBe("");
      expect(env.store.getSettings().taskModels.write.parameters?.temperature).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
      await change(env, select(page, "#tmc-write-temp-mode"), "inherit");
      await update.mock.results[0].value;
      await settle(env.bundle);
      expect(page.querySelector("#tmc-write-temp")).toBeNull();
      expect(resolveTaskModelSnapshot(env.store.getSettings(), "write").temperature).toBe(0.6);
      await change(env, select(page, "#tmc-write-temp-mode"), "omit");
      await update.mock.results[1].value;
      await settle(env.bundle);
      expect(env.store.getSettings().taskModels.write.parameters?.temperature).toBeNull();
      expect(resolveTaskModelSnapshot(env.store.getSettings(), "write").temperature).toBeUndefined();
      expect(parameterRow(page, "temperature").textContent).toContain(i18n.t("settings.taskDetails.omitted"));
    } finally { await env.cleanup(); }
  });

  it.each(["provider", "model"] as const)("labels resolved parameters as blocked when the %s is unavailable", async (missing) => {
    const settings = cloneDefaults();
    settings.providers.research = { apiKey: "", enabled: missing !== "provider", apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: missing === "model" ? "" : "model", defaultEmbedModel: "" };
    settings.taskModels.write = { providerId: "research", model: "", parameters: { maxTokens: 42 } };
    const { env } = await environment(settings);
    try {
      const task = await openTaskPage(env, "撰写");
      expect(task.querySelector('.cr-task-overview [role="status"]')!.textContent).toContain(i18n.t(`settings.taskDetails.${missing}Unavailable`));
      const page = await openTaskPage(env, "撰写", true);
      const row = parameterRow(page, "maxTokens");
      expect(row.textContent).toContain("42");
      expect(row.textContent).toContain(i18n.t("settings.taskDetails.resolvedOnly"));
    } finally { await env.cleanup(); }
  });

  it("resets a customised task and drops its pending drafts", async () => {
    const settings = cloneDefaults();
    settings.providers.provider = { apiKey: "", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled", defaultChatModel: "model", defaultEmbedModel: "" };
    settings.defaultProviderId = "provider";
    settings.taskModels.write = { providerId: "provider", model: "custom", parameters: { maxTokens: 64 } };
    const { env } = await environment(settings);
    try {
      const params = await openTaskPage(env, "撰写", true);
      await change(env, select(params, "#tmc-write-temp-mode"), "set");
      const task = await openTaskPage(env, "撰写");
      Array.from(task.querySelectorAll<HTMLButtonElement>(".cr-task-overview button")).find((button) => button.textContent === i18n.t("taskModels.reset"))!.click();
      await settle(env.bundle);
      expect(env.application.isTaskModelDefault("write")).toBe(true);
      const reopened = await openTaskPage(env, "撰写", true);
      expect(select(reopened, "#tmc-write-temp-mode").value).toBe("inherit");
    } finally { await env.cleanup(); }
  });
});
