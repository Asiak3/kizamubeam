# Add fitted freehand Pencil drawing with transactional pointer handling

Add a freehand Pencil tool using the existing bounded refitter, explicit closure/tolerance options, a dedicated SVG and a default toolbar entry. Preserve one-step Undo/Redo, cancellation, sample/work limits and active-pointer ownership. Show success/no-result feedback. Freehand is deliberately unsnapped; no partial-redraw or pressure appearance is added.

## Verification actually executed

`npm run test:pencil` (5 regressions) and actual-editor Chromium with trusted mouse events (6 checks: release, one Undo, capture release, feedback, Undo/Redo).

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

- Focused command: `npm run test:pencil`.
Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/editor-followup-browser-fixture.mjs pencil
node scripts/run-feature-browser.mjs artifacts/feature-browser preparePencilCheck
```

## Scope and limitations

The requester confirms the reported Pencil workflow now works as expected in the combined Windows test build. That is user acceptance of that workflow, not universal platform certification.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
