import { TFile } from "obsidian";
import {
  ok,
  err,
} from "../types";
import type {
  CRType,
  ILogger,
  Result,
  StandardizedConcept,
} from "../types";
import { extractFrontmatter } from "./frontmatter-utils";
import { schemaRegistry } from "./schema-registry";
import { generateFilePath, sanitizeFileName } from "./naming-utils";
import type { OrchestratorDeps } from "./orchestrator-deps";
import type { CreateOrchestrator, CreatePresetOptions } from "./create-orchestrator";
import type { FileStorage } from "../data/file-storage";

export type ExpandMode = "hierarchical" | "abstract";

export interface HierarchicalCandidate {
  name: string;
  description?: string;
  targetType: CRType;
  targetPath: string;
  status: "creatable" | "existing" | "invalid";
  reason?: string;
}

export interface HierarchicalPlan {
  mode: "hierarchical";
  parentTitle: string;
  currentPath: string;
  currentType: CRType;
  candidates: HierarchicalCandidate[];
  looseStructure?: boolean;
}

export interface AbstractCandidate {
  uid: string;
  name: string;
  path: string;
  similarity: number;
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

const HIERARCHICAL_FIELD_MAP: Record<CRType, Array<{ field: string; target: CRType }>> = {
  Domain: [
    { field: "sub_domains", target: "Domain" },
    { field: "issues", target: "Issue" }
  ],
  Issue: [
    { field: "sub_issues", target: "Issue" },
    { field: "theories", target: "Theory" }
  ],
  Theory: [
    { field: "sub_theories", target: "Theory" },
    { field: "entities", target: "Entity" },
    { field: "mechanisms", target: "Mechanism" }
  ],
  Entity: [],
  Mechanism: []
};

const MAX_CREATABLE = 200;

export class ExpandOrchestrator {
  private deps: OrchestratorDeps;
  private logger: ILogger;
  private createOrchestrator: CreateOrchestrator;
  private fileStorage: FileStorage;

  constructor(deps: OrchestratorDeps, extra: ExpandExtraDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    this.createOrchestrator = extra.createOrchestrator;
    this.fileStorage = extra.fileStorage;
  }

  /**
   * 准备拓展计划：根据当前笔记类型选择层级或抽象模式
   */
  async prepare(file: TFile): Promise<Result<ExpandPlan>> {
    try {
      const content = await this.deps.app.vault.cachedRead(file);
      const extracted = extractFrontmatter(content);
      if (!extracted) {
        return err("E310_INVALID_STATE", "当前笔记缺少 frontmatter，无法执行拓展");
      }

      const { frontmatter, body } = extracted;
      const noteType = frontmatter.type;
      const parentTitle = frontmatter.name || file.basename;

      if (!noteType || !HIERARCHICAL_FIELD_MAP[noteType]) {
        return err("E310_INVALID_STATE", "当前笔记类型不支持拓展");
      }

      if (noteType === "Domain" || noteType === "Issue" || noteType === "Theory") {
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

      // 抽象拓展（Entity / Mechanism）
      if (noteType === "Entity" || noteType === "Mechanism") {
        const planResult = await this.buildAbstractPlan({
          currentTitle: parentTitle,
          currentUid: frontmatter.cruid,
          currentPath: file.path,
          currentType: noteType
        });
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
  async createFromHierarchical(
    plan: HierarchicalPlan,
    selected: HierarchicalCandidate[]
  ): Promise<Result<{ started: number; failed: Array<{ name: string; message: string }> }>> {
    const failures: Array<{ name: string; message: string }> = [];
    let started = 0;

    for (const candidate of selected) {
      if (candidate.status !== "creatable") continue;
      const sc = this.buildStandardizedConcept(candidate.name, candidate.targetType, candidate.description);
      const parentLink = this.wrapAsWikilink(plan.parentTitle);
      const options: CreatePresetOptions = {
        parents: [parentLink],
        targetPathOverride: candidate.targetPath
      };
      // 委托给 CreateOrchestrator 启动独立创建管线
      const result = this.createOrchestrator.startCreatePipelineWithPreset(
        sc,
        candidate.targetType,
        options
      );
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

  /**
   * 启动抽象拓展（生成 1 个同类型更抽象概念）
   */
  async createFromAbstract(
    plan: AbstractPlan,
    selected: AbstractCandidate[]
  ): Promise<Result<string>> {
    if (selected.length === 0) {
      return err("E101_INVALID_INPUT", "请至少选择一个相似概念");
    }

    try {
      // 汇总来源笔记内容
    const sourceTitles: string[] = [];
    const sourceSections: string[] = [];

      const currentFile = this.deps.app.vault.getAbstractFileByPath(plan.currentPath);
      if (!(currentFile instanceof TFile)) {
        return err("E311_NOT_FOUND", "当前笔记不存在或已被移动");
      }
      const currentContent = await this.deps.app.vault.cachedRead(currentFile);
      sourceTitles.push(plan.currentTitle);
      sourceSections.push(this.wrapSource(plan.currentTitle, currentFile.path, currentContent));

      for (const item of selected) {
        const file = this.deps.app.vault.getAbstractFileByPath(item.path);
        if (!(file instanceof TFile)) {
          this.logger.warn("ExpandOrchestrator", "相似概念文件未找到，已跳过", { path: item.path });
          continue;
        }
        const content = await this.deps.app.vault.cachedRead(file);
        const extracted = extractFrontmatter(content);
        const title = extracted?.frontmatter.name || item.name;
        sourceTitles.push(title);
        sourceSections.push(this.wrapSource(title, file.path, content));
      }

      const sources = sourceSections.join("\n\n---\n\n");
      const abstractInput = `抽象以下${plan.currentType}：${sourceTitles.join("、")}，生成一个更高层的 ${plan.currentType} 概念。`;
      // 委托给 CreateOrchestrator 执行 Define
      const standardizeResult = await this.createOrchestrator.defineDirect(abstractInput);
      if (!standardizeResult.ok) {
        return err(standardizeResult.error.code, standardizeResult.error.message);
      }

      // 强制使用当前类型
      const standardized = {
        ...standardizeResult.value,
        primaryType: plan.currentType,
        typeConfidences: {
          ...standardizeResult.value.typeConfidences,
          [plan.currentType]: 1
        }
      };

      const targetName = standardized.standardNames[plan.currentType]?.chinese;
      if (!targetName) {
        return err("E310_INVALID_STATE", "标准化结果缺少目标名称");
      }

      const settings = this.deps.settingsStore.getSettings();
      const targetPath = generateFilePath(
        targetName,
        settings.directoryScheme,
        plan.currentType
      );

      const parentLinks = sourceTitles.map((t) => this.wrapAsWikilink(t));
      // 委托给 CreateOrchestrator 启动独立创建管线
      const startResult = this.createOrchestrator.startCreatePipelineWithPreset(
        standardized,
        plan.currentType,
        {
          parents: parentLinks,
          targetPathOverride: targetPath,
          sources
        }
      );

      if (!startResult.ok) {
        return err(startResult.error.code, startResult.error.message);
      }

      // 将 sources 写入上下文，确保 write 可用
      const context = this.createOrchestrator.getContext(startResult.value);
      if (context) {
        context.sources = sources;
      }

      return ok(startResult.value);
    } catch (error) {
      this.logger.error("ExpandOrchestrator", "抽象拓展启动失败", error as Error);
      return err("E500_INTERNAL_ERROR", "抽象拓展启动失败", error);
    }
  }

  private buildHierarchicalPlan(input: {
    parentTitle: string;
    currentPath: string;
    currentType: CRType;
    body: string;
  }): HierarchicalPlan {
    const candidates: HierarchicalCandidate[] = [];
    const mappings = HIERARCHICAL_FIELD_MAP[input.currentType];
    const descriptors = schemaRegistry.getFieldDescriptions(input.currentType);
    const headingMap = new Map<string, string>();
    for (const { field } of mappings) {
      const desc = descriptors.find((d) => d.name === field);
      if (desc?.description) {
        headingMap.set(desc.description.toLowerCase(), field);
      }
      headingMap.set(field.toLowerCase(), field);
    }

    const lines = input.body.split(/\r?\n/);
    let currentField: string | null = null;
    const rawCandidates: Array<{ name: string; description?: string; targetType: CRType }> = [];
    const fieldTargets = new Map<string, CRType>(mappings.map((m) => [m.field, m.target]));
    let looseStructure = false;

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
        rawCandidates.push({ ...parsed, targetType });
      }
    }

    // 找不到任何匹配章节，回退全局扫描
    if (rawCandidates.length === 0) {
      looseStructure = true;
      const fallbackTarget = mappings[0]?.target;
      if (fallbackTarget) {
        for (const line of lines) {
          const parsed = this.parseLineForField("fallback", line);
          if (parsed) {
            rawCandidates.push({ ...parsed, targetType: fallbackTarget });
          }
        }
      }
    }

    const seen = new Set<string>();
    let creatableCount = 0;
    const settings = this.deps.settingsStore.getSettings();

    for (const item of rawCandidates) {
      const normalizedName = this.normalizeLinkName(item.name);
      const key = `${item.targetType}::${normalizedName.toLowerCase()}`;
      if (!normalizedName || seen.has(key)) continue;
      seen.add(key);

      let status: HierarchicalCandidate["status"] = "creatable";
      let reason: string | undefined;
      const sanitized = sanitizeFileName(normalizedName);
      if (!sanitized) {
        status = "invalid";
        reason = "名称包含非法字符";
      } else if (normalizedName.length > 256) {
        status = "invalid";
        reason = "名称过长";
      }

      const targetPath = generateFilePath(
        normalizedName,
        settings.directoryScheme,
        item.targetType
      );

      if (status === "creatable") {
        const exists = !!this.deps.app.vault.getAbstractFileByPath(targetPath);
        if (exists) {
          status = "existing";
          reason = "已存在";
        } else if (creatableCount >= MAX_CREATABLE) {
          status = "invalid";
          reason = "超过批量创建上限（200），请分批执行";
        } else {
          creatableCount += 1;
        }
      }

      candidates.push({
        name: normalizedName,
        description: item.description,
        targetType: item.targetType,
        targetPath,
        status,
        reason
      });
    }

    return {
      mode: "hierarchical",
      parentTitle: input.parentTitle,
      currentPath: input.currentPath,
      currentType: input.currentType,
      candidates,
      looseStructure
    };
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
      if (!searchResult.ok) {
        return err(searchResult.error.code, searchResult.error.message);
      }

      const candidates: AbstractCandidate[] = searchResult.value
        .filter((item) => item.uid !== input.currentUid && item.path)
        .map((item) => ({
          uid: item.uid,
          name: item.name,
          path: item.path,
          similarity: item.similarity
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
  ): { name: string; description?: string } | null {
    // 名称 + 描述（适用于 sub_* 列表）
    const basicMatch = line.match(/^\s*[-*]\s+\[\[([^\]]+)\]\]\s*[：:]\s*(.+)?$/);
    if (basicMatch && (field.startsWith("sub_") || field === "issues")) {
      return { name: basicMatch[1].trim(), description: basicMatch[2]?.trim() };
    }

    // theories 列表：- [[Name]] (Status)：Brief
    const theoryMatch = line.match(/^\s*[-*]\s+\[\[([^\]]+)\]\]\s*(?:\(([^)]+)\))?\s*[：:]\s*(.+)?$/);
    if (theoryMatch && (field === "theories" || field === "fallback")) {
      const descParts = [theoryMatch[2], theoryMatch[3]].filter(Boolean).join(" / ");
      return { name: theoryMatch[1].trim(), description: descParts || undefined };
    }

    // entities/mechanisms：- [[Name]]
    const entityMatch = line.match(/^\s*[-*]\s+\[\[([^\]]+)\]\]/);
    if (entityMatch && (field === "entities" || field === "mechanisms" || field === "fallback")) {
      return { name: entityMatch[1].trim() };
    }

    // 回退：任何包含 [[...]] 的列表行
    if (field === "fallback") {
      const genericMatch = line.match(/^\s*[-*]\s+\[\[([^\]]+)\]\]/);
      if (genericMatch) {
        return { name: genericMatch[1].trim() };
      }
    }

    return null;
  }

  private normalizeLinkName(raw: string): string {
    const name = raw.split("|")[0]?.trim() || "";
    return name;
  }

  private buildStandardizedConcept(name: string, targetType: CRType, description?: string): StandardizedConcept {
    const build = (n: string) => ({ chinese: n, english: "" });
    return {
      standardNames: {
        Domain: build(name),
        Issue: build(name),
        Theory: build(name),
        Entity: build(name),
        Mechanism: build(name)
      },
      typeConfidences: {
        Domain: targetType === "Domain" ? 1 : 0,
        Issue: targetType === "Issue" ? 1 : 0,
        Theory: targetType === "Theory" ? 1 : 0,
        Entity: targetType === "Entity" ? 1 : 0,
        Mechanism: targetType === "Mechanism" ? 1 : 0
      },
      primaryType: targetType,
      coreDefinition: description
    };
  }

  private wrapSource(title: string, path: string, content: string): string {
    return `# 来源：${title}\n路径: ${path}\n\n${content}`;
  }

  private wrapAsWikilink(title: string): string {
    const trimmed = title.trim();
    if (/^\[\[.*\]\]$/.test(trimmed)) return trimmed;
    return `[[${trimmed}]]`;
  }
}
