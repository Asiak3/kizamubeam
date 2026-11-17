# Plugins (developer notes)

Status: stage 1 of [#205](https://github.com/KizamuBeam/kizamubeam/issues/205) and of [#335](https://github.com/KizamuBeam/kizamubeam/issues/335): runtime, plugins in extension packs (format version 2), generator plugins in the toolbox, dialog schema version 1 and the headless runner. Dynamic dialogs (`view`, `onChange`, lists, surfaces) follow in the next stages of #335.

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
  "dialog": { "version": 1 },       // optional, dialog schema the plugin needs (see below)
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
| `generate` | parameters (object) | `{ parts, info, poses?, plan? }` |

A part is `{ key, subs, at, marks? }`; a plugin with `"kind": "part"` returns exactly one, an assembly any number. `subs` uses the same sub-path format as the editor (`{ nodes: [{ x, y, … }], closed }`). `info` is a list of `[code, value]` rows for the dialog. Issue and info codes are translated through the plugin's texts (part of the manifest in the next step), so a plugin never builds user-facing sentences.

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

Limits (`LIMITS` in `contract.ts`): `validate` 2 s, `generate` 10 s, 512 MB memory, 8 MB code, 32 MB answer, 2000 parts, 500 000 nodes, coordinates within ±100 m.

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

The example [`plugins/hole-plate`](../plugins/hole-plate) (plate with a pattern of holes) implements this in Rust; `src/abi.rs` can be copied into other plugins.

## Headless runner and check

`src/plugins/headless.ts` runs a plugin's dialog without the app: `runDialog(manifest, steps)` starts with the default parameters, applies each step (a set of field changes, checked against the schema like user input) and returns after each one what the dialog would show: parameters, visible fields, issues with codes, info rows, the parts (key, position, size) and a SHA-256 of the geometry. Use it in plugin tests.

`npm run plugin:check <folder | file.kzp>` checks every plugin of a pack the way the catalogue will:

- the default parameters generate parts without errors,
- every option of every choice and both values of every switch run without a crash, timeout or broken output,
- two runs give the same geometry (no randomness or clock; use a seed parameter),
- issue codes, parameter labels and `desc` have English texts (warnings).

## Tests

`npm run test:plugins` runs both runtimes in Node (the hole plate, a JavaScript plugin, the time and memory limits, refused output), plugins in packs (`scripts/plugin-packs-test.ts`) and the dialog schema with the headless runner (`scripts/plugin-dialog-test.ts`).
