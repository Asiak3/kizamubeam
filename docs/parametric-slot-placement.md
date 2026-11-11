# Parametric slot / notch placement — local test prototype

Superseded interaction: see [contour-guided placement and dependent references](contour-guided-slots.md).
The notes below document the first free-placement build. New guided mode supports
workspace placement, two depth origins and references; free mode remains available.

Status: **local manual tests ongoing**. Not upstream functionality or hardware
certification. Windows test packaging is requested; do not run on physical
machines as part of automated verification.

Windows build completed: `artifacts/windows-slots-outline-20261106-014932/`
contains `KizamuBeam-slots-outline.exe`, NSIS installer, logs and source/binary
SHA-256 manifests. Recorded source hashes were rechecked and match the current
source. Neither binary was launched or installed by the agent.
Feature discussion: https://github.com/negurvulkan/kizamubeam/issues/146.

## Use

Select one closed vector object and choose **Werkzeuge → Schlitze / Ausklinkungen
platzieren …**, or add the `slotplace` action to a custom toolbar. This is
additional to the existing slot-resizing tool.

Move the pointer over the simplified preview to see a rectangular cutter and the
subtracted result; click to place. The cutter is centered at the click. Place it
across the boundary for a notch or fully inside for a closed slot. Select an
existing cut-out in the list to edit its center, angle, width, depth, factor or
clearance. Choose “Neuen Ausschnitt platzieren” to add another. Apply commits all
changes as one Undo step; Cancel leaves the document untouched.

Width is **nominal width × factor + total clearance**. Positive clearance widens
the opening; negative clearance tightens it. Depth is the full rectangle length.
This is geometry/fit correction, not measured laser kerf. The layer's ordinary
output kerf still applies afterwards; avoid double compensation. Preview axes
are the object's LOCAL coordinates, with y down, not machine coordinates.

Non-destructive is the default: the object becomes a generator with a stored
recipe and cached result paths. The recipe retains the original shape (including
generator/sketch parameters), original closed paths and editable cut-outs. The
same object ID, matrix, layer and output flags remain. Double-click reopens slot
editing. “Originalform wiederherstellen” explicitly removes cuts and restores
the source shape; Undo reverses that restoration.

“Destruktiv festschreiben” requires confirmation and produces a plain path,
discarding the recipe; Undo restores the previous object. Non-destructive does
NOT mean automatic live regeneration when an embedded source generator's own
parameters or project bindings change. Source editing through the wrapper is
not implemented; restore the source before editing it and placing new cuts.

## Boundaries and persistence

- One top-level visible, unlocked closed vector object at a time. Images, text,
  groups and assembly members are refused; no hidden conversion of a whole
  assembly or reassignment of its parts.
- Rectangular cuts only; no automatic edge snapping, tangent alignment, stable
  edge binding, dogbones, rounded corners or direct workspace placement yet.
- Up to 128 cut-outs, 16,384 source nodes and bounded clipping input. Invalid
  dimensions, cutters missing remaining material and full material removal
  reject rather than produce an empty or misleading result.
- Curve subtraction is approximated using existing flattening/Clipper integer
  precision. Narrow remnants may be generated: inspect the normal design-check
  and job preview. No assertion of structural strength or laser safety.
- Uses existing `gen` serialization: generator ID `slot-placement`, version 1,
  JSON recipe in a data parameter, cached `subs`. Older readers lacking this
  generator can retain/use cached geometry but cannot edit the recipe. No file
  version migration, new dependency or machine-command change.
- Existing generic path editing can explicitly flatten the generator after the
  normal confirmation. Use this tool, not “Schlitze anpassen”, to edit its recipe;
  that older tool is not recipe-aware. Project backup is recommended for testing.

## Executed checks

- `test:slot-placement`: 9 checks passed, including 3.7 mm + 0.1 mm fit example,
  notch geometry, rotation, budgets, invalid/removal cases, immutable sources,
  cached geometry, save/load/clone and exact Undo/Redo.
- Isolated real-editor browser check: `{errors: [], undo: 0}`; placing, applying,
  reopening, changing a slot width, cancel and listener cleanup.
- Passed: `test:outline`, `test:vector`, `test:interaction`, `test:generators`,
  `test:slots`, `test:gcode`, `test:history`, `test:boolean`, `test:params`,
  `test:sketch`, `test:nest`, frontend `build` and `i18n:check`.
- `test:joints` failed one textual assertion: expected English knuckle summary,
  actual German summary. Three other cases in that suite passed. Not hidden or
  relaxed; no claim that the entire regression collection is green.

Logs: `artifacts/local-prototypes/slots-*.log`. No hardware, full-app startup or
native manual acceptance by the agent. **Manual local tests ongoing** for both
this feature and the outer silhouette tool. Substantial implementation/test/docs
assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**, not independent human review.
