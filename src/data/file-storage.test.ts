import { describe, expect, it, vi } from "vitest";
import type { Vault } from "obsidian";
import { FileStorage } from "./file-storage";

function createStorage() {
  const adapter = {
    read: vi.fn<(path: string) => Promise<string>>(),
    write: vi.fn<(path: string, content: string) => Promise<void>>(),
    remove: vi.fn<(path: string) => Promise<void>>(),
    rename: vi.fn<(from: string, to: string) => Promise<void>>(),
    stat: vi.fn<(path: string) => Promise<{ type: "file" | "folder" } | null>>(),
    mkdir: vi.fn<(path: string) => Promise<void>>(),
    list: vi.fn<(path: string) => Promise<{ files: string[]; folders: string[] }>>(),
  };
  return {
    storage: new FileStorage({ adapter } as unknown as Vault, "plugin-data"),
    adapter,
  };
}

describe("FileStorage path boundaries", () => {
  it("treats a null adapter stat as a missing file", async () => {
    const { storage, adapter } = createStorage();
    adapter.stat.mockResolvedValue(null);

    await expect(storage.exists("data/missing.json")).resolves.toBe(false);
    expect(adapter.stat).toHaveBeenCalledWith("plugin-data/data/missing.json");
  });

  it("rejects traversal and absolute paths before touching the adapter", async () => {
    const { storage, adapter } = createStorage();

    await expect(storage.read("../outside.json")).resolves.toMatchObject({
      ok: false,
      error: { code: "E101_INVALID_INPUT" },
    });
    await expect(storage.write("/outside.json", "x")).resolves.toMatchObject({
      ok: false,
      error: { code: "E101_INVALID_INPUT" },
    });
    await expect(storage.atomicWrite("nested/../../outside.json", "x")).resolves.toMatchObject({
      ok: false,
      error: { code: "E101_INVALID_INPUT" },
    });
    expect(await storage.exists("..\\outside.json")).toBe(false);
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("rejects unknown vector types before constructing a vector path", async () => {
    const { storage, adapter } = createStorage();
    const result = await storage.deleteVectorFile("../../escape" as never, "node-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("E101_INVALID_INPUT");
    expect(adapter.stat).not.toHaveBeenCalled();
  });

  it("lists only safe vector files from known type directories", async () => {
    const { storage, adapter } = createStorage();
    adapter.list.mockImplementation(async (path) => {
      if (path === "plugin-data/data/vectors/domain") {
        return {
          files: [
            "plugin-data/data/vectors/domain/node-1.json",
            "plugin-data/data/vectors/domain/unsafe/name.json",
            "plugin-data/data/vectors/domain/index.json.tmp",
          ],
          folders: [],
        };
      }
      return { files: [], folders: [] };
    });

    await expect(storage.listVectorFiles()).resolves.toMatchObject({
      ok: true,
      value: [{ type: "domain", id: "node-1", path: "data/vectors/domain/node-1.json" }],
    });
  });

  it("lists nested files recursively for backup/reset", async () => {
    const { storage, adapter } = createStorage();
    adapter.list.mockImplementation(async (path) => {
      if (path === "plugin-data/data") {
        return {
          files: ["plugin-data/data/queue-state-v5.json"],
          folders: ["plugin-data/data/workflows", "plugin-data/data/vectors"],
        };
      }
      if (path === "plugin-data/data/workflows") {
        return { files: ["plugin-data/data/workflows/wf-1.json"], folders: [] };
      }
      if (path === "plugin-data/data/vectors") {
        return {
          files: ["plugin-data/data/vectors/index.json"],
          folders: ["plugin-data/data/vectors/domain"],
        };
      }
      if (path === "plugin-data/data/vectors/domain") {
        return { files: ["plugin-data/data/vectors/domain/n1.json"], folders: [] };
      }
      return { files: [], folders: [] };
    });

    await expect(storage.listFilesRecursive("data")).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        "data/queue-state-v5.json",
        "data/workflows/wf-1.json",
        "data/vectors/index.json",
        "data/vectors/domain/n1.json",
      ]),
    });
  });
});

describe("FileStorage atomic recovery", () => {
  it("preserves reset backup snapshots including copied tmp and bak files", async () => {
    const { storage, adapter } = createStorage();
    const backupRoot = "plugin-data/data/backups";
    const files = new Map([
      ["plugin-data/data/state.json.tmp", "unfinished live write"],
      [`${backupRoot}/reset-1/state.json.tmp`, "archived incomplete write"],
      [`${backupRoot}/reset-1/state.json.bak`, "archived previous state"],
    ]);
    adapter.list.mockImplementation(async (path) => ({
      files: [...files.keys()].filter((file) => file.slice(0, file.lastIndexOf("/")) === path),
      folders: path === "plugin-data/data" ? [backupRoot] : path === backupRoot ? [`${backupRoot}/reset-1`] : [],
    }));
    adapter.stat.mockResolvedValue(null);
    adapter.read.mockImplementation(async (path) => files.get(path)!);
    adapter.write.mockImplementation(async (path, content) => { files.set(path, content); });
    adapter.remove.mockImplementation(async (path) => { files.delete(path); });
    expect((await storage.recoverIncompleteWrites()).ok).toBe(true);
    expect([...files.entries()]).toEqual([
      [`${backupRoot}/reset-1/state.json.tmp`, "archived incomplete write"],
      [`${backupRoot}/reset-1/state.json.bak`, "archived previous state"],
    ]);
  });

  it("keeps the only backup when startup recovery cannot restore it", async () => {
    const { storage, adapter } = createStorage();
    const backupPath = "plugin-data/data/state.json.bak";
    const targetPath = "plugin-data/data/state.json";
    adapter.list.mockResolvedValue({ files: [backupPath], folders: [] });
    adapter.stat.mockResolvedValue(null);
    adapter.read.mockResolvedValue("last-good-state");
    adapter.write.mockRejectedValue(Object.assign(new Error("read-only"), { code: "EACCES" }));
    adapter.remove.mockResolvedValue();

    const result = await storage.recoverIncompleteWrites();

    expect(result).toMatchObject({ ok: false, error: { code: "E302_PERMISSION_DENIED" } });
    expect(adapter.write).toHaveBeenCalledWith(targetPath, "last-good-state");
    expect(adapter.remove).not.toHaveBeenCalledWith(backupPath);
  });

  it("does not treat a target stat permission error as a missing target", async () => {
    const { storage, adapter } = createStorage();
    const backupPath = "plugin-data/data/state.json.bak";
    adapter.list.mockResolvedValue({ files: [backupPath], folders: [] });
    adapter.stat.mockRejectedValue(Object.assign(new Error("forbidden"), { code: "EACCES" }));

    const result = await storage.recoverIncompleteWrites();

    expect(result).toMatchObject({ ok: false, error: { code: "E302_PERMISSION_DENIED" } });
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it("reports a residual cleanup failure instead of silently succeeding", async () => {
    const { storage, adapter } = createStorage();
    const tempPath = "plugin-data/data/state.json.tmp";
    adapter.list.mockResolvedValue({ files: [tempPath], folders: [] });
    adapter.remove.mockRejectedValue(Object.assign(new Error("forbidden"), { code: "EACCES" }));

    const result = await storage.recoverIncompleteWrites();

    expect(result).toMatchObject({ ok: false, error: { code: "E302_PERMISSION_DENIED" } });
    expect(adapter.remove).toHaveBeenCalledWith(tempPath);
  });

  it("preserves the backup when both commit and rollback fail", async () => {
    const { storage, adapter } = createStorage();
    const targetPath = "plugin-data/data/state.json";
    const tempPath = `${targetPath}.tmp`;
    const backupPath = `${targetPath}.bak`;
    adapter.stat.mockResolvedValue({ type: "folder" });
    adapter.read.mockImplementation(async (path) => {
      if (path === targetPath || path === backupPath) return "last-good-state";
      if (path === tempPath) return "new-state";
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    adapter.write.mockImplementation(async (path) => {
      if (path === targetPath) {
        throw Object.assign(new Error("disk unavailable"), { code: "EIO" });
      }
    });
    adapter.remove.mockResolvedValue();
    adapter.rename.mockRejectedValue(Object.assign(new Error("rename failed"), { code: "EIO" }));

    const result = await storage.atomicWrite("data/state.json", "new-state");

    expect(result).toMatchObject({ ok: false, error: { code: "E500_INTERNAL_ERROR" } });
    expect(adapter.write).toHaveBeenCalledWith(backupPath, "last-good-state");
    expect(adapter.write).toHaveBeenCalledWith(targetPath, "last-good-state");
    expect(adapter.write).not.toHaveBeenCalledWith(targetPath, "new-state");
    expect(adapter.remove).not.toHaveBeenCalledWith(backupPath);
  });

  it("removes the backup only after a failed commit is rolled back successfully", async () => {
    const { storage, adapter } = createStorage();
    const targetPath = "plugin-data/data/state.json";
    const tempPath = `${targetPath}.tmp`;
    const backupPath = `${targetPath}.bak`;
    adapter.stat.mockResolvedValue({ type: "folder" });
    adapter.read.mockImplementation(async (path) => {
      if (path === targetPath || path === backupPath) return "last-good-state";
      if (path === tempPath) return "new-state";
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    adapter.write.mockResolvedValue();
    adapter.remove.mockResolvedValue();
    adapter.rename.mockRejectedValue(Object.assign(new Error("rename failed"), { code: "EIO" }));

    const result = await storage.atomicWrite("data/state.json", "new-state");

    expect(result).toMatchObject({ ok: false, error: { code: "E500_INTERNAL_ERROR" } });
    expect(adapter.write).toHaveBeenCalledWith(targetPath, "last-good-state");
    expect(adapter.write).not.toHaveBeenCalledWith(targetPath, "new-state");
    expect(adapter.remove).toHaveBeenCalledWith(backupPath);
  });
});
