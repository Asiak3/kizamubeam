# Add an icon-only camera overlay toggle to the main toolbar

Add camera-specific on/off SVGs to the actual main toolbar, not a text button appended to the menu bar. Include a checked View command and synchronized Camera-panel master checkbox. The session-only global gate hides workspace images/mosaics and head-camera outlines without changing individual camera visibility, acquisition, calibration, live timers, output or document data. Upgrade older toolbar layouts once while preserving customization; expose aria-pressed.

## Verification actually executed

`npm run test:camera-overlay` (actual Camera-panel/render-gate offline integration with denied acquisition/network/hardware boundaries) and real-toolbar Chromium (8 icon/state/migration checks).

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

- Focused command: `npm run test:camera-overlay`.
Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/toolbar-followup-browser-fixture.mjs overlay
node scripts/run-feature-browser.mjs artifacts/toolbar-browser runFeatureChecks
```

## Scope and limitations

Refs #145 (already closed by the maintainer; not reopened). Global-master semantics preserve individual show settings. New sessions default visible. Native real-camera/platform acceptance remains distinct from these tests; no acquisition or hardware used.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
