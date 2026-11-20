import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc, newId, type Obj } from '../src/model';
import { imageDraftContour, imageDraftEdit } from '../src/editor/imageHandles';
import * as ui from '../src/imageCropUi';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); count++; console.log(`PASS ${name}`); }
  catch (err) { process.exitCode = 1; console.error(`FAIL ${name}`, err); }
}
function fixture(radii?: number[]) {
  const o: Obj = { id: newId(), m: [1, 0, 0, 1, 30, 40], layer: 0,
    shape: { kind: 'image', w: 100, h: 50, asset: 'a', ...(radii ? { edit: { cornerRadii: radii } } : {}) } };
  const ed = Object.create(Editor.prototype) as any;
  Object.assign(ed, { doc: newDoc(), sel: [o], tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 2, ox: 10, oy: 5 }, listeners: new Set(), isolation: null,
    builderSession: null, currentLayer: 0, snapHit: null, snapVer: 0, hint: '', jointPicks: [], clipboard: [], dpr: 2 });
  ed.doc.objs = [o]; ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return { ed, o };
}

await test('rounding draft clones radii; Apply serializes once and Undo restores', () => {
  const requested = [2, 3, 4, 5, 6, 7, 8, 9];
  const { ed, o } = fixture(requested);
  assert.equal(ui.startImageEditForSel(ed, 'rounding' as any), null);
  assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, requested);
  assert.notEqual(imageDraftEdit(ed, o.id)?.cornerRadii, requested);
  assert.equal(ed.setImageCornerRadius(0, 12), null);
  const preview = imageDraftEdit(ed, o.id)!;
  (preview.cornerRadii as number[])[0] = 99;
  assert.equal(imageDraftEdit(ed, o.id)?.cornerRadii?.[0], 12);
  assert.deepEqual((o.shape as any).edit.cornerRadii, requested);
  assert.equal(ed.history.position, 0);
  assert.equal(ed.applyImageDraft(), null);
  assert.equal(ed.history.position, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(o)).shape.edit.cornerRadii, [12, ...requested.slice(1)]);
  ed.doUndo();
  assert.deepEqual((ed.doc.objs[0].shape as any).edit.cornerRadii, requested);
});

await test('rounding tab never dispatches perspective handles or key nudges', () => {
  const { ed, o } = fixture();
  assert.equal(ui.startImageEditForSel(ed, 'rounding' as any), null);
  const p = ui.perspectiveCornerScreens(ed, o.id)[0].screen;
  assert.equal(ui.hitImageCropHandle(ed, p.x, p.y), null);
  assert.equal(ui.handleImageCropKey(ed, { key: 'ArrowLeft' }), false);
  assert.equal(ui.pointerCropTo(ed, p.x + 10, p.y), null);
  assert.deepEqual(ed.imageDraft().quad[0], { x: 0, y: 0 });
  assert.equal(ui.handleImageCropKey(ed, { key: 'Escape' }), true);
  assert.equal(ed.history.position, 0);
});

await test('common radius, individual radius and isolated resets preserve full draft state', () => {
  const { ed, o } = fixture([1, 2, 3, 4, 11, 12, 13, 14]);
  ed.startImageEdit(o.id, 'crop');
  ed.setImageCropNumeric({ left: 10, top: 5, right: 90, bottom: 45, unit: 'mm' });
  ed.setImageEditTab('perspective');
  ed.setImagePerspectiveCorner(0, { x: -5, y: 1 }, { snap: false });
  ed.setImageEditOrder('perspectiveFirst');
  const before = imageDraftEdit(ed, o.id)!;
  ed.setImageEditTab('rounding');
  assert.equal(ed.setImageCornerRadius(null, 7), null);
  assert.equal(ed.setImageCornerRadius(2, 9), null);
  assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, [7, 7, 9, 7, 11, 12, 13, 14]);
  assert.equal(ed.setImageCornerRadius(0, -1) !== null, true);
  assert.equal(ed.setImageCornerRadius(0, NaN) !== null, true);
  assert.equal(ed.resetImageRoundingDraft(), null);
  const reset = imageDraftEdit(ed, o.id)!;
  assert.deepEqual(reset.crop, before.crop); assert.deepEqual(reset.perspective, before.perspective);
  assert.equal(reset.order, 'perspectiveFirst'); assert.deepEqual(reset.cornerRadii, []);
  ed.setImageCornerRadius(null, 4);
  ed.resetImageCropDraft(); ed.resetImagePerspectiveDraft();
  assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, [4, 4, 4, 4]);
  assert.equal(ed.history.position, 0);
  ed.cancelImageDraft();
  assert.deepEqual((o.shape as any).edit.cornerRadii, [1, 2, 3, 4, 11, 12, 13, 14]);
});

await test('number overlay follows final world contour with zoom, offsets, reflection and dpr2', () => {
  const { ed, o } = fixture([3, 4, 5, 6]);
  o.m = [-1.4, .3, .6, 1.8, 30, 40];
  ed.startImageEdit(o.id, 'rounding');
  const drawn: [string, number, number][] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, arc() {}, fill() {},
    fillText(text: string, x: number, y: number) { drawn.push([text, x, y]); } };
  ui.renderImageCropOverlay(ed, ctx as any);
  const contour = imageDraftContour(ed, o.id)!;
  assert.ok(contour.ok);
  assert.deepEqual(drawn, contour.contour.corners.map((c, i) => {
    const p = ed.toScreen(c.vertex); return [String(i + 1), p.x, p.y];
  }));
  assert.equal(drawn.length, 4);
  assert.deepEqual((o.shape as any).edit.cornerRadii, [3, 4, 5, 6]);
});

class FakeEl {
  tagName: string; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  children: unknown[] = []; listeners: Record<string, ((...args: any[]) => void)[]> = {};
  textContent = ''; value = ''; placeholder = ''; validationMessage = ''; modeless = false; modal = false; closed = false;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  addEventListener(type: string, fn: (...args: any[]) => void) { (this.listeners[type] ??= []).push(fn); }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  setCustomValidity(message: string) { this.validationMessage = message; }
  append(...children: unknown[]) { this.children.push(...children); }
  replaceChildren(...children: unknown[]) { this.children = [...children]; }
  closest() { return this; }
  remove() {}
  focus() { (globalThis as any).document.activeElement = this; }
  show() { this.modeless = true; }
  showModal() { this.modal = true; }
  close() { if (!this.closed) { this.closed = true; this.fire('close'); } }
  fire(type: string, more: Record<string, unknown> = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...more };
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}
function elements(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(c => c instanceof FakeEl ? elements(c) : [])];
}
function withDom(fn: (dialogs: FakeEl[]) => void) {
  const previousDocument = (globalThis as any).document;
  const previousRaf = (globalThis as any).requestAnimationFrame;
  const dialogs: FakeEl[] = [];
  (globalThis as any).document = {
    querySelector: () => dialogs.find(d => !d.closed) ?? null,
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => dialogs.flatMap(elements).find(el => el.attrs.id === id),
    body: { append: (el: FakeEl) => dialogs.push(el) },
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  try { fn(dialogs); }
  finally { (globalThis as any).document = previousDocument; (globalThis as any).requestAnimationFrame = previousRaf; }
}
function byId(dlg: FakeEl, id: string): FakeEl {
  const el = elements(dlg).find(e => e.attrs.id === id); assert.ok(el, `missing ${id}`); return el;
}
function button(dlg: FakeEl, title: string): FakeEl {
  const el = elements(dlg).find(e => e.tagName === 'BUTTON' && e.children.includes(title));
  assert.ok(el, `missing button ${title}`); return el;
}
function input(el: FakeEl, value: string) { el.focus(); el.value = value; el.fire('input'); }

await test('real modeless DOM: third tab, live fields, effective/requested feedback, Apply and Undo', () => withDom(dialogs => {
  const { ed, o } = fixture();
  assert.equal(ui.runImageEdit(ed), null);
  const dlg = dialogs[0]; assert.equal(dlg.modeless, true); assert.equal(dlg.modal, false);
  button(dlg, ui.ROUNDING_TAB_TITLE()).fire('click');
  assert.equal(ed.imageDraft().tab, 'rounding');
  assert.equal(byId(dlg, 'imgedit-tab-rounding').attrs['aria-selected'], 'true');
  assert.equal(byId(dlg, 'imground-0').attrs.type, 'number');
  assert.ok(elements(dlg).some(e => e.tagName === 'LABEL' && e.attrs.for === 'imground-0'));
  input(byId(dlg, 'imground-common'), '100');
  assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, [100, 100, 100, 100]);
  assert.match(byId(dlg, 'imground-effective-0').textContent, /25.*100/);
  assert.ok(elements(dlg).some(e => e.attrs.role === 'status' && e.textContent.length > 0));
  input(byId(dlg, 'imground-1'), '8');
  assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, [100, 8, 100, 100]);
  assert.equal((o.shape as any).edit, undefined); assert.equal(ed.history.position, 0);
  let prevented = false;
  dlg.fire('keydown', { key: 'ArrowUp', target: byId(dlg, 'imground-1'), preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  button(dlg, 'Übernehmen').fire('click');
  assert.equal(dlg.closed, true); assert.equal(ed.history.position, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(o)).shape.edit.cornerRadii, [100, 8, 100, 100]);
  ed.doUndo(); assert.equal(ed.doc.objs[0].shape.edit, undefined);
}));

await test('real DOM follows 4→8→4 corners, preserves unused requests and reset/Cancel take no Undo', () => withDom(dialogs => {
  const { ed, o } = fixture([1, 2, 3, 4, 5, 6, 7, 8]);
  ui.runImageEdit(ed, 'rounding'); const dlg = dialogs[0];
  assert.equal(elements(dlg).filter(e => /^imground-\d+$/.test(e.attrs.id ?? '')).length, 4);
  button(dlg, ui.PERSP_TAB_TITLE()).fire('click');
  const quad = [{ x: 50, y: -20 }, { x: 120, y: 25 }, { x: 50, y: 70 }, { x: -20, y: 25 }];
  // Convex intermediate shapes: draft accepts the full sequence without bypassing validation.
  quad.forEach((p, i) => assert.equal(ed.setImagePerspectiveCorner(i, p, { snap: false }), null));
  ed.setImageEditOrder('perspectiveFirst');
  button(dlg, ui.ROUNDING_TAB_TITLE()).fire('click');
  assert.equal(elements(dlg).filter(e => /^imground-\d+$/.test(e.attrs.id ?? '')).length, 8);
  input(byId(dlg, 'imground-7'), '18');
  assert.equal(ed.resetImagePerspectiveDraft(), null);
  assert.equal(elements(dlg).filter(e => /^imground-\d+$/.test(e.attrs.id ?? '')).length, 4);
  assert.equal(imageDraftEdit(ed, o.id)?.cornerRadii?.[7], 18);
  const before = imageDraftEdit(ed, o.id)!;
  button(dlg, 'Eckenabrundung zurücksetzen').focus();
  button(dlg, 'Eckenabrundung zurücksetzen').fire('click');
  assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, []);
  assert.deepEqual(imageDraftEdit(ed, o.id)?.crop, before.crop);
  assert.deepEqual(imageDraftEdit(ed, o.id)?.perspective, before.perspective);
  assert.equal(imageDraftEdit(ed, o.id)?.order, before.order);
  assert.equal(byId(dlg, 'imground-0').value, '0');
  dlg.fire('keydown', { key: 'Escape' });
  assert.equal(dlg.closed, true); assert.equal(ed.imageDraft(), null); assert.equal(ed.history.position, 0);
  assert.deepEqual((o.shape as any).edit.cornerRadii, [1, 2, 3, 4, 5, 6, 7, 8]);
}));

await test('rounding DOM rejects negative and empty radii with named accessible feedback', () => withDom(dialogs => {
  const { ed, o } = fixture(); ui.runImageEdit(ed, 'rounding'); const dlg = dialogs[0];
  const field = byId(dlg, 'imground-0');
  for (const value of ['-1', '']) {
    input(field, value);
    assert.equal(field.attrs['aria-invalid'], 'true');
    assert.ok(elements(dlg).some(e => e.attrs.role === 'alert' && e.textContent.length > 0));
    assert.deepEqual(imageDraftEdit(ed, o.id)?.cornerRadii, []);
  }
  input(field, '5'); assert.equal(field.attrs['aria-invalid'], 'false');
  dlg.fire('keydown', { key: 'Enter', target: field });
  assert.equal(dlg.closed, true); assert.equal(ed.history.position, 1);
  assert.equal((o.shape as any).edit.cornerRadii[0], 5);
}));

await test('native tab keyboard navigation reaches rounding and wraps without moving image geometry', () => withDom(dialogs => {
  const { ed } = fixture(); ui.runImageEdit(ed); const dlg = dialogs[0];
  const tabBar = elements(dlg).find(e => e.attrs.role === 'tablist')!;
  tabBar.fire('keydown', { key: 'End' });
  assert.equal(ed.imageDraft().tab, 'rounding');
  assert.equal((globalThis as any).document.activeElement.attrs.id, 'imgedit-tab-rounding');
  tabBar.fire('keydown', { key: 'ArrowRight' }); assert.equal(ed.imageDraft().tab, 'crop');
  tabBar.fire('keydown', { key: 'ArrowLeft' }); assert.equal(ed.imageDraft().tab, 'rounding');
  tabBar.fire('keydown', { key: 'Home' }); assert.equal(ed.imageDraft().tab, 'crop');
  assert.equal(ed.history.position, 0);
}));

await test('requested world-mm radii survive both edit orders, draft geometry changes and resize', () => {
  for (const order of ['cropFirst', 'perspectiveFirst']) {
    const { ed, o } = fixture([5, 6, 7, 8, 9, 10]);
    ed.startImageEdit(o.id, 'crop'); ed.setImageEditOrder(order);
    ed.setImageCropNumeric({ left: 10, top: 10, right: 95, bottom: 45, unit: 'mm' });
    ed.setImageEditTab('perspective');
    ed.setImagePerspectiveCorner(0, { x: -2, y: -3 }, { snap: false });
    const requested = [...imageDraftEdit(ed, o.id)!.cornerRadii!];
    o.m = [2, .3, .7, 1.5, 13, -8];
    const result = imageDraftContour(ed, o.id)!;
    assert.ok(result.ok); assert.equal(result.contour.limited, false);
    assert.deepEqual(result.contour.corners.map(c => c.radius), requested.slice(0, result.contour.corners.length));
    ed.applyImageDraft(); assert.deepEqual((o.shape as any).edit.cornerRadii, requested);
  }
});

await test('invalid rounding text blocks Apply and Enter, stays visible and focuses its field', () => withDom(dialogs => {
  const { ed, o } = fixture(); ui.runImageEdit(ed, 'rounding'); const dlg = dialogs[0];
  const field = byId(dlg, 'imground-0');
  assert.equal(field.attrs.min, '0'); assert.equal(field.attrs.step, '0.1');
  input(byId(dlg, 'imground-common'), '1000');
  input(field, '-1');
  assert.ok(field.validationMessage, 'rejected values must also set native custom validity');
  const apply = button(dlg, 'Übernehmen'); apply.focus(); apply.fire('click');
  assert.equal(dlg.closed, false, 'invalid text must not commit the older valid draft');
  assert.equal(ed.history.position, 0); assert.equal((o.shape as any).edit, undefined);
  assert.equal(field.value, '-1'); assert.equal(field.attrs['aria-invalid'], 'true');
  assert.equal((globalThis as any).document.activeElement, field);
  dlg.fire('keydown', { key: 'Enter', target: field });
  assert.equal(dlg.closed, false); assert.equal(ed.history.position, 0);
  assert.equal(ui.handleImageCropKey(ed, { key: 'Enter' }), true);
  assert.equal(dlg.closed, false, 'canvas Enter must use the same modeless validation gate');
  assert.equal(ed.history.position, 0);
  input(byId(dlg, 'imground-1'), '6');
  assert.equal(field.value, '-1', 'an unrelated field edit must not silently replace invalid text');
  apply.focus(); apply.fire('click'); assert.equal(dlg.closed, false);
  input(field, '5'); apply.focus(); apply.fire('click');
  assert.equal(field.validationMessage, '');
  assert.equal(dlg.closed, true); assert.equal(ed.history.position, 1);
  assert.deepEqual((o.shape as any).edit.cornerRadii, [5, 6, 1000, 1000]);
}));

await test('reset and tab replacement clear invalid rounding state, while Escape still cancels', () => withDom(dialogs => {
  const { ed, o } = fixture(); ui.runImageEdit(ed, 'rounding'); const dlg = dialogs[0];
  input(byId(dlg, 'imground-0'), '-1');
  button(dlg, 'Eckenabrundung zurücksetzen').focus();
  button(dlg, 'Eckenabrundung zurücksetzen').fire('click');
  assert.equal(byId(dlg, 'imground-0').value, '0');
  assert.notEqual(byId(dlg, 'imground-0').attrs['aria-invalid'], 'true');
  assert.ok(elements(dlg).filter(e => e.attrs.role === 'alert').every(e => !e.textContent));
  const common = byId(dlg, 'imground-common'); input(common, '-1');
  input(byId(dlg, 'imground-1'), '3');
  assert.equal(common.value, '-1', 'an unrelated field edit must preserve invalid common-radius text');
  button(dlg, 'Übernehmen').fire('click'); assert.equal(dlg.closed, false);
  common.focus(); button(dlg, 'Eckenabrundung zurücksetzen').fire('click');
  assert.equal(common.value, '0'); assert.equal(common.validationMessage, '');
  input(byId(dlg, 'imground-0'), '-1');
  button(dlg, ui.CROP_TAB_TITLE()).fire('click');
  button(dlg, ui.ROUNDING_TAB_TITLE()).fire('click');
  assert.equal(byId(dlg, 'imground-0').value, '0');
  assert.ok(elements(dlg).filter(e => e.attrs.role === 'alert').every(e => !e.textContent));
  input(byId(dlg, 'imground-0'), '-1');
  dlg.fire('keydown', { key: 'Escape' });
  assert.equal(dlg.closed, true); assert.equal(ed.history.position, 0); assert.equal((o.shape as any).edit, undefined);
}));

await test('replacing invalid fields by reset or tab switch allows one clean Apply', () => withDom(dialogs => {
  for (const action of ['reset', 'tab']) {
    const { ed, o } = fixture([2, 3, 4, 5]); ui.runImageEdit(ed, 'rounding'); const dlg = dialogs.at(-1)!;
    input(byId(dlg, 'imground-0'), '-1');
    if (action === 'reset') button(dlg, 'Eckenabrundung zurücksetzen').fire('click');
    else {
      button(dlg, ui.CROP_TAB_TITLE()).fire('click');
      button(dlg, ui.ROUNDING_TAB_TITLE()).fire('click');
    }
    button(dlg, 'Übernehmen').fire('click');
    assert.equal(dlg.closed, true); assert.equal(ed.history.position, 1);
    assert.deepEqual((o.shape as any).edit?.cornerRadii, action === 'reset' ? undefined : [2, 3, 4, 5]);
  }
}));

console.log(`${count} image rounding UI tests passed`);
