import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';
// @ts-expect-error QA build transformation is an explicitly tested JavaScript module.
import { transformQaProviderManager } from './scripts/qa-renderer-transform.mjs';
export default mergeConfig(base, defineConfig({
 plugins:[{name:'same-qa-provider-transform',enforce:'pre',transform(source,id){if(id.endsWith('/src/core/provider-manager.ts'))return transformQaProviderManager(source);}}],
 test:{include:['scripts/qa-tests/*.qa.ts']},
}));
