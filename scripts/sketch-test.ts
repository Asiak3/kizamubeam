// Tests der Skizzen (Datenmodell, Umriss, Löser PlaneGCS). Aufruf: npm run test:sketch
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
const M = await import('../src/sketch/model');
const S = await import('../src/sketch/solver');
const { findArcs } = await import('../src/arcs');
const { subsToSketch } = await import('../src/sketch/convert');
const { shapeSubs } = await import('../src/geom');

S.setSolverWasm(resolve('node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'));
await S.loadSolver();

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
type Sk = ReturnType<typeof M.emptySketch>;

/** Rechteck aus vier Linien mit gemeinsamen Punkten (ungefähr gezeichnet) */
function roughRect(sk: Sk) {
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 41, 1), M.addPt(sk, 40.5, 19), M.addPt(sk, -1, 20.5)];
  const l = p.map((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id));
  return { p, l };
}

test('Rechteck: horizontal/vertikal, Länge und Höhe, fester Punkt → voll bestimmt', () => {
  const sk = M.emptySketch();
  const { p, l } = roughRect(sk);
  M.addCon(sk, 'horizontal', [l[0].id]);
  M.addCon(sk, 'horizontal', [l[2].id]);
  M.addCon(sk, 'vertical', [l[1].id]);
  M.addCon(sk, 'vertical', [l[3].id]);
  M.addCon(sk, 'fixed', [p[0].id], { x: 0, y: 0 });
  M.addCon(sk, 'distance', [l[0].id], { v: 50 });
  M.addCon(sk, 'distance', [l[1].id], { v: 30 });
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  assert.equal(r.dof, 0);
  near(M.ptOf(sk, p[2].id)!.x, 50);
  near(M.ptOf(sk, p[2].id)!.y, 30);
  const subs = M.sketchSubs(sk);
  assert.equal(subs.length, 1);
  assert.ok(subs[0].closed);
  assert.equal(subs[0].nodes.length, 4);
});

test('unterbestimmt: Freiheitsgrade werden gemeldet', () => {
  const sk = M.emptySketch();
  roughRect(sk);
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  assert.equal(r.dof, 8);
});

test('Widerspruch: Beziehungen werden genannt, die Skizze bleibt unverändert', () => {
  const sk = M.emptySketch();
  const { p, l } = roughRect(sk);
  M.addCon(sk, 'fixed', [p[0].id], { x: 0, y: 0 });
  M.addCon(sk, 'fixed', [p[1].id], { x: 20, y: 0 });
  const c = M.addCon(sk, 'distance', [l[0].id], { v: 10 });
  const before = JSON.stringify(sk.pts);
  const r = S.solveSketch(sk);
  assert.ok(!r.ok);
  assert.ok(r.conflicting.includes(c.id), JSON.stringify(r));
  assert.equal(JSON.stringify(sk.pts), before);
});

test('parallel, senkrecht, gleich lang, Winkel', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 1), c = M.addPt(sk, 0, 10), d = M.addPt(sk, 8, 13);
  const l1 = M.addLine(sk, a.id, b.id), l2 = M.addLine(sk, c.id, d.id);
  M.addCon(sk, 'parallel', [l1.id, l2.id]);
  M.addCon(sk, 'equal', [l1.id, l2.id]);
  assert.ok(S.solveSketch(sk).ok);
  const len = (l: typeof l1) => M.measureCon(sk, { id: 0, t: 'distance', r: [l.id] })!;
  near(len(l1), len(l2), 1e-6);
  near(M.measureCon(sk, { id: 0, t: 'angle', r: [l1.id, l2.id] })! % 180, 0, 1e-5);
  const sk2 = M.emptySketch();
  const p = [M.addPt(sk2, 0, 0), M.addPt(sk2, 10, 0), M.addPt(sk2, 10, 0.1), M.addPt(sk2, 14, 9)];
  const m1 = M.addLine(sk2, p[0].id, p[1].id), m2 = M.addLine(sk2, p[2].id, p[3].id);
  M.addCon(sk2, 'coincident', [p[1].id, p[2].id]);
  M.addCon(sk2, 'angle', [m1.id, m2.id], { v: 60 });
  assert.ok(S.solveSketch(sk2).ok);
  near(M.measureCon(sk2, { id: 0, t: 'angle', r: [m1.id, m2.id] })!, 60, 1e-5);
  // über Koinzidenz verbundene Linien bilden einen Zug
  const subs = M.sketchSubs(sk2);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].nodes.length, 3);
});

test('Kreise: Radius, Durchmesser, konzentrisch, tangential an Linie', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 20, 20), c2 = M.addPt(sk, 22, 19);
  const k1 = M.addCircle(sk, c1.id, 9), k2 = M.addCircle(sk, c2.id, 3);
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 2);
  const l = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'radius', [k1.id], { v: 10 });
  M.addCon(sk, 'diameter', [k2.id], { v: 4 });
  M.addCon(sk, 'concentric', [k1.id, k2.id]);
  M.addCon(sk, 'horizontal', [l.id]);
  M.addCon(sk, 'tangent', [l.id, k1.id]);
  assert.ok(S.solveSketch(sk).ok);
  const p1 = M.ptOf(sk, c1.id)!, p2 = M.ptOf(sk, c2.id)!;
  near(p1.x, p2.x, 1e-6);
  near(p1.y, p2.y, 1e-6);
  near((M.entOf(sk, k1.id) as { r: number }).r, 10, 1e-6);
  near((M.entOf(sk, k2.id) as { r: number }).r, 2, 1e-6);
  near(Math.abs(p1.y - M.ptOf(sk, a.id)!.y), 10, 1e-6);
  // Umriss: Kreise als Kreise erkennbar
  const arcs = findArcs(M.sketchSubs(sk));
  assert.equal(arcs.filter((x) => x.full).length, 2);
});

test('Langloch aus zwei Bögen und zwei Linien: geschlossener Umriss, tangential', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 0, 0), c2 = M.addPt(sk, 20, 0);
  const t1 = M.addPt(sk, 0, -5), b1 = M.addPt(sk, 0, 5), t2 = M.addPt(sk, 20, -5), b2 = M.addPt(sk, 20, 5);
  // Bogen links von unten (b1, Winkel 90°) über links (180°) nach oben (t1, 270°)
  const a1 = M.addArc(sk, c1.id, b1.id, t1.id);
  const a2 = M.addArc(sk, c2.id, t2.id, b2.id);
  const top = M.addLine(sk, t1.id, t2.id), bot = M.addLine(sk, b2.id, b1.id);
  M.addCon(sk, 'tangent', [top.id, a1.id]);
  M.addCon(sk, 'tangent', [bot.id, a2.id]);
  M.addCon(sk, 'radius', [a1.id], { v: 4 });
  M.addCon(sk, 'equal', [a1.id, a2.id]);
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
  const subs = M.sketchSubs(sk);
  assert.equal(subs.length, 1);
  assert.ok(subs[0].closed);
  const arcs = findArcs(subs).filter((x) => !x.full);
  assert.equal(arcs.length, 2);
  for (const x of arcs) near(x.r, 4, 0.01);
});

test('Ziehen: gezogener Punkt folgt, verbundene Beziehungen bleiben erfüllt', () => {
  const sk = M.emptySketch();
  const { p, l } = roughRect(sk);
  M.addCon(sk, 'horizontal', [l[0].id]);
  M.addCon(sk, 'horizontal', [l[2].id]);
  M.addCon(sk, 'vertical', [l[1].id]);
  M.addCon(sk, 'vertical', [l[3].id]);
  assert.ok(S.solveSketch(sk).ok);
  assert.ok(S.solveSketch(sk, { drag: { pt: p[2].id, x: 70, y: 45 } }).ok);
  near(M.ptOf(sk, p[2].id)!.x, 70, 1e-6);
  near(M.ptOf(sk, p[1].id)!.x, 70, 1e-6);
  near(M.ptOf(sk, p[3].id)!.y, 45, 1e-6);
  // fester Punkt lässt sich nicht wegziehen
  M.addCon(sk, 'fixed', [p[0].id], { x: M.ptOf(sk, p[0].id)!.x, y: M.ptOf(sk, p[0].id)!.y });
  assert.ok(S.solveSketch(sk).ok);
  assert.ok(!S.solveSketch(sk, { drag: { pt: p[0].id, x: -30, y: -30 } }).ok);
});

test('Löschen nimmt Elemente, verwaiste Punkte und Beziehungen mit; JSON hin und zurück', () => {
  const sk = M.emptySketch();
  const { l } = roughRect(sk);
  M.addCon(sk, 'parallel', [l[0].id, l[2].id]);
  M.deleteIds(sk, [l[0].id]);
  assert.equal(sk.ents.length, 3);
  assert.equal(sk.cons.length, 0);
  assert.equal(sk.pts.length, 4);
  M.deleteIds(sk, [l[1].id]);
  assert.equal(sk.pts.length, 3); // der Punkt zwischen l[0] und l[1] gehört zu nichts mehr
  const back = M.parseSketch(M.sketchJson(sk));
  assert.deepEqual(back, sk);
  assert.deepEqual(M.parseSketch('kaputt'), M.emptySketch());
});

test('Bemaßung mit Formel-Wert und waagrechter Abstand', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 13, 7);
  M.addCon(sk, 'hdistance', [a.id, b.id], { v: 25 });
  M.addCon(sk, 'vdistance', [a.id, b.id], { v: 5 });
  M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  assert.equal(r.dof, 0);
  near(M.ptOf(sk, b.id)!.x, 25, 1e-6);
  near(M.ptOf(sk, b.id)!.y, 5, 1e-6);
});

test('Umwandeln: Rechteck mit Rundungen und Loch → Linien, Bögen, Kreis, waagrecht/senkrecht', () => {
  const subs = [
    ...shapeSubs({ kind: 'rect', w: 60, h: 40, r: 8 }),
    ...shapeSubs({ kind: 'ellipse', rx: 6, ry: 6 }),
  ];
  const sk = subsToSketch(subs);
  const kinds = sk.ents.map((e) => e.t);
  assert.equal(kinds.filter((k) => k === 'line').length, 4);
  assert.equal(kinds.filter((k) => k === 'arc').length, 4);
  assert.equal(kinds.filter((k) => k === 'circle').length, 1);
  assert.equal(sk.cons.filter((c) => c.t === 'horizontal').length, 2);
  assert.equal(sk.cons.filter((c) => c.t === 'vertical').length, 2);
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  // Umriss bleibt geschlossen: Rechteck als ein geschlossener Pfad plus der Kreis
  const out = M.sketchSubs(sk);
  assert.equal(out.length, 2);
  assert.ok(out.every((sp) => sp.closed));
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
