import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const laser = readFileSync(new URL('../src/laser.ts', import.meta.url), 'utf8');
assert.match(laser, /class: 'preview-dialog'[\s\S]*?'data-dialog-resize': 'true'/,
  'Preview must opt into the existing dialog resize utility');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
assert.match(css, /\.energy-breakdown th:first-child\s*\{[^}]*min-width: 14em;[^}]*overflow-wrap: normal;[^}]*word-break: normal;/);
assert.match(css, /\.preview-bar\s*\{[^}]*flex-wrap: wrap;/);

class Element {
  constructor(width = 24) { this.width = width; this.style = {}; this.attrs = {}; this.events = new Map(); }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  emit(type, data = {}) { for (const fn of [...(this.events.get(type) ?? [])]) fn({ type, preventDefault() {}, stopPropagation() {}, ...data }); }
  getBoundingClientRect() { return { width: parseFloat(this.style.width) || this.width }; }
  closest() { return dialog; }
  focus() { this.focused = true; }
  setPointerCapture() { this.captured = true; }
  hasPointerCapture() { return this.captured; }
  releasePointerCapture() { this.captured = false; }
}
const dialog = new Element();
const stored = new Map();
globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
globalThis.document = { createElement: () => new Element() };
const observers = [];
globalThis.ResizeObserver = class {
  constructor(fn) { this.fn = fn; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
};
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/previewLayout.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { previewSplitter } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const main = new Element(); main.clientWidth = 1000;
const side = new Element(420);
const split = previewSplitter(main, side, 'Preview information width');
observers[0].fn();
assert.deepEqual([split.tabIndex, split.attrs.role, split.attrs['aria-label'], split.attrs['aria-valuenow']], [0, 'separator', 'Preview information width', '420']);
split.emit('keydown', { key: 'ArrowLeft' });
assert.equal(side.style.width, '430px');
assert.equal(stored.get('kizamubeam.previewSidebarWidth'), '430', 'Divider width survives closing the preview');
split.emit('keydown', { key: 'End' });
assert.equal(side.style.width, '856px');
split.emit('keydown', { key: 'Home' });
assert.equal(side.style.width, '280px');
split.emit('pointerdown', { button: 0, pointerId: 1, clientX: 500 });
split.emit('pointermove', { clientX: 350 });
assert.equal(side.style.width, '430px');
split.emit('pointercancel');
assert.equal(side.style.width, '280px');
assert.equal(stored.get('kizamubeam.previewSidebarWidth'), '280', 'Cancelled divider drag does not save its temporary width');
split.emit('pointerdown', { button: 0, pointerId: 1, clientX: 500 });
split.emit('pointermove', { clientX: 350 });
split.emit('pointerup');
assert.equal(side.style.width, '430px');
split.emit('pointerdown', { button: 0, pointerId: 1, clientX: 500 });
split.emit('pointermove', { clientX: 350 });
split.emit('keydown', { key: 'Escape' });
assert.equal(side.style.width, '430px');
main.clientWidth = 230;
observers[0].fn();
assert.equal(side.style.width, '206px');
assert.equal(split.attrs['aria-valuenow'], '206');
dialog.emit('close');
assert.equal(observers[0].disconnected, true);
const reopenedSide = new Element(420);
const reopened = previewSplitter(main, reopenedSide, 'Preview information width');
observers.at(-1).fn();
assert.equal(reopened.attrs['aria-valuenow'], '206', 'Saved width clamps to a narrow viewport');
main.clientWidth = 1000;
observers.at(-1).fn();
assert.equal(reopenedSide.style.width, '430px', 'Viewport clamping does not overwrite the preferred width');
stored.set('kizamubeam.previewSidebarWidth', 'NaN');
const corruptSide = new Element(420);
previewSplitter(main, corruptSide, 'Preview information width');
observers.at(-1).fn();
assert.equal(corruptSide.style.width, '420px', 'Invalid stored widths are ignored');
globalThis.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
const unavailable = previewSplitter(main, new Element(420), 'Preview information width');
observers.at(-1).fn();
assert.doesNotThrow(() => unavailable.emit('keydown', { key: 'ArrowLeft' }));
console.log('Preview layout regressions: 20 passed');
