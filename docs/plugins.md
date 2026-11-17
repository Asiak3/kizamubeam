# Plugins (developer notes)

Status: stage 1 of [#205](https://github.com/KizamuBeam/kizamubeam/issues/205) and of [#335](https://github.com/KizamuBeam/kizamubeam/issues/335): runtime, plugins in extension packs (format version 2), generator plugins in the toolbox, dialog schema version 1 and the headless runner. Stage 2 of #335 adds `view` (suggested texts) and `onChange` with in-dialog questions, stage 3 lists of rows and action buttons with the selection, an image file or the camera image as input (dialog schema version 2). 3D model inputs and surfaces follow.

A plugin computes geometry from parameters. It gets JSON in and gives JSON out. It cannot reach files, the network, the DOM, Tauri or the editor. Every plugin runs in its own Web Worker, and the app checks every answer before anything reaches the drawing.

Two runtimes are supported:

- **JavaScript / TypeScript** runs in QuickJS compiled to WebAssembly (`quickjs-emscripten`). Compile TypeScript to one plain script first.
- **WebAssembly** (for example Rust) is instantiated without any imports.

Code: [`src/plugins/`](../src/plugins). `contract.ts` holds the limits and the output checks, `engine.ts` the two runtimes, `worker.ts` the Worker and `client.ts` the main-thread side (`workerProcess` in the app, `inProcess` for Node tests).

## Manifest

A plugin is an entry of `plugins` in an extension pack ([docs/packs.md](packs.md)). The pack needs `"formatVersion": 2`.

```jsonc
{
  "id": "org.example.hole-plate",   // generator id, stored in projects; lowercase letters, digits, dots, hyphens
  "type": "generator",              // the only kind in stage 1
  "api": 1,                         // call protocol (PLUGIN_API); a newer one is refused with an update hint
  "version": 1,                     // version of the parameters (Generator.version)
  "kind": "part",                   // part or assembly
  "runtime": "wasm",                // wasm or js
  "code": "AGFzbQEAAAAB…",          // WebAssembly as Base64, JavaScript as text
  "sha256": "9f2c…",                // SHA-256 of the code bytes (hex), checked on every load
  "icon": "pattern",                // optional, a name from src/icons.ts
  "preview": { "center": true },    // optional, centre the dialog preview on the parts
  "dialog": { "version": 1 },       // optional, dialog schema the plugin needs (see below); 2 adds lists and actions
  "params": [
    { "key": "width", "type": "length", "min": 10, "max": 2000, "def": 120 },
    { "key": "pattern", "type": "enum", "options": ["hex", "square"], "def": "hex" },
    { "key": "margin", "type": "length", "min": 0, "max": 500, "def": 6, "advanced": true,
      "showIf": { "ne": ["pattern", "square"] } }
  ],
  "texts": {
    "en": { "name": "Hole plate", "width": "Width", "pattern": "Pattern", "pattern.hex": "Hexagonal", … },
    "de": { "name": "Lochplatte", … }
  }
}
```

Parameter types are the same as for built-in generators: `length` (mm), `angle` (degrees), `int`, `number`, `enum`, `bool`, `text` and `data` (hidden text). `showIf` uses the rule language of the app (`eq`, `ne`, `lt`, `le`, `gt`, `ge`, `in`, `and`, `or`, `not`); no plugin code runs for visibility. `advanced` puts a field under “Advanced”, `resetOnNew` starts new parts with `def`.

## Dialog (schema version 1)

Plugins describe what the dialog contains; the app draws it, with its own controls, units, formula fields, OK/Cancel and keyboard handling. Plugins never ship HTML, styles or scripts for the dialog. Version 1 has:

- **Fields** from `params`, in their order: number fields with unit, choice lists, switches, text fields; `data` fields are hidden.
- **Layout**: the main area, named sections (`"section": "<text key>"` on each field; a section appears below the main fields in the order of its first field, and disappears when all its fields are hidden) and the collapsed “Advanced” section (`"advanced": true`, which wins over `section`).
- **Rules**: `showIf` per field, evaluated by the app.
- **Preview** of the generated parts (centred with `"preview": { "center": true }`), the **info table** from `generate` and the **issue list** from `validate`; errors disable OK.

**Version 2** adds, under `dialog`:

- **Lists** (`"lists": [{ "param", "label", "empty", "columns", "shape", "remove", "removeTitle" }]`): rows kept as a JSON array in a `data` parameter. Columns are `text` (with `max` length and a `placeholder` text key for empty fields, `{n}` = row number), `int`, `number` or `length` (with `min` and `max`) and `enum` (`options` as `[value, text key]`). The app draws one row per entry with a field per column, checks every edit like a field (clamped, rounded, options checked, text cut) and can remove rows (`"remove": true`). `"shape": { "key", "rotate" }` shows a small picture of the sub-paths in that row key, turned by the degrees in `rotate`. A short text per row (e.g. its size) comes from `view` as `rows: { <param>: [text, …] }`; `empty` is shown when the list has no rows.
- **Actions** (`"actions": [{ "id", "label", "title", "inputs", "field" }]`): buttons below the lists. Pressing one calls `onEvent` with the inputs it declares:
  - `"selection"`: the selected objects of the drawing as `{ name, polys }` (closed outlines in mm, holes included; unnamed objects have an empty name),
  - `"image"`: the dialog first opens a file picker; the plugin gets `{ name, width, height, data }` (name without extension, at most 1000 pixels on the longer side),
  - `"camera"`: the calibrated camera image `{ width, height, data, bed: { w, h }, empty? }` (at most 1200 pixels, covering the bed; `empty` is the photo of the empty bed, if taken). The button is hidden while there is no camera image.

  Image `data` is RGBA, 4 bytes per pixel, as base64 (`pixels()` in both SDKs turns it into bytes). `"field"` names a number parameter that is shown next to the button instead of among the fields (e.g. the real width of the object in an image). The answer may change parameters (`patch`, checked like user input, e.g. new rows) and show a `message`. An answer that arrives after the dialog was closed or another action was started is dropped.

Labels, titles, `empty` and option labels are text keys. A list must name a `data` parameter; lists and actions in a version 1 dialog refuse the plugin.

`"dialog": { "version": N }` names the schema a plugin needs. A plugin that needs a newer one than the app knows is refused at install with an update hint. Without `dialog`, version 1 is assumed.

All state is in the parameters, so saving, undo, formulas with project parameters, reopening and MCP work the same as for built-in generators.

**Texts** are plain text, looked up in the interface language, then English (`en` is required). Keys:

| Key | Used for |
| --- | --- |
| `name` (required), `desc`, `keys` | toolbox tile: name, tooltip, more search words |
| `label` | name in the Objects window, placeholders `{param}`, e.g. `"Hole plate {width} × {height}"` |
| `<param>`, `<param>.title` | field label and tooltip |
| `<param>.<option>` | label of an enum option given as plain value; `["value", "text key"]` names another key |
| `part.<key>` | name of an assembly part |
| issue and info codes | messages from `validate`/`generate` and rows of the info table; `{name}` is filled from `values` |

A missing text falls back to its key. The app checks everything before it registers a plugin: ids, types, ranges, rules, text keys, code size and checksum. A mistake refuses the whole pack.

`npm run plugin:pack <folder>` builds a pack from `<folder>/plugin.json`: every `"code": "@path"` is replaced by the file and its checksum. Output: `<folder>/dist/<pack id>.kzp`.

## How the app uses a plugin generator

- Installed packs register their plugins as generators (`src/plugins/registry.ts`); removing the pack removes them. A plugin may not take the id of a built-in generator or of another pack's plugin.
- The editor calls generators synchronously, plugins answer asynchronously. `src/plugins/generator.ts` keeps the last answers per plugin: the first call for new parameters reports “Computing …” (OK stays disabled) and starts the plugin; when the answer arrives, the dialog and parts with formulas are updated. MCP tools wait for the answer (`buildGenAsync`).
- Parts store the generator id, its version, the parameters, the geometry and the extension's name (`GenShape.ext`). Without the extension they stay visible and can be lasered; editing their parameters names the missing extension.

## Calls

| Function | Input | Answer |
| --- | --- | --- |
| `validate` | parameters (object) | list of issues `{ key?, level: "error" \| "warn", code, values? }` |
| `generate` | parameters (object) | `{ parts, info, label?, labels?, poses?, plan? }` |
| `view` (optional) | parameters | `{ autoText?, rows? }`: suggestions for empty text fields and a text per list row, by key (texts) |
| `onChange` (optional) | `{ key, old, params }` | `null`, `{ patch }` or `{ ask: { question, options: [{ label, patch }] } }` |
| `onEvent` (optional) | `{ action, params, inputs }` | `null` or `{ patch?, message? }` (an action button of dialog version 2) |

A part is `{ key, subs, at, marks? }`; a plugin with `"kind": "part"` returns exactly one, an assembly any number. `subs` uses the same sub-path format as the editor (`{ nodes: [{ x, y, cin?, cout?, smooth? }], closed }`). `info` is a list of `[label, value]` rows for the dialog. Issue and info codes are translated through the plugin's texts, so a plugin never builds user-facing sentences.

**Dynamic dialogs (#335 stage 2).** `view` is called with every new set of parameters; the dialog shows its `autoText` in empty text fields (a field left at its suggestion stays empty, so the suggestion follows other fields). `onChange` is called when the user commits a field (number fields on leaving them, choices at once) with the previous value. A `patch` is checked against the schema like user input and never changes the committed field itself. An `ask` (question and up to three options, each with a patch) is shown inside the dialog; OK stays off until it is answered, Cancel restores the field. An answer that arrives after the user changed the field again is dropped. A plugin without these functions is asked once and then left alone. `runDialog` in the headless runner calls `onChange` for every field of a step; `$answer` in a step picks an option, without it the question is cancelled; each state has `autoText` and the `ask` of that step.

**Texts in answers.** Info labels and values, issue values, `label` and `labels` are texts: a plain string (shown as it is; decimal numbers and whole numbers from 1000 in the user's number format), `{ code, values? }` (a text key of the manifest, `values` fill its placeholders and may be texts again) or a list of texts shown one after the other. Number values are shown in the user's format when they have decimals. A plain info label is looked up as a text key first. The issue code `plugin-text` shows `values.text` as it is (for messages made of several texts).

**Names in the Objects window.** `label` names the object for these parameters (for example with computed outer dimensions), `labels` names the parts of an assembly by key. Without them, the manifest text `label` with `{param}` placeholders and `part.<key>` are used. The app keeps computed names for the last 2000 parameter sets; a saved part shows the manifest name until its plugin has run once.

A failure is reported as a code, for example `holes-touch`. Codes the app itself uses start with `plugin-`:

| Code | Meaning |
| --- | --- |
| `plugin-timeout` | The call took longer than its limit; the Worker is terminated and started again for the next call |
| `plugin-memory` | The plugin used more memory than allowed |
| `plugin-crash` | The engine or the Worker stopped |
| `plugin-bad-code` | The code could not be loaded |
| `plugin-imports` | A WebAssembly module asks for imports |
| `plugin-newer-api` | The plugin was built for a newer call protocol |
| `plugin-too-large` | The code is larger than 8 MB |
| `plugin-no-function` | The plugin does not provide the called function |
| `plugin-bad-output` | The answer breaks the contract (wrong types, NaN, too many parts or nodes, coordinates out of range, duplicate keys) |

Limits (`LIMITS` in `contract.ts`): `validate` 10 s, `generate` 30 s, `view` and `onChange` 2 s, `onEvent` 10 s, 512 MB memory, 8 MB code, 32 MB answer, 2000 parts, 500 000 nodes, coordinates within ±100 m.

## JavaScript

The script sets `globalThis.plugin`:

```js
globalThis.plugin = {
  validate(p) {
    return p.width < 10 ? [{ level: 'error', code: 'too-small', values: { min: 10 } }] : [];
  },
  generate(p) {
    const w = p.width, h = p.height;
    const rect = { closed: true, nodes: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] };
    return { parts: [{ key: 'plate', subs: [rect], at: { x: 0, y: 0 } }], info: [['area', `${w * h} mm²`]] };
  },
};
```

`throw new Error('some-code')` answers with that code.

## WebAssembly (ABI version 1)

The module has no imports and exports:

| Export | Signature | Meaning |
| --- | --- | --- |
| `memory` | | linear memory |
| `kzb_api` | `() -> i32` | protocol version, `1` |
| `kzb_alloc` | `(len: u32) -> u32` | a buffer the host writes into |
| `kzb_call` | `(fn_ptr, fn_len, in_ptr, in_len: u32) -> i64` | UTF-8 function name and JSON input; returns `(ptr << 32) \| len` of a UTF-8 JSON envelope `{"ok": …}` or `{"error": "code"}`, valid until the next call |

The Rust SDK (below) implements this ABI; the example [`plugins/hole-plate`](../plugins/hole-plate) (plate with a pattern of holes) uses it.

## Writing a plugin

Start from a template and change it:

- [`plugins/templates/typescript`](../plugins/templates/typescript): a name tag in TypeScript. `src/index.ts` imports the SDK from [`plugins/sdk/ts`](../plugins/sdk/ts/index.ts): the types (`Params`, `Part`, `SubPath`, `Issue`, `GenResult`), `definePlugin` and shape helpers (`polygon`, `rect`, `circle`, `regular`, `roundedRect`, `mm` for numbers in info rows). It also has `random(seed)` (deterministic random numbers; plugins must give the same result for the same parameters) and a single-stroke font, `strokeText(text, size, { x, y, align, valign, angle })`, for numbers and short labels engraved as open lines (digits, A–Z and a few signs; plugins cannot use the app's fonts). The [jigsaw puzzle](../plugins/jigsaw) is a complete example.
- [`plugins/templates/rust`](../plugins/templates/rust): the same tag in Rust with the crate [`kzb-plugin`](../plugins/sdk/rust) (`plugins/sdk/rust`). Implement the `Plugin` trait (`validate`, `generate` on `serde_json::Value` parameters; optional `view` and `on_change` return `Some(json)`, the default `None` means the plugin has none) and call `export_plugin!(MyPlugin)`; the macro provides the ABI exports. Builders: `Issue::error("code").on("key").value("max", 5)`, `GenResult::new().part(Part::new("tag", subs).at(x, y)).info("area", …).label(json!({ "code": "label" }))`, shapes in `kzb_plugin::geom`. Needs `rustup target add wasm32-unknown-unknown`.

Copy the template folder to `plugins/<your-name>/`, give the pack and the plugin your own ids (reverse domain, for example `io.github.you.coaster`), adjust the parameters and texts in `plugin.json`, then:

```sh
node scripts/plugin-pack.mjs --build plugins/<your-name>   # builds the code and writes dist/<id>.kzp
npm run plugin:check plugins/<your-name>                   # the catalogue's check
```

Install the `.kzp` in the app under Extensions to try it. `build` in `plugin.json` lists the recipes the catalogue runs: `{ "esbuild": "src/index.ts", "out": "dist/plugin.js" }` or `{ "rust": ".", "out": "dist/plugin.wasm" }`; `"code": "@dist/plugin.js"` points at the result. A plugin in `plugins/<name>/` is built from source and published by the catalogue workflow once it is merged.

## Headless runner and check

`src/plugins/headless.ts` runs a plugin's dialog without the app: `runDialog(manifest, steps)` starts with the default parameters, applies each step (a set of field changes, checked against the schema like user input) and returns after each one what the dialog would show: parameters, visible fields, issues with codes, info rows, the parts (key, position, size) and a SHA-256 of the geometry. A step may also press a button: `{ "$action": "<id>", "$selection": [{ name, polys }], "$image": { name, width, height, data }, "$camera": { width, height, data, bed, empty? } }` (images as a plugin gets them); the state then has the `message`, and every state has the `rows` from `view`. Use it in plugin tests.

`npm run plugin:check <folder | file.kzp>` checks every plugin of a pack the way the catalogue will:

- the default parameters generate parts without errors (a dialog that starts with an empty list is first filled by its first action with the selection as input, with a sample selection: a 40 × 30 mm rectangle with a hole),
- every option of every choice and both values of every switch run without a crash, timeout or broken output,
- two runs give the same geometry (no randomness or clock; use a seed parameter),
- issue codes, parameter labels and `desc` have English texts (warnings).

## Built-in generators as plugins

The built-in generators move to the plugin system (#205, #327). `npm run plugin:core` (`scripts/build-core-plugins.mjs`) builds them as JavaScript plugins from their unchanged source in `src/generators`:

- The generator is bundled with `plugins/core/wrap.ts` and a stand-in for `src/i18n` (`plugins/core/i18n-shim.ts`). A plugin has no language, so `t()` returns the German source text as a marker; the wrapper turns issue texts and info labels into text codes (`plugins/core/codes.ts`) with their values.
- The manifest is generated from the same source: parameters, rules, labels, tooltips and options, plus every `t()` text of the bundled files as a code, translated from `src/locales` into all app languages.
- The app writes numbers in plugin texts in the number format of the interface (QuickJS has no locale).

- Texts the generator composes (a field label with `t('Rad 1')` inside, an info value made of several texts) keep their parts: markers are closed, the wrapper turns them into lists of codes and plain strings, the build script renders static ones (field labels) into every language. The name in the Objects window comes from the generator's own `label()` through `label` and `labels`.

Built so far (`plugins/core/dist/org.kizamubeam.core-generators.kzp`): gear, box, rack, pulley, cam, gear pair, drawer, insert, shelf, disc sphere box with dividers (`box-divided`, with `view` and `onChange`; its error codes come from `Generator.texts`) and the jig (`jig`, a list of workpieces filled from the selection, an image or the camera; the build replaces print-and-cut's `geom` import, which pulls in fonts, by a stub). `npm run test:core-plugins` checks that they give the same dialog, geometry, issues, info, names and 3D poses as the built-in generators for the defaults, every option, every switch and every number at its minimum and maximum, and reports the time. QuickJS is about 10 to 20 times slower than the built-in code: most cases take well under a second, nesting many parts takes longer (a gear pair with 400 teeth about 20 s, which is why `generate` may run 30 s). Not yet: stack (3D model input) and ribs (drawing surface). `tn()` texts are collected in both forms; the plugin picks the German plural form by number. Generators without a thickness parameter (gear pair) compute their 3D poses for 3 mm. The built-in versions stay active until the switch-over: callers that need results synchronously (built-in templates, 3D view, design check) need their own solution first.

## Tests

`npm run test:plugins` runs both runtimes in Node (the hole plate, a JavaScript plugin, the time and memory limits, refused output), plugins in packs (`scripts/plugin-packs-test.ts`) the dialog schema with the headless runner (`scripts/plugin-dialog-test.ts`) and both templates (`scripts/plugin-sdk-test.ts`, the Rust one only where the wasm32 target is installed).
