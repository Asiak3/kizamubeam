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

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall clearance tests passed');
