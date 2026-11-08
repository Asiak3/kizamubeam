# Add exterior contours with selectable interior holes and workspace preview

Create an independent exterior path with optional interior holes selected on the workspace or by checkboxes. Provide a movable nonmodal tool window, dashed workspace preview, explicit 0–0.5 mm joining tolerance, target layer and keep-originals default. Confirm destructive replacement and preserve exact source definitions through Undo. Support planar networks including T-junctions and crossings; retain disconnected islands instead of adding artificial bridges.

## Verification actually executed

`npm run test:outline` (24 geometry/editor cases) and actual-editor Chromium (31 checks for hole picking, preview, tolerance, Apply/Cancel, replacement confirmation, Undo and cleanup).

All seven independently extracted branches ran `test:apps`, `test:history`, `test:gcode`, `i18n:check` (zero missing translations) and `build`. Existing bundler/i18n warnings remain. Browser tests use isolated fixtures, never app bootstrap or machine/camera acquisition.

- Focused command: `npm run test:outline`.
Browser reproduction (Node with WebSocket support and Chromium installed; use BROWSER_BIN if needed):

```sh
node scripts/editor-followup-browser-fixture.mjs outline
node scripts/run-feature-browser.mjs artifacts/feature-browser runFeatureChecks
```

## Scope and limitations

Closes #147 on merge. Curves are approximated and work budgets enforced; inspect tiny gaps/tangencies. Disabled source output conservatively disables the result. No source ownership modifier/contour-offset, Shape Builder or slot tool is included. **Draft gate: provenance/licensing audit remains open.** The earlier issue discussion described VectorCraft code reuse; this TypeScript/Clipper extraction is substantially AI-assisted, but a complete original-source attribution audit has not been established. Do not treat language differences as proof of independent reimplementation. Before merge, identify any adapted/copied portions and retain their original copyright, MIT/Apache license and NOTICE files, or establish independent provenance. No attribution is fabricated here.

Each branch starts from upstream main `73e75cb` (upstream version 2.8.0, not a version bump by this contribution). Other local prototypes, machine commands and project-format changes are excluded. These independent PRs touch nearby UI/editor/toolbar lines; merge conflict resolution and integration regression checks may be needed. No physical machine tests.

## AI disclosure

Substantial implementation/extraction/tests/documentation assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. Automated checks are not independent human review.
