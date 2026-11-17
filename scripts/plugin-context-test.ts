// Context for generator plugins (#386): material and work area through host.context, only when declared, part of
// the cache key; opening a plugin with the selection through the action that takes it.
// Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { parsePack } = await import('../src/packs');
const { pluginGenerator } = await import('../src/plugins/generator');
const { runDialog, checkPlugin } = await import('../src/plugins/headless');
const { buildGenAsync, normalizeParams, defaultParams } = await import('../src/generators/index');

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

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function manifest(code: string, extra: Record<string, unknown> = {}) {
  const text = JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.ctx', version: '1.0.0', name: 'Context example',
    plugins: [{
      id: 'com.example.plate', type: 'generator', api: 1, kind: 'part', runtime: 'js', code, sha256: sha(code),
      params: [{ key: 'n', type: 'int', min: 1, max: 9, def: 2 }],
      texts: { en: { name: 'Plate', desc: 'A plate', n: 'Count', noMaterial: 'Pick a layer with a material.', tooBig: 'Larger than the work area.' } },
      ...extra,
    }],
  });
  return parsePack(text).plugins[0];
}

// A plate as wide as the work area allows, with slots of the material thickness
const PLATE = `globalThis.plugin = {
  validate: () => {
    const m = host.context('material');
    return m && m.thickness ? [] : [{ level: 'error', code: 'noMaterial' }];
  },
  generate: (p) => {
    const m = host.context('material'), a = host.context('workArea');
    const w = Math.min(100, a.width), t = m.thickness;
    const sq = (x, y, s) => ({ closed: true, nodes: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });
    return { parts: [{ key: 'p', at: { x: 0, y: 0 }, subs: [sq(0, 0, w), ...Array.from({ length: p.n }, (_, i) => sq(10 + i * 20, 10, t))] }], info: [['t', String(t)], ['w', String(w)], ['nm', String(m.name)]] };
  },
};`;

await test('manifest: context names are checked, declaring them allows host.context', () => {
  const m = manifest(PLATE, { context: ['material', 'workArea', 'material'] });
  assert.deepEqual(m.context, ['material', 'workArea']);
  assert.ok(m.host?.includes('context'));
  assert.throws(() => manifest(PLATE, { context: ['documents'] }), /context/);
  assert.throws(() => manifest(PLATE, { host: ['context'] }), /context/);
  assert.equal(manifest(PLATE).context, undefined);
});

await test('host.context answers the declared material and work area; another material is another result', async () => {
  let ctx: Record<string, unknown> = { material: { name: 'Plywood', thickness: 3, kerf: 0.1, pairPlay: null, slotPlay: null }, workArea: { width: 80, height: 60 } };
  const g = pluginGenerator(manifest(PLATE, { context: ['material', 'workArea'] }), { id: 'p', name: 'p' }, { context: (w) => ctx[w] ?? null });
  try {
    const p = normalizeParams(g, defaultParams(g));
    let r = await buildGenAsync(g, p);
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.info.slice(0, 3), [['t', '3'], ['w', '80'], ['nm', 'Plywood']]);
    ctx = { ...ctx, material: { name: 'Acrylic', thickness: 4, kerf: null, pairPlay: null, slotPlay: null } };
    r = await buildGenAsync(g, p);
    assert.deepEqual(r.info.slice(0, 3), [['t', '4'], ['w', '80'], ['nm', 'Acrylic']], 'computed again for the new material');
    ctx = { ...ctx, workArea: { width: 400, height: 300 } };
    assert.deepEqual((await buildGenAsync(g, p)).info[1], ['w', '100'], 'and for another work area');
    // A layer without material: the plugin's own issue
    ctx = { ...ctx, material: null };
    assert.deepEqual((await buildGenAsync(g, p)).issues.map((i) => i.code), ['noMaterial']);
  } finally {
    g.dispose();
  }
});

await test('undeclared context is not reachable', async () => {
  const onlyArea = manifest(PLATE, { context: ['workArea'] });
  const g = pluginGenerator(onlyArea, { id: 'p', name: 'p' }, { context: () => ({ thickness: 3 }) });
  try {
    // validate asks for the material, which the manifest did not declare: a bad input, not the data
    const r = await buildGenAsync(g, normalizeParams(g, defaultParams(g)));
    assert.match(r.issues.map((i) => i.code).join(), /host-bad-input|plugin-crash/);
  } finally {
    g.dispose();
  }
  const none = pluginGenerator(manifest(PLATE), { id: 'p', name: 'p' }, { context: () => ({ thickness: 3 }) });
  try {
    const r = await buildGenAsync(none, normalizeParams(none, defaultParams(none)));
    assert.match(r.issues.map((i) => i.code).join(), /host-not-allowed|plugin-crash/);
  } finally {
    none.dispose();
  }
});

await test('headless runs give a sample context; the check also runs without context', async () => {
  const m = manifest(PLATE, { context: ['material', 'workArea'] });
  const [d] = await runDialog(m);
  assert.deepEqual(d.info.slice(0, 2), [['t', '3'], ['w', '100']]);
  const [own] = await runDialog(m, [], { context: { workArea: { width: 50, height: 50 } } });
  assert.deepEqual(own.info[1], ['w', '50']);
  const report = await checkPlugin(m);
  assert.deepEqual(report.errors, []);
  // A plugin that crashes without material is reported
  const careless = manifest(PLATE.replace("return m && m.thickness ? [] : [{ level: 'error', code: 'noMaterial' }];", 'return [];'), { context: ['material', 'workArea'] });
  assert.match((await checkPlugin(careless)).errors.join(' '), /without context/);
});

// Opened with the selection: the action that takes it fills the parameters
const LIST = `globalThis.plugin = {
  validate: (p) => (p.items ? [] : [{ level: 'error', code: 'empty' }]),
  generate: (p) => ({ parts: [{ key: 'p', at: { x: 0, y: 0 }, subs: [{ closed: true, nodes: [{x:0,y:0},{x:10,y:0},{x:0,y:10}] }] }], info: [['items', p.items]] }),
  onEvent: ({ action, inputs }) => action === 'take' ? { patch: { items: inputs.selection.map((s) => s.name).join(',') } } : null,
};`;

await test('opening with the selection runs the action that takes it', async () => {
  const extra = {
    params: [{ key: 'items', type: 'data', def: '' }],
    dialog: { version: 2, actions: [{ id: 'take', label: 'take', inputs: ['selection'] }] },
    inputs: [{ kind: 'selection', action: 'take' }],
  };
  const m = manifest(LIST, extra);
  assert.deepEqual(m.inputs, [{ kind: 'selection', action: 'take' }]);
  assert.throws(() => manifest(LIST, { ...extra, inputs: [{ kind: 'selection', action: 'nope' }] }), /action/);
  const g = pluginGenerator(m, { id: 'p', name: 'p' });
  try {
    assert.deepEqual(g.inputs, [{ kind: 'selection' }]);
    const sel = [{ name: 'A', polys: [[[0, 0], [5, 0], [0, 5]]] }, { name: 'B', polys: [] }];
    assert.deepEqual(await g.fromInputs!({ selection: sel as never }), { items: 'A,B' });
    assert.equal(await g.fromInputs!({ selection: [] }), undefined);
  } finally {
    g.dispose();
  }
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('plugin context tests passed');
