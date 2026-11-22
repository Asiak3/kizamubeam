import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { apply, newDoc, newId, type Mat, type Obj, type Pt } from '../src/model';
import { imageDraftContour } from '../src/editor/imageHandles';
import * as ui from '../src/imageCropUi';

let passed = 0, failed = 0;
const hosts = new WeakMap<Editor, ReturnType<typeof browserHost>>();
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (err) { failed++; console.error(`FAIL ${name}: ${err}`); }
}
// Browser boundary only: the constructor, installed event closures, redraw/RAF
// and complete production render remain real, including rectangle paths/grips.
class TestTarget {
  listeners = new Map<string, Function[]>();
  style = {}; tagName = 'CANVAS'; classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  clientWidth = 1000; clientHeight = 900; width = 2000; height = 1800;
  addEventListener(type: string, fn: Function) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener() {}
  dispatchEvent(e: any) { e.target ??= this; for (const fn of this.listeners.get(e.type) ?? []) fn(e); return !e.defaultPrevented; }
  append() {} remove() {} setAttribute() {} focus() {}
  setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 11, top: 17, width: this.clientWidth, height: this.clientHeight }; }
}
class TestPath {
  ops: unknown[][] = [];
  addPath(...args: unknown[]) { this.ops.push(['addPath', ...args]); }
  moveTo(...args: number[]) { this.ops.push(['moveTo', ...args]); }
  lineTo(...args: number[]) { this.ops.push(['lineTo', ...args]); }
  bezierCurveTo(...args: number[]) { this.ops.push(['bezierCurveTo', ...args]); }
  quadraticCurveTo(...args: number[]) { this.ops.push(['quadraticCurveTo', ...args]); }
  arc(...args: number[]) { this.ops.push(['arc', ...args]); }
  arcTo(...args: number[]) { this.ops.push(['arcTo', ...args]); }
  ellipse(...args: number[]) { this.ops.push(['ellipse', ...args]); }
  rect(...args: number[]) { this.ops.push(['rect', ...args]); }
  roundRect(...args: unknown[]) { this.ops.push(['roundRect', ...args]); }
  closePath() { this.ops.push(['closePath']); }
}
function browserHost() {
  let frames: FrameRequestCallback[] = [];
  const draws: any[][] = [];
  const ctx = new Proxy({ measureText: () => ({ width: 30 }), getLineDash: () => [] } as any, {
    get(target, key) { return target[key] ?? ((...args: unknown[]) => draws.push([key, ...args])); },
  });
  const canvas = Object.assign(new TestTarget(), { getContext: () => ctx });
  const win = Object.assign(new TestTarget(), { devicePixelRatio: 2, setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.assign(globalThis, { window: win, localStorage: storage, sessionStorage: storage,
    document: Object.assign(new TestTarget(), { documentElement: new TestTarget(), body: new TestTarget(), querySelector: () => null,
      createElement: () => Object.assign(new TestTarget(), { getContext: () => ctx }) }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} }, Path2D: TestPath,
    DOMMatrix: class { constructor(public values: number[]) {} },
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {},
  });
  const flush = () => { const pending = frames; frames = []; pending.forEach(fn => fn(0)); };
  return { canvas, win, draws, flush };
}
function fixture(kind: 'image' | 'rect' = 'image', m: Mat = [1.7, .8, .4, -1.3, 130, 170]) {
  const o: Obj = { id: newId(), m, layer: 0, shape: kind === 'image'
    ? { kind, w: 100, h: 50, asset: 'a' } : { kind, w: 100, h: 50, r: 5 } };
  const host = browserHost();
  const ed = new Editor(host.canvas as unknown as HTMLCanvasElement) as any;
  hosts.set(ed, host);
  ed.doc = newDoc(); ed.doc.objs = [o]; ed.sel = [o];
  ed.view = { zoom: 3, ox: 71, oy: 43 }; ed.dpr = 2;
  host.flush();
  return { ed, o, ...host };
}
const event = (p: Pt, extra = {}) => ({ clientX: p.x + 11, clientY: p.y + 17, pointerId: 1, button: 0,
  shiftKey: false, ctrlKey: true, metaKey: false, altKey: false, pointerType: 'mouse',
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, defaultPrevented: false, ...extra }) as any;
function send(ed: Editor, type: string, e: any) { ed.canvas.dispatchEvent({ ...e, type }); hosts.get(ed)!.flush(); }
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function contour(ed: any, id: number) {
  const r = imageDraftContour(ed, id); assert.ok(r?.ok); return r.contour;
}
function escape(ed: any) {
  window.dispatchEvent({ type: 'keydown', key: 'Escape', code: 'Escape', target: ed.canvas,
    preventDefault() {}, defaultPrevented: false } as any);
  hosts.get(ed)!.flush();
}

for (const cancel of ['escape', 'pointercancel'] as const) {
  for (const moved of [false, true]) test(`rectangle ${cancel}, moved=${moved}: radius/history/redo restored`, () => {
    const { ed } = fixture('rect');
    ed.snapshot('prior change'); ed.doc.objs[0].shape.r = 7; ed.doUndo();
    const o = ed.doc.objs[0]; const before = ed.state(), redo = ed.history.saveRedo();
    send(ed, 'pointerdown', event(ed.rectRadiusScreen())); assert.equal(ed.drag?.type, 'rect-radius');
    if (moved) send(ed, 'pointermove', event(ed.toScreen(apply(o.m, 12, 12))));
    if (cancel === 'escape') escape(ed); else send(ed, 'pointercancel', event(ed.rectRadiusScreen()));
    assert.equal(ed.drag, null); assert.equal(ed.state(), before);
    assert.equal(ed.history.position, 0); assert.deepEqual(ed.history.saveRedo(), redo);
    send(ed, 'pointerup', event(ed.toScreen(apply(o.m, 12, 12)))); assert.equal(ed.history.position, 0);
  });
}
test('rectangle successful release creates one undo; undo restores radius', () => {
  const { ed, o, draws, flush } = fixture('rect'); const before = ed.state();
  const startGrip = draws.findLast(op => op[0] === 'arc' && op[3] === 5);
  assert.ok(startGrip, 'real render draws radius grip');
  assert.deepEqual(draws.find(op => op[0] === 'setTransform'), ['setTransform', 2, 0, 0, 2, 0, 0]);
  const pathFrame = () => {
    const start = draws.findLastIndex(op => op[0] === 'fillRect' && op[1] === 0 && op[2] === 0
      && op[3] === ed.canvas.width / ed.dpr && op[4] === ed.canvas.height / ed.dpr);
    return JSON.stringify(draws.slice(start).filter(op => op[0] === 'stroke'));
  };
  const beforePaths = pathFrame();
  send(ed, 'pointerdown', event({ x: startGrip[1], y: startGrip[2] }));
  send(ed, 'pointermove', event(ed.toScreen(apply(o.m, 12, 12))));
  send(ed, 'pointermove', event(ed.toScreen(apply(o.m, 14, 14)))); flush();
  assert.notEqual(pathFrame(), beforePaths, 'actual rectangle paths change, not just call count');
  const movedGrip = draws.findLast(op => op[0] === 'arc' && op[3] === 5);
  assert.notDeepEqual(movedGrip, startGrip, 'real radius grip moves');
  send(ed, 'pointerup', event(ed.rectRadiusScreen())); assert.ok(o.shape.kind === 'rect');
  close(o.shape.r, 14); assert.equal(ed.history.position, 1);
  ed.doUndo(); flush(); assert.equal(ed.state(), before); assert.equal(pathFrame(), beforePaths);
  ed.doRedo(); flush(); close(ed.doc.objs[0].shape.r, 14);
});
test('rectangle click without movement preserves undo and redo', () => {
  const { ed } = fixture('rect'); ed.snapshot('prior'); ed.doc.objs[0].shape.r = 7; ed.doUndo();
  const redo = ed.history.saveRedo(); send(ed, 'pointerdown', event(ed.rectRadiusScreen())); send(ed, 'pointerup', event(ed.rectRadiusScreen()));
  assert.equal(ed.history.position, 0); assert.deepEqual(ed.history.saveRedo(), redo);
});

for (const backtrack of [false, true]) test(`registered radius gesture numerical no-op, backtrack=${backtrack}`, () => {
  const { ed, draws, flush } = fixture('rect');
  ed.snapshot('prior'); ed.doc.objs[0].shape.r = 7; ed.doUndo(); flush();
  const o = ed.doc.objs[0], before = ed.state(), redo = ed.history.saveRedo();
  const grip = draws.findLast(op => op[0] === 'arc' && op[3] === 5);
  assert.ok(grip); const start = { x: grip[1], y: grip[2] };
  send(ed, 'pointerdown', event(start));
  if (backtrack) send(ed, 'pointermove', event(ed.toScreen(apply(o.m, 12, 12))));
  send(ed, 'pointermove', event(start)); flush(); send(ed, 'pointerup', event(start)); flush();
  assert.equal(o.shape.r, 5, 'original radius restored exactly');
  assert.equal(ed.state(), before); assert.equal(ed.history.position, 0); assert.deepEqual(ed.history.saveRedo(), redo);
  ed.doRedo(); assert.equal(ed.doc.objs[0].shape.r, 7); ed.doUndo(); assert.equal(ed.state(), before);
});
for (const delta of [1e-6, 1e-9]) test(`registered radius drag retains a genuine ${delta} mm edit`, () => {
  const { ed, o } = fixture('rect');
  send(ed, 'pointerdown', event(ed.rectRadiusScreen()));
  send(ed, 'pointermove', event(ed.toScreen(apply(o.m, 5 + delta, 5 + delta))));
  send(ed, 'pointerup', event(ed.rectRadiusScreen()));
  assert.ok(o.shape.kind === 'rect'); assert.notEqual(o.shape.r, 5);
  close(o.shape.r, 5 + delta); assert.equal(ed.history.position, 1);
});
test('registered Shift+arrow changes only visible corner radii, preserving hidden requests', () => {
  const { ed, o } = fixture(); ed.startImageEdit(o.id, 'rounding');
  ed.imageDraft().cornerRadii = [1, 2, 3, 4, 11, 12, 13, 14];
  window.dispatchEvent({ type: 'keydown', key: 'ArrowRight', code: 'ArrowRight', shiftKey: true,
    target: ed.canvas, preventDefault() {}, defaultPrevented: false } as any);
  assert.deepEqual(ed.imageDraft().cornerRadii, [1.5, 2.5, 3.5, 4.5, 11, 12, 13, 14]);
  assert.equal(ed.history.position, 0);
});

test('cropped image: rendered/hittable grips follow all final contour vertices', () => {
  const { ed, o } = fixture(); ed.startImageEdit(o.id, 'crop');
  assert.equal(ed.setImageCropNumeric({ left: 20, top: 10, right: 80, bottom: 40, unit: 'mm' }), null);
  ed.setImageEditTab('rounding');
  const corners = contour(ed, o.id).corners, grips = ui.roundingHandleScreens(ed, o.id);
  assert.equal(grips.length, corners.length);
  const drawn: Pt[] = [];
  ui.renderImageCropOverlay(ed, { save() {}, restore() {}, beginPath() {}, fill() {}, fillText() {},
    arc(x: number, y: number) { drawn.push({ x, y }); } } as any);
  corners.forEach((c, i) => {
    const p = ed.toScreen(c.vertex); close(grips[i].screen.x, p.x); close(grips[i].screen.y, p.y);
    close(drawn[i].x, p.x); close(drawn[i].y, p.y);
    send(ed, 'pointerdown', event(p)); assert.equal(ed.drag?.mode, 'rounding'); assert.equal(ed.drag.handle, i);
    send(ed, 'pointerup', event(p));
  });
});
test('clipped eight-corner image: every visible corner has a stable drag index and one Apply/Undo', () => {
  const { ed, o } = fixture(); const before = ed.state();
  ed.startImageEdit(o.id, 'perspective');
  const quad = [{ x: 50, y: -20 }, { x: 120, y: 25 }, { x: 50, y: 70 }, { x: -20, y: 25 }];
  // Set the complete valid quad as one draft fixture; production resolves/clips it below.
  ed.imageDraft().quad = quad; ed.setImageEditOrder('perspectiveFirst');
  ed.setImageEditTab('crop');
  assert.equal(ed.setImageCropNumeric({ left: 10, top: 5, right: 90, bottom: 45, unit: 'mm' }), null);
  ed.setImageEditTab('rounding');
  const corners = contour(ed, o.id).corners; assert.equal(corners.length, 8, 'production clipped contour');
  assert.equal(ui.roundingHandleScreens(ed, o.id).length, 8, 'one grip per clipped corner');
  for (let i = 0; i < corners.length; i++) {
    const grip = ui.roundingHandleScreens(ed, o.id)[i]; send(ed, 'pointerdown', event(grip.screen));
    assert.equal(ed.drag?.handle, i);
    const target = ed.toScreen({ x: corners[i].vertex.x + 2, y: corners[i].vertex.y });
    send(ed, 'pointermove', event(target)); send(ed, 'pointerup', event(target)); close(ed.imageDraft().cornerRadii[i], 2);
    assert.equal(ed.history.position, 0);
  }
  assert.equal(ed.applyImageDraft(), null); assert.equal(ed.history.position, 1);
  assert.equal((o.shape as any).edit.cornerRadii.length, 8);
  ed.doUndo(); assert.equal(ed.state(), before);
});
for (const m of [[2, 0, 0, 2, 130, 170], [1.7, .8, .4, -1.3, 130, 170]] as Mat[]) {
  test(`image drag uses world-mm under matrix ${m.slice(0, 4)}`, () => {
    const { ed, o } = fixture('image', m); const before = ed.state();
    ed.startImageEdit(o.id, 'rounding'); ed.setImageCornerRadius(0, 6);
    const corner = contour(ed, o.id).corners[0]; const grip = ui.roundingHandleScreens(ed, o.id)[0];
    const w = ed.toWorld(grip.screen.x, grip.screen.y);
    close(Math.hypot(w.x - corner.vertex.x, w.y - corner.vertex.y), 6);
    send(ed, 'pointerdown', event(grip.screen)); assert.equal(ed.drag?.mode, 'rounding');
    // No initial jump, including reflection/Y-up, then a known 10 world-mm distance.
    send(ed, 'pointermove', event(grip.screen)); close(ed.imageDraft().cornerRadii[0], 6);
    const target = ed.toScreen({ x: corner.vertex.x + 6, y: corner.vertex.y + 8 });
    send(ed, 'pointermove', event(target)); send(ed, 'pointerup', event(target)); close(ed.imageDraft().cornerRadii[0], 10);
    assert.equal(ed.history.position, 0); assert.equal(ed.applyImageDraft(), null);
    assert.equal(ed.history.position, 1); ed.doUndo(); assert.equal(ed.state(), before);
  });
}
test('Shift drag changes all visible world-mm radii by the same delta; Escape discards draft', () => {
  const { ed, o } = fixture(); const before = ed.state(); ed.startImageEdit(o.id, 'rounding');
  [2, 3, 4, 5].forEach((r, i) => ed.setImageCornerRadius(i, r));
  const corner = contour(ed, o.id).corners[0]; const grip = ui.roundingHandleScreens(ed, o.id)[0];
  send(ed, 'pointerdown', event(grip.screen, { shiftKey: true }));
  const target = ed.toScreen({ x: corner.vertex.x + 6, y: corner.vertex.y + 8 });
  send(ed, 'pointermove', event(target, { shiftKey: true })); send(ed, 'pointerup', event(target, { shiftKey: true }));
  ed.imageDraft().cornerRadii.forEach((r: number, i: number) => close(r, 10 + i));
  escape(ed); assert.equal(ed.imageDraft(), null); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
});

console.log(`DONE ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
