import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings-store';
import { captureCardInput } from '../core/card-generation';
import { generateFrontmatter, generateMarkdownContent } from '../core/frontmatter-utils';
import { generateFilePath } from '../core/naming-utils';
import { CR_TYPES } from '../types';
import { locationCandidate, locationChanges, locationDraft, locationFingerprint, unifiedLocationDraft } from './settings-locations';

describe('single-authority locations', () => {
    it('connects all five new default note locations to the cards source', () => {
        expect(locationDraft(DEFAULT_SETTINGS).mode).toBe('unified');
        for (const type of CR_TYPES) {
            const path = generateFilePath('Synthetic', DEFAULT_SETTINGS.directoryScheme, type);
            const content = generateMarkdownContent(generateFrontmatter({ cruid: 'synthetic', type, name: 'Synthetic' }), 'Synthetic body');
            const captured = captureCardInput(path, content, DEFAULT_SETTINGS.cardsSourceRoot, DEFAULT_SETTINGS.cardsTargetRoot);
            expect(captured.ok).toBe(true);
            if (captured.ok) expect(captured.value.targetPath).toContain(`${DEFAULT_SETTINGS.cardsTargetRoot}/`);
        }
    });
    it('preserves exact custom seven fields without guessing a common prefix', () => {
        const custom = { cardsSourceRoot: 'Knowledge', cardsTargetRoot: 'Decks', directoryScheme: {
            domain: 'Old/shared/domain', issue: 'Old/shared/issue', theory: 'Old/shared/theory', entity: 'Old/shared/entity', mechanism: 'Old/shared/mechanism',
        } };
        const before = structuredClone(custom);
        const draft = locationDraft(custom);
        expect(draft.mode).toBe('custom');
        expect(locationCandidate(draft)).toEqual(before);
        expect(custom).toEqual(before);
    });
    it('conversion is only an explicit candidate with all seven before/after paths', () => {
        const custom = { ...structuredClone(DEFAULT_SETTINGS), directoryScheme: { domain: 'A', issue: 'B', theory: 'C', entity: 'D', mechanism: 'E' } };
        const candidate = locationCandidate({ ...unifiedLocationDraft(locationDraft(custom)), knowledgeRoot: 'New/Knowledge', destination: 'New/Decks' })!;
        expect(locationChanges(custom, candidate)).toHaveLength(7);
        expect(candidate.directoryScheme.domain).toBe('New/Knowledge/1-领域');
        expect(custom.directoryScheme.domain).toBe('A');
        expect(locationFingerprint(custom)).not.toBe(locationFingerprint(candidate));
    });
    it.each(['', '../outside', '/absolute', 'C:/vault', 'A\\B', 'A//B', 'A/./B'])('refuses unsafe paths (%s)', path => {
        expect(locationCandidate({ ...locationDraft(DEFAULT_SETTINGS), knowledgeRoot: path })).toBeUndefined();
    });
    it('retains explicitly nested custom type suffixes under an explicit source', () => {
        const settings = structuredClone(DEFAULT_SETTINGS); settings.directoryScheme.domain = `${settings.cardsSourceRoot}/Nested/Domain`;
        expect(locationCandidate(locationDraft(settings))).toEqual({ directoryScheme: settings.directoryScheme, cardsSourceRoot: settings.cardsSourceRoot, cardsTargetRoot: settings.cardsTargetRoot });
    });
});
