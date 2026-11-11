import './core-fixtures-env';
import assert from 'node:assert/strict';
import { assessOffsetOutput } from '../src/contourOffsetValidation';
import { offsetContours, offsetResults, offsetSource, type ContourOffsetRecipe, type OffsetSource } from '../src/contourOffset';
import { defaultLayer as modelLayer, IDENT, type SubPath } from '../src/model';
import { extract } from '../src/pathtools';

const defaultLayer = (index: number) => ({ ...modelLayer(index), mode: 'line' as 'line' | 'fill' });

const ring = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }] });
const open = (points: number[][]): SubPath => ({ closed: false, nodes: points.map(([x, y]) => ({ x, y })) });
const source = (id: number, subs: SubPath[]) => offsetSource(id, { kind: 'path', subs }, [...IDENT]);
const recipe = (s: OffsetSource, result: SubPath[]): ContourOffsetRecipe => ({ version: 2, source: s.source, base: s.base, edits: [], result });
let count = 0;
function test(name: string, run: () => void) { run(); count++; console.log('PASS ' + name); }

test('benign offset metrics and input immutability', () => {
  const s = source(1, [ring(0, 0, 20, 10)]), result = ring(-.1, -.1, 20.2, 10.2), r = recipe(s, [result]);
  const before = JSON.stringify([s, r]);
  const a = assessOffsetOutput([s], [r], [result], [defaultLayer(0)]);
  assert.deepEqual(a.unsafe, []); assert.deepEqual(a.warnings, []);
  assert.ok(Math.abs(a.metrics[0].areaMm2 - 206.04) < 1e-9);
  assert.ok(Math.abs(a.metrics[0].minSpanMm - 10.2) < 1e-9);
  assert.equal(JSON.stringify([s, r]), before);
});

test('resource-like .07 mm retained gap is unsafe, not silently discarded', () => {
  const s = source(2, [ring(0, 0, 20, 10)]);
  const retained = open([[0, 0], [20, 0], [20, 10], [0, 10], [0, .07]]);
  const a = assessOffsetOutput([s], [recipe(s, [ring(1, 1, 18, 8), retained])], [ring(1, 1, 18, 8)], [defaultLayer(0)]);
  assert.ok(a.unsafe.includes('new-open-output'));
  assert.equal(retained.nodes.at(-1)!.y, .07);
});

test('resource contour baseline zero versus two open result findings blocks', () => {
  const s = source(3, [ring(0, 0, 30, 20)]);
  const a = assessOffsetOutput([s], [recipe(s, [open([[0, 0], [4, 0], [4, 4], [0, .07]]),
    open([[10, 0], [14, 0], [14, 4], [10, .07]])])], [ring(1, 1, 20, 10)], [defaultLayer(0)]);
  assert.ok(a.unsafe.includes('new-open-output'));
});

test('warning counts ignore subindices but detect additional findings', () => {
  const gap = open([[0, 0], [4, 0], [4, 4], [0, .07]]), far = open([[30, 0], [40, 0]]);
  const s = source(4, [gap, far]), layer = defaultLayer(0);
  assert.deepEqual(assessOffsetOutput([s], [recipe(s, [far, gap])], [], [layer]).unsafe, []);
  const extra = open([[10, 0], [14, 0], [14, 4], [10, .07]]);
  assert.ok(assessOffsetOutput([s], [recipe(s, [far, gap, extra])], [], [layer]).unsafe.includes('new-open-output'));
});

test('untouched source warning is not a newly introduced warning', () => {
  const s = source(5, [ring(0, 0, 20, 20)]), untouched = source(6, [open([[30, 0], [34, 0], [34, 4], [30, .07]])]);
  assert.deepEqual(assessOffsetOutput([s, untouched], [recipe(s, [ring(1, 1, 18, 18)]), null], [ring(1, 1, 18, 18)], [defaultLayer(0), defaultLayer(1)]).unsafe, []);
});

test('new cross-owner unjoined contour is detected with unchanged owner identities', () => {
  const sources = [source(7, [open([[0, 0], [10, 0]])]), source(8, [open([[10, 10], [0, 10]])])];
  const recipes = [recipe(sources[0], [open([[0, 0], [10, 0], [10, 10]])]), recipe(sources[1], [open([[10, 10], [0, 10], [0, 0]])])];
  assert.ok(assessOffsetOutput(sources, recipes, [ring(0, 0, 10, 10)], [defaultLayer(0), defaultLayer(1)]).unsafe.includes('new-unjoined-output'));
});

test('actual cross-owner backend remains usable for lines but gates kerf and fill despite same baseline warning', () => {
  const sources = [source(9, [open([[0, 0], [20, 0], [20, 10]])]), source(10, [open([[20, 10], [0, 10], [0, 0]])])];
  const plan = offsetContours(sources, .05), output = offsetResults(sources, plan, new Map([[plan.contours[0].key, -.1]]), .05);
  const layers = [defaultLayer(0), defaultLayer(1)];
  assert.deepEqual(assessOffsetOutput(sources, output.recipes, output.preview, layers).unsafe, []);
  layers[1].kerf = .12;
  const kerf = assessOffsetOutput(sources, output.recipes, output.preview, layers);
  assert.ok(kerf.unsafe.includes('open-output-with-kerf-or-fill'));
  assert.equal(kerf.metrics[0].kerfMm, .12);
  layers[1].kerf = 0; layers[1].mode = 'fill';
  assert.ok(assessOffsetOutput(sources, output.recipes, output.preview, layers).unsafe.includes('open-output-with-kerf-or-fill'));
});

test('unquantized tiny region is advisory, not automatically blocked', () => {
  const s = source(11, [ring(0, 0, 10, 10)]), tiny = ring(2, 2, .007, .003), layer = defaultLayer(0); layer.kerf = .1;
  const a = assessOffsetOutput([s], [recipe(s, [tiny])], [tiny], [layer]);
  assert.deepEqual(a.unsafe, []); assert.deepEqual(a.warnings, ['small-area', 'narrow-span']);
  assert.ok(Math.abs(a.metrics[0].areaMm2 - .000021) < 1e-12);
  assert.ok(Math.abs(a.metrics[0].minSpanMm - .003) < 1e-12);
});

test('world-coordinate metrics and negative kerf use conservative changed-owner maximum', () => {
  const s = source(12, [ring(0, 0, 10, 10)]); s.m = [2, 0, 0, 3, 100, 200];
  const layer = defaultLayer(0); layer.kerf = -.2;
  const a = assessOffsetOutput([s], [recipe(s, [ring(0, 0, 1, .1)])], [ring(100, 200, 2, .3)], [layer]);
  assert.deepEqual(a.unsafe, []); assert.ok(a.warnings.includes('narrow-span'));
  assert.equal(a.metrics[0].kerfMm, .2); assert.ok(Math.abs(a.metrics[0].areaMm2 - .6) < 1e-9);
});

test('assembly permits only proven exact line-source complements with an explicit warning, never fill or altered remnants', () => {
  const sources=[source(21,[ring(0,0,40,30)]),source(22,[open([[0,0],[40,0]])])];
  const a=recipe(sources[0],[ring(.5,.5,39,29),extract(sources[0].base[0],1,4)]),b=recipe(sources[1],[]);
  const edit={token:'assembly-test',parts:2,distance:-.5,tolerance:.2,anchor:{x:0,y:0},outputOwner:21,sub:0,spans:[{u0:0,u1:1}]};
  a.edits=[edit];b.edits=[structuredClone(edit)];
  const layers=[{...defaultLayer(0),kerf:.06},{...defaultLayer(1),kerf:.06}],preview=[ring(.5,.5,39,29)];
  const assessed=assessOffsetOutput(sources,[a,b],preview,layers);
  assert.deepEqual(assessed.unsafe,[]);assert.ok(assessed.warnings.includes('open-source-remainders'));
  const forged=structuredClone(a);forged.result[1].nodes[1].y+=.001;
  assert.ok(assessOffsetOutput(sources,[forged,b],preview,layers).unsafe.includes('open-output-with-kerf-or-fill'));
  layers[0].mode='fill';
  assert.ok(assessOffsetOutput(sources,[a,b],preview,layers).unsafe.includes('open-output-with-kerf-or-fill'));
});
test('degenerate and nonfinite output fail closed with finite returned metrics', () => {
  const s = source(13, [ring(0, 0, 10, 10)]);
  for (const bad of [ring(0, 0, 0, 1), ring(0, 0, NaN, 1)]) {
    const a = assessOffsetOutput([s], [recipe(s, [bad])], [bad], [defaultLayer(0)]);
    assert.ok(a.unsafe.length > 0); assert.ok(a.metrics.every(m => Object.values(m).every(Number.isFinite)));
  }
  const collinear: SubPath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] };
  assert.ok(assessOffsetOutput([s], [recipe(s, [collinear])], [], [defaultLayer(0)]).unsafe.includes('degenerate-output'));
});
console.log(`${count} contour offset validation tests passed`);
