# Slot / notch placement — developer note

Parametric cut-outs on straight outer sections of a single closed vector object
(Tools → slot placement dialog, toolbox action `slotplace`, enabled for exactly
one selected object). Issue: #146. Short note kept per maintainer request; the
older prototype-stage docs and working drafts were removed.

## Interaction

Reference corner (red circle) and straight projection edge (orange) are two
independent picks inside the tool preview — no workspace clicking. The reference
is perpendicular-projected onto the edge's infinite line; that foot is dimension
zero. The distance runs parallel to the edge; the target per cut is the first
outer edge, the center or the second outer edge (yellow). The full cut width must
fit on the finite straight section — never across corners or onto curves.

## Data and code

- Recipe id `slot-placement-projection` (`PROJECTION_SLOT_GENERATOR` in
  `src/slotPlacement.ts`). Stable recipe-local ids, DAG resolver with
  cycle/missing-reference checks and transitive followers, also across edges.
- Geometry core `src/straightSlots.ts`; dialog `src/slotPlacementDialog.ts`;
  preview in a Web Worker (`src/slotPreview.worker.ts`) via
  `src/slotPreviewClient.ts` (one computation at a time, newest queued, stale
  results discarded). Feature tree/groups/helpers: `src/slotConstruction.ts`,
  `src/slotFeatureTree.ts`, `src/slotManufacturing.ts`, `src/slotViewport.ts`.
- Legacy dialogs kept for older recipes without reinterpretation:
  `src/slotLegacyDialog.ts`, `src/slotProjectionLegacyDialog.ts`,
  `src/slotDialog.ts` (slot resizing), `src/slots.ts`.
- Transactional: staged cuts, Apply commits one undo step, Cancel discards all,
  double-click reopens for editing, confirmed destructive commit converts to
  plain paths. Readers without the generator keep the cached geometry.

## Tests

`npm run test:slot-placement`, `test:straight-slots`, `test:contour-slots`,
`test:slot-features`, `test:slot-worker`, `npm run test:slots` (resizing).

## Scope and limits

Single closed vector object, outer straight sections, rectangular cut-outs. No
groups/assemblies, no inner-hole contours, no live editing of embedded generator
sources, local coordinates (general scale/shear needs review). Subtraction uses
the existing Clipper approximation. Burn/corner styles (corner/loop/backarc) and
local burn compensation are follow-ups, not implemented. Play/factor and layer
kerf stay separate — no hidden double compensation.
