// Tests for cut-out detection of the Virtual Machine (vm/src/parts.ts): node scripts/run-ts.mjs scripts/vm-parts-test.ts
import { BurnMap, burnSegments, type Piece } from '../vm/src/burn';
import { analyze, loopArea, signature } from '../vm/src/parts';

let fails = 0;
const ok = (c: boolean, msg: string) => {
  if (!c) {
    fails++;
    console.error('FAIL', msg);
  } else console.log('ok  ', msg);
};

const piece: Piece = { id: 'a', look: 'poplar', x: 0, y: 0, w: 100, h: 80, t: 3, rot: 0 };
const cutJob = (mmPerMin: number, paths: [number, number][][], p = piece) => {
  const m = new BurnMap(p.w, p.h, p.look, p.t);
  const s: number[] = [];
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1],
        [x1, y1] = path[i];
      s.push(x0, y0, x1, y1, 1, Math.hypot(x1 - x0, y1 - y0) / (mmPerMin / 60), 0);
    }
  burnSegments(s, 10, [{ piece: p, map: m }]);
  return m;
};
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const circle = (cx: number, cy: number, r: number, gap = 0): [number, number][] => {
  const pts: [number, number][] = [];
  const n = 120;
  for (let i = 0; i <= n - gap; i++) pts.push([cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
  return pts;
};

{
  const a = analyze(new BurnMap(100, 80, 'poplar', 3));
  ok(a.bodies.length === 0 && a.hanging.length === 0, 'untouched material has no parts');
}
{
  const m = cutJob(300, [rect(20, 20, 60, 50), circle(80, 40, 8)]);
  const a = analyze(m);
  const parts = a.bodies.filter((b) => b.kind === 'part');
  const rest = a.bodies.filter((b) => b.kind === 'rest');
  ok(parts.length === 2 && rest.length === 1, `a rectangle and a circle fall out of one leftover (${parts.length} parts, ${rest.length} rest)`);
  const sq = parts.find((b) => b.x1 < 70)!;
  ok(sq && Math.abs(sq.area - 40 * 30) < 40, `the rectangle has about 40 × 30 mm (${sq?.area.toFixed(0)} mm²)`);
  ok(sq && Math.abs(Math.abs(loopArea(sq.loops[0])) - sq.area) < 40, 'its outline encloses its area');
  ok(rest[0].loops.length === 3 && loopArea(rest[0].loops[0]) > 0 && loopArea(rest[0].loops[1]) < 0, 'the leftover has an outer edge and two holes');
  ok(a.hanging.length === 0, 'nothing hangs');
  ok(signature(a) === signature(analyze(m)), 'the fingerprint is stable');
}
{
  // ring: a part with a hole, the inner disc falls out as its own part
  const a = analyze(cutJob(300, [circle(50, 40, 25), circle(50, 40, 10)]));
  const parts = a.bodies.filter((b) => b.kind === 'part');
  ok(parts.length === 2, 'a ring and its inner disc are two parts');
  const ring = parts.sort((p, q) => q.area - p.area)[0];
  ok(ring.loops.length === 2, 'the ring has a hole');
}
{
  // a circle with a gap (tab) and a rectangle cut too fast: both still hang
  const m = cutJob(300, [circle(30, 40, 12, 1)]);
  const fast = cutJob(700, [rect(60, 20, 90, 60)]);
  const a = analyze(m),
    b = analyze(fast);
  ok(a.bodies.filter((x) => x.kind === 'part').length === 0 && a.hanging.length === 1, 'a circle with a 0.6 mm gap (tab) still hangs');
  ok(b.bodies.filter((x) => x.kind === 'part').length === 0 && b.hanging.length === 1, `a cut that is not quite through everywhere still hangs (${b.hanging.length})`);
}
{
  // a cut across the whole piece leaves two leftovers
  const a = analyze(cutJob(300, [[[50, -5], [50, 85]]]));
  ok(a.bodies.length === 2 && a.bodies.every((b) => b.kind === 'rest'), 'a cut across splits the piece into two pieces of leftover');
}
{
  // an open line or a wide gap is design, not a hanging part
  const a = analyze(cutJob(300, [circle(50, 40, 20, 15)]));
  ok(a.hanging.length === 0 && a.bodies.length === 1, 'a circle with a wide opening neither falls out nor hangs');
}

if (fails) {
  console.error(`${fails} test(s) failed`);
  process.exit(1);
}
console.log('all cut-out tests passed');
