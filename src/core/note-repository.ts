import { App, TFile } from "obsidian";
import type { ILogger, CRFrontmatter } from "../types";
import { extractFrontmatter, generateMarkdownContent } from "./frontmatter-utils";

function bodyForGeneration(body: string): string {
  // extractFrontmatter includes the newline separating YAML from Markdown;
  // generateMarkdownContent already emits that separator.
  return body.startsWith("\n") ? body.slice(1) : body;
}

export class NoteRepository {
  private readonly app: App;
  private readonly logger: ILogger;

  constructor(app: App, logger: ILogger) {
    this.app = app;
    this.logger = logger;
  }

  async readByPath(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`文件不存在: ${path}`);
    }
    return this.app.vault.cachedRead(file);
  }

  getFileByPath(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  async create(path: string, content: string): Promise<void> {
    await this.ensureVaultDir(path);
    await this.app.vault.create(path, content);
  }

  /** Create a draft once; recovery calls this repeatedly without overwriting user content. */
  async ensureCreate(path: string, content: string): Promise<"created" | "existing"> {
    const existing = this.getFileByPath(path);
    if (existing) return "existing";
    await this.ensureVaultDir(path);
    await this.app.vault.create(path, content);
    return "created";
  }

  /** 直接覆盖整篇笔记；生成期间的用户修改允许被覆盖。 */
  async replace(path: string, content: string): Promise<"updated" | "missing"> {
    const file = this.getFileByPath(path);
    if (!file) return "missing";
    await this.app.vault.process(file, () => content);
    return "updated";
  }

  /** Preserve the current file byte for byte; only a newly created file gets a Decks header. */
  async appendCards(path: string, markdown: string): Promise<void> {
    const append = (current: string) => `${current}\n\n${markdown}\n`;
    const existing = this.getFileByPath(path);
    if (existing) {
      await this.app.vault.process(existing, append);
      return;
    }
    await this.ensureVaultDir(path);
    // Do not retry after a create error: the host may have written the bytes
    // before reporting failure, and retrying could append the batch twice.
    await this.app.vault.create(path, `---\ntags: [decks]\n---\n\n${markdown}\n`);
  }

  /** 在当前内容上更新 frontmatter；重放同一补丁结果不变。 */
  async updateFrontmatter(
    path: string,
    patch: Partial<Pick<CRFrontmatter, "aliases" | "tags" | "status" | "updated">>,
  ): Promise<{ content: string } | "missing" | "invalid"> {
    const file = this.getFileByPath(path);
    if (!file) return "missing";
    let next: string | undefined;
    await this.app.vault.process(file, (current) => {
      const extracted = extractFrontmatter(current);
      if (!extracted) return current;
      next = generateMarkdownContent({ ...extracted.frontmatter, ...patch }, bodyForGeneration(extracted.body), current);
      return next;
    });
    return next === undefined ? "invalid" : { content: next };
  }

  /** 在当前内容上替换（或追加）带标记的核查报告；标记块已存在时重放结果不变。 */
  async replaceVerificationReport(
    path: string,
    reportBlock: string,
    status?: CRFrontmatter["status"],
    updated?: string,
  ): Promise<"updated" | "missing"> {
    const file = this.getFileByPath(path);
    if (!file) return "missing";
    const markerStart = "<!-- cognitive-razor:verify-report -->";
    const markerEnd = "<!-- /cognitive-razor:verify-report -->";
    const marked = `${markerStart}\n${reportBlock.trim()}\n${markerEnd}`;
    const existing = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "m");
    await this.app.vault.process(file, (current) => {
      const withReport = existing.test(current)
        ? current.replace(existing, () => marked)
        : `${current}${current.endsWith("\n") ? "\n" : "\n\n"}${marked}\n`;
      const next = extractFrontmatter(withReport);
      if (!next) return withReport;
      return generateMarkdownContent(
        { ...next.frontmatter, ...(status ? { status } : {}), ...(updated ? { updated } : {}) },
        bodyForGeneration(next.body),
        current,
      );
    });
    return "updated";
  }

  private async ensureVaultDir(targetPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const parts = targetPath.split("/").slice(0, -1);
    if (parts.length === 0) return;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      let currentStat = null;
      try {
        currentStat = await adapter.stat(current);
      } catch {
        // Missing directories may be reported as null or as an adapter error.
      }
      if (currentStat) {
        if (currentStat.type !== "folder") {
          throw new Error(`路径不是目录: ${current}`);
        }
        continue;
      }
      try {
        await adapter.mkdir(current);
      } catch (error) {
        let createdByPeer = null;
        try {
          createdByPeer = await adapter.stat(current);
        } catch {
          // Preserve the original mkdir error below.
        }
        if (!createdByPeer || createdByPeer.type !== "folder") {
          throw error;
        }
      }
    }
  }
}
