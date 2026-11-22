import type { SettingDefinition, SettingDefinitionPage, TextComponent } from "obsidian";
import type { ModelCapabilities, PluginSettings, TaskModelConfig, TaskType } from "../../types";
import { taskSettingsSummary } from "../settings-summaries";
import { toProviderProbeReadModel } from "../provider-probe-result";
import { resolveParameterValue, resolveParameterWrite, storedParameterMode, type TaskParameterMode } from "../task-model-parameters";
import {
  describeTaskParameter,
  taskCapabilitySource,
  taskParameterInputs,
  type ParameterSource,
  type TaskParameterKey,
} from "../task-parameter-summary";
import type { SettingsDefinitionsHost } from "./settings-definitions";
import type { TaskProbeRecord } from "./task-page-state";
import ProviderProbeStatus from "../svelte/settings/ProviderProbeStatus.svelte";

type BooleanCapability = "nativeWebSearch" | "promptCaching" | "responseContinuation";

/** 声明式子页面不在设置标签页的 .cr-scope 容器内；插件颜色令牌定义在 .cr-scope 上，分组需自带。 */
const SCOPE = "cr-scope";

const PARAMETER_IDS: Record<TaskParameterKey, string> = {
  temperature: "temp", topP: "topp", reasoning_effort: "reasoning", thinkingLevel: "thinking-level",
  thinkingBudget: "thinking-budget", maxTokens: "max-tokens", embeddingDimension: "dimension",
};
const PARAMETER_LABELS: Record<TaskParameterKey, string> = {
  temperature: "temperature", topP: "topP", reasoning_effort: "reasoningEffort", thinkingLevel: "thinkingLevel",
  thinkingBudget: "thinkingBudget", maxTokens: "maxTokens", embeddingDimension: "embeddingDimension",
};
/** 搜索时也能用请求里的参数名找到对应行。 */
const PARAMETER_ALIASES: Record<TaskParameterKey, string[]> = {
  temperature: ["temperature"], topP: ["top_p", "topP"], reasoning_effort: ["reasoning_effort", "推理"],
  thinkingLevel: ["thinking level", "思考"], thinkingBudget: ["thinking budget", "思考"],
  maxTokens: ["max_tokens", "最大输出"], embeddingDimension: ["dimensions", "维度"],
};

interface Line {
  text: string;
  tone?: "warning" | "error";
  role?: "status" | "alert";
  id?: string;
  cls?: string;
}

/** 说明区按行写入，警告与错误带语义类名；读屏通过 role 播报状态变化。 */
function writeLines(descEl: HTMLElement, lines: Line[]): void {
  const doc = descEl.ownerDocument;
  descEl.replaceChildren(...lines.map((line) => {
    const node = doc.createElement("div");
    node.textContent = line.text;
    node.className = [line.tone ? `cr-setting-${line.tone}` : "", line.cls ?? ""].join(" ").trim();
    if (line.role) node.setAttribute("role", line.role);
    if (line.id) node.id = line.id;
    return node;
  }));
}

/**
 * 单个任务的原生设置子页面。首屏只有生效配置、服务、模型与探针；
 * 参数与能力放在下一级子页面。每行都由原生 Setting 渲染，名称与说明进入设置搜索。
 */
export function buildTaskPage(
  host: SettingsDefinitionsHost,
  taskType: TaskType,
  entry: { desc: string; value: string; warning: boolean },
): SettingDefinitionPage {
  const { i18n, settingsApplication: app, taskState } = host;
  const t = (key: string) => i18n.t(key);
  const text = (key: string) => i18n.t(`settings.taskDetails.${key}`);
  const settings: PluginSettings = app.getSettings();
  const config: TaskModelConfig = settings.taskModels[taskType];
  const providers = settings.providers;
  const summary = taskSettingsSummary(settings, taskType);
  const resolved = summary.resolved;
  // 草稿按需取：宿主可能沿用较早构建的定义树，期间关闭过设置页会换掉草稿对象。
  const draftOf = () => taskState.draft(taskType);
  const title = t(`settings.redesign.tasks.${taskType}`);
  const isEmbeddingTask = taskType === "index";
  const activeProvider = providers[resolved.providerId];
  const activeApiFormat = activeProvider?.apiFormat;
  const providerAvailable = Boolean(activeProvider?.enabled && (isEmbeddingTask
    ? activeProvider.embeddingApiFormat === "openai-embeddings" : activeProvider.apiFormat !== "disabled"));
  const requestBlocked = !providerAvailable || !resolved.model.trim();
  const inheritedModel = isEmbeddingTask ? activeProvider?.defaultEmbedModel : activeProvider?.defaultChatModel;
  const isDefault = app.isTaskModelDefault(taskType);
  const update = (partial: Partial<TaskModelConfig>) => { void app.updateTaskModel(taskType, partial); };

  // ---- 生效配置 ----
  const overview: SettingDefinition = {
    name: i18n.t("settings.native.taskResolved"),
    searchable: false,
    render: (setting) => {
      setting.setClass("cr-task-overview");
      setting.setName(`${resolved.providerId || text("providerMissing")} · ${resolved.model || text("modelMissing")}`);
      const lines: Line[] = [{ text: text(isDefault ? "defaultConfig" : "customConfig") }, { text: text("resolvedHint") }];
      if (!providerAvailable) lines.push({ text: text("providerUnavailable"), tone: "warning", role: "status" });
      else if (!resolved.model.trim()) lines.push({ text: text("modelUnavailable"), tone: "warning", role: "status" });
      if (isEmbeddingTask) lines.push({ text: t("settings.redesign.indexChangeWarning") });
      writeLines(setting.descEl, lines);
      if (!isDefault) {
        setting.addButton((button) => button.setButtonText(t("taskModels.reset")).onClick(() => {
          taskState.resetDraft(taskType);
          void app.resetTaskModel(taskType);
        }));
      }
    },
  };

  // ---- 服务 ----
  const providerOptions: Record<string, string> = {
    "": isEmbeddingTask && providers[settings.defaultProviderId]?.embeddingApiFormat !== "openai-embeddings"
      ? t("taskModels.fields.defaultProviderNoEmbedding") : text("defaultProvider"),
  };
  for (const [id, provider] of Object.entries(providers)) {
    if (provider.enabled && (isEmbeddingTask ? provider.embeddingApiFormat === "openai-embeddings" : provider.apiFormat !== "disabled")) {
      providerOptions[id] = `${id}${id === settings.defaultProviderId ? ` · ${text("default")}` : ""}`;
    }
  }
  if (config.providerId && !(config.providerId in providerOptions)) {
    providerOptions[config.providerId] = `${config.providerId} (${t("taskModels.fields.providerUnavailable")})`;
  }
  const providerRow: SettingDefinition = {
    name: text("provider"),
    desc: config.providerId ? text("fromTask") : text("defaultProviderHint"),
    aliases: [title],
    render: (setting) => {
      setting.setName(text("provider")).setDesc(config.providerId ? text("fromTask") : text("defaultProviderHint"));
      setting.addDropdown((dropdown) => {
        dropdown.addOptions(providerOptions).setValue(config.providerId).onChange((value) => update({ providerId: value }));
        dropdown.selectEl.id = `tmc-${taskType}-provider`;
      });
    },
  };

  // ---- 模型 ----
  const modelMode = draftOf().pendingModel || config.model.trim() ? "specified" : "inherit";
  const handleModelMode = (value: string) => {
    draftOf().modelDraft = undefined; draftOf().modelError = ""; draftOf().pendingModel = false;
    if (value === "inherit") update({ model: "" });
    else if (!config.model.trim()) {
      if (inheritedModel?.trim()) update({ model: inheritedModel.trim() });
      else { draftOf().pendingModel = true; draftOf().modelDraft = ""; }
    }
    host.refresh();
  };
  const handleModelChange = (value: string) => {
    draftOf().modelDraft = value;
    if (!value.trim()) {
      draftOf().pendingModel = true;
      draftOf().modelError = t("settings.product.modelRequired");
    } else {
      draftOf().modelError = ""; draftOf().pendingModel = false; draftOf().modelDraft = undefined;
      update({ model: value.trim() });
    }
    host.refresh();
  };
  const modelDesc = config.model.trim() ? text("modelSpecified") : `${text("modelInherited")}${inheritedModel || text("modelMissing")}`;
  const modelRow: SettingDefinition = {
    name: text("model"),
    desc: modelDesc,
    aliases: [title, t("settings.product.modelMode")],
    render: (setting) => {
      const lines: Line[] = [{ text: modelDesc }];
      if (draftOf().modelError) lines.push({ text: draftOf().modelError, tone: "error", role: "alert", id: `tmc-${taskType}-model-error` });
      setting.setName(text("model"));
      writeLines(setting.descEl, lines);
      setting.addDropdown((dropdown) => {
        dropdown.addOption("inherit", t("settings.product.inheritModel")).addOption("specified", t("settings.product.specifiedModel"))
          .setValue(modelMode).onChange(handleModelMode);
        dropdown.selectEl.id = `tmc-${taskType}-model-mode`;
        dropdown.selectEl.setAttribute("aria-label", t("settings.product.modelMode"));
      });
      if (modelMode === "specified") {
        setting.addText((input) => {
          input.setValue(draftOf().modelDraft ?? config.model).setPlaceholder(inheritedModel || text("modelMissing"));
          configureInput(input, `tmc-${taskType}-model`, text("model"), Boolean(draftOf().modelError), draftOf().modelError ? `tmc-${taskType}-model-error` : undefined);
          // 输入中的文字也记入草稿（不重绘），离开页面再回来仍在。
          input.inputEl.addEventListener("input", () => { draftOf().modelDraft = input.inputEl.value; });
          input.inputEl.addEventListener("change", () => handleModelChange(input.inputEl.value));
        });
      }
    },
  };

  // ---- 参数 ----
  const parameterInputs = (key: TaskParameterKey) => taskParameterInputs(key, config, activeProvider);
  const parameterKeys: TaskParameterKey[] = (() => {
    if (isEmbeddingTask) return ["embeddingDimension"];
    const keys: TaskParameterKey[] = ["temperature", "topP"];
    const present = (key: TaskParameterKey) => resolveParameterValue(parameterInputs(key)) !== undefined || config.parameters?.[key] === null;
    if (activeApiFormat === "gemini-generative-language") {
      keys.push("thinkingLevel");
      if (present("reasoning_effort")) keys.push("reasoning_effort");
    } else if (activeApiFormat === "anthropic-messages") {
      keys.push("reasoning_effort", "thinkingBudget");
      if (present("thinkingLevel")) keys.push("thinkingLevel");
    } else {
      keys.push("reasoning_effort");
      for (const key of ["thinkingLevel", "thinkingBudget"] as const) if (present(key)) keys.push(key);
    }
    keys.push("maxTokens");
    return keys;
  })();
  const parameterLabel = (key: TaskParameterKey) => key === "temperature" || key === "maxTokens"
    ? text(key) : t(`taskModels.fields.${PARAMETER_LABELS[key]}`);
  const parameterId = (key: TaskParameterKey) => `tmc-${taskType}-${PARAMETER_IDS[key]}`;
  const parameterMode = (key: TaskParameterKey): TaskParameterMode =>
    draftOf().pendingSetKeys.includes(key) ? "set" : storedParameterMode(parameterInputs(key));
  const parameterValue = (key: TaskParameterKey): string => {
    const local = draftOf().draftValues[key];
    if (local !== undefined) return local;
    const inputs = parameterInputs(key);
    if (inputs.hasOverride && inputs.override === null) return "";
    const value = resolveParameterValue(inputs);
    return value === undefined ? "" : String(value);
  };
  const sourceText = (source: ParameterSource) =>
    source === "provider" ? `${text("fromProvider")}${resolved.providerId}` : text(source === "task" ? "fromTask" : "notConfigured");
  const writeParameter = (key: TaskParameterKey, value: unknown) => update({ parameters: { [key]: value } as NonNullable<TaskModelConfig["parameters"]> });
  const handleParameterMode = (key: TaskParameterKey, mode: string) => {
    const write = resolveParameterWrite(mode as TaskParameterMode, parameterInputs(key));
    taskState.clearParameter(taskType, key);
    if (write.action === "pending") {
      draftOf().pendingSetKeys = [...draftOf().pendingSetKeys, key];
      draftOf().draftValues[key] = "";
    } else {
      writeParameter(key, write.action === "delete" ? undefined : write.action === "omit" ? null : write.value);
    }
    host.refresh();
  };
  const handleParameterChange = (key: TaskParameterKey, raw: string) => {
    const value = raw.trim();
    draftOf().draftValues[key] = raw;
    // 校验提示只存在草稿里，需要重绘才能显示。
    host.refresh();
    if (!value) {
      draftOf().parameterErrors[key] = text("valueRequired");
      draftOf().pendingSetKeys = [...new Set([...draftOf().pendingSetKeys, key])];
      return;
    }
    if (key === "reasoning_effort" || key === "thinkingLevel") {
      taskState.clearParameter(taskType, key);
      writeParameter(key, value);
      return;
    }
    const parsed = Number(value);
    if (key === "temperature" || key === "topP") {
      const max = key === "temperature" ? 2 : 1;
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
        draftOf().parameterErrors[key] = text(key === "temperature" ? "temperatureError" : "topPError");
        return;
      }
    } else if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      draftOf().parameterErrors[key] = t("taskModels.fields.positiveIntegerError");
      return;
    }
    taskState.clearParameter(taskType, key);
    writeParameter(key, parsed);
  };
  const parameterLines = (key: TaskParameterKey): Line[] => {
    const parameter = describeTaskParameter(key, config, resolved);
    const retained = () => ({ text: `${text("retainedValue")}${String(parameter.configuredValue)} · ${sourceText(parameter.source)}${text("retainedHint")}` });
    const lines: Line[] = [];
    if (parameter.omitted) {
      lines.push({ text: text("omitted") }, { text: text("fromTask") });
    } else if (parameter.samplingSuppressed) {
      lines.push({ text: text("samplingSuppressed"), tone: "warning" }, retained());
    } else if (parameter.unsupported) {
      lines.push({ text: text("notSent"), tone: "warning" }, { text: text("unsupported"), tone: "warning" });
      if (parameter.configuredValue !== undefined) lines.push(retained());
    } else if (parameter.value !== undefined) {
      if (requestBlocked) lines.push({ text: text("resolvedOnly") });
      lines.push({ text: `${String(parameter.value)} · ${sourceText(parameter.source)}`, cls: "cr-task-value" });
    } else {
      lines.push({ text: text("unset") });
    }
    if (parameter.protocolIssue) lines.push({ text: text(`protocol.${parameter.protocolIssue}`), tone: "warning", role: "status" });
    if (draftOf().pendingSetKeys.includes(key)) lines.push({ text: text("pendingValue") });
    const error = draftOf().parameterErrors[key];
    if (error) lines.push({ text: error, tone: "error", role: "alert", id: `${parameterId(key)}-error` });
    return lines;
  };
  const parameterRow = (key: TaskParameterKey): SettingDefinition => ({
    name: parameterLabel(key),
    aliases: [title, ...PARAMETER_ALIASES[key]],
    render: (setting) => {
      const id = parameterId(key);
      const mode = parameterMode(key);
      setting.setClass("cr-task-parameter");
      setting.settingEl.dataset.parameter = key;
      setting.setName(parameterLabel(key));
      setting.descEl.id = `${id}-desc`;
      writeLines(setting.descEl, parameterLines(key));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("inherit", text("inherit")).addOption("set", text("specified")).addOption("omit", t("taskModels.fields.doNotSend"))
          .setValue(mode).onChange((value) => handleParameterMode(key, value));
        dropdown.selectEl.id = `${id}-mode`;
        dropdown.selectEl.setAttribute("aria-label", `${parameterLabel(key)} · ${text("mode")}`);
      });
      if (mode !== "set") return;
      setting.addText((input) => {
        const error = draftOf().parameterErrors[key];
        if (key !== "reasoning_effort" && key !== "thinkingLevel") {
          const sampling = key === "temperature" || key === "topP";
          input.inputEl.type = "number";
          input.inputEl.min = sampling ? "0" : "1";
          if (sampling) input.inputEl.max = key === "temperature" ? "2" : "1";
          input.inputEl.step = sampling ? "any" : "1";
        }
        input.setValue(parameterValue(key)).setPlaceholder(text("enterValue"));
        configureInput(input, id, parameterLabel(key), Boolean(error), `${id}-desc`);
        input.inputEl.addEventListener("input", () => { draftOf().draftValues[key] = input.inputEl.value; });
        input.inputEl.addEventListener("change", () => handleParameterChange(key, input.inputEl.value));
      });
    },
  });
  const longTaskReasoning: SettingDefinition = {
    name: t("taskModels.fields.longTaskReasoningWarning"),
    searchable: false,
    visible: (taskType === "write" || taskType === "verify") && ["high", "xhigh", "max"].includes(resolved.reasoningEffort ?? ""),
    render: (setting) => {
      setting.setClass("cr-setting-note");
      setting.setName("");
      writeLines(setting.descEl, [{ text: t("taskModels.fields.longTaskReasoningWarning"), tone: "warning", role: "status" }]);
    },
  };

  // ---- 能力 ----
  const capabilityKeys: BooleanCapability[] = [
    ...(taskType === "write" || taskType === "verify" ? ["nativeWebSearch" as const] : []),
    // 提示词缓存支持 OpenAI Responses 与 Anthropic Messages；续传仅支持 Responses。
    ...(activeApiFormat === "openai-responses" || activeApiFormat === "anthropic-messages" ? ["promptCaching" as const] : []),
    ...(activeApiFormat === "openai-responses" && taskType !== "cards" ? ["responseContinuation" as const] : []),
  ];
  const capabilitySource = (key: keyof ModelCapabilities) => {
    const source = taskCapabilitySource(key, config, activeProvider);
    return source === "none" ? text("pluginDefault") : sourceText(source);
  };
  const capabilityRow = (key: BooleanCapability): SettingDefinition => {
    const value = config.capabilities?.[key];
    const effective = key === "promptCaching" && !resolved.capabilities[key]
      ? t("taskModels.fields.promptCachingDisabled")
      : t(`taskModels.fields.${resolved.capabilities[key] ? "enabled" : "disabled"}`);
    const lines: Line[] = [{ text: `${effective} · ${capabilitySource(key)}` }];
    if (key === "promptCaching") lines.push({ text: t("taskModels.fields.promptCachingDesc") });
    return {
      name: t(`taskModels.fields.${key}`),
      aliases: [title],
      render: (setting) => {
        setting.setName(t(`taskModels.fields.${key}`));
        writeLines(setting.descEl, lines);
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", text("inherit")).addOption("true", t("taskModels.fields.enabled"))
            .addOption("false", t(key === "promptCaching" ? "taskModels.fields.promptCachingDisabled" : "taskModels.fields.disabled"))
            .setValue(value === undefined ? "" : String(value))
            .onChange((next) => update({ capabilities: { [key]: next === "" ? undefined : next === "true" } }));
          dropdown.selectEl.id = `tmc-${taskType}-${key}`;
        });
      },
    };
  };
  const note = (name: string, lines: string[]): SettingDefinition => ({
    name,
    searchable: false,
    render: (setting) => {
      setting.setClass("cr-setting-note");
      setting.setName("");
      writeLines(setting.descEl, lines.map((line) => ({ text: line })));
    },
  });
  const overrideCount = Object.values(config.parameters ?? {}).filter((value) => value !== undefined).length
    + Object.values(config.capabilities ?? {}).filter((value) => value !== undefined).length;
  const advanced: SettingDefinitionPage = {
    type: "page",
    name: text("advanced"),
    desc: text("modeHint"),
    displayValue: overrideCount === 0
      ? i18n.t("settings.native.taskParamsInherited")
      : i18n.format("settings.native.taskModelsCustomized", { count: overrideCount }),
    items: [
      {
        type: "group",
        cls: SCOPE,
        heading: i18n.t("settings.native.taskParameters"),
        items: [note(text("modeHint"), [text("modeHint"), text("emptySpecifiedHint")]), ...parameterKeys.map(parameterRow), longTaskReasoning],
      },
      {
        type: "group",
        cls: SCOPE,
        heading: text("capabilities"),
        visible: !isEmbeddingTask,
        items: [note(text("capabilitiesHint"), [text("capabilitiesHint"), text("capabilityHint")]), ...capabilityKeys.map(capabilityRow)],
      },
    ],
  };

  // ---- 探针 ----
  const probeSignature = JSON.stringify(resolved);
  const probeRow: SettingDefinition = {
    name: t("settings.product.taskProbe"),
    desc: t("settings.product.taskProbeHint"),
    aliases: [title],
    render: (setting) => {
      const doc = setting.settingEl.ownerDocument;
      setting.setName(t("settings.product.taskProbe"));
      writeLines(setting.descEl, [{ text: t("settings.product.taskProbeHint") }]);
      const resultEl = doc.createElement("div");
      resultEl.className = "cr-service-probe";
      setting.descEl.appendChild(resultEl);
      const record = taskState.probe(taskType, probeSignature);
      const run = (attemptReason: "initial" | "manual-retry") => runTaskProbe(host, taskType, probeSignature, attemptReason);
      setting.addButton((button) => button
        .setButtonText(record?.controller ? i18n.t("settings.native.testing") : i18n.t("settings.native.taskProbeRun"))
        .setDisabled(Boolean(summary.issue) || Boolean(record?.controller))
        .onClick(() => run("initial")));
      if (!record?.result) return;
      return host.mount(resultEl, ProviderProbeStatus, {
        result: record.result, i18n, retrying: Boolean(record.controller), onretry: () => run("manual-retry"),
      });
    },
  };

  return {
    type: "page",
    name: title,
    desc: entry.desc,
    displayValue: entry.value,
    status: entry.warning ? "warning" : null,
    items: [{ type: "group", cls: SCOPE, items: [overview, providerRow, modelRow, advanced, probeRow] }],
  };
}

function configureInput(input: TextComponent, id: string, label: string, invalid: boolean, describedBy?: string): void {
  input.inputEl.id = id;
  input.inputEl.spellcheck = false;
  input.inputEl.setAttribute("aria-label", label);
  if (invalid) input.inputEl.setAttribute("aria-invalid", "true");
  if (describedBy) input.inputEl.setAttribute("aria-describedby", describedBy);
}

/** 用任务实际解析的服务、模型与参数发起一次探针；结果按解析签名保存，配置变化即作废。 */
async function runTaskProbe(host: SettingsDefinitionsHost, taskType: TaskType, signature: string, attemptReason: "initial" | "manual-retry"): Promise<void> {
  const { settingsApplication: app, taskState } = host;
  const summary = taskSettingsSummary(app.getSettings(), taskType);
  const current = taskState.probe(taskType, signature);
  if (current?.controller || summary.issue || !summary.resolved.providerSnapshot) return;
  const snapshot = structuredClone(summary.resolved);
  const config = snapshot.providerSnapshot!;
  const record: TaskProbeRecord = { signature, controller: new AbortController() };
  taskState.setProbe(taskType, record);
  host.refresh();
  const target = {
    scope: taskType, providerId: snapshot.providerId, model: snapshot.model,
    ...(taskType === "index" && snapshot.embeddingDimension !== undefined ? { requestedDimensions: snapshot.embeddingDimension } : {}),
  };
  const signal = record.controller!.signal;
  try {
    const result = await app.testProvider({ providerId: snapshot.providerId, configOverride: config, taskType, taskConfig: snapshot, attemptReason }, signal);
    if (!signal.aborted) record.result = toProviderProbeReadModel(result, config, target);
  } catch {
    if (!signal.aborted) record.result = toProviderProbeReadModel({ ok: false, error: { code: "E500_INTERNAL_ERROR", message: "" } }, config, target);
  } finally {
    record.controller = undefined;
    if (taskState.isCurrentProbe(taskType, record)) host.refresh();
  }
}

