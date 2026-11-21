// Actual openPreview and dialog sizing code; DOM/canvas recording doubles only.
// No app bootstrap, native calls, transport, hardware, or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
// fileURLToPath, not .pathname: on Windows .pathname gives /E:/… which esbuild cannot resolve
const source = fileURLToPath(new URL('../src/', import.meta.url));
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
let frames = [];
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
performance.now = () => 1000;
const runFrame = (ms) => { performance.now = () => ms; const queued = frames; frames = []; for (const fn of queued) fn(ms); };
const resize = (target) => { for (const observer of observers) if (observer.targets.has(target)) observer.fn(); };
let job = { moves: { n: 4, x0: 10, y0: 20, x: [20, 30, 40, 60], y: [30, 40, 50, 70], s: [0, 50, 0, 50], f: [0, 100, 0, 100], layer: [0, 0, 1, 1], cls: [0, 1, 0, 2] },
  bounds: { x0: 10, y0: 20, x1: 60, y1: 70 }, air: [], warnings: [] };
const device = { energy: {}, cutSelected: false };
const ed = { doc: { bed: { w: 200, h: 100 } }, layerDrawColor: () => '#123456', layer: (i) => ({ name: `Layer ${i}` }) };
let estData = { total: 10, t: [1, 5, 6, 10], cutLength: 80, rapidLength: 0 };
const immutable = JSON.stringify({ job, device, doc: ed.doc });
const mocks = { h, setIcon() {}, t: (s) => s, dec: (s) => s, locale: 'en', loadDevices: () => ({ devices: [device] }),
  MOVE_TRAVEL: 0, MOVE_ENGRAVE: 1, MOVE_CUT: 2,
  buildJob: async () => job, estimate: () => estData, effOrderOf: () => ({}),
  rotaryOn: () => false, formatDuration: String, energyDraft: () => ({}), estimateEnergy: () => ({}),
  electricityTariffText: () => '', parseEnergyNumber: () => null, energyPreview: () => h('section'),
  machine: { connected: false, status: {}, fire: { locked: false }, on: () => () => {}, send: deny('machine.send'), connect: deny('machine.connect') },
  native: new Proxy({}, { get: (_, name) => deny(`native.${String(name)}`) }), saveText: deny('saveText') };
globalThis.__previewMocks = mocks;
const laser = readFileSync(source + 'laser.ts', 'utf8');
const imports = new Map();
for (const match of laser.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) imports.set(match[2], match[1].split(',').map((name) => name.trim()).filter(Boolean));
imports.get('./gcode')?.push('MOVE_TRAVEL', 'MOVE_ENGRAVE', 'MOVE_CUT');
const bundle = await build({ stdin: { contents: laser, resolveDir: source, sourcefile: 'preview-pipeline-entry.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'offline-preview-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.path === './previewLayout' || args.path === './previewPlayback') return;
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
const engrave = dlg.querySelector('.preview-engrave');
const cut = dlg.querySelector('.preview-cut');
const pause = dlg.querySelector('.preview-pause');
const smooth = dlg.querySelector('.preview-smooth');
const target = dlg.querySelector('.preview-target');
const factors = dlg.querySelector('.preview-factors');
assert.ok(engrave && cut && pause && smooth && target && factors, 'Playback controls exist');
assert.equal(engrave.children.find((o) => o.selected)?.textContent, '50×');
assert.equal(cut.children.find((o) => o.selected)?.textContent, '10×');
assert.equal(pause.checked, undefined, 'Pause is off by default');
assert.equal(smooth.checked, undefined, 'Smoothing is off by default');
assert.equal(target.disabled, true, 'Smoothing target is disabled by default');
assert.equal(dlg.querySelectorAll('.preview-marker').length, 1, 'One layer marker');
const marker = dlg.querySelector('.preview-marker');
assert.ok(marker.classList.contains('change'), 'Marker at the cut layer is marked as a process change');
assert.ok(marker.title.includes('Prozesswechsel'), 'Marker title names the process change');
assert.ok(marker['aria-label'].includes('Prozesswechsel'), 'Marker accessible name names the process change');
const timeTxt = dlg.querySelector('.preview-time');
const play = dlg.querySelector('.preview-bar').children.find((n) => n.tagName === 'BUTTON');
play.emit('click');
runFrame(1500);
assert.ok(Math.abs(parseFloat(timeTxt.textContent) - 9.8) < 1e-6, 'Playback applies engrave factor 50x to the first segments');
runFrame(1600);
assert.equal(parseFloat(timeTxt.textContent), 10, 'Playback stops at the estimated total');
pause.checked = true;
play.emit('click');
runFrame(2600);
assert.ok(Math.abs(parseFloat(timeTxt.textContent) - 6) < 1e-6, 'Pause stops exactly at the process change');
assert.equal(dlg.querySelector('.preview-status').textContent, 'Bei Prozesswechsel pausiert');
runFrame(3000);
assert.ok(Math.abs(parseFloat(timeTxt.textContent) - 6) < 1e-6, 'Paused playback does not advance on further frames');
play.emit('click');
runFrame(3200);
assert.ok(Math.abs(parseFloat(timeTxt.textContent) - 8) < 1e-6, 'Resume uses the cut factor without re-pausing at the boundary');
assert.equal(dlg.querySelector('.preview-status').textContent, '');
assert.equal(dlg.querySelector('.preview-breakdown').open, true, 'Breakdown is open');
assert.equal(dlg.querySelectorAll('.preview-layer').length, 2, 'One row per layer');
smooth.checked = true;
smooth.emit('change');
assert.equal(engrave.disabled, true, 'Smoothing disables engrave speed control');
assert.equal(cut.disabled, true, 'Smoothing disables cut speed control');
assert.equal(target.disabled, false, 'Smoothing enables the target field');
assert.equal(factors.hidden, false, 'Computed factors are shown in smoothing mode');
assert.ok(factors.textContent.includes('Faktor'), 'Factors are described as text');
smooth.checked = false;
smooth.emit('change');
assert.equal(engrave.disabled, false, 'Traditional mode restores engrave speed');
assert.equal(factors.hidden, true, 'Traditional mode hides computed factors');
assert.equal(target['aria-describedby'], 'preview-target-error', 'Target field references its error text');
smooth.checked = true;
smooth.emit('change');
target.value = '0';
target.emit('input');
assert.equal(target.getAttribute('aria-invalid'), 'true');
assert.equal(dlg.querySelector('.preview-error').hidden, false, 'Invalid target shows the associated error');
smooth.checked = false;
smooth.emit('change');
assert.equal(dlg.querySelector('.preview-error').hidden, true, 'Leaving smoothing mode clears the stale target error');
assert.equal(target.getAttribute('aria-invalid'), 'false');
resize(main); resize(canvas);
assert.equal(canvas.width, 1200); assert.equal(canvas.height, 800);
canvas.emit('wheel', { clientX: 220, clientY: 120, deltaY: -1 });
canvas.emit('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
canvas.emit('pointermove', { clientX: 137, clientY: 81 });
canvas.emit('pointerup');
const lastArc = () => canvas.calls.filter((c) => c[0] === 'arc').at(-1);
assert.deepEqual(lastArc().slice(1, 3), [183.875, 170.375], 'Real render applies nonidentity zoom and pan');
assert.ok(canvas.calls.some((c) => c[0] === 'setTransform' && c[1] === 2 && c[4] === 2), 'Real render uses DPR 2');
split.emit('keydown', { key: 'ArrowLeft' });
resize(canvas);
assert.equal(canvas.width, 1180, 'Divider resizing reaches the actual canvas backing store');
assert.deepEqual(lastArc().slice(1, 3), [155, 172], 'ResizeObserver refits and renders after nonidentity zoom/pan');
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
const layers = 27, moves = layers * 2;
const dense = (key, value) => Array.from({ length: moves }, (_, i) => (key === 'layer' ? Math.floor(i / 2) : value(i)));
job = { moves: { n: moves, x0: 10, y0: 20, x: dense('x', (i) => 10 + i * 2), y: dense('y', (i) => 20 + i * 2),
  s: dense('s', (i) => (i % 2 ? 50 : 0)), f: dense('f', (i) => (i % 2 ? 100 : 0)),
  layer: dense('layer'), cls: dense('cls', (i) => (i % 2 ? 1 : 0)) },
  bounds: { x0: 10, y0: 20, x1: 120, y1: 90 }, air: [], warnings: [] };
estData = { total: moves, t: Array.from({ length: moves }, (_, i) => i + 1), cutLength: 0, rapidLength: 0 };
await openPreview(ed);
const denseDlg = document.body.querySelectorAll('dialog').at(-1);
assert.equal(denseDlg.querySelectorAll('.preview-marker').length, layers - 1, 'Dense jobs show one visual tick per layer change');
assert.equal(denseDlg.querySelectorAll('button.preview-marker').length, 0, 'Dense jobs do not create overlapping marker buttons');
const jump = denseDlg.querySelector('.preview-layer-jump');
assert.ok(jump, 'Dense jobs offer one layer jump control instead');
assert.equal(jump.children.length, layers, 'Layer jump lists every layer change plus its prompt');
jump.value = String(layers - 2);
jump.emit('change');
assert.equal(parseFloat(denseDlg.querySelector('.preview-time').textContent), 52, 'Layer jump moves playback to the selected marker time');
denseDlg.close();
assert.ok(observers.every((observer) => !observer.targets.has(canvas) && !observer.targets.has(main)), 'Preview observers disconnect on close');
console.log('Preview real pipeline and grip regressions: 33 passed');
