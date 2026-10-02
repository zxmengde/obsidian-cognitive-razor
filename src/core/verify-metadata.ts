import YAML from 'yaml';
import type { TaskRecord } from '../types';

const NOTE_FIELDS = ['cruid', 'type', 'name', 'status', 'created', 'updated', 'aliases', 'tags', 'parents', 'sourceUids', 'standard_name', 'standard_name_cn', 'standard_name_en'] as const;

/** Verify describes the captured note, not the generated Concept schema.
 * Explicit legacy fields (including empty/null values) take precedence over
 * legacy concept context. Absent fields are never manufactured as empty ones.
 * This reads only; the original snapshot and custom prompt template are intact.
 */
export function buildVerifyMetaContext(payload: TaskRecord<'verify'>['payload']): string {
    const fields: Record<string, unknown> = {};
    const sources: Record<string, 'frontmatter' | 'task_context'> = {};
    const normalized = payload.currentContent.replace(/\r\n?/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    let frontmatterReadable = false;
    if (match) {
        try {
            const value: unknown = YAML.parse(match[1], { uniqueKeys: true });
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const note = value as Record<string, unknown>;
                // Round-trip before assigning so malformed cyclic YAML cannot
                // leave a partially assembled or unserializable context.
                const selected = Object.fromEntries(NOTE_FIELDS.filter(key => Object.hasOwn(note, key)).map(key => [key, note[key]]));
                const serializable = JSON.parse(JSON.stringify(selected)) as Record<string, unknown>;
                Object.assign(fields, serializable);
                for (const key of Object.keys(serializable)) sources[key] = 'frontmatter';
                frontmatterReadable = true;
            }
        } catch { /* The raw snapshot remains available; do not infer missing fields. */ }
    }
    const context: Record<string, unknown> = { type: payload.noteType };
    if (payload.concept) {
        context.standard_name_cn = payload.concept.name.chinese;
        context.standard_name_en = payload.concept.name.english;
    }
    for (const [key, value] of Object.entries(context)) {
        if (!Object.hasOwn(fields, key) && value !== undefined) {
            fields[key] = value;
            sources[key] = 'task_context';
        }
    }
    return JSON.stringify({ ...fields, _verify_context: {
        frontmatterReadable,
        fieldSources: sources,
        interpretation: 'frontmatter 标记的键来自笔记快照；task_context 是任务上下文，不表示笔记中存在该字段。未列出的键未提供，显式空值保留原样。本元信息不是必填字段 Schema，不能据此新增笔记字段要求。',
    } }, null, 2);
}
