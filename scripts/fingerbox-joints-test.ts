import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import Clipper from 'clipper-lib';
import { fieldCount, panelPolys, type BoxParams } from '../src/generators/box';
import { fingerboxParts, fingerboxSegments, horizontalSegments, type FingerboxParams } from '../src/generators/fingerbox-experiment';
import { buildGen, defaultParams, getGenerator, loadGen, normalizeParams } from '../src/generators';
const near = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-6, `${a} != ${b}`);
const cases: FingerboxParams[] = [
  { width: 100, depth: 80, height: 50, thickness: 3, finger: 10 },
  { width: 300, depth: 200, height: 100, thickness: 6, finger: 20 },
  { width: 60, depth: 60, height: 60, thickness: 5, finger: 50 },
  { width: 37, depth: 151, height: 23.5, thickness: 4.2, finger: 6 },
];
for (const p of cases) for (const top of ['open', 'closed'] as const) {
  const params = { ...p, top };
  const parts = fingerboxParts(params);
  for (const key of top === 'open' ? ['bottom'] : ['bottom', 'top']) {
    const ours = parts.find(pt => pt.key === key)!.subs[0].nodes;
    const original = panelPolys({ ...params, sizeMode: 'outer', kerf: 0, clearance: 0 } as BoxParams).find(pt => pt.key === key)!.pts;
    const path = (pts: typeof ours) => pts.map(q => ({ X: Math.round(q.x * 1e6), Y: Math.round(q.y * 1e6) }));
    const c = new Clipper.Clipper(); c.AddPath(path(ours), Clipper.PolyType.ptSubject, true); c.AddPath(path(original), Clipper.PolyType.ptClip, true);
    const diff: Clipper.Paths = []; c.Execute(Clipper.ClipType.ctXor, diff, Clipper.PolyFillType.pftEvenOdd, Clipper.PolyFillType.pftEvenOdd);
    const area = diff.reduce((sum, poly) => sum + Math.abs(Clipper.Clipper.Area(poly)), 0) / 1e12;
    assert.ok(area < 0.001, `${key} differs from original: ${area} mm²`);
  }
  for (const len of [p.width - 2*p.thickness, p.depth - 2*p.thickness]) assert.equal(horizontalSegments(len, p.finger), fieldCount(len, p.finger));
}
// Vertical boundaries on the front panel, starting at the bottom.
for (const top of ['open', 'closed'] as const) {
  const p = { width: 120, depth: 100, height: 60, thickness: 3.6, finger: 5.5, top };
  const usable = p.height - p.thickness * (top === 'closed' ? 2 : 1);
  const n = fingerboxSegments(usable, p.finger), d = usable / n;
  const pts = fingerboxParts(p).find(pt => pt.key === 'front')!.subs[0].nodes;
  const intervals: { a: number; b: number }[] = [];
  for (let i=0; i<pts.length; i++) {
    const a = pts[i], b = pts[(i+1) % pts.length];
    if (Math.abs(a.x-p.width/2)<1e-7 && Math.abs(b.x-p.width/2)<1e-7 && Math.abs(a.y-b.y)>1e-7) {
      const z1=p.height/2-a.y, z2=p.height/2-b.y;
      intervals.push({ a: Math.min(z1,z2), b: Math.max(z1,z2) });
    }
  }
  intervals.sort((a,b) => a.a-b.a);
  assert.equal(n,9); assert.equal(intervals.length,5);
  near(intervals[0].a,0); near(intervals[0].b, d + p.thickness);
  for (let i=1;i<intervals.length;i++) {
    near(intervals[i].a, p.thickness + 2*i*d);
    near(intervals[i].b, i === intervals.length-1 ? p.height : p.thickness + (2*i+1)*d);
    near(intervals[i].b-intervals[i].a, d + (i === intervals.length-1 && top === 'closed' ? p.thickness : 0));
  }
}
// Each side's contour must be a simple closed orthogonal path: no reversal,
// overlapping segments, or self intersections, especially at base/lid corners.
function checkSimpleContour(nodes: { x: number; y: number }[], context: string) {
  const eps = 1e-7, n = nodes.length;
  for (let i=0;i<n;i++) {
    const a=nodes[i], b=nodes[(i+1)%n], c=nodes[(i+2)%n];
    const dx=b.x-a.x, dy=b.y-a.y, ex=c.x-b.x, ey=c.y-b.y;
    assert.ok(Math.abs(dx)<eps || Math.abs(dy)<eps, `${context}: diagonal`);
    assert.ok(Math.hypot(dx,dy)>eps, `${context}: zero segment`);
    assert.ok(!(Math.abs(dx*ey-dy*ex)<eps && dx*ex+dy*ey < -eps), `${context}: reversed segment`);
    for (let j=i+1;j<n;j++) {
      if (j===i+1 || (i===0 && j===n-1)) continue;
      const d=nodes[j], e=nodes[(j+1)%n];
      const cross=(u:typeof a,v:typeof a,w:typeof a) => (v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x);
      const orient1=cross(a,b,d), orient2=cross(a,b,e), orient3=cross(d,e,a), orient4=cross(d,e,b);
      const on=(u:typeof a,v:typeof a,w:typeof a) => Math.abs(cross(u,v,w))<eps &&
        w.x>=Math.min(u.x,v.x)-eps && w.x<=Math.max(u.x,v.x)+eps &&
        w.y>=Math.min(u.y,v.y)-eps && w.y<=Math.max(u.y,v.y)+eps;
      const hit=(orient1*orient2 < -eps && orient3*orient4 < -eps) || on(a,b,d) || on(a,b,e) || on(d,e,a) || on(d,e,b);
      assert.ok(!hit, `${context}: segments ${i} and ${j} intersect`);
    }
  }
}
for (const dims of [
  {width:30,depth:30,height:60,thickness:3.6,finger:6},
  {width:100,depth:80,height:50,thickness:3,finger:10},
  {width:120,depth:100,height:60,thickness:3.6,finger:5.5},
  {width:60,depth:60,height:60,thickness:5,finger:50},
  {width:37,depth:151,height:23.5,thickness:4.2,finger:6},
]) for (const top of ['open','closed'] as const) {
  for (const part of fingerboxParts({...dims,top,jointLayout:'current'})) {
    checkSimpleContour(part.subs[0].nodes, `${top} ${part.key} ${JSON.stringify(dims)}`);
  }
}
const g=getGenerator('box-divided')!;
const base={...defaultParams(g),width:100,depth:80,height:50,thickness:3,finger:10,compartmentsX:2,compartmentsY:2,ratiosX:'1:1',ratiosY:'1:1'};
const legacy=buildGen(g,{...base,jointLayout:'legacy'});
const old=structuredClone(legacy.parts[0].shape); old.v=1; delete old.params.jointLayout;
const cached=structuredClone(old.subs); loadGen(old);
assert.equal(old.v,2); assert.equal(old.params.jointLayout,'legacy'); assert.deepEqual(old.subs,cached);
const regenerated=buildGen(g,normalizeParams(g,old.params));
assert.deepEqual(regenerated.parts.map(p => p.shape.subs), legacy.parts.map(p => p.shape.subs));
assert.equal(defaultParams(g).jointLayout,'current');
console.log('ok   Fingerbox: original base and lid, asymmetric corners, and v1 geometry preservation');
