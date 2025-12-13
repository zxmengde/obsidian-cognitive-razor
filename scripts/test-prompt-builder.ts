/**
 * Prompt 构建测试工具
 * 
 * 用途：生成完整的 Prompt 用于 API 测试
 * 
 * 使用方法：
 * ```bash
 * npx tsx scripts/test-prompt-builder.ts
 * ```
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// 类型定义
// ============================================================================

type CRType = "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";
type OperationType = "create" | "merge" | "incremental";

interface PromptComposeOptions {
  conceptType: CRType;
  operation: OperationType;
  slots: Record<string, string>;
}

// ============================================================================
// 文件读取工具
// ============================================================================

function readFile(filePath: string): string {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`文件不存在: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

function replaceVariable(template: string, varName: string, value: string): string {
  const placeholder = "{{" + varName + "}}";
  return template.split(placeholder).join(value);
}

// ============================================================================
// Prompt 构建器
// ============================================================================

class PromptBuilder {
  private promptsDir: string;
  private baseComponentsCache: Map<string, string>;
  private typeCoreCache: Map<CRType, string>;
  private operationCache: Map<OperationType, string>;

  constructor(promptsDir: string = "prompts") {
    this.promptsDir = promptsDir;
    this.baseComponentsCache = new Map();
    this.typeCoreCache = new Map();
    this.operationCache = new Map();
  }

  /** 加载基础组件 */
  private loadBaseComponent(componentName: string): string {
    if (this.baseComponentsCache.has(componentName)) {
      return this.baseComponentsCache.get(componentName)!;
    }

    const componentPath = `${this.promptsDir}/_base/${componentName}.md`;
    const content = readFile(componentPath);
    this.baseComponentsCache.set(componentName, content);
    return content;
  }

  /** 注入基础组件 */
  private injectBaseComponents(content: string): string {
    let processedContent = content;
    const componentMapping: Record<string, string> = {
      "{{BASE_WRITING_STYLE}}": "writing-style",
      "{{BASE_ANTI_PATTERNS}}": "anti-patterns",
      "{{BASE_TERMINOLOGY}}": "terminology",
      "{{BASE_OUTPUT_FORMAT}}": "output-format"
    };

    for (const [placeholder, componentName] of Object.entries(componentMapping)) {
      if (processedContent.includes(placeholder)) {
        try {
          const component = this.loadBaseComponent(componentName);
          processedContent = processedContent.split(placeholder).join(component);
        } catch (error) {
          console.warn(`警告: 无法加载基础组件 ${componentName}`);
        }
      }
    }

    return processedContent;
  }

  /** 加载类型核心模块 */
  loadTypeCoreModule(conceptType: CRType): string {
    if (this.typeCoreCache.has(conceptType)) {
      return this.typeCoreCache.get(conceptType)!;
    }

    const typeMapping: Record<CRType, string> = {
      "Entity": "entity-core",
      "Mechanism": "mechanism-core",
      "Domain": "domain-core",
      "Issue": "issue-core",
      "Theory": "theory-core"
    };

    const fileName = typeMapping[conceptType];
    const filePath = `${this.promptsDir}/_type/${fileName}.md`;
    
    let content = readFile(filePath);
    content = this.injectBaseComponents(content);
    
    this.typeCoreCache.set(conceptType, content);
    return content;
  }

  /** 加载操作指令模块 */
  loadOperationModule(operation: OperationType): string {
    if (this.operationCache.has(operation)) {
      return this.operationCache.get(operation)!;
    }

    const filePath = `${this.promptsDir}/_base/operations/${operation}.md`;
    const content = readFile(filePath);
    
    this.operationCache.set(operation, content);
    return content;
  }

  /** 组合 Prompt */
  compose(options: PromptComposeOptions): string {
    const typeCore = this.loadTypeCoreModule(options.conceptType);
    const operationModule = this.loadOperationModule(options.operation);

    // 1. 替换 OPERATION_BLOCK
    let content = typeCore.replace("{{OPERATION_BLOCK}}", operationModule);

    // 2. 注入类型名称
    content = replaceVariable(content, "TYPE", options.conceptType);

    // 3. 替换所有槽位
    for (const [key, value] of Object.entries(options.slots)) {
      content = replaceVariable(content, key, value);
    }

    return content;
  }
}

// ============================================================================
// 测试场景
// ============================================================================

const testScenarios = {
  // 创建新实体
  "entity-create": {
    conceptType: "Entity" as CRType,
    operation: "create" as OperationType,
    slots: {
      CTX_META: "量子力学中的波函数（Wave Function）",
      CTX_LANGUAGE: "Chinese"
    }
  },

  // 合并两个实体
  "entity-merge": {
    conceptType: "Entity" as CRType,
    operation: "merge" as OperationType,
    slots: {
      SOURCE_A_NAME: "波函数 (Wave Function)",
      CTX_SOURCE_A: `# 波函数 (Wave Function)

## 定义
波函数是量子力学中描述粒子状态的数学函数，通常用希腊字母 ψ (psi) 表示。

## 属性
- 复数值函数
- 满足薛定谔方程
- 归一化条件

## 物理意义
波函数的模平方 |ψ|² 表示在某位置找到粒子的概率密度。`,
      SOURCE_B_NAME: "波动函数 (Wavefunction)",
      CTX_SOURCE_B: `# 波动函数 (Wavefunction)

## 概述
波动函数是量子系统状态的完整描述，包含了系统的所有可观测量信息。

## 数学形式
ψ(x,t) = A·exp(i(kx - ωt))

## 测量
测量会导致波函数坍缩到本征态。`,
      USER_INSTRUCTION: "保留更规范的数学表述，合并两个来源的互补信息",
      CTX_LANGUAGE: "Chinese"
    }
  },

  // 增量改进机制
  "mechanism-incremental": {
    conceptType: "Mechanism" as CRType,
    operation: "incremental" as OperationType,
    slots: {
      CTX_CURRENT: `# 光电效应 (Photoelectric Effect)

## 定义
光电效应是指光照射到金属表面时，电子从金属表面逸出的现象。

## 触发条件
- 光的频率必须大于金属的截止频率
- 光强影响电子数量，不影响电子能量

## 因果链
1. 光子撞击金属表面
2. 电子吸收光子能量
3. 电子克服逸出功
4. 电子从金属表面逸出`,
      USER_INSTRUCTION: "扩展 modulation 部分，添加温度、电场等调节因素的影响",
      CTX_LANGUAGE: "Chinese"
    }
  },

  // 创建新领域
  "domain-create": {
    conceptType: "Domain" as CRType,
    operation: "create" as OperationType,
    slots: {
      CTX_META: "量子计算 (Quantum Computing)",
      CTX_LANGUAGE: "Chinese"
    }
  },

  // 创建新议题
  "issue-create": {
    conceptType: "Issue" as CRType,
    operation: "create" as OperationType,
    slots: {
      CTX_META: "量子测量问题 (Quantum Measurement Problem)",
      CTX_LANGUAGE: "Chinese"
    }
  },

  // 创建新理论
  "theory-create": {
    conceptType: "Theory" as CRType,
    operation: "create" as OperationType,
    slots: {
      CTX_META: "量子纠缠理论 (Quantum Entanglement Theory)",
      CTX_LANGUAGE: "Chinese"
    }
  }
};

// ============================================================================
// 主程序
// ============================================================================

function main() {
  console.log("=".repeat(80));
  console.log("Prompt 构建测试工具");
  console.log("=".repeat(80));
  console.log();

  const builder = new PromptBuilder();

  // 获取命令行参数
  const args = process.argv.slice(2);
  const scenarioName = args[0] || "entity-create";
  const outputDir = args[1] || "scripts/output";

  // 检查场景是否存在
  if (!(scenarioName in testScenarios)) {
    console.error(`错误: 场景 "${scenarioName}" 不存在`);
    console.log("\n可用场景:");
    Object.keys(testScenarios).forEach(name => {
      console.log(`  - ${name}`);
    });
    process.exit(1);
  }

  const scenario = testScenarios[scenarioName as keyof typeof testScenarios];

  console.log(`场景: ${scenarioName}`);
  console.log(`类型: ${scenario.conceptType}`);
  console.log(`操作: ${scenario.operation}`);
  console.log();

  try {
    // 生成 Prompt
    console.log("正在生成 Prompt...");
    const prompt = builder.compose(scenario);

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 保存到文件
    const outputFile = path.join(outputDir, `${scenarioName}.txt`);
    fs.writeFileSync(outputFile, prompt, "utf-8");

    console.log(`✅ Prompt 已生成: ${outputFile}`);
    console.log(`✅ 字符数: ${prompt.length}`);
    console.log(`✅ 行数: ${prompt.split("\n").length}`);
    console.log();

    // 显示预览
    console.log("=".repeat(80));
    console.log("Prompt 预览（前 50 行）:");
    console.log("=".repeat(80));
    const lines = prompt.split("\n");
    console.log(lines.slice(0, 50).join("\n"));
    if (lines.length > 50) {
      console.log("\n... (省略 " + (lines.length - 50) + " 行) ...");
    }
    console.log();

    // 生成 API 测试脚本
    generateApiTestScript(scenarioName, outputFile);

  } catch (error) {
    console.error("❌ 错误:", error);
    process.exit(1);
  }
}

function generateApiTestScript(scenarioName: string, promptFile: string) {
  const scriptContent = `#!/bin/bash
# API 测试脚本 - ${scenarioName}
# 生成时间: ${new Date().toISOString()}

# 读取 Prompt
PROMPT=$(cat "${promptFile}")

# OpenAI API 配置
API_KEY="your-api-key-here"
API_URL="https://api.openai.com/v1/chat/completions"
MODEL="gpt-4o"

# 发送请求
curl -X POST "$API_URL" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d @- <<EOF
{
  "model": "$MODEL",
  "messages": [
    {
      "role": "user",
      "content": $(echo "$PROMPT" | jq -Rs .)
    }
  ],
  "temperature": 0.7,
  "max_tokens": 4000
}
EOF
`;

  const scriptFile = promptFile.replace(".txt", ".sh");
  fs.writeFileSync(scriptFile, scriptContent, "utf-8");
  fs.chmodSync(scriptFile, "755");

  console.log(`✅ API 测试脚本已生成: ${scriptFile}`);
  console.log();
  console.log("使用方法:");
  console.log(`  1. 编辑脚本，填入你的 API Key`);
  console.log(`  2. 运行: bash ${scriptFile}`);
  console.log();
}

// 运行主程序
main();

export { PromptBuilder, testScenarios };
