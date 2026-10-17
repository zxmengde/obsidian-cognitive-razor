import { expect, it, vi } from "vitest";
import { SettingsStore, DEFAULT_SETTINGS } from "../data/settings-store";
import { SettingsApplication } from "./settings-application";
import type { PluginSettings } from "../types";

async function fixture(failures: number[]) {
  let disk = structuredClone(DEFAULT_SETTINGS);
  let release!: () => void;
  let writes = 0;
  const store = new SettingsStore({
    loadData: async () => structuredClone(disk),
    saveData: async (settings: PluginSettings) => {
      const attempt = ++writes;
      if (attempt === 1) await new Promise<void>(resolve => { release = resolve; });
      if (failures.includes(attempt)) throw new Error("synthetic local write failure");
      disk = structuredClone(settings);
    },
  } as never);
  await store.loadSettings();
  const app = new SettingsApplication({ settingsStore: store, providerProbe: {} as never,
    ensureSemanticIndex: vi.fn() });
  const start = async (patch = { enableAutoVerify: true }) => {
    const pending = app.updateSettings(patch);
    await vi.waitFor(() => expect(release).toBeDefined());
    return { pending, release };
  };
  const reload = async () => {
    const fresh = new SettingsStore({ loadData: async () => structuredClone(disk) } as never);
    await fresh.loadSettings();
    return fresh.getSettings();
  };
  return { app, store, start, reload, releaseFirst: () => release(), writes: () => writes };
}

it("keeps an unrelated earlier save failure visible and retries only its patch", async () => {
  const f = await fixture([1]);
  const states: string[] = [];
  f.app.subscribeSaveState(state => states.push(state.status));
  const a = await f.start();
  const b = f.app.updateSettings({ queuePageSize: 100 });
  a.release();
  const [first, second] = await Promise.all([a.pending, b]);
  expect(first.ok).toBe(false);
  expect(second.ok).toBe(true);
  expect(states).toContain("save-failed");
  expect(f.app.getSaveState().status).toBe("save-failed");
  expect(f.store.getSettings()).toMatchObject({ enableAutoVerify: false, queuePageSize: 100 });
  expect((await f.app.retryLastSave()).ok).toBe(true);
  expect(await f.reload()).toMatchObject({ enableAutoVerify: true, queuePageSize: 100 });
});

it("preserves an earlier success when the later independent save fails", async () => {
  const f = await fixture([2]);
  const a = await f.start();
  const b = f.app.updateSettings({ queuePageSize: 100 });
  a.release();
  expect((await a.pending).ok).toBe(true);
  expect((await b).ok).toBe(false);
  expect(f.app.getSaveState().status).toBe("save-failed");
  expect((await f.app.retryLastSave()).ok).toBe(true);
  expect(await f.reload()).toMatchObject({ enableAutoVerify: true, queuePageSize: 100 });
});

it("persists both independent successful intentions across reload", async () => {
  const f = await fixture([]);
  const a = await f.start();
  const b = f.app.updateSettings({ queuePageSize: 100 });
  a.release();
  expect((await a.pending).ok).toBe(true);
  expect((await b).ok).toBe(true);
  expect(f.app.getSaveState().status).toBe("saved");
  expect(await f.reload()).toMatchObject({ enableAutoVerify: true, queuePageSize: 100 });
});

it("does not retry an old failed value after a newer same-field intention", async () => {
  const f = await fixture([1]);
  const a = await f.start();
  const b = f.app.updateSettings({ enableAutoVerify: false });
  a.release();
  expect((await a.pending).ok).toBe(false);
  expect((await b).ok).toBe(true);
  expect(f.app.getSaveState().status).toBe("saved");
  expect((await f.app.retryLastSave()).ok).toBe(false);
  expect(f.writes()).toBe(1);
  expect((await f.reload()).enableAutoVerify).toBe(false);
});

it("does not hide one unresolved failure when a different failed change is retried", async () => {
  const f = await fixture([1, 2]);
  const a = await f.start();
  const b = f.app.updateSettings({ queuePageSize: 100 });
  a.release();
  await Promise.all([a.pending, b]);
  expect((await f.app.retryLastSave()).ok).toBe(true);
  expect(f.app.getSaveState().status).toBe("save-failed");
  expect((await f.app.retryLastSave()).ok).toBe(true);
  expect(f.app.getSaveState().status).toBe("saved");
  expect(await f.reload()).toMatchObject({ enableAutoVerify: true, queuePageSize: 100 });
});

it("retries only the still-applicable part of a failed multi-setting patch", async () => {
  const f = await fixture([1]);
  const pending = f.app.updateSettings({ enableAutoVerify: true, queuePageSize: 100 });
  await vi.waitFor(() => expect(f.writes()).toBe(1));
  // The newer same-field choice remains authoritative, even when it equals the old disk value.
  const newer = f.app.updateSettings({ enableAutoVerify: false });
  f.releaseFirst();
  await Promise.all([pending, newer]);
  expect(f.app.getSaveState().status).toBe("save-failed");
  expect((await f.app.retryLastSave()).ok).toBe(true);
  expect(await f.reload()).toMatchObject({ enableAutoVerify: false, queuePageSize: 100 });
});

it("retains failures for one task parameter while a different parameter is saved", async () => {
  const f = await fixture([1]);
  const a = f.app.updateTaskModel("write", { parameters: { temperature: 0.8 } });
  await vi.waitFor(() => expect(f.writes()).toBe(1));
  const b = f.app.updateTaskModel("write", { parameters: { topP: 0.9 } });
  f.releaseFirst();
  expect((await a).ok).toBe(false); expect((await b).ok).toBe(true);
  expect(f.app.getSaveState().status).toBe("save-failed");
  expect((await f.app.retryLastSave()).ok).toBe(true);
  expect((await f.reload()).taskModels.write.parameters).toMatchObject({ temperature: 0.8, topP: 0.9 });
});

it("merges a provider retry with the independently saved parameter defaults", async () => {
  const seed = structuredClone(DEFAULT_SETTINGS);
  seed.providers.p = { enabled: true, apiKey: '', apiFormat: 'openai-chat-completions', embeddingApiFormat: 'disabled', defaultChatModel: 'model', defaultEmbedModel: '', parameters: { temperature: 0.2, topP: 0.3 } };
  let disk = seed, fail = true;
  const store = new SettingsStore({ loadData: async () => disk, saveData: async (value: PluginSettings) => {
    if (fail) { fail = false; throw Error('synthetic local write failure'); } disk = structuredClone(value);
  } } as never);
  await store.loadSettings();
  const app = new SettingsApplication({ settingsStore: store, providerProbe: {} as never, ensureSemanticIndex: vi.fn() });
  expect((await app.updateProvider('p', { parameters: { temperature: 0.8 } })).ok).toBe(false);
  expect((await app.updateProvider('p', { parameters: { topP: 0.9 } })).ok).toBe(true);
  expect((await app.retryLastSave()).ok).toBe(true);
  expect(disk.providers.p.parameters).toMatchObject({ temperature: 0.8, topP: 0.9 });
});

it.each(['reset', 'import'] as const)("retains a failed %s after later setting edits without replaying a stale whole configuration", async operation => {
  const f = await fixture([1]);
  const pending = operation === 'reset' ? f.app.resetToDefaults() : f.app.importSettings(JSON.stringify({ ...DEFAULT_SETTINGS, enableAutoVerify: true }));
  await vi.waitFor(() => expect(f.writes()).toBe(1));
  const later = f.app.updateSettings({ queuePageSize: 100 });
  f.releaseFirst();
  expect((await pending).ok).toBe(false); expect((await later).ok).toBe(true);
  expect(f.app.getSaveState()).toMatchObject({ status: 'save-failed', retryable: false });
  expect((await f.app.retryLastSave()).ok).toBe(false);
  expect(f.writes()).toBe(2);
  expect((await f.reload()).queuePageSize).toBe(100);
  // A fresh explicit reset is a new intention and may replace the retained failure.
  expect((await f.app.resetToDefaults()).ok).toBe(true);
  expect(f.app.getSaveState().status).toBe('saved');
});
