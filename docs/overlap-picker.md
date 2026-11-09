# Overlapping-object chooser — Draft

Default: **hold right mouse button for 550 ms** over overlapping objects in the
selection tool. A scrollable list appears at the pointer, frontmost first. Hover
or keyboard focus highlights the candidate in magenta without selecting it.
Click/Enter selects it and closes the list. Escape, outside click, focus loss,
source/selection/tool/view changes cancel; no geometry, visibility or Undo edit.

Short right click preserves the existing editor context menu, including when
the platform sends `contextmenu` on press rather than release. Motion of 6 CSS
pixels cancels the waiting hold but preserves the secondary-click menu on release;
configured left holds resume ordinary dragging at that threshold. The tolerance
allows small trackpad jitter and is independent of display pixel density.
Escape while waiting cancels only the hold, without clearing selection or leaving
isolation; a subsequent ordinary Escape retains the editor's usual behavior.
Selection respects visibility, locks and isolation. Groups are listed as their
normal selectable top-level objects, not silently ungrouped or bypassed. A group
can be opened/ungrouped through established commands for leaf editing. Subpaths
within one compound path are not distinct document objects in this chooser.

**File → Overlap selection settings …** persists trigger (long right click,
long left click, disabled) and duration (250–2000 ms). Invalid/unavailable settings
fall back to right/550. Names are text, not HTML; labels include layer and ID to
distinguish duplicate names. Arrow/Home/End navigation, Escape and Enter/Space
are handled by the chooser, not editor shortcuts. Highlight excluded from export.

## macOS and single-button input

In the default right-trigger mode, **hold Ctrl + primary button** (without other
modifiers) over overlapping objects. A short Ctrl-click retains secondary-click
semantics, not Ctrl-primary selection toggling. Alternatively, switch to long
left click in the settings. Two-finger presses and Magic Mouse right clicks can
be held; a two-finger tap cannot. Other platforms' Ctrl-click selection and modified
clicks are not intercepted. Real macOS/WKWebView event ordering still needs native
verification; the automated macOS cases below use synthetic events in Chromium.

## Executed verification — review fixes, 2026-11-08

- `node scripts/overlap-browser-fixture.mjs` then
  `node scripts/run-feature-browser.mjs artifacts/feature-browser runOverlapRegressionChecks`:
  **38 checks passed**, no page errors. Real picker, editor pointer/keyboard,
  isolation and context-menu listeners: macOS Ctrl-hold and short/moved secondary
  replay, unchanged non-Mac/modified clicks, pending Escape with selection and
  isolation, early/late context menus at 3/6/10 CSS pixels, trackpad jitter, normal
  left drag/history and pointer cancellation. Synthetic events stub pointer capture.
- `node scripts/run-feature-browser.mjs artifacts/feature-browser`: all **14**
  original browser checks passed, no page errors.
- `node scripts/run-feature-browser.mjs artifacts/feature-browser prepareTrustedOverlap`:
  trusted Chromium right press/hold/release and lower-row hover/click passed,
  without context action, Undo entry or premature dismissal; capture is not stubbed.
- `test:nodes`, `test:refit`, `test:isolation`, `test:context-menu`, `test:paths`,
  `test:apps`, `test:history`, `test:gcode`, `i18n:check`, `build` (TypeScript + Vite),
  and `node node_modules/typescript/bin/tsc --noEmit`: all passed.
- Localization: zero missing keys/placeholder mismatches; two existing unused
  keys and three dynamic-translation warnings. Vite reports browser-externalization,
  mixed static/dynamic import and large-chunk warnings. On Windows, npm checks
  used `npm.cmd` because the shell blocks `npm.ps1`.

Independent upstream `73e75cb`/2.8.0. Native macOS/WKWebView, WebView2, other OS and
accessibility acceptance remain unverified. No native app, installer or hardware
was launched; no machine behavior, serialized project formats or dependencies changed.
Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**, including these
review fixes, regressions and documentation. Automated checks are not human review
or native-platform certification.
