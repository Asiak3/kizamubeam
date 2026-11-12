// Baugruppe „Rippenmodell“: ein eingelesenes 3D-Modell (STL/OBJ) als Rippen (Spanten), die mit Halbschlitzen auf
// Rückgraten stecken (Plan steckmodelle/plan-rippenmodell.md).
//
// Das Modell besteht aus Abschnitten (Rumpf, Beine, Schwanz …). Jeder Abschnitt hat eine Achse (Linienzug, auch
// gebogen), die in einer Ebene liegt, der Ebene seines Rückgrats. Die Rippen stehen senkrecht zur Achse, also
// auch senkrecht zum Rückgrat. Ohne eigene Abschnitte (Parameter „sections“ leer) gibt es einen einzigen geraden
// Abschnitt aus „Achse“ und „Rückgrat steht“ (Etappe R1).
//
// Je Rippe: T = Achsrichtung am Rippenort, N = Normale des Rückgrats, D = N × T (in der Rückgrat-Ebene, quer zur
// Achse). Rippe in der Ebene: (x, y) = (N, −D). Wo eine Rippe ein Rückgrat senkrecht kreuzt und beide Material
// haben, wird die gemeinsame Strecke halbiert: Die Rippe wird von der −L-Seite geschlitzt, das Rückgrat von der
// +L-Seite (L = D beim eigenen Rückgrat, sonst die Schnittgerade nach oben gerichtet). Die Rippen werden also von
// oben aufgesetzt, Beinplatten von unten in die Rumpf-Rippen geschoben.
//
// Abschnitte grenzen sich gegenseitig ab: Eine Rippe verliert, was im Schlauch (Radius r, flache Enden) um die Achse
// eines anderen Abschnitts liegt, und wird auf einen Kreis mit ihrem eigenen r begrenzt. Rückgrate gleicher Ebene werden ein Teil;
// jedes Rückgrat reicht nur so weit wie der Schlauch um seine Achsen (an den Enden um „Rückgrat verlängern“ länger,
// damit z. B. die Beinplatte in den Rumpf reicht).
import type { Pt, SubPath } from '../model';
import { t, tn } from '../i18n';
import { fitPolyline } from '../fit';
import { arrangeParts } from './build';
import type { Generator, GenPart, Issue, Params, PlanSheet } from './types';
import { getMesh } from '../model3d/store';
import type { Mesh } from '../model3d/mesh';
import {
  capsuleRegion, circleRegion, cleanRegion, region, inside, intersect, intervalsAtX, intervalsInBand, offsetRegion, polyRegion, prepare, Prepared, regionArea,
  regionIslands, sliceAt, sliceRegion, subtractRegions, unionRegions, V3,
} from '../model3d/slice';
import { numberStrokes, numberWidth, placeNumber, worldOf } from './stack';

export interface RibsParams {
  model: string;
  name: string;
  sections: string;
  up: string;
  axis: string;
  spineDir: string;
  size: number;
  thickness: number;
  spacing: number;
  /** Kleinster Abstand an Stellen, wo sich der Umriss schnell ändert (0 = überall gleich) */
  minSpacing: number;
  spineInset: number;
  spineOffset: number;
  play: number;
  numbers: boolean;
  numberSize: number;
  minArea: number;
  kerf: number;
  maxPlate: number;
  plan: boolean;
}

/** Ansicht, in der eine Achse gezeichnet ist: Ebene (e1, e2), Normale n */
export type View = 'xz' | 'yz' | 'xy';
export const VIEWS: Record<View, { e1: V3; e2: V3; n: V3 }> = {
  xz: { e1: [1, 0, 0], e2: [0, 0, 1], n: [0, 1, 0] },
  yz: { e1: [0, 1, 0], e2: [0, 0, 1], n: [1, 0, 0] },
  xy: { e1: [1, 0, 0], e2: [0, 1, 0], n: [0, 0, 1] },
};

/** Ein Abschnitt, wie er im Parameter „sections“ (JSON) steht; Maße in mm im skalierten Modell */
export interface Section {
  name: string;
  view: View;
  /** Achse in der Ansicht (e1, e2) */
  pts: [number, number][];
  /** Lage der Ebene entlang der Normalen der Ansicht */
  offset: number;
  /** Rippenabstand; 0 = wie im Dialog */
  spacing: number;
  /** Radius des Gebiets um die Achse; 0 = automatisch */
  radius: number;
  /** Rückgrat an beiden Enden über die Achse hinaus verlängern */
  extend: number;
}

const P = (p: Params) => p as unknown as RibsParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

const UNIT: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lin = (u: V3, x: number, v: V3, y: number, w: V3, z: number): V3 => add(add([u[0] * x, u[1] * x, u[2] * x], v, y), w, z);

/** Richtung des Rückgrats; fällt sie mit der Achse zusammen, nimmt es „oben“ (bei senkrechter Achse „vorne“) */
export const spineDirOf = (axis: string, dir: string) => (dir !== axis ? dir : axis === 'z' ? 'y' : 'z');

/** Abschnitte aus dem Parameter lesen (fehlerhafte Einträge fallen weg); null bei kaputtem JSON */
export function parseSections(s: string): Section[] | null {
  if (!s) return [];
  try {
    const raw = JSON.parse(s);
    if (!Array.isArray(raw)) return null;
    const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
    return raw
      .filter((x) => x && Array.isArray(x.pts))
      .map((x, i) => ({
        name: typeof x.name === 'string' && x.name ? x.name : t('Abschnitt {n}', { n: i + 1 }),
        view: (['xz', 'yz', 'xy'].includes(x.view) ? x.view : 'xz') as View,
        pts: (x.pts as unknown[])
          .filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && q.every((v) => typeof v === 'number' && isFinite(v)))
          .map((q) => [q[0], q[1]] as [number, number]),
        offset: num(x.offset, 0),
        spacing: Math.max(0, num(x.spacing, 0)),
        radius: Math.max(0, num(x.radius, 0)),
        extend: Math.max(0, num(x.extend, 0)),
      }));
  } catch {
    return null;
  }
}

export interface RibPart {
  key: string;
  /** Abschnitt (Index) einer Rippe; −1 beim Rückgrat */
  section: number;
  /** Inseln (Außenkontur + Löcher) in Teilkoordinaten, mm, mit Schnittfuge */
  polys: Pt[][];
  /** Lage im Raum: o + x·u + y·v + s·n (s = 0 … Dicke) */
  pose: { o: V3; u: V3; v: V3; n: V3 };
  /** Zusätzliche Gravuren (Schlitzmarken am Rückgrat) in denselben Koordinaten */
  extra?: SubPath[];
  /** Rückgrat: Nummern der Rippen, die darin stecken, und die Abschnitte, zu denen es gehört */
  slots?: number[];
  secs?: number[];
  /** Rückgrat: geteilt, weil länger als „Platten teilen ab“ (Schwalbenschwanz) */
  piece?: boolean;
}

export interface SectionInfo {
  name: string;
  /** Rippen mit Halt und Rippenorte insgesamt */
  ribs: number;
  count: number;
  /** Radius des Gebiets (mm; Infinity = unbegrenzt) */
  radius: number;
  /** Rippen stoßen in einer Biegung aneinander */
  bend: boolean;
  /** Achse in Weltkoordinaten (für die Ansicht im Dialog) */
  axis: V3[];
  /** Ansicht und Lage der Ebene (für „von Hand festlegen“) */
  view: View;
  offset: number;
}

export interface RibsLayout {
  dims: V3;
  ribs: RibPart[];
  spine: RibPart[];
  sections: SectionInfo[];
  /** true, wenn die Abschnitte von Hand festgelegt sind */
  manual: boolean;
  /** Rippen ohne Kreuzung mit einem Rückgrat (weggelassen) */
  lostRibs: number;
  /** Stücke von Rippen ohne Halt (weggelassen) */
  lostPieces: number;
  /** Rippenorte insgesamt (vor dem Weglassen) */
  count: number;
  open: number;
  /** Fehler in den Abschnitten (z. B. Achse mit weniger als zwei Punkten) */
  bad: string[];
}

const cache = new Map<string, RibsLayout | null>();

/** Zerlegung in Rippen und Rückgrate (zwischengespeichert); null, wenn das Modell fehlt */
export function ribsLayout(raw: Params): RibsLayout | null {
  const p = P(raw);
  const key = [p.model, p.sections, p.up, p.axis, p.spineDir, p.size, p.thickness, p.spacing, p.minSpacing, p.spineInset, p.spineOffset, p.play, p.minArea, p.kerf, p.numbers, p.numberSize, p.maxPlate].join('|');
  if (cache.has(key)) return cache.get(key)!;
  const mesh = p.model ? getMesh(p.model) : null;
  if (!mesh) return null;
  const out = compute(p, mesh);
  if (cache.size > 8) cache.clear();
  cache.set(key, out);
  return out;
}

/** Modell in Weltkoordinaten (aufrecht, skaliert), wie es der Generator schneidet */
export function worldMesh(mesh: Mesh, up: string, size: number): { mesh: Mesh; dims: V3 } {
  const { world, dims } = worldOf(mesh, up, size);
  const pos = new Float32Array(mesh.pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const q = world(mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]);
    pos[i] = q[0];
    pos[i + 1] = q[1];
    pos[i + 2] = q[2];
  }
  return { mesh: { pos, tri: mesh.tri }, dims };
}

/** Abschnitte [t0, t1] mit Material entlang des Strahls o + t·d (Gerade-Ungerade über alle Dreiecke) */
export function materialAlong(m: Mesh, o: V3, d: V3): [number, number][] {
  const ts: number[] = [];
  for (let i = 0; i < m.tri.length; i += 3) {
    const a = m.tri[i] * 3,
      b = m.tri[i + 1] * 3,
      c = m.tri[i + 2] * 3;
    const A: V3 = [m.pos[a], m.pos[a + 1], m.pos[a + 2]];
    const e1 = sub([m.pos[b], m.pos[b + 1], m.pos[b + 2]], A),
      e2 = sub([m.pos[c], m.pos[c + 1], m.pos[c + 2]], A);
    const pv = cross(d, e2);
    const det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) continue;
    const tv = sub(o, A);
    const u = dot(tv, pv) / det;
    if (u < 0 || u > 1) continue;
    const qv = cross(tv, e1);
    const v = dot(d, qv) / det;
    if (v < 0 || u + v > 1) continue;
    ts.push(dot(e2, qv) / det);
  }
  ts.sort((x, y) => x - y);
  // Treffer auf gemeinsamen Kanten zählen nur einmal
  const uniq = ts.filter((v, i) => i === 0 || v - ts[i - 1] > 1e-6);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < uniq.length; i += 2) out.push([uniq[i], uniq[i + 1]]);
  return out;
}

interface Sec {
  name: string;
  /** Achse in Welt-mm */
  pts: V3[];
  /** Normale des Rückgrats (so gewählt, dass D in der Mitte nach oben zeigt) */
  N: V3;
  view: View;
  spacing: number;
  radius: number;
  extend: number;
  /** Bogenlänge an den Punkten */
  cum: number[];
}

const at = (s: Sec, l: number): V3 => {
  const L = s.cum[s.cum.length - 1];
  l = Math.max(0, Math.min(L, l));
  let i = 1;
  while (i < s.cum.length - 1 && s.cum[i] < l) i++;
  const seg = s.cum[i] - s.cum[i - 1] || 1;
  return add(s.pts[i - 1], sub(s.pts[i], s.pts[i - 1]), (l - s.cum[i - 1]) / seg);
};
const tangent = (s: Sec, l: number, d: number): V3 => {
  const L = s.cum[s.cum.length - 1];
  return norm(sub(at(s, Math.min(L, l + d)), at(s, Math.max(0, l - d))));
};

/** Gerade „nach oben“ richten: z, bei waagerechter Lage nach vorne (−y), sonst +x */
function upward(L: V3): V3 {
  if (Math.abs(L[2]) > 0.1) return L[2] > 0 ? L : neg(L);
  if (Math.abs(L[1]) > 0.1) return L[1] < 0 ? L : neg(L);
  return L[0] > 0 ? L : neg(L);
}

interface Rib {
  sec: number;
  /** Abstand zur nächsten Rippe des Abschnitts (für die Schlitzmarken) */
  gap: number;
  P: V3;
  T: V3;
  D: V3;
  N: V3;
  h: number;
}

function compute(p: RibsParams, rawMesh: Mesh, skip = new Set<number>()): RibsLayout {
  const { mesh, dims } = worldMesh(rawMesh, p.up, p.size);
  const th = p.thickness;
  const w = th + p.play;
  const hold = Math.min(0.5, th / 2);
  const bad: string[] = [];
  let open = 0;

  // Vorbereitete Netze je Schnittrichtung (gerade Abschnitte teilen sich eines)
  const preps = new Map<string, Prepared>();
  const ident = (x: number, y: number, z: number): V3 => [x, y, z];
  const prep = (f: { u: V3; v: V3; w: V3 }) => {
    const k = [...f.u, ...f.v, ...f.w].map((v) => v.toFixed(6)).join(',');
    let q = preps.get(k);
    if (!q) {
      if (preps.size > 64) preps.clear();
      q = prepare(mesh, ident, f);
      preps.set(k, q);
    }
    return q;
  };
  const sliceIn = (f: { u: V3; v: V3; w: V3 }, h: number) => {
    const q = prep(f);
    if (h < q.min[2] || h > q.max[2]) return [];
    const sl = sliceAt(q, Math.min(q.max[2] - 0.01, Math.max(q.min[2] + 0.01, h)));
    open += sl.open;
    return sliceRegion(sl);
  };
  type Region = ReturnType<typeof sliceIn>;

  // ---- Abschnitte ----
  const parsed = parseSections(p.sections);
  if (parsed === null) bad.push(t('Die Abschnitte sind beschädigt; es gilt die einfache Achse.'));
  const secs: Sec[] = [];
  for (const s of parsed ?? []) {
    const V = VIEWS[s.view];
    const pts = s.pts.map((q) => lin(V.e1, q[0], V.e2, q[1], V.n, s.offset));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
    if (pts.length < 2 || cum[cum.length - 1] < th) {
      bad.push(t('Abschnitt „{name}“: Die Achse braucht mindestens zwei Punkte mit Abstand.', { name: s.name }));
      continue;
    }
    const sec: Sec = { name: s.name, pts, N: V.n, view: s.view, spacing: s.spacing || p.spacing, radius: s.radius, extend: s.extend, cum };
    // D = N × T soll in der Mitte nach oben zeigen
    const len = cum[cum.length - 1];
    const Dm = cross(sec.N, tangent(sec, len / 2, len / 2));
    if (dot(upward(Dm), Dm) < 0) sec.N = neg(sec.N);
    secs.push(sec);
  }
  const manual = secs.length > 0;
  if (!manual) {
    // Einfache Achse (R1): gerade über die ganze Länge, Rückgrat in der Mitte (± Versatz)
    const A = UNIT[p.axis] ?? UNIT.x;
    const D = UNIT[spineDirOf(p.axis, p.spineDir)] ?? UNIT.z;
    const N = cross(A, D);
    const lo: V3 = [Infinity, Infinity, Infinity],
      hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.pos.length; i += 3)
      for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], mesh.pos[i + k])), (hi[k] = Math.max(hi[k], mesh.pos[i + k]));
    const range = (v: V3) => [Math.min(dot(v, lo), dot(v, hi)), Math.max(dot(v, lo), dot(v, hi))];
    const mid = (v: V3) => (range(v)[0] + range(v)[1]) / 2;
    const [a0, a1] = range(A);
    const [n0, n1] = range(N);
    const nOff = Math.min(n1 - 0.01, Math.max(n0 + 0.01, mid(N) + p.spineOffset));
    const base = lin(D, mid(D), N, nOff, A, 0);
    const view: View = Math.abs(N[1]) > 0.5 ? 'xz' : Math.abs(N[0]) > 0.5 ? 'yz' : 'xy';
    secs.push({ name: t('Rumpf'), pts: [add(base, A, a0), add(base, A, a1)], N, view, spacing: p.spacing, radius: Infinity, extend: 0, cum: [0, a1 - a0] });
  }

  // ---- Rippenorte ----
  const ribs: Rib[] = [];
  const secRibs: number[][] = secs.map(() => []);
  // Standfläche: Endet eine Achse steil am Boden (Pfote, Hals), liegt die unterste Rippe genau auf dem Boden
  let floor = Infinity;
  for (let i = 2; i < mesh.pos.length; i += 3) floor = Math.min(floor, mesh.pos[i]);
  // Abstände: gleichmäßig oder (mit „Dichter an Details“) dichter, wo sich die Größe des Querschnitts schnell
  // ändert. Gerechnet wird in C(l) = ∫ 1/Abstand dl; die Rippen liegen dort, wo C ganzzahlig weiterzählt.
  const minSp = Number(p.minSpacing) || 0;
  const density = (s: Sec, len: number): { C: (l: number) => number; inv: (c: number) => number } => {
    const lin0 = { C: (l: number) => l / s.spacing, inv: (c: number) => c * s.spacing };
    if (!(minSp > 0 && minSp < s.spacing - 1e-6) || len < 2 * minSp) return lin0;
    const n = Math.max(8, Math.min(s.pts.length > 2 ? 40 : 240, Math.ceil(len / Math.max(0.5, minSp / 2))));
    const ls: number[] = [],
      rs: number[] = [];
    for (let i = 0; i <= n; i++) {
      const l = (len * i) / n;
      const q = at(s, l);
      const T = tangent(s, l, Math.min(s.spacing / 2, len / 2));
      const Tp = norm(add(T, s.N, -dot(T, s.N)));
      const f = { u: s.N, v: neg(cross(s.N, Tp)), w: Tp };
      const c = { x: dot(q, f.u), y: dot(q, f.v) };
      const isl = regionIslands(sliceIn(f, dot(q, Tp)), p.minArea).find((x) => inside(x, c));
      ls.push(l);
      rs.push(isl ? Math.sqrt(regionArea(isl) / Math.PI) : 0);
    }
    // Erlaubter Sprung im Umriss zwischen zwei Rippen; bei voller Steigung (45°) rücken sie auf 30 % zusammen
    const e = 0.3 * s.spacing;
    const raw = ls.map((_, i) => {
      const a = Math.max(0, i - 1),
        b = Math.min(n, i + 1);
      const slope = Math.abs(rs[b] - rs[a]) / (ls[b] - ls[a] || 1);
      return Math.max(minSp, Math.min(s.spacing, e / Math.max(slope, 1e-9)));
    });
    // Ein Detail wirkt auch auf die Nachbarschaft (bis zum halben Abstand), sonst springt eine Rippe darüber
    const hs = raw.map((h0, i) => {
      let h = h0;
      for (let j = 0; j <= n; j++) if (Math.abs(ls[j] - ls[i]) <= Math.max(h0, raw[j]) / 2) h = Math.min(h, raw[j]);
      return h;
    });
    const cs = [0];
    for (let i = 1; i <= n; i++) cs.push(cs[i - 1] + ((ls[i] - ls[i - 1]) * (1 / hs[i] + 1 / hs[i - 1])) / 2);
    const C = (l: number) => {
      if (l <= 0) return l / hs[0];
      if (l >= len) return cs[n] + (l - len) / hs[n];
      const k = Math.min(n - 1, Math.floor((l / len) * n));
      return cs[k] + ((cs[k + 1] - cs[k]) * (l - ls[k])) / (ls[k + 1] - ls[k]);
    };
    const inv = (c: number) => {
      if (c <= 0) return c * hs[0];
      if (c >= cs[n]) return len + (c - cs[n]) * hs[n];
      let k = 0;
      while (k < n - 1 && cs[k + 1] < c) k++;
      return ls[k] + ((ls[k + 1] - ls[k]) * (c - cs[k])) / (cs[k + 1] - cs[k] || 1);
    };
    return { C, inv };
  };
  secs.forEach((s, si) => {
    const len = s.cum[s.cum.length - 1];
    const { C, inv } = density(s, len);
    const grounded = (l: number) => {
      const tz = Math.abs(tangent(s, l, Math.min(s.spacing / 2, len / 2))[2]);
      return at(s, l)[2] <= floor + th && tz > 0.7 ? th / 2 / tz : -1;
    };
    const g0 = grounded(0),
      g1 = g0 < 0 ? grounded(len) : -1;
    const ca = C(th / 2),
      cb = C(len - th / 2);
    const ls: number[] = [];
    if (g0 >= 0) for (let c = C(g0); c <= cb + 1e-9 || !ls.length; c++) ls.push(inv(c));
    else if (g1 >= 0) {
      for (let c = C(len - g1); c >= ca - 1e-9 || !ls.length; c--) ls.push(inv(c));
    } else {
      const span = Math.max(0, cb - ca);
      const n = Math.floor(span + 1e-9) + 1;
      const c0 = ca + (span - (n - 1)) / 2;
      for (let i = 0; i < n; i++) ls.push(inv(c0 + i));
    }
    ls.forEach((l, i) => {
      const q = at(s, l);
      const T = tangent(s, l, Math.min(s.spacing / 2, len / 2));
      // T liegt in der Ebene; kleine Abweichungen herausrechnen
      const Tp = norm(add(T, s.N, -dot(T, s.N)));
      const gap = Math.min(i > 0 ? Math.abs(l - ls[i - 1]) : Infinity, i + 1 < ls.length ? Math.abs(ls[i + 1] - l) : Infinity);
      secRibs[si].push(ribs.length);
      ribs.push({ sec: si, gap: isFinite(gap) ? gap : s.spacing, P: q, T: Tp, D: cross(s.N, Tp), N: s.N, h: dot(q, Tp) });
    });
  });
  const ribFrame = (r: Rib) => ({ u: r.N, v: neg(r.D), w: r.T });
  const to2 = (f: { u: V3; v: V3 }, q: V3): Pt => ({ x: dot(q, f.u), y: dot(q, f.v) });

  // Querschnitte (ungeschnitten) einmal je Rippe
  const raw = ribs.map((r) => sliceIn(ribFrame(r), r.h));

  // ---- Radius je Abschnitt (nur bei mehreren) ----
  const multi = secs.length > 1;
  secs.forEach((s, si) => {
    if (!multi) return void (s.radius = Infinity);
    if (s.radius > 0) return;
    const rs: number[] = [];
    for (const ri of secRibs[si]) {
      const r = ribs[ri];
      const c = to2(ribFrame(r), r.P);
      for (const isl of regionIslands(raw[ri], p.minArea))
        if (inside(isl, c)) {
          let m = 0;
          for (const q of isl[0]) m = Math.max(m, Math.hypot(q.x - c.x, q.y - c.y));
          rs.push(m);
        }
    }
    rs.sort((a, b) => a - b);
    const med = rs.length ? rs[Math.floor(rs.length / 2)] : Math.max(...dims) / 4;
    s.radius = Math.max(2 * th, 1.3 * med);
  });

  // ---- Rückgrate: Abschnitte gleicher Ebene bilden ein Teil ----
  interface Group {
    secs: number[];
    u: V3;
    v: V3;
    n: V3;
    off: number;
    reg: Region;
    polys: Pt[][];
  }
  const groups: Group[] = [];
  secs.forEach((s, si) => {
    const off = dot(s.pts[0], s.N);
    const g = groups.find((x) => Math.abs(Math.abs(dot(x.n, s.N)) - 1) < 1e-6 && Math.abs(dot(s.pts[0], x.n) - x.off) < 0.5);
    if (g) return void g.secs.push(si);
    // Ebene: einfache Achse entlang der Achse (wie R1), sonst e1 der Ansicht; v = −oben
    let u: V3, v: V3;
    if (!manual) {
      u = norm(sub(s.pts[1], s.pts[0]));
      v = neg(cross(s.N, u));
    } else {
      u = VIEWS[s.view].e1;
      v = neg(VIEWS[s.view].e2);
    }
    groups.push({ secs: [si], u, v, n: s.N, off, reg: [], polys: [] });
  });
  for (const g of groups) {
    const f = { u: g.u, v: g.v, w: g.n };
    let reg = sliceIn(f, g.off);
    if (multi) {
      let caps: Region = [];
      for (const si of g.secs) {
        const s = secs[si];
        const line = s.pts.map((q) => to2(f, q));
        // Enden um „verlängern“ hinausziehen
        if (s.extend > 0) {
          const ext = (a: Pt, b: Pt): Pt => {
            const l = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            return { x: a.x + ((a.x - b.x) / l) * s.extend, y: a.y + ((a.y - b.y) / l) * s.extend };
          };
          line[0] = ext(line[0], line[1]);
          line[line.length - 1] = ext(line[line.length - 1], line[line.length - 2]);
        }
        caps = unionRegions(caps, capsuleRegion(line, s.radius));
      }
      reg = intersect(reg, caps);
    }
    g.reg = offsetRegion(reg, -p.spineInset);
    g.polys = cleanRegion(g.reg, p.minArea).polys;
  }

  // ---- Rippen mit Schlitzen ----
  // Schnittgerade in einem Teil: Ursprung c, Richtung dir (= +L), quer dazu perp. Koordinaten (X, Y) entlang perp/dir.
  type Line = { c: Pt; dir: Pt; perp: Pt };
  const lineIn = (f: { u: V3; v: V3 }, p0: V3, L: V3): Line => {
    const c = to2(f, p0);
    const dx = dot(L, f.u),
      dy = dot(L, f.v);
    const l = Math.hypot(dx, dy) || 1;
    return { c, dir: { x: dx / l, y: dy / l }, perp: { x: -dy / l, y: dx / l } };
  };
  const toLine = (ln: Line, polys: Pt[][]) =>
    polys.map((poly) => poly.map((q) => ({ x: (q.x - ln.c.x) * ln.perp.x + (q.y - ln.c.y) * ln.perp.y, y: (q.x - ln.c.x) * ln.dir.x + (q.y - ln.c.y) * ln.dir.y })));
  const fromLine = (ln: Line, X: number, Y: number): Pt => ({ x: ln.c.x + X * ln.perp.x + Y * ln.dir.x, y: ln.c.y + X * ln.perp.y + Y * ln.dir.y });
  const rect = (ln: Line, y0: number, y1: number) => polyRegion([fromLine(ln, -w / 2, y0), fromLine(ln, w / 2, y0), fromLine(ln, w / 2, y1), fromLine(ln, -w / 2, y1)]);

  const out: RibPart[] = [];
  const spineCuts: Region[] = groups.map(() => []);
  const spineHolds: Pt[][] = groups.map(() => []);
  const spineMarks: { ln: Line; m: number; y0: number; nr: number; spacing: number }[][] = groups.map(() => []);
  const keptBySec = secs.map(() => 0);
  // Rippen, deren Fläche ganz zu anderen Abschnitten gehört (z. B. Beinrippen im Rumpf): nicht nötig, nicht verloren
  const absorbed = secs.map(() => 0);
  const keptPolys: (Pt[][] | null)[] = ribs.map(() => null);
  let lostRibs = 0,
    lostPieces = 0;
  // Rippenort je Nummer (für Rippen, deren Rückgrat-Stück am Ende wegfällt)
  const nrToRib: number[] = [];
  ribs.forEach((r, ri) => {
    if (skip.has(ri)) {
      lostRibs++;
      return;
    }
    const f = ribFrame(r);
    let reg = raw[ri];
    if (multi && reg.length) {
      reg = intersect(reg, circleRegion(to2(f, r.P), secs[r.sec].radius, 48));
      // Gebiete der anderen Abschnitte abziehen: Kugeln entlang ihrer Achse, geschnitten mit der Rippenebene
      let other: Region = [];
      secs.forEach((s, si) => {
        if (si === r.sec) return;
        const L = s.cum[s.cum.length - 1];
        const step = Math.max(0.5, s.radius / 3);
        let own: Region = [];
        for (let l = 0; l <= L + 1e-9; l += step) {
          const q = at(s, l);
          const d = dot(q, r.T) - r.h;
          if (Math.abs(d) >= s.radius) continue;
          own = unionRegions(own, circleRegion(to2(f, q), Math.sqrt(s.radius * s.radius - d * d), 32));
        }
        // Flache Enden: Was hinter dem Ende der Achse liegt (z. B. der Schwanz hinter dem Rumpf), gehört nicht dazu
        for (const [l, sign] of [[0, 1], [L, -1]] as const) {
          if (!own.length) break;
          const T0 = tangent(s, l, Math.min(L / 2, s.radius / 2 || L / 2));
          const P0 = at(s, l);
          // sign·(a·X + b·Y + c) ≥ 0 in der Rippenebene
          const a = sign * dot(f.u, T0),
            b = sign * dot(f.v, T0),
            c = sign * (r.h * dot(r.T, T0) - dot(P0, T0));
          const nl = Math.hypot(a, b);
          if (nl < 1e-6) {
            if (c < 0) own = [];
            continue;
          }
          const nx = a / nl,
            ny = b / nl,
            d0 = -c / nl;
          const B = 1e4;
          own = intersect(own, polyRegion([
            { x: nx * d0 - ny * B, y: ny * d0 + nx * B },
            { x: nx * d0 + ny * B, y: ny * d0 - nx * B },
            { x: nx * (d0 + B) + ny * B, y: ny * (d0 + B) - nx * B },
            { x: nx * (d0 + B) - ny * B, y: ny * (d0 + B) + nx * B },
          ]));
        }
        if (own.length) other = unionRegions(other, own);
      });
      if (other.length) {
        const before = cleanRegion(reg, p.minArea).polys.length;
        reg = subtractRegions(reg, other);
        if (before && !cleanRegion(reg, p.minArea).polys.length) {
          absorbed[r.sec]++;
          return;
        }
      }
    }
    const polys = cleanRegion(reg, p.minArea).polys;
    const cuts: Region = [];
    const holds: Pt[] = [];
    const sCuts: { g: number; cut: Region; hold: Pt; mark: { ln: Line; m: number; y0: number } }[] = [];
    groups.forEach((g, gi) => {
      if (!polys.length || Math.abs(dot(r.T, g.n)) > 0.03) return;
      const own = g.secs.includes(r.sec);
      const L = own ? r.D : upward(norm(cross(r.T, g.n)));
      // Punkt auf beiden Ebenen: h·T + off·n (T ⟂ n)
      const p0 = add([r.T[0] * r.h, r.T[1] * r.h, r.T[2] * r.h], g.n, g.off);
      const lr = lineIn(f, p0, L);
      const ls = lineIn({ u: g.u, v: g.v }, p0, L);
      const rp = toLine(lr, polys);
      const sp = toLine(ls, g.polys);
      // Über die ganze Plattendicke: auch ein Rand, den die Mittelebene knapp verfehlt, braucht einen Schlitz
      const rIv = intervalsInBand(rp, th / 2);
      const sIv = intervalsInBand(sp, th / 2);
      for (const [r0, r1] of rIv)
        for (const [q0, q1] of sIv) {
          const c0 = Math.max(r0, q0),
            c1 = Math.min(r1, q1);
          if (c1 <= c0) continue;
          const prevR = [...rIv].reverse().find((iv) => iv[1] < r0)?.[1] ?? -Infinity;
          if (c1 - c0 < 2 * th) {
            // Zu kurz zum Stecken (z. B. Ende einer Beinplatte im Rumpf): Kerbe in der Rippe über die ganze Berührung
            cuts.push(...rect(lr, Math.max(reach(rp, w, (c0 + c1) / 2, r0, -1) - 0.5, (r0 + prevR) / 2), c1 + 0.2));
            continue;
          }
          const m = (c0 + c1) / 2;
          // Rippe: von ihrem Rand auf der −L-Seite bis zur Mitte (nicht in die nächste Insel davor)
          cuts.push(...rect(lr, Math.max(reach(rp, w, m, r0, -1) - 0.5, (r0 + prevR) / 2), m + 0.05));
          holds.push(fromLine(lr, 0, m + hold));
          // Rückgrat: von der Mitte bis zu seinem Rand auf der +L-Seite
          const nextS = sIv.find((iv) => iv[0] > q1)?.[0] ?? Infinity;
          const sEnd = Math.min(reach(sp, w, m, q1, 1) + 0.5, (q1 + nextS) / 2);
          sCuts.push({ g: gi, cut: rect(ls, m - 0.05, sEnd), hold: fromLine(ls, 0, m - hold), mark: { ln: ls, m, y0: q0 } });
        }
    });
    if (!holds.length) {
      lostRibs++;
      return;
    }
    const islands = regionIslands(offsetRegion(subtractRegions(reg, cuts), p.kerf / 2), p.minArea);
    const kept = islands.filter((isl) => holds.some((q) => inside(isl, q)));
    lostPieces += islands.length - kept.length;
    if (!kept.length) {
      lostRibs++;
      return;
    }
    const nr = out.length + 1;
    nrToRib[nr] = ri;
    for (const sc of sCuts) {
      spineCuts[sc.g].push(...sc.cut);
      spineHolds[sc.g].push(sc.hold);
      spineMarks[sc.g].push({ ...sc.mark, nr, spacing: r.gap });
    }
    const all = kept.flat();
    keptPolys[ri] = all;
    keptBySec[r.sec]++;
    const c = center(all);
    out.push({
      key: `R${nr}`,
      section: r.sec,
      polys: all.map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y }))),
      pose: { o: lin(f.u, c.x, f.v, c.y, r.T, r.h - th / 2), u: f.u, v: f.v, n: r.T },
    });
  });

  // ---- Biegungen: stoßen benachbarte Rippen innen aneinander? ----
  const bend = secs.map(() => false);
  secs.forEach((_s, si) => {
    const ids = secRibs[si];
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = ribs[ids[k]],
        b = ribs[ids[k + 1]];
      const theta = Math.acos(Math.max(-1, Math.min(1, dot(a.T, b.T))));
      if (theta < 0.02) continue;
      // Krümmungsmittelpunkt liegt in Richtung b.T − a.T, im Abstand R = Abstand / Winkel
      const R = Math.hypot(...sub(b.P, a.P)) / theta;
      const kdir = norm(sub(b.T, a.T));
      for (const [rib, polys] of [[a, keptPolys[ids[k]]], [b, keptPolys[ids[k + 1]]]] as [Rib, Pt[][] | null][]) {
        if (!polys) continue;
        const f = ribFrame(rib);
        const c = to2(f, rib.P);
        const kx = dot(kdir, f.u),
          ky = dot(kdir, f.v);
        let e = 0;
        for (const poly of polys) for (const q of poly) e = Math.max(e, (q.x - c.x) * kx + (q.y - c.y) * ky);
        if (e > R - th) bend[si] = true;
      }
    }
  });

  // ---- Rückgrate mit Schlitzen; nur Stücke, in denen Rippen stecken ----
  const spine: RibPart[] = [];
  groups.forEach((g, gi) => {
    if (!spineHolds[gi].length) return;
    const islands = regionIslands(offsetRegion(subtractRegions(g.reg, unionRegions(spineCuts[gi], [])), p.kerf / 2), p.minArea);
    for (const isl of islands.filter((x) => spineHolds[gi].some((q) => inside(x, q)))) {
      const c = center(isl);
      const local = isl.map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y })));
      // Schlitzmarke: Nummer der Rippe am Schlitzende, wenn sie dort ins Material passt
      const extra: SubPath[] = [];
      if (p.numbers)
        for (const mk of spineMarks[gi]) {
          if (!inside(isl, fromLine(mk.ln, 0, mk.m - hold))) continue;
          const label = String(mk.nr);
          const h = Math.min(p.numberSize, 4, (mk.spacing - 1) / numberWidth(label), (mk.m - mk.y0 - 2) / 1.2);
          if (h < 1.5) continue;
          const hw = (numberWidth(label) * h) / 2;
          const cc = fromLine(mk.ln, 0, mk.m - 1 - h / 2 - Math.abs(mk.ln.dir.x) * hw);
          const corners = [{ x: cc.x - hw, y: cc.y - h / 2 }, { x: cc.x + hw, y: cc.y - h / 2 }, { x: cc.x - hw, y: cc.y + h / 2 }, { x: cc.x + hw, y: cc.y + h / 2 }];
          if (!corners.every((q) => inside(isl, q))) continue;
          extra.push(...numberStrokes(label, { x: cc.x - c.x, y: cc.y - c.y }, h));
        }
      const slots = spineMarks[gi].filter((mk) => inside(isl, fromLine(mk.ln, 0, mk.m - hold))).map((mk) => mk.nr);
      spine.push({
        key: '', section: -1, polys: local, pose: { o: lin(g.u, c.x, g.v, c.y, g.n, g.off - th / 2), u: g.u, v: g.v, n: g.n },
        extra: extra.length ? extra : undefined, slots: [...new Set(slots)].sort((a, b) => a - b), secs: g.secs,
      });
    }
  });
  spine.forEach((s, i) => (s.key = spine.length > 1 ? `S${i + 1}` : 'S'));
  // Steckt eine Rippe nur in einem Stück Rückgrat, das zu klein war und wegfiel, hätte sie keinen Halt: ohne sie neu
  const held = new Set(spine.flatMap((x) => x.slots ?? []));
  const orphans = out.map((_, i) => i + 1).filter((nr) => !held.has(nr)).map((nr) => nrToRib[nr]);
  if (orphans.length && skip.size < ribs.length) return compute(p, rawMesh, new Set([...skip, ...orphans]));
  // Zu lange Platten mit Schwalbenschwanz teilen (Stücke a, b, …; gleiche Lage im Raum)
  if (p.maxPlate > 0) {
    const split: RibPart[] = [];
    for (const sp of spine) {
      const pieces = splitPlate(sp.polys, p.maxPlate, th, p.play, p.minArea);
      if (!pieces) {
        split.push(sp);
        continue;
      }
      pieces.forEach((pc, i) => {
        const c = center(pc);
        const local = pc.map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y })));
        // Schlitzmarken zum Stück, in dem sie liegen
        const extra = (sp.extra ?? [])
          .filter((m) => m.nodes.length && inside(pc, { x: m.nodes[0].x, y: m.nodes[0].y }))
          .map((m) => ({ ...m, nodes: m.nodes.map((nd) => ({ ...nd, x: nd.x - c.x, y: nd.y - c.y, ...(nd.cin ? { cin: { x: nd.cin.x - c.x, y: nd.cin.y - c.y } } : {}), ...(nd.cout ? { cout: { x: nd.cout.x - c.x, y: nd.cout.y - c.y } } : {}) })) }));
        const o = add(add(sp.pose.o, sp.pose.u, c.x), sp.pose.v, c.y);
        split.push({ ...sp, key: sp.key + String.fromCharCode(97 + i), polys: local, pose: { ...sp.pose, o }, extra: extra.length ? extra : undefined, piece: true });
      });
    }
    spine.length = 0;
    spine.push(...split);
  }

  return {
    dims,
    ribs: out,
    spine,
    sections: secs.map((s, si) => ({ name: s.name, ribs: keptBySec[si], count: secRibs[si].length - absorbed[si], radius: s.radius, bend: bend[si], axis: s.pts, view: s.view, offset: dot(s.pts[0], VIEWS[s.view].n) })),
    manual,
    lostRibs,
    lostPieces,
    count: ribs.length,
    open,
    bad,
  };
}

/**
 * Platte (Inseln in Teilkoordinaten) quer zu ihrer längsten Richtung in Stücke von höchstens max teilen. Die
 * Schnitte liegen möglichst an Stellen ohne Schlitz in der Nähe, wo das Material ein einziges, langes Stück ist;
 * dort greift ein Schwalbenschwanz vom linken in das rechte Stück (mit Steckspiel). null = nicht nötig.
 */
export function splitPlate(polys: Pt[][], max: number, th: number, play: number, minArea: number): Pt[][][] | null {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const poly of polys) for (const q of poly) (x0 = Math.min(x0, q.x)), (x1 = Math.max(x1, q.x)), (y0 = Math.min(y0, q.y)), (y1 = Math.max(y1, q.y));
  const rot = y1 - y0 > x1 - x0;
  const fw = (q: Pt): Pt => (rot ? { x: q.y, y: -q.x } : q);
  const bw = (q: Pt): Pt => (rot ? { x: -q.y, y: q.x } : q);
  const P = polys.map((poly) => poly.map(fw));
  const a0 = rot ? y0 : x0,
    a1 = rot ? y1 : x1;
  const len = a1 - a0;
  const k = Math.ceil(len / max - 1e-9);
  if (k < 2) return null;
  const off = 1.5 * th;
  const cuts: { x: number; iv: [number, number] }[] = [];
  let prev = a0;
  for (let i = 1; i < k; i++) {
    const ideal = a0 + (i * len) / k;
    const lo = Math.max(prev + 2 * th, ideal - (0.3 * len) / k),
      hi = Math.min(prev + max - 1, ideal + (0.3 * len) / k);
    let best: { x: number; iv: [number, number]; score: number } | null = null;
    for (let x = lo; x <= hi + 1e-9; x += 0.5) {
      const ivs = [x - off, x, x + off].map((xx) => intervalsAtX(P, xx));
      const here = ivs[1];
      if (!here.length) continue;
      const iv = here.reduce((m, v) => (v[1] - v[0] > m[1] - m[0] ? v : m));
      const clean = ivs.every((v) => v.length === 1) && Math.abs(ivs[0][0][1] - ivs[0][0][0] - (iv[1] - iv[0])) < 2 && Math.abs(ivs[2][0][1] - ivs[2][0][0] - (iv[1] - iv[0])) < 2;
      const score = (clean ? 1000 : 0) + (iv[1] - iv[0]) - 2 * Math.abs(x - ideal);
      if (!best || score > best.score) best = { x, iv, score };
    }
    if (!best) continue;
    cuts.push({ x: best.x, iv: best.iv });
    prev = best.x;
  }
  if (!cuts.length) return null;
  const R = region(P);
  const B = 1e4;
  const rect = (xa: number, xb: number) => polyRegion([{ x: xa, y: -B }, { x: xb, y: -B }, { x: xb, y: B }, { x: xa, y: B }]);
  // Schwalbenschwanz an einem Schnitt: greift nach rechts, ausgehend vom Stück links
  const tab = (c: { x: number; iv: [number, number] }, grow: number, back = grow) => {
    const hgt = c.iv[1] - c.iv[0],
      ym = (c.iv[0] + c.iv[1]) / 2;
    const n = Math.min(20, 0.35 * hgt),
      d = Math.min(12, Math.max(2 * th, 0.25 * hgt)),
      fl = 0.35 * n;
    return polyRegion([
      { x: c.x - back, y: ym - n / 2 - grow },
      { x: c.x - grow, y: ym - n / 2 - grow },
      { x: c.x + d + grow, y: ym - n / 2 - fl - grow },
      { x: c.x + d + grow, y: ym + n / 2 + fl + grow },
      { x: c.x - grow, y: ym + n / 2 + grow },
      { x: c.x - back, y: ym + n / 2 + grow },
    ]);
  };
  const out: Pt[][][] = [];
  const edges = [a0 - 1, ...cuts.map((c) => c.x), a1 + 1];
  for (let i = 0; i + 1 < edges.length; i++) {
    // 0,05 mm Fuge am geraden Schnitt, damit sich die Stücke nicht berühren
    let piece = intersect(R, rect(edges[i] + 0.025, edges[i + 1] - 0.025));
    // links: Zapfen des eigenen rechten Schnitts dazu; rechts: Aussparung für den Zapfen des linken Schnitts
    if (i + 1 < edges.length - 1) piece = unionRegions(piece, intersect(R, tab(cuts[i], 0, 1)));
    if (i > 0) piece = subtractRegions(piece, tab(cuts[i - 1], Math.max(0, play) / 2));
    for (const isl of regionIslands(piece, minArea)) out.push(isl.map((poly) => poly.map(bw)));
  }
  return out;
}

/**
 * Wie weit reicht das Material, das ein Schlitz der Breite w (Mittellinie x = 0) von m bis zum Rand (end)
 * durchschneidet? Neben der Mittellinie liegt ein schräger Rand weiter außen; sonst bliebe dort ein Steg quer über
 * dem Schlitzeingang. dir: +1 = zu größerem y, −1 = zu kleinerem.
 */
function reach(polys: Pt[][], w: number, m: number, end: number, dir: 1 | -1): number {
  let r = end;
  const lo = Math.min(m, end),
    hi = Math.max(m, end);
  for (const xx of [-w / 2 + 1e-3, -w / 4, 0, w / 4, w / 2 - 1e-3])
    for (const [y0, y1] of intervalsAtX(polys, xx)) {
      if (y1 < lo || y0 > hi) continue;
      r = dir > 0 ? Math.max(r, y1) : Math.min(r, y0);
    }
  return r;
}

/** Mitte der Umrandung */
function center(polys: Pt[][]): Pt {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const poly of polys)
    for (const q of poly) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

// ---------- Generator ----------

const simple = (p: Params) => !parseSections(String(p.sections ?? ''))?.length;

export const RIBS: Generator = {
  id: 'ribs',
  version: 2,
  kind: 'assembly',
  name: t('Rippenmodell'),
  icon: 'ribs',
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest' },
    { key: 'model', type: 'data', label: t('Modell'), def: '' },
    { key: 'name', type: 'data', label: t('Dateiname'), def: '' },
    { key: 'sections', type: 'data', label: t('Abschnitte'), def: '' },
    {
      key: 'up', type: 'enum', label: t('Oben im Modell'), def: 'z',
      options: [['z', t('Z (meist STL)')], ['y', t('Y (meist OBJ)')]],
      title: t('Welche Achse der Datei nach oben zeigt. Liegt das Modell in der 3D-Ansicht auf der Seite, hier umschalten.'),
    },
    {
      key: 'axis', type: 'enum', label: t('Achse'), def: 'x',
      options: [['x', t('von links nach rechts')], ['y', t('von vorne nach hinten')], ['z', t('von unten nach oben')]],
      title: t('Die Rippen stehen quer zu dieser Richtung. Bei Tieren, Fischen und Autos meist die Länge.'),
      showIf: simple,
    },
    {
      key: 'spineDir', type: 'enum', label: t('Rückgrat steht'), def: 'z',
      options: [['z', t('senkrecht (nach oben)')], ['y', t('nach vorne')], ['x', t('zur Seite')]],
      title: t('Ebene des Rückgrats: Es enthält die Achse und diese Richtung. Die Rippen werden in dieser Richtung aufgesteckt.'),
      showIf: simple,
    },
    { key: 'size', type: 'length', label: t('Größe (längste Seite)'), min: 10, max: 3000, def: 200 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 30, def: 3 },
    { key: 'spacing', type: 'length', label: t('Rippenabstand (Mitte zu Mitte)'), min: 1, max: 500, def: 10 },
    {
      key: 'minSpacing', type: 'length', label: t('Dichter an Details bis'), min: 0, max: 500, def: 0,
      title: t('Wo sich der Umriss schnell ändert (Nase, Ohren, runde Enden), rücken die Rippen bis auf diesen Abstand zusammen; an glatten Stellen bleibt der Rippenabstand. 0 = überall gleich.'),
    },
    {
      key: 'spineInset', type: 'length', label: t('Rückgrat nach innen versetzt'), min: 0, max: 100, def: 2,
      title: t('Das Rückgrat wird um so viel kleiner als der Umriss, damit es zwischen den Rippen nicht heraussteht. 0 = voller Umriss.'),
    },
    { key: 'spineOffset', type: 'length', label: t('Rückgrat verschieben'), min: -1000, max: 1000, def: 0, advanced: true, title: t('Lage des Rückgrats aus der Mitte heraus, quer zu seiner Ebene.'), showIf: simple },
    { key: 'play', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0.1, title: t('Die Schlitze werden um so viel breiter als die Materialdicke; negativ = Presspassung') },
    { key: 'numbers', type: 'bool', label: t('Nummern gravieren'), def: true, title: t('Jede Rippe bekommt ihre Nummer, das Rückgrat neben jedem Schlitz die Nummer der passenden Rippe.') },
    { key: 'numberSize', type: 'length', label: t('Größte Schrifthöhe'), min: 1.5, max: 30, def: 6, advanced: true, showIf: (p) => !!p.numbers },
    { key: 'minArea', type: 'number', label: t('Kleinste Fläche (mm²)'), min: 0, max: 10000, def: 4, advanced: true, title: t('Inseln und Löcher, die kleiner sind, werden weggelassen bzw. gefüllt.') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.1, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, Schlitze werden schmaler. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    { key: 'maxPlate', type: 'length', label: t('Platten teilen ab'), min: 0, max: 3000, def: 0, advanced: true, title: t('Rückgrat-Platten, die länger sind (z. B. als das Bett), werden mit einem Schwalbenschwanz geteilt. 0 = nie teilen.') },
    { key: 'plan', type: 'bool', label: t('Bauplan als eigene Seite'), def: true, title: t('Beim Erstellen eine Seite mit Ansicht, Teilenummern und Steckreihenfolge anlegen. Sie wird nicht gelasert.') },
  ],
  // Saved objects keep their packParts layout; new ones are nested compactly.
  migrate(p, from) { return from < 2 ? { ...p, partLayout: 'packed' } : p; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (!p.model || !getMesh(p.model)) {
      out.push({ level: 'error', msg: t('Das 3D-Modell fehlt. Bitte über Datei → Importieren … neu einlesen.') });
      return out;
    }
    if (p.spacing < p.thickness + 0.5) {
      out.push({ key: 'spacing', level: 'error', msg: t('Der Rippenabstand muss mindestens 0,5 mm größer als die Materialdicke sein.') });
      return out;
    }
    if (p.minSpacing > 0 && p.minSpacing < p.thickness + 0.5) {
      out.push({ key: 'minSpacing', level: 'error', msg: t('Der kleinste Abstand muss mindestens 0,5 mm größer als die Materialdicke sein.') });
      return out;
    }
    for (const s of parseSections(p.sections) ?? [])
      if (s.spacing && s.spacing < p.thickness + 0.5) {
        out.push({ key: 'sections', level: 'error', msg: t('Abschnitt „{name}“: Der Rippenabstand muss mindestens 0,5 mm größer als die Materialdicke sein.', { name: s.name }) });
        return out;
      }
    if (p.thickness + p.play <= p.kerf) out.push({ key: 'kerf', level: 'error', msg: t('Die Schnittfuge ist breiter als die Schlitze.') });
    const L = ribsLayout(raw);
    if (!L) return out;
    for (const b of L.bad) out.push({ key: 'sections', level: 'warn', msg: b });
    if (L.count > 400) out.push({ key: 'spacing', level: 'error', msg: t('{n} Rippen sind zu viele: größeren Abstand oder kleineres Modell wählen.', { n: L.count }) });
    else if (L.count > 120) out.push({ key: 'spacing', level: 'warn', msg: t('{n} Rippen: Das wird viel Arbeit beim Lasern und Stecken.', { n: L.count }) });
    if (!L.ribs.length) {
      out.push({ key: L.manual ? 'sections' : 'spineDir', level: 'error', msg: t('Keine Rippe kreuzt das Rückgrat: Richtung des Rückgrats oder Versatz ändern.') });
      return out;
    }
    if (L.manual)
      for (const s of L.sections) {
        if (!s.ribs) out.push({ key: 'sections', level: 'warn', msg: t('Abschnitt „{name}“ hat keine Rippe mit Halt: Achse oder Ebene prüfen.', { name: s.name }) });
        if (s.bend) out.push({ key: 'sections', level: 'warn', msg: t('Abschnitt „{name}“: Rippen stoßen in der Biegung aneinander. Größeren Abstand wählen oder die Achse weniger stark biegen.', { name: s.name }) });
      }
    if (L.lostRibs) out.push({ key: 'spacing', level: 'warn', msg: tn('{n} Rippe hat keinen Halt am Rückgrat (zu klein oder neben dem Rückgrat) und fällt weg.', '{n} Rippen haben keinen Halt am Rückgrat (zu klein oder neben dem Rückgrat) und fallen weg.', L.lostRibs) });
    if (L.lostPieces)
      out.push(
        L.manual
          ? { key: 'sections', level: 'warn', msg: tn('{n} Stück einer Rippe erreicht kein Rückgrat und fällt weg. Dafür einen eigenen Abschnitt anlegen.', '{n} Stücke von Rippen erreichen kein Rückgrat und fallen weg. Für sie einen eigenen Abschnitt anlegen.', L.lostPieces) }
          : { key: 'spineOffset', level: 'warn', msg: tn('{n} Stück einer Rippe erreicht das Rückgrat nicht und fällt weg (z. B. ein Bein neben dem Rumpf). Dafür unter „Abschnitte“ eine eigene Achse zeichnen.', '{n} Stücke von Rippen erreichen das Rückgrat nicht und fallen weg (z. B. Beine neben dem Rumpf). Dafür unter „Abschnitte“ eigene Achsen zeichnen.', L.lostPieces) },
      );
    if (!L.manual && L.spine.length > 1) out.push({ key: 'spineInset', level: 'warn', msg: t('Das Rückgrat besteht aus {n} Stücken; jedes hält nur seine Rippen.', { n: L.spine.length }) });
    if (L.open) out.push({ level: 'warn', msg: tn('Das Modell hat Löcher im Netz; an {n} Stelle fehlt ein Stück Kontur. Am besten das Modell vorher reparieren (z. B. in Blender oder PrusaSlicer).', 'Das Modell hat Löcher im Netz; an {n} Stellen fehlt ein Stück Kontur. Am besten das Modell vorher reparieren (z. B. in Blender oder PrusaSlicer).', L.open) });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const L = ribsLayout(raw);
    if (!L || !L.ribs.length) return { parts: [], info: [] };
    const items: { key: string; subs: SubPath[]; marks?: SubPath[] }[] = [];
    let area = 0;
    for (const part of [...L.spine, ...L.ribs]) {
      const subs = part.polys.map((poly) => fitPolyline(poly, true, 0.05));
      area += regionArea(part.polys);
      const marks: SubPath[] = [...(part.extra ?? [])];
      if (p.numbers && part.key.startsWith('R')) marks.push(...(placeNumber(part.polys, part.key.slice(1), p.numberSize) ?? []));
      items.push(marks.length ? { key: part.key, subs, marks } : { key: part.key, subs });
    }
    const placed = arrangeParts(items, 3 + p.kerf, raw.partLayout);
    const parts: GenPart[] = placed.map((pl, i) => (items[i].marks ? { ...pl, marks: items[i].marks } : pl));
    const [dx, dy, dz] = L.dims;
    const info: [string, string][] = [
      [t('Modell'), p.name || '–'],
      [t('Maße (B × T × H)'), `${fmt(dx)} × ${fmt(dy)} × ${fmt(dz)} mm`],
      [t('Rippen'), String(L.ribs.length)],
    ];
    if (L.manual) info.push([t('Abschnitte'), L.sections.map((s) => `${s.name} ${s.ribs}`).join(', ')]);
    let longest = 0;
    for (const sp of L.spine) {
      const c = center(sp.polys);
      for (const poly of sp.polys) for (const q of poly) longest = Math.max(longest, 2 * Math.abs(q.x - c.x), 2 * Math.abs(q.y - c.y));
    }
    info.push([t('Längste Platte'), `${fmt(longest, 0)} mm`]);
    info.push([t('Fläche gesamt'), `${fmt(area / 100, 0)} cm²`]);
    return p.plan ? { parts, info, plan: ribsPlan(p, L) } : { parts, info };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Rippenmodell {name}', { name: p.name || '' }).trim();
    if (!part) return base;
    if (part.startsWith('S')) return `${base}: ${t('Rückgrat')}${part.length > 1 ? ' ' + part.slice(1) : ''}`;
    const L = ribsLayout(raw);
    const r = L?.ribs.find((x) => x.key === part);
    const sec = L?.manual && r ? L.sections[r.section]?.name : '';
    return `${base}: ${t('Rippe {n}', { n: part.slice(1) })}${sec ? ` (${sec})` : ''}`;
  },
};

/** Nummern als Bereiche: 1–4, 7, 9–10 */
export function ranges(ns: number[]): string {
  const s = [...new Set(ns)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j + 1;
  }
  return out.join(', ');
}

/** Bauplan: Ansicht mit Teilenummern und Steckreihenfolge */
export function ribsPlan(p: RibsParams, L: RibsLayout): PlanSheet {
  const V = VIEWS[L.sections[0]?.view ?? 'xz'];
  const th = p.thickness;
  const proj = (q: V3): Pt => ({ x: dot(q, V.e1), y: -dot(q, V.e2) });
  const world = (part: RibPart, q: Pt): V3 => add(add(add(part.pose.o, part.pose.u, q.x), part.pose.v, q.y), part.pose.n, th / 2);
  const raw: Pt[][] = [];
  const marks: { at: Pt; text: string; size: number }[] = [];
  for (const part of [...L.spine, ...L.ribs]) {
    for (const poly of part.polys) raw.push([...poly, poly[0]].map((q) => proj(world(part, q))));
    marks.push({ at: proj(world(part, { x: 0, y: 0 })), text: part.key.startsWith('R') ? part.key.slice(1) : part.key, size: part.key.startsWith('R') ? 2.5 : 4 });
  }
  // In ein Feld von 180 × 110 mm ab (15, 22) einpassen
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const l of raw) for (const q of l) (x0 = Math.min(x0, q.x)), (y0 = Math.min(y0, q.y)), (x1 = Math.max(x1, q.x)), (y1 = Math.max(y1, q.y));
  const k = Math.min(180 / Math.max(1, x1 - x0), 110 / Math.max(1, y1 - y0));
  const T = (q: Pt): Pt => ({ x: 15 + (q.x - x0) * k, y: 22 + (q.y - y0) * k });
  const lines = raw.map((l) => l.map(T));
  const labels = marks.map((m) => ({ ...T(m.at), text: m.text, size: m.size }));

  // Steckreihenfolge
  const name = (si: number) => L.sections[si]?.name ?? '';
  const ribsOf = (secs: number[]) => L.ribs.filter((r) => secs.includes(r.section)).map((r) => Number(r.key.slice(1)));
  const steps: string[] = [];
  const pieces = L.spine.filter((s) => s.piece).map((s) => s.key);
  if (pieces.length) steps.push(t('Geteilte Platten zuerst am Schwalbenschwanz zusammenstecken und verleimen: {list}.', { list: pieces.join(', ') }));
  // Platten ohne Buchstaben zusammenfassen (S1a + S1b = S1)
  const plates = new Map<string, RibPart[]>();
  for (const s of L.spine) {
    const base = s.piece ? s.key.slice(0, -1) : s.key;
    plates.set(base, [...(plates.get(base) ?? []), s]);
  }
  const order = [...plates.entries()].sort((a, b) => Number(!(a[1][0].secs ?? []).includes(0)) - Number(!(b[1][0].secs ?? []).includes(0)));
  for (const [key, parts] of order) {
    const secs = parts[0].secs ?? [];
    const slots = parts.flatMap((x) => x.slots ?? []);
    const own = ribsOf(secs).filter((n) => slots.includes(n));
    const cross = slots.filter((n) => !own.includes(n));
    // Namen nur der Abschnitte, deren Rippen wirklich auf diesem Stück stecken (gleiche Ebene ≠ gleiche Platte)
    const ownSecs = [...new Set(L.ribs.filter((r) => own.includes(Number(r.key.slice(1)))).map((r) => r.section))];
    const names = L.manual ? ownSecs.map(name).filter(Boolean).join(', ') : '';
    const plate = names ? `${key} (${names})` : key;
    const main = steps.length === (pieces.length ? 1 : 0);
    if (own.length)
      steps.push(
        main
          ? t('Rippen {r} von oben auf Platte {s} stecken; die Nummer am Schlitz zeigt, welche Rippe wohin gehört.', { r: ranges(own), s: plate })
          : t('Rippen {r} auf Platte {s} stecken.', { r: ranges(own), s: plate }),
      );
    if (cross.length) steps.push(t('Platte {s} von unten in die Schlitze der Rippen {r} schieben.', { s: key, r: ranges(cross) }));
  }
  steps.push(t('Teile: {list}, Materialdicke {t} mm.', { list: `${tn('{n} Rippe', '{n} Rippen', L.ribs.length)}, ${tn('{n} Platte', '{n} Platten', L.spine.length)}`, t: fmt(th, 1) }));
  return { title: t('Bauplan: {name}', { name: t('Rippenmodell {name}', { name: p.name || '' }).trim() }), lines, labels, steps: steps.map((s2, i) => (i < steps.length - 1 ? `${i + 1}. ${s2}` : s2)) };
}

/** Lage jedes Teils im Raum (für die 3D-Ansicht) */
export function ribsPoses(raw: Params): Record<string, { o: V3; u: V3; v: V3; n: V3 }> | null {
  const L = ribsLayout(raw);
  if (!L) return null;
  const out: Record<string, { o: V3; u: V3; v: V3; n: V3 }> = {};
  for (const part of [...L.spine, ...L.ribs]) out[part.key] = part.pose;
  return out;
}
