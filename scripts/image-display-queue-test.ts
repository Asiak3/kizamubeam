// B-40 spinner regression: A→B→C with warm canvas. Redraw of queued C while B
// runs must not drop C from the queue (permanent pending + progress cursor).
// Standalone suite: image-display-async-test.ts fails pre-existing on main.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { addAsset, displayCanvasDraft, imageDisplayActivity } from '../src/images';
import { DEFAULT_ADJUST, defaultImageLayer, defaultLayer, imageOutput, type ImageShape, type Mat } from '../src/model';

const g = globalThis as any;
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
  pixels = Uint8ClampedArray.from({ length: 101 * 59 * 4 }, (_, i) => i % 4 === 3 ? 255 : 30);
  set src(_: string) { queueMicrotask(() => this.onload()); }
};
g.document.createElement = () => new Canvas();
class ManualWorker {
  static all: ManualWorker[] = [];
  messages: any[] = [];
  onmessage: ((event: any) => void) | null = null;
  constructor() { ManualWorker.all.push(this); }
  postMessage(message: any) { this.messages.push(structuredClone(message)); }
  terminate() {}
  reply(data: any) { this.onmessage?.({ data }); }
}
g.Worker = ManualWorker;

const a = await addAsset('data:image/test,spinner-warm');
const s: ImageShape = { kind: 'image', asset: a.id, w: 10.1, h: 5.9, pxW: 101, pxH: 59, adjust: { ...DEFAULT_ADJUST } };
const m: Mat = [1, 0, 0, 1, 0, 0];
const L = imageOutput({ ...defaultLayer(0), interval: .075 }, defaultImageLayer());
const owner = {};
const draw = (left: number) => displayCanvasDraft({ ...s }, m, L, { crop: { left, top: 0, right: 1, bottom: 1 } }, { zoom: 2, dpr: 1, owner });
const zeros = (req: any) => new Uint8ClampedArray(req.display.cols * req.display.rows);
const fill = (req: any, v: number) => Uint8ClampedArray.from({ length: req.display.cols * req.display.rows }, () => v);
const firstByte = (c: any) => c.getContext().getImageData().data[0];

// A completes: canvas retained, owner idle.
draw(.21);
const worker = ManualWorker.all.at(-1)!;
const reqA = worker.messages.at(-1);
worker.reply({ id: reqA.id, values: zeros(reqA) });
const canvasA = draw(.21);
assert.ok(canvasA, 'completed A display is cached');
assert.equal(firstByte(canvasA), 0, 'A pixels land on the canvas');
assert.equal(imageDisplayActivity(owner), null);
// B queued and running, C queued behind B, then C redrawn while B runs.
draw(.22);
draw(.23);
assert.equal(draw(.23), canvasA, 'queued C keeps showing the interim canvas');
// B completes: C must be dispatched, not stranded.
const reqB = worker.messages.at(-1);
worker.reply({ id: reqB.id, values: fill(reqB, 123) });
assert.equal(worker.messages.length, 3, 'B completion dispatches queued C instead of stranding it');
const reqC = worker.messages.at(-1);
assert.equal(reqC.shape.edit.crop.left, .23, 'dispatched request is the newest edit');
worker.reply({ id: reqC.id, values: fill(reqC, 200) });
assert.equal(imageDisplayActivity(owner), null, 'queued C settles instead of spinning forever');
const canvasC = draw(.23);
assert.equal(firstByte(canvasC), 200, 'settled canvas shows C pixels, not a stale interim');
console.log('spinner queue: warm A→B→C keeps queued work and settles passed');
