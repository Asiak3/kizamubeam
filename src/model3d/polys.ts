// Pure helpers on polygons (mm): area, point inside, deepest point, intervals along a line. No Clipper, so plugins
// that slice through host functions (plugins/core/slice-host.ts) can bundle them cheaply.
import type { Pt } from '../model';

/** Fläche eines Konturensatzes (Gerade-Ungerade, mm²) */
export function signedArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y;
  return s / 2;
}

export function regionArea(polys: Pt[][]): number {
  let a = 0;
  for (const p of polys) {
    let s = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y;
    a += s / 2;
  }
  return Math.abs(a);
}

/** Liegt q innerhalb (Gerade-Ungerade)? */
export function inside(polys: Pt[][], q: Pt): boolean {
  let c = false;
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j],
        b = p[i];
      if (a.y > q.y !== b.y > q.y && q.x < a.x + ((q.y - a.y) * (b.x - a.x)) / (b.y - a.y)) c = !c;
    }
  return c;
}

/** Abstand von q zum nächsten Rand */
function edgeDist(polys: Pt[][], q: Pt): number {
  let d = Infinity;
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j],
        b = p[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l = dx * dx + dy * dy;
      const s = l ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l)) : 0;
      d = Math.min(d, Math.hypot(q.x - a.x - s * dx, q.y - a.y - s * dy));
    }
  return d;
}

/** Punkt im Inneren mit größtem Abstand zum Rand (für die Nummer), grob gerastert und zweimal verfeinert */
export function deepestPoint(polys: Pt[][]): { p: Pt; r: number } | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of polys)
    for (const q of p) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  if (!isFinite(x0)) return null;
  let best: { p: Pt; r: number } | null = null;
  let cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    hw = (x1 - x0) / 2,
    hh = (y1 - y0) / 2;
  for (let round = 0; round < 3; round++) {
    const n = 20;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const q = { x: cx - hw + (2 * hw * i) / n, y: cy - hh + (2 * hh * j) / n };
        if (!inside(polys, q)) continue;
        const r = edgeDist(polys, q);
        // Near-ties keep the first point, so engines that differ in the last bit pick the same one (plugins)
        if (!best || r > best.r + 1e-9) best = { p: q, r };
      }
    if (!best) return null;
    cx = best.p.x;
    cy = best.p.y;
    hw /= 5;
    hh /= 5;
  }
  return best;
}

/** Abschnitte (y von, y bis) einer senkrechten Linie bei x, die im Inneren liegen (Gerade-Ungerade), aufsteigend */
export function intervalsAtX(polys: Pt[][], x: number): [number, number][] {
  const ys: number[] = [];
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j],
        b = p[i];
      if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x));
    }
  ys.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 1e-9) out.push([ys[i], ys[i + 1]]);
  return out;
}

/** Wie intervalsAtX, aber über einen Streifen der Breite 2·half: Material irgendwo im Streifen zählt (Vereinigung) */
export function intervalsInBand(polys: Pt[][], half: number): [number, number][] {
  const all = [-1, -0.5, 0, 0.5, 1].flatMap((k) => intervalsAtX(polys, k * half * 0.999)).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const iv of all) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}
