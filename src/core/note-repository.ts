import { App, TFile } from "obsidian";
import type { ILogger, CRFrontmatter } from "../types";
import { extractFrontmatter, generateMarkdownContent } from "./frontmatter-utils";

class NoteContentChangedError extends Error {}

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

  async readByPathIfExists(path: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    const exists = await adapter.exists(path);
    if (!exists) {
      return null;
    }
    return adapter.read(path);
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

  /** Replace the complete plugin-owned snapshot only when no user edit occurred. */
  async replaceIfUnchanged(
    path: string,
    expectedContent: string,
    content: string,
  ): Promise<"updated" | "missing" | "changed"> {
    const file = this.getFileByPath(path);
    if (!file) return "missing";
    try {
      await this.app.vault.process(file, (current) => {
        // A Vault write may have succeeded just before the workflow
        // checkpoint failed. Treat the already-applied target as idempotent.
        if (current === content) return current;
        if (current !== expectedContent) throw new NoteContentChangedError();
        return content;
      });
    } catch (error) {
      if (error instanceof NoteContentChangedError) return "changed";
      throw error;
    }
    const confirmed = this.getFileByPath(path);
    if (!confirmed) return "missing";
    return (await this.app.vault.cachedRead(confirmed)) === content ? "updated" : "changed";
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

  /** Patch frontmatter only when the complete plugin-owned snapshot is unchanged. */
  async updateFrontmatterIfUnchanged(
    path: string,
    expectedContent: string,
    patch: Partial<Pick<CRFrontmatter, "aliases" | "tags" | "status" | "updated">>,
  ): Promise<{ content: string } | "missing" | "invalid" | "changed"> {
    const file = this.getFileByPath(path);
    if (!file) return "missing";
    let valid = true;
    let targetContent: string | undefined;
    try {
      await this.app.vault.process(file, (current) => {
        const extracted = extractFrontmatter(expectedContent);
        if (!extracted) {
          if (current !== expectedContent) throw new NoteContentChangedError();
          valid = false;
          return current;
        }
        const next = generateMarkdownContent({ ...extracted.frontmatter, ...patch }, bodyForGeneration(extracted.body), expectedContent);
        // A successful frontmatter write followed by a checkpoint failure is
        // safe to replay when the current content is already the target.
        targetContent = next;
        if (current === next) return current;
        if (current !== expectedContent) throw new NoteContentChangedError();
        return next;
      });
    } catch (error) {
      if (error instanceof NoteContentChangedError) return "changed";
      throw error;
    }
    if (!valid) return "invalid";
    const confirmed = this.getFileByPath(path);
    if (!confirmed) return "missing";
    const content = await this.app.vault.cachedRead(confirmed);
    // Return the confirmed write, so callers never adopt a later user edit
    // as the plugin-owned snapshot for the next generation stage.
    return content === targetContent ? { content } : "changed";
  }

  /** Replace a marked Verify report exactly once, refusing to apply to a changed snapshot. */
  async replaceVerificationReport(
    path: string,
    expectedContent: string,
    reportBlock: string,
    status: CRFrontmatter["status"] = "draft",
    updated?: string,
  ): Promise<"updated" | "missing" | "changed"> {
    const file = this.getFileByPath(path);
    if (!file) return "missing";
    let targetContent: string | undefined;
    try {
      // Derive the target from the captured input, never from current user
      // edits. Exact equality with that target is the only safe replay.
      const markerStart = "<!-- cognitive-razor:verify-report -->";
      const markerEnd = "<!-- /cognitive-razor:verify-report -->";
      const marked = `${markerStart}\n${reportBlock.trim()}\n${markerEnd}`;
      const existing = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "m");
      const withReport = existing.test(expectedContent)
        ? expectedContent.replace(existing, () => marked)
        : `${expectedContent}${expectedContent.endsWith("\n") ? "\n" : "\n\n"}${marked}\n`;
      const next = extractFrontmatter(withReport);
      if (!next) return "changed";
      targetContent = generateMarkdownContent(
        { ...next.frontmatter, status, ...(updated ? { updated } : {}) },
        bodyForGeneration(next.body),
        expectedContent,
      );
      await this.app.vault.process(file, (current) => {
        if (current !== expectedContent && current !== targetContent) throw new NoteContentChangedError();
        return targetContent!;
      });
    } catch (error) {
      if (error instanceof NoteContentChangedError) return "changed";
      throw error;
    }
    const confirmed = this.getFileByPath(path);
    if (!confirmed) return "missing";
    return (await this.app.vault.cachedRead(confirmed)) === targetContent ? "updated" : "changed";
  }

  async appendIfUnchanged(
    path: string,
    expectedContent: string,
    block: string,
  ): Promise<"appended" | "missing" | "changed"> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return "missing";
    }

    try {
      await this.app.vault.process(file, (currentContent) => {
        if (currentContent !== expectedContent) {
          throw new NoteContentChangedError();
        }
        const separator = currentContent.endsWith("\n") ? "\n" : "\n\n";
        return `${currentContent}${separator}${block}\n`;
      });
    } catch (error) {
      if (error instanceof NoteContentChangedError) {
        return "changed";
      }
      throw error;
    }
    this.logger.debug("NoteRepository", "已在未变更的笔记末尾追加内容", { path });
    return "appended";
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
