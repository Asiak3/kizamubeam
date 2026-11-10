# Lasso and multiple Bézier handles — Draft

Use **Modify → Lasso selection** for objects, or enable **Node lasso** in the
node properties bar for anchors/handles. The node toggle has a visible pressed
state. Drag empty space to lasso; Alt-drag starts directly over a component.
Shift adds, Ctrl/Command toggles, Shift+Ctrl/Command removes. Escape cancels.

Object lasso is conservative **full bounding-box enclosure**, not crossing or
stroke-intersection selection; it does not split groups or select hidden/locked
objects. Node/handle lasso uses world-space positions and boundary-inclusive
even-odd polygon containment. Selection changes do not create Undo entries.
4096 gesture samples maximum; overflow rejects without changing selection.

Shift/Ctrl-click toggles individual handles. Drag a selected handle to move the
selected handles across objects in world mm, or use arrows. Delete removes
selected handles without removing their anchor nodes. Group moves have one
Undo/Redo and cancel restores geometry/redo. For explicit multi-handle moves,
smooth constraints on the affected anchors are released rather than silently
moving unselected opposite handles. Ordinary single-handle smooth/Alt dragging
retains the established behavior. Anchor movement takes precedence over selected
handles on the same anchor during keyboard nudging.

Handle selection is transient, cleared on document replacement/Undo/deselection, never
serialized into projects. Existing multi-object node and segment behavior remains.

## Executed verification

- `npm run test:component-selection`: 5 groups (containment, lasso/toggle,
  multi-handle nudge/Undo, handle-only deletion, cancellation/hidden target).
- `node scripts/next-editor-browser-fixture.mjs` then
  `node scripts/run-feature-browser.mjs artifacts/feature-browser`: 7 actual-editor
  pointer checks including lasso, Shift handles, drag, one Undo/exact restoration.
- `test:nodes`, `test:refit`, `test:isolation`, `test:context-menu`, `test:paths`,
  `test:apps`, `test:history`, `test:gcode`, `i18n:check`, `build`.
  Existing prototype-based test fixtures only gain the new handle-selection map;
  no existing assertion is removed or relaxed.

Independent upstream `73e75cb`/2.8.0. Native gesture/accessibility/platform
acceptance remains open. No app/installer or hardware operation. No unrelated
prototypes. Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**.
