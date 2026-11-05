// Run: node scripts/calibration-dialog-offline-test.mjs
// Adapted from the camera PR's read-only camera-ui-offline-test.mjs fake DOM.
// Actual cameraui + calibrationMachineControls + camera mathematics; all app,
// acquisition, native, firmware and transport boundaries are strict in-memory doubles.
// No app bootstrap, browser, hardware, network, discovery, or output files.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const forbidden = [];
const deny = (name) => () => {
  forbidden.push(name);
  throw new Error(`Forbidden offline operation: ${name}`);
};
class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = new Map();
    this.attributes = {}; this.style = {}; this.className = '';
    this.disabled = false; this.hidden = false; this.value = '';
    this.width = 32; this.height = 18;
    this.classList = { toggle: (name, enabled) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    } };
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof Element) { node.remove(); node.parentNode = this; }
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) if (node instanceof Element) node.parentNode = null;
    this.children = []; this.append(...nodes);
  }
  get firstChild() { return this.children[0] ?? null; }
  set textContent(text) { this.replaceChildren(String(text)); }
  get textContent() { return this.children.map((node) => node instanceof Element ? node.textContent : node).join(''); }
  set innerHTML(text) { this.textContent = text; }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key === 'class') this.className = String(value);
    else if (['disabled', 'checked', 'selected', 'open'].includes(key)) this[key] = true;
    else this[key] = String(value);
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  async emit(type, extra = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])])
      await fn({ target: this, preventDefault() {}, stopPropagation() {}, ...extra });
  }
  async click() { if (!this.disabled) await this.emit('click'); }
  get valueAsNumber() { return String(this.value).trim() ? Number(this.value) : NaN; }
  get validity() { return { valid: Number.isFinite(this.valueAsNumber) && this.valueAsNumber >= Number(this.min ?? -Infinity) }; }
  get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
  querySelectorAll(selector) {
    const matches = (node) => selector.split(',').some((part) => {
      const s = part.trim();
      return s.startsWith('.') ? node.className.split(' ').includes(s.slice(1)) : node.tag === s;
    });
    return this.children.filter((node) => node instanceof Element).flatMap((node) => [
      ...(matches(node) ? [node] : []), ...node.querySelectorAll(selector),
    ]);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 32, height: 18 }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  getContext() { return context; }
  setPointerCapture() {}
  showModal() { this.open = true; }
  async close() { this.open = false; await this.emit('close'); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }
}
class Video extends Element {
  constructor() { super('video'); this.videoWidth = 32; this.videoHeight = 18; }
}
class Select extends Element { constructor() { super('select'); } }
const context = Object.fromEntries([
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'arc', 'fill', 'stroke',
  'fillText', 'setTransform', 'putImageData', 'moveTo', 'lineTo',
  'save', 'restore', 'rect', 'clip', 'setLineDash',
].map((name) => [name, () => {}]));
const previewSources = [];
context.drawImage = (source) => previewSources.push(source);
context.getImageData = (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
context.createImageData = (w, h) => context.getImageData(0, 0, w, h);
const storage = new Map(), intervals = new Map(), timeouts = new Map(), animations = new Map(), observers = [];
let nextTimer = 1, now = 1000;
const timer = (map) => (fn) => { const id = nextTimer++; map.set(id, fn); return id; };
class Observer {
  constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
}
Object.assign(globalThis, {
  document: { createElement: (tag) => tag === 'video' ? new Video() : tag === 'select' ? new Select() : new Element(tag), activeElement: null },
  HTMLVideoElement: Video, HTMLSelectElement: Select,
  localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  MutationObserver: Observer, ResizeObserver: Observer,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: timer(animations), cancelAnimationFrame: (id) => animations.delete(id),
  setInterval: timer(intervals), clearInterval: (id) => intervals.delete(id),
  setTimeout: timer(timeouts), clearTimeout: (id) => timeouts.delete(id),
  fetch: deny('fetch'), WebSocket: deny('WebSocket'), XMLHttpRequest: deny('XMLHttpRequest'),
  EventSource: deny('EventSource'), Image: deny('Image'),
  confirm: deny('confirm'),
});
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
document.body = new Element('body');
globalThis.window = { devicePixelRatio: 1, setInterval, clearInterval, setTimeout, clearTimeout };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaDevices: { getUserMedia: deny('getUserMedia'), enumerateDevices: deny('enumerateDevices') },
  serial: { getPorts: deny('serial.getPorts'), requestPort: deny('serial.requestPort') },
  usb: { getDevices: deny('usb.getDevices'), requestDevice: deny('usb.requestDevice') },
} });

const machineListeners = new Set(), deviceListeners = new Set();
const subscribe = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };
const device = { id: 'offline-fixed', name: 'Offline machine', conn: 'serial', port: 'TEST_ONLY', fw: 'grbl', zAxis: true, limitSwitches: 'yes' };
let expectedSend = null;
const sent = [];
const machine = {
  connected: false, connecting: false, running: false, where: 'in-memory only',
  status: { state: '', wpos: null, sd: null }, on: subscribe(machineListeners),
  connect: deny('machine.connect'), disconnect: deny('machine.disconnect'), runJob: deny('machine.runJob'),
  send: async (line) => {
    if (!expectedSend) return deny('machine.send')();
    expectedSend(line); sent.push(line);
  },
};
const streams = [];
let listCalls = 0, grabs = 0, freshCalls = 0, nextFresh = null;
class CameraStream {
  constructor() { this.open = false; this.width = 32; this.height = 18; this.video = new Video(); streams.push(this); }
  get view() { return this.video; }
  static async list() { listCalls++; return []; }
  start = deny('CameraStream.start');
  grab = deny('CameraStream.grab');
  freshFrames = deny('CameraStream.freshFrames');
  stop() { this.open = false; }
}
const dictionary = JSON.parse(await readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
const translateText = (text, vars = {}) => (dictionary[text] ?? text).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
globalThis.__calibrationMocks = {
  CameraStream, cameraError: (error) => String(error), machine, device,
  onDeviceChange: subscribe(deviceListeners), runBlocker: () => null, isTauri: () => true,
  openText: deny('openText'), saveText: deny('saveText'), defaultLayer: deny('defaultLayer'), loadDoc: deny('loadDoc'), translate: deny('model.translate'),
  buildJob: deny('buildJob'), estimate: deny('estimate'), writeGCode: deny('writeGCode'),
  FIRMWARES: { grbl: { home: 'TEST_HOME', jog: deny('firmware.jog') } },
  jogLines: () => ['TEST_ONLY_JOG'], rotaryOn: () => false,
  dec: (text) => text, t: translateText, tBackend: (text) => text, tn: (one, many, n) => translateText(n === 1 ? one : many, { n }),
  openWorkpieceDialog: deny('openWorkpieceDialog'), hasNative: deny('hasNative'), native: deny('native'),
};
const mocks = {
  './laser': ['device', 'onDeviceChange', 'runBlocker'], './machine': ['machine', 'isTauri'],
  './files': ['saveText', 'openText'], './model': ['defaultLayer', 'loadDoc', 'translate'],
  './gcode': ['buildJob', 'estimate', 'writeGCode', 'FIRMWARES', 'jogLines', 'rotaryOn'],
  './i18n': ['dec', 't', 'tn', 'tBackend'], './workpieceDialog': ['openWorkpieceDialog'], './native': ['hasNative', 'native'],
};
for (const mount of ['fixed', 'head']) storage.set('kizamubeam.camera', JSON.stringify({
  ...JSON.parse(storage.get('kizamubeam.camera') ?? '{}'),
  [`offline-${mount}`]: { cur: 0, cams: [{ id: `fake-${mount}`, name: `Offline ${mount}`, mount, live: false }] },
}));
const source = fileURLToPath(new URL('../src/', import.meta.url));
// Also runs against the independent camera-adjustments PR after a merge.
const allowedFiles = new Set(['camera.ts', 'dom.ts', 'icons.ts', 'calibrationMachineControls.ts',
  'cameraProfile.ts', 'cameraFineTune.ts', 'cameraImageProcessing.ts', 'cameraImageControls.ts', 'cameraDisplay.ts']);
const bundle = await build({
  absWorkingDir: root, stdin: {
    contents: await readFile(new URL('../src/cameraui.ts', import.meta.url), 'utf8'),
    resolveDir: source, loader: 'ts', sourcefile: 'calibration-dialog-offline-entry.ts',
  }, bundle: true, write: false, format: 'esm', platform: 'node', metafile: true,
  plugins: [{ name: 'strict-offline-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (Object.hasOwn(mocks, args.path) || args.path === './camera') return { path: args.path, namespace: 'offline' };
      const name = args.path.split(/[\\/]/).at(-1).replace(/\.ts$/, '') + '.ts';
      if (allowedFiles.has(name) && (args.path.startsWith('./') || args.path === source + name)) return;
      throw new Error(`Unexpected source import: ${args.path} from ${args.importer}`);
    });
    b.onLoad({ filter: /.*/, namespace: 'offline' }, (args) => ({
      contents: args.path === './camera'
        ? `export * from ${JSON.stringify(fileURLToPath(new URL('../src/camera.ts', import.meta.url)))}; export const { CameraStream, cameraError } = globalThis.__calibrationMocks;`
        : `export const { ${mocks[args.path].join(',')} } = globalThis.__calibrationMocks;`,
      loader: 'js', resolveDir: source,
    }));
  } }],
});
for (const input of Object.keys(bundle.metafile.inputs)) {
  if (input.startsWith('offline:') || input === 'src/calibration-dialog-offline-entry.ts') continue;
  assert.ok(allowedFiles.has(input.split(/[\\/]/).at(-1)), `Unexpected bundled source: ${input}`);
}
assert.ok(!bundle.outputFiles[0].text.includes('getUserMedia'), 'Real acquisition must be tree-shaken out');
const { cameraTab } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const all = (node, selector) => node.querySelectorAll(selector);
const button = (node, text) => {
  const found = all(node, 'button').find((el) => el.textContent === translateText(text));
  assert.ok(found, `Missing button: ${text}`); return found;
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const emitMachine = async (type) => { for (const fn of [...machineListeners]) fn({ type }); await flush(); };
const emitDevice = async (id) => { device.id = id; for (const fn of [...deviceListeners]) fn(); await flush(); };
const resources = () => ({ machine: machineListeners.size, device: deviceListeners.size,
  intervals: intervals.size, timeouts: timeouts.size, animations: animations.size,
  observers: observers.filter((o) => o.active).length });
const ed = { doc: { bed: { w: 400, h: 300 } }, sel: [], on() {}, redraw() {} };
const tab = cameraTab(ed);
document.body.append(tab);
await flush();
assert.equal(listCalls, 1, 'Only fake static camera list queried');
assert.equal(streams.length, 1);
assert.deepEqual(forbidden, [], 'Startup cannot acquire, connect, send, build a job or use network');
assert.equal(intervals.size + timeouts.size, 0, 'Startup starts no polling/acquisition');
assert.ok(animations.size <= 1, 'Only optional camera-panel animation is allowed');
const baseline = resources();
const openDialog = async () => {
  streams.at(-1).open = true; // Pretend somebody already opened a camera; never acquire one.
  await emitMachine('connection');
  await button(tab, 'Kalibrieren …').click();
  const dialog = all(document.body, 'dialog')[0];
  assert.ok(dialog?.open, 'Actual camera-tab action opens actual calibration dialog');
  assert.equal(all(dialog, '.calibration-machine-controls').length, 1, 'Actual new panel is wired into wizard');
  return dialog;
};
const assertClean = async (dialog, snapshot = baseline) => {
  await flush();
  assert.equal(dialog.isConnected, false);
  assert.deepEqual(resources(), snapshot, 'Close removes dialog subscriptions, timers, observer and animation');
  assert.deepEqual(forbidden, []);
};
let dialog = await openDialog();
const panel = all(dialog, '.calibration-machine-controls')[0];
for (const label of ['Home…', 'Z+', 'Z−', '←', '→', '↑', '↓']) {
  assert.equal(button(panel, label).disabled, true, `${label} is disabled while disconnected`);
  await button(panel, label).emit('click'); // Handler guards survive bypassing disabled DOM.
}
assert.equal(button(panel, 'Connect').disabled, false, 'Explicit connection remains available');
assert.equal(button(dialog, 'Markierungen lasern').disabled, true);
await button(dialog, 'Markierungen lasern').emit('click');
assert.equal(button(dialog, 'Übernehmen').disabled, true);
assert.ok(animations.size > 0, 'Already-open fake stream drives only a scheduled preview');
assert.ok(previewSources.includes(streams.at(-1).video));
assert.equal(sent.length, 0, 'Opening/guarded disabled actions never send');
assert.deepEqual(forbidden, []);
await button(dialog, 'Abbrechen').click();
await assertClean(dialog);
for (const label of ['Connect', 'Home…', '→', 'Z+']) await button(panel, label).emit('click');
assert.deepEqual(forbidden, [], 'Detached machine controls cannot issue requests');

dialog = await openDialog();
await emitDevice('offline-head');
await assertClean(dialog);
const headBaseline = resources();
machine.connected = true;
machine.status = { state: 'Idle', wpos: [200, 150, 0], sd: null };
await emitMachine('connection');
await emitMachine('status');
now += 1000; // Synthetic monotonic time: no sleep, no hardware status polling.
const stream = streams.at(-1);
stream.grab = () => { grabs++; return new Element('canvas'); };
stream.freshFrames = async (n) => { assert.equal(n, 2); freshCalls++; if (nextFresh) await nextFresh; };
const points = async (dlg) => {
  const view = all(dlg, '.cal-view')[0];
  for (const [clientX, clientY] of [[2, 2], [30, 2], [2, 16], [30, 16]]) {
    await view.emit('pointerdown', { button: 0, pointerId: 1, clientX, clientY });
    await view.emit('pointerup');
  }
};
const captureDraft = async (dlg) => {
  const grid = all(dlg, 'select')[0]; grid.value = '2'; await grid.emit('change');
  await button(dlg, 'Foto aufnehmen').click();
  await points(dlg);
  assert.equal(button(dlg, 'Übernehmen').disabled, false, 'Real calibration mathematics accepts four synthetic head-camera correspondences');
};
dialog = await openDialog();
await emitMachine('status');
await captureDraft(dialog);
const storedBeforeMotion = storage.get('kizamubeam.camera');
expectedSend = (line) => {
  assert.equal(line, 'TEST_ONLY_JOG');
  assert.equal(button(dialog, 'Übernehmen').disabled, true, 'Manual motion invalidates draft BEFORE fake send');
};
await button(all(dialog, '.calibration-machine-controls')[0], '→').click();
await flush(); expectedSend = null;
assert.deepEqual(sent, ['TEST_ONLY_JOG']);
assert.equal(button(dialog, 'Übernehmen').disabled, true);
assert.equal(storage.get('kizamubeam.camera'), storedBeforeMotion, 'Invalid draft never overwrites saved calibration');
await emitMachine('status'); now += 1000;
await captureDraft(dialog);
machine.status.wpos = [201, 150, 0];
await emitMachine('status');
assert.equal(button(dialog, 'Übernehmen').disabled, true, 'Reported head motion invalidates captured draft');
await points(dialog);
assert.equal(button(dialog, 'Übernehmen').disabled, true, 'Old frame cannot reconstruct invalidated draft');
await button(dialog, 'Abbrechen').click();
await assertClean(dialog, headBaseline);

// A capture waiting for fresh frames must not grab after close, device change,
// or motion-generation invalidation, even when its promise eventually resolves.
for (const interruption of ['close', 'device change', 'head motion', 'manual jog']) {
  now += 1000;
  dialog = await openDialog();
  await emitMachine('status');
  let release;
  nextFresh = new Promise((resolve) => { release = resolve; });
  const before = grabs;
  const beforeFresh = freshCalls;
  const pending = button(dialog, 'Foto aufnehmen').click();
  await flush();
  assert.equal(freshCalls, beforeFresh + 1, `${interruption}: capture is waiting inside fake freshFrames`);
  assert.equal(grabs, before);
  if (interruption === 'close') await button(dialog, 'Abbrechen').click();
  else if (interruption === 'device change') await emitDevice('offline-fixed');
  else if (interruption === 'head motion') {
    machine.status.wpos = [machine.status.wpos[0] + 1, 150, 0];
    await emitMachine('status');
  } else {
    expectedSend = (line) => assert.equal(line, 'TEST_ONLY_JOG');
    await button(all(dialog, '.calibration-machine-controls')[0], '→').click();
    await flush(); expectedSend = null;
  }
  release(); await pending; await flush(); nextFresh = null;
  assert.equal(grabs, before, `${interruption}: stale capture completion must not grab a frame`);
  assert.equal(button(dialog, 'Übernehmen').disabled, true);
  if (dialog.isConnected) await button(dialog, 'Abbrechen').click();
  await assertClean(dialog, headBaseline);
  if (interruption === 'device change') {
    await emitDevice('offline-head');
    // Device change intentionally discards the old stream. Inject only in-memory frames again.
    const replacement = streams.at(-1);
    replacement.grab = stream.grab; replacement.freshFrames = stream.freshFrames;
  }
}
assert.ok(freshCalls >= 6 && grabs >= 2, 'Synthetic frames exercised actual head capture and fit');

// Every reported axis change matters, including Z-only motion.
now += 1000;
dialog = await openDialog(); await emitMachine('status');
await captureDraft(dialog);
machine.status.wpos = [machine.status.wpos[0], 150, 0.01];
await emitMachine('status');
assert.equal(button(dialog, 'Übernehmen').disabled, true, 'Z-only motion invalidates head-camera draft');
await button(dialog, 'Abbrechen').click(); await assertClean(dialog, headBaseline);

// Closing preserves only the marking section, including the head field centre.
dialog = await openDialog();
const markFields = all(all(dialog, '.cal-step')[0], 'input');
for (const [index, value] of [42, 123, 124, 3, 2100, 17].entries()) {
  markFields[index].value = String(value); await markFields[index].emit('blur');
}
await captureDraft(dialog);
await button(dialog, 'Abbrechen').click();
const headMarks = JSON.parse(storage.get('kizamubeam.camera'))['offline-head'].cams[0].marks;
assert.deepEqual(headMarks, { n: 2, margin: 25, field: 42, size: 3, speed: 2100, power: 17, center: { x: 123, y: 124 } });
assert.equal(JSON.parse(storage.get('kizamubeam.camera'))['offline-head'].cams[0].calib, null,
  'Cancel never accepts calculated calibration');
dialog = await openDialog();
assert.deepEqual(all(all(dialog, '.cal-step')[0], 'input').map((input) => Number(input.value)), [42, 123, 124, 3, 2100, 17]);
assert.equal(button(dialog, 'Übernehmen').disabled, true);
await points(dialog);
assert.equal(button(dialog, 'Übernehmen').disabled, true, 'No old photo or clicked points survive reopening');
await button(dialog, 'Abbrechen').click();

await emitDevice('offline-fixed');
const fixedStream = streams.at(-1);
fixedStream.grab = stream.grab;
dialog = await openDialog(); await emitMachine('status');
await captureDraft(dialog);
expectedSend = () => assert.equal(button(dialog, 'Übernehmen').disabled, false, 'Fixed-camera draft survives manual motion');
await button(all(dialog, '.calibration-machine-controls')[0], '→').click();
await flush(); expectedSend = null;
machine.status.wpos = [250, 150, 1]; await emitMachine('status');
assert.equal(button(dialog, 'Übernehmen').disabled, false, 'Fixed-camera draft survives reported XYZ motion');
await button(dialog, 'Übernehmen').click();
const accepted = JSON.parse(storage.get('kizamubeam.camera'))['offline-fixed'].cams[0].calib;
assert.ok(accepted);
dialog = await openDialog();
const fixedFields = all(all(dialog, '.cal-step')[0], 'input');
for (const [index, value] of [23, 4, 1900, 12].entries()) {
  fixedFields[index].value = String(value); await fixedFields[index].emit('blur');
}
await button(dialog, 'Abbrechen').click();
const fixedSaved = JSON.parse(storage.get('kizamubeam.camera'))['offline-fixed'].cams[0];
assert.deepEqual(fixedSaved.calib, accepted, 'Cancel preserves already accepted calibration');
assert.deepEqual(fixedSaved.marks, { n: 2, margin: 23, field: 40, size: 4, speed: 1900, power: 12 });
dialog = await openDialog();
assert.deepEqual(all(all(dialog, '.cal-step')[0], 'input').map((input) => Number(input.value)), [23, 4, 1900, 12]);
assert.equal(button(dialog, 'Übernehmen').disabled, true);
await button(dialog, 'Abbrechen').click();
assert.deepEqual(forbidden, [], 'No real app, hardware, acquisition, transport, discovery or network operations');
console.log('Calibration dialog: offline startup, real fixed-camera controls, disconnected guards, close/device cleanup, head fit, motion invalidation and pending-capture generations passed.');
