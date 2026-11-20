import './core-fixtures-env';
import { SynchronousImageWorker } from './image-display-worker-fixture';
import { strict as assert } from 'node:assert';
import { downsampleRgbaCalls } from '../src/imagePixels';
import { addAsset, displayCanvas, displayCanvasDraft, isReducedImageDisplay, outputGrid, processImage } from '../src/images';
import { imageDraftEdit } from '../src/editor/imageHandles';
import { DEFAULT_ADJUST, DITHER_MODES, defaultImageLayer, defaultLayer, imageOutput, type ImageShape, type Mat } from '../src/model';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc, newId, type Obj } from '../src/model';

const global = globalThis as any;
global.pipelineNative = false;
global.pipelineNativeCalls = [];
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
// Left half black, right half white: any warp moves the edge.
const edge = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => (i % w < w / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])).flat();
async function image(): Promise<ImageShape> {
  const data = `data:image/test,${JSON.stringify({ w: 20, h: 8, rgba: edge(20, 8) })}`;
  const asset = await addAsset(data);
  return { kind: 'image', asset: asset.id, w: 100, h: 40, pxW: 20, pxH: 8, adjust: { ...DEFAULT_ADJUST } };
}
function editor(objects: Obj[]): Editor {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 2, ox: 10, oy: 5 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: true, snapObjects: true, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    gridStep: 1, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  });
  (ed as any).doc.objs = [...objects];
  ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}
const pixelsOf = (cv: any) => [...cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data];
const fullQuad = (s: ImageShape) => [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }];
let passed = 0, failed = 0;
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).stack}`); }
}

await test('draft identity matches committed render exactly', async () => {
  const s = await image();
  const edit = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) };
  const draft = displayCanvasDraft(s, identity, output, edit as never)!;
  const committed = displayCanvas({ ...s, edit: edit as never }, identity, output, true)!;
  assert.equal(draft.width, 10); assert.equal(draft.height, 4);
  assert.deepEqual(pixelsOf(draft), pixelsOf(committed));
});

await test('perspective draft warps pixels, model untouched', async () => {
  const s = await image();
  const before = JSON.stringify(s);
  const o = { id: newId(), m: identity, layer: 0, shape: s } as unknown as Obj;
  const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'perspective');
  (ed as any).setImagePerspectiveCorner(0, { x: 40, y: 8 }, { snap: false });
  const edit = imageDraftEdit(ed, o.id)!;
  const warped = displayCanvasDraft(s, identity, output, edit)!;
  const plain = displayCanvasDraft(s, identity, output, { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never)!;
  assert.notDeepEqual(pixelsOf(warped), pixelsOf(plain));
  assert.equal(JSON.stringify(s), before);
  assert.equal((s as ImageShape).edit, undefined);
  (ed as any).cancelImageDraft();
});

await test('no stale cache: alternating edits each render correctly', async () => {
  const s = await image();
  const full = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never;
  const skew = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: [{ x: 40, y: 8 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }] } as never;
  const a = pixelsOf(displayCanvasDraft(s, identity, output, skew)!);
  const b = pixelsOf(displayCanvasDraft(s, identity, output, full)!);
  const a2 = pixelsOf(displayCanvasDraft(s, identity, output, skew)!);
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, a2);
});

await test('non-identity object matrix scales the draft grid', async () => {
  const s = await image();
  const full = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never;
  const cv = displayCanvasDraft(s, [2, 0, 0, 2, 0, 0], output, full)!;
  assert.equal(cv.width, 20); assert.equal(cv.height, 8);
});

await test('large idle draft retains output detail, invalid geometry throws ImageProcessingError', async () => {
  const s = await image();
  const full = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never;
  const big = displayCanvasDraft(s, [10, 0, 0, 10, 0, 0], { ...output, interval: 1 }, full)!;
  assert.equal(big.width, 1000); assert.equal(big.height, 400);
  const drag = displayCanvasDraft(s, [10, 0, 0, 10, 0, 0], { ...output, interval: 1 }, full, { dragging: true })!;
  assert.equal(drag.width, 512); assert.equal(drag.height, 205);
  assert.equal(isReducedImageDisplay(drag), true);
  const bad = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }] } as never;
  assert.throws(() => displayCanvasDraft(s, identity, output, bad), (e: any) => e?.name === 'ImageProcessingError');
});

await test('identical draft values reuse a bounded display cache across temporary shapes', async () => {
  const s = await image(), edit = { perspective: fullQuad(s) } as never;
  const a = displayCanvasDraft(s, identity, output, edit)!;
  assert.equal(displayCanvasDraft({ ...s }, [...identity], { ...output }, structuredClone(edit)), a);
  const changed = displayCanvasDraft(s, identity, { ...output, negative: true }, edit)!;
  assert.notEqual(changed, a);
  assert.equal(displayCanvasDraft(s, identity, output, edit), a);
  // More distinct grids than the bounded cache can retain must evict the oldest.
  for (let i = 2; i <= 10; i++) displayCanvasDraft(s, identity, { ...output, interval: i }, edit);
  assert.notEqual(displayCanvasDraft(s, identity, output, edit), a);
});
await test('committed edited display is bounded without reducing the output raster', async () => {
  const s = await image(); s.edit = { perspective: fullQuad(s) } as never;
  const L = { ...output, interval: .1 };
  const canvas = displayCanvas(s, identity, L, true)!;
  assert.equal(canvas.width, 1000); assert.equal(canvas.height, 400);
  assert.equal(processImage(s, L, 1000, 400)!.length, 400000);
});
await test('view density changes invalidate cache without exceeding validated job grid', async () => {
  const s = await image(); s.edit = { perspective: fullQuad(s) } as never;
  const L = { ...output, interval: .05 }, grid = outputGrid(s, identity, L.interval);
  const low = displayCanvas(s, identity, L, true, { zoom: 5, dpr: 1 })!;
  const high = displayCanvas(s, identity, L, true, { zoom: 5, dpr: 2 })!;
  assert.equal(low.width, 500); assert.equal(high.width, 1000);
  assert.notEqual(high, low);
  assert.equal(displayCanvas(s, identity, L, true, { zoom: 5, dpr: 2 }), high);
  const full = displayCanvas(s, identity, L, true, { zoom: 500, dpr: 2 })!;
  assert.equal(full.width, grid.cols); assert.equal(full.height, grid.rows);
  assert.equal(isReducedImageDisplay(full), false);
  assert.throws(() => displayCanvas(s, identity, { ...L, interval: .001 }, true, { zoom: 1, dragging: true }),
    (e: any) => e?.name === 'ImageProcessingError' && e?.code === 'output-too-large');
});
// Integrate source-pixel overlap independently of the display implementation.
function areaReference(src: Uint8ClampedArray, sw: number, sh: number, w: number, h: number) {
  const result: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const left = x * sw / w, right = (x + 1) * sw / w;
    const top = y * sh / h, bottom = (y + 1) * sh / h;
    let sum = 0;
    for (let yy = Math.floor(top); yy < Math.ceil(bottom); yy++) for (let xx = Math.floor(left); xx < Math.ceil(right); xx++) {
      sum += src[yy * sw + xx] * (Math.min(right, xx + 1) - Math.max(left, xx)) * (Math.min(bottom, yy + 1) - Math.max(top, yy));
    }
    result.push(sum / ((right - left) * (bottom - top)));
  }
  return result;
}

for (const [mode] of DITHER_MODES) {
  await test(`minified ${mode}: idle keeps full-job signal, dragging previews low-res`, async () => {
    const w = 101, h = 59;
    const rgba = Array.from({ length: w * h }, (_, i) => {
      const x = i % w, y = Math.floor(i / w);
      const value = (x % 2 ? 218 : 26) + ((x * 13 + y * 7) % 31);
      return [value, value, value, 255];
    }).flat();
    const asset = await addAsset(`data:image/test,${JSON.stringify({ w, h, rgba })}`);
    const s: ImageShape = { kind: 'image', asset: asset.id, w: 10.1, h: 5.9, pxW: w, pxH: h, adjust: { ...DEFAULT_ADJUST } };
    const edit = { crop: { left: .001, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never;
    const m: Mat = [1.1, .2, -.15, .9, 17, 13];
    const L = { ...output, interval: .075, dither: mode };
    const edited = { ...s, edit }, grid = outputGrid(edited, m, L.interval);
    const before = JSON.stringify(s), values = processImage(edited, L, grid.cols, grid.rows, m)!;
    for (const options of [{ zoom: 2, dpr: 1.5 }, { zoom: 3.3, dpr: 1.25 }]) {
      const draft = displayCanvasDraft(s, m, L, edit, options)!;
      const applied = displayCanvas(edited, m, L, true, options)!;
      const expected = areaReference(values, grid.cols, grid.rows, draft.width, draft.height);
      const actual = pixelsOf(draft).filter((_, i) => i % 4 === 0);
      const error = actual.reduce((sum, v, i) => sum + Math.abs(v - expected[i]), 0) / actual.length;
      assert.ok(error <= .51, `${mode}: full-job area-reference mean error ${error.toFixed(3)}`);
      assert.deepEqual(pixelsOf(applied), pixelsOf(draft));
      assert.equal(isReducedImageDisplay(draft), true);
    }
    // Live drag: synchronous low-res preview without any full job raster; releasing
    // (idle) upgrades the same edit to the full-job signal.
    const jobs = SynchronousImageWorker.processedJobs;
    const drag = displayCanvasDraft(s, m, L, edit, { zoom: 2, dpr: 1.5, dragging: true })!;
    assert.ok(drag, 'drag preview resolves synchronously and stays visible');
    assert.equal(isReducedImageDisplay(drag), true);
    assert.ok(Math.max(drag.width, drag.height) <= 512, 'drag preview stays low-res');
    assert.equal(SynchronousImageWorker.processedJobs, jobs, 'dragging never queues a full job raster');
    const idle = displayCanvasDraft(s, m, L, edit, { zoom: 2, dpr: 1.5 })!;
    const expected = areaReference(values, grid.cols, grid.rows, idle.width, idle.height);
    const actual = pixelsOf(idle).filter((_, i) => i % 4 === 0);
    const error = actual.reduce((sum, v, i) => sum + Math.abs(v - expected[i]), 0) / actual.length;
    assert.ok(error <= .51, `${mode}: upgraded idle mean error ${error.toFixed(3)}`);
    const applied = displayCanvas(edited, m, L, true, { zoom: 2, dpr: 1.5 })!;
    assert.deepEqual(pixelsOf(applied), pixelsOf(idle));
    assert.equal(JSON.stringify(s), before);
  });
}
await test('zoom and DPR reuse job-density pixels; option and affine changes invalidate them', async () => {
  const s = await image(); s.edit = { perspective: fullQuad(s) } as never;
  const L = { ...output, interval: .5 };
  displayCanvas(s, identity, L, true, { zoom: 1, dpr: 1 });
  let jobs = SynchronousImageWorker.processedJobs;
  displayCanvas(s, identity, L, true, { zoom: 1.25, dpr: 1.5 });
  assert.equal(SynchronousImageWorker.processedJobs, jobs, 'zoom reuses job-density worker pixels');
  displayCanvas(s, identity, { ...L, negative: true }, true, { zoom: 1.25, dpr: 1.5 });
  assert.ok(SynchronousImageWorker.processedJobs > jobs, 'changed output processes a fresh job raster');
  jobs = SynchronousImageWorker.processedJobs;
  displayCanvas(s, [1, .2, 0, 1, 17, 13], L, true, { zoom: 1.25, dpr: 1.5 });
  assert.ok(SynchronousImageWorker.processedJobs > jobs, 'changed linear affine processes a fresh job raster');
  for (let i = 1; i <= 5; i++) displayCanvas(s, identity, { ...L, threshold: i }, true, { zoom: 1 });
  jobs = SynchronousImageWorker.processedJobs;
  displayCanvas(s, identity, L, true, { zoom: 1.5 });
  assert.ok(SynchronousImageWorker.processedJobs > jobs, 'job raster entry limit evicts old edits/options');
});
await test('high-density idle and applied images do not lose detail to a cache-size cap', async () => {
  const s = await image();
  const edit = { crop: { left: 0, top: 0, right: 1, bottom: 1 } };
  const fine = { ...output, interval: 1 / 30 };
  const view = { zoom: 15, dpr: 2 };
  const draft = displayCanvasDraft(s, identity, fine, edit, view)!;
  assert.equal(draft.width, 3000);
  assert.equal(draft.height, 1200);
  const applied = displayCanvas({ ...s, edit }, identity, fine, true, view)!;
  assert.equal(applied, draft);
  assert.equal(isReducedImageDisplay(applied), false);
});

await test('drag on huge sources samples a cached mip once and stays visible', async () => {
  const w = 2000, h = 1500;
  const rgba = Array.from({ length: w * h }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    const value = (x % 2 ? 218 : 26) + ((x * 13 + y * 7) % 31);
    return [value, value, value, 255];
  }).flat();
  const asset = await addAsset(`data:image/test,${JSON.stringify({ w, h, rgba })}`);
  const s: ImageShape = { kind: 'image', asset: asset.id, w: 200, h: 150, pxW: w, pxH: h, adjust: { ...DEFAULT_ADJUST } };
  const before = JSON.stringify(s);
  const m: Mat = [1, 0, 0, 1, 0, 0];
  const L = { ...output, interval: .1, dither: 'threshold' as const };
  const callsBefore = downsampleRgbaCalls;
  const jobs = SynchronousImageWorker.processedJobs;
  const seen = new Set<string>();
  for (let k = 0; k < 5; k++) {
    const edit = { crop: { left: k * .02, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never;
    const drag = displayCanvasDraft(s, m, L, edit, { zoom: 2, dpr: 1.5, dragging: true })!;
    assert.ok(drag, `drag frame ${k} resolves synchronously`);
    assert.ok(Math.max(drag.width, drag.height) <= 512, 'drag preview stays low-res');
    assert.equal(isReducedImageDisplay(drag), true);
    seen.add([...pixelsOf(drag)].join(','));
  }
  assert.equal(downsampleRgbaCalls - callsBefore, 1, 'mip built once per asset and reused across drags');
  assert.equal(SynchronousImageWorker.processedJobs, jobs, 'dragging never queues a full job raster');
  assert.ok(seen.size > 1, 'different crops render different previews');
  assert.equal(JSON.stringify(s), before);
});

await test('mip drag preserves smooth tones against the full-job reference', async () => {
  const w = 2000, h = 1500;
  const rgba = Array.from({ length: w * h }, (_, i) => {
    const x = i % w, value = Math.round((255 * x) / (w - 1));
    return [value, value, value, 255];
  }).flat();
  const asset = await addAsset(`data:image/test,${JSON.stringify({ w, h, rgba })}`);
  const s: ImageShape = { kind: 'image', asset: asset.id, w: 200, h: 150, pxW: w, pxH: h, adjust: { ...DEFAULT_ADJUST } };
  const edit = { crop: { left: 0, top: 0, right: 1, bottom: 1 }, perspective: fullQuad(s) } as never;
  const m: Mat = [1, 0, 0, 1, 0, 0];
  const L = { ...output, interval: .1, dither: 'grayscale' as const };
  const edited = { ...s, edit }, grid = outputGrid(edited, m, L.interval);
  const values = processImage(edited, L, grid.cols, grid.rows, m)!;
  const drag = displayCanvasDraft(s, m, L, edit, { zoom: 2, dpr: 1.5, dragging: true })!;
  const expected = areaReference(values, grid.cols, grid.rows, drag.width, drag.height);
  const actual = pixelsOf(drag).filter((_, i) => i % 4 === 0);
  const error = actual.reduce((sum, v, i) => sum + Math.abs(v - expected[i]), 0) / actual.length;
  assert.ok(error <= 6, `mip drag mean error ${error.toFixed(3)}`);
});

console.log(failed ? `${failed} FAILED` : `draft render: ${passed} passed`);
process.exitCode = failed ? 1 : 0;
