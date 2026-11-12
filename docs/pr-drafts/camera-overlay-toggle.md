# Draft: Add a global camera-overlay visibility toggle

**Update 07.11.:** [PR #174](https://github.com/negurvulkan/kizamubeam/pull/174)
veröffentlicht gegen Upstream 2.8.0 (`73e75cb`). Kamera-Overlay ist jetzt ein
Symbolknopf in der tatsächlichen Haupttoolbar mit separaten Ein/Aus-SVGs,
Aktivzustand und `aria-pressed`; der frühere Textknopf in der Menüzeile entfällt.
Ältere Toolbar-Belegungen erhalten ihn einmal ohne Reset. Offline-Kameragate,
8 Toolbar-Browserchecks, Apps/History/G-code/i18n/Build bestanden. #145 war
bereits geschlossen und enthält nun den PR-Verweis. Folgender Entwurf ist historisch.

Related: https://github.com/negurvulkan/kizamubeam/issues/145

## Summary

- Add an always-available **Camera overlays** button in the upper menu bar, with a visible active state and `aria-pressed`.
- Add a checked **View → Show all camera overlays** command and the same action in customizable toolbars (View category).
- Add a synchronized **Show all camera overlays** master checkbox in the Camera tab, separate from the existing per-camera **Show on workspace** checkbox.
- Gate only workspace rendering: both camera images/mosaics and head-camera field-of-view outlines disappear together. Restoring visibility reuses existing images, subject to the existing per-camera/calibration/readiness checks.

## Explicit global semantics

This chooses the global-master option discussed in #145 rather than changing the selected camera's persisted `show` value. The new master checkbox, top button, menu and customizable action share one state. The original checkbox continues to select whether that individual camera participates. Switching the master on does not enable individually hidden cameras or guarantee that a valid image is available.

The master defaults to **on** for every application session. It is not serialized into projects, camera settings, device settings or toolbar configuration, and it remains global when changing the current device within a session. Existing customized toolbar layouts are not migrated or overwritten; the fixed menu-bar button remains available, and users can optionally add the customizable action to either toolbar.

No camera connect/disconnect, frame acquisition, image update, live timer change, calibration change, machine command, motion, laser output or document mutation is triggered by the master. Existing live previews/acquisition continue while workspace overlays are hidden. Inserted image objects and output data are unaffected.

## Isolated scope / integration note

Intended feature files:

- `src/cameraOverlayVisibility.ts`
- Minimal overlay-only hunks in `src/cameraui.ts` and `src/ui.ts`
- `scripts/camera-overlay-toggle-test.mjs`
- This draft and the three locale entries below (locale edits delegated to parent)

The working tree contains other unpublished work, including pre-existing edits in `src/ui.ts` and slot-placement files. Do not include those unrelated changes in this PR. This draft does not claim that an isolated upstream checkout compiles, nor that a PR has been published. No commits, pushes or PR publication were performed for this task.

## Actual automated checks

- Latest combined feature-tool Windows build passed:
  `artifacts/windows-slot-features-20261106-222649/`. Overlay/camera offline suites,
  build and i18n rerun successfully; source hashes rechecked. Not launched or
  installed. This remains a mixed prototype build, not an isolated overlay PR.

- **Passed:** `node scripts/camera-overlay-toggle-test.mjs` — actual Camera-tab integration with offline mocks, default/shared master state, per-camera checkbox independence, render early return, fixed/head-camera overlay restoration, individually hidden camera preservation, current-device gate, unchanged storage/timers, redraw/tool notification, forbidden acquisition/network/machine boundaries; source assertions for menu/top/customizable wiring.
- **Passed:** `node scripts/camera-ui-offline-test.mjs` — existing offline Camera UI regression suite.
- **Passed:** `node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --skipLibCheck src/cameraOverlayVisibility.ts` — isolated gate typecheck.
- **Passed:** `git diff --check -- src/cameraui.ts src/ui.ts src/cameraOverlayVisibility.ts scripts/camera-overlay-toggle-test.mjs docs/pr-drafts/camera-overlay-toggle.md` (Git emits only LF/CRLF conversion warnings).
- **Passed after integration:** root `npm run build` (including TypeScript), `npm run i18n:check`, `npm run test:camera`, `npm run test:camera-overlay`; translations below integrated. The initial narrowing/translation blockers found by the subagent are resolved in the mixed local checkout.
- Combined Windows EXE/NSIS packaging succeeded: `artifacts/windows-projection-overlay-20261106-165125/`; not launched or installed. This is not yet an isolated upstream PR build.

## Translation handoff

Integrated German source keys in `src/locales/en.json`:

```json
{
  "Alle Kameraüberlagerungen anzeigen": "Show all camera overlays",
  "Kameraüberlagerungen": "Camera overlays",
  "Kameraüberlagerungen global ausgeblendet. Die Auswahl je Kamera und laufende Aktualisierungen bleiben unverändert.": "Camera overlays are globally hidden. Individual camera selections and ongoing updates remain unchanged."
}
```

## Manual checks — pending, not claimed as completed

- [ ] With synthetic/preloaded imagery and no hardware connection, verify top-button sizing/placement at supported window sizes and in both themes.
- [ ] Toggle from top button, View menu, Camera master checkbox and a customized toolbar; verify active/checked states agree.
- [ ] With multiple synthetic cameras, including a head-camera mosaic, hide/restore overlays and confirm individually hidden cameras stay hidden.
- [ ] Switch current device while hidden; verify all workspace overlays stay hidden and the Camera master checkbox remains off.
- [ ] Verify preview remains unchanged, reload restores master-on default, and invalid/missing calibration does not become usable through the toggle.
- [ ] Run full build/localization checks after isolating/integrating the PR.

No browser visual, native desktop, real-camera or physical-machine test was performed. Simulated checks are not hardware certification.

## AI assistance

Implementation, focused tests and this PR draft were substantially assisted by **GPT 6.1 Sol (OpenAI) via OpenCode**. Human review and the remaining manual checks are still required.
