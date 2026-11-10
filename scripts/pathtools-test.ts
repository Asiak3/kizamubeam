// Tests der Pfad-Werkzeuge (Schließen, Verbinden, Zerlegen, Startpunkt, Trimmen). Aufruf: npm run test:paths
import { strict as assert } from 'node:assert';
import { SubPath } from '../src/model';
import {
  breakApart, breakAtNode, closeSubs, cutParams, extract, joinSubs, pointAt, reverseSub, setStart, splitAt, trimSpan, trimSub,
} from '../src/pathtools';
import { segments } from '../src/curves';

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
const line = (pts: [number, number][], closed = false): SubPath => ({ closed, nodes: pts.map(([x, y]) => ({ x, y })) });
const K = 0.5522847498;
const circle = (cx: number, cy: number, r: number): SubPath => {
  const k = r * K;
  return {
    closed: true,
    nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k }, smooth: true },
      { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r }, smooth: true },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k }, smooth: true },
      { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r }, smooth: true },
    ],
  };
};

test('Close Path: Lücke unter Toleranz wird geschlossen, darüber nicht', () => {
  const a = line([[0, 0], [10, 0], [10, 10], [0.3, 0]]);
  const b = line([[0, 0], [10, 0], [10, 10], [2, 0]]);
  const st = closeSubs([a, b], 0.5, 'line');
  assert.deepEqual(st, { open: 2, closed: 1 });
  assert.ok(a.closed && a.nodes.length === 4);
  assert.ok(!b.closed);
});

test('Close: aufeinanderliegende Enden werden verschmolzen, Kurvenanfasser bleiben', () => {
  const a: SubPath = { closed: false, nodes: [{ x: 0, y: 0, cout: { x: 0, y: -5 } }, { x: 10, y: 0 }, { x: 0, y: 0, cin: { x: -5, y: 0 } }] };
  closeSubs([a], 0.5, 'line');
  assert.ok(a.closed);
  assert.equal(a.nodes.length, 2);
  assert.deepEqual(a.nodes[0].cin, { x: -5, y: 0 });
  assert.deepEqual(a.nodes[0].cout, { x: 0, y: -5 });
});

test('Close mit Toleranz: Enden zusammenziehen trifft sich in der Mitte', () => {
  const a = line([[0, 0], [10, 0], [10, 10], [2, 0]]);
  closeSubs([a], 3, 'move');
  assert.ok(a.closed);
  assert.equal(a.nodes.length, 3);
  near(a.nodes[0].x, 1);
});

test('Auto-Join: vier lose Kanten werden ein geschlossenes Rechteck', () => {
  const subs = [line([[0, 0], [10, 0]]), line([[10, 5], [10, 0.02]]), line([[0, 5], [0, 0]]), line([[10, 5], [0, 5]])];
  const r = joinSubs(subs, 0.05);
  assert.equal(r.subs.length, 1);
  assert.ok(r.subs[0].closed);
  assert.equal(r.subs[0].nodes.length, 4);
  assert.deepEqual(r.origin[0].sort(), [0, 1, 2, 3]);
});

test('Auto-Join: zu weit entfernte Enden bleiben getrennt, Kurven bleiben Kurven', () => {
  const c: SubPath = { closed: false, nodes: [{ x: 0, y: 0, cout: { x: 3, y: 5 } }, { x: 10, y: 0, cin: { x: 7, y: 5 } }] };
  const r = joinSubs([c, line([[10, 0], [20, 0]]), line([[30, 0], [40, 0]])], 0.05);
  assert.equal(r.subs.length, 2);
  const j = r.subs.find((s) => s.nodes.length === 3)!;
  assert.ok(segments(j).some((s) => s.curve));
});

test('Break Apart: Rechteck wird vier Linien', () => {
  const parts = breakApart(line([[0, 0], [10, 0], [10, 5], [0, 5]], true));
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => !p.closed && p.nodes.length === 2));
  assert.deepEqual(parts[3].nodes.map((n) => [n.x, n.y]), [[0, 5], [0, 0]]);
});

test('Break Apart: Kreis bleibt aus Kurven', () => {
  const parts = breakApart(circle(0, 0, 5));
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => p.nodes[0].cout && p.nodes[1].cin));
});

test('Knoten B: geschlossener Pfad öffnet sich am Knoten', () => {
  const r = breakAtNode(line([[0, 0], [10, 0], [10, 5], [0, 5]], true), 2)!;
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].nodes.map((n) => [n.x, n.y]), [[10, 5], [0, 5], [0, 0], [10, 0], [10, 5]]);
  const s = breakAtNode(line([[0, 0], [10, 0], [20, 0]]), 1)!;
  assert.equal(s.length, 2);
});

test('Startpunkt: geschlossener Pfad beginnt am gewählten Knoten, Shift kehrt die Richtung um', () => {
  const sp = line([[0, 0], [10, 0], [10, 5], [0, 5]], true);
  assert.ok(setStart(sp, 2));
  assert.deepEqual(sp.nodes.map((n) => [n.x, n.y]), [[10, 5], [0, 5], [0, 0], [10, 0]]);
  assert.ok(sp.start);
  setStart(sp, 0, true);
  assert.deepEqual(sp.nodes.map((n) => [n.x, n.y]), [[10, 5], [10, 0], [0, 0], [0, 5]]);
});

test('Startpunkt: offene Linie nur an den Enden', () => {
  const sp = line([[0, 0], [10, 0], [20, 0]]);
  assert.ok(!setStart(sp, 1));
  assert.ok(setStart(sp, 2));
  assert.equal(sp.nodes[0].x, 20);
});

test('Start point on an edge: splitAt inserts a node and setStart begins there', () => {
  const sp = line([[0, 0], [10, 0], [10, 5], [0, 5]], true);
  const i = splitAt(sp, 1.4);
  assert.equal(i, 2);
  assert.equal(sp.nodes.length, 5);
  assert.ok(setStart(sp, i));
  assert.deepEqual(sp.nodes.map((n) => [+n.x.toFixed(9), +n.y.toFixed(9)]), [[10, 2], [10, 5], [0, 5], [0, 0], [10, 0]]);
  // close to an existing node: no extra node
  assert.equal(splitAt(sp, 1 + 1e-9), 1);
  assert.equal(sp.nodes.length, 5);
  // closing segment (last node back to the first)
  const sq = line([[0, 0], [10, 0], [10, 10], [0, 10]], true);
  assert.equal(splitAt(sq, 3.5), 4);
  assert.deepEqual([sq.nodes[4].x, sq.nodes[4].y], [0, 5]);
});

test('Start point on an edge keeps the curve shape', () => {
  const sp: SubPath = { closed: true, nodes: [{ x: 0, y: 0, cout: { x: 0, y: 10 } }, { x: 20, y: 0, cin: { x: 20, y: 10 } }, { x: 10, y: -10 }] };
  const before = [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => pointAt(sp, u));
  const i = splitAt(sp, 0.5);
  assert.equal(i, 1);
  assert.ok(Math.abs(sp.nodes[1].x - 10) < 1e-9 && Math.abs(sp.nodes[1].y - 7.5) < 1e-9);
  // the first half is now segment 0, the second half segment 1
  const after = [0.2, 0.6, 1, 1.4, 1.8].map((u) => pointAt(sp, u));
  before.forEach((p, k) => assert.ok(Math.hypot(p.x - after[k].x, p.y - after[k].y) < 1e-9));
});

test('Richtung umkehren erhält die Kurvenform', () => {
  const c = circle(0, 0, 5);
  const before = pointAt(c, 0.5);
  reverseSub(c);
  const after = pointAt(c, 3.5);
  near(before.x, after.x);
  near(before.y, after.y);
});

test('Teilstück einer Kurve liegt exakt auf der Kurve', () => {
  const c = circle(0, 0, 5);
  const part = extract(c, 0.25, 1.75);
  near(part.nodes[0].x, pointAt(c, 0.25).x);
  const e = part.nodes[part.nodes.length - 1];
  near(e.x, pointAt(c, 1.75).x);
  near(e.y, pointAt(c, 1.75).y);
  assert.equal(part.nodes.length, 3);
});

test('Schnittpunkte: zwei Kreise schneiden sich zweimal', () => {
  const a = circle(0, 0, 5),
    b = circle(6, 0, 5);
  const cuts = cutParams(a, [b]);
  assert.equal(cuts.length, 2);
  for (const u of cuts) {
    const p = pointAt(a, u);
    near(p.x, 3, 1e-3);
    near(Math.abs(p.y), 4, 2e-3);
  }
});

test('Trimmen: Linie durch ein Rechteck verliert das innere Stück', () => {
  const l = line([[-5, 2], [15, 2]]);
  const rect = line([[0, 0], [10, 0], [10, 5], [0, 5]], true);
  const cuts = cutParams(l, [rect]);
  assert.equal(cuts.length, 2);
  const span = trimSpan(l, cuts, 0.5);
  const r = trimSub(l, span);
  assert.equal(r.kept.length, 2);
  near(r.kept[0].nodes[1].x, 0);
  near(r.kept[1].nodes[0].x, 10);
  near(r.removed.nodes[0].x, 0);
});

test('Trimmen: geschlossene Form wird an den Schnittpunkten offen', () => {
  const a = circle(0, 0, 5),
    b = circle(6, 0, 5);
  const cuts = cutParams(a, [b]);
  // Punkt rechts (innen, zum anderen Kreis hin): u = 0
  const span = trimSpan(a, cuts, 0);
  const r = trimSub(a, span);
  assert.equal(r.kept.length, 1);
  assert.ok(!r.kept[0].closed);
  assert.ok(r.removed.nodes.every((n) => n.x > 2.99));
});

test('Trimmen ohne Schnitt entfernt den ganzen Pfad', () => {
  const l = line([[0, 0], [1, 0]]);
  assert.equal(trimSpan(l, cutParams(l, []), 0.5), null);
});

test('Trimmen: Selbstschnitt einer Acht', () => {
  const eight = line([[0, 0], [10, 10], [10, 0], [0, 10]], true);
  const cuts = cutParams(eight, []);
  assert.equal(cuts.length, 2);
});

test('Trimmen und Verbinden: zwei Kreise werden zur Vereinigung', () => {
  const a = circle(0, 0, 5),
    b = circle(6, 0, 5);
  const ka = trimSub(a, trimSpan(a, cutParams(a, [b]), 0)).kept;
  const kb = trimSub(b, trimSpan(b, cutParams(b, [a]), 2)).kept;
  const r = joinSubs([...ka, ...kb], 1e-3);
  assert.equal(r.subs.length, 1);
  assert.ok(r.subs[0].closed);
});

test('Trimmen nacheinander: der zweite Kreis wird am Rest des ersten geschnitten', () => {
  const a = circle(0, 0, 5),
    b = circle(6, 0, 5);
  const ka = trimSub(a, trimSpan(a, cutParams(a, [b]), 0)).kept;
  // b wird jetzt gegen den Rest von a geschnitten, nicht gegen den ganzen Kreis
  const cb = cutParams(b, ka);
  assert.equal(cb.length, 2);
  const kb = trimSub(b, trimSpan(b, cb, 2)).kept;
  const r = joinSubs([...ka, ...kb], 0.01);
  assert.equal(r.subs.length, 1);
  assert.ok(r.subs[0].closed);
});

test('T-Stoß: Ende einer Linie auf einer anderen teilt sie', () => {
  const base = line([[0, 0], [20, 0]]);
  const stem = line([[10, 0.0004], [10, 10]]);
  assert.equal(cutParams(base, [stem]).length, 1);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Pfad-Tests bestanden');
