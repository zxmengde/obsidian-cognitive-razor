import { describe, expect, it } from "vitest";
import type { Vault } from "obsidian";
import { backupAndClearPluginData } from "./runtime-data-maintenance";
import { DEFAULT_SETTINGS } from "./settings-store";

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
  return { vault: { adapter } as unknown as Vault, files };
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
