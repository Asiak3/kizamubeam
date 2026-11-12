# Contour-guided slots and dependent cut-outs — test prototype

Manual local tests **ongoing**. Follow-up to the earlier free-placement prototype.
Feature discussion: https://github.com/negurvulkan/kizamubeam/issues/146.

Successful Windows build: `artifacts/windows-contour-slots-20261106-022609/`.
Application: `KizamuBeam-contour-slots.exe`; NSIS installer and source/binary
SHA-256 manifests/logs alongside. Source hashes rechecked after build. Neither
binary was launched or installed by the agent. Includes earlier outer silhouette
and layer-list refresh work; replaces no previous archived binaries.

## Use

Select one closed vector object, then **Werkzeuge → Schlitze / Ausklinkungen
platzieren …**. Set width, depth, clearance and factor. The default mode is now
**Konturgeführt**. Select depth from either the actual contour contact on the
centerline or the chord between the two mouth corners.

Click **Auf der Arbeitsfläche platzieren**. The dialog temporarily closes and
the workspace owns point picking. Move close to the source contour: the cutter
orients automatically, with two contact corners on the approximated boundary.
The orange overlay shows the subtracted paths, cutter and contact markers.
Click to stage a cut-out, then place another; **Fertig** or Escape returns to
the dialog. Staging does not edit the document. Apply commits one Undo step;
Cancel discards all staged changes. Existing cut-outs can be selected in the list
and repositioned through the same workspace action.

## References

Each contour-guided cut has a stored contour attachment. Enable **Position über
Referenz und Konturabstand festlegen** for explicit positioning:

- Use a point on the original contour, with local X/Y coordinates or choose it
  on the workspace. The numeric point must be within 0.1 mm of one unambiguous
  boundary. The interactive picker records the projected point.
- Enter distance as arc length along the normalized contour and choose direction.
  Distance must be nonnegative and less than one full perimeter. This is not a
  horizontal/vertical offset. Hole contours have opposite traversal orientation.
- Alternatively choose another contour-guided cut's center or first/second mouth
  edge. The workspace reference picker can choose these contact points; the
  dropdown provides an explicit alternative. The reference applies to mouth
  contacts, not arbitrary edges at the bottom of the cutter.
- Each cut has a stable recipe-local ID. The resolver follows a DAG before each
  subtraction; parent movement propagates transitively. Edge-based children also
  follow changes in the parent's mouth width. Cycles, missing parents and free
  rectangle parents reject. The UI blocks deletion of referenced cuts until their
  children are reassigned. References are within one object's recipe only.

While an explicit reference is enabled, its distance determines position: cursor
movement does not override that constraint. Disable the explicit reference to
move freely along the source contour again. Angle/X/Y center fields are disabled
in guided mode because contour/reference rules determine them.

## Geometry, precision and limits

Existing flattened, integer-normalized source contours supply contact points.
Contacts are found around the cursor's boundary parameter with a chord equal to
effective width. The axis is perpendicular to that chord, directed into material.
A circle therefore gives a radial axis. The actual centerline/contour crossing
and the chord define the two different depth origins. The cutter extends outside
the curved lip to avoid leaving a thin cap at the opening.

This is approximate contact geometry (existing ~0.01 mm flattening and 0.001 mm
integer grid), not an exact Bézier constraint solver. Ambiguous nearby branches,
folds, impossible widths, missing centerline crossings and insufficient depth
are refused. Tiny tangencies, very tight curves and large curvature changes need
manual inspection. No structural-strength or physical-machine certification.

Workspace placement currently supports rigid transforms including rotation and
reflection. Scaled/sheared objects are refused explicitly rather than quietly
interpreting local dimensions as world millimeters. The earlier prototype's
single-object/no-group/no-assembly restrictions remain. Original generator data
is retained but not live-editable through the wrapper.

## Persistence

Original free recipes (`slot-placement`) remain readable, unchanged on load, and
editable in free mode. New commits use `slot-placement-contour` with cached paths
and optional anchor/reference metadata. This separate generator identity makes
the earlier local binary treat the new recipe as unknown and retain cached paths
instead of regenerating incorrect free rectangles. Back up test projects before
editing them with different local binary versions. No document version migration
or machine-command change; normal layer kerf still applies independently.

## Executed checks

- `test:contour-slots`: 11 cases passed, including circle/ellipse/hole contacts,
  depth origins, contour distances, reference chains and parent-width changes,
  cycles/missing references and legacy recipes.
- `test:slot-placement` (9), `test:outline` (18), `test:interaction`, `test:vector`,
  `test:gcode`, `test:slots`, `test:generators`, `test:params`, `test:history`,
  `test:boolean`, `test:sketch`, `test:nest`, `build`, `i18n:check`: passed.
- Rebuilt isolated browser fixture: guided placement and reference handling
  `{errors: [], undo: 0}`; free-placement compatibility `{errors: [], undo: 0}`;
  outer silhouette `{errors: [], objects: 1, undo: 0}`.
- The earlier `test:joints` language-assertion failure is not addressed or hidden;
  that suite was not rerun for this follow-up. No native/manual/hardware claim.

Logs: `artifacts/local-prototypes/guided-*.log`. Substantial assistance:
**GPT 6.1 Sol (OpenAI) via OpenCode**; automated checks are not human review.
