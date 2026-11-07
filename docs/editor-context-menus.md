# Context-aware editor menus

Right-click menus reuse existing editor commands for vectors, images, nodes and
blank canvas. An already-selected object keeps multi-selection; clicking another
editable object selects it. Existing right-click draft completion and active
sketch/pick gestures take precedence. Unavailable actions are disabled.

The menu captures keyboard input while open, supports arrow/submenu navigation,
stays in the viewport and restores focus. Escape/outside click, external scroll
or editor changes close it and remove listeners. Stale-document callbacks and
open modal dialogs block execution. Shared command bindings drive shortcut labels
and matching; no customizable-keybinding UI is introduced.

Independent scope for issue #144: no Shape Builder, isolation or refit commands
are exposed until those separate features exist upstream. Existing menus/toolbars,
project formats and machine-command semantics are preserved. `laser.ts` only
routes its preview shortcut through the shared matcher.

Executed: `npm run test:context-menu`, `npm run build`, `npm run i18n:check`
(no missing keys). Browser lifecycle/keyboard/focus checks passed using
`node scripts/context-menu-browser-fixture.mjs`, loopback serving and
`window.runContextMenuChecks()`. Native WebView/accessibility and macOS/Linux
acceptance remain outstanding. No hardware or full application startup.

Substantially generated/adapted and tested with **GPT 6.1 Sol (OpenAI) via OpenCode**.
Automated checks are not independent human review.
