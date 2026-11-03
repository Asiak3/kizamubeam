// Skizzen mit Beziehungen und Bemaßungen (wie in CAD-Programmen): Datenmodell und Umriss.
// Eine Skizze besteht aus Punkten, Elementen (Linie, Kreis, Bogen) und Beziehungen. Alle Werte in lokalen mm der
// Skizze (y nach unten). Gespeichert wird sie als Parameter „sketch“ eines Generator-Objekts (gen: 'sketch'),
// dadurch funktionieren Speichern, Undo, Kopieren, 3D-Ansicht, Export usw. ohne Sonderfälle.
import type { Pt, SubPath } from '../model';

export interface SkPt {
  id: number;
  x: number;
  y: number;
}

export type SkEnt =
  | { id: number; t: 'line'; a: number; b: number; aux?: boolean }
  | { id: number; t: 'circle'; c: number; r: number; aux?: boolean }
  /** Bogen um c von s nach e mit wachsendem Winkel (a0 < a1, Bogenmaß in Skizzenkoordinaten mit y nach unten) */
  | { id: number; t: 'arc'; c: number; s: number; e: number; r: number; a0: number; a1: number; aux?: boolean };

/** Beziehungen (ohne Wert) und Bemaßungen (mit Wert v) */
export type ConType =
  | 'coincident' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'equal' | 'fixed'
  | 'pointOnLine' | 'pointOnCircle' | 'midpoint' | 'symmetric' | 'tangent' | 'concentric'
  | 'distance' | 'hdistance' | 'vdistance' | 'angle' | 'radius' | 'diameter';

export const DIMENSIONS: ConType[] = ['distance', 'hdistance', 'vdistance', 'angle', 'radius', 'diameter'];
export const isDim = (t: ConType) => DIMENSIONS.includes(t);

export interface SkCon {
  id: number;
  t: ConType;
  /** beteiligte Punkte/Elemente (ids) */
  r: number[];
  /** Wert der Bemaßung (mm bzw. Grad bei angle) */
  v?: number;
  /** Formel mit Projekt-Parametern (ersetzt v beim Lösen) */
  expr?: string;
  /** Lage der Beschriftung relativ zur Mitte der Bemaßung (mm) */
  at?: Pt;
  /** fixed: festgehaltene Lage des Punkts */
  x?: number;
  y?: number;
}

export interface Sketch {
  v: 1;
  pts: SkPt[];
  ents: SkEnt[];
  cons: SkCon[];
  /** nächste freie id (gemeinsam für Punkte, Elemente, Beziehungen) */
  next: number;
}

export const emptySketch = (): Sketch => ({ v: 1, pts: [], ents: [], cons: [], next: 1 });

export function parseSketch(s: unknown): Sketch {
  try {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    if (!o || typeof o !== 'object') return emptySketch();
    const sk = o as Partial<Sketch>;
    const out: Sketch = {
      v: 1,
      pts: Array.isArray(sk.pts) ? sk.pts.filter((p) => p && isFinite(p.x) && isFinite(p.y)) : [],
      ents: Array.isArray(sk.ents) ? sk.ents : [],
      cons: Array.isArray(sk.cons) ? sk.cons : [],
      next: typeof sk.next === 'number' ? sk.next : 1,
    };
    const maxId = Math.max(0, ...out.pts.map((p) => p.id), ...out.ents.map((e) => e.id), ...out.cons.map((c) => c.id));
    out.next = Math.max(out.next, maxId + 1);
    return out;
  } catch {
    return emptySketch();
  }
}

export const sketchJson = (sk: Sketch) => JSON.stringify(sk);
export const cloneSketch = (sk: Sketch): Sketch => JSON.parse(JSON.stringify(sk));

export function ptOf(sk: Sketch, id: number): SkPt | undefined {
  return sk.pts.find((p) => p.id === id);
}
export function entOf(sk: Sketch, id: number): SkEnt | undefined {
  return sk.ents.find((e) => e.id === id);
}

export function addPt(sk: Sketch, x: number, y: number): SkPt {
  const p = { id: sk.next++, x, y };
  sk.pts.push(p);
  return p;
}
export function addLine(sk: Sketch, a: number, b: number, aux = false): SkEnt {
  const e: SkEnt = { id: sk.next++, t: 'line', a, b, ...(aux ? { aux } : {}) };
  sk.ents.push(e);
  return e;
}
export function addCircle(sk: Sketch, c: number, r: number, aux = false): SkEnt {
  const e: SkEnt = { id: sk.next++, t: 'circle', c, r, ...(aux ? { aux } : {}) };
  sk.ents.push(e);
  return e;
}
/** Bogen um den Punkt c von Punkt s nach Punkt e (mit wachsendem Winkel); Radius und Winkel aus den Punkten */
export function addArc(sk: Sketch, c: number, s: number, e: number, aux = false): SkEnt {
  const C = ptOf(sk, c)!,
    S = ptOf(sk, s)!,
    E = ptOf(sk, e)!;
  const r = Math.hypot(S.x - C.x, S.y - C.y);
  const a0 = Math.atan2(S.y - C.y, S.x - C.x);
  let a1 = Math.atan2(E.y - C.y, E.x - C.x);
  while (a1 <= a0) a1 += 2 * Math.PI;
  const ent: SkEnt = { id: sk.next++, t: 'arc', c, s, e, r, a0, a1, ...(aux ? { aux } : {}) };
  sk.ents.push(ent);
  return ent;
}
export function addCon(sk: Sketch, t: ConType, r: number[], extra: Partial<SkCon> = {}): SkCon {
  const c: SkCon = { id: sk.next++, t, r, ...extra };
  sk.cons.push(c);
  return c;
}

/** Punkte, die ein Element benutzt */
export function entPoints(e: SkEnt): number[] {
  return e.t === 'line' ? [e.a, e.b] : e.t === 'circle' ? [e.c] : [e.c, e.s, e.e];
}

/**
 * Löschen: Elemente/Punkte/Beziehungen mit diesen ids. Mit gelöschten Punkten verschwinden ihre Elemente,
 * mit Elementen ihre nicht mehr benutzten Punkte, und jede Beziehung, die etwas Gelöschtes nennt.
 */
export function deleteIds(sk: Sketch, ids: Iterable<number>) {
  const del = new Set(ids);
  for (const e of sk.ents) if (entPoints(e).some((p) => del.has(p))) del.add(e.id);
  const ents = sk.ents.filter((e) => !del.has(e.id));
  const used = new Set(ents.flatMap(entPoints));
  // Punkte löschen, die nur zu gelöschten Elementen gehörten
  for (const e of sk.ents) if (del.has(e.id)) for (const p of entPoints(e)) if (!used.has(p)) del.add(p);
  sk.ents = ents;
  sk.pts = sk.pts.filter((p) => !del.has(p.id));
  sk.cons = sk.cons.filter((c) => !del.has(c.id) && !c.r.some((r) => del.has(r)));
}

/** Aktueller Messwert einer Bemaßung (mm bzw. Grad), aus der Geometrie */
export function measureCon(sk: Sketch, c: SkCon): number | null {
  const P = (id: number) => ptOf(sk, id);
  const E = (id: number) => entOf(sk, id);
  switch (c.t) {
    case 'distance': {
      if (c.r.length === 1) {
        const e = E(c.r[0]);
        if (e?.t !== 'line') return null;
        const a = P(e.a)!,
          b = P(e.b)!;
        return Math.hypot(b.x - a.x, b.y - a.y);
      }
      const p = P(c.r[0]);
      const q = P(c.r[1]);
      if (p && q) return Math.hypot(q.x - p.x, q.y - p.y);
      const l = E(c.r[1]);
      if (p && l?.t === 'line') return distPointLine(p, P(l.a)!, P(l.b)!);
      return null;
    }
    case 'hdistance':
    case 'vdistance': {
      const ps = pointPair(sk, c.r);
      if (!ps) return null;
      return Math.abs(c.t === 'hdistance' ? ps[1].x - ps[0].x : ps[1].y - ps[0].y);
    }
    case 'angle': {
      const l1 = E(c.r[0]),
        l2 = E(c.r[1]);
      if (l1?.t !== 'line' || l2?.t !== 'line') return null;
      return (lineAngle(sk, l1, l2) * 180) / Math.PI;
    }
    case 'radius':
    case 'diameter': {
      const e = E(c.r[0]);
      if (!e || e.t === 'line') return null;
      return c.t === 'radius' ? e.r : e.r * 2;
    }
    default:
      return null;
  }
}

/** Zwei Punkte einer Bemaßung: zwei Punkt-ids oder eine Linie */
export function pointPair(sk: Sketch, r: number[]): [SkPt, SkPt] | null {
  if (r.length === 1) {
    const e = entOf(sk, r[0]);
    if (e?.t !== 'line') return null;
    return [ptOf(sk, e.a)!, ptOf(sk, e.b)!];
  }
  const p = ptOf(sk, r[0]),
    q = ptOf(sk, r[1]);
  return p && q ? [p, q] : null;
}

export function distPointLine(p: Pt, a: Pt, b: Pt): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!L) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
}

/** Winkel von Linie 1 zu Linie 2 (0 … π), wie PlaneGCS ihn für l2l_angle misst (Richtung b−a) */
export function lineAngle(sk: Sketch, l1: SkEnt & { t: 'line' }, l2: SkEnt & { t: 'line' }): number {
  const a1 = ptOf(sk, l1.a)!,
    b1 = ptOf(sk, l1.b)!,
    a2 = ptOf(sk, l2.a)!,
    b2 = ptOf(sk, l2.b)!;
  const d1 = Math.atan2(b1.y - a1.y, b1.x - a1.x),
    d2 = Math.atan2(b2.y - a2.y, b2.x - a2.x);
  let d = d2 - d1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}

// ---------- Umriss ----------

const arcPt = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

/** Bézierstücke eines Bogens von a0 nach a1 (beliebige Richtung), höchstens 90° je Stück */
export function arcNodes(c: Pt, r: number, a0: number, a1: number): SubPath['nodes'] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const d = (a1 - a0) / n;
  const h = (4 / 3) * Math.tan(d / 4) * r;
  const nodes: SubPath['nodes'] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + i * d;
    const p = arcPt(c, r, a);
    const tx = -Math.sin(a),
      ty = Math.cos(a);
    nodes.push({
      x: p.x, y: p.y,
      ...(i > 0 ? { cin: { x: p.x - tx * h, y: p.y - ty * h } } : {}),
      ...(i < n ? { cout: { x: p.x + tx * h, y: p.y + ty * h } } : {}),
    });
  }
  return nodes;
}

/** Punkt-ids, die durch Koinzidenz-Beziehungen zusammengehören, auf einen Vertreter abbilden */
export function coincidentRoots(sk: Sketch): (id: number) => number {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let r = i;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of sk.cons) if (c.t === 'coincident' && c.r.length === 2) {
    const a = find(c.r[0]),
      b = find(c.r[1]);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

/**
 * Umriss der Skizze (ohne Hilfsgeometrie): Linien und Bögen, die an Punkten zusammenhängen, werden zu Zügen
 * verbunden (geschlossen, wenn sie zum Anfang zurückkehren); Kreise sind eigene geschlossene Umrisse.
 */
export function sketchSubs(sk: Sketch): SubPath[] {
  const root = coincidentRoots(sk);
  const P = (id: number) => ptOf(sk, id)!;
  type Edge = { e: SkEnt; u: number; v: number; used: boolean };
  const edges: Edge[] = [];
  const subs: SubPath[] = [];
  for (const e of sk.ents) {
    if (e.aux) continue;
    if (e.t === 'circle') {
      const c = P(e.c);
      if (!c || !(e.r > 0)) continue;
      const nodes = arcNodes(c, e.r, 0, 2 * Math.PI);
      const last = nodes.pop()!;
      nodes[0].cin = last.cin;
      subs.push({ closed: true, nodes });
      continue;
    }
    if (e.t === 'line') {
      if (!P(e.a) || !P(e.b)) continue;
      edges.push({ e, u: root(e.a), v: root(e.b), used: false });
    } else {
      if (!P(e.c) || !P(e.s) || !P(e.e)) continue;
      edges.push({ e, u: root(e.s), v: root(e.e), used: false });
    }
  }
  const at = new Map<number, Edge[]>();
  for (const ed of edges) for (const n of [ed.u, ed.v]) at.set(n, [...(at.get(n) ?? []), ed]);
  /** Knoten eines Elements in Laufrichtung (ab Knoten from) */
  const nodesOf = (ed: Edge, from: number): SubPath['nodes'] => {
    const e = ed.e;
    if (e.t === 'line') {
      const a = P(e.a),
        b = P(e.b);
      return from === ed.u ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : [{ x: b.x, y: b.y }, { x: a.x, y: a.y }];
    }
    if (e.t !== 'arc') return [];
    const c = P(e.c);
    return from === ed.u ? arcNodes(c, e.r, e.a0, e.a1) : arcNodes(c, e.r, e.a1, e.a0);
  };
  const walk = (start: number) => {
    let cur = start;
    const nodes: SubPath['nodes'] = [];
    for (;;) {
      const next = (at.get(cur) ?? []).find((x) => !x.used);
      if (!next) break;
      next.used = true;
      const ns = nodesOf(next, cur);
      if (!nodes.length) nodes.push(...ns);
      else {
        // gemeinsamen Knoten verschmelzen: Anfasser übernehmen
        const last = nodes[nodes.length - 1];
        if (ns[0].cout) last.cout = ns[0].cout;
        nodes.push(...ns.slice(1));
      }
      cur = cur === next.u ? next.v : next.u;
      if (cur === start) {
        // geschlossen: letzten Knoten mit dem ersten verschmelzen
        const last = nodes.pop()!;
        if (last.cin) nodes[0].cin = last.cin;
        subs.push({ closed: true, nodes });
        return;
      }
    }
    if (nodes.length >= 2) subs.push({ closed: false, nodes });
  };
  // offene Züge zuerst an ihren Enden beginnen, dann die geschlossenen
  for (const [n, list] of at) if (list.length === 1 && !list[0].used) walk(n);
  for (const ed of edges) if (!ed.used) walk(ed.u);
  return subs;
}

/** Begrenzung aller Punkte und Kreise (für Zoom und Auswahl) */
export function sketchBounds(sk: Sketch): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const p of sk.pts) add(p.x, p.y);
  for (const e of sk.ents)
    if (e.t !== 'line') {
      const c = ptOf(sk, e.c);
      if (c) {
        add(c.x - e.r, c.y - e.r);
        add(c.x + e.r, c.y + e.r);
      }
    }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
