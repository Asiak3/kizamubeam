# Extended vector tools

## Published independent PRs — 2026-11-07

All four PRs below have since been **merged upstream**; issue #144 is closed.
The latest official release checked on 07.11. remains v2.7.0 (05.11.), predating
these merges. The combined test build includes additional unpublished work; see
the [current inventory](pr-drafts/README.md#was-unveröffentlicht-aktuell-bedeutet).

Local toolbar follow-up: node editing, Pencil, refit, Shape Builder and isolation
are visible in the default left toolbar, with distinct symbols. Isolation switches
to an exit symbol while active. Existing v5 layouts gain the four missing actions
without resetting order, icon sizes, hidden bars or group choices. Explicit v6
removals remain removed. 11 Apps/migration and 21 actual toolbar DOM checks passed;
this toolbar follow-up has not been published as a PR.

- [#162](https://github.com/negurvulkan/kizamubeam/pull/162): multi-object node/segment editing.
- [#165](https://github.com/negurvulkan/kizamubeam/pull/165): whole-path simplification/refitting, without Pencil.
- [#163](https://github.com/negurvulkan/kizamubeam/pull/163): temporary isolation.
- [#164](https://github.com/negurvulkan/kizamubeam/pull/164): context menus; closes issue #144 on merge.

Each was extracted into its own branch against upstream `main` (`9bee124`), built
and tested independently. They are not stacked. Their documentation/tests describe
the exact extracted scope; the combined local working tree also includes other
unpublished prototypes. See [the ledger](pr-drafts/README.md) for current results.
The sections below retain the original combined-port history and limitations.

Pencil follow-up: [pointer lifecycle and remaining native verification](pencil-follow-up.md).

This increment is based on unmodified upstream **2.7.0**, commit `480d5b1`.
Only the earlier local vector tools are carried forward; no local USB diagnostics,
camera variants, grid-intensity controls, application identity, updater or settings
migration changes are included. The accepted upstream camera/USB behavior stays
as shipped in main. No dependency or version changes are required.

## Included

- Whole-path simplify/refit with world-mm tolerance, cubic/line fitting, sharp
  corner protection, immutable orange preview and transactional Apply/Cancel.
- Multi-object node and independent segment selection, marquee, drag/nudge,
  type changes, edge deletion without bridging gaps, and one-step Undo/Redo.
- Freehand/Pencil with bounded mouse/stylus samples, cubic fitting, tolerance,
  explicit closure, and cancellation without partial geometry.
- German UI keys and English translations; pure geometry diagnostics are
  translated at the UI boundary. Menu entries remain reachable when users have
  customized their toolbars. New tools can also be added to custom toolbars.

Object identity, matrices, layers, names, path marks, subpaths, closure and explicit
start flags are retained where applicable. Unsupported grouped/text/generator
objects require explicit conversion/ungrouping. Changed or locked sources block
stale preview application; no-op edits do not consume Undo history.

## Additional local prototypes

The [outer silhouette tool with selectable holes](outer-silhouette.md) now creates
new geometry from cross-layer selections, with interactive hole selection and a
user-selectable keep-originals option (default on). Replacing originals requires
confirmation and is reversible with one Undo.

Interactive Shape Builder is additive to existing Booleans: hover/click/stroke
closed regions to merge, Alt to erase. The confirmed first edit retains originals
and sets them to “Nicht lasern”; independent derived paths are replaced on later
strokes. Generators retain their parameters; groups are refused intact. No open
cutting lines, gap detection, nested groups or live derived geometry yet.

Context menus now cover vectors, bitmaps, components and blank canvas using shared
shortcut defaults. No configurable-keybinding UI is included. Temporary isolation
filters editing/rendering/snapping, not output; groups stay whole. No persistent
visibility/output flags are changed by isolation.

See the [fresh combined verification and three internal issue drafts](prototype-verification.md).

## Vector fitting limits

No partial-run simplification, separate Gaussian smoothing, freehand continuation
or redraw, Lasso, multiple-handle selection or pressure-based appearance. This is
curve refitting, not a smoothing brush. Inspect near-touching geometry, tiny gaps,
holes and intersections: deviation bounds do not certify unchanged topology.

## Verification

`npm run test:vector` runs nine synthetic geometry cases and sixteen actual-editor
integration cases without constructing the application or loading camera/machine
boundaries. File/native operations are replaced by rejecting test doubles.

Also checked: `test:paths`, `test:corners`, `test:boolean`, `test:warp`,
`test:history`, `test:params`, `test:sketch`, `test:relations`, `test:vecformats`,
`test:gcode`, `test:lbrn`, `i18n:check` and `build`.

All passed on Windows. Existing i18n/bundling warnings remain. Logs are local in
`artifacts/vector-port-2.7.0/`. No real hardware, full app startup or native
EXE/installer build was performed; existing installed binaries are not updated.

Port and tests were substantially generated/adapted by GPT 6.1 Sol (OpenAI) via
OpenCode. Automated verification is not independent human review. No new PR or
feature-branch upload is performed by this increment.
