// Memory-only tests: no browser, camera, app startup, network, or hardware access.
// Run: node scripts/run-ts.mjs scripts/camera-image-test.ts
import { strict as assert } from 'node:assert';
import { adjustCameraPixels } from '../src/cameraImageProcessing';
import type { CameraHardwareChange } from '../src/cameraImageControls';
import type { CameraImageAdjustments } from '../src/cameraProfile';

const defaults: CameraImageAdjustments = { brightness: 1, contrast: 1, saturation: 1, gamma: 1, grayscale: false };
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn(); passed++; console.log(`ok   ${name}`);
}
function corrected(rgba: number[], changes: Partial<CameraImageAdjustments> = {}) {
  const data = new Uint8ClampedArray(rgba);
  adjustCameraPixels(data, { ...defaults, ...changes });
  return [...data];
}

await test('identity preserves every byte exactly, including alpha and channel order', () => {
  const data = Uint8ClampedArray.from({ length: 256 * 4 }, (_, i) => (i * 73 + 19) % 256);
  const original = data.slice();
  adjustCameraPixels(data, defaults);
  assert.deepEqual(data, original);
});
await test('alpha and fully transparent RGB are preserved under extreme correction', () => {
  assert.deepEqual(corrected([13, 41, 92, 0, 200, 20, 50, 123], {
    brightness: 3, contrast: 3, saturation: 3, gamma: 5, grayscale: true,
  }).slice(0, 4), [13, 41, 92, 0]);
  assert.equal(corrected([200, 20, 50, 123], { brightness: 0 })[3], 123);
  assert.deepEqual(corrected([80, 40, 20, 255], { brightness: 2 }), [160, 80, 40, 255]);
});
await test('brightness, contrast and gamma move in the documented directions', () => {
  assert.ok(corrected([80, 80, 80, 255], { brightness: 2 })[0] > 80);
  assert.ok(corrected([80, 80, 80, 255], { brightness: 0.5 })[0] < 80);
  assert.ok(corrected([80, 180, 128, 255], { contrast: 2 })[0] < 80);
  assert.ok(corrected([80, 180, 128, 255], { contrast: 2 })[1] > 180);
  assert.equal(corrected([0, 255, 80, 255], { contrast: 0 })[0], 128);
  assert.ok(corrected([80, 80, 80, 255], { gamma: 2 })[0] > 80);
  assert.ok(corrected([80, 80, 80, 255], { gamma: 0.5 })[0] < 80);
});
await test('saturation and grayscale use Rec.709 luma without swapping channels', () => {
  assert.deepEqual(corrected([255, 0, 0, 255], { saturation: 0 }), [54, 54, 54, 255]);
  const saturated = corrected([160, 100, 60, 255], { saturation: 2 });
  assert.ok(saturated[0] > 160 && saturated[2] < 60);
  assert.deepEqual(corrected([255, 0, 0, 255], { grayscale: true, saturation: 3 }), [54, 54, 54, 255]);
  // Luma first, then brightness: 0.2126 * 255 * 2 = 108.426.
  assert.deepEqual(corrected([255, 0, 0, 255], { grayscale: true, brightness: 2 }), [108, 108, 108, 255]);
});
await test('input ranges clamp, invalid finite values fall back, and bytes stay bounded', () => {
  const rgba = [90, 180, 240, 33];
  for (const [key, low, high] of [
    ['brightness', 0, 3], ['contrast', 0, 3], ['saturation', 0, 3], ['gamma', 0.1, 5],
  ] as const) {
    assert.deepEqual(corrected(rgba, { [key]: -100 }), corrected(rgba, { [key]: low }));
    assert.deepEqual(corrected(rgba, { [key]: 100 }), corrected(rgba, { [key]: high }));
    assert.deepEqual(corrected(rgba, { [key]: NaN }), rgba);
    assert.deepEqual(corrected(rgba, { [key]: Infinity }), rgba);
  }
  assert.deepEqual(corrected([255, 0, 10, 19], { brightness: 3, contrast: 3, saturation: 3 }), [255, 0, 0, 19]);
  assert.deepEqual(corrected([255, 128, 0, 255], { brightness: 0 }), [0, 0, 0, 255]);
});

// Tiny DOM stand-in exercises event handling and async track races without a browser.
class FakeElement {
  children: (FakeElement | string)[] = [];
  textContent = '';
  className = '';
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  checked = false;
  disabled = false;
  listeners = new Map<string, Set<() => void>>();
  constructor(public tag: string) {}
  append(...children: (FakeElement | string)[]) { this.children.push(...children); }
  replaceChildren(...children: (FakeElement | string)[]) { this.children = children; }
  setAttribute(_name: string, _value: string) {}
  addEventListener(event: string, handler: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }
  removeEventListener(event: string, handler: () => void) { this.listeners.get(event)?.delete(handler); }
  emit(event: string) { for (const handler of [...(this.listeners.get(event) ?? [])]) handler(); }
  get text(): string { return this.textContent + this.children.map(c => typeof c === 'string' ? c : c.text).join(''); }
  all(tag: string): FakeElement[] {
    return this.children.flatMap(c => typeof c === 'string' ? [] : [...(c.tag === tag ? [c] : []), ...c.all(tag)]);
  }
}
class FakeSelect extends FakeElement { constructor() { super('select'); } }
const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'en' } });
const savedSelect = Object.getOwnPropertyDescriptor(globalThis, 'HTMLSelectElement');
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  documentElement: { lang: '' },
  createElement: (tag: string) => tag === 'select' ? new FakeSelect() : new FakeElement(tag),
} });
Object.defineProperty(globalThis, 'HTMLSelectElement', { configurable: true, value: FakeSelect });
const { cameraImageControls } = await import('../src/cameraImageControls');

class FakeTrack {
  readyState = 'live';
  caps: Record<string, unknown> = {
    exposureMode: ['continuous', 'manual'], exposureTime: { min: 1, max: 100, step: 1 },
    zoom: { min: 1, max: 4, step: 0.1 },
  };
  settings: Record<string, unknown> = { exposureMode: 'continuous', exposureTime: 10, zoom: 1 };
  calls: Record<string, unknown>[] = [];
  constraints: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, deviceId: { exact: 'fake-only' } };
  inspectThrows = false;
  apply: (values: Record<string, unknown>) => Promise<void> = async values => { Object.assign(this.settings, values); };
  getCapabilities() { if (this.inspectThrows) throw new Error('inspection denied'); return this.caps; }
  getSettings() { return { ...this.settings }; }
  getConstraints() { return structuredClone(this.constraints); }
  applyConstraints(constraints: MediaTrackConstraints) {
    this.constraints = structuredClone(constraints);
    const values = Object.assign({}, ...constraints.advanced ?? []);
    this.calls.push(values);
    return this.apply(values);
  }
}
function fixture(initial: FakeTrack | null = new FakeTrack()) {
  let track = initial;
  let settings = { ...defaults };
  let hardwareChanges = 0;
  const beforeChanges: CameraHardwareChange[] = [];
  const afterChanges: CameraHardwareChange[] = [];
  let calibrationInvalidated = false;
  const controls = cameraImageControls({
    getTrack: () => track as unknown as MediaStreamTrack | null,
    getSettings: () => settings,
    onChange: value => { settings = value; },
    onBeforeHardwareChange: change => { beforeChanges.push(change); calibrationInvalidated = true; },
    onHardwareChange: change => { hardwareChanges++; afterChanges.push(change); },
  });
  const root = controls.element as unknown as FakeElement;
  const field = (label: string) => {
    const row = root.all('label').find(row => row.text.startsWith(`${label}: `));
    assert.ok(row, label);
    return row.all('input')[0] ?? row.all('select')[0];
  };
  return {
    controls, root, field, beforeChanges, afterChanges,
    get calibrationInvalidated() { return calibrationInvalidated; },
    get settings() { return settings; }, get hardwareChanges() { return hardwareChanges; },
    setTrack: (value: FakeTrack | null) => { track = value; },
    setSettings: (value: CameraImageAdjustments) => { settings = value; },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

try {
  await test('native changes preserve resolution, selected device and previously requested hardware values', async () => {
    const track = new FakeTrack(); const f = fixture(track);
    const mode = f.field('Exposure mode'); mode.value = 'manual'; mode.emit('change'); await settle();
    const exposure = f.field('Exposure time'); exposure.value = '20'; exposure.emit('change'); await settle();
    const zoom = f.field('Zoom'); zoom.value = '2'; zoom.emit('change'); await settle();
    assert.deepEqual(track.constraints.width, { ideal: 1920 });
    assert.deepEqual(track.constraints.height, { ideal: 1080 });
    assert.deepEqual(track.constraints.deviceId, { exact: 'fake-only' });
    assert.equal(track.settings.exposureMode, 'manual');
    assert.equal(track.settings.exposureTime, 20);
    assert.equal(track.settings.zoom, 2);
    assert.deepEqual(Object.assign({}, ...track.constraints.advanced ?? []), { exposureMode: 'manual', exposureTime: 20, zoom: 2 });
    f.controls.dispose();
  });
  await test('refresh synchronizes software fields; reset never applies hardware defaults', () => {
    const track = new FakeTrack(); const f = fixture(track);
    f.setSettings({ ...defaults, brightness: 2, grayscale: true }); f.controls.refresh();
    assert.equal(f.root.all('input')[0].value, '2');
    assert.equal(f.root.all('input').find(input => input.type === 'checkbox')!.checked, true);
    const slider = f.root.all('input')[0]; slider.value = '1.5'; slider.emit('input');
    assert.equal(f.settings.brightness, 1.5);
    f.root.all('button')[0].emit('click');
    assert.deepEqual(f.settings, defaults); assert.equal(track.calls.length, 0);
    f.controls.dispose();
  });
  await test('capability gating rejects absent, malformed, and unreadable controls', () => {
    const track = new FakeTrack();
    track.caps.focusDistance = { min: 0, max: Infinity };
    track.caps.sharpness = { min: 1, max: 1 };
    track.caps.colorTemperature = { min: 1000, max: 9000 };
    track.caps.exposureCompensation = { min: 2, max: 1 };
    const f = fixture(track);
    assert.ok(f.field('Exposure mode')); assert.ok(f.field('Zoom'));
    for (const label of ['Focus distance', 'Sharpness', 'Color temperature', 'Exposure compensation', 'White balance mode']) {
      assert.equal(f.field(label), undefined);
    }
    assert.equal(track.calls.length, 0);
    track.inspectThrows = true; f.controls.refresh(); assert.match(f.root.text, /inspection denied/);
    f.setTrack(null); f.controls.refresh(); assert.match(f.root.text, /no selected open camera/);
    f.controls.dispose();
  });
  await test('only explicit user change applies named advanced constraint and verifies readback', async () => {
    const track = new FakeTrack(); const f = fixture(track);
    f.controls.refresh(); assert.equal(track.calls.length, 0);
    const mode = f.field('Exposure mode'); mode.value = 'manual'; mode.emit('change');
    assert.ok(f.field('Zoom').disabled);
    await settle();
    assert.deepEqual(track.calls, [{ exposureMode: 'manual' }]);
    assert.match(f.root.text, /applied and confirmed/); assert.equal(f.hardwareChanges, 1);
    assert.deepEqual(f.beforeChanges, [], 'Exposure does not preemptively invalidate geometry');
    assert.deepEqual(f.afterChanges, [{ field: 'exposureMode', geometryChanged: false }]);
    assert.equal(f.field('Exposure mode').value, 'manual');
    f.field('Exposure mode').emit('change'); assert.equal(track.calls.length, 1);
    f.controls.dispose();
  });
  await test('silently ignored requests become unavailable, and errors are reported', async () => {
    const track = new FakeTrack(); const f = fixture(track);
    track.apply = async () => {};
    const zoom = f.field('Zoom'); zoom.value = '2'; zoom.emit('change'); await settle();
    assert.equal(f.field('Zoom'), undefined); assert.match(f.root.text, /did not confirm/);
    track.apply = async () => { throw new Error('driver refused'); };
    const exposure = f.field('Exposure time'); exposure.value = '20'; exposure.emit('change'); await settle();
    assert.match(f.root.text, /driver refused/); assert.equal(f.field('Exposure time').disabled, false);
    assert.equal(f.hardwareChanges, 1); f.controls.dispose();
  });
  await test('invalid user values never apply', () => {
    const track = new FakeTrack(); const f = fixture(track);
    for (const value of ['', 'NaN', '100']) {
      const zoom = f.field('Zoom'); zoom.value = value; zoom.emit('change');
    }
    assert.equal(track.calls.length, 0); f.controls.dispose();
  });
  await test('zoom and focus invalidate before the native call and notify after confirmed, ignored or failed requests', async () => {
    for (const [field, label, initial, requested, capability] of [
      ['zoom', 'Zoom', 1, 2, { min: 1, max: 4 }],
      ['focusMode', 'Focus mode', 'continuous', 'manual', ['continuous', 'manual']],
      ['focusDistance', 'Focus distance', 1, 2, { min: 0, max: 10 }],
    ] as const) {
      for (const outcome of ['confirmed', 'ignored', 'failed']) {
        const track = new FakeTrack();
        track.caps[field] = capability; track.settings[field] = initial;
        const f = fixture(track);
        track.apply = async values => {
          assert.equal(f.calibrationInvalidated, true, `${field}/${outcome}: invalidate before native apply`);
          assert.deepEqual(f.beforeChanges, [{ field, geometryChanged: true }]);
          assert.deepEqual(f.afterChanges, [], 'After callback must wait for the request');
          if (outcome === 'failed') throw new Error('optical request refused');
          if (outcome === 'confirmed') Object.assign(track.settings, values);
        };
        const input = f.field(label); input.value = String(requested); input.emit('change');
        await settle();
        assert.equal(track.calls.length, 1);
        assert.deepEqual(f.afterChanges, [{ field, geometryChanged: true }], `${field}/${outcome}`);
        if (outcome === 'failed') assert.match(f.root.text, /optical request refused/);
        f.controls.dispose();
      }
    }
  });
  await test('unexpected readback dimensions invalidate geometry even for exposure changes', async () => {
    const track = new FakeTrack(); track.settings.width = 1920; track.settings.height = 1080;
    const f = fixture(track);
    track.apply = async values => { Object.assign(track.settings, values, { width: 1280 }); };
    const input = f.field('Exposure time'); input.value = '20'; input.emit('change'); await settle();
    assert.deepEqual(f.beforeChanges, []);
    assert.deepEqual(f.afterChanges, [{ field: 'exposureTime', geometryChanged: true }]);
    assert.match(f.root.text, /dimensions changed/); f.controls.dispose();
  });
  await test('track replacement and disposal discard pending completions and callbacks', async () => {
    const old = new FakeTrack(); const next = new FakeTrack(); const f = fixture(old);
    let resolve!: () => void;
    old.apply = () => new Promise<void>(done => { resolve = done; });
    const zoom = f.field('Zoom'); zoom.value = '2'; zoom.emit('change');
    assert.equal(f.calibrationInvalidated, true);
    assert.deepEqual(f.beforeChanges, [{ field: 'zoom', geometryChanged: true }]);
    f.setTrack(next); f.controls.refresh();
    assert.equal(f.field('Zoom').disabled, false);
    resolve(); await settle();
    assert.equal(f.hardwareChanges, 0); assert.equal(next.calls.length, 0);
    assert.equal(f.calibrationInvalidated, true, 'Stale completion cannot undo pre-request invalidation');
    assert.equal(f.field('Zoom').value, '1');
    next.apply = () => new Promise<void>(done => { resolve = done; });
    const newZoom = f.field('Zoom'); newZoom.value = '2'; newZoom.emit('change');
    f.controls.dispose(); resolve(); await settle();
    assert.equal(f.hardwareChanges, 0);
    assert.equal(f.beforeChanges.length, 2, 'Each optical request invalidates before disposal/replacement');
    f.controls.refresh(); newZoom.emit('change'); assert.equal(next.calls.length, 1);
  });
  await test('stale optical rejection cannot notify a replacement track or undo prior invalidation', async () => {
    const old = new FakeTrack(); const next = new FakeTrack(); const f = fixture(old);
    let reject!: (error: Error) => void;
    old.apply = () => new Promise<void>((_resolve, fail) => { reject = fail; });
    const zoom = f.field('Zoom'); zoom.value = '2'; zoom.emit('change');
    f.setTrack(next); f.controls.refresh(); reject(new Error('stale optical failure')); await settle();
    assert.equal(f.calibrationInvalidated, true);
    assert.deepEqual(f.beforeChanges, [{ field: 'zoom', geometryChanged: true }]);
    assert.deepEqual(f.afterChanges, []); assert.equal(next.calls.length, 0);
    assert.equal(f.root.text.includes('stale optical failure'), false); f.controls.dispose();
  });
} finally {
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument);
  else Reflect.deleteProperty(globalThis, 'document');
  if (savedSelect) Object.defineProperty(globalThis, 'HTMLSelectElement', savedSelect);
  else Reflect.deleteProperty(globalThis, 'HTMLSelectElement');
}
console.log(`\n${passed} camera image tests passed (memory only).`);
