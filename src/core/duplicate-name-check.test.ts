/**
 * 重复名称检查测试
 * 
 * 测试场景：
 * 1. 创建新概念时检查是否存在同类型同名笔记
 * 2. 不同类型允许同名
 * 3. 同类型不同名允许创建
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineOrchestrator } from "./pipeline-orchestrator";
import { CRType, StandardizedConcept } from "../types";

describe("重复名称检查", () => {
  let orchestrator: PipelineOrchestrator;
  let mockApp: any;
  let mockVault: any;

  beforeEach(() => {
    // Mock Obsidian App
    mockVault = {
      getAbstractFileByPath: vi.fn()
    };

    mockApp = {
      vault: mockVault
    };

    // 创建 PipelineOrchestrator 实例（需要完整的依赖注入）
    // 这里简化处理，实际测试需要完整的 mock
  });

  it("应该拒绝创建同类型同名的笔记", () => {
    // 模拟已存在的文件
    mockVault.getAbstractFileByPath.mockReturnValue({
      path: "1-领域/人工智能 (Artificial Intelligence).md"
    });

    const standardizedData: StandardizedConcept = {
      standardNames: {
        Domain: { chinese: "人工智能", english: "Artificial Intelligence" },
        Issue: { chinese: "", english: "" },
        Theory: { chinese: "", english: "" },
        Entity: { chinese: "", english: "" },
        Mechanism: { chinese: "", english: "" }
      },
      typeConfidences: { Domain: 0.95 },
      primaryType: "Domain",
      coreDefinition: "研究智能代理的科学"
    };

    // 尝试创建同名笔记
    const result = orchestrator.startCreatePipelineWithStandardized(
      standardizedData,
      "Domain"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("E400");
      expect(result.error.message).toContain("已存在同类型同名的笔记");
    }
  });

  it("应该允许不同类型使用相同名称", () => {
    // 模拟 Domain 类型已存在，但 Entity 类型不存在
    mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
      if (path.includes("1-领域")) {
        return { path }; // Domain 存在
      }
      return null; // Entity 不存在
    });

    const standardizedData: StandardizedConcept = {
      standardNames: {
        Domain: { chinese: "人工智能", english: "Artificial Intelligence" },
        Issue: { chinese: "", english: "" },
        Theory: { chinese: "", english: "" },
        Entity: { chinese: "人工智能", english: "Artificial Intelligence" },
        Mechanism: { chinese: "", english: "" }
      },
      typeConfidences: { Entity: 0.90 },
      primaryType: "Entity",
      coreDefinition: "一个研究机构"
    };

    // 尝试创建 Entity 类型的同名笔记
    const result = orchestrator.startCreatePipelineWithStandardized(
      standardizedData,
      "Entity"
    );

    expect(result.ok).toBe(true);
  });

  it("应该允许同类型不同名的笔记", () => {
    // 模拟不存在任何文件
    mockVault.getAbstractFileByPath.mockReturnValue(null);

    const standardizedData: StandardizedConcept = {
      standardNames: {
        Domain: { chinese: "机器学习", english: "Machine Learning" },
        Issue: { chinese: "", english: "" },
        Theory: { chinese: "", english: "" },
        Entity: { chinese: "", english: "" },
        Mechanism: { chinese: "", english: "" }
      },
      typeConfidences: { Domain: 0.92 },
      primaryType: "Domain",
      coreDefinition: "人工智能的子领域"
    };

    const result = orchestrator.startCreatePipelineWithStandardized(
      standardizedData,
      "Domain"
    );

    expect(result.ok).toBe(true);
  });
});
