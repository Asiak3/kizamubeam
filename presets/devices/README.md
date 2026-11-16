# Device presets

One JSON file per device: `<manufacturer>/<model>.json`; generic presets per controller live in `generic/`.
Each file is one entry in the format of a pack's `devices` list (see [docs/packs.md](../../docs/packs.md#device-presets-devices)), plus:

- `id`: the file path without `.json`, with `/` replaced by `.` (e.g. `ortur/laser-master-3.json` → `ortur.laser-master-3`)
- `vendor`: the manufacturer as shown in the list (not needed in `generic/`)
- `source`: where the values come from; please always give one

The files are bundled into the app at build time and checked like pack presets. Check them with `npm run test:packs`.
