import { CR_TYPES } from '../types';
import type { CRType, DirectoryScheme, PluginSettings } from '../types';

export const DEFAULT_KNOWLEDGE_ROOT = 'C-知识库';
export const DEFAULT_CARDS_DESTINATION = 'D-习题库';
export const DEFAULT_TYPE_SUBDIRECTORIES: DirectoryScheme = {
    domain: '1-领域', issue: '2-议题', theory: '3-理论', entity: '4-实体', mechanism: '5-机制',
};
export type LocationSettings = Pick<PluginSettings, 'directoryScheme' | 'cardsSourceRoot' | 'cardsTargetRoot'>;
export type LocationDraft = { mode: 'unified' | 'custom'; knowledgeRoot: string; destination: string; directories: DirectoryScheme };
export type LocationChange = { key: CRType | 'cardsSourceRoot' | 'cardsTargetRoot'; before: string; after: string };

function mapDirectories(value: (type: CRType) => string): DirectoryScheme {
    return { domain: value('domain'), issue: value('issue'), theory: value('theory'), entity: value('entity'), mechanism: value('mechanism') };
}

export function isLocationPath(value: string): boolean {
    return value.length > 0 && !/[\\:]/.test(value) && !value.startsWith('/')
        && !Array.from(value).some(char => char.charCodeAt(0) <= 31)
        && value.split('/').every(part => Boolean(part) && part !== '.' && part !== '..');
}
/** Only the explicit source root can establish unified mode. Never infer an old root. */
export function locationDraft(settings: LocationSettings): LocationDraft {
    const prefix = `${settings.cardsSourceRoot}/`;
    const unified = CR_TYPES.every(type => settings.directoryScheme[type].startsWith(prefix)
        && isLocationPath(settings.directoryScheme[type].slice(prefix.length)));
    return {
        mode: unified ? 'unified' : 'custom', knowledgeRoot: settings.cardsSourceRoot,
        destination: settings.cardsTargetRoot,
        directories: mapDirectories(type => unified ? settings.directoryScheme[type].slice(prefix.length) : settings.directoryScheme[type]),
    };
}
export function unifiedLocationDraft(current: LocationDraft): LocationDraft {
    return { ...current, mode: 'unified', directories: { ...DEFAULT_TYPE_SUBDIRECTORIES } };
}
export function locationCandidate(draft: LocationDraft): LocationSettings | undefined {
    const source = draft.knowledgeRoot.trim();
    const destination = draft.destination.trim();
    const directories = mapDirectories(type => draft.directories[type].trim());
    if (![source, destination, ...Object.values(directories)].every(isLocationPath)) return undefined;
    return {
        cardsSourceRoot: source, cardsTargetRoot: destination,
        directoryScheme: mapDirectories(type => draft.mode === 'unified' ? `${source}/${directories[type]}` : directories[type]),
    };
}
export function locationChanges(before: LocationSettings, after: LocationSettings): LocationChange[] {
    return [
        ...CR_TYPES.map(key => ({ key, before: before.directoryScheme[key], after: after.directoryScheme[key] })),
        ...(['cardsSourceRoot', 'cardsTargetRoot'] as const).map(key => ({ key, before: before[key], after: after[key] })),
    ];
}
export function locationFingerprint(settings: LocationSettings): string {
    return JSON.stringify(locationChanges(settings, settings).map(({ key, before }) => [key, before]));
}
