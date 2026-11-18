// Regressionstests der Vorschau-Abspiellogik: Prozessarten, Glättung, Pausen, Zeitmarken.
// Aufruf: npm run test:preview-playback
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { Moves } from '../src/gcode';
import { advancePlayback, analyzePlayback, computeFactors, PROCESS_CUT, PROCESS_ENGRAVE, PROCESS_TRAVEL, type PlaybackAnalysis, type PlaybackSettings } from '../src/previewPlayback';

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

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);

function fixture() {
  const mv = new Moves();
  const t: number[] = [];
  let x = 0;
  const add = (cls: number, dt: number, layer: number, s = cls === PROCESS_TRAVEL ? 0 : 0.5) => {
    x += 1;
    mv.push(x, 0, cls === PROCESS_TRAVEL ? 0 : 1000, s, layer, cls);
    t.push((t.at(-1) ?? 0) + dt);
  };
  add(PROCESS_ENGRAVE, 2, 0);
  add(PROCESS_ENGRAVE, 2, 0);
  add(PROCESS_TRAVEL, 2, 0);
  add(PROCESS_CUT, 2, 1);
  add(PROCESS_CUT, 2, 1);
  return { mv, est: { t: Float64Array.from(t), total: 10, cutLength: 0, rapidLength: 0 } };
}

const settings = (patch: Partial<PlaybackSettings> = {}): PlaybackSettings => ({ engrave: 50, cut: 10, smooth: false, target: 20, ...patch });

await test('Prozesszeiten trennen Gravieren, Schneiden und Leerweg', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings());
  near(a.processTimes.engrave, 4);
  near(a.processTimes.travel, 2);
  near(a.processTimes.cut, 4);
  near(a.processTimes.engrave + a.processTimes.travel + a.processTimes.cut, est.total);
});

await test('Verfahrwege erben die vorige Prozessart', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings());
  assert.equal(a.segmentProcess[2], PROCESS_ENGRAVE);
});

await test('Layerzeiten und Anteile in Layerreihenfolge', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings());
  assert.deepEqual(a.layerTimes.map((l) => l.layer), [0, 1]);
  near(a.layerTimes[0].seconds, 6);
  near(a.layerTimes[0].share, 0.6);
  near(a.layerTimes[1].seconds, 4);
  near(a.layerTimes[1].share, 0.4);
});

await test('Zeitmarke am Layerwechsel mit Prozessartwechsel', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings());
  assert.equal(a.markers.length, 1);
  near(a.markers[0].time, 6);
  assert.equal(a.markers[0].layer, 1);
  assert.equal(a.markers[0].process, PROCESS_CUT);
  assert.equal(a.markers[0].change, true);
});

await test('Zeitmarke nennt die erste Arbeitsart des Layers nach dem Eilgang', () => {
  const mv = new Moves();
  const t: number[] = [];
  let x = 0;
  const add = (cls: number, dt: number, layer: number) => {
    x += 1;
    mv.push(x, 0, cls === PROCESS_TRAVEL ? 0 : 1000, cls === PROCESS_TRAVEL ? 0 : 0.5, layer, cls);
    t.push((t.at(-1) ?? 0) + dt);
  };
  add(PROCESS_ENGRAVE, 2, 0);
  add(PROCESS_ENGRAVE, 2, 0);
  add(PROCESS_TRAVEL, 1, 0);
  add(PROCESS_TRAVEL, 1, 1);
  add(PROCESS_CUT, 2, 1);
  add(PROCESS_TRAVEL, 1, 2);
  add(PROCESS_ENGRAVE, 2, 2);
  const est = { t: Float64Array.from(t), total: 11, cutLength: 0, rapidLength: 0 };
  const a = analyzePlayback(mv, est, settings());
  assert.deepEqual(a.markers.map((m) => [m.layer, m.process, m.change]), [
    [1, PROCESS_CUT, true],
    [2, PROCESS_ENGRAVE, true],
  ]);
  near(a.markers[0].time, 5);
});

await test('Layer ohne Arbeitsbewegung bekommt keine Zeitmarke', () => {
  const mv = new Moves();
  const t: number[] = [];
  let x = 0;
  const add = (cls: number, dt: number, layer: number) => {
    x += 1;
    mv.push(x, 0, cls === PROCESS_TRAVEL ? 0 : 1000, cls === PROCESS_TRAVEL ? 0 : 0.5, layer, cls);
    t.push((t.at(-1) ?? 0) + dt);
  };
  add(PROCESS_ENGRAVE, 2, 0);
  add(PROCESS_TRAVEL, 2, 1);
  add(PROCESS_CUT, 2, 2);
  const est = { t: Float64Array.from(t), total: 6, cutLength: 0, rapidLength: 0 };
  const a = analyzePlayback(mv, est, settings());
  assert.deepEqual(a.markers.map((m) => m.layer), [2]);
  assert.equal(a.markers[0].change, true);
});

await test('Reiner Schneidjob nutzt den Schneidfaktor schon für die Anfahrt', () => {
  const mv = new Moves();
  const t: number[] = [];
  let x = 0;
  const add = (cls: number, dt: number, layer: number) => {
    x += 1;
    mv.push(x, 0, cls === PROCESS_TRAVEL ? 0 : 1000, cls === PROCESS_TRAVEL ? 0 : 0.5, layer, cls);
    t.push((t.at(-1) ?? 0) + dt);
  };
  add(PROCESS_TRAVEL, 1, 0);
  add(PROCESS_CUT, 4, 0);
  add(PROCESS_TRAVEL, 1, 0);
  const est = { t: Float64Array.from(t), total: 6, cutLength: 0, rapidLength: 0 };
  const a = analyzePlayback(mv, est, settings());
  assert.equal(a.segmentProcess[0], PROCESS_CUT);
  assert.equal(a.segmentProcess[2], PROCESS_CUT);
  const r = advancePlayback(mv, est, a, 0, 0.5, true);
  near(r.time, 5);
  assert.equal(r.paused, false);
});

await test('Sublayer trennen Zeiten und Marken im selben Layer', () => {
  const mv = new Moves();
  const t: number[] = [];
  let x = 0;
  const add = (cls: number, dt: number, layer: number, sub: number) => {
    x += 1;
    mv.push(x, 0, cls === PROCESS_TRAVEL ? 0 : 1000, cls === PROCESS_TRAVEL ? 0 : 0.5, layer, cls, sub);
    t.push((t.at(-1) ?? 0) + dt);
  };
  add(PROCESS_ENGRAVE, 2, 0, -1);
  add(PROCESS_TRAVEL, 1, 0, 0);
  add(PROCESS_CUT, 2, 0, 0);
  add(PROCESS_CUT, 2, 0, 1);
  const est = { t: Float64Array.from(t), total: 7, cutLength: 0, rapidLength: 0 };
  const a = analyzePlayback(mv, est, settings());
  // Zeiten je (Layer, Sublayer): Haupt, Sub 0 (inkl. Anfahrt), Sub 1
  assert.deepEqual(a.layerTimes.map((l) => [l.layer, l.sub]), [[0, -1], [0, 0], [0, 1]]);
  near(a.layerTimes[0].seconds, 2);
  near(a.layerTimes[1].seconds, 3);
  near(a.layerTimes[2].seconds, 2);
  // Marken je Bearbeitungswechsel, mit Sublayer-Zuordnung
  assert.deepEqual(a.markers.map((m) => [m.layer, m.sub, m.process]), [[0, 0, PROCESS_CUT], [0, 1, PROCESS_CUT]]);
  assert.equal(a.markers[0].change, true);
  assert.equal(a.markers[1].change, false);
});

await test('Traditionelle Faktoren kommen aus den Reglern', () => {
  const a = computeFactors({ engrave: 4, cut: 4, travel: 2 }, settings({ engrave: 50, cut: 10 }));
  assert.deepEqual(a, { engrave: 50, cut: 10 });
});

await test('Glättung rafft längere Prozessarten auf das Ziel', () => {
  assert.deepEqual(computeFactors({ engrave: 4, cut: 4, travel: 2 }, settings({ smooth: true, target: 2 })), { engrave: 2, cut: 2 });
  assert.deepEqual(computeFactors({ engrave: 120, cut: 20, travel: 5 }, settings({ smooth: true, target: 20 })), { engrave: 6, cut: 1 });
});

await test('Glättung verlangsamt nie und begrenzt den Faktor', () => {
  assert.deepEqual(computeFactors({ engrave: 4, cut: 4, travel: 0 }, settings({ smooth: true, target: 20 })), { engrave: 1, cut: 1 });
  assert.deepEqual(computeFactors({ engrave: 4, cut: 4, travel: 0 }, settings({ smooth: true, target: 0.001 })), { engrave: 1000, cut: 1000 });
  assert.deepEqual(computeFactors({ engrave: 0, cut: 0, travel: 2 }, settings({ smooth: true, target: 20 })), { engrave: 1, cut: 1 });
});

await test('Abspielen rückt mit dem Faktor der aktuellen Prozessart vor', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings({ engrave: 2, cut: 2 }));
  near(advancePlayback(mv, est, a, 0, 2.5, false).time, 5);
  assert.equal(advancePlayback(mv, est, a, 0, 2.5, false).paused, false);
});

await test('Opt-in-Pause stoppt genau am Wechsel der Prozessart', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings({ engrave: 2, cut: 2 }));
  const r = advancePlayback(mv, est, a, 3, 3, true);
  assert.equal(r.paused, true);
  near(r.time, 6);
});

await test('Ohne Pause läuft der Wechsel durch', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings({ engrave: 2, cut: 2 }));
  const r = advancePlayback(mv, est, a, 3, 3, false);
  assert.equal(r.paused, false);
  near(r.time, 9);
});

await test('Fortsetzen an der Pausenzeit pausiert nicht erneut', () => {
  const { mv, est } = fixture();
  const a = analyzePlayback(mv, est, settings({ engrave: 2, cut: 2 }));
  const r = advancePlayback(mv, est, a, 6, 1, true);
  assert.equal(r.paused, false);
  near(r.time, 8);
});

await test('Bewegungen ohne Prozessmarke gelten als Gravieren', () => {
  const mv = new Moves();
  mv.push(1, 0, 1000, 0.4, 0);
  mv.push(2, 0, 0, 0, 0);
  const est = { t: Float64Array.from([2, 4]), total: 4, cutLength: 0, rapidLength: 0 };
  const a = analyzePlayback(mv, est, settings());
  near(a.processTimes.engrave, 2);
  near(a.processTimes.travel, 2);
  assert.equal(a.segmentProcess[0], PROCESS_ENGRAVE);
});

await test('Kein Zeitmarker am Jobanfang und bei leerer Schätzung', () => {
  const { mv, est } = fixture();
  assert.ok(analyzePlayback(mv, est, settings()).markers.every((m) => m.time > 0));
  const empty = new Moves();
  const a = analyzePlayback(empty, { t: new Float64Array(), total: 0, cutLength: 0, rapidLength: 0 }, settings({ smooth: true }));
  assert.deepEqual(a.markers, []);
  assert.deepEqual(a.factors, { engrave: 1, cut: 1 });
  assert.deepEqual(advancePlayback(empty, { t: new Float64Array(), total: 0, cutLength: 0, rapidLength: 0 }, a, 0, 1, true), { time: 0, paused: false });
});

await test('Analyse verändert die Bewegungen nicht', () => {
  const { mv, est } = fixture();
  const before = {
    x: [...mv.x.slice(0, mv.n)], y: [...mv.y.slice(0, mv.n)], s: [...mv.s.slice(0, mv.n)],
    f: [...mv.f.slice(0, mv.n)], layer: [...mv.layer.slice(0, mv.n)], cls: [...mv.cls.slice(0, mv.n)],
  };
  analyzePlayback(mv, est, settings({ smooth: true, target: 2 }));
  assert.deepEqual({ x: [...mv.x.slice(0, mv.n)], y: [...mv.y.slice(0, mv.n)], s: [...mv.s.slice(0, mv.n)], f: [...mv.f.slice(0, mv.n)], layer: [...mv.layer.slice(0, mv.n)], cls: [...mv.cls.slice(0, mv.n)] }, before);
});

await test('Pause am Wechsel innerhalb eines Layers', () => {
  const mv = new Moves();
  mv.push(1, 0, 1000, 0.5, 0, PROCESS_ENGRAVE);
  mv.push(2, 0, 1500, 0.9, 0, PROCESS_CUT);
  const est = { t: Float64Array.from([1, 2]), total: 2, cutLength: 0, rapidLength: 0 };
  const a = analyzePlayback(mv, est, settings({ engrave: 1, cut: 1 }));
  const r = advancePlayback(mv, est, a, 0, 2, true);
  assert.equal(r.paused, true);
  near(r.time, 1);
  assert.equal(a.markers.length, 0, 'kein Layerwechsel');
});

await test('Glättungsfaktoren wirken auf die Abspielzeit', () => {
  const { mv, est } = fixture();
  const a: PlaybackAnalysis = analyzePlayback(mv, est, settings({ smooth: true, target: 2 }));
  near(a.factors.engrave, 2);
  near(a.factors.cut, 2);
  near(advancePlayback(mv, est, a, 0, 2, false).time, 4);
});

if (failed) {
  console.log(`${failed} Vorschau-Abspieltests fehlgeschlagen`);
  process.exit(1);
}
console.log('Vorschau-Abspieltests: alle bestanden');
