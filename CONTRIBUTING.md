# Contributing to KizamuBeam

Thank you for helping improve KizamuBeam! Contributions of all sizes are welcome: bug reports, testing on real machines, documentation, translations, design improvements, and code.

KizamuBeam is free software under **GPL-3.0-or-later**. It is maintained as a community project, and thoughtful, focused contributions are especially appreciated.

Want to translate the app, the website or the documentation? See **[TRANSLATION.md](TRANSLATION.md)**, no programming needed.

## Before you start

- Check existing [issues](https://github.com/negurvulkan/kizamubeam/issues) and [pull requests](https://github.com/negurvulkan/kizamubeam/pulls) to avoid duplicating work.
- For a substantial feature, new dependency, major refactor, or change to supported hardware or file formats, please open an issue first to discuss the approach.
- Small, self-contained fixes can be submitted directly as pull requests.
- Be respectful and constructive. Different experience levels and development workflows are welcome.

## Reporting a bug

Please include as much of the following as you can:

- KizamuBeam version, operating system, and steps to reproduce the problem.
- Expected behavior versus actual behavior.
- A minimal sample project or file, if you can share one, and screenshots or relevant logs.
- For machine issues: controller model, firmware and version, connection type (USB/network), and relevant *non-sensitive* configuration details.
- Whether the same operation works in another application, if known.

**Safety first:** If the laser head moves unexpectedly, homing fails, or a job behaves incorrectly, stop testing on physical hardware. Do not repeat a potentially dangerous movement just to collect a log. Never share Wi-Fi passwords, access tokens, or other secrets. Remove personal information from uploaded projects and logs.

## Development setup

Requirements: **Node.js 20+**, npm, and **stable Rust**. Building the desktop app requires the platform-specific [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/negurvulkan/kizamubeam.git
cd kizamubeam
npm ci
npm run tauri dev    # Desktop app with live reload
# or: npm run dev    # Browser UI only (not all native features)
```

The repository also contains **KizamuBeam Virtual Machine**, an independently usable application under `vm/`. It shares the root Node.js dependencies but has its own Tauri/Rust application and release process.

```bash
npm run vm           # Virtual Machine development mode
npm run vm:headless  # Virtual controller without the GUI
```

For a directory map and build details, see [the developer guide](docs/development.md). Coding agents should also follow [AGENTS.md](AGENTS.md).

## Tests and quality checks

At minimum, run the checks relevant to your change and describe the results in your pull request. In particular:

```bash
npm run build          # TypeScript check and Vite build
npm run i18n:check     # Translation consistency
npm run test:gcode     # Job generation and machine output
npm run test:nest      # Automatic nesting
npm run test:generators
npm run test:3d
npm run test:core      # Includes Rust core tests
npm run test:vm        # VM tests, including Rust controller tests
```

There are many more focused `test:*` commands in `package.json`; select the tests that cover the files and behavior you changed. Add a regression test for bug fixes wherever practical. If you cannot run a test, say so rather than claiming it passed.

Changes to G-code, streaming, homing, limits, laser power, emergency handling, firmware commands, or the virtual controller need particularly careful review. Simulator tests help but **do not prove that an operation is safe on real hardware**. Never require physical machine testing as an undocumented or automatic step.

## Code and compatibility

- Follow the existing conventions and avoid unrelated formatting or architectural changes.
- The main UI uses **TypeScript and native DOM APIs**, without React or Vue. Please do not add a UI framework or reorganize the application without prior discussion.
- Keep geometry, document/model logic, UI, and device transport responsibilities clear. Prefer small, understandable changes.
- Preserve compatibility with existing projects, settings, machine profiles, templates, packs, and file formats. Changes to serialization or migrations should include tests and a clear compatibility plan.
- User-facing UI strings are written in German using `t('…')` or `tn(…)`, with translations in `src/locales/`. See [translation instructions](docs/development.md#translations). Check localization whenever you add or change strings.
- Avoid introducing new dependencies without a clear reason; mention additions and licensing implications in the PR.
- For changes to the independent Virtual Machine, keep its behavior and release versioning separate from the main application.

## AI-assisted contributions

**AI-assisted contributions are welcome.** You may use Claude Code, Codex, OpenCode, or other tools. Please disclose meaningful AI involvement in the pull request description, including which parts were generated or substantially edited when practical.

The person submitting the PR remains responsible for reviewing the changes, understanding their intended behavior, checking licensing and attribution, and reporting which tests were *actually* run. Automated AI reviews and AI-generated test reports are not a substitute for human review. Please do not add generated code that you cannot explain or maintain.

## Pull request checklist

Before submitting a PR, please check that:

- [ ] The PR has one clear purpose, with a description of the problem and solution.
- [ ] Changes are limited to the relevant files; unrelated refactoring is kept separate.
- [ ] Relevant tests were run, and the results are included in the description.
- [ ] New behavior or fixed bugs have tests where practical.
- [ ] UI text and translations have been checked where applicable.
- [ ] Existing projects and machine configurations remain compatible, or any intentional change is explained.
- [ ] Hardware-related risks and test limitations are explicitly described.
- [ ] AI involvement, new dependencies, and attribution requirements are disclosed when applicable.
- [ ] Documentation is updated if the user-facing behavior changes.

A PR can be useful even if it is not ready to merge. Feel free to mark it as a draft and explain what still needs work. Maintainers may request changes, defer an idea, or decline a PR to keep the project coherent.

Thank you for contributing!

## Credits

Every kind of contribution is credited, not only code. The [Contributors section of the README](README.md#contributors) is maintained with [all-contributors](https://allcontributors.org) and also lists translations, testing on real machines, bug reports and ideas.

- Maintainers add people by commenting on an issue or pull request, for example `@all-contributors please add @name for code, translation`. The bot then opens a pull request that updates `.all-contributorsrc` and all three READMEs. The available types are listed in the [emoji key](https://allcontributors.org/docs/en/emoji-key).
- If you contributed and are missing from the list, just ask in your issue or pull request, or on Discord.
- Release notes thank contributors by GitHub handle (for example “Thanks to @name for …”). GitHub's “Generate release notes” groups merged pull requests using `.github/release.yml` and adds a “New Contributors” section for first-time contributors.

Contributors who only test or report on Discord can also be added; tell us which GitHub handle (or name) you would like to be credited with.
