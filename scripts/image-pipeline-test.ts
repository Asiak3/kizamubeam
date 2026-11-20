import './core-fixtures-env';
import './image-display-worker-fixture';
import { strict as assert } from 'node:assert';
import { addAsset, adjustedGray, assetUrl, displayCanvas, imageRasterGeometry, nativeScanLines, outputGrid, processedPng, processImage, processImageAsync } from '../src/images';
import { buildJob, estimate, MOVE_CUT, MOVE_ENGRAVE, newDevice, sameMoves, scanLines, writeGCode } from '../src/gcode';
import { apply, inv, mul, DEFAULT_ADJUST, defaultImageLayer, defaultLayer, imageOutput, isGrayMode, loadDoc, type ImageOutput, type ImageShape, type Mat, type Pt } from '../src/model';
import { checkDesign, DEFAULT_CHECK } from '../src/check';
import { resolveImageEdits } from '../src/imageEdits';
import { resolveImageContour } from '../src/imageContour';
import { resolveImageCutPath } from '../src/imageCut';

const global = globalThis as any;
global.pipelineNative = false;
global.pipelineNativeCalls = [];
let reads = 0;
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
  white = false;
  style = {};
  getContext() {
    return {
      fillStyle: '',
      fillRect: () => { this.white = true; },
      drawImage: (image: TestImage) => {
        assert.equal(this.width, image.naturalWidth);
        assert.equal(this.height, image.naturalHeight);
        this.pixels = image.pixels.slice();
        if (this.white) for (let i = 0; i < this.pixels.length; i += 4) {
          const alpha = this.pixels[i + 3] / 255;
          for (let k = 0; k < 3; k++) this.pixels[i + k] = this.pixels[i + k] * alpha + 255 * (1 - alpha);
          this.pixels[i + 3] = 255;
        }
      },
      getImageData: () => { reads++; return { data: this.pixels.slice() }; },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (data: { data: Uint8ClampedArray }) => { this.pixels = data.data.slice(); },
    };
  }
  toDataURL() { return JSON.stringify({ w: this.width, h: this.height, rgba: [...this.pixels] }); }
}
global.Image = TestImage;
global.document.createElement = (tag: string) => {
  assert.equal(tag, 'canvas'); return new TestCanvas();
};

const identity: Mat = [1, 0, 0, 1, 0, 0];
const layer = { ...defaultLayer(0), interval: 10, power: 80, minPower: 0, overscan: 0 };
const imgLayer = { ...defaultImageLayer(), dither: 'threshold' as const };
const output = imageOutput(layer, imgLayer);
const black = (w: number, h: number, alpha = 255) => Array.from({ length: w * h }, () => [0, 0, 0, alpha]).flat();
async function image(rgba = black(10, 4), w = 10, h = 4): Promise<ImageShape> {
  const data = `data:image/test,${JSON.stringify({ w, h, rgba })}`;
  const asset = await addAsset(data);
  return { kind: 'image', asset: asset.id, w: 100, h: 40, pxW: w, pxH: h, adjust: { ...DEFAULT_ADJUST } };
}
const crop = (s: ImageShape): ImageShape => ({ ...s, edit: { crop: { left: .1, top: 0, right: .9, bottom: 1 } } });
async function job(s: ImageShape, m: Mat = [1, 0, 0, 1, 30, 20], options = {}) {
  const doc = loadDoc({ bed: { w: 500, h: 500 }, objs: [{ id: 1, layer: 0, m, shape: s }], layers: {} });
  return buildJob({ doc, layer: () => layer, imgLayer: () => imgLayer, device: { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' }, ...options });
}
const errorCode = (code: string) => (error: any) => error?.name === 'ImageProcessingError' && error.code === code;
// Full bounding-grid oracle: retain the pre-optimization iteration and run
// arithmetic, with P1's two-polygon clipping, independently of scanLines.
function fullGridScan(v: Uint8ClampedArray, w: number, h: number, L: ImageOutput, cols: number, rows: number,
  M: Mat, IM: Mat, edited?: Parameters<typeof scanLines>[9]) {
  const quad = (edited?.quad ?? [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]).map(p => apply(M, p.x, p.y));
  const clipQuad = edited?.clipQuad?.map(p => apply(M, p.x, p.y));
  const x0 = Math.min(...quad.map(p => p.x)), x1 = Math.max(...quad.map(p => p.x));
  const y0 = Math.min(...quad.map(p => p.y)), y1 = Math.max(...quad.map(p => p.y));
  const aligned = Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9;
  const dx = aligned ? (x1 - x0) / cols : L.interval, dy = aligned ? (y1 - y0) / rows : L.interval;
  const nx = Math.max(1, Math.round((x1 - x0) / dx)), ny = Math.max(1, Math.round((y1 - y0) / dy));
  const spanAt = (polygon: Pt[], y: number): [number, number] | null => {
    const xs: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) xs.push(a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y)));
    }
    return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
  };
  const result: { y: number; runs: [number, number, number][] }[] = [];
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + .5) * dy;
    let span = edited ? spanAt(quad, y) : null;
    if (clipQuad && span) {
      const clip = spanAt(clipQuad, y);
      span = clip ? [Math.max(span[0], clip[0]), Math.min(span[1], clip[1])] : null;
      if (span && span[0] >= span[1]) span = null;
    }
    const runs: [number, number, number][] = [];
    let cur: [number, number, number] | null = null;
    for (let k = 0; k < nx; k++) {
      const x = x0 + (k + .5) * dx, q = apply(IM, x, y);
      const c = Math.floor(((q.x - (edited?.bounds.x ?? 0)) / (edited?.bounds.width ?? w)) * cols);
      const r = Math.floor(((q.y - (edited?.bounds.y ?? 0)) / (edited?.bounds.height ?? h)) * rows);
      let s = 0;
      if (c >= 0 && c < cols && r >= 0 && r < rows && (!edited || (span && x >= span[0] && x <= span[1]))) {
        const val = v[r * cols + c], pmax = L.power / 100, pmin = Math.min(L.minPower, L.power) / 100;
        s = isGrayMode(L.dither) ? (val >= 255 ? 0 : Math.round((pmin + (pmax - pmin) * (1 - val / 255)) * 1000) / 1000)
          : (val < 128 ? pmax : 0);
      }
      const a = x0 + k * dx, b = a + dx;
      if (cur && cur[2] === s && Math.abs(cur[1] - a) < 1e-9) cur[1] = b;
      else { if (cur && cur[2] > 0) runs.push(cur); cur = [a, b, s]; }
    }
    if (cur && cur[2] > 0) runs.push(cur);
    result.push({ y, runs: edited ? runs.flatMap(([a, b, s]): [number, number, number][] => {
      if (!span) return [];
      const lo = Math.max(a, span[0]), hi = Math.min(b, span[1]);
      return hi > lo ? [[lo, hi, s]] : [];
    }) : runs });
  }
  return result;
}
let passed = 0, failed = 0;
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${String((e as Error).stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-pipeline-bundle>')}`); }
}

await test('legacy exact processing, alpha semantics and cap remain unchanged', async () => {
  const s = await image([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 128], 4, 1);
  assert.deepEqual([...processImage(s, { ...output, dither: 'grayscale' }, 4, 1)!], [0, 255, 255, 127]);
  assert.deepEqual(outputGrid(s, identity, 10), { cols: 10, rows: 4, capped: false });
  assert.equal(outputGrid(s, identity, .0001).capped, true);
  const j = await job(await image());
  assert.deepEqual(j.bounds, { x0: 30, x1: 130, y0: 440, y1: 480 });
  const segments = [];
  for (let i = 1; i < j.moves.n; i++) if (j.moves.s[i] > 0) {
    segments.push([j.moves.x[i - 1], j.moves.y[i - 1], j.moves.x[i], j.moves.y[i], j.moves.s[i]]);
  }
  const power = Math.fround(.8); // Moves stores power as Float32, unchanged from legacy.
  assert.deepEqual(segments, [[30, 445, 130, 445, power], [130, 455, 30, 455, power], [30, 465, 130, 465, power], [130, 475, 30, 475, power]]);
});
await test('crop preserves physical width 80 of 100, grid density and job coordinates', async () => {
  const s = crop(await image());
  assert.deepEqual(outputGrid(s, identity, 10), { cols: 8, rows: 4, capped: false });
  const j = await job(s);
  assert.deepEqual(j.bounds, { x0: 40, x1: 120, y0: 440, y1: 480 });
  const mv = j.moves;
  let burns = 0;
  for (let i = 0; i < mv.n; i++) if (mv.s[i] > 0) {
    burns++; assert.equal(mv.cls[i], MOVE_ENGRAVE); assert.equal(mv.sub[i], -1);
    assert.ok(mv.x[i] >= 40 && mv.x[i] <= 120);
    assert.ok(mv.x[i - 1] >= 40 && mv.x[i - 1] <= 120);
  }
  assert.equal(burns, 4);
});
await test('crop samples original content, caches original RGBA, does not mutate inputs', async () => {
  const s = crop(await image(Array.from({ length: 40 }, (_, i) => [i % 10 * 25, i % 10 * 25, i % 10 * 25, 255]).flat()));
  const before = JSON.stringify(s), url = assetUrl(s.asset), count = reads;
  const g = adjustedGray(s, 8, 4)!;
  assert.ok(Math.abs(g[0] - 25) < .001); assert.ok(Math.abs(g[7] - 200) < .001);
  s.edit!.crop = { left: .2, top: 0, right: .8, bottom: 1 };
  assert.ok(Math.abs(adjustedGray(s, 6, 4)![0] - 50) < .001);
  assert.equal(reads - count, 1);
  s.edit!.crop = { left: .1, top: 0, right: .9, bottom: 1 };
  processImage(s, output, 8, 4);
  assert.equal(JSON.stringify(s), before); assert.equal(assetUrl(s.asset), url);
});
await test('perspective exterior stays off after negative, sharpening and every dither', async () => {
  const s = await image(Array(40 * 4).fill(255));
  s.edit = { perspective: [{ x: 30, y: 0 }, { x: 100, y: 10 }, { x: 75, y: 40 }, { x: 0, y: 30 }] };
  s.adjust = { ...DEFAULT_ADJUST, sharpen: 200 };
  const resolved = resolveImageEdits(s); assert.ok(resolved.ok);
  const gray = adjustedGray(s, 20, 8, true)!;
  for (const dither of ['threshold', 'ordered', 'atkinson', 'floyd', 'stucki', 'jarvis', 'newsprint', 'halftone', 'sketch', 'grayscale'] as const) {
    const v = processImage(s, { ...output, dither, negative: true }, 20, 8)!;
    let exterior = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 20; x++) {
      const p = resolved.geometry.localToSource({ x: (x + .5) * 5, y: (y + .5) * 5 });
      if (!p || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        exterior++; assert.equal(v[y * 20 + x], 255, dither); assert.equal(gray[y * 20 + x], 255);
      }
    }
    assert.ok(exterior > 0);
    // Sketch extracts edges, so a uniform interior is intentionally blank.
    if (dither !== 'sketch') assert.ok(v.some(value => value < 128), `${dither}: visible interior must engrave`);
  }
});
await test('transparent interior retains legacy negative behavior, exterior remains off', async () => {
  const s = crop(await image(black(10, 4, 0)));
  assert.ok([...processImage(s, { ...output, negative: true }, 8, 4)!].every(v => v === 0));
});
await test('perspective under nonidentity affine clips whole powered segments to visible polygon', async () => {
  const s = await image();
  s.edit = { crop: { left: .1, top: .1, right: .9, bottom: .9 }, perspective: [{ x: 30, y: -10 }, { x: 110, y: 5 }, { x: 75, y: 60 }, { x: -10, y: 30 }] };
  const m: Mat = [1.2, .3, -.4, .9, 110, 80];
  const resolved = resolveImageEdits(s); assert.ok(resolved.ok);
  const quad = resolved.quad.map(p => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: 500 - (m[1] * p.x + m[3] * p.y + m[5]) }));
  const j = await job(s, m);
  assert.deepEqual(j.bounds, { x0: Math.min(...quad.map(p => p.x)), x1: Math.max(...quad.map(p => p.x)), y0: Math.min(...quad.map(p => p.y)), y1: Math.max(...quad.map(p => p.y)) });
  const inside = (x: number, y: number) => {
    const signs = quad.map((p, i) => { const b = quad[(i + 1) % 4]; return (b.x - p.x) * (y - p.y) - (b.y - p.y) * (x - p.x); });
    return signs.every(s => s >= -1e-7) || signs.every(s => s <= 1e-7);
  };
  let count = 0;
  for (let i = 1; i < j.moves.n; i++) if (j.moves.s[i] > 0) {
    count++; assert.ok(inside(j.moves.x[i - 1], j.moves.y[i - 1])); assert.ok(inside(j.moves.x[i], j.moves.y[i]));
  }
  assert.ok(count > 0);
});
await test('native-present edited async/scan fallback and PNG use TS edited source only', async () => {
  global.pipelineNative = true;
  const s = crop(await image(black(12, 4), 12, 4));
  assert.ok(global.pipelineNativeCalls.includes('image_register'));
  global.pipelineNativeCalls.length = 0;
  assert.equal(await nativeScanLines(s, output, 8, 4, identity, identity), null);
  assert.deepEqual(await processImageAsync(s, output, 8, 4), processImage(s, output, 8, 4));
  assert.deepEqual((await job(s)).bounds, { x0: 40, x1: 120, y0: 440, y1: 480 });
  const png = JSON.parse((await processedPng(s, identity, output))!);
  assert.equal(png.w, 8); assert.equal(png.h, 4);
  assert.deepEqual(global.pipelineNativeCalls, []);
  global.pipelineNative = false;
});
await test('perspectiveFirst clips whole powered segments to both polygons under crop, reflection and rotation', async () => {
  const r = Math.SQRT1_2;
  const transforms: Mat[] = [[1, 0, 0, 1, 30, 20], [2, 0, 0, 1, 30, 20],
    [-2, 0, 0, 1, 40, 20], [1.2, .3, -.4, .9, 30, 20], [r, r, -r, r, 30, 20]];
  const perspectives = [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
    // Full crop rectangle intersected with this diamond has eight vertices.
    [{ x: 2, y: -1 }, { x: 5, y: 1 }, { x: 2, y: 3 }, { x: -1, y: 1 }]];
  let forward = 0, reverse = 0;
  const failures: string[] = [];
  for (const perspective of perspectives) for (const cropBox of [undefined, { left: .1, top: .1, right: .9, bottom: .9 }]) {
    for (const m of transforms) {
      const s = { ...await image(black(4, 2), 4, 2), w: 4, h: 2,
        edit: { perspective, order: 'perspectiveFirst' as const, ...(cropBox ? { crop: cropBox } : {}) } };
      const local = resolveImageEdits(s); assert.ok(local.ok);
      const toOutput = (p: { x: number; y: number }) => ({ x: m[0] * p.x + m[2] * p.y + m[4],
        y: 500 - (m[1] * p.x + m[3] * p.y + m[5]) });
      const polygons = [perspective.map(toOutput), local.quad.map(toOutput)];
      const j = await job(s, m, { layer: () => ({ ...layer, interval: 1.2, bidirectional: true }) });
      let powered = 0;
      for (let i = 1; i < j.moves.n; i++) if (j.moves.s[i] > 0) {
        powered++;
        if (j.moves.x[i] > j.moves.x[i - 1]) forward++; else reverse++;
        for (const k of [i - 1, i]) for (const polygon of polygons) {
          const signs = polygon.map((a, n) => { const b = polygon[(n + 1) % polygon.length];
            return (b.x - a.x) * (j.moves.y[k] - a.y) - (b.y - a.y) * (j.moves.x[k] - a.x); });
          if (!(signs.every(v => v >= -1e-7) || signs.every(v => v <= 1e-7))) {
            failures.push(`crop=${!!cropBox}, affine=${m}, endpoint=${j.moves.x[k]},${j.moves.y[k]}`);
          }
        }
      }
      assert.ok(powered > 0, `fixture must engrave: ${m}`);
    }
  }
  assert.ok(forward > 0 && reverse > 0, 'exercise both powered directions');
  assert.deepEqual(failures, [], 'powered endpoints must stay inside crop AND full perspective polygon');
});
await test('span-limited scans retain exact full-grid output and reduce thin rotated scan work', async () => {
  const s = { ...await image(black(8, 4), 8, 4), w: 8, h: 4 };
  const r = Math.SQRT1_2;
  const transforms: Mat[] = [identity, [2, 0, 0, -1.5, 13.2, -7.1], [-1.2, .3, -.4, .9, 23, -14],
    [r, r, -r, r, -2.7, 11.9]];
  const perspective = [{ x: 1, y: -1 }, { x: 10, y: 1 }, { x: 7, y: 5 }, { x: -2, y: 3 }] as const;
  const edits: ImageShape['edit'][] = [undefined, {}, { crop: { left: .13, top: .17, right: .91, bottom: .83 } },
    { perspective }, { perspective, order: 'perspectiveFirst', crop: { left: .13, top: .17, right: .91, bottom: .83 } }];
  let comparisons = 0;
  for (const edit of edits) for (const m of transforms) for (const interval of [.7, 1.2]) for (const dither of ['threshold', 'grayscale'] as const) {
    const shape = { ...s, ...(edit ? { edit } : {}) };
    const geometry = edit ? imageRasterGeometry(shape) : undefined;
    const clipQuad = geometry?.order === 'perspectiveFirst' ? perspective.map(p => ({ ...p })) : undefined;
    const edited = geometry && { ...geometry, clipQuad };
    const { cols, rows } = outputGrid(shape, m, interval);
    const v = Uint8ClampedArray.from({ length: cols * rows }, (_, i) => [0, 31, 127, 128, 221, 255][(i * 7 + Math.floor(i / cols)) % 6]);
    const L = { ...output, dither, interval, power: 73, minPower: 17 };
    const im = inv(m);
    assert.deepEqual(scanLines(v, s.w, s.h, L, cols, rows, m, im, edited),
      fullGridScan(v, s.w, s.h, L, cols, rows, m, im, edited), `edit=${JSON.stringify(edit)}, affine=${m}, interval=${interval}, dither=${dither}`);
    comparisons++;
  }
  const thin = { ...s, w: 300, h: 1, edit: {} }, m: Mat = [r, r, -r, r, 12, -9];
  const { cols, rows } = outputGrid(thin, m, 1), im = inv(m), geometry = imageRasterGeometry(thin);
  const v = new Uint8ClampedArray(cols * rows), L = { ...output, interval: 1 };
  let referenceReads = 0, optimizedReads = 0;
  const counted = (read: () => void) => new Proxy(im, { get(target, key, receiver) {
    if (typeof key === 'string' && /^[0-5]$/.test(key)) read();
    return Reflect.get(target, key, receiver);
  } });
  const expected = fullGridScan(v, 300, 1, L, cols, rows, m, counted(() => referenceReads++), geometry);
  const actual = scanLines(v, 300, 1, L, cols, rows, m, counted(() => optimizedReads++), geometry);
  assert.deepEqual(actual, expected);
  console.log(`scan equivalence: ${comparisons + 1} exact comparisons; affine reads ${referenceReads} -> ${optimizedReads}`);
  assert.ok(optimizedReads < referenceReads / 10, 'skip empty bounding-box columns without changing grid phase');
  assert.throws(() => scanLines(v, 300, 1, L, cols, rows, m, im,
    { ...geometry, clipQuad: [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }), errorCode('geometry'));
});
await test('parking uses edited visible quad, including nested groups, without mutating document', async () => {
  const s = await image();
  s.edit = { perspective: [{ x: -200, y: 0 }, { x: -100, y: 0 }, { x: -100, y: 40 }, { x: -200, y: 40 }] };
  const doc = loadDoc({ bed: { w: 500, h: 500 }, layers: {}, objs: [
    { id: 1, layer: 0, m: [1, 0, 0, 1, 50, 50], shape: { kind: 'rect', w: 5, h: 5, r: 0 } },
    { id: 2, layer: 0, m: [1, 0, 0, 1, 600, 100], shape: { kind: 'group', children: [
      { id: 3, layer: 0, m: identity, shape: s },
    ] } },
  ] });
  const before = JSON.stringify(doc);
  const inp = { doc, layer: () => layer, imgLayer: () => imgLayer, device: { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' as const } };
  const j = await buildJob(inp);
  assert.ok(j.moves.cls.subarray(0, j.moves.n).includes(MOVE_ENGRAVE));
  assert.equal(j.bounds!.x1, 500);
  assert.equal(JSON.stringify(doc), before);
  s.edit.perspective = [{ x: 700, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 40 }, { x: 700, y: 40 }];
  // loadDoc retains the image object in this fixture, but replace explicitly to
  // ensure the test exercises the document and not incidental loader aliasing.
  (doc.objs[1].shape as { children: any[] }).children[0].shape = s;
  const parked = await buildJob(inp);
  assert.ok(!parked.moves.cls.subarray(0, parked.moves.n).includes(MOVE_ENGRAVE));
});
await test('edited preview/current job share bounds, offset and scan positions under affine transform', async () => {
  const s = crop(await image());
  const m: Mat = [1.3, .25, -.2, .8, 100, 60];
  const options = { device: { ...newDevice({ fw: 'grbl' }), startFrom: 'current', jobOrigin: 6 }, position: { x: 31, y: 47 } };
  const preview = await job(s, m, { ...options, forPreview: true });
  const real = await job(s, m, options);
  assert.ok(sameMoves(preview.moves, real.moves, real.offset));
  assert.deepEqual(preview.bounds, { x0: real.bounds!.x0 - real.offset.x, x1: real.bounds!.x1 - real.offset.x,
    y0: real.bounds!.y0 - real.offset.y, y1: real.bounds!.y1 - real.offset.y });
});
await test('edited images retain per-pass Z, air and engraving metadata', async () => {
  const s = crop(await image());
  const passLayer = { ...layer, passes: 2, zOffset: 3, zStep: -1, air: true };
  const j = await job(s, undefined, { layer: () => passLayer,
    device: { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute', zAxis: true } });
  const powers = [];
  for (let i = 0; i < j.moves.n; i++) if (j.moves.s[i] > 0) {
    powers.push(j.moves.z[i]); assert.equal(j.moves.cls[i], MOVE_ENGRAVE); assert.equal(j.moves.sub[i], -1);
  }
  assert.deepEqual(powers, [3, 3, 3, 3, 2, 2, 2, 2]);
  assert.deepEqual(j.air, [0]);
});
await test('edit invalidation recalculates cached display (placement remains out of scope)', async () => {
  const s = crop(await image());
  const first = displayCanvas(s, identity, output, true);
  s.edit = { crop: { left: .2, top: 0, right: 1, bottom: 1 } };
  assert.notEqual(displayCanvas(s, identity, output, true), first);
});
await test('edited invalid geometry and strict cap failures propagate, including native-present job', async () => {
  const s = crop(await image());
  assert.throws(() => outputGrid(s, identity, .0001), errorCode('output-too-large'));
  assert.throws(() => outputGrid(s, [1, 1, 1, 1, 0, 0], 10), errorCode('invalid-grid'));
  assert.throws(() => outputGrid(s, identity, 0), errorCode('invalid-grid'));
  assert.throws(() => processImage(s, output, 16_000_001, 1), errorCode('output-too-large'));
  await assert.rejects(processImageAsync(s, output, 16_000_001, 1), errorCode('output-too-large'));
  global.pipelineNative = true;
  await assert.rejects(job(s, [10000, 0, 0, 10000, 0, 0]), errorCode('output-too-large'));
  const invalid = { ...s, edit: { crop: { left: .9, top: 0, right: .1, bottom: 1 } } };
  assert.throws(() => outputGrid(invalid, identity, 10), errorCode('geometry'));
  await assert.rejects(job(invalid), errorCode('geometry'));
  await assert.rejects(processImageAsync({ ...s, asset: 'missing' }, output, 8, 4), errorCode('asset-unavailable'));
  await assert.rejects(processImageAsync({ ...s, pxW: 99 }, output, 8, 4), errorCode('source-dimensions'));
  global.pipelineNative = false;
});
await test('rounded source sampling uses final world millimetres without changing original pixels', async () => {
  const s = { ...await image(black(100, 40), 100, 40), edit: { cornerRadii: [10, 10, 10, 10] } };
  const before = JSON.stringify(s);
  const plain = processImage(s, output, 100, 40)!;
  const scaled = processImage(s, output, 100, 40, [2, 0, 0, 1, 13, 7])!;
  assert.equal(plain[103], 255, 'identity corner is excluded');
  assert.equal(scaled[103], 0, 'world radius stays 10mm rather than stretching to 20mm');
  assert.equal(scaled[0], 255);
  assert.equal(scaled[2050], 0);
  assert.equal(JSON.stringify(s), before);
});
await test('rounded actual job powered endpoints stay within exact tangent circles under affine transforms', async () => {
  const s = { ...await image(), edit: { cornerRadii: [12, 7, 10, 4] } };
  for (const m of [[2, 0, 0, 1, 30, 20], [1, .3, .7, 1, 30, 20], [-1, .2, .1, 1, 200, 20]] as Mat[]) {
    const boundary = resolveImageContour(s, m); assert.ok(boundary.ok);
    const built = await job(s, m, { layer: () => ({ ...layer, interval: 2 }) });
    let count = 0;
    for (let i = 0; i < built.moves.n; i++) if (built.moves.s[i] > 0) {
      count++;
      for (const k of [i - 1, i]) {
        const p = { x: k < 0 ? built.moves.x0 : built.moves.x[k],
          y: 500 - (k < 0 ? built.moves.y0 : built.moves.y[k]) };
        assert.ok(boundary.contour.contains(p), `powered endpoint outside rounding: ${JSON.stringify({ m, p })}`);
      }
    }
    assert.ok(count > 0);
  }
});
// ---- image cut-contour slice: GCode + checkDesign ----
type CutLink = { mode: 'boundary' | 'contour'; contourId?: number };
const cutImg = (over: Record<string, unknown> = {}): any => ({
  ...imgLayer, cut: { output: true, speed: 160, power: 70, minPower: 0, passes: 1,
    kerf: 0, zOffset: 0, zStep: 0, air: false, ...over },
});
// Cut settings live on the image layer (ImageLayer.cut); the link is on the image shape.
const withLink = (s: ImageShape, link: CutLink): ImageShape => ({ ...s, cut: link }) as ImageShape;
const lineLayer = { ...layer, mode: 'line' as const };
const pathObj = (nodes: Pt[], closed: boolean): any => ({ kind: 'path', subs: [{ nodes, closed }] });
const square = (x: number, y: number, w: number, h: number) => pathObj(
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
const outPt = (p: Pt): Pt => ({ x: p.x, y: 500 - p.y });
const onPolygon = (p: Pt, pts: Pt[], tol = 1e-5): boolean => pts.some((a, k) => {
  const b = pts[(k + 1) % pts.length];
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.abs(cross) <= len * tol + 1e-9
    && p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol
    && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;
});
const jobObjs = async (objs: any[], opt: any = {}, L: any = lineLayer, IL: any = imgLayer) => {
  const doc = loadDoc({ bed: { w: 500, h: 500 }, objs, layers: {} });
  return buildJob({ doc, layer: () => L, imgLayer: () => IL,
    device: { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' }, ...opt });
};

await test('legacy image job without cut fields stays byte-identical in lines, order and values', async () => {
  const s = await image();
  const m: Mat = [1.3, .2, -.1, .9, 40, 30];
  const plain = await job(s, m);
  const none = await job(s, m, { imgLayer: () => ({ ...imgLayer, output: false }) });
  assert.ok(sameMoves(plain.moves, none.moves, { x: 0, y: 0 }));
  const d = { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' as const };
  assert.deepEqual(writeGCode(plain, d, estimate(plain.moves, d), 'KZB', true).lines,
    writeGCode(none, d, estimate(none.moves, d), 'KZB', true).lines);
  assert.ok([...plain.moves.sub.slice(0, plain.moves.n)].every((v) => v === -1));
});

await test('boundary cut follows crop, perspective and rounding under non-identity transform', async () => {
  const s: ImageShape = { ...await image(black(20, 12), 20, 12), w: 100, h: 60,
    edit: { crop: { left: .1, top: .1, right: .9, bottom: .9 },
      perspective: [{ x: 5, y: -2 }, { x: 95, y: 3 }, { x: 80, y: 58 }, { x: -3, y: 50 }],
      cornerRadii: [10, 6, 8, 4] } };
  const m: Mat = [1.3, .25, -.2, .85, 90, 60];
  const boundary = resolveImageContour(s, m); assert.ok(boundary.ok);
  assert.ok(boundary.contour.corners.some((c) => c.radius > 0), 'fixture must exercise rounding');
  const j = await job(withLink(s, { mode: 'boundary' }), m, { imgLayer: () => cutImg(), layer: () => lineLayer });
  const cutPath = resolveImageCutPath({ id: 1, layer: 0, m, shape: s } as any, m, () => undefined);
  assert.ok(cutPath.ok);
  const expected = cutPath.polygon.map(outPt);
  assert.ok(expected.length > boundary.contour.polygon.length, 'gerundeter Pfad muss Bogenpunkte enthalten');
  let cuts = 0;
  for (let i = 0; i < j.moves.n; i++) if (j.moves.sub[i] === -2 && j.moves.s[i] > 0) {
    cuts++;
    for (const k of [i - 1, i]) {
      const p = { x: k < 0 ? j.moves.x0 : j.moves.x[k], y: k < 0 ? j.moves.y0 : j.moves.y[k] };
      assert.ok(onPolygon(p, expected), `cut endpoint off resolved crop/perspective boundary: ${JSON.stringify(p)}`);
    }
  }
  assert.ok(cuts > 0);
});

await test('assigned contour cut follows move/scale/perspective but not the image crop', async () => {
  const world: Mat = [1.5, .2, -.1, 1, 70, 50];
  const s = withLink({ ...await image(black(10, 4), 10, 4), w: 100, h: 40,
    edit: { crop: { left: .1, top: 0, right: .9, bottom: 1 },
      perspective: [{ x: 0, y: 0 }, { x: 100, y: 4 }, { x: 92, y: 40 }, { x: 6, y: 36 }] } },
  { mode: 'contour', contourId: 2 });
  // Stored contour nodes are original-image-local mm; crop never enters the mapping.
  const nodes = [{ x: 15, y: 6 }, { x: 85, y: 6 }, { x: 85, y: 34 }, { x: 15, y: 34 }];
  const contour = pathObj(nodes, true);
  const objs = [{ id: 1, layer: 0, m: world, shape: s },
    { id: 2, layer: 0, m: identity, shape: contour, noLaser: true }];
  const j = await jobObjs(objs, {}, lineLayer, cutImg());
  const resolved = resolveImageEdits(s); assert.ok(resolved.ok);
  const expected = nodes.map((p) => {
    const local = resolved.geometry.sourceToLocal({ x: p.x / s.w, y: p.y / s.h })!;
    return outPt(apply(world, local.x, local.y));
  });
  const cropped = resolveImageContour(s, world); assert.ok(cropped.ok);
  let cuts = 0;
  for (let i = 0; i < j.moves.n; i++) if (j.moves.sub[i] === -2 && j.moves.s[i] > 0) {
    cuts++;
    const p = { x: j.moves.x[i], y: j.moves.y[i] };
    assert.ok(onPolygon(p, expected), `assigned cut off perspective-mapped contour: ${JSON.stringify(p)}`);
    assert.ok(!onPolygon(p, cropped.contour.polygon.map(outPt), 1e-3), 'assigned cut must not follow the crop');
  }
  assert.equal(cuts, 4);
  assert.ok(![...j.moves.cls.slice(0, j.moves.n)].some((c, k) => k >= 0 && c === MOVE_CUT && j.moves.sub[k] === -1),
    'linked contour must not be cut twice as a vector');
});

await test('missing and dangling assigned contours block the job and surface as checkDesign errors', async () => {
  await assert.rejects(job(withLink(await image(), { mode: 'contour', contourId: 999 }), undefined,
    { imgLayer: () => cutImg(), layer: () => lineLayer }));
  await assert.rejects(job(withLink(await image(), { mode: 'contour' }), undefined,
    { imgLayer: () => cutImg(), layer: () => lineLayer }));
  // Ohne Link bleibt der Grenzmodus gültig: kein Rechteck-Ersatz, aber eine echte Kontur.
  const plainCut = await job(await image(), undefined, { imgLayer: () => cutImg(), layer: () => lineLayer });
  assert.ok([...plainCut.moves.sub.slice(0, plainCut.moves.n)].includes(-2));
  const bad = { id: 1, layer: 0, m: identity, shape: withLink(await image(), { mode: 'contour', contourId: 999 }) };
  const issues = checkDesign({ objs: [bad], layer: () => ({ ...lineLayer, img: cutImg() }),
    bed: { w: 500, h: 500 }, settings: { ...DEFAULT_CHECK } });
  assert.ok(issues.some((x) => x.level === 'error' && x.kind === 'image'), 'missing contour must be a check error');
});

await test('open and self-crossing assigned contours block the job', async () => {
  const shapes = [
    pathObj([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false),
    pathObj([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }], true),
  ];
  for (const shape of shapes) {
    const objs = [
      { id: 1, layer: 0, m: identity, shape: withLink(await image(), { mode: 'contour', contourId: 2 }) },
      { id: 2, layer: 0, m: identity, shape },
    ];
    await assert.rejects(jobObjs(objs, {}, lineLayer, cutImg()));
  }
});

await test('all images engrave before any cut, then vectors and sublayers keep their order', async () => {
  const a = withLink(await image(), { mode: 'boundary' });
  const b = withLink(await image(), { mode: 'boundary' });
  const vec = square(0, 0, 5, 5);
  const L = { ...lineLayer, img: cutImg(), sub: [{ ...lineLayer, output: true, speed: 90, power: 40 }] };
  const objs = [
    { id: 1, layer: 0, m: [1, 0, 0, 1, 30, 20], shape: a },
    { id: 2, layer: 0, m: [1, 0, 0, 1, 150, 20], shape: b },
    { id: 3, layer: 0, m: identity, shape: vec },
  ];
  const j = await jobObjs(objs, {}, L, cutImg());
  const kinds: string[] = [];
  for (let i = 0; i < j.moves.n; i++) {
    if (j.moves.sub[i] === -2) kinds.push('cut');
    else if (j.moves.cls[i] === MOVE_ENGRAVE) kinds.push('eng');
    else if (j.moves.s[i] > 0) kinds.push('vec');
  }
  const firstCut = kinds.indexOf('cut');
  assert.ok(firstCut > 0 && kinds.lastIndexOf('eng') < firstCut, 'all engraving precedes all cuts');
  assert.ok(kinds.slice(firstCut).every((k) => k === 'cut' || k === 'vec'), 'cuts precede vectors');
  assert.ok([...j.moves.sub.slice(0, j.moves.n)].includes(0), 'sublayer still emitted');
});

await test('two cut layers: each layer engraves its images before cutting its own contours', async () => {
  const a = withLink(await image(), { mode: 'boundary' });
  const b = withLink(await image(), { mode: 'boundary' });
  const doc = loadDoc({ bed: { w: 500, h: 500 }, objs: [
    { id: 1, layer: 0, m: [1, 0, 0, 1, 30, 20], shape: a },
    { id: 2, layer: 1, m: [1, 0, 0, 1, 150, 20], shape: b },
  ], layers: {} });
  const j = await buildJob({ doc, layer: () => lineLayer, imgLayer: () => cutImg(),
    device: { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' } });
  const events: string[] = [];
  for (let i = 0; i < j.moves.n; i++) {
    if (!(j.moves.s[i] > 0)) continue;
    const li = j.moves.layer[i];
    if (j.moves.sub[i] === -2) events.push(`cut${li}`);
    else if (j.moves.cls[i] === MOVE_ENGRAVE) events.push(`eng${li}`);
  }
  const order = ['eng0', 'cut0', 'eng1', 'cut1'].map((k) => events.indexOf(k));
  assert.ok(order[0] >= 0 && order[1] > order[0] && order[2] > order[1] && order[3] > order[2],
    `pro Layer erst gravieren, dann schneiden erwartet; Folge: ${events.join(',')}`);
});

await test('image cut carries Z, air and its own annotated layer marker', async () => {
  const s = withLink(await image(), { mode: 'boundary' });
  const cut = cutImg({ passes: 2, zOffset: 3, zStep: -1, air: true, power: 55, speed: 200 });
  const dev = { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' as const, zAxis: true };
  const j = await job(s, undefined, { imgLayer: () => cut, layer: () => ({ ...lineLayer, img: cut }), device: dev });
  const zs: number[] = [];
  for (let i = 0; i < j.moves.n; i++) if (j.moves.sub[i] === -2 && j.moves.s[i] > 0) zs.push(j.moves.z[i]);
  assert.deepEqual(zs, [3, 3, 3, 3, 2, 2, 2, 2]);
  assert.deepEqual(j.air, [0]);
  const est = estimate(j.moves, dev);
  const annotated = writeGCode(j, dev, est, 'KZB', true);
  assert.ok(annotated.lines.includes('; KZB1 layer 0 sub -2'));
  assert.deepEqual(annotated.lines.filter((l) => !l.startsWith('; KZB1')),
    writeGCode(j, dev, est, 'KZB', false).lines);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
