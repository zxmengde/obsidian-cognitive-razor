import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { CruidCache } from "./cruid-cache";
import type { ILogger } from "../types";

function createLogger(): ILogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function createApp(
  files: TFile[],
  getFrontmatter: (file: TFile) => Record<string, unknown> | undefined = () => undefined,
) {
  const metadataListeners = new Map<string, (file: TFile) => void>();
  const vaultListeners = new Map<string, (...args: unknown[]) => void>();
  const removedRefs: unknown[] = [];
  let nextId = 0;

  const metadataCache: {
    on: (event: string, callback: (file: TFile) => void) => string;
    offref: (ref: string) => void;
    getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | undefined;
  } = {
    on(_event: string, callback: (file: TFile) => void) {
      const ref = `metadata-${nextId++}`;
      metadataListeners.set(ref, callback);
      return ref;
    },
    offref(ref: string) {
      metadataListeners.delete(ref);
      removedRefs.push(ref);
    },
    getFileCache: (file) => {
      const frontmatter = getFrontmatter(file);
      return frontmatter ? { frontmatter } : undefined;
    },
  };
  const vault = {
    on(event: string, callback: (...args: unknown[]) => void) {
      const ref = `vault-${event}-${nextId++}`;
      vaultListeners.set(ref, callback);
      return ref;
    },
    offref(ref: string) {
      vaultListeners.delete(ref);
      removedRefs.push(ref);
    },
    getMarkdownFiles: () => [...files],
    getAbstractFileByPath: (path: string) => files.find((file) => file.path === path),
  };

  return {
    app: { metadataCache, vault } as unknown as App,
    metadataCache,
    metadataListeners,
    vaultListeners,
    removedRefs,
  };
}

describe("CruidCache lifecycle", () => {
  it("stops an in-flight vault scan before it can repopulate after dispose", async () => {
    const files = Array.from({ length: 101 }, (_, index) => createFile(`notes/${index}.md`));
    const harness = createApp(files, (file) => ({ cruid: file.basename }));
    const cache = new CruidCache(harness.app, createLogger());

    cache.start();
    await Promise.resolve();

    const disposing = cache.dispose();
    await disposing;

    expect(cache.has("0")).toBe(false);
    expect(cache.getPath("0")).toBeNull();
    expect(harness.metadataListeners.size).toBe(0);
    expect(harness.vaultListeners.size).toBe(0);
    expect(harness.removedRefs).toHaveLength(3);
  });

  it("does not restore a file deleted while the initial vault scan is yielding", async () => {
    const files = Array.from({ length: 101 }, (_, index) => createFile(`notes/${index}.md`));
    const deletedFile = files[100];
    const harness = createApp(files, (file) => ({ cruid: file.basename }));
    const cache = new CruidCache(harness.app, createLogger());

    cache.start();
    files.pop();
    const deleted = [...harness.vaultListeners.entries()]
      .find(([ref]) => ref.includes("vault-delete"))?.[1];
    deleted?.(deletedFile);
    await cache.waitUntilReady();

    expect(cache.has("100")).toBe(false);
    expect(cache.getPath("100")).toBeNull();
    await cache.dispose();
  });

  it("can restart cleanly after disposal without retaining old event callbacks", async () => {
    const file = createFile("notes/one.md");
    const harness = createApp([file], () => ({ cruid: "one" }));
    const cache = new CruidCache(harness.app, createLogger());

    cache.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cache.getPath("one")).toBe("notes/one.md");
    await cache.dispose();

    cache.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cache.getPath("one")).toBe("notes/one.md");
    await cache.dispose();
    expect(harness.metadataListeners.size).toBe(0);
    expect(harness.vaultListeners.size).toBe(0);
  });

  it("returns a stable path-ordered snapshot after the initial scan", async () => {
    const second = createFile("notes/z.md");
    const first = createFile("notes/a.md");
    const harness = createApp([second, first], (file) => ({ cruid: file.basename }));
    const cache = new CruidCache(harness.app, createLogger());

    cache.start();
    const snapshot = await cache.snapshotEntries();

    expect(snapshot.map(({ cruid, path, file }) => ({ cruid, path, file }))).toEqual([
      { cruid: "a", path: "notes/a.md", file: first },
      { cruid: "z", path: "notes/z.md", file: second },
    ]);
    await cache.dispose();
    expect(await cache.snapshotEntries()).toEqual([]);
  });

  it("removes stale mappings when metadata drops or changes a cruid", async () => {
    const file = createFile("notes/one.md");
    let frontmatter: Record<string, unknown> = { cruid: "one" };
    const harness = createApp([file], () => frontmatter);
    const cache = new CruidCache(harness.app, createLogger());
    const deleted: Array<{ cruid: string; path: string }> = [];
    cache.onDelete((event) => deleted.push(event));

    cache.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cache.getPath("one")).toBe("notes/one.md");

    frontmatter = { cruid: "two" };
    const changed = [...harness.metadataListeners.values()][0];
    changed?.(file);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cache.has("one")).toBe(false);
    expect(cache.getPath("two")).toBe("notes/one.md");

    frontmatter = {};
    changed?.(file);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cache.has("two")).toBe(false);
    expect(deleted).toEqual([
      { cruid: "one", path: file.path },
      { cruid: "two", path: file.path },
    ]);

    await cache.dispose();
  });

  it("does not let an older disposal clear a cache that was restarted meanwhile", async () => {
    const file = createFile("notes/one.md");
    const harness = createApp([file], () => ({ cruid: "one" }));
    const cache = new CruidCache(harness.app, createLogger());

    cache.start();
    const disposing = cache.dispose();
    cache.start();

    await disposing;
    for (let index = 0; index < 4; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(cache.getPath("one")).toBe("notes/one.md");
    await cache.dispose();
  });
});
