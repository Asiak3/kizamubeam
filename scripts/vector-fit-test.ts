import assert from 'node:assert/strict';
import { fitPoints, MAX_VECTOR_SAMPLES, refitSubpath } from '../src/vectorFit';
import { bezierPt, segments } from '../src/curves';
import type { Pt, SubPath } from '../src/model';
let count = 0;
function test(name: string, f: () => void) { f(); count++; console.log(`PASS ${name}`); }
const opt = { tolerance: 0.1, curves: true, preserveCorners: true };
function sample(sp: SubPath, n = 160): Pt[] {
  return segments(sp).flatMap((s) => Array.from({ length: n + 1 }, (_, i) => s.curve ? bezierPt(s.a, s.c1, s.c2, s.b, i / n) :
    { x: s.a.x + (s.b.x - s.a.x) * i / n, y: s.a.y + (s.b.y - s.a.y) * i / n }));
}
function distance(p: Pt, a: Pt, b: Pt) {
  const x = b.x - a.x, y = b.y - a.y, l = x * x + y * y;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / l)) : 0;
  return Math.hypot(p.x - a.x - t * x, p.y - a.y - t * y);
}
function deviation(a: Pt[], b: Pt[]) {
  return Math.max(...a.map((p) => {
    let d = Infinity;
    for (let i = 1; i < b.length; i++) d = Math.min(d, distance(p, b[i - 1], b[i]));
    return d;
  }));
}
test('dense line reduces without mutation', () => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({ x: i / 3, y: 0 }));
  const before = JSON.stringify(nodes), sp = refitSubpath({ nodes, closed: false }, opt);
  assert.equal(sp.nodes.length, 2); assert.equal(JSON.stringify(nodes), before);
  assert.deepEqual({ x: sp.nodes[1].x, y: sp.nodes[1].y }, nodes[299]);
});
test('freehand cubic has bounded independently sampled bidirectional error', () => {
  const points = Array.from({ length: 151 }, (_, i) => ({ x: i / 5, y: Math.sin(i / 20) * 5 }));
  const sp = fitPoints(points, false, opt), result = sample(sp);
  assert.ok(sp.nodes.length < points.length / 3); assert.ok(sp.nodes.some((n) => n.cout));
  assert.ok(deviation(points, result) <= 0.105); assert.ok(deviation(result, points) <= 0.105);
});
test('collinear endpoint flattening retains cubic overshoot', () => {
  const sp: SubPath = { nodes: [{ x: 0, y: 0, cout: { x: 80, y: 0 } }, { x: 10, y: 0, cin: { x: -60, y: 0 } }], closed: false };
  const out = refitSubpath(sp, opt), a = sample(sp, 800), b = sample(out, 150);
  assert.ok(deviation(a, b) < 0.11); assert.ok(deviation(b, a) < 0.11);
});
test('line-only fit obeys tolerance without handles', () => {
  const sp: SubPath = { nodes: [{ x: 0, y: 0, cout: { x: 0, y: 10 } }, { x: 10, y: 0, cin: { x: 10, y: 10 } }], closed: false };
  const out = refitSubpath(sp, { ...opt, curves: false });
  assert.ok(out.nodes.every((n) => !n.cin && !n.cout)); assert.ok(deviation(sample(sp), sample(out)) < 0.11);
});
test('closed square retains corners and explicit start', () => {
  const sp: SubPath = { nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true, start: true };
  const out = refitSubpath(sp, opt);
  assert.equal(out.closed, true); assert.equal(out.start, true); assert.equal(out.nodes.length, 4);
  assert.deepEqual(out.nodes.map(({ x, y }) => ({ x, y })), sp.nodes);
});
test('tiny closed contour retains three anchors', () => {
  const sp = fitPoints([{ x: 0, y: 0 }, { x: 0.02, y: 0 }, { x: 0.01, y: 0.02 }, { x: 0, y: 0 }], true, opt);
  assert.equal(sp.closed, true); assert.ok(sp.nodes.length >= 3);
});
test('nonfinite inputs and invalid tolerances are rejected', () => {
  assert.throws(() => fitPoints([{ x: NaN, y: 0 }], false, opt));
  for (const tolerance of [NaN, Infinity, 0, -1, 101]) assert.throws(() => fitPoints([], false, { ...opt, tolerance }));
});
test('sample budget rejects rather than truncates', () => {
  assert.throws(() => fitPoints(Array.from({ length: MAX_VECTOR_SAMPLES + 1 }, (_, x) => ({ x, y: 0 })), false, opt));
});
test('duplicates and tap do not generate degenerate curves', () => {
  const sp = fitPoints(Array.from({ length: 20 }, () => ({ x: 4, y: 5 })), false, opt);
  assert.equal(sp.nodes.length, 1); assert.equal(sp.closed, false);
});
console.log(`Vector fitting: ${count} checks passed (synthetic, no hardware).`);
