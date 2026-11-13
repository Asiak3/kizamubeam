// Tests für „Konstruktion prüfen“. Aufruf: npm run test:check
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { CheckIssue } from '../src/check';
import type { Layer, Obj, Shape, SubPath } from '../src/model';
const { defaultLayer, IDENT, translate } = await import('../src/model');
const { checkDesign, DEFAULT_CHECK, removeSpans } = await import('../src/check');
const { buildGen, defaultParams, GENERATORS, getGenerator } = await import('../src/generators/index');
const { library } = await import('../src/materials');
const { t } = await import('../src/i18n');
const { drawnFit, realGap, suggestFit, genFitPatch } = await import('../src/fitcheck');
const { buildCalibParts, calibResult, defaultSteps, stepValues, SQUARE, TAB } = await import('../src/calibrate');

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

let id = 1;
const obj = (shape: Shape, x = 0, y = 0, layer = 1): Obj => ({ id: id++, m: x || y ? translate(x, y) : IDENT, layer, shape });
const rect = (w: number, h: number, x = 0, y = 0, layer = 1) => obj({ kind: 'rect', w, h, r: 0 }, x, y, layer);
const ellipse = (r: number, x: number, y: number, layer = 1) => obj({ kind: 'ellipse', rx: r, ry: r }, x, y, layer);
const line = (pts: [number, number][], closed = false): SubPath => ({ closed, nodes: pts.map(([x, y]) => ({ x, y })) });
const path = (subs: SubPath[], layer = 1) => obj({ kind: 'path', subs }, 0, 0, layer);

const layers: Record<number, Layer> = {};
const layerOf = (i: number) => (layers[i] ??= defaultLayer(i));
const run = (objs: Obj[], settings = {}): CheckIssue[] =>
  checkDesign({ objs, layer: layerOf, bed: { w: 400, h: 400 }, settings: { ...DEFAULT_CHECK, ...settings } });
const kinds = (xs: CheckIssue[]) => xs.map((x) => x.kind).sort();

test('Saubere Teile: keine Befunde', () => {
  const plate = rect(100, 60, 10, 10);
  const hole = ellipse(5, 40, 40);
  assert.deepEqual(run([plate, hole, rect(30, 30, 150, 10)]), []);
});

test('Deckungsgleiches Objekt: wird gemeldet, Korrektur löscht das spätere', () => {
  const a = rect(50, 50, 10, 10);
  const b = rect(50, 50, 10, 10);
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['double']);
  assert.equal(xs[0].fix?.kind, 'delete');
  assert.deepEqual(xs[0].fix?.kind === 'delete' && xs[0].fix.objs, [b]);
});

test('Gemeinsame Kante: Länge stimmt, Korrektur entfernt sie aus dem späteren Teil', () => {
  const a = rect(50, 30, 10, 10);
  const b = rect(40, 30, 60, 10); // linke Kante von b liegt auf der rechten von a
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['double']);
  assert.match(xs[0].msg, /30/);
  const f = xs[0].fix;
  assert.ok(f && f.kind === 'spans');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].leaf, b);
  const rest = removeSpans(line([[0, 0], [40, 0], [40, 30], [0, 30]], true), f.items[0].spans);
  assert.equal(rest.length, 1);
  assert.ok(!rest[0].closed);
  // die linke Kante (x = 0, von unten nach oben) fehlt, der Rest ist ein Linienzug über drei Seiten
  const xsOf = rest[0].nodes.map((n) => Math.round(n.x * 100) / 100);
  assert.deepEqual([xsOf[0], xsOf[xsOf.length - 1]], [0, 0]);
  assert.equal(rest[0].nodes.length, 4);
});

test('Kreis zweimal (verschiedene Startpunkte): als doppelt erkannt', () => {
  const a = ellipse(10, 50, 50);
  const b = obj({ kind: 'ellipse', rx: 10, ry: 10 }, 0, 0);
  b.m = [0, 1, -1, 0, 50, 50]; // um 90° gedreht
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['double']);
  assert.equal(xs[0].fix?.kind, 'delete');
});

test('Fast geschlossener Umriss: gemeldet mit Lücke, Korrektur schließt', () => {
  const p = path([line([[0, 0], [20, 0], [20, 20], [0, 20], [0, 0.4]])]);
  p.m = translate(10, 10);
  const xs = run([p]);
  assert.deepEqual(kinds(xs), ['open']);
  assert.match(xs[0].msg, /0[.,]40/);
  assert.equal(xs[0].fix?.kind, 'close');
});

test('Offene Linie mit großer Lücke auf Linien-Layer: kein Befund, auf Füll-Layer schon', () => {
  const p = path([line([[0, 0], [20, 0], [20, 20]])]);
  p.m = translate(10, 10);
  assert.deepEqual(run([p]), []);
  const q = path([line([[0, 0], [20, 0], [20, 20]])], 0);
  q.m = translate(10, 10);
  assert.deepEqual(kinds(run([q])), ['open']);
});

test('Einzellinien, die einen Umriss bilden: nicht verbunden, Korrektur verbindet', () => {
  const a = path([line([[10, 10], [30, 10]])]);
  const b = path([line([[30, 10], [30, 30]])]);
  const c = path([line([[30, 30], [10, 30], [10, 10]])]);
  const xs = run([a, b, c]);
  assert.deepEqual(kinds(xs), ['unjoined']);
  assert.equal(xs[0].fix?.kind, 'join');
  assert.equal(xs[0].objs.length, 3);
});

test('Schmaler Steg zwischen Loch und Rand: gemeldet mit Breite', () => {
  const plate = rect(50, 50, 10, 10);
  const hole = rect(10, 10, 20, 10.6); // 0,6 mm vom oberen Rand
  const xs = run([plate, hole]);
  assert.deepEqual(kinds(xs), ['web']);
  // 0,6 − Schnittbreite 0,15 = 0,45 mm
  assert.match(xs[0].msg, /0[.,]45/);
  assert.deepEqual(new Set(xs[0].objs), new Set([plate, hole]));
});

test('Füll- und Gravur-Konturen davor stören die Suche nicht', () => {
  const engr = rect(20, 20, 200, 200, 0);
  const plate = rect(50, 50, 10, 10);
  const hole = rect(10, 10, 20, 10.6);
  const dup = rect(30, 30, 100, 100);
  const dup2 = rect(30, 30, 100, 100);
  assert.deepEqual(kinds(run([engr, plate, hole, dup, dup2])), ['double', 'web']);
});

test('Steg breit genug und Kerf-Ausgleich zählt mit', () => {
  const plate = rect(50, 50, 10, 10);
  const hole = rect(10, 10, 20, 12);
  assert.deepEqual(run([plate, hole]), []);
  // schmaler Steg wird mit Kerf-Ausgleich breiter: 0,9 − 0,2 + 2·0,1 = 0,9 < 1 → noch gemeldet; mit 1,1 nicht mehr
  layers[2] = { ...defaultLayer(2), kerf: 0.1 };
  const p2 = rect(50, 50, 10, 10, 0 + 2);
  const h2 = rect(10, 10, 20, 11.1, 2);
  assert.deepEqual(run([p2, h2]), []);
  const h3 = rect(10, 10, 20, 10.8, 2);
  assert.deepEqual(kinds(run([p2, h3])), ['web']);
});

test('Teil im Loch eines anderen ist kein Steg, Spitzen werden erkannt', () => {
  const frame = rect(60, 60, 10, 10);
  const win = rect(40, 40, 20, 20);
  const inner = rect(30, 30, 25, 25); // liegt im Fenster, 5 mm Abstand
  assert.deepEqual(run([frame, win, inner]), []);
  const star = obj({ kind: 'polygon', sides: 5, r: 20, star: true, inner: 0.2 }, 100, 100);
  assert.ok(kinds(run([star])).includes('web'));
});

test('Zu kleiner Ausschnitt und Kerf-Ausgleich, der ihn verschwinden lässt', () => {
  const plate = rect(50, 50, 10, 10);
  const tiny = ellipse(0.12, 30, 30);
  assert.deepEqual(kinds(run([plate, tiny])), ['hole']);
  layers[3] = { ...defaultLayer(3), kerf: 0.2 };
  const p3 = rect(50, 50, 10, 10, 3);
  const h3 = ellipse(0.15, 30, 30, 3);
  const xs = run([p3, h3]);
  assert.deepEqual(kinds(xs), ['hole']);
  assert.equal(xs[0].level, 'error');
  // Gravur-Layer zählen nicht als Schnitt
  assert.deepEqual(run([plate, tiny], { engraveLayers: [1] }), []);
});

test('Außerhalb des Arbeitsbereichs: Korrektur schiebt aufs Bett', () => {
  const a = rect(50, 50, 380, 10);
  const xs = run([a]);
  assert.deepEqual(kinds(xs), ['bed']);
  const f = xs[0].fix;
  assert.ok(f && f.kind === 'bed');
  assert.equal(f.dx, -30);
  assert.equal(f.dy, 0);
  // Issue #217: ausgeblendete Objekte mit Ausgabe zählen als Hindernisse, Layer ohne Ausgabe nicht
  const b = rect(50, 50, 500, 10);
  b.hidden = true;
  assert.deepEqual(kinds(run([b])), ['bed']);
  const c = rect(50, 50, 500, 10, 30);
  assert.deepEqual(run([c]), []);
});

test('Geparkte Teile neben dem Bett und „Nicht lasern“ sind kein Befund', () => {
  const inside = rect(20, 20, 10, 10);
  const parked = rect(20, 20, 500, 10);
  assert.deepEqual(run([inside, parked]), []);
  // Alone outside: still reported (nothing would be lasered on the bed)
  assert.deepEqual(kinds(run([rect(20, 20, 500, 10)])), ['bed']);
  const off = rect(50, 50, 380, 10);
  off.noLaser = true;
  assert.deepEqual(run([off]), []);
});

test('Import-Hinweis: ein Befund je Hinweis, Korrektur blendet ihn aus', () => {
  const a = rect(10, 10, 10, 10);
  const b = rect(10, 10, 30, 10);
  a.importNote = b.importNote = 'test.svg: 2 Texte übersprungen.';
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['import']);
  assert.equal(xs[0].level, 'info');
  assert.equal(xs[0].objs.length, 2);
});

test('Generatoren mit Standardwerten: keine Befunde außer den feinen GT2-Zähnen', () => {
  for (const g of GENERATORS) {
    // Generatoren mit eingelesenen Daten (Schichtmodell: 3D-Modell) haben ohne Eingabe keine Teile
    if (g.schema.some((s) => s.type === 'data')) continue;
    const r = buildGen(g, defaultParams(g));
    assert.ok(r.parts.length, g.id);
    const objs = r.parts.map((p) => obj(p.shape, 20 + (p.at?.x ?? 0), 20 + (p.at?.y ?? 0)));
    const xs = run(objs).filter((x) => x.kind !== 'bed');
    // GT2-Zähne sind zwischen den Lücken nur gut 0,5 mm breit: das ist ein echter Hinweis
    if (g.id === 'pulley') assert.ok(xs.length && xs.every((x) => x.kind === 'web'), g.id);
    else assert.deepEqual(xs.map((x) => `${g.id}: ${x.msg}`), []);
  }
});

test('removeSpans: geschlossener Pfad, Abschnitt über den Anfang', () => {
  const sq = line([[0, 0], [10, 0], [10, 10], [0, 10]], true);
  const r = removeSpans(sq, [[3.5, 0.5]]);
  assert.equal(r.length, 1);
  const xy = (n: { x: number; y: number }) => [n.x, n.y];
  assert.deepEqual(xy(r[0].nodes[0]), [5, 0]);
  assert.deepEqual(xy(r[0].nodes[r[0].nodes.length - 1]), [0, 5]);
  assert.deepEqual(removeSpans(sq, [[0, 4]]), []);
  const open = line([[0, 0], [10, 0], [20, 0]]);
  const r2 = removeSpans(open, [[0.5, 1.5]]);
  assert.equal(r2.length, 2);
});

test('Laufzeit: 400 Teile mit Löchern', () => {
  const objs: Obj[] = [];
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 20; j++) {
      objs.push(rect(15, 15, 5 + i * 19, 5 + j * 19));
      objs.push(ellipse(3, 12.5 + i * 19, 12.5 + j * 19));
    }
  const t0 = Date.now();
  const xs = run(objs);
  const ms = Date.now() - t0;
  console.log(`     ${ms} ms`);
  assert.deepEqual(xs, []);
  assert.ok(ms < 4000);
});

// ---------- Passung (Etappe 2) ----------

const genObjs = (id: string, patch: Record<string, number | string | boolean>, layer = 1): Obj[] => {
  const g = getGenerator(id)!;
  const r = buildGen(g, { ...defaultParams(g), ...patch });
  assert.ok(r.parts.length, r.issues.map((i) => i.msg).join('; '));
  return r.parts.map((p) => obj({ ...p.shape, asm: 'a' + id }, 20 + p.at.x, 20 + p.at.y, layer));
};
const fitOnly = (xs: CheckIssue[]) => xs.filter((x) => x.kind === 'fit' || x.kind === 'thickness');

test('Box: Standard passt, Presspassung zu eng, großes Spiel zu locker', () => {
  assert.deepEqual(fitOnly(run(genObjs('box', {}))), []);
  const tight = fitOnly(run(genObjs('box', { clearance: -0.3 })));
  assert.equal(tight.length, 1);
  assert.equal(tight[0].level, 'error');
  assert.ok(tight[0].objs.length >= 4, 'alle Teile der Baugruppe');
  assert.ok(tight[0].fix?.kind === 'gen' && tight[0].fix.patch.clearance === 0);
  const loose = fitOnly(run(genObjs('box', { clearance: 0.4 })));
  assert.equal(loose.length, 1);
  assert.match(loose[0].msg, /locker|loose/);
});

test('Kerf doppelt (Generator und Layer) wird als zu eng erkannt', () => {
  layers[5] = { ...defaultLayer(5), kerf: 0.08 };
  const xs = fitOnly(run(genObjs('box', {}, 5)));
  assert.equal(xs.length, 1);
  assert.match(xs[0].msg, /Pressung|interference/);
});

test('Materialdicke am Layer weicht ab: Hinweis mit Korrektur', () => {
  const e = library.add({ material: 'Pappel', thickness: 4, title: 'Schneiden', desc: '', settings: defaultLayer(6) });
  layers[6] = { ...defaultLayer(6), material: e.id };
  const xs = fitOnly(run(genObjs('shelf', { thickness: 3 }, 6)));
  const th = xs.find((x) => x.kind === 'thickness');
  assert.ok(th);
  assert.ok(th.fix?.kind === 'gen' && th.fix.patch.thickness === 4);
  // Schlitze 3,1 mm für 4 mm Material: viel zu eng
  assert.ok(xs.some((x) => x.kind === 'fit' && x.level === 'error'));
  library.remove(e.id);
});

test('Mit Kalibrierung: Abweichung gemeldet, Korrektur übernimmt die kalibrierten Werte', () => {
  const e = library.add({ material: 'Birke', thickness: 3, title: 'Schneiden', desc: '', settings: defaultLayer(7) });
  library.update(e.id, { fit: { kerf: 0.2, pair: -0.05, slot: 0.1, th: 3, date: '' } });
  layers[7] = { ...defaultLayer(7), material: e.id };
  const xs = fitOnly(run(genObjs('box', { clearance: 0 }, 7)));
  assert.equal(xs.length, 1);
  assert.match(xs[0].msg, /enger als die Kalibrierung|tighter than the calibration/);
  const f = xs[0].fix;
  assert.ok(f && f.kind === 'gen' && f.calibrated);
  assert.equal(f.patch.kerf, 0.2);
  // gezeichnetes Spiel = 0,15 − 0,2 = −0,05 wie kalibriert
  assert.ok(Math.abs(drawnFit('pair', Number(f.patch.clearance), 0.2, 0) - -0.05) < 1e-9);
  // nach dem Übernehmen kein Befund mehr
  assert.deepEqual(fitOnly(run(genObjs('box', f.patch as Record<string, number>, 7))), []);
  // Einsatz: Schlitz = Dicke + 0,1 gezeichnet
  const p = genFitPatch('insert', library.get(e.id)!, { kerf: 0.15 } as never, 0)!;
  assert.ok(Math.abs(3 + drawnFit('slot', Number(p.play), Number(p.kerf), 0) - 3.1) < 1e-9);
  assert.deepEqual(fitOnly(run(genObjs('insert', p as Record<string, number>, 7))), []);
  library.remove(e.id);
});

test('Verbindungs-Werkzeug: Passung der gespeicherten Verbindung', () => {
  const a = rect(50, 30, 10, 10);
  const b = rect(50, 30, 10, 60);
  const mate = { to: b.id, kind: 'finger', th: 3, a: [{ x: 0, y: 30 }, { x: 50, y: 30 }, { x: 25, y: 20 }], b: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 10 }] } as never as NonNullable<Obj['mates']>[number];
  a.mates = [{ ...mate, fit: { k: 0, c: -0.3 } }];
  const xs = fitOnly(run([a, b]));
  assert.equal(xs.length, 1);
  assert.equal(xs[0].objs.length, 2);
  assert.equal(xs[0].lines.length, 2);
  a.mates = [{ ...mate, fit: { k: 0, c: 0 } }];
  assert.deepEqual(fitOnly(run([a, b])), []);
  // ältere Verbindung ohne Angaben: nichts zu prüfen
  a.mates = [mate];
  assert.deepEqual(fitOnly(run([a, b])), []);
});

test('Spiel-Formeln', () => {
  assert.ok(Math.abs(realGap('pair', drawnFit('pair', 0, 0.15, 0), 0.15, 3, 3)) < 1e-9);
  assert.ok(Math.abs(realGap('slot', drawnFit('slot', 0.1, 0.15, 0), 0.15, 3, 3) - 0.05) < 1e-9);
  assert.equal(suggestFit('pair', { id: 'x', material: 'm', thickness: 3, title: '', desc: '', settings: defaultLayer(1) }, 0.15, 0), null);
});

// ---------- Kalibrierassistent (Etappe 3) ----------

test('Kalibrier-Testteile: Stufen stimmen, saubere Konstruktion', () => {
  const opt = { th: 3, pair: { from: -0.2, step: 0.05, count: 6 }, slot: { from: -0.25, step: 0.05, count: 8 } };
  assert.deepEqual(stepValues(opt.pair), [-0.2, -0.15, -0.1, -0.05, 0, 0.05]);
  const { objs, w, h } = buildCalibParts(opt, 1, 0, 'sans');
  assert.ok(w > 0 && h > 0 && w < 200 && h < 120);
  const byName = (n: string) => objs.find((o) => o.name === t(n))!;
  // Zapfen: Breite TAB − 2·Spiel
  const tabs = byName('Zapfenkamm').shape as Extract<Shape, { kind: 'path' }>;
  const top = tabs.subs[0].nodes.filter((q) => q.y === 0).map((q) => q.x);
  const widths = [];
  for (let i = 0; i < top.length; i += 2) widths.push(Math.round((top[i + 1] - top[i]) * 1000) / 1000);
  assert.deepEqual(widths, stepValues(opt.pair).map((c) => TAB - 2 * c));
  // Schlitze: Dicke + Zugabe
  const comb = byName('Schlitzkamm').shape as Extract<Shape, { kind: 'path' }>;
  const bottom = comb.subs[0].nodes.filter((q) => q.y === 10).map((q) => q.x);
  const sw = [];
  for (let i = 0; i < bottom.length; i += 2) sw.push(Math.round((bottom[i + 1] - bottom[i]) * 1000) / 1000);
  assert.deepEqual(sw, stepValues(opt.slot).map((d) => Math.round((3 + d) * 1000) / 1000));
  // Nummern auf dem Gravur-Layer, Schnitte ohne Befunde
  assert.equal(objs.filter((o) => o.shape.kind === 'text').length, 1 + 8 + 6 + 6);
  layers[0] = { ...defaultLayer(0), mode: 'fill' };
  assert.deepEqual(run(objs.filter((o) => o.layer === 1)), []);
});

test('Kalibrierung auswerten: Schnittfuge, Spiel und Schlitz, Kerf-Versatz eingerechnet', () => {
  const test0 = { th: 3, kl: 0, layer: 1, pair: [-0.2, -0.15, -0.1], slot: [-0.1, 0, 0.1], date: '2026-10-18' };
  const r = calibResult(test0, 19.84, 2, 3);
  assert.ok('fit' in r);
  assert.deepEqual(r.fit, { kerf: 0.16, pair: -0.15, slot: 0.1, th: 3, date: '2026-10-18' });
  assert.deepEqual(calibResult(test0, null, 1, 1), { fit: { kerf: null, pair: -0.2, slot: -0.1, th: 3, date: '2026-10-18' } });
  assert.deepEqual(calibResult(test0, 21, 1, 1), { error: 'square' });
  assert.deepEqual(calibResult(test0, NaN, 1, 1), { error: 'square' });
  assert.deepEqual(calibResult(test0, null, 4, 1), { error: 'pair' });
  // Mit Kerf-Versatz 0,08 am Layer: Quadrat außen größer, gezeichnete Passung enger
  const r2 = calibResult({ ...test0, kl: 0.08 }, SQUARE, 1, 2);
  assert.ok('fit' in r2);
  assert.deepEqual([r2.fit.kerf, r2.fit.pair, r2.fit.slot], [0.16, -0.36, -0.16]);
  // Vorschlag der Stufen liegt um die Schnittbreite herum
  const d = defaultSteps(0.15, 0);
  assert.ok(stepValues(d.pair).some((c) => Math.abs(c + 0.15) < 1e-9));
  assert.ok(stepValues(d.slot).some((c) => Math.abs(c + 0.15) < 1e-9));
});

test('Kalibrierung → Generator: kein Befund, Layer-Kerf ersetzt die Fuge im Bauteil', () => {
  const e = library.add({ material: 'Pappel', thickness: 3, title: 'Schneiden', desc: '', settings: defaultLayer(8) });
  library.update(e.id, { fit: { kerf: 0.16, pair: -0.15, slot: 0.1, th: 3, date: '' } });
  layers[8] = { ...defaultLayer(8), material: e.id };
  const p = genFitPatch('box', library.get(e.id)!, defaultParams(getGenerator('box')!), 0)!;
  assert.equal(p.kerf, 0.16);
  assert.deepEqual(fitOnly(run(genObjs('box', p as Record<string, number>, 8))), []);
  layers[9] = { ...defaultLayer(9), material: e.id, kerf: 0.08 };
  const p2 = genFitPatch('box', library.get(e.id)!, defaultParams(getGenerator('box')!), 0.08)!;
  assert.equal(p2.kerf, 0);
  assert.deepEqual(fitOnly(run(genObjs('box', p2 as Record<string, number>, 9))), []);
  // Verbindungs-Werkzeug: Schlitz und Zapfen für 3 mm
  const s = suggestFit('slot', library.get(e.id)!, 0, 0)!;
  assert.ok(Math.abs(3 + s.play - s.kerf - 3.1) < 1e-9);
  library.remove(e.id);
});

// ---------- Steckprüfung ----------

const asmOnly = (xs: CheckIssue[]) => xs.filter((x) => x.kind === 'loose' || x.kind === 'insert');

test('Steckprüfung: Regal und Einsatz ohne Befund, Scheibenkugel lässt sich nicht gerade stecken', () => {
  assert.deepEqual(asmOnly(run(genObjs('shelf', {}))), []);
  assert.deepEqual(asmOnly(run(genObjs('insert', {}))), []);
  const ds = asmOnly(run(genObjs('discsphere', {})));
  assert.equal(ds.length, 1);
  assert.equal(ds[0].kind, 'insert');
  assert.equal(ds[0].level, 'warn');
  assert.match(ds[0].msg, /gerade stecken|straight/);
  assert.ok(ds[0].objs.length > 0 && ds[0].lines.length === 1);
});

test('Steckprüfung: Fehlt ein Teil, hängen andere lose; Teile auf anderen Seiten zählen mit', () => {
  const all = genObjs('insert', {});
  const parts = all.map((o) => (o.shape as { part?: string }).part);
  // Ohne das Teil, in dem die anderen stecken, hält nichts mehr zusammen
  let hit = '';
  for (let i = 0; i < all.length && !hit; i++) {
    const xs = asmOnly(run(all.filter((_, j) => j !== i)));
    if (xs.some((x) => x.kind === 'loose' && x.level === 'error')) hit = parts[i] ?? '?';
  }
  assert.ok(hit, 'Kein Teil, dessen Fehlen etwas löst');
  // Liegt ein Teil auf einer anderen Seite, ist es nicht gelöscht
  const half = all.slice(0, 1);
  const xs = checkDesign({ objs: half, allObjs: all, layer: layerOf, bed: { w: 400, h: 400 }, settings: DEFAULT_CHECK });
  assert.deepEqual(asmOnly(xs), []);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('alle Tests bestanden');
