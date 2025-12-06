/**
 * TaskRunner 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { TaskRunner, TaskRunnerConfig } from "./task-runner";
import { ProviderManager } from "./provider-manager";
import { PromptManager } from "./prompt-manager";
import { Validator } from "../data/validator";
import { UndoManager } from "./undo-manager";
import { LockManager } from "./lock-manager";
import { RetryHandler } from "./retry-handler";
import { FileStorage } from "../data/file-storage";
import { TaskRecord, CRType } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("TaskRunner 属性测试", () => {
  // 生成器：知识类型
  const crTypeArb = fc.constantFrom<CRType>(
    "Domain",
    "Issue",
    "Theory",
    "Entity",
    "Mechanism"
  );

  // 生成器：概念描述
  const conceptDescriptionArb = fc.string({ minLength: 10, maxLength: 200 });

  // 生成器：概念名称
  const conceptNameArb = fc.string({ minLength: 3, maxLength: 50 });

  // 生成器：核心定义
  const coreDefinitionArb = fc.string({ minLength: 20, maxLength: 300 });

  /**
   * 创建 Mock Provider Manager
   * 返回符合规范的标准化输出
   */
  function createMockProviderManager() {
    return {
      async chat(request: any) {
        // 根据请求内容判断是标准化还是内容生成
        const content = request.messages[0].content;
        
        if (content.includes("standardizeClassify") || content.includes("标准化")) {
          // 返回标准化输出
          const output = {
            standard_name: {
              chinese: "测试概念",
              english: "Test Concept",
            },
            aliases: ["别名1", "别名2", "别名3", "别名4", "别名5"],
            type_confidences: {
              Domain: 0.3,
              Issue: 0.2,
              Theory: 0.2,
              Entity: 0.2,
              Mechanism: 0.1,
            },
            core_definition: "这是一个测试概念的核心定义。",
          };
          
          return {
            ok: true,
            value: {
              content: JSON.stringify(output),
              tokensUsed: 100,
            },
          };
        } else {
          // 返回内容生成输出（根据类型）
          let output: any = {
            description: "这是一个详细的描述。",
          };
          
          // 根据内容判断类型并添加相应字段
          if (content.includes("Issue")) {
            output.core_tension = "传统方法 vs 现代方法";
          } else if (content.includes("Theory")) {
            output.axioms = [
              {
                statement: "公理1",
                justification: "公理1的理由",
              },
            ];
          } else if (content.includes("Mechanism")) {
            output.causal_chain = ["步骤1", "步骤2"];
            output.operates_on = ["实体1"];
          } else if (content.includes("Entity")) {
            output.definition = "这是一个包含属和种差的定义，描述了实体的本质特征。";
          } else if (content.includes("Domain")) {
            output.boundaries = ["边界1"];
          }
          
          return {
            ok: true,
            value: {
              content: JSON.stringify(output),
              tokensUsed: 150,
            },
          };
        }
      },
      async embed(request: any) {
        return {
          ok: true,
          value: {
            embedding: Array(10).fill(0).map(() => Math.random()),
            tokensUsed: 50,
          },
        };
      },
      async checkAvailability(providerId: string) {
        return {
          ok: true,
          value: {
            chat: true,
            embedding: true,
            maxContextLength: 32768,
            models: ["test-model"],
          },
        };
      },
      getConfiguredProviders() {
        return [];
      },
      setProvider() {},
      removeProvider() {},
    };
  }

  /**
   * 创建 Mock Prompt Manager
   */
  function createMockPromptManager() {
    return {
      loadTemplate() {
        return { ok: true, value: undefined };
      },
      getTemplate() {
        return {
          ok: true,
          value: {
            id: "test",
            content: "test template",
            requiredSlots: [],
          },
        };
      },
      render(templateId: string, slots: any) {
        return {
          ok: true,
          value: `Rendered template: ${templateId}`,
        };
      },
      listTemplates() {
        return [];
      },
      clear() {},
    };
  }

  /**
   * 创建测试配置
   */
  async function createTestConfig(testDir: string): Promise<TaskRunnerConfig> {
    const storage = new FileStorage({ dataDir: testDir });
    const providerManager = createMockProviderManager() as any;
    const promptManager = createMockPromptManager() as any;
    const validator = new Validator();
    const undoManager = new UndoManager({
      storage,
      maxSnapshots: 100,
    });
    const lockManager = new LockManager();
    const retryHandler = new RetryHandler();

    await undoManager.initialize();

    return {
      providerManager,
      promptManager,
      validator,
      undoManager,
      lockManager,
      storage,
      retryHandler,
      defaultProviderId: "test-provider",
      defaultChatModel: "test-model",
      defaultEmbedModel: "test-embed-model",
    };
  }

  /**
   * **Feature: cognitive-razor, Property 1: 标准化输出完整性**
   * 
   * 对于任意概念描述输入，标准化处理后的输出必须包含中文名、英文名、3-10 个别名、
   * 五种类型的置信度（总和为 1.0）和核心定义。
   * 
   * **验证需求：1.1, 1.2, 1.3**
   */
  it("属性 1: 标准化输出完整性 - 输出必须包含所有必需字段", async () => {
    await fc.assert(
      fc.asyncProperty(
        conceptDescriptionArb,
        fc.uuid(),
        async (conceptDescription, nodeId) => {
          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `task-runner-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建测试配置
            const config = await createTestConfig(testDir);
            const taskRunner = new TaskRunner(config);

            // 创建标准化任务
            const task: TaskRecord = {
              id: `task-${Date.now()}`,
              nodeId,
              taskType: "standardizeClassify",
              state: "Pending",
              attempt: 0,
              maxAttempts: 3,
              payload: {
                conceptDescription,
              },
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            };

            // 执行任务
            const result = await taskRunner.run(task);

            // 验证：任务必须成功
            expect(result.ok).toBe(true);

            if (result.ok) {
              const data = result.value.data;

              // 验证：必须包含 standard_name
              expect(data).toHaveProperty("standard_name");
              expect(data.standard_name).toHaveProperty("chinese");
              expect(data.standard_name).toHaveProperty("english");
              expect(typeof (data.standard_name as any).chinese).toBe("string");
              expect(typeof (data.standard_name as any).english).toBe("string");
              expect((data.standard_name as any).chinese.length).toBeGreaterThan(0);
              expect((data.standard_name as any).english.length).toBeGreaterThan(0);

              // 验证：必须包含 aliases，且长度在 3-10 之间
              expect(data).toHaveProperty("aliases");
              expect(Array.isArray(data.aliases)).toBe(true);
              expect((data.aliases as any[]).length).toBeGreaterThanOrEqual(3);
              expect((data.aliases as any[]).length).toBeLessThanOrEqual(10);

              // 验证：必须包含 type_confidences
              expect(data).toHaveProperty("type_confidences");
              const confidences = data.type_confidences as any;
              expect(confidences).toHaveProperty("Domain");
              expect(confidences).toHaveProperty("Issue");
              expect(confidences).toHaveProperty("Theory");
              expect(confidences).toHaveProperty("Entity");
              expect(confidences).toHaveProperty("Mechanism");

              // 验证：所有置信度都是数字
              expect(typeof confidences.Domain).toBe("number");
              expect(typeof confidences.Issue).toBe("number");
              expect(typeof confidences.Theory).toBe("number");
              expect(typeof confidences.Entity).toBe("number");
              expect(typeof confidences.Mechanism).toBe("number");

              // 验证：置信度总和为 1.0（允许浮点误差）
              const sum =
                confidences.Domain +
                confidences.Issue +
                confidences.Theory +
                confidences.Entity +
                confidences.Mechanism;
              expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);

              // 验证：必须包含 core_definition
              expect(data).toHaveProperty("core_definition");
              expect(typeof data.core_definition).toBe("string");
              expect((data.core_definition as string).length).toBeGreaterThan(0);
            }

            return true;
          } finally {
            // 清理测试目录
            if (fs.existsSync(testDir)) {
              fs.rmSync(testDir, { recursive: true, force: true });
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: cognitive-razor, Property 2: 类型置信度总和恒等**
   * 
   * 对于任意标准化输出，五种知识类型的置信度分数总和必须精确等于 1.0。
   * 
   * **验证需求：1.3**
   */
  it("属性 2: 类型置信度总和恒等 - 置信度总和必须等于 1.0", async () => {
    await fc.assert(
      fc.asyncProperty(
        conceptDescriptionArb,
        fc.uuid(),
        async (conceptDescription, nodeId) => {
          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `task-runner-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建测试配置
            const config = await createTestConfig(testDir);
            const taskRunner = new TaskRunner(config);

            // 创建标准化任务
            const task: TaskRecord = {
              id: `task-${Date.now()}`,
              nodeId,
              taskType: "standardizeClassify",
              state: "Pending",
              attempt: 0,
              maxAttempts: 3,
              payload: {
                conceptDescription,
              },
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            };

            // 执行任务
            const result = await taskRunner.run(task);

            // 验证：任务必须成功
            expect(result.ok).toBe(true);

            if (result.ok) {
              const data = result.value.data;
              const confidences = data.type_confidences as any;

              // 计算总和
              const sum =
                confidences.Domain +
                confidences.Issue +
                confidences.Theory +
                confidences.Entity +
                confidences.Mechanism;

              // 验证：总和必须等于 1.0（允许浮点误差 0.0001）
              expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);

              // 验证：每个置信度都在 [0, 1] 范围内
              expect(confidences.Domain).toBeGreaterThanOrEqual(0);
              expect(confidences.Domain).toBeLessThanOrEqual(1);
              expect(confidences.Issue).toBeGreaterThanOrEqual(0);
              expect(confidences.Issue).toBeLessThanOrEqual(1);
              expect(confidences.Theory).toBeGreaterThanOrEqual(0);
              expect(confidences.Theory).toBeLessThanOrEqual(1);
              expect(confidences.Entity).toBeGreaterThanOrEqual(0);
              expect(confidences.Entity).toBeLessThanOrEqual(1);
              expect(confidences.Mechanism).toBeGreaterThanOrEqual(0);
              expect(confidences.Mechanism).toBeLessThanOrEqual(1);
            }

            return true;
          } finally {
            // 清理测试目录
            if (fs.existsSync(testDir)) {
              fs.rmSync(testDir, { recursive: true, force: true });
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
