import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { addAsset } from '../src/images';
import * as F from '../src/files';
import { DEFAULT_ADJUST, type ImageShape, type Mat } from '../src/model';

const g = globalThis as any;
g.__pdfPages = null;

class TestImage {
  naturalWidth = 0;
  naturalHeight = 0;
  pixels = new Uint8ClampedArray();
  onload = () => {};
  set src(value: string) {
    const payload = value.slice(value.indexOf(',') + 1);
    if (payload.startsWith('{')) {
      const d = JSON.parse(payload);
      this.naturalWidth = d.w; this.naturalHeight = d.h; this.pixels = new Uint8ClampedArray(d.rgba);
    } else {
      const b = Buffer.from(payload, 'base64');
      let w = 1, h = 1;
      for (let p = 2; p + 9 < b.length; p++) {
        if (b[p] === 0xff && b[p + 1] === 0xc0) { h = (b[p + 5] << 8) | b[p + 6]; w = (b[p + 7] << 8) | b[p + 8]; break; }
      }
      this.naturalWidth = w; this.naturalHeight = h;
      this.pixels = new Uint8ClampedArray(w * h * 4).fill(255);
    }
    queueMicrotask(() => this.onload());
  }
}
class TestCanvas {
  width = 0; height = 0;
  pixels = new Uint8ClampedArray();
  getContext() {
    return {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => { this.pixels = img.data.slice(); },
      getImageData: () => ({ data: this.pixels.slice() }),
      drawImage: (image: TestImage) => { this.pixels = image.pixels.slice(); },
      fillRect: () => {},
    };
  }
  toDataURL() {
    return 'data:image/png;base64,' + Buffer.from(JSON.stringify({ w: this.width, h: this.height, rgba: [...this.pixels] })).toString('base64');
  }
}
g.Image = TestImage;
g.document = { createElement: (tag: string) => { assert.equal(tag, 'canvas'); return new TestCanvas(); } };

const solid = (w: number, h: number, rgb: [number, number, number]) =>
  Array.from({ length: w * h }, () => [...rgb, 255]).flat();
async function imageAsset(rgb: [number, number, number] = [0, 200, 0]) {
  const url = `data:image/test,${JSON.stringify({ w: 8, h: 8, rgba: solid(8, 8, rgb) })}`;
  const a = await addAsset(url);
  return { asset: a.id, url };
}
// Minimal baseline JPEG: SOI + SOF0 (8x8, 3 components) + EOI.
const jpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]);
async function jpegAsset() {
  const url = 'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64');
  return (await addAsset(url)).id;
}
const shape = (asset: string, edit?: ImageShape['edit']): ImageShape => ({
  kind: 'image', asset, w: 80, h: 80, pxW: 8, pxH: 8,
  adjust: { ...DEFAULT_ADJUST }, ...(edit ? { edit } : {}),
});
const m: Mat = [1, 0, 0, 1, 30, 20];
function editor(objs: any[]) {
  return {
    doc: { bed: { w: 200, h: 100 }, objs, pages: [{ name: 'p', objs }], page: 0, layers: {} },
    layer: () => ({ show: true, fill: false, mode: 'line', name: 'L' }),
    tab: { name: 't' }, hint: '', emit() {},
  };
}
function svgFor(s: ImageShape, notes?: Set<string>) {
  return F.buildSvg(editor([{ id: 1, layer: 0, m, shape: s }]) as any, notes ? { notes } : {});
}
async function pdfFor(s: ImageShape) {
  const r = await F.buildPdfBytes(editor([{ id: 1, layer: 0, m, shape: s }]) as any);
  return { items: g.__pdfPages[0].items, notes: r.notes };
}
function decodePng(href: string) {
  assert.ok(href.startsWith('data:image/png;base64'), 'expected a baked PNG data URL');
  return JSON.parse(Buffer.from(href.slice(href.indexOf(',') + 1), 'base64').toString());
}

let passed = 0, failed = 0;
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${String((e as Error).stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<image-export-bundle>')}`); }
}

await test('unedited SVG keeps the original URL and affine image element', async () => {
  const { asset, url } = await imageAsset();
  const svg = svgFor(shape(asset));
  assert.ok(svg.includes(`href="${url}"`), 'original asset URL preserved');
  assert.ok(svg.includes('transform="matrix(1 0 0 1 30 20)"'));
  assert.ok(svg.includes('width="80" height="80"'));
  assert.ok(!svg.includes('data:image/png;base64'), 'no bake for unedited image');
});

await test('unedited PDF keeps legacy JPEG byte passthrough', async () => {
  const { items } = await pdfFor(shape(await jpegAsset()));
  assert.equal(items.length, 1);
  const it = items[0];
  assert.ok(it.jpeg instanceof Uint8Array, 'JPEG bytes passed through unchanged');
  assert.equal(it.rgb, undefined);
  assert.deepEqual([...it.m], [80, 0, 0, 80, 30, 20]);
  assert.equal(it.pxW, 8); assert.equal(it.pxH, 8);
});

await test('edited crop bakes a PNG in local mm and composes the matrix', async () => {
  const { asset } = await imageAsset();
  const notes = new Set<string>();
  const s = shape(asset, { crop: { left: .25, top: .25, right: .75, bottom: .75 } });
  const svg = svgFor(s, notes);
  const hit = svg.match(/transform="matrix\(([^)]+)\)" width="(\d+)" height="(\d+)"[^>]*href="(data:image\/png;base64,[^"]+)"/);
  assert.ok(hit, 'baked <image> present');
  assert.deepEqual(hit![1].split(' ').map(Number), [10, 0, 0, 10, 50, 40]);
  assert.equal(hit![2], '4'); assert.equal(hit![3], '4');
  const png = decodePng(hit![4]);
  assert.equal(png.w, 4); assert.equal(png.h, 4);
  assert.ok(png.rgba.every((v: number, i: number) => i % 4 !== 3 || v === 255), 'opaque raster');
  assert.ok([...notes].some(n => n.includes('gerastert')), `rasterization note missing: ${[...notes].join(' | ')}`);
});

await test('rounded corners produce a white exterior in the baked raster', async () => {
  const { asset } = await imageAsset();
  const svg = svgFor(shape(asset, { cornerRadii: [20, 0, 0, 0] }));
  const hit = svg.match(/href="(data:image\/png;base64,[^"]+)"/);
  assert.ok(hit, 'baked <image> present');
  const png = decodePng(hit![1]);
  assert.equal(png.w, 8); assert.equal(png.h, 8);
  assert.deepEqual(png.rgba.slice(0, 4), [255, 255, 255, 255], 'outside rounded corner is white');
  const c = (4 * 8 + 4) * 4;
  assert.deepEqual(png.rgba.slice(c, c + 4), [0, 200, 0, 255], 'interior keeps source color');
});

await test('edited PDF bakes rgb, disables JPEG passthrough and composes the matrix', async () => {
  const s = shape(await jpegAsset(), { crop: { left: .25, top: .25, right: .75, bottom: .75 } });
  const { items, notes } = await pdfFor(s);
  const it = items[0];
  assert.equal(it.jpeg, undefined, 'JPEG byte passthrough disabled for edited image');
  assert.ok(it.rgb instanceof Uint8Array, 'rgb raster present');
  assert.deepEqual([...it.m], [10, 0, 0, 10, 50, 40]);
  assert.equal(it.pxW, 4); assert.equal(it.pxH, 4);
  assert.ok(it.alpha === undefined || it.alpha.every((a: number) => a === 255), 'opaque, no soft mask');
  assert.ok(notes.some(n => n.includes('gerastert')), `rasterization note missing: ${notes.join(' | ')}`);
});

await test('near-identity crop within tolerance keeps the unedited path', async () => {
  const { asset, url } = await imageAsset();
  const s = shape(asset, { crop: { left: 1e-10, top: 0, right: 1, bottom: 1 - 1e-10 } });
  const affects = (F as any).imageEditAffectsAppearance;
  assert.equal(affects(s), false, 'sub-nanometre crop is not an appearance edit');
  const notes = new Set<string>();
  const svg = svgFor(s, notes);
  assert.ok(svg.includes(`href="${url}"`));
  assert.equal(notes.size, 0);
});

await test('no-op edit keeps the unedited path and emits no note', async () => {
  const { asset, url } = await imageAsset();
  const s = shape(asset, {
    crop: { left: 0, top: 0, right: 1, bottom: 1 },
    perspective: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
    cornerRadii: [0, 0, 0, 0],
  });
  const affects = (F as any).imageEditAffectsAppearance;
  assert.equal(typeof affects, 'function');
  assert.equal(affects(s), false);
  const notes = new Set<string>();
  const svg = svgFor(s, notes);
  assert.ok(svg.includes(`href="${url}"`));
  assert.equal(notes.size, 0);
});

await test('bake grid bounds huge sources and reports the cap', async () => {
  const grid = (F as any).exportBakeGrid;
  assert.equal(typeof grid, 'function');
  const big = grid(100000, 100000, shape('x'), { x: 0, y: 0, width: 100000, height: 100000 }, 1000);
  assert.equal(big.capped, true);
  assert.ok(big.width > 0 && big.height > 0 && big.width * big.height <= 1000);
  const small = grid(1000, 1000, { ...shape('x'), w: 1000, h: 1000 }, { x: 0, y: 0, width: 1000, height: 1000 }, 16_000_000);
  assert.deepEqual([small.width, small.height, small.capped], [1000, 1000, false]);
});

await test('a changed perspective counts as appearance-changing', async () => {
  const affects = (F as any).imageEditAffectsAppearance;
  const s = shape('x', { perspective: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }] });
  assert.equal(affects(s), true);
});

await test('baking leaves the shape edit and original asset untouched', async () => {
  const { asset, url } = await imageAsset();
  const s = shape(asset, { crop: { left: .2, top: .1, right: .8, bottom: .9 }, cornerRadii: [5, 0, 0, 0] });
  const before = JSON.stringify(s);
  svgFor(s);
  await pdfFor(s);
  assert.equal(JSON.stringify(s), before, 's.edit unchanged');
  const { assetUrl } = await import('../src/images');
  assert.equal(assetUrl(asset), url, 'original asset URL unchanged');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
