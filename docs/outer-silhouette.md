# Outer silhouette with selected holes (local prototype)

Status: **local manual tests ongoing**. Feature request published by explicit
request: https://github.com/negurvulkan/kizamubeam/issues/147.
Included in the successful Windows test build
`artifacts/windows-slots-outline-20261106-014932/` (not launched/installed).
Earlier “no EXE” verification notes below describe the initial implementation.

German UI: **Werkzeuge → Außenkontur mit gewählten Löchern …**. The `outline`
action is also available for customizable toolbars under modification tools.
This is additional to ordinary Booleans and Shape Builder, not a replacement.

## Workflow

1. Select 1–32 closed vector objects, including objects on different layers.
2. Open the tool. The preview starts with only the combined exterior boundaries;
   enclosed holes are filled. Disconnected silhouettes remain disconnected.
3. Hover/click interior regions to retain them as holes. Checkbox alternatives,
   select-all and select-none are available. An entirely enclosed separate source
   object can also become a hole even if ordinary union would swallow it.
4. Choose a target layer and whether to **keep the originals** (on by default).
5. Apply or cancel. Replacing originals requires explicit confirmation; one Undo
   restores the exact original objects, including generator parameters.

The result is an independent compound path, not a live derived parametric feature.
Keeping originals leaves their geometry, parameters, transforms, flags and output
unchanged. They may still be output: avoid sending overlapping originals and
derived geometry together. If any included source is marked no-laser or has
disabled output, the new result is conservatively marked no-laser too.

## Geometry and compatibility

The existing bounded Clipper region decomposition handles overlaps, transforms,
parity holes and nested islands. Only root exterior boundaries form the initial
solid silhouette. Existing empty regions plus completely enclosed input faces
are selectable; regions touching the exterior are not holes. Nested regions can
be selected independently. No bridges or convex hull are invented.

Curves are finely approximated by closed polylines using the existing flattening
and integer clipping grid. This is not exact Bézier preservation or a guarantee
of identical topology at tiny gaps/tangencies. Inspect such details before output.
Images, open paths, hidden/locked sources (including group members) are refused,
not silently dropped. Work/face budgets reject overly complex selections.
Groups with fully supported visible closed members are handled as combined
regions. Text outlines are prepared on copies; originals are not converted.

No new project fields, dependencies, machine commands or output-generation changes.
The generated path uses the existing project format. Source changes, page/tab/
history changes, selection/tool changes and new active edits invalidate stale
previews. Isolation adopts the new object without revealing outsiders.

## Verification — 2026-11-06

- `npm run test:outline`: 18 geometry/editor checks passed with native/file/app
  boundaries denied, including selectable holes/overlaps/islands, transforms,
  curves, guards, keep/replace, parameters, Undo/Redo, no-laser and isolation.
- Real-editor isolated browser fixture: `{errors: [], objects: 1, undo: 0}`.
  Covers actual dialog canvas pixels/click selection, keeping/replacing sources,
  replacement cancellation, stale state, reopening and listener cleanup.
- Passed: `test:vector`, `test:interaction`, `test:boolean`, `test:paths`,
  `test:history`, `test:check`, `test:gcode`, `test:generators`, `test:nest`,
  `i18n:check`, `build`. Logs: `artifacts/local-prototypes/outline-*.log`.
- Rebuilt browser fixture also retained the earlier interaction result:
  `{errors: [], objects: 3, undo: 0}` for region editing/isolation/context wiring.

No new Windows EXE/installer, full application startup or hardware test was
performed for this feature. The earlier Windows test binary does not include it.
Manual native WebView and cross-platform usability acceptance remains outstanding.

Substantial generation/adaptation and tests: **GPT 6.1 Sol (OpenAI) via OpenCode**.
Automated checks are not independent human review. Implementation remains local;
no PR or source-branch upload has been published. Feature issue #147 was later
published by explicit user request, with manual tests marked ongoing.
