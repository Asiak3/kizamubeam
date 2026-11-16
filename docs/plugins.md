# Plugins (developer notes)

Status: stage 1 of [#205](https://github.com/KizamuBeam/kizamubeam/issues/205), runtime only. Packaging, installation and dialogs follow in the next steps (pack format 2, [#335](https://github.com/KizamuBeam/kizamubeam/issues/335)).

A plugin computes geometry from parameters. It gets JSON in and gives JSON out. It cannot reach files, the network, the DOM, Tauri or the editor. Every plugin runs in its own Web Worker, and the app checks every answer before anything reaches the drawing.

Two runtimes are supported:

- **JavaScript / TypeScript** runs in QuickJS compiled to WebAssembly (`quickjs-emscripten`). Compile TypeScript to one plain script first.
- **WebAssembly** (for example Rust) is instantiated without any imports.

Code: [`src/plugins/`](../src/plugins). `contract.ts` holds the limits and the output checks, `engine.ts` the two runtimes, `worker.ts` the Worker and `client.ts` the main-thread side (`workerProcess` in the app, `inProcess` for Node tests).

## Calls

| Function | Input | Answer |
| --- | --- | --- |
| `validate` | parameters (object) | list of issues `{ key?, level: "error" \| "warn", code, values? }` |
| `generate` | parameters (object) | `{ parts, info, poses?, plan? }` |

A part is `{ key, subs, at, marks? }`. `subs` uses the same sub-path format as the editor (`{ nodes: [{ x, y, … }], closed }`). `info` is a list of `[code, value]` rows for the dialog. Issue and info codes are translated through the plugin's texts (part of the manifest in the next step), so a plugin never builds user-facing sentences.

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

## Tests

`npm run test:plugins` runs both runtimes in Node: the hole plate, a JavaScript plugin, the time and memory limits, and refused output.
