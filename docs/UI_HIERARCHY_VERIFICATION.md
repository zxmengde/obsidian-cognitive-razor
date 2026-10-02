# Workbench hierarchy and host merge dialog — 2026-10-02

## Verified starting point

Restored Library `libfile_d9d4161640b081919584dbc5f51c646c`, version 0,
`cognitive-razor-verify-diagnostic-chain-20261002.zip`.
SHA256: `1782cec36b19adb78bf90237d3b87d9b2094d097cc1fae7dffa18120618ac502`.
The restored source recreates commit `3b34df5d0b270dc84460fd9fd515b1ce7e185d56`
and tree `3122406758872d1d700ca5683d0fc458988216fa` exactly.
The earlier parent history is absent; that commit is explicitly a Git shallow
boundary. The unrelated checkout at `275aa4e` was not used or modified.

Library preparation resolved the exact records. Its signed download path failed
in this container (proxy 403 / DNS failure, also with elevated execution). The
platform attachment downloader successfully transported the resolved file IDs;
the current Library transfer helper then applied their Library identity/version
metadata. Local archive readability and SHA256 were verified before extraction.

All three approved design reference images and the four supplied before-QA
screenshots were downloaded and inspected as actual pixels. The design follows
flat sections, restrained accent links, thin separators and progressive detail.

## Implemented behavior

- Workbench uses 16px padding and flat sections. A visible “识别概念” primary
  button replaces the submit icon; the current note provides compact context.
  Note actions wrap according to available container width.
- Queue heading has natural height even under a host's fixed button-height rule.
  The summary is “需处理 N · 进行中 N”. Filtering and batch actions remain
  available in a collapsed management section.
- Unresolved tasks appear before completed/cancelled history. History starts
  folded and is mounted only when opened. Both groups honor configured page size.
  Select-all excludes folded history, but includes all matching history when
  expanded; explicit state filters still expose their complete matching group.
- Task stage and status wrap together. Interrupted/no-auto-retry state remains
  visible, as does a short safe reason. Longer diagnostics, elapsed time and
  handling guidance are disclosed per task. Raw provider bodies are never shown.
  Retry is labeled with text; uncertain retries still require the existing
  explicit risk confirmation, with no automatic resend.
- Merge preview portals to the owning window's body, escaping the workbench
  container. It remains scoped to plugin theme variables. Its maximum width is
  720px with viewport margins; the body scrolls independently of the footer.
  Existing name/alias/tag/parent/body editing and explicit write confirmation
  remain intact. Parent links retain one-link-per-line handling. Closing a
  pending preview ignores the late result; it never confirms a merge.
- Shared controls have consistent UI typography and no native shadow on quiet
  buttons. Settings use host UI font scale, a bounded content width, and clearer
  heading/section spacing. No model or output parameter behavior changed.

## Validation and evidence

Environment: Node 24.19.0 / npm 11.9.0. Dependencies installed with npm ci using
unchanged package-lock.json. No user credentials, plugin data.json or real notes
were read. No real model API calls were made.

Run lint, check, check:test, full tests and build; exact logs are in the delivery
package. Initial full tests found an obsolete history-default assertion and a
centralized-token violation; these were corrected without weakening rules.

New offline tests cover folded history/priority/safe details; owning-window
portal, keyboard loop, focus return and teardown; a preview arriving after
close; card cancellation followed by reload, late result and new generation;
and late embeddings after cancellation followed by a fresh rebuild. Existing
TaskQueue cancellation/late-result/isolation and restoration tests also run.
Mocks are synthetic ports and cannot establish real API correctness.

`scripts/preview-workbench.mjs` renders the actual Svelte components with synthetic
ports and no model network access. Chromium captures cover 360px and 448px
workbench, expanded management/error details at 360px, light theme, 724px
settings and a merge dialog launched from a 360px contained pane. Browser
geometry verifies summary clearance, no horizontal workbench overflow, two
unresolved rows with history folded, body-level dialog placement and a footer
that remains at the same viewport coordinates while content scrolls. The
preview uses the Obsidian mock for icons and synthetic theme CSS, not the real
Obsidian host. HTML before/after imagery must not be described as host acceptance.

## Remaining host acceptance

In the independent real Obsidian test vault, install only the candidate plugin
build after checking for active tasks. Inspect 360/448px workbench and 724px
settings, dark/light themes, long titles, expanded diagnostics, filter/history
pagination and batch selection. Confirm that host-level merge remains centered
when launched from a narrow sidebar or popout; tab/escape/focus return, human
editing, fixed footer and actual link repair/write semantics require host QA.

No push, merge or deployment has been performed. The known upstream non-streaming
524 after extended buffering and cloud streaming ECONNREFUSED are not resolved
or masked by these UI changes. TLS verification stays enabled; no fallback retry
or parameter changes were introduced. IP:3000 security checks remain separate.


## 2026-10-02 narrow-workbench simplification candidate

Baseline: source archive HEAD `4e0f91d48eff785f46000aeec26ba10c6790c9c4`,
tree `69c0cd3ae89ec2a43ed86281ebe6ffc97be947d9` (matching the supplied upstream
tree). Extracted once into the existing package/source location; no vault,
credentials, user notes, or settings data were read or replaced by development.

- The concept input gets its full row; clearing remains inside the field and
  the primary action has a separate full-width row. Current note context wraps
  safely, with note actions behind a native keyboard-accessible disclosure.
- Unknown requests share one count/risk notice per filtered queue. Each task
  retains stage/state, retry/remove controls, and a compact details disclosure
  for allowlisted reason, elapsed time and guidance. Existing retry confirmation
  and history/filter/pagination behavior stay in place.
- Healthy chat-task defaults are summarized once. Customized, unavailable and
  embedding tasks remain individual rows; opening the adjustment list reveals
  every task. Existing task-editor navigation and retained drafts are unchanged.
- A six-line shared uncertainty predicate also closes an inconsistent-history
  edge case: E206 with an older `known` kind cannot bypass individual confirmation
  or enter a bulk retry. Recovery recognizes the same predicate. Integration
  tests exercise persisted-state load, ordinary bulk retry, explicit retry and
  the synthetic task runner for both kind values. No API request is involved.

Validation: npm ci with unchanged lockfile; lint, production types/Svelte,
test types and production build passed. Seven affected test files are covered
(140 tests total across the initial UI run and the final guard run; overlapping
queue/feedback tests were rerun after the shared guard changed). The first new
queue fixture had a non-bubbling synthetic change event and missing required
error fields; these test-fixture defects were fixed, then that file passed.
This is targeted coverage, not a full repository test run.

Final pre-host-QA main.js SHA256:
`f216cae97e74bd2559b4d07d5e5fca7b5ef86bf0e9de131e921d05a4af9cd57c`.
Build handed to the independent host QA worker for real Obsidian validation.
Browser proposal rendering was blocked; no proposal screenshot or browser UI
acceptance is claimed. Actual host QA, commit and publication are pending.


Host QA caught a clear-button placement regression: the first candidate targeted
an absent generic `.cr-btn` class, leaving the clear control in normal flow.
The selector now targets the actual shared button's `.cr-btn-ghost` class.
A computed-style assertion supplements the input/draft test; its 24-test file,
affected-file lint, test types and production build passed again. The new
`f216cae9...` build was returned to host QA for geometry verification.

### Final host acceptance and regression

The independent real Obsidian QA pass on build `f216cae9...` is complete:
360/448px layouts and the clear-button position passed; every one of the seven
task editors was entered and returned from; unconfigured inherited tasks stayed
visible; a pending blank maxTokens draft survived back/return navigation; unknown
request retry was opened and cancelled; selecting the three interrupted records
exposed no bulk retry action. Temporary UI/settings changes were restored.
No model API calls were made. Real active-task cancellation, Windows and mobile
were not exercised in this round.

Final complete Vitest run: **75 files / 933 tests passed**. The latest lint,
production/test type checks, Svelte check (0 errors / 0 warnings), and production
build passed. Source behavior and the QA-approved build were frozen afterwards.
