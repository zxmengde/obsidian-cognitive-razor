/**
 * schema-data.mjs
 *
 * 运行时自动从 src/core/schema-registry.ts 提取 Schema 定义。
 * 通过 esbuild 转译 TypeScript → 临时 ESM 模块 → 动态 import，
 * 确保脚本与插件代码始终保持同步（SSOT）。
 *
 * 导出：
 *   SCHEMAS       — 各知识类型的 JSON Schema（{ Domain, Issue, ... }）
 *   WRITE_PHASES  — 分阶段写入配置（与 schema-registry.ts 一致）
 *   buildPhaseSchema(conceptType, fields) — 生成 <output_schema> 内容
 */

import { build } from "esbuild";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGISTRY_SRC = join(ROOT, "src/core/schema-registry.ts");
const TEMP_OUTPUT = join(__dirname, ".schema-registry-compiled.mjs");

// ============================================================================
// 转译 + 提取
// ============================================================================

/**
 * 用 esbuild 将 schema-registry.ts 转译为临时 ESM 模块并动态导入
 */
async function extractFromSource() {
    await build({
        entryPoints: [REGISTRY_SRC],
        bundle: true,
        format: "esm",
        target: "es2022",
        outfile: TEMP_OUTPUT,
        // 擦除 obsidian 等外部依赖（schema-registry.ts 不依赖它们）
        external: ["obsidian"],
        // 路径别名与主项目一致
        alias: { "@": join(ROOT, "src") },
        logLevel: "silent",
    });

    const moduleUrl = pathToFileURL(TEMP_OUTPUT).href;
    const mod = await import(moduleUrl);

    // 清理临时文件
    try { unlinkSync(TEMP_OUTPUT); } catch { /* 忽略 */ }

    return mod;
}

const mod = await extractFromSource();

// ============================================================================
// 提取 SCHEMAS：通过 SchemaRegistry 实例获取各类型的完整 Schema
// ============================================================================

const registry = mod.schemaRegistry;
const TYPES = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];

export const SCHEMAS = {};
for (const type of TYPES) {
    SCHEMAS[type] = registry.getSchema(type);
}

// ============================================================================
// 提取 WRITE_PHASES：直接使用导出的常量
// ============================================================================

export const WRITE_PHASES = mod.WRITE_PHASES;

// ============================================================================
// buildPhaseSchema：生成 <output_schema> 内容（对齐 task-runner.ts）
// ============================================================================

/**
 * 构建阶段 Schema 描述
 * 生成人类可读的字段描述，带 // description 注释和正确的逗号分隔
 */
export function buildPhaseSchema(conceptType, fields) {
    const schema = SCHEMAS[conceptType];
    if (!schema?.properties) return fields.map(f => `"${f}": "..."`).join(",\n");

    const lines = ["{"];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const prop = schema.properties[field];
        const comma = i < fields.length - 1 ? "," : "";
        if (!prop) { lines.push(`  "${field}": "..."${comma}`); continue; }
        const desc = String(prop.description || field);
        const type = prop.type || "string";
        // 多行描述放在字段上方作为独立注释块，单行描述保持行尾注释
        const isMultiLine = desc.includes("\n");

        if (isMultiLine) {
            const descLines = desc.split("\n").map(l => `  // ${l}`);
            lines.push(...descLines);
        }

        const inlineComment = isMultiLine ? "" : `  // ${desc}`;

        if (type === "array" && prop.items) {
            const items = prop.items;
            if (items.type === "object" && items.properties) {
                const subFields = Object.entries(items.properties)
                    .map(([k, v]) => `"${k}": "${v.description || k}"`)
                    .join(", ");
                lines.push(`  "${field}": [{ ${subFields} }, ...]${comma}${inlineComment}`);
            } else {
                lines.push(`  "${field}": ["...", ...]${comma}${inlineComment}`);
            }
        } else if (type === "object" && prop.properties) {
            const subFields = Object.entries(prop.properties)
                .map(([k, v]) => `"${k}": "${v.description || k}"`)
                .join(", ");
            lines.push(`  "${field}": { ${subFields} }${comma}${inlineComment}`);
        } else {
            lines.push(`  "${field}": "..."${comma}${inlineComment}`);
        }
    }
    lines.push("}");
    return lines.join("\n");
}
