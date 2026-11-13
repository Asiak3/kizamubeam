// Tests der Maschinenausgabe: Start-/End-Skripte, „Start Here“, Vorschau gegen Job. Aufruf: npm run test:gcode
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, burns, checkBed, DEFAULT_ROTARY, Device, estimate, frameGCode, gcodeFooter, jogLines, jogToLines, Moves, newDevice, Rotary, rotaryMoves, rotaryTestLines, sameMoves, startHere, writeGCode } from '../src/gcode';
import { emptyStatus, parseStatus, WorkOffset } from '../src/machine';
import { defaultImageLayer, defaultLayer, imageOutput, defaultSubLayer, Layer, loadDoc, normalizeLayer, Obj } from '../src/model';
import { dedupPolys } from '../src/dedup';

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
    const device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, optInnerFirst: true, optTravel: true, returnHome: false };
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

// Issue #148: a start point set on a contour must survive the kerf offset, in the preview and in the job
const firstRapid = (mv: Moves) => [Math.round(mv.x[0] * 100) / 100, Math.round(mv.y[0] * 100) / 100];
/** Direction of the first contour: sign of the shoelace area of the burning moves after the first rapid */
function firstContourArea(mv: Moves) {
  const xs = [mv.x[0]],
    ys = [mv.y[0]];
  for (let i = 1; i < mv.n && mv.f[i] !== 0; i++) (xs.push(mv.x[i]), ys.push(mv.y[i]));
  let a = 0;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    a += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return a / 2;
}
for (const kerf of [0, 0.2, -0.2]) {
  await test(`Startpunkt gesetzt, Kerf ${kerf}: Vorschau und Job beginnen am gesetzten Knoten`, async () => {
    const corners = [{ x: 100, y: 300 }, { x: 120, y: 300 }, { x: 120, y: 320 }, { x: 100, y: 320 }];
    const jobAt = async (idx: number | null, reverse = false) => {
      const sp: { closed: boolean; nodes: { x: number; y: number }[]; start?: boolean } = { closed: true, nodes: corners.map((p) => ({ ...p })) };
      if (idx !== null) {
        sp.nodes = sp.nodes.slice(idx).concat(sp.nodes.slice(0, idx));
        if (reverse) sp.nodes = [sp.nodes[0], ...sp.nodes.slice(1).reverse()];
        sp.start = true;
      }
      const doc = loadDoc({ bed: { w: 400, h: 400 }, objs: [{ id: 1, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [sp] } }], layers: {} });
      const device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, optInnerFirst: true, optTravel: true, returnHome: false };
      const inp = { doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const, kerf }), imgLayer: () => defaultImageLayer(), device };
      const prev = await buildJob({ ...inp, forPreview: true });
      const real = await buildJob(inp);
      assert.ok(sameMoves(prev.moves, real.moves, real.offset), 'preview and job differ');
      return real.moves;
    };
    // Machine Y is flipped (bed 400): node (120, 320) → (120, 80), node (100, 300) → (100, 100)
    const free = await jobAt(null);
    const near = await jobAt(2);
    const far = await jobAt(0);
    const fx = firstRapid(far),
      nx = firstRapid(near);
    assert.ok(Math.hypot(nx[0] - 120, nx[1] - 80) <= Math.abs(kerf) * 1.5 + 1e-6, `near start ${nx}`);
    assert.ok(Math.hypot(fx[0] - 100, fx[1] - 100) <= Math.abs(kerf) * 1.5 + 1e-6, `far start ${fx}`);
    assert.notDeepEqual(fx, firstRapid(free), 'changing the start point changes the rapid move');
    // Direction is kept, and reversing it flips the contour orientation
    const rev = await jobAt(0, true);
    assert.deepEqual(firstRapid(rev), fx);
    assert.ok(Math.sign(firstContourArea(rev)) === -Math.sign(firstContourArea(far)), 'reversed direction');
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
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false, optInnerFirst: false, optTravel: false, ...dev },
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

await test('Durchgänge laufen pro Bearbeitung: erst Sub1 fertig, dann Sub2 (#218)', async () => {
  const sub = [
    { ...defaultSubLayer('line'), speed: 600, power: 80, passes: 2 },
    { ...defaultSubLayer('line'), speed: 1200, power: 80, passes: 1 },
  ];
  const job = await cutJob([square()], { mode: 'line', speed: 900, power: 80, passes: 1, sub });
  const mv = job.moves;
  // Brennstrecken gruppieren: Layer (900), dann Sub1 zweimal (600), dann Sub2 (1200) — kein globaler Repeat
  const groups: number[] = [];
  for (let i = 0; i < mv.n; i++) {
    if (mv.f[i] > 0 && mv.s[i] > 0) {
      if (!groups.length || groups[groups.length - 1] !== mv.f[i]) groups.push(mv.f[i]);
    }
  }
  assert.deepEqual(groups, [900, 600, 1200]);
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
  const job0 = await lineJob([sqObj(1, 10, 10), sqObj(2, 260, 10), sqObj(3, 10, -50)]);
  assert.ok(job0.bounds!.x1 - job0.bounds!.x0 <= 20 + 1e-6 && job0.bounds!.y1 - job0.bounds!.y0 <= 20 + 1e-6, JSON.stringify(job0.bounds));
  assert.equal(job0.warnings.length, 1);
  assert.match(job0.warnings[0], /2/);
  // Relative to the user origin the bed position does not matter: everything is lasered as before
  const rel = await lineJob([sqObj(1, 10, 10), sqObj(2, 260, 10), sqObj(3, 10, -50)], 'user');
  assert.ok(rel.bounds!.x1 - rel.bounds!.x0 > 200, JSON.stringify(rel.bounds));
  assert.equal(rel.warnings.length, 0);
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

await test('Images use speed, power, passes, interval, direction and overscan of their layer; older files move image values into image-only layers', () => {
  const img = (layer: number): Obj => ({ id: 900 + layer, m: [1, 0, 0, 1, 0, 0], layer, shape: { kind: 'image', asset: 'a', w: 10, h: 10, pxW: 10, pxH: 10, adjust: { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, sharpenRadius: 1, denoise: 0 } } } as Obj);
  const legacy = { ...defaultImageLayer(), speed: 1800, power: 42, minPower: 5, passes: 2, interval: 0.2, bidirectional: false, overscan: 5, dither: 'floyd' };
  const doc = loadDoc({
    version: 2, bed: { w: 400, h: 400 }, page: 0,
    pages: [{ name: 'P', objs: [img(0), img(1), { ...sqObj(1, 0, 0), layer: 1 }] }],
    layers: {
      0: { ...defaultLayer(0), speed: 1000, power: 60, img: legacy },
      1: { ...defaultLayer(1), speed: 300, power: 95, img: legacy },
    },
  });
  // Image-only layer: the old image values become the layer's values
  const L0 = doc.layers[0];
  assert.deepEqual([L0.speed, L0.power, L0.minPower, L0.passes, L0.interval, L0.bidirectional, L0.overscan], [1800, 42, 5, 2, 0.2, false, 5]);
  // Layer with vectors: the layer's values win
  assert.deepEqual([doc.layers[1].speed, doc.layers[1].power, doc.layers[1].interval, doc.layers[1].bidirectional], [300, 95, 0.1, true]);
  for (const L of [doc.layers[0], doc.layers[1]]) {
    assert.equal(L.img!.speed, undefined);
    assert.equal(L.img!.interval, undefined);
    assert.equal(L.img!.dither, 'floyd');
  }
  const out = imageOutput(normalizeLayer(doc.layers[1]));
  assert.deepEqual([out.speed, out.power, out.passes, out.interval, out.overscan, out.dither], [300, 95, 1, 0.1, 2.5, 'floyd']);
  // Loading again does not move anything (the legacy fields are gone)
  doc.layers[0].speed = 700;
  assert.equal(loadDoc(JSON.parse(JSON.stringify(doc))).layers[0].speed, 700);
});

// ---------- Doppelte Linien beim Export (Issue #221) ----------

await test('Dedup aus (Standard): identische Quadrate werden zweimal geschnitten', async () => {
  const job = await cutJob([square(100, 100, 10, 1), square(100, 100, 10, 2)], {});
  const { on } = lengths(job.moves);
  assert.ok(Math.abs(on - 80) < 0.5, `on=${on}`);
  assert.equal(job.dedup?.length ?? 0, 0);
  assert.equal(job.warnings.length, 0);
});

await test('Dedup an: identisches Quadrat nur einmal, Warnung + Markierung', async () => {
  const job = await cutJob([square(100, 100, 10, 1), square(100, 100, 10, 2)], { dedup: true, dedupTol: 0.05 });
  const { on } = lengths(job.moves);
  assert.ok(Math.abs(on - 40) < 0.5, `on=${on}`);
  assert.equal(job.warnings.length, 1);
  assert.ok((job.dedup?.[0].len ?? 0) > 39, JSON.stringify(job.dedup?.[0]?.len));
  assert.ok((job.dedup?.[0].lines.length ?? 0) >= 1);
});

await test('Dedup an: Teilüberlappung (5 mm Kante) wird einmal abgezogen', async () => {
  const objs = [square(100, 100, 10, 1), square(105, 100, 10, 2)];
  const plain = await cutJob(objs, {});
  const ded = await cutJob(objs, { dedup: true, dedupTol: 0.05 });
  const a = lengths(plain.moves),
    b = lengths(ded.moves);
  assert.ok(Math.abs(a.on - 80) < 0.5, `plain on=${a.on}`);
  // obere + untere Kante je 5 mm doppelt
  assert.ok(Math.abs(b.on - 70) < 0.6, `dedup on=${b.on}`);
  assert.equal(ded.warnings.length, 1);
});

await test('Dedup: nur Ecke berührt → kein Abzug', async () => {
  const job = await cutJob([square(100, 100, 10, 1), square(110, 110, 10, 2)], { dedup: true, dedupTol: 0.05 });
  const { on } = lengths(job.moves);
  assert.ok(Math.abs(on - 80) < 0.5, `on=${on}`);
  assert.equal(job.warnings.length, 0);
});

await test('Dedup: layerübergreifend wird nichts zusammengefasst', async () => {
  const o1 = square(100, 100, 10, 1);
  const o2 = { ...square(100, 100, 10, 2), layer: 2 };
  const job = await buildJob({
    doc: loadDoc({ bed: { w: 400, h: 400 }, objs: [o1, o2], layers: {} }),
    layer: (i: number) => normalizeLayer({ ...defaultLayer(i), mode: 'line' as const, speed: 600, power: 80, dedup: true, dedupTol: 0.05 }),
    imgLayer: () => defaultImageLayer(),
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false, optimize: false },
  });
  const { on } = lengths(job.moves);
  assert.ok(Math.abs(on - 80) < 0.5, `on=${on}`);
});

await test('Dedup + Kerf: Teilspannen bleiben (Versatz), ganze Doppel fallen', async () => {
  const objs = [square(100, 100, 10, 1), square(105, 100, 10, 2)];
  const kerfPlain = await cutJob(objs, { kerf: 0.2 });
  const kerfDed = await cutJob(objs, { kerf: 0.2, dedup: true, dedupTol: 0.05 });
  assert.ok(Math.abs(lengths(kerfPlain.moves).on - lengths(kerfDed.moves).on) < 0.5, 'Teil bleibt bei Kerf');
  // ganze Doppel fallen trotz Kerf
  const fullPlain = await cutJob([square(100, 100, 10, 1), square(100, 100, 10, 2)], { kerf: 0.2 });
  const fullDed = await cutJob([square(100, 100, 10, 1), square(100, 100, 10, 2)], { kerf: 0.2, dedup: true, dedupTol: 0.05 });
  assert.ok(lengths(fullDed.moves).on < lengths(fullPlain.moves).on - 30, 'ganz fällt bei Kerf');
});

await test('Dedup: Fix-Start wandert auf die überlebende Kontur', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const r = dedupPolys(
    [{ pts: pts.map((p) => ({ ...p })), closed: true }, { pts: pts.map((p) => ({ ...p })), closed: true, fixed: true }],
    0.05,
  );
  assert.equal(r.polys.length, 1);
  assert.equal(r.polys[0].fixed, true);
});

// ---------- Kerf-Vertrag (Issue #220) ----------

await test('Kerf: offen läuft ohne Kerf durch + Warnung', async () => {
  const job = await cutJob([hLine(), square()], { kerf: 0.2 });
  assert.ok(job.warnings.some((w) => w.includes('offene Kontur')), JSON.stringify(job.warnings));
});

await test('Kerf-Vertrag: Loch vom Versatz aufgelöst + Warnung', async () => {
  const tiny: Obj = {
    id: 2, m: [1, 0, 0, 1, 0, 0], layer: 1,
    shape: { kind: 'path', subs: [
      { closed: true, nodes: [{ x: 100, y: 100 }, { x: 100.3, y: 100 }, { x: 100.3, y: 100.3 }, { x: 100, y: 100.3 }] },
    ] },
  };
  const job = await cutJob([tiny], { kerf: -0.5 });
  assert.ok(job.warnings.some((w) => w.includes('aufgelöst')), JSON.stringify(job.warnings));
});

await test('Kerf-Vertrag: berührend per Union zusammengefasst + Warnung', async () => {
  const touch: Obj = {
    id: 3, m: [1, 0, 0, 1, 0, 0], layer: 1,
    shape: { kind: 'path', subs: [
      { closed: true, nodes: [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }] },
      { closed: true, nodes: [{ x: 110, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 110 }, { x: 110, y: 110 }] },
    ] },
  };
  const job = await cutJob([touch], { kerf: 0.1 });
  assert.ok(job.warnings.some((w) => w.includes('zusammengefasst')), JSON.stringify(job.warnings));
});

await test('Kerf-Vertrag: Fill kerft Hülle + Warnung, Bild ohne Kerf', async () => {
  const fillJob = await cutJob([square()], { mode: 'fill' as const, kerf: 0.2 });
  assert.ok(fillJob.warnings.some((w) => w.includes('Hüll-Geometrie')), JSON.stringify(fillJob.warnings));
  const img: Obj = { id: 7, m: [1, 0, 0, 1, 100, 100], layer: 1, shape: { kind: 'image', w: 10, h: 10, asset: 'a' } as never };
  const imgJob = await cutJob([img], { kerf: 0.2 });
  assert.ok(!imgJob.warnings.some((w) => w.includes('Kerf-Vertrag')), JSON.stringify(imgJob.warnings));
});

await test('Kerf-Vertrag: Tabs nach Kerf auf kompensierter Kontur', async () => {
  const plain = lengths((await cutJob([square()], { kerf: 0.2 })).moves).on;
  const tabs = lengths((await cutJob([square()], { kerf: 0.2, tabs: { enabled: true, size: 2, useCount: true, count: 2, spacing: 10, skipInner: false } })).moves).on;
  assert.ok(tabs < plain, `tabs ${tabs} < plain ${plain}`);
});
// ---------- Optimizer-Schalter (Issue #222) ----------

/** Ziele der Leerwege (f === 0) in der Reihenfolge des Jobs */
function rapidDests(mv: Moves): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < mv.n; i++) if (mv.f[i] === 0) out.push([Math.round(mv.x[i] * 100) / 100, Math.round(mv.y[i] * 100) / 100]);
  return out;
}
const optDev = (o: { inner: boolean; travel: boolean; group?: boolean }) => ({ optInnerFirst: o.inner, optTravel: o.travel, optGroup: o.group ?? false });

await test('Optimizer: Defaults entsprechen explizit inner-first + travel (Gruppe aus)', async () => {
  const objs = [square(50, 50, 100, 1), square(120, 120, 10, 2)];
  const base = {
    doc: loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} }),
    layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }),
    imgLayer: () => defaultImageLayer(),
  };
  const a = await buildJob({ ...base, device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false } });
  const b = await buildJob({ ...base, device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false, optInnerFirst: true, optTravel: true, optGroup: false } });
  const sig = (mv: Moves) => JSON.stringify([[...mv.x.slice(0, mv.n)], [...mv.y.slice(0, mv.n)], [...mv.f.slice(0, mv.n)], [...mv.s.slice(0, mv.n)]]);
  assert.equal(sig(a.moves), sig(b.moves));
});

await test('Optimizer: Loch vor Hülle mit inner-first, danach ohne', async () => {
  const objs = [square(50, 50, 100, 1), square(120, 120, 10, 2)];
  const inner = await cutJob(objs, {}, optDev({ inner: true, travel: true }));
  assert.deepEqual(rapidDests(inner.moves)[0], [120, 270]);
  const outer = await cutJob(objs, {}, optDev({ inner: false, travel: true }));
  assert.deepEqual(rapidDests(outer.moves)[0], [50, 250]);
  assert.ok(outer.warnings.some((w) => w.includes('Innere Formen zuerst')), JSON.stringify(outer.warnings));
  assert.ok(!inner.warnings.some((w) => w.includes('Innere Formen zuerst')), JSON.stringify(inner.warnings));
});

await test('Optimizer: ohne travel gilt die Dokumentreihenfolge (kein Umdrehen)', async () => {
  const objs = [square(300, 100, 10, 1), square(100, 100, 10, 2)];
  const nn = await cutJob(objs, {}, optDev({ inner: true, travel: true }));
  assert.deepEqual(rapidDests(nn.moves)[0], [100, 290]);
  const doc = await cutJob(objs, {}, optDev({ inner: false, travel: false }));
  assert.deepEqual(rapidDests(doc.moves)[0], [300, 300]);
});

await test('Optimizer: Gruppen zusammenhalten bevorzugt die eigene Gruppe', async () => {
  const g1a: Obj = { id: 11, m: [1, 0, 0, 1, 100, 100], layer: 1, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as never };
  const g1b: Obj = { id: 12, m: [1, 0, 0, 1, 300, 100], layer: 1, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as never };
  const solo: Obj = { id: 13, m: [1, 0, 0, 1, 110, 100], layer: 1, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as never };
  const grp: Obj = { id: 10, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'group', children: [g1a, g1b] } };
  const objs = [grp, solo];
  const plain = await cutJob(objs, {}, optDev({ inner: true, travel: true }));
  const pxs = rapidDests(plain.moves).map(([x]) => x);
  assert.ok(pxs[0] >= 95 && pxs[0] <= 105 && pxs[1] >= 105 && pxs[1] <= 125 && pxs[2] >= 295, JSON.stringify(pxs));
  const grouped = await cutJob(objs, {}, optDev({ inner: true, travel: true, group: true }));
  const gxs = rapidDests(grouped.moves).map(([x]) => x);
  assert.ok(gxs[0] >= 95 && gxs[0] <= 105 && gxs[1] >= 295 && gxs[2] >= 105 && gxs[2] <= 125, JSON.stringify(gxs));
});

await test('Optimizer: gesetzter Startpunkt bleibt in allen Kombinationen', async () => {
  const nodes = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const fixed: Obj = { id: 20, m: [1, 0, 0, 1, 300, 100], layer: 1, shape: { kind: 'path', subs: [{ closed: true, nodes, start: true }] } };
  for (const combo of [{ inner: true, travel: true }, { inner: true, travel: false }, { inner: false, travel: true }, { inner: false, travel: false }]) {
    const job = await cutJob([fixed], {}, optDev(combo));
    assert.deepEqual(rapidDests(job.moves)[0], [300, 300], JSON.stringify(combo));
  }
});

await test('Optimizer: lbrn2-CutOptimize wird toleriert gelesen und gemeldet', async () => {
  const { convertLbrn } = await import('../src/lbrn');
  const xml = `<LightBurnProject><CutSetting type="Cut"><index Value="0"/></CutSetting><CutOptimize><InnerFirst Value="1"/><ReduceTravelMoves Value="0"/></CutOptimize></LightBurnProject>`;
  const res = await convertLbrn(xml, { bedH: 400, assetId: async () => 'a' });
  assert.deepEqual(res.optimizer, { innerFirst: true, travel: false, group: undefined });
  assert.equal(res.notes.length, 1);
  assert.match(res.notes[0], /Optimierer/);
});
// Issue #217: Sichtbarkeit vs. Ausgabe — output entscheidet, show nur Anzeige
const selJob = (objs: Obj[], layerPatch: Partial<Layer> = {}) =>
  buildJob({
    doc: loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} }),
    layer: (i: number) => normalizeLayer({ ...defaultLayer(i), mode: 'line' as const, ...layerPatch }),
    imgLayer: () => defaultImageLayer(),
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, optimize: false, returnHome: false },
  });
const selRect = (id: number, x: number, extra: Partial<Obj> = {}): Obj => ({
  id, m: [1, 0, 0, 1, x, 100], layer: 1, shape: { kind: 'rect', w: 10, h: 10, r: 0 } as never, ...extra,
});

await test('#217: ausgeblendetes Objekt mit Ausgabe nimmt teil + Warnung', async () => {
  const base = await selJob([selRect(1, 100), selRect(2, 200)]);
  const job = await selJob([selRect(1, 100), selRect(2, 200, { hidden: true })]);
  assert.ok(burns(job.moves));
  assert.equal(job.moves.n, base.moves.n);
  assert.ok(job.warnings.some((w) => w.includes('ausgeblendet')), job.warnings.join(' | '));
  assert.ok(!base.warnings.some((w) => w.includes('ausgeblendet')));
  const prev = await buildJob({
    doc: loadDoc({ bed: { w: 400, h: 400 }, objs: [selRect(1, 100), selRect(2, 200, { hidden: true })], layers: {} }),
    layer: (i: number) => normalizeLayer({ ...defaultLayer(i), mode: 'line' as const }),
    imgLayer: () => defaultImageLayer(),
    device: { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, optimize: false, returnHome: false },
    forPreview: true,
  });
  assert.ok(sameMoves(prev.moves, job.moves, job.offset));
});

await test('#217: noLaser und showIf-falsch schließen aus (auch vererbt)', async () => {
  const onlyNoLaser = await selJob([selRect(1, 100, { noLaser: true })]);
  assert.equal(burns(onlyNoLaser.moves), false);
  const onlyShowIf = await selJob([selRect(1, 100, { showIf: 'false' })]);
  assert.equal(burns(onlyShowIf.moves), false);
  const group: Obj = {
    id: 7, m: [1, 0, 0, 1, 0, 0], layer: 1, noLaser: true,
    shape: { kind: 'group', children: [selRect(8, 100), selRect(9, 200)] },
  };
  const grp = await selJob([group]);
  assert.equal(burns(grp.moves), false);
  // showIf wahr und hidden ohne noLaser: nimmt teil
  const vis = await selJob([selRect(1, 100, { showIf: 'true' }), selRect(2, 200, { hidden: true })]);
  assert.ok(burns(vis.moves));
});

await test('#217: output=false schließt aus, Warnung nur bei Ausgabe', async () => {
  const job = await selJob([selRect(1, 100)], { output: false });
  assert.equal(burns(job.moves), false);
  const hiddenNoOut = await selJob([selRect(1, 100, { hidden: true })], { output: false });
  assert.equal(burns(hiddenNoOut.moves), false);
  assert.ok(!hiddenNoOut.warnings.some((w) => w.includes('ausgeblendet')));
});

// ---------- Einheitliche Kontur-Topologie (Issue #219) ----------

const tabbed = (skipInner: boolean): Partial<Layer> => ({ kerf: 0, tabs: { enabled: true, size: 2, useCount: true, count: 2, spacing: 10, skipInner } });
const burnOn = async (objs: Obj[], patch: Partial<Layer>) => lengths((await cutJob(objs, patch)).moves).on;

await test('Topologie: Duplikate — genau eine Form behält die Stege (neu 76, alt 72)', async () => {
  const dup = [square(100, 100, 10, 1), square(100, 100, 10, 2)];
  const both = await burnOn(dup, tabbed(true));
  // neu: Form 0 ist kein Innen (Ident-Regel i<j), Form 1 schon → eine mit, eine ohne Stege
  assert.equal(both, (await burnOn([dup[0]], tabbed(false))) + (await burnOn([dup[1]], {})));
  // alt: beide ohne Stege — dieses Verhalten ist weg
  assert.notEqual(both, 2 * (await burnOn([dup[0]], tabbed(false))));
});

await test('Topologie: eckberührende Innenform verliert die Stege (neu 596, alt 592)', async () => {
  const outer: Obj = { id: 3, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 100, h: 100, r: 0 } as never };
  const corner: Obj = { id: 4, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 50, h: 50, r: 0 } as never };
  const both = await burnOn([outer, corner], tabbed(true));
  // neu: Rahmenmitte liegt innen → Stege entfallen (alt: erster Punkt auf der Kante → Stege blieben)
  assert.equal(both, (await burnOn([outer], tabbed(false))) + (await burnOn([corner], {})));
});

await test('Topologie: normal verschachtelte Form unverändert ohne Stege', async () => {
  const outer: Obj = { id: 3, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 100, h: 100, r: 0 } as never };
  const nested: Obj = { id: 6, m: [1, 0, 0, 1, 80, 80], layer: 1, shape: { kind: 'rect', w: 20, h: 20, r: 0 } as never };
  assert.equal(await burnOn([outer, nested], tabbed(true)), (await burnOn([outer], tabbed(false))) + (await burnOn([nested], {})));
});

await test('Topologie: buildContainment liefert Baum und Even-Odd-Tiefe', async () => {
  const { buildContainment } = await import('../src/polyTopology');
  const polys = [
    { pts: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }], closed: true },
    { pts: [{ x: 80, y: 80 }, { x: 120, y: 80 }, { x: 120, y: 120 }, { x: 80, y: 120 }], closed: true },
    { pts: [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }], closed: true },
  ];
  const { parent, depth } = buildContainment(polys);
  assert.deepEqual([...parent], [-1, 0, 1]);
  assert.deepEqual([...depth], [0, 1, 2]);
  const dup = [
    { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true },
    { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true },
  ];
  const d2 = buildContainment(dup);
  // identische Rahmen: nur eine Richtung zählt (zweite Form liegt in der ersten)
  assert.deepEqual([...d2.parent], [-1, 0]);
  assert.deepEqual([...d2.depth], [0, 1]);
  const open = [
    { pts: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 150 }], closed: true },
    { pts: [{ x: 60, y: 60 }, { x: 70, y: 60 }], closed: false },
  ];
  const d3 = buildContainment(open);
  // offen ist nie Container, kann aber enthalten sein
  assert.deepEqual([...d3.parent], [-1, 0]);
  assert.deepEqual([...d3.depth], [0, 1]);
});

// ---------- Manuelle Schnittreihenfolge (Issue #153) ----------

await test('Manuell: Stapelreihenfolge wird 1:1 gefahren (alle Optimierer-Schalter aus)', async () => {
  const a = square(50, 100, 10, 1);
  const b = square(200, 100, 10, 2);
  // Dokumentreihenfolge [B, A]: manuell beginnt bei B (x≈200), auto beim näheren A (x≈50, Start bei 0,0)
  const man = await cutJob([b, a], {}, { optInnerFirst: false, optTravel: false, optGroup: false });
  const auto = await cutJob([b, a], {}, { optInnerFirst: true, optTravel: true });
  assert.ok(man.moves.x[0] >= 200 && man.moves.x[0] <= 210, `manual first x=${man.moves.x[0]}`);
  assert.ok(auto.moves.x[0] >= 50 && auto.moves.x[0] <= 60, `auto first x=${auto.moves.x[0]}`);
});

await test('Manuell: außen-vor-innen warnt, innen-vor-außen nicht', async () => {
  const outer: Obj = { id: 3, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 100, h: 100, r: 0 } as never };
  const inner: Obj = { id: 4, m: [1, 0, 0, 1, 80, 80], layer: 1, shape: { kind: 'rect', w: 20, h: 20, r: 0 } as never };
  const bad = await cutJob([outer, inner], {}, { optInnerFirst: false, optTravel: false, optGroup: false });
  assert.ok(bad.warnings.some((w) => w.includes('Manuelle Reihenfolge')), JSON.stringify(bad.warnings));
  const good = await cutJob([inner, outer], {}, { optInnerFirst: false, optTravel: false, optGroup: false });
  assert.ok(!good.warnings.some((w) => w.includes('Manuelle Reihenfolge')), JSON.stringify(good.warnings));
  // nur eine Warnung: die grobe Prüfung schweigt bei manueller Reihenfolge
  assert.ok(!good.warnings.some((w) => w.includes('Innere Formen zuerst“ ist aus')), JSON.stringify(good.warnings));
  const auto = await cutJob([outer, inner], {}, { optInnerFirst: true, optTravel: true });
  assert.ok(!auto.warnings.some((w) => w.includes('Manuelle Reihenfolge')), JSON.stringify(auto.warnings));
});

await test('Manuell: gesetzter Startpunkt gilt auch ohne Optimierung', async () => {
  const sp = { closed: true, nodes: [{ x: 100, y: 300 }, { x: 120, y: 300 }, { x: 120, y: 320 }, { x: 100, y: 320 }], start: true };
  const objs: Obj[] = [{ id: 1, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [sp] } }];
  const job = await cutJob(objs, {}, { optInnerFirst: false, optTravel: false, optGroup: false });
  // gesetzter Knoten nodes[0]=(100,300) → Maschine (100,100); ohne fixed wäre es der nächste Knoten
  assert.deepEqual(firstRapid(job.moves), [100, 100]);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
