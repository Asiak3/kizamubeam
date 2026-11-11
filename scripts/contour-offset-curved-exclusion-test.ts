import './core-fixtures-env';
import assert from 'node:assert/strict';
import { IDENT, type SubPath, type Pt } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape } from '../src/contourOffset';
import { extract } from '../src/pathtools';
import { segments, bezierPt } from '../src/curves';

let count = 0;
function test(name: string, fn: () => void) { fn(); count++; console.log('PASS ' + name); }
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
function ellipse(rx = 20, ry = 2): SubPath {
  const k = .5522847498307936;
  return { closed: true, nodes: [
    { x: rx, y: 0, cin: { x: rx, y: -k * ry }, cout: { x: rx, y: k * ry } },
    { x: 0, y: ry, cin: { x: k * rx, y: ry }, cout: { x: -k * rx, y: ry } },
    { x: -rx, y: 0, cin: { x: -rx, y: k * ry }, cout: { x: -rx, y: -k * ry } },
    { x: 0, y: -ry, cin: { x: -k * rx, y: -ry }, cout: { x: k * rx, y: -ry } },
  ] };
}
function verifyInterval(path: SubPath, expected: SubPath) {
  const wanted = segments(expected), actual = segments(path);
  for (const s of wanted) {
    const found = actual.find(q => near(q.a, s.a) && near(q.b, s.b) && near(q.c1, s.c1) && near(q.c2, s.c2));
    assert.ok(found, 'exact source Bézier segment and both handles survive');
    for (const u of [.1, .35, .7, .9]) assert.ok(near(bezierPt(found.a, found.c1, found.c2, found.b, u), bezierPt(s.a, s.c1, s.c2, s.b, u)));
  }
  const start = path.nodes.findIndex(n => near(n, expected.nodes[0])), end = path.nodes.findIndex(n => near(n, expected.nodes.at(-1)!));
  assert.ok(start >= 0 && end >= 0);
  assert.equal(path.nodes[(start + path.nodes.length - 1) % path.nodes.length].cout, undefined, 'incoming connector has no curve handle');
  assert.equal(path.nodes[start].cin, undefined, 'incoming connector ends without a handle');
  assert.equal(path.nodes[end].cout, undefined, 'outgoing connector starts without a handle');
  assert.equal(path.nodes[(end + 1) % path.nodes.length].cin, undefined, 'outgoing connector has no curve handle');
}
// The first two intervals failed the old chord/miter lookup with seam-not-on-ring.
for (const [u0, u1] of [[.01, .05], [.03, .07], [.08, .18], [.17, .63], [.81, .92]]) test(`tight elliptical curve exclusion ${u0}–${u1} preserves actual geometry`, () => {
  const base = ellipse(), source = offsetSource(156, { kind: 'path', subs: [base] }, [...IDENT]), before = structuredClone(source), plan = offsetContours([source], .2);
  const amounts = new Map([[plan.contours[0].key, -.2]]), exclusions = new Map([[156, [{ sub: 0, u0, u1 }]]]);
  const result = offsetResults([source], plan, amounts, .2, new Set(), exclusions), path = result.recipes[0]!.result[0];
  assert.equal(path.closed, true); assert.equal(result.preview.length, 1);
  verifyInterval(path, extract(base, u0, u1));
  assert.deepEqual(result.preview[0], path); assert.deepEqual(source, before);
  const reopened = offsetSource(156, contourOffsetShape(result.recipes[0]!), [...IDENT]), next = offsetContours([reopened], .2);
  assert.deepEqual(offsetResults([reopened], next, new Map([[next.contours[0].key, -.2]]), .2).recipes[0]!.result, result.recipes[0]!.result);
});

test('curved interval ending at a source-node junction uses a straight corner connector', () => {
  const base: SubPath = { closed: true, nodes: [{ x: 0, y: 0, cout: { x: 10, y: -15 } },
    { x: 40, y: 0, cin: { x: 30, y: -15 } }, { x: 40, y: 30 }, { x: 0, y: 30 }] };
  const source = offsetSource(158, { kind: 'path', subs: [base] }, [...IDENT]), plan = offsetContours([source], .2);
  const result = offsetResults([source], plan, new Map([[plan.contours[0].key, -.2]]), .2, new Set(), new Map([[158, [{ sub: 0, u0: .3, u1: 1 }]]]));
  verifyInterval(result.recipes[0]!.result[0], extract(base, .3, 1));
});

test('curved exclusion ending at a noninteger same-leaf T-junction keeps the source tail exact', () => {
  const curve: SubPath = { closed: false, nodes: [{ x: 0, y: 0, cout: { x: 10, y: -15 } }, { x: 40, y: 0, cin: { x: 30, y: -15 } }] };
  const side: SubPath = { closed: false, nodes: [{ x: 20, y: -11.25 }, { x: 20, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] };
  const source = offsetSource(156, { kind: 'path', subs: [curve, side] }, [...IDENT]), before = structuredClone(source), plan = offsetContours([source], .2);
  assert.equal(plan.contours.length, 1);
  const result = offsetResults([source], plan, new Map([[plan.contours[0].key, -.2]]), .2, new Set(), new Map([[156, [{ sub: 0, u0: .3, u1: .5 }]]]));
  const ring = result.recipes[0]!.result.find(p => p.closed)!;
  verifyInterval(ring, extract(curve, .3, .5));
  assert.deepEqual(result.recipes[0]!.result.find(p => !p.closed), extract(curve, .5, 1));
  assert.deepEqual(source, before);
});

test('a tight network origin outside the exclusion is not an ownership seam', () => {
  const base = ellipse(20, .5);
  const source = offsetSource(156, { kind: 'path', subs: [base] }, [...IDENT]), plan = offsetContours([source], .2);
  const result = offsetResults([source], plan, new Map([[plan.contours[0].key, -.2]]), .2, new Set(), new Map([[156, [{ sub: 0, u0: .3, u1: .7 }]]]));
  verifyInterval(result.recipes[0]!.result[0], extract(base, .3, .7));
});

test('a normal that cannot reach the surviving inset safely is refused with its cause', () => {
  const source = offsetSource(156, { kind: 'path', subs: [ellipse(20, .5)] }, [...IDENT]), before = structuredClone(source), plan = offsetContours([source], .2);
  assert.throws(() => offsetResults([source], plan, new Map([[plan.contours[0].key, -.2]]), .2, new Set(), new Map([[156, [{ sub: 0, u0: .01, u1: .05 }]]])),
    (e: unknown) => e instanceof Error && (e.cause as { reason: string }).reason === 'exclusion-normal-misses-ring');
  assert.deepEqual(source, before);
});

test('different-owner T-junction exclusion reports the ownership cause and never mutates inputs', () => {
  const a = offsetSource(156, { kind: 'path', subs: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] }] }, [...IDENT]);
  const b = offsetSource(157, { kind: 'path', subs: [{ closed: false, nodes: [{ x: 40, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] }] }, [...IDENT]);
  const sources = [a, b], before = structuredClone(sources), plan = offsetContours(sources, .2);
  assert.throws(() => offsetResults(sources, plan, new Map([[plan.contours[0].key, -.2]]), .2, new Set(), new Map([[156, [{ sub: 0, u0: .4, u1: 1 }]]])),
    (e: unknown) => e instanceof Error && (e.cause as { reason: string }).reason === 'cross-owner-exclusion' && !e.message.includes('Ungültiges'));
  assert.deepEqual(sources, before);
});
console.log(`${count} curved contour exclusion tests passed`);
