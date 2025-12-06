/**
 * PromptManager 单元测试
 */

import { PromptManager, PromptManagerConfig } from "./prompt-manager";

describe("PromptManager", () => {
  let manager: PromptManager;
  let config: PromptManagerConfig;

  beforeEach(() => {
    config = {
      templatePath: "/test/prompts",
      sharedConstraints: {
        outputFormat: "必须输出有效的 JSON 格式",
        safety: "不得生成有害内容",
        generalRules: "遵循用户指令",
      },
    };
    manager = new PromptManager(config);
  });

  describe("loadTemplate", () => {
    it("应该成功加载简单模板", () => {
      const content = "Hello {{name}}!";
      const result = manager.loadTemplate("greeting", content);

      expect(result.ok).toBe(true);
    });

    it("应该提取必需槽位", () => {
      const content = "User: {{username}}, Age: {{age}}";
      manager.loadTemplate("user-info", content);

      const templateResult = manager.getTemplate("user-info");
      expect(templateResult.ok).toBe(true);
      if (templateResult.ok) {
        expect(templateResult.value.requiredSlots).toContain("username");
        expect(templateResult.value.requiredSlots).toContain("age");
      }
    });

    it("应该区分必需和可选槽位", () => {
      const content = "Name: {{name}}, Email: {{email?}}";
      manager.loadTemplate("contact", content);

      const templateResult = manager.getTemplate("contact");
      expect(templateResult.ok).toBe(true);
      if (templateResult.ok) {
        expect(templateResult.value.requiredSlots).toContain("name");
        expect(templateResult.value.optionalSlots).toContain("email");
      }
    });
  });

  describe("getTemplate", () => {
    it("应该返回已加载的模板", () => {
      const content = "Test {{value}}";
      manager.loadTemplate("test", content);

      const result = manager.getTemplate("test");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("test");
        expect(result.value.content).toBe(content);
      }
    });

    it("应该在模板不存在时返回错误", () => {
      const result = manager.getTemplate("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
      }
    });
  });

  describe("render", () => {
    beforeEach(() => {
      manager.loadTemplate("greeting", "Hello {{name}}!");
      manager.loadTemplate("user", "User: {{username}}, Role: {{role}}");
    });

    it("应该成功渲染模板", () => {
      const result = manager.render("greeting", { name: "Alice" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("Hello Alice!");
      }
    });

    it("应该替换多个槽位", () => {
      const result = manager.render("user", {
        username: "bob",
        role: "admin",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("User: bob");
        expect(result.value).toContain("Role: admin");
      }
    });

    it("应该在缺少必需槽位时返回错误", () => {
      const result = manager.render("user", { username: "bob" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MISSING_SLOTS");
        expect(result.error.message).toContain("role");
      }
    });

    it("应该注入共享约束", () => {
      const result = manager.render("greeting", { name: "Alice" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("共享约束");
        expect(result.value).toContain("必须输出有效的 JSON 格式");
        expect(result.value).toContain("不得生成有害内容");
        expect(result.value).toContain("遵循用户指令");
      }
    });

    it("应该在模板不存在时返回错误", () => {
      const result = manager.render("nonexistent", { name: "Alice" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
      }
    });
  });

  describe("listTemplates", () => {
    it("应该返回所有已加载的模板 ID", () => {
      manager.loadTemplate("template1", "Content 1");
      manager.loadTemplate("template2", "Content 2");
      manager.loadTemplate("template3", "Content 3");

      const templates = manager.listTemplates();
      expect(templates).toHaveLength(3);
      expect(templates).toContain("template1");
      expect(templates).toContain("template2");
      expect(templates).toContain("template3");
    });

    it("应该在没有模板时返回空数组", () => {
      const templates = manager.listTemplates();
      expect(templates).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("应该清空所有模板", () => {
      manager.loadTemplate("template1", "Content 1");
      manager.loadTemplate("template2", "Content 2");

      manager.clear();

      const templates = manager.listTemplates();
      expect(templates).toHaveLength(0);
    });
  });
});
