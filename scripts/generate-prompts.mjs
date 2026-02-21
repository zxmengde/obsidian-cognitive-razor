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
import { buildPhaseSchema, WRITE_PHASES } from "./schema-data.mjs";

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
 * 优先从 phases/{Type}/{phaseId}.md 读取，不存在时返回 null
 */
function loadPhaseTemplate(type, phaseId) {
    const fullPath = join(PROMPTS_DIR, "phases", type, `${phaseId}.md`);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
}

// ============================================================================
// 基础组件注入
// ============================================================================

const BASE_COMPONENT_MAP = {
    "{{BASE_WRITING_STYLE}}": "writing-style",
    "{{BASE_ANTI_PATTERNS}}": "anti-patterns",
    "{{BASE_OUTPUT_FORMAT}}": "output-format",
};

function loadBaseComponents() {
    const cache = {};
    for (const [, name] of Object.entries(BASE_COMPONENT_MAP)) {
        const path = join(PROMPTS_DIR, "base", name + ".md");
        cache[name] = existsSync(path) ? readFileSync(path, "utf-8") : `<!-- ${name} not found -->`;
    }
    return cache;
}

function injectBaseComponents(content, baseComponents) {
    let result = content;
    for (const [placeholder, name] of Object.entries(BASE_COMPONENT_MAP)) {
        result = result.split(placeholder).join(baseComponents[name] ?? "");
    }
    return result;
}

// ============================================================================
// 变量替换
// ============================================================================

function renderTemplate(content, slots, optionalSlots = []) {
    let result = content;
    for (const [key, value] of Object.entries(slots)) {
        result = result.split(`{{${key}}}`).join(value);
    }
    for (const key of optionalSlots) {
        if (!(key in slots)) result = result.split(`{{${key}}}`).join("");
    }
    const unreplaced = [...result.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[0]);
    if (unreplaced.length > 0) console.warn(`  ⚠ 未替换变量: ${unreplaced.join(", ")}`);
    return result;
}

// ============================================================================
// system/user 分割（复现 task-runner.ts buildChatRequest 逻辑）
// ============================================================================

function splitSystemUser(prompt) {
    const sysMatch = prompt.match(/<system_instructions>([\s\S]*?)<\/system_instructions>/);
    if (sysMatch) {
        const systemContent = sysMatch[1].trim();
        const userContent = prompt.replace(/<system_instructions>[\s\S]*?<\/system_instructions>/, "").trim();
        return { system: systemContent, user: userContent };
    }
    return { system: null, user: prompt };
}

function buildApiPayload(prompt, model = "gemini-2.5-flash-preview") {
    const { system, user } = splitSystemUser(prompt);
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
    return { model, messages, temperature: 0.5 };
}

// ============================================================================
// 示例数据
// ============================================================================

const EXAMPLES = {
    Domain: {
        meta: { cruid: "1640bddd", type: "Domain", standard_name_cn: "量子信息科学", standard_name_en: "Quantum Information Science", noteState: "Stub" },
        label: "量子信息科学",
    },
    Issue: {
        meta: { cruid: "91b5c16a", type: "Issue", standard_name_cn: "测量问题", standard_name_en: "The Measurement Problem", noteState: "Stub" },
        label: "测量问题",
    },
    Theory: {
        meta: { cruid: "944d43db", type: "Theory", standard_name_cn: "哥本哈根诠释", standard_name_en: "Copenhagen Interpretation", noteState: "Stub" },
        label: "哥本哈根诠释",
    },
    Entity: {
        meta: { cruid: "03d10972", type: "Entity", standard_name_cn: "量子纠缠", standard_name_en: "Quantum Entanglement", noteState: "Stub" },
        label: "量子纠缠",
    },
    Mechanism: {
        meta: { cruid: "bbc4affe", type: "Mechanism", standard_name_cn: "波函数坍缩", standard_name_en: "Wave Function Collapse", noteState: "Stub" },
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
            templateId: "base/operations/define",
            slots: { CTX_INPUT: "量子纠缠" },
            optionalSlots: ["CTX_LANGUAGE"],
            userMessage: "量子纠缠",
        },
        {
            id: "tag",
            label: "Tag",
            templateId: "base/operations/tag",
            slots: { CTX_META: JSON.stringify(EXAMPLES.Entity.meta, null, 2) },
            optionalSlots: ["CTX_LANGUAGE"],
            userMessage: "请为以上概念生成别名和标签。",
        },
        {
            id: "verify",
            label: "Verify",
            templateId: "base/operations/verify",
            slots: {
                CTX_META: JSON.stringify(EXAMPLES.Entity.meta, null, 2),
                CTX_CURRENT: "## 定义\n量子纠缠是量子力学中两个或多个粒子之间的特殊关联状态。",
                CTX_LANGUAGE: "中文",
            },
            optionalSlots: ["CTX_SOURCES"],
            userMessage: "请对以上内容进行事实核查。",
        },
    ];

    for (const task of simpleTasks) {
        console.log(`处理: ${task.label}`);
        try {
            let content = readPromptFile(task.templateId);
            content = injectBaseComponents(content, baseComponents);
            const prompt = renderTemplate(content, task.slots, task.optionalSlots);
            const payload = buildApiPayload(prompt);

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
        const phases = WRITE_PHASES[type];
        if (!phases) {
            console.error(`  ✗ 未找到 ${type} 的分阶段配置`);
            results.push({ id: `write-${type.toLowerCase()}`, label: `Write/${type}`, ok: false, error: "无分阶段配置" });
            console.log();
            continue;
        }

        const accumulated = {};  // 模拟累积的已生成内容

        for (let i = 0; i < phases.length; i++) {
            const phase = phases[i];
            const phaseId = `write-${type.toLowerCase()}-${phase.id}`;
            const label = `Write/${type} — ${phase.id}（${i + 1}/${phases.length}）`;

            try {
                const previousContext = Object.keys(accumulated).length > 0
                    ? JSON.stringify(accumulated, null, 2)
                    : "";

                let phaseTemplateContent = loadPhaseTemplate(type, phase.id);
                if (!phaseTemplateContent) {
                    throw new Error(`阶段 prompt 文件不存在: phases/${type}/${phase.id}.md`);
                }
                phaseTemplateContent = injectBaseComponents(phaseTemplateContent, baseComponents);

                const slots = {
                    CTX_META: JSON.stringify(example.meta, null, 2),
                    CTX_LANGUAGE: "中文",
                    CONCEPT_TYPE: type,
                    PHASE_SCHEMA: buildPhaseSchema(type, phase.fields),
                    CTX_PREVIOUS: previousContext,
                };

                const prompt = renderTemplate(phaseTemplateContent, slots, ["CTX_SOURCES"]);
                const payload = buildApiPayload(prompt, null);

                writeFileSync(join(OUTPUT_DIR, `prompt-${phaseId}.md`), prompt, "utf-8");
                writeFileSync(join(OUTPUT_DIR, `api-payload-${phaseId}.json`), JSON.stringify(payload, null, 2), "utf-8");
                console.log(`  ✓ 阶段 ${phase.id} (${phase.fields.join(", ")})`);
                results.push({ id: phaseId, label, ok: true });

                // 模拟本阶段生成了内容，供下一阶段的 CTX_PREVIOUS 使用
                for (const f of phase.fields) {
                    accumulated[f] = `[${f} 的示例内容]`;
                }
            } catch (err) {
                console.error(`  ✗ 阶段 ${phase.id} 失败: ${err.message}`);
                results.push({ id: phaseId, label, ok: false, error: err.message });
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
            json: "api-payload-{id}.json 可直接作为 OpenAI 兼容 API 请求体",
            note: "system 消息来自 <system_instructions> 标签内容，user 消息为其余部分",
        },
    }, null, 2), "utf-8");

    const ok = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    console.log(`=== 完成：${ok} 成功，${fail} 失败 ===`);
    console.log(`输出目录: ${OUTPUT_DIR}`);
}

main();
