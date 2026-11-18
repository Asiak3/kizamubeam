// Box composer (#327): wall model, validation and parts. The plugin's functions run in Node without QuickJS; the
// joints come from the app's host functions (hostCaller), exactly as the plugin gets them.
// Aufruf: node scripts/run-ts.mjs scripts/box-composer-test.ts
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildModel, mergeWalls, readLayout, sampleLayout, scaleLayout, writeLayout, type Layout, type Wall } from '../plugins/box-composer/src/model';

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

// Innenmaß der Skizze 100 × 200, t = 3
const W = 94, D = 194, T = 3;
// Wie im Plugin (index.ts)
const LIM = { t: T, gap: T, minLen: 2 * T, freeLen: 2 * T };
const model = (walls: Wall[], w = W, d = D) => buildModel({ ref: [w, d], walls }, w, d, LIM);
const codes = (walls: Wall[]) => model(walls).issues.map((i) => i.code).sort();
const h = (id: number, pos: number, from: number, to: number): Wall => ({ id, axis: 'h', pos, from, to });
const v = (id: number, pos: number, from: number, to: number): Wall => ({ id, axis: 'v', pos, from, to });

test('reading: broken, wrong or too large text is refused; a good layout comes back the same', () => {
  for (const bad of ['[', '{}', '"x"', '{"walls":[]}', '[{"id":1}]', '[{"id":0,"axis":"h","pos":1,"from":0,"to":5}]',
    '[{"id":1,"axis":"z","pos":1,"from":0,"to":5}]', '[{"id":1,"axis":"h","pos":1,"from":0,"to":5},{"id":1,"axis":"v","pos":1,"from":0,"to":5}]', 'x'.repeat(100_001)])
    assert.equal(readLayout(bad), null, bad.slice(0, 60));
  for (const bad of ['[0,5]', '[5]', '{', '"x"', '{"w":5}'])
    assert.equal(readLayout('[]', bad), null, `reference ${bad}`);
  const many = Array.from({ length: 101 }, (_, i) => h(i + 1, i, 0, 5));
  assert.equal(readLayout(JSON.stringify(many)), null, 'more than 100 walls');
  assert.deepEqual(readLayout(''), { ref: [0, 0], walls: [] }, 'empty text = no walls');
  assert.deepEqual(readLayout('[]', '[50,60]'), { ref: [50, 60], walls: [] });
  const l = sampleLayout(W, D);
  const stored = writeLayout(l);
  assert.deepEqual(readLayout(stored.walls, stored.wallsRef), { ref: l.ref, walls: l.walls.map((x) => ({ ...x, pos: Math.round(x.pos * 1000) / 1000, from: Math.round(x.from * 1000) / 1000, to: Math.round(x.to * 1000) / 1000 })) });
  assert.equal(writeLayout({ ref: [0, 0], walls: [] }).wallsRef, '', 'no reference size: empty');
  assert.deepEqual(readLayout('[{"id":3,"axis":"v","pos":10,"from":50,"to":20,"note":"x"}]')!.walls[0], v(3, 10, 20, 50), 'from and to in order, other keys of a row ignored');
});

test('scaling: proportional to the reference size, unchanged without one', () => {
  const l: Layout = { ref: [100, 200], walls: [h(1, 100, 0, 100), v(2, 50, 0, 200)] };
  assert.deepEqual(scaleLayout(l, 50, 400), [h(1, 200, 0, 50), v(2, 25, 0, 400)]);
  assert.deepEqual(scaleLayout({ ref: [0, 0], walls: l.walls }, 50, 400), l.walls);
});

test('merging: walls on one line that touch or overlap become one with the oldest id', () => {
  assert.deepEqual(mergeWalls([h(5, 10, 30, 60), h(2, 10, 0, 30), h(7, 10, 50, 80)]), [h(2, 10, 0, 80)]);
  assert.deepEqual(mergeWalls([h(1, 10, 0, 20), h(2, 10, 30, 50)]).length, 2, 'a gap stays');
  assert.deepEqual(mergeWalls([h(1, 10, 0, 20), v(2, 10, 0, 20)]).length, 2, 'other axis');
  // Zwei T von beiden Seiten an derselben Stelle = eine Wand, die kreuzt
  const m = model([h(1, 97, 0, W), v(2, 40, 0, 97), v(3, 40, 97, 150)]);
  assert.equal(m.walls.length, 2);
  assert.deepEqual(m.walls.find((x) => x.wall.id === 2)!.crosses, [{ at: 97, wall: 1 }]);
});

test("the user's sketch: T on the outer walls, crossing, corner, T on a wall and a free end, no issues", () => {
  const m = buildModel(sampleLayout(W, D), W, D, LIM);
  assert.deepEqual(m.issues, []);
  const by = (id: number) => m.walls.find((x) => x.wall.id === id)!;
  assert.deepEqual([by(1).start, by(1).end], [{ kind: 'outer', side: 'x0' }, { kind: 'outer', side: 'x1' }]);
  assert.deepEqual(by(1).crosses.map((c) => c.wall), [2]);
  assert.deepEqual(by(1).tees.map((t) => [t.wall, t.side]), [[4, 1]]);
  assert.deepEqual([by(2).start, by(2).end], [{ kind: 'outer', side: 'y0' }, { kind: 'corner', other: 3 }]);
  assert.deepEqual([by(3).start, by(3).end], [{ kind: 'corner', other: 2 }, { kind: 'outer', side: 'x1' }]);
  assert.deepEqual([by(4).start, by(4).end], [{ kind: 'tee', host: 1 }, { kind: 'free' }]);
});

test('errors: outside, on an outer wall, too short, too close, gaps, misaligned T, short free ends (clear distances)', () => {
  assert.deepEqual(codes([h(1, 97, 0, 120)]), ['wall-outside']);
  assert.deepEqual(codes([h(1, 0, 0, W)]), ['wall-on-outer']);
  assert.deepEqual(codes([h(1, 4, 0, W)]), ['wall-near-outer']);
  assert.deepEqual(codes([h(1, 4.5, 0, W)]), [], 'one thickness of clear space to the outer wall is enough');
  assert.deepEqual(codes([h(1, 97, 40, 45)]), ['wall-short']);
  assert.deepEqual(codes([h(1, 97, 40, 46)]), []);
  assert.deepEqual(codes([h(1, 97, 0, W), h(2, 102, 0, W)]), ['walls-close']);
  assert.deepEqual(codes([h(1, 97, 0, W), h(2, 103, 0, W)]), [], 'one thickness of clear space');
  assert.deepEqual(codes([h(1, 97, 0, W), h(2, 97, 50, W)]).length, 0, 'same line: merged, no error');
  // Ende knapp vor einer Wand, knapp vor der Außenwand, knapp vorbei an einem Wandende
  assert.deepEqual(codes([h(1, 97, 0, W), v(2, 40, 0, 95)]), ['wall-gap']);
  assert.deepEqual(codes([v(2, 40, 0, 192)]), ['wall-gap']);
  // Ecke knapp verfehlt: beide Enden melden sich, jedes mit seiner Wand
  assert.deepEqual(model([h(1, 97, 0, 40), v(2, 42, 97, 150)]).issues.map((i) => [i.code, i.values!.id]), [['wall-gap', 1], ['wall-gap', 2]]);
  // Zwei T von beiden Seiten fast an derselben Stelle
  assert.ok(codes([h(1, 97, 0, W), v(2, 40, 0, 97), v(3, 45, 97, 150)]).includes('tees-misaligned'));
  assert.deepEqual(codes([h(1, 97, 0, W), v(2, 40, 0, 97), v(3, 46, 97, 150)]), [], 'one thickness of clear space between the slots');
  // Freies Ende zu kurz hinter einer Kreuzung
  assert.deepEqual(codes([h(1, 97, 0, W), v(2, 40, 0, 104)]), ['free-end-short']);
  assert.deepEqual(codes([h(1, 97, 0, W), v(2, 40, 0, 104.5)]), [], 'two thicknesses from the face of the crossing wall');
});

test('the pinwheel and a closed cell give no issue', () => {
  // Windmühle: vier Wände, jede endet als T an der nächsten
  const pin = model([v(1, 30, 0, 120), h(2, 60, 30, W), v(3, 64, 60, D), h(4, 120, 0, 64)]);
  assert.deepEqual(pin.issues, []);
  assert.deepEqual(pin.walls.map((x) => [x.start.kind, x.end.kind]), [['outer', 'tee'], ['tee', 'outer'], ['tee', 'outer'], ['outer', 'tee']]);
  const cell = model([h(1, 40, 20, 70), h(2, 100, 20, 70), v(3, 20, 40, 100), v(4, 70, 40, 100)]);
  assert.deepEqual(cell.issues, []);
  assert.ok(cell.walls.every((x) => x.start.kind === 'corner' && x.end.kind === 'corner'));
});

test('scaling keeps the joints: walls at the outer walls stay there, corners stay corners', () => {
  const l = sampleLayout(W, D);
  const m = buildModel(l, 2 * W, 1.5 * D, LIM);
  assert.deepEqual(m.issues, []);
  const before = buildModel(l, W, D, LIM).walls.map((x) => [x.start, x.end]);
  assert.deepEqual(m.walls.map((x) => [x.start, x.end]), before);
});

// --- Teile, mit den Verbindungen der App -------------------------------------------------------------------------
const { hostCaller } = await import('../src/plugins/hostfns');
const call = hostCaller(['joints', 'offset', 'boolean', 'nest']);
const viaHost = (name: string) => (input: unknown) => {
  const r = JSON.parse(call(name, JSON.stringify(input)));
  if (r.error) throw new Error(r.error);
  return r.ok;
};
(globalThis as Record<string, unknown>).host = { joints: viaHost('joints'), offset: viaHost('offset'), boolean: viaHost('boolean'), nest: viaHost('nest') };
const { buildParts, withKerf, innerHeight } = await import('../plugins/box-composer/src/parts');
const { fields, tenonStretches } = await import('../plugins/box-composer/src/joints');
type Sub = { nodes: { x: number; y: number }[]; closed: boolean };
type Dims = Parameters<typeof buildParts>[1];
const DIMS: Dims = { W: 100, D: 200, H: 50, t: T, finger: 10, clearance: 0.1, kerf: 0, sides: { x0: true, x1: true, y0: true, y1: true }, lid: false, drop: 0 };
const parts = (d: Partial<Dims> = {}, walls = sampleLayout(W, D).walls) => {
  const dims = { ...DIMS, ...d };
  return buildParts(buildModel({ ref: [dims.W - 2 * T, dims.D - 2 * T], walls }, dims.W - 2 * T, dims.D - 2 * T, LIM), dims);
};
const box = (subs: Sub[]) => {
  const xs = subs.flatMap((s) => s.nodes.map((n) => n.x)),
    ys = subs.flatMap((s) => s.nodes.map((n) => n.y));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
/** Stellen, an denen der Umriss auf derselben Linie zurückläuft (Stege der Breite null, doppelt geschnitten) */
const backtracks = (subs: Sub[]) =>
  subs.reduce((k, s) => {
    const n = s.nodes.length;
    for (let i = 0; i < n; i++) {
      const a = s.nodes[(i + n - 1) % n],
        b = s.nodes[i],
        c = s.nodes[(i + 1) % n];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
        dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cr) < 1e-9 && dot < -1e-12) k++;
    }
    return k;
  }, 0);

test('parts of the sketch: outer box, four walls, slots where walls meet, clean outlines', () => {
  const r = parts();
  assert.deepEqual(Object.keys(r.parts).sort(), ['back', 'floor', 'front', 'left', 'right', 'wall-1', 'wall-2', 'wall-3', 'wall-4']);
  // Schlitze: Rückwand 2 (Wand 2), links 2 (Wand 1), rechts 4 (Wände 1 und 3), Wand 1: 2 (T von Wand 4), vorne keine
  const holes = (k: string) => r.parts[k].length - 1;
  assert.deepEqual(['back', 'left', 'right', 'front', 'wall-1'].map(holes), [2, 2, 4, 0, 2]);
  for (const [k, subs] of Object.entries(r.parts)) {
    assert.equal(backtracks(subs as Sub[]), 0, `${k}: no zero-width spikes`);
    assert.ok(subs.every((s) => s.closed), `${k}: closed`);
  }
  assert.equal(innerHeight(DIMS), 47);
});

for (const c of [0.1, 0, -0.1])
  test(`floor teeth sit centred in their slots, total play ${c} along and across`, () => {
    const r = parts({ clearance: c });
    const floor = r.parts.floor.slice(1).map((s) => box([s as Sub]));
    let n = 0;
    for (const p of r.walls) {
      const w = p.it.wall,
        len = p.e - p.s;
      const nodes = (r.parts[p.key][0] as Sub).nodes;
      // Zahnspitzen: Kanten auf y = h/2 + t
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i],
          b = nodes[(i + 1) % nodes.length];
        if (Math.abs(a.y - (p.h / 2 + T)) > 1e-6 || Math.abs(b.y - a.y) > 1e-6) continue;
        const u0 = Math.min(a.x, b.x) + len / 2 + p.s,
          u1 = Math.max(a.x, b.x) + len / 2 + p.s;
        const mid = (u0 + u1) / 2;
        const at = w.axis === 'h' ? { x: mid + T - 50, y: w.pos + T - 100 } : { x: w.pos + T - 50, y: mid + T - 100 };
        const slot = floor.find((s) => s.x0 <= at.x && at.x <= s.x1 && s.y0 <= at.y && at.y <= s.y1);
        assert.ok(slot, `${p.key}: tooth at ${mid.toFixed(2)} has a slot`);
        const [along, across] = w.axis === 'h' ? [slot.x1 - slot.x0, slot.y1 - slot.y0] : [slot.y1 - slot.y0, slot.x1 - slot.x0];
        const centre = w.axis === 'h' ? (slot.x0 + slot.x1) / 2 - at.x : (slot.y0 + slot.y1) / 2 - at.y;
        assert.ok(Math.abs(along - (u1 - u0) - c) < 1e-6, `${p.key}: play along ${along - (u1 - u0)}`);
        assert.ok(Math.abs(across - T - c) < 1e-6, `${p.key}: slot width ${across}`);
        assert.ok(Math.abs(centre) < 1e-6, `${p.key}: centred`);
        n++;
      }
    }
    assert.equal(n, floor.length, 'every floor slot has its tooth');
  });

for (const c of [0.1, -0.1])
  test(`T joints: tenons sit centred in the slots of inner and outer walls, total play ${c} along and across`, () => {
    const r = parts({ clearance: c });
    const byId = new Map(r.walls.map((p) => [p.it.wall.id, p]));
    const OUT: Record<string, string> = { x0: 'left', x1: 'right', y0: 'back', y1: 'front' };
    let n = 0;
    for (const p of r.walls)
      for (const which of ['start', 'end'] as const) {
        const end = p.it[which];
        if (end.kind !== 'tee' && end.kind !== 'outer') continue;
        const len = p.e - p.s;
        const tip = which === 'start' ? -len / 2 - T : len / 2 + T;
        const nodes = (r.parts[p.key][0] as Sub).nodes;
        // Zapfen: senkrechte Kanten auf x = Spitze, als y-Bereiche (Wandmitte bei y = 0)
        const tenons: [number, number][] = [];
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i],
            b = nodes[(i + 1) % nodes.length];
          if (Math.abs(a.x - tip) < 1e-6 && Math.abs(b.x - tip) < 1e-6) tenons.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
        }
        assert.ok(tenons.length > 0, `${p.key} ${which}: tenons`);
        // Schlitze im Gastteil: x um die Stelle der Wand, y in dessen Koordinaten
        let key: string, sx: number, dy: number;
        if (end.kind === 'tee') {
          const host = byId.get(end.host)!;
          key = host.key;
          sx = host.it.tees.find((t) => t.wall === p.it.wall.id)!.at - host.s - (host.e - host.s) / 2;
          dy = 0;
        } else {
          key = OUT[end.side];
          sx = p.it.wall.pos + T - (end.side === 'x0' || end.side === 'x1' ? 100 : 50);
          dy = 50 / 2 - T - p.h / 2;
        }
        const slots = r.parts[key].slice(1).map((s) => box([s as Sub])).filter((s) => s.x0 < sx && sx < s.x1);
        assert.equal(slots.length, tenons.length, `${p.key} → ${key}: one slot per tenon`);
        for (const [y0, y1] of tenons) {
          const s = slots.find((q) => q.y0 <= (y0 + y1) / 2 + dy && (y0 + y1) / 2 + dy <= q.y1)!;
          assert.ok(s, `${p.key} → ${key}: slot for tenon ${y0}…${y1}`);
          assert.ok(Math.abs(s.y1 - s.y0 - (y1 - y0) - c) < 1e-6, `${p.key} → ${key}: play along`);
          assert.ok(Math.abs((s.y0 + s.y1) / 2 - (y0 + y1) / 2 - dy) < 1e-6, `${p.key} → ${key}: centred`);
          assert.ok(Math.abs((s.x0 + s.x1) / 2 - sx) < 1e-6, `${p.key} → ${key}: on the wall's line`);
          assert.ok(Math.abs(s.x1 - s.x0 - T - c) < 1e-6, `${p.key} → ${key}: slot width`);
          n++;
        }
      }
    // Wand 1: beide Enden an Außenwänden, Wand 2 und 3: je eines, Wand 4: T an Wand 1
    assert.equal(n, 2 * 5, 'five tenon ends in the sketch, two tenons each');
  });

test('lid and lower inner walls; without outer walls the walls reach the floor edge', () => {
  const r = parts({ lid: true, drop: 5 });
  assert.ok(r.parts.lid);
  assert.equal(r.walls[0].h, 50 - 2 * T - 5);
  const o = parts({ sides: { x0: false, x1: false, y0: false, y1: false } });
  assert.deepEqual(Object.keys(o.parts).sort(), ['floor', 'wall-1', 'wall-2', 'wall-3', 'wall-4']);
  const w1 = box(o.parts['wall-1'] as Sub[]);
  assert.ok(Math.abs(w1.x1 - w1.x0 - 100) < 1e-6, 'wall 1 as wide as the floor');
  for (const [k, subs] of Object.entries(o.parts)) assert.equal(backtracks(subs as Sub[]), 0, k);
});

/** Liegt der Punkt in den Umrissen (gerade-ungerade)? */
const inside = (subs: Sub[], x: number, y: number) => {
  let k = false;
  for (const sp of subs)
    for (let i = 0, j = sp.nodes.length - 1; i < sp.nodes.length; j = i++) {
      const a = sp.nodes[i],
        b = sp.nodes[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) k = !k;
    }
  return k;
};

test('open sides: no wall there, the side walls or the floor take over the corners, inner walls reach the floor edge', () => {
  const open = parts({ sides: { x0: true, x1: true, y0: true, y1: false }, lid: true });
  assert.deepEqual(Object.keys(open.parts).sort(), ['back', 'floor', 'left', 'lid', 'right', 'wall-1', 'wall-2', 'wall-3', 'wall-4']);
  for (const [k, subs] of Object.entries(open.parts)) assert.equal(backtracks(subs as Sub[]), 0, k);
  // Seitenwand (u = −Y): vorne ist x = +D/2; die Eckwürfel oben und unten gehören jetzt ihr
  for (const k of ['left', 'right']) {
    const o = open.parts[k][0] as Sub;
    assert.ok(inside([o], 100 - T / 2, -25 + T / 2) && inside([o], 100 - T / 2, 25 - T / 2), `${k}: front corners`);
    assert.ok(!inside([o], -100 + T / 2, 25 - T / 2), `${k}: back corner still belongs to the back wall`);
  }
  assert.ok(!inside(open.parts.floor as Sub[], -50 + T / 2, 100 - T / 2), 'floor corner belongs to the side wall');
  // Frontseite offen und links offen: die vordere linke Ecke gehört Boden und Deckel
  const two = parts({ sides: { x0: false, x1: true, y0: true, y1: false }, lid: true });
  assert.deepEqual(Object.keys(two.parts).filter((k) => !k.startsWith('wall')).sort(), ['back', 'floor', 'lid', 'right']);
  for (const k of ['floor', 'lid']) assert.ok(inside(two.parts[k] as Sub[], -50 + T / 2, 100 - T / 2), `${k}: front left corner`);
  for (const [k, subs] of Object.entries(two.parts)) assert.equal(backtracks(subs as Sub[]), 0, k);
  // Wand 1 endet links an der offenen Seite: bündig mit dem Bodenrand, ohne Zapfen
  const w1 = box(two.parts['wall-1'] as Sub[]);
  assert.ok(Math.abs(w1.x0 + (two.walls[0].e - two.walls[0].s) / 2) < 1e-6, 'flat at the open side');
  assert.equal(two.walls[0].s, -T, 'reaches the floor edge');
});

test('kerf widens every part by half of it on each side', () => {
  const a = parts().parts,
    b = withKerf(a, 0.2);
  for (const k of Object.keys(a)) {
    const p = box(a[k] as Sub[]),
      q = box(b[k] as Sub[]);
    assert.ok(Math.abs(q.x1 - q.x0 - (p.x1 - p.x0) - 0.2) < 1e-3, `${k}: width`);
  }
});

test('fields: the odd number nearest to length / finger, at least 3, all equally wide; tenons on every second field', () => {
  assert.deepEqual(fields(47, 10), { n: 5, w: 9.4 });
  assert.deepEqual(fields(44, 10), { n: 5, w: 8.8 });
  assert.equal(fields(194, 10).n, 19);
  assert.equal(fields(12, 10).n, 3);
  assert.deepEqual(
    tenonStretches(0, 47, 10).map((sp) => [sp.a, sp.b, sp.width].map((x) => +x.toFixed(6))),
    [[4.7, 23.5, 9.4], [23.5, 42.3, 9.4]],
  );
});

/** Inner field boundaries (sorted, rounded to µm) of the nodes of a part between lo and hi on one coordinate, near the line at */
const bounds = (subs: Sub[], axis: 'x' | 'y', at: number[], lo: number, hi: number) => {
  const other = axis === 'x' ? 'y' : 'x';
  const vals = subs[0].nodes.filter((n) => at.some((a) => Math.abs(n[other] - a) < 1e-3) && n[axis] > lo + 1e-3 && n[axis] < hi - 1e-3).map((n) => +n[axis].toFixed(3));
  return [...new Set(vals)].sort((a, b) => a - b);
};
const steps = (lo: number, w: number, n: number) => Array.from({ length: n - 1 }, (_, k) => +(lo + (k + 1) * w).toFixed(3));

test('outer corners: without a lid the fingers reach the top edge (H − t), with a lid between both plates (H − 2t)', () => {
  // Höhe 50, t 3, Zinke 10: ohne Deckel 47 / 10 → 5 Felder je 9,4; mit Deckel 44 / 10 → 5 Felder je 8,8
  const open = parts({ clearance: 0 }).parts;
  assert.deepEqual(bounds(open.front as Sub[], 'y', [-50, -47], -25, 22), steps(-25, 9.4, 5), 'front, left corner');
  assert.deepEqual(bounds(open.right as Sub[], 'y', [100, 97], -25, 22), steps(-25, 9.4, 5), 'right wall, front corner');
  const lid = parts({ clearance: 0, lid: true }).parts;
  assert.deepEqual(bounds(lid.front as Sub[], 'y', [-50, -47], -22, 22), steps(-22, 8.8, 5), 'front with lid');
  assert.deepEqual(bounds(lid.left as Sub[], 'y', [-100, -97], -22, 22), steps(-22, 8.8, 5), 'left wall with lid');
});

test('floor edges: the same equal fields on the floor and on the wall standing on it', () => {
  // Rückwand 100 breit: 94 / 10 → 9 Felder je 10,44 auf beiden Teilen
  const r = parts({ clearance: 0 }).parts;
  const want = steps(-47, 94 / 9, 9);
  assert.deepEqual(bounds(r.floor as Sub[], 'x', [-100, -97], -47, 47), want, 'floor, back edge');
  assert.deepEqual(bounds(r.back as Sub[], 'x', [22, 25], -47, 47), want, 'back wall, bottom edge');
});

test('T joints: tenons on the 2nd and 4th of five fields, in line with the fingers of the outer corners', () => {
  const r = parts({ clearance: 0 });
  const p = r.walls.find((q) => q.it.end.kind === 'outer')!;
  const tip = (p.e - p.s) / 2 + T;
  const ys = bounds(r.parts[p.key] as Sub[], 'y', [tip], -p.h / 2, p.h / 2);
  assert.deepEqual(ys, [-14.1, -4.7, 4.7, 14.1], 'two tenons, 9.4 wide, 9.4 apart');
});

test('pinwheel and closed cell build without joint errors', () => {
  const pin = parts({}, [v(1, 30, 0, 120), h(2, 60, 30, W), v(3, 64, 60, D), h(4, 120, 0, 64)]);
  assert.equal(Object.keys(pin.parts).length, 1 + 4 + 4);
  const cell = parts({}, [h(1, 40, 20, 70), h(2, 100, 20, 70), v(3, 20, 40, 100), v(4, 70, 40, 100)]);
  for (const [k, subs] of Object.entries(cell.parts)) assert.equal(backtracks(subs as Sub[]), 0, k);
});

// --- Das gebaute Paket in QuickJS, wie in der App ------------------------------------------------------------------
async function atest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { readFileSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const { parsePack } = await import('../src/packs');
const { checkPlugin } = await import('../src/plugins/headless');
const { pluginGenerator } = await import('../src/plugins/generator');
const G = await import('../src/generators/index');
const { assemblyReport } = await import('../src/asmcheck');
const { asmSolids, findOverlaps } = await import('../src/view3d/solids');

execFileSync('node', ['scripts/plugin-pack.mjs', '--build', 'plugins/box-composer'], { stdio: 'ignore' });
const manifest = parsePack(buildPluginPack('plugins/box-composer')).plugins[0];
const ctx: Record<string, unknown> = {};
const gen = pluginGenerator(manifest, { id: 'box-composer', name: 'Box composer' }, { context: (w: string) => (ctx[w] ?? null) as never });
G.register(gen);
const run = (p: Record<string, unknown> = {}) => G.buildGenAsync(gen, G.normalizeParams(gen, { ...G.defaultParams(gen), ...p }));
const PLY = { name: 'Plywood 3 mm', thickness: 3, kerf: 0, pairPlay: null, slotPlay: 0.1 };

await atest('pack: catalogue check without errors or warnings', async () => {
  const r = await checkPlugin(manifest);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(manifest.fit?.kind, 'slot', 'clearance is the total play, like the slot play of a material (#402)');
});

await atest('pack: the sketch from the material, parts named, one assembly that fits together without overlaps', async () => {
  Object.assign(ctx, { material: PLY, workArea: { width: 400, height: 300 } });
  const p = G.normalizeParams(gen, G.defaultParams(gen));
  const r = await run();
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.parts.map((x) => x.shape.part).sort(), ['back', 'floor', 'front', 'left', 'right', 'wall-1', 'wall-2', 'wall-3', 'wall-4']);
  assert.equal(r.distribute, undefined, 'fits the work area as one block');
  const keys = new Set(r.parts.map((x) => x.shape.part!));
  let rep = assemblyReport(gen.id, p, keys);
  for (let i = 0; i < 100 && !rep; i++) {
    await new Promise((res) => setTimeout(res, 20));
    rep = assemblyReport(gen.id, p, keys);
  }
  assert.ok(rep, 'assembly report');
  assert.deepEqual(rep.groups.map((g) => g.length), [9], 'every part holds on to the rest');
  assert.deepEqual(rep.conflicts, [], 'can be put together');
  assert.equal(rep.order.length, 9);
  assert.equal(rep.crossings.length, 1, 'the crossing of walls 1 and 2');
  const solids = asmSolids(gen.id, p, 3, keys);
  assert.ok(Array.isArray(solids));
  assert.deepEqual(findOverlaps(solids), [], 'no part overlaps another in 3D');
});

await atest('pack: open front, and open front and left: one assembly, no overlaps', async () => {
  for (const open of [{ wallFront: false }, { wallFront: false, wallLeft: false, lid: true }]) {
    const p = G.normalizeParams(gen, { ...G.defaultParams(gen), ...open });
    const r = await run(open);
    assert.deepEqual(r.issues, [], JSON.stringify(open));
    const keys = new Set(r.parts.map((x) => x.shape.part!));
    let rep = assemblyReport(gen.id, p, keys);
    for (let i = 0; i < 100 && !rep; i++) {
      await new Promise((res) => setTimeout(res, 20));
      rep = assemblyReport(gen.id, p, keys);
    }
    assert.ok(rep);
    assert.deepEqual(rep.groups.length, 1, JSON.stringify(open));
    assert.deepEqual(rep.conflicts, []);
    const solids = asmSolids(gen.id, p, 3, keys);
    assert.ok(Array.isArray(solids));
    assert.deepEqual(findOverlaps(solids), [], JSON.stringify(open));
  }
});

await atest('pack: material missing, without kerf or play; broken walls; a block larger than the work area', async () => {
  ctx.material = null;
  assert.deepEqual((await run({ fromMaterial: true })).issues.map((i) => i.code), ['material-none']);
  assert.deepEqual((await run()).issues, [], 'without "From material" the fields are used');
  ctx.material = { ...PLY, kerf: null, slotPlay: null };
  assert.deepEqual((await run({ fromMaterial: true })).issues.map((i) => [i.code, i.level]), [['material-no-kerf', 'warn'], ['material-no-play', 'warn']]);
  ctx.material = PLY;
  assert.deepEqual((await run({ walls: '{"walls":[' })).issues.map((i) => i.code), ['walls-bad']);
  assert.deepEqual((await run({ width: 350, depth: 250 })).distribute, { rotate: false }, 'spread over pages, not turned');
  assert.ok((await run({ width: 500, depth: 350 })).issues.some((i) => i.code === 'check-too-big'), 'a part larger than the work area');
});

await atest('pack: "From material" copies the material into the fields and warns when the layer changes', async () => {
  ctx.material = { name: 'Birch 4 mm', thickness: 4, kerf: 0.12, pairPlay: null, slotPlay: 0.15 };
  const p = G.normalizeParams(gen, { ...G.defaultParams(gen), fromMaterial: true });
  // onChange gets the layer's current material (#404), without a computation before
  const ch = await gen.onChange!('fromMaterial', false, p);
  assert.deepEqual(ch && 'patch' in ch ? ch.patch : null, { thickness: 4, kerf: 0.12, clearance: 0.15 });
  const synced = { ...p, thickness: 4, kerf: 0.12, clearance: 0.15 };
  assert.deepEqual((await G.buildGenAsync(gen, synced)).issues, [], 'in step with the material');
  assert.deepEqual((await gen.onChange!('width', 100, synced)) ?? null, null, 'other fields: nothing to take over');
  ctx.material = { ...ctx.material as object, thickness: 6 };
  const changed = (await G.buildGenAsync(gen, synced)).issues;
  assert.deepEqual(changed.map((i) => i.code), ['material-changed']);
  assert.match(changed[0].msg, /\(6 mm\)/, 'names the thickness of the new material');
  ctx.material = PLY;
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
process.exit(0);
