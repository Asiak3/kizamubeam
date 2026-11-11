import './core-fixtures-env';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';
import { manufacturedSlotPaths } from '../src/slotManufacturing';
import { projectedSlot, straightGeometry } from '../src/straightSlots';
import { flattenSub } from '../src/clip';
import { IDENT } from '../src/model';
import type { Pt, SubPath } from '../src/model';
import type { ProjectionFrame } from '../src/straightSlots';

const near = (a: number, b: number, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const local = (f: ProjectionFrame, p: Pt): Pt => ({ x: (p.x - f.a.x) * f.edge.tangent.x + (p.y - f.a.y) * f.edge.tangent.y,
  y: (p.x - f.a.x) * f.edge.normal.x + (p.y - f.a.y) * f.edge.normal.y });
const localPaths = (f: ProjectionFrame, paths: SubPath[]) => paths.map(sp => ({ ...sp, nodes: sp.nodes.map(p => local(f, p)) }));
const bounds = (paths: SubPath[]) => {
  const points = paths.flatMap(sp => sp.nodes);
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
};
const area = (paths: SubPath[]) => Math.abs(paths.reduce((sum, sp) => sum + sp.nodes.reduce((a, p, i) => {
  const q = sp.nodes[(i + 1) % sp.nodes.length]; return a + (p.x * q.y - p.y * q.x) / 2;
}, 0), 0));
const contains = (paths: SubPath[], p: Pt) => paths.some(sp => ClipperLib.Clipper.PointInPolygon(
  { X: Math.round(p.x * 1000), Y: Math.round(p.y * 1000) }, flattenSub(sp, IDENT)) !== 0);
let cases = 0;
for (const mirrored of [false, true]) for (const angle of [0, 0.71, 2.2]) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const base: SubPath[] = [{ closed: true, nodes: [[0, 0], [100, 0], [100, 80], [0, 80]].map(([x, y]) => {
    if (mirrored) x = -x;
    return { x: 17 + c * x - s * y, y: -23 + s * x + c * y };
  }) }];
  for (const edge of straightGeometry(base, 45).edges) {
    const f = projectedSlot(base, { edge: edge.key, origin: { kind: 'vertex', sub: 0, node: 0 }, target: 'center',
      distance: 30, direction: 1, cornerAngle: 45 }, 3.7 + 0.1, 10, edge.a);
    const before = JSON.stringify(f);
    const plain = manufacturedSlotPaths(f, { burn: 0, cornerStyle: 'corner' });
    assert.deepEqual(plain, [f.outline]); assert.notEqual(plain[0], f.outline); assert.notEqual(plain[0].nodes[0], f.outline.nodes[0]);
    const corrected = localPaths(f, manufacturedSlotPaths(f, { burn: 0.06, cornerStyle: 'corner' }));
    const b = bounds(corrected); near(b.maxX - b.minX, 3.68); near(b.maxY, 9.94); near(b.minX, 0.06); assert.ok(b.minY < -0.06);
    for (const burn of [0, 0.06]) {
      const loop = localPaths(f, manufacturedSlotPaths(f, { burn, cornerStyle: 'loop' }));
      const back = localPaths(f, manufacturedSlotPaths(f, { burn, cornerStyle: 'backarc' }));
      for (const relief of [loop, back]) {
        assert.equal(relief.length, 1);
        for (const x of [0, 3.8]) assert.ok(contains(relief, { x, y: 10 }), 'nominal bottom corner cleared');
        const bb = bounds(relief), limit = 2 * burn + 0.05 + 0.001;
        assert.ok(bb.minX >= -limit && bb.maxX <= 3.8 + limit && bb.maxY <= 10 + limit);
        assert.ok(area(relief) > area(localPaths(f, manufacturedSlotPaths(f, { burn, cornerStyle: 'corner' }))));
        for (const sp of relief) {
          assert.ok(sp.closed && sp.nodes.length <= 128);
          sp.nodes.forEach((p, i) => {
            assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
            const q = sp.nodes[(i + 1) % sp.nodes.length]; assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 1e-8);
          });
        }
      }
      assert.notDeepEqual(loop, back, 'relief profiles differ even with zero burn');
    }
    assert.equal(JSON.stringify(f), before, 'nominal datums and source outline remain immutable');
    for (const burn of [-1, NaN, Infinity, -Infinity, 1.9, 10, Number.MAX_VALUE])
      assert.throws(() => manufacturedSlotPaths(f, { burn, cornerStyle: 'corner' }));
    assert.throws(() => manufacturedSlotPaths(f, { burn: 0, cornerStyle: 'unknown' as 'corner' }));
    const bad = structuredClone(f); bad.bottomEnd.x = NaN;
    assert.throws(() => manufacturedSlotPaths(bad, { burn: 0, cornerStyle: 'loop' }));
    const shallow = structuredClone(f);
    shallow.bottomStart = { x: f.a.x + edge.normal.x * 0.1, y: f.a.y + edge.normal.y * 0.1 };
    shallow.bottomEnd = { x: f.b.x + edge.normal.x * 0.1, y: f.b.y + edge.normal.y * 0.1 };
    for (const cornerStyle of ['corner', 'loop', 'backarc'] as const)
      assert.throws(() => manufacturedSlotPaths(shallow, { burn: 0.1, cornerStyle }), 'collapsed depth rejected');
    // Editing a returned polygon must never change a nominal datum.
    plain[0].nodes[0].x += 1; assert.equal(JSON.stringify(f), before);
    cases++;
  }
}
console.log(`PASS slot manufacturing: ${cases} rotated/mirrored edge cases, burn correction, both relief profiles, bounds, datums and invalid input`);
