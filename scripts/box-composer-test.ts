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
const pack = parsePack(buildPluginPack('plugins/box-composer')).plugins[0];
// A new box starts without inner walls; the tests work on the sketch from #327 in the inner rectangle 94 × 194
const SKETCH = '[{"id":1,"axis":"h","pos":97,"from":0,"to":94},{"id":2,"axis":"v","pos":47,"from":0,"to":150.35},{"id":3,"axis":"h","pos":150.35,"from":47,"to":94},{"id":4,"axis":"v","pos":19.74,"from":97,"to":169.75}]';
const manifest = { ...pack, schema: pack.schema.map((q) => (q.key === 'walls' ? { ...q, def: SKETCH } : q.key === 'wallsRef' ? { ...q, def: '[94,194]' } : q)) };
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

await atest('pack: a new box starts with the outer walls only', async () => {
  const w = pack.schema.find((q) => q.key === 'walls')!,
    r = pack.schema.find((q) => q.key === 'wallsRef')!;
  assert.deepEqual([w.def, w.resetOnNew, r.def, r.resetOnNew], ['[]', true, '', true]);
  const empty = pluginGenerator(pack, { id: 'box-composer-new', name: 'Box composer' }, { context: (k: string) => (ctx[k] ?? null) as never });
  Object.assign(ctx, { material: PLY, workArea: { width: 400, height: 300 } });
  const out = await G.buildGenAsync(empty, G.normalizeParams(empty, G.defaultParams(empty)));
  assert.deepEqual(out.issues, []);
  assert.deepEqual(out.parts.map((x) => x.shape.part).sort(), ['back', 'floor', 'front', 'left', 'right']);
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
  assert.deepEqual((await gen.onChange!('height', 40, synced)) ?? null, null, 'other fields: nothing to take over');
  assert.deepEqual((await gen.onChange!('width', 100, synced)) ?? null, null, 'the same width again: no question');
  ctx.material = { ...ctx.material as object, thickness: 6 };
  const changed = (await G.buildGenAsync(gen, synced)).issues;
  assert.deepEqual(changed.map((i) => i.code), ['material-changed']);
  assert.match(changed[0].msg, /\(6 mm\)/, 'names the thickness of the new material');
  ctx.material = PLY;
});

await atest('pack: the wall list names every row; a row removed in the list removes the wall', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const rows = JSON.parse(String(G.defaultParams(gen).walls)) as Wall[];
  const [first, after] = await runDialog(manifest, [{ walls: JSON.stringify(rows.filter((r) => r.id !== 4)) }]);
  assert.deepEqual(first.rows.walls, ['1 · X', '2 · Y', '3 · X', '4 · Y']);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(after.rows.walls, ['1 · X', '2 · Y', '3 · X']);
  assert.deepEqual(after.issues, []);
  assert.ok(!after.parts.some((p) => p.key.endsWith('4')) && first.parts.length === after.parts.length + 1, 'one part less');
});

// --- Plan editor (#385): pointer events on the drawing surface, through the headless runner -------------------------
// The sketch in the inner rectangle 94 × 194: 1 = h at 97 (0–94), 2 = v at 47 (0–150.35), 3 = h at 150.35 (47–94),
// 4 = v at 19.74 (97–169.75, a T on wall 1)
const wallsOf = (s: { params: Record<string, unknown> }) => JSON.parse(String(s.params.walls)) as Wall[];
const byId = (s: { params: Record<string, unknown> }, id: number) => wallsOf(s).find((w) => w.id === id);
const drag = (hit: string | undefined, x0: number, y0: number, x1: number, y1: number, extra: Record<string, unknown> = {}) => [
  { type: 'down', x: x0, y: y0, ...(hit ? { hit } : {}), ...extra },
  { type: 'move', x: x1, y: y1, drag: true, from: { x: x0, y: y0 }, ...extra },
  { type: 'up', x: x1, y: y1, from: { x: x0, y: y0 }, ...extra },
];
/** A double click on the wall first (the whole wall), then the drag */
const dragWhole = (hit: string, x0: number, y0: number, x1: number, y1: number) => [{ type: 'dblclick', x: x0, y: y0, hit }, ...drag(hit, x0, y0, x1, y1)];

await atest('plan: dragging a wall moves it, walls ending on it follow; one parameter change on release', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const [start, moved] = await runDialog(manifest, [{ $surface: dragWhole('w1', 20, 97, 20, 107.4) }]);
  assert.ok(start.surface!.items > 10 && start.surface!.layers === 1, 'walls, ends and the outer box are drawn');
  // Escape: closes the dialog while nothing is selected, clears the selection otherwise (#411)
  assert.equal(start.surface!.escape, false);
  assert.equal(moved.surface!.escape, true);
  assert.deepEqual(byId(moved, 1), { id: 1, axis: 'h', pos: 107, from: 0, to: 94 }, 'moved, rounded to whole mm');
  assert.equal(byId(moved, 4)!.from, 107, 'the T on it follows');
  assert.deepEqual(byId(moved, 2), byId(start, 2), 'the crossing wall stays');
  assert.equal(moved.params.wallsRef, '[94,194]');
  assert.equal(moved.surface!.selected.walls, 0, 'the moved wall is selected');
  assert.deepEqual(moved.surface!.state, { at: { id: 1, along: 20 }, sel: { axis: 'h', pos: 107, runs: [[0, 94]] } }, 'after the release where its measures are taken and the selection');
  // Measured where the pointer held it (x = 20): from the inside of the back wall 107 − 1.5, to the front wall
  // 195.5 − 107 − 3 (wall 3 is not there; numbers in the system's format)
  assert.match(moved.message ?? '', /^Wall 1 · clear behind 105[.,]5 mm, in front 85[.,]5 mm · length 94 mm$/, 'the measures under the plan');
  assert.deepEqual(moved.issues, []);
});

await atest('plan: a dragged wall goes to the nearest place where it may stand; a wall that cannot be added is refused', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const [start, held] = await runDialog(manifest, [{ $surface: dragWhole('w1', 20, 97, 20, 150) }]);
  assert.equal(byId(held, 1)!.pos, 144, 'not onto wall 3');
  const [, past] = await runDialog(manifest, [{ $surface: dragWhole('w1', 20, 97, 20, 156) }]);
  assert.equal(byId(past, 1)!.pos, 157, 'over wall 3 to below it');
  assert.deepEqual(past.issues, []);
  const [, short] = await runDialog(manifest, [{ $surface: drag('e4.to', 19.74, 169.75, 19.74, 99) }]);
  assert.equal(byId(short, 4)!.to, 105, 'as short as a free end may be');
  const [, close] = await runDialog(manifest, [{ $surface: [{ type: 'dblclick', x: 70, y: 99 }] }]);
  assert.equal(close.params.walls, start.params.walls);
  assert.match(close.message ?? '', /closer than 3 mm/);
});

await atest('plan: a click takes the stretch under the pointer; dragged, it leaves its wall (a U); Shift adds stretches', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const shape = (st: { params: Record<string, unknown> }) => wallsOf(st).map((w) => [w.axis, w.pos, w.from, w.to].join(' ')).sort();
  // Wand 1 zwischen Wand 4 (19.74) und Wand 2 (47) nach hinten: Wand 4 kommt von vorne und wird länger, der Rest bleibt
  const [, u] = await runDialog(manifest, [{ $surface: drag('w1', 30, 97, 30, 85.2) }]);
  assert.deepEqual(shape(u), ['h 150.35 47 94', 'h 85 19.74 47', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 85 169.75', 'v 47 0 150.35']);
  assert.deepEqual(u.issues, []);
  assert.deepEqual((u.surface!.state as { sel?: unknown }).sel, { axis: 'h', pos: 85, runs: [[19.74, 47]] }, 'the stretch stays selected where it is now');
  // Mit Umschalt das Stück rechts dazu (bis zur rechten Außenwand), beide zusammen nach hinten
  const click = (x: number, y: number, hit: string) => [{ type: 'down', x, y, hit }, { type: 'up', x, y, from: { x, y } }];
  const [, two] = await runDialog(manifest, [{ $surface: [...click(30, 97, 'w1'), ...drag('w1', 60, 97, 60, 85.2, { shift: true })] }]);
  assert.deepEqual(shape(two), ['h 150.35 47 94', 'h 85 19.74 94', 'h 97 0 19.74', 'v 19.74 85 169.75', 'v 47 0 150.35']);
  assert.deepEqual(two.issues, []);
  // Rechtsklick löscht nur das Stück unter dem Zeiger
  const [, cut] = await runDialog(manifest, [{ $surface: [{ type: 'context', x: 30, y: 97, hit: 'w1' }] }]);
  assert.deepEqual(shape(cut), ['h 150.35 47 94', 'h 97 0 19.74', 'h 97 47 94', 'v 19.74 97 169.75', 'v 47 0 150.35']);
});

await atest('plan: Ctrl shows a target on the selection; a click adds a wall from there across the compartment, a drag draws it', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const click = (x: number, y: number, hit: string) => [{ type: 'down', x, y, hit }, { type: 'up', x, y, from: { x, y } }];
  // Stück 19.74 … 47 von Wand 1 gewählt, Strg vor der Wand: Ziel in seiner Mitte (33.37), Seite vorne
  const [, aimed] = await runDialog(manifest, [{ $surface: [...click(30, 97, 'w1'), { type: 'move', x: 32, y: 103, ctrl: true }] }]);
  const aim = (aimed.surface!.state as { aim?: { along: number; side: number; sel: unknown } }).aim!;
  assert.deepEqual([aim.along, aim.side, aim.sel], [33.37, 1, { axis: 'h', pos: 97, runs: [[19.74, 47]] }]);
  assert.equal(aimed.surface!.cursor, 'default', 'with the target the normal cursor, also over walls');
  const [, added] = await runDialog(manifest, [{ $surface: [...click(30, 97, 'w1'), ...click(32, 103, 'w1').map((e) => ({ ...e, ctrl: true }))] }]);
  assert.deepEqual(byId(added, 5), { id: 5, axis: 'v', pos: 33.37, from: 97, to: 194 }, 'from wall 1 to the front wall');
  assert.deepEqual(added.issues, []);
  const [, drawn] = await runDialog(manifest, [{ $surface: [...click(30, 97, 'w1'), ...drag(undefined, 32, 103, 32, 150, { ctrl: true })] }]);
  assert.deepEqual(byId(drawn, 5), { id: 5, axis: 'v', pos: 33.37, from: 97, to: 150 }, 'drawn from the target to the pointer');
  // Ohne Auswahl, nahe an Wand 4 (x 19.74): das Ziel auf ihr, in der Mitte ihres Stücks; der Klick setzt eine Wand nach rechts bis Wand 2
  const [, near] = await runDialog(manifest, [{ $surface: [{ type: 'move', x: 23, y: 130, ctrl: true }] }]);
  const a4 = (near.surface!.state as { aim?: { along: number; side: number; sel: unknown } }).aim!;
  assert.deepEqual([a4.along, a4.side, a4.sel], [133.38, 1, { axis: 'v', pos: 19.74, runs: [[97, 169.75]] }], 'wall 4 preselected');
  const [, fromFour] = await runDialog(manifest, [{ $surface: [{ type: 'down', x: 23, y: 130, ctrl: true }, { type: 'up', x: 23, y: 130, from: { x: 23, y: 130 }, ctrl: true }] }]);
  assert.deepEqual(byId(fromFour, 5), { id: 5, axis: 'h', pos: 133.38, from: 19.74, to: 47 });
  assert.deepEqual(fromFour.issues, []);
  // Ohne Strg verschwindet das Ziel
  const [, gone] = await runDialog(manifest, [{ $surface: [...click(30, 97, 'w1'), { type: 'move', x: 32, y: 103, ctrl: true }, { type: 'move', x: 32, y: 104 }] }]);
  assert.equal((gone.surface!.state as { aim?: unknown }).aim, undefined);
  // Strg im leeren Raum: ein Kreuz, Ziehen zeichnet eine freie Wand (das Ende rastet an der rechten Außenwand ein)
  const [, cross] = await runDialog(manifest, [{ $surface: [{ type: 'move', x: 60.3, y: 120, ctrl: true }] }]);
  assert.deepEqual((cross.surface!.state as { free?: unknown }).free, [60, 120]);
  const [, free] = await runDialog(manifest, [{ $surface: drag(undefined, 60, 120, 92, 121, { ctrl: true }) }]);
  assert.deepEqual(byId(free, 5), { id: 5, axis: 'h', pos: 120, from: 60, to: 94 }, 'drawn left to right, the end snapped to the right wall');
  assert.deepEqual(free.issues, []);
});

await atest('plan: double click adds a wall across the compartment (Shift: the other way); Ctrl+Shift+click takes the whole wall', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const [, across] = await runDialog(manifest, [{ $surface: [{ type: 'dblclick', x: 70, y: 40.3 }] }]);
  assert.deepEqual(byId(across, 5), { id: 5, axis: 'h', pos: 40, from: 47, to: 94 }, 'from wall 2 to the right wall');
  assert.equal(across.surface!.selected.walls, 4, 'the new wall is selected');
  assert.deepEqual(across.issues, []);
  const [, deep] = await runDialog(manifest, [{ $surface: [{ type: 'dblclick', x: 70, y: 40, shift: true }] }]);
  assert.deepEqual(byId(deep, 5), { id: 5, axis: 'v', pos: 71.25, from: 0, to: 97 }, 'from the back wall to wall 1, near the middle: in the middle');
  const [, mid] = await runDialog(manifest, [{ $surface: [{ type: 'dblclick', x: 70, y: 45 }] }]);
  assert.deepEqual(byId(mid, 5), { id: 5, axis: 'h', pos: 47.75, from: 47, to: 94 }, 'near the middle: in the middle');
  const [, all] = await runDialog(manifest, [{ $surface: drag('w1', 20, 97, 20, 107.4, { ctrl: true, shift: true }) }]);
  assert.deepEqual(byId(all, 1), { id: 1, axis: 'h', pos: 107, from: 0, to: 94 }, 'the whole wall moved');
  assert.equal(byId(all, 4)!.from, 107, 'the T on it follows');
  assert.deepEqual(all.issues, []);
});

await atest('plan: Delete removes the selected wall, a right click the one under the pointer; ends snap when stretched', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const [, del] = await runDialog(manifest, [{ $surface: [{ type: 'down', x: 19.74, y: 130, hit: 'w4' }, { type: 'up', x: 19.74, y: 130, from: { x: 19.74, y: 130 } }, { type: 'key', x: 0, y: 0, key: 'Delete' }] }]);
  assert.deepEqual(wallsOf(del).map((w) => w.id), [1, 2, 3]);
  assert.equal(del.surface!.selected.walls, -1);
  const [, ctx] = await runDialog(manifest, [{ $surface: [{ type: 'context', x: 70, y: 150.35, hit: 'w3' }] }]);
  assert.deepEqual(wallsOf(ctx).map((w) => w.id), [1, 2, 4]);
  assert.deepEqual(ctx.issues, [], 'wall 2 keeps a free end where wall 3 was');
  const [, long] = await runDialog(manifest, [{ $surface: drag('e4.to', 19.74, 169.75, 19.74, 191) }]);
  assert.equal(byId(long, 4)!.to, 194, 'snapped to the front wall');
  assert.deepEqual(long.issues, []);
});

await atest('plan: a wall dragged near the middle between its neighbours snaps there, for even divisions', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  // Wand 4 zwischen der linken Außenwand (Innenseite bei 0) und Wand 2 (bei 47): Mitte (−1.5 + 47) / 2 = 22.75
  const [, mid] = await runDialog(manifest, [{ $surface: drag('w4', 19.74, 130, 21, 130) }]);
  assert.equal(byId(mid, 4)!.pos, 22.75);
  assert.match(mid.message ?? '', /^Wall 4 · centred · clear on the left 21[.,]25 mm, on the right 21[.,]25 mm/);
  const [, off] = await runDialog(manifest, [{ $surface: drag('w4', 19.74, 130, 31, 130) }]);
  assert.equal(byId(off, 4)!.pos, 31, 'further away: no snap');
  assert.doesNotMatch(off.message ?? '', /centred/);
});

await atest('plan: measured and centred where the pointer holds the wall; the middle of a wall it crosses', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  // Wand 1 (quer bei 97) kreuzt Wand 2 (0–150.35): deren Mitte 75.175; der Zeiger bei x = 20
  const [, onWall] = await runDialog(manifest, [{ $surface: dragWhole('w1', 20, 97, 20, 78) }]);
  assert.equal(byId(onWall, 1)!.pos, 75.175);
  assert.match(onWall.message ?? '', /^Wall 1 · in the middle of wall 2 · /);
  // Wand 2 (längs bei 47) zwischen linker Außenwand und Wand 4 nur unten (97–169.75): oben gefasst ist die Mitte die
  // ganze Breite, unten zwischen Wand 4 und der rechten Außenwand
  const [, low] = await runDialog(manifest, [{ $surface: dragWhole('w2', 47, 120, 55, 120) }]);
  assert.equal(byId(low, 2)!.pos, 57.62, 'pointer at y = 120: the middle between wall 4 (19.74) and the right wall');
  assert.match(low.message ?? '', /^Wall 2 · centred · /);
});

await atest('plan: with the side open, the middle and the measures go to the edge of the floor', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  // Linke Seite offen: der Boden reicht bis −3; Mitte zwischen −4.5 (als Mittellinie) und Wand 2 (47) = 21.25
  const [, open] = await runDialog(manifest, [{ wallLeft: false, $surface: drag('w4', 19.74, 130, 21, 130) }]);
  assert.equal(byId(open, 4)!.pos, 21.25);
  assert.match(open.message ?? '', /^Wall 4 · centred · clear on the left 22[.,]75 mm, on the right 22[.,]75 mm/);
});

await atest('plan: a wall dragged near the middle of the box snaps there, with a guide and the measures', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const walls = JSON.stringify([{ id: 1, axis: 'h', pos: 97, from: 0, to: 94 }, { id: 2, axis: 'v', pos: 70, from: 97, to: 194 }, { id: 3, axis: 'v', pos: 20, from: 97, to: 194 }]);
  const [, s] = await runDialog(manifest, [{ walls, $surface: drag('w2', 70, 150, 50, 150) }]);
  assert.equal(byId(s, 2)!.pos, 47);
  assert.match(s.message ?? '', /^Wall 2 · in the middle of the box · clear on the left 24 mm, on the right 45[.,]5 mm/);
});

await atest('plan: the selected wall\'s measures as fields beside the preview; a typed value moves it or sets its length (#411)', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const whole = (hit: string, x: number, y: number) => ({ type: 'dblclick', x, y, hit });
  const field = (id: string, value: number) => ({ type: 'field', x: 0, y: 0, field: id, value });
  const [start, one] = await runDialog(manifest, [{ $surface: [whole('w1', 20, 97)] }]);
  assert.deepEqual(start.surface!.fields, [], 'nothing selected: no fields');
  // Wall 1 runs from the left to the right outer wall: both ends joined, the length cannot be typed
  assert.deepEqual(one.surface!.fields, [
    { id: 'a', label: 'Clear behind', value: 95.5 },
    { id: 'b', label: 'Clear in front', value: 95.5 },
    { id: 'len', label: 'Length', value: 94, readonly: true },
  ]);
  const [, behind] = await runDialog(manifest, [{ $surface: [whole('w1', 20, 97), field('a', 80)] }]);
  assert.equal(byId(behind, 1)!.pos, 81.5, '80 mm clear from the inside of the back wall');
  assert.equal(byId(behind, 4)!.from, 81.5, 'the T on it follows, as when dragged');
  assert.equal(behind.surface!.fields![0].value, 80);
  const [, front] = await runDialog(manifest, [{ $surface: [whole('w1', 20, 97), field('b', 100)] }]);
  assert.equal(byId(front, 1)!.pos, 92.5);
  const [, far] = await runDialog(manifest, [{ $surface: [whole('w1', 20, 97), field('a', 300)] }]);
  assert.equal(far.params.walls, start.params.walls, 'outside the box: refused');
  assert.ok(far.message, 'with a message why');
  const [, len] = await runDialog(manifest, [{ $surface: [whole('w1', 20, 97), field('len', 50)] }]);
  assert.equal(len.params.walls, start.params.walls, 'a joined length is not changed');
  // Wall 4 ends on wall 1 (T) and is free at the front: the length moves the free end
  const [, four] = await runDialog(manifest, [{ $surface: [whole('w4', 19.74, 130)] }]);
  assert.deepEqual(four.surface!.fields!.map((f) => [f.id, f.label, f.value, !!f.readonly]), [['a', 'Clear on the left', 18.24, false], ['b', 'Clear on the right', 24.26, false], ['len', 'Length', 72.75, false]]);
  const [, shorter] = await runDialog(manifest, [{ $surface: [whole('w4', 19.74, 130), field('len', 60)] }]);
  assert.deepEqual(byId(shorter, 4), { id: 4, axis: 'v', pos: 19.74, from: 97, to: 157 });
  assert.deepEqual(shorter.issues, []);
});

await atest('plan: the length shown is that of the selected stretch: in the drawing (turned along a vertical wall), the field and the message', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  // Wall 2 (x = 47) from wall 1 (y = 97) to a free end at 180, crossed by wall 3 (y = 140): stretches 97–140 and 140–180
  const walls = JSON.stringify([{ id: 1, axis: 'h', pos: 97, from: 0, to: 94 }, { id: 2, axis: 'v', pos: 47, from: 97, to: 180 }, { id: 3, axis: 'h', pos: 140, from: 0, to: 94 }]);
  const click = (x: number, y: number, hit: string) => [{ type: 'down', x, y, hit }, { type: 'up', x, y, from: { x, y } }];
  const field = (id: string, value: number) => ({ type: 'field', x: 0, y: 0, field: id, value });
  const len = (s: Awaited<ReturnType<typeof runDialog>>[number]) => s.surface!.fields!.find((f) => f.id === 'len')!;
  const texts = async (s: Awaited<ReturnType<typeof runDialog>>[number]) => {
    const { view, state, selected } = s.surface!;
    const d = await gen.draw!({ view, state, selected, have: [], size: { width: 560, height: 300 } }, G.normalizeParams(gen, s.params));
    return d.items.filter((i) => i.type === 'text') as { text: string; angle?: number; align?: string }[];
  };
  const [, free] = await runDialog(manifest, [{ walls, $surface: click(47, 160, 'w2') }]);
  assert.deepEqual(free.issues, []);
  assert.deepEqual(len(free), { id: 'len', label: 'Length', value: 40 }, 'the stretch up to the free end: its length can be typed');
  assert.match(free.message ?? '', /length 40 mm$/);
  const shown = (await texts(free)).find((i) => i.text.startsWith('↔'));
  assert.deepEqual(shown, { type: 'text', x: shown && (shown as { x: number }).x, y: 160, text: '↔ 40 mm', style: 'accent', align: 'center', angle: 90, bubble: true }, 'centred on the stretch 140–180, on a bubble');
  assert.ok((shown as unknown as { x: number }).x < 47 - 1.5, 'beside the wall, on the side without its number');
  for (const i of await texts(free)) assert.equal(i.align, 'center', `centred: ${i.text}`);
  assert.ok((await texts(free)).filter((i) => / mm$/.test(i.text)).every((i) => (i as { bubble?: boolean }).bubble), 'every measure on a bubble');
  const [, joined] = await runDialog(manifest, [{ walls, $surface: click(47, 120, 'w2') }]);
  assert.deepEqual(len(joined), { id: 'len', label: 'Length', value: 43, readonly: true }, 'between two joints: follows them');
  assert.match(joined.message ?? '', /length 43 mm$/);
  const [, wholeWall] = await runDialog(manifest, [{ walls, $surface: [{ type: 'dblclick', x: 47, y: 160, hit: 'w2' }] }]);
  assert.equal(len(wholeWall).value, 83, 'the whole wall');
  // Typed: the free end moves, the stretch stays selected with its new length
  const [, typed] = await runDialog(manifest, [{ walls, $surface: [...click(47, 160, 'w2'), field('len', 50)] }]);
  assert.deepEqual(byId(typed, 2), { id: 2, axis: 'v', pos: 47, from: 97, to: 190 });
  assert.equal(len(typed).value, 50);
  const [, still] = await runDialog(manifest, [{ walls, $surface: [...click(47, 120, 'w2'), field('len', 60)] }]);
  assert.equal(still.params.walls, walls, 'a stretch joined at both ends is not changed');
  // A horizontal wall: its length reads normally, the numbers of the dimension lines (vertical) are turned
  const [, h] = await runDialog(manifest, [{ walls, $surface: click(20, 140, 'w3') }]);
  const ht = await texts(h);
  assert.equal(ht.find((i) => i.text.startsWith('↔'))?.angle, undefined);
  assert.deepEqual(ht.filter((i) => / mm$/.test(i.text) && !i.text.startsWith('↔')).map((i) => i.angle), [90, 90]);
});

await atest('plan: the selected wall is marked in the preview: its part and the slots of its teeth in the floor (#411)', async () => {
  const p = G.normalizeParams(gen, G.defaultParams(gen));
  const built = await G.buildGenAsync(gen, p);
  const key = (i: number) => built.parts[i].shape.part;
  const none = await gen.draw!({ view: 'plan', state: null, selected: { walls: -1 }, have: [] }, p);
  assert.deepEqual(none.highlight, []);
  const d = await gen.draw!({ view: 'plan', state: null, selected: { walls: 1 }, have: [] }, p);
  const [wall, floor] = d.highlight!;
  assert.equal(key(wall.part), 'wall-2');
  assert.equal(wall.subs, undefined, 'the whole part');
  assert.equal(key(floor.part), 'floor');
  // Wall 2 (x = 47, 0 … 150.35) stands on the floor with its teeth: slots along x = 47 + 3 − 50 = 0 in the floor
  assert.ok(floor.subs!.length >= 2);
  for (const sp of floor.subs!) {
    const xs = sp.nodes.map((n) => n.x);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 1e-6, 'on the line of the wall');
  }
});

await atest('plan: a new width asks whether the walls scale with the box or keep their mm', async () => {
  const { runDialog } = await import('../src/plugins/headless');
  const [, keep] = await runDialog(manifest, [{ width: 120, $answer: 1 }]);
  assert.equal(keep.ask?.options.length, 2);
  assert.deepEqual([byId(keep, 1)!.to, byId(keep, 2)!.pos, byId(keep, 3)!.to, byId(keep, 4)!.pos], [114, 47, 114, 19.74]);
  assert.equal(keep.params.wallsRef, '[114,194]');
  const [, scale] = await runDialog(manifest, [{ width: 120, $answer: 0 }]);
  assert.deepEqual([byId(scale, 1)!.to, byId(scale, 2)!.pos, byId(scale, 4)!.pos], [114, 57, 23.94]);
  const [, cancel] = await runDialog(manifest, [{ width: 120 }]);
  assert.equal(cancel.params.width, 100, 'cancelled: the width goes back');
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
process.exit(0);
