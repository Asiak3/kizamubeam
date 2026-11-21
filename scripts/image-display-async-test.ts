import './core-fixtures-env';
import assert from 'node:assert/strict';
import { addAsset, displayCanvasDraft, onImageReady, outputGrid, processImage, resample } from '../src/images';
import * as images from '../src/images';
import { DEFAULT_ADJUST, defaultImageLayer, defaultLayer, imageOutput, type ImageShape, type Mat } from '../src/model';

const g = globalThis as any;
const imageDisplayActivity = (owner: object) => (images as any).imageDisplayActivity(owner);
const cancelImageDisplay = (owner: object) => (images as any).cancelImageDisplay(owner);
class Canvas {
  width = 0; height = 0; pixels = new Uint8ClampedArray();
  getContext() { return {
    drawImage: (img: any) => { this.pixels = img.pixels.slice(); },
    getImageData: () => ({ data: this.pixels.slice() }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (data: any) => { this.pixels = data.data.slice(); },
  }; }
}
g.Image = class {
  naturalWidth = 101; naturalHeight = 59; onload = () => {};
  pixels = Uint8ClampedArray.from({ length: 101 * 59 * 4 }, (_, i) => i % 4 === 3 ? 255 : ((Math.floor(i / 4) % 101) % 2 ? 220 : 30));
  set src(_: string) { queueMicrotask(() => this.onload()); }
};
g.document.createElement = () => new Canvas();
class ManualWorker {
  static all: ManualWorker[] = [];
  messages: any[] = []; terminated = false;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  constructor() { ManualWorker.all.push(this); }
  postMessage(message: any) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  reply(data: any) { this.onmessage?.({ data }); }
}
g.Worker = ManualWorker;
const a = await addAsset('data:image/test,async-signal');
const s: ImageShape = { kind: 'image', asset: a.id, w: 10.1, h: 5.9, pxW: 101, pxH: 59, adjust: { ...DEFAULT_ADJUST } };
const m: Mat = [1.1, .2, -.15, .9, 17, 13];
const L = imageOutput({ ...defaultLayer(0), interval: .075 }, defaultImageLayer());
const edit = { crop: { left: .001, top: 0, right: 1, bottom: 1 } };
const options = { zoom: 2, dpr: 1.5 };
const before = JSON.stringify(s);
let redraws = 0; const off = onImageReady(() => redraws++);
const draw = (e = edit, output = L, world = m) => displayCanvasDraft(s, world, output, e, options);
assert.equal(draw(), null, 'cold edited display must return before full-job processing');
assert.equal(ManualWorker.all.length, 1, 'production display actually starts a worker');
const worker = ManualWorker.all[0], first = worker.messages[0];
assert.equal(imageDisplayActivity(s)?.pending, true);
const grid = outputGrid({ ...s, edit }, m, L.interval);
assert.deepEqual(first.job, { cols: grid.cols, rows: grid.rows });
assert.equal(first.output.interval, L.interval, 'no coarse interval before dither');
worker.reply({ id: first.id, phase: 2 });
assert.equal(imageDisplayActivity(s)?.phase, 2, 'progress reports completed processing phases');
for (let i = 2; i <= 60; i++) assert.equal(draw({ crop: { ...edit.crop, left: i / 10000 } }), null);
assert.equal(worker.messages.length, 1, 'drag frames cannot queue 60 full calculations');
worker.reply({ id: first.id, values: new Uint8ClampedArray(first.display.cols * first.display.rows) });
assert.equal(worker.messages.length, 2, 'only newest pending edit is dispatched');
const latest = worker.messages[1], lastEdit = { crop: { ...edit.crop, left: .006 } };
assert.equal(latest.shape.edit.crop.left, .006);
assert.equal(draw(lastEdit), null, 'superseded result is never drawn as current geometry');
const latestGrid = outputGrid({ ...s, edit: lastEdit }, m, L.interval);
const job = processImage({ ...s, edit: lastEdit }, L, latestGrid.cols, latestGrid.rows, m)!;
const values = Uint8ClampedArray.from(resample(job, latestGrid.cols, latestGrid.rows, latest.display.cols, latest.display.rows));
worker.reply({ id: latest.id, values });
const canvas = draw(lastEdit) as unknown as Canvas;
assert.ok(canvas);
assert.deepEqual(canvas.pixels.filter((_, i) => i % 4 === 0), values);
assert.equal(imageDisplayActivity(s), null);
assert.ok(redraws >= 2, 'progress and completion request redraws');
assert.equal(draw(lastEdit), canvas, 'completed display is cached');
const invalidated = draw(lastEdit, { ...L, negative: true });
assert.equal(invalidated, canvas, 'output changes keep showing the interim canvas while the replacement renders');
assert.equal(worker.messages.at(-1).output.negative, true, 'output changes queue replacement work');
assert.equal(imageDisplayActivity(s)?.pending, true);
const negativeRequests = worker.messages.length;
cancelImageDisplay(s);
assert.equal(worker.terminated, true, 'cancel terminates expensive current work');
assert.equal(imageDisplayActivity(s), null);
worker.reply({ id: worker.messages.at(-1).id, values: new Uint8ClampedArray(1) });
assert.equal(draw(lastEdit, { ...L, negative: true }), canvas, 'cancelled key shows the interim canvas without restarting the redraw');
assert.equal(worker.messages.length, negativeRequests, 'cancelled key does not queue another redraw');
assert.equal(ManualWorker.all.length, 1);
const restarted = draw(lastEdit, L, [1, .3, -.2, 1, 17, 13]);
assert.equal(restarted, canvas, 'changed affine keeps showing the interim canvas while fresh work starts');
assert.equal(imageDisplayActivity(s)?.pending, true);
assert.equal(ManualWorker.all.length, 2);
const nextWorker = ManualWorker.all[1], bad = nextWorker.messages[0];
nextWorker.reply({ id: bad.id, error: { name: 'TypeError', message: 'programmer failure' } });
assert.throws(() => draw(lastEdit, L, [1, .3, -.2, 1, 17, 13]), /programmer failure/, 'unexpected worker errors propagate on render');
assert.throws(() => draw({ crop: { left: 1, right: 0, top: 0, bottom: 1 } }), /Image processing/, 'validation stays synchronous');
assert.throws(() => displayCanvasDraft({ ...s, pxW: 102 }, m, L, edit, options), /source-dimensions/, 'source dimension validation stays synchronous');
const replacement = await addAsset('data:image/test,another-original');
const changedSource = { ...s, asset: replacement.id };
assert.equal(displayCanvasDraft(changedSource, m, L, edit, { ...options, owner: s }), null);
const sourceRequest = nextWorker.messages.at(-1);
assert.notEqual(sourceRequest.jobKey, first.jobKey, 'source identity invalidates the full-job cache');
cancelImageDisplay(s);
const badOwner = {}, goodOwner = {}, badOutput = { ...L, threshold: 246 }, goodOutput = { ...L, threshold: 247 };
assert.equal(displayCanvasDraft(s, m, badOutput, edit, { ...options, owner: badOwner }), null);
const presentationWorker = ManualWorker.all.at(-1)!;
assert.equal(displayCanvasDraft(s, m, goodOutput, edit, { ...options, owner: goodOwner }), null);
assert.equal(presentationWorker.messages.length, 1, 'different owners also share one worker slot');
const presentationRequest = presentationWorker.messages[0], createElement = g.document.createElement;
g.document.createElement = () => { throw new TypeError('canvas presentation failure'); };
try { presentationWorker.reply({ id: presentationRequest.id, values: new Uint8ClampedArray(presentationRequest.display.cols * presentationRequest.display.rows) }); }
finally { g.document.createElement = createElement; }
assert.throws(() => displayCanvasDraft(s, m, badOutput, edit, { ...options, owner: badOwner }), /canvas presentation failure/);
assert.equal(presentationWorker.messages.length, 2, 'presentation errors release the worker slot for other images');
cancelImageDisplay(goodOwner);
assert.equal(JSON.stringify(s), before);
off();
console.log('async display: completion, full-job signal, progress, 60-frame coalescing, invalidation, cancellation, errors and immutability passed');
