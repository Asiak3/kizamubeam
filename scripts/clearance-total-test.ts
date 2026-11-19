// Clearance = total play of the joint (#402): box, drawer and box with dividers. Saved projects keep their geometry
// (migrate doubles the clearance that was per side; the box with dividers keeps the old play of its dividers), new
// boxes get the field as total play everywhere. Aufruf: npm run test:generators
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import type { Generator, Params } from '../src/generators/types';
const { normalizeParams } = await import('../src/generators/index');
const { BOX } = await import('../src/generators/box');
const { DRAWER } = await import('../src/generators/drawer');
const { FINGERBOX } = await import('../src/generators/fingerbox');

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const round = (x: unknown) => JSON.parse(JSON.stringify(x), (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(round(x))).digest('hex').slice(0, 16);
/** Parts of a generator for the given parameters, as a saved project of version `from` opens today */
const parts = (g: Generator, raw: Params, from = g.version ?? 1) => {
  const p = normalizeParams(g, g.migrate && from < (g.version ?? 1) ? g.migrate(raw, from) : raw);
  return (g.generate(p) as { parts: unknown[] }).parts;
};

/** Saved projects from before #402: generator, its version then and parameter sets */
const OLD: [Generator, number, Params[]][] = [
  [BOX, 2, [-1, -0.5, 0, 0.1, 0.5, 2].flatMap((clearance) => (['open', 'closed'] as const).flatMap((top) => [0, 0.15].map((kerf) =>
    ({ sizeMode: 'outer', width: 120, depth: 80, height: 60, thickness: 3, top, finger: 10, clearance, kerf, partLayout: 'rows' }))))],
  [DRAWER, 2, [-0.5, 0, 0.2, 1].flatMap((clearance) => [0, 0.1].map((kerf) => ({ ...normalizeParams(DRAWER, {}), clearance, kerf, partLayout: 'packed' })))],
  [FINGERBOX, 3, [-0.5, 0, 0.1, 0.5].flatMap((clearance) => (['current', 'legacy'] as const).flatMap((jointLayout) => (['open', 'closed'] as const).flatMap((top) => [0, 0.1].map((kerf) =>
    ({ ...normalizeParams(FINGERBOX, {}), width: 120, depth: 90, height: 50, compartmentsX: 3, compartmentsY: 2, dividerDrop: 10, top, clearance, kerf, jointLayout, partLayout: 'rows' })))))],
];
/** Hashes of their parts, taken with the code from before #402 */
const PINS: Record<string, string> = { box: 'd0f6b41911e39e34', drawer: '5a1fecdab2420dd6', 'box-divided': '37b0ff070c448d1c' };

test('saved boxes, drawers and boxes with dividers keep their geometry', () => {
  const got: Record<string, string> = {};
  for (const [g, from, sets] of OLD) got[g.id] = hash(sets.map((p) => parts(g, p, from)));
  assert.deepEqual(got, PINS);
});

const { panelPolys } = await import('../src/generators/box');
const { makeDividers } = await import('../src/generators/fingerbox-dividers');
const { edgeRuns, panelCut } = await import('../src/generators/panelJoints');
type P = { x: number; y: number };
/** Sorted distinct coordinates of an outline along one axis */
const coords = (pts: P[], k: 'x' | 'y') => [...new Set(pts.map((q) => Math.round(q[k] * 1e6) / 1e6))].sort((a, b) => a - b);

test('new box: a finger and its gap differ by the clearance (total play)', () => {
  // The fields of an edge: inner fingers 0.2 narrower, inner gaps 0.2 wider, so a finger sits in its gap with 0.4
  const fields = (play: number) => edgeRuns(120, 3, { pattern: 'A' }, false, 10, play).filter((r) => !r.corner).map((r) => ({ full: r.full, w: r.s1 - r.s0 }));
  const a = fields(0), b = fields(0.4);
  assert.equal(a.length, b.length);
  assert.ok(a.length > 4);
  for (const [i, f] of b.entries()) assert.ok(Math.abs(f.w - a[i].w - (f.full ? -0.2 : 0.2)) < 1e-9, `${i}: ${f.w - a[i].w}`);
  // The box takes the clearance as it is
  const box = (clearance: number) => panelPolys({ sizeMode: 'outer', width: 120, depth: 80, height: 60, thickness: 3, top: 'closed', finger: 10, clearance, kerf: 0 });
  const plate = box(0.4).find((p) => p.key === 'bottom')!;
  assert.deepEqual(round(plate.pts), round(panelCut({ key: 'bottom', a: plate.a, b: plate.b, edges: [{ pattern: 'A' }, { pattern: 'A' }, { pattern: 'A' }, { pattern: 'A' }], corners: false }, 3, 10, 0.4, 0)));
});

test('new box with dividers: the teeth and slots of the dividers get the clearance as total play, like the corners', () => {
  const p = { width: 120, depth: 90, height: 50, thickness: 3, finger: 10, compartmentsX: 3, compartmentsY: 1, ratiosX: '', ratiosY: '', dividerHeight: 40, top: 'open' as const };
  const d0 = makeDividers({ ...p, clearance: 0 }), d4 = makeDividers({ ...p, clearance: 0.4 });
  // Bottom slot: as long as the tooth's field, 0.4 wider than the thickness; the tooth 0.4 shorter than the slot
  const span = (pts: P[], k: 'x' | 'y') => Math.max(...pts.map((q) => q[k])) - Math.min(...pts.map((q) => q[k]));
  const slot = (d: typeof d0) => d.holes.bottom[0].nodes;
  assert.ok(Math.abs(span(slot(d4), 'x') - 3.4) < 1e-9, `slot width ${span(slot(d4), 'x')}`);
  assert.ok(Math.abs(span(slot(d4), 'y') - span(slot(d0), 'y')) < 1e-9, 'slot length stays');
  // The teeth along the bottom edge of the divider (y = height / 2 in its own coordinates)
  const teeth = (d: typeof d0) => coords(d.dividers[0].outline.nodes.filter((q) => Math.abs(q.y - 40 / 2) < 1e-9), 'x');
  const t0 = teeth(d0), t4 = teeth(d4);
  const moved = t0.map((x, i) => Math.abs(t4[i] - x)).filter((dx) => dx > 1e-9);
  assert.ok(moved.length > 0 && moved.every((dx) => Math.abs(dx - 0.2) < 1e-9), JSON.stringify(moved));
  // dividerClearance (saved boxes) replaces the clearance for the dividers only
  assert.deepEqual(round(makeDividers({ ...p, clearance: 0.8, dividerClearance: 0.4 })), round(d4));
  // New boxes have none: the field is the total play everywhere
  assert.equal(normalizeParams(FINGERBOX, {}).dividerClearance, '');
  assert.ok(FINGERBOX.schema.find((s) => s.key === 'dividerClearance')!.resetOnNew);
});

test('migrate: clearance doubled, the dividers of a saved box keep theirs; the old maximum fits the new range', () => {
  assert.deepEqual(FINGERBOX.migrate!({ clearance: 0.3, jointLayout: 'current', partLayout: 'rows' }, 3), { clearance: 0.6, dividerClearance: '0.3', jointLayout: 'current', partLayout: 'rows' });
  assert.deepEqual(BOX.migrate!({ clearance: -0.25, partLayout: 'rows' }, 2), { clearance: -0.5, partLayout: 'rows' });
  assert.deepEqual(DRAWER.migrate!({ clearance: 0.5, partLayout: 'packed' }, 2), { clearance: 1, partLayout: 'packed' });
  // Up to date: nothing changes
  assert.deepEqual(BOX.migrate!({ clearance: 0.3, partLayout: 'nest' }, 3), { clearance: 0.3, partLayout: 'nest' });
  for (const g of [BOX, DRAWER, FINGERBOX]) {
    const s = g.schema.find((x) => x.key === 'clearance') as { min: number; max: number };
    assert.deepEqual([s.min, s.max], [-2, 4], g.id);
  }
});

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { lastRaw } = await import('../src/generators/dialog');
const { INSERT } = await import('../src/generators/insert');

test('remembered dialog values from before #402 are doubled once, also when they come back through sync', () => {
  mem.set('kizamubeam.gen.box', JSON.stringify({ clearance: 0.1, finger: 8 }));
  assert.equal(lastRaw(BOX).clearance, 0.2);
  assert.equal(lastRaw(BOX).clearance, 0.2, 'only once');
  assert.equal(JSON.parse(mem.get('kizamubeam.gen.box')!)._playTotal, true, 'the mark is stored with the values (they are synced)');
  mem.set('kizamubeam.gen.box-divided', JSON.stringify({ clearance: -0.2 }));
  assert.equal(lastRaw(FINGERBOX).clearance, -0.4);
  mem.set('kizamubeam.gen.drawer', JSON.stringify({ clearance: 0.5 }));
  assert.equal(lastRaw(DRAWER).clearance, 1);
  // The parameters are marked in the schema (playTotal), no generator ids in the dialog
  for (const g of [BOX, DRAWER, FINGERBOX]) assert.deepEqual(g.schema.filter((s) => s.playTotal).map((s) => s.key), ['clearance'], g.id);
  // Other generators are left alone
  mem.set('kizamubeam.gen.insert', JSON.stringify({ play: 0.1 }));
  assert.deepEqual(lastRaw(INSERT), { play: 0.1 });
});

// ---------- PR 3: material library, calibration, Joint tool, plugin context ----------

const { library, parseLibrary, pairSide } = await import('../src/materials');
const { genFitPatch } = await import('../src/fitcheck');
await import('./builtin-generators');
const { editorContext } = await import('../src/plugins/context');
const calib = await import('../src/calibrate');
const { loadCalibTest, saveCalibTest, calibResult, defaultSteps, stepValues } = calib;
const { loadJointState, saveJointState, JOINT_STATE_KEY } = await import('../src/jointState');
const { defaultLayer } = await import('../src/model');

const entryJson = (fit: Record<string, unknown>, title = 'Schneiden') => ({ material: 'Birke', thickness: 3, title, desc: '', settings: { ...defaultLayer(1) }, fit });
const V1_FIT = { kerf: 0.15, pair: 0.075, slot: 0.1, th: 3, date: '2026-10-01' };

test('material library: a fit without the mark has the play per side and is doubled once; with the mark it is left alone', () => {
  const [old] = parseLibrary(JSON.stringify({ format: 'kizamubeam-materials', version: 1, entries: [{ ...entryJson(V1_FIT), id: 'a' }] }));
  assert.deepEqual(old.fit, { ...V1_FIT, pair: 0.15, v: 2 });
  const [cur] = parseLibrary(JSON.stringify({ format: 'kizamubeam-materials', version: 2, entries: [{ ...entryJson({ ...V1_FIT, pair: 0.15, v: 2 }), id: 'a' }] }));
  assert.deepEqual(cur.fit, old.fit);
  // Converted entries do not change again when they are read again (save, load, save, load)
  const again = parseLibrary(JSON.stringify([old]))[0];
  assert.deepEqual(again.fit, old.fit);
  // Only pair changes: kerf, slot and thickness stay
  assert.equal(old.fit!.slot, 0.1);
  assert.equal(old.fit!.kerf, 0.15);
  assert.equal(pairSide(old.fit!), 0.075);
  // Negative values (press fit) and no fit at all
  assert.equal(parseLibrary(JSON.stringify([entryJson({ ...V1_FIT, pair: -0.05 })]))[0].fit!.pair, -0.1);
  assert.equal(parseLibrary(JSON.stringify([{ ...entryJson({}), fit: undefined }]))[0].fit, undefined);
});

test('material library: export is version 2, import of a version 1 file and a pack applied twice give the same values', () => {
  const [old] = parseLibrary(JSON.stringify({ version: 1, entries: [{ ...entryJson(V1_FIT), id: 'a' }] }));
  library.merge([old]);
  const out = JSON.parse(library.serialize());
  assert.equal(out.version, 2);
  assert.equal(out.entries.find((e: { id: string }) => e.id === 'a').fit.pair, 0.15);
  // Round trip: a file exported now reads back with the same values
  const [back] = parseLibrary(library.serialize());
  assert.deepEqual(back.fit, old.fit);
  // A pack with the play per side (no mark) is converted every time it is read, the stored entry is not doubled again
  const fromPack = () => parseLibrary(JSON.stringify([{ ...entryJson(V1_FIT), id: 'pk:x:1' }]))[0];
  library.syncPack('x', [fromPack()]);
  library.syncPack('x', [fromPack()]);
  assert.equal(library.get('pk:x:1')!.fit!.pair, 0.15);
  library.syncPack('x', [library.get('pk:x:1')!]);
  assert.equal(library.get('pk:x:1')!.fit!.pair, 0.15, 'a stored entry synced back is not doubled');
  // What the library stores in localStorage reads back unchanged
  const stored = JSON.parse(mem.get('kizamubeam.materials')!);
  assert.equal(stored.version, 2);
  assert.ok(stored.entries.every((e: { fit: { v: number } }) => e.fit.v === 2));
});

test('a calibration suggests the same values for a generator as before (library doubled, suggestion per side)', () => {
  const [e] = parseLibrary(JSON.stringify([{ ...entryJson(V1_FIT), id: 'b' }]));
  // Before: clearance = 2 · (pair + kerf) with pair per side = 0.075 and kerf 0.15 → 0.45
  const patch = genFitPatch('box', e, { kerf: 0 } as never, 0)!;
  assert.equal(patch.clearance, 0.45);
  assert.equal(patch.kerf, 0.15);
  // With a layer kerf offset of 0.08 the generator gets no kerf of its own: 2 · (0.075 + 2 · 0.08) = 0.47
  assert.equal(genFitPatch('box', e, { kerf: 0 } as never, 0.08)!.clearance, 0.47);
});

test('host.context("material"): pairPlay keeps the play per side, pairPlayTotal is new', () => {
  const [e] = parseLibrary(JSON.stringify([{ ...entryJson(V1_FIT, 'Kontext'), id: 'c' }]));
  library.merge([e]);
  const ed = { doc: { bed: { w: 400, h: 300 } }, currentLayer: 0, layer: () => ({ material: 'c' }) };
  const ctx = editorContext(ed as never, 'material') as Record<string, unknown>;
  assert.equal(ctx.pairPlay, 0.075);
  assert.equal(ctx.pairPlayTotal, 0.15);
  assert.equal(ctx.slotPlay, 0.1);
  assert.equal(ctx.kerf, 0.15);
});

test('calibration: a half-finished test from before is converted once; the default comb is the same as before', () => {
  mem.set('kizamubeam.calib', JSON.stringify({ th: 3, kl: 0.05, layer: 1, pair: [-0.2, -0.15, -0.1], slot: [-0.1, 0, 0.1], date: '2026-10-18' }));
  const t1 = loadCalibTest()!;
  assert.deepEqual(t1.pair, [-0.4, -0.3, -0.2]);
  assert.equal(t1.v, 2);
  assert.deepEqual(loadCalibTest()!.pair, [-0.4, -0.3, -0.2], 'only once');
  assert.deepEqual(JSON.parse(mem.get('kizamubeam.calib')!).pair, [-0.4, -0.3, -0.2], 'stored with the mark');
  // The old result of the best tab (−0.15 per side, layer kerf 0.05) is the new one with twice the value
  const r = calibResult(t1, null, 2, 1);
  assert.ok('fit' in r);
  assert.equal(r.fit.pair, -0.5, '−0.3 − 4 · 0.05 = 2 · (−0.15 − 2 · 0.05)');
  assert.equal(r.fit.v, 2);
  // Old default steps: from r(2kl − beam − 0.05) step 0.05; now twice that
  for (const [beam, kl] of [[0.15, 0], [0.2, 0.05], [0.1, -0.05]] as const) {
    const old = { from: Math.round((2 * kl - beam - 0.05) / 0.05) * 0.05, step: 0.05 };
    assert.deepEqual(stepValues(defaultSteps(beam, kl).pair), stepValues({ ...old, count: 6 }).map((c) => Math.round(2 * c * 1000) / 1000), `${beam} ${kl}`);
  }
  saveCalibTest(null);
});

test('calibration test parts are the same as before #402 (hashes taken with the old code; steps are now the total play)', () => {
  const { buildCalibParts } = calib;
  const strip = (o: { objs: { id: number }[] }) => o.objs.map((x) => ({ ...x, id: 0 }));
  const got: Record<string, string> = {};
  for (const [beam, kl, th] of [[0.15, 0, 3], [0.2, 0.05, 4], [0.1, -0.05, 6], [0.3, 0, 3]] as const) {
    got[`def ${beam} ${kl} ${th}`] = hash(strip(buildCalibParts({ th, ...defaultSteps(beam, kl) }, 1, 2, 'Arial')));
  }
  // Steps as they were per side: from, step, count; now twice the from and step
  for (const [from, step, count] of [[-0.2, 0.05, 6], [0, 0.1, 5], [-0.1, 0.025, 12], [0.05, 0.05, 1]] as const) {
    got[`cust ${from} ${step} ${count}`] = hash(strip(buildCalibParts({ th: 3, pair: { from: 2 * from, step: 2 * step, count }, slot: { from: 0, step: 0.05, count: 4 } }, 1, 2, 'Arial')));
  }
  assert.deepEqual(got, {
    'def 0.15 0 3': '789af0afa269feda', 'def 0.2 0.05 4': '313a37511312c0dd', 'def 0.1 -0.05 6': '43582b7b9b50bc45', 'def 0.3 0 3': 'f09d427f0f1da91d',
    'cust -0.2 0.05 6': 'c3c38f44ec76689f', 'cust 0 0.1 5': '3cad1ba616e73e98', 'cust -0.1 0.025 12': 'c6877cede35f911b', 'cust 0.05 0.05 1': '2ccdd0b8bf444b2a',
  });
});

test('Joint tool: the remembered play is doubled once', () => {
  mem.set(JOINT_STATE_KEY, JSON.stringify({ kind: 'finger', thickness: 4, clearance: 0.05, kerf: 0.1 }));
  const st = loadJointState();
  assert.equal(st.clearance, 0.1);
  assert.equal(st.thickness, 4);
  assert.equal((st as unknown as Record<string, unknown>)._playTotal, undefined, 'the mark stays out of the options');
  assert.equal(loadJointState().clearance, 0.1, 'only once');
  assert.equal(JSON.parse(mem.get(JOINT_STATE_KEY)!)._playTotal, true);
  saveJointState({ ...st, clearance: -0.05 });
  assert.equal(loadJointState().clearance, -0.05, 'a value saved by the new dialog is kept');
  mem.delete(JOINT_STATE_KEY);
  assert.equal(loadJointState().clearance, 0);
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall clearance tests passed');
