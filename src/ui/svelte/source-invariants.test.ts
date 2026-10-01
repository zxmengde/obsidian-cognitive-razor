import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { CR_TYPES } from "../../types";
import { TASK_TYPES } from "../../data/settings-store";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function collectSvelteSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectSvelteSources(path);
    return entry.isFile() && entry.name.endsWith(".svelte") ? [path] : [];
  });
}

function collectRuntimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectRuntimeSources(path);
    if (!entry.isFile() || entry.name.endsWith(".test.ts")) return [];
    return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
  });
}

function stripUiComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("current UI architecture", () => {
  it("keeps the queue workbench minimal and stage-driven", () => {
    const list = read("src/ui/svelte/workbench/QueueTaskList.svelte");
    const section = read("src/ui/svelte/workbench/QueueSection.svelte");

    expect(list).toContain("task.state === 'failed'");
    expect(list).toContain("formatStandardName");
    expect(list).not.toContain("NAMING_TEMPLATE");
    expect(list).not.toContain("TYPE_LABELS");
    expect(section).toContain("queue.cancelAllActive()");
    expect(section).toContain("queue.retryFailed()");
    expect(section).toContain("queue.removeTerminal()");
    expect(section).toContain("selectedIds");
    expect(section).toContain("TASK_STAGE_IDS");
    expect(section).toContain("stageFilter");
    expect(list).toContain("onretry");
    expect(list).toContain("onremove");
    expect(section).toMatch(/catch\s*(?:\([^)]*\))?\s*\{/);
    expect(section).not.toContain("queue.reorder");
    expect(list).not.toContain("draggable");
    expect(list).not.toContain("ondrag");
    expect(section).not.toContain("draggable");
    expect(section).not.toContain("ondrag");
    expect(section).not.toContain("failureGroups");
    expect(section).not.toContain("providerAttempts");
    expect(section).not.toContain("modelSnapshot");
    expect(section).not.toContain("error.message");
    expect(section).not.toContain("queueStatus.details");
    expect(section).not.toContain("queueStatus.failureSummary");
    expect(list).not.toContain("task.error");

    const locale = JSON.parse(read("src/locales/zh.json")) as {
      workbench: { queueStatus: Record<string, unknown> };
    };
    for (const key of [
      "attempt", "providerAttempts", "filterType", "allTypes", "details", "note",
      "queuePosition", "failureSummary", "items", "model", "reasoningEffort", "maxTokens",
      "failureStage", "failureStages", "duration", "createdAt", "startedAt", "finishedAt",
      "filePath", "notAvailable",
    ]) {
      expect(locale.workbench.queueStatus).not.toHaveProperty(key);
    }
  });

  it("keeps Workbench feedback local and free of technical error details", () => {
    const files = [
      "src/ui/svelte/workbench/CreateSection.svelte",
      "src/ui/svelte/workbench/DuplicatesSection.svelte",
      "src/ui/svelte/workbench/ExpandPanel.svelte",
      "src/ui/svelte/workbench/QueueSection.svelte",
      "src/ui/svelte/workbench/QueueTaskList.svelte",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain("showSuccess");
      expect(source).not.toContain("showError");
      expect(source).not.toContain("[${");
    }
    expect(read("src/ui/svelte/workbench/CreateSection.svelte")).not.toContain("cr-search-btn");
    expect(read("src/ui/svelte/workbench/ExpandPanel.svelte")).not.toContain("cr-link-btn");
    expect(read("src/ui/svelte/workbench/QueueTaskList.svelte")).not.toContain("toSafeErrorFeedback");
  });

  it("waits on the shared runtime promise instead of polling", () => {
    const source = read("src/ui/svelte/workbench-view.ts");

    expect(source).toContain("await this.plugin.ensureWorkbenchApplication()");
    expect(source).toContain("openGeneration");
    expect(source).toContain("await previousCleanup()");
    expect(source).toContain("await cleanup?.()");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("initializationPollId");
  });

  it("keeps main.ts as a lightweight host and leaves indexing config to runtime", () => {
    const source = read("main.ts");

    expect(source).toContain("ensureRuntime");
    expect(source).toContain("registerView");
    expect(source).not.toContain("ServiceContainer");
    expect(source).not.toContain("SERVICE_TOKENS");
    expect(source).not.toContain("ProviderManager");
    expect(source).not.toContain("resolveVectorIndexConfig");
    expect(source).not.toContain("taskModels?.index?.embeddingDimension");
  });

  it("lets Obsidian add the plugin prefix to command IDs exactly once", () => {
    const source = read("src/ui/command-utils.ts");

    expect(source).toContain('OPEN_WORKBENCH: "open-workbench"');
    expect(source).toContain('VERIFY_CURRENT_NOTE: "verify-current-note"');
    expect(source).not.toContain("cognitive-razor:");
  });

  it("formats command errors before sending them to the feedback layer", () => {
    const source = read("src/ui/command-dispatcher.ts");

    // Commands funnel every failure through the shared projection; startup
    // failures keep their own diagnostic there, coded errors keep the mapping.
    expect(source).toContain("toHostErrorFeedback(error");
    expect(source).toContain("i18n.format(");
    expect(source).not.toContain("showError(error,");
    expect(source).not.toContain("showSuccess");
  });

  it("keeps the workbench free of Projection and Recovery surfaces", () => {
    const root = read("src/ui/svelte/workbench/WorkbenchRoot.svelte");
    const bridge = read("src/ui/bridge/reactive.svelte.ts");
    expect(root).not.toContain("RecoverySection");
    expect(root).not.toContain("application.recovery");
    expect(bridge).not.toContain("createRecoveryStore");
  });

  it("exposes missing-vector maintenance controls in settings", () => {
    const source = read("src/ui/svelte/settings/MaintenanceTab.svelte");
    expect(source).toContain("scanSemanticIndex");
    expect(source).toContain("embedMissingSemanticIndex");
    expect(source).toContain("embedOneSemanticIndex");
    expect(source).toContain("rebuildSemanticIndex");
    expect(source).toContain("inspectVectorFiles");
    expect(source).toContain("cleanupOrphanedVectorFiles");
    expect(source).toContain("cleanupVectorFilesConfirm");
  });

  it("keeps single-note vector maintenance in settings and cards in the workbench", () => {
    const source = read("src/ui/svelte/workbench/CreateSection.svelte");
    expect(source).not.toContain("rebuildCurrentNote");
    expect(source).toContain("application.cards.start");
    expect(read("src/ui/svelte/settings/MaintenanceTab.svelte")).toContain("rebuildSpecifiedNote");
  });

  it("keeps host/runtime access outside Svelte settings and workbench code", () => {
    const workbench = read("src/ui/svelte/workbench-view.ts");
    const settings = read("src/ui/svelte/settings/WorkflowTab.svelte");
    const context = read("src/ui/bridge/context.ts");

    expect(workbench).not.toContain("PluginRuntime");
    expect(settings).not.toContain("PluginRuntime");
    expect(settings).not.toContain("ensureRuntime");
    expect(context).not.toContain("CognitiveRazorPlugin");
  });

  it("keeps host view and provider modal errors on the shared safe UI projection", () => {
    const view = read("src/ui/svelte/workbench-view.ts");
    const provider = read("src/ui/svelte/modals/ProviderModal.svelte");
    const projection = read("src/ui/error-feedback.ts");

    expect(projection).toContain("export function toSafeErrorFeedback");
    expect(projection).toContain("export function toHostErrorFeedback");
    expect(view).toContain("toHostErrorFeedback(");
    expect(view).not.toContain("error.message");
    expect(provider).toContain("toSafeErrorFeedback(result");
    expect(provider).not.toContain("safeErrorMessage");
  });

  it("keeps host lifecycle diagnostics behind the Logger boundary", () => {
    for (const file of ["main.ts", "src/app/plugin-runtime.ts", "src/ui/svelte/settings-tab.ts"]) {
      expect(read(file), file).not.toContain("console.");
    }
    expect(read("main.ts")).toContain("reportHostError");
    expect(read("src/data/logger.ts")).toContain("reportHostDiagnostic");
  });

  it("keeps host user feedback on the locale source", () => {
    const main = read("main.ts");

    expect(main).toContain("this.i18n.messages.host.settingsLoadFailed");
    expect(main).toContain("this.i18n.messages.host.externalSettingsInvalid");
    expect(main).not.toContain("Cognitive Razor 设置读取失败，已使用当前可用设置");
    expect(main).not.toContain("Cognitive Razor 外部设置无效，已使用当前可用设置");
  });

  it("keeps scoped UI styles on the centralized token mapping", () => {
    for (const file of collectSvelteSources("src/ui")) {
      const source = read(file);
      expect(source, file).not.toMatch(/var\(--[^)]*,/);
      expect(source, file).not.toMatch(/(?<![A-Za-z0-9_])#[0-9a-fA-F]{3,8}(?![A-Za-z0-9_])|rgba?\(/);
    }

    expect(read("styles.css")).toContain(
      "--cr-bg-cover: var(--background-modifier-cover);",
    );
  });

  it("keeps user-visible UI copy in the locale source", () => {
    const files = [...collectSvelteSources("src/ui"), "src/ui/svelte/workbench-view.ts"];
    const bareChineseLiteral = /"[^"\r\n]*[\u4e00-\u9fff][^"\r\n]*"|'[^'\r\n]*[\u4e00-\u9fff][^'\r\n]*'|`[^`\r\n]*[\u4e00-\u9fff][^`\r\n]*`/;

    for (const file of files) {
      expect(stripUiComments(read(file)), file).not.toMatch(bareChineseLiteral);
    }

    const confirm = read("src/ui/components/ConfirmModal.svelte");
    const password = read("src/ui/components/PasswordInput.svelte");
    const alert = read("src/ui/components/InlineAlert.svelte");
    const feedback = read("src/ui/feedback.ts");

    expect(confirm).toContain("confirmLabel: string");
    expect(confirm).toContain("cancelLabel: string");
    expect(confirm).not.toContain("confirmLabel =");
    expect(password).toContain("showLabel: string");
    expect(password).toContain("hideLabel: string");
    expect(alert).toContain("detailsToggleLabels");
    expect(feedback).not.toContain("fallback ??");
  });

  it("resolves every static copy key referenced from runtime code", () => {
    const locale = JSON.parse(read("src/locales/zh.json")) as Record<string, unknown>;
    const resolveKey = (key: string): unknown => key
      .split(".")
      .reduce<unknown>((value, part) => (
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined
      ), locale);
    // Template keys such as `settings.tabs.${tab}` cannot be resolved here and
    // are intentionally skipped: the closing quote must follow the literal.
    const pattern = /(?:\bi18n\.t|\bt|\.t|i18n\.format)\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
    const missing: string[] = [];

    for (const file of [...collectRuntimeSources("src"), "main.ts"]) {
      for (const match of read(file).matchAll(pattern)) {
        const key = match[1];
        if (!key.includes(".")) continue;
        if (typeof resolveKey(key) !== "string") missing.push(`${file}: ${key}`);
      }
    }

    // A missing key is rendered verbatim to the user instead of the copy.
    expect(missing).toEqual([]);
  });

  it("resolves every copy key generated from a code enumeration", () => {
    const locale = JSON.parse(read("src/locales/zh.json")) as Record<string, unknown>;
    const resolveKey = (key: string): unknown => key
      .split(".")
      .reduce<unknown>((value, part) => (
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined
      ), locale);
    const families: Array<[string, readonly string[]]> = [
      ["crTypes", CR_TYPES],
      ["crTypeDirectories", CR_TYPES],
      ["settings.tabs", ["providers", "workflow", "backup"]],
      ["settings.provider.probe.outcome", ["success", "partial", "failed", "uncertain"]],
      ["settings.provider.probe.status", ["available", "unavailable", "disabled"]],
      ["settings.advanced.semanticIndexing.rebuildPhases", ["scanning", "embedding", "committing", "duplicates"]],
    ];
    const missing: string[] = [];

    for (const [prefix, values] of families) {
      const node = resolveKey(prefix);
      for (const value of values) {
        const entry = node && typeof node === "object"
          ? (node as Record<string, unknown>)[value]
          : undefined;
        if (typeof entry !== "string") missing.push(`${prefix}.${value}`);
      }
    }
    for (const taskType of TASK_TYPES) {
      for (const field of ["name", "desc"]) {
        if (typeof resolveKey(`taskModels.tasks.${taskType}.${field}`) !== "string") {
          missing.push(`taskModels.tasks.${taskType}.${field}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("tests provider connections without starting the vault runtime", () => {
    const source = read("src/ui/svelte/settings/ProvidersTab.svelte");
    const card = read("src/ui/svelte/settings/ProviderCard.svelte");
    const modal = read("src/ui/svelte/modals/ProviderModal.svelte");

    expect(source).toContain("ctx.settingsApplication.testProvider");
    expect(source).toContain("toProviderProbeReadModel");
    expect(card).toContain("ProviderProbeStatus");
    expect(modal).toContain("ProviderProbeStatus");
    expect(card).toContain("manual-retry");
    expect(modal).toContain("manual-retry");
    expect(source).not.toContain("checkProviderConnection");
    expect(source).not.toContain("ensureRuntime()");
    expect(source).not.toContain("showSuccess");
    expect(source).not.toContain("showError");
    expect(card).not.toContain("chatError");
    expect(modal).not.toContain("chatError");
  });

  it("organizes settings around providers, workflow, and backup", () => {
    const source = read("src/ui/svelte/settings/SettingsRoot.svelte");

    expect(source).toContain("'providers' | 'workflow' | 'backup'");
    expect(source).toContain("<ProvidersTab {expandedTask} />");
    expect(source).toContain("<WorkflowTab onConfigureTask={configureTask} />");
    expect(source).toContain("<MaintenanceTab />");
    expect(read("src/ui/svelte/settings/MaintenanceTab.svelte")).toContain("<BackupTab />");
    expect(existsSync("src/ui/svelte/settings/DataTab.svelte")).toBe(false);
    expect(existsSync("src/ui/svelte/settings/AdvancedTab.svelte")).toBe(false);
    expect(existsSync("src/ui/svelte/settings/GeneralTab.svelte")).toBe(false);
    expect(existsSync("src/ui/svelte/settings/SystemTab.svelte")).toBe(false);
  });

  it("keeps ordinary settings save feedback in the shared in-place read model", () => {
    const root = read("src/ui/svelte/settings/SettingsRoot.svelte");
    const providers = read("src/ui/svelte/settings/ProvidersTab.svelte");
    const workflow = read("src/ui/svelte/settings/WorkflowTab.svelte");
    const backup = read("src/ui/svelte/settings/BackupTab.svelte");
    const section = read("src/ui/svelte/settings/SettingsSection.svelte");

    expect(root).toContain("settingsApplication.subscribeSaveState");
    expect(root).toContain("settings.save.saved");
    expect(root).toContain("settingsApplication.retryLastSave()");
    expect(root).toContain("<Button");
    expect(providers).not.toContain("reportSettingsSaveResult");
    expect(providers).not.toContain("notices.providerAdded");
    expect(workflow).not.toContain("reportSettingsSaveResult");
    expect(backup).not.toContain("reportSettingsSaveResult");
    expect(backup).not.toContain("showSuccess");
    expect(backup).not.toContain("showError");
    expect(providers).toContain("<SettingsSection");
    expect(workflow).toContain("<SettingsSection");
    expect(backup).toContain("<SettingsSection");
    expect(section).toContain("cr-settings-section__header");
    expect(providers).not.toContain("cr-settings-group");
    expect(workflow).not.toContain("cr-settings-section h3");
    expect(providers).not.toContain("class=\"cr-btn-");
    expect(read("src/ui/svelte/settings/ProviderCard.svelte")).not.toContain("class=\"cr-btn-");
    expect(read("src/ui/svelte/settings/TaskModelCard.svelte")).not.toContain("class=\"cr-btn-");
    expect(workflow).not.toContain("settingsStore.updateSettings");
    expect(providers).not.toContain("settingsStore");
    expect(workflow).not.toContain("settingsStore");
    expect(root).not.toContain("settingsStore");
    expect(existsSync("src/ui/settings-save.ts")).toBe(false);
    expect(existsSync("src/ui/settings-save.test.ts")).toBe(false);
  });

  it("keeps settings listener diagnostics behind the logger port", () => {
    const store = read("src/data/settings-store.ts");
    const application = read("src/app/settings-application.ts");

    expect(store).toContain("设置监听器执行失败");
    expect(application).toContain("保存状态监听器执行失败");
    expect(store).not.toContain("console.error");
    expect(application).not.toContain("console.error");
  });

  it("keeps settings UI on the application read port", () => {
    const context = read("src/ui/bridge/context.ts");
    const settingsTab = read("src/ui/svelte/settings-tab.ts");
    const workbenchView = read("src/ui/svelte/workbench-view.ts");
    const main = read("main.ts");

    expect(context).not.toContain("SettingsStore");
    expect(settingsTab).not.toContain("getSettingsStore");
    expect(workbenchView).not.toContain("getSettingsStore");
    expect(main).not.toContain("getSettingsStore");
  });

  it("uses the shared settings token system", () => {
    const files = [
      "src/ui/svelte/settings/BackupTab.svelte",
      "src/ui/svelte/settings/ProviderCard.svelte",
      "src/ui/svelte/settings/ProviderProbeStatus.svelte",
      "src/ui/svelte/settings/ProvidersTab.svelte",
      "src/ui/svelte/settings/SettingItem.svelte",
      "src/ui/svelte/settings/SettingsNav.svelte",
      "src/ui/svelte/settings/SettingsSection.svelte",
      "src/ui/svelte/settings/TaskModelCard.svelte",
      "src/ui/svelte/settings/WorkflowTab.svelte",
    ];
    for (const file of files) {
      expect(read(file)).not.toMatch(/var\(--cr-[^)]*,/);
    }
  });

  it("keeps embedding capability selection separate from chat protocol", () => {
    const modal = read("src/ui/svelte/modals/ProviderModal.svelte");
    const taskModel = read("src/ui/svelte/settings/TaskModelCard.svelte");

    expect(modal).toContain("embeddingApiFormat: formEmbeddingApiFormat");
    expect(modal).toContain("embeddingApiFormats.openaiEmbeddings");
    expect(modal).toContain("embeddingApiFormats.disabled");
    expect(modal).not.toContain("formEmbeddingApiFormat = formApiFormat");
    expect(taskModel).toContain("provider.embeddingApiFormat === 'openai-embeddings'");
  });

  it("centralizes modal focus and keyboard lifecycle", () => {
    const shell = read("src/ui/components/ModalShell.svelte");
    const confirm = read("src/ui/components/ConfirmModal.svelte");
    const provider = read("src/ui/svelte/modals/ProviderModal.svelte");

    expect(shell).toContain("<svelte:window onkeydown={handleKeydown} />");
    expect(shell).toContain("previousActiveElement.isConnected");
    expect(shell).toContain("aria-modal=\"true\"");
    expect(confirm).toContain("<ModalShell");
    expect(provider).toContain("<ModalShell");
    expect(confirm).not.toContain("getFocusableElements");
    expect(provider).not.toContain("getFocusableElements");
    expect(provider).toContain("testAbortController?.abort('provider modal unmounted')");
  });

  it("locks provider editing while saving and invalidates stale connection tests", () => {
    const shell = read("src/ui/components/ModalShell.svelte");
    const provider = read("src/ui/svelte/modals/ProviderModal.svelte");

    expect(shell).toContain("dismissible = true");
    expect(shell).toContain("if (dismissible) oncancel();");
    expect(provider).toContain("dismissible={!saving}");
    expect(provider).toContain("if (saving) return;");
    expect(provider).toContain("testedSignature");
    expect(provider).not.toContain("supportsNativeWebSearchLimit");
    expect(provider).toContain("provider configuration changed");
    expect(provider).toContain("invalidateConnectionTest('provider configuration saved')");
    expect(provider).toContain("testAbortController = undefined;");
    expect(provider).toContain("testing = false;");
    expect(provider).toContain("buildTestSignature() !== requestSignature");
    expect(provider).toContain("disabled={saving}");
  });

  it("separates everyday indexing settings from maintenance without a second search service", () => {
    const workflow = read("src/ui/svelte/settings/WorkflowTab.svelte");
    const source = read("src/ui/svelte/settings/MaintenanceTab.svelte");

    expect(source).toContain("settings.enableSemanticIndexing");
    expect(source).toContain("settings.enableDuplicateDetection");
    expect(source).toContain("settingsApplication.rebuildSemanticIndex");
    expect(source).toContain("settingsApplication.cancelSemanticIndexRebuild()");
    expect(source).toContain("subscribeSemanticIndexRebuildState");
    expect(source).toContain("rebuildState.status");
    expect(source).not.toContain("plugin.ensureRuntime()");
    expect(source).not.toContain("viewActive");
    expect(source).toContain("rebuildDuplicateFailed");
    expect(source).toContain("<ConfirmModal");
    expect(source).not.toContain("groundingSearch");
    expect(source).toContain("value={settings.taskTimeoutMs / 1000}");
    expect(source).toContain("taskTimeoutMs: value * 1000");
    expect(source).toContain("ariaLabel=");
    expect(workflow).toContain("directoryScheme: { [key]: value }");
    expect(workflow).not.toContain("rebuildSemanticIndex()");
    expect(source).not.toContain("...settings.directoryScheme");
  });

  it("shows unavailable task assignments and uses user-scale provider controls", () => {
    const providers = read("src/ui/svelte/settings/ProvidersTab.svelte");
    const workflow = read("src/ui/svelte/settings/MaintenanceTab.svelte");
    const taskModel = read("src/ui/svelte/settings/TaskModelCard.svelte");

    expect(workflow).toContain("settings.providerTimeoutMs / 1000");
    expect(workflow).toContain("providerTimeoutMs: value * 1000");
    expect(workflow).toContain("settings.providerMaxAttempts");
    expect(workflow).toContain("settings.enableStreamingKeepalive");
    expect(workflow).toContain("enableStreamingKeepalive: value");
    expect(providers).not.toContain("settings.providerTimeoutMs / 1000");
    expect(providers).toContain("providerUnavailable");
    expect(taskModel).toContain("providerUnavailable");
    expect(taskModel).toContain("aria-label={parameterLabel(key)}");
    expect(taskModel).toContain("aria-describedby={`${parameterId(key)}-desc");
    expect(taskModel).toContain("positiveIntegerError");
    expect(taskModel).toContain("Number.isSafeInteger");
    expect(taskModel).toContain("showLongTaskReasoningWarning");
    expect(taskModel).toContain("longTaskReasoningWarning");
    expect(taskModel).toContain("maxTokens: 'max-tokens'");
  });

  it("never persists a placeholder task parameter when 指定值 has no real value", () => {
    const taskModel = read("src/ui/svelte/settings/TaskModelCard.svelte");
    const parameters = read("src/ui/task-model-parameters.ts");

    // 旧的兜底分支会把 maxTokens/embeddingDimension 写成 1：嵌入维度 1 会立刻
    // 重置整个向量索引，maxTokens=1 会截断下一次任务输出。
    expect(taskModel).toContain("resolveParameterWrite");
    expect(taskModel).toContain("pendingSetKeys");
    expect(taskModel).not.toContain("thinkingBudget' ? 1024");
    expect(parameters).toContain('{ action: "pending" }');
  });

  it("prevents stale expand loads and stale nested settings snapshots", () => {
    const expand = read("src/ui/svelte/workbench/ExpandPanel.svelte");
    const providers = read("src/ui/svelte/settings/ProvidersTab.svelte");
    const workflowSettings = read("src/ui/svelte/settings/WorkflowTab.svelte");

    expect(expand).toContain("loadGeneration");
    expect(expand).toContain("generation !== loadGeneration");
    expect(expand).toContain("const submissionGeneration = loadGeneration");
    expect(expand).toContain("submissionGeneration === loadGeneration");
    expect(expand).not.toContain("replaceSelection(getCreatableIndices(result.value))");
    expect(expand).toContain("String(selected.size)");
    expect(providers).toContain("settingsApplication.updateTaskModel(type, partial)");
    expect(workflowSettings).not.toContain("<TaskModelCard");
    expect(providers).toContain("ctx.settingsApplication.updateProvider(id, config)");
    expect(providers).not.toContain("sanitizeTaskModelsForProvider");
  });

  it("guards user-triggered async actions against duplicate submission", () => {
    const create = read("src/ui/svelte/workbench/CreateSection.svelte");
    const duplicates = read("src/ui/svelte/workbench/DuplicatesSection.svelte");
    const duplicateItem = read("src/ui/svelte/workbench/DuplicateItem.svelte");

    expect(create).toContain("if (!activeFile || verifying) return");
    expect(create).toContain("loading={verifying}");
    expect(create).toContain("defineAbortController?.abort('create panel unmounted')");
    expect(create).toContain("application.create.define(inputValue.trim(), controller.signal)");
    expect(duplicates).toContain("dismissingIds.has(pair.id)");
    expect(duplicateItem).toContain("loading={dismissing}");
    expect(duplicateItem).not.toContain("cursor: pointer");
  });

  it("keeps merge parents editable one link per line", () => {
    const merge = read("src/ui/svelte/workbench/MergeModal.svelte");

    // Text inputs sanitize their value by stripping newlines, so rendering
    // newline-separated parents in one silently collapsed every link into a
    // single broken value as soon as the user edited the field.
    const singleLine = document.createElement("input");
    singleLine.type = "text";
    singleLine.value = "[[甲]]\n[[乙]]";
    expect(singleLine.value).toBe("[[甲]][[乙]]");
    const multiline = document.createElement("textarea");
    multiline.value = "[[甲]]\n[[乙]]";
    expect(multiline.value).toBe("[[甲]]\n[[乙]]");

    expect(merge).toContain("<textarea bind:value={parents}");
    expect(merge).not.toContain("<TextInput value={parents}");
  });
});
