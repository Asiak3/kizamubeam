# Separate path islands — Draft

## Corrected source-curve topology (supersedes earlier local counts)

The current local implementation separates50 valid contours in original
`inseln.kzb` object233 and retains only the self-crossing subpath42. All51 original
definitions survive exactly. Integer-rounded detection contacts/areas no longer
decide validity: a bounded source-Bézier topology check and curve-based containment
do. Old42+9 counts below describe the previous build, not this correction.
Extraction also validates its actual restored output. See
[portable handoff and open points](handoff-islands-20261108.md).

## Local test-build follow-up (2026-11-08)

The following changes are local only, not yet pushed to Draft
[PR #175](https://github.com/negurvulkan/kizamubeam/pull/175).

- Nonmodal window, movable by its title; result-list hover and canvas selection
  highlight the matching group. Canvas selection scrolls its list entry into view.
- “Problematische Teilpfade behalten” defaults on: unclassifiable subpaths remain
  intact in a red-marked group with the original object ID. Strict mode remains
  available. Invalid settings/coordinates and exceeded work budgets still reject.
- X-range contact sweep, 16384 source/sample point caps, unchanged 4-million work
  cap; closed two-node Béziers supported without altering their handles.
- Original `inseln.kzb`, visible object233:42 independent valid islands and one
  group retaining9 subpaths. All51 original subpaths survive, with exact Undo.

Known limitation: coarse sampling and raster rounding falsely flag several of
those9 retained subpaths. The initial count of two false alarms was too low;
ungerasterized diagnostics also clear the three larger contours (4,5,10).
The classifier is not yet fixed. [Findings/performance](island-validation-findings.md).
Some remaining defects originate in our extraction output. Retention prevents
data loss but does not repair that output or validate final reconstructed Béziers.
Inspect generated contours before cutting; this build is for UI testing.

Executed before packaging:13 synthetic test groups plus the unchanged private
resource regression;14 browser checks for highlights, movement, strict/recovery
modes, Apply, original-ID retention, exact Undo and listener cleanup.
Repeat with:

```text
node scripts/vector-offline-test.mjs scripts/path-islands-test.ts <private-inseln.kzb>
node scripts/editor-resource-browser-fixture.mjs <private-inseln.kzb>
node scripts/run-feature-browser.mjs artifacts/resource-browser runPathIslandResourceChecks
```

Manual test: select visible object233, open “Pfadinseln trennen …”, leave distance
at0 and preservation on. Hover list rows, click an island on the canvas, drag the
title, Apply, then Undo. Retained red spans must remain; nothing is deleted.

## Published Draft baseline (historical; before local follow-up)

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
