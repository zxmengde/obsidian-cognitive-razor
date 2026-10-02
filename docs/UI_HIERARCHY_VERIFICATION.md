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
