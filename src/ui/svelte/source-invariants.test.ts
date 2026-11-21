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
    // Filter/batch markup moved to its own component; the section keeps the wiring.
    const management = read("src/ui/svelte/workbench/QueueManagementPanel.svelte");

    expect(list).toContain("task.state === 'failed'");
    expect(list).toContain("formatStandardName");
    expect(list).not.toContain("NAMING_TEMPLATE");
    expect(list).not.toContain("TYPE_LABELS");
    expect(section).not.toContain("queue.cancelAllActive()");
    expect(list).not.toContain("cr-task-progress");
    expect(section).toContain("queue.retryFailed()");
    expect(section).toContain("queue.removeTerminal()");
    expect(section).toContain("selectedIds");
    expect(management).toContain("TASK_STAGE_IDS");
    expect(management).toContain("stageFilter");
    expect(list).toContain("onretry");
    expect(list).toContain("onremove");
    expect(section).toMatch(/catch\s*(?:\([^)]*\))?\s*\{/);
    expect(section).not.toContain("queue.reorder");
    expect(list).not.toContain("draggable");
    expect(list).not.toContain("ondrag");
    expect(management).not.toContain("draggable");
    expect(management).not.toContain("ondrag");
    expect(management).not.toContain("failureGroups");
    expect(management).not.toContain("providerAttempts");
    expect(management).not.toContain("modelSnapshot");
    expect(management).not.toContain("error.message");
    expect(management).not.toContain("queueStatus.details");
    expect(management).not.toContain("queueStatus.failureSummary");
    expect(list).toContain("queueTaskFeedback");
    expect(list).not.toContain("task.error.message");

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

  it("keeps Workbench feedback projected and sends note actions through one Notice service", () => {
    const files = [
      "src/ui/svelte/workbench/CreateSection.svelte",
      "src/ui/svelte/workbench/CurrentNoteSection.svelte",
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
    // 笔记操作（核查、卡片）在「当前笔记」区，经同一 Notice 服务反馈。
    expect(read("src/ui/svelte/workbench/CurrentNoteSection.svelte")).toContain("showActionFeedback");
    expect(read("src/ui/svelte/workbench/ExpandPanel.svelte")).toContain("showActionFeedback");
    expect(read("src/ui/svelte/workbench/ExpandPanel.svelte")).not.toContain("InlineAlert");
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

  it("exposes missing-vector and vector-file maintenance controls in settings", () => {
    const controller = read("src/ui/settings/maintenance-controller.ts");
    const definitions = read("src/ui/settings/settings-definitions.ts");
    const results = read("src/ui/svelte/settings/MaintenanceResults.svelte");
    expect(controller).toContain("this.settingsApplication.scanSemanticIndex()");
    expect(controller).toContain("this.settingsApplication.embedMissingSemanticIndex()");
    expect(controller).toContain("this.settingsApplication.embedOneSemanticIndex(cruid)");
    expect(controller).toContain("this.settingsApplication.inspectVectorFiles()");
    expect(controller).toContain("this.settingsApplication.cleanupOrphanedVectorFiles(report.orphanFiles)");
    expect(definitions).toContain("maintenance.scanSemanticIndex()");
    expect(definitions).toContain("maintenance.scanVectorFiles()");
    expect(definitions).toContain("app.rebuildSemanticIndex()");
    expect(results).toContain("controller.embedMissing()");
    expect(results).toContain("controller.embedOne(note.cruid)");
    expect(definitions).toContain("settings.advanced.semanticIndexing.cleanupVectorFilesConfirm");
  });

  it("keeps single-note vector maintenance in settings and cards in the workbench", () => {
    const source = read("src/ui/svelte/workbench/CurrentNoteSection.svelte");
    expect(source).not.toContain("rebuildCurrentNote");
    expect(source).toContain("application.cards.start");
    expect(read("src/ui/settings/settings-definitions.ts")).toContain("maintenance.rebuildSpecifiedNote(notePath)");
  });

  it("keeps host/runtime access outside settings and workbench code", () => {
    const workbench = read("src/ui/svelte/workbench-view.ts");
    const context = read("src/ui/bridge/context.ts");
    const settingsFiles = [
      "src/ui/svelte/settings-tab.ts",
      "src/ui/settings/settings-definitions.ts",
      "src/ui/settings/maintenance-controller.ts",
      "src/ui/settings/service-probes.ts",
      "src/ui/settings/task-probe-modal.ts",
      "src/ui/settings/svelte-setting-page.ts",
    ];

    expect(workbench).not.toContain("PluginRuntime");
    for (const file of settingsFiles) {
      expect(read(file), file).not.toContain("PluginRuntime");
      expect(read(file), file).not.toContain("ensureRuntime");
    }
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
      expect(read(file), file).not.toMatch(/(?<![A-Za-z0-9_])#[0-9a-fA-F]{3,8}(?![A-Za-z0-9_])|rgba?\(/);
    }
    expect(read("styles.css")).toContain("--cr-bg-cover: var(--background-modifier-cover);");
  });

  // 已知违例：LocationsEditor.svelte 的 .mod-warning 写成 var(--text-warning, var(--cr-status-warning))，带了回退值。
  // 去掉回退、直接使用 var(--cr-status-warning) 后，把此处改为普通 it。
  it("keeps fallback values out of var() in scoped UI styles", () => {
    for (const file of collectSvelteSources("src/ui")) {
      expect(read(file), file).not.toMatch(/var\(--[^)]*,/);
    }
  });

  it("defines every plugin-owned visual token used by production components", () => {
    const sources = [read("styles.css"), ...collectSvelteSources("src/ui").map(read)].join("\n");
    const defined = new Set([...sources.matchAll(/(--cr-[\w-]+)\s*:/g)].map(match => match[1]));
    const used = new Set([...sources.matchAll(/var\((--cr-[\w-]+)/g)].map(match => match[1]));
    expect([...used].filter(token => !defined.has(token))).toEqual([]);
    expect(read("styles.css")).toContain("--cr-overlay-warning-10:");
    expect(read("styles.css")).toContain(".cr-scope .cr-btn-primary { font-weight: 600; }");
    // 原生设置页不再自绘下拉框：select 规则不得用 background 简写覆盖宿主背景。
    const selectBodies = [...read("styles.css").matchAll(/\.cr-scope[^{}]*\bselect\b[^{}]*\{([^}]+)\}/g)].map(match => match[1]);
    expect(selectBodies.length).toBeGreaterThan(0);
    for (const body of selectBodies) expect(body).not.toMatch(/(?:^|;)\s*background\s*:/);
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
    const probes = read("src/ui/settings/service-probes.ts");
    const definitions = read("src/ui/settings/settings-definitions.ts");
    const tab = read("src/ui/svelte/settings-tab.ts");
    const modal = read("src/ui/svelte/modals/ProviderModal.svelte");

    expect(probes).toContain("settingsApplication.testProvider(request, signal)");
    expect(probes).toContain("toProviderProbeReadModel");
    expect(definitions).toContain("ProviderProbeStatus");
    expect(definitions).toContain('run("manual-retry")');
    expect(modal).toContain("ProviderProbeStatus");
    expect(modal).toContain("manual-retry");
    expect(modal).not.toContain("chatError");
    for (const source of [probes, definitions, tab]) {
      expect(source).not.toContain("checkProviderConnection");
      expect(source).not.toContain("ensureRuntime()");
      expect(source).not.toContain("showSuccess");
      expect(source).not.toContain("showError");
    }
  });

  it("organizes settings in the native section order and removes the old tab components", () => {
    // 源文件可能是 CRLF 换行，比较前统一成 LF，避免多行锚点因换行符失配。
    const definitions = read("src/ui/settings/settings-definitions.ts").replace(/\r\n/g, "\n");
    const start = definitions.indexOf("  return [\n    saveFailed,");
    expect(start).toBeGreaterThan(-1);
    const block = definitions.slice(start);
    let cursor = 0;
    for (const token of ["services,", 'heading: n("models")', 'heading: n("notes")', "generation,", "display,", 'heading: n("advanced")']) {
      const index = block.indexOf(token, cursor);
      expect(index, token).toBeGreaterThan(-1);
      cursor = index;
    }
    expect(definitions).toContain("host.sveltePage(title, TaskDetails, () => ({ taskType }), `task:${taskType}`)");
    expect(definitions).toContain('host.sveltePage(n("locations"), LocationsEditor, () => ({}))');
    for (const file of [
      "BackupTab", "MaintenanceTab", "ProviderCard", "ProvidersTab", "SettingItem",
      "SettingsNav", "SettingsRoot", "SettingsSection", "WorkflowTab",
      "DataTab", "AdvancedTab", "GeneralTab", "SystemTab",
    ]) {
      expect(existsSync(`src/ui/svelte/settings/${file}.svelte`), file).toBe(false);
    }
  });

  it("keeps ordinary settings save feedback in the native read model", () => {
    const tab = read("src/ui/svelte/settings-tab.ts");
    const definitions = read("src/ui/settings/settings-definitions.ts");

    expect(tab).toContain("settingsApplication.subscribeSaveState");
    expect(definitions).toContain('visible: () => app.getSaveState().status === "save-failed"');
    expect(definitions).toContain("app.retryLastSave()");
    expect(definitions).toContain('t("settings.save.failed")');
    for (const source of [tab, definitions]) {
      expect(source).not.toContain("reportSettingsSaveResult");
      expect(source).not.toContain("showSuccess");
      expect(source).not.toContain("showError");
      expect(source).not.toContain("settingsStore.updateSettings");
    }
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
      "src/ui/svelte/settings/LocationsEditor.svelte",
      "src/ui/svelte/settings/MaintenanceResults.svelte",
      "src/ui/svelte/settings/ProviderProbeStatus.svelte",
      "src/ui/svelte/settings/TaskDetails.svelte",
      "src/ui/svelte/settings/TaskModelCard.svelte",
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

    expect(shell).toContain("dialogEl?.ownerDocument");
    expect(shell).toContain("ownerWindow.addEventListener('keydown', handleKeydown)");
    expect(shell).toContain("ownerWindow.removeEventListener('keydown', handleKeydown)");
    expect(shell).not.toContain("<svelte:window");
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
    const definitions = read("src/ui/settings/settings-definitions.ts");
    const controller = read("src/ui/settings/maintenance-controller.ts");
    const results = read("src/ui/svelte/settings/MaintenanceResults.svelte");
    const tab = read("src/ui/svelte/settings-tab.ts");

    expect(definitions).toContain('key: "enableSemanticIndexing"');
    expect(definitions).toContain('key: "enableDuplicateDetection"');
    expect(definitions).toContain("app.rebuildSemanticIndex()");
    expect(definitions).toContain("app.cancelSemanticIndexRebuild()");
    expect(definitions).toContain("app.getSemanticIndexRebuildState()");
    expect(definitions).toContain("host.confirm(");
    expect(results).toContain("rebuildDuplicateFailed");
    expect(controller).toContain("this.settingsApplication.getSemanticIndexRebuildState().status");
    expect(tab).toContain("subscribeSemanticIndexRebuildState");
    expect(tab).toContain("this.settingsApplication.cancelSemanticIndexRebuild()");
    expect(definitions).not.toContain("plugin.ensureRuntime()");
    expect(definitions).not.toContain("viewActive");
    expect(definitions).not.toContain("groundingSearch");
    expect(definitions).not.toContain("...settings.directoryScheme");
    expect(read("src/ui/svelte/settings/LocationsEditor.svelte")).toContain("settingsApplication.updateSettings(candidate)");
    expect(tab).toContain("settings.taskTimeoutMs / 1000");
    expect(tab).toContain("taskTimeoutMs: Number(value) * 1000");
  });

  it("shows unavailable task assignments and uses user-scale provider controls", () => {
    const tab = read("src/ui/svelte/settings-tab.ts");
    const definitions = read("src/ui/settings/settings-definitions.ts");
    const taskModel = read("src/ui/svelte/settings/TaskModelCard.svelte");

    expect(tab).toContain("settings.providerTimeoutMs / 1000");
    expect(tab).toContain("providerTimeoutMs: Number(value) * 1000");
    expect(definitions).toContain("VIRTUAL_CONTROL_KEYS.providerTimeoutSeconds");
    expect(definitions).toContain("settings.advanced.queue.providerMaxAttempts");
    expect(definitions).toContain('key: "enableStreamingKeepalive"');
    expect(definitions).toContain("warning: Boolean(summary.issue) && !waitingDefault");
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
    const tab = read("src/ui/svelte/settings-tab.ts");
    const definitions = read("src/ui/settings/settings-definitions.ts");

    expect(expand).toContain("loadGeneration");
    expect(expand).toContain("generation !== loadGeneration");
    expect(expand).toContain("const submissionGeneration = loadGeneration");
    expect(expand).toContain("submissionGeneration === loadGeneration");
    expect(expand).not.toContain("replaceSelection(getCreatableIndices(result.value))");
    expect(expand).toContain("String(selected.size)");
    expect(read("src/ui/svelte/settings/TaskDetails.svelte")).toContain("settingsApplication.updateTaskModel(type, partial)");
    expect(definitions).not.toContain("TaskModelCard");
    expect(tab).toContain("settingsApplication.updateProvider(nextId, config)");
    expect(tab + definitions).not.toContain("sanitizeTaskModelsForProvider");
  });

  it("guards user-triggered async actions against duplicate submission", () => {
    const create = read("src/ui/svelte/workbench/CreateSection.svelte");
    const note = read("src/ui/svelte/workbench/CurrentNoteSection.svelte");
    const duplicates = read("src/ui/svelte/workbench/DuplicatesSection.svelte");
    const duplicateItem = read("src/ui/svelte/workbench/DuplicateItem.svelte");

    expect(note).toContain("if (!activeFile || !isCRNode || verifying || verifyUnavailable) return");
    expect(note).toContain("disabled={!isCRNode || verifying || verifyUnavailable}");
    expect(note).toContain("{#if verifying}");
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
