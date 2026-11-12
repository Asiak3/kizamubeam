# Separate path islands — Draft

Use **Modify → Separate path islands …** (German: „Pfadinseln trennen …“).
The dialog previews resulting objects in different colors. A material island
keeps its direct holes; nested material islands become independent objects.
Original Bézier nodes/handles, start flags, transforms and object properties are
retained; no refitting, flattening of output, or layer-kerf changes. One Undo/Redo.

## Options

- Edge distance in **world mm**, default 0: keep islands up to this distance
  together, transitively. This groups subpaths in the same result object without
  moving or joining their geometry. It is not a minimum island size filter.
- Open contours: leave unchanged/reject (default), or explicitly close small
  endpoint gaps. The separate closing tolerance is in world mm. Only a subpath's
  own endpoints may close; different open subpaths are not auto-joined. Preview
  precedes a confirmation before any added closing edges. Cancel changes nothing.

Only editable top-level path objects are accepted. Ungroup and explicitly convert
generators/text first; marked/generated engraving paths are refused. A failed
member cancels the entire batch. Touching, intersecting, coincident, self-crossing
or degenerate contours reject rather than silently boolean/refit source geometry.
At most 256 subpaths, 4096 source/flattened nodes and 4 million segment comparisons.
Classification/distances use the existing quantized curve approximation (0.001 mm
grid, existing curve sampling), not certified exact Bézier topology. Inspect very
small clearances/tangencies and threshold-near curved results before cutting.

## Executed verification

- `npm run test:path-islands`: 8 groups, including nested holes, winding, exact
  nodes, rejection/work bounds, world-mm/transitive distances, explicit closure,
  metadata, one-step Undo/Redo and whole-batch rejection.
- `node scripts/next-editor-browser-fixture.mjs` then
  `node scripts/run-feature-browser.mjs artifacts/feature-browser`: 8 checks using
  the actual editor/dialog: preview/options/Cancel/Apply/Undo/Redo/stale source.
- `test:nodes`, `test:refit`, `test:isolation`, `test:context-menu`, `test:paths`,
  `test:apps`, `test:history`, `test:gcode`, `i18n:check`, `build`.

Independent branch on upstream `73e75cb` / 2.8.0. Native/manual acceptance remains
open. No desktop app/installer or hardware operation. No slot/offset/Shape Builder
prototype included. Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**.
