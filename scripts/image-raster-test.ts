import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ImageShape } from '../src/model';
import { apply, inv, type Mat } from '../src/mat';
import { rasterizeImage, resolveImageRasterGeometry, DEFAULT_IMAGE_MAX_PIXELS } from '../src/imageRaster';
import { resolveImageContour } from '../src/imageContour';

const image = (pxW = 10, pxH = 1): ImageShape => ({ kind: 'image', asset: 'original',
  w: 100, h: 10, pxW, pxH, adjust: {} } as ImageShape);
const source = (width = 10, height = 1) => ({ width, height,
  rgba: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) * 20) });
function render(s = source(), shape = image(), width = s.width, height = s.height) {
  const result = rasterizeImage(s, shape, { width, height });
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}
function pixel(data: Uint8ClampedArray, i: number) { return Array.from(data.slice(i * 4, i * 4 + 4)); }
function rejection(...args: Parameters<typeof rasterizeImage>) {
  const result = rasterizeImage(...args);
  assert.ok(!result.ok);
  return result;
}

test('native identity preserves colors and nonzero alpha; zero-alpha RGB is canonical black', () => {
  const s = { width: 3, height: 2, rgba: new Uint8ClampedArray([
    1, 2, 3, 255, 25, 80, 222, 128, 100, 20, 80, 1,
    255, 0, 50, 0, 5, 60, 99, 254, 44, 33, 22, 255]) };
  const expected = s.rgba.slice(); expected.set([0, 0, 0, 0], 12);
  assert.deepEqual(render(s, image(3, 2)).rgba, expected);
});

test('crop keeps 80 of 100 physical units and matching original pixel density', () => {
  const s = source();
  const shape = { ...image(), edit: { crop: { left: 0.1, top: 0, right: 0.9, bottom: 1 } } };
  const result = render(s, shape, 8, 1);
  assert.deepEqual(result.bounds, { x: 10, y: 0, width: 80, height: 10 });
  assert.deepEqual(result.rgba, s.rgba.slice(4, 36));
  assert.equal(result.width, 8); assert.equal(result.height, 1);
});

test('known projective inverse is not bilinear quad interpolation', () => {
  // x=(4u+2v)/(1+v), y=4v/(1+v). At local (2,1), u=1/2,v=1/3.
  const s = source(3, 3);
  s.rgba.forEach((_, i) => { s.rgba[i] = i % 4 === 3 ? 255 : Math.floor(i / 12) * 90; });
  const shape = { ...image(3, 3), edit: { perspective: [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 },
  ] as const } };
  // Magnification isolates the inverse point mapping from minification filtering.
  assert.deepEqual(pixel(render(s, shape, 9, 9).rgba, 40), [45, 45, 45, 255]);
});

test('outside trapezoid is transparent, including after a source crop', () => {
  const shape = { ...image(), edit: { perspective: [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 },
  ] as const } };
  const result = render(source(), shape, 8, 4);
  assert.deepEqual(pixel(result.rgba, 24), [0, 0, 0, 0]);
  assert.equal(pixel(result.rgba, 27)[3], 255);
  const cropped = render(source(), { ...shape, edit: { ...shape.edit,
    crop: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 } } }, 20, 20);
  assert.deepEqual(pixel(cropped.rgba, 380), [0, 0, 0, 0]);
  assert.ok(cropped.bounds.width < result.bounds.width);
});

test('premultiplied interpolation prevents transparent RGB halos and clamps original edges', () => {
  const s = { width: 2, height: 1, rgba: new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]) };
  const result = render(s, image(2), 3, 1);
  assert.deepEqual(pixel(result.rgba, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(result.rgba, 1), [0, 0, 255, 128]);
  assert.deepEqual(pixel(result.rgba, 2), [0, 0, 255, 255]);
});

test('fractional crop boundary clamps footprint to retained centers without stretching', () => {
  const s = { width: 4, height: 1, rgba: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 100, 0, 255, 0, 200, 0, 255, 255, 0, 0, 255]) };
  const shape = { ...image(4), edit: { crop: { left: 0.3, top: 0, right: 0.7, bottom: 1 } } };
  const result = render(s, shape, 4, 1);
  assert.deepEqual(result.bounds, { x: 30, y: 0, width: 40, height: 10 });
  assert.deepEqual(Array.from(result.rgba), [0, 100, 0, 255, 0, 130, 0, 255, 0, 170, 0, 255, 0, 200, 0, 255]);
});

test('subpixel crop with no retained center uses its intersected original pixel', () => {
  const shape = { ...image(), edit: { crop: { left: 0.21, top: 0, right: 0.22, bottom: 1 } } };
  assert.deepEqual(pixel(render(source(), shape, 1, 1).rgba, 0), [40, 40, 40, 255]);
});

test('invalid decoded dimensions, metadata mismatch, exact buffer length and safe count rejected', () => {
  for (const width of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(rejection({ ...source(), width }, image(), { width: 1, height: 1 }).reason, 'source-dimensions');
  }
  for (const s of [{ ...source(), rgba: new Uint8ClampedArray(39) }, source(9)]) {
    assert.equal(rejection(s, image(), { width: 1, height: 1 }).reason, 'source-dimensions');
  }
});

test('invalid geometry is rejected without model repair', () => {
  for (const shape of [{ ...image(), w: 0 }, { ...image(), edit: { crop: { left: 0.8, top: 0, right: 0.2, bottom: 1 } } },
    { ...image(), edit: { perspective: Array(4).fill({ x: 0, y: 0 }) } } as ImageShape]) {
    assert.equal(rejection(source(), shape, { width: 1, height: 1 }).reason, 'geometry');
  }
});

test('invalid output dimensions and pixel limit rejected; huge requested grid is never allocated/shrunk', () => {
  for (const width of [0, -1, 1.2, NaN, Infinity]) {
    assert.equal(rejection(source(), image(), { width, height: 1 }).reason, 'invalid');
  }
  assert.equal(DEFAULT_IMAGE_MAX_PIXELS, 16_000_000);
  const s = source(), originalArray = globalThis.Uint8ClampedArray;
  let allocations = 0;
  globalThis.Uint8ClampedArray = new Proxy(originalArray, { construct() {
    allocations++; throw new Error('Rejected output attempted allocation');
  } });
  try {
    for (const width of [16_000_001, Number.MAX_SAFE_INTEGER]) {
      const result = rasterizeImage(s, image(), { width, height: 2 });
      assert.deepEqual(result, { ok: false, reason: 'output-too-large', width, height: 2, maxPixels: 16_000_000 });
    }
    assert.equal(allocations, 0);
  } finally { globalThis.Uint8ClampedArray = originalArray; }
  assert.equal(rejection(source(), image(), { width: 2, height: 2, maxPixels: 3 }).reason, 'output-too-large');
  assert.equal(rejection(source(), image(), { width: 1, height: 1, maxPixels: 0 }).reason, 'invalid');
});

test('frozen model and original bytes stay unchanged; repeated outputs do not share storage', () => {
  const shape = image(); Object.freeze(shape.adjust); Object.freeze(shape);
  const s = source(), before = s.rgba.slice();
  const a = render(s, shape), b = render(s, shape);
  a.rgba.fill(17);
  assert.deepEqual(b.rgba, before); assert.deepEqual(s.rgba, before);
  assert.deepEqual(render(s, shape).rgba, before);
});

test('local bounds placement composes externally with nonidentity world Mat, not baked into pixels', () => {
  const shape = { ...image(), edit: { crop: Object.freeze({ left: 0.1, top: 0, right: 0.9, bottom: 1 }) } };
  Object.freeze(shape.edit); Object.freeze(shape);
  const result = render(source(), shape, 8, 1);
  const m: Mat = [1.5, 0.4, -0.3, 0.8, 41, -27];
  const x = result.bounds.x + 0.5 * result.bounds.width / result.width;
  const y = result.bounds.y + 0.5 * result.bounds.height / result.height;
  const world = apply(m, x, y), local = apply(inv(m), world.x, world.y);
  assert.ok(Math.abs(local.x - 15) < 1e-10); assert.ok(Math.abs(local.y - 5) < 1e-10);
  assert.notEqual(world.x, x);
  assert.deepEqual(pixel(result.rgba, 0), pixel(source().rgba, 1));
});

test('1200 to 250 fine stripes use area coverage, not aliased point samples', () => {
  const s = { width: 1200, height: 800, rgba: Uint8ClampedArray.from({ length: 1200 * 800 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (Math.floor(i / 4) % 1200 >> 1) & 1 ? 210 : 40) };
  const before = s.rgba.slice(), start = performance.now();
  const result = render(s, image(1200, 800), 250, 167);
  let sum = 0, square = 0, dark = 0;
  for (let i = 0; i < result.rgba.length; i += 4) {
    const v = result.rgba[i]; sum += v; square += v * v; dark += +(v < 128);
  }
  const mean = sum / (250 * 167), sd = Math.sqrt(square / (250 * 167) - mean * mean);
  assert.ok(Math.abs(mean - 125) < 0.1, `mean ${mean}`);
  assert.ok(Math.abs(sd - 12.671) < 0.5, `SD ${sd}; bilinear aliases at about 68.845`);
  assert.ok(dark > 0 && dark < 250 * 167, 'threshold output retains both states');
  assert.equal(result.width, 250); assert.equal(result.height, 167);
  assert.deepEqual(s.rgba, before);
  console.log(`raster minification 1200x800 -> 250x167: ${Math.round(performance.now() - start)} ms, SD ${sd.toFixed(3)}`);
});

test('fractional minifying crop integrates exact source edges, not retained-center shortcuts', () => {
  const s = { width: 4, height: 1, rgba: new Uint8ClampedArray([
    0, 0, 0, 255, 60, 60, 60, 255, 120, 120, 120, 255, 240, 240, 240, 255]) };
  const shape = { ...image(4), edit: { crop: { left: 0.125, top: 0, right: 0.875, bottom: 1 } } };
  assert.deepEqual(pixel(render(s, shape, 1, 1).rgba, 0), [100, 100, 100, 255]);
});

test('fractional minification weights premultiplied alpha without transparent-color halos', () => {
  const s = { width: 4, height: 1, rgba: new Uint8ClampedArray([
    255, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0, 255]) };
  const shape = { ...image(4), edit: { crop: { left: 0.125, top: 0, right: 0.875, bottom: 1 } } };
  assert.deepEqual(pixel(render(s, shape, 1, 1).rgba, 0), [64, 64, 127, 170]);
  shape.edit.crop.left = 0.3; shape.edit.crop.right = 0.7;
  assert.deepEqual(pixel(render(s, shape, 1, 1).rgba, 0), [0, 85, 170, 192]);
});

test('two-dimensional fractional alpha footprints weight both crop axes', () => {
  const s = { width: 2, height: 2, rgba: new Uint8ClampedArray([
    255, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0, 255]) };
  const shape = { ...image(2, 2), edit: { crop: { left: 0.125, top: 0, right: 1, bottom: 0.875 } } };
  assert.deepEqual(pixel(render(s, shape, 1, 1).rgba, 0), [94, 35, 125, 169]);
});

test('small fractional crop cannot turn fine stripes into all-white threshold output', () => {
  const s = { width: 1200, height: 4, rgba: Uint8ClampedArray.from({ length: 1200 * 4 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (Math.floor(i / 4) % 1200 >> 1) & 1 ? 210 : 40) };
  const shape = { ...image(1200, 4), edit: { crop: { left: 0.001, top: 0, right: 1, bottom: 1 } } };
  const result = render(s, shape, 300, 1);
  assert.ok(Array.from({ length: 300 }, (_, i) => result.rgba[i * 4]).every(v => v >= 124 && v <= 126));
});

test('genuine projective minification follows varying destination-area footprints', () => {
  const s = { width: 120, height: 96, rgba: Uint8ClampedArray.from({ length: 120 * 96 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (((Math.floor(i / 4) % 120 >> 1) & 1) ? 160 : 30) + Math.floor(Math.floor(i / 4) / 120 / 4)) };
  const shape = { ...image(120, 96), w: 100, h: 80, edit: { perspective: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 65, y: 80 }, { x: 25, y: 80 },
  ] as const } };
  const crop = { left: 0.123, top: 0.073, right: 0.917, bottom: 0.891 };
  for (const edit of [shape.edit, { ...shape.edit, crop }, { ...shape.edit, crop, order: 'perspectiveFirst' as const }]) {
    const current = { ...shape, edit }, resolved = resolveImageRasterGeometry(current); assert.ok(resolved.ok);
    const result = render(s, current, 10, 8), samples = 192;
    let checked = 0, maxError = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) {
      const index = j * 10 + i;
      if (!result.coverage[index]) { assert.deepEqual(pixel(result.rgba, index), [0, 0, 0, 0]); continue; }
      // Independent dense destination-area reference; no production sampling cap.
      let sum = 0, count = 0;
      for (let v = 0; v < samples; v++) for (let u = 0; u < samples; u++) {
        const p = resolved.geometry.localToSource({
          x: result.bounds.x + (i + (u + 0.5) / samples) * result.bounds.width / 10,
          y: result.bounds.y + (j + (v + 0.5) / samples) * result.bounds.height / 8,
        });
        if (!p || p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1) continue;
        if (resolved.order === 'cropFirst' && (p.x < resolved.crop.left || p.x > resolved.crop.right
          || p.y < resolved.crop.top || p.y > resolved.crop.bottom)) continue;
        sum += s.rgba[(Math.floor(p.y * s.height) * s.width + Math.floor(p.x * s.width)) * 4]; count++;
      }
      const error = Math.abs(result.rgba[index * 4] - sum / count);
      maxError = Math.max(maxError, error); checked++;
    }
    assert.ok(checked >= 50); assert.ok(maxError < 1.5, `projective footprint max error ${maxError}`);
  }
});

test('strong projective shrink weights destination area, not source area', () => {
  const s = { width: 2, height: 2, rgba: new Uint8ClampedArray([
    0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]) };
  const shape = { ...image(2, 2), edit: { perspective: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 100 }, { x: 0, y: 100 },
  ] as const } };
  // The white lower source half occupies only 128.099 / 5500 destination area.
  assert.deepEqual(pixel(render(s, shape, 1, 1).rgba, 0), [6, 6, 6, 255]);
});

test('footprints clipped before inversion remain filtered when a bbox edge reaches the inverse horizon', () => {
  const s = { width: 2, height: 2, rgba: new Uint8ClampedArray([
    0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]) };
  const shape = { ...image(2, 2), edit: { perspective: [
    { x: 0, y: 0 }, { x: 1 / 3, y: 0 }, { x: 1 / 5, y: 1 / 5 }, { x: 0, y: 1 / 3 },
  ] as const } };
  // x=u/(1+2u+2v), y=v/(1+2u+2v). The white area fraction is exactly 7/32.
  assert.deepEqual(pixel(render(s, shape, 1, 1).rgba, 0), [56, 56, 56, 255]);
});

test('minification retains exact world-circle center masks under nonidentity affine', () => {
  const s = { width: 24, height: 24, rgba: Uint8ClampedArray.from({ length: 24 * 24 * 4 }, (_, i) => [40, 80, 120, 255][i % 4]) };
  const shape = { ...image(24, 24), w: 100, h: 100, edit: { cornerRadii: [30, 30, 30, 30] } };
  const world: Mat = [1.5, 0.3, -0.25, 0.9, 10, 20], contour = resolveImageContour(shape, world);
  assert.ok(contour.ok);
  const result = rasterizeImage(s, shape, { width: 12, height: 12, world }); assert.ok(result.ok);
  for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
    const inside = contour.contour.contains(apply(world, (i + 0.5) * 100 / 12, (j + 0.5) * 100 / 12));
    assert.equal(result.coverage[j * 12 + i], +inside);
    assert.deepEqual(pixel(result.rgba, j * 12 + i), inside ? [40, 80, 120, 255] : [0, 0, 0, 0]);
  }
});

test('representative projective minification keeps the requested grid and original', () => {
  const s = { width: 1200, height: 800, rgba: new Uint8ClampedArray(1200 * 800 * 4).fill(127) };
  const shape = { ...image(1200, 800), w: 100, h: 80, edit: { perspective: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 65, y: 80 }, { x: 25, y: 80 },
  ] as const } };
  const start = performance.now(), result = render(s, shape, 250, 167);
  assert.equal(result.width, 250); assert.equal(result.height, 167);
  for (let i = 0; i < result.coverage.length; i++) {
    if (result.coverage[i]) assert.deepEqual(pixel(result.rgba, i), [127, 127, 127, 127]);
    else assert.deepEqual(pixel(result.rgba, i), [0, 0, 0, 0]);
  }
  assert.ok(s.rgba.every(v => v === 127));
  console.log(`raster projective 1200x800 -> 250x167: ${Math.round(performance.now() - start)} ms`);
});
