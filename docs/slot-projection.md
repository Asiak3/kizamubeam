# Straight-edge slot projection — local test prototype

**Historical editor/build stage:** current feature-tree/group/helper development
and its actual verification are documented in [slot-features.md](slot-features.md).
The archived Windows build below does not include that newer implementation.

Manual tests **ongoing**. Supersedes the arc-length/workspace-placement interaction
in `contour-guided-slots.md`, without reinterpreting older saved recipes.

Windows test build succeeded: `artifacts/windows-projection-overlay-20261106-165125/`,
application `KizamuBeam-projection-overlay.exe`, NSIS installer/logs/hashes alongside.
Source hashes checked after packaging. Includes overlay toggle and isolation menu
fixes; neither executable was launched or installed by the agent.

## Interaction

Select one closed vector object and open **Werkzeuge → Schlitze / Ausklinkungen
platzieren …**. Everything is selected inside the movable, resizable tool window.

1. Choose a reference corner in the preview (or its labelled dropdown).
2. Independently choose a straight projection/placement edge.
3. Choose the new cut-out's first edge, center or second edge as the measurement
   target. Enter distance and direction parallel to the selected straight edge.
4. Set width, depth, factor and total clearance. Stage the cut to continue adding
   others, or Apply the currently valid preview. Cancel leaves the project intact.

The reference is perpendicular-projected onto the infinite line of the placement
edge. That foot is the dimension zero; the distance is a linear dimension, NOT
arc length or global X/Y. The physical cut must fit entirely on the finite straight
section: it cannot cross a corner or move onto an adjoining curve.

For each selected cut: the origin is circled **red**, the projection edge is
**orange**, and the dimension/projection line and target are **yellow**. References
remain visible in the dropdowns and can be changed. Known corners are drawn as
small rings for direct selection; no second click on the workspace is required.

References may be corners on different edges or another cut-out's first/second
opening or bottom corner. Dependencies use stable recipe-local IDs and resolve
as a DAG, including across different placement edges. Parent position, width or
depth changes move children as their selected reference requires. Cycles/missing
references fail; referenced cuts cannot be deleted until dependants are reassigned.

The configurable corner angle means **minimum change in direction** (1–179°),
not an interior polygon angle. A straight/curve transition is also a reference
even if tangential. Real Bezier spans are excluded from placement, not mistaken
for their control-polygon chords. Collinear straight segments are merged.

## Architecture and persistence

- `straightSlots.ts`: pure geometry, corner/edge inventory, perpendicular projection
  and finite-edge fit checks, no DOM or editor dependency.
- `slotPlacement.ts`: recipe validation, dependency resolution and subtraction.
- `slotPreview.worker.ts`: worker-local geometry/bootstrap and reuse of unchanged
  source geometry. No native/hardware/app imports.
- `slotPreviewClient.ts`: one inflight calculation, newest queued request only;
  outdated results discarded, worker terminated on dialog close/stale source.
- `slotPlacementDialog.ts`: staged state, preview/controls and transaction boundary.
- `toolWindow.ts`: draggable title, resizable/clamped dialog and disposable listeners.

The Vite worker output is ES-module format to support bootstrap/dynamic imports.
Heavy preview work runs off the UI thread; final Apply still validates and computes
the bounded recipe once synchronously before taking its Undo snapshot. This is
not a claim of measured frame-rate or hardware safety for arbitrary project sizes.

New recipes use `slot-placement-projection`, retaining cached paths and the source
definition in existing generator fields. `slot-placement` free and
`slot-placement-contour` arc-length recipes remain supported with their original
semantics. The legacy editor is explicitly available for entirely older recipes;
selecting an old cut does not automatically convert it to the new position model.
Earlier local binaries see the new identity as unknown and retain its cached paths.
One Undo restores source parameters, flags and transforms exactly. No data-format
version, native command or laser-control change.

## Limits and remaining work

One top-level closed vector object, no groups/assemblies/images/text. Placement
edges are on root outer contours, not inner holes. Coordinates/dimensions remain
in the object's local coordinate system; general scaled/sheared-source behavior
has not had a native usability acceptance. Source generator definitions are stored,
not live-edited through the wrapper. Curves use existing flattening/Clipper for
subtraction; topology/very small remnants still require inspection.

Burn correction and `corner`/`loop`/`backarc`-style inner corner relief are **not yet
implemented**. Boxes.py documentation was used for conceptual orientation; no
Python source was copied or translated. Fit clearance and existing layer kerf
remain separate; no silent double compensation is introduced.

## Executed verification

- 15 `test:straight-slots` cases passed, covering oriented/off-edge projection,
  own edge/center targets, finite-edge rejection, arbitrary corner thresholds,
  tangent transitions, cross-edge dependency chains, JSON and legacy compatibility.
- `test:slot-worker`: coalescing, stale replies, snapshots, error/disposal handling,
  worker bootstrap and denied native/hardware boundaries passed.
- `test:interaction`: 21 cases passed, including isolation action variants.
- Passed: `test:camera-overlay`, `test:camera`, `test:outline`, `test:slot-placement`,
  `test:contour-slots`, `test:vector`, `test:gcode`, `test:slots`, `test:generators`,
  `test:params`, `test:history`, `test:boolean`, `test:nest`, `build`, `i18n:check`.
- Real isolated module-worker/browser check: `{errors: [], undo: 0}` for projection,
  off-edge bottom-corner reference, persisted propagation, window resize/title drag,
  footer reachability, Cancel/Undo and cleanup.
- Refreshed browser outline and interaction fixtures: no errors. Context menu
  fixture: `{errors: [], ran: 1, closed: 4}`, including menu scroll ownership and
  hidden inactive isolation exit. An initial hidden-tab RAF test timed out; rerun
  from a fresh visible tab passed. No full native app or machine was started.
- Prior Scharnier-suite language assertion failure is not fixed or reclassified;
  that suite was not rerun in this increment. Small-display/Windows scaling and
  real camera usability still require manual acceptance.

Logs: `artifacts/local-prototypes/projection-final-*.log`. Drafts:
`docs/pr-drafts/parametric-slot-projection.md`, `docs/pr-drafts/camera-overlay-toggle.md`.
Substantial AI assistance including delegated work: **GPT 6.1 Sol (OpenAI) via
OpenCode**. Automated agents/tests are not independent human review.
