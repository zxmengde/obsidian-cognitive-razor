import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import CognitiveRazorPlugin from "../../main.ts";
import { PluginRuntime } from "./plugin-runtime";
import type { SettingsStore } from "../data/settings-store";

vi.mock("../../src/ui/svelte/settings-tab", () => ({
  CRSettingTab: class {},
}));
vi.mock("../../src/ui/svelte/workbench-view", () => ({
  WorkbenchView: class {},
  VIEW_TYPE_CR_WORKBENCH: "cr-workbench",
}));
vi.mock("../../src/ui/command-dispatcher", () => ({
  CommandDispatcher: class {},
}));
vi.mock("../../src/ui/feedback", () => ({
  showError: vi.fn(),
}));

function createPlugin(): CognitiveRazorPlugin {
  const plugin = new CognitiveRazorPlugin({} as App, { dir: "plugin" } as never);
  Object.assign(plugin as unknown as Record<string, unknown>, {
    settingsStore: {} as SettingsStore,
    manifest: { dir: "plugin" },
  });
  return plugin;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CognitiveRazorPlugin runtime ownership", () => {
  it("routes host diagnostics to the active runtime logger", () => {
    const plugin = createPlugin();
    const logger = { error: vi.fn() };
    Object.assign(plugin as unknown as Record<string, unknown>, {
      runtime: { logger },
    });

    plugin.reportHostError("Plugin", "cleanup failed", new Error("boom"));

    expect(logger.error).toHaveBeenCalledWith(
      "Plugin",
      "cleanup failed",
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("does not emit fallback host diagnostics when logging is silent", () => {
    const plugin = createPlugin();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.assign(plugin as unknown as Record<string, unknown>, {
      settingsStore: { getSettings: () => ({ logLevel: "silent" }) } as SettingsStore,
    });

    plugin.reportHostError("Plugin", "cleanup failed", new Error("boom"));

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shares concurrent initialization and drops the settled promise", async () => {
    let ready = false;
    vi.spyOn(PluginRuntime.prototype, "isReady", "get").mockImplementation(() => ready);
    const start = vi.spyOn(PluginRuntime.prototype, "start").mockImplementation(async () => {
      ready = true;
    });

    const plugin = createPlugin();
    const first = plugin.ensureRuntime();
    const second = plugin.ensureRuntime();

    expect(start).toHaveBeenCalledTimes(1);
    const [runtime] = await Promise.all([first, second]);
    const state = plugin as unknown as {
      runtime: PluginRuntime | undefined;
      runtimePromise: Promise<PluginRuntime> | undefined;
    };

    expect(state.runtime).toBe(runtime);
    expect(state.runtimePromise).toBeUndefined();
    await expect(plugin.ensureRuntime()).resolves.toBe(runtime);
  });

  it("does not leave a promise or runtime behind when unloading races startup", async () => {
    let ready = false;
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    vi.spyOn(PluginRuntime.prototype, "isReady", "get").mockImplementation(() => ready);
    vi.spyOn(PluginRuntime.prototype, "start").mockImplementation(async () => {
      await startGate;
      ready = true;
    });
    const dispose = vi.spyOn(PluginRuntime.prototype, "dispose").mockResolvedValue(undefined);

    const plugin = createPlugin();
    const initializing = plugin.ensureRuntime();
    const unloading = plugin.onunload();
    releaseStart();

    await expect(initializing).rejects.toThrow("插件正在卸载");
    await unloading;
    const state = plugin as unknown as {
      runtime: PluginRuntime | undefined;
      runtimePromise: Promise<PluginRuntime> | undefined;
    };

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(state.runtime).toBeUndefined();
    expect(state.runtimePromise).toBeUndefined();
  });
});
