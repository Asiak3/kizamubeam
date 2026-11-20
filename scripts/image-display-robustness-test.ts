import './core-fixtures-env';
import { SynchronousImageWorker } from './image-display-worker-fixture';
import { strict as assert } from 'node:assert';
import { addAsset, displayCanvas } from '../src/images';
import { ImageProcessingError } from '../src/imagePixels';
import { DEFAULT_ADJUST, defaultImageLayer, defaultLayer, imageOutput, type ImageShape, type Mat } from '../src/model';

const global = globalThis as any;
class TestImage {
  naturalWidth = 0;
  naturalHeight = 0;
  pixels = new Uint8ClampedArray();
  onload = () => {};
  set src(value: string) {
    const data = JSON.parse(value.slice(value.indexOf(',') + 1));
    this.naturalWidth = data.w; this.naturalHeight = data.h;
    this.pixels = new Uint8ClampedArray(data.rgba);
    queueMicrotask(() => this.onload());
  }
}
class TestCanvas {
  width = 0; height = 0;
  pixels = new Uint8ClampedArray();
  getContext() {
    return {
      drawImage: (image: TestImage) => {
        assert.equal(this.width, image.naturalWidth);
        assert.equal(this.height, image.naturalHeight);
        this.pixels = image.pixels.slice();
      },
      getImageData: () => ({ data: this.pixels.slice() }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (data: { data: Uint8ClampedArray }) => { this.pixels = data.data.slice(); },
    };
  }
}
global.Image = TestImage;
global.document.createElement = (tag: string) => {
  assert.equal(tag, 'canvas'); return new TestCanvas();
};

const layer = { ...defaultLayer(0), interval: 10, power: 80, minPower: 0, overscan: 0 };
const imgLayer = { ...defaultImageLayer(), dither: 'threshold' as const };
const output = imageOutput(layer, imgLayer);
const identity: Mat = [1, 0, 0, 1, 0, 0];
const edge = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => (i % w < w / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])).flat();
async function image(seed: number): Promise<ImageShape> {
  const w = 20 + seed, h = 8;
  const data = `data:image/test,${JSON.stringify({ w, h, rgba: edge(w, h) })}`;
  const asset = await addAsset(data);
  return { kind: 'image', asset: asset.id, w: 100, h: 40, pxW: w, pxH: h, adjust: { ...DEFAULT_ADJUST } };
}
const fullQuad = (s: ImageShape) => [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }];
let passed = 0, failed = 0;
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).stack}`); }
}

// Runs first: no display worker exists yet, so the broken constructor is used.
await test('unavailable worker surfaces a per-image ImageProcessingError, never a raw ReferenceError', async () => {
  const s = await image(99);
  const edited = { ...s, edit: { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } };
  const RealHook = (globalThis as any).__kizamubeamSyncDisplayWorker;
  (globalThis as any).__kizamubeamSyncDisplayWorker = () => { throw new ReferenceError('Worker is not defined'); };
  try {
    let first: unknown = 'threw';
    try { first = displayCanvas(edited, identity, output, true); }
    catch (e) { assert.fail(`first call must not throw, got ${(e as Error).constructor.name}: ${(e as Error).message}`); }
    assert.equal(first, null, 'no canvas while the display worker is unavailable');
    assert.throws(() => displayCanvas(edited, identity, output, true),
      (e: unknown) => e instanceof ImageProcessingError && (e as { code?: string }).code === 'display-unavailable');
  } finally {
    (globalThis as any).__kizamubeamSyncDisplayWorker = RealHook;
  }
});

await test('five distinct edited images do not evict and recompute each other', async () => {
  const shapes: ImageShape[] = [];
  for (let k = 0; k < 5; k++) {
    const s = await image(k);
    // Distinct crop per image so every cache key differs.
    shapes.push({ ...s, edit: { crop: { left: k * 0.02, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } });
  }
  const first = shapes.map((s) => displayCanvas(s, identity, output, true));
  for (const cv of first) assert.ok(cv, 'edited display resolves synchronously');
  const jobs = SynchronousImageWorker.processedJobs;
  const second = shapes.map((s) => displayCanvas(s, identity, output, true));
  for (let i = 0; i < first.length; i++) assert.equal(second[i], first[i], `image ${i} reuses its completed display`);
  assert.equal(SynchronousImageWorker.processedJobs, jobs, 'no worker recomputation on revisit');
});

console.log(failed ? `${failed} FAILED` : `display robustness: ${passed} passed`);
process.exitCode = failed ? 1 : 0;
