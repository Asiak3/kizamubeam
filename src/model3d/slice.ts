// Ebene ∩ Netz: Querschnitte eines 3D-Modells als geschlossene Konturen. Ohne DOM.
//
// Das Modell wird in ein Achsensystem (u, v, w) gebracht: w ist die Schichtrichtung, (u, v) die Ebene einer
// Scheibe. Jedes Dreieck, das die Höhe h kreuzt, liefert eine Strecke zwischen zwei Kantenpunkten. Weil die
// Ecken verschweißt sind, haben Nachbardreiecke an der gemeinsamen Kante denselben Punkt (Schlüssel = Kante);
// so lassen sich die Strecken exakt zu Schleifen verketten. Eine Ecke genau auf h zählt als „darüber“, damit
// keine doppelten Punkte entstehen.
import ClipperLib from 'clipper-lib';
import type { Pt } from '../model';
import type { Mesh } from './mesh';
import { worldOf } from './world';

import { signedArea } from './polys';
export { deepestPoint, inside, intervalsAtX, intervalsInBand, regionArea } from './polys';

export type V3 = [number, number, number];
export const SCALE = 1000;
/** Schlüssel für gerichtete Strecken: von · DIRK + nach */
const DIRK = 1 << 26;
type IntPath = ClipperLib.Path;

export interface Prepared {
  /** Koordinaten jeder Ecke im Achsensystem (mm) */
  X: Float64Array;
  Y: Float64Array;
  Z: Float64Array;
  tri: Uint32Array;
  /** Ausdehnung im Achsensystem */
  min: V3;
  max: V3;
  /** Dreiecke nach kleinster Höhe sortiert, mit kleinster und größter Höhe */
  order: Uint32Array;
  zlo: Float64Array;
  zhi: Float64Array;
}

/** Netz im Achsensystem: Punkt p (Welt) → (p·u, p·v, p·w); world(p) bringt Modellkoordinaten in die Welt (mm) */
export function prepare(mesh: Mesh, world: (x: number, y: number, z: number) => V3, frame: { u: V3; v: V3; w: V3 }): Prepared {
  const nv = mesh.pos.length / 3;
  const X = new Float64Array(nv),
    Y = new Float64Array(nv),
    Z = new Float64Array(nv);
  const min: V3 = [Infinity, Infinity, Infinity],
    max: V3 = [-Infinity, -Infinity, -Infinity];
  const { u, v, w } = frame;
  for (let i = 0; i < nv; i++) {
    const p = world(mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]);
    X[i] = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    Y[i] = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
    Z[i] = p[0] * w[0] + p[1] * w[1] + p[2] * w[2];
    const c = [X[i], Y[i], Z[i]];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], c[k]);
      max[k] = Math.max(max[k], c[k]);
    }
  }
  const nt = mesh.tri.length / 3;
  const zlo = new Float64Array(nt),
    zhi = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = Z[mesh.tri[t * 3]],
      b = Z[mesh.tri[t * 3 + 1]],
      c = Z[mesh.tri[t * 3 + 2]];
    zlo[t] = Math.min(a, b, c);
    zhi[t] = Math.max(a, b, c);
  }
  const order = Uint32Array.from({ length: nt }, (_, i) => i).sort((p, q) => zlo[p] - zlo[q]);
  return { X, Y, Z, tri: mesh.tri, min, max, order, zlo, zhi };
}

/** The model as the 3D-model generators place it (worldOf: upright, scaled to size, centred) in the frame */
export const prepareFit = (mesh: Mesh, up: string, size: number, frame: { u: V3; v: V3; w: V3 }): Prepared => prepare(mesh, worldOf(mesh, up, size).world, frame);

export interface SliceResult {
  /** Geschlossene Schleifen (mm, Koordinaten u, v) */
  loops: Pt[][];
  /** Offene Ketten, die nicht geschlossen werden konnten (Löcher im Netz) */
  open: number;
  /**
   * Schleifen nach der Drehrichtung der Dreiecke ausgerichtet (außen gegen den Uhrzeigersinn, Löcher im
   * Uhrzeigersinn). Dann dürfen sich Schleifen überlappen (mehrere Körper ineinander, häufig bei STL-Dateien).
   * false bei uneinheitlich gedrehten Dreiecken: dann gilt Gerade-Ungerade.
   */
  oriented: boolean;
}

/** Erstes Dreieck in order, dessen kleinste Höhe > h ist */
function upper(P: Prepared, h: number): number {
  let lo = 0,
    hi = P.order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (P.zlo[P.order[mid]] <= h) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Querschnitt in Höhe h; offene Ketten mit Enden näher als gap werden geschlossen */
export function sliceAt(P: Prepared, h: number, gap = 0.5): SliceResult {
  const nv = P.X.length;
  const pts: Pt[] = [];
  const ptOf = new Map<number, number>();
  const adj: number[][] = [];
  const dir = new Map<number, number>();
  const point = (a: number, b: number): number => {
    const key = a < b ? a * nv + b : b * nv + a;
    let id = ptOf.get(key);
    if (id === undefined) {
      const za = P.Z[a],
        zb = P.Z[b];
      const s = (h - za) / (zb - za);
      id = pts.length;
      pts.push({ x: P.X[a] + (P.X[b] - P.X[a]) * s, y: P.Y[a] + (P.Y[b] - P.Y[a]) * s });
      adj.push([]);
      ptOf.set(key, id);
    }
    return id;
  };
  const end = upper(P, h);
  for (let k = 0; k < end; k++) {
    const t = P.order[k];
    if (P.zhi[t] < h) continue;
    const a = P.tri[t * 3],
      b = P.tri[t * 3 + 1],
      c = P.tri[t * 3 + 2];
    const sa = P.Z[a] >= h,
      sb = P.Z[b] >= h,
      sc = P.Z[c] >= h;
    if (sa === sb && sb === sc) continue;
    const cut: number[] = [];
    if (sa !== sb) cut.push(point(a, b));
    if (sb !== sc) cut.push(point(b, c));
    if (sc !== sa) cut.push(point(c, a));
    if (cut.length === 2 && cut[0] !== cut[1]) {
      adj[cut[0]].push(cut[1]);
      adj[cut[1]].push(cut[0]);
      // Richtung: Material links der Strecke, wenn die Dreiecke nach außen zeigen (d = w × n)
      const ux = P.X[b] - P.X[a],
        uy = P.Y[b] - P.Y[a],
        uz = P.Z[b] - P.Z[a],
        vx = P.X[c] - P.X[a],
        vy = P.Y[c] - P.Y[a],
        vz = P.Z[c] - P.Z[a];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz;
      const p0 = pts[cut[0]],
        p1 = pts[cut[1]];
      // Strecken der Länge null (Ecke genau auf h) stimmen nicht ab
      const dot = (p1.x - p0.x) * -ny + (p1.y - p0.y) * nx;
      if (Math.abs(dot) > 1e-12) dir.set(dot > 0 ? cut[0] * DIRK + cut[1] : cut[1] * DIRK + cut[0], 1);
    }
  }
  // Verketten: jeder Punkt hat bei einem dichten Netz genau zwei Nachbarn
  const used = new Uint8Array(pts.length);
  const rings: number[][] = [];
  const chains: number[][] = [];
  const walk = (start: number): number[] => {
    const chain = [start];
    used[start] = 1;
    let prev = -1,
      cur = start;
    for (;;) {
      const next = adj[cur].find((n) => n !== prev && !used[n]);
      if (next === undefined) break;
      used[next] = 1;
      chain.push(next);
      prev = cur;
      cur = next;
    }
    return chain;
  };
  // Offene Ketten zuerst von einem Ende aus, damit sie ganz erfasst werden
  for (let i = 0; i < pts.length; i++) if (!used[i] && adj[i].length === 1) chains.push(walk(i));
  for (let i = 0; i < pts.length; i++)
    if (!used[i] && adj[i].length) {
      const ch = walk(i);
      const last = ch[ch.length - 1];
      if (ch.length > 2 && adj[last].includes(ch[0])) rings.push(ch);
      else chains.push(ch);
    }
  // Offene Ketten aneinanderhängen bzw. schließen, wenn die Enden nahe beieinander liegen
  const pend = chains.filter((c) => c.length > 1);
  const dist = (i: number, j: number) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  let open = 0;
  while (pend.length) {
    const c = pend.pop()!;
    for (;;) {
      const e = c[c.length - 1];
      if (dist(e, c[0]) <= gap && c.length > 2) {
        rings.push(c);
        break;
      }
      let best = -1,
        bd = gap,
        rev = false;
      pend.forEach((d, i) => {
        const d0 = dist(d[0], e),
          d1 = dist(d[d.length - 1], e);
        if (d0 <= bd) (bd = d0), (best = i), (rev = false);
        if (d1 <= bd) (bd = d1), (best = i), (rev = true);
      });
      if (best < 0) {
        open++;
        break;
      }
      const d = pend.splice(best, 1)[0];
      c.push(...(rev ? d.reverse() : d));
    }
  }
  // Ausrichten: Jede Strecke stimmt ab, ob die Schleife in Dreiecksrichtung läuft
  let oriented = rings.length > 0;
  let total = 0;
  const loops: Pt[][] = [];
  for (const r of rings) {
    let vote = 0,
      known = 0;
    for (let k = 0; k < r.length; k++) {
      const i = r[k],
        j = r[(k + 1) % r.length];
      if (dir.has(i * DIRK + j)) vote++, known++;
      else if (dir.has(j * DIRK + i)) vote--, known++;
    }
    if (!known || Math.abs(vote) < 0.6 * known) oriented = false;
    const loop = (vote < 0 ? r.slice().reverse() : r).map((j) => pts[j]);
    total += signedArea(loop);
    loops.push(loop);
  }
  // Spiegelndes Achsensystem oder nach innen gedrehtes Netz: alles umdrehen
  if (oriented && total < 0) loops.forEach((l) => l.reverse());
  return { loops, open, oriented };
}

// ---------- Flächen ----------

const toInt = (loop: Pt[]): IntPath => loop.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }));

function clip(type: ClipperLib.ClipType, a: IntPath[], b: IntPath[], fill = ClipperLib.PolyFillType.pftEvenOdd): IntPath[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  const out: IntPath[] = [];
  c.Execute(type, out, fill, fill);
  return out;
}

/** Fläche aus Schleifen (Gerade-Ungerade, damit falsch gedrehte Dreiecke nicht stören) */
export const region = (loops: Pt[][]): IntPath[] => clip(ClipperLib.ClipType.ctUnion, loops.map(toInt), []);
/** Fläche eines Querschnitts: ausgerichtet mit Nonzero (überlappende Körper verschmelzen), sonst Gerade-Ungerade */
export const sliceRegion = (s: SliceResult): IntPath[] =>
  s.oriented ? clip(ClipperLib.ClipType.ctUnion, s.loops.map(toInt), [], ClipperLib.PolyFillType.pftNonZero) : region(s.loops);
export const unionRegions = (a: IntPath[], b: IntPath[]): IntPath[] => clip(ClipperLib.ClipType.ctUnion, a, b, ClipperLib.PolyFillType.pftNonZero);
export const intersectRegions = (a: IntPath[], b: IntPath[]): IntPath[] => clip(ClipperLib.ClipType.ctIntersection, a, b, ClipperLib.PolyFillType.pftNonZero);

/**
 * Inseln und Löcher unter minArea (mm²) entfernen. Fällt ein Loch weg, wird es gefüllt (samt Inseln darin);
 * fällt eine Insel weg, verschwindet sie mit ihren Löchern. Ergebnis: Außenkonturen und Löcher (mm).
 */
export function cleanRegion(paths: IntPath[], minArea: number): { polys: Pt[][]; islands: number } {
  if (!paths.length) return { polys: [], islands: 0 };
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const polys: Pt[][] = [];
  let islands = 0;
  const min = minArea * SCALE * SCALE;
  const visit = (node: ClipperLib.PolyNode, depth: number) => {
    for (const ch of node.Childs()) {
      const poly = ch.Contour();
      if (Math.abs(ClipperLib.Clipper.Area(poly)) < min) continue;
      const clean = ClipperLib.Clipper.CleanPolygon(poly, 0.01 * SCALE);
      if (clean.length < 3) continue;
      polys.push(clean.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
      if (depth % 2 === 0) islands++;
      visit(ch, depth + 1);
    }
  };
  visit(tree, 0);
  return { polys, islands };
}

/** Kontur um d nach außen (negativ: innen) versetzen, runde Ecken */
export function offsetRegion(paths: IntPath[], d: number): IntPath[] {
  if (!d) return paths;
  const co = new ClipperLib.ClipperOffset(2, 0.01 * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: IntPath[] = [];
  co.Execute(out, d * SCALE);
  return out;
}

// ---------- Für gesteckte Modelle (Rippen auf Rückgrat) ----------

/** a ohne b */
export const subtractRegions = (a: IntPath[], b: IntPath[]): IntPath[] =>
  b.length ? clip(ClipperLib.ClipType.ctDifference, a, b, ClipperLib.PolyFillType.pftNonZero) : a;

/** Einzelne Inseln (Außenkontur mit ihren Löchern), kleine Inseln und Löcher wie bei cleanRegion entfernt */
export function regionIslands(paths: IntPath[], minArea: number): Pt[][][] {
  if (!paths.length) return [];
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const min = minArea * SCALE * SCALE;
  const out: Pt[][][] = [];
  const conv = (poly: IntPath): Pt[] | null => {
    if (Math.abs(ClipperLib.Clipper.Area(poly)) < min) return null;
    const clean = ClipperLib.Clipper.CleanPolygon(poly, 0.01 * SCALE);
    return clean.length < 3 ? null : clean.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }));
  };
  // Tiefe 0: Inseln, 1: Löcher, 2: Inseln in Löchern (wieder eigene Inseln) …
  const visit = (node: ClipperLib.PolyNode) => {
    for (const isl of node.Childs()) {
      const outer = conv(isl.Contour());
      if (!outer) continue;
      const group = [outer];
      for (const hole of isl.Childs()) {
        const hp = conv(hole.Contour());
        if (hp) group.push(hp);
        visit(hole);
      }
      out.push(group);
    }
  };
  visit(tree);
  return out;
}

/** Vieleck (mm) als Fläche */
export const polyRegion = (pts: Pt[]): IntPath[] => [pts.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }))];

/** Kreis (mm) als Vieleck-Fläche */
export function circleRegion(c: Pt, r: number, n = 32): IntPath[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) });
  return polyRegion(pts);
}

/** Schlauch mit Radius r um einen offenen Linienzug (runde Enden) */
export function capsuleRegion(line: Pt[], r: number): IntPath[] {
  const co = new ClipperLib.ClipperOffset(2, 0.01 * SCALE);
  co.AddPath(line.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);
  const out: IntPath[] = [];
  co.Execute(out, r * SCALE);
  return out;
}

/** Schnittmenge zweier Flächen */
export const intersect = (a: IntPath[], b: IntPath[]): IntPath[] => (a.length && b.length ? intersectRegions(a, b) : []);
