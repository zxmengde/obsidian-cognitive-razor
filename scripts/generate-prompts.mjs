/**
 * generate-prompts.mjs
 *
 * Prompt 构建测试脚本：复现 PromptManager 的完整构建逻辑。
 * - 为每种任务类型生成填充了示例槽位的完整 Prompt
 * - Write 任务为每个类型的每个阶段生成独立 payload（含 CTX_PREVIOUS 模拟上下文）
 * - 按 <system_instructions> 标签正确分割 system/user 消息
 *
 * 用法：node scripts/generate-prompts.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
    DEFINE_SCHEMA,
    TAG_SCHEMA,
    getWriteStages,
    getWriteStage,
    getOperationPromptTemplateKey,
    buildPhaseJsonSchema,
    buildPromptMetaContext,
    BASE_COMPONENT_MAP,
    injectPromptBaseComponents,
    renderPromptTemplate,
    splitPromptIntoMessages,
    buildJsonSchemaResponseFormat,
    OPENAI_CHAT_COMPLETIONS_ADAPTER,
    OPENAI_RESPONSES_ADAPTER,
    GEMINI_GENERATIVE_LANGUAGE_ADAPTER,
} from "./schema-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROMPTS_DIR = join(ROOT, "prompts");
const OUTPUT_DIR = join(__dirname, "output");

// ============================================================================
// 文件读取工具
// ============================================================================

function readPromptFile(relativePath) {
    const fullPath = join(PROMPTS_DIR, relativePath + ".md");
    if (!existsSync(fullPath)) throw new Error(`模板文件不存在: ${fullPath}`);
    return readFileSync(fullPath, "utf-8");
}

/**
 * 加载阶段专属 prompt 模板
 * 只从 StageCatalog 声明的模板路径读取。
 */
function loadStageTemplate(type, stageId) {
    const stage = getWriteStage(type, stageId);
    if (!stage) return null;
    const fullPath = join(PROMPTS_DIR, `${stage.promptTemplateKey}.md`);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
}

// ============================================================================
// 基础组件注入
// ============================================================================

function loadBaseComponents() {
    const cache = {};
    for (const [, name] of Object.entries(BASE_COMPONENT_MAP)) {
        const path = join(PROMPTS_DIR, "base", name + ".md");
        if (!existsSync(path)) throw new Error(`基础组件文件不存在: ${path}`);
        cache[name] = readFileSync(path, "utf-8");
    }
    return cache;
}

function injectBaseComponents(content, baseComponents) {
    const injected = injectPromptBaseComponents(content, baseComponents);
    if (injected.missingComponents.length > 0) throw new Error(`基础组件缺失: ${injected.missingComponents.join(", ")}`);
    return injected.content;
}

function renderTemplate(content, slots, optionalSlots = []) {
    const rendered = renderPromptTemplate(content, slots, optionalSlots);
    if (rendered.unreplacedVariables.length > 0) throw new Error(`存在未替换变量: ${rendered.unreplacedVariables.join(", ")}`);
    return rendered.prompt;
}

// ============================================================================
// 请求构建使用运行时共享的消息拆分和协议适配器。
// ============================================================================
function buildApiPayloads(prompt, model = "configured-model", schema, schemaName) {
    const baseMessages = splitPromptIntoMessages(prompt);
    const request = {
        providerId: "prompt-export",
        model,
        messages: baseMessages,
        response_format: schema ? buildJsonSchemaResponseFormat(schemaName, schema) : undefined,
        capabilities: { temperature: false, topP: false, reasoning: false,
            nativeWebSearch: false,
            promptCaching: false, responseContinuation: false },
    };
    return {
        "openai-chat-completions": OPENAI_CHAT_COMPLETIONS_ADAPTER.buildRequestBody(request),
        "openai-responses": OPENAI_RESPONSES_ADAPTER.buildRequestBody(request),
        "gemini-generative-language": GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(request).body,
    };
}

// ============================================================================
// 示例数据
// ============================================================================

const EXAMPLES = {
    domain: {
        meta: { standard_name_cn: "量子信息科学", type: "domain", standard_name_en: "Quantum Information Science" },
        label: "量子信息科学",
    },
    issue: {
        meta: { standard_name_cn: "测量问题", type: "issue", standard_name_en: "The Measurement Problem" },
        label: "测量问题",
    },
    theory: {
        meta: { standard_name_cn: "哥本哈根诠释", type: "theory", standard_name_en: "Copenhagen Interpretation" },
        label: "哥本哈根诠释",
    },
    entity: {
        meta: { standard_name_cn: "量子纠缠", type: "entity", standard_name_en: "Quantum Entanglement" },
        label: "量子纠缠",
    },
    mechanism: {
        meta: { standard_name_cn: "波函数坍缩", type: "mechanism", standard_name_en: "Wave Function Collapse" },
        label: "波函数坍缩",
    },
};

// ============================================================================
// 主流程
// ============================================================================

function main() {
    console.log("=== Cognitive Razor Prompt 构建测试脚本 ===\n");
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const baseComponents = loadBaseComponents();
    console.log(`加载基础组件: ${Object.keys(baseComponents).length} 个\n`);

    const results = [];

    // --- 非 Write 任务 ---
    const simpleTasks = [
        {
            id: "define",
            label: "Define",
            templateId: getOperationPromptTemplateKey("define"),
            slots: { CTX_INPUT: "量子纠缠" },
            optionalSlots: [],
            userMessage: "量子纠缠",
            schema: DEFINE_SCHEMA,
            schemaName: "define_output",
        },
        {
            id: "tag",
            label: "Tag",
            templateId: getOperationPromptTemplateKey("tag"),
            slots: { CTX_META: buildPromptMetaContext(EXAMPLES.entity.meta) },
            optionalSlots: [],
            userMessage: "请为以上概念生成别名和标签。",
            schema: TAG_SCHEMA,
            schemaName: "tag_output",
        },
        {
            id: "verify",
            label: "Verify",
            templateId: getOperationPromptTemplateKey("verify"),
            slots: {
                CTX_META: buildPromptMetaContext(EXAMPLES.entity.meta),
                CTX_CURRENT: "## 定义\n量子纠缠是量子力学中两个或多个粒子之间的特殊关联状态。",
            },
            optionalSlots: [],
            userMessage: "请对以上内容进行事实核查。",
        },
        {
            id: "merge",
            label: "Merge",
            templateId: getOperationPromptTemplateKey("merge"),
            slots: { CTX_CURRENT: JSON.stringify({ canonical: EXAMPLES.entity, redundant: EXAMPLES.entity }) },
            optionalSlots: [],
            userMessage: "请生成合并草稿。",
        },
    ];

    for (const task of simpleTasks) {
        console.log(`处理: ${task.label}`);
        try {
            let content = readPromptFile(task.templateId);
            content = injectBaseComponents(content, baseComponents);
            const prompt = renderTemplate(content, task.slots, task.optionalSlots);
            const payload = buildApiPayloads(prompt, undefined, task.schema, task.schemaName);

            writeFileSync(join(OUTPUT_DIR, `prompt-${task.id}.md`), prompt, "utf-8");
            writeFileSync(join(OUTPUT_DIR, `api-payload-${task.id}.json`), JSON.stringify(payload, null, 2), "utf-8");
            console.log(`  ✓ ${prompt.split("\n").length} 行`);
            results.push({ id: task.id, label: task.label, ok: true });
        } catch (err) {
            console.error(`  ✗ ${err.message}`);
            results.push({ id: task.id, label: task.label, ok: false, error: err.message });
        }
        console.log();
    }

    // --- Write 任务：每个类型的每个阶段 ---
    for (const [type, example] of Object.entries(EXAMPLES)) {
        console.log(`处理: Write / ${type}`);
        const stages = getWriteStages(type);
        if (!stages) {
            console.error(`  ✗ 未找到 ${type} 的分阶段配置`);
            results.push({ id: `write-${type.toLowerCase()}`, label: `Write/${type}`, ok: false, error: "无分阶段配置" });
            console.log();
            continue;
        }

        const accumulated = {};  // 模拟累积的已生成内容

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            const outputId = `write-${type}-${stage.id}`;
            const label = `Write/${type} — ${stage.id}（${i + 1}/${stages.length}）`;

            try {
                const previousContext = Object.keys(accumulated).length > 0
                    ? JSON.stringify(accumulated, null, 2)
                    : "";

                let stageTemplateContent = loadStageTemplate(type, stage.id);
                if (!stageTemplateContent) {
                    throw new Error(`阶段 prompt 文件不存在: ${stage.promptTemplateKey}.md`);
                }
                stageTemplateContent = injectBaseComponents(stageTemplateContent, baseComponents);

                const slots = {
                    CTX_META: buildPromptMetaContext(example.meta),
                    CONCEPT_TYPE: type,
                    CTX_PREVIOUS: previousContext,
                };

                const prompt = renderTemplate(stageTemplateContent, slots, []);
                const payload = buildApiPayloads(
                    prompt,
                    undefined,
                    buildPhaseJsonSchema(type, stage.fields),
                    `write_${type}_${stage.id}`,
                );

                writeFileSync(join(OUTPUT_DIR, `prompt-${outputId}.md`), prompt, "utf-8");
                writeFileSync(join(OUTPUT_DIR, `api-payload-${outputId}.json`), JSON.stringify(payload, null, 2), "utf-8");
                console.log(`  ✓ 阶段 ${stage.id} (${stage.fields.join(", ")})`);
                results.push({ id: outputId, label, ok: true });

                // 模拟本阶段生成了内容，供下一阶段的 CTX_PREVIOUS 使用
                for (const f of stage.fields) {
                    accumulated[f] = `[${f} 的示例内容]`;
                }
            } catch (err) {
                console.error(`  ✗ 阶段 ${stage.id} 失败: ${err.message}`);
                results.push({ id: outputId, label, ok: false, error: err.message });
            }
        }
        console.log();
    }

    // 写入索引
    writeFileSync(join(OUTPUT_DIR, "index.json"), JSON.stringify({
        generatedAt: new Date().toISOString(),
        tasks: results,
        usage: {
            md: "prompt-{id}.md 包含完整 prompt（含 system/user 分割标记），可直接在编辑器中查看和修改",
            json: "api-payload-{id}.json 同时包含三种协议适配器生成的请求体",
            note: "消息拆分和协议字段来自运行时共享实现；默认使用提示词 Schema 约束",
        },
    }, null, 2), "utf-8");

    const ok = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    console.log(`=== 完成：${ok} 成功，${fail} 失败 ===`);
    console.log(`输出目录: ${OUTPUT_DIR}`);
}

main();
