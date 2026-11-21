// #463 for the box composers of the catalog (kizamubeam-plugins: box-composer 0.2.1 in plugins/box-composer-catalog,
// box-composer-advanced 0.5.4): the built packs in QuickJS, as in the app.
// outer-faces-composers-fixtures.json holds fingerprints taken with 0.2.0 and 0.5.3 (before #463): geom = parts on the
// work area, pose = their poses, world = the assembled solids in space.
// - saved parts (faces: 'legacy', set by migrate) are exactly as before;
// - new parts: the solids stay where they were and every outer part lies outer face up (−(u×v) points out of the box).
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const { parsePack } = await import('../src/packs');
const { pluginGenerator } = await import('../src/plugins/generator');
const G = await import('../src/generators/index');

type V3 = [number, number, number];
type Pt = { x: number; y: number };
const fx: Record<string, { geom: string; pose: string; world: string }> = JSON.parse(readFileSync(new URL('./outer-faces-composers-fixtures.json', import.meta.url), 'utf8'));
const r = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function inside(pts: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

// The sketch from #327, the box of the issue (faces.kzb) and an L-shaped outline (boards outer-1 … outer-6)
const SKETCH = '[{"id":1,"axis":"h","pos":97,"from":0,"to":94},{"id":2,"axis":"v","pos":47,"from":0,"to":150.35},{"id":3,"axis":"h","pos":150.35,"from":47,"to":94},{"id":4,"axis":"v","pos":19.74,"from":97,"to":169.75}]';
const ISSUE = { width: 200, depth: 100, height: 50, wallFront: true, wallBack: true, wallLeft: true, wallRight: true, lid: false, dividerDrop: 0, fromMaterial: false, thickness: 3, clearance: 0, kerf: 0, finger: 10,
  walls: '[{"id":1,"axis":"h","pos":-1.5,"from":-1.5,"to":195.5},{"id":2,"axis":"v","pos":195.5,"from":-1.5,"to":95.5},{"id":3,"axis":"h","pos":95.5,"from":-1.5,"to":195.5},{"id":4,"axis":"v","pos":-1.5,"from":-1.5,"to":95.5},{"id":6,"axis":"v","pos":22,"from":-1.5,"to":33},{"id":7,"axis":"v","pos":130,"from":33,"to":95.5},{"id":8,"axis":"h","pos":57,"from":-1.5,"to":22},{"id":9,"axis":"h","pos":13,"from":167,"to":195.5}]',
  wallsRef: '[194,94]' };
const L_SHAPE = '[{"id":1,"axis":"h","pos":-1.5,"from":-1.5,"to":195.5},{"id":2,"axis":"v","pos":195.5,"from":-1.5,"to":40},{"id":3,"axis":"h","pos":95.5,"from":-1.5,"to":150},{"id":4,"axis":"v","pos":-1.5,"from":-1.5,"to":95.5},{"id":5,"axis":"h","pos":40,"from":150,"to":195.5},{"id":6,"axis":"v","pos":150,"from":40,"to":95.5}]';
const CASES: [string, string, Record<string, unknown>[]][] = [
  ['box-composer', 'plugins/box-composer-catalog', [{}, { walls: SKETCH, wallsRef: '[94,194]' }, { walls: SKETCH, wallsRef: '[94,194]', lid: true, kerf: 0.15, clearance: 0.2 }, { lid: true, clearance: -0.2, wallLeft: false }]],
  ['box-composer-advanced', 'plugins/box-composer-advanced', [{}, ISSUE, { ...ISSUE, lid: true, kerf: 0.15, clearance: 0.2 }, { lid: true, clearance: -0.2, wallFront: false }, { walls: L_SHAPE, wallsRef: '[194,94]', width: 200, depth: 100 }]],
];
/** Direction out of the box of the outer parts of a rectangular box; boards of a shaped outline are checked against the floor */
const SHELL: Record<string, V3> = { floor: [0, 0, -1], lid: [0, 0, 1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

let n = 0;
for (const [name, dir, list] of CASES) {
  execFileSync('node', ['scripts/plugin-pack.mjs', '--build', dir], { stdio: 'ignore' });
  const pack = parsePack(buildPluginPack(dir)).plugins[0];
  assert.equal(pack.version, 2, `${name}: generator version`);
  const gen = pluginGenerator(pack, { id: name, name }, { context: (w: string) => (w === 'workArea' ? { width: 600, height: 600 } : null) as never });
  G.register(gen);
  assert.equal(G.defaultParams(gen).faces, 'out', `${name}: new boxes`);
  for (const [i, ex] of list.entries()) for (const faces of ['out', 'legacy']) {
    const id = `${name} #${i}`;
    const p = G.normalizeParams(gen, { ...G.defaultParams(gen), ...ex, faces });
    const b = await G.buildGenAsync(gen, p);
    assert.ok(b.parts.length, `${id}: ${b.issues.map((x) => x.msg).join('; ')}`);
    const th = Number(p.thickness);
    const poses = gen.poses!(p, th)!.poses;
    const parts = b.parts.map((x) => ({ key: x.shape.part!, subs: x.shape.subs, at: x.at }));
    const geom = hash(parts.map((pt) => [pt.key, r(pt.at.x), r(pt.at.y), pt.subs.map((s) => s.nodes.map((q) => [r(q.x), r(q.y)]))]));
    const pose = hash(Object.entries(poses).map(([k, q]) => [k, ...[q.o, q.u, q.v, q.n].map((w) => w.map(r))]));
    const world = hash(parts.map((pt) => {
      const q = poses[pt.key];
      const pts: string[] = [];
      for (const s of pt.subs) for (const nd of s.nodes) for (const h of [0, th]) pts.push([0, 1, 2].map((k) => r(q.o[k] + nd.x * q.u[k] + nd.y * q.v[k] + h * q.n[k])).join(','));
      return [pt.key, pts.sort()];
    }));
    const f = fx[id];
    assert.ok(f, `fingerprint missing: ${id}`);
    if (faces === 'legacy') {
      assert.deepEqual([geom, pose, world], [f.geom, f.pose, f.world], `legacy changed: ${id}`);
      continue;
    }
    assert.equal(world, f.world, `solids moved: ${id}`);
    const floor = poses.floor, outline = parts.find((x) => x.key === 'floor')!.subs[0].nodes;
    for (const pt of parts) {
      const q = poses[pt.key];
      const up = cross(q.u as V3, q.v as V3).map((v) => -v) as V3;
      if (SHELL[pt.key]) assert.ok(dot(up, SHELL[pt.key]) > 0.99, `${id}: ${pt.key} lies outer face down`);
      else if (pt.key.startsWith('outer-')) {
        // A point a little above the face that lies up must be outside the floor
        const xs = pt.subs[0].nodes.map((q) => q.x), ys = pt.subs[0].nodes.map((q) => q.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const c = [0, 1, 2].map((k) => q.o[k] + cx * q.u[k] + cy * q.v[k] + (th / 2) * q.n[k] + 3 * th * up[k] - floor.o[k]);
        assert.ok(!inside(outline, dot(c, floor.u), dot(c, floor.v)), `${id}: ${pt.key} lies outer face down`);
      }
    }
    n++;
  }
  // Saved boxes (generator version 1) keep their faces
  assert.equal((await gen.upgrade!({ ...G.defaultParams(gen), faces: 'out' }, 1)).faces, 'legacy', `${name}: migrate`);
}
console.log(`outer-faces composers: ${n} cases ok`);
