# Developer guide

English · [Deutsch](development.de.md) · [Back to the README](../README.md)

For font-size groups, CSS/Canvas integration and settings previews, see [UI typography](ui-typography.md).

## Building

Requirements: Node.js 20+, Rust (stable), on Linux also `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`
(see https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # desktop app with live reload
npm run dev            # UI only, in the browser: http://localhost:1420
npm run tauri build    # installer package
```

On Windows, `npm run tauri build` only builds the NSIS installer (`.exe`, see `src-tauri/tauri.windows.conf.json`), because the MSI installer does not accept pre-release versions such as `1.2.0-beta`. This stays the same for stable versions: a second installer could create a second, separate installation, and beta versions would no longer build. On Linux it builds AppImage and .deb; RPM does not accept a hyphen in the version (see `src-tauri/tauri.linux.conf.json`), so the release workflow builds the .rpm only for stable versions such as `2.2.0`.

On Windows the main window also has native drag and drop turned off (`dragDropEnabled: false` in `src-tauri/tauri.windows.conf.json`). With it on, WebView2 blocks HTML5 drag and drop inside the page, so rows in the Objects window, library items, toolbar buttons and tabs could not be dragged (#258). Files dropped from Explorer then arrive through the browser's own `drop` event (`installDomFileDrop` in `src/nativeFileDrop.ts`). The platform file replaces the whole `app.windows` list, so keep its window entry in sync with `tauri.conf.json`.

Releases: publishing a release on GitHub (Releases → Draft a new release → new tag → Publish release) runs `.github/workflows/release.yml`, which builds the installers for macOS (universal, Apple Silicon and Intel), Windows (NSIS) and Linux (AppImage, .deb, plus .rpm for stable versions) and attaches them to that release. An already published release can be built with Actions → Release → Run workflow. The builds are not code-signed yet, so macOS and Windows show a warning on first launch.

Updates: Help → Check for Updates looks for a newer release on GitHub (channel Stable, or Nightly including nightly builds and release candidates; by default once a day at startup; a stored former Beta channel counts as Stable), verifies its signature and installs it. This needs an updater key pair (`npx tauri signer generate -w ~/.tauri/kizamubeam.key`): the private key as repository secret `TAURI_SIGNING_PRIVATE_KEY` (and its password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), the public key as repository variable `TAURI_UPDATER_PUBKEY`. Builds without the key cannot update themselves. On Linux, updating works for the AppImage.

Nightly builds: `.github/workflows/nightly.yml` runs once a night. If `main` has new commits since the last nightly and the CI workflow is green on them, it creates a pre-release `v<next>-nightly.<YYYYMMDD>.<run>` (`<next>` = next minor version after a stable version, e.g. 2.8.0 → 2.9.0-nightly.…). While the repository version is a release candidate, the nightly continues it instead, e.g. 2.9.0-rc.1 → `v2.9.0-rc.1.nightly.<YYYYMMDD>.<run>`, so it sorts after that RC and before the next RC or the stable version. The nightly is built with `release.yml`, which writes that version into `package.json` and `tauri.conf.json` for the build only. A nightly whose build fails is deleted, and only the newest 7 are kept. There are no regular beta releases any more; before a stable release, tag a release candidate such as `v2.9.0-rc.1`, which reaches the Nightly channel. Manual run: Actions → Nightly → Run workflow (“force” builds even without new commits).

Virtual Machine: the virtual laser machine is a separate Tauri program in the `vm/` folder (UI in `vm/src/`, Rust in `vm/src-tauri/`, the controller without UI in `vm/src-tauri/core/`, crate `kizamubeam-vm-core`). It uses the packages from the main folder. `npm run vm` starts it with live reload (port 1421, KizamuBeam uses 1420), `npm run vm:build` builds the installer, `npm run vm:headless` runs it without a window (`-- --help` lists the options), `npm run test:vm` tests the controller. VM releases have their own tags `vm-v0.1.0` (version from `vm/src-tauri/tauri.conf.json`) and are published as pre-releases so they never count as the latest release on GitHub; `.github/workflows/vm-release.yml` builds them, `release.yml` skips them, and KizamuBeam’s update check only considers tags starting with `v` and a digit.

## Translations

The step-by-step guide for translators (app, website, README, feature list) is [TRANSLATION.md](../TRANSLATION.md). The technical details:

UI texts are written in German in the code inside `t('…')` (placeholders in curly braces, `t('{n} Bilder', { n })`; singular/plural with `tn('{n} Bild', '{n} Bilder', n)`). Every text that shows a count uses `tn()`; the form follows the plural rules of the shown language (`Intl.PluralRules`), so the translation of the singular is that language's "one" form (in French also 0). If the German singular and plural read the same, the singular gets the context `|one`: `tn('{n} Fehler|one', '{n} Fehler', n)`. Languages with more forms add them to their file as `"<plural text>|few"`, `|many`, `|two` or `|zero`; missing ones fall back to the plural. `npm run i18n:check` reports `tn()` calls with identical keys. The German text is also the key in the language files `src/locales/<language>.json`. If a translation is missing, the English text is shown, otherwise the German one. If the same German text has two meanings, it gets a context after `|`, e.g. `t('Verbindung|Gerät')`.

- `npm run i18n:check` lists missing, unused and misplaced entries (fails if anything is missing).
- `npm run i18n:check -- --write` adds new texts with an empty value and removes unused ones; afterwards only the empty values need translating.
- New language: create `src/locales/fr.json` (e.g. a copy of `en.json` with empty values). Nothing else needs registering: the app finds every file in `src/locales/` on its own, the file name is the language code (`fr`, `pt-BR`), and the name in View → Language, the number and date formats and the decimal separator come from the browser's `Intl`. The system language picks the file automatically. `npm run i18n:check` also checks that the file name is a valid language code. The Virtual Machine shares the list; its own texts are only translated to English, which other languages get as well.
- Messages from the Rust side are in German and are translated in `src/i18n.ts` (`tBackend`).

## Structure

| File | Contents |
|---|---|
| `src/model.ts` | Data model: document, objects, layers, matrices, palette |
| `src/geom.ts` | Shapes as Bézier paths, bounding boxes, text layout, hit testing, SVG paths |
| `src/editor.ts` | Editor class: state, view, selection, tool choice; pulls in the parts below |
| `src/editor/*.ts` | Editor parts: `document` (undo, autosave, pages), `pointer` (mouse input), `keyboard`, `snapping`, `nodes`, `paths` (path tools), `shapeops` (convert, booleans, offset, arrays), `joints`, `hinges`, `generators` (parametric parts), `nest` (nesting), `check` (design check), `params` (project parameters, templates), `series` (series from a table), `commands`, `objects`, `text` (QR, variable text, text on path, text boxes), `imageops` (images, import, trace), `render` (drawing the workspace) |
| `src/ui.ts` | Menu, toolbar actions, numeric edits toolbar, layer window, palette, status bar, text input |
| `src/storageMigration.ts` | Copies settings saved under the old name (`laserwerk.*`) to `kizamubeam.*` on first start |
| `src/dock.ts` | Dockable windows: tabs, groups, floating windows, sizing, show/hide, saved layout |
| `src/apps.ts`, `src/appsPanel.ts` | Toolbox: tiles with groups, descriptions and keywords, search; window with filters and groups |
| `src/toolbars.ts` | Customizable toolbars: actions, contents, icon size, customize dialog, show/hide bars |
| `src/layerdialog.ts` | Cut settings (kerf, tabs, fill, air assist, perforation, lead-in, power ramp, Z, sub-layers) |
| `src/fonts.ts` | Load font files (system fonts via Rust, fallback font) and convert text to Bézier paths (opentype.js) |
| `src/fontCatalog.ts`, `src/fontManager.ts`, `src-tauri/src/fonts.rs` | Font manager: read and search the Google Fonts list, favorites, missing fonts in projects; Fonts window; download, import and remove fonts in the app folder (`npm run test:fonts`) |
| `src/vartext.ts` | Variable text: placeholders, CSV import, auto-advance |
| `src/params.ts`, `src/paramsPanel.ts` | Project parameters: formulas, `{…}` placeholders, renaming; “Parameters” window |
| `src/templates.ts`, `src/templateDialogs.ts`, `src-tauri/src/templates.rs` | Templates: `.kzt` format, templates folder, dialogs for saving, choosing and filling in, series from a table |
| `src/builtinTemplates.ts` | Included templates (key fob, name tag, labelled box), built in code |
| `src/packs.ts`, `src/packsDialog.ts`, `src-tauri/src/packs.rs` | Extensions: `.kzp` format and checks, packs folder, Extensions window |
| `src/assetFormat.ts`, `src/assetLibrary.ts`, `src/libraryPanel.ts`, `src/editor/library.ts`, `src-tauri/src/library.rs` | Library: `.kza` format and checks, search, library folder, Library window, saving and inserting items |
| `src/builtinLibrary.ts`, `src/builtinFormat.ts`, `src/library/builtin.json`, `scripts/build-library.ts`, `scripts/library/` | Built-in library: 400 motifs and design elements, compact path data, groups, drawing kit and sources |
| `src/catalog.ts`, `packs/`, `scripts/build-catalog.ts`, `scripts/sign-catalog.mjs` | Signed catalogue of extension packs, published with the website |
| `src/barcode.ts`, `src/qrDialog.ts` | QR codes (qrcode-generator, MIT) and barcodes as closed outlines; “QR Code” and “Variable Text” dialogs |
| `src/barcode1d.ts`, `src/barcodeDialog.ts` | Barcodes: Code 128, EAN-13, EAN-8, UPC-A, Code 39, ITF as bar widths; “Barcode” dialog |
| `src/textpath.ts` | Text on a path: arc length, placing glyphs along the curve |
| `src/clip.ts`, `src/curves.ts` | Clipper bindings (flattening, curve refitting, welding letters) and Bézier basics |
| `src/ops.ts` | Boolean operations and offset (Clipper) |
| `src/pathtools.ts` | Path tools: close, auto-join, break apart, start point, intersections and trimming (exact Bézier splitting). Tests: `npm run test:paths` |
| `src/corners.ts` | Corner tool: round, inverse-round or chamfer individual corners. Tests: `npm run test:corners` |
| `src/snap.ts` | Snapping: object snap (node, midpoint, center, intersection, line) and alignment guides |
| `src/arrays.ts`, `src/arrayDialogs.ts` | Grid and circular arrays with dialogs and live preview |
| `src/nest.ts`, `src/nestDialog.ts`, `src/editor/nest.ts` | Nesting: raster search with real outlines (core), dialog, grouping parts and applying the result |
| `src/check.ts`, `src/checkPanel.ts`, `src/editor/check.ts` | Design check: the checks (core, no DOM), the Design Check window, selecting findings and applying fixes |
| `src/hinges.ts`, `src/hingeDialog.ts` | Living hinges: patterns and dialog |
| `src/pattern.ts`, `src/patternFormat.ts`, `src/patternLibrary.ts`, `src/patternDialog.ts`, `src/editor/pattern.ts` | Pattern fill: tile repeat, clipping and dedupe, recipe format, built-in patterns, dialog and editor commands |
| `src/generators/` | Parametric parts: common interface (`types.ts`: parameter schema, validation, geometry), registry (`index.ts`, `register()`), opening with declared inputs (`run.ts`), dialog built from the schema, Bézier helpers, spur gear (`gear.ts`), rack (`rack.ts`), timing pulley (`pulley.ts`), cam (`cam.ts`), gear pair (`gearpair.ts`), shared bores (`bore.ts`), finger-jointed box (`box.ts`), drawer (`drawer.ts`), insert (`insert.ts`), slot-together shelf (`shelf.ts`), disc sphere (`discsphere.ts`), layered model from a 3D model (`stack.ts`), rib model (`ribs.ts`) |
| `src/model3d/` | 3D models: read STL/OBJ, weld and store compactly (`mesh.ts`), model store with autosave (`store.ts`), cross-sections, regions and deepest point (`slice.ts`) |
| `src/view3d/` | 3D view: position of the assembly parts in space (`poses.ts`), plates and intersection check (`solids.ts`), assembling parts joined with the joint tool (`mates.ts`), engravings on the surfaces (`engrave.ts`), material looks and generated textures (`looks.ts`, picker `lookui.ts`), the window (`panel.ts`) and the drawing with three.js (MIT, `viewer.ts`, loaded only when the window opens) |
| `src/joints.ts`, `src/jointDialog.ts` | Joints: finger joints, tab-and-slot, cross-lap, snap-fit, hook, wedge and T-slot joints, lid hinge with pin. Tests: `npm run test:joints` |
| `src/images.ts` | Image data (outside undo, backed up in IndexedDB), image processing and dithering, result cache |
| `src/imagePresets.ts` | Image presets (adjustments and image mode) in local storage |
| `src/trace.ts` | Trace image: marching squares, simplification, curve fitting |
| `src/centerline.ts` | Trace centerlines: Zhang-Suen thinning, skeleton graph, spur pruning, joining at crossings. Tests: `npm run test:centerline` |
| `src/importers.ts` | SVG and DXF import |
| `src/pdfimport.ts` | PDF and Illustrator (`.ai`) import: own PDF reader (cross references, object streams, filters, paths, images) |
| `src/pdffonts.ts` | Font programs from PDF files (TrueType, CFF, Type 1) as outlines for the PDF import |
| `src/pdfcrypt.ts` | Decryption of edit-protected PDFs (MD5, RC4, AES, SHA-2) |
| `src/vecexport.ts` | DXF, PDF and Illustrator (`.ai`) export |
| `src/lbrn.ts` | Reading LightBurn projects (`.lbrn2`) |
| `src/fit.ts` | Curve refitting: polylines to Bézier paths (corner detection, Schneider’s algorithm) |
| `src/gcode.ts` | Machine output: job from the document (line, fill, images, order), G-code, runtime estimate, frame, Start Here, start/end scripts, device settings. Tests: `npm run test:gcode` |
| `src/camera.ts` | Camera: access, calibration model (homography and radial distortion, Levenberg-Marquardt), undistortion onto the bed |
| `src/cameraui.ts` | Camera tab, camera image on the workspace, calibration wizard with markers |
| `src/workpieces.ts`, `src/workpieceDialog.ts` | Place on workpieces: separating workpieces in the camera image, outlines, rotation by shape comparison (core), dialog with preview |
| `src/materials.ts`, `src/materialui.ts` | Material library, `.kzm` export/import, reading LightBurn `.clb`, “Material” tab |
| `src/fitcheck.ts`, `src/calibrate.ts`, `src/calibrateDialog.ts` | Fit of joints (check, proposals for generators and the joint tool), fit calibration: test parts and evaluation (core, no DOM) and its dialog |
| `src/slots.ts`, `src/slotDialog.ts` | Resize slots: detect slots and widen/narrow them (core, no DOM) and its dialog |
| `src/materialtest.ts` | Material test: grid with stepped values and its own test layers |
| `src/testphoto.ts`, `src/testphotoDialog.ts` | Evaluate a material test from a photo: grid alignment by four corners, cell picking, darkening measurement (`npm run test:testphoto`) |
| `src/focustest.ts`, `src/focustestDialog.ts` | Focus test: ramp on tilted material or Z series with one layer per Z offset (`npm run test:focus`) |
| `src/printcut.ts`, `src/printcutDialog.ts` | Print and Cut: registration marks, fit from 2–3 measured marks (rigid, similar, affine), laser dot (`npm run test:printcut`) |
| `src/generators/jig.ts`, `src/generators/jigPanel.ts`, `src/jigUse.ts`, `src/jigFillDialog.ts` | Jig generator: outlines from selection, image or camera, cut-outs with clearance and notches, slot layout, numbers and registration marks (`npm run test:jig`) |
| `src/objectsPanel.ts` | Objects window: pages, layers and objects as a tree |
| `src/history.ts`, `src/historyPanel.ts` | Undo history with named steps, History window |
| `src/agent.ts`, `src/agentedit.ts`, `src/agentmachine.ts`, `src/agentutil.ts`, `src/agentui.ts` | Tools for AI agents (MCP) by level, safety rules of the machine level, settings dialog |
| `src/remote.ts`, `src/remoteHost.ts`, `src/remoteBundle.ts` | Controlling a laser through another KizamuBeam: pairing, job bundles and taking over device/materials/cameras on the client, host mode, job computation, job list and camera sharing (`sharedCameras`/`sharedCameraJpeg` in `src/cameraui.ts`) on the host. Tests: `npm run test:remote` |
| `src/machine.ts` | Machine connection from the UI’s side: state, status parsing, plain-language alarms, commands to Rust |
| `src/laser.ts` | Laser, Move and Console windows, device settings, preview |
| `src/fluidnc.ts`, `src/fluidncDialog.ts` | FluidNC and GRBL family: overrides, files on SD card/flash, configuration with backups, outputs and coolant, network search. Tests: `npm run test:fluidnc` |
| `src/setup.ts`, `src/setupWizard.ts` | Laser Setup wizard: detect firmware, read and check settings, suggestions, test job. Tests: `npm run test:setup` |
| `src/dom.ts` | DOM helpers and numeric fields with formulas |
| `src/i18n.ts`, `src/locales/` | Localization: `t()`, language selection, English language file |
| `src/files.ts` | Open/save/import (Tauri dialogs or browser), drag and paste, SVG/DXF/PDF/AI export, save processed bitmap |
| `src-tauri/` | Rust shell: native file dialogs, reading/writing files, list and files of the system fonts (fontdb) |
| `src-tauri/src/stream.rs` | G-code streaming with character counting, status queries, hold/reset (with tests: `cargo test`) |
| `src-tauri/src/machine.rs` | Serial (serialport), Telnet (TCP) and WebSocket, events to the window |
| `src-tauri/src/ws.rs` | WebSocket to the controller (tungstenite) as a byte stream for streaming, with a test against a simulated FluidNC |
| `src-tauri/src/fluid.rs` | FluidNC web interface over plain HTTP: upload to SD card/flash, search on the local network (with tests against a simulated web interface) |
| `src-tauri/src/agent.rs` | MCP server (Streamable HTTP on 127.0.0.1, token, levels) and stdio bridge `--mcp-stdio` |
| `src-tauri/src/remote.rs` | Remote KizamuBeam transport: TLS server/client with pinned self-signed certificate, JSON lines, pairing code (HMAC over the fingerprint), per-client keys and roles; forwards machine events to clients |
| `src-tauri/core/` | Computation core without UI (`kizamubeam-core`): image processing and dithering, image raster lines, writing G-code. Computes the same as `images.ts`/`gcode.ts`; the desktop app uses it, the browser uses the TypeScript version. Comparison test: `npm run test:core` |
| `vm/` | KizamuBeam Virtual Machine: the virtual laser machine as a separate program. `vm/src-tauri/core/src/machine.rs` controller (GRBL/FluidNC, planner, real time), `gcode.rs` line checks, `net.rs` Telnet/WebSocket servers, `ruida.rs` Ruida DSP emulation (unscrambling, commands → G-code, memory replies) with `ruida_net.rs` UDP ports 50200/50207 (check real .rd files locally with `RUIDA_RD_FILES=a.rd:b.rd cargo test -p kizamubeam-vm-core -- --ignored rd_files`), `vm/src/view.ts` top view with burn marks, `vm/src/view3d.ts` 3D view (three.js, material looks from `src/view3d/looks.ts`), `vm/src/burn.ts` workpieces and burn maps, `vm/src/parts.ts` cut-out detection (in a worker, `parts.worker.ts`), `vm/src/ui.ts` theme and sidebar layout (language shared with `src/i18n.ts`), `vm/src-tauri/core/src/camera.rs` HTTP camera server (MJPEG/single image; the window renders the images with `Bed3D.cameraImage`). Network cameras in KizamuBeam: `src-tauri/src/netcam.rs`. Tests: `npm run test:vm` (burn maps, cut-out detection and controller) |
| `src-tauri/src/native.rs` | Computation core for the UI: image grayscale data and finished G-code stay in Rust |
| `src/native.ts` | Calls into the computation core from the UI |

Internally the editor works in mm with y pointing down; the display uses machine coordinates (origin at the bottom left).

## Toolbar integration

Use the native DOM [toolbar framework integration notes](toolbar-layout-core.md)
for stable IDs, action/control factories, inline sections and detachable flyouts,
shared feature state, lifecycle cleanup, layout operations and persistence.
`src/toolbars.ts` is the app facade; `src/toolbars/` owns the common runtime,
registry, renderer and docking implementation. Menus and panel docking remain
separate. Typography PR #360 is independent, not a toolbar dependency.

## Generators

A generator declares everything the app needs to know about it on its `Generator` object (`src/generators/types.ts`); the core never branches on generator ids (issue #341, checked by `npm run test:gen-decoupling`):

- `tile`: toolbox group, position (`before`), texts for the tile and the toolbar action. The toolbox, the actions in `ui.ts` and the legacy generator toolbar group are built from the registry.
- `fit`: kind of plug-in fit and the parameter holding the play (design check, material calibration).
- `poses(params, thickness)`: position of every part in space (3D view, assembly check); helpers in `src/generators/pose.ts`.
- `assemblyCheck`: the parts form one assembly for the assembly check.
- `inputs`: what the generator needs before its dialog opens (a 3D model, the selection); `fromInputs()` turns them into parameters. Importing a 3D model offers every generator with a `model3d` input.
- `panel(params, set, host)`: extra dialog area that reads the app only through `GenHost` (selection outlines, bed size, camera images; `src/generators/host.ts`) and writes only parameters.
- `showIf` on a field is a rule (`{ eq: [key, value] }`, `ne`, `lt`, `le`, `gt`, `ge`, `in`, `and`, `or`, `not`), never a function; `ruleHolds()` evaluates it.
- `view(params)`: values the dialog shows that depend on the parameters (`autoText` suggestions for empty text fields).
- `onChange(key, old, params)`: called when a field is committed; returns a `patch` and/or an `ask` (question with options, cancelling restores the field). `preview.center` centres the dialog preview; `resetOnNew` on a field makes new objects start with its default.
- Issues carry a stable `code`; texts for codes that `generate()` throws come from `texts`. Internals throw codes, not UI text.

Its `id` is stored in projects and must never change. The generators that come with the app are not registered from this code: they are listed in `src/generators/builtin.ts` and `CORE` in `scripts/build-core-plugins.mjs`, built into the core pack and run as plugins (`src/plugins/core.ts`, see [plugins.md](plugins.md)). The app does not import their source. Node tests that compute with them directly import `scripts/builtin-generators.ts`, which registers the source with `register()`; `npm run test:core-plugins` checks that the plugins give the same results. New generators are written as plugins (#327).

## Security: CSP and markup

The WebView runs under a strict Content Security Policy (`app.security.csp` in `src-tauri/tauri.conf.json`): scripts only from the app itself (plus WebAssembly), no `eval`, no inline scripts, no frames or objects. Network access from the WebView is limited to the update check (api.github.com), the extension catalog and the Google Fonts preview; everything else (machines, network cameras, settings sync, font downloads) goes through Rust. `devCsp` adds the Vite dev server. `style-src` keeps `'unsafe-inline'` because the UI sets inline styles; Tauri is told not to add nonces there (`dangerousDisableAssetCspModification`), since a nonce would switch `'unsafe-inline'` off.

Markup is only inserted through `src/dom.ts`: `h(tag, { icon: 'name' })` and `setIcon()` for entries of `ICONS`, `h(tag, { svg })` and `setTrustedSvg()` for SVG the app builds itself (escape text with `escapeXml()`). Text from files, plugins, the catalog or the network is always inserted as text. `npm run check:html` (part of CI) fails on any other `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` in `src/`.

Plugins never get their own Tauri capability set; `src-tauri/capabilities/default.json` stays minimal.

## Logo

Logo files are in [`docs/brand/`](brand/): logo with symbol, wordmark, symbol in color and monochrome, symbol above the wordmark, each also as `-dark` for dark backgrounds, plus the app icon (`kizamubeam-app-icon.png`, source for `npx tauri icon`).
