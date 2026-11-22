// Execute the complete production dialog and real DOM builder, not a copy of its
// event handlers. Only unrelated raster/preset controls and the DOM host are fake.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
const targetImages = source.slice(source.indexOf('function targetImages('), source.indexOf('setAdjustOpener('));
const dialog = source.slice(source.indexOf('function openAdjustDialog('), source.indexOf('function assetImageOf('));
assert.ok(targetImages.startsWith('function targetImages(') && dialog.trimEnd().endsWith('}'));
const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
  import { h } from './src/dom';
  import { ZOOM_STEP, clampPan, imageOrigin, panBy, resetZoomView, zoomAtCursor, zoomPercent, type ZoomView } from './src/previewZoom';
  const t = s => s, layerLabel = String;
  const slider = () => ({ el: [], set() {} });
  const imageLayerFields = () => [], liveLayerRaster = () => ({});
  const loadPresets = () => [], onImageReady = () => () => {};
  const savePresets = () => [], savePreset = () => [], deletePreset = () => [];
  const presetOutput = x => x;
  const assetImageOf = () => globalThis.previewOriginal;
  const displayCanvas = () => globalThis.previewProcessed;
  ${targetImages}
  ${dialog}
  export { openAdjustDialog };
` }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'error' });
const { openAdjustDialog } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

let timers = new Map(), timerId = 0, dialogs = [], draws = [], transforms = [];
const ctx = { setTransform(...args) { transforms.push(args); }, fillRect() {}, drawImage(...args) { draws.push(args); } };
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.style = {};
    this.disabled = false; this.checked = false; this.value = ''; this.width = 0; this.height = 0; this.className = '';
    this.clientWidth = 420; this.clientHeight = 300; this.captured = new Set();
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
  set textContent(v) { this.children = [v]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  querySelectorAll(selector) { return elements(this).filter(e => e.tagName.toLowerCase() === selector); }
  getContext() { return ctx; }
  getBoundingClientRect() { return { left: 11, top: 17, width: 420, height: 300 }; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  focus() { document.activeElement = this; }
  showModal() { this.modal = true; }
  remove() {}
  close() { this.fire('close'); }
  click() { if (!this.disabled) this.fire('click'); }
  fire(type, more = {}) {
    const e = { target: this, preventDefault() {}, stopPropagation() {}, pointerId: 1, button: 0, ...more };
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
}
function elements(el) { return [el, ...el.children.flatMap(c => c instanceof Element ? elements(c) : [])]; }
function flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }
function fixture() {
  timers = new Map(); dialogs = []; draws = []; transforms = [];
  globalThis.document = { createElement: tag => new Element(tag), body: { append: dlg => dialogs.push(dlg) } };
  globalThis.window = { devicePixelRatio: 2, setTimeout: fn => { timers.set(++timerId, fn); return timerId; } };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.previewProcessed = { width: 1000, height: 800 };
  globalThis.previewOriginal = { width: 1600, height: 100 };
  const image = { layer: 0, m: [1.7, .8, .4, -1.3, 30, 40], shape: { kind: 'image', adjust: {} } };
  const layer = { interval: .1, bidirectional: true, overscan: 0 }, output = {};
  openAdjustDialog({ selImages: () => [image], imgLayer: () => output, layer: () => layer, imgOutput: () => output });
  flush();
  const dlg = dialogs[0], all = elements(dlg), view = all.find(e => e.tagName === 'CANVAS');
  const bar = all.find(e => e.className === 'adjust-zoom'), buttons = bar.querySelectorAll('button');
  const label = all.find(e => e.attrs.role === 'status');
  const check = text => all.find(e => e.tagName === 'LABEL' && e.textContent === text).children[0];
  const original = check('Original zeigen'), oneToOne = check('Ausschnitt 1:1');
  const toggle = (el, checked) => { el.checked = checked; el.fire('change'); flush(); };
  // Real zoom buttons and captured drag, with nonzero zoom and pan at DPR=2.
  for (let i = 0; i < 3; i++) { buttons[1].click(); flush(); }
  view.fire('pointerdown', { clientX: 221, clientY: 167 });
  assert.ok(view.captured.has(1));
  view.fire('pointermove', { clientX: 314, clientY: 387 }); view.fire('pointerup'); flush();
  assert.equal(label.textContent, '195 %'); assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, 0, 0]);
  assert.equal(view.width, 840); assert.equal(view.height, 600);
  return { dlg, view, buttons, label, toggle, original, oneToOne, normalDraw: [...draws.at(-1)] };
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (err) { failed++; console.error(`FAIL ${name}: ${err}`); }
}
test('1:1 label and native disabled zoom controls match the real DPR2 draw', () => {
  const { view, buttons, label, toggle, oneToOne, normalDraw } = fixture();
  toggle(oneToOne, true); assert.equal(label.textContent, '1:1');
  assert.ok(buttons.every(b => b.disabled)); assert.deepEqual(transforms.at(-1), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(draws.at(-1).slice(1), [80, 100, 840, 600, 0, 0, 840, 600]);
  buttons.forEach(b => b.click()); view.fire('dblclick');
  view.fire('wheel', { deltaY: -1, clientX: 60, clientY: 80 });
  view.fire('pointerdown', { clientX: 20, clientY: 30 }); view.fire('pointermove', { clientX: 80, clientY: 90 });
  view.fire('pointercancel'); flush(); assert.equal(label.textContent, '1:1');
  toggle(oneToOne, false); assert.ok(buttons.every(b => !b.disabled)); assert.equal(label.textContent, '195 %');
  assert.deepEqual(draws.at(-1), normalDraw);
});
test('Original is Fit, disables zoom and preserves stored zoom/pan despite different aspect ratio', () => {
  const { view, buttons, label, toggle, original, normalDraw } = fixture();
  toggle(original, true); assert.equal(label.textContent, '100 %'); assert.ok(buttons.every(b => b.disabled));
  assert.deepEqual(draws.at(-1).slice(1), [0, 136.875, 420, 26.25]);
  buttons.forEach(b => b.click()); view.fire('dblclick');
  view.fire('wheel', { deltaY: -1, clientX: 60, clientY: 80 });
  view.fire('pointerdown', { clientX: 20, clientY: 30 }); view.fire('pointermove', { clientX: 80, clientY: 90 });
  view.fire('pointerup'); flush(); assert.equal(label.textContent, '100 %');
  toggle(original, false); assert.equal(label.textContent, '195 %'); assert.deepEqual(draws.at(-1), normalDraw);
});
test('both modes give Original priority and restore 1:1 then stored normal view', () => {
  const { buttons, label, toggle, original, oneToOne, normalDraw } = fixture();
  toggle(oneToOne, true); toggle(original, true); assert.equal(label.textContent, '100 %');
  toggle(original, false); assert.equal(label.textContent, '1:1'); assert.ok(buttons.every(b => b.disabled));
  toggle(oneToOne, false); assert.equal(label.textContent, '195 %'); assert.deepEqual(draws.at(-1), normalDraw);
});
test('mode switch during captured pan stops the gesture without changing stored view', () => {
  const { view, label, toggle, original, normalDraw } = fixture();
  view.fire('pointerdown', { clientX: 40, clientY: 50 }); toggle(original, true);
  view.fire('pointermove', { clientX: 140, clientY: 150 }); view.fire('pointercancel'); flush();
  toggle(original, false); assert.equal(label.textContent, '195 %'); assert.deepEqual(draws.at(-1), normalDraw);
});
test('normal pointercancel stops pan; Fit remains operable after comparison modes', () => {
  const { view, buttons, label, toggle, oneToOne } = fixture();
  view.fire('pointerdown', { clientX: 40, clientY: 50 }); view.fire('pointermove', { clientX: 80, clientY: 90 });
  view.fire('pointercancel'); flush(); const stopped = [...draws.at(-1)];
  view.fire('pointermove', { clientX: 180, clientY: 190 }); flush(); assert.deepEqual(draws.at(-1), stopped);
  toggle(oneToOne, true); toggle(oneToOne, false); buttons[2].click(); flush();
  assert.equal(label.textContent, '100 %'); assert.deepEqual(draws.at(-1).slice(1), [22.5, 0, 375, 300]);
});
console.log(`DONE ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
