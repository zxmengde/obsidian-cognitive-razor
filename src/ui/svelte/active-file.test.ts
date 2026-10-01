import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { build, transform } from "esbuild";
import { compileModule } from "svelte/compiler";
import type { TFile, Workspace } from "obsidian";

let createActiveFileStore: (workspace: Workspace) => { file: TFile | null; destroy(): void };
beforeAll(async () => {
  const result = await build({
    stdin: { contents: 'export { createActiveFileStore } from "./src/ui/bridge/reactive.svelte.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "ActiveFileTest",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    plugins: [{ name: "runes", setup(builder) {
      builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
        const source = await transform(await readFile(path, "utf8"), { loader: "ts" });
        return { contents: compileModule(source.code, { filename: path }).js.code, loader: "js" };
      });
    } }],
  });
  createActiveFileStore = new Function(`${result.outputFiles[0].text}; return ActiveFileTest.createActiveFileStore;`)();
});

describe("active note actions", () => {
  it("follows file changes within the same leaf and releases all listeners", () => {
    const first = { path: "first.md" } as TFile;
    const second = { path: "second.md" } as TFile;
    let active: TFile | null = first;
    const listeners = new Map<string, () => void>();
    const offref = vi.fn((ref: string) => listeners.delete(ref));
    const workspace = {
      getActiveFile: () => active,
      on: (event: string, callback: () => void) => { listeners.set(event, callback); return event; },
      offref,
    } as unknown as Workspace;
    const store = createActiveFileStore(workspace);
    try {
      expect(store.file?.path).toBe("first.md");
      active = second;
      listeners.get("file-open")?.();
      expect(store.file?.path).toBe("second.md");
      active = null;
      listeners.get("active-leaf-change")?.();
      listeners.get("file-open")?.();
      expect(store.file).toBeNull();
    } finally { store.destroy(); }
    expect(listeners.size).toBe(0);
  });
});
