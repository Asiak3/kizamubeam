// Vergleichsdaten für den Rust-Kern (src-tauri/core/tests): dieselben Eingaben laufen durch die
// TypeScript-Fassung, die Ergebnisse landen in src-tauri/core/tests/fixtures/parity.json.
// Aufruf: npm run test:core (erzeugt die Daten und startet cargo test).
import './core-fixtures-env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { applyAdjust, dither, resample } from '../src/images';
import { DEFAULT_ROTARY, estimate, FIRMWARES, gcodeLines, Moves, newDevice, outAxis, packMoves, rotaryMoves, scanLines, zInserts } from '../src/gcode';
import { defaultImageLayer, defaultLayer, inv, ImageAdjust, Mat, mul } from '../src/model';
import { ruidaLayersFromMoves, RuidaParams, writeRuida } from '../src/ruida';

// Reproduzierbare Zufallszahlen
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);

const SW = 97,
  SH = 71;
const src = new Float32Array(SW * SH);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) src[y * SW + x] = Math.min(255, Math.max(0, 128 + 100 * Math.sin(x / 7) * Math.cos(y / 5) + 40 * (rnd() - 0.5)));

const arr = (a: ArrayLike<number>) => Array.from(a);
const adjust: ImageAdjust = { brightness: 8, contrast: 25, gamma: 1.4, sharpen: 120, sharpenRadius: 5, denoise: 3 };

const down = resample(src, SW, SH, 40, 30);
const up = resample(src, SW, SH, 150, 110);
const adjusted = down.slice();
applyAdjust(adjusted, 40, 30, adjust, false);
const adjustedNeg = up.slice();
applyAdjust(adjustedNeg, 150, 110, { ...adjust, sharpen: 0 }, true);
const modes = ['threshold', 'ordered', 'atkinson', 'floyd', 'stucki', 'jarvis', 'newsprint', 'halftone', 'sketch', 'grayscale'] as const;
const dithered = Object.fromEntries(modes.map((m) => [m, arr(dither(adjusted, 40, 30, { mode: m, threshold: 140, cellPx: 3.5, angle: 30 }))]));

// Rasterzeilen: achsparallel und gedreht, Graustufen und schwarz-weiß
const scans = [
  { m: [0.5, 0, 0, -0.5, 12, 40] as Mat, mode: 'jarvis' },
  { m: mul([Math.cos(0.4), Math.sin(0.4), -Math.sin(0.4), Math.cos(0.4), 30, 5], [0.5, 0, 0, 0.5, 0, 0]) as Mat, mode: 'grayscale' },
  { m: [0.5, 0, 0, -0.5, 3, 20] as Mat, mode: 'sketch' },
].map(({ m, mode }) => {
  const L = { ...defaultImageLayer(), dither: mode as never, interval: 0.4, power: 60, minPower: 10 };
  const v = Uint8Array.from(dithered[mode]);
  const lines = scanLines(v, 20, 15, L, 40, 30, m, inv(m)).filter((l) => l.runs.length);
  return { m, im: inv(m), layer: L, v: arr(v), lines };
});

// G-Code: Eilgänge, Vorschübe, gleiche Punkte, negative Koordinaten, Air Assist auf Layer 1
// withZ: Z-Versatz wechselt (wie bei „tiefer je Durchgang“), Z-Zeilen werden vor Bewegungen eingefügt
function gcodeCase(fw: 'fluidnc' | 'smoothie', axis?: 'A', withZ = false) {
  const d = newDevice({ fw, ...(axis ? { rotary: { ...DEFAULT_ROTARY, enabled: true, axis, kind: 'chuck' as const, objectDiam: 70 } } : {}) });
  const mv = new Moves(1.25, -3);
  let x = 0,
    y = 0;
  for (let i = 0; i < 3000; i++) {
    const r = rnd();
    if (r < 0.05) {
      // gleicher Punkt nach Rundung
    } else {
      x += (rnd() - 0.4) * 7.3;
      y += (rnd() - 0.6) * 3.1;
    }
    const rapid = rnd() < 0.15;
    const f = rapid ? 0 : [1200, 3000.4, 6000][Math.floor(rnd() * 3)];
    const s = rapid ? 0 : [0, 0.25, 0.3333, 1][Math.floor(rnd() * 4)];
    if (withZ && i % 500 === 0) mv.zCur = i === 2500 ? 0.1 : (i / 500) * 0.35;
    mv.push(i === 7 ? -0.0001 : x, y, f, s, Math.floor(i / 700) % 3 === 1 ? 1 : i > 2900 ? -1 : 0);
  }
  const est = estimate(mv, d);
  // Mit Drehachse: Bewegungen wie in prepareGCode umgerechnet, Y-Richtung als A ausgegeben
  const out = rotaryMoves(mv, d).mv;
  const g = gcodeLines(out, d, est, [1], ['; Kopf', 'G21', 'G90', 'M4 S0']);
  const zs = zInserts(out, d);
  const params = {
    x0: out.x0, y0: out.y0, sMax: d.sMax, air: [1], airCmd: 'M8', header: ['; Kopf', 'G21', 'G90', 'M4 S0'], footer: [...zs.end, ...FIRMWARES[fw].footer], total: est.total,
    ...(axis ? { yAxis: outAxis(d) } : {}), ...(withZ ? { inserts: zs.at } : {}),
  };
  return {
    // so, wie prepareGCode die Daten an den Rust-Kern schickt
    packed: arr(packMoves(out, est.t, JSON.stringify(params))),
    moves: { x0: out.x0, y0: out.y0, x: arr(out.x.subarray(0, out.n)), y: arr(out.y.subarray(0, out.n)), s: arr(out.s.subarray(0, out.n)), f: arr(out.f.subarray(0, out.n)), layer: arr(out.layer.subarray(0, out.n)), t: arr(est.t) },
    params,
    lines: g.lines,
    times: arr(g.times),
  };
}

function ruidaCase(startFrom: 'absolute' | 'current', origin: 'top-right' | 'bottom-left', magic: '88' | '11', laser: '1' | 'both') {
  const mv = new Moves(10, 15);
  mv.push(10, 15, 0, 0, 0);
  mv.push(45.5, 15, 1800, 0.75, 0);
  mv.push(45.5, 32.25, 1800, 0.75, 0);
  mv.push(20, 40, 0, 0, 1);
  mv.push(60, 55.125, 3600, 0.4, 1);
  const est = estimate(mv, newDevice({ fw: 'ruida' }));
  const layers = ruidaLayersFromMoves(mv, (i) => ({
    ...defaultLayer(i),
    speed: i === 0 ? 1800 : 3600,
    power: i === 0 ? 75 : 40,
    minPower: i === 0 ? 25 : 0,
    air: i === 1,
  }));
  const params: RuidaParams = {
    x0: mv.x0,
    y0: mv.y0,
    bedW: 600,
    bedH: 400,
    origin,
    startFrom,
    magic: magic === '11' ? 0x11 : 0x88,
    laser,
    air: [1],
    layers,
  };
  return {
    packed: arr(packMoves(mv, est.t, JSON.stringify(params))),
    bytes: arr(writeRuida(mv, params)),
  };
}

const out = {
  src: { w: SW, h: SH, v: arr(src) },
  down: arr(down),
  up: arr(up),
  adjust,
  adjusted: arr(adjusted),
  adjustedNeg: arr(adjustedNeg),
  dithered,
  scans,
  gcode: [gcodeCase('fluidnc'), gcodeCase('smoothie'), gcodeCase('fluidnc', 'A'), gcodeCase('fluidnc', undefined, true)],
  ruida: [
    ruidaCase('absolute', 'top-right', '88', '1'),
    ruidaCase('current', 'bottom-left', '11', 'both'),
  ],
};
mkdirSync(new URL('../src-tauri/core/tests/fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src-tauri/core/tests/fixtures/parity.json', import.meta.url), JSON.stringify(out));
console.log('Vergleichsdaten geschrieben');
