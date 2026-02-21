/**
 * test-prompts.mjs
 *
 * 独立于 Obsidian 的 Prompt 端到端测试脚本。
 * 完整复现 PromptManager + TaskRunner 的构建逻辑，
 * 通过 OpenAI 兼容 API 调用大模型，获取真实生成结果。
 *
 * 评估标准：仅校验结构完整性和插件可解析性，
 * 对齐 Validator + SchemaRegistry + mapStandardizeOutput 的解析链路。
 *
 * 用法：node scripts/test-prompts.mjs [--rounds N] [--cases case1,case2]
 *
 * 依赖：Node.js 18+（内置 fetch）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SCHEMAS, WRITE_PHASES, buildPhaseSchema } from "./schema-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROMPTS_DIR = join(ROOT, "prompts");
const RESULTS_DIR = join(__dirname, "test-results");

// ============================================================================
// 配置：从 data.json 读取 Provider 信息
// ============================================================================

const dataJson = JSON.parse(readFileSync(join(ROOT, "data.json"), "utf-8"));
const defaultProvider = dataJson.providers[dataJson.defaultProviderId];
const API_BASE_URL = defaultProvider.baseUrl;
const API_KEY = defaultProvider.apiKey;

// 各任务的模型配置（与 data.json taskModels 一致）
const TASK_MODELS = dataJson.taskModels;

// ============================================================================
// 基础组件加载
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
        cache[name] = existsSync(path) ? readFileSync(path, "utf-8") : "";
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
// 模板读取与渲染
// ============================================================================

function readPromptFile(relativePath) {
    const fullPath = join(PROMPTS_DIR, relativePath + ".md");
    if (!existsSync(fullPath)) throw new Error(`模板文件不存在: ${fullPath}`);
    return readFileSync(fullPath, "utf-8");
}

function loadPhaseTemplate(type, phaseId) {
    const fullPath = join(PROMPTS_DIR, "phases", type, `${phaseId}.md`);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
}

function renderTemplate(content, slots, optionalSlots = []) {
    let result = content;
    for (const [key, value] of Object.entries(slots)) {
        result = result.split(`{{${key}}}`).join(value);
    }
    for (const key of optionalSlots) {
        if (!(key in slots)) result = result.split(`{{${key}}}`).join("");
    }
    return result;
}

// ============================================================================
// system/user 分割（复现 task-runner.ts buildChatRequest）
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

// ============================================================================
// ============================================================================
// 工具函数
// ============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// API 调用（含重试与冷却机制）
// ============================================================================

const MAX_RETRIES = 5;
const RETRY_BASE_DELAY = 15000;
const INTER_CALL_DELAY = 3000;

async function callApi(messages, taskType = "write") {
    const config = TASK_MODELS[taskType] || TASK_MODELS.write;
    const body = {
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.7,
        top_p: config.topP ?? 1.0,
    };
    if (config.reasoning_effort) body.reasoning_effort = config.reasoning_effort;
    const url = `${API_BASE_URL}/chat/completions`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const startTime = Date.now();
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
            body: JSON.stringify(body),
        });
        const elapsed = Date.now() - startTime;

        if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || "";
            const tokens = data.usage?.total_tokens || 0;
            await sleep(INTER_CALL_DELAY);
            return { content, tokens, elapsed, model: config.model };
        }
        const text = await response.text();
        if (response.status === 429) {
            const delay = RETRY_BASE_DELAY * Math.pow(1.5, attempt - 1);
            console.log(`    ⏳ 限流 (429)，第 ${attempt}/${MAX_RETRIES} 次重试，等待 ${Math.round(delay / 1000)}s...`);
            await sleep(delay);
            continue;
        }
        throw new Error(`API 错误 ${response.status}: ${text}`);
    }
    throw new Error(`API 调用失败：${MAX_RETRIES} 次重试后仍被限流`);
}

// ============================================================================
// 测试用例：覆盖哲学、数学、计算机、材料 4 个领域
// ============================================================================

const TEST_CASES = {
    "philosophy": {
        input: "辩证唯物主义",
        expectedType: "Theory",
        domain: "哲学",
        meta: { Type: "Theory", standard_name_cn: "辩证唯物主义", standard_name_en: "Dialectical Materialism" },
    },
    "math": {
        input: "拓扑学",
        expectedType: "Domain",
        domain: "数学",
        meta: { Type: "Domain", standard_name_cn: "拓扑学", standard_name_en: "Topology" },
    },
    "cs": {
        input: "反向传播算法",
        expectedType: "Mechanism",
        domain: "计算机",
        meta: { Type: "Mechanism", standard_name_cn: "反向传播算法", standard_name_en: "Backpropagation" },
    },
    "material": {
        input: "石墨烯",
        expectedType: "Entity",
        domain: "材料",
        meta: { Type: "Entity", standard_name_cn: "石墨烯", standard_name_en: "Graphene" },
    },
};

// ============================================================================
// JSON 提取工具（对齐 validator.ts extractJsonFromResponse）
// ============================================================================

function extractJson(text) {
    const trimmed = text.trim();
    // 阶段 1：代码块提取
    const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/)
        || trimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]); } catch { }
    }
    // 阶段 2：直接解析
    try { return JSON.parse(trimmed); } catch { }
    // 阶段 3：提取第一个完整 JSON 对象
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
        try { return JSON.parse(trimmed.substring(first, last + 1)); } catch { }
    }
    return null;
}

// ============================================================================
// 结构评估函数（仅校验插件可解析性，对齐 Validator + Schema 逻辑）
// ============================================================================

/**
 * 评估 Define 结果的结构完整性
 * 对齐：DEFINE_TASK_SCHEMA + Validator.validateSchema + mapStandardizeOutput
 */
function evaluateDefineResult(parsed, testCase) {
    const issues = [];
    if (!parsed) {
        return { score: 0, issues: ["JSON 解析失败"] };
    }

    // 1. 顶层 classification_result（DEFINE_TASK_SCHEMA.required）
    const cr = parsed.classification_result || parsed;
    if (!parsed.classification_result) {
        issues.push("缺少 classification_result 包装（Validator 会拒绝）");
    }

    // 2. 五维度必填检查
    const TYPES = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
    for (const t of TYPES) {
        if (!cr[t]) { issues.push(`缺少 ${t} 维度`); continue; }
        if (typeof cr[t] !== "object" || Array.isArray(cr[t])) {
            issues.push(`${t} 应为对象，实际为 ${Array.isArray(cr[t]) ? "array" : typeof cr[t]}`);
            continue;
        }
        const cn = cr[t].standard_name_cn ?? cr[t].chinese;
        const en = cr[t].standard_name_en ?? cr[t].english;
        if (cn == null) issues.push(`${t}.standard_name_cn 缺失`);
        else if (typeof cn !== "string") issues.push(`${t}.standard_name_cn 应为 string`);
        else if (!cn.trim()) issues.push(`${t}.standard_name_cn 为空字符串`);
        if (en == null) issues.push(`${t}.standard_name_en 缺失`);
        else if (typeof en !== "string") issues.push(`${t}.standard_name_en 应为 string`);
        else if (!en.trim()) issues.push(`${t}.standard_name_en 为空字符串`);
        const conf = cr[t].confidence_score ?? cr[t].confidences;
        if (conf == null) issues.push(`${t}.confidence_score 缺失`);
        else if (typeof conf !== "number") issues.push(`${t}.confidence_score 应为 number`);
    }

    // 3. primaryType 可提取性
    const typeConf = {};
    for (const t of TYPES) {
        const e = cr[t] || {};
        const c = e.confidence_score ?? e.confidences;
        typeConf[t] = typeof c === "number" ? c : 0;
    }
    const predicted = TYPES.reduce((b, c) => typeConf[c] > typeConf[b] ? c : b, "Domain");
    const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 10);
    return { score, issues, predicted, primaryScore: typeConf[testCase.expectedType] ?? 0 };
}

/**
 * 评估 Tag 结果的结构完整性
 * 对齐：TaskRunner.executeTag 的 schema {required: ["aliases", "tags"]} + 数组提取
 */
function evaluateTagResult(parsed) {
    const issues = [];
    if (!parsed) { return { score: 0, issues: ["JSON 解析失败"] }; }
    // required 字段存在性
    if (parsed.aliases == null) issues.push('缺少必填字段 "aliases"');
    if (parsed.tags == null) issues.push('缺少必填字段 "tags"');
    // 类型校验
    if (parsed.aliases != null && !Array.isArray(parsed.aliases))
        issues.push(`aliases 应为 array，实际为 ${typeof parsed.aliases}`);
    if (parsed.tags != null && !Array.isArray(parsed.tags))
        issues.push(`tags 应为 array，实际为 ${typeof parsed.tags}`);
    // 数组元素类型
    if (Array.isArray(parsed.aliases)) {
        const bad = parsed.aliases.filter(a => typeof a !== "string");
        if (bad.length) issues.push(`aliases 含 ${bad.length} 个非 string 元素`);
    }
    if (Array.isArray(parsed.tags)) {
        const bad = parsed.tags.filter(t => typeof t !== "string");
        if (bad.length) issues.push(`tags 含 ${bad.length} 个非 string 元素`);
    }
    const aliasCount = Array.isArray(parsed.aliases) ? parsed.aliases.length : 0;
    const tagCount = Array.isArray(parsed.tags) ? parsed.tags.length : 0;
    const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20);
    return { score, issues, aliasCount, tagCount };
}

/**
 * 评估 Write 结果的结构完整性
 * 对齐：TaskRunner.executeWrite 的 buildPhaseValidationSchema + Validator 逻辑
 */
function evaluateWriteResult(accumulated, conceptType) {
    const issues = [];
    const phases = WRITE_PHASES[conceptType];
    const allFields = phases.flatMap(p => p.fields);
    const properties = SCHEMAS[conceptType]?.properties || {};

    // 1. 字段存在性（required 检查）
    const missing = allFields.filter(f => accumulated[f] == null);
    for (const f of missing) issues.push(`缺少必填字段 "${f}"`);

    // 2. 字段类型 + 子结构校验
    for (const field of allFields) {
        const val = accumulated[field];
        if (val == null) continue;
        const prop = properties[field];
        if (!prop) continue;
        const expected = prop.type;

        if (expected === "array") {
            if (!Array.isArray(val)) {
                issues.push(`"${field}" 应为 array，实际为 ${typeof val}`);
                continue;
            }
            // 数组元素子字段校验（items.properties 的 keys 即为必填子字段）
            if (prop.items?.type === "object" && prop.items?.properties && val.length > 0) {
                const requiredKeys = Object.keys(prop.items.properties);
                for (let i = 0; i < val.length; i++) {
                    if (typeof val[i] !== "object" || Array.isArray(val[i])) {
                        issues.push(`"${field}[${i}]" 应为 object`);
                    } else {
                        for (const rk of requiredKeys) {
                            if (val[i][rk] == null) issues.push(`"${field}[${i}]" 缺少 "${rk}"`);
                        }
                    }
                }
            }
        } else if (expected === "object") {
            if (typeof val !== "object" || Array.isArray(val)) {
                issues.push(`"${field}" 应为 object，实际为 ${Array.isArray(val) ? "array" : typeof val}`);
            } else if (prop.properties) {
                // properties 的 keys 即为必填子字段
                for (const rk of Object.keys(prop.properties)) {
                    if (val[rk] == null) issues.push(`"${field}" 缺少子字段 "${rk}"`);
                }
            }
        } else if (expected === "string") {
            if (typeof val !== "string") issues.push(`"${field}" 应为 string，实际为 ${typeof val}`);
            else if (!val.trim()) issues.push(`"${field}" 为空字符串`);
        }
    }

    const fieldCount = allFields.length - missing.length;
    const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 5);
    return { score, issues, fieldCount, totalFields: allFields.length };
}

// ============================================================================
// 核心管线执行
// ============================================================================

async function runDefine(input, baseComponents) {
    console.log(`  [Define] 输入: "${input}"`);
    let content = readPromptFile("base/operations/define");
    content = injectBaseComponents(content, baseComponents);
    const prompt = renderTemplate(content, { CTX_INPUT: input }, ["CTX_LANGUAGE"]);
    const { system, user } = splitSystemUser(prompt);
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
    const result = await callApi(messages, "define");
    console.log(`  [Define] ${result.model} | ${result.tokens} tokens | ${result.elapsed}ms`);
    return { raw: result.content, parsed: extractJson(result.content), ...result };
}

async function runTag(meta, baseComponents) {
    console.log(`  [Tag] 概念: ${meta.standard_name_cn}`);
    let content = readPromptFile("base/operations/tag");
    content = injectBaseComponents(content, baseComponents);
    const prompt = renderTemplate(content, { CTX_META: JSON.stringify(meta, null, 2) }, ["CTX_LANGUAGE"]);
    const { system, user } = splitSystemUser(prompt);
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
    const result = await callApi(messages, "tag");
    console.log(`  [Tag] ${result.model} | ${result.tokens} tokens | ${result.elapsed}ms`);
    return { raw: result.content, parsed: extractJson(result.content), ...result };
}

async function runWritePhased(meta, conceptType, baseComponents) {
    console.log(`  [Write] 类型: ${conceptType} | 概念: ${meta.standard_name_cn}`);
    const phases = WRITE_PHASES[conceptType];
    const accumulated = {};

    for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        console.log(`    阶段 ${i + 1}/${phases.length}: ${phase.id} (${phase.fields.join(", ")})`);

        let templateContent = loadPhaseTemplate(conceptType, phase.id);
        if (!templateContent) {
            throw new Error(`阶段 prompt 文件不存在: phases/${conceptType}/${phase.id}.md`);
        }
        templateContent = injectBaseComponents(templateContent, baseComponents);

        const previousContext = Object.keys(accumulated).length > 0
            ? JSON.stringify(accumulated, null, 2) : "";
        const phaseSchema = buildPhaseSchema(conceptType, phase.fields);

        const prompt = renderTemplate(templateContent, {
            CTX_META: JSON.stringify(meta, null, 2),
            CTX_LANGUAGE: "Chinese",
            CONCEPT_TYPE: conceptType,
            PHASE_SCHEMA: phaseSchema,
            CTX_PREVIOUS: previousContext,
        }, ["CTX_SOURCES"]);

        const { system, user } = splitSystemUser(prompt);
        const messages = [];
        if (system) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: user });

        const result = await callApi(messages, "write");
        console.log(`    → ${result.model} | ${result.tokens} tokens | ${result.elapsed}ms`);

        const parsed = extractJson(result.content);
        if (parsed) {
            for (const field of phase.fields) {
                if (parsed[field] !== undefined) accumulated[field] = parsed[field];
            }
        } else {
            console.log(`    ⚠ 阶段 ${phase.id} JSON 解析失败`);
        }
    }
    return accumulated;
}

// ============================================================================
// 完整管线：Define → Tag → Write（分阶段）
// ============================================================================

async function runFullPipeline(caseId, testCase, baseComponents, roundId) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`测试用例: ${caseId} (${testCase.domain}) — 第 ${roundId} 轮`);
    console.log(`${"=".repeat(60)}`);

    const result = {
        caseId, domain: testCase.domain, round: roundId,
        define: null, tag: null, write: null,
        scores: {}, totalScore: 0, timestamp: new Date().toISOString(),
    };

    try {
        // 1. Define
        const defineResult = await runDefine(testCase.input, baseComponents);
        const defineEval = evaluateDefineResult(defineResult.parsed, testCase);
        result.define = {
            raw: defineResult.raw, parsed: defineResult.parsed,
            evaluation: defineEval, tokens: defineResult.tokens, elapsed: defineResult.elapsed,
        };
        result.scores.define = defineEval.score;
        console.log(`  [Define 评分] ${defineEval.score}/100 ${defineEval.issues.length > 0 ? "| 问题: " + defineEval.issues.join("; ") : "✓"}`);

        // 2. Tag
        const tagResult = await runTag(testCase.meta, baseComponents);
        const tagEval = evaluateTagResult(tagResult.parsed);
        result.tag = {
            raw: tagResult.raw, parsed: tagResult.parsed,
            evaluation: tagEval, tokens: tagResult.tokens, elapsed: tagResult.elapsed,
        };
        result.scores.tag = tagEval.score;
        console.log(`  [Tag 评分] ${tagEval.score}/100 ${tagEval.issues.length > 0 ? "| 问题: " + tagEval.issues.join("; ") : "✓"}`);

        // 3. Write（分阶段）
        const conceptType = testCase.expectedType;
        const writeAccumulated = await runWritePhased(testCase.meta, conceptType, baseComponents);
        const writeEval = evaluateWriteResult(writeAccumulated, conceptType);
        result.write = { accumulated: writeAccumulated, evaluation: writeEval };
        result.scores.write = writeEval.score;
        console.log(`  [Write 评分] ${writeEval.score}/100 (${writeEval.fieldCount}/${writeEval.totalFields} 字段) ${writeEval.issues.length > 0 ? "| 问题: " + writeEval.issues.join("; ") : "✓"}`);

        result.totalScore = Math.round(
            (result.scores.define + result.scores.tag + result.scores.write) / 3
        );
        console.log(`  [总分] ${result.totalScore}/100`);

    } catch (error) {
        console.error(`  ✗ 管线执行失败: ${error.message}`);
        result.error = error.message;
    }

    return result;
}

// ============================================================================
// 主入口
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    let rounds = 1;
    let selectedCases = Object.keys(TEST_CASES);

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--rounds" && args[i + 1]) {
            rounds = parseInt(args[i + 1], 10);
            i++;
        }
        if (args[i] === "--cases" && args[i + 1]) {
            selectedCases = args[i + 1].split(",").map(s => s.trim());
            i++;
        }
    }

    console.log(`\n🧪 Cognitive Razor Prompt 结构测试`);
    console.log(`   轮次: ${rounds} | 用例: ${selectedCases.join(", ")}`);
    console.log(`   评估标准: 结构完整性 + 插件可解析性\n`);

    const baseComponents = loadBaseComponents();
    const allResults = [];

    for (let round = 1; round <= rounds; round++) {
        console.log(`\n${"#".repeat(60)}`);
        console.log(`# 第 ${round}/${rounds} 轮`);
        console.log(`${"#".repeat(60)}`);

        for (const caseId of selectedCases) {
            const testCase = TEST_CASES[caseId];
            if (!testCase) {
                console.log(`⚠ 未知用例: ${caseId}，跳过`);
                continue;
            }
            const result = await runFullPipeline(caseId, testCase, baseComponents, round);
            allResults.push(result);
        }
    }

    // 汇总报告
    console.log(`\n${"=".repeat(60)}`);
    console.log(`汇总报告`);
    console.log(`${"=".repeat(60)}`);

    const validResults = allResults.filter(r => !r.error);
    if (validResults.length === 0) {
        console.log("所有用例均执行失败，无有效结果。");
    } else {
        const avgTotal = Math.round(validResults.reduce((s, r) => s + r.totalScore, 0) / validResults.length);
        const avgDefine = Math.round(validResults.reduce((s, r) => s + (r.scores.define || 0), 0) / validResults.length);
        const avgTag = Math.round(validResults.reduce((s, r) => s + (r.scores.tag || 0), 0) / validResults.length);
        const avgWrite = Math.round(validResults.reduce((s, r) => s + (r.scores.write || 0), 0) / validResults.length);

        console.log(`  有效结果: ${validResults.length}/${allResults.length}`);
        console.log(`  平均总分: ${avgTotal}/100`);
        console.log(`  Define 均分: ${avgDefine}/100`);
        console.log(`  Tag 均分: ${avgTag}/100`);
        console.log(`  Write 均分: ${avgWrite}/100`);

        // 按用例分组
        const byCaseId = {};
        for (const r of validResults) {
            if (!byCaseId[r.caseId]) byCaseId[r.caseId] = [];
            byCaseId[r.caseId].push(r);
        }
        console.log(`\n  按用例明细:`);
        for (const [caseId, results] of Object.entries(byCaseId)) {
            const avg = Math.round(results.reduce((s, r) => s + r.totalScore, 0) / results.length);
            console.log(`    ${caseId}: 均分 ${avg}/100 (${results.length} 轮)`);
        }
    }

    // 写入结果文件
    mkdirSync(RESULTS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = join(RESULTS_DIR, `results-${timestamp}.json`);
    writeFileSync(outputPath, JSON.stringify(allResults, null, 2), "utf-8");
    console.log(`\n📄 详细结果已保存: ${outputPath}`);
}

main().catch(err => {
    console.error("致命错误:", err);
    process.exit(1);
});
