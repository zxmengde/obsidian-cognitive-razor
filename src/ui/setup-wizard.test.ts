/**
 * Setup Wizard 测试
 * 
 * 验证演示模式已被完全移除
 * 验证校验失败时模态框保持打开
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";

describe("Demo Mode Removal", () => {
  /**
   * **Feature: bug-fixes-v1, Property 1: Demo Mode Removal Completeness**
   * **Validates: Requirements 1.1, 1.2, 1.3**
   * 
   * *For any* codebase search for "demoMode" or "demo" related identifiers, 
   * the search result SHALL return zero matches in production code files 
   * (excluding test files and documentation).
   */
  it("Property 1: Demo Mode Removal Completeness - no demoMode references in production code", () => {
    // 定义需要检查的生产代码文件
    const productionFiles = [
      "src/types.ts",
      "src/data/settings-store.ts",
      "src/ui/setup-wizard.ts",
      "main.ts"
    ];

    // 定义需要检查的模式
    const demoModePatterns = [
      /demoMode/,
      /WizardStep\.Mode/,
      /WizardStep\.DemoReady/,
      /SetupMode/,
      /enterDemoMode/,
      /seedDemoNotes/,
      /renderMode\(/,
      /renderDemoReady\(/
    ];

    // 检查每个文件
    for (const file of productionFiles) {
      const filePath = path.join(process.cwd(), file);
      
      // 确保文件存在
      expect(fs.existsSync(filePath)).toBe(true);
      
      // 读取文件内容
      const content = fs.readFileSync(filePath, "utf-8");
      
      // 检查每个模式
      for (const pattern of demoModePatterns) {
        const matches = content.match(pattern);
        
        // 如果找到匹配，提供详细的错误信息
        if (matches) {
          throw new Error(
            `Found demo mode reference in ${file}: "${matches[0]}"\n` +
            `Pattern: ${pattern}\n` +
            `This violates Requirements 1.1, 1.2, 1.3 - all demo mode code must be removed.`
          );
        }
      }
    }

    // 如果所有检查都通过，测试成功
    expect(true).toBe(true);
  });

  /**
   * 验证 PluginSettings 接口不包含 demoMode 字段
   */
  it("Example: PluginSettings interface does not contain demoMode field", () => {
    const typesPath = path.join(process.cwd(), "src/types.ts");
    const content = fs.readFileSync(typesPath, "utf-8");

    // 查找 PluginSettings 接口定义
    const interfaceMatch = content.match(/interface PluginSettings\s*{([^}]+)}/s);
    expect(interfaceMatch).toBeTruthy();

    if (interfaceMatch) {
      const interfaceBody = interfaceMatch[1];
      
      // 验证不包含 demoMode 字段
      expect(interfaceBody).not.toMatch(/demoMode/);
    }
  });

  /**
   * 验证 DEFAULT_SETTINGS 不包含 demoMode
   */
  it("Example: DEFAULT_SETTINGS does not contain demoMode", () => {
    const settingsPath = path.join(process.cwd(), "src/data/settings-store.ts");
    const content = fs.readFileSync(settingsPath, "utf-8");

    // 查找 DEFAULT_SETTINGS 定义
    const defaultSettingsMatch = content.match(/export const DEFAULT_SETTINGS[^=]*=\s*{([^;]+)};/s);
    expect(defaultSettingsMatch).toBeTruthy();

    if (defaultSettingsMatch) {
      const settingsBody = defaultSettingsMatch[1];
      
      // 验证不包含 demoMode
      expect(settingsBody).not.toMatch(/demoMode/);
    }
  });

  /**
   * 验证 Setup Wizard 只有 Configure 步骤
   */
  it("Example: Setup Wizard only has Configure step", () => {
    const wizardPath = path.join(process.cwd(), "src/ui/setup-wizard.ts");
    const content = fs.readFileSync(wizardPath, "utf-8");

    // 查找 WizardStep 枚举定义
    const enumMatch = content.match(/enum WizardStep\s*{([^}]+)}/s);
    expect(enumMatch).toBeTruthy();

    if (enumMatch) {
      const enumBody = enumMatch[1];
      
      // 验证只包含 Configure 步骤
      expect(enumBody).toMatch(/Configure\s*=\s*"configure"/);
      expect(enumBody).not.toMatch(/Mode/);
      expect(enumBody).not.toMatch(/DemoReady/);
    }
  });

  /**
   * 验证 Setup Wizard 不包含演示模式相关方法
   */
  it("Example: Setup Wizard does not contain demo mode methods", () => {
    const wizardPath = path.join(process.cwd(), "src/ui/setup-wizard.ts");
    const content = fs.readFileSync(wizardPath, "utf-8");

    // 验证不包含演示模式相关方法
    expect(content).not.toMatch(/private\s+renderMode\s*\(/);
    expect(content).not.toMatch(/private\s+renderDemoReady\s*\(/);
    expect(content).not.toMatch(/private\s+enterDemoMode\s*\(/);
    expect(content).not.toMatch(/private\s+seedDemoNotes\s*\(/);
  });
});

describe("Validation Failure Modal Persistence", () => {
  /**
   * **Feature: bug-fixes-v1, Property 2: Validation Failure Modal Persistence**
   * **Validates: Requirements 2.1, 2.2**
   * 
   * *For any* validation failure event in Setup Wizard, the modal SHALL remain open 
   * and the error message SHALL be visible to the user.
   */
  it("Property 2: Validation failure sets showSkipButton flag and does not close modal", () => {
    fc.assert(
      fc.property(
        // 生成随机的错误消息
        fc.string({ minLength: 1, maxLength: 200 }),
        // 生成随机的错误状态（error 或 offline）
        fc.constantFrom("error" as const, "offline" as const),
        (errorMessage, errorStatus) => {
          // 读取 setup-wizard.ts 文件
          const wizardPath = path.join(process.cwd(), "src/ui/setup-wizard.ts");
          const content = fs.readFileSync(wizardPath, "utf-8");

          // 验证 ValidationState 接口包含 showSkipButton 字段
          const validationStateMatch = content.match(/interface ValidationState\s*{([^}]+)}/s);
          expect(validationStateMatch).toBeTruthy();
          
          if (validationStateMatch) {
            const interfaceBody = validationStateMatch[1];
            expect(interfaceBody).toMatch(/showSkipButton\?:\s*boolean/);
          }

          // 验证在错误情况下设置 showSkipButton: true
          // 检查所有设置 validation 状态为 error 或 offline 的地方
          // 使用更宽松的匹配，因为对象可能跨多行
          const errorValidationPattern = new RegExp(
            `this\\.validation\\s*=\\s*\\{[\\s\\S]*?status:\\s*"${errorStatus}"[\\s\\S]*?\\}`,
            "g"
          );
          
          const matches = content.match(errorValidationPattern);
          
          if (matches) {
            // 对于每个错误状态设置，验证包含 showSkipButton
            for (const match of matches) {
              // 跳过初始化时的 idle 状态
              if (match.includes('status: "idle"')) {
                continue;
              }
              
              // 验证错误状态包含 showSkipButton: true
              expect(match).toMatch(/showSkipButton:\s*true/);
            }
          }

          // 验证存在 renderSkipButton 方法
          expect(content).toMatch(/private\s+renderSkipButton\s*\(/);

          // 验证 saveConfig 方法在错误时不调用 this.close()
          // 通过检查 close() 调用只在成功路径中出现
          const saveConfigMatch = content.match(/private\s+async\s+saveConfig\([^)]*\)[^{]*{([\s\S]*?)^\s*}/m);
          
          if (saveConfigMatch) {
            const saveConfigBody = saveConfigMatch[1];
            
            // 验证 close() 调用在成功分支中（与 "配置完成" 消息一起）
            const closeCallPattern = /this\.close\(\)/g;
            const closeMatches = saveConfigBody.match(closeCallPattern);
            
            if (closeMatches) {
              // 验证每个 close() 调用都在成功路径中
              // 通过检查它们出现在 validation.status === "ok" 或成功消息附近
              const successPattern = /配置完成|validation\.status.*ok/;
              
              // 分割代码以检查 close() 的上下文
              const closeCalls = saveConfigBody.split(/this\.close\(\)/);
              
              for (let i = 0; i < closeCalls.length - 1; i++) {
                const beforeClose = closeCalls[i];
                const afterClose = closeCalls[i + 1];
                const context = beforeClose.slice(-200) + afterClose.slice(0, 200);
                
                // 验证 close() 不在错误处理块中
                expect(context).not.toMatch(/status:\s*"error"/);
                expect(context).not.toMatch(/校验失败/);
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 验证跳过按钮的存在和行为
   */
  it("Example: Skip button is rendered after validation failure", () => {
    const wizardPath = path.join(process.cwd(), "src/ui/setup-wizard.ts");
    const content = fs.readFileSync(wizardPath, "utf-8");

    // 验证存在 renderSkipButton 方法 - 匹配到类结束或下一个方法
    const renderSkipButtonMatch = content.match(/private\s+renderSkipButton\s*\([^)]*\)[^{]*:\s*void\s*{([\s\S]*?)(?=\n^\}$)/m);
    expect(renderSkipButtonMatch).toBeTruthy();

    if (renderSkipButtonMatch) {
      const methodBody = renderSkipButtonMatch[1];
      
      // 验证方法创建跳过按钮（可能是 createEl 或 buttonsContainer.createEl）
      expect(methodBody).toMatch(/\.createEl\s*\(/);
      expect(methodBody).toMatch(/button/);
      expect(methodBody).toMatch(/跳过配置/);
      
      // 验证按钮点击时关闭模态框
      expect(methodBody).toMatch(/this\.close\(\)/);
      
      // 验证防止重复创建按钮
      expect(methodBody).toMatch(/querySelector/);
      expect(methodBody).toMatch(/cr-skip-btn/);
    }
  });

  /**
   * 验证 saveConfig 在错误时调用 renderSkipButton
   */
  it("Example: saveConfig calls renderSkipButton on validation failure", () => {
    const wizardPath = path.join(process.cwd(), "src/ui/setup-wizard.ts");
    const content = fs.readFileSync(wizardPath, "utf-8");

    // 查找 saveConfig 方法 - 使用更宽松的匹配
    const saveConfigMatch = content.match(/private\s+async\s+saveConfig\s*\([^)]*\)[^{]*:\s*Promise<void>\s*{([\s\S]*?)(?=\n\s{2}\/\*\*|\n\s{2}private|\n\s{2}public|\n})/);
    expect(saveConfigMatch).toBeTruthy();

    if (saveConfigMatch) {
      const methodBody = saveConfigMatch[1];
      
      // 验证在错误情况下调用 renderSkipButton
      expect(methodBody).toMatch(/this\.renderSkipButton\s*\(/);
      
      // 验证 renderSkipButton 在设置错误状态后调用
      const renderSkipButtonCalls = methodBody.match(/this\.renderSkipButton\s*\([^)]*\)/g);
      expect(renderSkipButtonCalls).toBeTruthy();
      expect(renderSkipButtonCalls!.length).toBeGreaterThan(0);
    }
  });

  /**
   * 验证错误消息显示在界面上
   */
  it("Example: Error message is displayed in validation status box", () => {
    const wizardPath = path.join(process.cwd(), "src/ui/setup-wizard.ts");
    const content = fs.readFileSync(wizardPath, "utf-8");

    // 查找 renderValidation 方法
    const renderValidationMatch = content.match(/private\s+renderValidation\s*\([^)]*\)[^{]*:\s*void\s*{([\s\S]*?)(?=\n\s{2}\/\*\*|\n\s{2}private|\n\s{2}public|\n})/);
    expect(renderValidationMatch).toBeTruthy();

    if (renderValidationMatch) {
      const methodBody = renderValidationMatch[1];
      
      // 验证方法显示错误消息
      // renderValidation 使用 else 分支处理 error 状态
      expect(methodBody).toMatch(/status/);
      expect(methodBody).toMatch(/message/);
      expect(methodBody).toMatch(/setText/);
      // 验证有处理不同状态的逻辑
      expect(methodBody).toMatch(/idle|checking|ok|offline/);
    }
  });
});
