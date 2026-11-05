// Tests der 3D-Ansicht: Baugruppen in Lage bringen und auf Durchdringungen prüfen. Aufruf: npm run test:3d
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Params } from '../src/generators';
import type { Solid } from '../src/view3d/solids';
const { asmSolids, findOverlaps, solidBounds } = await import('../src/view3d/solids');
const { rotatePose } = await import('../src/view3d/poses');
const { defaultParams, getGenerator } = await import('../src/generators/index');
const { computeJoint, jointMate, DEFAULT_JOINT } = await import('../src/joints');
const { assembleMates } = await import('../src/view3d/mates');
const { subsPolys } = await import('../src/view3d/solids');
const { sphereLayout } = await import('../src/generators/discsphere');
import type { Obj, Mate } from '../src/model';
import type { JointOptions } from '../src/joints';
const { loadDoc, IDENT } = await import('../src/model');
const { collectScene } = await import('../src/view3d/panel');

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
const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) < eps, `${what} ${a} ≠ ${b} (±${eps})`);

function solids(gen: string, o: Params = {}): Solid[] {
  const s = asmSolids(gen, { ...defaultParams(getGenerator(gen)!), ...o }, 3);
  assert.ok(s && s.length, `${gen}: keine Teile`);
  return s!;
}
function bounds(s: Solid[]) {
  const b = s.map(solidBounds);
  return [0, 1, 2].map((k) => [Math.min(...b.map((x) => x.min[k])), Math.max(...b.map((x) => x.max[k]))]);
}
const pairs = (s: Solid[]) => findOverlaps(s).map((o) => `${o.a}/${o.b}`);

test('Mehrlagenarbeit: Platten bleiben über Seiten verknüpft und stapeln sich bündig', () => {
  const rect = (id: number, x: number, y: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w: 40, h: 30, r: 0 } });
  const lower = rect(901, 20, 20), upper = rect(902, 180, 90);
  const doc = loadDoc({ version: 2, bed: { w: 300, h: 200 }, page: 0, layers: {}, pages: [{ name: 'A', objs: [lower] }, { name: 'B', objs: [upper] }], multiLayerAssemblies: [{ id: 'layers', plates: [
    { object: 901, name: 'Basis', thickness: 2, look: { id: 'birch' }, anchor: IDENT },
    { object: 902, name: 'Decklage', thickness: 4, look: { id: 'acrylic' }, anchor: IDENT },
  ] }] });
  const ed = { doc, sel: [lower], layer: () => ({ mode: 'line', output: true, show: true, material: undefined }) } as never;
  const scene = collectScene(ed, 3, false).scene;
  assert.equal(scene.solids.length, 2);
  assert.deepEqual(scene.solids.map((s) => s.label), ['Basis', 'Decklage']);
  assert.deepEqual(scene.solids.map((s) => [s.pose.o[2], s.th]), [[0, 2], [2, 4]]);
  assert.deepEqual(pairs(scene.solids), []);
});

test('Box: Platten ergeben den Kasten, mit Spiel ohne und mit Presspassung mit Durchdringung', () => {
  for (const o of [{ top: 'closed' }, { top: 'open', width: 37, depth: 151, height: 23.5, thickness: 4.2, finger: 6 }]) {
    const s = solids('box', o);
    assert.deepEqual(pairs(s), [], JSON.stringify(o));
  }
  const s = solids('box', { top: 'closed', width: 120, depth: 80, height: 60 });
  const b = bounds(s);
  [120, 80, 60].forEach((len, k) => (near(b[k][0], 0, 1e-6, 'Anfang'), near(b[k][1], len, 1e-6, 'Ende')));
  assert.deepEqual(pairs(solids('box', { top: 'closed', clearance: 0.3 })), []);
  // Jede der zwölf Kanten greift ineinander
  const press = findOverlaps(solids('box', { top: 'closed', clearance: -0.3 }));
  assert.equal(press.length, 12, press.map((o) => `${o.a}/${o.b}`).join(' '));
  assert.ok(press.every((o) => o.pieces.length > 0 && o.volume > 0.01));
});

test('Schublade: Schubkasten im Korpus, Blende davor, nichts durchdringt sich', () => {
  for (const o of [{}, { front: 'inset' }, { carcass: false }, { sidePlay: 0, topPlay: 0, backPlay: 0 }, { front: 'none', handle: 'none' }]) assert.deepEqual(pairs(solids('drawer', o)), [], JSON.stringify(o));
  const b = bounds(solids('drawer', { width: 160, height: 80, depth: 150, thickness: 3 }));
  near(b[0][0], 0, 1e-6, 'links');
  near(b[0][1], 160, 1e-6, 'rechts');
  near(b[1][0], -3, 1e-6, 'Blende vorne');
  near(b[1][1], 150, 1e-6, 'hinten');
  near(b[2][1], 80, 1e-6, 'oben');
  // Schubkasten mit der Luft in der Öffnung des Korpus
  const d = bounds(solids('drawer', { width: 160, height: 80, depth: 150, thickness: 3, sidePlay: 1, topPlay: 2, backPlay: 2 }).filter((x) => x.key.startsWith('d_')));
  assert.deepEqual(d, [[4, 156], [0, 145], [3, 75]]);
  // Presspassung nur innerhalb von Korpus und Schubkasten
  const press = findOverlaps(solids('drawer', { clearance: -0.3 }));
  assert.ok(press.length > 0);
  assert.ok(press.every((o) => o.a.slice(0, 2) === o.b.slice(0, 2)), press.map((o) => `${o.a}/${o.b}`).join(' '));
});

test('Einsatz: Stege kreuzen sich in den Schlitzen', () => {
  assert.deepEqual(pairs(solids('insert', {})), []);
  assert.deepEqual(pairs(solids('insert', { play: 0 })), []);
  const press = findOverlaps(solids('insert', { cellsX: 4, cellsY: 3, play: -0.3 }));
  assert.equal(press.length, 3 * 2, 'jede Kreuzung');
  const b = bounds(solids('insert', { width: 150, depth: 100, height: 40, endPlay: 0.5 }));
  near(b[1][1] - b[1][0], 99.5, 1e-6, 'Längsstege');
  near(b[2][1] - b[2][0], 40, 1e-6, 'Höhe');
});

test('Steckregal: Böden stecken in den Seiten', () => {
  for (const o of [{}, { play: 0 }, { shelves: 5, width: 420, depth: 200, height: 600, thickness: 6, overhang: 0 }]) assert.deepEqual(pairs(solids('shelf', o)), [], JSON.stringify(o));
  const press = findOverlaps(solids('shelf', { shelves: 3, play: -0.3 }));
  assert.equal(press.length, 2 * 3, press.map((o) => `${o.a}/${o.b}`).join(' '));
  const b = bounds(solids('shelf', { width: 300, depth: 150, height: 300 }));
  near(b[0][1] - b[0][0], 300, 1e-6, 'Breite');
  near(b[2][1], 300, 1e-6, 'Höhe');
});

test('Zahnradpaar: Räder greifen ineinander und drehen sich ohne Durchdringung', () => {
  for (const o of [{}, { teeth1: 13, teeth2: 30 }, { teeth1: 9, teeth2: 9, profileShift: 0.3 }, { plate: false }] as Params[]) {
    const s = solids('gearpair', o);
    const z1 = Number(o.teeth1 ?? defaultParams(getGenerator('gearpair')!).teeth1);
    // Über eine Zahnteilung von Rad 1 drehen
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * ((2 * Math.PI) / z1);
      const turned = s.map((x) => (x.spin ? { ...x, pose: rotatePose(x.pose, a * x.spin) } : x));
      assert.deepEqual(pairs(turned), [], `${JSON.stringify(o)} bei ${a}`);
    }
  }
  // Ohne Flankenspiel und um einen halben Zahn verdreht greifen die Zähne aufeinander
  const s = solids('gearpair', { teeth1: 12, teeth2: 20, plate: true });
  const wrong = s.map((x) => (x.key === 'gear2' ? { ...x, pose: rotatePose(x.pose, Math.PI / 20) } : x));
  assert.deepEqual(pairs(wrong), ['gear1/gear2']);
  // Räder liegen auf der Platte
  const plate = s.find((x) => x.key === 'plate')!;
  near(solidBounds(s.find((x) => x.key === 'gear1')!).min[2], solidBounds(plate).max[2], 1e-9, 'auf der Platte');
});

test('Teile ohne räumlichen Aufbau', () => {
  assert.equal(asmSolids('gear', defaultParams(getGenerator('gear')!), 3), null);
  assert.equal(asmSolids('unbekannt', {}, 3), null);
  const some = asmSolids('box', { ...defaultParams(getGenerator('box')!), top: 'closed' }, 3, new Set(['front', 'left']))!;
  assert.deepEqual(some.map((x) => x.key).sort(), ['front', 'left']);
});

// ---------- Teile aus dem Verbindungs-Werkzeug ----------

const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
let nid = 1;
const rect = (x: number, y: number, w: number, h: number): Obj => ({
  id: nid++, m: [...I], layer: 0,
  shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }] },
});
/** Verbindung wie im Editor anwenden und merken (Weltmatrix = Identität, lokal = Welt) */
function join(a: Obj, segA: number, b: Obj, segB: number, o: Partial<JointOptions>) {
  const opt = { ...DEFAULT_JOINT, ...o };
  const picks = [{ obj: a, m: I, sub: 0, seg: segA }, { obj: b, m: I, sub: 0, seg: segB }];
  const mw = jointMate(picks, opt);
  const r = computeJoint(picks, opt);
  assert.ok(!r.error, r.error);
  for (const [obj, c] of r.changes) obj.shape = { kind: 'path', subs: c.subs };
  assert.ok(mw, 'keine Lage');
  const m: Mate = { to: b.id, kind: opt.kind, th: opt.thickness, a: mw!.a, b: mw!.b, ...(mw!.out ? { out: true } : {}), ...(mw!.lap ? { lap: mw!.lap } : {}) };
  a.mates = [...(a.mates ?? []), m];
}
function assembled(objs: Obj[]) {
  const parts = objs.map((o) => ({ id: o.id, label: String(o.id), polys: subsPolys((o.shape as { subs: never }).subs), m: I, mates: o.mates ?? [] }));
  return assembleMates(parts, 3).solids;
}
const perp = (a: Solid, b: Solid) => Math.abs(a.pose.n[0] * b.pose.n[0] + a.pose.n[1] * b.pose.n[1] + a.pose.n[2] * b.pose.n[2]) < 1e-9;

test('Verbindungen: Fingerzinken stellen die Wand senkrecht an die Kante', () => {
  for (const direction of ['in', 'out'] as const) {
    for (const clearance of [0, 0.2]) {
      const bottom = rect(0, 0, 100, 80),
        front = rect(0, 100, 100, 50);
      // Unterkante des Bodens (Segment 2) mit Oberkante der Wand (Segment 0)
      join(bottom, 2, front, 0, { kind: 'finger', direction, clearance, thickness: 3, fingerWidth: 10 });
      const s = assembled([bottom, front]);
      assert.equal(s.length, 2);
      assert.ok(perp(s[0], s[1]), 'nicht senkrecht');
      assert.deepEqual(pairs(s), [], `${direction} ${clearance}`);
      const b = bounds(s);
      near(b[2][1] - b[2][0], direction === 'in' ? 50 : 53, 1e-6, `Höhe ${direction}`);
      near(b[1][1] - b[1][0], direction === 'in' ? 80 : 83, 1e-6, `Tiefe ${direction}`);
    }
    const bottom = rect(0, 0, 100, 80),
      front = rect(0, 100, 100, 50);
    join(bottom, 2, front, 0, { kind: 'finger', direction, clearance: -0.2 });
    assert.equal(findOverlaps(assembled([bottom, front])).length, 1, `Presspassung ${direction}`);
  }
});

test('Verbindungen: Box aus Boden und vier Wänden', () => {
  // Außenmaß 100 × 80 × 50, Zinken nach innen, jede Wand mit dem Boden verbunden
  const bottom = rect(0, 0, 100, 80);
  const front = rect(0, 100, 100, 50),
    back = rect(0, 160, 100, 50),
    left = rect(120, 100, 80, 50),
    right = rect(120, 160, 80, 50);
  const o = { kind: 'finger' as const, direction: 'in' as const, thickness: 3, fingerWidth: 10 };
  // Hinten anfangen: eingefügte Zinken verschieben die Nummern der folgenden Segmente
  join(bottom, 3, left, 2, o);
  join(bottom, 2, front, 2, o);
  join(bottom, 1, right, 2, o);
  join(bottom, 0, back, 2, o);
  const s = assembled([bottom, front, back, left, right]);
  const b = bounds(s);
  near(b[0][1] - b[0][0], 100, 1e-6, 'Breite');
  near(b[1][1] - b[1][0], 80, 1e-6, 'Tiefe');
  near(b[2][1] - b[2][0], 50, 1e-6, 'Höhe');
  // Nur der Boden ist verbunden: jede Wand berührt ihn ohne Durchdringung
  const touch = findOverlaps(s).filter((x) => [x.a, x.b].includes(String(bottom.id)));
  assert.deepEqual(touch.map((x) => `${x.a}/${x.b}`), []);
});

test('Verbindungen: Zapfen stecken in den Schlitzen der Gegenplatte', () => {
  for (const kind of ['tenon', 'wedge', 'snap', 'tslot'] as const) {
    const plate = rect(0, 0, 100, 80),
      wall = rect(200, 0, 60, 40);
    // Unterkante der Wand (Segment 2) bekommt Zapfen, die Oberkante der Platte (Segment 0) mit 20 mm Abstand die Schlitze
    join(wall, 2, plate, 0, { kind, tenonCount: 2, tenonWidth: 10, slotOffset: 20, thickness: 3 });
    const s = assembled([wall, plate]);
    assert.ok(perp(s[0], s[1]), `${kind}: nicht senkrecht`);
    assert.deepEqual(pairs(s), [], kind);
  }
  const plate = rect(0, 0, 100, 80),
    wall = rect(200, 0, 60, 40);
  join(wall, 2, plate, 0, { kind: 'tenon', tenonCount: 2, tenonWidth: 10, slotOffset: 20, clearance: -0.2 });
  assert.equal(findOverlaps(assembled([wall, plate])).length, 1, 'Presspassung');
});

test('Verbindungen: Schlitze auf einer Hilfslinie gehören zur Platte darunter', () => {
  const side = rect(0, 0, 120, 160),
    shelf = rect(200, 40, 100, 40);
  const guide: Obj = { id: nid++, m: [...I], layer: 0, shape: { kind: 'path', subs: [{ closed: false, nodes: [{ x: 20, y: 80 }, { x: 100, y: 80 }] }] } };
  // Linke Kante des Regalbodens (Segment 3) bekommt die Zapfen, die Hilfslinie die Schlitze
  join(shelf, 3, guide, 0, { kind: 'tenon', tenonCount: 2, tenonWidth: 15, thickness: 3 });
  shelf.mates![0].to = side.id;
  side.shape = { kind: 'path', subs: [...(side.shape as { subs: never[] }).subs, ...(guide.shape as { subs: never[] }).subs] };
  const s = assembled([shelf, side]);
  assert.ok(perp(s[0], s[1]));
  assert.deepEqual(pairs(s), []);
});

test('Verbindungen: Überblattung kreuzt die Platten', () => {
  for (const [lapDepth, clearance, expect] of [[50, 0, 0], [30, 0.1, 0], [50, -0.2, 1]] as const) {
    const a = rect(0, 0, 100, 40),
      b = rect(0, 60, 120, 40);
    join(a, 0, b, 2, { kind: 'lap', lapCount: 1, lapDepth, clearance, thickness: 3 });
    const s = assembled([a, b]);
    assert.ok(perp(s[0], s[1]));
    assert.equal(findOverlaps(s).length, expect, `${lapDepth} ${clearance}`);
    // Gleich breite Platten liegen bündig: beide reichen quer zur Kreuzung gleich weit (A liegt flach, Kante bei y = 0)
    const ya = solidBounds(s[0]),
      yb = solidBounds(s[1]);
    near(ya.min[1], yb.min[1], 1e-3, 'bündig unten');
    near(ya.max[1], yb.max[1], 1e-3, 'bündig oben');
  }
});

test('Verbindungen: Deckel liegt geschlossen auf der Rückwand', () => {
  const back = rect(0, 0, 100, 50),
    lid = rect(0, 70, 100, 80);
  join(back, 0, lid, 0, { kind: 'lidhinge', thickness: 3 });
  const s = assembled([back, lid]);
  assert.ok(perp(s[0], s[1]));
  assert.deepEqual(pairs(s), []);
  // Rückwand flach (100 × 50), Deckel senkrecht auf ihrer Oberkante, nach außen: 100 × 53 × 80
  const dims = bounds(s).map(([lo, hi]) => hi - lo).sort((x, y) => x - y);
  [53, 80, 100].forEach((v, i) => near(dims[i], v, 1e-6, 'Maße'));
});

// ---------- Material-Aussehen ----------
const { LOOKS, cleanLook, guessLook, layerLook, lookTexture, resolveLook, DEFAULT_LOOK } = await import('../src/view3d/looks');
const { sanitizeEntry } = await import('../src/materials');

test('Aussehen: Vorlagen eindeutig und vollständig', () => {
  assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length);
  for (const l of LOOKS) {
    assert.match(l.color, /^#[0-9a-f]{6}$/);
    assert.match(l.engrave.color, /^#[0-9a-f]{6}$/);
    assert.ok(l.tile > 0 && l.rough >= 0 && l.rough <= 1 && l.clear >= 0 && l.clear <= 1, l.id);
  }
});

test('Aussehen: gespeicherte Werte prüfen', () => {
  assert.deepEqual(cleanLook({ id: 'slate' }), { id: 'slate' });
  assert.deepEqual(cleanLook({ id: 'oak', color: '#AABBCC' }), { id: 'oak', color: '#aabbcc' });
  assert.deepEqual(cleanLook({ id: 'oak', color: 'rot' }), { id: 'oak' });
  assert.equal(cleanLook({ id: 'gibtsnicht' }), undefined);
  assert.equal(cleanLook(null), undefined);
  assert.equal(resolveLook({ id: 'oak', color: '#112233' }).color, '#112233');
});

test('Aussehen: aus dem Materialnamen raten', () => {
  assert.equal(guessLook('Schiefer')?.id, 'slate');
  assert.equal(guessLook('Sperrholz Pappel 3 mm')?.id, 'poplar');
  assert.equal(guessLook('Birch plywood')?.id, 'birch');
  assert.equal(guessLook('Acryl schwarz')?.id, 'acrylic-opaque');
  assert.equal(guessLook('Plexiglas klar')?.id, 'acrylic');
  assert.equal(guessLook('Graupappe')?.id, 'cardboard');
  assert.equal(guessLook('Aluminium eloxiert')?.id, 'anodized');
  assert.equal(guessLook('MDF')?.id, 'mdf');
  assert.equal(guessLook('Glasfaser'), undefined);
  assert.equal(guessLook('Irgendwas'), undefined);
  const names: Record<string, string> = { m1: 'Schiefer' };
  // Eigenes Aussehen vor geratenem vor Standard
  assert.equal(layerLook({ look: { id: 'oak' }, material: 'm1' }, (id) => names[id], DEFAULT_LOOK).id, 'oak');
  assert.equal(layerLook({ material: 'm1' }, (id) => names[id], DEFAULT_LOOK).id, 'slate');
  assert.equal(layerLook({}, (id) => names[id], { id: 'walnut' }).id, 'walnut');
});

test('Aussehen: Texturen kachelbar', () => {
  const N = 64;
  for (const l of LOOKS) {
    const { rgba, height } = lookTexture(l, N);
    assert.equal(rgba.length, N * N * 4);
    assert.equal(height.length, N * N);
    // Gegenüberliegende Ränder passen zusammen: Sprung über den Rand nicht viel größer als innen
    let edge = 0,
      inner = 0;
    for (let j = 0; j < N; j++) {
      const at = (i: number) => rgba[(j * N + i) * 4 + 1];
      edge += Math.abs(at(N - 1) - at(0));
      inner += Math.abs(at(N / 2) - at(N / 2 - 1));
    }
    assert.ok(edge <= inner * 2.5 + N * 2, `${l.id}: Rand ${edge} / innen ${inner}`);
  }
});

test('Aussehen: Material-Bibliothek speichert es mit', () => {
  const e = sanitizeEntry({ material: 'Schiefer', settings: { mode: 'fill', look: { id: 'slate', color: '#000000' } } })!;
  assert.deepEqual(e.settings.look, { id: 'slate', color: '#000000' });
  const bad = sanitizeEntry({ material: 'X', settings: { mode: 'line', look: { id: 'nix' } } })!;
  assert.equal('look' in bad.settings, false);
});

test('Scheibenkugel: schräge Schlitze ohne Durchdringung', () => {
  for (const o of [{ shape: 'dodeca' }, { shape: 'icosa', overlap: 0 }, { shape: 'icosa', overlap: 100, thickness: 2 }, { shape: 'rhombi' }, { shape: 'tico', diameter: 300 }] as Params[]) {
    // Ganz ohne Spiel liegen die Flächen genau aufeinander; die Rundung der Konturen auf 0,001 mm kann dann winzige
    // Überdeckungen ergeben. Deshalb mit 0,02 mm Spiel prüfen.
    const s = solids('discsphere', { ...o, play: 0.02, kerf: 0 });
    assert.deepEqual(pairs(s), [], JSON.stringify(o));
    // Mit Presspassung überdecken sich genau die gesteckten Paare
    const press = findOverlaps(solids('discsphere', { ...o, play: -0.2, kerf: 0 }));
    const L = sphereLayout({ ...defaultParams(getGenerator('discsphere')!), ...o, play: -0.2 })!;
    assert.equal(press.length, L.discs.reduce((n, d) => n + d.slots.length, 0) / 2, `${JSON.stringify(o)}: Presspassung`);
  }
  // Rand der Scheiben auf der Kugel, die Plattendicke (1 mm) steht etwas über
  const b = bounds(solids('discsphere', { diameter: 200, shape: 'icosa' }));
  assert.ok(b.every(([lo, hi]) => hi - lo <= 202 && hi - lo > 190), JSON.stringify(b));
});

test('Schräge Platten: Durchdringung wird gefunden', () => {
  // Zwei volle Rechtecke, die sich im Winkel von 60° kreuzen
  const rect = [[{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }]];
  const c = Math.cos(Math.PI / 3),
    sn = Math.sin(Math.PI / 3);
  const A: Solid = { key: 'a', label: 'a', polys: rect, th: 2, pose: { o: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] } };
  const n: [number, number, number] = [0, -sn, c];
  const B: Solid = { key: 'b', label: 'b', polys: rect, th: 2, pose: { o: [0, -n[1], -n[2]], u: [1, 0, 0], v: [0, c, sn], n } };
  const ov = findOverlaps([A, B]);
  assert.equal(ov.length, 1);
  // Querschnitt = Raute mit Seiten 2/sin 60°, Fläche 4/sin 60°, über 40 mm Länge
  near(ov[0].volume, (40 * 4) / sn, 0.5, 'Volumen');
});

// ---------- Steckprüfung ----------
const { analyzeAssembly } = await import('../src/view3d/assembly');
const ClipperLib = (await import('clipper-lib')).default;
const { execute, SCALE } = await import('../src/clip');

test('Steckprüfung: Generator-Baugruppen hängen zusammen und lassen sich stecken', () => {
  for (const [gen, o] of [['box', {}], ['box', { top: 'closed' }], ['drawer', {}], ['insert', {}], ['shelf', {}]] as const) {
    const r = analyzeAssembly(solids(gen, o));
    assert.equal(r.groups.length, 1, `${gen}: ${r.groups.length} Gruppen`);
    assert.deepEqual(r.conflicts, [], gen);
    assert.equal(r.order.length, r.pieces.length, gen);
  }
  // Regal und Einsatz: Halbschlitze, also feste Steckrichtungen
  assert.ok(analyzeAssembly(solids('shelf')).crossings.length >= 4);
  // Scheibenkugel aus starren Scheiben: Ringe schließen sich, nicht alles lässt sich gerade stecken
  const ds = analyzeAssembly(solids('discsphere'));
  assert.equal(ds.groups.length, 1);
  assert.ok(ds.conflicts.length > 0);
});

test('Steckprüfung: loses Teil, eigene Gruppe und widersprüchliche Steckrichtungen', () => {
  const th = 3;
  // Rechteck minus Schlitze, in lokalen Koordinaten (x, y)
  const plate = (w: [number, number], h: [number, number], cuts: [number, number, number, number][]) => {
    const r = (x0: number, y0: number, x1: number, y1: number) => [{ X: x0 * SCALE, Y: y0 * SCALE }, { X: x1 * SCALE, Y: y0 * SCALE }, { X: x1 * SCALE, Y: y1 * SCALE }, { X: x0 * SCALE, Y: y1 * SCALE }];
    const res = execute(ClipperLib.ClipType.ctDifference, [r(w[0], h[0], w[1], h[1])], cuts.map((c) => r(...c)), ClipperLib.PolyFillType.pftNonZero);
    return res.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
  };
  const W = th / 2 + 0.05;
  // Zwei Rückgrate (Ebene y = 0 und y = 20, in x/z), zwei Rippen (Ebene x = 30 und x = 70, in y/z)
  // top: Schlitz von oben (sonst von unten) an x = 30 / 70 bzw. y = 0 / 20
  const cut = (c: number, top: boolean): [number, number, number, number] => (top ? [c - W, 20, c + W, 41] : [c - W, -1, c + W, 20]);
  const spine = (y: number, t30: boolean, t70: boolean): Solid => ({
    key: `S${y}`, label: `S${y}`, th, pose: { o: [0, y - th / 2, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
    polys: plate([0, 100], [0, 40], [cut(30, t30), cut(70, t70)]),
  });
  const rib = (x: number, t0: boolean, t20: boolean): Solid => ({
    key: `R${x}`, label: `R${x}`, th, pose: { o: [x - th / 2, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
    polys: plate([-10, 30], [0, 40], [cut(0, t0), cut(20, t20)]),
  });
  const good = () => [spine(0, true, true), spine(20, true, true), rib(30, false, false), rib(70, false, false)];
  const ok = analyzeAssembly(good());
  assert.equal(ok.groups.length, 1);
  assert.equal(ok.crossings.length, 4);
  assert.deepEqual(ok.conflicts, []);
  // Gemischt, aber in passender Reihenfolge steckbar (Rippe 70 von oben auf das hintere Rückgrat)
  assert.deepEqual(analyzeAssembly([spine(0, true, true), spine(20, true, false), rib(30, false, false), rib(70, false, true)]).conflicts, []);
  // Jedes Teil müsste auf seine beiden Nachbarn in entgegengesetzten Richtungen: geht in keiner Reihenfolge
  const bad = analyzeAssembly([spine(0, true, false), spine(20, false, true), rib(30, false, true), rib(70, true, false)]);
  assert.equal(bad.groups.length, 1);
  assert.equal(bad.crossings.length, 4);
  assert.equal(bad.conflicts.length, 1, JSON.stringify(bad.conflicts));
  // Loses Teil daneben und ein Teil aus zwei Inseln
  const far: Solid = { ...rib(30, false, false), key: 'X', label: 'X', pose: { ...rib(30, false, false).pose, o: [200, 0, 0] } };
  const two: Solid = { key: 'T', label: 'T', th, pose: { o: [0, 50, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] }, polys: [...plate([0, 10], [0, 10], []), ...plate([20, 30], [0, 10], [])] };
  const lo = analyzeAssembly([...good(), far, two]);
  assert.equal(lo.pieces.length, 7);
  assert.equal(lo.groups.length, 4);
  assert.equal(lo.groups[0].length, 4);
  assert.deepEqual(lo.pieces.filter((p) => p.key === 'T').map((p) => p.island), [1, 2]);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle 3D-Tests bestanden');
