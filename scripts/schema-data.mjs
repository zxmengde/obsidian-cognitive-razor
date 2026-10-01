/**
 * schema-data.mjs
 *
 * 运行时自动从 SchemaRegistry 和 StageCatalog 提取 Schema/阶段定义。
 * 通过 esbuild 转译 TypeScript → 临时 ESM 模块 → 动态 import，
 * 确保脚本与插件代码始终保持同步（SSOT）。
 *
 * 导出：
 *   STAGE_CATALOG — 阶段、字段、Prompt 和提交策略的唯一目录
 *   DEFINE_SCHEMA — Define 任务的严格 JSON Schema
 *   TAG_SCHEMA    — Tag 任务的严格 JSON Schema
 *   buildPhaseJsonSchema(conceptType, fields) — 生成 Write 阶段的严格 JSON Schema
 *   buildPromptMetaContext(meta) — 将 CTX_META 收窄为标准名称与概念类型
 */

import { build } from "esbuild";
import { unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGISTRY_SRC = join(ROOT, "src/core/schema-registry.ts");
const STAGE_CATALOG_SRC = join(ROOT, "src/core/stage-catalog.ts");
const PROMPT_CATALOG_SRC = join(ROOT, "src/core/prompt-catalog.ts");
const PROMPT_TEMPLATE_SRC = join(ROOT, "src/core/prompt-template.ts");
const PROMPT_MESSAGE_SRC = join(ROOT, "src/core/prompt-message-builder.ts");
const CHAT_ADAPTER_SRC = join(ROOT, "src/core/openai-chat-adapter.ts");
const RESPONSES_ADAPTER_SRC = join(ROOT, "src/core/openai-responses-adapter.ts");
const GEMINI_ADAPTER_SRC = join(ROOT, "src/core/gemini-generative-language-adapter.ts");
const TEMP_OUTPUT = join(__dirname, ".schema-registry-compiled.mjs");
const STAGE_TEMP_OUTPUT = join(__dirname, ".stage-catalog-compiled.mjs");
const PROMPT_TEMP_OUTPUT = join(__dirname, ".prompt-catalog-compiled.mjs");
const PROMPT_TEMPLATE_TEMP_OUTPUT = join(__dirname, ".prompt-template-compiled.mjs");
const PROMPT_MESSAGE_TEMP_OUTPUT = join(__dirname, ".prompt-message-compiled.mjs");
const CHAT_ADAPTER_TEMP_OUTPUT = join(__dirname, ".chat-adapter-compiled.mjs");
const RESPONSES_ADAPTER_TEMP_OUTPUT = join(__dirname, ".responses-adapter-compiled.mjs");
const GEMINI_ADAPTER_TEMP_OUTPUT = join(__dirname, ".gemini-adapter-compiled.mjs");

// ============================================================================
// 转译 + 提取
// ============================================================================

/**
 * 用 esbuild 将 schema-registry.ts 转译为临时 ESM 模块并动态导入
 */
async function extractFromSource(entryPoint, outfile) {
    await build({
        entryPoints: [entryPoint],
        bundle: true,
        format: "esm",
        target: "es2022",
        outfile,
        // 擦除 obsidian 等外部依赖（schema-registry.ts 不依赖它们）
        external: ["obsidian"],
        // 路径别名与主项目一致
        alias: { "@": join(ROOT, "src") },
        logLevel: "silent",
    });

    const moduleUrl = pathToFileURL(outfile).href;
    const mod = await import(moduleUrl);

    // 清理临时文件
    try { unlinkSync(outfile); } catch { /* 忽略 */ }

    return mod;
}

const mod = await extractFromSource(REGISTRY_SRC, TEMP_OUTPUT);
const stageMod = await extractFromSource(STAGE_CATALOG_SRC, STAGE_TEMP_OUTPUT);
const promptMod = await extractFromSource(PROMPT_CATALOG_SRC, PROMPT_TEMP_OUTPUT);
const promptTemplateMod = await extractFromSource(PROMPT_TEMPLATE_SRC, PROMPT_TEMPLATE_TEMP_OUTPUT);
const promptMessageMod = await extractFromSource(PROMPT_MESSAGE_SRC, PROMPT_MESSAGE_TEMP_OUTPUT);
const chatAdapterMod = await extractFromSource(CHAT_ADAPTER_SRC, CHAT_ADAPTER_TEMP_OUTPUT);
const responsesAdapterMod = await extractFromSource(RESPONSES_ADAPTER_SRC, RESPONSES_ADAPTER_TEMP_OUTPUT);
const geminiAdapterMod = await extractFromSource(GEMINI_ADAPTER_SRC, GEMINI_ADAPTER_TEMP_OUTPUT);

// ============================================================================
// 提取 SCHEMAS：通过 SchemaRegistry 实例获取各类型的完整 Schema
// ============================================================================

const registry = mod.schemaRegistry;
const TYPES = ["domain", "issue", "theory", "entity", "mechanism"];

const SCHEMAS = {};
for (const type of TYPES) {
    SCHEMAS[type] = registry.getSchema(type);
}

// ============================================================================
// 提取阶段目录：脚本与运行时共用同一份元数据
// ============================================================================

export const STAGE_CATALOG = stageMod.STAGE_CATALOG;

export function getWriteStages(type) {
    return stageMod.getWriteStageDefinitions(type);
}

export function getWriteStage(type, stageId) {
    return stageMod.getWriteStageDefinition(type, stageId);
}

export const getOperationPromptTemplateKey = promptMod.getOperationPromptTemplateKey;
export const BASE_COMPONENT_MAP = promptTemplateMod.BASE_COMPONENT_MAP;
export const injectPromptBaseComponents = promptTemplateMod.injectPromptBaseComponents;
export const renderPromptTemplate = promptTemplateMod.renderPromptTemplate;
export const splitPromptIntoMessages = promptMessageMod.splitPromptIntoMessages;
export const addPromptSchemaConstraint = promptMessageMod.addPromptSchemaConstraint;
export const OPENAI_CHAT_COMPLETIONS_ADAPTER = chatAdapterMod.OPENAI_CHAT_COMPLETIONS_ADAPTER;
export const OPENAI_RESPONSES_ADAPTER = responsesAdapterMod.OPENAI_RESPONSES_ADAPTER;
export const GEMINI_GENERATIVE_LANGUAGE_ADAPTER = geminiAdapterMod.GEMINI_GENERATIVE_LANGUAGE_ADAPTER;

// ============================================================================
// 任务输出 Schema（对齐 TaskRunner 的 response_format）
// ============================================================================

export const DEFINE_SCHEMA = mod.buildStrictJsonSchema(registry.getDefineSchema());
export const TAG_SCHEMA = mod.buildStrictJsonSchema(registry.getTagSchema());

export function buildPhaseJsonSchema(conceptType, fields) {
    const schema = SCHEMAS[conceptType];
    if (!schema) throw new Error(`未知知识类型: ${conceptType}`);
    return mod.buildPhaseJsonSchema(schema, fields);
}

/** 与生产 CTX_META 契约一致：不向模型暴露内部标识、状态或其他阶段数据。 */
export function buildPromptMetaContext(meta = {}) {
    const type = typeof meta.type === "string"
        ? meta.type
        : "";
    return JSON.stringify({
        standard_name_cn: typeof meta.standard_name_cn === "string" ? meta.standard_name_cn : "",
        type,
        standard_name_en: typeof meta.standard_name_en === "string" ? meta.standard_name_en : "",
    }, null, 2);
}
