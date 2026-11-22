// Pasting into the document must be blocked while a modal tool dialog is open.
// A dialog such as the slot tool owns a captured document snapshot, so any import
// behind it (e.g. a screenshot via OS-level middle-click paste on Linux) would
// silently invalidate the tool as stale. Guards the window paste path, mirroring
// the existing file-drop guard in files.ts.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
type Obj = import('../src/model').Obj;

let nextId = 1;
const pathObj = (): Obj => ({ id: nextId++, m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: { kind: 'path', subs: [{ nodes: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], closed: true }] } });

const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(),
  nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), clipboard: [],
  isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, batching: false, hint: '',
  view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
ed.doc.layers[0] = defaultLayer(0);
ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
ed.emit = () => {};
ed.snapshot = function (this: import('../src/editor').Editor) { return; } as never;

const g = globalThis as Record<string, unknown>;
const prevDocument = g.document;
const withModal = (open: boolean) => {
  g.document = { ...(prevDocument as object), querySelector: (sel: string) => (open && sel === 'dialog[open]' ? {} : null) };
};
const pasteEvent = (target: object, data: object) => {
  let prevented = false;
  return { event: { target, clipboardData: data, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent,
    isPrevented: () => prevented };
};

let checks = 0;
const check = async (name: string, fn: () => Promise<void> | void) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };

await check('open modal dialog blocks external image paste and keeps the document', async () => {
  withModal(true);
  try {
    let external = 0;
    ed.externalPaste = async () => { external++; return true; };
    ed.clipboard = [pathObj()];
    ed.hint = '';
    const before = ed.doc.objs.length;
    const p = pasteEvent({ tagName: 'CANVAS', isContentEditable: false }, { files: [] });
    await ed.onPaste(p.event);
    assert.equal(external, 0, 'no import while a modal dialog is open');
    assert.equal(ed.doc.objs.length, before, 'document unchanged');
    assert.ok(p.isPrevented(), 'os paste swallowed');
    assert.ok(ed.hint.length > 0, 'user gets a hint');
  } finally { g.document = prevDocument; }
});

await check('open modal dialog blocks internal clipboard paste too', async () => {
  withModal(true);
  try {
    ed.externalPaste = async () => false;
    ed.clipboard = [pathObj()];
    const before = ed.doc.objs.length;
    const p = pasteEvent({ tagName: 'CANVAS', isContentEditable: false }, { files: [] });
    await ed.onPaste(p.event);
    assert.equal(ed.doc.objs.length, before, 'document unchanged');
    assert.ok(p.isPrevented());
  } finally { g.document = prevDocument; }
});

await check('paste still works with no dialog open', async () => {
  withModal(false);
  try {
    ed.externalPaste = async () => false;
    ed.clipboard = [pathObj()];
    ed.doc.objs = [];
    const p = pasteEvent({ tagName: 'CANVAS', isContentEditable: false }, { files: [] });
    await ed.onPaste(p.event);
    assert.equal(ed.doc.objs.length, 1, 'paste inserts with no dialog open');
  } finally { g.document = prevDocument; }
});

await check('text inputs keep their own paste behavior', async () => {
  withModal(true);
  try {
    let external = 0;
    ed.externalPaste = async () => { external++; return true; };
    ed.clipboard = [pathObj()];
    const before = ed.doc.objs.length;
    const p = pasteEvent({ tagName: 'INPUT', isContentEditable: false }, { files: [] });
    await ed.onPaste(p.event);
    assert.equal(external, 0);
    assert.equal(ed.doc.objs.length, before);
    assert.ok(!p.isPrevented(), 'input paste left to the field');
  } finally { g.document = prevDocument; }
});

console.log(`Paste guard: ${checks} passed.`);
