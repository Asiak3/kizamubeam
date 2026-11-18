// Finger joints of box panels (box, drawer, finger box …): the outline of a panel whose four edges carry fingers or
// slots for the neighbouring panels. Pure geometry without texts, so the plugin host function joints (#398) runs it
// in the plugin Worker; box.ts uses it for the built-in generators.
import type { Pt } from '../model';

export type Pattern = 'A' | 'B' | 'flat';
export interface EdgeSpec {
  pattern: Pattern;
}
export interface PanelSpec {
  key: string;
  /** Breite (x) und Höhe (y) der Platte, Außenmaß */
  a: number;
  b: number;
  /** Kanten oben, rechts, unten, links */
  edges: [EdgeSpec, EdgeSpec, EdgeSpec, EdgeSpec];
  /** Besitzt die Platte ihre vier Eckwürfel? */
  corners: boolean;
}

/** Zahl der Felder zwischen den Ecken: größte ungerade Zahl, bei der ein Feld mindestens die Zinkenbreite hat */
export function fieldCount(len: number, finger: number): number {
  const n = Math.floor(len / finger);
  return Math.max(1, n % 2 ? n : n - 1);
}

interface Run {
  s0: number;
  s1: number;
  /** Material bis zum Rand (false = um die Materialdicke zurückgesetzt) */
  full: boolean;
  corner: boolean;
}

/**
 * Felder einer Kante der Länge L als Abschnitte (Ecke, Felder, Ecke), gleiche Nachbarn zusammengefasst, mit Spiel.
 * play: total play of the joint (#402): each finger gets play/2 narrower, each gap play/2 wider.
 */
export function edgeRuns(L: number, th: number, e: EdgeSpec, cornerFull: boolean, finger: number, play: number): Run[] {
  const n = fieldCount(L - 2 * th, finger);
  // An geraden Kanten liegt nur die Ecke der Nachbarplatte an: kein Steckspiel
  if (e.pattern === 'flat') play = 0;
  const w = (L - 2 * th) / n;
  const raw: Run[] = [{ s0: 0, s1: th, full: cornerFull, corner: true }];
  for (let i = 0; i < n; i++) {
    const full = e.pattern === 'flat' ? true : e.pattern === 'A' ? i % 2 === 0 : i % 2 === 1;
    raw.push({ s0: th + i * w, s1: th + (i + 1) * w, full, corner: false });
  }
  raw.push({ s0: L - th, s1: L, full: cornerFull, corner: true });
  const runs: Run[] = [];
  for (const r of raw) {
    const last = runs[runs.length - 1];
    if (last && last.full === r.full) {
      last.s1 = r.s1;
      last.corner ||= r.corner;
    } else runs.push({ ...r });
  }
  // Übergänge um ein Viertel des Gesamtspiels in das Materialfeld verschieben: jede Zinke wird an beiden Seiten so
  // viel schmaler, jede Lücke so viel breiter
  for (let i = 0; i + 1 < runs.length; i++) {
    const d = runs[i].full ? -play / 4 : play / 4;
    runs[i].s1 += d;
    runs[i + 1].s0 += d;
  }
  return runs;
}

/**
 * Umriss einer Platte (lokal 0..a × 0..b, y nach unten) ohne Schnittfuge: Rechteck minus die Bereiche, in denen die
 * Nachbarplatten liegen (jeder ausgesparte Abschnitt einer Kante = Rechteck mit der Materialdicke als Tiefe).
 * Gerechnet wird auf dem Raster aller Abschnittsgrenzen, der Rand der Materialzellen ergibt den Umriss.
 * play: total play of the joints (#402).
 */
export function panelOutline(P: PanelSpec, th: number, finger: number, play: number): Pt[] {
  const { a, b } = P;
  const C: Pt[] = [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: b }, { x: 0, y: b }];
  const U: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  // Richtung nach innen = Laufrichtung der nächsten Kante
  const N = [U[1], U[2], U[3], U[0]];
  const lens = [a, b, a, b];
  const at = (i: number, s: number, d: number): Pt => ({ x: C[i].x + U[i].x * s + N[i].x * d, y: C[i].y + U[i].y * s + N[i].y * d });
  const cuts: { x0: number; x1: number; y0: number; y1: number }[] = [];
  P.edges.forEach((e, i) => {
    const runs = edgeRuns(lens[i], th, e, P.corners, finger, play);
    // Negatives Steckspiel (Presspassung): Die Eckabschnitte beider Kanten werden kürzer und ließen ein
    // |Spiel|/4-Quadrat stehen, das unter der Nachbarwand liegt (Stufe/Überlappung). Die ausgesparte Ecke wird deshalb
    // als volles Quadrat weggeschnitten. Nur Muster A: Es beginnt mit einer Zinke, die Ecke ist ein eigener Abschnitt;
    // bei B ist sie mit dem ersten Feld verschmolzen. Bei positivem Spiel bleibt die Stufe bewusst erhalten: Sie ist
    // Bodenmaterial im Innenwinkel, das keine Wand abdeckt.
    if (play < 0 && !P.corners && e.pattern === 'A') {
      for (const s0 of [0, lens[i] - th]) {
        const p = at(i, s0, 0), q = at(i, s0 + th, th);
        cuts.push({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
      }
    }
    for (const r of runs) {
      if (r.full) continue;
      const p = at(i, r.s0, 0),
        q = at(i, r.s1, th);
      cuts.push({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
    }
  });
  const coords = (vals: number[]) => {
    const out: number[] = [];
    for (const v of vals.sort((u, w) => u - w)) if (!out.length || v - out[out.length - 1] > 1e-9) out.push(v);
    return out;
  };
  const xs = coords([0, a, ...cuts.flatMap((c) => [c.x0, c.x1])].map((v) => Math.min(a, Math.max(0, v))));
  const ys = coords([0, b, ...cuts.flatMap((c) => [c.y0, c.y1])].map((v) => Math.min(b, Math.max(0, v))));
  const nx = xs.length - 1,
    ny = ys.length - 1;
  // Cells whose centre lies inside a cut are empty. Marked per cut over its range of cells (binary search on the
  // sorted centres) instead of testing every cell against every cut: fine fingers give thousands of cuts.
  const cxs = xs.slice(1).map((x, i) => (xs[i] + x) / 2),
    cys = ys.slice(1).map((y, j) => (ys[j] + y) / 2);
  /** First index whose value is greater than v */
  const above = (vals: number[], v: number) => {
    let lo = 0,
      hi = vals.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (vals[m] > v) hi = m;
      else lo = m + 1;
    }
    return lo;
  };
  /** First index whose value is not less than v */
  const notBelow = (vals: number[], v: number) => {
    let lo = 0,
      hi = vals.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (vals[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const empty = new Uint8Array(nx * ny);
  for (const c of cuts) {
    const i0 = above(cxs, c.x0),
      i1 = notBelow(cxs, c.x1),
      j0 = above(cys, c.y0),
      j1 = notBelow(cys, c.y1);
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) empty[i * ny + j] = 1;
  }
  const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && !empty[i * ny + j];
  // Randkanten der Materialzellen im Uhrzeigersinn (y nach unten), Material jeweils rechts der Laufrichtung
  const next = new Map<string, [number, number][]>();
  const key = (i: number, j: number) => `${i},${j}`;
  const add = (i0: number, j0: number, i1: number, j1: number) => {
    const k = key(i0, j0);
    if (!next.has(k)) next.set(k, []);
    next.get(k)!.push([i1, j1]);
  };
  let count = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!solid(i, j)) continue;
      if (!solid(i, j - 1)) (add(i, j, i + 1, j), count++);
      if (!solid(i + 1, j)) (add(i + 1, j, i + 1, j + 1), count++);
      if (!solid(i, j + 1)) (add(i + 1, j + 1, i, j + 1), count++);
      if (!solid(i - 1, j)) (add(i, j + 1, i, j), count++);
    }
  // Ab der Ecke (0,0)-nächsten Randkante einmal herumlaufen; an Kreuzungen rechts abbiegen
  const startKey = [...next.keys()].sort((u, w) => {
    const [ui, uj] = u.split(',').map(Number),
      [wi, wj] = w.split(',').map(Number);
    return uj - wj || ui - wi;
  })[0];
  const pts: Pt[] = [];
  let [ci, cj] = startKey.split(',').map(Number);
  let dir: [number, number] = [0, -1];
  for (let guard = 0; guard <= count; guard++) {
    const outs = next.get(key(ci, cj));
    if (!outs?.length) break;
    // Kandidaten nach Abbiegung ordnen: rechts, geradeaus, links (y nach unten: rechts von (dx,dy) ist (-dy,dx))
    const turn = (o: [number, number]) => {
      const dx = o[0] - ci,
        dy = o[1] - cj;
      if (dx === -dir[1] && dy === dir[0]) return 0;
      if (dx === dir[0] && dy === dir[1]) return 1;
      return 2;
    };
    outs.sort((u, w) => turn(u) - turn(w));
    const o = outs.shift()!;
    pts.push({ x: xs[ci], y: ys[cj] });
    dir = [o[0] - ci, o[1] - cj];
    [ci, cj] = o;
    if (key(ci, cj) === startKey && !next.get(startKey)!.length) break;
  }
  return cleanup(pts);
}

/** Doppelte und auf einer Geraden liegende Punkte entfernen */
export function cleanup(input: Pt[]): Pt[] {
  let pts = input.filter((p, i) => {
    const q = input[(i + input.length - 1) % input.length];
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length],
        b = pts[i],
        c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9 || Math.hypot(b.x - c.x, b.y - c.y) < 1e-9) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Rechtwinkligen Umriss um d nach außen versetzen (exakt, Ecken bleiben scharf) */
export function offsetOrtho(pts: Pt[], d: number): Pt[] {
  if (!d) return pts;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  const sgn = area > 0 ? 1 : -1;
  // Außennormale einer Kante p→q
  const out = (p: Pt, q: Pt): Pt => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (sgn * (q.y - p.y)) / l, y: (-sgn * (q.x - p.x)) / l };
  };
  return pts.map((v, i) => {
    const a = pts[(i + pts.length - 1) % pts.length],
      c = pts[(i + 1) % pts.length];
    const n1 = out(a, v),
      n2 = out(v, c);
    return { x: v.x + (n1.x + n2.x) * d, y: v.y + (n1.y + n2.y) * d };
  });
}


/**
 * Outline of a panel centred on the origin (y down), with the kerf: what box panels are cut along. edges: top, right,
 * bottom, left. play: total play of the joints (#402).
 */
export function panelCut(P: PanelSpec, th: number, finger: number, play: number, kerf: number): Pt[] {
  return offsetOrtho(panelOutline(P, th, finger, play), kerf / 2).map((q) => ({ x: q.x - P.a / 2, y: q.y - P.b / 2 }));
}
