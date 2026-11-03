// Tests der Beziehungen (einmal angewendet) und Messwerte. Aufruf: npm run test:relations
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Mat, Pt } from '../src/model';
const { apply } = await import('../src/model');
const { relationTransform, relAccepts, currentDistance, measureOf, angleBetween } = await import('../src/relations');
type Elem = Parameters<typeof relationTransform>[1];

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
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const nearPt = (p: Pt, q: Pt, eps = 1e-6) => {
  near(p.x, q.x, eps);
  near(p.y, q.y, eps);
};
const T = (r: ReturnType<typeof relationTransform>): Mat => {
  assert.ok(r.ok, r.ok ? '' : r.msg);
  return (r as { T: Mat }).T;
};
const mv = (m: Mat, p: Pt) => apply(m, p.x, p.y);
const circle = (x: number, y: number, r: number): Elem => ({ kind: 'circle', c: { x, y }, r });
const edge = (ax: number, ay: number, bx: number, by: number): Elem => ({ kind: 'edge', a: { x: ax, y: ay }, b: { x: bx, y: by } });
const dir = (m: Mat, e: Elem & { kind: 'edge' }) => {
  const a = mv(m, e.a),
    b = mv(m, e.b);
  return Math.atan2(b.y - a.y, b.x - a.x);
};

test('konzentrisch: Mittelpunkt des Ziels landet auf der Referenz', () => {
  const m = T(relationTransform('concentric', circle(10, 20, 5), circle(40, 60, 3)));
  nearPt(mv(m, { x: 40, y: 60 }), { x: 10, y: 20 });
});

test('gleich groß: Kreis skaliert um seinen Mittelpunkt, Kanten auf gleiche Länge', () => {
  const r = relationTransform('equal', circle(0, 0, 10), circle(50, 50, 4));
  assert.ok(r.ok && r.scaled);
  const m = T(r);
  nearPt(mv(m, { x: 50, y: 50 }), { x: 50, y: 50 });
  nearPt(mv(m, { x: 54, y: 50 }), { x: 60, y: 50 });
  const m2 = T(relationTransform('equal', edge(0, 0, 30, 0), edge(0, 10, 0, 20)));
  const a = mv(m2, { x: 0, y: 10 }),
    b = mv(m2, { x: 0, y: 20 });
  near(Math.hypot(b.x - a.x, b.y - a.y), 30);
  assert.ok(!relationTransform('equal', circle(0, 0, 1), edge(0, 0, 1, 0)).ok);
});

test('parallel und senkrecht: kleinste Drehung um die Mitte der Zielkante', () => {
  const ref = edge(0, 0, 10, 10) as Elem & { kind: 'edge' };
  const tgt = edge(100, 0, 110, 1) as Elem & { kind: 'edge' };
  const m = T(relationTransform('parallel', ref, tgt));
  near(Math.tan(dir(m, tgt)), 1, 1e-9);
  nearPt(mv(m, { x: 105, y: 0.5 }), { x: 105, y: 0.5 });
  const p = T(relationTransform('perpendicular', ref, tgt));
  near(Math.abs(Math.cos(dir(p, tgt) - Math.PI / 4)), 0, 1e-9);
  // umgekehrte Kante: dreht nicht um 180°
  const back = edge(110, 1, 100, 0) as Elem & { kind: 'edge' };
  const mb = T(relationTransform('parallel', ref, back));
  const ang = Math.atan2(mb[1], mb[0]);
  assert.ok(Math.abs(ang) < Math.PI / 2, `Drehung ${ang}`);
});

test('horizontal und vertikal: eine Kante, Drehung um ihre Mitte', () => {
  const e = edge(0, 0, 10, 2) as Elem & { kind: 'edge' };
  const h = T(relationTransform('horizontal', e, null));
  near(Math.sin(dir(h, e)), 0, 1e-9);
  nearPt(mv(h, { x: 5, y: 1 }), { x: 5, y: 1 });
  const v = T(relationTransform('vertical', e, null));
  near(Math.cos(dir(v, e)), 0, 1e-9);
});

test('tangential: Kreis rückt an die Gerade, Gerade an den Kreis, Kreise berühren sich', () => {
  const line = edge(0, 0, 100, 0);
  // Kreis unter der Geraden (y nach unten = positiv), Radius 5, Mitte 12 entfernt → rückt auf 5
  const m = T(relationTransform('tangent', line, circle(50, 12, 5)));
  nearPt(mv(m, { x: 50, y: 12 }), { x: 50, y: 5 });
  // Kante ist das Ziel: sie rückt zum Kreis
  const m2 = T(relationTransform('tangent', circle(50, 12, 5), line));
  nearPt(mv(m2, { x: 0, y: 0 }), { x: 0, y: 7 });
  // zwei Kreise außen
  const m3 = T(relationTransform('tangent', circle(0, 0, 10), circle(30, 40, 5)));
  const c = mv(m3, { x: 30, y: 40 });
  near(Math.hypot(c.x, c.y), 15);
  // kleiner Kreis innen: berührt innen
  const m4 = T(relationTransform('tangent', circle(0, 0, 10), circle(1, 0, 2)));
  const c4 = mv(m4, { x: 1, y: 0 });
  near(Math.hypot(c4.x, c4.y), 8);
  assert.ok(!relationTransform('tangent', edge(0, 0, 1, 0), edge(0, 1, 1, 1)).ok);
});

test('Abstand: parallele Kanten, Kante–Kreis, Punkt–Punkt', () => {
  const m = T(relationTransform('distance', edge(0, 0, 100, 0), edge(0, 30, 50, 30), 12));
  near(mv(m, { x: 0, y: 30 }).y, 12);
  near(currentDistance(edge(0, 0, 100, 0), edge(0, 30, 50, 30)), 30);
  const m2 = T(relationTransform('distance', edge(0, 0, 0, 100), circle(40, 50, 3), 10));
  nearPt(mv(m2, { x: 40, y: 50 }), { x: 10, y: 50 });
  const m3 = T(relationTransform('distance', { kind: 'point', p: { x: 0, y: 0 } }, circle(30, 40, 2), 25));
  nearPt(mv(m3, { x: 30, y: 40 }), { x: 15, y: 20 });
});

test('Welche Elemente passen: Konzentrisch nur Kreise, gleich groß gleicher Art', () => {
  assert.ok(relAccepts('concentric', 0, circle(0, 0, 1)));
  assert.ok(!relAccepts('concentric', 0, edge(0, 0, 1, 0)));
  assert.ok(!relAccepts('equal', 1, edge(0, 0, 1, 0), circle(0, 0, 1)));
  assert.ok(relAccepts('tangent', 1, circle(0, 0, 1), edge(0, 0, 1, 0)));
  assert.ok(!relAccepts('tangent', 1, edge(0, 0, 1, 0), edge(0, 0, 1, 0)));
  assert.ok(!relAccepts('parallel', 0, { kind: 'point', p: { x: 0, y: 0 } }));
});

test('Messen: Länge, Δ in Maschinenrichtung, Winkel, Winkel zwischen Kanten', () => {
  const r = measureOf({ x: 0, y: 0 }, { x: 30, y: -40 });
  near(r.len, 50);
  near(r.dx, 30);
  near(r.dy, 40);
  near(r.angle, (Math.atan2(40, 30) * 180) / Math.PI);
  near(measureOf({ x: 0, y: 0 }, { x: 0, y: 10 }).angle, 270);
  near(angleBetween(edge(0, 0, 10, 0) as never, edge(0, 0, 0, 10) as never), 90);
  near(angleBetween(edge(0, 0, 10, 0) as never, edge(10, 10, 0, 10) as never), 0);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
