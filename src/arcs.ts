// Kreise und Kreisbögen in Pfaden erkennen: Mittelpunkte zeigen und fangen, auch bei Löchern,
// importierten DXF/SVG-Kreisen, Ergebnissen Boolescher Operationen und abgerundeten Ecken.
// Alle Werte in lokalen mm der Form; keine Abhängigkeit von geom.ts (geom ruft forgetCenters auf).
import { Pt, Shape, SubPath } from './model';
import { bezierPt, segments } from './curves';

/** Ein Kreisbogen aus einem oder mehreren aufeinanderfolgenden Segmenten eines Unterpfads */
export interface ArcInfo {
  c: Pt;
  r: number;
  /** Unterpfad und erstes Segment */
  sub: number;
  seg: number;
  /** Anzahl der Segmente */
  count: number;
  /** Startwinkel und überstrichener Winkel (Bogenmaß, Vorzeichen = Richtung) */
  a0: number;
  sweep: number;
  /** ganzer Kreis (geschlossener Unterpfad, der nur aus diesem Bogen besteht) */
  full: boolean;
}

export type CenterKind = 'circle' | 'ellipse' | 'polygon' | 'arc';

/** Mittelpunkt, der angezeigt und gefangen wird */
export interface CenterMark {
  x: number;
  y: number;
  kind: CenterKind;
  /** Radius (Kreis, Bogen) bzw. Halbachsen (Ellipse) */
  r?: number;
  ry?: number;
  /** Quadrantenpunkte (0°, 90°, 180°, 270°) */
  quads?: Pt[];
  /** Bogen: überstrichener Winkel (Betrag) */
  sweep?: number;
}

/** Ab diesem Winkel wird ein Bogen-Mittelpunkt auch angezeigt (kleinere Bögen, z. B. Eckenrundungen, fangen nur) */
export const SHOW_ARC_SWEEP = (150 * Math.PI) / 180;

/** Grundtoleranz: Kurveneinpassung nach Booleschen Operationen und Offset weicht bis 0,02 mm ab */
const TOL = 0.03;
const tolFor = (r: number) => TOL + r * 4e-4;

/** Kreis durch drei Punkte; null bei (fast) gerader Lage */
export function circleFrom3(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const bx = b.x - a.x,
    by = b.y - a.y,
    cx = c.x - a.x,
    cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  const scale = Math.max(Math.hypot(bx, by), Math.hypot(cx, cy));
  if (!scale || Math.abs(d) < 1e-9 * scale * scale) return null;
  const b2 = bx * bx + by * by,
    c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d,
    uy = (bx * c2 - cx * b2) / d;
  return { c: { x: a.x + ux, y: a.y + uy }, r: Math.hypot(ux, uy) };
}

/** Ist das Segment (Bézier a–c1–c2–b) ein Kreisbogen? Liefert Mittelpunkt, Radius, Start- und Bogenwinkel */
export function segmentArc(a: Pt, c1: Pt, c2: Pt, b: Pt): { c: Pt; r: number; a0: number; sweep: number } | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6 && Math.hypot(c1.x - a.x, c1.y - a.y) < 1e-6) return null;
  const m = bezierPt(a, c1, c2, b, 0.5);
  const circ = circleFrom3(a, m, b);
  if (!circ || circ.r > 1e5) return null;
  // fast gerade Kurven sind keine Bögen: Pfeilhöhe zu klein
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = chord ? Math.abs((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)) / chord : circ.r;
  if (sag < 0.02) return null;
  const tol = tolFor(circ.r);
  for (const t of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) {
    const p = bezierPt(a, c1, c2, b, t);
    if (Math.abs(Math.hypot(p.x - circ.c.x, p.y - circ.c.y) - circ.r) > tol) return null;
  }
  const ang = (p: Pt) => Math.atan2(p.y - circ.c.y, p.x - circ.c.x);
  const a0 = ang(a);
  const norm = (v: number) => {
    while (v <= -Math.PI) v += 2 * Math.PI;
    while (v > Math.PI) v -= 2 * Math.PI;
    return v;
  };
  // über die Mitte laufen, damit auch Bögen über 180° die richtige Richtung bekommen
  const sweep = norm(ang(m) - a0) + norm(ang(b) - ang(m));
  if (Math.abs(sweep) < 1e-3) return null;
  return { c: circ.c, r: circ.r, a0, sweep };
}

/** Geschlossener Unterpfad aus vielen Geraden, deren Knoten alle auf einem Kreis liegen (Kreise aus Vielecken) */
function polyCircle(sp: SubPath): { c: Pt; r: number } | null {
  const ns = sp.nodes;
  if (!sp.closed || ns.length < 12 || ns.some((n) => n.cin || n.cout)) return null;
  let cx = 0,
    cy = 0;
  for (const n of ns) {
    cx += n.x;
    cy += n.y;
  }
  cx /= ns.length;
  cy /= ns.length;
  let r = 0;
  for (const n of ns) r += Math.hypot(n.x - cx, n.y - cy);
  r /= ns.length;
  if (r < 0.2) return null;
  const tol = Math.max(0.02, r * 0.005);
  for (const n of ns) if (Math.abs(Math.hypot(n.x - cx, n.y - cy) - r) > tol) return null;
  return { c: { x: cx, y: cy }, r };
}

/** Kreis nach kleinsten Quadraten (Kåsa) durch die Punkte */
export function fitCircle(pts: Pt[]): { c: Pt; r: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0,
    my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  // zentriert rechnen (numerisch stabil)
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx,
      v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = (suuu + suvv) / 2,
    b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det,
    vc = (suu * b2 - suv * b1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { c: { x: mx + uc, y: my + vc }, r };
}

const SAMPLES = 8;
function samplesOf(s: { a: Pt; c1: Pt; c2: Pt; b: Pt }, first: boolean): Pt[] {
  const out: Pt[] = [];
  for (let i = first ? 0 : 1; i <= SAMPLES; i++) out.push(bezierPt(s.a, s.c1, s.c2, s.b, i / SAMPLES));
  return out;
}
const onCircle = (pts: Pt[], c: { c: Pt; r: number }) => {
  const tol = tolFor(c.r);
  return pts.every((p) => Math.abs(Math.hypot(p.x - c.c.x, p.y - c.c.y) - c.r) <= tol);
};

/** Alle Kreisbögen der Unterpfade; aufeinanderfolgende Segmente auf demselben Kreis werden zusammengefasst */
export function findArcs(subs: SubPath[]): ArcInfo[] {
  const out: ArcInfo[] = [];
  subs.forEach((sp, si) => {
    const pc = polyCircle(sp);
    if (pc) {
      out.push({ c: pc.c, r: pc.r, sub: si, seg: 0, count: sp.nodes.length, a0: 0, sweep: 2 * Math.PI, full: true });
      return;
    }
    const segs = segments(sp);
    const n = segs.length;
    if (!n) return;
    const arcs = segs.map((s) => (s.curve ? segmentArc(s.a, s.c1, s.c2, s.b) : null));
    // Setzt Segment j den Bogen fort, der mit Kreis c und Richtung dir läuft?
    const continues = (c: { c: Pt; r: number }, dir: number, j: number) => {
      const b = arcs[j];
      return !!b && Math.sign(b.sweep) === dir && onCircle(samplesOf(segs[j], false), c);
    };
    // Bei geschlossenen Pfaden an einer Stelle beginnen, an der kein Bogen über den Anfang läuft
    let start = 0;
    if (sp.closed) {
      start = -1;
      for (let i = 0; i < n; i++) {
        const prev = arcs[(i - 1 + n) % n];
        if (!arcs[i] || !prev || !continues(prev, Math.sign(prev.sweep), i)) {
          start = i;
          break;
        }
      }
      if (start < 0) start = 0;
    }
    let i = 0;
    while (i < n) {
      const k = (start + i) % n;
      const a = arcs[k];
      if (!a) {
        i++;
        continue;
      }
      const dir = Math.sign(a.sweep);
      const pts = samplesOf(segs[k], true);
      let circ: { c: Pt; r: number } = { c: a.c, r: a.r };
      let cnt = 1,
        sweep = a.sweep;
      while (i + cnt < n) {
        const j = (start + i + cnt) % n;
        if (!continues(circ, dir, j)) break;
        pts.push(...samplesOf(segs[j], false));
        circ = fitCircle(pts) ?? circ;
        sweep += arcs[j]!.sweep;
        cnt++;
      }
      const full = sp.closed && cnt === n && Math.abs(Math.abs(sweep) - 2 * Math.PI) < 0.05;
      out.push({ c: circ.c, r: circ.r, sub: si, seg: k, count: cnt, a0: Math.atan2(segs[k].a.y - circ.c.y, segs[k].a.x - circ.c.x), sweep, full });
      i += cnt;
    }
  });
  return out;
}

const cache = new WeakMap<Shape, CenterMark[]>();

/** Zwischenspeicher einer Form verwerfen (aus geom.invalidate) */
export function forgetCenters(s: Shape) {
  cache.delete(s);
}

/**
 * Mittelpunkte einer Form in lokalen mm. subs: Umriss der Form (shapeSubs), wird nur für Pfade gebraucht.
 * Text, Bilder, Strichcodes und Gruppen haben keine.
 */
export function shapeCenters(s: Shape, subs: () => SubPath[]): CenterMark[] {
  let c = cache.get(s);
  if (c) return c;
  c = computeCenters(s, subs);
  cache.set(s, c);
  return c;
}

function computeCenters(s: Shape, subs: () => SubPath[]): CenterMark[] {
  switch (s.kind) {
    case 'ellipse': {
      const circle = Math.abs(s.rx - s.ry) < 1e-9;
      return [{
        x: 0, y: 0, kind: circle ? 'circle' : 'ellipse', r: s.rx, ry: s.ry,
        quads: [{ x: s.rx, y: 0 }, { x: 0, y: s.ry }, { x: -s.rx, y: 0 }, { x: 0, y: -s.ry }],
      }];
    }
    case 'polygon':
      return [{ x: 0, y: 0, kind: 'polygon', r: s.r }];
    case 'rect':
    case 'path':
    case 'gen':
      return marksFromArcs(findArcs(subs()));
    default:
      return [];
  }
}

function marksFromArcs(arcs: ArcInfo[]): CenterMark[] {
  const out: CenterMark[] = [];
  for (const a of arcs) {
    const tol = tolFor(a.r) * 2;
    const kind: CenterKind = a.full ? 'circle' : 'arc';
    // gleicher Mittelpunkt mit gleichem Radius nur einmal (z. B. Bogen in mehreren Teilen); konzentrische Kreise bleiben
    const dup = out.find((m) => Math.hypot(m.x - a.c.x, m.y - a.c.y) <= tol && Math.abs((m.r ?? 0) - a.r) <= tol);
    if (dup) {
      if (kind === 'circle') dup.kind = 'circle';
      dup.sweep = Math.max(dup.sweep ?? 0, Math.abs(a.sweep));
      continue;
    }
    const m: CenterMark = { x: a.c.x, y: a.c.y, kind, r: a.r, sweep: Math.abs(a.sweep) };
    if (a.full) m.quads = [{ x: a.c.x + a.r, y: a.c.y }, { x: a.c.x, y: a.c.y + a.r }, { x: a.c.x - a.r, y: a.c.y }, { x: a.c.x, y: a.c.y - a.r }];
    out.push(m);
  }
  return out;
}

/** Wird der Mittelpunkt angezeigt (nicht nur gefangen)? */
export function shownMark(m: CenterMark): boolean {
  return m.kind !== 'arc' || (m.sweep ?? 0) >= SHOW_ARC_SWEEP;
}
