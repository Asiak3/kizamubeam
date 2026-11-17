// Plugin SDK and templates (#206): both templates build from source and pass the catalogue check without warnings.
// The Rust template is skipped when cargo or the wasm32 target is missing.
// Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const { parsePack } = await import('../src/packs');
const { checkPlugin, runDialog } = await import('../src/plugins/headless');

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

async function checkTemplate(dir: string) {
  // Build in a child process: esbuild cannot run inside this bundled test
  execFileSync('node', ['scripts/plugin-pack.mjs', '--build', dir], { stdio: 'inherit' });
  const pack = parsePack(buildPluginPack(dir));
  assert.equal(pack.plugins.length, 1);
  const r = await checkPlugin(pack.plugins[0]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  // The hole switch hides its diameter and changes the geometry
  const [on, off] = await runDialog(pack.plugins[0], [{ hole: false }]);
  assert.ok(on.visible.includes('holeDia'));
  assert.ok(!off.visible.includes('holeDia'));
  assert.notEqual(on.geometry, off.geometry);
  // A corner radius larger than half the tag is reported with the template's own code
  const [, big] = await runDialog(pack.plugins[0], [{ corner: 50 }]);
  assert.ok(big.issues.some((i) => i.code === 'corner-too-large'));
  return pack.plugins[0];
}

const ts = await (async () => {
  let m: Awaited<ReturnType<typeof checkTemplate>> | undefined;
  await test('TypeScript template builds and passes the check', async () => void (m = await checkTemplate('plugins/templates/typescript')));
  return m;
})();

const hasRust = (() => {
  try {
    return execFileSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' }).includes('wasm32-unknown-unknown');
  } catch {
    return false;
  }
})();
if (hasRust) {
  await test('Rust template builds and gives the same tag as the TypeScript template', async () => {
    const rs = await checkTemplate('plugins/templates/rust');
    if (!ts) return;
    const a = await runDialog(ts);
    const b = await runDialog(rs);
    assert.deepEqual(b[0].parts.map((p) => p.box), a[0].parts.map((p) => p.box));
  });
} else console.log('skip Rust template (no wasm32-unknown-unknown target)');

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
