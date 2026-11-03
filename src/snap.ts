// Fangen wie in LightBurn: Objektfang (Knoten, Mittelpunkt, Zentrum, Schnittpunkt, Linie) und Ausrichtungshilfen.
// Alle Koordinaten in Welt-mm; Toleranzen werden vom Editor aus Bildschirmpixeln umgerechnet.
import { apply, inv, visibleLeaves, mul, Obj, Pt } from './model';
import { bezierPt, Box, boundsOf, segments, shapeSubs, textOutline } from './geom';
import { t } from './i18n';
import { shapeCenters } from './arcs';

export type SnapKind = 'node' | 'mid' | 'center' | 'quad' | 'cross' | 'line';

export const SNAP_LABELS: Record<SnapKind, string> = {
  node: t('Knoten'),
  mid: t('Mittelpunkt'),
  center: t('Zentrum'),
  quad: t('Quadrant'),
  cross: t('Schnittpunkt'),
  line: t('Linie'),
};

export interface SnapHit {
  p: Pt;
  kind: SnapKind;
}

/** Ausrichtungshilfe: senkrechte (x) oder waagrechte (y) Linie von a bis b */
export interface AlignGuide {
  axis: 'x' | 'y';
  v: number;
  a: number;
  b: number;
}

export interface SnapPoint {
  x: number;
  y: number;
  kind: 'node' | 'mid' | 'center' | 'quad';
}

/** Gerade Stücke der Umrisse (Kurven angenähert) mit Begrenzung für die schnelle Vorauswahl */
interface Piece {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const CURVE_STEPS = 16;
/** Höchstzahl der Stücke, die für Schnittpunkte paarweise geprüft werden */
const MAX_CROSS_PIECES = 160;

export class SnapSet {
  pts: SnapPoint[] = [];
  pieces: Piece[] = [];
  /** Begrenzungen der Objekte (oberste Ebene) für Ausrichtungshilfen */
  boxes: Box[] = [];

  addPoint(x: number, y: number, kind: SnapPoint['kind']) {
    this.pts.push({ x, y, kind });
  }
  addPiece(ax: number, ay: number, bx: number, by: number) {
    if (ax === bx && ay === by) return;
    this.pieces.push({
      ax, ay, bx, by, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by),
    });
  }
}

/**
 * Fangpunkte aller sichtbaren Objekte sammeln.
 * visible: Blatt-Objekt sichtbar? skip: Objekte der obersten Ebene, die nicht fangen (z. B. die bewegte Auswahl).
 */
export function buildSnapSet(objs: Obj[], visible: (leaf: Obj) => boolean, skip: Set<Obj> = new Set()): SnapSet {
  const set = new SnapSet();
  for (const top of objs) {
    if (skip.has(top)) continue;
    let any = false;
    for (const [leaf, m] of visibleLeaves([top])) {
      if (!visible(leaf)) continue;
      any = true;
      const s = leaf.shape;
      const subs = s.kind === 'text' ? (textOutline(s)?.subs ?? []) : shapeSubs(s);
      for (const sp of subs) {
        for (const n of sp.nodes) {
          const q = apply(m, n.x, n.y);
          set.addPoint(q.x, q.y, 'node');
        }
        for (const sg of segments(sp)) {
          const a = apply(m, sg.a.x, sg.a.y),
            b = apply(m, sg.b.x, sg.b.y);
          if (!sg.curve) {
            set.addPoint((a.x + b.x) / 2, (a.y + b.y) / 2, 'mid');
            set.addPiece(a.x, a.y, b.x, b.y);
            continue;
          }
          const mid = bezierPt(sg.a, sg.c1, sg.c2, sg.b, 0.5);
          const mq = apply(m, mid.x, mid.y);
          set.addPoint(mq.x, mq.y, 'mid');
          let prev = a;
          for (let i = 1; i <= CURVE_STEPS; i++) {
            const t = bezierPt(sg.a, sg.c1, sg.c2, sg.b, i / CURVE_STEPS);
            const q = i === CURVE_STEPS ? b : apply(m, t.x, t.y);
            set.addPiece(prev.x, prev.y, q.x, q.y);
            prev = q;
          }
        }
      }
      // echte Mittelpunkte von Kreisen, Bögen (auch Löchern) und Vielecken, dazu Quadranten
      if (s.kind !== 'text')
        for (const c of shapeCenters(s, () => subs)) {
          const q = apply(m, c.x, c.y);
          set.addPoint(q.x, q.y, 'center');
          for (const p of c.quads ?? []) {
            const w = apply(m, p.x, p.y);
            set.addPoint(w.x, w.y, 'quad');
          }
        }
      const lb = boundsOf([leaf], mul(m, inv(leaf.m)));
      if (lb) set.addPoint(lb.x + lb.w / 2, lb.y + lb.h / 2, 'center');
    }
    if (!any) continue;
    const b = boundsOf([top]);
    if (!b) continue;
    set.boxes.push(b);
    if (top.shape.kind === 'group') set.addPoint(b.x + b.w / 2, b.y + b.h / 2, 'center');
  }
  return set;
}

/**
 * Nächsten Fangpunkt suchen. Punkte (Knoten, Mittelpunkt, Zentrum, Schnittpunkt) haben Vorrang vor Linien.
 * extra: zusätzliche Knoten (z. B. die Linie im Entstehen).
 */
export function findSnap(set: SnapSet, p: Pt, tol: number, extra: Pt[] = []): SnapHit | null {
  let best: SnapHit | null = null,
    bd = tol;
  const consider = (x: number, y: number, kind: SnapKind) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= bd) {
      bd = d;
      best = { p: { x, y }, kind };
    }
  };
  for (const q of set.pts) if (Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol) consider(q.x, q.y, q.kind);
  for (const q of extra) consider(q.x, q.y, 'node');

  // Stücke in der Nähe: für Schnittpunkte und Linienfang
  const near: Piece[] = [];
  for (const s of set.pieces) {
    if (s.x1 < p.x - tol || s.x0 > p.x + tol || s.y1 < p.y - tol || s.y0 > p.y + tol) continue;
    if (distToPiece(s, p).d <= tol) near.push(s);
  }
  if (near.length <= MAX_CROSS_PIECES) {
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const x = crossPoint(near[i], near[j]);
        if (x) consider(x.x, x.y, 'cross');
      }
  }
  if (best) return best;
  for (const s of near) {
    const r = distToPiece(s, p);
    if (r.d <= bd) {
      bd = r.d;
      best = { p: r.p, kind: 'line' };
    }
  }
  return best;
}

function distToPiece(s: Piece, p: Pt): { d: number; p: Pt } {
  const vx = s.bx - s.ax,
    vy = s.by - s.ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.y - s.ay) * vy) / l2)) : 0;
  const q = { x: s.ax + vx * t, y: s.ay + vy * t };
  return { d: Math.hypot(q.x - p.x, q.y - p.y), p: q };
}

/** Echter Schnittpunkt zweier Stücke; aneinanderstoßende Stücke (gemeinsamer Endpunkt) zählen nicht */
function crossPoint(s: Piece, t: Piece): Pt | null {
  const rx = s.bx - s.ax,
    ry = s.by - s.ay,
    qx = t.bx - t.ax,
    qy = t.by - t.ay;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-12) return null;
  const u = ((t.ax - s.ax) * qy - (t.ay - s.ay) * qx) / den;
  const v = ((t.ax - s.ax) * ry - (t.ay - s.ay) * rx) / den;
  const e = 1e-9;
  if (u < -e || u > 1 + e || v < -e || v > 1 + e) return null;
  const x = s.ax + rx * u,
    y = s.ay + ry * u;
  const shared = (ax: number, ay: number) => Math.abs(ax - x) < 1e-6 && Math.abs(ay - y) < 1e-6;
  if ((shared(s.ax, s.ay) || shared(s.bx, s.by)) && (shared(t.ax, t.ay) || shared(t.bx, t.by))) return null;
  return { x, y };
}

/** Punkt waagrecht und senkrecht an Fangpunkten ausrichten (Alt beim Zeichnen) */
export function alignPoint(set: SnapSet, p: Pt, tol: number, extra: Pt[] = []): { p: Pt; guides: AlignGuide[] } {
  let bx: { d: number; v: number; o: number } | null = null,
    by: { d: number; v: number; o: number } | null = null;
  const check = (q: Pt) => {
    const dx = Math.abs(q.x - p.x),
      dy = Math.abs(q.y - p.y);
    if (dx <= tol && (!bx || dx < bx.d)) bx = { d: dx, v: q.x, o: q.y };
    if (dy <= tol && (!by || dy < by.d)) by = { d: dy, v: q.y, o: q.x };
  };
  set.pts.forEach(check);
  extra.forEach(check);
  const out = { x: p.x, y: p.y };
  const guides: AlignGuide[] = [];
  const gx = bx as { v: number; o: number } | null,
    gy = by as { v: number; o: number } | null;
  if (gx) out.x = gx.v;
  if (gy) out.y = gy.v;
  if (gx) guides.push({ axis: 'x', v: gx.v, a: gx.o, b: out.y });
  if (gy) guides.push({ axis: 'y', v: gy.v, a: gy.o, b: out.x });
  return { p: out, guides };
}

/**
 * Begrenzung der bewegten Auswahl an Kanten und Mitten anderer Objekte ausrichten (Alt beim Verschieben).
 * Liefert die Korrektur und die anzuzeigenden Hilfslinien.
 */
export function alignBox(set: SnapSet, b: Box, tol: number): { dx: number; dy: number; guides: AlignGuide[] } {
  const own = (o: number, w: number) => [o, o + w / 2, o + w];
  let best: { x?: { d: number; v: number; o: Box }; y?: { d: number; v: number; o: Box } } = {};
  const ox = own(b.x, b.w),
    oy = own(b.y, b.h);
  for (const o of set.boxes) {
    for (const v of own(o.x, o.w))
      for (const s of ox) {
        const d = v - s;
        if (Math.abs(d) <= tol && (!best.x || Math.abs(d) < Math.abs(best.x.d))) best.x = { d, v, o };
      }
    for (const v of own(o.y, o.h))
      for (const s of oy) {
        const d = v - s;
        if (Math.abs(d) <= tol && (!best.y || Math.abs(d) < Math.abs(best.y.d))) best.y = { d, v, o };
      }
  }
  const dx = best.x?.d ?? 0,
    dy = best.y?.d ?? 0;
  const guides: AlignGuide[] = [];
  if (best.x) {
    const o = best.x.o;
    guides.push({ axis: 'x', v: best.x.v, a: Math.min(o.y, b.y + dy), b: Math.max(o.y + o.h, b.y + dy + b.h) });
  }
  if (best.y) {
    const o = best.y.o;
    guides.push({ axis: 'y', v: best.y.v, a: Math.min(o.x, b.x + dx), b: Math.max(o.x + o.w, b.x + dx + b.w) });
  }
  return { dx, dy, guides };
}
