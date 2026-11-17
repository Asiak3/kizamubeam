// Check the plugins of a pack the way the catalogue will (#205, #335): defaults generate without errors, every
// choice runs, results are deterministic, codes have English texts.
// Aufruf: npm run plugin:check <plugin folder with plugin.json | file.kzp>
import './core-fixtures-env';
import { readFileSync, statSync } from 'node:fs';
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const { parsePack } = await import('../src/packs');
const { checkPlugin } = await import('../src/plugins/headless');

const arg = process.argv[3];
if (!arg) {
  console.error('Usage: npm run plugin:check <plugin folder | file.kzp>');
  process.exit(2);
}
const text: string = statSync(arg).isDirectory() ? buildPluginPack(arg) : readFileSync(arg, 'utf8');
let pack;
try {
  pack = parsePack(text);
} catch (e) {
  console.error(`✗ ${arg}: ${(e as Error).message}`);
  process.exit(1);
}
if (!pack.plugins.length) console.log(`${pack.id}: no plugins`);
let bad = 0;
for (const m of pack.plugins) {
  const r = await checkPlugin(m);
  console.log(`${r.errors.length ? '✗' : '✓'} ${r.id}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  if (r.errors.length) bad++;
}
process.exit(bad ? 1 : 0);
