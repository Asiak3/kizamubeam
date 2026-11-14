// Vergleichsdaten für den Rust-Kern erzeugen (siehe core-fixtures.ts)
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'kizamubeam-'));
const out = join(dir, 'fixtures.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('./core-fixtures.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  loader: { '.woff': 'empty', '.woff2': 'empty' },
  define: { 'import.meta.url': JSON.stringify(import.meta.url) },
  logLevel: 'error',
});
try {
  await import(pathToFileURL(out).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
