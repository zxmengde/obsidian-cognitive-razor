import { describe, expect, it } from 'vitest';
import { buildVerifyMetaContext } from './verify-metadata';
import { generateFrontmatter, generateMarkdownContent } from './frontmatter-utils';
import type { TaskRecord } from '../types';

function payload(extra = ''): TaskRecord<'verify'>['payload'] {
    const currentContent = generateMarkdownContent(generateFrontmatter({ cruid: 'synthetic', type: 'mechanism', name: 'Spaced repetition' }), '# Fixture title\nSynthetic body.').replace('\n---\n', `${extra}\n---\n`);
    return { filePath: 'Unrelated fixture filename.md', currentContent, noteType: 'mechanism' };
}

describe('Verify snapshot metadata compatibility', () => {
    it('uses the existing name without creating absent legacy name fields or changing the snapshot', () => {
        const input = payload(); const before = structuredClone(input);
        const metadata = JSON.parse(buildVerifyMetaContext(input));
        expect(metadata).toMatchObject({ name: 'Spaced repetition', cruid: 'synthetic', type: 'mechanism', _verify_context: { frontmatterReadable: true, fieldSources: { name: 'frontmatter' } } });
        for (const key of ['standard_name', 'standard_name_cn', 'standard_name_en']) expect(Object.hasOwn(metadata, key)).toBe(false);
        expect(JSON.stringify(metadata)).not.toContain('Unrelated fixture filename');
        expect(input).toEqual(before);
    });
    it.each(['"旧中文名"', '""', 'null'])('preserves an explicit legacy name %s rather than treating it as absent', value => {
        const input = payload(`\nstandard_name_cn: ${value}\nstandard_name_en: Legacy name\nstandard_name: {chinese: 原始值, english: Original}`);
        input.concept = { name: { chinese: '上下文中文', english: 'Context English' }, type: 'mechanism', coreDefinition: 'Context', source: 'define', parents: [] };
        const metadata = JSON.parse(buildVerifyMetaContext(input));
        expect(metadata.standard_name_cn).toEqual(JSON.parse(value));
        expect(metadata.standard_name_en).toBe('Legacy name');
        expect(metadata.standard_name).toEqual({ chinese: '原始值', english: 'Original' });
        expect(metadata._verify_context.fieldSources.standard_name_cn).toBe('frontmatter');
        expect(metadata.name).toBe('Spaced repetition');
    });
    it('retains explicit legacy concept values with provenance, including empty strings', () => {
        const input = payload();
        input.concept = { name: { chinese: '', english: 'Legacy context name' }, type: 'mechanism', coreDefinition: 'Context', source: 'define', parents: [] };
        const metadata = JSON.parse(buildVerifyMetaContext(input));
        expect(metadata.standard_name_cn).toBe('');
        expect(metadata.standard_name_en).toBe('Legacy context name');
        expect(metadata._verify_context.fieldSources.standard_name_en).toBe('task_context');
        expect(metadata._verify_context.fieldSources.name).toBe('frontmatter');
    });
    it.each(['body without frontmatter', '---\nname: A\nname: B\n---\nbody', '---\nname: &loop [*loop]\n---\nbody'])('does not invent empty names when metadata cannot be read', currentContent => {
        const metadata = JSON.parse(buildVerifyMetaContext({ ...payload(), currentContent }));
        expect(metadata._verify_context.frontmatterReadable).toBe(false);
        expect(Object.hasOwn(metadata, 'name')).toBe(false);
        expect(Object.hasOwn(metadata, 'standard_name_cn')).toBe(false);
    });
    it('distinguishes missing, empty and null real name fields without adding validation requirements', () => {
        for (const [yaml, present, value] of [['type: mechanism', false, undefined], ['name: ""', true, ''], ['name: null', true, null]] as const) {
            const metadata = JSON.parse(buildVerifyMetaContext({ ...payload(), currentContent: `---\n${yaml}\n---\nbody` }));
            expect(Object.hasOwn(metadata, 'name')).toBe(present);
            expect(metadata.name).toBe(value);
            expect(metadata._verify_context.interpretation).toContain('不是必填字段 Schema');
        }
    });
});
