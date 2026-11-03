// Tests für das Hintergrundgitter (src/grid.ts): npm run test:grid
import assert from 'node:assert/strict';
import { cleanGrid, DEFAULT_GRID, finestStep, gridLevels, gridLines } from '../src/grid';

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('ok', name);
};

test('Standard entspricht dem bisherigen Gitter 1/10/100 mm', () => {
  assert.deepEqual(gridLevels(DEFAULT_GRID).map((l) => l.step), [1, 10, 100]);
  assert.equal(finestStep(DEFAULT_GRID), 1);
});

test('Unterteilung 1 und kräftig 0 lassen Stufen weg', () => {
  const g = cleanGrid({ spacing: 5, divisions: 1, every: 0 });
  assert.deepEqual(gridLevels(g), [{ level: 'major', step: 5 }]);
  assert.equal(finestStep(g), 5);
});

test('Zoll-Gitter: 25,4 mm mit 4 Unterteilungen', () => {
  const g = cleanGrid({ spacing: 25.4, divisions: 4, every: 4 });
  assert.deepEqual(gridLevels(g).map((l) => l.step), [6.35, 25.4, 101.6]);
});

test('cleanGrid repariert kaputte Werte', () => {
  assert.deepEqual(cleanGrid(null), DEFAULT_GRID);
  assert.deepEqual(cleanGrid('x'), DEFAULT_GRID);
  const g = cleanGrid({ show: 'ja', spacing: -3, divisions: 0.2, every: 99, color: 'rot', opacity: 0 });
  assert.equal(g.show, true);
  assert.equal(g.spacing, 10);
  assert.equal(g.divisions, 1);
  assert.equal(g.every, 50);
  assert.equal(g.color, '');
  assert.equal(g.opacity, 5);
  assert.equal(cleanGrid({ color: '#AABBCC' }).color, '#aabbcc');
  assert.equal(cleanGrid({ show: false }).show, false);
});

test('gridLines zählt ab 0 ohne aufsummierte Rundungsfehler', () => {
  const xs = gridLines(0.1, 0, 400);
  assert.equal(xs.length, 4001);
  assert.ok(Math.abs(xs[3000] - 300) < 1e-9); // i*step, nicht 3000 Additionen
  assert.ok(Math.abs(xs[4000] - 400) < 1e-9);
  assert.deepEqual(gridLines(10, 15, 42), [20, 30, 40]);
  assert.deepEqual(gridLines(10, 20, 40), [20, 30, 40]);
  assert.deepEqual(gridLines(0, 0, 10), []);
  assert.deepEqual(gridLines(1, 0, 100000, 1000), []);
});

console.log(`${n} Tests bestanden`);
