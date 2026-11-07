# Overlapping-object chooser — Draft

Default: **hold right mouse button for 550 ms** over overlapping objects in the
selection tool. A scrollable list appears at the pointer, frontmost first. Hover
or keyboard focus highlights the candidate in magenta without selecting it.
Click/Enter selects it and closes the list. Escape, outside click, focus loss,
source/selection/tool/view changes cancel; no geometry, visibility or Undo edit.

Short right click preserves the existing editor context menu. Motion of 3 px
cancels the waiting hold; no interference with ordinary left-click dragging.
Selection respects visibility, locks and isolation. Groups are listed as their
normal selectable top-level objects, not silently ungrouped or bypassed. A group
can be opened/ungrouped through established commands for leaf editing. Subpaths
within one compound path are not distinct document objects in this chooser.

**File → Overlap selection settings …** persists trigger (long right click,
long left click, disabled) and duration (250–2000 ms). Invalid/unavailable settings
fall back to right/550. Names are text, not HTML; labels include layer and ID to
distinguish duplicate names. Arrow/Home/End navigation, Escape and Enter/Space
are handled by the chooser, not editor shortcuts. Highlight excluded from export.

## Executed verification

- `node scripts/overlap-browser-fixture.mjs` then
  `node scripts/run-feature-browser.mjs artifacts/feature-browser`: 14 browser
  checks: defaults, opening, safe labels, hover, lower-object selection, context
  preservation, motion/Escape/stale-source cancellation, persisted settings,
  configured left hold and disabled mode.
- `node scripts/run-feature-browser.mjs artifacts/feature-browser prepareTrustedOverlap`:
  trusted Chromium right press/hold/release and lower-row mouse hover/click,
  without a context action, Undo entry or premature menu dismissal. Synthetic
  fixture checks stub pointer capture; this separate trusted test does not.
- `test:nodes`, `test:refit`, `test:isolation`, `test:context-menu`, `test:paths`,
  `test:apps`, `test:history`, `test:gcode`, `i18n:check`, `build`.

Independent upstream `73e75cb`/2.8.0. Native WebView2/other OS and accessibility
acceptance remains separate. No hardware, app/installer startup or machine edits.
Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**.
