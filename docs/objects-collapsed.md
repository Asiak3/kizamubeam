# Start Objects-panel layers collapsed while retaining manual expansion

Initialize palette layers collapsed in the Objects tree. Groups already start collapsed. Retain the existing in-memory toggle sets so manual layer/group expansion survives document and selection refreshes, and newly encountered layers start collapsed. No serialized preference or restart-persistence change.

## Verification actually executed

Actual Objects-panel Chromium: 6 checks for layer/group defaults, document refresh, new layers and retained manual group expansion on reopening its layer. Dock visibility and unrelated Show-if dialog boundaries are test doubles.

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/editor-followup-browser-fixture.mjs objects
node scripts/run-feature-browser.mjs artifacts/feature-browser runFeatureChecks
```

## Scope and limitations

This is the Objects tree, not the cut/layer settings list. No geometry, hierarchy, output or durable project-data edits.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
