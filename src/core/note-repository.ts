import { App, TFile } from "obsidian";
import type { ILogger } from "../types";

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

  async read(file: TFile): Promise<string> {
    return this.app.vault.cachedRead(file);
  }

  listMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  async modify(file: TFile, content: string): Promise<void> {
    // 需求 22.2：后台文件修改使用 Vault.process() 原子操作
    await this.app.vault.process(file, () => content);
  }

  async readByPathIfExists(path: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    const exists = await adapter.exists(path);
    if (!exists) {
      return null;
    }
    return adapter.read(path);
  }

  async deleteByPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`文件不存在: ${path}`);
    }
    // 需求 22.4：使用 fileManager.trashFile() 处理反向链接清理
    await this.app.fileManager.trashFile(file);
  }

  async deleteByPathIfExists(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return false;
    }
    // 需求 22.4：使用 fileManager.trashFile() 处理反向链接清理
    await this.app.fileManager.trashFile(file);
    return true;
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    const adapter = this.app.vault.adapter;

    const existingFile = this.app.vault.getAbstractFileByPath(path);
    if (existingFile && existingFile instanceof TFile) {
      // 需求 22.2：后台文件修改使用 Vault.process() 原子操作
      await this.app.vault.process(existingFile, () => content);
      this.logger.debug("NoteRepository", "静默更新已存在文件", { path });
      return;
    }

    const temp = `${path}.tmp`;
    try {
      await this.ensureVaultDir(path);
      await adapter.write(temp, content);
      const verify = await adapter.read(temp);
      if (verify !== content) {
        throw new Error("写入校验失败");
      }
      await adapter.rename(temp, path);
      this.logger.debug("NoteRepository", "原子写入新文件", { path });
    } catch (error) {
      try {
        if (await adapter.exists(temp)) {
          await adapter.remove(temp);
        }
      } catch (cleanupError) {
        this.logger.warn("NoteRepository", "清理临时文件失败", {
          temp,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
      throw error;
    }
  }

  async ensureDirForPath(targetPath: string): Promise<void> {
    await this.ensureVaultDir(targetPath);
  }

  getAvailablePathForAttachment(fileName: string, currentFilePath: string): string {
    const vaultAny = this.app.vault as any;
    if (typeof vaultAny.getAvailablePathForAttachment === "function") {
      return vaultAny.getAvailablePathForAttachment(fileName, currentFilePath);
    }

    const currentFile = this.getFileByPath(currentFilePath);
    if (currentFile?.parent) {
      return `${currentFile.parent.path}/${fileName}`;
    }

    return fileName;
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureVaultDir(path);
    await this.app.vault.createBinary(path, data);
  }

  private async ensureVaultDir(targetPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const parts = targetPath.split("/").slice(0, -1);
    if (parts.length === 0) return;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const exists = await adapter.exists(current);
      if (!exists) {
        await adapter.mkdir(current);
      }
    }
  }
}
