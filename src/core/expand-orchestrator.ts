import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import {
  ok,
  err,
} from "../types";
import type {
  ConfirmedConcept,
  CRType,
  DefinePreview,
  DirectoryScheme,
  ILogger,
  Result,
} from "../types";
import { confirmConcept } from "../domain/concept";
import { extractFrontmatter, hasUppercaseCognitiveRazorFields } from "./frontmatter-utils";
import { parseInternalNoteLink, renderParentNoteLink } from "../utils/note-links";
import { schemaRegistry } from "./schema-registry";
import { generateFilePath, hasIllegalFileNameChars, sanitizeFileName } from "./naming-utils";
import type { CreateOrchestrator } from "./create-orchestrator";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import type { VectorIndex } from "./vector-index";

interface ExpandOrchestratorDeps {
  settingsStore: SettingsStore;
  logger: ILogger;
  app: App;
  vectorIndex: VectorIndex;
}

export interface HierarchicalCandidate {
  name: string;
  description?: string;
  targetType: CRType;
  targetPath: string;
  status: "creatable" | "existing" | "queued" | "invalid";
  reason?: string;
}

export interface HierarchicalPlan {
  mode: "hierarchical";
  parentTitle: string;
  currentPath: string;
  currentType: CRType;
  candidates: HierarchicalCandidate[];
}

export interface AbstractCandidate {
  uid: string;
  name: string;
  path: string;
  similarity: number;
  status?: "creatable" | "queued";
}

export interface AbstractPlan {
  mode: "abstract";
  currentTitle: string;
  currentUid: string;
  currentPath: string;
  currentType: CRType;
  candidates: AbstractCandidate[];
}

export type ExpandPlan = HierarchicalPlan | AbstractPlan;

/**
 * ExpandOrchestrator 额外依赖（OrchestratorDeps 之外）
 *
 * - createOrchestrator：用于为用户勾选的候选启动独立创建管线
 * - fileStorage：用于读取向量文件（抽象拓展模式）
 */
interface ExpandExtraDeps {
  createOrchestrator: CreateOrchestrator;
  fileStorage: FileStorage;
}

/** Model-generated abstract concept preview awaiting explicit confirmation. */
export interface AbstractExpandPreview {
  preview: DefinePreview;
  type: CRType;
  parents: string[];
  targetPath: string;
}

interface RawHierarchicalCandidate {
  name: string;
  description?: string;
  targetType: CRType;
  explicitPath?: boolean;
}

const HIERARCHICAL_FIELD_MAP: Record<CRType, Array<{ field: string; target: CRType }>> = {
  domain: [
    { field: "sub_domains", target: "domain" },
    { field: "issues", target: "issue" }
  ],
  issue: [
    { field: "sub_issues", target: "issue" },
    { field: "theories", target: "theory" }
  ],
  theory: [
    { field: "sub_theories", target: "theory" },
    { field: "entities", target: "entity" },
    { field: "mechanisms", target: "mechanism" }
  ],
  entity: [],
  mechanism: []
};

const MAX_CREATABLE = 200;

export class ExpandOrchestrator {
  private deps: ExpandOrchestratorDeps;
  private logger: ILogger;
  private createOrchestrator: CreateOrchestrator;
  private fileStorage: FileStorage;
  private disposed = false;
  private readonly activeOperations = new Set<Promise<unknown>>();
  private disposePromise?: Promise<void>;

  constructor(deps: ExpandOrchestratorDeps, extra: ExpandExtraDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    this.createOrchestrator = extra.createOrchestrator;
    this.fileStorage = extra.fileStorage;
  }

  /**
   * 准备拓展计划：根据当前笔记类型选择层级或抽象模式
   */
  async prepare(file: TFile): Promise<Result<ExpandPlan>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "拓展服务已停止");
    }
    return this.trackOperation(this.prepareInternal(file));
  }

  private async prepareInternal(file: TFile): Promise<Result<ExpandPlan>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "拓展服务已停止");
    }
    try {
      const content = await this.deps.app.vault.cachedRead(file);
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      const extracted = extractFrontmatter(content);
      if (!extracted) {
        if (hasUppercaseCognitiveRazorFields(content)) {
          return err(
            "E101_INVALID_INPUT",
            "当前笔记的 type 和 status 必须使用小写规范值（例如 type: domain、status: draft）；插件不会自动改写现有笔记",
          );
        }
        return err("E310_INVALID_STATE", "当前笔记缺少 frontmatter，无法执行拓展");
      }

      const { frontmatter, body } = extracted;
      const noteType = frontmatter.type;
      const parentTitle = frontmatter.name || file.basename;

      if (!noteType || !HIERARCHICAL_FIELD_MAP[noteType]) {
        return err("E310_INVALID_STATE", "当前笔记类型不支持拓展");
      }

      if (noteType === "domain" || noteType === "issue" || noteType === "theory") {
        const plan = this.buildHierarchicalPlan({
          parentTitle,
          currentPath: file.path,
          currentType: noteType,
          body
        });
        if (plan.candidates.length === 0) {
          return err("E310_INVALID_STATE", "未找到可创建的候选项，请检查正文结构");
        }
        return ok(plan);
      }

      // 抽象拓展（entity / mechanism）
      if (noteType === "entity" || noteType === "mechanism") {
        const planResult = await this.buildAbstractPlan({
          currentTitle: parentTitle,
          currentUid: frontmatter.cruid,
          currentPath: file.path,
          currentType: noteType
        });
        if (this.disposed) {
          return err("E310_INVALID_STATE", "拓展服务已停止");
        }
        return planResult;
      }

      return err("E310_INVALID_STATE", "当前笔记类型不支持拓展");
    } catch (error) {
      this.logger.error("ExpandOrchestrator", "准备拓展计划失败", error as Error);
      return err("E500_INTERNAL_ERROR", "准备拓展计划失败", error);
    }
  }

  /**
   * 批量启动层级拓展的创建管线
   */
  async confirmHierarchical(
    plan: HierarchicalPlan,
    selected: HierarchicalCandidate[]
  ): Promise<Result<{ started: number; failed: Array<{ name: string; message: string }> }>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "拓展服务已停止");
    }
    const failures: Array<{ name: string; message: string }> = [];
    let started = 0;

    for (const candidate of selected) {
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      if (candidate.status !== "creatable") continue;
      const parentLink = this.wrapAsWikilink(plan.currentPath.replace(/\.md$/i, ""));
      const concept = confirmConcept({
        type: candidate.targetType,
        name: { chinese: candidate.name, english: "" },
        coreDefinition: candidate.description,
        source: "hierarchical-expand",
        parents: [parentLink],
      });
      if (!concept.ok) {
        failures.push({ name: candidate.name, message: concept.error.message });
        continue;
      }
      const result = await this.createOrchestrator.confirmCreate(concept.value, {
        targetPathOverride: candidate.targetPath,
      });
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      if (result.ok) {
        started += 1;
      } else {
        failures.push({ name: candidate.name, message: result.error.message });
      }
    }

    if (started === 0) {
      return err("E310_INVALID_STATE", "未能启动任何创建任务", { failures });
    }

    return ok({ started, failed: failures });
  }

  /** Generate an abstract Define preview; this method never creates a workflow. */
  async prepareAbstractPreview(
    plan: AbstractPlan,
    selected: AbstractCandidate[]
  ): Promise<Result<AbstractExpandPreview>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "拓展服务已停止");
    }
    return this.trackOperation(this.prepareAbstractPreviewInternal(plan, selected));
  }

  /** Create an abstract concept only after the UI confirms the preview. */
  async confirmAbstract(
    abstractPreview: AbstractExpandPreview,
    concept: ConfirmedConcept,
  ): Promise<Result<string>> {
    if (this.disposed) return err("E310_INVALID_STATE", "拓展服务已停止");
    if (concept.source !== "abstract-expand" || concept.type !== abstractPreview.type) {
      return err("E101_INVALID_INPUT", "抽象拓展确认结果无效");
    }
    return this.trackOperation(this.createOrchestrator.confirmCreate(concept, {
      targetPathOverride: abstractPreview.targetPath,
    }));
  }

  private async prepareAbstractPreviewInternal(
    plan: AbstractPlan,
    selected: AbstractCandidate[],
  ): Promise<Result<AbstractExpandPreview>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "拓展服务已停止");
    }
    if (selected.length === 0) {
      return err("E101_INVALID_INPUT", "请至少选择一个相似概念");
    }
    selected = selected.filter((item) => item.status !== "queued" && !this.isPathActive(item.path));
    if (selected.length === 0) return err("E320_TASK_CONFLICT", "所选笔记已在队列中");

    try {
      // Resolve source titles again so a stale selection cannot silently create parents.
      const sourceTitles: string[] = [];
      const sourcePaths: string[] = [];

      const currentFile = this.deps.app.vault.getAbstractFileByPath(plan.currentPath);
      if (!(currentFile instanceof TFile)) {
        return err("E311_NOT_FOUND", "当前笔记不存在或已被移动");
      }
      sourceTitles.push(plan.currentTitle);
      sourcePaths.push(currentFile.path);

      for (const item of selected) {
        const file = this.deps.app.vault.getAbstractFileByPath(item.path);
        if (!(file instanceof TFile)) {
          this.logger.warn("ExpandOrchestrator", "相似概念文件未找到，已跳过", { path: item.path });
          continue;
        }
        sourceTitles.push(file.basename || item.name);
        sourcePaths.push(file.path);
      }

      if (sourceTitles.length === 1) {
        return err("E311_NOT_FOUND", "所选相似概念均不存在或已被移动");
      }

      const abstractInput = `抽象以下${plan.currentType}：${sourceTitles.join("、")}，生成一个更高层的 ${plan.currentType} 概念。`;
      const defineResult = await this.createOrchestrator.defineDirect(abstractInput);
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      if (!defineResult.ok) {
        return err(defineResult.error.code, defineResult.error.message);
      }

      const targetCandidate = defineResult.value.candidates[plan.currentType];
      const targetName = targetCandidate?.name.chinese || targetCandidate?.name.english;
      if (!targetName?.trim()) {
        return err("E310_INVALID_STATE", "Define 预览缺少目标类型名称");
      }

      const settings = this.deps.settingsStore.getSettings();
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      const targetPath = generateFilePath(
        targetName,
        settings.directoryScheme,
        plan.currentType
      );

      const parentLinks = [...new Set(sourcePaths)].map((path) => this.wrapAsWikilink(path.replace(/\.md$/i, "")));
      return ok({
        preview: defineResult.value,
        type: plan.currentType,
        parents: parentLinks,
        targetPath,
      });
    } catch (error) {
      this.logger.error("ExpandOrchestrator", "抽象拓展预览失败", error as Error);
      return err("E500_INTERNAL_ERROR", "抽象拓展预览失败", error);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (!this.disposePromise) {
      const active = [...this.activeOperations];
      this.disposePromise = Promise.all(active.map((operation) => operation.catch(() => undefined))).then(() => {
        this.activeOperations.clear();
      });
    }
    return this.disposePromise;
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.activeOperations.add(operation);
    operation.then(
      () => this.activeOperations.delete(operation),
      () => this.activeOperations.delete(operation),
    );
    return operation;
  }

  private isPathActive(path: string): boolean {
    return typeof this.createOrchestrator.isPathActive === "function"
      ? this.createOrchestrator.isPathActive(path)
      : false;
  }

  private buildHierarchicalPlan(input: {
    parentTitle: string;
    currentPath: string;
    currentType: CRType;
    body: string;
  }): HierarchicalPlan {
    const candidates: HierarchicalCandidate[] = [];
    const rawCandidates = this.collectHierarchicalCandidates(input.currentType, input.body);
    const seen = new Set<string>();
    let creatableCount = 0;
    const directoryScheme = this.deps.settingsStore.getSettings().directoryScheme;

    for (const item of rawCandidates) {
      const candidate = this.buildHierarchicalCandidate(item, directoryScheme);
      if (!candidate) continue;
      if (this.isPathActive(candidate.targetPath) && candidate.status === "creatable") {
        candidate.status = "queued";
        candidate.reason = "已在队列中";
      }

      const key = `${candidate.targetType}::${candidate.targetPath.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (candidate.status === "creatable" && creatableCount >= MAX_CREATABLE) {
        candidate.status = "invalid";
        candidate.reason = "超过批量创建上限（200），请分批执行";
      } else if (candidate.status === "creatable") {
        creatableCount += 1;
      }
      candidates.push(candidate);
    }

    return {
      mode: "hierarchical",
      parentTitle: input.parentTitle,
      currentPath: input.currentPath,
      currentType: input.currentType,
      candidates,
    };
  }

  private collectHierarchicalCandidates(currentType: CRType, body: string): RawHierarchicalCandidate[] {
    const mappings = HIERARCHICAL_FIELD_MAP[currentType];
    const descriptors = schemaRegistry.getFieldDescriptions(currentType);
    const headingMap = new Map<string, string>();
    for (const { field } of mappings) {
      const desc = descriptors.find((d) => d.name === field);
      if (desc?.description) {
        headingMap.set(desc.description.toLowerCase(), field);
      }
      headingMap.set(field.toLowerCase(), field);
    }

    const lines = body.split(/\r?\n/);
    let currentField: string | null = null;
    const candidates: RawHierarchicalCandidate[] = [];
    const fieldTargets = new Map<string, CRType>(mappings.map((m) => [m.field, m.target]));
    for (const line of lines) {
      const headingMatch = line.match(/^#{1,6}\s*(.+?)\s*$/);
      if (headingMatch) {
        const key = headingMatch[1].trim().toLowerCase();
        currentField = headingMap.get(key) || null;
        continue;
      }

      if (!currentField) continue;
      const targetType = fieldTargets.get(currentField);
      if (!targetType) continue;

      const parsed = this.parseLineForField(currentField, line);
      if (parsed) {
        candidates.push({ ...parsed, targetType });
      }
    }
    return candidates;
  }

  private buildHierarchicalCandidate(
    item: RawHierarchicalCandidate,
    directoryScheme: DirectoryScheme,
  ): HierarchicalCandidate | undefined {
    const target = item.name.trim().replace(/\.md$/i, "");
    if (!target) return undefined;

    // Exact existing paths (including root/moved/merged notes) win over title
    // guessing. Rendered links carry aliases, so retain their explicit paths
    // even after settings change. Bare slash-containing titles still require
    // a known type directory; do not guess an unintended folder.
    const explicitPath = `${target}.md`;
    const directory = normalizePath(directoryScheme[item.targetType] || "").replace(/\/$/, "");
    const hasPath = target.includes("/");
    const safePath = target.split("/").every((part) => part && part !== "." && part !== ".." && !hasIllegalFileNameChars(part));
    const existing = safePath && this.deps.app.vault.getAbstractFileByPath(explicitPath);
    const explicitLink = item.explicitPath;
    const qualified = safePath && (existing instanceof TFile || explicitLink || (hasPath && directory && target.startsWith(`${directory}/`)));
    const name = qualified ? target.split("/").at(-1)! : target;
    const targetPath = qualified ? explicitPath : generateFilePath(name, directoryScheme, item.targetType);
    const candidate: HierarchicalCandidate = {
      name,
      description: item.description,
      targetType: item.targetType,
      targetPath,
      status: "creatable",
    };
    if (!safePath || (hasPath && !qualified) || hasIllegalFileNameChars(name) || !sanitizeFileName(name)) {
      candidate.status = "invalid";
      candidate.reason = "名称包含非法字符";
    } else if (name.length > 256) {
      candidate.status = "invalid";
      candidate.reason = "名称过长";
    } else if (this.deps.app.vault.getAbstractFileByPath(targetPath)) {
      candidate.status = "existing";
      candidate.reason = "已存在";
    }
    return candidate;
  }

  private async buildAbstractPlan(input: {
    currentTitle: string;
    currentUid: string;
    currentPath: string;
    currentType: CRType;
  }): Promise<Result<AbstractPlan>> {
    if (!input.currentUid) {
      return err("E310_INVALID_STATE", "当前笔记缺少 cruid，无法检索相似概念");
    }
    try {
      const vectorResult = await this.fileStorage.readVectorFile(input.currentType, input.currentUid);
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      if (!vectorResult.ok) {
        return err("E310_INVALID_STATE", "当前笔记尚未生成向量嵌入，请先完成创建或重建索引");
      }
      const vector = vectorResult.value;
      if (!vector.embedding || vector.embedding.length === 0) {
        return err("E310_INVALID_STATE", "当前笔记嵌入为空，无法执行相似检索");
      }

      const searchResult = await this.deps.vectorIndex.search(
        input.currentType,
        vector.embedding,
        15
      );
      if (this.disposed) {
        return err("E310_INVALID_STATE", "拓展服务已停止");
      }
      if (!searchResult.ok) {
        return err(searchResult.error.code, searchResult.error.message);
      }

      const candidates: AbstractCandidate[] = searchResult.value
        .filter((item) => item.uid !== input.currentUid && item.path)
        .map((item) => ({
          uid: item.uid,
          name: item.name,
          path: item.path,
          similarity: item.similarity,
          status: this.isPathActive(item.path) ? "queued" as const : "creatable" as const,
        }));

      if (candidates.length === 0) {
        return err("E310_INVALID_STATE", "未找到可用的相似概念，无法执行抽象拓展");
      }

      return ok({
        mode: "abstract",
        currentTitle: input.currentTitle,
        currentUid: input.currentUid,
        currentPath: input.currentPath,
        currentType: input.currentType,
        candidates
      });
    } catch (error) {
      this.logger.error("ExpandOrchestrator", "构建抽象拓展计划失败", error as Error);
      return err("E500_INTERNAL_ERROR", "构建抽象拓展计划失败", error);
    }
  }

  private parseLineForField(
    field: string,
    line: string
  ): { name: string; description?: string; explicitPath: boolean } | null {
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const link = bullet && parseInternalNoteLink(bullet[1]);
    if (!link) return null;
    const basicMatch = /^\s*[：:]\s*(.*)$/.exec(link.rest);
    if (basicMatch && (field.startsWith("sub_") || field === "issues")) {
      return { name: link.target, explicitPath: link.explicitPath, description: basicMatch[1]?.trim() };
    }

    // theories 列表：- [[Name]] (Status)：Brief
    const theoryMatch = /^\s*(?:\(([^)]+)\))?\s*[：:]\s*(.*)$/.exec(link.rest);
    if (theoryMatch && field === "theories") {
      const descParts = [theoryMatch[1], theoryMatch[2]].filter(Boolean).join(" / ");
      return { name: link.target, explicitPath: link.explicitPath, description: descParts || undefined };
    }

    // entities/mechanisms：- [[Name]]
    if (field === "entities" || field === "mechanisms") {
      return { name: link.target, explicitPath: link.explicitPath };
    }

    return null;
  }

  private wrapAsWikilink(title: string): string {
    const trimmed = title.trim();
    if (/^\[\[.*\]\]$/.test(trimmed)) return trimmed;
    return renderParentNoteLink(trimmed);
  }
}
