import './core-fixtures-env';
import { SynchronousImageWorker } from './image-display-worker-fixture';
import assert from 'node:assert/strict';
import { shapeSubs, boundsOf, hitLeaf, leafIntersectsBox, localPath, worldPath, imageContourHitsSegment } from '../src/geom';
import { IDENT, apply, mul, newDoc, DEFAULT_ADJUST, DITHER_MODES, type ImageShape, type Obj, type Pt, type Mat } from '../src/model';
import { checkDesign, DEFAULT_CHECK } from '../src/check';
import { defaultLayer, defaultImageLayer } from '../src/model';
import { Editor } from '../src/editor';
import { addAsset, outputGrid, processImage, resample, imageDisplayActivity } from '../src/images';
import { parkedObjs } from '../src/parking';
import { History } from '../src/history';
import { t } from '../src/i18n';
import { buildJob, newDevice } from '../src/gcode';
import { cachedWorldPath } from '../src/editor/shared';
import { resolveImageContour } from '../src/imageContour';

if (process.env.IMAGE_ERROR_ONLY) {
  const bad = { id: 2, layer: 0, m: IDENT, shape: { kind: 'image', w: 100, h: 100, edit: { crop: { left: 1, right: 0, top: 0, bottom: 1 } } } } as Obj;
  const top: Obj = { id: 3, layer: 0, m: IDENT, shape: { kind: 'group', children: [bad] } };
  const issues = checkDesign({ objs: [top], layer: defaultLayer, bed: { w: 200, h: 200 }, settings: DEFAULT_CHECK });
  const issue = issues.find(x => x.kind === ('image' as string));
  assert.ok(issue);
  assert.equal(issue.level, 'error');
  assert.deepEqual(issue.objs, [top]);
  assert.match(issue.msg, /crop|Zuschnitt/i);
  console.log('4 image error assertions passed');
  process.exit(0);
}

class TestPath {
  points: Pt[] = [];
  moveTo(x: number, y: number) { this.points.push({ x, y }); }
  lineTo(x: number, y: number) { this.points.push({ x, y }); }
  arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise = false) {
    let sweep = end - start;
    if (anticlockwise && sweep > 0) sweep -= Math.PI * 2;
    if (!anticlockwise && sweep < 0) sweep += Math.PI * 2;
    for (let i = 1; i <= 64; i++) {
      const angle = start + sweep * i / 64;
      this.points.push({ x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) });
    }
  }
  closePath() {}
  addPath(path: TestPath, matrix?: { m: Mat }) { this.points.push(...path.points.map(p => matrix ? apply(matrix.m, p.x, p.y) : p)); }
}
const g = globalThis as any;
// DOM fixture: exercise the production status element and its live-region semantics,
// not an announcement callback substituted for the implementation.
class StatusElement {
  style = {};
  children: StatusElement[] = [];
  attributes = new Map<string, string>();
  private value = '';
  writes = 0;
  focusCalls = 0;
  constructor(public tagName: string) {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(...children: StatusElement[]) { this.children.push(...children); }
  set textContent(value: string) { this.value = value; this.writes++; }
  get textContent(): string { return this.value + this.children.map(c => c.textContent).join(''); }
  focus() { this.focusCalls++; }
}
let statusRoot = new StatusElement('DIV');
g.document.getElementById = (id: string) => id === 'status' ? statusRoot : null;
g.Path2D = TestPath;
g.DOMMatrix = class { constructor(public m: Mat) {} };
const inside = (ps: Pt[], x: number, y: number) => {
  const signs = ps.map((a, i) => { const b = ps[(i + 1) % ps.length]; return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x); });
  return ps.length > 2 && (signs.every(s => s >= 0) || signs.every(s => s <= 0));
};
class Canvas {
  focusCalls = 0;
  focus() { this.focusCalls++; }
  width = 10; height = 10; style = {}; pixels = new Uint8ClampedArray(400);
  calls: { name: string; args: any[]; matrix: Mat; clip: TestPath | null }[] = [];
  matrix: Mat = [...IDENT]; clip: TestPath | null = null;
  stack: { matrix: Mat; clip: TestPath | null }[] = [];
  ctx: any = new Proxy({ lineWidth: 1 }, { get: (target: any, name: string) => {
    if (name in target) return target[name];
    return (...args: any[]) => {
      this.calls.push({ name, args, matrix: [...this.matrix], clip: this.clip });
      if (name === 'save') this.stack.push({ matrix: [...this.matrix], clip: this.clip });
      if (name === 'restore') Object.assign(this, this.stack.pop());
      if (name === 'setTransform') this.matrix = args as Mat;
      if (name === 'transform') this.matrix = mul(this.matrix, args as Mat);
      if (name === 'clip') this.clip = args[0];
      if (name === 'measureText') return { width: String(args[0]).length * 7 };
      if (name === 'isPointInPath') return inside(args[0].points, args[1], args[2]);
      if (name === 'isPointInStroke') {
        const ps: Pt[] = args[0].points, x = args[1], y = args[2];
        return ps.some((a, i) => { const b = ps[(i + 1) % ps.length], dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= target.lineWidth / 2;
        });
      }
      if (name === 'drawImage') this.pixels = args[0].pixels ?? this.pixels;
      if (name === 'getImageData') return { data: this.pixels };
      if (name === 'createImageData') return { data: new Uint8ClampedArray(args[0] * args[1] * 4) };
      if (name === 'putImageData') this.pixels = args[0].data;
    };
  } });
  getContext() { return this.ctx; }
}
g.document.createElement = (tag: string) => tag === 'canvas' ? new Canvas() : new StatusElement(tag.toUpperCase());
g.Image = class {
  naturalWidth = 10; naturalHeight = 10; pixels = new Uint8ClampedArray(400).fill(255); onload = () => {};
  set src(_: string) { queueMicrotask(() => this.onload()); }
};
const asset = await addAsset('data:image/test,visible-geometry');
const image: ImageShape = { kind: 'image', asset: asset.id, w: 100, h: 100, pxW: 10, pxH: 10, adjust: { ...DEFAULT_ADJUST }, edit: { crop: { left: .1, top: 0, right: .9, bottom: 1 } } };
const obj: Obj = { id: 1, layer: 0, m: [...IDENT], shape: image };
const perspective: ImageShape = { ...image, edit: { perspective: [{ x: 30, y: 10 }, { x: 100, y: 20 }, { x: 80, y: 90 }, { x: 10, y: 70 }] } };
const poly: Obj = { ...obj, shape: perspective };
let passed = 0, failed = 0;
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + String(error)); }
}
await test('freehand lasso follows exact rounded boundary including its closing edge', async () => {
  const { touchHit } = await import('../src/lasso');
  const rounded: ImageShape = { ...image, edit: { cornerRadii: [20, 20, 20, 20] } };
  for (const m of [IDENT, [-1.2, .3, -.4, .9, 140, 30]] as Mat[]) {
    const leaf = { ...obj, shape: rounded, m };
    const resolved = resolveImageContour(rounded, m); assert.ok(resolved.ok);
    const c = resolved.contour.corners[0], distance = Math.hypot(c.vertex.x - c.center.x, c.vertex.y - c.center.y);
    const n = { x: (c.vertex.x - c.center.x) / distance, y: (c.vertex.y - c.center.y) / distance };
    const point = (along: number, across = 0) => ({ x: c.center.x + n.x * along - n.y * across,
      y: c.center.y + n.y * along + n.x * across });
    const empty = (p: Pt) => {
      const length = Math.hypot(p.x - c.vertex.x, p.y - c.vertex.y), step = (distance - c.radius) / 4;
      return { x: c.vertex.x + (p.x - c.vertex.x) / length * step, y: c.vertex.y + (p.y - c.vertex.y) / length * step };
    };
    assert.equal(touchHit([c.vertex, empty(c.start), empty(c.end)], leaf), false);
    // The closing chord crosses the minor arc; both explicit edges stay outside it.
    const halfAngle = Math.acos(((c.start.x - c.center.x) * n.x + (c.start.y - c.center.y) * n.y) / c.radius);
    const along = c.radius * Math.cos(halfAngle / 2), reach = c.radius * 4;
    const a = point(along, reach), b = point(c.radius + reach), end = point(along, -reach);
    assert.equal(touchHit([a, b], leaf), false);
    assert.equal(touchHit([b, end], leaf), false);
    assert.equal(touchHit([a, end], leaf), true);
    assert.equal(touchHit([a, b, end], leaf), true);
    assert.equal(touchHit([point(c.radius - 1), point(c.radius + 1)], leaf), true);
  }
});
await test('crop 80 of 100: real subs and bounds', () => {
  assert.deepEqual(shapeSubs(image)[0].nodes, [{ x: 10, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 100 }, { x: 10, y: 100 }]);
  assert.deepEqual(boundsOf([obj]), { x: 10, y: 0, w: 80, h: 100 });
});
await test('true perspective and grouped nonidentity bounds retain input', () => {
  const parent: Mat = [2, .5, -.25, 1.5, 40, 30], child: Mat = [1, .2, .3, 1, 5, 7];
  const leaf = { ...poly, m: child }, group: Obj = { id: 2, layer: 0, m: parent, shape: { kind: 'group', children: [leaf] } };
  const before = JSON.stringify(group), ps = perspective.edit!.perspective!.map(p => apply(mul(parent, child), p.x, p.y));
  assert.deepEqual(shapeSubs(perspective)[0].nodes, perspective.edit!.perspective);
  const x = Math.min(...ps.map(p => p.x)), y = Math.min(...ps.map(p => p.y));
  assert.deepEqual(boundsOf([group]), { x, y, w: Math.max(...ps.map(p => p.x)) - x, h: Math.max(...ps.map(p => p.y)) - y });
  assert.equal(JSON.stringify(group), before);
});
await test('LINE image interior hit, empty polygon corner miss, world edge tolerance', () => {
  const m: Mat = [2, .5, -.25, 1.5, 40, 30];
  assert.equal(hitLeaf(poly, m, apply(m, 50, 50), .1, false), true);
  assert.equal(hitLeaf(poly, m, apply(m, 12, 12), .1, false), false);
  const a = apply(m, 30, 10), b = apply(m, 100, 20), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const near = { x: (a.x + b.x) / 2 + dy / len * .4, y: (a.y + b.y) / 2 - dx / len * .4 };
  assert.equal(hitLeaf(poly, m, near, .5, false), true);
  assert.equal(hitLeaf(poly, m, near, .2, false), false);
});
await test('crossing selects actual edge, empty corner misses; enclosure uses crop bounds', () => {
  assert.equal(leafIntersectsBox(poly, IDENT, { x: 29, y: 9, w: 3, h: 3 }), true);
  assert.equal(leafIntersectsBox(poly, IDENT, { x: 10, y: 10, w: 3, h: 3 }), false);
  const b = boundsOf([obj])!;
  assert.ok(b.x >= 9 && b.x + b.w <= 91 && b.y >= -1 && b.y + b.h <= 101);
  assert.equal(leafIntersectsBox(obj, IDENT, { x: 0, y: 20, w: 5, h: 20 }), false);
});
await test('same-reference crop and perspective mutations invalidate local and world paths', () => {
  const s = structuredClone(image), old = localPath(s) as unknown as TestPath;
  const o = { ...obj, shape: s }, cached = cachedWorldPath(o, IDENT) as unknown as TestPath;
  s.edit!.crop!.left = .2;
  const current = localPath(s) as unknown as TestPath;
  assert.notDeepEqual(current.points, old.points);
  assert.equal(current.points[0].x, 20);
  assert.notDeepEqual((cachedWorldPath(o, IDENT) as unknown as TestPath).points, cached.points);
  s.edit!.perspective = structuredClone(perspective.edit!.perspective!);
  assert.notDeepEqual((worldPath(s, IDENT) as unknown as TestPath).points, current.points);
});
function editor(objs: Obj[]) {
  statusRoot = new StatusElement('DIV');
  const ed = Object.create(Editor.prototype) as Editor, canvas = new Canvas();
  canvas.width = 1200; canvas.height = 900;
  Object.assign(ed, { doc: newDoc(), ctx: canvas.ctx, canvas, dpr: 1.5, view: { zoom: 2, ox: 17, oy: -23 },
    sel: [], grid: { show: false }, filled: false, tool: 'select', dark: false, isolation: null });
  ed.doc.objs = objs; ed.doc.layers[0] = { ...defaultLayer(0), interval: 10, img: defaultImageLayer() };
  // Unrelated overlay stages are not targets of this image drawing suite.
  ed.renderGuides = ed.renderOverlay = ed.renderRulers = () => {};
  return { ed, canvas };
}
await test('real image render restores view-density pixels on release and Apply', () => {
  const s: ImageShape = { ...image, edit: { perspective: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] } };
  const leaf: Obj = { ...obj, shape: s, m: [-1, .2, .5, 1, 140, 30] };
  const { ed, canvas } = editor([leaf]);
  Object.assign(ed, { dpr: 2, history: new History(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(),
    nodeSel: new Set(), batching: false, drag: null, snapHit: null, alignGuides: [], hint: '', listeners: new Set() });
  ed.doc.layers[0].interval = .04;
  ed.scheduleSave = ed.syncTextLinks = () => {};
  const before = JSON.stringify(s);
  const draw = () => {
    canvas.calls = []; ed.render();
    const call = canvas.calls.find(c => c.name === 'drawImage')!;
    assert.ok(call); assert.deepEqual(call.matrix, mul([4, 0, 0, 4, 34, -46], leaf.m));
    return call.args[0] as Canvas;
  };
  const applied = draw();
  assert.ok(applied.width >= 600 && applied.height >= 600, 'projected bbox includes shear and DPR');
  ed.view.zoom = 4;
  canvas.calls = []; ed.render();
  const zoomed = canvas.calls.find(c => c.name === 'drawImage')!.args[0] as Canvas;
  assert.ok(zoomed.width >= 1200 && zoomed.height >= 1200, 'zoom upgrades beyond old 800 cap');
  assert.notEqual(zoomed, applied);
  ed.view.zoom = 2;
  ed.startImageEdit(leaf.id, 'perspective');
  const idle = draw();
  assert.equal(idle.width, applied.width); assert.equal(idle.height, applied.height);
  assert.deepEqual(idle.pixels, applied.pixels, 'idle draft preserves applied detail');
  ed.drag = { type: 'image-crop', mode: 'perspective', handle: 0 };
  const dragging = draw();
  assert.ok(dragging.width <= 512 && dragging.height <= 512);
  assert.equal(canvas.ctx.imageSmoothingEnabled, true);
  ed.dirty = false;
  ed.onUp({ pointerId: 1 } as PointerEvent);
  assert.equal(ed.dirty, true, 'pointer release requests upgraded render');
  assert.equal(draw(), idle);
  assert.equal(JSON.stringify(s), before);
  ed.applyImageDraft();
  const afterApply = draw();
  assert.ok(afterApply.width >= applied.width && afterApply.height >= applied.height,
    'Apply does not retain drag raster (identity edits may normalize to legacy full grid)');
});
await test('real render draws full-job tone in draft and after Apply for every dither mode', async () => {
  const OriginalImage = g.Image;
  g.Image = class {
    naturalWidth = 101; naturalHeight = 59; onload = () => {};
    pixels = Uint8ClampedArray.from({ length: 101 * 59 * 4 }, (_, i) => i % 4 === 3 ? 255 : ((Math.floor(i / 4) % 101) % 2 ? 220 : 30));
    set src(_: string) { queueMicrotask(() => this.onload()); }
  };
  let signalAsset;
  try { signalAsset = await addAsset('data:image/test,render-signal'); }
  finally { g.Image = OriginalImage; }
  for (const [dither] of DITHER_MODES) {
    const s: ImageShape = { kind: 'image', asset: signalAsset.id, w: 10.1, h: 5.9, pxW: 101, pxH: 59, adjust: { ...DEFAULT_ADJUST } };
    const leaf: Obj = { ...obj, shape: s, m: [-1.1, .2, .15, .9, 40, 30] };
    const { ed, canvas } = editor([leaf]);
    Object.assign(ed, { history: new History(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(),
      nodeSel: new Set(), batching: false, drag: null, snapHit: null, alignGuides: [], hint: '', listeners: new Set() });
    ed.scheduleSave = ed.syncTextLinks = () => {};
    ed.doc.layers[0].interval = .075;
    ed.doc.layers[0].img = { ...defaultImageLayer(), dither };
    const before = JSON.stringify(s);
    ed.startImageEdit(leaf.id, 'crop');
    assert.equal(ed.setImageCropNumeric({ left: .1, top: 0, right: 100, bottom: 100, unit: 'percent' }), null);
    const draw = () => {
      canvas.calls = []; ed.render();
      const call = canvas.calls.find(c => c.name === 'drawImage')!;
      assert.ok(call); assert.deepEqual(call.matrix, mul([3, 0, 0, 3, 25.5, -34.5], leaf.m));
      assert.equal(canvas.ctx.imageSmoothingEnabled, true, 'minified full-job pixels must be filtered');
      return call.args[0] as Canvas;
    };
    const draft = draw();
    assert.equal(JSON.stringify(s), before, 'render/draft cannot mutate committed source');
    assert.equal(ed.applyImageDraft(), null);
    const applied = draw(), L = ed.imgOutput(0), grid = outputGrid(leaf.shape as ImageShape, leaf.m, L.interval);
    const full = processImage(leaf.shape as ImageShape, L, grid.cols, grid.rows, leaf.m)!;
    const expected = resample(full, grid.cols, grid.rows, applied.width, applied.height);
    assert.deepEqual(applied.pixels, draft.pixels, `${dither}: Apply retains idle draft signal`);
    for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(applied.pixels[i * 4] - expected[i]) <= .501,
      `${dither}: rendered input pixel ${i} must represent finished job raster`);
  }
});
await test('real pointer release encloses rounded image contour, not its empty bbox corners', async () => {
  const { insideLasso, lassoWinding } = await import('../src/lasso');
  const rounded: ImageShape = { ...image, edit: { cornerRadii: [20, 20, 20, 20] } };
  for (const m of [IDENT, [1.5, .3, -.4, 1.2, 40, 30], [-1.2, .3, -.4, .9, 140, 30]] as Mat[]) {
    const leaf = { ...obj, shape: rounded, m }, { ed, canvas } = editor([leaf]);
    Object.assign(ed, { history: new History(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(),
      nodeSel: new Set(), batching: false, drag: null, snapHit: null, alignGuides: [], nodeEditObj: null, hint: '' });
    Object.assign(canvas, { getBoundingClientRect: () => ({ left: 11, top: 13 }) });
    ed.emit = ed.redraw = () => {};
    const resolved = resolveImageContour(rounded, m); assert.ok(resolved.ok);
    const corners = resolved.contour.corners;
    const polygon = corners.flatMap(c => [c.start, c.end].map(p => ({
      x: c.vertex.x + (p.x - c.vertex.x) / 4, y: c.vertex.y + (p.y - c.vertex.y) / 4,
    })));
    const samples = corners.flatMap(c => {
      const start = Math.atan2(c.start.y - c.center.y, c.start.x - c.center.x);
      let sweep = Math.atan2(c.end.y - c.center.y, c.end.x - c.center.x) - start;
      if (resolved.contour.clockwise && sweep < 0) sweep += Math.PI * 2;
      if (!resolved.contour.clockwise && sweep > 0) sweep -= Math.PI * 2;
      return Array.from({ length: 101 }, (_, i) => ({ x: c.center.x + c.radius * Math.cos(start + sweep * i / 100),
        y: c.center.y + c.radius * Math.sin(start + sweep * i / 100) }));
    });
    assert.equal(samples.length, 404);
    assert.ok(samples.every(p => insideLasso(p, polygon)));
    const bounds = boundsOf([leaf])!;
    assert.ok(!insideLasso({ x: bounds.x, y: bounds.y }, polygon));
    const before = JSON.stringify(ed.doc);
    const finish = (points: Pt[]) => {
      points = lassoWinding(points) < 0 ? [...points].reverse() : points;
      ed.drag = { type: 'lasso', points: points.slice(0, -1), pointerId: 1, components: false, touch: false,
        overflow: false, doc: ed.doc, base: [], nodeBase: new Map(), handleBase: new Map(), mode: 'set' };
      const last = ed.toScreen(points.at(-1)!);
      ed.onUp({ pointerId: 1, clientX: last.x + 11, clientY: last.y + 13 } as PointerEvent);
    };
    finish(polygon);
    assert.deepEqual(ed.sel, [leaf], 'All visible contour points are enclosed despite excluded bbox corners');
    const c = corners[0], distance = Math.hypot(c.vertex.x - c.center.x, c.vertex.y - c.center.y);
    const inset = { x: c.center.x + (c.vertex.x - c.center.x) / distance * (c.radius - 1),
      y: c.center.y + (c.vertex.y - c.center.y) / distance * (c.radius - 1) };
    const notched = [polygon[0], inset, ...polygon.slice(1)];
    assert.ok(corners.every(c => insideLasso(c.start, notched) && insideLasso(c.end, notched)));
    finish(notched);
    assert.deepEqual(ed.sel, [], 'A concave notch through an arc prevents enclosing selection');
    assert.equal(JSON.stringify(ed.doc), before);
  }
});
await test('rounded image world path, bounds and hit use fixed mm circles under shear and reflection', () => {
  const rounded: ImageShape = { ...perspective, edit: { ...perspective.edit, cornerRadii: [5, 5, 5, 5] } };
  for (const m of [[2, .5, -.25, 1.5, 40, 30], [-2, .5, .4, 1.5, 40, 30]] as Mat[]) {
    const leaf = { ...poly, shape: rounded, m }, resolved = resolveImageContour(rounded, m);
    assert.ok(resolved.ok);
    const path = worldPath(rounded, m) as unknown as TestPath;
    for (const c of resolved.contour.corners) {
      assert.equal(c.radius, 5);
      assert.ok(path.points.some(p => Math.hypot(p.x - c.start.x, p.y - c.start.y) < 1e-8));
      assert.equal(hitLeaf(leaf, m, c.vertex, .01, false), false);
      const tiny = { x: c.vertex.x - .01, y: c.vertex.y - .01, w: .02, h: .02 };
      assert.equal(leafIntersectsBox(leaf, m, tiny), false);
      assert.equal(imageContourHitsSegment(resolved.contour,
        { x: tiny.x, y: tiny.y }, { x: tiny.x + tiny.w, y: tiny.y + tiny.h }), false);
      const len = Math.hypot(c.vertex.x - c.center.x, c.vertex.y - c.center.y);
      const outward = { x: (c.vertex.x - c.center.x) / len, y: (c.vertex.y - c.center.y) / len };
      const near = { x: c.center.x + outward.x * 5.4, y: c.center.y + outward.y * 5.4 };
      assert.equal(hitLeaf(leaf, m, near, .5, false), true);
      assert.equal(hitLeaf(leaf, m, near, .2, false), false);
      assert.equal(imageContourHitsSegment(resolved.contour, c.center, c.vertex), true);
      const tangent = { x: c.center.x + outward.x * 5, y: c.center.y + outward.y * 5 };
      assert.equal(imageContourHitsSegment(resolved.contour,
        { x: tangent.x - outward.y, y: tangent.y + outward.x },
        { x: tangent.x + outward.y, y: tangent.y - outward.x }), true);
    }
    const b = boundsOf([leaf])!;
    const xs = path.points.map(p => p.x), ys = path.points.map(p => p.y);
    assert.ok(Math.abs(b.x - Math.min(...xs)) < .002);
    assert.ok(Math.abs(b.y - Math.min(...ys)) < .002);
    assert.ok(Math.abs(b.x + b.w - Math.max(...xs)) < .002);
    assert.ok(Math.abs(b.y + b.h - Math.max(...ys)) < .002);
  }
});
await test('rounding cache changes in place; omitted and zero radii preserve legacy geometry', () => {
  const s = structuredClone(perspective), m: Mat = [2, .2, .4, 1.5, 30, 20];
  const original = worldPath(s, m) as unknown as TestPath;
  s.edit!.cornerRadii = [0, 0, 0, 0];
  assert.deepEqual((worldPath(s, m) as unknown as TestPath).points, original.points);
  const leaf = { ...poly, shape: s }, before = cachedWorldPath(leaf, m) as unknown as TestPath;
  s.edit!.cornerRadii = [5, 0, 0, 0];
  assert.notDeepEqual((cachedWorldPath(leaf, m) as unknown as TestPath).points, before.points);
  (s.edit!.cornerRadii as number[])[0] = 7;
  assert.notDeepEqual((worldPath(s, m) as unknown as TestPath).points, before.points);
  const legacy = { ...image, edit: undefined };
  assert.deepEqual(boundsOf([{ ...obj, shape: legacy }]), { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(hitLeaf({ ...obj, shape: legacy }, IDENT, { x: 0, y: 0 }, 0, false), true);
});
await test('rotated rounded bounds park an image whose unrounded vertex overlaps the bed', () => {
  const r = Math.SQRT1_2, m: Mat = [r, r, -r, r, 199 + 100 * r, 20];
  const s: ImageShape = { ...image, edit: { cornerRadii: [5, 5, 5, 5] } };
  const leaf = { ...obj, shape: s, m };
  assert.ok(boundsOf([leaf])!.x > 200);
  const onBed: Obj = { id: 9, layer: 0, m: IDENT, shape: { kind: 'rect', w: 20, h: 20, r: 0 } };
  assert.ok(parkedObjs([leaf, onBed], { w: 200, h: 200 }, defaultLayer).has(leaf));
});
await test('rounded crop/perspective both orders use the actual world intersection', () => {
  for (const order of ['cropFirst', 'perspectiveFirst'] as const) {
    const s: ImageShape = { ...perspective, edit: { ...perspective.edit, order,
      crop: { left: .2, top: .2, right: .8, bottom: .8 }, cornerRadii: [5, 5, 5, 5, 5, 5, 5, 5] } };
    const m: Mat = [1.5, .3, -.4, 2, 20, 30], resolved = resolveImageContour(s, m);
    assert.ok(resolved.ok);
    const path = worldPath(s, m) as unknown as TestPath;
    for (const c of resolved.contour.corners) {
      assert.ok(path.points.some(p => Math.hypot(p.x - c.start.x, p.y - c.start.y) < 1e-8));
      assert.equal(hitLeaf({ ...poly, shape: s }, m, c.vertex, .001, false), false);
    }
  }
});
await test('rounded real render preserves raster bbox under nonidentity view DPR shear reflection', () => {
  const rounded: ImageShape = { ...perspective, edit: { ...perspective.edit, cornerRadii: [5, 5, 5, 5] } };
  const m: Mat = [-1.2, .3, -.4, .9, 140, 30], { ed, canvas } = editor([{ ...poly, shape: rounded, m }]);
  const before = JSON.stringify(ed.doc);
  ed.render();
  const draw = canvas.calls.find(c => c.name === 'drawImage')!;
  assert.ok(draw); assert.deepEqual(draw.args.slice(1), [10, 10, 90, 80]);
  assert.deepEqual(draw.matrix, mul([3, 0, 0, 3, 25.5, -34.5], m));
  assert.ok(draw.clip);
  const resolved = resolveImageContour(rounded, m); assert.ok(resolved.ok);
  const worldPoints = draw.clip.points.map(p => apply(m, p.x, p.y));
  for (const c of resolved.contour.corners) {
    assert.ok(worldPoints.some(p => Math.hypot(p.x - c.start.x, p.y - c.start.y) < 1e-8));
    assert.equal(inside(worldPoints, c.vertex.x, c.vertex.y), false);
  }
  assert.equal(JSON.stringify(ed.doc), before);
});
await test('live radius draft reaches the real render without changing the committed image', () => {
  const m: Mat = [2, .3, -.2, 1.5, 50, 30], leaf = { ...poly, m }, { ed, canvas } = editor([leaf]);
  ed.emit = ed.redraw = () => {};
  const before = JSON.stringify(ed.doc);
  assert.equal(ed.startImageEdit(leaf.id), null);
  assert.equal(ed.setImageCornerRadius(null, 5), null);
  ed.render();
  const draw = canvas.calls.find(c => c.name === 'drawImage')!;
  const rounded: ImageShape = { ...perspective, edit: { ...perspective.edit, cornerRadii: [5, 5, 5, 5] } };
  const resolved = resolveImageContour(rounded, m); assert.ok(resolved.ok);
  const worldPoints = draw.clip!.points.map(p => apply(m, p.x, p.y));
  for (const c of resolved.contour.corners) assert.ok(worldPoints.some(p => Math.hypot(p.x - c.start.x, p.y - c.start.y) < 1e-8));
  assert.equal(JSON.stringify(ed.doc), before);
});
await test('rounded placeholder and array copies use each final world transform', () => {
  const s: ImageShape = { ...perspective, asset: 'not-decoded', edit: { ...perspective.edit, cornerRadii: [5, 5, 5, 5] } };
  const m: Mat = [1.2, .3, -.4, .9, 40, 30], leaf = { ...poly, shape: s, m };
  const { ed, canvas } = editor([leaf]);
  const copy: Mat = [-1.5, .2, .3, 1, 350, 20];
  ed.sel = [leaf]; ed.arrayPreview = [IDENT, copy];
  ed.render();
  const placeholder = canvas.calls.find(c => c.name === 'fill' && c.args[0] instanceof TestPath)!;
  assert.ok(placeholder);
  const worldPoints = placeholder.args[0].points.map((p: Pt) => apply(m, p.x, p.y));
  const first = resolveImageContour(s, m); assert.ok(first.ok);
  for (const c of first.contour.corners) assert.ok(worldPoints.some((p: Pt) => Math.hypot(p.x - c.start.x, p.y - c.start.y) < 1e-8));
  const outline = canvas.calls.filter(c => c.name === 'stroke' && c.args[0] instanceof TestPath).at(-1)!.args[0] as TestPath;
  const resolved = resolveImageContour(s, mul(copy, m)); assert.ok(resolved.ok);
  for (const c of resolved.contour.corners) assert.ok(outline.points.some(p => Math.hypot(p.x - c.start.x, p.y - c.start.y) < 1e-8));
});
await test('invalid radii and singular world matrices fail visibly without aborting the next image', () => {
  for (const invalid of [
    { ...poly, shape: { ...perspective, edit: { ...perspective.edit, cornerRadii: [-1] } } },
    { ...poly, m: [1, 0, 2, 0, 40, 30] as Mat },
  ]) {
    assert.equal(boundsOf([invalid]), null);
    assert.equal(hitLeaf(invalid, invalid.m, { x: 50, y: 50 }, .1, false), false);
    const { ed, canvas } = editor([invalid, { ...poly, id: 2 }]);
    ed.render();
    assert.match(statusRoot.textContent, /processing|Bildverarbeitung/i);
    assert.equal(canvas.calls.filter(c => c.name === 'drawImage').length, 1);
  }
});
await test('unexpected contour helper errors propagate rather than being relabeled as image failures', () => {
  const s = structuredClone(perspective), unexpected = new Error('programmer error resolving contour');
  Object.defineProperty(s.edit, 'cornerRadii', { get() { throw unexpected; } });
  const { ed } = editor([{ ...poly, shape: s }]);
  assert.throws(() => ed.render(), e => e === unexpected);
});
await test('actual Editor render places processed canvas in bbox and clips polygon under view+DPR+affine', () => {
  const m: Mat = [1.2, .3, -.4, .9, 40, 30], { ed, canvas } = editor([{ ...poly, m }]);
  ed.doc.layers[0].interval = .7;
  const before = JSON.stringify(ed.doc);
  ed.render();
  const draw = canvas.calls.find(c => c.name === 'drawImage')!;
  assert.ok(draw); assert.deepEqual(draw.args.slice(1), [10, 10, 90, 80]);
  assert.deepEqual(draw.matrix, mul([3, 0, 0, 3, 25.5, -34.5], m));
  assert.ok(draw.clip); assert.deepEqual(draw.clip.points.slice(0, 4), perspective.edit!.perspective);
  assert.equal(inside(draw.clip.points, 12, 12), false);
  assert.equal(canvas.ctx.imageSmoothingEnabled, false, 'full job grid keeps exact dots');
  assert.equal(JSON.stringify(ed.doc), before);
  assert.ok(canvas.calls.some(c => c.name === 'stroke' && c.args[0] instanceof TestPath));
});
await test('placeholder and array preview use visible polygon, not original rectangle', () => {
  const missing: Obj = { ...poly, shape: { ...perspective, asset: 'not-decoded' } }, { ed, canvas } = editor([missing]);
  ed.sel = [missing]; ed.arrayPreview = [IDENT, [1, 0, 0, 1, 150, 0]];
  ed.render();
  assert.equal(canvas.calls.filter(c => c.name === 'drawImage').length, 0);
  assert.ok(canvas.calls.some(c => c.name === 'fill' && c.args[0] instanceof TestPath && c.args[0].points[0].x === 30));
  const array = canvas.calls.filter(c => c.name === 'stroke' && c.args[0] instanceof TestPath).at(-1)!;
  assert.deepEqual(array.args[0].points.slice(0, 4), perspective.edit!.perspective!.map(p => ({ x: p.x + 150, y: p.y })));
});
await test('processing error is visible and does not abort next image', () => {
  const { ed, canvas } = editor([poly, { ...poly, id: 2, layer: 1 }]);
  ed.doc.layers[0].interval = .00001;
  ed.doc.layers[1] = { ...defaultLayer(1), interval: 10, img: defaultImageLayer() };
  ed.render();
  assert.ok(canvas.calls.some(c => c.name === 'fillText' && /processing|Bildverarbeitung/i.test(c.args[0])));
  assert.equal(canvas.calls.filter(c => c.name === 'drawImage').length, 1);
});
await test('unrelated imgOutput exception propagates from actual render', () => {
  const { ed } = editor([poly]);
  const unexpected = new Error('programmer error in layer settings');
  ed.imgOutput = () => { throw unexpected; };
  assert.throws(() => ed.render(), e => e === unexpected);
});
await test('unexpected processing programmer exception propagates from actual render', () => {
  const s = structuredClone(perspective), unexpected = new Error('programmer error in adjustment');
  Object.defineProperty(s.adjust, 'brightness', { get() { throw unexpected; } });
  const { ed } = editor([{ ...poly, shape: s }]);
  assert.throws(() => ed.render(), e => e === unexpected);
});
await test('unexpected canvas drawing exception is outside the processing boundary', () => {
  const { ed, canvas } = editor([poly]), unexpected = new Error('programmer error while drawing');
  canvas.ctx.drawImage = () => { throw unexpected; };
  assert.throws(() => ed.render(), e => e === unexpected);
});
await test('expected processing errors have polite status, no frame spam, recovery and deletion clearing', () => {
  const { ed, canvas } = editor([poly, { ...poly, id: 2 }, { ...poly, id: 3, layer: 1 }]);
  ed.doc.layers[0].interval = .00001;
  ed.doc.layers[1] = { ...defaultLayer(1), interval: 10, img: defaultImageLayer() };
  const active = { name: 'focused editor control' };
  g.document.activeElement = active;
  const before = JSON.stringify(ed.doc);
  ed.render();
  const region = statusRoot.children.find(c => c.getAttribute('role') === 'status');
  assert.ok(region, 'Production render must create an accessible status element');
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.getAttribute('aria-atomic'), 'true');
  assert.match(region.textContent, /processing|Bildverarbeitung/i);
  assert.match(region.textContent, /1:/); assert.match(region.textContent, /2:/);
  assert.equal(canvas.calls.filter(c => c.name === 'drawImage').length, 1);
  assert.equal(canvas.calls.filter(c => c.name === 'fillText' && /processing|Bildverarbeitung/i.test(c.args[0])).length, 2);
  assert.equal(JSON.stringify(ed.doc), before);
  const writes = region.writes;
  ed.render(); ed.render();
  assert.equal(region.writes, writes, 'Unchanged frames must not reannounce the same errors');
  assert.equal(statusRoot.children.length, 1);
  assert.equal(region.focusCalls, 0); assert.equal(g.document.activeElement, active);
  ed.doc.objs = ed.doc.objs.filter(o => o.id !== 2); ed.render();
  assert.match(region.textContent, /1:/); assert.doesNotMatch(region.textContent, /2:/);
  ed.doc.layers[0].interval = 10; ed.render();
  assert.equal(region.textContent, '');
  ed.doc.layers[0].interval = .00001; ed.render();
  assert.notEqual(region.textContent, '');
  ed.doc.objs = []; ed.render();
  assert.equal(region.textContent, '');
});
await test('invalid edits: no valid geometry/hit; explicit render error and top-level design error', () => {
  const bad = { ...image, edit: { crop: { left: 1, right: 0, top: 0, bottom: 1 } } }, leaf = { ...obj, shape: bad };
  assert.deepEqual(shapeSubs(bad), []); assert.equal(boundsOf([leaf]), null);
  assert.equal(hitLeaf(leaf, IDENT, { x: 50, y: 50 }, 1, false), false);
  const { ed, canvas } = editor([leaf, poly]); ed.render();
  assert.ok(canvas.calls.some(c => c.name === 'fillText' && /crop|Zuschnitt/i.test(c.args[0])));
  assert.match(statusRoot.textContent, /crop|Zuschnitt/i);
  assert.equal(canvas.calls.filter(c => c.name === 'drawImage').length, 1);
  const group: Obj = { ...obj, id: 5, shape: { kind: 'group', children: [leaf] } };
  assert.equal(checkDesign({ objs: [group], layer: defaultLayer, bed: { w: 200, h: 200 }, settings: DEFAULT_CHECK })[0].objs[0], group);
});
await test('design and parking agree on crop outside bed while original overlaps', () => {
  const parked = { ...obj, m: [1, 0, 0, 1, 195, 20] as Mat };
  const insideObj: Obj = { id: 9, layer: 0, m: IDENT, shape: { kind: 'rect', w: 20, h: 20, r: 0 } };
  assert.ok(parkedObjs([parked, insideObj], { w: 200, h: 200 }, defaultLayer).has(parked));
  assert.equal(checkDesign({ objs: [parked, insideObj], layer: defaultLayer, bed: { w: 200, h: 200 }, settings: DEFAULT_CHECK }).some(x => x.kind === 'bed'), false);
});
await test('image-only group extending beyond bed is a top-level design error', () => {
  const group: Obj = { ...obj, id: 10, m: [1, 0, 0, 1, 150, 0], shape: { kind: 'group', children: [poly] } };
  const issue = checkDesign({ objs: [group], layer: defaultLayer, bed: { w: 200, h: 200 }, settings: DEFAULT_CHECK }).find(x => x.kind === 'bed');
  assert.ok(issue); assert.equal(issue.objs[0], group);
});
await test('actual grouped marquee enclosing and crossing selection uses edited geometry', () => {
  const group: Obj = { id: 20, layer: 0, m: [2, .25, -.25, 1.5, 40, 20], shape: { kind: 'group', children: [{ ...obj, m: [1, 0, 0, 1, 10, 10] }] } };
  const { ed } = editor([group]);
  Object.assign(ed, { history: new History(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(), batching: false,
    drag: null, snapHit: null, alignGuides: [], nodeEditObj: null, hint: '' });
  ed.emit = ed.redraw = () => {};
  const finish = (start: Pt, end: Pt) => {
    ed.drag = { type: 'marquee', start, end, base: [], mode: 'set' };
    ed.onUp({ pointerId: 1 } as PointerEvent);
  };
  const b = boundsOf([group])!;
  finish({ x: b.x - 1, y: b.y - 1 }, { x: b.x + b.w + 1, y: b.y + b.h + 1 });
  assert.deepEqual(ed.sel, [group]);
  const y = b.y + b.h / 2;
  finish({ x: b.x + b.w + 10, y: y - 1 }, { x: b.x - 10, y: y + 1 });
  assert.deepEqual(ed.sel, [group]);
});
await test('jobs reject invalid edited image before parking, independently of design checking', async () => {
  const bad: Obj = { ...obj, shape: { ...image, edit: { crop: { left: .9, right: .1, top: 0, bottom: 1 } } } };
  const outside: Obj = { id: 22, layer: 0, m: [1, 0, 0, 1, 900, 0], shape: { kind: 'group', children: [bad, { id: 23, layer: 0, m: IDENT, shape: { kind: 'rect', w: 10, h: 10, r: 0 } }] } };
  const doc = newDoc(); doc.objs = [outside, { id: 24, layer: 0, m: IDENT, shape: { kind: 'rect', w: 10, h: 10, r: 0 } }];
  await assert.rejects(buildJob({ doc, layer: defaultLayer, imgLayer: () => defaultImageLayer(), device: { ...newDevice({ fw: 'grbl' }), startFrom: 'absolute' } }),
    (e: any) => e.name === 'ImageProcessingError' && e.code === 'geometry');
});
await test('pending real render shows phase progress, keyboard cancel and a placeholder rather than stale pixels', () => {
  const s = structuredClone(image);
  s.edit = { crop: { left: .1234, top: 0, right: .9, bottom: 1 } };
  const leaf = { ...obj, shape: s, m: [1.1, .2, -.15, .9, 17, 13] as Mat };
  const { ed, canvas } = editor([leaf]);
  ed.doc.layers[0].img = { ...defaultImageLayer(), threshold: 77 };
  (canvas.style as any).cursor = 'crosshair';
  const before = JSON.stringify(s);
  SynchronousImageWorker.paused = true;
  try {
    ed.render();
    assert.equal(imageDisplayActivity(leaf)?.pending, true);
    assert.equal((canvas.style as any).cursor, 'progress');
    assert.equal(canvas.calls.some(call => call.name === 'drawImage'), false, 'pending geometry uses a placeholder');
    const root = statusRoot.children.find(child => child.getAttribute('role') === 'group') as any;
    assert.ok(root);
    const [label, progress, button] = root.children;
    assert.equal(label.getAttribute('role'), 'status');
    assert.equal(label.getAttribute('aria-live'), 'polite');
    assert.equal(progress.getAttribute('aria-label'), t('Vorschau'));
    assert.equal(progress.max, 4); assert.equal(progress.value, 0);
    assert.equal(button.textContent, t('Abbrechen')); assert.equal(button.style.minHeight, '24px');
    SynchronousImageWorker.phase(2); ed.render();
    assert.equal(progress.value, 2);
    g.document.activeElement = button;
    let prevented = false, stopped = false;
    root.onkeydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented, true); assert.equal(stopped, true);
    assert.equal(imageDisplayActivity(leaf), null);
    const queued = SynchronousImageWorker.pending.length;
    canvas.calls = []; ed.render();
    assert.equal(imageDisplayActivity(leaf), null, 'abort does not silently requeue the same key');
    assert.equal(SynchronousImageWorker.pending.length, queued, 'no worker job queued after abort');
    assert.equal(root.hidden, true); assert.equal(canvas.focusCalls, 1);
    assert.equal((canvas.style as any).cursor, 'crosshair');
    assert.equal(canvas.calls.some(call => call.name === 'drawImage'), false);
    assert.equal(JSON.stringify(s), before);
  } finally {
    SynchronousImageWorker.paused = false;
    SynchronousImageWorker.pending = [];
    g.document.activeElement = null;
  }
});
console.log(`${passed} visible geometry groups passed; ${failed} failed`);
if (failed) process.exitCode = 1;
