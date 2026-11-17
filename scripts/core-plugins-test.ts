// Built-in generators built as plugins (#205, #327): built from their unchanged source, run in QuickJS, they must
// give the same dialog, geometry, issues, info, names and poses as the built-in generators.
// Aufruf: npm run test:core-plugins (builds plugins/core/dist first)
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { parsePack } = await import('../src/packs');
const { pluginGenerator } = await import('../src/plugins/generator');
const { checkPlugin } = await import('../src/plugins/headless');
const G = await import('../src/generators/index');
const { assemblyPoses, genThickness } = await import('../src/view3d/poses');

const pack = parsePack(readFileSync(new URL('../plugins/core/dist/org.kizamubeam.core-generators.kzp', import.meta.url), 'utf8'));

let failed = 0;
/** ONLY=<text> runs only the tests whose name contains it */
async function test(name: string, fn: () => Promise<void> | void) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

/**
 * Numbers equal within 0.1 µm: QuickJS and V8 may differ in the last bit of sin/cos, and curve fitting within a
 * tolerance (cam: 4 µm) can carry that a little further
 */
function close(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= 1e-4, `${path}: ${a} ≠ ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, `${path}: length`);
    a.forEach((x, i) => close(x, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort();
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
    assert.deepEqual(ka, kb, `${path}: keys`);
    for (const k of ka) close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  assert.equal(a, b, path);
}

const timings: string[] = [];
const SLOW_MS = 150;
async function same(id: string, cases: Record<string, unknown>[]) {
  const core = G.getGenerator(id)!;
  const m = pack.plugins.find((x) => x.id === id)!;
  const plug = pluginGenerator(m, { id: pack.id, name: 'core' });
  try {
    // Dialog: same fields, labels, options and rules
    assert.deepEqual(
      plug.schema.map((s) => [s.key, s.type, s.type === 'data' ? '' : s.label, s.title ?? '', s.advanced ?? false, JSON.stringify(s.showIf ?? null), s.type === 'enum' ? s.options : null]),
      core.schema.map((s) => [s.key, s.type, s.type === 'data' ? '' : s.label, s.title ?? '', s.advanced ?? false, JSON.stringify(s.showIf ?? null), s.type === 'enum' ? s.options : null]),
    );
    assert.equal(plug.name, core.name);
    let tCore = 0, tPlug = 0, slow = 0;
    for (const raw of cases) {
      const p = G.normalizeParams(core, raw);
      let t0 = performance.now();
      const a = G.buildGen(core, p);
      const dt = performance.now() - t0;
      // Cases that take long already built in (extreme sizes, nesting many parts) take 10–20 times as long in
      // QuickJS; they are left out to keep the test short
      if (dt > SLOW_MS) {
        slow++;
        continue;
      }
      tCore += dt;
      t0 = performance.now();
      const b = await G.buildGenAsync(plug, p);
      tPlug += performance.now() - t0;
      const what = JSON.stringify(raw);
      assert.deepEqual(b.issues.map((i) => [i.key, i.level, i.msg]), a.issues.map((i) => [i.key, i.level, i.msg]), `${what}: issues`);
      assert.deepEqual(b.info, a.info, `${what}: info`);
      close(b.parts.map((x) => [x.shape.part, x.at, x.shape.subs, x.marks]), a.parts.map((x) => [x.shape.part, x.at, x.shape.subs, x.marks]), `${what}: parts`);
      // Generators without a thickness parameter compute poses for 3 mm in the plugin (the 3D view's default)
      if (core.poses && a.parts.length) close(plug.poses!(p, 3), assemblyPoses(id, p, genThickness(p, 3)), `${what}: poses`);
      if (core.view) assert.deepEqual(plug.view!(p), core.view(p), `${what}: view`);
      if (a.parts.length) {
        assert.equal(plug.label(p), core.label(p), `${what}: label`);
        for (const x of a.parts) if (x.shape.part) assert.equal(plug.label(p, x.shape.part), core.label(p, x.shape.part), `${what}: label of ${x.shape.part}`);
      }
    }
    timings.push(`${id}: ${cases.length - slow} cases${slow ? `, ${slow} slow left out` : ''}, built-in ${tCore.toFixed(0)} ms, plugin ${tPlug.toFixed(0)} ms (QuickJS, incl. start)`);
  } finally {
    plug.dispose();
  }
}

await test('gear as a plugin: same dialog, geometry, issues, info and name', () =>
  same('gear', [
    {},
    { teeth: 9 },
    { teeth: 5 },
    { teeth: 60, module: 1.5, pressureAngle: 14.5, backlash: 0.2 },
    { profileShift: 0.6 },
    { profileShift: 1, clearance: 0.1 },
    { backlash: 3 },
    { teeth: 40, boreDia: 8 },
    ...G.getGenerator('gear')!.schema.filter((s) => s.type === 'enum').flatMap((s) => (s.type === 'enum' ? s.options.map(([v]) => ({ teeth: 48, boreDia: 10, [s.key]: v })) : [])),
  ]));

await test('box as a plugin: same dialog, geometry, issues, info and poses', () =>
  same('box', [
    {},
    { top: 'closed' },
    { sizeMode: 'inner', width: 120, depth: 90, height: 40 },
    { partLayout: 'rows' },
    { thickness: 15, width: 50, depth: 50, height: 50 },
    { finger: 2, thickness: 4 },
    { clearance: 1, finger: 3 },
    { kerf: 0, clearance: -0.1, top: 'closed', width: 300, depth: 200, height: 150 },
  ]));

/** Defaults, every option of every choice, every switch flipped, every number at its minimum and maximum */
function sweep(id: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{}];
  for (const s of G.getGenerator(id)!.schema) {
    if (s.type === 'enum') for (const [v] of s.options) if (v !== s.def) out.push({ [s.key]: v });
    if (s.type === 'bool') out.push({ [s.key]: !s.def });
    if ('min' in s) out.push({ [s.key]: s.min }, { [s.key]: s.max });
  }
  return out;
}

for (const id of ['rack', 'pulley', 'cam', 'gearpair', 'drawer', 'insert', 'shelf', 'discsphere'])
  await test(`${id} as a plugin: same dialog, geometry, issues, info and poses`, () => same(id, sweep(id)));

await test('box-divided as a plugin: same dialog, geometry, suggestions; onChange with patch and question', async () => {
  await same('box-divided', [...sweep('box-divided'), { compartmentsX: 3, ratiosX: '1:2:1' }, { ratiosY: '30mm:*' }, { ratiosX: '1:0' }, { ratiosX: '(1' }]);
  const core = G.getGenerator('box-divided')!;
  const plug = pluginGenerator(pack.plugins.find((x) => x.id === 'box-divided')!, { id: pack.id, name: 'core' });
  try {
    for (const [key, old, raw] of [
      ['compartmentsX', 3, { compartmentsX: 4, ratiosX: '1:2:1' }],
      ['compartmentsX', 4, { compartmentsX: 2, ratiosX: '1:2:1:1' }],
      ['compartmentsX', 4, { compartmentsX: 2, ratiosX: '10mm:2:3:4' }],
      ['compartmentsY', 2, { compartmentsY: 2 }],
      ['width', 100, { width: 120 }],
    ] as const) {
      const p = G.normalizeParams(core, raw);
      assert.deepEqual(await plug.onChange!(key, old, p) ?? null, core.onChange!(key, old, p) ?? null, `${key} ${old} → ${JSON.stringify(raw)}`);
    }
    const asked = await plug.onChange!('compartmentsX', 4, G.normalizeParams(core, { compartmentsX: 2, ratiosX: '10mm:2:3:4' }));
    assert.deepEqual(asked, { ask: { question: 'Diese Fachwerte werden entfernt: 3 : 4. Fortfahren?', options: [{ label: 'OK', patch: { ratiosX: '10mm:2' } }] } });
  } finally {
    plug.dispose();
  }
});

const square = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const selected = [
  { name: 'Coaster', polys: [square(0, 0, 40, 40)] },
  { name: 'Tag', polys: [square(10, 10, 60, 25), square(15, 15, 5, 5)] },
];

await test('jig as a plugin: same dialog, geometry and rows; adding the selection with an action', async () => {
  const core = G.getGenerator('jig')!;
  const shapes = (await core.onEvent!({ action: 'fromSelection', inputs: { selection: selected } }, G.normalizeParams(core, {})))!.patch!.shapes;
  await same('jig', [...sweep('jig'), { shapes }, { shapes, plate: 'size', width: 60, height: 40 }, { shapes, notch: 'two', numbers: false }]);
  const plug = pluginGenerator(pack.plugins.find((x) => x.id === 'jig')!, { id: pack.id, name: 'core' });
  try {
    assert.deepEqual(plug.lists, core.lists);
    assert.deepEqual(plug.actions, core.actions);
    for (const raw of [{}, { shapes }]) {
      const p = G.normalizeParams(core, raw);
      for (const selection of [selected, []])
        assert.deepEqual(await plug.onEvent!({ action: 'fromSelection', inputs: { selection } }, p), await core.onEvent!({ action: 'fromSelection', inputs: { selection } }, p));
    }
  } finally {
    plug.dispose();
  }
});

await test('all pass the catalogue check', async () => {
  for (const m of pack.plugins) {
    const r = await checkPlugin(m);
    assert.deepEqual(r.errors, [], m.id);
  }
});

for (const s of timings) console.log(`     ${s}`);
if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
