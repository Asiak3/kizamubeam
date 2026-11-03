// Tests der Kreis- und Bogenerkennung (Mittelpunkte zeigen und fangen). Aufruf: npm run test:arcs
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Shape, SubPath } from '../src/model';
const { findArcs, shapeCenters, shownMark, segmentArc } = await import('../src/arcs');
const { shapeSubs, invalidate } = await import('../src/geom');
const { cornerSub } = await import('../src/corners');
const { buildSnapSet, findSnap } = await import('../src/snap');

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
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const K = 0.5522847498;

/** Kreis aus vier Bézier-Vierteln um (cx, cy) */
function circleSub(cx: number, cy: number, r: number): SubPath {
  const k = r * K;
  return {
    closed: true,
    nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k } },
      { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r } },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k } },
      { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r } },
    ],
  };
}
/** Bogen mit n Bézier-Stücken von a0 um sweep (wie der DXF-Import) */
function arcSub(cx: number, cy: number, r: number, a0: number, sweep: number, n: number): SubPath {
  const nodes: SubPath['nodes'] = [];
  const d = sweep / n,
    h = (4 / 3) * Math.tan(d / 4) * r;
  for (let i = 0; i <= n; i++) {
    const a = a0 + i * d;
    const x = cx + r * Math.cos(a),
      y = cy + r * Math.sin(a);
    const tx = -Math.sin(a),
      ty = Math.cos(a);
    nodes.push({ x, y, ...(i > 0 ? { cin: { x: x - tx * h, y: y - ty * h } } : {}), ...(i < n ? { cout: { x: x + tx * h, y: y + ty * h } } : {}) });
  }
  return { closed: false, nodes };
}
const path = (subs: SubPath[]): Shape => ({ kind: 'path', subs });

test('Kreis aus vier Vierteln: ein Vollkreis mit Mittelpunkt und Radius', () => {
  const a = findArcs([circleSub(10, 20, 5)]);
  assert.equal(a.length, 1);
  assert.ok(a[0].full);
  near(a[0].c.x, 10);
  near(a[0].c.y, 20);
  near(a[0].r, 5);
  near(Math.abs(a[0].sweep), 2 * Math.PI, 1e-2);
});

test('großer und kleiner Kreis werden erkannt (Toleranz wächst mit dem Radius)', () => {
  for (const r of [0.5, 3, 50, 300]) {
    const a = findArcs([circleSub(0, 0, r)]);
    assert.equal(a.length, 1, `r=${r}`);
    assert.ok(a[0].full, `r=${r}`);
    near(a[0].r, r, 1e-3 * Math.max(1, r));
  }
});

test('Platte mit Löchern: jedes Loch hat seinen Mittelpunkt', () => {
  const plate: SubPath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };
  const s = path([plate, circleSub(20, 25, 4), circleSub(80, 25, 4), circleSub(50, 25, 10)]);
  const cs = shapeCenters(s, () => shapeSubs(s));
  assert.equal(cs.length, 3);
  assert.deepEqual(cs.map((c) => [Math.round(c.x), Math.round(c.y)]), [[20, 25], [80, 25], [50, 25]]);
  assert.ok(cs.every((c) => c.kind === 'circle' && c.quads?.length === 4 && shownMark(c)));
});

test('Halbkreis aus zwei Stücken (DXF-ARC) ist ein Bogen mit 180°', () => {
  const a = findArcs([arcSub(5, 5, 8, 0, Math.PI, 2)]);
  assert.equal(a.length, 1);
  assert.equal(a[0].count, 2);
  assert.ok(!a[0].full);
  near(a[0].c.x, 5);
  near(a[0].c.y, 5);
  near(a[0].sweep, Math.PI, 1e-3);
});

test('Bogen über 180° in einem Stück bekommt die richtige Richtung', () => {
  const r = segmentArc(...((): [any, any, any, any] => {
    const sp = arcSub(0, 0, 10, 0, (240 * Math.PI) / 180, 1);
    return [sp.nodes[0], sp.nodes[0].cout, sp.nodes[1].cin, sp.nodes[1]];
  })());
  // Ein einzelnes kubisches Stück über 240° ist kein genauer Kreis mehr: darf erkannt werden oder nicht, aber nie mit falschem Winkel
  if (r) near(Math.abs(r.sweep), (240 * Math.PI) / 180, 0.05);
});

test('Langloch: zwei Halbkreise, zwei Mittelpunkte, beide angezeigt', () => {
  const a = arcSub(0, 0, 3, Math.PI / 2, Math.PI, 2),
    b = arcSub(20, 0, 3, -Math.PI / 2, Math.PI, 2);
  const slot: SubPath = { closed: true, nodes: [...a.nodes, ...b.nodes] };
  const cs = shapeCenters(path([slot]), () => [slot]);
  assert.equal(cs.length, 2);
  assert.deepEqual(cs.map((c) => [Math.round(c.x) + 0, Math.round(c.y) + 0]).sort((p, q) => p[0] - q[0]), [[0, 0], [20, 0]]);
  assert.ok(cs.every((c) => c.kind === 'arc' && shownMark(c)));
});

test('abgerundetes Rechteck: vier Eckmittelpunkte, nur gefangen, nicht angezeigt', () => {
  const s: Shape = { kind: 'rect', w: 40, h: 20, r: 5 };
  const cs = shapeCenters(s, () => shapeSubs(s));
  assert.equal(cs.length, 4);
  assert.ok(cs.every((c) => c.kind === 'arc' && !shownMark(c)));
  near(cs[0].r!, 5);
});

test('Ecke mit dem Eckenwerkzeug gerundet: Bogenmittelpunkt stimmt', () => {
  const sq: SubPath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] };
  const rounded = cornerSub(sq, [1], 'round', 4).sub;
  const a = findArcs([rounded]);
  assert.equal(a.length, 1);
  near(a[0].c.x, 16);
  near(a[0].c.y, 4);
  near(a[0].r, 4);
});

test('freie Bézierkurven, S-Kurven und Geraden sind keine Bögen', () => {
  const s: SubPath = {
    closed: false,
    nodes: [
      { x: 0, y: 0, cout: { x: 10, y: 20 } },
      { x: 30, y: 0, cin: { x: 20, y: -20 }, cout: { x: 40, y: 0.001 } },
      { x: 50, y: 0, cin: { x: 45, y: 0 } },
      { x: 80, y: 0 },
    ],
  };
  assert.equal(findArcs([s]).length, 0);
});

test('Kreis aus 36 Geraden (Vieleck-Export) zählt als Kreis', () => {
  const nodes = Array.from({ length: 36 }, (_, i) => ({ x: 50 + 12 * Math.cos((i * Math.PI) / 18), y: 40 + 12 * Math.sin((i * Math.PI) / 18) }));
  const a = findArcs([{ closed: true, nodes }]);
  assert.equal(a.length, 1);
  assert.ok(a[0].full);
  near(a[0].c.x, 50);
  near(a[0].r, 12, 0.01);
  // ein Quadrat mit 12 Knoten auf den Kanten ist kein Kreis
  const sq = Array.from({ length: 12 }, (_, i) => (i < 3 ? { x: i * 10, y: 0 } : i < 6 ? { x: 30, y: (i - 3) * 10 } : i < 9 ? { x: 30 - (i - 6) * 10, y: 30 } : { x: 0, y: 30 - (i - 9) * 10 }));
  assert.equal(findArcs([{ closed: true, nodes: sq }]).length, 0);
});

test('Ellipse und Vieleck: Mittelpunkt im Ursprung der Form, Ellipse mit Quadranten', () => {
  const e = shapeCenters({ kind: 'ellipse', rx: 10, ry: 6 }, () => []);
  assert.equal(e.length, 1);
  assert.equal(e[0].kind, 'ellipse');
  assert.deepEqual(e[0].quads, [{ x: 10, y: 0 }, { x: 0, y: 6 }, { x: -10, y: 0 }, { x: 0, y: -6 }]);
  const p = shapeCenters({ kind: 'polygon', sides: 6, r: 10, star: false, inner: 0.5 }, () => []);
  assert.equal(p[0].kind, 'polygon');
});

test('Fangen: Lochmitte und Quadrant einer Platte mit Loch', () => {
  const plate: SubPath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };
  const obj = { id: 1, m: [1, 0, 0, 1, 10, 10] as [number, number, number, number, number, number], layer: 0, shape: path([plate, circleSub(20, 25, 4)]) };
  const set = buildSnapSet([obj], () => true);
  const hit = findSnap(set, { x: 30.3, y: 34.8 }, 1);
  assert.ok(hit);
  assert.equal(hit!.kind, 'center');
  near(hit!.p.x, 30);
  near(hit!.p.y, 35);
  const q = findSnap(set, { x: 34.2, y: 35.1 }, 1);
  assert.equal(q?.kind, 'quad');
  near(q!.p.x, 34);
});

test('Zwischenspeicher: geänderte Form liefert nach invalidate neue Mittelpunkte', () => {
  const s = path([circleSub(0, 0, 5)]);
  near(shapeCenters(s, () => shapeSubs(s))[0].x, 0);
  (s as { subs: SubPath[] }).subs = [circleSub(7, 0, 5)];
  invalidate(s);
  near(shapeCenters(s, () => shapeSubs(s))[0].x, 7);
});

setTimeout(() => {
  if (failed) {
    console.log(`\n${failed} Test(s) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlle Tests bestanden');
}, 50);
