# Temporary selection isolation

Tools → Isolate selection restricts drawing, hit tests, selection and snapping to
the selected top-level objects. Newly created objects join the scope; existing
outsiders cannot be adopted by selecting them. Groups stay whole. Exit restores
the prior surviving selection; Escape, history restoration and page/tab/document
resets clear transient state. A visible badge explicitly says this is **not an
output filter**. Workspace image export temporarily removes the isolation view.

No persistent visibility, locking, output flags, serialization or generated
machine moves change. No nested isolation stack or group-child editor is added.
Normal selection-only job output remains independent. This branch does not add
context menus, vector fitting, Shape Builder or the other local prototypes.

Executed on this independent branch: `npm run test:isolation` (serialization/output,
selection/hits, snapping, adoption, restoration, resets, edit guards), `npm run
build`, `npm run i18n:check` (no missing keys). Actual-editor Chromium: 7 checks via
`node scripts/editor-feature-browser-fixture.mjs isolation`, serve its printed
directory and call `await window.runFeatureChecks()`.
Native WebView/cross-platform acceptance remains outstanding. No hardware.

Substantially generated/adapted and tested with **GPT 6.1 Sol (OpenAI) via OpenCode**.
Automated checks are not independent human review.
