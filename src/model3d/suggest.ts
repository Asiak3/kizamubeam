// Vorschlag für die Abschnitte eines Rippenmodells (Etappe R3, Plan steckmodelle/plan-rippenmodell.md).
//
// Das Modell wird in ein grobes Raster aus Würfeln (Voxel) zerlegt. Darauf:
//  1. Spiegelebene: senkrecht zu X oder Y, dort, wo das gespiegelte Raster am besten auf sich selbst passt.
//     Sie wird die Ebene des Rumpf-Rückgrats.
//  2. Beine: Eine Schicht knapp über dem Boden zerfällt in Inseln. Jede wird Schicht für Schicht nach oben
//     verfolgt (Mittelpunkt je Schicht), bis sie mit einer anderen verschmilzt oder deutlich breiter wird: Dort
//     beginnt der Rumpf. Schräge Beine folgen so ihrer Richtung.
//  3. Rumpf, Kopf, Schwanz: Das übrige Modell, auf die Spiegelebene projiziert, wird zu einer Mittellinie
//     ausgedünnt; der längste Weg darauf ist die Hauptachse. Dünne Stücke an ihren Enden (Schwanz, Hals) werden
//     eigene Abschnitte mit gebogener Achse.
// Ganz automatisch für jedes Netz ist das nicht zuverlässig; der Vorschlag ist ein Startpunkt zum Korrigieren.
import { t, tn } from '../i18n';
import type { Mesh } from './mesh';
import type { V3 } from './slice';
import { ribsLayout, worldMesh, type Section, type View } from '../generators/ribs';
import type { Params } from '../generators/types';

export interface Suggestion {
  sections: Section[];
  /** Kurze Beschreibung, was gefunden wurde */
  found: string;
}

interface Grid {
  nx: number;
  ny: number;
  nz: number;
  vs: number;
  lo: V3;
  v: Uint8Array;
}

/** Netz als Voxel-Raster (Gerade-Ungerade je Säule entlang Z); n Zellen entlang der längsten Seite */
export function voxelize(m: Mesh, n = 72): Grid {
  const lo: V3 = [Infinity, Infinity, Infinity],
    hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3)
    for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], m.pos[i + k])), (hi[k] = Math.max(hi[k], m.pos[i + k]));
  const vs = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6) / n;
  const nx = Math.max(1, Math.ceil((hi[0] - lo[0]) / vs)),
    ny = Math.max(1, Math.ceil((hi[1] - lo[1]) / vs)),
    nz = Math.max(1, Math.ceil((hi[2] - lo[2]) / vs));
  const cols: number[][] = Array.from({ length: nx * ny }, () => []);
  // Säulen leicht versetzt, damit sie selten genau eine Kante oder Ecke treffen
  const ex = 0.5 + 1.234e-4,
    ey = 0.5 + 2.345e-4;
  const P = m.pos,
    T = m.tri;
  for (let f = 0; f < T.length; f += 3) {
    const a = T[f] * 3,
      b = T[f + 1] * 3,
      c = T[f + 2] * 3;
    const x0 = P[a], y0 = P[a + 1], z0 = P[a + 2];
    const x1 = P[b], y1 = P[b + 1], z1 = P[b + 2];
    const x2 = P[c], y2 = P[c + 1], z2 = P[c + 2];
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(x0, x1, x2) - lo[0]) / vs - ex)),
      i1 = Math.min(nx - 1, Math.floor((Math.max(x0, x1, x2) - lo[0]) / vs - ex));
    const j0 = Math.max(0, Math.ceil((Math.min(y0, y1, y2) - lo[1]) / vs - ey)),
      j1 = Math.min(ny - 1, Math.floor((Math.max(y0, y1, y2) - lo[1]) / vs - ey));
    for (let i = i0; i <= i1; i++) {
      const x = lo[0] + (i + ex) * vs;
      for (let j = j0; j <= j1; j++) {
        const y = lo[1] + (j + ey) * vs;
        const u = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / det;
        const w = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / det;
        if (u < 0 || w < 0 || u + w > 1) continue;
        cols[i + nx * j].push(z0 + u * (z1 - z0) + w * (z2 - z0));
      }
    }
  }
  const v = new Uint8Array(nx * ny * nz);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const zs = cols[i + nx * j].sort((p, q) => p - q).filter((z, k, arr) => k === 0 || z - arr[k - 1] > 1e-6);
      for (let k = 0; k + 1 < zs.length; k += 2) {
        const k0 = Math.max(0, Math.ceil((zs[k] - lo[2]) / vs - 0.5)),
          k1 = Math.min(nz - 1, Math.floor((zs[k + 1] - lo[2]) / vs - 0.5));
        for (let kk = k0; kk <= k1; kk++) v[i + nx * (j + ny * kk)] = 1;
      }
    }
  return { nx, ny, nz, vs, lo, v };
}

/** Zusammenhängende Inseln (8er-Nachbarschaft) einer 2D-Maske */
function components(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const x = c % w,
        y = (c - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = xx + w * yy;
          if (mask[q] && !seen[q]) (seen[q] = 1), stack.push(q);
        }
    }
    out.push(comp);
  }
  return out;
}

/** Linienzug vereinfachen (Douglas-Peucker) */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const rec = (a: number, b: number) => {
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1,
      bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > bd) (bd = d), (best = i);
    }
    if (best >= 0) {
      keep[best] = 1;
      rec(a, best);
      rec(best, b);
    }
  };
  rec(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}

/** Ausdünnen zur Mittellinie (Zhang-Suen) */
function thin(src: Uint8Array, w: number, h: number): Uint8Array {
  const m = src.slice();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[x + w * y]);
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const del: number[] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!m[x + w * y]) continue;
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          const B = p.reduce((s, v) => s + v, 0);
          if (B < 2 || B > 6) continue;
          let A = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
          if (A !== 1) continue;
          if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          del.push(x + w * y);
        }
      for (const d of del) m[d] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

/** Abstand jeder Zelle zum Rand (Zellen, 3-4-Chamfer) */
function distance(mask: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 1e9 : 0;
  const relax = (i: number, j: number, c: number) => {
    if (d[j] + c < d[i]) d[i] = d[j] + c;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = x + w * y;
      if (!d[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) d[i] = Math.min(d[i], 3);
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) relax(i, i - w, 3);
      if (x > 0 && y > 0) relax(i, i - w - 1, 4);
      if (x < w - 1 && y > 0) relax(i, i - w + 1, 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = x + w * y;
      if (!d[i]) continue;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) relax(i, i + w, 3);
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, 4);
      if (x > 0 && y < h - 1) relax(i, i + w - 1, 4);
    }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

/** Längster Weg auf der Mittellinie (zweimal Breitensuche) */
function longestPath(sk: Uint8Array, w: number, h: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < w * h; i++) if (sk[i]) cells.push(i);
  if (!cells.length) return [];
  const bfs = (s: number) => {
    const prev = new Int32Array(w * h).fill(-2);
    prev[s] = -1;
    const q = [s];
    let last = s;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      last = c;
      const x = c % w,
        y = (c - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const n = xx + w * yy;
          if (sk[n] && prev[n] === -2) (prev[n] = c), q.push(n);
        }
    }
    return { last, prev };
  };
  // Größte zusammenhängende Mittellinie: vom ersten Punkt aus, dann vom entferntesten
  let best: number[] = [];
  const done = new Uint8Array(w * h);
  for (const c of cells) {
    if (done[c]) continue;
    const a = bfs(c);
    for (let i = 0; i < w * h; i++) if (a.prev[i] !== -2) done[i] = 1;
    const b = bfs(a.last);
    const path: number[] = [];
    for (let k = b.last; k >= 0; k = b.prev[k]) path.push(k);
    if (path.length > best.length) best = path;
  }
  return best;
}

/** Abschnitte für das Modell vorschlagen (Maße wie im Generator: aufrecht, skaliert) */
export function suggestSections(raw: Mesh, p: Params): Suggestion {
  const thickness = Number(p.thickness) || 3;
  const { mesh } = worldMesh(raw, String(p.up), Number(p.size));
  const G = voxelize(mesh);
  const { nx, ny, nz, vs, lo, v } = G;
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const cx = (i: number) => lo[0] + (i + 0.5) * vs,
    cy = (j: number) => lo[1] + (j + 0.5) * vs,
    cz = (k: number) => lo[2] + (k + 0.5) * vs;
  let total = 0;
  for (let i = 0; i < v.length; i++) total += v[i];
  if (!total) return { sections: [], found: t('Im Modell wurde kein Körper gefunden.') };

  // ---- 1. Spiegelebene senkrecht zu X oder Y ----
  const occList: number[] = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (v[idx(i, j, k)]) occList.push(i, j, k);
  const occ = Int16Array.from(occList);
  let mirror = { axis: 1, K: ny - 1, score: -1 };
  for (const axis of [0, 1]) {
    const n = axis === 0 ? nx : ny;
    for (let K = Math.round(n * 0.6); K <= Math.round(n * 1.4); K++) {
      let hit = 0;
      for (let q = 0; q < occ.length; q += 3) {
        const i = occ[q],
          j = occ[q + 1],
          k = occ[q + 2];
        const mi = axis === 0 ? K - i : i,
          mj = axis === 1 ? K - j : j;
        if (mi >= 0 && mj >= 0 && mi < nx && mj < ny && v[idx(mi, mj, k)]) hit++;
      }
      const score = hit / total;
      if (score > mirror.score + 1e-9) mirror = { axis, K, score };
    }
  }
  // Keine deutliche Symmetrie: Ebene quer zur kürzeren waagerechten Seite, durch die Mitte
  if (mirror.score < 0.55) mirror = nx >= ny ? { axis: 1, K: ny - 1, score: 0 } : { axis: 0, K: nx - 1, score: 0 };
  const ma = mirror.axis; // Normale der Spiegelebene: 0 = X, 1 = Y
  const view: View = ma === 1 ? 'xz' : 'yz';
  const planeOff = lo[ma] + (mirror.K / 2 + 0.5) * vs;
  const along = (i: number, j: number) => (ma === 1 ? cx(i) : cy(j)); // Koordinate in der Ebene (waagerecht)
  const across = (i: number, j: number) => (ma === 1 ? cy(j) : cx(i)); // quer zur Ebene
  const r1 = (x: number) => Math.round(x * 10) / 10;

  // ---- 2. Beine vom Boden aus ----
  const layer = (k: number) => {
    const m = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) m[i + nx * j] = v[idx(i, j, k)];
    return m;
  };
  const legVox = new Uint8Array(v.length);
  const sections: Section[] = [];
  const legs: { pts: [number, number][]; off: number; top: number; cells: number[] }[] = [];
  const k0 = Math.min(nz - 1, 1);
  const feet = components(layer(k0), nx, ny).filter((c) => c.length >= 2);
  if (feet.length >= 2) {
    type Track = { cells: Set<number>; path: { a: number; z: number; o: number }[]; areas: number[]; alive: boolean; vox: number[][] };
    const tracks: Track[] = feet.map((c) => ({ cells: new Set(c), path: [], areas: [], alive: true, vox: [] }));
    const centroid = (c: number[]) => {
      let a = 0,
        o = 0;
      for (const q of c) {
        const i = q % nx,
          j = (q - i) / nx;
        a += along(i, j);
        o += across(i, j);
      }
      return { a: a / c.length, o: o / c.length };
    };
    for (let k = k0; k < nz && tracks.some((tr) => tr.alive); k++) {
      const comps = components(layer(k), nx, ny);
      const owner = new Map<number, number[]>(); // Insel → Beine, die in ihr weiterlaufen
      tracks.forEach((tr, ti) => {
        if (!tr.alive) return;
        let bestC = -1,
          bestN = 0;
        comps.forEach((c, ci) => {
          let n = 0;
          for (const q of c) if (tr.cells.has(q)) n++;
          if (n > bestN) (bestN = n), (bestC = ci);
        });
        if (bestC < 0) return void (tr.alive = false);
        owner.set(bestC, [...(owner.get(bestC) ?? []), ti]);
      });
      for (const [ci, tis] of owner) {
        const c = comps[ci];
        for (const ti of tis) {
          const tr = tracks[ti];
          const med = tr.areas.length ? [...tr.areas].sort((p, q) => p - q)[tr.areas.length >> 1] : c.length;
          // Verschmolzen oder viel breiter: hier beginnt der Rumpf
          if (tis.length > 1 || (tr.areas.length > 2 && c.length > 2.5 * med + 4)) {
            tr.alive = false;
            continue;
          }
          const cc = centroid(c);
          tr.path.push({ a: cc.a, z: cz(k), o: cc.o });
          tr.areas.push(c.length);
          tr.cells = new Set(c);
          tr.vox.push(c.map((q) => q + nx * ny * k));
        }
      }
    }
    for (const tr of tracks) {
      const hgt = tr.path.length * vs;
      // Ein „Bein“, das bis fast oben reicht oder nie in einen Rumpf mündet, ist keines
      if (tr.path.length < 3 || tr.alive || hgt > 0.85 * nz * vs) continue;
      const off = tr.path.reduce((s, q) => s + q.o, 0) / tr.path.length;
      // Achse von oben (Rumpf) nach unten bis zum Boden
      const pts = simplify(
        tr.path.map((q) => [q.a, q.z] as [number, number]).reverse(),
        Math.max(vs, 0.05 * hgt),
      );
      pts[pts.length - 1] = [pts[pts.length - 1][0], lo[2]];
      legs.push({ pts, off, top: tr.path[tr.path.length - 1].z, cells: tr.vox.flat() });
    }
    if (legs.length < 2) legs.length = 0;
    for (const l of legs) for (const q of l.cells) legVox[q] = 1;
  }

  // ---- 3. Hauptachse in der Spiegelebene ----
  const W = ma === 1 ? nx : ny;
  const H = nz;
  const proj = new Uint8Array(W * H);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const q = idx(i, j, k);
        if (v[q] && !legVox[q]) proj[(ma === 1 ? i : j) + W * k] = 1;
      }
  // Nur die größte Fläche
  const pc = components(proj, W, H).sort((a, b) => b.length - a.length);
  const body = new Uint8Array(W * H);
  for (const q of pc[0] ?? []) body[q] = 1;
  const dist = distance(body, W, H);
  const path = longestPath(thin(body, W, H), W, H);
  const P2 = (q: number): [number, number] => {
    const a = q % W,
      k = (q - a) / W;
    return [lo[ma === 1 ? 0 : 1] + (a + 0.5) * vs, cz(k)];
  };
  if (path.length >= 2) {
    const rad = path.map((q) => dist[q]);
    const rBody = [...rad].sort((p, q) => p - q)[Math.floor(rad.length * 0.8)] || 1;
    // Dünne Enden (Schwanz, Hals) abtrennen
    const thinAt = (i: number) => rad[i] < 0.45 * rBody;
    let s = 0,
      e = path.length - 1;
    while (s < path.length - 1 && thinAt(s)) s++;
    while (e > s && thinAt(e)) e--;
    const minRun = Math.max(4, Math.round((3 * thickness) / vs));
    const tailA = s >= minRun ? path.slice(0, s + 1) : null;
    const tailB = path.length - 1 - e >= minRun ? path.slice(e) : null;
    const bodyPath = path.slice(tailA ? s : 0, tailB ? e + 1 : path.length);
    // Enden der Mittellinie liegen um den Radius im Inneren: dort verlängern
    const extendEnds = (pts: [number, number][], r0: number, r1: number, atStart: boolean, atEnd: boolean) => {
      if (pts.length < 2) return pts;
      const out = pts.map((q) => [q[0], q[1]] as [number, number]);
      const push = (i: number, j: number, r: number) => {
        const dx = out[i][0] - out[j][0],
          dy = out[i][1] - out[j][1];
        const L = Math.hypot(dx, dy) || 1;
        out[i] = [out[i][0] + (dx / L) * r, out[i][1] + (dy / L) * r];
      };
      if (atStart) push(0, 1, r0);
      if (atEnd) push(out.length - 1, out.length - 2, r1);
      return out;
    };
    const mk = (cells: number[], tolK: number, startFree: boolean, endFree: boolean) => {
      const pts = simplify(cells.map(P2), Math.max(1.5 * vs, tolK * cells.length * vs));
      return extendEnds(pts, dist[cells[0]] * vs, dist[cells[cells.length - 1]] * vs, startFree, endFree).map((q) => [r1(q[0]), r1(q[1])] as [number, number]);
    };
    // Rumpf: gerade Achse entlang der Hauptrichtung der Fläche (ohne dünne Enden); eine geknickte Mittellinie
    // ließe die Rippen in der Biegung aneinanderstoßen
    const tails = [tailA && [...tailA].reverse(), tailB].filter((x): x is number[] => !!x);
    // Jede Zelle gehört zum nächsten Punkt der Mittellinie (Breitensuche von allen Punkten aus)
    const label = new Int32Array(W * H).fill(-1);
    const queue: number[] = [];
    path.forEach((q, i) => ((label[q] = i), queue.push(q)));
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      const ca = c % W,
        ck = (c - ca) / W;
      for (const [da, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a2 = ca + da,
          k2 = ck + dk;
        if (a2 < 0 || k2 < 0 || a2 >= W || k2 >= H) continue;
        const n2 = a2 + W * k2;
        if (body[n2] && label[n2] < 0) (label[n2] = label[c]), queue.push(n2);
      }
    }
    const bs = tailA ? s : 0,
      be = tailB ? e : path.length - 1;
    const bc: [number, number][] = [];
    for (let q = 0; q < W * H; q++) if (body[q] && label[q] >= bs && label[q] <= be) bc.push(P2(q));
    if (bc.length < 3) for (const q of bodyPath) bc.push(P2(q));
    const mx = bc.reduce((s2, q) => s2 + q[0], 0) / bc.length,
      my = bc.reduce((s2, q) => s2 + q[1], 0) / bc.length;
    let sxx = 0,
      sxy = 0,
      syy = 0;
    for (const [x, y] of bc) (sxx += (x - mx) ** 2), (sxy += (x - mx) * (y - my)), (syy += (y - my) ** 2);
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let dx = Math.cos(ang),
      dy = Math.sin(ang);
    // Fast waagerecht oder senkrecht: gerade ausrichten
    if (Math.abs(dy) < 0.12) (dx = Math.sign(dx) || 1), (dy = 0);
    else if (Math.abs(dx) < 0.12) (dx = 0), (dy = 1);
    let t0 = Infinity,
      t1 = -Infinity;
    for (const [x, y] of bc) {
      const u = (x - mx) * dx + (y - my) * dy;
      t0 = Math.min(t0, u);
      t1 = Math.max(t1, u);
    }
    t0 -= vs / 2;
    t1 += vs / 2;
    sections.push({ name: t('Rumpf'), view, pts: [[r1(mx + dx * t0), r1(my + dy * t0)], [r1(mx + dx * t1), r1(my + dy * t1)]], offset: r1(planeOff), spacing: 0, radius: 0, extend: 0 });
    tails.forEach((c, i) => {
      const name = tails.length > 1 ? t('Ende {n}', { n: i + 1 }) : t('Schwanz');
      // Reicht ein Stück in den Rumpf, damit das Rückgrat zusammenhängt
      sections.push({ name, view, pts: mk(c, 0.03, false, true), offset: r1(planeOff), spacing: 0, radius: 0, extend: r1(Math.max(2 * thickness, (rBody * vs) / 2)) });
    });
  }
  const legSecs = new Set<Section>();
  legs.sort((p, q) => p.pts[0][0] - q.pts[0][0] || p.off - q.off);
  legs.forEach((l, i) => {
    // Beinplatte reicht bis an die Rumpf-Achse, damit sie in den Rumpf-Rippen steckt
    const top = l.pts[0];
    const rumpf = sections.find((x) => x.name === t('Rumpf'));
    let extend = 3 * thickness;
    if (rumpf) {
      const [[ax, ay], [bx, by]] = rumpf.pts;
      const u = bx !== ax ? (top[0] - ax) / (bx - ax) : 0.5;
      const zAxis = ay + Math.max(0, Math.min(1, u)) * (by - ay);
      extend = Math.max(3 * thickness, Math.min(80, zAxis - top[1]));
    }
    const leg: Section = { name: t('Bein {n}', { n: i + 1 }), view, pts: l.pts.map((q) => [r1(q[0]), r1(q[1])] as [number, number]), offset: r1(l.off), spacing: 0, radius: 0, extend: r1(extend) };
    sections.push(leg);
    legSecs.add(leg);
  });
  // Abschnitte ohne eine Rippe mit Halt (z. B. ein Ohr als „Schwanz“) wieder weglassen
  let secs = sections;
  if (p.model)
    for (let round = 0; round < 2 && secs.length > 1; round++) {
      const L = ribsLayout({ ...p, sections: JSON.stringify(secs) });
      if (!L?.manual) break;
      const keep = secs.filter((_, i) => i === 0 || (L.sections[i]?.ribs ?? 0) > 0);
      if (keep.length === secs.length) break;
      secs = keep;
    }
  const nLegs = secs.filter((x) => legSecs.has(x)).length;
  const found = secs.filter((x) => !legSecs.has(x)).map((x) => x.name);
  if (nLegs) found.push(tn('{n} Bein', '{n} Beine', nLegs));
  return { sections: secs, found: found.join(', ') };
}
