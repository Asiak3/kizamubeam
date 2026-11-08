# Give vector refitting and isolation distinct visible toolbar actions

Add distinct SVGs and visible default toolbar buttons for the already-merged refit and isolation tools. Isolation switches to a dedicated exit symbol and tooltip. Upgrade older layouts once without resetting custom action order, sizes, hidden bars or group preferences; subsequent deliberate removals stay removed.

## Verification actually executed

`npm run test:apps` including toolbar migrations, and actual-toolbar Chromium (8 checks for SVG visibility, custom order, registered refit handler, dynamic isolation icons and retained preferences).

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/toolbar-followup-browser-fixture.mjs toolbar
node scripts/run-feature-browser.mjs artifacts/toolbar-browser runFeatureChecks
```

## Scope and limitations

Independent against current main. Pencil includes its own icon/default entry in its separate PR, as does exterior contour; camera has its own icon/migration PR. Shape Builder is not yet upstream and is not smuggled into this toolbar-only PR. The combined local prototype can additionally expose that unpublished tool. Toolbar-version additions use distinct versions to permit the camera PR to merge separately; normal conflict resolution may still be needed in nearby UI code.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
