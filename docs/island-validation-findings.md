# Island validation diagnosis and performance — 2026-11-08

## Superseding correction implemented

The diagnosis below is historical. `src/contourTopology.ts` now validates the
source Béziers using monotone spans/control-hull subdivision, unrounded curve
area and containment. Original object233 now separates50 valid contours while
retaining only the confirmed crossing (subpath42); all51 originals and exact Undo
survive. Raster-zero-area subpath51 is valid and no longer incorrectly retained.
Extraction validates reconstructed boundaries before caching success and the
final collection before document changes. The photoframe regression blocks3
unsafe exact restorations, returns91 validated exact contours, and verifies
individual labeled polygon approximations for all3 at tolerances0.05/0.2/0.3.
No automatic repair/deletion of old geometry. Numerical/work limits remain;
conservative rejection is possible. See [handoff/status](handoff-islands-20261108.md)
and the latest archive's verification/logs for the package actually built.

## Correction to earlier diagnosis

“Nine problematic subpaths” in the current separation UI is **not** evidence of
nine defective Bézier contours. The classifier checks uniformly sampled,
integer-rounded polylines (`flattenSub`,0.001mm grid). Rounding and straight
sample chords can introduce contacts absent from the curves. Translation relative
to the grid changes some classifications without changing the actual topology.

Read-only unquantized adaptive sampling (control-hull error1e-7mm) of original
`inseln.kzb`, object233, subpaths4,5,10 finds no proper crossings. Their areas are
approximately0.219672,6.343278 and15.591069mm². Subpaths4 and5 pass the current
classifier at identity but fail with the saved translation. Subpath10's reported
contact involves a rounded short junction near a tip. Coincident consecutive
source nodes exist, but `flattenSub` already removes consecutive identical grid
points; those duplicate nodes alone do **not** explain the reported contacts.

Earlier claims that all these large paths had real self-contacts were too strong.
The screenshot cannot by itself be mapped to a particular subpath index, but
these large retained contours show that the UI currently mislabels valid-looking
geometry. No source nodes or curves were deleted or repaired in this investigation.

Small slivers must be distinguished from these false alarms. Subpath42 has a
numerically confirmed Bézier intersection near(65.04066,364.81889) in local mm:
Newton refinement of two distinct curve parameters leaves residual1.42e-14mm.
Subpath51 has nonzero sampled area around1.03e-6mm² despite zero raster area.
“Raster area zero” must therefore not be described as proven exact zero area.
No universal manufacturing guarantee follows from either result.

Re-running extraction on `photoframe.kzb`, objects117–124, reproduces the large
contours and tiny slivers, including subpath42's matching area/intersection.
At tolerance0.05 the current extraction returns94 exact-selected contours from162
candidates. Other tested tolerances are0.2 and0.3. This confirms creation-side
responsibility for at least the intersecting sliver; it does not prove every red
contour is defective. `outlineBoundary` restores exact source intervals after
grid-based detection, while `restoredBoundary` caches success without validating
the restored final topology. The precise interval-level origin of each sliver
and a safe final-output guard still need implementation and regression tests.

Diagnostic: `scripts/island-output-diagnostic.ts <resource>` through the offline
runner. Results remain in private local `artifacts/outline-islands/`; projects
are unchanged. Sampled absence of crossings is not an exact topology certificate,
and the diagnostic does not fully classify collinear contacts or all tangencies.

## Performance changes (local, not in the supplied EXE or PR175)

`scripts/path-islands-performance-study.ts` measures seven repetitions at edge
distances0,0.01,0.1,1mm, with source/output hashes and read-only file assertions.

- Before: positive distances take roughly470–660ms and exceed the4-million
  candidate-work cap. The unchanged zero-distance result has43 groups/9 retained.
- After: component and segment bounding-box rejection plus skipping already
  transitively connected components bring positive-distance runs to roughly
  25–60ms in the first local run. The work cap remains unchanged. These requests
  now complete; there is no previously successful output hash to compare for them.
- The successful zero-distance output hash remains identical. A32-rectangle,
  seven-threshold exhaustive distance oracle verifies grouping independently.
- Cached node polygons/bounds/areas preserve existing workspace pick semantics.
  In a separate Chromium test, median300 hover probes drop11.6→1.2ms. This is not
  a claim of faster native rendering: opening10.3→12.1ms, ten renders13.7→14.9ms,
  Apply9.1→11.2ms in that run; these small phases show no measured improvement.
- Browser output geometry matches byte-for-byte before/after; exact Undo remains.
  1200 pick probes match the previous exhaustive picker. Picking still uses the
  existing node polygons, not an improved exact-curve hit test.

Executed:14 path-island test groups plus original-resource regression,15 resource
browser checks, before/after Node/Chromium studies, TypeScript, production build
and i18n check. Build has existing chunk/externalization warnings; i18n has no
missing English entries. No native app/installer or hardware was started.

**Remaining:** fix raster-sensitive classification and validate restored final
extraction output without deleting small geometry. Current performance changes
intentionally do not change which original contours are retained at distance0.
No PR push or new Windows package in this follow-up.

Substantial AI assistance: GPT6.1 Sol (OpenAI) via OpenCode.
