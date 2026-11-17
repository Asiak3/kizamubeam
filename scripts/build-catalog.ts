// Katalog der Erweiterungen bauen: prüft alle Pakete in packs/ und schreibt catalog.json samt Paketdateien in den
// Zielordner (beim Veröffentlichen der Website: website/catalog). Signiert wird danach mit sign-catalog.mjs.
// Plugin packs are built from their source in plugins/<folder>/plugin.json (scripts/plugin-pack.mjs --build: Rust
// with cargo, TypeScript with esbuild), so the catalogue never ships code that was not built from this repository;
// every plugin must pass the catalogue check (src/plugins/headless.ts).
// Aufruf: node scripts/run-ts.mjs scripts/build-catalog.ts <Zielordner> [--no-build]
//   --no-build: use the code files already in plugins/*/dist (local runs without Rust)
import './core-fixtures-env';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildCatalog } = await import('../src/catalog');
const { parsePack } = await import('../src/packs');
const { checkPlugin } = await import('../src/plugins/headless');

// argv: node, run-ts.mjs, dieses Skript, Zielordner
const out = process.argv[3];
const noBuild = process.argv.includes('--no-build');
if (!out) throw new Error('Aufruf: node scripts/run-ts.mjs scripts/build-catalog.ts <Zielordner> [--no-build]');
const root = new URL('../', import.meta.url).pathname;
const REPO = 'https://github.com/KizamuBeam/kizamubeam/tree/main';

const files: [string, string][] = [];
const copies: [string, string][] = [];
const src = join(root, 'packs');
for (const n of readdirSync(src).filter((f) => f.endsWith('.kzp'))) {
  files.push([n, readFileSync(join(src, n), 'utf8')]);
  copies.push([join(src, n), n]);
}
// Plugin packs from source
const sources: Record<string, string> = {};
const pluginRoot = join(root, 'plugins');
for (const d of readdirSync(pluginRoot, { withFileTypes: true })) {
  const dir = join(pluginRoot, d.name);
  if (!d.isDirectory() || !existsSync(join(dir, 'plugin.json'))) continue;
  execFileSync('node', [join(root, 'scripts/plugin-pack.mjs'), ...(noBuild ? [] : ['--build']), dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  const id = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')).id as string;
  const name = `${id}.kzp`;
  if (files.some(([n]) => n === name)) throw new Error(`${name} exists in packs/ and plugins/${d.name}`);
  files.push([name, readFileSync(join(dir, 'dist', name), 'utf8')]);
  copies.push([join(dir, 'dist', name), name]);
  sources[id] = `${REPO}/plugins/${d.name}`;
}
// Every plugin must pass the check before it goes into the catalogue
for (const [name, text] of files) {
  for (const m of parsePack(text, '9999.0.0').plugins) {
    const r = await checkPlugin(m);
    for (const w of r.warnings) console.log(`${name} ${m.id}: warning: ${w}`);
    if (r.errors.length) throw new Error(`${name} ${m.id}: ${r.errors.join('; ')}`);
  }
}
const json = await buildCatalog(files, new Date().toISOString(), sources);
mkdirSync(out, { recursive: true });
for (const [from, n] of copies) copyFileSync(from, join(out, n));
writeFileSync(join(out, 'catalog.json'), json);
console.log(`Katalog mit ${files.length} Paket(en) in ${out}`);
