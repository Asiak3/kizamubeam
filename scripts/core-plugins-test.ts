// Built-in generators built as plugins (#205 stage 1 proof): gear and box from their unchanged source, run in
// QuickJS, must give the same geometry, issues, info and poses as the built-in generators.
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
const { assemblyPoses } = await import('../src/view3d/poses');

const pack = parsePack(readFileSync(new URL('../plugins/core/dist/org.kizamubeam.core-generators.kzp', import.meta.url), 'utf8'));

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

/** Numbers equal within 1e-9 (QuickJS and V8 may differ in the last bit of sin/cos) */
function close(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)), `${path}: ${a} ≠ ${b}`);
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
    let tCore = 0, tPlug = 0;
    for (const raw of cases) {
      const p = G.normalizeParams(core, raw);
      let t0 = performance.now();
      const a = G.buildGen(core, p);
      tCore += performance.now() - t0;
      t0 = performance.now();
      const b = await G.buildGenAsync(plug, p);
      tPlug += performance.now() - t0;
      const what = JSON.stringify(raw);
      assert.deepEqual(b.issues.map((i) => [i.key, i.level, i.msg]), a.issues.map((i) => [i.key, i.level, i.msg]), `${what}: issues`);
      assert.deepEqual(b.info, a.info, `${what}: info`);
      close(b.parts.map((x) => [x.shape.part, x.at, x.shape.subs, x.marks]), a.parts.map((x) => [x.shape.part, x.at, x.shape.subs, x.marks]), `${what}: parts`);
      if (core.poses && a.parts.length) close(plug.poses!(p, 3), assemblyPoses(id, p, 3), `${what}: poses`);
      if (id === 'gear') assert.equal(plug.label(p), core.label(p), `${what}: label`);
    }
    timings.push(`${id}: ${cases.length} cases, built-in ${tCore.toFixed(0)} ms, plugin ${tPlug.toFixed(0)} ms (QuickJS, incl. start)`);
  } finally {
    plug.dispose();
  }
}

await test('gear as a plugin: same dialog, geometry, issues and info', () =>
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

await test('both pass the catalogue check', async () => {
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
