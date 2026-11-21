// #463: Outer faces of box-like assemblies lie face up on the work area (the side that faces up there is −(u×v) of
// the part's pose and must point out of the box). Saved parts keep their former orientation (faces: 'legacy').
//
// outer-faces-fixtures.json holds fingerprints of the code before #463 (write them again with --write, only on
// that code): geom = parts on the work area, poses = their poses, world = the assembled solids in space.
// - geometry that #463 does not change (box, drawer) and every legacy part keep geom (and poses for legacy);
// - the assembled solids stay where they were: world is the same with and without legacy (the parts still fit).
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { defaultParams, getGenerator, normalizeParams, type Params } from '../src/generators';
import './builtin-generators';
import type { Pose, V3 } from '../src/generators/pose';

const FIXTURES = new URL('./outer-faces-fixtures.json', import.meta.url);
const write = process.argv.includes('--write');

const CASES: Record<string, Params[]> = {
  box: [
    {},
    { top: 'closed' },
    { top: 'closed', width: 137.3, depth: 91.7, height: 43.1, finger: 7.3, clearance: 0.3, kerf: 0.15 },
    { sizeMode: 'inner', clearance: -0.3, partLayout: 'rows' },
  ],
  'box-divided': [
    {},
    { top: 'closed' },
    { compartmentsX: 3, ratiosX: '1:2:1', compartmentsY: 2, ratiosY: '1:3' },
    { top: 'closed', width: 137.3, clearance: 0.3, kerf: 0.15, compartmentsX: 2 },
    { clearance: -0.3, compartmentsY: 3, partLayout: 'rows' },
  ],
  drawer: [
    {},
    { carcass: false },
    { front: 'inset', width: 133.7, depth: 97.1, height: 61.3, clearance: -0.3 },
    { clearance: 0.3, kerf: 0, partLayout: 'packed' },
  ],
  shelf: [{}, { shelves: 4, overhang: 15, play: -0.1 }, { shelves: 1 }, { play: 0.3, kerf: 0, partLayout: 'packed' }],
};
/** Generators whose saved parts keep the former orientation through faces: 'legacy' (their geometry changes) */
const LEGACY = new Set(['box-divided', 'shelf']);

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const N = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const SHELL = { bottom: N(Z), top: Z, front: N(Y), back: Y, left: N(X), right: X };
/** Direction out of the assembly for every outer part (parts not listed are inside and may lie either way) */
function outward(gen: string, p: Params): Record<string, V3> {
  if (gen === 'box' || gen === 'box-divided') return SHELL;
  if (gen === 'drawer') {
    const out: Record<string, V3> = { front: N(Y) };
    for (const [k, d] of Object.entries(SHELL)) out['d_' + k] = d;
    Object.assign(out, { c_back: Y, c_bottom: N(Z), c_top: Z, c_left: N(X), c_right: X });
    return out;
  }
  if (gen === 'shelf') {
    const out: Record<string, V3> = { side1: N(X), side2: X };
    const n = Number(p.shelves);
    if (n > 1) out[`board${n}`] = Z;
    return out;
  }
  throw new Error(gen);
}

const r = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function prints(gen: string, raw: Params) {
  const g = getGenerator(gen)!;
  const p = normalizeParams(g, raw);
  assert.deepEqual(g.validate(p).filter((i) => i.level === 'error'), [], `${gen} ${JSON.stringify(raw)}`);
  const th = Number(p.thickness);
  const parts = g.generate(p).parts;
  const poses = g.poses!(p, th)!.poses;
  const geom = hash(parts.map((pt) => [pt.key, r(pt.at.x), r(pt.at.y), pt.subs.map((s) => [s.closed, s.nodes.map((n) => [r(n.x), r(n.y), n.cin && [r(n.cin.x), r(n.cin.y)], n.cout && [r(n.cout.x), r(n.cout.y)]])])]));
  const pose = hash(Object.entries(poses).map(([k, q]) => [k, ...[q.o, q.u, q.v, q.n].map((w) => w.map(r))]));
  // The solid of every part in space: its outline points on both faces, as a set (mirroring reverses their order)
  const world = hash(parts.map((pt) => {
    const q: Pose = poses[pt.key];
    const pts: string[] = [];
    for (const s of pt.subs) for (const n of s.nodes) for (const h of [0, th]) pts.push([0, 1, 2].map((i) => r(q.o[i] + n.x * q.u[i] + n.y * q.v[i] + h * q.n[i])).join(','));
    return [pt.key, pts.sort()];
  }));
  // Sense of rotation of every contour (outline and holes; the kerf of the layer depends on it)
  const area = (ns: { x: number; y: number }[]) => ns.reduce((a, q, i) => a + q.x * ns[(i + 1) % ns.length].y - ns[(i + 1) % ns.length].x * q.y, 0);
  const turns = Object.fromEntries(parts.map((pt) => [pt.key, pt.subs.map((s) => Math.sign(area(s.nodes)))]));
  return { p, poses, keys: new Set(parts.map((pt) => pt.key)), geom, pose, world, turns };
}

const key = (gen: string, raw: Params) => `${gen} ${JSON.stringify(raw)}`;

if (write) {
  const out: Record<string, { geom: string; pose: string; world: string }> = {};
  for (const [gen, list] of Object.entries(CASES)) for (const raw of list) {
    const { geom, pose, world } = prints(gen, raw);
    out[key(gen, raw)] = { geom, pose, world };
  }
  writeFileSync(FIXTURES, JSON.stringify(out, null, 2) + '\n');
  console.log(`outer-faces: ${Object.keys(out).length} fingerprints written`);
} else {
  const fx: Record<string, { geom: string; pose: string; world: string }> = JSON.parse(readFileSync(FIXTURES, 'utf8'));
  let n = 0;
  for (const [gen, list] of Object.entries(CASES)) for (const raw of list) {
    const f = fx[key(gen, raw)];
    assert.ok(f, `fingerprint missing: ${key(gen, raw)}`);
    // New parts: the solids stay where they were, every outer face up on the work area points out of the box
    const now = prints(gen, raw);
    assert.equal(now.world, f.world, `solids moved: ${key(gen, raw)}`);
    if (!LEGACY.has(gen)) assert.equal(now.geom, f.geom, `work area geometry changed: ${key(gen, raw)}`);
    for (const [part, d] of Object.entries(outward(gen, now.p))) {
      if (!now.keys.has(part)) continue;
      const q = now.poses[part];
      assert.ok(q, `${key(gen, raw)}: no pose for ${part}`);
      const up = cross(q.u, q.v).map((v) => -v) as V3;
      assert.ok(dot(up, d) > 0.99, `${key(gen, raw)}: ${part} lies outer face down`);
    }
    // Saved parts (faces: 'legacy'): exactly as before #463
    if (LEGACY.has(gen)) {
      const old = prints(gen, { ...raw, faces: 'legacy' });
      assert.deepEqual([old.geom, old.pose, old.world], [f.geom, f.pose, f.world], `legacy changed: ${key(gen, raw)}`);
      assert.deepEqual(now.turns, old.turns, `sense of rotation changed: ${key(gen, raw)}`);
    }
    n++;
  }
  // Saved parts get faces: 'legacy' when they are loaded, new ones lie outer face up
  for (const [gen, before] of [['box-divided', 4], ['shelf', 2]] as const) {
    const g = getGenerator(gen)!;
    assert.equal(g.version, before + 1);
    assert.equal(g.migrate!({}, before).faces, 'legacy');
    assert.equal(g.migrate!({}, before + 1).faces, undefined);
    assert.equal(defaultParams(g).faces, 'out');
  }
  console.log(`outer-faces: ${n} cases ok`);
}
