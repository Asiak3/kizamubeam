// Separater experimenteller Test; Fixtures aus dem Python-Rechenkern, ohne Python-Laufzeit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fingerboxParts, fingerboxSegments, type FingerboxParams } from '../src/generators/fingerbox-experiment';

type Fixture = { params: FingerboxParams; outlines: number[][][] };
const fixtures = JSON.parse(readFileSync('scripts/fingerbox-reference.json', 'utf8')) as Fixture[];
const near = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-6, `${a} != ${b}`);
assert.equal(fingerboxSegments(100, 30), 3);
assert.equal(fingerboxSegments(100, 24), 3);
assert.equal(fingerboxSegments(100, 10), 9);
assert.equal(fingerboxSegments(10, 100), 3);
for (const { params, outlines } of fixtures) {
  const parts = fingerboxParts({ ...params, jointLayout: 'legacy' });
  assert.deepEqual(parts.map((p) => p.key), ['bottom', 'front', 'back', 'left', 'right']);
  parts.forEach((p, i) => {
    assert.equal(p.subs.length, 1); assert.equal(p.subs[0].closed, true);
    const nodes = p.subs[0].nodes;
    assert.equal(nodes.length, outlines[i].length);
    nodes.forEach((q, j) => {
      near(q.x, outlines[i][j][0]); near(q.y, outlines[i][j][1]);
      const r = nodes[(j + 1) % nodes.length];
      assert.ok(Math.abs(q.x-r.x) < 1e-6 || Math.abs(q.y-r.y) < 1e-6, 'diagonale Kante');
      assert.ok(Math.hypot(q.x-r.x,q.y-r.y) > 1e-7, 'doppelter Punkt');
    });
  });
}
// Stichproben in der montierten Schale: weder Lücken noch Überlappungen.
function inside(poly: {x: number; y: number}[], x: number, y: number): boolean {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) result = !result;
  }
  return result;
}
for (const { params: p } of fixtures) {
  const { width: W, depth: D, height: H, thickness: t } = p;
  const shapes = new Map(fingerboxParts(p).map((part) => [part.key, part.subs[0].nodes]));
  let seed = 7, overlaps = 0, holes = 0;
  const rand = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
  const has = (key: string, x: number, y: number, w: number, h: number) => inside(shapes.get(key)!, x-w/2, y-h/2);
  for (let i = 0; i < 60000; i++) {
    const x=rand()*W, y=rand()*D, z=rand()*H;
    if (x>t && x<W-t && y>t && y<D-t && z>t) continue;
    let count=0;
    if (z<t && has('bottom',x,y,W,D)) count++;
    if (y<t && has('front',x,H-z,W,H)) count++;
    if (y>D-t && has('back',x,H-z,W,H)) count++;
    if (x<t && has('left',y,H-z,D,H)) count++;
    if (x>W-t && has('right',y,H-z,D,H)) count++;
    if (count>1) overlaps++;
    if (count===0) holes++;
  }
  assert.equal(overlaps, 0, `Montage: ${overlaps} Überlappungen bei ${JSON.stringify(p)}`);
  assert.equal(holes, 0, `Montage: ${holes} Lücken bei ${JSON.stringify(p)}`);
}
// Geschlossene Box: Deckel und vier Wände mit gegenüberliegenden Zinken.
for (const { params: base } of fixtures) {
  const p = { ...base, top: 'closed' as const, jointLayout: 'current' };
  const { width: W, depth: D, height: H, thickness: t } = p;
  const parts = fingerboxParts(p);
  assert.deepEqual(parts.map((part) => part.key), ['bottom', 'front', 'back', 'top', 'left', 'right']);
  const shapes = new Map(parts.map((part) => [part.key, part.subs[0].nodes]));
  assert.deepEqual(shapes.get('top'), shapes.get('bottom'));
  for (const part of parts) {
    const pts = part.subs[0].nodes;
    assert.ok(part.subs[0].closed);
    pts.forEach((q, i) => {
      const r = pts[(i+1) % pts.length];
      assert.ok(Math.abs(q.x-r.x) < 1e-6 || Math.abs(q.y-r.y) < 1e-6, 'diagonale Kante');
      assert.ok(Math.hypot(q.x-r.x, q.y-r.y) > 1e-7, 'doppelter Punkt');
    });
  }
  let seed = 19, overlaps = 0, holes = 0;
  const rand = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
  const has = (key: string, x: number, y: number, w: number, h: number) => inside(shapes.get(key)!, x-w/2, y-h/2);
  for (let i = 0; i < 100000; i++) {
    const x=rand()*W, y=rand()*D, z=rand()*H;
    if (x>t && x<W-t && y>t && y<D-t && z>t && z<H-t) continue;
    let count=0;
    if (z<t && has('bottom',x,y,W,D)) count++;
    if (z>H-t && has('top',x,y,W,D)) count++;
    if (y<t && has('front',x,H-z,W,H)) count++;
    if (y>D-t && has('back',x,H-z,W,H)) count++;
    if (x<t && has('left',y,H-z,D,H)) count++;
    if (x>W-t && has('right',y,H-z,D,H)) count++;
    if (count>1) overlaps++;
    if (count===0) holes++;
  }
  assert.equal(overlaps, 0, `Deckelmontage: ${overlaps} Überlappungen bei ${JSON.stringify(p)}`);
  assert.equal(holes, 0, `Deckelmontage: ${holes} Lücken bei ${JSON.stringify(p)}`);
}
assert.throws(() => fingerboxParts({ width: 10, depth: 10, height: 10, thickness: 5, finger: 1 }));
assert.throws(() => fingerboxParts({ width: 100, depth: 80, height: 50, thickness: 3, finger: 0 }));
console.log(`ok   Fingerbox: ${fixtures.length} Vergleichsfälle, offene und geschlossene Montage, Eingabeprüfung`);
