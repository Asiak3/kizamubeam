# Parametric notch features — local prototype

## Follow-up: reference marker meaning and hand pan (2026-11-07)

The angle is labelled **minimum change in direction**, not an exact interior-angle
filter. Sharp corners are offered when their turn reaches it. A rounded corner is
collapsed into one virtual-corner reference (square marker) at the intersection
of its two adjacent straights and is offered only when that effective turn
reaches the threshold. This stops a small rounded junction from producing two
references and keeps sub-threshold corners out. Coincident virtual corners are
de-duplicated. Stored vertex references still resolve against the legacy junction
list, so existing recipes are not rebound; new rounded references use an explicit
`curveCorner` origin that resolves independently of later threshold changes.

Read-only diagnosis of `resources/photoframe.kzb` at 90°: object 32 previously
exposed 28 straight/curve junction vertices; 12 virtual corners remain, all with
a 90° or larger effective turn. The 67° junction pair from the report is no longer
offered. The project itself was not modified. This is evidence for that file, not
a guarantee for other drawings.

Directional pan buttons removed. Hand-tool selection plus left-button dragging
pans the preview, with grab/grabbing cursors, pointer capture/release and matching
pointer checks. Middle-button panning and wheel navigation remain available.
Status text has a bounded scrollable area so lengthy diagnostics do not resize
the preview or shift a retained last-valid view.

Executed: 18 straight-geometry tests, the related slot feature/worker/placement/
contour suites, frontend build and i18n passed. Actual browser feature suite:
94/94 assertions passed, including the hand-pan/removed-buttons/legend tests.
Visibility restoration verifies 174,176 stable material/background samples per
toggle (zero mismatches) and identical view transforms. Initial tests also
exposed status-driven preview resizing; fixed. Brittle fill-colour counts were
replaced with those geometry/transform checks because antialiased reference
strokes are not a material-area invariant. Pointer-capture regression events are
synthetic with capture spies; native mouse/touchpad acceptance remains open.
Windows packaging passed: `artifacts/windows-slot-rounded-corners-20261107-005602/`
with EXE, NSIS installer, build log, verification notes, browser results and
SHA-256 manifests; source hashes rechecked after packaging. Not launched or
installed. No machine commands, file-format changes, source commits/pushes or
public PR.

## Follow-up: drafts, visibility and mirrors

Current source work supersedes the archived feature-only build below. Windows
packaging passed: `artifacts/windows-slot-mirrors-20261106-225359/`, application
`KizamuBeam-slot-mirrors.exe` and NSIS installer. Build logs, browser results and
SHA-256 manifests retained; source hashes rechecked after packaging. Neither
application nor installer was launched; native/manual acceptance remains open.

- Toolbar and reference/target/direction actions use icons, localized hover
  tooltips and accessible names. Apply/Cancel retain their conventional text.
  Reference and projection-edge pickers exist only in the selected feature's
  properties, not as context-free toolbar actions.
- Multiple complete or incomplete notch drafts survive tree/group selection.
  Drafts are labelled in the tree, remain editable and stage independently.
  Complete drafts join Apply even without staging; incomplete drafts block Apply
  rather than silently disappearing. Cancel discards the dialog transaction.
- A new notch chooses a feasible initial edge direction once when its first
  placement edge is picked, if the default direction cannot fit. Later explicit
  direction/edge edits are never silently repaired or clamped. Preview updates
  on every reference/edge/parameter edit; direction toggling is not a commit step.
- Original-source reset asks before clearing notches, mirrors, groups and helpers,
  stays inside the open dialog and changes no document until Apply. Cancel leaves
  the previous recipe intact. Applying a pure reset restores the original shape
  in one Undo transaction.
- The body, each group, notch and helper have eye toggles. Helpers remain outside
  notch groups. Visibility is dialog-local, preview-only and never an output or
  dependency filter. Hidden parents/helpers still resolve, and invalid hidden
  features still block Apply. Hiding a group/parent also hides its displayed
  children; restoring it preserves children's individual hidden states.
- Select a notch, use Mirror, then pick a helper line or a straight body edge in
  the preview. The reflected notch appears beneath the original and stores its
  parent and infinite-axis reference. It inherits dimensions/corrections/group;
  edits propagate. Existing mirror axes remain editable. Missing/cyclic/ambiguous
  references, duplicate cutters and reflected mouths that do not fit a matching
  straight body edge reject, without moving the result to a nearby location.

Mirror recipes use `slot-placement-mirrors`, retaining all four prior generator
identities. This prevents the previous test EXE from regenerating a mirror as an
ordinary independent notch. Preview replies explicitly carry resolved nominal
frames so reflected first/second corner identities survive worker transport.

Executed in this follow-up: 14 mirror cases, all existing feature-engine,
construction/manufacturing/viewport suites, real bundled worker/client suite,
straight/free/contour placement, history, generators, G-code, frontend build and
localization checks passed. Actual Chromium: 87 feature assertions passed,
including creation without direction toggling, multiple retained drafts,
confirmed open-window reset, preview-only eyes, mirror inheritance/deletion/
persistence and Undo. Final rebuilt browser pass: all six editor/outline/free/
guided/projection/feature suites passed, along with 192 toolbar SVG label/focus
checks and real-worker reflected semantic-corner/orientation checks. Older results
below apply to the previous build. No hardware, source commit/push or public PR.

## Archived feature-only build

Manual/native acceptance is **ongoing**, not certified. Supersedes the current
editor described in `slot-projection.md`; earlier Windows builds still contain
that earlier editor, not this feature-tree implementation.

Windows packaging passed: `artifacts/windows-slot-features-20261106-222649/`,
application `KizamuBeam-slot-features.exe`, NSIS installer alongside. Build logs,
verification notes and SHA-256 manifests retained; source hashes rechecked after
packaging. Neither application nor installer was launched.

## Workflow

Select one closed vector object and open the notch placement tool. A scrollable
tree replaces object dropdowns. Groups own nominal width, depth, total clearance,
width factor, burn and inner-corner style. Instances inherit all those values,
without overrides, and own their origin, straight placement edge, distance,
direction and own first-edge/center/second-edge measurement target.

Create a notch, pick its origin and edge **inside the preview**, edit position and
stage it to add another. Apply also accepts the currently complete valid draft.
Cancel leaves the document unchanged. Group reassignment by drag/drop requires
confirmation because inherited dimensions change. Reordering is presentation
only; it neither changes dependency evaluation nor cutter subtraction order.

The general corner angle belongs to the recipe, not groups or instances. Sharp
corners are references at or above the threshold; rounded corners are offered
once at their virtual corner when their effective turn reaches it. Legacy vertex
references to either junction remain readable. A legacy recipe with differing
angle thresholds requires explicit adoption; the old editor remains available.

Red marks the origin, orange the selected edge and its traversal direction, and
yellow the projection/parallel dimension. Full notch width must fit on one finite
straight section. No placement on curves or travel around a corner. Invalid edits
retain the last valid geometry and cannot Apply. The diagnostic reports occupied
versus available edge range; change direction/distance or explicitly revert.

Pan with middle mouse, the Pan tool or Shift+wheel/touchpad. Wheel zoom is anchored
at the pointer. Buttons provide pan, zoom and explicit Fit. Parameter edits never
refit the view. Fit uses the finite source geometry, not infinite helper extents.

## Construction and persistence

The midpoint-perpendicular helper stores two point references and an independent
straight-edge reference. It is an infinite line through the points' midpoint,
perpendicular to the edge. Only its drawing is clipped to the viewport. Source
corners, notch mouth/bottom corners and existing virtual intersections can be
selected. Original contour line/cubic intersections become virtual references.

Intersection identities include helper, original contour/segment, root index and
expected root count. Missing/ambiguous intersections, tangencies and coincident
contours reject instead of binding to nearby coordinates. Slots and helpers share
one dependency DAG; mixed cycles reject. Referenced features and occupied groups
are protected from deletion. Helpers never become cutters or output paths.

Recipes retain the original generator/sketch definition, groups, settings,
references and presentation order. Apply is one Undo transaction; only confirmed
destructive baking removes parameters. Original-source restoration remains
available. This stores the source definition; it does **not** implement live
editing/regeneration of an embedded source generator.

New identity: `slot-placement-features`. Earlier `slot-placement-projection`,
`slot-placement-contour` and `slot-placement` remain readable. Earlier local
binaries do not understand new recipes and must retain cached geometry rather
than reinterpret them using older semantics.

## Manufacturing correction

Nominal opening width = nominal width × factor + total clearance. Positive local
burn reduces cutter width by twice burn and depth by burn, tightening the opening
without moving nominal reference datums. Apply rejects local burn together with
nonzero layer kerf and never changes the layer automatically. A later manual
layer-kerf change is outside this dialog's guard: keep layer kerf zero while using
local burn. Material/beam calibration and inspection remain the operator's task.

`corner` is plain; `loop` and `backarc` provide distinct bounded geometric inner-
corner reliefs. They use polygonal lobes/Boolean subtraction, **not exact Boxes.py
continuous or retraced toolpaths**. Independently formulated; no Boxes.py code was
copied or translated. Relief may remove extra material; narrow remnants and
physical fit still require inspection. There is no machine-safety certification.

## Verification in this increment

Executed successfully:

- `npm run test:slot-features`: 11 feature-engine, 9 construction, 24 oriented/
  mirrored manufacturing cases and 6 viewport tests.
- `test:slot-worker`: actual bundled worker, helper results/global settings,
  coalescing, stale replies, snapshots, failures, disposal, no hardware imports.
- `test:straight-slots` (15), `test:slot-placement` (9), `test:contour-slots` (11),
  `test:generators`, `test:history`, `test:gcode`, `test:interaction` (21), and
  `test:camera-overlay` and `test:camera` (offline/memory-only).
- `npm run build` and `npm run i18n:check` passed. Existing chunk-size/import
  warnings and unrelated unused translation keys remain.

- Actual Chromium: existing editor/outline/free/guided/projection fixtures passed;
  new feature UI 47/47 passed, including group propagation, helpers, global angle,
  pan/zoom/fit, Apply/Cancel/Undo, cleanup, helper-only persistence, source
  restoration, valid-draft revert without duplicate staging, confirmed/cancelled
  drag/drop group reassignment and persisted presentation order.
  Invalid-angle last-valid preview:
  51,728 stable geometry samples, zero mismatches.
- Isolated tree browser fixture passed ordering, literal names, ARIA, keyboard,
  focus, validated drag/drop, stale identities, immutability and disposal. The
  server-only launch is not itself a test; results were read in the browser.

Native
pointer/touchpad accessibility, small-display/Windows scaling, screen readers,
material fit and physical cutting remain manually unverified. The known earlier
`test:joints` language assertion has not been fixed or reclassified.

Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**, including delegated
work. Automated tests/agents do not replace independent human review. No public
PR, source commit/push, application startup/installation or hardware connection.
