# Outer contour and islands

Follow-up to merged PR #170. Select sources, then open **Außenkontur und Inseln
ableiten …**. Choose outer only, outer plus selected islands, or islands only.
Pick islands on the canvas or list; the matching row is highlighted and scrolled
into view. Source retention defaults on. Replacement requires confirmation and
Undo restores originals. Avoid cutting retained originals and results twice.

Detection uses adaptive0.001mm tessellation on the existing0.001mm integer grid,
independently of the joining tolerance. Output restores source Bezier intervals.
Explicit tolerance connectors do not stretch source end segments; orange shows
connections in the detection network. Only connections on output boundaries are
cut. Grid-to-source endpoint recovery can differ by up to0.002mm; inspect tiny
gaps and tangencies. No universal sub-grid topology or manufacturing guarantee.

Untraceable islands are individually selectable as validated detected polylines,
labeled **Näherung** and marked red. There is no smoothing or extra gap closure,
nor a promised maximum deviation from the original source. Self-crossing/open/
degenerate polygons and unapproved merged-boundary or exterior approximations
remain refused. “Alle exakten” never silently selects approximate candidates.

Shared network/curve-piece caches, failed-trace caching and one batched union
avoid repeated full reconstruction. Tolerance typing is debounced120ms; Apply
is disabled immediately and pending work canceled when closing. Preparation
still runs synchronously. These changes add no dependencies or serialized
document fields. Other local contour-offset, slot and separation prototypes
are deliberately excluded.

Checks: `npm run test:outline`; synthetic matrix:
`node scripts/vector-offline-test.mjs scripts/outline-precision-study.ts`.
Browser: `node scripts/editor-followup-browser-fixture.mjs outline`, then
`node scripts/run-feature-browser.mjs artifacts/feature-browser runFeatureChecks`.
No native application launch or physical machine tests. Private projects are
not included. Substantial AI assistance: GPT6.1Sol(OpenAI) via OpenCode.
