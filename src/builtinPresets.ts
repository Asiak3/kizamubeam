// Built-in device presets: one JSON file per device in presets/devices/<manufacturer>/<model>.json, in the
// same format as an entry in a pack's `devices` list (docs/packs.md). Vite bundles them at build time, so
// they work offline. The esbuild test runners have no import.meta.glob; they pass the files in with
// setBuiltinPresetFiles (see scripts/packs-test.ts).

let override: Record<string, unknown> | null = null;

/** For tests: use these files instead of the bundled ones */
export function setBuiltinPresetFiles(files: Record<string, unknown> | null) {
  override = files;
}

/** Raw preset files by path */
export function builtinPresetFiles(): Record<string, unknown> {
  if (override) return override;
  try {
    return import.meta.glob<unknown>('../presets/devices/**/*.json', { eager: true, import: 'default' });
  } catch {
    return {};
  }
}
