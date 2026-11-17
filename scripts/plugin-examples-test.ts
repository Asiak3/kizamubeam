// The plugins in plugins/ that are written in TypeScript (#307–#309): built from source, the catalogue check, and
// the geometry each one promises.
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
const { checkPlugin } = await import('../src/plugins/headless');
const { pluginGenerator } = await import('../src/plugins/generator');
const G = await import('../src/generators/index');
const font = await import('../plugins/sdk/ts/font');

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

/** Build a plugin folder (esbuild in a child process) and return its generator */
async function load(dir: string) {
  execFileSync('node', ['scripts/plugin-pack.mjs', '--build', dir], { stdio: 'ignore' });
  const m = parsePack(buildPluginPack(dir)).plugins[0];
  const r = await checkPlugin(m);
  assert.deepEqual(r.errors, [], `${dir}: catalogue check`);
  assert.deepEqual(r.warnings, [], `${dir}: catalogue check warnings`);
  return pluginGenerator(m, { id: dir, name: dir });
}
const run = (g: Awaited<ReturnType<typeof load>>, p: Record<string, unknown> = {}) => G.buildGenAsync(g, G.normalizeParams(g, { ...G.defaultParams(g), ...p }));

await test('stroke font: every digit and capital has a glyph, width and alignment', () => {
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.-°') assert.ok(font.hasGlyph(ch), ch);
  assert.ok(font.hasGlyph('a'), 'lower case is drawn as upper case');
  assert.equal(font.textWidth('8', 6), 4);
  const c = font.strokeText('10', 6, { align: 'center', valign: 'middle' });
  const xs = c.flatMap((s) => s.nodes.map((n) => n.x));
  const ys = c.flatMap((s) => s.nodes.map((n) => n.y));
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 0.8, 'centred');
  assert.ok(Math.abs(Math.min(...ys) + 3) < 1e-9 && Math.abs(Math.max(...ys) - 3) < 1e-9, 'middle');
  assert.ok(c.every((s) => !s.closed || s.nodes.length > 2));
});

await test('jigsaw (#307): one path per grid line, seed decides the tabs, frame and numbers', async () => {
  const g = await load('plugins/jigsaw');
  const r = await run(g);
  assert.equal(r.issues.length, 0);
  assert.equal(r.parts.length, 1);
  const subs = r.parts[0].shape.subs;
  // Border plus 3 inner rows and 5 inner columns for the default 6 × 4
  assert.equal(subs.length, 1 + 3 + 5);
  assert.ok(subs[0].closed);
  assert.ok(subs.slice(1).every((s) => !s.closed), 'inner lines are open, so no edge is cut twice');
  assert.deepEqual(r.info[0], ['Pieces', '24']);
  // Every inner line runs from border to border
  for (const s of subs.slice(1)) {
    const a = s.nodes[0], b = s.nodes.at(-1)!;
    assert.ok(Math.abs(Math.abs(a.x) - 100) < 1e-6 || Math.abs(Math.abs(a.y) - 75) < 1e-6);
    assert.ok(Math.abs(Math.abs(b.x) - 100) < 1e-6 || Math.abs(Math.abs(b.y) - 75) < 1e-6);
  }
  const same = await run(g);
  assert.deepEqual(same.parts[0].shape.subs, subs, 'same seed, same puzzle');
  const other = await run(g, { seed: 2 });
  assert.notDeepEqual(other.parts[0].shape.subs, subs, 'another seed, other tabs');
  const framed = await run(g, { frame: true, numbers: true });
  assert.deepEqual(framed.parts.map((p) => p.shape.part), ['puzzle', 'frame']);
  assert.ok((framed.parts[0].marks?.length ?? 0) >= 24, 'piece numbers engraved');
  const tiny = await run(g, { cols: 50, rows: 50, width: 100, height: 100 });
  assert.equal(tiny.parts.length, 0);
  assert.ok(tiny.issues.some((i) => i.code === 'pieces-too-small'));
  for (const shape of ['round', 'square']) assert.equal((await run(g, { shape })).issues.length, 0, shape);
  g.dispose();
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
