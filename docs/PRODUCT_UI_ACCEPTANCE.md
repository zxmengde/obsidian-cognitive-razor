# Approved product UI acceptance

Approval: 2026-10-02. Reference images: `04-workbench-product-proposal.png` and `05-settings-single-authority-proposal.png`. Static examples are visual contracts, not test evidence. Preserve existing runtime safety and configuration semantics unless explicitly described below.

## Visual contract

- Workbench: verify actual 360 px and 448 px host panes; 20 px horizontal inset; one left-aligned content column. Heading 19 px / 600, main concept 18–19 px, row titles 14–15 px, body 13 px, secondary 12 px, fine print 11 px. Respect user font scaling.
- Main area: 36 px two-segment intent switch, 42 px input, 38 px primary action; 7 px corners. Small spacing 8/12 px; related groups 24 px; section separators followed by 23–24 px. No nested decorative cards.
- Dark reference: background #1e1e1e, field #2c2c30, divider #39393d, foreground #eeeef1, secondary #b0afb9, subtle #888792, accent #c5b8f3, selected surface #34303f, warning #e2bd84. Provide corresponding accessible light-theme tokens; do not impose dark colors in light mode.
- Settings: same typography and separators; single column capped at 760 px, examples at 580 px. Title 22 px, page title 23 px, section 16 px. Keep original three top-level pages.
- Buttons must not inherit host centering, shadow, or intrinsic width that changes reference alignment. Labels, paths, and long Chinese/English titles must wrap without overlap or horizontal scrolling.

## Workbench behavior

- Separate New concept / Current note intentions; preserve draft and current result when switching. One primary create action after selecting a candidate; keep all five types and their confidence available.
- Current note shows real name and parent path. Expand, verify, and cards retain exact eligibility and safeguards. Disabled/unavailable states explain the next step.
- Tasks show activity and needed decisions; bulk selection/filters only inside Management. History and similar-note checks are subordinate. No-task and index-disabled states must not claim an unperformed check.
- Unknown outcomes remain explicit per-task risk confirmations (including E206); no batch bypass. No duplicate full warnings on every collapsed row. Details, retry/cancel, delete, and existing recovery flows remain reachable.

## Settings behavior

- AI & models is the only task-model editing location. Notes & cards has no duplicate cards/index editor shortcuts. Service defaults are clearly labeled shared defaults; per-task inheritance/override/omit stays intact.
- Actual task tests resolve the effective provider/model/parameters. Index tests include the effective dimensions; results state the tested scope and invalidate when configuration changes. Connection tests do not imply all tasks passed.
- Unified locations use one knowledge root for five type subdirectories and cards source, plus a cards destination. New defaults must connect create → cards. Legacy dispersed exact paths stay custom; conversion requires a before/after preview and one explicit save. Never move existing user files.
- Preserve active task path snapshots, pending-start model resolution, old settings import, parameter drafts, and recovery behavior. Endpoint identity uses the effective endpoint without exposing secrets in metadata.

## Required acceptance evidence

1. Focused behavior tests plus types/lint; full suite once on final candidate.
2. Real Obsidian screenshots at the reference pane widths for start, candidates, current-note actions, activity, unknown-result handling, settings overview, unified/custom paths and conversion preview.
3. Check both light and dark themes, long labels, keyboard navigation/focus, drafts on back/switch, and host style overrides. Fix deviations before release; unit tests or a static render are not host acceptance.
4. No real API calls for this development pass; no credential or real vault reads/writes by source workers. QA deploys only approved plugin build files.
