// Doppelte Schnittlinien beim Export (Issue #221): deckungsgleiche oder kollinear
// überlappende Spannen werden vor Kerf/Tabs/Perfo/Lead/Order zusammengefasst.
// Gleiche Erkennungsparameter wie die Konstruktionsprüfung (src/check.ts):
// Abtastung alle ~0,25 mm, Toleranz (Standard 0,05 mm), Tangenten-Kreuzprodukt ≤ 0,2,
// nur gegen frühere Konturen, ganz = ≥98 % Deckung, Mindestlänge max(0,5, 2·st).
// Arbeitet auf flachen Polys in Bettkoordinaten (Kurven sind bereits geflattet).
import type { Pt } from './model';

export interface DedupPoly {
  pts: Pt[];
  closed: boolean;
  fixed?: boolean;
  hole?: boolean;
  off?: Uint8Array;
}

export interface DedupResult {
  polys: DedupPoly[];
  /** entfernte/geopferte Bahnlänge in mm */
  len: number;
  /** entfernte Spannen (Bettkoordinaten) für die Vorschau-Markierung */
  lines: Pt[][];
}

const STEP = 0.25;
const MAX_SAMPLES = 200000;

function cumOf(pts: Pt[], closed: boolean): { cum: number[]; len: number } {
  const cum = [0];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n];
    cum.push(cum[cum.length - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { cum, len: cum[cum.length - 1] };
}

function ptAt(pts: Pt[], cum: number[], len: number, closed: boolean, a: number): Pt {
  a = Math.max(0, Math.min(len, a));
  let lo = 0,
    hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const f = seg > 0 ? (a - cum[lo]) / seg : 0;
  const p = pts[lo % pts.length],
    q = pts[hi % pts.length];
  void closed;
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
}

function spanLine(pts: Pt[], cum: number[], len: number, closed: boolean, a0: number, a1: number): Pt[] {
  if (closed && a1 < a0) return [...spanLine(pts, cum, len, closed, a0, len), ...spanLine(pts, cum, len, closed, 0, a1).slice(1)];
  const out = [ptAt(pts, cum, len, closed, a0)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > a0 && cum[i] < a1) out.push(pts[i]);
  out.push(ptAt(pts, cum, len, closed, a1));
  return out;
}

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const f = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * f, p.y - a.y - dy * f);
}

/** Läufe aufeinanderfolgender Treffer (bei geschlossenen über den Anfang) */
function runs(flags: boolean[], closed: boolean): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < flags.length && flags[j + 1]) j++;
    out.push([i, j]);
    i = j + 1;
  }
  if (closed && out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === flags.length - 1) {
    const last = out.pop()!;
    out[0] = [last[0], out[0][1] + flags.length];
  }
  return out;
}

/** Raster über alle Segmente (Zelle 2 mm, wie im Check) */
class SegGrid {
  private map = new Map<number, number[]>();
  private segA: Pt[] = [];
  private segB: Pt[] = [];
  private segC: number[] = [];
  constructor(
    all: Pt[][],
    private cell = 2,
  ) {
    all.forEach((pts, c) => {
      if (pts.length < 2) return;
      for (let i = 0; i + 1 < pts.length; i++) {
        const id = this.segA.length;
        this.segA.push(pts[i]);
        this.segB.push(pts[i + 1]);
        this.segC.push(c);
        const a = pts[i],
          b = pts[i + 1];
        this.addBox(id, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
      }
    });
  }
  private k(gx: number, gy: number) {
    return gx * 73856093 + gy * 19349663;
  }
  private addBox(id: number, x0: number, y0: number, x1: number, y1: number) {
    for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++)
      for (let gy = Math.floor(y0 / this.cell); gy <= Math.floor(y1 / this.cell); gy++) {
        const key = this.k(gx, gy);
        const l = this.map.get(key);
        if (l) l.push(id);
        else this.map.set(key, [id]);
      }
  }
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const out = new Set<number>();
    for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++)
      for (let gy = Math.floor(y0 / this.cell); gy <= Math.floor(y1 / this.cell); gy++) for (const id of this.map.get(this.k(gx, gy)) ?? []) out.add(id);
    return [...out];
  }
  seg(id: number): { a: Pt; b: Pt; c: number } {
    return { a: this.segA[id], b: this.segB[id], c: this.segC[id] };
  }
}

/**
 * Doppelte Linien in flachen Polys zusammenfassen.
 * - Ganze Doppel (≥98 % Deckung): spätere Kontur fällt weg.
 * - Teil-Überlappung: Spanne wird aus der späteren Kontur entfernt (Rest bleibt,
 *   geschlossen→offen wie beim manuellen Fix in check.ts). Bei Kerf ≠ 0 werden
 *   Teilspannen behalten (Versatz verschiebt die Deckung), nur ganze fallen.
 * Fix-Start: hatte eine gedroppte Kontur `fixed` und die überlebende nicht,
 * wandert das Flag auf die überlebende (nächster Punkt ist pts[0]-nah genug,
 * die Feinposition regelt orderPolys/startAt).
 */
export function dedupPolys(polys: DedupPoly[], tol: number, kerf = 0): DedupResult {
  const t = Math.max(0.01, Math.min(0.5, tol || 0.05));
  const n = polys.length;
  if (n < 2) return { polys: polys.map((p) => ({ ...p, pts: p.pts.map((q) => ({ ...q })) })), len: 0, lines: [] };
  const cums = polys.map((p) => cumOf(p.pts, p.closed));
  const total = cums.reduce((s, c) => s + c.len, 0);
  const step = Math.max(STEP, total / MAX_SAMPLES);
  const grid = new SegGrid(polys.map((p) => p.closed && p.pts.length > 2 ? [...p.pts, p.pts[0]] : p.pts));
  const drop = new Array<boolean>(n).fill(false);
  const spans: [number, number][][] = polys.map(() => []);
  const spanLines: Pt[][][] = polys.map(() => []);
  let len = 0;
  const lines: Pt[][] = [];
  // pro Poly der Haupt-Überlappungspartner (für Fix-Start-Übertrag)
  const partner = new Array<number>(n).fill(-1);

  for (let c = 0; c < n; c++) {
    const p = polys[c];
    const { cum, len: L } = cums[c];
    if (L < 1e-9) continue;
    const m = Math.max(1, Math.round(L / step));
    const st = L / m;
    const hit: number[] = new Array(m).fill(-1);
    for (let k = 0; k < m; k++) {
      const at = (k + 0.5) * st;
      // Punkt + Tangente an der Bogenlänge
      const pos = ptAt(p.pts, cum, L, p.closed, at);
      const a2 = ptAt(p.pts, cum, L, p.closed, Math.min(L, at + st / 2));
      const b2 = ptAt(p.pts, cum, L, p.closed, Math.max(0, at - st / 2));
      const dl = Math.hypot(a2.x - b2.x, a2.y - b2.y) || 1e-12;
      const dx = (a2.x - b2.x) / dl,
        dy = (a2.y - b2.y) / dl;
      let best = -1;
      for (const id of grid.query(pos.x - t, pos.y - t, pos.x + t, pos.y + t)) {
        const s = grid.seg(id);
        if (s.c >= c || drop[s.c]) continue;
        const l = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        if (l < 1e-9) continue;
        const cross = Math.abs(dx * (s.b.y - s.a.y) - dy * (s.b.x - s.a.x)) / l;
        if (cross > 0.2) continue;
        if (distSeg(pos, s.a, s.b) > t) continue;
        if (s.c > best) best = s.c;
      }
      hit[k] = best;
    }
    const flags = hit.map((h) => h >= 0);
    const covered = flags.filter(Boolean).length;
    const full = covered >= m * 0.98;
    const rs = runs(flags, p.closed);
    if (full) {
      drop[c] = true;
      // Hauptpartner = häufigster Treffer
      const cnt = new Map<number, number>();
      for (const h of hit) if (h >= 0) cnt.set(h, (cnt.get(h) ?? 0) + 1);
      let bi = -1,
        bn = 0;
      for (const [k, v] of cnt) if (v > bn) [bn, bi] = [v, k];
      partner[c] = bi;
      len += L;
      lines.push(p.closed ? [...p.pts.map((q) => ({ ...q })), { ...p.pts[0] }] : p.pts.map((q) => ({ ...q })));
      continue;
    }
    for (const [i0, i1] of rs) {
      const runLen = (i1 - i0 + 1) * st;
      if (runLen < Math.max(0.5, 2 * st)) continue;
      if (kerf !== 0) continue; // Teil bei Kerf behalten (Versatz!), nur ganze droppen
      let a0 = (i0 % m) * st,
        a1 = ((i1 % m) + 1) * st;
      // an die Enden offener Linien heranziehen
      if (!p.closed && a0 < st) a0 = 0;
      if (!p.closed && (i1 % m) === m - 1) a1 = L;
      if (p.closed) {
        a0 = (i0 * st) % L;
        a1 = a0 + runLen;
        if (a1 > L) a1 = a1 % L; // wird als Wrap gespeichert (a1 < a0)
      }
      spans[c].push([a0, Math.min(a1, L)]);
      spanLines[c].push(spanLine(p.pts, cum, L, p.closed, a0, a1));
      partner[c] = hit[i0 % m];
      len += runLen;
      lines.push(spanLines[c][spanLines[c].length - 1]);
    }
  }

  // Fix-Start-Übertrag: gedroppte ganze Kontur → überlebender Partner
  for (let c = 0; c < n; c++) {
    if (!drop[c] || !polys[c].fixed) continue;
    const o = partner[c];
    if (o >= 0 && !drop[o] && !polys[o].fixed) polys[o].fixed = true;
  }
  // fällt die Kette um (Partner auch gedroppt), Flag auf erste überlebende retten
  if (polys.some((p, i) => p.fixed && drop[i])) {
    const anySurvivorFixed = polys.some((p, i) => p.fixed && !drop[i]);
    if (!anySurvivorFixed) {
      const first = polys.findIndex((_, i) => !drop[i]);
      if (first >= 0) polys[first].fixed = true;
    }
  }

  // Teilspannen anwenden: Reststücke behalten (geschlossen→offen bei Anschnitt)
  const out: DedupPoly[] = [];
  for (let c = 0; c < n; c++) {
    if (drop[c]) continue;
    const p = polys[c];
    const sp = spans[c];
    if (!sp.length) {
      out.push({ ...p, pts: p.pts.map((q) => ({ ...q })), off: p.off ? Uint8Array.from(p.off) : undefined });
      continue;
    }
    const { cum, len: L } = cums[c];
    // Wrap-Spannen (a1 < a0 bei geschlossen) aufteilen
    const list: [number, number][] = [];
    for (const [a, b] of sp) {
      if (p.closed && b < a) list.push([a, L], [0, b]);
      else list.push([Math.max(0, a), Math.min(L, b)]);
    }
    list.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const s of list) {
      const l = merged[merged.length - 1];
      if (l && s[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], s[1]);
      else merged.push([...s]);
    }
    // Komplement = behalten
    const keep: [number, number][] = [];
    if (p.closed) {
      if (merged.length === 1 && merged[0][0] <= 1e-9 && merged[0][1] >= L - 1e-9) continue; // de facto ganz
      for (let i = 0; i < merged.length; i++) {
        const from = merged[i][1];
        const to = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + L;
        if (to - from > 1e-6) keep.push([from, to > L ? to - L : to]);
      }
    } else {
      let at = 0;
      for (const [a, b] of merged) {
        if (a - at > 1e-6) keep.push([at, a]);
        at = b;
      }
      if (L - at > 1e-6) keep.push([at, L]);
    }
    let hadFixed = !!p.fixed;
    for (const [a, b] of keep) {
      // enthält das Stück den Originalstart (Bogenlänge 0)?
      const containsStart = p.closed ? (b < a ? true : a <= 1e-9) : a <= 1e-9;
      const pts = spanLine(p.pts, cum, L, p.closed, a, b);
      // doppelte Schlusspunkte bei offenen Stücken vermeiden
      const fixed = hadFixed && containsStart;
      if (fixed) hadFixed = false;
      if (pts.length >= 2) out.push({ pts, closed: false, ...(fixed ? { fixed: true } : {}) });
    }
    // Start lag in entfernter Spanne: Flag auf längstes Reststück retten
    if (hadFixed && out.length) {
      const last = out[out.length - 1];
      if (!last.fixed) last.fixed = true;
    }
  }
  return { polys: out, len, lines };
}
