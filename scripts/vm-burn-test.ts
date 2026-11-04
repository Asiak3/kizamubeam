// Tests for the burn maps of the Virtual Machine (vm/src/burn.ts): node scripts/run-ts.mjs scripts/vm-burn-test.ts
import { BurnMap, burnSegments, contains, toBed, toLocal, type Piece } from '../vm/src/burn';

let fails = 0;
const ok = (c: boolean, msg: string) => {
  if (!c) {
    fails++;
    console.error('FAIL', msg);
  } else console.log('ok  ', msg);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const piece = (o: Partial<Piece> = {}): Piece => ({ id: 'a', look: 'poplar', x: 50, y: 40, w: 100, h: 60, t: 3, rot: 0, ...o });

// coordinates
{
  const p = piece({ rot: 30 });
  const [x, y] = toBed(p, 12, 34);
  const [u, v] = toLocal(p, x, y);
  ok(near(u, 12, 1e-9) && near(v, 34, 1e-9), 'toLocal undoes toBed with rotation');
  const q = piece({ rot: 90 });
  const [cx, cy] = toBed(q, 0, 0);
  ok(near(cx, 50 + 50 + 30) && near(cy, 40 + 30 - 50), 'rotation by 90° turns the front left corner about the centre');
  ok(contains(q, 120, 70) && !contains(q, 55, 45), 'contains follows the rotation');
}

// energy is kept
{
  const m = new BurnMap(100, 60, 'poplar', 3);
  m.deposit(10, 10, 80, 50, 7.5);
  ok(near(m.total(), 7.5, 1e-3), 'a line inside the piece keeps all its energy');
  m.deposit(-50, 30, 50, 30, 10);
  ok(near(m.total(), 12.5, 0.02), 'only the part of a line on the piece counts');
}

const job = (watts: number, mmPerMin: number, power: number, lines: [number, number, number, number][], p = piece()) => {
  const m = new BurnMap(p.w, p.h, p.look, p.t);
  const s: number[] = [];
  for (const [x0, y0, x1, y1] of lines) s.push(x0, y0, x1, y1, power, Math.hypot(x1 - x0, y1 - y0) / (mmPerMin / 60), 0);
  burnSegments(s, watts, [{ piece: p, map: m }]);
  return m;
};

// cutting: 10 W at 100 % and 300 mm/min cuts 3 mm poplar, at 1000 mm/min it does not
{
  const slow = job(10, 300, 1, [[60, 60, 140, 60]]);
  ok(slow.through > 0, '300 mm/min at 10 W cuts through 3 mm poplar');
  const centred = job(10, 300, 1, [[60, 60.05, 140, 60.05]]);
  ok(centred.through > 0, 'the same cut on a pixel centre instead of a pixel edge cuts as well');
  const fast = job(10, 1000, 1, [[60, 60, 140, 60]]);
  ok(fast.through === 0, '1000 mm/min at 10 W does not cut through');
  const i = (60 - 40) * fast.res * fast.nx + Math.floor(50 * fast.res);
  ok(fast.tex[i * 2] > 200 && fast.tex[i * 2 + 1] > 50, 'a fast line still marks and goes in partly');
  const thick = new BurnMap(100, 60, 'poplar', 3);
  thick.energy.set(slow.energy);
  thick.setMaterial('poplar', 6);
  ok(thick.through === 0, 'the same energy does not cut 6 mm');
  thick.setMaterial('slate', 3);
  ok(thick.through === 0 && thick.tex.some((b, k) => k % 2 === 0 && b > 200), 'slate is marked but never cut');
}

// engraving: 30 % at 3000 mm/min with 0.1 mm line interval is medium dark and stays on the surface
{
  const lines: [number, number, number, number][] = [];
  for (let y = 60; y < 70; y += 0.1) lines.push([60, y, 70, y]);
  const m = job(10, 3000, 0.3, lines);
  const i = Math.floor((65 - 40) * m.res) * m.nx + Math.floor((65 - 50) * m.res);
  const mark = m.tex[i * 2] / 255;
  ok(mark > 0.5 && mark < 0.97, `fill engraving is medium dark (${mark.toFixed(2)})`);
  ok(m.through === 0, 'fill engraving does not cut through');
}

// rapids and laser off leave nothing; the burn follows a rotated piece
{
  const p = piece({ rot: 90 });
  const m = new BurnMap(p.w, p.h, p.look, p.t);
  burnSegments([60, 50, 140, 90, 1, 5, 1, 60, 50, 140, 90, 0, 5, 0], 10, [{ piece: p, map: m }]);
  ok(m.total() === 0, 'rapids and moves with the laser off do not burn');
  const [x0, y0] = toBed(p, 10, 30);
  const [x1, y1] = toBed(p, 90, 30);
  burnSegments([x0, y0, x1, y1, 1, 2, 0], 10, [{ piece: p, map: m }]);
  const row = Math.floor(30 * m.res);
  let sum = 0;
  for (let x = 0; x < m.nx; x++) sum += m.energy[row * m.nx + x] + m.energy[(row - 1) * m.nx + x];
  ok(sum > 0 && near(m.total(), 20, 0.01), 'a line along the rotated piece lands along its own x axis');
}

if (fails) {
  console.error(`${fails} test(s) failed`);
  process.exit(1);
}
console.log('all burn map tests passed');
