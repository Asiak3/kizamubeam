import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import Clipper from 'clipper-lib';
import { initialDialogParams } from '../src/generators/dialog';
import { buildGen, defaultParams, getGenerator } from '../src/generators';
import type { GenShape, Pt } from '../src/model';

const box = getGenerator('box')!;
const divided = getGenerator('box-divided')!;
const prior = { ...defaultParams(divided), width: 60, depth: 60, height: 60, thickness: 3.6,
  finger: 10, compartmentsX: 1, compartmentsY: 1, jointLayout: 'legacy', partLayout: 'rows' };
const priorBox = { ...defaultParams(box), width: 70, partLayout: 'rows' };
const gearpair = getGenerator('gearpair')!;
const priorGears = { ...defaultParams(gearpair), teeth1: 20, partLayout: 'rows' };
localStorage.setItem = () => {};
localStorage.getItem = (key) => ({ 'kizamubeam.gen.box-divided': JSON.stringify(prior), 'kizamubeam.gen.box': JSON.stringify(priorBox),
  'kizamubeam.gen.gearpair': JSON.stringify(priorGears) } as Record<string, string>)[key] ?? null;
const fresh = initialDialogParams(divided, null);
assert.equal(fresh.jointLayout, 'current', 'new boxes must not inherit old geometry');
assert.equal(fresh.partLayout, 'nest', 'new boxes must not inherit the old row layout');
for (const [g, last] of [[box, priorBox], [gearpair, priorGears]] as const) {
  const p = initialDialogParams(g, null);
  assert.equal(p.partLayout, 'nest', `new ${g.id} is nested`);
  assert.equal(p.width ?? p.teeth1, last.width ?? last.teeth1, `${g.id} keeps other last-used settings`);
  assert.equal(initialDialogParams(g, { kind: 'gen', gen: g.id, v: 2, params: last, subs: [] }).partLayout, 'rows', `saved ${g.id} keeps rows`);
}
assert.equal(fresh.width, 60, 'ordinary last-used settings still work');
const previous: GenShape = { kind: 'gen', gen: divided.id, v: 2, params: prior, subs: [] };
assert.equal(initialDialogParams(divided, previous).jointLayout, 'legacy', 'old boxes keep their geometry');
assert.equal(initialDialogParams(divided, previous).partLayout, 'rows', 'old boxes keep their layout');
assert.equal(initialDialogParams(divided, null, prior).jointLayout, 'current');

function difference(a: Pt[], b: Pt[]) {
  const path = (pts: Pt[]) => pts.map(q => ({ X: Math.round(q.x * 1e6), Y: Math.round(q.y * 1e6) }));
  const c = new Clipper.Clipper();
  c.AddPath(path(a), Clipper.PolyType.ptSubject, true);
  c.AddPath(path(b), Clipper.PolyType.ptClip, true);
  const out: Clipper.Paths = [];
  c.Execute(Clipper.ClipType.ctXor, out, Clipper.PolyFillType.pftEvenOdd, Clipper.PolyFillType.pftEvenOdd);
  return out.reduce((sum, p) => sum + Math.abs(Clipper.Clipper.Area(p)), 0) / 1e12;
}
for (const top of ['open', 'closed']) for (const dims of [
  [60,60,60,3.6,10], [100,80,50,3,10], [37,151,23.5,4.2,6],
  [60,60,60,5,50], [121,93,72,3.6,7.4],
]) {
  const [width,depth,height,thickness,finger] = dims;
  const shared = { width,depth,height,thickness,finger,top };
  const original = buildGen(box, { ...defaultParams(box), ...shared, sizeMode:'outer', clearance:0, kerf:0 });
  const ours = buildGen(divided, { ...fresh, ...shared });
  assert.ok(original.parts.length && ours.parts.length, JSON.stringify({original:original.issues, ours:ours.issues}));
  for (const key of top === 'open' ? ['bottom'] : ['bottom','top']) {
    const a = original.parts.find(p => p.shape.part === key)!.shape.subs[0].nodes;
    const b = ours.parts.find(p => p.shape.part === key)!.shape.subs[0].nodes;
    assert.ok(difference(a,b)<0.000001, `${key} ${JSON.stringify(shared)}`);
  }
}
// The same comparison also applies when divider holes are present: compare only the outside contour.
const shared = { width:100, depth:80, height:50, thickness:3, finger:10, top:'closed' };
const withDividers = buildGen(divided, { ...fresh, ...shared, compartmentsX:2, compartmentsY:2,
  ratiosX:'1:1', ratiosY:'1:1', dividerDrop:10 });
const ordinary = buildGen(box, { ...defaultParams(box), ...shared, sizeMode:'outer', clearance:0, kerf:0 });
assert.ok(withDividers.parts.length, JSON.stringify(withDividers.issues));
for (const key of ['bottom', 'top']) {
  const own = withDividers.parts.find(p => p.shape.part === key)!.shape;
  const original = ordinary.parts.find(p => p.shape.part === key)!.shape;
  assert.ok(difference(own.subs[0].nodes, original.subs[0].nodes) < 0.000001, key);
  if (key === 'bottom') assert.ok(own.subs.length > 1, 'base keeps divider holes');
}
console.log('ok   Box mit Trennwänden: new dialog ignores legacy joints and row layout; actual generated base and lid match Box');
