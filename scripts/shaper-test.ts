import './core-fixtures-env';
import assert from 'node:assert/strict';
import { closureOf, closurePreview, recognize, recognizeCandidates, SHAPER_MIN_CONFIDENCE, smoothStroke } from '../src/shaper';
import type { Pt } from '../src/model';

let count = 0;
function test(name: string, f: () => void) { f(); count++; console.log(`PASS ${name}`); }

// Deterministisches Wackeln (kein Math.random): Sinus-Mix wie Pencil-Tests
const jit = (i: number, a: number) => Math.sin(i * 12.9898) * 0.5 * a + Math.sin(i * 3.7) * 0.5 * a;

function stroke(n: number, f: (t: number) => Pt, wobble = 0.4): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = f(i / (n - 1));
    out.push({ x: p.x + jit(i, wobble), y: p.y + jit(i + 50, wobble) });
  }
  return out;
}

test('gerade Linie wird erkannt', () => {
  const m = recognize(stroke(40, (t) => ({ x: t * 100, y: t * 5 })));
  assert.ok(m && m.kind === 'line', `erwartet line, bekommen ${m?.kind ?? 'null'}`);
  assert.ok(m.confidence >= SHAPER_MIN_CONFIDENCE);
  if (m.kind === 'line') assert.ok(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) > 90);
});

test('Rechteck wird erkannt', () => {
  const per = (t: number): Pt => {
    const p = t * 4, s = 100, h = 60;
    if (p < 1) return { x: p * s, y: 0 };
    if (p < 2) return { x: s, y: (p - 1) * h };
    if (p < 3) return { x: s - (p - 2) * s, y: h };
    return { x: 0, y: h - (p - 3) * h };
  };
  const m = recognize(stroke(120, per));
  assert.ok(m && (m.kind === 'rect' || m.kind === 'roundrect'), `erwartet rect/roundrect, bekommen ${m?.kind ?? 'null'}`);
  assert.ok(m!.confidence >= SHAPER_MIN_CONFIDENCE);
});

test('Kreis wird Ellipse mit rx≈ry', () => {
  const m = recognize(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.ok(m && m.kind === 'ellipse', `erwartet ellipse, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'ellipse') {
    assert.ok(Math.abs(m.rx - m.ry) / Math.max(m.rx, m.ry) < 0.25, `rx=${m.rx} ry=${m.ry}`);
    assert.ok(Math.abs(m.rx - 50) < 8, `rx=${m.rx}`);
  }
});

test('Ellipse wird erkannt', () => {
  const m = recognize(stroke(100, (t) => ({ x: 60 + Math.cos(t * Math.PI * 2) * 60, y: 40 + Math.sin(t * Math.PI * 2) * 30 })));
  assert.ok(m && m.kind === 'ellipse', `erwartet ellipse, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'ellipse') assert.ok(m.rx > m.ry * 1.4, `rx=${m.rx} ry=${m.ry}`);
});

test('Dreieck wird Polygon mit 3 Seiten', () => {
  const v = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 40, y: 90 }];
  const per = (t: number): Pt => {
    const p = t * 3, i = Math.min(2, Math.floor(p)), f = p - i;
    const a = v[i], b = v[(i + 1) % 3];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const m = recognize(stroke(90, per));
  assert.ok(m && m.kind === 'polygon', `erwartet polygon, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'polygon') assert.equal(m.sides, 3);
});

test('Kritzel ohne Form bleibt Freihand (null)', () => {
  // Deterministischer Random-Walk: keine Grundform
  let x = 0, y = 0;
  const pts: Pt[] = [];
  for (let i = 0; i < 120; i++) {
    x += Math.sin(i * 7.3) * 9 + Math.sin(i * 1.7) * 4;
    y += Math.cos(i * 5.1) * 9 + Math.cos(i * 2.3) * 4;
    pts.push({ x, y });
  }
  const m = recognize(pts);
  assert.ok(!m || m.confidence < SHAPER_MIN_CONFIDENCE, `erwartet null, bekommen ${m?.kind} @ ${m?.confidence}`);
});

test('Tap und offener Bogen werden keine Ellipse', () => {
  assert.equal(recognize([{ x: 10, y: 10 }, { x: 10, y: 10 }]), null);
  const arc = stroke(60, (t) => ({ x: 50 + Math.cos(t * Math.PI) * 50, y: 50 - Math.sin(t * Math.PI) * 50 }));
  const m = recognize(arc);
  assert.ok(!m || m.kind !== 'ellipse', `offener Bogen darf keine Ellipse sein, bekommen ${m?.kind}`);
});

console.log(`Shaper-Erkennung: ${count} Tests, Schwelle ${SHAPER_MIN_CONFIDENCE}.`);

// --- Slice C: Gesten-Entscheidung am Editor (Fixture wie freehand-edit-test) ---
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { apply, defaultLayer, newDoc, type Obj } from '../src/model';
import { DEFAULT_GRID } from '../src/grid';
import { installCanvasGlobals, recordingCtx } from './render-mock';
installCanvasGlobals();

let failed = 0;
async function etest(name: string, f: () => void | Promise<void>) {
  try { await f(); count++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${(e as Error).stack}`); }
}

function sEditor() {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc: newDoc(), sel: [], nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 }, drag: null,
    canvas: { width: 800, height: 600, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} }, snapHit: null, alignGuides: [], tool: 'shaper', currentLayer: 0,
    boolKeep: false, shaperRecognize: true, shaperTolerance: 1,
    shaperCloseGap: 2, shaperSmoothing: 0.8, shaperEdit: null, shaperCloseHint: null,
    pencilTolerance: 0.2, pencilClosed: false,
    // Render-Umgebung (für den Vorschau-Test): Standardwerte wie im Editor
    dpr: 1, grid: { ...DEFAULT_GRID, show: false }, filled: false, dark: false, centerMarks: 'off',
    cursor: { x: 0, y: 0 }, isolation: null, vectorPreview: null, hingePreview: null, patternPreview: null,
    outlinePreview: null, offsetPreview: null, arrayPreview: null, arrayCenter: null, laserPos: null,
    checkMarks: false, checkIssues: [], checkActive: null, overlapHover: null, pivot: null, rotateMode: false,
    builderSession: null, sketchEdit: null, measure: null, measureCircle: null, trimHover: null,
    startHover: null, relPicks: [], relHover: null, jointPicks: [], jointHover: null, jointHingeMode: false,
    nodeEditObj: null, nodeHover: null, segHover: null, draft: null, continuedFrom: null,
  });
  ed.doc.layers[0] = defaultLayer(0);
  ed.emit = () => {};
  ed.redraw = () => {};
  return ed;
}

let nextId = 1000;
function rectObj(x: number, y: number, w: number, h: number): Obj {
  return { id: nextId++, m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w, h, r: 0 } };
}

/** Gerade Geste von a nach b in 1-mm-Schritten (Welt) */
function linePts(a: Pt, b: Pt): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

await etest('Union: offene Geste über zwei Rechtecke verschmilzt (ein Undo)', async () => {
  const ed = sEditor();
  ed.doc.objs = [rectObj(0, 0, 20, 10), rectObj(30, 0, 20, 10)];
  await ed.finishShaper(linePts({ x: -5, y: 5 }, { x: 55, y: 5 }));
  assert.equal(ed.doc.objs.length, 1, 'ein Ergebnisobjekt');
  assert.equal(ed.doc.objs[0].shape.kind, 'path');
  assert.equal(ed.sel.length, 1);
  assert.equal(ed.history.position, 1, 'genau ein Undo-Schritt');
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2, 'Undo stellt beide Rechtecke wieder her');
});

await etest('Subtract: kreuzende Linie zieht Kapsel ab (zwei Teile)', async () => {
  const ed = sEditor();
  ed.doc.objs = [rectObj(0, 0, 40, 20)];
  await ed.finishShaper(linePts({ x: 20, y: -10 }, { x: 20, y: 30 }));
  assert.equal(ed.doc.objs.length, 1, 'Objektzahl gleich');
  const shape = ed.doc.objs[0].shape;
  assert.ok(shape.kind === 'path' && shape.subs.length === 2, `Kapsel teilt das Rechteck, Subs: ${shape.kind === 'path' ? shape.subs.length : '?'}`);
  assert.equal(ed.history.position, 1, 'genau ein Undo-Schritt');
});

await etest('Erkennung: Kreisgeste legt Ellipse an', async () => {
  const ed = sEditor();
  await ed.finishShaper(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'ellipse', `erwartet ellipse, bekommen ${ed.doc.objs[0].shape.kind}`);
  assert.ok(ed.hint.includes('Ellipse'), `Hinweis nennt die Form: ${ed.hint}`);
  assert.equal(ed.history.position, 1);
});

await etest('Fallback: Kritzel ohne Form wird Freihandpfad', async () => {
  const ed = sEditor();
  const pts: Pt[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < 120; i++) {
    x += Math.sin(i * 7.3) * 9 + Math.sin(i * 1.7) * 4;
    y += Math.cos(i * 5.1) * 9 + Math.cos(i * 2.3) * 4;
    pts.push({ x, y });
  }
  await ed.finishShaper(pts);
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'path', 'Fallback ist ein Pfad');
  assert.equal(ed.history.position, 1);
});

await etest('Erkennung aus: Kreisgeste wird Freihandpfad', async () => {
  const ed = sEditor();
  ed.shaperRecognize = false;
  await ed.finishShaper(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'path', 'ohne Erkennung kein Grundform-Objekt');
});

await etest('BoolKeep: Originale bleiben bei Union erhalten', async () => {
  const ed = sEditor();
  ed.boolKeep = true;
  ed.doc.objs = [rectObj(0, 0, 20, 10), rectObj(30, 0, 20, 10)];
  await ed.finishShaper(linePts({ x: -5, y: 5 }, { x: 55, y: 5 }));
  assert.equal(ed.doc.objs.length, 3, 'beide Originale plus Ergebnis');
  assert.equal(ed.sel.length, 1);
});

await etest('Tap legt nichts an und verbraucht kein Undo', async () => {
  const ed = sEditor();
  await ed.finishShaper([{ x: 10, y: 10 }, { x: 10, y: 10 }]);
  assert.equal(ed.doc.objs.length, 0);
  assert.equal(ed.history.position, 0);
});

// --- Nacharbeit: Schließregel, Glättung, Vorschläge, dynamische Werte ---

test('Schließregel: Endpunktabstand in mm, Grenze exakt', () => {
  const a: Pt = { x: 0, y: 0 };
  const open = closureOf([a, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 3, y: 0 }], 2);
  assert.equal(open.closed, false, '3 mm Abstand ist offen');
  const closed = closureOf([a, { x: 50, y: 0 }, { x: 2, y: 0 }], 2);
  assert.equal(closed.closed, true, '2 mm Abstand ist geschlossen');
  assert.equal(closed.limit, 2);
  // Grenze gilt in mm, nicht als Anteil der Strichlänge
  const big = closureOf([a, { x: 500, y: 0 }, { x: 1000, y: 0 }, { x: 1.5, y: 0 }], 2);
  assert.equal(big.closed, true, 'lange Geste mit kleinem Abstand ist geschlossen');
});

test('Vorschau-Geometrie liegt in Welt-mm, unabhängig von Zoom', () => {
  const pts = [{ x: 10, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 70 }, { x: 11, y: 20.5 }];
  const pv = closurePreview(pts, 2);
  assert.ok(pv, 'Vorschau vorhanden');
  assert.deepEqual(pv.start, { x: 10, y: 20 }, 'Startpunkt ist der Gestenpunkt in Welt-mm');
  assert.deepEqual(pv.end, { x: 11, y: 20.5 }, 'Endpunkt ist der letzte Gestenpunkt');
  assert.equal(pv.limit, 2, 'Ringradius ist der eingestellte mm-Wert');
  assert.equal(pv.closed, true, '1,1 mm Abstand schließt');
  assert.equal(closurePreview([{ x: 0, y: 0 }], 2), null, 'ein Punkt ergibt keine Vorschau');
});

test('Glättung: Wackeln wird kleiner, Endpunkte bleiben', () => {
  const raw = stroke(80, (t) => ({ x: t * 100, y: 0 }), 1.5);
  const smooth = smoothStroke(raw, 3);
  const dev = (pts: Pt[]) => Math.max(...pts.map((p) => Math.abs(p.y - 0)));
  assert.ok(dev(smooth) < dev(raw), `geglättet ${dev(smooth)} < roh ${dev(raw)}`);
  assert.deepEqual(smooth[0], raw[0]);
  assert.deepEqual(smooth[smooth.length - 1], raw[raw.length - 1]);
  assert.deepEqual(smoothStroke(raw, 0), raw, 'Stärke 0 lässt die Geste unverändert');
});

test('Kreis bleibt Ellipse, auch wenn der Erkenner Ecken sieht', () => {
  // Eckenlastige Kreisgeste: Radius springt segmentweise, Umlauf geschlossen
  const pts: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = i % 10 < 5 ? 50 : 46;
    pts.push({ x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r });
  }
  const cands = recognizeCandidates(pts);
  assert.ok(cands.length > 0, 'mindestens ein Vorschlag');
  assert.equal(cands[0].kind, 'ellipse', `bester Vorschlag ${cands[0].kind}`);
  assert.ok(cands.some((c) => c.kind === 'polygon'), 'Vieleck bleibt als Alternative erhalten');
});

test('Vorschläge sind nach Konfidenz sortiert und ohne Doppel', () => {
  const cands = recognizeCandidates(stroke(120, (t) => {
    const p = t * 4, s = 100, h = 60;
    if (p < 1) return { x: p * s, y: 0 };
    if (p < 2) return { x: s, y: (p - 1) * h };
    if (p < 3) return { x: s - (p - 2) * s, y: h };
    return { x: 0, y: h - (p - 3) * h };
  }));
  for (let i = 1; i < cands.length; i++) assert.ok(cands[i - 1].confidence >= cands[i].confidence, 'absteigend sortiert');
  assert.equal(new Set(cands.map((c) => c.kind)).size, cands.length, 'je Familie ein Vorschlag');
});

await etest('Schnittbreite ist Gesamtbreite und nachträglich einstellbar (A→B→A)', async () => {
  const ed = sEditor();
  ed.doc.objs = [rectObj(0, 0, 40, 20)];
  await ed.finishShaper(linePts({ x: 20, y: -10 }, { x: 20, y: 30 }));
  assert.equal(ed.history.position, 1);
  const gapAt = () => {
    const shape = ed.doc.objs[0].shape;
    if (shape.kind !== 'path' || shape.subs.length !== 2) return -1;
    const parts = shape.subs.map((sub) => {
      const xs = sub.nodes.map((n) => n.x);
      return { min: Math.min(...xs), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length };
    }).sort((a, b) => a.mean - b.mean);
    return parts[1].min - parts[0].max;
  };
  const narrow = gapAt();
  assert.ok(narrow > 0.5 && narrow < 1.5, `1 mm Breite ergibt etwa 1 mm Spalt, ist ${narrow}`);
  ed.shaperTolerance = 4;
  assert.ok(ed.shaperRebuild(), 'Neuberechnung greift');
  const wide = gapAt();
  assert.ok(wide > narrow + 1, `breiter geschnitten: ${wide} > ${narrow}`);
  assert.equal(ed.history.position, 1, 'Nachjustieren erzeugt keinen Undo-Schritt');
  ed.shaperTolerance = 1;
  ed.shaperRebuild();
  assert.ok(Math.abs(gapAt() - narrow) < 0.01, 'A→B→A ergibt wieder A');
  ed.doUndo();
  assert.ok(ed.doc.objs.length === 1 && ed.doc.objs[0].shape.kind === 'rect', 'ein Undo stellt das Original wieder her');
});

await etest('Vorschlag wechseln ersetzt die Form ohne neuen Undo-Schritt', async () => {
  const ed = sEditor();
  await ed.finishShaper(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.equal(ed.doc.objs[0].shape.kind, 'ellipse');
  const s = ed.shaperEdit!;
  assert.ok(s.cands.length > 0, 'Vorschlagsliste gefüllt');
  s.pick = 'freehand';
  assert.ok(ed.shaperRebuild());
  const obj = ed.doc.objs[0];
  assert.equal(obj.shape.kind, 'path', 'Freihand gewählt');
  assert.equal(ed.history.position, 1, 'kein zusätzlicher Undo-Schritt');
  // Freihand liegt im Weltraum: keine Matrix der erkannten Form darf hängen bleiben
  const xs: number[] = [], ys: number[] = [];
  if (obj.shape.kind === 'path')
    for (const n of obj.shape.subs[0].nodes) {
      const w = apply(obj.m, n.x, n.y);
      xs.push(w.x); ys.push(w.y);
    }
  assert.ok(Math.min(...xs) > -5 && Math.max(...xs) < 105, `Freihand-x im Gestenbereich: ${Math.min(...xs)}..${Math.max(...xs)}`);
  assert.ok(Math.min(...ys) > -5 && Math.max(...ys) < 105, `Freihand-y im Gestenbereich: ${Math.min(...ys)}..${Math.max(...ys)}`);
  s.pick = 'ellipse';
  ed.shaperRebuild();
  assert.equal(ed.doc.objs[0].shape.kind, 'ellipse', 'zurück zur Ellipse');
});

await etest('Nachbearbeitung endet bei Undo und Werkzeugwechsel', async () => {
  const ed = sEditor();
  ed.doc.objs = [rectObj(0, 0, 40, 20)];
  await ed.finishShaper(linePts({ x: 20, y: -10 }, { x: 20, y: 30 }));
  assert.equal(ed.shaperEditValid(), true);
  ed.doUndo();
  assert.equal(ed.shaperEditValid(), false, 'nach Undo keine Nachbearbeitung mehr');
  ed.shaperTolerance = 5;
  assert.equal(ed.shaperRebuild(), false, 'keine Neuberechnung auf altem Stand');
});

if (failed) {
  console.log(`${failed} Shaper-Editor-Test(s) fehlgeschlagen`);
  process.exit(1);
}

test('Render: Schließ-Vorschau im Welt-Transform mit Welt-Koordinaten', () => {
  const ed = sEditor();
  ed.view = { zoom: 2, ox: 60, oy: 40 };
  // geschlossene Geste (Ende 1,1 mm vom Start) um ein Rechteck herum
  ed.drag = { type: 'shaper', points: [{ x: 10, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 70 }, { x: 11, y: 20.5 }], pointerId: 1, overflow: false };
  const { ctx, calls } = recordingCtx();
  ed.ctx = ctx;
  ed.render();
  const ring = calls.filter((c) => c.op === 'arc' && c.args[2] === 2);
  assert.ok(ring.length >= 1, 'Ring mit dem eingestellten mm-Radius');
  assert.deepEqual(ring[0].mat, [2, 0, 0, 2, 60, 40], 'Welt-Transform aktiv');
  assert.deepEqual([ring[0].args[0], ring[0].args[1]], [10, 20], 'Ring liegt am Welt-Startpunkt, nicht bei toScreen');
  const closing = calls.filter((c) => c.op === 'lineTo' && c.args[0] === 10 && c.args[1] === 20);
  assert.ok(closing.length >= 1, 'geschlossene Kontur zieht die Verbindungslinie zum Startpunkt');
  assert.deepEqual(closing[0].mat, [2, 0, 0, 2, 60, 40], 'Verbindungslinie ebenfalls im Welt-Transform');
});

console.log(`Shaper-Editor: alle Tests bestanden (insgesamt ${count}).`);
