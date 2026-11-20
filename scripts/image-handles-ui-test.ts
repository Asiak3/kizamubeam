import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc, newId } from '../src/model';
import type { Obj } from '../src/model';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); count++; console.log(`PASS ${name}`); }
  catch (err) { process.exitCode = 1; console.error(`FAIL ${name}`, err); }
}

function editor(objects: Obj[]): any {
  const ed = Object.create(Editor.prototype) as any;
  Object.assign(ed, { doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 2, ox: 10, oy: 5 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: true, snapObjects: true, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    gridStep: 1, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  (ed as any).doc.objs = [...objects];
  ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}
const imgObj = (extra: Partial<Obj> = {}): Obj => ({ id: newId(), m: [1, 0, 0, 1, 0, 0] as any, layer: 0,
  shape: { kind: 'image', w: 100, h: 50, asset: 'a', ...(extra as any).shape ?? {} }, ...extra } as Obj);

// REAL entry points: toolbar/menu starters, overlay hit-testing, screen<->local, keyboard.
const ui = await import('../src/imageCropUi');
assert.ok(ui.singleImageSel, 'singleImageSel missing');
assert.ok(ui.startImageEditForSel, 'startImageEditForSel missing');
assert.ok(ui.hitImageCropHandle, 'hitImageCropHandle missing');
assert.ok(ui.screenToImageLocal, 'screenToImageLocal missing');
assert.ok(ui.handleImageCropKey, 'handleImageCropKey missing');

await test('toolbar starters disabled unless exactly one image', () => {
  const a = imgObj(); const b = imgObj(); const r: Obj = { id: newId(), m: [1, 0, 0, 1, 0, 0] as any, layer: 0, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as any };
  const ed = editor([a]);
  ed.sel = [a]; assert.equal(ui.cropDraftEnabled(ed), true);
  ed.sel = [a, b]; assert.equal(ui.cropDraftEnabled(ed), false);
  ed.sel = [r]; assert.equal(ui.cropDraftEnabled(ed), false);
  ed.sel = []; assert.equal(ui.cropDraftEnabled(ed), false);
});

await test('overlay hit-testing under rotated m + zoom2 + offsets', () => {
  const m = [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5), 30, 40] as any;
  const o = imgObj({ m }); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  ed.view = { zoom: 2, ox: 10, oy: 5 };
  assert.equal(ui.startImageEditForSel(ed), null);
  const pts = ui.cropHandleScreens(ed, o.id);
  assert.equal(pts.length, 8);
  // every handle hit-tests back to itself despite rotation/zoom/offset
  for (const p of pts) {
    const hit = ui.hitImageCropHandle(ed, p.screen.x, p.screen.y);
    assert.ok(hit && hit.mode === 'crop' && hit.handle === p.handle, `miss ${p.handle}`);
  }
  // screen->local roundtrip through REAL view transform
  const tl = pts.find((p: any) => p.handle === 'tl')!;
  const local = ui.screenToImageLocal(ed, o, tl.screen.x, tl.screen.y);
  assert.ok(Math.abs(local.x - 0) < 1e-6 && Math.abs(local.y - 0) < 1e-6);
});

await test('pointer drag path calls logic with modifiers preserved', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed), null);
  // simulate pointer drag on right edge: screen pos of local (90,25)
  const s = ed.toScreen({ x: 90, y: 25 } as any);
  const err = ui.pointerCropTo(ed, s.x, s.y, { aspectLock: false, snap: false });
  assert.equal(err, null);
  assert.equal(ed.imageCropPreview(o.id)!.right, 0.9);
  ed.cancelImageDraft();
});

await test('locked corner pointer drag preserves crop ratio under rotation and zoom', () => {
  const o = imgObj({ shape: { kind: 'image', w: 200, h: 100, asset: 'a' },
    m: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5), 30, 40] as any });
  const ed = editor([o]);
  assert.equal(ui.startImageEditForSel(ed), null);
  const br = ui.cropHandleScreens(ed, o.id).find((p) => p.handle === 'br')!;
  assert.deepEqual(ui.hitImageCropHandle(ed, br.screen.x, br.screen.y), { mode: 'crop', handle: 'br' });
  const [a, b, c, d, tx, ty] = o.m;
  const target = ed.toScreen({ x: a * 160 + c * 80 + tx, y: b * 160 + d * 80 + ty });
  assert.equal(ui.pointerCropTo(ed, target.x, target.y, { aspectLock: true, snap: true }), null);
  const crop = ed.imageCropPreview(o.id)!;
  assert.ok(Math.abs(crop.right - 0.8) < 1e-9);
  assert.ok(Math.abs(crop.bottom - 0.8) < 1e-9);
  assert.equal(crop.left, 0); assert.equal(crop.top, 0);
  ed.cancelImageDraft();
});

await test('draft->apply->undo->cancel flows via real starters', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  const before = ed.history.position;
  assert.equal(ui.startImageEditForSel(ed), null);
  ui.pointerCropTo(ed, ed.toScreen({ x: 90, y: 25 } as any).x, ed.toScreen({ x: 90, y: 25 } as any).y, { snap: false });
  assert.equal(ed.applyImageDraft(), null);
  assert.equal(ed.history.position, before + 1);
  ed.doUndo();
  assert.equal((ed.doc.objs.find((x: Obj) => x.shape.kind === 'image')!.shape as any).edit, undefined);
  assert.equal(ui.startImageEditForSel(ed, 'perspective'), null);
  ed.cancelImageDraft();
  assert.equal(ed.imageDraft(), null);
});

await test('invalid quad rejection is visible text with cause+fix', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed, 'perspective'), null);
  const err = ed.setImagePerspectiveCorner(0, { x: 90, y: 40 });
  assert.ok(err && /Ursache/.test(err) && /Behebung/.test(err));
  ui.showImageError(ed, err);
  assert.ok(/Ursache/.test(ed.hint) && /Behebung/.test(ed.hint));
  ed.cancelImageDraft();
});

await test('keyboard paths: arrows nudge, esc cancel, enter apply', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed), null);
  assert.equal(ui.handleImageCropKey(ed, { key: 'ArrowLeft', shiftKey: false } as any), true);
  const prev = ed.imageCropPreview(o.id)!;
  assert.ok(prev.right < 1);
  assert.equal(ui.handleImageCropKey(ed, { key: 'Enter' } as any), true);
  assert.equal(ed.imageDraft(), null);
  assert.equal(ui.startImageEditForSel(ed), null);
  assert.equal(ui.handleImageCropKey(ed, { key: 'Escape' } as any), true);
  assert.equal(ed.imageDraft(), null);
});

await test('draft dialog is modeless: canvas handles stay usable', () => {
  const prevDoc = (globalThis as any).document;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  class FakeEl {
    tag: string; attrs: Record<string, string> = {}; style: Record<string, string> = {};
    children: unknown[] = []; listeners: Record<string, ((...a: any[]) => void)[]> = {};
    textContent = ''; modeless = false; modal = false; closed = false;
    constructor(tag: string) { this.tag = tag; }
    addEventListener(type: string, fn: (...a: any[]) => void) { (this.listeners[type] ??= []).push(fn); }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    append(...cs: unknown[]) { this.children.push(...cs); return this.children.length; }
    replaceChildren(...cs: unknown[]) { this.children = [...cs]; }
    querySelector() { return null; }
    closest() { return null; }
    remove() {}
    focus() { (globalThis as any).document.activeElement = this; }
    show() { this.modeless = true; }
    showModal() { this.modal = true; }
    close() {
      if (this.closed) return;
      this.closed = true;
      for (const fn of this.listeners.close ?? []) fn();
    }
  }
  const dialogs: any[] = [];
  (globalThis as any).document = {
    querySelector: () => null,
    createElement: (tag: string) => new FakeEl(tag),
    body: { append: (el: unknown) => { dialogs.push(el); } },
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  try {
    for (const tab of ['crop', 'perspective'] as const) {
      const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
      assert.equal(ui.runImageEdit(ed, tab), null);
      assert.equal(dialogs.length, 1);
      const dlg = dialogs.pop();
      assert.equal(dlg.modeless, true);
      assert.equal(dlg.modal, false);
      const d = ed.imageDraft();
      assert.ok(d);
      if (d.tab === 'crop') {
        const pts = ui.cropHandleScreens(ed, o.id);
        const hit = ui.hitImageCropHandle(ed, pts[0].screen.x, pts[0].screen.y);
        assert.ok(hit && hit.mode === 'crop');
      } else {
        const pts = ui.perspectiveCornerScreens(ed, o.id);
        const hit = ui.hitImageCropHandle(ed, pts[0].screen.x, pts[0].screen.y);
        assert.ok(hit && hit.mode === 'perspective');
      }
      if (tab === 'crop') assert.equal((globalThis as any).document.activeElement.attrs.id, 'imgcrop-l');
      let stopped = false, prevented = false;
      for (const fn of dlg.listeners.keydown ?? []) fn({ key: 'ArrowLeft', target: (globalThis as any).document.activeElement,
        stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
      assert.equal(prevented, false, 'input arrow keys must retain their native behavior');
      assert.equal(dlg.closed, false);
      for (const fn of dlg.listeners.keydown ?? []) fn({ key: 'Escape', target: (globalThis as any).document.activeElement,
        stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
      assert.equal(stopped, true);
      assert.equal(prevented, true);
      assert.equal(dlg.closed, true, 'Escape inside the modeless dialog must close it');
      assert.equal(ed.imageDraft(), null);
    }
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).requestAnimationFrame = prevRaf;
  }
});

await test('numeric fields track handles and commits apply (incl. percent on wide image)', () => {
  const prevDoc = (globalThis as any).document;
  const prevRaf = (globalThis as any).requestAnimationFrame;
  class FakeEl2 {
    tag: string; attrs: Record<string, string> = {}; style: Record<string, string> = {};
    children: unknown[] = []; listeners: Record<string, ((...a: any[]) => void)[]> = {};
    textContent = ''; closed = false;
    constructor(tag: string) { this.tag = tag; }
    addEventListener(type: string, fn: (...a: any[]) => void) { (this.listeners[type] ??= []).push(fn); }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    append(...cs: unknown[]) { this.children.push(...cs); return this.children.length; }
    replaceChildren(...cs: unknown[]) { this.children = [...cs]; }
    querySelector() { return null; }
    closest() { return null; }
    remove() {}
    focus() { (globalThis as any).document.activeElement = this; }
    show() {}
    showModal() {}
    close() {
      if (this.closed) return;
      this.closed = true;
      for (const fn of this.listeners.close ?? []) fn();
    }
  }
  const created: any[] = [];
  const dialogs: any[] = [];
  (globalThis as any).document = {
    querySelector: () => null,
    createElement: (tag: string) => { const el = new FakeEl2(tag); created.push(el); return el; },
    body: { append: (el: unknown) => { dialogs.push(el); } },
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  try {
    const o = imgObj({ shape: { kind: 'image', w: 200, h: 100, asset: 'a' },
      m: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5), 30, 40] as any });
    const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
    assert.equal(ui.runImageEdit(ed, 'crop'), null);
    const find = (id: string) => created.find((el) => el.attrs.id === id);
    // handle drag -> dialog field follows
    const fL = find('imgcrop-l') as any;
    fL.value = '2*10';
    const [a, b, c, d, tx, ty] = o.m;
    const s = ed.toScreen({ x: a * 180 + c * 50 + tx, y: b * 180 + d * 50 + ty });
    assert.equal(ui.pointerCropTo(ed, s.x, s.y, { aspectLock: false, snap: false }), null);
    assert.equal((find('imgcrop-r') as any)?.value, '180');
    assert.equal(fL.value, '2*10', 'draft refresh must not replace a focused expression');
    fL.value = '20';
    for (const fn of fL.listeners.input ?? []) fn();
    assert.ok(Math.abs(ed.imageCropPreview(o.id)!.right - 0.9) < 1e-9, 'editing left must retain the dragged right edge');
    (globalThis as any).document.activeElement = null;
    // numeric commit -> draft follows (percent of 200mm width)
    const sel = find('imgcrop-unit') as any;
    sel.value = 'percent';
    for (const fn of sel.listeners.change ?? []) fn({ target: sel });
    fL.value = '10';
    for (const fn of fL.listeners.input ?? []) fn();
    const prev = ed.imageCropPreview(o.id)!;
    assert.ok(Math.abs(prev.left - 0.1) < 1e-9, `left ${prev.left} != 0.1`);
    assert.ok(Math.abs(prev.right - 0.9) < 1e-9, 'percent commit must retain the dragged right edge');
    // reset keeps the tool open: draft active, dialog not closed
    const dlg = dialogs[0];
    const btns: any[] = [];
    const walk = (el: any) => { if (!el || typeof el !== 'object') return; if (el.tag === 'button') btns.push(el); for (const c of el.children ?? []) walk(c); };
    walk(dlg);
    const reset = btns.find((b) => (b.children ?? []).includes('Bildzuschnitt zurücksetzen'));
    assert.ok(reset, 'reset button missing');
    for (const fn of reset.listeners.click ?? []) fn();
    assert.ok(ed.imageDraft(), 'draft ended by reset');
    assert.equal(dlg.closed, false);
    assert.deepEqual(ed.imageCropPreview(o.id), { left: 0, top: 0, right: 1, bottom: 1 });
    fL.value = '10';
    for (const fn of fL.listeners.input ?? []) fn();
    assert.deepEqual(ed.imageCropPreview(o.id), { left: 0.1, top: 0, right: 1, bottom: 1 }, 'numeric edits after Reset must use the reset edges');
    dlg.close();
    assert.equal(ed.imageDraft(), null);
  } finally {
    (globalThis as any).document = prevDoc;
    (globalThis as any).requestAnimationFrame = prevRaf;
  }
});

await test('perspective apply persists the moved corner', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed, 'perspective'), null);
  assert.equal(ed.setImagePerspectiveCorner(2, { x: 90, y: 45 }, { snap: false }), null);
  assert.equal(ed.applyImageDraft(), null);
  const q = (o.shape as any).edit?.perspective;
  assert.ok(q, 'perspective missing after apply');
  assert.ok(Math.abs(q[2].x - 90) < 1e-9 && Math.abs(q[2].y - 45) < 1e-9);
  ed.doUndo();
  const o2 = ed.doc.objs.find((x: Obj) => x.shape.kind === 'image')!;
  assert.equal((o2.shape as any).edit, undefined);
});

await test('crop rect follows perspective warp (and unwarps on drag)', () => {
  const o = imgObj({ m: [1, 0, 0, 1, 30, 40] as any }); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed, 'perspective'), null);
  assert.equal(ed.setImagePerspectiveCorner(2, { x: 90, y: 45 }, { snap: false }), null);
  ed.setImageEditTab('crop');
  const crop = ui.cropHandleScreens(ed, o.id);
  const quad = ui.perspectiveCornerScreens(ed, o.id);
  for (const [name, idx] of [['tl', 0], ['tr', 1], ['br', 2], ['bl', 3]] as const) {
    const c = crop.find((p: any) => p.handle === name)!.screen;
    const q = quad[idx].screen;
    assert.ok(Math.hypot(c.x - q.x, c.y - q.y) < 1e-6, `${name} folgt der Perspektive nicht`);
  }
  // Zeiger auf der verzerrten br-Ecke darf den Zuschnitt nicht verändern (Entzerrung).
  const br = crop.find((p: any) => p.handle === 'br')!;
  assert.equal(ui.pointerCropTo(ed, br.screen.x, br.screen.y, { snap: false }), null);
  const prev = ed.imageCropPreview(o.id)!;
  assert.ok(Math.abs(prev.left) < 1e-9 && Math.abs(prev.top) < 1e-9 && Math.abs(prev.right - 1) < 1e-9 && Math.abs(prev.bottom - 1) < 1e-9);
  ed.cancelImageDraft();
});

console.log(`DONE ${count}`);
