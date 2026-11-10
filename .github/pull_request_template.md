<!--
Thanks for contributing to KizamuBeam! Please read CONTRIBUTING.md first.
Tick what applies and delete lines that do not apply to your change.
-->

## Summary

<!-- What does this PR change and why? Link related issues, e.g. "Fixes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Translation
- [ ] Documentation or website
- [ ] Refactoring / maintenance
- [ ] Virtual Machine (`vm/`)

## Screenshots

<!-- For UI changes, before/after screenshots help a lot. -->

## Tests

<!-- Which checks did you actually run, and with what result? If you could not run something, say so. -->

- [ ] `npm run build`
- [ ] `npm run i18n:check`
- [ ] Focused tests: <!-- e.g. npm run test:gcode -->
- [ ] Tested in the desktop app on: <!-- macOS / Windows / Linux -->

## Checklist

- [ ] The PR has one clear purpose; unrelated refactoring is kept separate.
- [ ] New or fixed behavior has a test where practical (`scripts/`).
- [ ] Test fixtures still work: editor fixtures built with `Object.create(Editor.prototype)` set any new `Editor` fields.
- [ ] New UI text uses `t('…')` / `tn(…)` and is added to `src/locales/en.json` (and other locales where possible).
- [ ] Undoable edits are recorded with `snapshot(t('…'))`.
- [ ] New user-facing features are listed in `docs/features.md`, `docs/features.de.md` and `docs/features.it.md`.
- [ ] Website texts are updated in `website/i18n/*.json` if needed, and `node website/build.mjs` still runs.
- [ ] Existing projects, settings and machine profiles stay compatible, or the change is explained.
- [ ] No version bumps (README, `package.json`, `Cargo.toml`, …) unless a maintainer asked for them.

## Machine safety

<!-- Only if you touched G-code, streaming, homing, limits, laser power, stop handling or firmware commands. -->

- [ ] This change affects machine control.
- What was tested in the Virtual Machine / on real hardware (model, firmware, connection):

## AI assistance

<!-- AI-assisted contributions are welcome. Please disclose meaningful involvement. -->

- [ ] This PR was written with AI assistance (tool: …), and I reviewed and understand the changes.
