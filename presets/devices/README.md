# Device presets

One JSON file per device: `<manufacturer>/<model>.json`; generic presets per controller live in `generic/`.
Each file is one entry in the format of a pack's `devices` list (see [docs/packs.md](../../docs/packs.md#device-presets-devices)), plus:

- `id`: the file path without `.json`, with `/` replaced by `.` (e.g. `ortur/laser-master-3.json` → `ortur.laser-master-3`)
- `vendor`: the manufacturer as shown in the list (not needed in `generic/`)
- `source`: where the values come from; please always give one
- `checked`: the date you checked the values against the source (`YYYY-MM-DD`); required for manufacturer presets
- `sourceUrl`, `measured`, `laser`, `features`, `variants`: see docs/packs.md. Use `variants` when one model comes with several laser modules instead of one file per module, and only fill in values a source confirms

The files are bundled into the app at build time and checked like pack presets. Check them with `npm run test:packs`.
