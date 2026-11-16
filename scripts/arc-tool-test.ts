// Tests des Bogenwerkzeugs: reine Geometrie und Editor-Integration. Aufruf: npm run test:arc-tool
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { defaultLayer, newDoc, Node, Pt } from '../src/model';
import { ARC_SNAP, arcFrom3Points, arcNodes, arcSubPath, newArcDraft, snapAngle } from '../src/editor/arc';
import { DEFAULT_GRID } from '../src/grid';

class MockPath2D {
  ops: { op: string; args: number[] }[] = [];
  moveTo(x: number, y: number) { this.ops.push({ op: 'moveTo', args: [x, y] }); }
  lineTo(x: number, y: number) { this.ops.push({ op: 'lineTo', args: [x, y] }); }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number) { this.ops.push({ op: 'bezierCurveTo', args: [a, b, c, d, e, f] }); }
  closePath() { this.ops.push({ op: 'closePath', args: [] }); }
  rect(x: number, y: number, w: number, h: number) { this.ops.push({ op: 'rect', args: [x, y, w, h] }); }
  addPath(other: MockPath2D) { if (other?.ops) this.ops.push(...other.ops); }
}
class MockDOMMatrix {
  a: number; b: number; c: number; d: number; e: number; f: number;
  constructor(m: number[] = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = m; }
}
const g = globalThis as Record<string, unknown>;
g.Path2D ??= MockPath2D;
g.DOMMatrix ??= MockDOMMatrix;

let count = 0;
const test = (name: string, f: () => void) => { f(); count++; console.log('PASS ' + name); };
const near = (a: number, b: number, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg}${a} ≠ ${b}`);
const nearPt = (a: Pt, b: Pt, eps = 1e-6) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= eps, `${a.x},${a.y} ≠ ${b.x},${b.y}`);
const DEG = Math.PI / 180;

function editor() {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc: newDoc(), currentLayer: 0, sel: [], tool: 'arc', draft: null, continuedFrom: null, drag: null,
    arcMode: 'center', arcCw: false, arcDraft: null, hint: '',
    nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(), history: new History(), batching: false,
    view: { zoom: 1, ox: 0, oy: 0 },
    canvas: { width: 800, height: 600, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} },
    dpr: 1, grid: { ...DEFAULT_GRID, show: false }, filled: false, dark: false, centerMarks: 'off',
    snapObjects: false, snapGrid: false, snapHit: null, alignGuides: [], cursor: { x: 0, y: 0 },
    nodeEditObj: null, nodeHover: null, segHover: null, jointPicks: [], jointHover: null, jointHingeMode: false,
    trimHover: null, startHover: null, relPicks: [], relHover: null, measure: null, measureCircle: null,
    sketchEdit: null, builderSession: null, isolation: null, vectorPreview: null, hingePreview: null,
    patternPreview: null, outlinePreview: null, offsetPreview: null, arrayPreview: null, arrayCenter: null,
    laserPos: null, checkMarks: false, checkIssues: [], checkActive: null, overlapHover: null, pivot: null,
    rotateMode: false, space: false, pickHandler: null, pickEnd: null,
  });
  ed.doc.layers[0] = defaultLayer(0);
  ed.emit = () => {};
  ed.redraw = () => {};
  return ed;
}

const pointer = (sx: number, sy: number, shiftKey = false) => ({
  button: 0, pointerId: 1, clientX: sx, clientY: sy, shiftKey, ctrlKey: false, metaKey: false, altKey: false,
  preventDefault() {},
} as unknown as PointerEvent);
const click = (ed: Editor, x: number, y: number, shiftKey = false) => {
  ed.onDown(pointer(x, y, shiftKey));
  ed.onUp(pointer(x, y, shiftKey));
};
const keyEv = (key: string) => ({
  key, code: key, preventDefault() {}, target: { tagName: 'CANVAS' },
  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, defaultPrevented: false,
} as unknown as KeyboardEvent);

type Mat6 = [number, number, number, number, number, number];
function mockCtx() {
  let cur: Mat6 = [1, 0, 0, 1, 0, 0];
  const stack: Mat6[] = [];
  const calls: { op: string; mat: Mat6; args: unknown[]; strokeStyle: string; fillStyle: string; lineWidth: number }[] = [];
  const rec = (op: string, ...args: unknown[]) => calls.push({ op, mat: [...cur] as Mat6, args, strokeStyle: String(ctx.strokeStyle), fillStyle: String(ctx.fillStyle), lineWidth: Number(ctx.lineWidth) });
  const ctx = {
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    save() { stack.push([...cur] as Mat6); },
    restore() { cur = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { cur = [a, b, c, d, e, f]; },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      const [m0, m1, m2, m3, m4, m5] = cur;
      cur = [m0 * a + m2 * b, m1 * a + m3 * b, m0 * c + m2 * d, m1 * c + m3 * d, m0 * e + m2 * f + m4, m1 * e + m3 * f + m5];
    },
    translate(x: number, y: number) { ctx.transform(1, 0, 0, 1, x, y); },
    scale(sx: number, sy: number) { ctx.transform(sx, 0, 0, sy, 0, 0); },
    rotate(a: number) { ctx.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); },
    setLineDash() {},
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) { rec('moveTo', x, y); },
    lineTo(x: number, y: number) { rec('lineTo', x, y); },
    rect(x: number, y: number, w: number, h: number) { rec('rect', x, y, w, h); },
    arc(x: number, y: number, r: number, a0: number, a1: number) { rec('arc', x, y, r, a0, a1); },
    fillRect(x: number, y: number, w: number, h: number) { rec('fillRect', x, y, w, h); },
    strokeRect(x: number, y: number, w: number, h: number) { rec('strokeRect', x, y, w, h); },
    fill() { rec('fill'); },
    stroke(p?: MockPath2D) { rec('stroke', p); },
    fillText() {},
    measureText(s: string) { return { width: s.length * 6 }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const bezier = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};
const pathShape = (ed: Editor) => {
  const shape = ed.doc.objs[0].shape;
  if (shape.kind !== 'path') throw Error('kein Pfad');
  return shape;
};

test('arcNodes: Endpunkt liegt für 90°, 180°, 270° und 359° exakt auf dem Kreis', () => {
  const cx = 3, cy = -7, r = 12.5, a0 = 0.37;
  for (const deg of [90, 180, 270, 359]) {
    const sweep = deg * DEG;
    const nodes = arcNodes(cx, cy, r, a0, sweep);
    const end = nodes[nodes.length - 1];
    near(Math.hypot(end.x - cx, end.y - cy), r, 1e-6, `${deg}° Radius: `);
    nearPt(end, { x: cx + r * Math.cos(a0 + sweep), y: cy + r * Math.sin(a0 + sweep) }, 1e-6);
    for (const n of nodes) near(Math.hypot(n.x - cx, n.y - cy), r, 1e-6, `${deg}° Knoten: `);
  }
});

test('arcNodes: kein Segment über 90°, Anzahl = ceil(|sweep|/90°)', () => {
  for (const sweep of [10 * DEG, Math.PI / 2, Math.PI, 1.5 * Math.PI, 359 * DEG, -270 * DEG]) {
    const nodes = arcNodes(0, 0, 10, 0, sweep);
    const n = nodes.length - 1;
    assert.equal(n, Math.ceil(Math.abs(sweep) / (Math.PI / 2)), `${sweep}`);
    const delta = Math.abs(sweep) / n;
    assert.ok(delta <= Math.PI / 2 + 1e-12, `${delta}`);
  }
});

test('Bézier-Näherung: Mittelpunkt je Segment höchstens 3e-4·r vom Kreis entfernt', () => {
  const r = 10;
  for (const sweep of [Math.PI / 2, Math.PI, 1.75 * Math.PI, 359 * DEG, -270 * DEG]) {
    const nodes = arcNodes(0, 0, r, 0.4, sweep);
    for (let i = 0; i + 1 < nodes.length; i++) {
      const mid = bezier(nodes[i], nodes[i].cout!, nodes[i + 1].cin!, nodes[i + 1], 0.5);
      assert.ok(Math.abs(Math.hypot(mid.x, mid.y) - r) <= 3e-4 * r, `${sweep}: ${Math.hypot(mid.x, mid.y)}`);
    }
  }
});

test('Richtung: negativer Sweep erzeugt umgekehrte Knotenreihenfolge', () => {
  const pos = arcNodes(0, 0, 5, 0.2, Math.PI);
  const neg = arcNodes(0, 0, 5, 0.2, -Math.PI);
  // Gleicher Startpunkt, aber absteigende Winkel.
  nearPt(neg[0], pos[0]);
  assert.ok(neg[1].y < pos[1].y, 'negative Richtung läuft zu kleineren Winkeln');
  // Vom anderen Ende aus betrachtet ist die Knotenreihenfolge die umgekehrte.
  const back = arcNodes(0, 0, 5, 0.2 + Math.PI, -Math.PI);
  nearPt(back[0], pos[pos.length - 1]);
  nearPt(back[back.length - 1], pos[0]);
  assert.ok(neg[0].cout && neg[neg.length - 1].cin, 'Anfasser bleiben an den Enden frei');
});

test('arcFrom3Points: Mittelpunkt und Radius entsprechen der analytischen Lösung', () => {
  const cx = 10, cy = 20, r = 5;
  const at = (a: number): Pt => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  const ccw = arcFrom3Points(at(0), at(Math.PI / 2), at(Math.PI))!;
  assert.ok(ccw);
  near(ccw.cx, cx, 1e-9); near(ccw.cy, cy, 1e-9); near(ccw.r, r, 1e-9);
  near(ccw.a0, 0, 1e-12); near(ccw.sweep, Math.PI, 1e-12);
  // Durchgangspunkt unterhalb entscheidet für den Uhrzeigersinn
  const cw = arcFrom3Points(at(0), at(-Math.PI / 2), at(Math.PI))!;
  near(cw.sweep, -Math.PI, 1e-12);
});

test('arcFrom3Points: kollinear, identisch und zu klein liefern null', () => {
  assert.equal(arcFrom3Points({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }), null);
  assert.equal(arcFrom3Points({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 1 }), null);
  assert.equal(arcFrom3Points({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
  assert.equal(arcFrom3Points({ x: 0, y: 0 }, { x: 1e-12, y: 0 }, { x: 0, y: 1e-12 }), null);
});

test('Commit: ein Objekt, ein Undo, offener Pfad, Richtung nach CW/CCW', () => {
  const draft = newArcDraft('center', { x: 0, y: 0 });
  draft.phase = 3; draft.radius = 10; draft.a0 = 0; draft.a1 = Math.PI / 2;
  const ccw = editor();
  ccw.arcDraft = draft;
  assert.equal(ccw.finishArc(), true);
  assert.equal(ccw.doc.objs.length, 1);
  assert.equal(ccw.history.position, 1);
  const shape = pathShape(ccw);
  assert.equal(shape.subs.length, 1);
  assert.equal(shape.subs[0].closed, false);
  assert.ok(shape.subs[0].nodes[1].y < 0, 'CCW läuft auf dem Bildschirm nach oben');
  ccw.doUndo();
  assert.equal(ccw.doc.objs.length, 0);

  const cw = editor();
  cw.arcCw = true;
  cw.arcDraft = { ...newArcDraft('center', { x: 0, y: 0 }), phase: 3, radius: 10, a0: 0, a1: Math.PI / 2 };
  assert.equal(cw.finishArc(), true);
  const cwShape = pathShape(cw);
  assert.ok(cwShape.subs[0].nodes[1].y > 0, 'CW läuft auf dem Bildschirm nach unten');
  nearPt(cwShape.subs[0].nodes[0], { x: 10, y: 0 });
});

test('Commit: drei Punkte ergeben den Bogen durch den Durchgangspunkt', () => {
  const ed = editor();
  ed.arcMode = '3point';
  const d = newArcDraft('3point', { x: 10, y: 0 });
  d.phase = 3;
  d.start = { x: 10, y: 0 }; d.mid = { x: 0, y: 10 }; d.end = { x: -10, y: 0 };
  ed.arcDraft = d;
  assert.equal(ed.finishArc(), true);
  const nodes = pathShape(ed).subs[0].nodes;
  assert.equal(nodes.length, 3);
  near(Math.hypot(nodes[1].x, nodes[1].y), 10, 1e-6);
  assert.equal(nodes[1].y > 0, true);
  // Richtungsumschalter kehrt nur die Knotenreihenfolge um (natürlicher Bogen ist hier im Uhrzeigersinn).
  const flipped = arcSubPath(d, false)!;
  nearPt(flipped.nodes[0], d.end);
  nearPt(flipped.nodes[flipped.nodes.length - 1], d.start);
});

test('Esc verwirft den laufenden Bogen ohne Undo; unvollständig wird nicht committet', () => {
  const ed = editor();
  ed.arcDraft = { ...newArcDraft('center', { x: 0, y: 0 }), phase: 3, radius: 10, a0: 0, a1: Math.PI / 2 };
  ed.onKey(keyEv('Escape'));
  assert.equal(ed.arcDraft, null);
  assert.equal(ed.doc.objs.length, 0);
  assert.equal(ed.history.position, 0);
  assert.equal(ed.tool, 'arc', 'Esc beendet nur den Bogen, nicht das Werkzeug');

  const half = editor();
  half.arcDraft = { ...newArcDraft('center', { x: 0, y: 0 }), phase: 2, radius: 10, a0: 0, a1: 0 };
  assert.equal(half.finishArc(), false);
  assert.equal(half.doc.objs.length, 0);
  assert.equal(half.history.position, 0);

  // Auch mitten im Ziehen verwirft Esc den ganzen Bogen.
  const drag = editor();
  const d = { ...newArcDraft('center', { x: 0, y: 0 }), phase: 2, radius: 10, a0: 0, a1: 0 };
  drag.arcDraft = d;
  drag.drag = { type: 'arc', pointerId: 1, start: { x: 0, y: 0 }, moved: true, draft: d };
  drag.onKey(keyEv('Escape'));
  assert.equal(drag.drag, null);
  assert.equal(drag.arcDraft, null);
  assert.equal(drag.history.position, 0);
});

test('Shift rastet Winkel auf 15°-Vielfache', () => {
  near(snapAngle(44 * DEG), 45 * DEG, 1e-12);
  near(snapAngle(7 * DEG), 0, 1e-12);
  near(snapAngle(-23 * DEG), -30 * DEG, 1e-12);
  near(snapAngle(100 * DEG), 105 * DEG, 1e-12);
  assert.equal(snapAngle(0.1), Math.round(0.1 / ARC_SNAP) * ARC_SNAP);
  const ed = editor();
  const d = newArcDraft('center', { x: 0, y: 0 });
  d.phase = 2;
  ed.arcDraft = d;
  ed.arcTrack(d, { x: 10, y: 10 }, { shiftKey: true });
  near(d.a0, Math.PI / 4, 1e-12, 'Startwinkel: ');
});

test('Drei Klicks ohne Ziehen zeichnen den Bogen und übernehmen ihn', () => {
  const ed = editor();
  click(ed, 5, 5);
  assert.equal(ed.arcDraft!.phase, 2);
  near(ed.arcDraft!.center.x, 5); near(ed.arcDraft!.center.y, 5);
  click(ed, 15, 5);
  assert.equal(ed.arcDraft!.phase, 3);
  near(ed.arcDraft!.radius, 10, 1e-9, 'Radius: ');
  near(ed.arcDraft!.a0, 0, 1e-12, 'Startwinkel: ');
  click(ed, 5, 15);
  assert.equal(ed.arcDraft, null);
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.history.position, 1);
  assert.equal(ed.tool, 'select');
  assert.equal(ed.sel.length, 1);
  const nodes = pathShape(ed).subs[0].nodes;
  nearPt(nodes[nodes.length - 1], { x: 5, y: 15 }, 1e-6);
});

test('Ziehen im zweiten Schritt setzt Radius und Startwinkel wie ein Klick', () => {
  const ed = editor();
  click(ed, 5, 5);
  ed.onDown(pointer(15, 5));
  ed.onMove(pointer(5, 15));
  ed.onUp(pointer(5, 15));
  assert.equal(ed.arcDraft!.phase, 3);
  near(ed.arcDraft!.radius, 10, 1e-9, 'Radius: ');
  near(ed.arcDraft!.a0, Math.PI / 2, 1e-9, 'Startwinkel: ');
  click(ed, 5, 5);
  assert.equal(ed.doc.objs.length, 1);
});

test('3-Punkt: drei Klicks zeichnen den Bogen; die Richtung kehrt die Knotenreihenfolge um', () => {
  const ed = editor();
  ed.arcMode = '3point';
  click(ed, 10, 0);
  assert.equal(ed.arcDraft!.phase, 2);
  click(ed, 0, 10);
  assert.equal(ed.arcDraft!.phase, 3);
  click(ed, -10, 0);
  assert.equal(ed.doc.objs.length, 1);
  const nodes = pathShape(ed).subs[0].nodes;
  assert.equal(nodes.length, 3);
  nearPt(nodes[0], { x: -10, y: 0 }, 1e-6);
  nearPt(nodes[nodes.length - 1], { x: 10, y: 0 }, 1e-6);
  near(Math.hypot(nodes[1].x, nodes[1].y), 10, 1e-6);
  assert.ok(nodes[1].y > 0, 'Durchgangspunkt bleibt erhalten');
});

test('Ungültiger zweiter Klick bleibt im Schritt stehen statt zu übernehmen', () => {
  const ed = editor();
  click(ed, 5, 5);
  click(ed, 5, 5);
  assert.equal(ed.arcDraft!.phase, 2);
  assert.equal(ed.doc.objs.length, 0);
  const three = editor();
  three.arcMode = '3point';
  click(three, 0, 0);
  click(three, 0, 0);
  assert.equal(three.arcDraft!.phase, 2);
  assert.equal(three.doc.objs.length, 0);
});

test('Enter übernimmt nur einen gültigen Bogen, sonst bleibt er laufen', () => {
  const ed = editor();
  ed.arcDraft = { ...newArcDraft('center', { x: 0, y: 0 }), phase: 3, radius: 10, a0: 0, a1: Math.PI / 2 };
  ed.onKey(keyEv('Enter'));
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.history.position, 1);

  const half = editor();
  half.arcDraft = { ...newArcDraft('center', { x: 0, y: 0 }), phase: 2, radius: 10, a0: 0, a1: 0 };
  half.onKey(keyEv('Enter'));
  assert.equal(half.doc.objs.length, 0);
  assert.equal(half.history.position, 0);
  assert.ok(half.arcDraft, 'unvollständiger Bogen bleibt für den nächsten Klick stehen');
});

test('arcSubPath: ungültige Entwürfe liefern null (keine Null-Länge, kein Radius 0)', () => {
  const zero = newArcDraft('center', { x: 0, y: 0 });
  zero.phase = 3;
  assert.equal(arcSubPath(zero, false), null);
  const same = newArcDraft('3point', { x: 0, y: 0 });
  same.phase = 3;
  assert.equal(arcSubPath(same, false), null);
  // Der letzte Knoten eines offenen Bogens trägt keinen cout, der erste keinen cin.
  const sub = arcSubPath({ ...newArcDraft('center', { x: 0, y: 0 }), phase: 3, radius: 4, a0: 0, a1: Math.PI / 2 }, false)!;
  const nodes: Node[] = sub.nodes;
  assert.equal(nodes[0].cin, undefined);
  assert.equal(nodes[nodes.length - 1].cout, undefined);
});

test('Render: Bogenvorschau im Welt-Transform, Mittelpunkt im Bildschirm-Transform (zoom 2, dpr 2)', () => {
  const ed = editor();
  const { ctx, calls } = mockCtx();
  ed.ctx = ctx;
  ed.dpr = 2;
  ed.view = { zoom: 2, ox: 60, oy: 40 };
  ed.arcDraft = {
    ...newArcDraft('center', { x: 0, y: 0 }), phase: 3, radius: 10, a0: 0, a1: Math.PI / 2,
    start: { x: 10, y: 0 }, end: { x: 0, y: 10 },
  };
  ed.render();

  const preview = calls.filter((c) => c.op === 'stroke' && c.args[0] instanceof MockPath2D
    && (c.args[0] as MockPath2D).ops.some((o) => o.op === 'bezierCurveTo'));
  assert.equal(preview.length, 1, 'genau eine Bogenvorschau');
  assert.deepEqual(preview[0].mat, [4, 0, 0, 4, 120, 80], 'Weltgeometrie mit dpr·zoom und dpr·Offset');

  const q = ed.toScreen(ed.arcDraft.center);
  const screen: Mat6 = [2, 0, 0, 2, 0, 0];
  const has = (op: string, x: number, y: number) => calls.some((c) => c.op === op && c.mat.join() === screen.join()
    && Number(c.args[0]) === x && Number(c.args[1]) === y);
  assert.ok(has('moveTo', q.x - 7, q.y) && has('lineTo', q.x + 7, q.y), 'Mittelpunktkreuz waagrecht');
  assert.ok(has('moveTo', q.x, q.y - 7) && has('lineTo', q.x, q.y + 7), 'Mittelpunktkreuz senkrecht');
  const s = ed.toScreen(ed.arcDraft.start);
  assert.ok(has('moveTo', q.x, q.y) && has('lineTo', s.x, s.y), 'Radiuslinie in Bildschirmkoordinaten');
});

test('arcFrom3Points: Start ≈ Ende (Sweep ≈ 2π) ist als offener Pfad degeneriert; flach fast-kollinear bleibt erlaubt', () => {
  // Fast geschlossener Kreis (Radius 10, Lücke 2e-7): kein sinnvoller offener Pfad.
  assert.equal(arcFrom3Points({ x: 10, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 2e-7 }), null);
  // Flacher fast-kollinearer Bogen (Pfeilhöhe 1e-7 auf 1 mm Sehne) bleibt ein gültiger kleiner Sweep.
  const flat = arcFrom3Points({ x: 0, y: 0 }, { x: 0.5, y: 1e-7 }, { x: 1, y: 0 });
  assert.ok(flat && Math.abs(flat.sweep) < 0.01 && Math.abs(flat.sweep) >= 1e-9);
});

setTimeout(() => {
  console.log(`\n${count} Tests bestanden`);
}, 50);
