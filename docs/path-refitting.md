# Whole-path simplification / curve refitting

Use Tools → Simplify / smooth paths after selecting supported paths or primitives.
World-mm tolerance, cubic versus line fitting and sharp-corner protection are
explicit. The orange dashed preview leaves originals untouched until Apply;
Cancel clears it. Apply preserves object identity, matrix, metadata, subpaths,
closure and explicit starts where applicable, with one Undo step. A no-op does
not add history. Changed sources invalidate the preview.

The implementation bounds fitting work/samples and rejects invalid/excessive
input instead of silently truncating. This is whole-path refitting, not a separate
smoothing brush or partial-run editor. Topology around tight gaps/intersections
is not certified by a deviation bound. Inspect the preview before applying.
Text/generators/groups require explicit conversion/ungrouping. No Pencil tool,
machine-command, dependency or project-format changes are included.

Executed on this independent branch: `npm run test:refit` (9 geometry + 3 editor
cases), `npm run build`, `npm run i18n:check` (no missing keys). Actual-editor
Chromium: 5 checks via `node scripts/editor-feature-browser-fixture.mjs refit`,
serve its printed directory and call `await window.runFeatureChecks()`.
Native WebView/cross-platform acceptance remains outstanding. No hardware.

Substantially generated/adapted and tested with **GPT 6.1 Sol (OpenAI) via OpenCode**.
Automated checks are not independent human review.
