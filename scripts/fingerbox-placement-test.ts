import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { defaultParams, getGenerator, buildGen } from '../src/generators';
import { fingerboxParts, type FingerboxParams } from '../src/generators/fingerbox-experiment';

// Regression: parts of a new box must never overlap in the 2D layout, even when the box is much taller than deep.
// Boxes with jointLayout 'legacy' keep their old arrangement so existing projects do not move.
type Part = { key: string; at: { x: number; y: number }; subs: { nodes: { x: number; y: number }[] }[] };
const bbox = (p: Part) => {
  const xs = p.subs.flatMap((s) => s.nodes.map((n) => n.x + p.at.x));
  const ys = p.subs.flatMap((s) => s.nodes.map((n) => n.y + p.at.y));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const overlaps = (parts: Part[]) => {
  const out: string[] = [];
  parts.forEach((a, i) => parts.slice(i + 1).forEach((b) => {
    const p = bbox(a), q = bbox(b);
    if (Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 1e-6 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 1e-6) out.push(`${a.key}/${b.key}`);
  }));
  return out;
};

// Reported case: 30 x 30 x 60 mm, material 3.6 mm, finger 6 mm, open, no dividers
const reported: FingerboxParams = { width: 30, depth: 30, height: 60, thickness: 3.6, finger: 6, top: 'open' };
assert.deepEqual(overlaps(fingerboxParts(reported)), [], 'reported case overlaps');
const rows = fingerboxParts(reported);
assert.deepEqual(rows.map((p) => p.key), ['bottom', 'front', 'back', 'left', 'right']);
const firstRowBottom = Math.max(...rows.slice(0, 3).map((p) => bbox(p).y1));
for (const p of rows.slice(3)) assert.ok(bbox(p).y0 >= firstRowBottom + 5, `${p.key} must sit below the first row`);

// Sweep of dimensions, open and closed
let seed = 11, checked = 0;
const rnd = (a: number, b: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return a + (seed / 0x7fffffff) * (b - a); };
for (let i = 0; i < 300; i++) {
  const p: FingerboxParams = { width: rnd(20, 300), depth: rnd(20, 300), height: rnd(15, 400), thickness: rnd(2, 6), finger: rnd(4, 30), top: i % 2 ? 'closed' : 'open' };
  let parts: Part[];
  try { parts = fingerboxParts(p); } catch { continue; }
  checked++;
  assert.deepEqual(overlaps(parts), [], `overlap ${JSON.stringify(p)}`);
}
assert.ok(checked > 200, `only ${checked} cases were valid`);

// Through the generator (packed layout by default), including dividers
const g = getGenerator('box-divided')!;
for (const top of ['open', 'closed']) for (const [h, cx, cy] of [[60, 1, 1], [60, 3, 2], [150, 2, 3], [20, 4, 1]] as const) {
  const params = { ...defaultParams(g), width: 100, depth: 40, height: h, thickness: 3, finger: 6, top, compartmentsX: cx, compartmentsY: cy, ratiosX: '', ratiosY: '', dividerDrop: 5 };
  const parts = buildGen(g, params).parts.map((x) => ({ key: x.shape.part as string, at: x.at, subs: x.shape.subs })) as Part[];
  assert.deepEqual(overlaps(parts), [], `generator overlap ${top} h=${h} ${cx}x${cy}`);
}

// Old boxes keep exactly the arrangement they had
const legacy = fingerboxParts({ width: 300, depth: 200, height: 100, thickness: 6, finger: 20, jointLayout: 'legacy' });
assert.deepEqual(legacy.map((p) => p.at), [{ x: 150, y: 100 }, { x: 460, y: 50 }, { x: 770, y: 50 }, { x: 100, y: 260 }, { x: 310, y: 260 }]);
console.log(`ok   Fingerbox placement: no overlaps in ${checked} swept cases, reported 30x30x60 case and dividers; legacy layout unchanged`);
