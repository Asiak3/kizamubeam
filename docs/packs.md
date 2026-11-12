# Extension packs (`.kzp`)

An extension pack adds device presets, templates, material library entries and library items (motifs, images, design elements) to KizamuBeam without installing a new version of the app. A pack is a single JSON file. It contains data only, never program code, and KizamuBeam checks every entry before it installs anything.

Install a pack with File → Extensions … → Install …, or drag the `.kzp` file onto the workspace. The same window lists installed packs and removes them. A complete example is [`packs/org.kizamubeam.example.kzp`](../packs/org.kizamubeam.example.kzp).

## Where packs are stored

- Desktop app: the `packs` folder in the settings folder, for example `~/Library/Application Support/org.laserwerk.app/packs` on macOS (“Show folder” opens it). The file is named after the pack id, e.g. `com.example.workshop.kzp`.
- Browser: local storage of the page.

## Format

```json
{
  "format": "kizamubeam-pack",
  "formatVersion": 1,
  "id": "com.example.workshop",
  "version": "1.0.0",
  "minApp": "1.2.1-beta",
  "name": { "en": "Workshop pack", "de": "Werkstatt-Paket" },
  "description": { "en": "…", "de": "…" },
  "author": "Your name",
  "homepage": "https://example.com/workshop-pack",
  "devices": [],
  "templates": [],
  "materials": [],
  "assets": []
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Always `kizamubeam-pack` |
| `formatVersion` | no | Format version, currently `1`. A newer number is refused with a hint to update KizamuBeam. |
| `id` | yes | Unique id in reverse domain style: lowercase letters, digits and hyphens, at least two parts separated by dots, at most 64 characters |
| `version` | yes | Version of the pack, e.g. `1.0.0` or `1.1.0-beta`. Installing a pack with the same id replaces the installed one; the dialog says whether it is an update, the same version or an older one. |
| `minApp` | no | Oldest KizamuBeam version that can use the pack |
| `name` | yes | Name shown in the app, at most 80 characters |
| `description`, `author` | no | Shown in the Extensions window |
| `homepage` | no | An `https://` address, shown as text |
| `devices`, `templates`, `materials`, `assets` | at least one entry in total | The content, described below |

Texts marked as *localised* may be a plain string or an object with one string per language code (`"en"`, `"de"`, …). KizamuBeam shows the interface language, then English, then German, then the first one given.

A pack with a mistake anywhere (unknown firmware, a template that cannot be loaded, duplicate material ids, …) is refused as a whole, so nothing is ever half installed. Unknown fields are ignored.

### Device presets (`devices`)

Each entry appears under “New device from template” (Laser → Device → Devices … and the Set up laser assistant), with the pack name in brackets.

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Localised name, e.g. `"Example Laser 10 W"` |
| `fw` | yes | `fluidnc`, `grbl`, `grblhal`, `marlin` or `smoothie` |
| `bedW`, `bedH` | yes | Work area in mm (10 to 5000) |
| `baud` | no | Baud rate for USB |
| `sMax` | no | S value for 100 % power |
| `rapid`, `accel`, `junction` | no | Rapid speed (mm/min), acceleration (mm/s²) and junction deviation (mm) for time estimates |
| `conn` | no | `serial`, `tcp` or `ws` |
| `tcpPort`, `wsPort` | no | Network ports |
| `airCmd` | no | `M8` or `M7` for air assist |
| `limitSwitches` | no | `yes`, `no` or `unknown` |
| `homeOnConnect` | no | `true` or `false` |
| `source` | no | Where the values come from (shown as a tooltip). Please always give one. |

Start and end scripts, rotary settings, addresses and AI agent limits cannot come from a pack, because they send commands to the machine or are personal settings. Invalid optional values are dropped; the preset keeps the default.

### Templates (`templates`)

Each entry is the content of a `.kzt` file (a project with a `template` entry), as written by File → Save as template …. The easiest way to make one is to save the template in KizamuBeam, open the `.kzt` file in a text editor and paste its content into the list. In a pack, `template.title` and `template.description` may be localised. Parameter names cannot be translated, because formulas refer to them.

Templates appear under “From extensions” in File → New from template …. A template that uses a parametric part (gear, box, …) needs a KizamuBeam version that knows that part; set `minApp` accordingly.

### Materials (`materials`)

Entries in the format of a material library (`.kzm`): `material`, `thickness` (mm or `null`), `title`, `desc`, `settings` (layer settings; at least `mode` `line` or `fill`, other values fall back to defaults) and optionally `img` and `fit`. Give each entry a short `id` that stays the same between versions of the pack.

Materials are copied into the material library when the pack is installed. When the pack is updated, its entries are replaced; an entry that was changed in KizamuBeam belongs to you from then on and is kept. Removing the pack removes its unchanged entries.

### Library items (`assets`)

Motifs, images and design elements for the Library window (Window → Library). They appear there with the pack name, can be searched and inserted like your own items, but cannot be changed or deleted except by removing the pack. Each entry has the content of a `.kza` file, as written by the Library window's “Export …” button, plus an `id`:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | recommended | Short id that stays the same between versions of the pack (otherwise the position in the list) |
| `name` | yes | Localised name, at most 80 characters |
| `category` | no | `motif`, `image`, `element` (design element) or `pattern` (fill pattern); without it `image` for pure images, otherwise `motif` |
| `tags` | no | List of localised keywords for the search |
| `w`, `h` | no | Size in mm, shown in the Library window |
| `pattern` | for patterns | Fill pattern for Pattern fill: `tile` (`w`, `h` in mm and `subs`, the paths centred on 0, 0) and optional `settings` (`repeat`, `shift`, `mirror`, `gapX`, `gapY`, `scale`, `angle`, `wrap`, `output`) |
| `objs` | yes | Objects as in a project file (`m` matrix, `layer` 0 to 31, `shape`), best with their bounding box starting at 0, 0 |
| `images` | for images | Image data by asset id, as `data:image/png;base64,…` (also JPEG, GIF, WebP, BMP); nothing else is accepted |
| `fill` | no | Layers drawn filled in the preview |
| `preview` | no | Small SVG preview; without it KizamuBeam draws one |

Every object is checked: known shape kinds only, valid numbers, layers and paths, images only as embedded data. Formulas (`bind`), visibility conditions (`showIf`), hidden and locked flags are dropped, because they belong to the project an item came from. The example pack has three items (heart, double frame, star).

## Official catalogue

File → Extensions … also shows the official catalogue. It lists the packs in the [`packs/`](../packs) folder of this repository and is published with the website at `https://negurvulkan.github.io/kizamubeam/catalog/catalog.json`. Installing or updating from there needs no file download by hand, and the app shows which installed packs have a newer version.

The catalogue is protected twice: `catalog.json` is signed with an Ed25519 key of its own (not the app updater's key), and it names the SHA-256 checksum of every pack file. KizamuBeam ignores a catalogue whose signature does not match the public key built into the app (`CATALOG_PUBKEY` in `src/catalog.ts`) and refuses a pack whose checksum differs.

To add or update a pack in the catalogue, open a pull request that puts the file into `packs/` as `<id>.kzp` (raise `version` for an update). `npm run test:catalog` checks every pack there. When the pull request is merged, the Pages workflow builds the catalogue (`scripts/build-catalog.ts`), signs it with the repository secret `PACKS_SIGNING_KEY` (`scripts/sign-catalog.mjs`) and publishes it.

A new key pair comes from `node scripts/catalog-keygen.mjs`: the secret part goes into the repository secret `PACKS_SIGNING_KEY`, the public part into `CATALOG_PUBKEY`. App versions with the old public key stop using the catalogue until they are updated.

## Safety

Packs contain data only. KizamuBeam never runs code from a pack, and a pack cannot send anything to the laser. Still, a wrong work area or wrong laser values can damage material or the machine, so only install packs from sources you trust and check the values before the first job.
