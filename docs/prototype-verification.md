# Combined local editor prototypes — verification 2026-11-05

Baseline: upstream 2.7.0, `480d5b1`; local uncommitted `feat/vector-tools`.
No issue, PR or branch upload was made. These are prototypes, not accepted
upstream features or a packaged desktop release.

## Fresh executed checks

- `npm run test:vector`: 9 geometry + 16 editor cases passed.
- `npm run test:interaction`: 19 cases passed.
- Existing suites passed: `test:paths`, `test:corners`, `test:boolean`,
  `test:warp`, `test:history`, `test:params`, `test:sketch`, `test:relations`,
  `test:vecformats`, `test:gcode`, `test:lbrn`.
- `npm run i18n:check` and `npm run build`: passed; existing warnings remain.
- Regenerated both isolated browser fixtures from final source. Menu result:
  `{errors: [], ran: 1, closed: 4}`. Real editor result:
  `{errors: [], objects: 3, undo: 0}`.
- `git diff --check`: no whitespace errors (Windows line-ending warnings).

Logs: `artifacts/local-prototypes/`. Fixtures deny external/native/file boundaries
and never bootstrap the complete application. Browser checks cover menu keyboard,
focus and lifecycle plus actual editor rendering, hit-tests, region editing,
Undo and right-click selection. These are synthetic checks, not full acceptance.

## Remaining verification

Follow-up: a Windows x64 release build and NSIS packaging completed successfully.
Artifacts, log and hashes: `artifacts/windows-prototypes-20261105-231150/`.
Neither executable was launched or installed. The following limitations describe
the earlier automated prototype-check increment; native packaging is now built,
but full-app/manual acceptance remains outstanding. See also the
[manual checklist](prototype-manual-checks.de.md).

No full application startup, native EXE/installer build, physical-machine test,
Rust/backend test run or Linux package verification in this increment. Tab-reset
behavior follows the existing shared page-state reset path; dedicated full-app
tab/dialog/clipboard and cross-platform acceptance remain outstanding. Inspect
near-touching region geometry and native WebView accessibility/focus manually.

Three separate internal discussion drafts: [vector tools](issue-drafts/01-vector-tools.md),
[context menus](issue-drafts/02-context-menus.md), [isolation](issue-drafts/03-isolation.md).
Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**; not independent
human review. Linux packaging is performed separately by the requester.
