# Fix precision-touchpad pinch zoom without enabling page-zoom hotkeys

Share bounded Ctrl+wheel pinch sensitivity and a WebKit gesture fallback, preserving the pointer anchor and preventing duplicate wheel processing during an active gesture. Enable only WebView2 IsPinchZoomEnabled on Windows; leave browser zoom hotkeys disabled. Direct Windows COM dependencies already exist transitively; Cargo.lock only adds root dependency edges, without package upgrades.

## Verification actually executed

`npm run test:canvas-zoom` (5 cases), actual-editor Chromium (4 pointer-anchor/gesture/duplicate/Undo checks), and `cargo check --offline --locked -p kizamubeam` on Windows (passed, shared target directory).

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

- Focused command: `npm run test:canvas-zoom`.
Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/editor-followup-browser-fixture.mjs pinch
node scripts/run-feature-browser.mjs artifacts/feature-browser runFeatureChecks
```

## Scope and limitations

The requester confirms native Pinch-Zoom works in the combined Windows build, including its two canvases. This independent PR wires the upstream workspace canvas; the unpublished slot preview is deliberately not imported and continues to use the helper in the combined branch. Its wiring belongs with the future slot PR. No Linux/macOS native touchpad test or full native application startup by the agent.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
