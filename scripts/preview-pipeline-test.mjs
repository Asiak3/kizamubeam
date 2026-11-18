// Actual openPreview and dialog sizing code; DOM/canvas recording doubles only.
// No app bootstrap, native calls, transport, hardware, or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const source = new URL('../src/', import.meta.url).pathname;
const observers = [];
const forbidden = [];
const deny = (name) => () => { forbidden.push(name); throw Error(`Forbidden offline operation: ${name}`); };
class RecordingPath {
  points = [];
  moveTo(...p) { this.points.push(['moveTo', ...p]); }
  lineTo(...p) { this.points.push(['lineTo', ...p]); }
}
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map(); this.attrs = {}; this.dataset = {};
    this.style = { removeProperty(key) { delete this[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; } };
    this.className = ''; this.scrollLeft = this.scrollTop = 0;
    this.classList = { contains: (c) => this.className.split(' ').includes(c), add: (c) => { this.className += ` ${c}`; },
      [Symbol.iterator]: () => this.className.split(' ').filter(Boolean)[Symbol.iterator]() };
    this.calls = [];
    this.context = new Proxy({}, { get: (_, key) => (...args) => this.calls.push([key, ...args]) });
  }
  append(...nodes) { for (const n of nodes.flat()) if (n != null) { this.children.push(n); if (n instanceof Element) n.parentElement = this; } }
  insertBefore(node, ref) { node.parentElement = this; this.children.splice(this.children.indexOf(ref), 0, node); }
  get firstElementChild() { return this.children.find((n) => n instanceof Element); }
  get textContent() { return this.text ?? this.children.map((n) => n.textContent ?? n).join(''); }
  set textContent(text) { this.text = text; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  emit(type, extra = {}) { const e = { type, target: this, preventDefault() {}, stopPropagation() {}, ...extra }; for (const fn of [...(this.events.get(type) ?? [])]) fn(e); }
  dispatchEvent(event) { this.emit(event.type, event); if (event.bubbles) dialogHooks.onDoubleClick({ target: this, preventDefault() {} }); return true; }
  querySelectorAll(selector) { return this.children.filter((n) => n instanceof Element).flatMap((n) => [
    ...(selector === '*' || (selector.startsWith('.') ? n.classList.contains(selector.slice(1)) : n.tagName.toLowerCase() === selector) ? [n] : []), ...n.querySelectorAll(selector),
  ]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.tagName.toLowerCase() === selector ? this : this.parentElement?.closest(selector) ?? null; }
  getBoundingClientRect() {
    const dlg = this.closest('dialog');
    let width = 24, height = 24;
    if (this.tagName === 'DIALOG') { width = parseFloat(this.style.width) || 1044; height = parseFloat(this.style.height) || 520; }
    else if (this.className === 'preview-side') { width = parseFloat(this.style.width) || 420; height = dlg.getBoundingClientRect().height - 120; }
    else if (this.className === 'preview-main') { width = dlg.getBoundingClientRect().width; height = dlg.getBoundingClientRect().height - 120; }
    else if (this.className === 'preview-canvas') { width = dlg.getBoundingClientRect().width - dlg.querySelector('.preview-side').getBoundingClientRect().width - 24; height = dlg.getBoundingClientRect().height - 120; }
    return { width, height, left: 20, top: 20 };
  }
  get clientWidth() { return this.getBoundingClientRect().width; }
  get clientHeight() { return this.getBoundingClientRect().height; }
  getContext() { return this.context; }
  setPointerCapture() { this.captured = true; }
  hasPointerCapture() { return this.captured; }
  releasePointerCapture() { this.captured = false; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  remove() { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); }
}
const h = (tag, attrs = {}, ...children) => {
  const el = new Element(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('data-')) el.setAttribute(key, value);
    else el[key] = value;
  }
  el.append(...children); return el;
};
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.Element = globalThis.HTMLElement = globalThis.HTMLDialogElement = Element;
globalThis.document = { body: h('body'), documentElement: { dataset: { theme: 'dark' } }, createElement: (tag) => h(tag) };
globalThis.window = { devicePixelRatio: 2, innerWidth: 1600, innerHeight: 1000 };
globalThis.matchMedia = () => ({ matches: false });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', paddingTop: '0', paddingLeft: '0', paddingRight: '0' });
globalThis.Path2D = RecordingPath;
globalThis.MouseEvent = class { constructor(type, attrs) { this.type = type; Object.assign(this, attrs); } };
globalThis.ResizeObserver = class {
  constructor(fn) { this.fn = fn; this.targets = new Set(); observers.push(this); }
  observe(target) { this.targets.add(target); }
  disconnect() { this.targets.clear(); }
};
const resize = (target) => { for (const observer of observers) if (observer.targets.has(target)) observer.fn(); };
const job = { moves: { n: 2, x0: 10, y0: 20, x: [30, 60], y: [40, 70], s: [50, 50], f: [100, 100], layer: [0, 0] },
  bounds: { x0: 10, y0: 20, x1: 60, y1: 70 }, air: [], warnings: [] };
const device = { energy: {}, cutSelected: false };
const ed = { doc: { bed: { w: 200, h: 100 } }, layerDrawColor: () => '#123456' };
const immutable = JSON.stringify({ job, device, doc: ed.doc });
const mocks = { h, setIcon() {}, t: (s) => s, locale: 'en', loadDevices: () => ({ devices: [device] }),
  buildJob: async () => job, estimate: () => ({ total: 10, t: [5, 10], cutLength: 80, rapidLength: 0 }),
  rotaryOn: () => false, formatDuration: String, energyDraft: () => ({}), estimateEnergy: () => ({}),
  electricityTariffText: () => '', parseEnergyNumber: () => null, energyPreview: () => h('section'),
  machine: { connected: false, status: {}, on: () => () => {}, send: deny('machine.send'), connect: deny('machine.connect') },
  native: new Proxy({}, { get: (_, name) => deny(`native.${String(name)}`) }), saveText: deny('saveText') };
globalThis.__previewMocks = mocks;
const laser = readFileSync(source + 'laser.ts', 'utf8');
const imports = new Map();
for (const match of laser.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) imports.set(match[2], match[1].split(',').map((name) => name.trim()).filter(Boolean));
const bundle = await build({ stdin: { contents: laser, resolveDir: source, sourcefile: 'preview-pipeline-entry.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'offline-preview-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.path === './previewLayout') return;
      if (imports.has(args.path)) return { path: args.path, namespace: 'offline' };
      if (args.path === '../package.json') return { path: args.path, namespace: 'offline' };
      if (args.path === './setupWizard' || args.path === './fluidncDialog') return { path: args.path, namespace: 'blocked' };
      throw Error(`Unexpected import: ${args.path}`);
    });
    b.onLoad({ filter: /.*/, namespace: 'blocked' }, () => ({ contents: 'throw Error("Forbidden offline dialog import");', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'offline' }, (args) => ({ contents: args.path === '../package.json' ? 'export const version = "test";' :
      imports.get(args.path).map((name) => `export const ${name} = globalThis.__previewMocks[${JSON.stringify(name)}] ?? (() => { throw Error(${JSON.stringify('Unexpected offline call: ' + name)}); });`).join('\n'), loader: 'js' }));
  } }] });
const { openPreview } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const drag = await build({ stdin: { contents: readFileSync(source + 'dialogDrag.ts', 'utf8') + '\nexport { initSize, startResize, onDoubleClick };', resolveDir: source, loader: 'ts' }, bundle: true, write: false, format: 'esm' });
const dialogHooks = await import(`data:text/javascript;base64,${Buffer.from(drag.outputFiles[0].text).toString('base64')}`);
await openPreview(ed);
const dlg = document.body.querySelector('dialog');
const canvas = dlg.querySelector('.preview-canvas');
const main = dlg.querySelector('.preview-main');
const split = dlg.querySelector('.preview-splitter');
resize(main); resize(canvas);
assert.equal(canvas.width, 1200); assert.equal(canvas.height, 800);
canvas.emit('wheel', { clientX: 220, clientY: 120, deltaY: -1 });
canvas.emit('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
canvas.emit('pointermove', { clientX: 137, clientY: 81 });
canvas.emit('pointerup');
const lastArc = () => canvas.calls.filter((c) => c[0] === 'arc').at(-1);
assert.deepEqual(lastArc().slice(1, 3), [219.5, 134.75], 'Real render applies nonidentity zoom and pan');
assert.ok(canvas.calls.some((c) => c[0] === 'setTransform' && c[1] === 2 && c[4] === 2), 'Real render uses DPR 2');
split.emit('keydown', { key: 'ArrowLeft' });
resize(canvas);
assert.equal(canvas.width, 1180, 'Divider resizing reaches the actual canvas backing store');
assert.deepEqual(lastArc().slice(1, 3), [183, 144], 'ResizeObserver refits and renders after nonidentity zoom/pan');
dialogHooks.initSize(dlg, 'preview-test');
const grip = dlg.querySelector('.dlg-grip');
assert.equal(grip.tabIndex, 0);
grip.emit('keydown', { key: 'ArrowRight' });
resize(main); resize(canvas);
assert.equal(dlg.getBoundingClientRect().width, 1054);
assert.equal(canvas.width, 1200, 'Keyboard window resizing reaches the actual canvas');
grip.emit('keydown', { key: 'Enter' });
resize(main); resize(canvas);
assert.equal(dlg.style.width, undefined, 'Enter resets window size through actual double-click dispatch');
assert.equal(canvas.width, 1180);
grip.emit('keydown', { key: 'ArrowDown' });
grip.emit('keydown', { key: ' ' });
assert.equal(dlg.style.height, undefined, 'Space resets window size');
dialogHooks.startResize({ clientX: 100, clientY: 100, pointerId: 2, preventDefault() {}, stopPropagation() {} }, dlg, grip);
grip.emit('pointermove', { clientX: 200, clientY: 180 });
resize(main); resize(canvas);
assert.equal(dlg.getBoundingClientRect().width, 1144);
grip.emit('pointercancel');
resize(main); resize(canvas);
assert.equal(dlg.style.width, undefined, 'Cancelled grip drag restores standard size');
assert.equal(canvas.width, 1180);
grip.emit('keydown', { key: 'ArrowRight' });
const previous = dlg.style.width;
const savedSize = storage.get('kizamubeam.dialogSize');
dialogHooks.startResize({ clientX: 100, clientY: 100, pointerId: 3, preventDefault() {}, stopPropagation() {} }, dlg, grip);
grip.emit('pointermove', { clientX: 250, clientY: 180 });
grip.emit('pointercancel');
assert.equal(dlg.style.width, previous, 'Cancelled grip drag restores an explicitly chosen size');
assert.equal(storage.get('kizamubeam.dialogSize'), savedSize, 'Cancelled grip drag does not overwrite the saved size');
assert.equal(JSON.stringify({ job, device, doc: ed.doc }), immutable, 'Resize/render never mutates job, device or document');
assert.deepEqual(forbidden, []);
dlg.close();
assert.ok(observers.every((observer) => !observer.targets.has(canvas) && !observer.targets.has(main)), 'Preview observers disconnect on close');
console.log('Preview real pipeline and grip regressions: 20 passed');
