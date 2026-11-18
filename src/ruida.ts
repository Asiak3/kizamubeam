// Ruida DSP (.rd) Binärformat: Lesen, Schreiben und Rahmen-Befehle für CO2-Laser-Steuerungen
// (RDC6442G/S, RDC6445G/S, RDC6332, RDLC320 usw.). Entspricht 1:1 `src-tauri/core/src/ruida.rs`.
import { defaultLayer, IDENT, Layer, newId, Obj, PALETTE, SubPath } from './model';
import type { LbrnResult } from './lbrn';
import type { Device, Job, Moves, RuidaLaser, RuidaMagic, RuidaOrigin } from './gcode';

export const RUIDA_ACK = 0xcc;
export const RUIDA_NAK = 0xcf;
export const RUIDA_DEFAULT_MAGIC = 0x88;

export function magicByte(m?: RuidaMagic): number {
  if (m === '11') return 0x11;
  if (m === '38') return 0x38;
  return 0x88;
}

export function swizzleByte(b: number, magic = RUIDA_DEFAULT_MAGIC): number {
  const swapped = (b & 0x7e) | ((b >> 7) & 1) | ((b & 1) << 7);
  return ((swapped ^ magic) + 1) & 0xff;
}

export function unswizzleByte(b: number, magic = RUIDA_DEFAULT_MAGIC): number {
  const u = ((b - 1) & 0xff) ^ magic;
  return (u & 0x7e) | ((u >> 7) & 1) | ((u & 1) << 7);
}

export function swizzle(data: Uint8Array, magic = RUIDA_DEFAULT_MAGIC): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = swizzleByte(data[i], magic);
  return out;
}

export function unswizzle(data: Uint8Array, magic = RUIDA_DEFAULT_MAGIC): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = unswizzleByte(data[i], magic);
  return out;
}

export function magicFromHistogram(data: Uint8Array): number {
  const hist = new Uint32Array(256);
  let prev = -1;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    hist[b] += b === prev ? 5 : 1;
    prev = b;
  }
  let top = 0;
  for (let i = 1; i < 256; i++) if (hist[i] > hist[top]) top = i;
  return (top - 1) & 0xff;
}

export function magicForFile(data: Uint8Array): number {
  if (!data.length) return RUIDA_DEFAULT_MAGIC;
  const guess = magicFromHistogram(data);
  const fits = (m: number) => unswizzleByte(data[0], m) >= 0x80 && unswizzleByte(data[data.length - 1], m) === 0xd7;
  for (const m of [guess, 0x88, 0x11, 0x38]) if (fits(m)) return m;
  return guess;
}

/** Prüft, ob eine Binärdatei wie eine gültige Ruida-.rd-Datei aussieht */
export function isRuidaFile(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  for (const m of [0x88, 0x11, 0x38, magicFromHistogram(data)]) {
    const first = unswizzleByte(data[0], m);
    const last = unswizzleByte(data[data.length - 1], m);
    if (first >= 0x80 && last === 0xd7) return true;
  }
  return false;
}

export function packet(cmds: Uint8Array, magic = RUIDA_DEFAULT_MAGIC): Uint8Array {
  const data = swizzle(cmds, magic);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) & 0xffff;
  const out = new Uint8Array(2 + data.length);
  out[0] = (sum >> 8) & 0xff;
  out[1] = sum & 0xff;
  out.set(data, 2);
  return out;
}

export function checkedPayload(pkt: Uint8Array): Uint8Array | null {
  if (pkt.length < 3) return null;
  const want = (pkt[0] << 8) | pkt[1];
  let sum = 0;
  for (let i = 2; i < pkt.length; i++) sum = (sum + pkt[i]) & 0xffff;
  return sum === want ? pkt.subarray(2) : null;
}

export function splitCommands(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= 0x80) {
      if (start >= 0) out.push(data.subarray(start, i));
      start = i;
    }
  }
  if (start >= 0) out.push(data.subarray(start));
  return out;
}

export function u14(d: Uint8Array, off = 0): number | null {
  if (d.length < off + 2) return null;
  return ((d[off] & 0x7f) << 7) | (d[off + 1] & 0x7f);
}

export function i14(d: Uint8Array, off = 0): number | null {
  const v = u14(d, off);
  if (v === null) return null;
  return v > 0x1fff ? v - 0x4000 : v;
}

export function u35(d: Uint8Array, off = 0): number | null {
  if (d.length < off + 5) return null;
  let v = 0;
  for (let i = 0; i < 5; i++) v = v * 128 + (d[off + i] & 0x7f);
  return v;
}

export function i35(d: Uint8Array, off = 0): number | null {
  if (d.length < off + 5) return null;
  let v = 0n;
  for (let i = 0; i < 5; i++) v = (v << 7n) | BigInt(d[off + i] & 0x7f);
  const low32 = Number(v & 0xffff_ffffn);
  return low32 | 0;
}

export function encodeU35(v: number): [number, number, number, number, number] {
  const u = v >>> 0;
  return [(u >>> 28) & 0x7f, (u >>> 21) & 0x7f, (u >>> 14) & 0x7f, (u >>> 7) & 0x7f, u & 0x7f];
}

export function encodeI35(v: number): [number, number, number, number, number] {
  return encodeU35(v | 0);
}

export function encodeI14(v: number): [number, number] {
  const u = v & 0x3fff;
  return [(u >> 7) & 0x7f, u & 0x7f];
}

export function encodePower(percent: number): [number, number] {
  const clamped = Math.max(0, Math.min(100, percent));
  const v = Math.round((clamped * 16383) / 100);
  return encodeI14(v);
}

export function mm(d: Uint8Array, off = 0): number | null {
  const v = i35(d, off);
  return v === null ? null : v / 1000;
}

export function mmShort(d: Uint8Array, off = 0): number | null {
  const v = i14(d, off);
  return v === null ? null : v / 1000;
}

export function power(d: Uint8Array, off = 0): number | null {
  const v = u14(d, off);
  return v === null ? null : (v * 100) / 16383;
}

export function speed(d: Uint8Array, off = 0): number | null {
  const v = i35(d, off);
  return v === null ? null : v / 1000;
}

export function flipAxes(origin: RuidaOrigin = 'top-right'): [boolean, boolean] {
  if (origin === 'top-left') return [false, true];
  if (origin === 'bottom-left') return [false, false];
  if (origin === 'bottom-right') return [true, false];
  return [true, true];
}

export function toRuidaAbs(origin: RuidaOrigin, bedW: number, bedH: number, x: number, y: number): [number, number] {
  const [fx, fy] = flipAxes(origin);
  return [fx ? bedW - x : x, fy ? bedH - y : y];
}

export function fromRuidaAbs(origin: RuidaOrigin, bedW: number, bedH: number, rx: number, ry: number): [number, number] {
  return toRuidaAbs(origin, bedW, bedH, rx, ry);
}

export function toRuidaRel(origin: RuidaOrigin, dx: number, dy: number): [number, number] {
  const [fx, fy] = flipAxes(origin);
  return [fx ? -dx : dx, fy ? -dy : dy];
}

export interface RuidaLayerParam {
  index: number;
  speed: number;
  power: number;
  minPower: number;
  color: number;
}

export interface RuidaParams {
  x0: number;
  y0: number;
  bedW: number;
  bedH: number;
  origin: RuidaOrigin;
  startFrom: 'absolute' | 'user' | 'current';
  magic: number;
  laser: RuidaLaser;
  returnHome: boolean;
  air: number[];
  layers: RuidaLayerParam[];
}

export function hexToBgr(hex: string): number {
  const clean = hex.replace(/^#/, '');
  const n = parseInt(clean, 16);
  if (isNaN(n)) return 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (b << 16) | (g << 8) | r;
}

export function ruidaLayersFromMoves(mv: Moves, layerOf?: (i: number) => Layer): RuidaLayerParam[] {
  const seen = new Map<number, { maxS: number; maxF: number }>();
  for (let i = 0; i < mv.n; i++) {
    if (mv.f[i] <= 0 || mv.s[i] <= 0) continue;
    const li = mv.layer[i];
    if (li < 0) continue;
    const cur = seen.get(li);
    if (!cur) seen.set(li, { maxS: mv.s[i], maxF: mv.f[i] });
    else {
      if (mv.s[i] > cur.maxS) cur.maxS = mv.s[i];
      if (mv.f[i] > cur.maxF) cur.maxF = mv.f[i];
    }
  }
  const out: RuidaLayerParam[] = [];
  for (const [li, st] of seen.entries()) {
    const L = layerOf ? layerOf(li) : null;
    const colHex = PALETTE[li % PALETTE.length] ?? '#000000';
    out.push({
      index: li,
      speed: L ? L.speed : st.maxF,
      power: L ? L.power : st.maxS * 100,
      minPower: L ? L.minPower : 0,
      color: hexToBgr(colHex),
    });
  }
  return out;
}

export function ruidaParamsForJob(job: Job, d: Device, layerOf?: (i: number) => Layer): RuidaParams {
  return {
    x0: job.moves.x0,
    y0: job.moves.y0,
    bedW: d.bedW,
    bedH: d.bedH,
    origin: d.ruidaOrigin ?? 'top-right',
    startFrom: d.startFrom,
    magic: magicByte(d.ruidaMagic),
    laser: d.ruidaLaser ?? '1',
    returnHome: d.returnHome,
    air: job.air,
    layers: ruidaLayersFromMoves(job.moves, layerOf),
  };
}

function um(mmVal: number): number {
  return Math.round(mmVal * 1000);
}

function mapPoint(p: RuidaParams, x: number, y: number): [number, number] {
  const [rx, ry] =
    p.startFrom === 'absolute'
      ? toRuidaAbs(p.origin, p.bedW, p.bedH, x, y)
      : toRuidaRel(p.origin, x - p.x0, y - p.y0);
  return [um(rx), um(ry)];
}

function pushLayerPower(out: number[], idx: number, minP: number, maxP: number, laser: RuidaLaser) {
  const minEnc = encodePower(minP);
  const maxEnc = encodePower(maxP);
  const zeroEnc = encodePower(0);
  if (laser === '2') {
    out.push(0xc6, 0x31, idx, ...zeroEnc, 0xc6, 0x32, idx, ...zeroEnc, 0xc6, 0x41, idx, ...minEnc, 0xc6, 0x42, idx, ...maxEnc);
  } else if (laser === 'both') {
    out.push(0xc6, 0x31, idx, ...minEnc, 0xc6, 0x32, idx, ...maxEnc, 0xc6, 0x41, idx, ...minEnc, 0xc6, 0x42, idx, ...maxEnc);
  } else {
    out.push(0xc6, 0x31, idx, ...minEnc, 0xc6, 0x32, idx, ...maxEnc);
  }
}

function pushCutPower(out: number[], min14: number, max14: number, laser: RuidaLaser) {
  const minEnc = encodeI14(min14);
  const maxEnc = encodeI14(max14);
  const zeroEnc = encodeI14(0);
  if (laser === '2') {
    out.push(0xc6, 0x01, ...zeroEnc, 0xc6, 0x02, ...zeroEnc, 0xc6, 0x21, ...minEnc, 0xc6, 0x22, ...maxEnc);
  } else if (laser === 'both') {
    out.push(0xc6, 0x01, ...minEnc, 0xc6, 0x02, ...maxEnc, 0xc6, 0x21, ...minEnc, 0xc6, 0x22, ...maxEnc);
  } else {
    out.push(0xc6, 0x01, ...minEnc, 0xc6, 0x02, ...maxEnc);
  }
}

/** Erzeugt die unverwürfelten Ruida-Befehle eines Auftrags (1:1 wie `write_plain` in `ruida.rs`) */
export function writeRuidaPlain(mv: Moves, p: RuidaParams): Uint8Array {
  const n = mv.n;
  const out: number[] = [];

  // 1. Referenzpunkt
  const refCode = p.startFrom === 'user' ? 0x11 : p.startFrom === 'current' ? 0x12 : 0x10;
  out.push(0xd8, refCode);

  const startUm = mapPoint(p, p.x0, p.y0);
  const pts: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) pts[i] = mapPoint(p, mv.x[i], mv.y[i]);

  // 2. Bounding-Box (über Vorschub-/Schnittbewegungen ohne Rückfahrt-Eilgang, sonst alle Punkte)
  if (n > 0) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let hasFeed = false;
    for (let i = 0; i < n; i++) if (mv.f[i] > 0) { hasFeed = true; break; }
    let prev = startUm;
    for (let i = 0; i < n; i++) {
      const [rx, ry] = pts[i];
      if (!hasFeed || mv.f[i] > 0) {
        if (hasFeed) {
          if (prev[0] < minX) minX = prev[0];
          if (prev[1] < minY) minY = prev[1];
          if (prev[0] > maxX) maxX = prev[0];
          if (prev[1] > maxY) maxY = prev[1];
        }
        if (rx < minX) minX = rx;
        if (ry < minY) minY = ry;
        if (rx > maxX) maxX = rx;
        if (ry > maxY) maxY = ry;
      }
      prev = [rx, ry];
    }
    out.push(0xe7, 0x03, ...encodeI35(minX), ...encodeI35(minY));
    out.push(0xe7, 0x07, ...encodeI35(maxX), ...encodeI35(maxY));
  }

  // 3. Layer-Tabelle
  const layerMin = new Map<number, number>();
  for (const l of p.layers) {
    const idx = Math.max(0, l.index) & 0x1f;
    const spd = Math.max(1, Math.round((l.speed / 60) * 1000));
    const maxP = Math.max(0, Math.min(100, l.power));
    const minP = l.minPower > 0 ? Math.max(0, Math.min(maxP, l.minPower)) : maxP;
    layerMin.set(l.index, minP);
    out.push(0xc9, 0x04, idx, ...encodeI35(spd));
    pushLayerPower(out, idx, minP, maxP, p.laser);
    out.push(0xca, 0x06, idx, ...encodeU35(l.color & 0x00ff_ffff));
  }

  // 4. Bewegungen & Schnitte
  let curPos: [number, number] | null = null;
  let curLayer = -32768;
  let curSpeed = -1;
  let curPower = -1;
  let airOn = false;

  for (let i = 0; i < n; i++) {
    const [rx, ry] = pts[i];
    if (curPos !== null && curPos[0] === rx && curPos[1] === ry) continue;
    const cut = mv.f[i] > 0 && mv.s[i] > 0;
    if (cut) {
      if (curPos === null) {
        out.push(0x88, ...encodeI35(startUm[0]), ...encodeI35(startUm[1]));
        curPos = [startUm[0], startUm[1]];
      }
      if (mv.layer[i] !== curLayer) {
        curLayer = mv.layer[i];
        const idx = Math.max(0, curLayer) & 0x1f;
        out.push(0xca, 0x02, idx);
        const wantAir = p.air?.includes(curLayer) ?? false;
        if (wantAir !== airOn) {
          airOn = wantAir;
          out.push(0xca, 0x01, airOn ? 0x13 : 0x12);
        }
        curSpeed = -1;
        curPower = -1;
      }
      const spd = Math.max(1, Math.round((mv.f[i] / 60) * 1000));
      if (spd !== curSpeed) {
        curSpeed = spd;
        out.push(0xc9, 0x02, ...encodeI35(spd));
      }
      const pwPct = Math.max(0, Math.min(100, mv.s[i] * 100));
      const pw14 = Math.round((pwPct * 16383) / 100);
      if (pw14 !== curPower) {
        const lm = layerMin.get(curLayer);
        const minPct = curPower === -1 && lm !== undefined && lm > 0 ? Math.min(lm, pwPct) : pwPct;
        const min14 = Math.round((Math.max(0, Math.min(100, minPct)) * 16383) / 100);
        pushCutPower(out, min14, pw14, p.laser);
        curPower = pw14;
      }
    }

    if (curPos !== null) {
      const dx = rx - curPos[0];
      const dy = ry - curPos[1];
      if (dx === 0 && dy === 0) continue;
      const sx = dx >= -8192 && dx <= 8191;
      const sy = dy >= -8192 && dy <= 8191;
      if (dy === 0 && sx) {
        out.push(cut ? 0xaa : 0x8a, ...encodeI14(dx));
      } else if (dx === 0 && sy) {
        out.push(cut ? 0xab : 0x8b, ...encodeI14(dy));
      } else if (sx && sy) {
        out.push(cut ? 0xa9 : 0x89, ...encodeI14(dx), ...encodeI14(dy));
      } else {
        out.push(cut ? 0xa8 : 0x88, ...encodeI35(rx), ...encodeI35(ry));
      }
    } else {
      out.push(0x88, ...encodeI35(rx), ...encodeI35(ry));
    }
    curPos = [rx, ry];
  }

  if (airOn) out.push(0xca, 0x01, 0x12);
  if (p.returnHome && curPos !== null && (curPos[0] !== startUm[0] || curPos[1] !== startUm[1])) {
    out.push(0x88, ...encodeI35(startUm[0]), ...encodeI35(startUm[1]));
  }
  out.push(0xd7);
  return new Uint8Array(out);
}

/** Erzeugt die verwürfelten `.rd`-Bytes eines Auftrags */
export function writeRuida(mv: Moves, p: RuidaParams): Uint8Array {
  const m = p.magic || RUIDA_DEFAULT_MAGIC;
  return swizzle(writeRuidaPlain(mv, p), m);
}

export interface DecodedRuidaLayer {
  index: number;
  speed: number;
  power: number;
  minPower: number;
  air: boolean;
  color?: number;
}

export interface DecodedRuidaCut {
  from: [number, number];
  to: [number, number];
  layer: number;
  speed: number;
  power: number;
}

export interface DecodedRuidaJob {
  magic: number;
  startFrom: 'absolute' | 'user' | 'current';
  bounds: [number, number, number, number] | null;
  layers: Map<number, DecodedRuidaLayer>;
  cuts: DecodedRuidaCut[];
  rapids: number;
  eof: boolean;
}

export function decodeRuida(raw: Uint8Array, magicHint?: number): DecodedRuidaJob {
  const magic = magicHint ?? magicForFile(raw);
  const plain = unswizzle(raw, magic);
  let startFrom: 'absolute' | 'user' | 'current' = 'absolute';
  let minBound: [number, number] | null = null;
  let maxBound: [number, number] | null = null;
  const layers = new Map<number, DecodedRuidaLayer>();
  const cuts: DecodedRuidaCut[] = [];
  let rapids = 0;
  let eof = false;

  let pos: [number, number] = [0, 0];
  let curLayer = 0;
  let curSpeed = 1200;
  let curPower = 50;

  const ensureLayer = (idx: number): DecodedRuidaLayer => {
    let l = layers.get(idx);
    if (!l) {
      l = { index: idx, speed: 1200, power: 50, minPower: 0, air: false };
      layers.set(idx, l);
    }
    return l;
  };

  for (const c of splitCommands(plain)) {
    if (!c.length) continue;
    const b0 = c[0];
    const b1 = c[1] ?? 0;
    const b2 = c[2] ?? 0;
    switch (b0) {
      case 0x88:
      case 0xa8: {
        const x = mm(c, 1);
        const y = mm(c, 6);
        if (x !== null && y !== null) {
          const to: [number, number] = [x, y];
          if (b0 === 0xa8) cuts.push({ from: pos, to, layer: curLayer, speed: curSpeed, power: curPower });
          else rapids++;
          pos = to;
        }
        break;
      }
      case 0x89:
      case 0xa9: {
        const dx = mmShort(c, 1);
        const dy = mmShort(c, 3);
        if (dx !== null && dy !== null) {
          const to: [number, number] = [pos[0] + dx, pos[1] + dy];
          if (b0 === 0xa9) cuts.push({ from: pos, to, layer: curLayer, speed: curSpeed, power: curPower });
          else rapids++;
          pos = to;
        }
        break;
      }
      case 0x8a:
      case 0xaa: {
        const dx = mmShort(c, 1);
        if (dx !== null) {
          const to: [number, number] = [pos[0] + dx, pos[1]];
          if (b0 === 0xaa) cuts.push({ from: pos, to, layer: curLayer, speed: curSpeed, power: curPower });
          else rapids++;
          pos = to;
        }
        break;
      }
      case 0x8b:
      case 0xab: {
        const dy = mmShort(c, 1);
        if (dy !== null) {
          const to: [number, number] = [pos[0], pos[1] + dy];
          if (b0 === 0xab) cuts.push({ from: pos, to, layer: curLayer, speed: curSpeed, power: curPower });
          else rapids++;
          pos = to;
        }
        break;
      }
      case 0x80: {
        const v = mm(c, 2);
        if (v !== null) {
          if (b1 === 0x00) {
            pos = [v, pos[1]];
            rapids++;
          } else if (b1 === 0x01) {
            pos = [pos[0], v];
            rapids++;
          }
        }
        break;
      }
      case 0xc7: {
        const p = power(c, 1);
        if (p !== null) curPower = p;
        break;
      }
      case 0xc6: {
        if (b1 === 0x01 || b1 === 0x21) {
          const p = power(c, 2);
          if (p !== null) ensureLayer(curLayer).minPower = p;
        } else if (b1 === 0x02 || b1 === 0x22) {
          const p = power(c, 2);
          if (p !== null) {
            curPower = p;
            const l = ensureLayer(curLayer);
            if (l.power === 0) l.power = p;
          }
        } else if (b1 === 0x31 || b1 === 0x41) {
          const p = power(c, 3);
          if (p !== null && p > 0) ensureLayer(b2).minPower = p;
        } else if (b1 === 0x32 || b1 === 0x42) {
          const p = power(c, 3);
          if (p !== null && p > 0) ensureLayer(b2).power = p;
        }
        break;
      }
      case 0xc9: {
        if (b1 === 0x02) {
          const s = speed(c, 2);
          if (s !== null) curSpeed = s * 60;
        } else if (b1 === 0x04) {
          const s = speed(c, 3);
          if (s !== null) ensureLayer(b2).speed = s * 60;
        }
        break;
      }
      case 0xca: {
        if (b1 === 0x01) {
          if (b2 === 0x13) ensureLayer(curLayer).air = true;
        } else if (b1 === 0x02) {
          curLayer = b2;
          const l = ensureLayer(curLayer);
          curSpeed = l.speed;
          curPower = l.power;
        } else if (b1 === 0x06) {
          const col = u35(c, 3);
          if (col !== null) ensureLayer(b2).color = col & 0x00ff_ffff;
        }
        break;
      }
      case 0xe7: {
        if (b1 === 0x03) {
          const x = mm(c, 2);
          const y = mm(c, 7);
          if (x !== null && y !== null) minBound = [x, y];
        } else if (b1 === 0x07) {
          const x = mm(c, 2);
          const y = mm(c, 7);
          if (x !== null && y !== null) maxBound = [x, y];
        }
        break;
      }
      case 0xd8: {
        if (b1 === 0x10) startFrom = 'absolute';
        else if (b1 === 0x11) startFrom = 'user';
        else if (b1 === 0x12) startFrom = 'current';
        break;
      }
      case 0xd7:
        eof = true;
        break;
    }
  }

  const bounds: [number, number, number, number] | null =
    minBound && maxBound ? [minBound[0], minBound[1], maxBound[0], maxBound[1]] : null;

  return { magic, startFrom, bounds, layers, cuts, rapids, eof };
}

/**
 * Konvertiert eine `.rd`-Datei in KizamuBeam-Objekte und Layer-Einstellungen (wie `convertLbrn` für `.lbrn2`).
 */
export function importRuida(
  raw: Uint8Array,
  bedW: number,
  bedH: number,
  origin: RuidaOrigin = 'top-right',
): LbrnResult {
  const dec = decodeRuida(raw);
  const layers: Record<number, Layer> = {};
  for (const [idx, dl] of dec.layers.entries()) {
    const li = idx % 30;
    const L = defaultLayer(li);
    L.mode = 'line';
    L.speed = Math.max(1, Math.round(dl.speed));
    L.power = Math.max(0, Math.min(100, Math.round(dl.power * 10) / 10));
    const minP = Math.max(0, Math.min(L.power, Math.round(dl.minPower * 10) / 10));
    L.minPower = Math.abs(minP - L.power) < 0.05 ? 0 : minP;
    L.air = dl.air;
    L.output = true;
    L.show = true;
    layers[li] = L;
  }

  // Ruida-Koordinaten -> KizamuBeam-Bettkoordinaten (Ursprung vorne links, +Y nach hinten)
  // -> Dokumentkoordinaten (Ursprung oben links, +Y nach unten)
  const [fx, fy] = flipAxes(origin);
  const toDoc = (rx: number, ry: number): { x: number; y: number } => {
    if (dec.startFrom === 'absolute') {
      const bx = fx ? bedW - rx : rx;
      const by = fy ? bedH - ry : ry;
      return { x: bx, y: bedH - by };
    }
    const bx = fx ? -rx : rx;
    const by = fy ? -ry : ry;
    return { x: bx, y: -by };
  };

  // Zusammenhängende Schnittsegmente je Layer zu Polygonzügen verbinden
  const byLayer = new Map<number, SubPath[]>();
  let curSub: SubPath | null = null;
  let lastPt: { x: number; y: number } | null = null;
  let lastLayer = -1;

  for (const c of dec.cuts) {
    const li = c.layer % 30;
    const p0 = toDoc(c.from[0], c.from[1]);
    const p1 = toDoc(c.to[0], c.to[1]);
    const cont =
      curSub !== null &&
      lastLayer === li &&
      lastPt !== null &&
      Math.hypot(p0.x - lastPt.x, p0.y - lastPt.y) < 1e-3;
    if (!cont) {
      if (curSub && curSub.nodes.length > 1) {
        const first = curSub.nodes[0];
        const last = curSub.nodes[curSub.nodes.length - 1];
        if (curSub.nodes.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-3) {
          curSub.nodes.pop();
          curSub.closed = true;
        }
      }
      curSub = { nodes: [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }], closed: false };
      let list = byLayer.get(li);
      if (!list) {
        list = [];
        byLayer.set(li, list);
      }
      list.push(curSub);
    } else {
      curSub!.nodes.push({ x: p1.x, y: p1.y });
    }
    lastPt = p1;
    lastLayer = li;
  }
  if (curSub && curSub.nodes.length > 1) {
    const first = curSub.nodes[0];
    const last = curSub.nodes[curSub.nodes.length - 1];
    if (curSub.nodes.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-3) {
      curSub.nodes.pop();
      curSub.closed = true;
    }
  }

  // Bei relativen Jobs (oder wenn Punkte im Negativen liegen) in den Arbeitsbereich rücken
  if (dec.startFrom !== 'absolute') {
    let minX = Infinity,
      minY = Infinity;
    for (const subs of byLayer.values()) {
      for (const sp of subs) {
        for (const n of sp.nodes) {
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
        }
      }
    }
    if (isFinite(minX) && isFinite(minY)) {
      const dx = 10 - minX;
      const dy = 10 - minY;
      for (const subs of byLayer.values()) {
        for (const sp of subs) {
          for (const n of sp.nodes) {
            n.x += dx;
            n.y += dy;
          }
        }
      }
    }
  }

  const objs: Obj[] = [];
  for (const [li, subs] of byLayer.entries()) {
    for (const sp of subs) {
      objs.push({
        id: newId(),
        m: [...IDENT],
        layer: li,
        shape: { kind: 'path', subs: [sp] },
      });
    }
  }

  return { objs, layers, assets: {}, texts: [], notes: [] };
}
