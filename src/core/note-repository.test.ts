import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { NoteRepository } from "./note-repository";
import type { ILogger } from "../types";
import { generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import YAML from "yaml";

const logger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("NoteRepository creation", () => {
  it("appends cards to the latest user content without changing any existing bytes", async () => {
    const file = new TFile(); file.path = "cards.md";
    const original = "---\r\ntags: [decks]\r\n---\r\n## 手工卡\r\n答案  ";
    let content = original;
    const repository = new NoteRepository({ vault: {
      getAbstractFileByPath: () => file,
      process: async (_file: TFile, update: (value: string) => string) => { content = update(content); },
    } } as unknown as App, logger);
    await repository.appendCards(file.path, "## 新卡\n答案");
    expect(content).toBe(original + "\n\n## 新卡\n答案\n");
  });
  it("accepts a directory concurrently created by another operation", async () => {
    const stat = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ type: "folder" });
    const mkdir = vi.fn().mockRejectedValue(new Error("already exists"));
    const create = vi.fn().mockResolvedValue(undefined);
    const repository = new NoteRepository({
      vault: {
        adapter: { stat, mkdir },
        create,
      },
    } as unknown as App, logger);

    await repository.create("notes/example.md", "content");

    expect(mkdir).toHaveBeenCalledWith("notes");
    expect(create).toHaveBeenCalledWith("notes/example.md", "content");
  });

  it("does not treat an existing file as a directory", async () => {
    const repository = new NoteRepository({
      vault: {
        adapter: {
          stat: vi.fn().mockResolvedValue({ type: "file" }),
          mkdir: vi.fn(),
        },
        create: vi.fn(),
      },
    } as unknown as App, logger);

    await expect(repository.create("notes/example.md", "content"))
      .rejects.toThrow("路径不是目录: notes");
  });
});

describe("NoteRepository conditional append", () => {
  it("preserves user properties when writing and replaying a verification report", async () => {
    const file = new TFile();
    file.path = "note.md";
    const original = generateMarkdownContent(generateFrontmatter({ cruid: "id", type: "entity", name: "测试" }), "正文")
      .replace("\n---\n", "\ncssclasses: [wide-page]\nreview: {owner: me, score: 3}\n---\n");
    let content = original;
    const repository = new NoteRepository({ vault: {
      getAbstractFileByPath: () => file,
      cachedRead: async () => content,
      process: async (_file: TFile, update: (value: string) => string) => { content = update(content); },
    } } as unknown as App, logger);

    expect(await repository.replaceVerificationReport(file.path, original, "报告", "evergreen")).toBe("updated");
    const properties = YAML.parse(content.split("---")[1]);
    expect(properties).toMatchObject({ cssclasses: ["wide-page"], review: { owner: "me", score: 3 }, status: "evergreen" });
    const applied = content;
    expect(await repository.replaceVerificationReport(file.path, original, "报告", "evergreen")).toBe("updated");
    expect(content).toBe(applied);
  });

  it("does not overwrite content edited after the verification snapshot", async () => {
    const file = new TFile();
    file.path = "note.md";
    let currentContent = "用户刚刚修改的正文";
    const process = vi.fn(async (_file: TFile, update: (content: string) => string) => {
      currentContent = update(currentContent);
    });
    const repository = new NoteRepository({
      vault: {
        getAbstractFileByPath: () => file,
        process,
      },
    } as unknown as App, logger);

    const status = await repository.appendIfUnchanged("note.md", "旧正文", "核查报告");

    expect(status).toBe("changed");
    expect(currentContent).toBe("用户刚刚修改的正文");
  });

  it("appends exactly once when the note still matches the task snapshot", async () => {
    const file = new TFile();
    file.path = "note.md";
    let currentContent = "正文";
    const process = vi.fn(async (_file: TFile, update: (content: string) => string) => {
      currentContent = update(currentContent);
    });
    const repository = new NoteRepository({
      vault: {
        getAbstractFileByPath: () => file,
        process,
      },
    } as unknown as App, logger);

    const status = await repository.appendIfUnchanged("note.md", "正文", "核查报告");

    expect(status).toBe("appended");
    expect(currentContent).toBe("正文\n\n核查报告\n");
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("treats an already-applied full replacement as idempotent", async () => {
    const file = new TFile();
    file.path = "note.md";
    let currentContent = "target";
    const process = vi.fn(async (_file: TFile, update: (content: string) => string) => {
      currentContent = update(currentContent);
    });
    const repository = new NoteRepository({
      vault: { getAbstractFileByPath: () => file, process, cachedRead: vi.fn(async () => currentContent) },
    } as unknown as App, logger);

    const status = await repository.replaceIfUnchanged("note.md", "old", "target");

    expect(status).toBe("updated");
    expect(currentContent).toBe("target");
  });

  it("treats an already-applied frontmatter patch as idempotent", async () => {
    const file = new TFile();
    file.path = "note.md";
    const baseFrontmatter = generateFrontmatter({ cruid: "id", type: "entity", name: "测试" });
    const initial = generateMarkdownContent(baseFrontmatter, "正文");
    let currentContent = generateMarkdownContent({ ...baseFrontmatter, tags: ["tag"] }, "正文");
    const process = vi.fn(async (_file: TFile, update: (content: string) => string) => {
      currentContent = update(currentContent);
    });
    const repository = new NoteRepository({
      vault: { getAbstractFileByPath: () => file, process, cachedRead: vi.fn(async () => currentContent) },
    } as unknown as App, logger);

    const status = await repository.updateFrontmatterIfUnchanged("note.md", initial, { tags: ["tag"] });

    expect(status).toEqual({ content: currentContent });
    expect(currentContent).toContain('tags: ["tag"]');
  });

  it("does not adopt user edits as the owned snapshot when replaying a tag patch", async () => {
    const file = new TFile();
    file.path = "note.md";
    const frontmatter = generateFrontmatter({ cruid: "id", type: "entity", name: "测试" });
    const initial = generateMarkdownContent(frontmatter, "正文");
    let content = generateMarkdownContent({ ...frontmatter, tags: ["tag"] }, "正文\n用户新增内容");
    const edited = content;
    const repository = new NoteRepository({ vault: {
      getAbstractFileByPath: () => file,
      cachedRead: async () => content,
      process: async (_file: TFile, update: (value: string) => string) => { content = update(content); },
    } } as unknown as App, logger);

    expect(await repository.updateFrontmatterIfUnchanged(file.path, initial, { tags: ["tag"] })).toBe("changed");
    expect(content).toBe(edited);
  });

  it("replaces an existing Verify marker idempotently after a checkpoint retry", async () => {
    const file = new TFile();
    file.path = "note.md";
    const marker = "<!-- cognitive-razor:verify-report -->\n## 报告\n\n内容\n\n<!-- /cognitive-razor:verify-report -->";
    let currentContent = `---\ncruid: note-1\ntype: domain\nname: Note\nstatus: draft\ncreated: 2026-01-01\nupdated: 2026-01-01\naliases: []\ntags: []\nparents: []\n---\n\n正文\n\n${marker}\n`;
    const process = vi.fn(async (_file: TFile, update: (content: string) => string) => {
      currentContent = update(currentContent);
    });
    const repository = new NoteRepository({
      vault: { getAbstractFileByPath: () => file, process, cachedRead: vi.fn(async () => currentContent) },
    } as unknown as App, logger);

    const status = await repository.replaceVerificationReport("note.md", currentContent, "## 报告\n\n内容", "evergreen");

    expect(status).toBe("updated");
    expect(currentContent.match(/cognitive-razor:verify-report/g)).toHaveLength(2);
  });

  it("refuses to append a report when the note was edited after the Verify snapshot", async () => {
    const file = new TFile();
    file.path = "note.md";
    const snapshot = `---
cruid: note-1
type: domain
name: Note
status: draft
created: 2026-01-01
updated: 2026-01-01
aliases: []
tags: []
parents: []
---

正文
`;
    let currentContent = `${snapshot}用户在 Verify 启动后新增的内容
`;
    const process = vi.fn(async (_file: TFile, update: (content: string) => string) => {
      currentContent = update(currentContent);
    });
    const repository = new NoteRepository({
      vault: { getAbstractFileByPath: () => file, process, cachedRead: vi.fn(async () => currentContent) },
    } as unknown as App, logger);

    const status = await repository.replaceVerificationReport("note.md", snapshot, "## 报告", "evergreen");

    expect(status).toBe("changed");
    expect(currentContent).toContain("用户在 Verify 启动后新增的内容");
    expect(currentContent).not.toContain("## 报告");
  });
});
