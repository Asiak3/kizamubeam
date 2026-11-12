import './core-fixtures-env';
import assert from 'node:assert/strict';
import { IDENT, type SubPath } from '../src/model';
import { offsetSource, offsetContours, offsetResults } from '../src/contourOffset';
import { offsetContourSections, pickOffsetSections, toggleOffsetSection, offsetSectionExcluded } from '../src/contourOffsetSections';
import { extract } from '../src/pathtools';

const rect = (): SubPath => ({ closed: true, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] });
const line = (...points: [number, number][]): SubPath => ({ closed: false, nodes: points.map(([x, y]) => ({ x, y })) });
const source = (subs: SubPath[], id = 1) => offsetSource(id, { kind: 'path', subs }, [...IDENT]);
let count = 0;
function test(name: string, fn: () => void) { fn(); count++; console.log('PASS ' + name); }

test('closed curved contour without junctions offers whole contour, not every Bézier node', () => {
  const curved = rect(); curved.nodes[0].cout = { x: 10, y: -5 }; curved.nodes[1].cin = { x: 30, y: -5 };
  const s = source([curved]), plan = offsetContours([s], 0), before = structuredClone(s);
  const sections = offsetContourSections([s], plan, plan.contours[0].key, 0);
  assert.equal(sections.length, 1); assert.equal(sections[0].wholeContour, true);
  assert.deepEqual(sections[0].spans, [{ sub: 0, u0: 0, u1: 4 }]);
  // Dialog removes the selected amount for this special case, not safety guards.
  assert.equal(offsetResults([s], plan, new Map(), 0).recipes[0], null);
  assert.deepEqual(s, before);
});

test('T-junctions create two exact sections; ordinary corners and origin seam do not', () => {
  const s = source([rect(), line([10, -10], [10, 0]), line([10, 30], [10, 40])]), plan = offsetContours([s], 0);
  const sections = offsetContourSections([s], plan, plan.contours[0].key, 0);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(s => s.spans), [
    [{ sub: 0, u0: 0, u1: .25 }, { sub: 0, u0: 2.75, u1: 4 }],
    [{ sub: 0, u0: .25, u1: 2.75 }],
  ]);
  const section = sections[1], excluded = toggleOffsetSection(section, []);
  assert.equal(offsetSectionExcluded(section, excluded), true);
  assert.deepEqual(toggleOffsetSection(section, excluded), []);
  assert.equal(pickOffsetSections([s], sections, { x: 40, y: 15 }, .1)[0].section.key, section.key);
  assert.equal(pickOffsetSections([s], sections, { x: 10, y: 0 }, .1).length, 2, 'junction ambiguity is explicit');
});

test('explicit contour ownership prevents a nearby unselected branch stealing a pick', () => {
  const other = rect(); other.nodes.forEach(n => n.x += 40.2);
  const s = source([rect(), other]), plan = offsetContours([s], 0);
  const face = plan.contours.find(c => c.points.every(p => p.x <= 40.001))!;
  assert.ok(face);
  const sections = offsetContourSections([s], plan, face.key, 0);
  assert.equal(pickOffsetSections([s], sections, { x: 40.2, y: 15 }, .1).length, 0);
  assert.ok(sections.every(c => c.sub === 0));
  assert.equal(pickOffsetSections([s], sections, { x: 40.2, y: 15 }, 1)[0].section.sub, 0);
});

test('common endpoints separate source paths and unsupported cross-owner closure still refuses', () => {
  const a = source([line([0, 0], [40, 0], [40, 30])], 1), b = source([line([40, 30], [0, 30], [0, 0])], 2);
  const sources = [a, b], plan = offsetContours(sources, 0), before = structuredClone(sources);
  const sections = offsetContourSections(sources, plan, plan.contours[0].key, 0);
  assert.equal(sections.length, 2); assert.ok(sections.every(s => !s.wholeContour));
  assert.throws(() => offsetResults(sources, plan, new Map([[plan.contours[0].key, .2]]), 0, new Set(), new Map([[1, sections.find(s => s.id === 1)!.spans]])));
  assert.deepEqual(sources, before);
});

test('tolerance-only endpoint joins are flagged without changing tolerance or sources', () => {
  const s = source([rect(), line([10, -10], [10, -.03]), line([10, 30.03], [10, 40])]), before = structuredClone(s);
  const plan = offsetContours([s], .05), sections = offsetContourSections([s], plan, plan.contours[0].key, .05);
  assert.equal(sections.length, 2); assert.ok(sections.every(s => s.toleranceOnly));
  assert.deepEqual(s, before);
  const exactPlan = offsetContours([s], 0);
  assert.equal(offsetContourSections([s], exactPlan, exactPlan.contours[0].key, 0).length, 1);
});

test('curved section extraction preserves exact original Bézier controls and toggling preserves other exclusions', () => {
  const curved = rect(); curved.nodes[0].cout = { x: 10, y: -5 }; curved.nodes[1].cin = { x: 30, y: -5 };
  const s = source([curved, line([0, -10], [0, 0]), line([40, 0], [40, -10])]), plan = offsetContours([s], 0);
  const sections = offsetContourSections([s], plan, plan.contours[0].key, 0), top = sections.find(s => s.spans.length === 1 && s.spans[0].u0 === 0)!;
  assert.ok(top); assert.deepEqual(extract(curved, top.spans[0].u0, top.spans[0].u1).nodes[0].cout, curved.nodes[0].cout);
  const other = [{ sub: 1, u0: .2, u1: .4 }];
  assert.deepEqual(toggleOffsetSection(top, toggleOffsetSection(top, other)), other);
  const result = offsetResults([s], plan, new Map([[plan.contours[0].key, -.2]]), 0, new Set(), new Map([[s.id, top.spans]]));
  assert.deepEqual(result.recipes[0]!.excluded, top.spans);
});

test('restoring a wrapped section subtracts only its original intervals from merged exclusions', () => {
  const section = { key: 'wrap', id: 1, sub: 0, spans: [{ sub: 0, u0: 0, u1: .25 }, { sub: 0, u0: 2.75, u1: 4 }], toleranceOnly: false, wholeContour: false };
  const previous = [{ sub: 0, u0: 0, u1: .5 }, { sub: 0, u0: 2.5, u1: 4 }, { sub: 1, u0: 0, u1: 1 }], before = structuredClone(previous);
  assert.deepEqual(toggleOffsetSection(section, previous), [{ sub: 0, u0: .25, u1: .5 }, { sub: 0, u0: 2.5, u1: 2.75 }, { sub: 1, u0: 0, u1: 1 }]);
  assert.deepEqual(previous, before);
});

console.log(`${count} contour offset section tests passed`);
