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

describe("NoteRepository direct writes", () => {
  function repo(initial: string) {
    const file = new TFile(); file.path = "note.md";
    const box = { content: initial };
    const repository = new NoteRepository({ vault: {
      getAbstractFileByPath: () => file,
      cachedRead: async () => box.content,
      process: async (_file: TFile, update: (value: string) => string) => { box.content = update(box.content); },
    } } as unknown as App, logger);
    return { repository, box };
  }
  const base = () => generateFrontmatter({ cruid: "id", type: "entity", name: "测试" });

  it("preserves user properties when writing and replaying a verification report", async () => {
    const original = generateMarkdownContent(base(), "正文")
      .replace("\n---\n", "\ncssclasses: [wide-page]\nreview: {owner: me, score: 3}\n---\n");
    const { repository, box } = repo(original);
    expect(await repository.replaceVerificationReport("note.md", "报告", "evergreen")).toBe("updated");
    expect(YAML.parse(box.content.split("---")[1])).toMatchObject({ cssclasses: ["wide-page"], review: { owner: "me", score: 3 }, status: "evergreen" });
    const applied = box.content;
    expect(await repository.replaceVerificationReport("note.md", "报告", "evergreen")).toBe("updated");
    expect(box.content).toBe(applied);
  });

  it("keeps user edits made after the snapshot when writing the report and patching frontmatter", async () => {
    const { repository, box } = repo(generateMarkdownContent(base(), "正文\n用户新增内容"));
    expect(await repository.updateFrontmatter("note.md", { tags: ["tag"] })).toEqual({ content: box.content });
    expect(box.content).toContain('tags: ["tag"]');
    expect(box.content).toContain("用户新增内容");
    await repository.replaceVerificationReport("note.md", "## 报告", "evergreen");
    expect(box.content).toContain("用户新增内容");
    expect(box.content).toContain("## 报告");
  });

  it("overwrites the whole note without comparing the previous content", async () => {
    const { repository, box } = repo("用户刚刚修改的正文");
    expect(await repository.replace("note.md", "target")).toBe("updated");
    expect(box.content).toBe("target");
  });

  it("reports an invalid frontmatter without touching the note", async () => {
    const { repository, box } = repo("没有 frontmatter");
    expect(await repository.updateFrontmatter("note.md", { tags: ["tag"] })).toBe("invalid");
    expect(box.content).toBe("没有 frontmatter");
  });

  it("replaces an existing Verify marker idempotently", async () => {
    const marker = "<!-- cognitive-razor:verify-report -->\n## 报告\n\n内容\n\n<!-- /cognitive-razor:verify-report -->";
    const { repository, box } = repo(`---\ncruid: note-1\ntype: domain\nname: Note\nstatus: draft\ncreated: 2026-01-01\nupdated: 2026-01-01\naliases: []\ntags: []\nparents: []\n---\n\n正文\n\n${marker}\n`);
    expect(await repository.replaceVerificationReport("note.md", "## 报告\n\n内容", "evergreen")).toBe("updated");
    expect(box.content.match(/cognitive-razor:verify-report/g)).toHaveLength(2);
  });
});

describe("Verify preserves note maturity unless explicitly supplied", () => {
  it.each(["seed", "draft", "evergreen"] as const)("preserves %s on write and replay", async (status) => {
    const file = new TFile(); file.path = "note.md";
    let content = generateMarkdownContent(generateFrontmatter({ cruid: "id", type: "entity", name: "测试", status }), "正文");
    const repository = new NoteRepository({ vault: {
      getAbstractFileByPath: () => file,
      cachedRead: async () => content,
      process: async (_file: TFile, update: (value: string) => string) => { content = update(content); },
    } } as unknown as App, logger);
    expect(await repository.replaceVerificationReport(file.path, "通过")).toBe("updated");
    expect(YAML.parse(content.split("---")[1]).status).toBe(status);
    const applied = content;
    expect(await repository.replaceVerificationReport(file.path, "通过")).toBe("updated");
    expect(content).toBe(applied);
  });
});
