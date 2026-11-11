import './core-fixtures-env';
import assert from 'node:assert/strict';
import { IDENT, type SubPath, type Mat } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape, readContourOffset, offsetRemainderKey } from '../src/contourOffset';
import { normalizeOffsetExclusions, worldExcludedOffsetPaths } from '../src/contourOffsetExclusions';
import { extract } from '../src/pathtools';

const rect = (x = 0, y = 0, w = 40, h = 30): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const source = (subs: SubPath[], id = 187, m: Mat = [...IDENT]) => offsetSource(id, { kind: 'path', subs }, m);
let count = 0;
function test(name: string, fn: () => void) { fn(); count++; console.log('PASS ' + name); }
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('source-ID keyed interior exclusion stays original with straight connectors and closed output', () => {
  const s = source([rect()]), plan = offsetContours([s], 0);
  const output = offsetResults([s], plan, new Map([[plan.contours[0].key, 1]]), 0, new Set(), new Map([[187, [{ sub: 0, u0: .25, u1: .75 }]]]));
  const r = output.recipes[0]!;
  assert.equal(r.result.length, 1); assert.equal(r.result[0].closed, true); assert.equal(output.remainders.length, 0);
  assert.ok(r.result[0].nodes.some(n => n.x === 10 && n.y === 0));
  assert.ok(r.result[0].nodes.some(n => n.x === 30 && n.y === 0));
  assert.deepEqual(r.excluded, [{ sub: 0, u0: .25, u1: .75 }]);
  assert.deepEqual(s.base, [rect()]);
});

test('saved exclusions reopen noncumulatively; explicit empty map clears them', () => {
  const s = source([rect()]), plan = offsetContours([s], 0), amounts = new Map([[plan.contours[0].key, -1]]);
  const r = offsetResults([s], plan, amounts, 0, new Set(), new Map([[187, [{ sub: 0, u0: 0, u1: 1 }]]])).recipes[0]!;
  const shape = contourOffsetShape(r), reopened = offsetSource(187, shape, [...IDENT]), next = offsetContours([reopened], 0);
  assert.deepEqual(readContourOffset(shape)!.excluded, r.excluded);
  assert.deepEqual(offsetResults([reopened], next, new Map([[next.contours[0].key, -1]]), 0).recipes[0]!.result, r.result);
  assert.equal(offsetResults([reopened], next, new Map([[next.contours[0].key, -1]]), 0, new Set(), new Map()).recipes[0]!.excluded, undefined);
});

test('exact curved source interval survives, including affine world transforms', () => {
  const curved = rect(); curved.nodes[0].cout = { x: 10, y: -5 }; curved.nodes[1].cin = { x: 30, y: -5 };
  const s = source([curved], 187, [0, 2, -1, 0, 80, 40]), plan = offsetContours([s], 0);
  const exclusions = [{ sub: 0, u0: .2, u1: .8 }], expected = extract(curved, .2, .8);
  const r = offsetResults([s], plan, new Map([[plan.contours[0].key, .2]]), 0, new Set(), new Map([[187, exclusions]])).recipes[0]!;
  const nodes = r.result[0].nodes;
  for (const e of expected.nodes) {
    const found = nodes.find(n => Math.hypot(n.x - e.x, n.y - e.y) < 1e-8); assert.ok(found);
    if (e.cout) { assert.ok(found.cout); near(found.cout.x, e.cout.x); near(found.cout.y, e.cout.y); }
    if (e.cin) { assert.ok(found.cin); near(found.cin.x, e.cin.x); near(found.cin.y, e.cin.y); }
  }
  assert.equal(worldExcludedOffsetPaths(s, exclusions).length, 1);
});

test('single leaf assembled from reversed open subpaths closes once and keeps excluded span', () => {
  const s = source([
    { closed: false, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
    { closed: false, nodes: [{ x: 40, y: 30 }, { x: 40, y: 0 }] },
    { closed: false, nodes: [{ x: 40, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] },
  ]), plan = offsetContours([s], 0);
  const r = offsetResults([s], plan, new Map([[plan.contours[0].key, -.5]]), 0, new Set(), new Map([[187, [{ sub: 1, u0: .8, u1: .2 }]]])).recipes[0]!;
  assert.equal(r.result.length, 1); assert.equal(r.result[0].closed, true);
  assert.ok(r.result[0].nodes.some(n => Math.abs(n.x - 40) < 1e-8 && Math.abs(n.y - 6) < 1e-8));
  assert.deepEqual(r.base, s.base);
});

test('normalization merges intervals and rejects malformed persistence', () => {
  assert.deepEqual(normalizeOffsetExclusions([rect()], [{ sub: 0, u0: .8, u1: .2 }, { sub: 0, u0: .7, u1: 1 }]), [{ sub: 0, u0: .2, u1: 1 }]);
  for (const spans of [[{ sub: 0, u0: -1, u1: 1 }], [{ sub: 1, u0: 0, u1: 1 }], [{ sub: 0, u0: 0, u1: 5 }], [{ sub: 0, u0: NaN, u1: 1 }]]) {
    assert.throws(() => normalizeOffsetExclusions([rect()], spans));
  }
  const s = source([rect()]), plan = offsetContours([s], 0);
  assert.throws(() => offsetResults([s], plan, new Map([[plan.contours[0].key, 1]]), 0, new Set(), new Map([[999, []]])));
});

test('all-excluded and cross-leaf ambiguous exclusions reject before mutation', () => {
  const s = source([rect()]), plan = offsetContours([s], 0), before = structuredClone(s);
  assert.throws(() => offsetResults([s], plan, new Map([[plan.contours[0].key, 1]]), 0, new Set(), new Map([[187, [{ sub: 0, u0: 0, u1: 4 }]]])));
  assert.deepEqual(s, before);
  const a = source([{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] }], 1);
  const b = source([{ closed: false, nodes: [{ x: 40, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] }], 2);
  const split = offsetContours([a, b], 0);
  assert.throws(() => offsetResults([a, b], split, new Map([[split.contours[0].key, 1]]), 0, new Set(), new Map([[1, [{ sub: 0, u0: 0, u1: 1 }]]])));
});

test('excluded source remainder is protected and never removed', () => {
  const s = source([{ closed: false, nodes: [{ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] }]);
  const plan = offsetContours([s], 0), amounts = new Map([[plan.contours[0].key, -.2]]), exclusions = new Map([[187, [{ sub: 0, u0: 0, u1: .5 }]]]);
  const r = offsetResults([s], plan, amounts, 0, new Set(), exclusions);
  assert.equal(r.remainders.length, 1); assert.equal(r.remainders[0].protected, true);
  assert.throws(() => offsetResults([s], plan, amounts, 0, new Set([offsetRemainderKey(187, r.remainders[0])]), exclusions));
});

test('multiple exclusions and a source-origin wrap stay closed without duplicated remainders', () => {
  const s = source([rect(), rect(100, 100, 10, 10)]), plan = offsetContours([s], 0);
  const selected = plan.contours.find(c => c.members.some(m => m.sub === 0))!;
  const spans = [{ sub: 0, u0: 0, u1: .2 }, { sub: 0, u0: 3.8, u1: 4 }, { sub: 0, u0: 1.2, u1: 1.8 }];
  const output = offsetResults([s], plan, new Map([[selected.key, -.5]]), 0, new Set(), new Map([[187, spans]]));
  assert.equal(output.recipes[0]!.result[0].closed, true); assert.equal(output.remainders.length, 0);
  assert.deepEqual(output.recipes[0]!.result[1], s.base[1]);
  assert.ok(output.recipes[0]!.result[0].nodes.some(n => n.x === 0 && n.y === 0));
});

test('collision and nesting checks use the final exclusions and their connectors', () => {
  const s = source([rect(), rect(41, 10, 4, 4)]), plan = offsetContours([s], 0);
  const selected = plan.contours.find(c => c.members.some(m => m.sub === 0))!, amounts = new Map([[selected.key, 2]]);
  assert.throws(() => offsetResults([s], plan, amounts, 0));
  assert.doesNotThrow(() => offsetResults([s], plan, amounts, 0, new Set(), new Map([[187, [{ sub: 0, u0: 1, u1: 2 }]]])));
  const colliding = source([rect(), rect(40.3, -1, 1, 1)]), otherPlan = offsetContours([colliding], 0);
  const outer = otherPlan.contours.find(c => c.members.some(m => m.sub === 0))!;
  assert.throws(() => offsetResults([colliding], otherPlan, new Map([[outer.key, 2]]), 0, new Set(), new Map([[187, [{ sub: 0, u0: 1, u1: 2 }]]])));
  const nested = source([rect(), rect(1, 10, 4, 4)]), nestedPlan = offsetContours([nested], 0);
  const outside = nestedPlan.contours.find(c => c.members.some(m => m.sub === 0))!;
  assert.throws(() => offsetResults([nested], nestedPlan, new Map([[outside.key, -8]]), 0, new Set(), new Map([[187, [{ sub: 0, u0: 0, u1: .5 }]]])));
});

test('reversed curved contour keeps the original handles in its traversal direction', () => {
  const curved = rect(); curved.nodes[0].cout = { x: 10, y: -5 }; curved.nodes[1].cin = { x: 30, y: -5 };
  curved.nodes.reverse(); for (const n of curved.nodes) [n.cin, n.cout] = [n.cout, n.cin];
  const s = source([curved]), plan = offsetContours([s], 0), expected = extract(curved, 2.2, 2.8);
  const r = offsetResults([s], plan, new Map([[plan.contours[0].key, .3]]), 0, new Set(), new Map([[187, [{ sub: 0, u0: 2.2, u1: 2.8 }]]])).recipes[0]!;
  for (const e of expected.nodes) {
    const n = r.result[0].nodes.find(n => Math.hypot(n.x - e.x, n.y - e.y) < 1e-8); assert.ok(n);
    // Network orientation may reverse the source curve, but never its geometry.
    for (const control of [e.cin, e.cout].filter(Boolean)) assert.ok([n.cin, n.cout].some(c => c && Math.hypot(c.x - control!.x, c.y - control!.y) < 1e-8), 'exact reversed control point retained');
  }
});

test('fixed machine start and malformed saved exclusions fail safely', () => {
  const base = rect(); base.start = true;
  const s = source([base]), plan = offsetContours([s], 0);
  assert.throws(() => offsetResults([s], plan, new Map([[plan.contours[0].key, .2]]), 0, new Set(), new Map([[187, [{ sub: 0, u0: .2, u1: .8 }]]])));
  const plain = source([rect()]), p = offsetContours([plain], 0);
  const recipe = offsetResults([plain], p, new Map([[p.contours[0].key, .2]]), 0).recipes[0]!;
  recipe.excluded = [{ sub: 0, u0: 0, u1: 10 }];
  assert.throws(() => contourOffsetShape(recipe));
});

console.log(`${count} contour offset exclusion tests passed`);
