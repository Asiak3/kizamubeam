# Fix native image and SVG file drops through existing DOM import handlers

Enable native Tauri file drops and convert explicitly dropped native paths to in-memory File objects for the existing DOM workspace/library handlers. Apply DPI conversion, deduplicate paths, queue reads, reject invalid coordinates and suppress delivery after document/page context changes. Preserve internal non-file drags and clipboard behavior; block competing workspace edits/modal dialogs and prevent external file drops navigating away from the app.

## Verification actually executed

`npm run test:file-drop` (5 bridge checks: bytes/DPI, ignored drags, stale context, read recovery, disposal) and actual-editor Chromium (5 checks, including real SVG parsing/import and Undo plus image File delivery and library routing).

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

- Focused command: `npm run test:file-drop`.
Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/editor-followup-browser-fixture.mjs drop
node scripts/run-feature-browser.mjs artifacts/feature-browser runFeatureChecks
```

## Scope and limitations

No URL download. At most 100 unique paths and 256 MiB **after reading** (not a pre-read allocation limit). Full Explorer→WebView2 native drag and image decoder end-to-end acceptance remain unverified; native APIs are compiled but not exercised by a real OS drag here.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
