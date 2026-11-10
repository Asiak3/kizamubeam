# Freehand continuation and redraw — Draft

Use **Modify → Edit freehand path …**. Choose continuation or section redraw and
the fit tolerance in world mm (0.002–10), then explicitly start the tool. It edits
a single selected ordinary path; it does not depend on the separate Pencil PR.
Existing nodes are visible as start/end anchors. Stroke preview changes no data.

- Continue an open path at either endpoint. Continuation at a fixed cutting start
  is blocked until that start is explicitly released; no silent start relocation.
- Redraw between two **existing nodes of the same subpath**. Either draw direction
  replaces the interval between the smaller/larger indices. Closed paths retain
  closure; wrapping across node zero is deliberately not inferred. Untouched nodes,
  their Bézier handles, other subpaths, metadata and transforms remain unchanged.
- Freehand sampling is unsnapped. Release commits one Undo step. Escape/capture
  cancellation discards it; unrelated pointers cannot replace or commit a stroke.
- Stale source/selection/matrix/document and locked/hidden/singular targets reject.
  Explicit path conversion is required for generators/text/groups. Sample/fit
  work limits apply. No pressure brush, automatic endpoint search across objects,
  arbitrary interior-curve anchors or curve-topology guarantee is claimed.

Multiple handle movement/Lasso and path islands are independent contributions.

## Executed verification

- `npm run test:freehand-edit`: 5 groups: continuation both ends, redraw both
  directions, closure/start guards, bad endpoints/no-motion, actual-editor affine
  continuation with exact Undo/Redo and stale-source rejection.
- `node scripts/next-editor-browser-fixture.mjs` then
  `node scripts/run-feature-browser.mjs artifacts/feature-browser`: 6 real-editor
  browser checks for dialog, pointer ownership, continuation/redraw/Undo/cancel.
- `test:nodes`, `test:refit`, `test:isolation`, `test:context-menu`, `test:paths`,
  `test:apps`, `test:history`, `test:gcode`, `i18n:check`, `build`.

Independent upstream `73e75cb`/2.8.0; no unrelated prototypes. Desktop/native
gesture acceptance remains open. No application/installer or hardware operation.
Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**.
