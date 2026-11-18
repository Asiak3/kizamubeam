// Real Editor.render/renderImage pipeline, using the vector-offline import boundary.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { newDoc, defaultLayer, type Obj, type Mat } from '../src/model';
import { DEFAULT_GRID } from '../src/grid';
import { resolveTypography, type TypographyPreset } from '../src/uiTypography';
import { SNAP_LABELS } from '../src/snap';
import { RULER } from '../src/editor/shared';
import { emptySketch, addPt, addLine, addCon, sketchJson } from '../src/sketch/model';

type Call = { op: string; args: unknown[]; mat: Mat; font: string; fillStyle: string };
// Deliberately explicit Canvas stubs: an unexpected method must fail, not disappear.
class DOMCanvasStubs {
  calls: Call[] = [];
  mat: Mat = [1, 0, 0, 1, 0, 0];
  font = '10px sans-serif';
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  textBaseline = 'alphabetic';
  textAlign = 'left';
  stack: { mat: Mat; font: string; fillStyle: string; strokeStyle: string; lineWidth: number; globalAlpha: number; textBaseline: string; textAlign: string }[] = [];
  failText = false;
  record(op: string, ...args: unknown[]) {
    this.calls.push({ op, args, mat: [...this.mat], font: this.font, fillStyle: this.fillStyle });
  }
  save() {
    this.stack.push({ mat: [...this.mat], font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, textBaseline: this.textBaseline, textAlign: this.textAlign });
  }
  restore() { const saved = this.stack.pop(); assert.ok(saved, 'balanced canvas restore'); Object.assign(this, saved); }
  setTransform(...m: Mat) { this.mat = m; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const [ma, mb, mc, md, me, mf] = this.mat;
    this.mat = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d, ma * e + mc * f + me, mb * e + md * f + mf];
  }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a: number) { this.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); }
  setLineDash() {}
  beginPath() {}
  closePath() {}
  moveTo(...args: number[]) { this.record('moveTo', ...args); }
  lineTo(...args: number[]) { this.record('lineTo', ...args); }
  rect(...args: number[]) { this.record('rect', ...args); }
  arc(...args: number[]) { this.record('arc', ...args); }
  fillRect(...args: number[]) { this.record('fillRect', ...args); }
  strokeRect(...args: number[]) { this.record('strokeRect', ...args); }
  fill() { this.record('fill'); }
  stroke() { this.record('stroke'); }
  fillText(...args: unknown[]) {
    this.record('fillText', ...args);
    if (this.failText) throw new Error('injected canvas text failure');
  }
  strokeText(...args: unknown[]) { this.record('strokeText', ...args); }
  measureText(text: string) { return { width: text.length * parseFloat(this.font.match(/[\d.]+px/)![0]) * 0.6 }; }
  get context() { return this as unknown as CanvasRenderingContext2D; }
}
class MockPath2D {
  moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} rect() {} addPath() {}
}
const g = globalThis as Record<string, unknown>;
g.Path2D = MockPath2D;
g.DOMMatrix = class { constructor(public values: number[]) {} };
// Keep the font-loading state pending, so drawText exercises the real browser-text
// fallback without fetching bundled fonts (the offline harness excludes their bytes).
Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } });
Object.assign(window, { queryLocalFonts: () => new Promise(() => {}) });

const offscreens: { canvas: HTMLCanvasElement; recording: DOMCanvasStubs }[] = [];
let exportFailure: 'render' | 'encode' | null = null;
function canvas(recording: DOMCanvasStubs, width = 1600, height = 1200): HTMLCanvasElement {
  return { width, height, style: {}, getContext: () => recording.context,
    toDataURL(mime: string) {
      assert.equal(mime, 'image/png');
      assert.ok(recording.calls.some((c) => c.op === 'fillText'), 'real render reached ruler text before encoding');
      if (exportFailure === 'encode') throw new Error('injected PNG encoding failure');
      return 'data:image/png;base64,offline-recording';
    } } as unknown as HTMLCanvasElement;
}
document.createElement = ((tag: string) => {
  assert.equal(tag, 'canvas');
  const recording = new DOMCanvasStubs();
  recording.failText = exportFailure === 'render';
  const off = canvas(recording);
  offscreens.push({ canvas: off, recording });
  return off;
}) as typeof document.createElement;

function editor(workspace: TypographyPreset = 150) {
  const ed = Object.create(Editor.prototype) as Editor;
  const recording = new DOMCanvasStubs();
  Object.assign(ed, { doc: newDoc(), currentLayer: 0, sel: [], tool: 'select', draft: null, continuedFrom: null, drag: null,
    view: { zoom: 2.5, ox: 73, oy: -31 }, canvas: canvas(recording), ctx: recording.context, dpr: 2,
    typo: resolveTypography({ interface: 80, supporting: 125, technical: 150, workspace }),
    grid: { ...DEFAULT_GRID, show: false }, filled: false, dark: false, centerMarks: 'off',
    cursor: { x: 40, y: 50 }, snapHit: null, alignGuides: [], nodeEditObj: null, nodeHover: null, segHover: null,
    jointPicks: [], jointHover: null, relPicks: [], relHover: null, sketchEdit: null, builderSession: null,
    isolation: null, overlapHover: null, pivot: null, rotateMode: false, dirty: false });
  ed.doc.layers[0] = defaultLayer(0);
  return { ed, recording };
}
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
function near(actual: number, expected: number, message = '') {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}
function one(calls: Call[], op: string, text: string) {
  const found = calls.filter((c) => c.op === op && c.args[0] === text);
  assert.equal(found.length, 1, `${op} ${text} is reached exactly once`);
  return found[0];
}
function fontPx(c: Call) { return parseFloat(c.font.match(/[\d.]+px/)![0]); }
function devicePoint(c: Call) {
  const [x, y] = c.args.slice(1) as number[];
  const [a, b, cc, d, e, f] = c.mat;
  return [a * x + cc * y + e, b * x + d * y + f];
}

for (const preset of [80, 125, 150] as const) {
  test(`render ${preset}%: snap/rotation boxes and rulers scale once in screen space`, () => {
    const { ed, recording } = editor(preset), f = preset / 100;
    ed.snapHit = { kind: 'node', p: { x: 20, y: 30 } };
    Object.assign(ed, { drag: { type: 'rotate', angle: 37.5, center: { x: 10, y: 20 } } });
    ed.render();
    for (const [label, base, height, padding] of [[SNAP_LABELS.node, 11, 16, 8], ['37.5°', 12, 18, 10]] as const) {
      const text = one(recording.calls, 'fillText', label);
      near(fontPx(text), base * f, 'font');
      assert.deepEqual(text.mat, [2, 0, 0, 2, 0, 0], 'overlay has DPR only, not world zoom/offset');
      const box = recording.calls[recording.calls.indexOf(text) - 1];
      assert.equal(box.op, 'fillRect');
      near(box.args[2] as number, label.length * base * f * 0.6 + padding, 'measured box width');
      near(box.args[3] as number, height * f, 'box height');
      near((box.args[3] as number) * box.mat[3], height * f * ed.dpr, 'device box height');
    }
    const snap = one(recording.calls, 'fillText', SNAP_LABELS.node);
    // Snap rounds the world-to-screen anchor before adding its fixed offsets.
    const [sx, sy] = devicePoint(snap);
    near(sx, (Math.round(20 * 2.5 + 73) + 0.5 + 14) * 2, 'snap device x');
    near(sy, (Math.round(30 * 2.5 - 31) + 0.5 + 8 + 8 * f) * 2, 'snap device y');
    const rotation = one(recording.calls, 'fillText', '37.5°');
    assert.deepEqual(devicePoint(rotation), [(40 * 2.5 + 73 + 14 + 5 * f) * 2, (50 * 2.5 - 31 + 10 + 9 * f) * 2]);
    const ruler = recording.calls.find((c) => c.op === 'fillText' && c.args[0] === '0' && c.args[2] === 2);
    assert.ok(ruler, 'real renderRulers reached');
    near(fontPx(ruler), 10 * f, 'ruler font');
    assert.deepEqual(devicePoint(ruler), [(Math.round(73) + 0.5 + 2) * 2, 4]);
  });

  test(`render ${preset}%: joint label and circle cancel world zoom once`, () => {
    const { ed, recording } = editor(preset), f = preset / 100;
    const obj: Obj = { id: 1, m: [1, 0, 0, 1, 7, 9], layer: 0,
      shape: { kind: 'path', subs: [{ closed: false, nodes: [{ x: 10, y: 20 }, { x: 30, y: 20 }] }] } };
    ed.doc.objs = [obj]; ed.tool = 'joint';
    ed.jointPicks = [{ obj, m: obj.m, sub: 0, seg: 0 }];
    ed.render();
    const text = one(recording.calls, 'fillText', '1');
    near(fontPx(text) * text.mat[0], 11 * f * 2, 'device font cancels zoom');
    assert.deepEqual(devicePoint(text), [(27 * 2.5 + 73) * 2, (29 * 2.5 - 31 + 0.5) * 2]);
    const circle = recording.calls.find((c) => c.op === 'arc' && c.args[0] === 27 && c.args[1] === 29);
    assert.ok(circle, 'real joint marker reached');
    near((circle.args[2] as number) * circle.mat[0], 8 * f * 2, 'device marker radius');
  });
}

test('render: document text geometry, font and model do not follow any UI typography group', () => {
  const { ed, recording } = editor(100);
  const obj: Obj = { id: 2, layer: 0, m: [1.2, 0, 0, 0.8, 12, 18], shape: { kind: 'text',
    text: 'Document text', font: 'Offline missing font', size: 7, bold: false, italic: false, upper: false,
    align: 'left', hSpace: 0, vSpace: 0 } };
  ed.doc.objs = [obj];
  const before = JSON.stringify(ed.doc);
  ed.render();
  const baseline = one(recording.calls, 'strokeText', 'Document text');
  for (const preset of [80, 125, 150] as const) {
    ed.typo = resolveTypography({ interface: preset, supporting: preset, technical: preset, workspace: preset });
    recording.calls = []; ed.render();
    assert.deepEqual(one(recording.calls, 'strokeText', 'Document text'), baseline);
    assert.equal(JSON.stringify(ed.doc), before, 'render is document-immutable');
  }
});

test('render: sketch constraint label offset scales once, including its hit box', () => {
  const { ed, recording } = editor(150);
  const sk = emptySketch(), a = addPt(sk, 10, 20), b = addPt(sk, 30, 20);
  const line = addLine(sk, a.id, b.id);
  const con = addCon(sk, 'horizontal', [line.id]);
  const json = sketchJson(sk);
  const obj: Obj = { id: 3, layer: 0, m: [1, 0, 0, 1, 7, 9],
    shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: json }, subs: [] } };
  ed.doc.objs = [obj];
  ed.sketchEdit = { obj, m: obj.m, sk, json, orig: json, tool: 'select', sel: new Set(), hover: null,
    draft: [], draftIds: [], dimPick: [], status: null, drag: null, labels: [] };
  ed.render();
  const box = ed.sketchEdit!.labels.find((l) => l.id === con.id);
  assert.ok(box, 'real renderSketch produced hit box');
  near(box.h, 16 * 1.5, 'hit box height');
  const text = recording.calls.find((c) => c.op === 'fillText' && fontPx(c) === 11 * 1.5);
  assert.ok(text, 'sketch glyph drawn');
  near(box.w, String(text.args[0]).length * 11 * 1.5 * 0.6 + 8, 'hit box measured width');
  const expectedCenterY = (29 * 2.5 - 31) + 13 * 1.5;
  near(box.y, Math.round(expectedCenterY - box.h / 2), 'constraint offset uses workspace factor once');
});

const restoredKeys = ['canvas', 'ctx', 'dpr', 'view', 'sel', 'nodeHover', 'segHover', 'snapHit', 'alignGuides',
  'draft', 'continuedFrom', 'centerMarks', 'isolation', 'builderSession', 'overlapHover', 'typo'] as const;
for (const failure of [null, 'render', 'encode'] as const) {
  test(`renderImage: baseline pipeline and full state restore (${failure ?? 'success'})`, () => {
    const { ed, recording } = editor(150);
    // Sentinels need not be renderable: renderImage must hide these transient editor states.
    Object.assign(ed, { sel: [{ id: 99 }], nodeHover: { sentinel: 'node' }, segHover: { sentinel: 'seg' },
      snapHit: { kind: 'node', p: { x: 20, y: 30 } }, alignGuides: [{ axis: 'x', v: 10, a: 2, b: 20 }],
      draft: { sentinel: 'draft' }, continuedFrom: { sentinel: 'continued' }, centerMarks: 'all',
      isolation: { sentinel: 'isolation' }, builderSession: { sentinel: 'builder' }, overlapHover: { sentinel: 'hover' } });
    const saved = Object.fromEntries(restoredKeys.map((key) => [key, ed[key]]));
    const before = JSON.stringify(ed.doc);
    exportFailure = failure;
    try {
      if (failure) assert.throws(() => ed.renderImage({ x: 10, y: 20, w: 100, h: 60 }, 360),
        new RegExp(failure === 'render' ? 'injected canvas text failure' : 'injected PNG encoding failure'));
      else assert.equal(ed.renderImage({ x: 10, y: 20, w: 100, h: 60 }, 360), 'data:image/png;base64,offline-recording');
    } finally { exportFailure = null; }
    for (const key of restoredKeys) assert.equal(ed[key], saved[key], `${key} restored by reference`);
    assert.equal(ed.dirty, true);
    assert.equal(JSON.stringify(ed.doc), before);
    assert.equal(recording.calls.length, 0, 'onscreen canvas untouched');
    const off = offscreens.at(-1)!;
    const z = (360 - RULER - 24) / 100;
    assert.equal(off.canvas.width, 360);
    assert.equal(off.canvas.height, Math.round(RULER + 24 + 60 * z));
    const text = off.recording.calls.find((c) => c.op === 'fillText');
    assert.ok(text, 'real offscreen render reached ruler text');
    near(fontPx(text), 10, 'export uses baseline, not workspace 150%');
    assert.deepEqual(text.mat, [1, 0, 0, 1, 0, 0], 'offscreen DPR is one');
    const bed = off.recording.calls[1];
    assert.deepEqual(bed.args, [RULER + 12 - 10 * z, RULER + 12 - 20 * z, ed.doc.bed.w * z, ed.doc.bed.h * z]);
    // Restoration must also allow the next ordinary render to use the original preference and view.
    Object.assign(ed, { sel: [], nodeHover: null, segHover: null, snapHit: null, alignGuides: [], draft: null,
      continuedFrom: null, centerMarks: 'off', isolation: null, builderSession: null, overlapHover: null });
    ed.render();
    const ruler = recording.calls.find((c) => c.op === 'fillText');
    assert.ok(ruler); near(fontPx(ruler), 15, 'next screen render uses restored 150%');
    assert.deepEqual(ruler.mat, [2, 0, 0, 2, 0, 0]);
  });
}
console.log(`Typography render pipeline: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
