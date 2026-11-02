// Steckprüfung einer Baugruppe: Hält alles zusammen, und lässt es sich stecken?
//
// Die Teile (Platten in Lage, ohne Schnittfuge) werden in ihre Stücke zerlegt: Ein Teil aus zwei Inseln sind nach
// dem Lasern zwei lose Stücke. Zwei Stücke berühren sich, wenn sie um `TOUCH` mm dicker gedacht einen gemeinsamen
// Punkt haben (Schlitze mit Spiel, aufeinanderliegende Schichten, Schwalbenschwanz in derselben Ebene).
//
// Stecken: Kreuzen sich zwei Platten mit Halbschlitzen (eine von oben, die andere von unten geschlitzt), lässt sich
// die eine nur in genau einer Richtung auf die andere schieben: entlang der Schnittgeraden, zur Öffnung ihres
// Schlitzes hin. Die Prüfung setzt die Teile nacheinander zusammen; ein neues Stück muss sich in einer einzigen
// geraden Bewegung auf alle schon stehenden Stücke schieben lassen, in denen es steckt. Andere Verbindungen
// (Zinken, Zapfen durch Löcher, Leim) schränken die Richtung nicht ein. Drehen und Biegen beim Stecken wird nicht
// nachgebildet, ebenso wenig Teile, die beim Hineinschieben an einem dritten Teil anstoßen.
import ClipperLib from 'clipper-lib';
import type { Pt } from '../model';
import { execute, Paths, SCALE } from '../clip';
import type { Solid } from './solids';
import { cross, dot, V3 } from './poses';

/** Abstand, bis zu dem sich zwei Stücke noch berühren (mm, je Seite der Platte) */
const TOUCH = 0.25;
/** Lücke zwischen den Enden zweier Halbschlitze, die noch als Kreuzung gilt (mm) */
const ABUT = 0.4;
/** Richtungen, die so wenig voneinander abweichen, gelten als dieselbe (cos 8°) */
const SAME_DIR = Math.cos((8 * Math.PI) / 180);

export interface Piece {
  /** Teil (Schlüssel der Baugruppe) und Nummer des Stücks darin (0, wenn das Teil nur eines hat) */
  key: string;
  label: string;
  island: number;
  solid: Solid;
  /** Fläche (mm²), für die Wahl des Hauptkörpers */
  area: number;
}

export interface Crossing {
  a: number;
  b: number;
  /** Bewegung von a relativ zu b beim Stecken (Einheitsvektor) */
  dir: V3;
}

export interface Conflict {
  /** Stück, das sich nicht stecken lässt */
  piece: number;
  /** Stücke, auf die es in verschiedenen Richtungen geschoben werden müsste */
  with: number[];
}

export interface AssemblyReport {
  pieces: Piece[];
  /** Berührungen (Paare von Stücken) */
  contacts: [number, number][];
  crossings: Crossing[];
  /** Zusammenhängende Gruppen, die größte zuerst */
  groups: number[][];
  /** Reihenfolge zum Stecken (Hauptgruppe); unvollständig, wenn es Konflikte gibt */
  order: number[];
  conflicts: Conflict[];
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const world = (s: Solid, x: number, y: number): V3 => add(add(s.pose.o, s.pose.u, x), s.pose.v, y);
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

function signedArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x - p[i].x) * (p[j].y + p[i].y);
  return s / 2;
}

function inPoly(q: Pt, p: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if (p[i].y > q.y !== p[j].y > q.y && q.x < ((p[j].x - p[i].x) * (q.y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c;
  return c;
}

/** Ein Teil in seine Inseln (Außenkontur mit ihren Löchern) zerlegen, Gerade-Ungerade-Regel */
export function islandsOf(s: Solid): { polys: Pt[][]; area: number }[] {
  const ps = s.polys.filter((p) => p.length > 2);
  if (ps.length <= 1) return ps.length ? [{ polys: ps, area: Math.abs(signedArea(ps[0])) }] : [];
  const areas = ps.map((p) => Math.abs(signedArea(p)));
  const depth = ps.map((p, i) => ps.reduce((n, q, j) => n + (j !== i && areas[j] > areas[i] && inPoly(p[0], q) ? 1 : 0), 0));
  const outers = ps.map((_, i) => i).filter((i) => depth[i] % 2 === 0);
  const out = outers.map((i) => ({ polys: [ps[i]], area: areas[i] }));
  ps.forEach((p, i) => {
    if (depth[i] % 2 === 0) return;
    // Loch gehört zur kleinsten Außenkontur, die es enthält (eine Ebene tiefer)
    let best = -1;
    outers.forEach((o, k) => {
      if (depth[o] === depth[i] - 1 && inPoly(p[0], ps[o]) && (best < 0 || areas[o] < areas[outers[best]])) best = k;
    });
    if (best >= 0) {
      out[best].polys.push(p);
      out[best].area -= areas[i];
    }
  });
  return out;
}

/** Linienzüge in (x, y) = (P·ex, P·ey) einer Platte */
const mapTo = (s: Solid, polys: Pt[][], ex: V3, ey: V3): [number, number][][] =>
  polys.map((poly) => poly.map((q): [number, number] => { const P = world(s, q.x, q.y); return [dot(P, ex), dot(P, ey)]; }));

/** Schnitt der Konturen mit der Geraden x = x0: Intervalle in y */
function scanX(polys: [number, number][][], x0: number): [number, number][] {
  const ys: number[] = [];
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xa, ya] = poly[j],
        [xb, yb] = poly[i];
      if (xa <= x0 !== xb <= x0) ys.push(ya + ((x0 - xa) * (yb - ya)) / (xb - xa));
    }
  ys.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 1e-9) out.push([ys[i], ys[i + 1]]);
  return out;
}

function union(iv: [number, number][]): [number, number][] {
  const s = [...iv].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Bereich der Koordinate P·n, den die Platte einnimmt (Dicke) */
function slab(s: Solid, n: V3): [number, number] {
  const o = dot(s.pose.o, n);
  return dot(s.pose.n, n) > 0 ? [o, o + s.th] : [o - s.th, o];
}

function box(p: Piece): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity],
    max: V3 = [-Infinity, -Infinity, -Infinity];
  const s = p.solid;
  for (const poly of s.polys)
    for (const q of poly)
      for (const z of [0, s.th]) {
        const P = add(world(s, q.x, q.y), s.pose.n, z);
        for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], P[k])), (max[k] = Math.max(max[k], P[k]));
      }
  return { min, max };
}

/** Parallele Platten: berühren sie sich (Flächen aufeinander oder Kanten in derselben Ebene)? */
function parallelTouch(A: Solid, B: Solid): boolean {
  const n = A.pose.n;
  const [a0, a1] = slab(A, n),
    [b0, b1] = slab(B, n);
  if (Math.max(a0, b0) - Math.min(a1, b1) > 2 * TOUCH) return false;
  const toA = (P: V3) => {
    const r = add(P, A.pose.o, -1);
    return { X: Math.round(dot(r, A.pose.u) * SCALE), Y: Math.round(dot(r, A.pose.v) * SCALE) };
  };
  const pa: Paths = A.polys.map((poly) => poly.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
  let pb: Paths = B.polys.map((poly) => poly.map((q) => toA(world(B, q.x, q.y))));
  // In derselben Ebene (z. B. Schwalbenschwanz): Kanten mit Spalt berühren sich auch
  if (Math.min(a1, b1) - Math.max(a0, b0) > 0.5 * Math.min(A.th, B.th)) {
    const co = new ClipperLib.ClipperOffset();
    co.AddPaths(execute(ClipperLib.ClipType.ctUnion, pb, [], ClipperLib.PolyFillType.pftEvenOdd), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const grown: Paths = [];
    co.Execute(grown, 2 * TOUCH * SCALE);
    pb = grown;
  }
  const res = execute(ClipperLib.ClipType.ctIntersection, pa, pb, ClipperLib.PolyFillType.pftEvenOdd);
  const area = Math.abs(res.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0)) / (SCALE * SCALE);
  return area > 0.05;
}

/**
 * Nicht parallele Platten: Berührung und, bei Halbschlitzen, die Steckrichtung von A relativ zu B.
 * Koordinaten: t entlang der Schnittgeraden d; die Kontur von A wird auf Höhe der Platte B abgetastet und umgekehrt.
 */
function crossTouch(A: Solid, B: Solid): { touch: boolean; dir: V3 | null } {
  const nA = A.pose.n,
    nB = B.pose.n;
  const c = cross(nA, nB);
  const l = Math.hypot(c[0], c[1], c[2]);
  const d: V3 = [c[0] / l, c[1] / l, c[2] / l];
  const pa = mapTo(A, A.polys, nB, d),
    pb = mapTo(B, B.polys, nA, d);
  const [sa0, sa1] = slab(A, nA),
    [sb0, sb1] = slab(B, nB);
  const band = (polys: [number, number][][], s0: number, s1: number) => {
    const iv: [number, number][] = [];
    const n = 8;
    for (let k = 0; k <= n; k++) iv.push(...scanX(polys, s0 - TOUCH + ((s1 - s0 + 2 * TOUCH) * k) / n));
    return union(iv);
  };
  const ua = band(pa, sb0, sb1),
    ub = band(pb, sa0, sa1);
  let touch = false;
  for (const [a0, a1] of ua) for (const [b0, b1] of ub) if (Math.min(a1, b1) - Math.max(a0, b0) > -0.05) touch = true;
  if (!touch) return { touch, dir: null };
  // Halbschlitze: auf der Mittelebene des anderen genau ein Stück von A und eines von B, die Ende an Ende stoßen
  const ia = scanX(pa, (sb0 + sb1) / 2),
    ib = scanX(pb, (sa0 + sa1) / 2);
  let dir: V3 | null = null;
  let n = 0;
  for (const [a0, a1] of ia)
    for (const [b0, b1] of ib) {
      const over = Math.min(a1, b1) - Math.max(a0, b0);
      if (over > ABUT) return { touch, dir: null }; // A geht durch B (Zapfen im Loch, Zinken): keine feste Richtung
      if (over < -ABUT) continue;
      n++;
      // A endet dort, wo B beginnt: A wird zu B hin geschoben (zur Öffnung seines Schlitzes)
      dir = a0 + a1 < b0 + b1 ? d : neg(d);
    }
  return { touch, dir: n === 1 ? dir : null };
}

/** Baugruppe prüfen; solids: Teile in Lage ohne Schnittfuge (asmSolids) */
export function analyzeAssembly(solids: Solid[]): AssemblyReport {
  const pieces: Piece[] = [];
  for (const s of solids) {
    const isl = islandsOf(s);
    isl.forEach((x, i) => pieces.push({ key: s.key, label: s.label, island: isl.length > 1 ? i + 1 : 0, solid: { ...s, polys: x.polys }, area: x.area }));
  }
  const boxes = pieces.map(box);
  const contacts: [number, number][] = [];
  const crossings: Crossing[] = [];
  const adj: number[][] = pieces.map(() => []);
  const dirs = new Map<string, V3>();
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const p = boxes[i],
        q = boxes[j];
      if ([0, 1, 2].some((k) => Math.min(p.max[k], q.max[k]) - Math.max(p.min[k], q.min[k]) < -2 * TOUCH)) continue;
      const A = pieces[i].solid,
        B = pieces[j].solid;
      const par = Math.abs(dot(A.pose.n, B.pose.n)) > 1 - 1e-6;
      let touch: boolean,
        dir: V3 | null = null;
      if (par) touch = parallelTouch(A, B);
      else ({ touch, dir } = crossTouch(A, B));
      if (!touch) continue;
      contacts.push([i, j]);
      adj[i].push(j);
      adj[j].push(i);
      if (dir) {
        crossings.push({ a: i, b: j, dir });
        dirs.set(`${i}/${j}`, dir);
        dirs.set(`${j}/${i}`, neg(dir));
      }
    }

  // ---- Zusammenhang ----
  const comp = new Int32Array(pieces.length).fill(-1);
  const groups: number[][] = [];
  for (let s = 0; s < pieces.length; s++) {
    if (comp[s] >= 0) continue;
    const g = [s];
    comp[s] = groups.length;
    for (let k = 0; k < g.length; k++)
      for (const y of adj[g[k]])
        if (comp[y] < 0) {
          comp[y] = groups.length;
          g.push(y);
        }
    groups.push(g);
  }
  const weight = (g: number[]) => g.reduce((s, i) => s + pieces[i].area * pieces[i].solid.th, 0);
  groups.sort((a, b) => weight(b) - weight(a) || b.length - a.length);

  // ---- Stecken: Stück für Stück an den stehenden Körper ----
  const conflicts: Conflict[] = [];
  let order: number[] = [];
  for (const [gi, g] of groups.entries()) {
    if (g.length < 2) {
      if (gi === 0) order = [...g];
      continue;
    }
    const nCross = (i: number) => adj[i].filter((y) => dirs.has(`${i}/${y}`)).length;
    // Anfangen mit dem Stück, in dem am meisten steckt (Rückgrat); bei Misserfolg ein paar andere versuchen
    const starts = [...g].sort((a, b) => nCross(b) - nCross(a) || pieces[b].area - pieces[a].area).slice(0, 6);
    let best: { order: number[]; stuck: Conflict[] } | null = null;
    // Nach den festen Versuchen noch einige mit zufälliger Wahl unter den möglichen Stücken (fester Startwert)
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tries = [...starts.map((s) => ({ s, random: false })), ...Array.from({ length: 40 }, () => ({ s: starts[0], random: true }))];
    for (const { s, random } of tries) {
      const placed = new Set([s]);
      const ord = [s];
      for (;;) {
        let pick = -1,
          pickN = -1;
        for (const x of g) {
          if (placed.has(x) || !adj[x].some((y) => placed.has(y))) continue;
          const need = adj[x].filter((y) => placed.has(y)).map((y) => dirs.get(`${x}/${y}`)).filter((v): v is V3 => !!v);
          if (need.some((v) => dot(v, need[0]) < SAME_DIR)) continue;
          // Zuerst die Stücke, die am meisten Halt bekommen
          const score = random ? rnd() : need.length;
          if (score > pickN) (pick = x), (pickN = score);
        }
        if (pick < 0) break;
        placed.add(pick);
        ord.push(pick);
      }
      const stuck: Conflict[] = [];
      for (const x of g) {
        if (placed.has(x)) continue;
        const w = adj[x].filter((y) => placed.has(y) && dirs.has(`${x}/${y}`));
        if (w.length) stuck.push({ piece: x, with: w });
      }
      // Stücke, die nur an anderen hängenbleibenden hängen, zählen nicht einzeln
      if (!best || ord.length > best.order.length) best = { order: ord, stuck };
      if (ord.length === g.length) break;
    }
    if (gi === 0) order = best!.order;
    conflicts.push(...best!.stuck);
  }
  return { pieces, contacts, crossings, groups, order, conflicts };
}
