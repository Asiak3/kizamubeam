// Layer dialog: the optional image cut uses a working copy, writes L.img.cut on Apply only.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { openLayerDialog } = await import('../src/layerdialog');
const { imageCutSettings } = await import('../src/imageCut');
type Obj = import('../src/model').Obj;

class FakeEl {
  tagName: string; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  children: (FakeEl | string)[] = []; listeners: Record<string, ((...a: any[]) => void)[]> = {};
  textContent = ''; value = ''; checked = false; className = ''; hidden = false; isConnected = true;
  innerHTML = '';
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  addEventListener(type: string, fn: (...a: any[]) => void) { (this.listeners[type] ??= []).push(fn); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  hasAttribute(k: string) { return k in this.attrs; }
  append(...kids: (FakeEl | string)[]) { this.children.push(...kids); }
  replaceChildren(...kids: (FakeEl | string)[]) { this.children = [...kids]; }
  closest() { return this; }
  remove() { this.isConnected = false; }
  focus() {}
  show() {}
  showModal() {}
  close() { this.fire('close'); }
  fire(type: string, more: Record<string, unknown> = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...more };
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}
const elements = (el: FakeEl): FakeEl[] => [el, ...el.children.flatMap((c) => c instanceof FakeEl ? elements(c) : [])];
function withDom(fn: (dialogs: FakeEl[]) => void) {
  const prev = (globalThis as any).document;
  const dialogs: FakeEl[] = [];
  (globalThis as any).document = {
    querySelector: () => dialogs.find((d) => d.isConnected) ?? null,
    createElement: (tag: string) => new FakeEl(tag),
    body: { append: (el: FakeEl) => dialogs.push(el) },
  };
  try { fn(dialogs); } finally { (globalThis as any).document = prev; }
}
const named = (dlg: FakeEl, text: string) => elements(dlg).find((e) => e.children.includes(text));
const button = (dlg: FakeEl, text: string) => {
  const el = elements(dlg).find((e) => e.tagName === 'BUTTON' && e.children.includes(text));
  assert.ok(el, `missing button ${text}`); return el!;
};
const cutCheckbox = (dlg: FakeEl) => {
  const label = named(dlg, 'Bildschnitt ausgeben');
  assert.ok(label, 'cut output checkbox is labelled');
  const input = label!.children.find((c): c is FakeEl => c instanceof FakeEl && c.tagName === 'INPUT');
  assert.ok(input, 'cut output checkbox exists'); return input!;
};

function fixture() {
  const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
  Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(),
    nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), clipboard: [],
    isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, batching: false,
    view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.doc.layers[0] = defaultLayer(0);
  const img: Obj = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0,
    shape: { kind: 'image', asset: 'a', w: 100, h: 60, pxW: 100, pxH: 60, adjust: {} as never } };
  ed.doc.objs = [img];
  ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
  ed.emit = () => {};
  return ed;
}

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`ok ${checks} - ${name}`); };

check('Apply writes image-layer cut settings with one undo step', () => withDom((dialogs) => {
  const ed = fixture();
  openLayerDialog(ed, 0);
  const dlg = dialogs[0];
  assert.ok(named(dlg, 'Bildschnitt (optional)'), 'separate optional cut section');
  const chk = cutCheckbox(dlg);
  chk.checked = true; chk.fire('change');
  button(dlg, 'Übernehmen').fire('click');
  const L = ed.layer(0);
  assert.equal(L.img?.cut?.output, true);
  assert.equal(L.img?.cut?.speed, imageCutSettings(undefined).speed);
  assert.equal('mode' in (L.img?.cut ?? {}), false, 'no layer mode stored in the cut settings');
  assert.equal(ed.history.position, 1, 'one undo step');
  ed.doUndo();
  assert.equal(ed.layer(0).img?.cut, undefined, 'undo restores the layer without a cut');
}));

check('Cancel leaves the layer untouched (no hidden live mutation)', () => withDom((dialogs) => {
  const ed = fixture();
  openLayerDialog(ed, 0);
  const chk = cutCheckbox(dialogs[0]);
  chk.checked = true; chk.fire('change');
  assert.equal(ed.imgLayer(0).cut, undefined, 'no mutation before Apply');
  button(dialogs[0], 'Abbrechen').fire('click');
  assert.equal(ed.layer(0).img?.cut, undefined);
  assert.equal(ed.history.position, 0);
}));

check('an untouched legacy image layer keeps its file unchanged on Apply', () => withDom((dialogs) => {
  const ed = fixture();
  openLayerDialog(ed, 0);
  button(dialogs[0], 'Übernehmen').fire('click');
  assert.equal(ed.layer(0).img?.cut, undefined, 'no cut field added');
  assert.equal(ed.history.position, 0, 'no undo step for a no-op');
}));

check('dangling assigned contour is reported in the cut section', () => withDom((dialogs) => {
  const ed = fixture();
  (ed.doc.objs[0].shape as { cut?: unknown }).cut = { mode: 'contour', contourId: 999999 };
  openLayerDialog(ed, 0);
  const notes = elements(dialogs[0]).filter((e) => e.className?.includes('note') || e.attrs.class?.includes('note')).map((e) => e.textContent).join(' ');
  assert.match(notes, /fehlt.*zuweisen|zuweisen.*fehlt/, 'status names problem and fix');
}));

check('sections are grouped into collapsible groups (A-13)', () => withDom((dialogs) => {
  const ed = fixture();
  openLayerDialog(ed, 0);
  const els = elements(dialogs[0]);
  const sums = els.filter((e) => e.tagName === 'SUMMARY');
  for (const t of ['Allgemein', 'Geometrie', 'Bild', 'Bildschnitt (optional)', 'Aussehen in 3D'])
    assert.ok(sums.some((e) => e.children.includes(t)), `group ${t}`);
  const group = (t: string) => els.find((e) => e.tagName === 'DETAILS' &&
    e.children.some((c) => c instanceof FakeEl && c.tagName === 'SUMMARY' && c.children.includes(t)));
  assert.equal((group('Allgemein') as FakeEl | undefined)?.attrs.open, '', 'core group starts open');
  assert.equal((group('Bildschnitt (optional)') as FakeEl | undefined)?.attrs.open, undefined, 'image cut starts collapsed');
  assert.equal(sums.filter((e) => e.children.includes('Linie')).length, 1, 'line params nested once inside image cut');
  const cut = cutCheckbox(dialogs[0]);
  cut.checked = true; cut.fire('change');
  assert.equal((group('Bildschnitt (optional)') as unknown as { open?: boolean })?.open, true, 'image cut opens on output check');
}));

check('alte Bildschnitt-Stege bekommen neue Defaults', () => {
  const cut = imageCutSettings({ cut: { output: true, tabs: { enabled: true, size: 1, useCount: true, count: 2, spacing: 5, skipInner: false } } } as never);
  assert.equal(cut.tabs.enabled, true);
  assert.equal(cut.tabs.maxTabs, 0);
  assert.equal(cut.tabs.minTabs, 1);
  assert.equal(cut.tabs.tabPower, 0);
});

check('legacy image-cut defaults stay isolated until Apply and undo restores the legacy data', () => withDom((dialogs) => {
  const ed = fixture();
  ed.layer(0).img = { cut: { output: true, tabs: { enabled: true, size: 1, useCount: true, count: 2, spacing: 5, skipInner: false } } } as never;
  const before = JSON.stringify(ed.layer(0));
  openLayerDialog(ed, 0);
  const field = (dlg: FakeEl, name: string) => {
    const input = elements(dlg).find((e) => e.tagName === 'INPUT' && e.attrs['aria-label'] === name);
    assert.ok(input, `missing field ${name}`);
    return input;
  };
  assert.equal(Number(field(dialogs[0], 'Max. Stege je Form').value), 0);
  assert.equal(Number(field(dialogs[0], 'Min. Stege je Form').value), 1);
  assert.equal(Number(field(dialogs[0], 'Stegleistung (%)').value), 0);
  const power = field(dialogs[0], 'Stegleistung (%)');
  power.value = '25'; power.fire('blur');
  assert.equal(JSON.stringify(ed.layer(0)), before, 'editing does not mutate the original');
  button(dialogs[0], 'Abbrechen').fire('click');
  assert.equal(JSON.stringify(ed.layer(0)), before, 'Cancel preserves legacy serialization');
  assert.equal(ed.history.position, 0);
  openLayerDialog(ed, 0);
  const appliedPower = field(dialogs[1], 'Stegleistung (%)');
  appliedPower.value = '25'; appliedPower.fire('blur');
  button(dialogs[1], 'Übernehmen').fire('click');
  assert.equal(ed.layer(0).img?.cut?.tabs.tabPower, 25);
  assert.equal(ed.history.position, 1);
  ed.doUndo();
  assert.equal(JSON.stringify(ed.layer(0)), before, 'Undo restores original missing defaults');
}));

check('Pausenfelder haben zugängliche Namen', () => withDom((dialogs) => {
  const ed = fixture();
  openLayerDialog(ed, 0);
  const names = elements(dialogs[0])
    .filter((e) => e.tagName === 'INPUT' && typeof e.attrs['aria-label'] === 'string')
    .map((e) => e.attrs['aria-label'] as string);
  assert.ok(names.some((n) => n.includes('Startpause')), 'Startpause benannt: ' + names.join(' | '));
  assert.ok(names.some((n) => n.includes('Endpause')), 'Endpause benannt');
  assert.ok(names.some((n) => n.includes('Anstechleistung')), 'Anstechleistung benannt');
}));

console.log(`image cut dialog: ${checks}/${checks} passed`);
