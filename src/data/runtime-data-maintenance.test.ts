import { afterEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "obsidian";
import { backupAndClearPluginData, recoverInterruptedReset } from "./runtime-data-maintenance";
import { DEFAULT_SETTINGS } from "./settings-store";
import { FileStorage } from "./file-storage";
afterEach(() => vi.restoreAllMocks());

/** Minimal in-memory model of Obsidian's desktop DataAdapter (list is non-recursive). */
function memoryVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const folders = new Set<string>();
  const addParents = (path: string) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  };
  for (const path of files.keys()) addParents(path);
  const enoent = (p: string) => Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
  const adapter = {
    async read(p: string) { if (!files.has(p)) throw enoent(p); return files.get(p)!; },
    async write(p: string, c: string) { addParents(p); files.set(p, c); },
    async remove(p: string) { if (!files.delete(p)) throw enoent(p); },
    async rename(a: string, b: string) { const c = files.get(a)!; files.delete(a); files.set(b, c); },
    async stat(p: string) {
      return files.has(p) ? { type: "file" } : folders.has(p) ? { type: "folder" } : null;
    },
    async mkdir(p: string) { folders.add(p); addParents(p); },
    async list(dir: string) {
      if (!folders.has(dir)) throw enoent(dir);
      const direct = (p: string) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/");
      return { files: [...files.keys()].filter(direct), folders: [...folders].filter(direct) };
    },
  };
  return { vault: { adapter } as unknown as Vault, files, adapter };
}

describe("backupAndClearPluginData", () => {
  it("backs up and clears nested workflows and vectors", async () => {
    const { vault, files } = memoryVault({
      "plugin/data/queue-state-v5.json": "{}",
      "plugin/data/duplicate-pairs.json": "{}",
      "plugin/data/workflows/wf-1.json": "{\"state\":\"active\"}",
      "plugin/data/vectors/index.json": "{}",
      "plugin/data/vectors/domain/n1.json": "{}",
    });

    const result = await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);

    const remaining = [...files.keys()].filter((p) => !p.startsWith("plugin/data/backups/"));
    expect(remaining).toEqual([]);
    const backedUp = [...files.keys()].filter((p) => p.startsWith("plugin/data/backups/"));
    expect(backedUp.some((p) => p.endsWith("/workflows/wf-1.json"))).toBe(true);
    expect(backedUp.some((p) => p.endsWith("/vectors/domain/n1.json"))).toBe(true);
  });
});

const originals = {
  "plugin/data/queue-state-v5.json": "queue with interrupted request",
  "plugin/data/workflows/wf-1.json": "active workflow",
  "plugin/data/vectors/entity/n1.json": "vector",
  "plugin/data.json": "live settings",
  "notes/original.md": "original note body",
  "notes/cards.md": "existing cards",
};
const markerPath = "plugin/data/reset-in-progress.json";
const fault = () => Object.assign(new Error("injected failure"), { code: "EACCES" });
function expectOriginals(files: Map<string, string>) {
  for (const [path, value] of Object.entries(originals)) expect(files.get(path), path).toBe(value);
}

describe("reset failure boundaries", () => {
  it.each(["source-read", "copy-write", "copy-readback", "settings-readback", "manifest-readback", "marker-write", "marker-readback"])("does not delete originals when %s fails", async (phase) => {
    const { vault, adapter, files } = memoryVault(originals);
    const read = adapter.read.bind(adapter);
    const write = adapter.write.bind(adapter);
    vi.spyOn(adapter, "read").mockImplementation(async (path) => {
      if (phase === "source-read" && path === "plugin/data/workflows/wf-1.json") throw fault();
      if (phase === "copy-readback" && path.includes("/backups/") && path.endsWith("/wf-1.json")) return "truncated";
      if (phase === "settings-readback" && path.includes("/backups/") && path.endsWith("/settings.json")) return "truncated";
      if (phase === "manifest-readback" && path.includes("/backups/") && path.endsWith("/manifest.json")) return "truncated";
      if (phase === "marker-readback" && path === markerPath && files.has(path)) return "truncated";
      return read(path);
    });
    vi.spyOn(adapter, "write").mockImplementation(async (path, content) => {
      if (phase === "copy-write" && path.includes("/backups/") && path.endsWith("/wf-1.json")) throw fault();
      if (phase === "marker-write" && path === markerPath) throw fault();
      return write(path, content);
    });
    const remove = vi.spyOn(adapter, "remove");
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(false);
    expectOriginals(files);
    expect(remove).not.toHaveBeenCalled();
  });

  it("restores every runtime file after deletion fails midway without changing notes or settings", async () => {
    const { vault, adapter, files } = memoryVault(originals);
    const remove = adapter.remove.bind(adapter);
    vi.spyOn(adapter, "remove").mockImplementation(async (path) => {
      if (path === "plugin/data/workflows/wf-1.json") throw fault();
      return remove(path);
    });
    const result = await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("已恢复");
    expectOriginals(files);
    expect(files.has(markerPath)).toBe(false);
    expect([...files.keys()].some((path) => path.includes("/backups/") && path.endsWith("/runtime/queue-state-v5.json"))).toBe(true);
  });

  it("keeps snapshot and marker if rollback fails; later recovery restores all originals", async () => {
    const { vault, adapter, files } = memoryVault(originals);
    const remove = adapter.remove.bind(adapter);
    const write = adapter.write.bind(adapter);
    vi.spyOn(adapter, "remove").mockImplementation(async (path) => {
      if (path === "plugin/data/workflows/wf-1.json") throw fault();
      return remove(path);
    });
    const failedWrite = vi.spyOn(adapter, "write").mockImplementation(async (path, content) => {
      if (path === "plugin/data/queue-state-v5.json") throw fault();
      return write(path, content);
    });
    const result = await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("已停止启动任务");
    expect(files.has(markerPath)).toBe(true);
    expect(files.has("plugin/data/queue-state-v5.json")).toBe(false);
    const archived = new Map([...files].filter(([path]) => path.includes("/backups/")));
    failedWrite.mockRestore();
    expect((await recoverInterruptedReset(new FileStorage(vault, "plugin"))).ok).toBe(true);
    expectOriginals(files);
    expect(files.has(markerPath)).toBe(false);
    for (const [path, bytes] of archived) expect(files.get(path)).toBe(bytes);
  });

  it("recovers serialized deletion-crash bytes including .tmp and .bak files", async () => {
    const source = { ...originals, "plugin/data/receipt.json.bak": "last receipt", "plugin/data/receipt.json.tmp": "partial receipt" };
    const { vault, adapter, files } = memoryVault(source);
    const remove = adapter.remove.bind(adapter);
    let crashBytes: Map<string, string> | undefined;
    vi.spyOn(adapter, "remove").mockImplementation(async (path) => {
      if (path === "plugin/data/workflows/wf-1.json") { crashBytes = new Map(files); throw fault(); }
      return remove(path);
    });
    await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS);
    expect(crashBytes?.has(markerPath)).toBe(true);
    expect(crashBytes?.has("plugin/data/queue-state-v5.json")).toBe(false);
    const reload = memoryVault(Object.fromEntries(crashBytes!));
    expect((await recoverInterruptedReset(new FileStorage(reload.vault, "plugin"))).ok).toBe(true);
    for (const [path, bytes] of Object.entries(source)) expect(reload.files.get(path)).toBe(bytes);
    expect(reload.files.has(markerPath)).toBe(false);
  });

  it.each(["{", JSON.stringify({ version: 1, backupRoot: "data/backups/reset-test", files: ["data/../../notes/original.md"] })])("fails closed for an invalid marker", async (marker) => {
    const { vault, adapter, files } = memoryVault({ ...originals, [markerPath]: marker });
    const write = vi.spyOn(adapter, "write");
    const remove = vi.spyOn(adapter, "remove");
    expect((await recoverInterruptedReset(new FileStorage(vault, "plugin"))).ok).toBe(false);
    expectOriginals(files);
    expect(files.get(markerPath)).toBe(marker);
    expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it("preserves the first snapshot when retrying within the same millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);
    const { vault, files } = memoryVault(originals);
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(true);
    const firstBackup = new Map([...files].filter(([path]) => path.includes("/backups/")));
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(true);
    for (const [path, bytes] of firstBackup) expect(files.get(path)).toBe(bytes);
    expect([...files.keys()].filter((path) => path.endsWith("/manifest.json"))).toHaveLength(2);
    expect(files.get("notes/original.md")).toBe(originals["notes/original.md"]);
    expect(files.get("notes/cards.md")).toBe(originals["notes/cards.md"]);
    expect([...firstBackup.keys()].some((path) => path.endsWith(".md"))).toBe(false);
    expect(files.get("plugin/data.json")).toBe("live settings");
  });

  it("confirms success when marker deletion commits before the adapter reports failure", async () => {
    const { vault, adapter, files } = memoryVault(originals);
    const remove = adapter.remove.bind(adapter);
    vi.spyOn(adapter, "remove").mockImplementation(async (path) => { await remove(path); if (path === markerPath) throw fault(); });
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(true);
    expect(files.has(markerPath)).toBe(false);
    expect(files.has("plugin/data/queue-state-v5.json")).toBe(false);
    expect(files.get("notes/original.md")).toBe(originals["notes/original.md"]);
  });

  it("keeps startup blocked when final marker removal cannot be completed", async () => {
    const { vault, adapter, files } = memoryVault(originals);
    const remove = adapter.remove.bind(adapter);
    const blocked = vi.spyOn(adapter, "remove").mockImplementation(async (path) => { if (path === markerPath) throw fault(); return remove(path); });
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(false);
    expectOriginals(files);
    expect(files.has(markerPath)).toBe(true);
    expect((await recoverInterruptedReset(new FileStorage(vault, "plugin"))).ok).toBe(false);
    blocked.mockRestore();
    expect((await recoverInterruptedReset(new FileStorage(vault, "plugin"))).ok).toBe(true);
  });

  it("reports uncertainty instead of claiming rollback when final marker readback fails", async () => {
    const { vault, adapter, files } = memoryVault(originals);
    const remove = adapter.remove.bind(adapter); const read = adapter.read.bind(adapter);
    let deleted = false;
    vi.spyOn(adapter, "remove").mockImplementation(async (path) => { await remove(path); if (path === markerPath) { deleted = true; throw fault(); } });
    const readback = vi.spyOn(adapter, "read").mockImplementation(async (path) => { if (path === markerPath && deleted) { deleted = false; throw fault(); } return read(path); });
    const result = await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.message).toContain("无法确认重置是否完成"); expect(result.error.message).not.toContain("已恢复"); }
    expect(readback.mock.calls.filter(([path]) => path === markerPath)).toHaveLength(3);
    expect(files.has(markerPath)).toBe(false);
    expect(files.has("plugin/data/queue-state-v5.json")).toBe(false);
  });
});

describe("reset directory listing boundaries", () => {
  it("skips historical backup trees without reading them and still clears every live file", async () => {
    const { vault, adapter, files } = memoryVault({ ...originals, "plugin/data/backups/old/snapshot.json": "old immutable backup" });
    const list = adapter.list.bind(adapter);
    const calls = vi.spyOn(adapter, "list").mockImplementation(async (path) => {
      if (path.startsWith("plugin/data/backups")) throw Object.assign(new Error("old folder unreadable"), { code: "ENOENT" });
      return list(path);
    });
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(true);
    expect(calls.mock.calls.every(([path]) => !path.startsWith("plugin/data/backups"))).toBe(true);
    expect(files.get("plugin/data/backups/old/snapshot.json")).toBe("old immutable backup");
    expect(files.has("plugin/data/queue-state-v5.json")).toBe(false);
    expect(files.has("plugin/data/workflows/wf-1.json")).toBe(false);
  });

  it("fails closed when a live child directory disappears instead of treating the whole tree as empty", async () => {
    const { vault, adapter, files } = memoryVault(originals);
    const list = adapter.list.bind(adapter);
    vi.spyOn(adapter, "list").mockImplementation(async (path) => {
      if (path === "plugin/data/workflows") throw Object.assign(new Error("child missing"), { code: "ENOENT" });
      return list(path);
    });
    const remove = vi.spyOn(adapter, "remove");
    expect((await backupAndClearPluginData(vault, "plugin", DEFAULT_SETTINGS)).ok).toBe(false);
    expectOriginals(files); expect(remove).not.toHaveBeenCalled();
    expect([...files.keys()].some((path) => path.endsWith("/manifest.json"))).toBe(false);
  });
});
