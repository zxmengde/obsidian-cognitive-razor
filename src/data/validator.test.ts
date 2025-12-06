/**
 * Validator 单元测试
 */

import { Validator } from "./validator";

describe("Validator", () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  describe("validateJSON", () => {
    it("应该成功解析有效的 JSON", () => {
      const input = '{"name": "test", "value": 123}';
      const result = validator.validateJSON(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ name: "test", value: 123 });
      }
    });

    it("应该在 JSON 无效时返回错误", () => {
      const input = '{invalid json}';
      const result = validator.validateJSON(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E001");
      }
    });
  });

  describe("validateStandardizeOutput", () => {
    it("应该验证有效的标准化输出", () => {
      const data = {
        standard_name: {
          chinese: "测试概念",
          english: "Test Concept",
        },
        aliases: ["别名1", "别名2", "别名3"],
        type_confidences: {
          Domain: 0.2,
          Issue: 0.2,
          Theory: 0.2,
          Entity: 0.2,
          Mechanism: 0.2,
        },
        core_definition: "这是一个测试概念",
      };

      const result = validator.validateStandardizeOutput(data);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("应该检测缺少的必需字段", () => {
      const data = {
        standard_name: {
          chinese: "测试概念",
        },
        // 缺少 aliases, type_confidences, core_definition
      };

      const result = validator.validateStandardizeOutput(data);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("应该验证 aliases 数组长度", () => {
      const data = {
        standard_name: {
          chinese: "测试概念",
          english: "Test Concept",
        },
        aliases: ["别名1", "别名2"], // 只有 2 个，少于 3
        type_confidences: {
          Domain: 0.2,
          Issue: 0.2,
          Theory: 0.2,
          Entity: 0.2,
          Mechanism: 0.2,
        },
        core_definition: "这是一个测试概念",
      };

      const result = validator.validateStandardizeOutput(data);
      expect(result.valid).toBe(false);
      const aliasError = result.errors.find((e) => e.field === "aliases");
      expect(aliasError).toBeDefined();
      expect(aliasError?.code).toBe("E004");
    });

    it("应该验证 type_confidences 总和为 1.0 (C009)", () => {
      const data = {
        standard_name: {
          chinese: "测试概念",
          english: "Test Concept",
        },
        aliases: ["别名1", "别名2", "别名3"],
        type_confidences: {
          Domain: 0.3,
          Issue: 0.3,
          Theory: 0.3,
          Entity: 0.3,
          Mechanism: 0.3, // 总和 = 1.5，不等于 1.0
        },
        core_definition: "这是一个测试概念",
      };

      const result = validator.validateStandardizeOutput(data);
      expect(result.valid).toBe(false);
      const sumError = result.errors.find((e) => e.code === "E009");
      expect(sumError).toBeDefined();
    });
  });

  describe("validateEnrichOutput - Issue", () => {
    it("应该验证有效的 Issue 内容", () => {
      const data = {
        core_tension: "效率 vs 公平",
        description: "这是一个关于效率和公平的议题",
        stakeholders: ["群体A", "群体B"],
        trade_offs: ["权衡1", "权衡2"],
      };

      const result = validator.validateEnrichOutput(data, "Issue");
      if (!result.valid) {
        console.log("Issue validation errors:", result.errors);
      }
      expect(result.valid).toBe(true);
    });

    it("应该验证 core_tension 格式 (C001)", () => {
      const data = {
        core_tension: "无效格式", // 不匹配 "X vs Y"
        description: "这是一个议题",
      };

      const result = validator.validateEnrichOutput(data, "Issue");
      expect(result.valid).toBe(false);
      const tensionError = result.errors.find((e) => e.code === "E010");
      expect(tensionError).toBeDefined();
    });
  });

  describe("validateEnrichOutput - Theory", () => {
    it("应该验证有效的 Theory 内容", () => {
      const data = {
        overview: "理论概述",
        axioms: [
          {
            statement: "公理1",
            justification: "理由1",
          },
        ],
        predictions: ["预测1"],
        evidence: ["证据1"],
        limitations: ["局限1"],
      };

      const result = validator.validateEnrichOutput(data, "Theory");
      expect(result.valid).toBe(true);
    });

    it("应该验证 axioms 数组长度 (C003)", () => {
      const data = {
        overview: "理论概述",
        axioms: [], // 空数组，不满足 ≥ 1
        predictions: ["预测1"],
      };

      const result = validator.validateEnrichOutput(data, "Theory");
      expect(result.valid).toBe(false);
      const axiomsError = result.errors.find((e) => e.field === "axioms");
      expect(axiomsError).toBeDefined();
    });

    it("应该验证每个 axiom 包含 justification (C004)", () => {
      const data = {
        overview: "理论概述",
        axioms: [
          {
            statement: "公理1",
            // 缺少 justification
          },
        ],
      };

      const result = validator.validateEnrichOutput(data, "Theory");
      expect(result.valid).toBe(false);
      const justificationError = result.errors.find((e) =>
        e.field?.includes("justification")
      );
      expect(justificationError).toBeDefined();
    });
  });

  describe("validateEnrichOutput - Mechanism", () => {
    it("应该验证有效的 Mechanism 内容", () => {
      const data = {
        overview: "机制概述",
        operates_on: ["[[对象1]]"],
        causal_chain: [
          { step: 1, description: "步骤1" },
          { step: 2, description: "步骤2" },
        ],
        conditions: ["条件1"],
        outcomes: ["结果1"],
      };

      const result = validator.validateEnrichOutput(data, "Mechanism");
      expect(result.valid).toBe(true);
    });

    it("应该验证 causal_chain 数组长度 (C005)", () => {
      const data = {
        overview: "机制概述",
        operates_on: ["[[对象1]]"],
        causal_chain: [{ step: 1, description: "步骤1" }], // 只有 1 个，不满足 ≥ 2
      };

      const result = validator.validateEnrichOutput(data, "Mechanism");
      expect(result.valid).toBe(false);
      const chainError = result.errors.find((e) => e.field === "causal_chain");
      expect(chainError).toBeDefined();
    });

    it("应该验证 operates_on 数组长度 (C006)", () => {
      const data = {
        overview: "机制概述",
        operates_on: [], // 空数组，不满足 ≥ 1
        causal_chain: [
          { step: 1, description: "步骤1" },
          { step: 2, description: "步骤2" },
        ],
      };

      const result = validator.validateEnrichOutput(data, "Mechanism");
      expect(result.valid).toBe(false);
      const operatesError = result.errors.find((e) => e.field === "operates_on");
      expect(operatesError).toBeDefined();
    });
  });

  describe("validateEnrichOutput - Entity", () => {
    it("应该验证有效的 Entity 内容", () => {
      const data = {
        definition: "实体定义，包含属和种差的详细描述",
        properties: ["属性1", "属性2"],
        examples: ["例子1", "例子2"],
      };

      const result = validator.validateEnrichOutput(data, "Entity");
      expect(result.valid).toBe(true);
    });

    it("应该验证 definition 包含属和种差 (C007)", () => {
      const data = {
        definition: "太短", // 内容过短
        properties: ["属性1"],
      };

      const result = validator.validateEnrichOutput(data, "Entity");
      expect(result.valid).toBe(false);
      const defError = result.errors.find((e) => e.field === "definition");
      expect(defError).toBeDefined();
    });
  });

  describe("validateEnrichOutput - Domain", () => {
    it("应该验证有效的 Domain 内容", () => {
      const data = {
        overview: "领域概述",
        boundaries: ["边界1", "边界2"],
        key_concepts: ["[[概念1]]", "[[概念2]]"],
      };

      const result = validator.validateEnrichOutput(data, "Domain");
      expect(result.valid).toBe(true);
    });

    it("应该验证 boundaries 数组长度 (C008)", () => {
      const data = {
        overview: "领域概述",
        boundaries: [], // 空数组，不满足 ≥ 1
      };

      const result = validator.validateEnrichOutput(data, "Domain");
      expect(result.valid).toBe(false);
      const boundariesError = result.errors.find((e) => e.field === "boundaries");
      expect(boundariesError).toBeDefined();
    });
  });
});
