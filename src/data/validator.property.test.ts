/**
 * Validator 属性测试
 * 
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { Validator } from "./validator";

describe("Validator Property Tests", () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  // **Feature: cognitive-razor, Property 7: Issue 类型格式约束**
  // **验证需求：3.2**
  describe("Property 7: Issue 类型格式约束", () => {
    it("对于任意生成的 Issue 类型内容，core_tension 必须匹配 'X vs Y' 格式", () => {
      // 生成符合 "X vs Y" 格式的 core_tension
      const validTensionArb = fc
        .tuple(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 })
        )
        .map(([x, y]) => `${x} vs ${y}`);

      // 生成有效的 Issue 内容
      const validIssueArb = fc.record({
        core_tension: validTensionArb,
        description: fc.string({ minLength: 1, maxLength: 200 }),
        stakeholders: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        trade_offs: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
      });

      fc.assert(
        fc.property(validIssueArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Issue");
          
          // 验证 core_tension 格式正确时，不应该有 E010 错误
          const tensionError = result.errors.find((e) => e.code === "E010");
          expect(tensionError).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it("对于任意不符合格式的 core_tension，验证器必须返回 E010 错误", () => {
      // 生成不符合 "X vs Y" 格式的字符串
      const invalidTensionArb = fc
        .string({ minLength: 1, maxLength: 100 })
        .filter((s) => !/^.+ vs .+$/.test(s));

      // 生成无效的 Issue 内容
      const invalidIssueArb = fc.record({
        core_tension: invalidTensionArb,
        description: fc.string({ minLength: 1, maxLength: 200 }),
      });

      fc.assert(
        fc.property(invalidIssueArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Issue");
          
          // 验证 core_tension 格式错误时，必须有 E010 错误
          const tensionError = result.errors.find((e) => e.code === "E010");
          expect(tensionError).toBeDefined();
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: cognitive-razor, Property 8: Theory 类型最小约束**
  // **验证需求：3.3**
  describe("Property 8: Theory 类型最小约束", () => {
    it("对于任意生成的 Theory 类型内容，axioms 数组长度必须 ≥ 1", () => {
      // 生成有效的 axiom
      const axiomArb = fc.record({
        statement: fc.string({ minLength: 1, maxLength: 100 }),
        justification: fc.string({ minLength: 1, maxLength: 200 }),
      });

      // 生成有效的 Theory 内容（至少 1 个 axiom）
      const validTheoryArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        axioms: fc.array(axiomArb, { minLength: 1, maxLength: 10 }),
        predictions: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        evidence: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        limitations: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
      });

      fc.assert(
        fc.property(validTheoryArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Theory");
          
          // 验证 axioms 长度 ≥ 1 时，不应该有相关错误
          const axiomsError = result.errors.find(
            (e) => e.field === "axioms" && e.code === "E003"
          );
          expect(axiomsError).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it("对于任意 axioms 数组长度 < 1 的 Theory 内容，验证器必须返回错误", () => {
      // 生成无效的 Theory 内容（空 axioms）
      const invalidTheoryArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        axioms: fc.constant([]), // 空数组
        predictions: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
      });

      fc.assert(
        fc.property(invalidTheoryArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Theory");
          
          // 验证 axioms 为空时，必须有错误
          const axiomsError = result.errors.find((e) => e.field === "axioms");
          expect(axiomsError).toBeDefined();
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("对于任意 Theory 内容，每个 axiom 必须包含 justification", () => {
      // 生成缺少 justification 的 axiom
      const invalidAxiomArb = fc.record({
        statement: fc.string({ minLength: 1, maxLength: 100 }),
        // 缺少 justification
      });

      // 生成无效的 Theory 内容
      const invalidTheoryArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        axioms: fc.array(invalidAxiomArb, { minLength: 1, maxLength: 3 }),
      });

      fc.assert(
        fc.property(invalidTheoryArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Theory");
          
          // 验证缺少 justification 时，必须有错误
          const justificationError = result.errors.find((e) =>
            e.field?.includes("justification")
          );
          expect(justificationError).toBeDefined();
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: cognitive-razor, Property 9: Mechanism 类型最小约束**
  // **验证需求：3.4**
  describe("Property 9: Mechanism 类型最小约束", () => {
    it("对于任意生成的 Mechanism 类型内容，causal_chain 数组长度必须 ≥ 2", () => {
      // 生成有效的 causal step
      const causalStepArb = fc.record({
        step: fc.integer({ min: 1, max: 10 }),
        description: fc.string({ minLength: 1, maxLength: 200 }),
      });

      // 生成有效的 Mechanism 内容（至少 2 个 causal_chain）
      const validMechanismArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        operates_on: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        causal_chain: fc.array(causalStepArb, { minLength: 2, maxLength: 10 }),
        conditions: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        outcomes: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
      });

      fc.assert(
        fc.property(validMechanismArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Mechanism");
          
          // 验证 causal_chain 长度 ≥ 2 时，不应该有相关错误
          const chainError = result.errors.find(
            (e) => e.field === "causal_chain" && e.code === "E003"
          );
          expect(chainError).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it("对于任意 causal_chain 数组长度 < 2 的 Mechanism 内容，验证器必须返回错误", () => {
      // 生成无效的 Mechanism 内容（causal_chain 长度 < 2）
      const invalidMechanismArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        operates_on: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        causal_chain: fc.array(
          fc.record({
            step: fc.integer({ min: 1, max: 10 }),
            description: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          { minLength: 0, maxLength: 1 }
        ),
      });

      fc.assert(
        fc.property(invalidMechanismArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Mechanism");
          
          // 验证 causal_chain 长度 < 2 时，必须有错误
          const chainError = result.errors.find((e) => e.field === "causal_chain");
          expect(chainError).toBeDefined();
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("对于任意生成的 Mechanism 类型内容，operates_on 数组长度必须 ≥ 1", () => {
      // 生成有效的 Mechanism 内容（至少 1 个 operates_on）
      const validMechanismArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        operates_on: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        causal_chain: fc.array(
          fc.record({
            step: fc.integer({ min: 1, max: 10 }),
            description: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
      });

      fc.assert(
        fc.property(validMechanismArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Mechanism");
          
          // 验证 operates_on 长度 ≥ 1 时，不应该有相关错误
          const operatesError = result.errors.find(
            (e) => e.field === "operates_on" && e.code === "E003"
          );
          expect(operatesError).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it("对于任意 operates_on 数组长度 < 1 的 Mechanism 内容，验证器必须返回错误", () => {
      // 生成无效的 Mechanism 内容（空 operates_on）
      const invalidMechanismArb = fc.record({
        overview: fc.string({ minLength: 1, maxLength: 200 }),
        operates_on: fc.constant([]), // 空数组
        causal_chain: fc.array(
          fc.record({
            step: fc.integer({ min: 1, max: 10 }),
            description: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
      });

      fc.assert(
        fc.property(invalidMechanismArb, (data) => {
          const result = validator.validateEnrichOutput(data, "Mechanism");
          
          // 验证 operates_on 为空时，必须有错误
          const operatesError = result.errors.find((e) => e.field === "operates_on");
          expect(operatesError).toBeDefined();
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });
});
