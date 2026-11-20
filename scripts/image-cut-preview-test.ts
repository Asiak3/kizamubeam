// Image cut moves (sub = -2) sort after main/sublayer groups; marker order stays time-based.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Moves } = await import('../src/gcode');
const { analyzePlayback, PROCESS_CUT, PROCESS_ENGRAVE, PROCESS_TRAVEL } = await import('../src/previewPlayback');

const mv = new Moves();
const t: number[] = [];
let x = 0;
const add = (cls: number, dt: number, layer: number, sub: number) => {
  x += 1;
  mv.push(x, 0, cls === PROCESS_TRAVEL ? 0 : 1000, cls === PROCESS_TRAVEL ? 0 : 0.5, layer, cls, sub);
  t.push((t.at(-1) ?? 0) + dt);
};
add(PROCESS_TRAVEL, 1, 0, -1);   // main group (travel only, no marker)
add(PROCESS_CUT, 2, 0, -2);      // image cut
add(PROCESS_ENGRAVE, 2, 0, 0);   // sublayer
const est = { t: Float64Array.from(t), total: 5, cutLength: 0, rapidLength: 0 };
const a = analyzePlayback(mv, est, { engrave: 50, cut: 10, smooth: false, target: 20 });

assert.deepEqual(a.layerTimes.map((l) => l.sub), [-1, 0, -2], 'image cut row is last within its layer');
assert.deepEqual(a.markers.map((m) => m.sub), [-2, 0], 'markers keep time order and are not re-sorted');
assert.deepEqual(a.layerTimes.map((l) => Math.round(l.seconds)), [1, 2, 2]);
console.log('image cut preview: layer/cut/sub order and marker order passed');
