# Plugins (developer notes)

Status: stage 1 of [#205](https://github.com/KizamuBeam/kizamubeam/issues/205) and of [#335](https://github.com/KizamuBeam/kizamubeam/issues/335): runtime, plugins in extension packs (format version 2), generator plugins in the toolbox, dialog schema version 1 and the headless runner. Stage 2 of #335 adds `view` (suggested texts) and `onChange` with in-dialog questions, stage 3 lists of rows and action buttons with the selection, an image file or the camera image as input (dialog schema version 2), stage 4 a drawing surface, selectable rows and row buttons (dialog schema version 3). 3D models reach plugins as resources. Stage 5 of [#211](https://github.com/KizamuBeam/kizamubeam/issues/211) adds host functions (boolean operations, offsets, curve fitting, tracing), progress reports, cancelling and sessions. Stage 3 of #205 adds two more kinds: path tools and image filters. Stage 6 of #211 keeps images with the project as resources (dialog schema version 4: `store`, `selectedImage`), stage 7 adds steps, sortable lists, colour columns and region maps (dialog schema version 5).

A plugin computes geometry from parameters. It gets JSON in and gives JSON out. It cannot reach files, the network, the DOM, Tauri or the editor. Every plugin runs in its own Web Worker, and the app checks every answer before anything reaches the drawing.

Two runtimes are supported:

- **JavaScript / TypeScript** runs in QuickJS compiled to WebAssembly (`quickjs-emscripten`). Compile TypeScript to one plain script first.
- **WebAssembly** (for example Rust) is instantiated without imports, apart from the one host function bridge `kzb.host_call` (see below).

Code: [`src/plugins/`](../src/plugins). `contract.ts` holds the limits and the output checks, `engine.ts` the two runtimes, `worker.ts` the Worker and `client.ts` the main-thread side (`workerProcess` in the app, `inProcess` for Node tests).

## Manifest

A plugin is an entry of `plugins` in an extension pack ([docs/packs.md](packs.md)). The pack needs `"formatVersion": 2`.

```jsonc
{
  "id": "org.example.hole-plate",   // generator id, stored in projects; lowercase letters, digits, dots, hyphens
  "type": "generator",              // generator, pathtool or imagefilter (see "Path tools and image filters")
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

**3D models** (#211 stage 5). A `data` parameter with `"resource": "model3d"` holds the id of a 3D model the app keeps (models are not stored in the parameters, they can be megabytes). Before the plugin computes with such an id, the app calls its `resource` function once with `{ kind: "model3d", id, data }`, and again after the plugin was restarted (a timeout or crash); the plugin keeps the data by id. `data` is `kzm1:` followed by base64 of: vertex count and triangle count (uint32), the positions (float32, x y z in mm) and the triangle indices (uint32), little endian; `mesh()` in both SDKs decodes it. While a model is not loaded (an old project whose model is still being restored), the plugin is not told and reports the missing model itself; the result is computed again once the model is there. `"inputs": [{ "kind": "model3d", "param": "model", "name": "name" }]` offers the plugin when the user imports a 3D model: the model id goes into `param`, the file name into `name` (optional, a `data` or `text` parameter).

**Images** (#211 stage 6). A `data` parameter with `"resource": "image"` holds the id of an image in the app's image store, the same store image objects use; the image is saved with the project and restored with it. The plugin gets its pixels through `resource` like a 3D model: `{ kind: "image", id, data }` with `data` = `rgba1:<width>,<height>,` followed by base64 of the RGBA bytes (4 per pixel, row by row from the top left), scaled down to at most 1200 pixels on the longer side. `storedImage(data)` in the TypeScript SDK and `stored_image(&data)` in Rust split it. The parameter is filled by an action with `"store"` (dialog version 4, below). While the image is not decoded yet (just after opening a project), the plugin is not told and the result is computed again once it is there.

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

**Version 3** adds:

- **Drawing surface** (`"surface": { "views": [{ "id", "label" }], "height", "help" }`): an area the plugin draws on, with a tab per view, under the fields. The app asks `draw` what to show and sends pointer events to `onSurface`; it scales, draws and finds what the pointer hits. Coordinates are mm in the view, y down.
  - `draw` gets `{ view, state, selected, have, params }` and answers `{ frame: { x0, y0, x1, y1 }, items, layers?, track? }`. `frame` is fitted into the surface. `items` are `{ type: "line", pts: [[x, y], …], closed?, style?, width?, dash?, alpha?, id? }`, `{ type: "handle", x, y, id, style?, size? }` and `{ type: "text", x, y, text, style? }` (`style`: `normal`, `muted`, `accent`, `warn`; `text` is a text like in issues). Handles and lines with an `id` can be hit, the topmost first and handles before lines.
  - `layers` (at most 4) are drawings that rarely change, for example the silhouette of a model (`tris`: filled triangles as a flat list x0, y0, x1, y1, x2, y2, …, faded by `alpha`) or the outlines of the parts (`items`). The app keeps them by `key` and lists the keys it has in `have`; for those, answer `{ key }` without content.
  - `onSurface` gets `{ event, surface, params }`. `event` is `{ type, x, y, hit?, from?, drag?, key? }` with `type` `down` (with the `id` under the pointer as `hit`), `move` (with `drag` and `from` while the button is held; without a button only while the last drawing had `track: true`), `up`, `dblclick`, `context` (right click), `key` (`Enter`, `Escape`, `Delete`, `Backspace`; Escape only while `track` is on, otherwise it closes the dialog) and `select` (a row of a selectable list was clicked: `list` and `row`). Pointer and key events carry the held modifier keys as `shift: true`, `alt: true` (Option) and `ctrl: true` (Ctrl, or Cmd on macOS); a key that is not held is left out, e.g. Shift-click to add instead of replace. Events are sent one after the other; of several waiting moves only the newest is sent.
  - `surface` is `{ view, state, selected }`: `state` is free JSON the plugin keeps between events (null at first, at most 1 MB; for example the points while dragging or a line being drawn), `selected` the selected row by list parameter (-1 = none). An answer of `onSurface` or `onEvent` may change parameters (`patch`), show a `message` under the surface, and set `state` (null clears it), `view` and `select`. Parameters change only through `patch`, so undo, saving and formulas work as for fields.
- **Lists**: `"select": true` makes rows selectable (the selected row goes to `draw`, `onSurface` and `onEvent`), `"rowActions": [{ "id", "label", "title" }]` adds buttons to every row (`onEvent` with `row`), number columns may have a `placeholder` shown instead of 0 (e.g. “auto”), and `view` may suggest a text for the empty first text cell of each row (`rowAuto: { <param>: [text, …] }`, e.g. a name in the user's language without storing one).
- **Actions**: `"showIf"` shows a button only while a rule holds.

**Version 4** adds, for actions:

- `"selectedImage"` as input: the selected image object of the drawing instead of a file, as `inputs.image` (`{ name, width, height, data }`, at most 1000 pixels like a picked file). Without a selected image the dialog says so and does not call the plugin.
- `"store": "<param>"` on an action with an `image` or `selectedImage` input: the app keeps the picked file (or the selected image) in its image store and writes the id into that parameter (a `data` parameter with `"resource": "image"`) before `onEvent` runs, so `params` already has it. From then on the plugin works with the kept image whenever it computes, also after reopening the project.

**Version 5** (#211 stage 7) adds:

- **Steps** (`"steps": [{ "id", "label", "items" }]`, 2 to 8): the dialog shows numbered tabs (“1 Source”, “2 Panel” …) and one step at a time. `items` names what a step shows, in order: fields (parameter keys), lists (their parameter), action buttons (their id, with their `field`) and `"surface"`. Each may appear in one step only; whatever no step names is shown below the steps. The preview, info and issues stay visible, and a tab is marked while one of its fields has an error.
- **Sortable lists** (`"sort": true`): every row gets a grip; rows are reordered by dragging the grip onto another row or with Alt+↑/↓ in the row. `"fixedLast": n` keeps the last n rows in place (for example the back plate). The new order goes into the parameter like an edit; the selected row moves along.
- **Colour columns** (`{ "key", "type": "color", "readonly"? }`): a value `#rrggbb` shown as a swatch, editable with the colour picker unless `readonly`.
- **Region maps** on the drawing surface, for click-to-pick: a layer may have `regions: { frame, width, height, data, colors }`, a grid of `width` × `height` cells over `frame` (mm in the view), one byte per cell as base64 (0 = no region, n = region n − 1), each region filled in `colors[n − 1]` (`#rrggbb`, at most 255, faded by the layer's `alpha`, default 0.7). A click on a region reports `hit: "<layer key>:<region>"` (handles and lines are hit first). Like other layers it is sent once per key. `regionMap(frame, width, height, cells, colors)` in the TypeScript SDK builds it from region numbers per cell.

Several layers or materials stacked on top of each other are described with `poses` (the 3D view), and an engraving that belongs on its own layer with part `marks` (the app puts it on a label layer and groups it with the part); there is no separate field for them.

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
- **Parameter migrations.** When a project is opened, parts saved with an older `version` of the plugin are passed to `migrate` with `{ params, from }` (in the Worker, `loadGen` in `src/generators/index.ts`). The part keeps its stored geometry and its old version until the answer arrives; opening its dialog and recomputing formulas wait for it (`genReady`). Without `migrate`, or when it fails, the parameters stay as saved. The Rust SDK answers „no function“ for `None`, which keeps the parameters as well.
- **Plug-in joints and assembly check.** `"fit": { "kind": "pair" | "slot", "play": "<number parameter>" }` tells the design check and the material calibration which parameter holds the play; `"assemblyCheck": true` lets the assembly check examine the parts as one connected assembly (needs `poses`).
- **Toolbox place** (`"tile": { "group", "before"?, "since"? }`, texts `tile.name` and `tile.action`) is used only by the generators that come with the app (below); extensions are listed under “From extensions”.

## Calls

| Function | Input | Answer |
| --- | --- | --- |
| `validate` | parameters (object) | list of issues `{ key?, level: "error" \| "warn", code, values? }` |
| `generate` | parameters (object) | `{ parts, info, label?, labels?, poses?, plan?, distribute? }` |
| `view` (optional) | parameters | `{ autoText?, rows?, rowAuto? }`: suggestions for empty text fields, a text per list row and a suggestion per row's empty name, by key (texts) |
| `onChange` (optional) | `{ key, old, params }` | `null`, `{ patch }` or `{ ask: { question, options: [{ label, patch }] } }` |
| `resource` (optional) | `{ kind, id, data }` | `null` (see 3D models above) |
| `onEvent` (optional) | `{ action, params, inputs, row?, surface? }` | `null` or `{ patch?, message?, state?, view?, select? }` (an action button of dialog version 2, a row button of version 3) |
| `draw` (optional) | `{ view, state, selected, have, params }` | `{ frame, items, layers?, track? }` (the drawing surface of version 3) |
| `onSurface` (optional) | `{ event, surface, params }` | like `onEvent` |
| `open` (optional) | parameters | anything (ignored): the dialog was opened; prepare caches for this session |
| `close` (optional) | `null` | anything (ignored): the dialog was closed; free what `open` prepared |
| `migrate` (optional) | `{ params, from }` | the parameters for the manifest's `version` (generators; see below) |

A part is `{ key, subs, at, marks?, page? }`; a plugin with `"kind": "part"` returns exactly one, an assembly any number. `subs` uses the same sub-path format as the editor (`{ nodes: [{ x, y, cin?, cout?, smooth? }], closed }`). `info` is a list of `[label, value]` rows for the dialog. Issue and info codes are translated through the plugin's texts, so a plugin never builds user-facing sentences.

**Several pages** (#387). An assembly larger than the work area can ask the app to spread it over pages; the app creates the pages and places the parts, the plugin never touches the document. `page` (0 … 49) groups parts: parts with the same number go on the same page, the lowest group on the page the user inserts on, every further group on new pages right behind it (`at` is then relative to the other parts of the group, each group is placed as one block at the first free spot). `distribute: { rotate? }` spreads the parts over as many pages as the work area needs with the app's nesting (`rotate` allows 90°, 180° and 270°; off keeps the grain direction); with page groups each group is spread on its own. Objects already on the current page stay where they are and are avoided. Distribution uses one nesting order, so the same parts always land in the same places. A part (or a group block) larger than the work area goes alone into the middle of a page of its own, and the message says so; the dialog's size warning counts each part (distribute) or each group on its own. The parts stay one assembly across the pages (Select assembly, double-click to edit, saved with the project). When the parameters change, every part is recomputed on its page; a page group still in the arrangement the plugin gave is laid out again with the new sizes, moved and distributed parts stay where they are, and new parts go to a free spot on the page of their group or onto a new page behind the assembly. Inserting, spreading and every change are one undo step each. Without `page` and `distribute` nothing changes. Built-in generators use the same fields (`GenPart.page`, `GenResult.distribute`).

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
| `plugin-imports` | A WebAssembly module asks for imports other than `kzb.host_call` |
| `plugin-newer-api` | The plugin was built for a newer call protocol |
| `plugin-too-large` | The code is larger than 8 MB |
| `plugin-no-function` | The plugin does not provide the called function |
| `plugin-cancelled` | The user cancelled the computation; the Worker is terminated and started again for the next call |
| `host-not-allowed` | The plugin called a host function its manifest does not name in `host` |
| `host-bad-input` | A host function got input it cannot use |
| `host-failed` | A host function failed |
| `plugin-bad-output` | The answer breaks the contract (wrong types, NaN, too many parts or nodes, coordinates out of range, duplicate keys) |

Limits (`LIMITS` in `contract.ts`): `validate` 10 s, `generate` 30 s, `view` and `onChange` 2 s, `onEvent` 10 s, `resource` 20 s, `draw` 30 s (it may lay out new parameters), `onSurface` 5 s, `open` 30 s, `close` 2 s, 512 MB memory, 8 MB code, 32 MB answer, 2000 parts, 500 000 nodes, coordinates within ±100 m; a drawing has at most 20 000 shapes, 1 000 000 points and 2 000 000 triangles.

## Host functions, progress, cancelling and sessions (#211 stage 5)

**Host functions** are building blocks of the app a plugin may call while it computes, instead of bundling its own (`src/plugins/hostfns.ts`). They are pure computation on the data the plugin hands over; none reaches the editor or files; `fetch` (below, “Network access”) only answers with data the app fetched for the plugin. A plugin names the ones it uses in its manifest, `"host": ["boolean", "fit"]`; calling another one fails with `host-not-allowed`. Their time counts toward the time limit of the plugin call. Input and answer are JSON, sub-paths in the editor's format:

| Function | Input | Answer |
| --- | --- | --- |
| `boolean` | `{ op: "union" \| "difference" \| "intersection" \| "xor", a: subs, b?: subs }` | closed sub-paths of Bézier curves; holes within each side by even-odd |
| `offset` | `{ subs, delta (mm, negative = inward, ±1000), join?: "round" \| "miter" \| "square" }` | closed sub-paths; open sub-paths get a band of width 2 × \|delta\| |
| `fit` | `{ pts: [[x, y], …], closed?, tolerance? (mm, 0.05) }` | one sub-path of Bézier curves through the points |
| `trace` | `{ width, height, data (one gray byte per pixel, base64), threshold? (128), smooth? 0 … 1 (0.5), ignoreLess? (pixels², 4), scale? (mm per pixel, 1) }` | closed outlines of the dark areas, from the top left |
| `slice` | `{ model (id of a 3D model the plugin got as a resource), up?: "z" \| "y", size? (mm), frame?: { u, v, w }, heights: [h, …], gap? (mm, 0.5) }` | `{ min, max, layers: [{ region, open }] }`: cross-sections at the heights along `w` (default frame x, y, z). With `size` the model is placed like the built-in 3D-model generators do it: upright (`up: "y"` turns a Y-up model), scaled to that longest side, centred over the origin with the bottom at 0; without it the model's own units. `min`/`max` are the bounds in the frame, `open` counts chains that could not be closed (holes in the mesh) |
| `region` | `{ op, … }`, see below | an area, or what the operation gives |
| `nest` | `{ parts: [{ key?, subs }], gap (mm) }`, each part's outlines around its own origin | `[[x, y], …]`: where each part goes, in the order given; the compact, tidy arrangement without rotation the generators use for “nested” parts, centred on the origin. Same parts give the same positions |
| `check` | `{ parts: [{ key, subs, at?: [x, y] }], placed?, minWeb? (mm, 1), beam? (mm, 0.15), kerf? (mm, 0), tol? (mm, 0.05), closeGap? (mm, 1), workArea?: { width, height } }`, at most 500 parts | `[{ code, level, parts: [key, …], values?, at?: [x, y] }]`, at most 200 findings; see “Checking the design” below |

**Areas** (`slice`, `region`) are lists of closed polygons `[x0, y0, x1, y1, …]` in mm, filled by the nonzero rule; points lie on a 1 µm grid, exactly as in the app's own slicing. `region` operations: `union { a, b? }`, `intersection { a, b }`, `difference { a, b }` (a without b), `offset { a, delta }` (round corners, negative = inward), `loops { loops }` (closed loops to an area by the even-odd rule), `band { line, radius }` (around an open line, round ends) give an area; `clean { a, minArea? }` gives `{ polys, islands }` (outlines and holes without islands and holes under minArea mm², and the island count), `islands { a, minArea? }` gives `[[outline, hole, …], …]`, `deepest { polys }` gives `{ p: [x, y], r }`, the inner point farthest from the edge (for a label), or null. The app keeps the 3D models a plugin with `slice` gets as resources (the last 8) and the slicing prepared on them, so slicing layer by layer is cheap. The built-in stack and rib models (`scripts/build-core-plugins.mjs`) cut through these functions (`plugins/core/slice-host.ts`, `fit-host.ts`) and so slice as fast as built in. Every built-in generator built as a plugin arranges its parts through `nest` (`plugins/core/build-host.ts` replaces `arrangeParts`, `layoutParts` and `nestParts` of `generators/build`), which was most of the remaining time in QuickJS.

**Checking the design** (`check`, #388). The geometric part of Check design (`src/checkGeom.ts`) on the cut lines a plugin computes, before they reach the canvas, so its dialog can warn while the user changes parameters. Each part is checked on its own (its sub-paths are cut lines); with `placed: true` the parts lie where they will be cut (moved by `at`) and are also checked against each other, for shared lines cut twice. `workArea` adds a check of each part's size, turned by 90° too. Codes: `check-double` (`len` mm cut twice), `check-double-whole` (a whole outline twice), `check-unjoined` (`n` lines that form an outline but are not joined), `check-open` (`gap` mm), `check-open-fill`, `check-hole-lost` (kerf offset `k` makes the cut-out vanish), `check-hole-small` (smaller than the beam width `b`), `check-web` (`w` mm, thinner than `minWeb`), `check-web-cut` (cuts touch), `check-too-big` (`w`, `h` against `aw`, `ah`). A plugin passes them on as issues of `validate` with the same code and values (`{ key: f.code, level: f.level, code: f.code, values: f.values }`); the app writes the texts of Check design in the interface language, so the plugin needs no texts for them, and `npm run plugin:check` does not ask for any. `beam` is the cut width when `kerf` is 0; with a kerf offset it is 2 × kerf, like a layer in the app.

**Progress.** `progress` needs no manifest entry: a number 0 … 1 or `{ done, text? }` (text at most 200 characters). The dialog shows it next to “Computing …”, at most every 150 ms. While a plugin computes, the dialog offers **Cancel computation**: the Worker is terminated, the call fails with `plugin-cancelled`, and **Compute again** (also offered after `plugin-timeout`) starts it afresh.

**Sessions.** `open` is called with the parameters when the plugin's dialog opens, `close` when it closes. A plugin may keep caches between them (for example a sliced model while the user changes other parameters); it must still give the same result for the same parameters without them, because the Worker can be restarted at any time.

In JavaScript the functions are methods of `globalThis.host` (`host.boolean({ … })`, `host.progress(0.5)`); a failure throws an `Error` whose message is the code. In the TypeScript SDK they are typed (`host` from `plugins/sdk/ts`); in Rust `kzb_plugin::host("fit", &json!({ … }))` returns `Result<Value, String>` and `kzb_plugin::progress(0.5)` reports progress; the `Plugin` trait has `open` and `close`.

## Material, work area and selection (#386)

A generator may ask for context the app knows, declared in its manifest:

```jsonc
"context": ["material", "workArea"],                         // allows host.context; nothing else is reachable
"inputs": [{ "kind": "selection", "action": "fromSelection" }] // optional: opened with the current selection
```

- `host.context("material")` answers `{ name, thickness, kerf, pairPlay, slotPlay }` (mm, each `null` when unknown) from the material library entry on the layer the part goes on: in the dialog the layer of the edited part, or the current layer while creating one. `null` for a layer without material.
- `host.context("workArea")` answers `{ width, height }`: the machine's work area in mm.
- Declaring `context` adds the host function `context`; listing it under `host` without `context` is refused. A name the manifest does not declare fails with `host-bad-input`. The app sends the declared context before every computation (as resources of kind `context`, which the plugin's own `resource` function does not see) and it is part of the cache key: another material or work area computes the part again. No editor, document, file or machine state reaches the plugin.
- A plugin must cope with `null`: report an issue with a text (for example "Pick a layer with a material"). The catalogue check runs the defaults once without context and reports an error the plugin did not write a text for. Headless runs use 3 mm plywood on a 400 × 300 mm machine unless the test gives its own (`runDialog(m, steps, { context })`).
- **Selection.** `inputs` with `"kind": "selection"` names an action whose inputs include `selection`. When the user opens the plugin from the toolbox with objects selected, the app runs that action with the selection (the same objects and format as pressing its button: `{ name, polys }` per top-level object) and opens the dialog with the parameters its patch sets. The built-in jig uses this.
- TypeScript SDK: `host.context('material')` with the types `MaterialContext` and `WorkArea`. Rust SDK: `host("context", &json!("material"))`.

## Network access (#280 stage 9)

A plugin never reaches the network itself: it only runs inside its engine in a Worker, which has no network functions, and the app's content security policy allows no plugin servers. A plugin that needs data from a server (a place search, map data, a weather service) declares the servers in its manifest and asks for data with the host function `fetch`; the app makes the request after its own checks and hands the answer back.

```jsonc
"host": ["fetch"],
"network": [{
  "id": "osm",                                   // name used in host.fetch
  "base": "https://nominatim.openstreetmap.org", // https, a host name (no IP address), optional path prefix, no query
  "methods": ["GET"],                            // GET (default) and/or POST
  "types": ["json"],                             // accepted answers: json, xml, text, png, mvt (default json)
  "rate": 1,                                     // requests per second at most (the app allows 2 at most)
  "purpose": "net.osm",                          // text key: what the plugin gets there, shown before the first request
  "attribution": "© OpenStreetMap contributors"  // optional, shown with every result that used the data
}]
```

At most 4 servers. `network` needs `fetch` in `host` and the other way round. The catalog shows the servers of a pack, the install dialog warns about them, and the Extensions window marks the plugin with **Network**.

**Request.** `host.fetch({ host: "osm", path: "/search", query: { q: "Berlin", format: "json" }, method?: "GET" | "POST", body?: "…" })`. The app builds the URL from the server's `base`, the path (must start with `/`, no `..`, `//` or encoded slashes, and stays under the base path) and the query values (sorted, at most 40). `body` is for POST only (sent as `application/x-www-form-urlencoded`, at most 100 000 characters). The answer is `{ status, type, text }` for json, xml and text, `{ status, type, data }` with base64 for png and mvt, or `{ status, error }`.

**Round trip.** The call is synchronous for the plugin, but data takes time: the first time a request is made, `fetch` fails with `net-pending` and the request goes to the app. The plugin lets this error end the call (in JavaScript it is thrown, in Rust `host("fetch", …)` returns `Err("net-pending")`, which the plugin returns). The app fetches the data, hands it to the plugin as a resource of kind `net` (the plugin's own `resource` function does not see it) and calls again; now `fetch` answers at once. This repeats up to 6 times per result, so a plugin can make one request after the other (search, then the map around the place found). To ask for several things in one round, a JavaScript plugin may catch `net-pending`, make the other requests and then throw it again. The plugin must give the same result for the same parameters and answers.

**Checks of the app** (`src/plugins/net.ts`, in the app `src-tauri/src/plugin_net.rs`):

- The user agrees per plugin before its first request, to the list of servers with their purpose; a changed server list asks again. The answer is a switch in the Extensions window, which also shows the plugin's requests of this session. A switch under the installed extensions keeps all plugins offline.
- Only the declared servers and methods, at most `rate` requests per second per server.
- HTTPS only, no redirects, cookies, credentials or referrer, a fixed User-Agent. In the app the request runs in Rust: the host name must resolve to public addresses only (no loopback, private, link-local or other local networks), checked by the resolver the connection uses.
- At most 10 MB and 20 seconds per request; only the declared content types; HTTP errors come back as their status with `net-status`.
- Answers are kept for an hour (50 MB at most), so a live preview does not ask the server again.

The test load before installing makes no requests (a plugin that asks for data counts as answered). The headless runner and `npm run plugin:check` have no network either: they answer requests from recorded answers, `net-fixtures.json` next to `plugin.json` or in its `test/` folder: `{ "answers": [{ "host", "path", "match"?, "status"?, "contentType"?, "file" }] }`. A request gets the first answer with its server id and a URL starting with the server's base plus `path`; `match` is a text the URL or POST body must contain. Requests without an answer fail with `net-offline`, and the check says how to add one. `useNetAnswers(manifest, answers)` in `src/plugins/headless.ts` does the same for a plugin's own tests; the catalogue build checks every plugin this way. Example: `plugins/street-map` (#280 stage 10), whose `test/` folder has a small made-up town.

Error codes: `net-unknown-host`, `net-method`, `net-offline`, `net-denied`, `net-local`, `net-failed`, `net-status`, `net-type`, `net-too-large`. A plugin that ends its call with one of them gets the app's explanation shown to the user. `net-failed` means the server could not be reached (connection, name lookup, TLS or time-out); a plugin may declare a second server for the same data and try it then, like the street map does with three Overpass instances. Recorded answers can simulate it: `"error": "net-failed"` in an answer makes the request fail with that code.

## Path tools and image filters (#205 stage 3)

Besides generators, a plugin can be a **path tool** (`"type": "pathtool"`: parameters and the selected shapes → shapes that replace them, for example stencil bridges) or an **image filter** (`"type": "imagefilter"`: parameters and the selected image as grayscale → a new grayscale image). Their manifest has `params`, `texts`, `icon`, `host` and dialog version 1 like a generator (fields, sections, „Advanced“, showIf); lists, actions, the drawing surface and `inputs` belong to generators and are refused, `kind` is ignored. Both appear in the toolbox under “From extensions” (the tile asks for a fitting selection first). The dialog shows the fields, a preview (the selection faint with the result on top, or the filtered image), info and issues, “Cancel computation” while it computes, and “Apply”, which changes the document in one undo step. The last values are kept per tool (`kizamubeam.tool.<id>`). AI agents list the tools and their parameters with `list_extensions` (field `tools`) and run them with `run_extension_tool { tool, ids, params }`.

A tool has one function, `apply`, which may run 30 s:

| Kind | Input | Answer |
| --- | --- | --- |
| `pathtool` | `{ params, objects: [{ id, subs }] }`: every selected object except images, its paths in mm in page coordinates (y down), texts as outlines | `{ objects?: [{ from?, subs }], issues?, info? }`: the objects that replace the whole selection; `from` names the input whose layer the object takes (otherwise the first input's) |
| `imagefilter` | `{ params, image: { width, height, data } }`: the selected image in its own resolution (at most 16 million pixels), one gray byte per pixel (0 black … 255 white), row by row from the top left, base64; transparent pixels count as white | `{ image?: { width, height, data }, issues?, info? }`: the new image in the same format, any size up to 8000 pixels a side and 16 million pixels; the image keeps its size in mm, transparency is kept when the pixel size stays the same |

An issue with level `error` means there is nothing to apply (the dialog shows it next to its field); warnings are shown with the result. An answer with `objects: []` removes the selection. `checkPathResult` and `checkFilterResult` in `contract.ts` refuse everything else (unknown `from`, NaN, too many nodes or objects, an image whose data does not have width × height bytes) with `plugin-bad-output`.

In the TypeScript SDK, `definePathTool({ apply })` and `defineImageFilter({ apply })` register a tool, `pixels(image)` decodes the gray bytes and `base64(bytes)` encodes them. In Rust, implement `Plugin::apply(input, params)` (`validate` and `generate` have defaults for tools), with `kzb_plugin::pixels` and `kzb_plugin::base64`.

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

The module exports the following; its only allowed import is `kzb.host_call`, and only a plugin that uses host functions needs it:

| Export | Signature | Meaning |
| --- | --- | --- |
| `memory` | | linear memory |
| `kzb_api` | `() -> i32` | protocol version, `1` |
| `kzb_alloc` | `(len: u32) -> u32` | a buffer the host writes into |
| `kzb_call` | `(fn_ptr, fn_len, in_ptr, in_len: u32) -> i64` | UTF-8 function name and JSON input; returns `(ptr << 32) \| len` of a UTF-8 JSON envelope `{"ok": …}` or `{"error": "code"}`, valid until the next call |

| Import | Signature | Meaning |
| --- | --- | --- |
| `kzb.host_call` | `(name_ptr, name_len, in_ptr, in_len: u32) -> i64` | calls a host function (or `progress`) with UTF-8 name and JSON input; the host writes the JSON envelope into a buffer from `kzb_alloc` and returns `(ptr << 32) \| len`. The buffer belongs to the plugin until its call returns |

The Rust SDK (below) implements this ABI; the example [`plugins/hole-plate`](../plugins/hole-plate) (plate with a pattern of holes) uses it.

## Writing a plugin

Start from a template and change it:

- [`plugins/templates/typescript`](../plugins/templates/typescript): a name tag in TypeScript. `src/index.ts` imports the SDK from [`plugins/sdk/ts`](../plugins/sdk/ts/index.ts): the types (`Params`, `Part`, `SubPath`, `Issue`, `GenResult`), `definePlugin` and shape helpers (`polygon`, `rect`, `circle`, `regular`, `roundedRect`, `mm` for numbers in info rows). It also has `random(seed)` (deterministic random numbers; plugins must give the same result for the same parameters) and a single-stroke font, `strokeText(text, size, { x, y, align, valign, angle })`, for numbers and short labels engraved as open lines (digits, A–Z and a few signs; plugins cannot use the app's fonts). The [jigsaw puzzle](../plugins/jigsaw) is a complete example; [layered art](../plugins/layered-art) (#159) shows a large dialog: a kept image, steps, a sortable colour list with a fixed back plate, a region map to pick levels, and the host functions `trace` and `nest`.
- [`plugins/templates/rust`](../plugins/templates/rust): the same tag in Rust with the crate [`kzb-plugin`](../plugins/sdk/rust) (`plugins/sdk/rust`). Implement the `Plugin` trait (`validate`, `generate` on `serde_json::Value` parameters; optional `view` and `on_change` return `Some(json)`, the default `None` means the plugin has none) and call `export_plugin!(MyPlugin)`; the macro provides the ABI exports. Builders: `Issue::error("code").on("key").value("max", 5)`, `GenResult::new().part(Part::new("tag", subs).at(x, y)).info("area", …).label(json!({ "code": "label" }))`, shapes in `kzb_plugin::geom`. Needs `rustup target add wasm32-unknown-unknown`.

Copy the template folder to `plugins/<your-name>/`, give the pack and the plugin your own ids (reverse domain, for example `io.github.you.coaster`), adjust the parameters and texts in `plugin.json`, then:

```sh
node scripts/plugin-pack.mjs --build plugins/<your-name>   # builds the code and writes dist/<id>.kzp
npm run plugin:check plugins/<your-name>                   # the catalogue's check
```

Install the `.kzp` in the app under Extensions to try it. `build` in `plugin.json` lists the recipes the catalogue runs: `{ "esbuild": "src/index.ts", "out": "dist/plugin.js" }` or `{ "rust": ".", "out": "dist/plugin.wasm" }`; `"code": "@dist/plugin.js"` points at the result. A plugin in `plugins/<name>/` is built from source and published by the catalogue workflow once it is merged.

## Headless runner and check

`runTool(manifest, params, input?)` runs a path tool or image filter once (params checked like the dialog; the input defaults to a sample: a square with a round hole and an open line, or a gray ramp) and returns the issues, info, a summary of the result (objects with their node counts, or the image size), a SHA-256 of it and the full answer. `plugin:check` runs a tool with its defaults on the sample, twice (the results must match) and with every choice.

`src/plugins/headless.ts` runs a plugin's dialog without the app: `runDialog(manifest, steps)` starts with the default parameters, applies each step (a set of field changes, checked against the schema like user input) and returns after each one what the dialog would show: parameters, visible fields, issues with codes, info rows, the parts (key, position, size) and a SHA-256 of the geometry. A step may also press a button: `{ "$action": "<id>", "$selection": [{ name, polys }], "$image": { name, width, height, data } (also for `selectedImage`; with `store` the runner keeps it like the app), "$camera": { width, height, data, bed, empty? } }` (images as a plugin gets them), and `{ "$model": { name, data } }` opens a 3D model (`kzm1:` data) like an import, `{ "$move": { list, from, to } }` drags a row of a sortable list; the state then has the `message`, and every state has the `rows` from `view`. With a drawing surface, `{ "$view": "<id>" }` switches the view, `{ "$surface": [{ type, x, y, hit?, … }, …] }` sends pointer events, `{ "$action": "<id>", "$row": n }` presses a row button, and every state has `surface` (view, state, selected rows and the number of shapes and layers `draw` returned). Use it in plugin tests.

`npm run plugin:check <folder | file.kzp>` checks every plugin of a pack the way the catalogue will:

- the default parameters generate parts without errors (a plugin that is opened with a 3D model first gets a sample model, an octahedron 60 mm across; a dialog that starts with an empty list is first filled by its first action with the selection as input, with a sample selection: a 40 × 30 mm rectangle with a hole),
- every option of every choice and both values of every switch run without a crash, timeout or broken output, and every view of a drawing surface draws,
- two runs give the same geometry (no randomness or clock; use a seed parameter),
- issue codes, parameter labels and `desc` have English texts (warnings).

## Built-in generators as plugins

The built-in generators move to the plugin system (#205, #327). `npm run plugin:core` (`scripts/build-core-plugins.mjs`) builds them as JavaScript plugins from their unchanged source in `src/generators`:

- The generator is bundled with `plugins/core/wrap.ts` and a stand-in for `src/i18n` (`plugins/core/i18n-shim.ts`). A plugin has no language, so `t()` returns the German source text as a marker; the wrapper turns issue texts and info labels into text codes (`plugins/core/codes.ts`) with their values.
- The manifest is generated from the same source: parameters, rules, labels, tooltips and options, plus every `t()` text of the bundled files as a code, translated from `src/locales` into all app languages.
- The app writes numbers in plugin texts in the number format of the interface (QuickJS has no locale).

- Texts the generator composes (a field label with `t('Rad 1')` inside, an info value made of several texts) keep their parts: markers are closed, the wrapper turns them into lists of codes and plain strings, the build script renders static ones (field labels) into every language. The name in the Objects window comes from the generator's own `label()` through `label` and `labels`.

Built so far (`plugins/core/dist/org.kizamubeam.core-generators.kzp`): gear, box, rack, pulley, cam, gear pair, drawer, insert, shelf, disc sphere box with dividers (`box-divided`, with `view` and `onChange`; its error codes come from `Generator.texts`) and the jig (`jig`, a list of workpieces filled from the selection, an image or the camera; the build replaces print-and-cut's `geom` import, which pulls in fonts, by a stub). `npm run test:core-plugins` checks that they give the same dialog, geometry, issues, info, names and 3D poses as the built-in generators for the defaults, every option, every switch and every number at its minimum and maximum, and reports the time. QuickJS is about 10 to 20 times slower than the built-in code: most cases take well under a second, nesting many parts used to take much longer in QuickJS (a gear pair with 400 teeth about 20 s) and now runs in the app through the host function `nest`. The stack model (`stack`) gets its 3D model through `resource`; the wrapper puts it into the generator's own model store. It slices through the host functions `slice` and `region`, finds the place for layer numbers with `region` (`deepest`) and fits curves with `fit`, all at built-in speed; with the parts arranged through `nest` as well, three sizes of a model with 65 000 triangles take 3.7 s instead of 28.6 s (built in about 2 s). The rib model (`ribs`) is built as well: its sections are drawn on the surface (`src/generators/ribsSurface.ts`, the same code built in and in the plugin), set in a selectable list with row buttons and created by buttons with conditions. Section names it suggests are stored as roles (body, leg n, tail), so the name shows in the user's language without storing a translated text. It slices through the same host functions (65 000 triangles, three sizes: 1.8 s instead of 11.5 s, built in 0.7 s). `tn()` texts are collected in both forms; the plugin picks the German plural form by number. Generators without a thickness parameter (gear pair) compute their 3D poses for 3 mm. **The app uses the core pack (#327).** `npm run dev` and `npm run build` build it first; `src/plugins/corePack.ts` bundles it with the app and `src/plugins/core.ts` registers its generators before the editor reads the last project, in place of the built-in ones with the same ids. Everything comes from the plugin: geometry, dialog, parameter migrations of older projects (`migrate`, from `Generator.migrate`), the toolbox tile (`tile` from `Generator.tile`), plug-in joints (`fit`) and the assembly check (`assemblyCheck`). Callers that need a result at once (built-in templates, 3D view, design and assembly check, slot resize) wait for the plugin (`buildGenAsync`, „being computed“ until the answer). Core generators count as built in: no extension name on their parts, and no pack may take their ids, not even one with the core pack's id. The app no longer contains the generator source: `src/generators/builtin.ts` lists it for the pack build and for Node tests (`scripts/builtin-generators.ts`).

## Tests

`npm run test:plugins` runs both runtimes in Node (the hole plate, a JavaScript plugin, the time and memory limits, refused output, host functions from both runtimes), path tools and image filters (`scripts/plugin-tools-test.ts`: manifest, contract, registry, check, applying to the selection, `run_extension_tool`), plugins in packs (`scripts/plugin-packs-test.ts`) the dialog schema with the headless runner (`scripts/plugin-dialog-test.ts`) and both templates (`scripts/plugin-sdk-test.ts`, the Rust one only where the wasm32 target is installed) and network access (`scripts/plugin-net-test.ts`: manifest, host.fetch round trip, the checks of `net.ts` with a fake transport, the generator computing again).
