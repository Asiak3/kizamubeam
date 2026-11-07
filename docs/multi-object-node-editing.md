# Multi-object node and segment editing

Select multiple paths/primitives and enter the node tool. Nodes and segments
have independent selection sets per object. Marquee/Shift selection, drag,
arrow-key nudge, type changes and component deletion work across objects in
world coordinates. Deleting a segment splits surviving paths without bridging
the removed edge. Each operation has one Undo step; cancelling a drag restores
source definitions and Redo. Clicking a primitive alone does not convert it.

Object identities, transforms, layers, names and unrelated objects are retained.
Hidden/locked/singular targets are excluded. Text/generators/groups still require
the existing explicit conversion/ungrouping workflow. No Lasso or multiple-handle
selection is added. Project formats and machine commands are unchanged.

Executed on this independent branch: `npm run test:nodes` (11 integration cases),
`npm run build`, `npm run i18n:check` (no missing keys). Actual-editor Chromium:
6 checks via `node scripts/editor-feature-browser-fixture.mjs nodes`, serve its
printed directory on loopback and call `await window.runFeatureChecks()`.
Native WebView/cross-platform gesture acceptance remains outstanding. No hardware.

Substantially generated/adapted and tested with **GPT 6.1 Sol (OpenAI) via OpenCode**.
Automated checks are not independent human review.
