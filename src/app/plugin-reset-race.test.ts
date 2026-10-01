import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import CognitiveRazorPlugin from "../../main.ts";
import { PluginRuntime } from "./plugin-runtime";
import type { SettingsStore } from "../data/settings-store";

vi.mock("../ui/svelte/settings-tab", () => ({ CRSettingTab: class {} }));
vi.mock("../ui/svelte/workbench-view", () => ({ WorkbenchView: class {}, VIEW_TYPE_CR_WORKBENCH: "cr-workbench" }));
vi.mock("../ui/command-dispatcher", () => ({ CommandDispatcher: class { registerAllCommands() {} } }));
vi.mock("../ui/feedback", () => ({ showError: vi.fn() }));

const events: string[] = [];
vi.mock("../data/runtime-data-maintenance", () => ({
  backupAndClearPluginData: vi.fn(async () => {
    events.push("files-cleared");
    return { ok: true, value: undefined };
  }),
}));

describe("backupAndResetRuntimeData race with ensureRuntime", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a fresh workbench after resetting its runtime", async () => {
    const staleLeaf = { detach: vi.fn() };
    let leaves: unknown[] = [staleLeaf];
    const freshLeaf = { setViewState: vi.fn(async () => undefined) };
    const workspace = {
      getLeavesOfType: vi.fn(() => leaves),
      detachLeavesOfType: vi.fn(() => { leaves = []; }),
      getRightLeaf: vi.fn(() => freshLeaf),
      revealLeaf: vi.fn(),
    };
    const plugin = new CognitiveRazorPlugin({} as App, {} as never);
    Object.assign(plugin, {
      app: { vault: {}, workspace },
      manifest: { dir: "plugin" },
      addSettingTab: vi.fn(),
      registerView: vi.fn(),
    });
    await plugin.onload();
    await expect(plugin.getSettingsApplication().resetAndStart()).resolves.toMatchObject({ ok: true });
    await plugin.openWorkbench();

    expect(freshLeaf.setViewState).toHaveBeenCalledWith({ type: "cr-workbench", active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(freshLeaf);
    await plugin.onunload();
  });

  it("disposes an in-flight runtime before clearing files", async () => {
    events.length = 0;
    let ready = false;
    let releaseStart!: () => void;
    const gate = new Promise<void>((resolve) => { releaseStart = resolve; });
    vi.spyOn(PluginRuntime.prototype, "isReady", "get").mockImplementation(() => ready);
    vi.spyOn(PluginRuntime.prototype, "start").mockImplementation(async () => {
      await gate;
      ready = true;
      events.push("runtime-ready");
    });
    vi.spyOn(PluginRuntime.prototype, "dispose").mockImplementation(async () => {
      events.push("runtime-disposed");
    });

    const plugin = new CognitiveRazorPlugin({ vault: {} } as unknown as App, { dir: "plugin" } as never);
    Object.assign(plugin as unknown as Record<string, unknown>, {
      app: { vault: {}, workspace: { detachLeavesOfType: vi.fn() } },
      settingsStore: { getSettings: () => ({}) } as unknown as SettingsStore,
      manifest: { dir: "plugin" },
    });

    const starting = plugin.ensureRuntime();
    const reset = (plugin as unknown as {
      backupAndResetRuntimeData(): Promise<unknown>;
    }).backupAndResetRuntimeData();

    // Let reset reach the await on the in-flight start, then finish start.
    await Promise.resolve();
    releaseStart();
    await Promise.all([reset, starting.catch(() => undefined)]);

    expect(events.indexOf("runtime-disposed")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("runtime-disposed")).toBeLessThan(events.indexOf("files-cleared"));
    const state = plugin as unknown as { runtime?: PluginRuntime };
    expect(state.runtime).toBeUndefined();
  });
});
