// Tests für die Platzierung neuer Teile (src/placement.ts): npm run test:placement
import assert from 'node:assert/strict';
import { findFreeSpot, fitsArea, type Rect } from '../src/placement';

const test = (name: string, fn: () => void) => {
  fn();
  console.log('ok', name);
};
const BED = { w: 400, h: 300 };
const GAP = 2, MARGIN = 3;
const place = (obst: Rect[], w: number, h: number) => findFreeSpot(obst, { w, h }, BED, GAP, MARGIN);
const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap - 1e-9 && a.x + a.w + gap > b.x + 1e-9 && a.y < b.y + b.h + gap - 1e-9 && a.y + a.h + gap > b.y + 1e-9;

test('Leere Seite: unten links mit Randabstand (Modell: großes y = unten)', () => {
  assert.deepEqual(place([], 50, 40), { x: 3, y: 300 - 3 - 40 });
});

test('Zweites Teil kommt rechts neben das erste, mit Abstand', () => {
  const first = { x: 3, y: 257, w: 50, h: 40 };
  assert.deepEqual(place([first], 30, 40), { x: 55, y: 257 });
});

test('Ist die unterste Reihe voll, kommt die nächste Reihe darüber', () => {
  const full = { x: 3, y: 257, w: 394, h: 40 };
  assert.deepEqual(place([full], 50, 40), { x: 3, y: 257 - 2 - 40 });
});

test('Ein niedriges Teil füllt eine Lücke unten, bevor eine neue Reihe beginnt', () => {
  const a = { x: 3, y: 197, w: 100, h: 100 };
  const b = { x: 200, y: 197, w: 100, h: 100 };
  assert.deepEqual(place([a, b], 90, 30), { x: 105, y: 297 - 30 });
});

test('Eine Lücke, die nur ohne Abstand passen würde, wird übersprungen', () => {
  const a = { x: 3, y: 257, w: 100, h: 40 };
  const b = { x: 150, y: 257, w: 100, h: 40 };
  // Zwischen a und b sind 47 mm; ein Teil von 44 mm passt mit 2 + 2 mm Abstand nicht mehr (44 + 4 > 47)
  const p = place([a, b], 44, 40)!;
  assert.ok(p.x >= 252 - 1e-9, `x = ${p.x}`);
  // 43 mm passen genau (43 + 4 = 47)
  assert.deepEqual(place([a, b], 43, 40), { x: 105, y: 257 });
});

test('Kein Platz mehr: null', () => {
  const all = { x: 0, y: 0, w: 400, h: 300 };
  assert.equal(place([all], 10, 10), null);
});

test('Größer als die Fläche: null und fitsArea = false', () => {
  assert.equal(place([], 395, 10), null);
  assert.equal(fitsArea({ w: 395, h: 10 }, BED, MARGIN), false);
  assert.equal(fitsArea({ w: 394, h: 294 }, BED, MARGIN), true);
  assert.deepEqual(place([], 394, 294), { x: 3, y: 3 });
});

test('Hindernisse außerhalb der Fläche stören nicht, solche am Rand schon', () => {
  const outside = { x: -500, y: -500, w: 100, h: 100 };
  assert.deepEqual(place([outside], 50, 40), { x: 3, y: 257 });
  const overEdge = { x: -20, y: 250, w: 60, h: 80 };
  const p = place([overEdge], 50, 40)!;
  assert.ok(!overlaps({ ...p, w: 50, h: 40 }, overEdge, GAP));
});

test('Viele Teile hintereinander: nie überlappend, nie außerhalb', () => {
  const placed: Rect[] = [];
  const sizes = [[60, 40], [25, 80], [100, 20], [45, 45], [70, 30], [10, 10], [120, 60], [33, 17]];
  for (let i = 0; i < 40; i++) {
    const [w, h] = sizes[i % sizes.length];
    const p = place(placed, w, h);
    if (!p) break;
    const r = { ...p, w, h };
    for (const o of placed) assert.ok(!overlaps(r, o, GAP), `Teil ${i} überlappt`);
    assert.ok(r.x >= MARGIN - 1e-9 && r.y >= MARGIN - 1e-9 && r.x + w <= BED.w - MARGIN + 1e-9 && r.y + h <= BED.h - MARGIN + 1e-9, `Teil ${i} außerhalb`);
    placed.push(r);
  }
  assert.ok(placed.length >= 20, `nur ${placed.length} Teile platziert`);
});
