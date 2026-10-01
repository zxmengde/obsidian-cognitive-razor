import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { ExpandOrchestrator, type AbstractPlan, type HierarchicalPlan } from "./expand-orchestrator";
import { err, ok } from "../types";
import { generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { ContentRenderer } from "./content-renderer";
import { confirmDefinePreview } from "../domain/concept";
import type { DefinePreview, ILogger } from "../types";
import type { CreateOrchestrator } from "./create-orchestrator";

type ExpandOrchestratorDeps = ConstructorParameters<typeof ExpandOrchestrator>[0];

function createLogger(): ILogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
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

function createPreview(): DefinePreview {
  return {
    candidates: {
      domain: { name: { chinese: "领域", english: "" }, confidence: 0.1 },
      issue: { name: { chinese: "议题", english: "" }, confidence: 0.1 },
      theory: { name: { chinese: "理论", english: "" }, confidence: 0.1 },
      entity: { name: { chinese: "实体", english: "" }, confidence: 1 },
      mechanism: { name: { chinese: "机制", english: "" }, confidence: 0.1 },
    },
    coreDefinition: "说明",
  };
}

describe("ExpandOrchestrator lifecycle", () => {
  it("keeps abstract expansion at a preview until the user confirms it", async () => {
    const currentFile = createFile("current.md");
    const sourceFile = createFile("source.md");
    const confirmCreate = vi.fn(async () => ok("workflow-1"));
    const createOrchestrator = {
      defineDirect: vi.fn(async () => ok(createPreview())),
      confirmCreate,
    } as unknown as CreateOrchestrator;
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => path === "current.md" ? currentFile : sourceFile,
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as unknown as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator,
      fileStorage: {} as never,
    });
    const plan: AbstractPlan = {
      mode: "abstract",
      currentTitle: "当前概念",
      currentUid: "current-1",
      currentPath: "current.md",
      currentType: "entity",
      candidates: [{ uid: "source-1", name: "来源概念", path: "source.md", similarity: 0.9 }],
    };

    const prepared = await orchestrator.prepareAbstractPreview(plan, plan.candidates);
    expect(prepared).toMatchObject({ ok: true, value: { type: "entity", targetPath: "4-实体/实体.md" } });
    expect(confirmCreate).not.toHaveBeenCalled();
    if (prepared.ok) expect(prepared.value.parents).toEqual(["[[current]]", "[[source]]"]);
    if (!prepared.ok) return;

    const confirmed = confirmDefinePreview(prepared.value.preview, prepared.value.type, {
      source: "abstract-expand",
      parents: prepared.value.parents,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    await orchestrator.confirmAbstract(prepared.value, confirmed.value);
    expect(confirmCreate).toHaveBeenCalledWith(confirmed.value, {
      targetPathOverride: "4-实体/实体.md",
    });
  });

  it("starts every creatable hierarchical candidate and reports partial failures", async () => {
    const confirmCreate = vi.fn()
      .mockResolvedValueOnce(ok("workflow-1"))
      .mockResolvedValueOnce(err("E320_TASK_CONFLICT", "目标已存在"));
    const createOrchestrator = { confirmCreate } as unknown as CreateOrchestrator;
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {} as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator,
      fileStorage: {} as never,
    });
    const plan: HierarchicalPlan = {
      mode: "hierarchical",
      parentTitle: "父概念",
      currentPath: "parent.md",
      currentType: "domain",
      candidates: [
        { name: "子领域", description: "说明", targetType: "domain", targetPath: "1-领域/子领域.md", status: "creatable" },
        { name: "议题", targetType: "issue", targetPath: "2-议题/议题.md", status: "creatable" },
        { name: "旧概念", targetType: "issue", targetPath: "2-议题/旧概念.md", status: "existing" },
      ],
    };

    const result = await orchestrator.confirmHierarchical(plan, plan.candidates);

    expect(result).toEqual(ok({ started: 1, failed: [{ name: "议题", message: "目标已存在" }] }));
    expect(confirmCreate).toHaveBeenCalledTimes(2);
    expect(confirmCreate).toHaveBeenNthCalledWith(
      1,
      {
        type: "domain",
        name: { chinese: "子领域", english: "" },
        coreDefinition: "说明",
        source: "hierarchical-expand",
        parents: ["[[parent]]"],
      },
      { targetPathOverride: "1-领域/子领域.md" },
    );
  });

  it("只从当前类型的标准结构章节生成层级候选", async () => {
    const file = createFile("domain.md");
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          cachedRead: async () => `---
cruid: domain-1
type: domain
name: 领域
status: draft
created: 2026-08-16 12:00:00
updated: 2026-08-16 12:00:00
aliases: []
tags: []
parents: []
---

## 子领域
- [[子领域 A]]：说明

## 核心议题
- [[议题 B]]：说明`,
          getAbstractFileByPath: () => null,
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as unknown as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator: {} as CreateOrchestrator,
      fileStorage: {} as never,
    });

    const result = await orchestrator.prepare(file);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.mode === "hierarchical") {
      expect(result.value.candidates.map(({ name, targetType }) => ({ name, targetType }))).toEqual([
        { name: "子领域 A", targetType: "domain" },
        { name: "议题 B", targetType: "issue" },
      ]);
    }
  });

  it("marks hierarchical candidates with illegal filename characters as invalid", async () => {
    const file = createFile("issue.md");
    const confirmCreate = vi.fn(async () => ok("wf"));
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          cachedRead: async () => `---
cruid: issue-1
type: issue
name: 心身问题
status: draft
created: 2026-08-16 12:00:00
updated: 2026-08-16 12:00:00
aliases: []
tags: []
parents: []
---

## 子议题
- [[先天/后天之争]]：说明
- [[意识难题]]：说明`,
          getAbstractFileByPath: () => null,
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as unknown as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator: { confirmCreate } as unknown as CreateOrchestrator,
      fileStorage: {} as never,
    });

    const plan = await orchestrator.prepare(file);
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.value.mode !== "hierarchical") return;

    const bad = plan.value.candidates.find((c) => c.name === "先天/后天之争");
    expect(bad).toMatchObject({ status: "invalid", reason: "名称包含非法字符" });
    const okCandidate = plan.value.candidates.find((c) => c.name === "意识难题");
    expect(okCandidate?.status).toBe("creatable");

    const onlyBad = await orchestrator.confirmHierarchical(plan.value, bad ? [bad] : []);
    expect(onlyBad.ok).toBe(false);
    expect(confirmCreate).not.toHaveBeenCalled();
  });

  it("明确拒绝使用大写 type 或 status 的旧笔记", async () => {
    const file = createFile("legacy-domain.md");
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          cachedRead: async () => `---
cruid: legacy-domain-1
type: Domain
name: 旧领域
status: Draft
created: 2026-08-16 12:00:00
updated: 2026-08-16 12:00:00
aliases: []
tags: []
parents: []
---
`,
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator: {} as CreateOrchestrator,
      fileStorage: {} as never,
    });

    await expect(orchestrator.prepare(file)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "E101_INVALID_INPUT",
        message: "当前笔记的 type 和 status 必须使用小写规范值（例如 type: domain、status: draft）；插件不会自动改写现有笔记",
      },
    });
  });

  it("不从无标准章节的松散链接猜测候选类型", async () => {
    const file = createFile("domain.md");
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          cachedRead: async () => `---
cruid: domain-1
type: domain
name: 领域
status: draft
created: 2026-08-16 12:00:00
updated: 2026-08-16 12:00:00
aliases: []
tags: []
parents: []
---

## 随手记录
- [[无法判断类型的链接]]`,
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as unknown as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator: {} as CreateOrchestrator,
      fileStorage: {} as never,
    });

    const result = await orchestrator.prepare(file);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "E310_INVALID_STATE", message: "未找到可创建的候选项，请检查正文结构" },
    });
  });

  it("卸载期间不会在 Define 完成后启动创建管线，并等待异步拓展结束", async () => {
    let releaseDefine!: () => void;
    const defineGate = new Promise<void>((resolve) => {
      releaseDefine = resolve;
    });
    const currentFile = createFile("current.md");
    const sourceFile = createFile("source.md");
    const confirmCreate = vi.fn(async () => ok("workflow-1"));
    const createOrchestrator = {
      defineDirect: async () => {
        await defineGate;
        return ok(createPreview());
      },
      confirmCreate,
    } as unknown as CreateOrchestrator;
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => path === "current.md" ? currentFile : sourceFile,
          cachedRead: async () => "正文",
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as unknown as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(
      deps,
      {
        createOrchestrator,
        fileStorage: {} as never,
      },
    );
    const plan: AbstractPlan = {
      mode: "abstract",
      currentTitle: "当前概念",
      currentUid: "current-1",
      currentPath: "current.md",
      currentType: "entity",
      candidates: [{ uid: "source-1", name: "来源概念", path: "source.md", similarity: 0.9 }],
    };

    const creating = orchestrator.prepareAbstractPreview(plan, plan.candidates);
    await Promise.resolve();
    const disposing = orchestrator.dispose();
    releaseDefine();
    const [result] = await Promise.all([creating, disposing]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("E310_INVALID_STATE");
    }
    expect(confirmCreate).not.toHaveBeenCalled();
  });

  it("does not start an abstract creation when every selected source has disappeared", async () => {
    const currentFile = createFile("current.md");
    const defineDirect = vi.fn(async () => ok(createPreview()));
    const createOrchestrator = {
      defineDirect,
      confirmCreate: vi.fn(async () => ok("workflow-1")),
    } as unknown as CreateOrchestrator;
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme: {
        domain: "1-领域", issue: "2-议题", theory: "3-理论", entity: "4-实体", mechanism: "5-机制",
      } }) } as ExpandOrchestratorDeps["settingsStore"],
      logger: createLogger(),
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => path === "current.md" ? currentFile : null,
        },
      } as unknown as ExpandOrchestratorDeps["app"],
      vectorIndex: {} as unknown as ExpandOrchestratorDeps["vectorIndex"],
    };
    const orchestrator = new ExpandOrchestrator(deps, {
      createOrchestrator,
      fileStorage: {} as never,
    });
    const plan: AbstractPlan = {
      mode: "abstract",
      currentTitle: "当前概念",
      currentUid: "current-1",
      currentPath: "current.md",
      currentType: "entity",
      candidates: [{ uid: "missing-1", name: "已删除概念", path: "missing.md", similarity: 0.9 }],
    };

    const result = await orchestrator.prepareAbstractPreview(plan, plan.candidates);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("E311_NOT_FOUND");
    expect(defineDirect).not.toHaveBeenCalled();
  });
});


describe("ExpandOrchestrator qualified paths", () => {
  const directoryScheme = { domain: "D", issue: "I", theory: "T", entity: "E", mechanism: "M" };
  function setup(body: string) {
    const parent = createFile("Moved/Parent.md");
    const files = new Map([["Archive/Canonical.md", createFile("Archive/Canonical.md")], ["Root Canonical.md", createFile("Root Canonical.md")]]);
    const confirmCreate = vi.fn(async () => ok("workflow"));
    const deps: ExpandOrchestratorDeps = {
      settingsStore: { getSettings: () => ({ directoryScheme }) } as ExpandOrchestratorDeps["settingsStore"], logger: createLogger(),
      app: { vault: {
        cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: "parent", type: "theory", name: "Displayed Parent" }), body),
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      } } as unknown as ExpandOrchestratorDeps["app"], vectorIndex: {} as never,
    };
    return { parent, confirmCreate, orchestrator: new ExpandOrchestrator(deps, { createOrchestrator: { confirmCreate } as unknown as CreateOrchestrator, fileStorage: {} as never }) };
  }
  it("expands renderer-qualified same-name targets without mixing types and links back by actual path", async () => {
    const body = new ContentRenderer().renderNoteMarkdown({ type: "theory", title: "Parent", language: "zh", directoryScheme,
      content: { entities: [{ name: "Same" }], mechanisms: [{ name: "Same" }] },
    });
    const f = setup(body);
    const prepared = await f.orchestrator.prepare(f.parent);
    if (!prepared.ok || prepared.value.mode !== "hierarchical") throw new Error("prepare failed");
    expect(prepared.value.candidates).toMatchObject([
      { name: "Same", targetType: "entity", targetPath: "E/Same.md", status: "creatable" },
      { name: "Same", targetType: "mechanism", targetPath: "M/Same.md", status: "creatable" },
    ]);
    await f.orchestrator.confirmHierarchical(prepared.value, prepared.value.candidates);
    expect(f.confirmCreate).toHaveBeenCalledTimes(2);
    for (const [concept] of f.confirmCreate.mock.calls as unknown as Array<[{ parents: string[] }]>) expect(concept.parents).toEqual(["[[Moved/Parent]]"]);
  });
  it("recognizes full paths repaired by merge, .md, aliases and headings while preserving other candidates", async () => {
    const f = setup("## entities\n- [[Archive/Canonical.md#Section|Old Name]]\n- [[E/New|Shown Name]]\n- [[E/Another]]");
    const prepared = await f.orchestrator.prepare(f.parent);
    if (!prepared.ok || prepared.value.mode !== "hierarchical") throw new Error("prepare failed");
    expect(prepared.value.candidates).toMatchObject([
      { name: "Canonical", targetPath: "Archive/Canonical.md", status: "existing" },
      { name: "New", targetPath: "E/New.md", status: "creatable" },
      { name: "Another", targetPath: "E/Another.md", status: "creatable" },
    ]);
  });
  it("respects a merge-repaired canonical target in the vault root instead of creating a same-name typed note", async () => {
    const f = setup("## entities\n- [[Root Canonical]]");
    const prepared = await f.orchestrator.prepare(f.parent);
    if (!prepared.ok || prepared.value.mode !== "hierarchical") throw new Error("prepare failed");
    expect(prepared.value.candidates).toMatchObject([{ targetPath: "Root Canonical.md", status: "existing" }]);
    await f.orchestrator.confirmHierarchical(prepared.value, prepared.value.candidates);
    expect(f.confirmCreate).not.toHaveBeenCalled();
  });
  it("retains explicit old-directory targets after settings changes and does not collapse same-name paths", async () => {
    const f = setup("## entities\n- [[Old E/Same|Same]]\n- [[Older E/Same.md]]\n- [[E/Same|Same]]");
    const prepared = await f.orchestrator.prepare(f.parent);
    if (!prepared.ok || prepared.value.mode !== "hierarchical") throw new Error("prepare failed");
    expect(prepared.value.candidates).toMatchObject([
      { name: "Same", targetPath: "Old E/Same.md", status: "creatable" },
      { name: "Same", targetPath: "Older E/Same.md", status: "creatable" },
      { name: "Same", targetPath: "E/Same.md", status: "creatable" },
    ]);
  });
  it("distinguishes new explicit root targets from legacy bare aliases", async () => {
    const rootBody = new ContentRenderer().renderNoteMarkdown({ type: "theory", title: "Parent", language: "zh",
      directoryScheme: { ...directoryScheme, entity: "" }, content: { entities: [{ name: "Root Child" }] },
    });
    const f = setup(`${rootBody}\n- [[Legacy Child|Display]]`);
    const prepared = await f.orchestrator.prepare(f.parent);
    if (!prepared.ok || prepared.value.mode !== "hierarchical") throw new Error("prepare failed");
    expect(prepared.value.candidates).toMatchObject([
      { targetPath: "Root Child.md", status: "creatable" },
      { targetPath: "E/Legacy Child.md", status: "creatable" },
    ]);
  });
  it("does not create traversal or unrecognized directory paths", async () => {
    const f = setup("## entities\n- [[E/../Escape]]\n- [[/E/Absolute]]\n- [[Unknown/Name]]");
    const prepared = await f.orchestrator.prepare(f.parent);
    if (!prepared.ok || prepared.value.mode !== "hierarchical") throw new Error("prepare failed");
    expect(prepared.value.candidates.every((candidate) => candidate.status === "invalid")).toBe(true);
    expect((await f.orchestrator.confirmHierarchical(prepared.value, prepared.value.candidates)).ok).toBe(false);
    expect(f.confirmCreate).not.toHaveBeenCalled();
  });
});
