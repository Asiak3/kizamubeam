// Tests der Maschinenausgabe: Start-/End-Skripte, „Start Here“, Vorschau gegen Job. Aufruf: npm run test:gcode
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, burns, checkBed, DEFAULT_ROTARY, Device, estimate, frameGCode, gcodeFooter, jogLines, jogToLines, Moves, newDevice, Rotary, rotaryMoves, rotaryTestLines, sameMoves, startHere, writeGCode } from '../src/gcode';
import { emptyStatus, parseStatus, WorkOffset } from '../src/machine';
import { defaultImageLayer, defaultLayer, defaultSubLayer, Layer, loadDoc, normalizeLayer, Obj } from '../src/model';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const motion = (lines: string[]) => lines.filter((l) => /^G[01]\b|^[XY]/.test(l));

await test('End-Skript nach M5 und vor dem Programmende', () => {
  const endScript = 'G0 X0 Y0\n\n  M8  \n';
  assert.deepEqual(gcodeFooter({ ...newDevice({ fw: 'fluidnc' }), endScript }), ['M5', 'G0 X0 Y0', 'M8', 'M2']);
  assert.deepEqual(gcodeFooter({ ...newDevice({ fw: 'marlin' }), endScript }), ['M5', 'G0 X0 Y0', 'M8', 'M400']);
  assert.deepEqual(gcodeFooter({ ...newDevice({ fw: 'smoothie' }), endScript }), ['G0 X0 Y0', 'M8']);
  assert.deepEqual(gcodeFooter(newDevice({ fw: 'fluidnc' })), ['M5', 'M2']);
});

function sampleMoves(): Moves {
  const mv = new Moves(0, 0);
  mv.push(10, 0, 0, 0, 1);
  mv.push(20, 0, 1000, 0.5, 1);
  mv.push(20, 10, 1000, 0.5, 1);
  mv.push(0, 0, 0, 0, -1);
  return mv;
}
const jobOf = (mv: Moves, air: number[] = []) => ({ moves: mv, bounds: { x0: 10, y0: 0, x1: 20, y1: 10 }, travel: null, hull: [], warnings: [], offset: { x: 0, y: 0 }, air });

await test('Start-Skript nach G21/G90/M4, End-Skript am Ende', () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), startScript: 'M7\nG4 P1', endScript: 'M9' };
  const mv = sampleMoves();
  const g = writeGCode(jobOf(mv), d, estimate(mv, d)).lines;
  const k = g.indexOf('G21');
  assert.deepEqual(g.slice(k, k + 5), ['G21', 'G90', 'M4 S0', 'M7', 'G4 P1']);
  assert.deepEqual(g.slice(-3), ['M5', 'M9', 'M2']);
  assert.equal(g.length, motion(g).length + k + 5 + 3);
});

await test('Start Here mitten in einer Laserbewegung', () => {
  const mv = startHere(sampleMoves(), 1, 0.5);
  assert.equal(mv.n, 4);
  assert.deepEqual([mv.x[0], mv.y[0], mv.f[0], mv.s[0]], [15, 0, 0, 0]);
  assert.deepEqual([mv.x[1], mv.f[1], mv.s[1]], [20, 1000, 0.5]);
  const d = newDevice({ fw: 'fluidnc' });
  const g = motion(writeGCode(jobOf(mv), d, estimate(mv, d)).lines);
  assert.deepEqual(g, ['G0 X15 Y0', 'G1 X20 S500 F1000', 'Y10', 'G0 X0 Y0']);
});

await test('Start Here in einem Eilgang und am Ende einer Bewegung', () => {
  let mv = startHere(sampleMoves(), 0, 0.3);
  assert.deepEqual([mv.n, mv.x[0], mv.y[0], mv.x[1]], [4, 10, 0, 20]);
  mv = startHere(sampleMoves(), 1, 1);
  assert.deepEqual([mv.n, mv.x[0], mv.y[0], mv.x[1], mv.y[1]], [3, 20, 0, 20, 10]);
  mv = startHere(sampleMoves(), 3, 0);
  assert.equal(burns(mv), false);
  assert.equal(startHere(sampleMoves(), 4, 0).n, 0);
});

await test('Start Here schaltet Air Assist vor dem Anfahren ein', () => {
  const d = newDevice({ fw: 'fluidnc' });
  const mv = startHere(sampleMoves(), 2, 0.5);
  const g = writeGCode(jobOf(mv, [1]), d, estimate(mv, d)).lines;
  const i = g.indexOf('M8');
  assert.ok(i >= 0 && g[i + 1] === 'G0 X20 Y5', g.join('\n'));
  // Die Rückfahrt zum Start gehört zu keinem Layer: Air Assist ist dabei schon aus
  assert.deepEqual(g.slice(-4), ['M9', 'G0 X0 Y0', 'M5', 'M2']);
});

// Vorschau und Job: gleiche Bahnen und Reihenfolge, nur verschoben (sonst passt „Start Here“ nicht)
for (const startFrom of ['absolute', 'user', 'current'] as const) {
  await test(`Vorschau entspricht dem Job (Starten ab: ${startFrom})`, async () => {
    const objs: Obj[] = [];
    for (let i = 0; i < 12; i++)
      objs.push({ id: i + 1, m: [1, 0, 0, 1, 40 + ((i * 37) % 200), 50 + ((i * 53) % 150)], layer: 1, shape: { kind: i % 2 ? 'rect' : 'ellipse', w: 20, h: 10, r: 0, rx: 8, ry: 5 } as never });
    const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
    const device = { ...newDevice({ fw: 'fluidnc' }), startFrom, jobOrigin: 6 };
    const inp = { doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device, position: { x: 123, y: 77 } };
    const prev = await buildJob({ ...inp, forPreview: true });
    const real = await buildJob(inp);
    assert.ok(real.moves.n > 20);
    assert.ok(sameMoves(prev.moves, real.moves, real.offset));
    if (startFrom !== 'absolute') assert.ok(real.offset.x || real.offset.y);
    // Vorschau liegt auf dem Bett, der Job beginnt am Ursprung bzw. an der Laserposition
    assert.deepEqual(prev.bounds, { x0: real.bounds!.x0 - real.offset.x, y0: real.bounds!.y0 - real.offset.y, x1: real.bounds!.x1 - real.offset.x, y1: real.bounds!.y1 - real.offset.y });
    if (startFrom === 'current') assert.deepEqual([real.moves.x0, real.moves.y0], [123, 77]);
  });
}

// Gesetzter Startpunkt (Set Start Point): die Optimierung beginnt dort und behält die Richtung
for (const fixed of [false, true]) {
  await test(`Startpunkt ${fixed ? 'gesetzt: bleibt' : 'frei: nächster Knoten'}`, async () => {
    const sq = { closed: true, nodes: [{ x: 100, y: 300 }, { x: 120, y: 300 }, { x: 120, y: 320 }, { x: 100, y: 320 }], ...(fixed ? { start: true } : {}) };
    const ln = { closed: false, nodes: [{ x: 300, y: 300 }, { x: 200, y: 300 }], ...(fixed ? { start: true } : {}) };
    const objs: Obj[] = [
      { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [sq] } },
      { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [ln] } },
    ];
    const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
    const device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, optimize: true, returnHome: false };
    const job = await buildJob({ doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device });
    const mv = job.moves;
    // erste Eilfahrt: zur Ecke des Quadrats
    const first = [mv.x[0], mv.y[0]];
    assert.deepEqual(first, fixed ? [100, 100] : [100, 80]);
    // zweite Eilfahrt: zur Linie; frei am näheren Ende (200), gesetzt am Anfang (300)
    let k = 1;
    while (k < mv.n && mv.f[k] !== 0) k++;
    assert.deepEqual([mv.x[k], mv.y[k]], fixed ? [300, 100] : [200, 100]);
  });
}

// ---------- Konturfolgende Füllung ----------

const offsetJob = (objs: Obj[], interval = 1, passes = 1) =>
  buildJob({
    doc: loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} }),
    layer: (i: number) => ({ ...defaultLayer(i), mode: 'fill' as const, fillStyle: 'offset' as const, interval, passes }),
    imgLayer: () => defaultImageLayer(),
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false },
  });
/** Geschlossene Ringe einer Bewegungsliste: Eilfahrt zum Start, dann Laserstrecken zurück zum Start */
function ringsOf(mv: Moves) {
  const rings: { x: number[]; y: number[] }[] = [];
  for (let i = 0; i < mv.n; i++) {
    if (mv.s[i] === 0) rings.push({ x: [mv.x[i]], y: [mv.y[i]] });
    else (rings.at(-1)!.x.push(mv.x[i]), rings.at(-1)!.y.push(mv.y[i]));
  }
  return rings;
}

await test('Kontur folgend: Quadrat in Ringen nach innen, erster Ring einen halben Abstand innerhalb', async () => {
  const objs: Obj[] = [{ id: 1, m: [1, 0, 0, 1, 100, 100], layer: 1, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as never }];
  const job = await offsetJob(objs);
  const rings = ringsOf(job.moves);
  // Abstand 1 mm, Kante 10 mm: Ringe bei 0,5 / 1,5 / … / 4,5 mm innerhalb
  assert.equal(rings.length, 5);
  rings.forEach((r, k) => {
    assert.ok(Math.abs(r.x.at(-1)! - r.x[0]) < 1e-9 && Math.abs(r.y.at(-1)! - r.y[0]) < 1e-9, 'Ring geschlossen');
    const w = Math.max(...r.x) - Math.min(...r.x);
    assert.ok(Math.abs(w - (9 - 2 * k)) < 0.01, `Ring ${k}: Breite ${w}`);
  });
  // Von außen nach innen, jeder Ring beginnt nah am Ende des vorigen
  for (let k = 1; k < rings.length; k++) assert.ok(Math.hypot(rings[k].x[0] - rings[k - 1].x[0], rings[k].y[0] - rings[k - 1].y[0]) < 1.5);
  // Gesamter Lauf bleibt innerhalb des Quadrats
  for (let i = 0; i < job.moves.n; i++) assert.ok(job.moves.x[i] >= 100.49 && job.moves.x[i] <= 109.51);
});

await test('Kontur folgend: Löcher bleiben frei, Inseln nacheinander, Durchgänge wiederholt', async () => {
  // Rahmen 20×20 mit Loch 10×10 (gerade-ungerade) und daneben ein zweites Quadrat
  const objs: Obj[] = [
    { id: 1, m: [1, 0, 0, 1, 100, 100], layer: 1, shape: { kind: 'rect', w: 20, h: 20, r: 0 } as never },
    { id: 2, m: [1, 0, 0, 1, 105, 105], layer: 1, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as never },
    { id: 3, m: [1, 0, 0, 1, 200, 100], layer: 1, shape: { kind: 'rect', w: 4, h: 4, r: 0 } as never },
  ];
  const one = ringsOf((await offsetJob(objs)).moves);
  // Rahmen 5 mm breit: Außen- und Lochring bei 0,5 und 1,5 mm; bei 2,5 mm bleiben nur die Ecken zwischen eckigem
  // Außenrand und gerundetem Loch als ein Ring übrig. Dazu 2 Ringe im kleinen Quadrat.
  const frame = one.filter((r) => Math.max(...r.x) < 150),
    small = one.filter((r) => Math.min(...r.x) > 150);
  assert.equal(small.length, 2);
  assert.equal(frame.length, 5);
  // Nichts im Loch (x 105…115, y 285…295 auf dem Bett mit y nach oben)
  for (const r of frame) for (let i = 0; i < r.x.length; i++) assert.ok(!(r.x[i] > 104.9 && r.x[i] < 115.1 && r.y[i] > 284.9 && r.y[i] < 295.1));
  // Erst eine Insel ganz, dann die andere
  const side = one.map((r) => (Math.max(...r.x) < 150 ? 'a' : 'b')).join('');
  assert.ok(/^a+b+$|^b+a+$/.test(side), side);
  const two = ringsOf((await offsetJob(objs, 1, 2)).moves);
  assert.equal(two.length, 2 * one.length);
});

// ---------- Drehachse ----------

const rotDev = (r: Partial<Rotary>, extra: Partial<Device> = {}): Device => ({ ...newDevice({ fw: 'fluidnc' }), ...extra, rotary: { ...DEFAULT_ROTARY, enabled: true, ...r } });
const moveLines = (lines: string[]) => lines.filter((l) => /^G[01]\b|^[XYAZ]/.test(l));

await test('Drehachse am Y-Anschluss: Y gestreckt, Vorschub auf der Oberfläche gleich', () => {
  // Walze Ø 10 mm, 20π mm Achsweg je Umdrehung: 1 mm Oberfläche = 2 mm Y
  const d = rotDev({ kind: 'roller', axis: 'Y', rollerDiam: 10, perRev: 20 * Math.PI });
  const mv = sampleMoves();
  const g = writeGCode(jobOf(mv), d, estimate(mv, d)).lines;
  assert.deepEqual(moveLines(g), ['G0 X10 Y0', 'G1 X20 S500 F1000', 'Y20 F2000', 'G0 X0 Y0']);
  assert.ok(!g.some((l) => l.startsWith('G92')));
});

await test('Drehachse aus: G-Code unverändert', () => {
  const d = rotDev({ kind: 'roller', axis: 'A', rollerDiam: 10, perRev: 360 }, {});
  d.rotary.enabled = false;
  const mv = sampleMoves();
  assert.deepEqual(moveLines(writeGCode(jobOf(mv), d, estimate(mv, d)).lines), ['G0 X10 Y0', 'G1 X20 S500 F1000', 'Y10', 'G0 X0 Y0']);
});

await test('Eigene Achse A mit Futter: Grad statt Y, G92 A0 zu Beginn', () => {
  // Objekt Ø 360/π mm: Umfang 360 mm, also 1 mm = 1°; Start bei Y 50 (aktuelle Position)
  const d = rotDev({ kind: 'chuck', axis: 'A', objectDiam: 360 / Math.PI, perRev: 360 });
  const mv = new Moves(5, 50);
  mv.push(5, 60, 0, 0, 1);
  mv.push(15, 60, 600, 1, 1);
  mv.push(15, 40, 600, 1, 1);
  mv.push(5, 50, 0, 0, -1);
  const g = writeGCode(jobOf(mv), d, estimate(mv, d)).lines;
  const k = g.indexOf('G21');
  assert.deepEqual(g.slice(k, k + 4), ['G21', 'G90', 'G92 A0', 'M4 S0']);
  assert.deepEqual(moveLines(g), ['G0 X5 A10', 'G1 X15 S1000 F600', 'A-10', 'G0 X5 A0']);
  assert.ok(!moveLines(g).some((l) => /Y/.test(l)));
});

await test('Drehrichtung umkehren spiegelt um den Startpunkt', () => {
  const d = rotDev({ kind: 'chuck', axis: 'Y', objectDiam: 100 / Math.PI, perRev: 100, mirror: true });
  const mv = new Moves(0, 50);
  mv.push(0, 60, 0, 0, 1);
  const g = moveLines(writeGCode(jobOf(mv), d, estimate(mv, d)).lines);
  assert.deepEqual(g, ['G0 X0 Y40']);
});

await test('Rahmen mit Drehachse fährt zum Start zurück', () => {
  const d = rotDev({ kind: 'chuck', axis: 'A', objectDiam: 360 / Math.PI, perRev: 360 });
  const job = { ...jobOf(new Moves(0, 0)), bounds: { x0: 10, y0: 0, x1: 20, y1: 5 } };
  const g = frameGCode(job, d, false)!;
  assert.deepEqual(g.slice(0, 3), ['G21', 'G90', 'G92 A0']);
  assert.ok(g.includes('G1 X20 A0 S0 F3000'), g.join('\n'));
  assert.ok(g.includes('G1 X20 A5'), g.join('\n'));
  assert.equal(g[g.length - 2], 'G0 X0 A0');
  // Ohne Drehachse wie bisher
  const g0 = frameGCode(job, newDevice({ fw: 'fluidnc' }), false)!;
  assert.deepEqual(g0, ['G21', 'G90', 'G0 X10 Y0', 'G1 X20 Y0 S0 F3000', 'G1 X20 Y5', 'G1 X10 Y5', 'G1 X10 Y0', 'M5']);
});

await test('Verfahren und Testdrehung auf der Drehachse', () => {
  const d = rotDev({ kind: 'roller', axis: 'A', rollerDiam: 20, objectDiam: 80, perRev: 360 });
  // 1 mm Oberfläche = 360 / (20π) °
  assert.deepEqual(jogLines(d, 0, 20 * Math.PI, 1000), ['$J=G91 G21 A360 F' + Math.round((1000 * 360) / (20 * Math.PI))]);
  // Objekt Ø 80 auf Walze Ø 20: eine Objektumdrehung = vier Walzenumdrehungen
  assert.match(rotaryTestLines(d)[0], /^\$J=G91 G21 A1440 F/);
  assert.deepEqual(jogLines(newDevice({ fw: 'marlin' }), 0, 5, 1000), ['G91', 'G0 Y5 F1000', 'G90']);
});

await test('Warnung, wenn der Job höher ist als der Objektumfang', async () => {
  const objs: Obj[] = [{ id: 1, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 20, h: 100, r: 0 } as never }];
  const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
  const job = (od: number) => buildJob({ doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device: rotDev({ objectDiam: od }) });
  assert.equal((await job(20)).warnings.length, 1);
  assert.equal((await job(40)).warnings.length, 0);
});

// Becher mit Futter auf A: links Umfang 360 mm (1 mm = 1°), rechts 180 mm (1 mm = 2°), Job X 0 … 100, Mitte Y 10
const cup = (r: Partial<Rotary> = {}) => rotDev({ kind: 'chuck', axis: 'A', perRev: 360, taper: true, taperLeft: 360 / Math.PI, taperRight: 180 / Math.PI, ...r });
const cupJob = (mv: Moves) => ({ ...jobOf(mv), bounds: { x0: 0, y0: 0, x1: 100, y1: 20 } });
/** Sollwert auf A: (y − Mitte) · 360 / Umfang an der Stelle x */
const cupA = (x: number, y: number) => ((y - 10) * 360) / (360 - 1.8 * x);

await test('Konisch: Achsweg hängt vom Durchmesser an der Stelle ab, Mitte in Y bleibt gerade', () => {
  const d = cup();
  const mv = new Moves(0, 10);
  mv.push(100, 10, 600, 1, 1);
  mv.push(0, 20, 0, 0, 1);
  mv.push(100, 20, 600, 1, 1);
  const est = estimate(mv, d);
  const r = rotaryMoves(mv, d, cupJob(mv).bounds, est.t);
  // Mittellinie: ein einziges Stück auf A0
  assert.deepEqual([r.mv.x[0], r.mv.y[0]], [100, 0]);
  assert.deepEqual([r.mv.x[1], r.mv.y[1]], [0, 10]);
  // Linie am Rand: unterteilt, jeder Punkt auf der Sollkurve, Ende bei 20°
  assert.ok(r.mv.n > 5, String(r.mv.n));
  for (let i = 2; i < r.mv.n; i++) assert.ok(Math.abs(r.mv.y[i] - cupA(r.mv.x[i], 20)) < 1e-9);
  assert.ok(Math.abs(r.mv.y[r.mv.n - 1] - 20) < 1e-9);
  // Zwischen den Stützpunkten weicht die Gerade höchstens 0,01 mm auf der Oberfläche ab
  for (let i = 3; i < r.mv.n; i++) {
    const mx = (r.mv.x[i - 1] + r.mv.x[i]) / 2,
      soll = cupA(mx, 20),
      ist = (r.mv.y[i - 1] + r.mv.y[i]) / 2;
    assert.ok((Math.abs(soll - ist) * (360 - 1.8 * mx)) / 360 <= 0.0100001);
  }
  // Zeiten wurden mit aufgeteilt
  assert.equal(r.t!.length, r.mv.n);
  assert.equal(r.t![r.mv.n - 1], est.t[mv.n - 1]);
  for (let i = 1; i < r.mv.n; i++) assert.ok(r.t![i] >= r.t![i - 1]);
  const g = writeGCode(cupJob(mv), d, est).lines;
  assert.ok(g.some((l) => /^; (Konisch|Tapered):/.test(l)), g.slice(0, 9).join('\n'));
  assert.ok(g.some((l) => /^X100 A20( F\d+)?$/.test(l)), g.join('\n'));
});

await test('Konisch mit Walzen: am dicken Ende wie ohne Ausgleich', () => {
  // Walze Ø 10, 360° je Umdrehung; dickes Ende rechts
  const plain = rotDev({ kind: 'roller', axis: 'A', rollerDiam: 10, perRev: 360 });
  const d = rotDev({ ...plain.rotary, taper: true, taperLeft: 50, taperRight: 100 });
  const mv = new Moves(100, 10);
  mv.push(100, 20, 600, 1, 1);
  mv.push(0, 20, 0, 0, 1);
  const a = rotaryMoves(mv, plain).mv,
    b = rotaryMoves(mv, d, cupJob(mv).bounds).mv;
  assert.ok(Math.abs(a.y[0] - b.y[0]) < 1e-9);
  // Am dünnen Ende (halber Durchmesser) dreht die Walze doppelt so weit
  assert.ok(Math.abs(b.y[1] - 2 * a.y[0]) < 1e-9);
});

await test('Konisch aus oder ohne Drehachse: Ausgabe unverändert', () => {
  const mv = sampleMoves();
  const off = writeGCode(jobOf(mv), rotDev({ kind: 'chuck', axis: 'A', objectDiam: 360 / Math.PI, perRev: 360 }), estimate(mv, newDevice({ fw: 'fluidnc' }))).lines;
  const d = rotDev({ kind: 'chuck', axis: 'A', objectDiam: 360 / Math.PI, perRev: 360, taper: false, taperLeft: 10, taperRight: 90 });
  assert.deepEqual(writeGCode(jobOf(mv), d, estimate(mv, d)).lines.slice(4), off.slice(4));
  const none = { ...newDevice({ fw: 'fluidnc' }), rotary: { ...DEFAULT_ROTARY, taper: true } };
  assert.equal(rotaryMoves(mv, none).mv, mv);
});

await test('Konisch: Umfang-Warnung richtet sich nach dem dünneren Rand', async () => {
  const objs: Obj[] = [{ id: 1, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 20, h: 100, r: 0 } as never }];
  const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
  const device = rotDev({ objectDiam: 40, taper: true, taperLeft: 40, taperRight: 30 });
  const job = await buildJob({ doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device });
  assert.equal(job.warnings.length, 1);
});

await test('Arbeitsbereich: Benutzer-Ursprung mit gemeldetem Nullpunkt wird geprüft', () => {
  const bed = { w: 400, h: 400 };
  const d = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'user' as const };
  const tb = { x0: -1, y0: 0, x1: 99, y1: 50 };
  // Ursprung unbekannt: keine Aussage möglich, nicht stillschweigend „passt“
  assert.deepEqual(checkBed(tb, bed, d, null), { kind: 'unknown' });
  assert.equal(checkBed(tb, bed, d, { x: 100, y: 100 }).kind, 'ok');
  const out = checkBed(tb, bed, d, { x: 350, y: 100 });
  assert.equal(out.kind, 'out');
  assert.deepEqual(out.kind === 'out' && out.box, { x0: 349, y0: 100, x1: 449, y1: 150 });
  // Ohne gemeldeten Nullpunkt bleibt es bei „Absolut“ beim Bett in Werkstückkoordinaten
  const abs = { ...d, startFrom: 'absolute' as const };
  assert.equal(checkBed({ x0: 0, y0: 0, x1: 400, y1: 400 }, bed, abs, null).kind, 'ok');
  assert.equal(checkBed({ x0: 0, y0: 0, x1: 400, y1: 400 }, bed, abs, { x: 10, y: 0 }).kind, 'out');
  assert.equal(checkBed(null, bed, d, null).kind, 'ok');
});

await test('Statusbericht: Werkstück-Nullpunkt erst bekannt, wenn die Steuerung ihn meldet', () => {
  const wco: WorkOffset = { v: [0, 0, 0], known: false };
  const empty = emptyStatus();
  let st = parseStatus('<Idle|MPos:150.000,120.000,0.000|FS:0,0>', empty, wco);
  assert.equal(wco.known, false);
  st = parseStatus('<Idle|MPos:150.000,120.000,0.000|FS:0,0|WCO:100.000,80.000,0.000>', st, wco);
  assert.equal(wco.known, true);
  assert.deepEqual(st.wpos, [50, 40, 0]);
  // Smoothieware meldet MPos und WPos zugleich
  const w2: WorkOffset = { v: [0, 0, 0], known: false };
  parseStatus('<Idle|MPos:30.000,20.000,0.000|WPos:10.000,5.000,0.000>', empty, w2);
  assert.deepEqual(w2, { v: [20, 15, 0], known: true });
});

// ---------- Erweiterte Schnitt-Einstellungen ----------

const cutJob = (objs: Obj[], patch: Partial<Layer>, dev: Partial<Device> = {}) =>
  buildJob({
    doc: loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} }),
    layer: (i: number) => normalizeLayer({ ...defaultLayer(i), mode: 'line' as const, speed: 600, power: 80, ...patch }),
    imgLayer: () => defaultImageLayer(),
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false, optimize: false, ...dev },
  });
const square = (x = 100, y = 100, w = 10, id = 1): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer: 1, shape: { kind: 'rect', w, h: w, r: 0 } as never });
const hLine = (): Obj => ({ id: 9, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [{ closed: false, nodes: [{ x: 100, y: 200 }, { x: 110, y: 200 }] }] } });
/** Längen der Strecken mit und ohne Laser */
function lengths(mv: Moves) {
  let on = 0,
    off = 0,
    px = mv.x0,
    py = mv.y0;
  for (let i = 0; i < mv.n; i++) {
    const l = Math.hypot(mv.x[i] - px, mv.y[i] - py);
    if (mv.f[i] > 0) {
      if (mv.s[i] > 0) on += l;
      else off += l;
    }
    px = mv.x[i];
    py = mv.y[i];
  }
  return { on, off };
}

await test('Perforation: 1 mm schneiden, 0,5 mm Lücke', async () => {
  const job = await cutJob([hLine()], { perf: { enabled: true, on: 1, off: 0.5 } });
  const { on, off } = lengths(job.moves);
  // 10 mm: 7 Striche (6×1 mm + Rest 0,5 mm … ) – Summe muss stimmen, Ende ohne Laser fällt weg
  assert.ok(Math.abs(on - 7) < 1e-6, `on ${on}`);
  assert.ok(Math.abs(off - 3) < 1e-6, `off ${off}`);
  const g = writeGCode(job, newDevice({ fw: 'fluidnc' }), estimate(job.moves, newDevice({ fw: 'fluidnc' }))).lines;
  assert.ok(g.some((l) => / S0\b/.test(l)));
});

await test('Überschnitt: der Kontur 3 mm über den Start hinaus folgen', async () => {
  const plain = lengths((await cutJob([square()], {})).moves).on;
  const over = lengths((await cutJob([square()], { lead: { leadIn: false, leadOut: false, length: 2, angle: 90, arc: false, overcut: 3 } })).moves).on;
  assert.ok(Math.abs(plain - 40) < 1e-6);
  assert.ok(Math.abs(over - 43) < 1e-6, `over ${over}`);
});

await test('Anschnitt außen bei Außenkonturen, innen bei Löchern', async () => {
  const frame: Obj = {
    id: 1, m: [1, 0, 0, 1, 0, 0], layer: 1,
    shape: { kind: 'path', subs: [
      { closed: true, nodes: [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 140 }, { x: 100, y: 140 }] },
      { closed: true, nodes: [{ x: 110, y: 110 }, { x: 130, y: 110 }, { x: 130, y: 130 }, { x: 110, y: 130 }] },
    ] },
  };
  const job = await cutJob([frame], { lead: { leadIn: true, leadOut: true, length: 2, angle: 90, arc: false, overcut: 0 } });
  const mv = job.moves;
  // Eilfahrten = Anfang jedes Anschnitts
  const starts: [number, number][] = [];
  for (let i = 0; i < mv.n; i++) if (mv.f[i] === 0) starts.push([mv.x[i], mv.y[i]]);
  assert.equal(starts.length, 2);
  // Bett: y nach oben (400 − y). Außen 100…140 → x/y außerhalb, Loch 110…130 → innerhalb
  const inside = (p: [number, number], lo: number, hi: number) => p[0] >= lo && p[0] <= hi && p[1] >= 400 - hi && p[1] <= 400 - lo;
  const outer = starts.find((p) => !inside(p, 100, 140))!;
  const hole = starts.find((p) => inside(p, 110, 130) && (p[0] > 110 || p[1] < 290) && (p[0] < 130 || p[1] > 270))!;
  assert.ok(outer, `Außenkontur: ${starts}`);
  assert.ok(hole, `Loch: ${starts}`);
  // Länge: 160 + 80 Konturen + 4 × 2 mm Anschnitt/Auslauf
  assert.ok(Math.abs(lengths(mv).on - 248) < 1e-6, `${lengths(mv).on}`);
});

await test('Anschnitt als Bogen hat die eingestellte Länge', async () => {
  const job = await cutJob([square()], { lead: { leadIn: true, leadOut: false, length: 3, angle: 45, arc: true, overcut: 0 } });
  const on = lengths(job.moves).on;
  // Bogen aus Sehnen: etwas kürzer als 3 mm
  assert.ok(on > 42.99 && on <= 43 + 1e-9, `on ${on}`);
});

await test('Leistungsrampe: Ecken mit Min. Leistung, nach 1 mm volle Leistung', async () => {
  const job = await cutJob([square()], { minPower: 20, ramp: { enabled: true, length: 1, angle: 45, ends: false } });
  const mv = job.moves;
  let lo = 1,
    hi = 0;
  for (let i = 0; i < mv.n; i++)
    if (mv.f[i] > 0) {
      lo = Math.min(lo, mv.s[i]);
      hi = Math.max(hi, mv.s[i]);
    }
  assert.ok(lo < 0.25 && lo >= 0.2, `lo ${lo}`);
  assert.ok(Math.abs(hi - 0.8) < 1e-6, `hi ${hi}`);
  // Länge bleibt gleich
  assert.ok(Math.abs(lengths(mv).on - 40) < 1e-6);
  // Gerade Linie ohne Ecken: keine Rampe (außer an den Enden, wenn gewünscht)
  const line = (await cutJob([hLine()], { minPower: 20, ramp: { enabled: true, length: 1, angle: 45, ends: false } })).moves;
  for (let i = 0; i < line.n; i++) if (line.f[i] > 0) assert.ok(Math.abs(line.s[i] - 0.8) < 1e-6);
  const ends = (await cutJob([hLine()], { minPower: 20, ramp: { enabled: true, length: 1, angle: 45, ends: true } })).moves;
  assert.ok(Math.abs(ends.s[1] - 0.8) > 0.1);
});

await test('Z je Durchgang: relativ tiefer, am Ende zurück', async () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), zAxis: true, startFrom: 'absolute' as const, returnHome: false };
  const job = await cutJob([square()], { passes: 3, zOffset: 0.5, zStep: 1 }, d);
  assert.deepEqual(job.warnings, []);
  const g = writeGCode(job, d, estimate(job.moves, d)).lines;
  const zs = g.filter((l) => /Z/.test(l));
  assert.deepEqual(zs, ['G0 Z-0.5', 'G0 Z-1', 'G0 Z-1', 'G0 Z2.5']);
  // Nach jeder Z-Zeile G90 und dann wieder ein vollständiger Bewegungsbefehl
  const k = g.indexOf('G0 Z-1');
  assert.deepEqual(g.slice(k - 1, k + 2), ['G91', 'G0 Z-1', 'G90']);
  assert.ok(/^G[01] /.test(g[k + 2]));
  // Umgekehrte Richtung
  const gf = writeGCode(job, { ...d, zFlip: true }, estimate(job.moves, d)).lines.filter((l) => /Z/.test(l));
  assert.deepEqual(gf, ['G0 Z0.5', 'G0 Z1', 'G0 Z1', 'G0 Z-2.5']);
  // Ohne Z-Achse: Hinweis, kein Z
  const none = await cutJob([square()], { passes: 2, zStep: 1 });
  assert.equal(none.warnings.length, 1);
  const dn = newDevice({ fw: 'fluidnc' });
  assert.ok(!writeGCode(none, dn, estimate(none.moves, dn)).lines.some((l) => /Z/.test(l)));
});

await test('Z bleibt bei Start Here erhalten', async () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), zAxis: true };
  const job = await cutJob([square()], { passes: 2, zStep: 1 }, d);
  const k = job.moves.n - 2;
  const mv = startHere(job.moves, k, 0.5);
  const g = writeGCode({ ...job, moves: mv }, d, estimate(mv, d)).lines.filter((l) => /Z/.test(l));
  assert.deepEqual(g, ['G0 Z-1', 'G0 Z1']);
});

await test('Sub-Layer: erst füllen, dann ausschneiden; ausgeschaltete Sub-Layer fehlen', async () => {
  const sub = [
    { ...defaultSubLayer('line'), speed: 300, power: 90 },
    { ...defaultSubLayer('line'), speed: 100, power: 10, output: false },
  ];
  const job = await cutJob([square()], { mode: 'fill', speed: 3000, power: 30, interval: 1, sub });
  const mv = job.moves;
  const feeds = new Set<number>();
  for (let i = 0; i < mv.n; i++) if (mv.f[i] > 0 && mv.s[i] > 0) feeds.add(mv.f[i]);
  assert.deepEqual([...feeds], [3000, 300]);
  // Ausschnitt kommt zuletzt und ist 40 mm lang
  let cut = 0;
  for (let i = 1; i < mv.n; i++) if (mv.f[i] === 300 && mv.s[i] > 0) cut += Math.hypot(mv.x[i] - mv.x[i - 1], mv.y[i] - mv.y[i - 1]);
  assert.ok(Math.abs(cut - 40) < 1e-6);
  assert.equal(mv.f[mv.n - 1], 300);
});

await test('Laser zur Klickposition: absolutes Verfahren je Firmware', () => {
  assert.deepEqual(jogToLines(newDevice({ fw: 'fluidnc' }), 12.5, 30, 3000), ['$J=G90 G21 X12.5 Y30 F3000']);
  assert.deepEqual(jogToLines(newDevice({ fw: 'grbl' }), 1, null, 1500), ['$J=G90 G21 X1 F1500']);
  assert.deepEqual(jogToLines(newDevice({ fw: 'marlin' }), 5, 6, 3000), ['G90', 'G0 X5 Y6 F3000']);
});

// ---------- Parked parts and parts that are not lasered ----------

const sqObj = (id: number, x: number, y: number, extra: Partial<Obj> = {}): Obj => ({
  id, m: [1, 0, 0, 1, x, y], layer: 1, shape: { kind: 'rect', w: 20, h: 20, r: 0 }, ...extra,
});
const lineJob = (objs: Obj[], startFrom: Device['startFrom'] = 'absolute') =>
  buildJob({
    doc: loadDoc({ bed: { w: 200, h: 200 }, objs, layers: {} }),
    layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }),
    imgLayer: () => defaultImageLayer(),
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom },
  });

await test('Teil ganz außerhalb des Arbeitsbereichs ist geparkt: nicht gelasert, Hinweis statt Warnung', async () => {
  for (const startFrom of ['absolute', 'user'] as const) {
    const job = await lineJob([sqObj(1, 10, 10), sqObj(2, 260, 10), sqObj(3, 10, -50)], startFrom);
    assert.ok(job.bounds, startFrom);
    assert.ok(job.bounds!.x1 - job.bounds!.x0 <= 20 + 1e-6 && job.bounds!.y1 - job.bounds!.y0 <= 20 + 1e-6, `${startFrom}: ${JSON.stringify(job.bounds)}`);
    assert.equal(job.warnings.length, 1);
    assert.match(job.warnings[0], /2/);
  }
  // Partly outside: not parked
  const job = await lineJob([sqObj(1, 10, 10), sqObj(2, 190, 10)]);
  assert.ok(job.bounds!.x1 > 205, JSON.stringify(job.bounds));
  assert.equal(job.warnings.length, 0);
});

await test('Liegt alles außerhalb, wird nichts geparkt (die Bereichsprüfung meldet es)', async () => {
  const job = await lineJob([sqObj(1, 300, 10), sqObj(2, 340, 10)]);
  assert.ok(job.bounds && job.bounds.x0 >= 299, JSON.stringify(job.bounds));
  assert.equal(job.warnings.length, 0);
});

await test('„Nicht lasern“ je Objekt, auch für Gruppen', async () => {
  const group: Obj = { id: 5, m: [1, 0, 0, 1, 0, 0], layer: 1, noLaser: true, shape: { kind: 'group', children: [sqObj(6, 100, 100), sqObj(7, 150, 150)] } };
  const job = await lineJob([sqObj(1, 10, 10), sqObj(2, 50, 10, { noLaser: true }), group]);
  assert.ok(job.bounds!.x1 <= 30 + 1e-6, JSON.stringify(job.bounds));
  // Nothing parked: the excluded objects do not count
  assert.equal(job.warnings.length, 0);
  const none = await lineJob([sqObj(1, 10, 10, { noLaser: true })]);
  assert.equal(none.moves.n, 0);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
