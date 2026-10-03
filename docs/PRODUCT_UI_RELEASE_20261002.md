# Product UI and configuration consistency release

## Implemented

- Workbench follows the approved 360/448 px design: separate concept/current-note intentions, retained drafts and selected candidate, all five types, one create action, contextual note actions, quiet task/history summaries, opt-in bulk management, and per-request E206 confirmation.
- Settings retain the three-page architecture. Models are edited only in AI & models; shared defaults and per-task overrides are explicit. Effective task probes test only that task's capability, including the index model and requested/returned dimensions. Temporary forced-connection diagnostics remain in the connection menu.
- New locations place the five note types under the cards source root. Existing seven path values are preserved as custom locations; conversion requires a before/after preview and explicit save. Existing files are never moved. Pending/running path snapshots retain their established behavior.
- Embedding cache identity uses the effective canonical endpoint and a credential-safe route-query fingerprint. Equivalent origin and /v1 forms no longer repeatedly invalidate the index; routing-query changes now invalidate incompatible vectors. Existing affected legacy bare-origin or routing-query profiles may be invalidated once when corrected. This affects index cache only; Markdown is not removed, and the upgrade does not automatically send model requests. Rebuilding remains an explicit user action.
- Integrated the locally supplied renderer-fetch timeout correction: total request duration uses that request's configured network timeout, rather than a fixed 600 seconds. Heartbeats extend idle time only; they never extend the total deadline. No automatic replay or transport fallback was introduced.

## Verification on final source

- Full Vitest: 76 files, 981 tests passed.
- ESLint, test TypeScript, production TypeScript/Svelte and production build passed; Svelte reports zero errors and zero warnings.
- Fake-clock regressions cover requests completing after 600 seconds with a 3600-second setting, the configured total deadline despite heartbeats, cancellation/late-result protection, one dispatch, timer cleanup, and persistence of both 3600-second controls as milliseconds.
- Real Obsidian host checks covered 360/448 px workbench states, 580 px settings content, dark/light warning rendering, primary action weight, native select affordance, legacy path preview/cancel, and restoration of the production bundle with no QA commands.
- The five-candidate, running/cancelled/late-result visual states used a standalone, memory-only QA plugin mounting the exact production Svelte components. These verify actual host layout and UI interaction, not real model or transport success.
- No real model API calls were made in this pass. Windows-specific runtime behavior and long real provider calls were not newly exercised.

The separate `scripts/build-product-ui-qa.mjs` fixture builder is not a production entry point. Its generated QA bundle must never be released as the plugin's main.js.
