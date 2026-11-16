// Editor: reine Geometrie des Bogenwerkzeugs (ohne Editor-, Dokument- oder Canvas-Zustand).
// Kreisbögen werden als offener Pfad mit kubischen Bézier-Segmenten ausgegeben. Jedes Segment
// überstreicht höchstens 90°; mit k = (4/3)·tan(Δ/4) bleibt die Abweichung zum exakten Kreis
// bei ≤ 2,7e-4·r (Maximum bei 90°; gemessen 2,708e-4·r). Kleinere Segmente sind entsprechend genauer.
import { Node, Pt, SubPath } from '../model';

/** Größter Winkel eines Segments; darüber wächst der Näherungsfehler über die zugesagte Grenze. */
export const ARC_MAX_SEGMENT = Math.PI / 2;
/** Rastschritt für Winkel mit Shift. */
export const ARC_SNAP = Math.PI / 12;
/** Kleinster Radius in mm; darunter gilt ein Bogen als nicht gesetzt. */
export const ARC_MIN_RADIUS = 1e-6;
/** Kleinster überstrichener Winkel in rad; 0 wäre nur ein Punkt. */
export const ARC_MIN_SWEEP = 1e-9;

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Konstruktionsart: Mitte–Radius–Winkel oder drei Punkte (Start, Durchgang, Ende). */
export type ArcMode = 'center' | '3point';

/**
 * Laufender Bogen. Dieselbe Form trägt Vorschau und Commit; es gibt kein zweites Datenmodell.
 * phase 1: Mitte bzw. Startpunkt, phase 2: Radius und Startwinkel bzw. Durchgangspunkt,
 * phase 3: Endwinkel bzw. Endpunkt.
 */
export interface ArcDraft {
  mode: ArcMode;
  phase: 1 | 2 | 3;
  center: Pt;
  /** Radius in Welt-mm (nur Mitte-Modus) */
  radius: number;
  /** Startwinkel in rad (nur Mitte-Modus) */
  a0: number;
  /** Endwinkel in rad, Vorschau; die Richtung entscheidet beim Commit */
  a1: number;
  /** Drei-Punkt-Modus: gesetzte Punkte in Welt-mm */
  start: Pt;
  mid: Pt;
  end: Pt;
}

/** Kreisbogen in analytischer Form. */
export interface ArcSpec {
  cx: number;
  cy: number;
  r: number;
  /** Startwinkel in rad */
  a0: number;
  /** Vorzeichenbehafteter Überstreichungswinkel in rad; positiv = wachsender Winkel (auf dem Bildschirm im Uhrzeigersinn, weil y nach unten zeigt) */
  sweep: number;
}

/** Punkt auf dem Kreis zum Winkel a. */
export const arcPoint = (cx: number, cy: number, r: number, a: number): Pt =>
  ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });

/**
 * Knoten eines offenen Kreisbogens, aufgeteilt in Segmente von höchstens 90°.
 * Die Knotenreihenfolge folgt dem Vorzeichen von sweep (negativ = umgekehrt).
 * Der letzte Knoten liegt exakt auf dem Kreis beim Winkel a0 + sweep.
 */
export function arcNodes(cx: number, cy: number, r: number, a0: number, sweep: number): Node[] {
  if (![cx, cy, r, a0, sweep].every(Number.isFinite) || !(r > 0)) return [];
  if (Math.abs(sweep) < ARC_MIN_SWEEP) return [arcPoint(cx, cy, r, a0)];
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_MAX_SEGMENT));
  const delta = sweep / n;
  const arm = (4 / 3) * Math.tan(delta / 4) * r;
  const nodes: Node[] = [];
  for (let i = 0; i <= n; i++) {
    // Der Endwinkel wird direkt aus a0 + sweep gerechnet, damit der Endpunkt nicht durch
    // aufsummierte Schrittfehler neben dem Kreis liegt.
    const a = i === n ? a0 + sweep : a0 + i * delta;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    // Tangente in Richtung wachsender Winkel; arm trägt das Vorzeichen von delta.
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    nodes.push({
      x,
      y,
      ...(i > 0 && i < n ? { smooth: true } : {}),
      ...(i > 0 ? { cin: { x: x - tx * arm, y: y - ty * arm } } : {}),
      ...(i < n ? { cout: { x: x + tx * arm, y: y + ty * arm } } : {}),
    });
  }
  return nodes;
}

/** Knoten umdrehen und dabei cin/cout tauschen (Gegenrichtung eines offenen Pfads). */
export function reverseNodes(nodes: Node[]): Node[] {
  return nodes.slice().reverse().map((n) => {
    const out: Node = { x: n.x, y: n.y, ...(n.smooth === undefined ? {} : { smooth: n.smooth }) };
    if (n.cout) out.cin = { x: n.cout.x, y: n.cout.y };
    if (n.cin) out.cout = { x: n.cin.x, y: n.cin.y };
    return out;
  });
}

/**
 * Kreis durch drei Punkte. Der Durchgangspunkt p2 entscheidet, welcher der beiden Bögen
 * zwischen p1 und p3 gemeint ist. null bei identischen, kollinearen oder zu kleinen Punkten.
 */
export function arcFrom3Points(p1: Pt, p2: Pt, p3: Pt): ArcSpec | null {
  const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
  if (same(p1, p2) || same(p2, p3) || same(p1, p3)) return null;
  const { x: ax, y: ay } = p1;
  const { x: bx, y: by } = p2;
  const { x: cx, y: cy } = p3;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  if (!Number.isFinite(r) || r < ARC_MIN_RADIUS) return null;
  const a1 = Math.atan2(ay - uy, ax - ux);
  const am = Math.atan2(by - uy, bx - ux);
  const ae = Math.atan2(cy - uy, cx - ux);
  const ccw = norm(ae - a1);
  const through = norm(am - a1);
  // Kleine Toleranz, damit ein Durchgangspunkt knapp am Gegenpunkt nicht in den langen Bogen kippt.
  const sweep = through <= ccw + 1e-12 ? ccw : ccw - TAU;
  // Start ≈ Ende relativ zum Kreis wäre fast ein Vollkreis: als offener Pfad degeneriert,
  // darum ablehnen. Flache fast-kollineare Bögen (kleiner Sweep) bleiben erlaubt.
  if (TAU - Math.abs(sweep) < 1e-6) return null;
  if (Math.abs(sweep) < ARC_MIN_SWEEP) return null;
  return { cx: ux, cy: uy, r, a0: a1, sweep };
}

/** Winkel auf ein Vielfaches von step rasten (Shift: 15°). */
export function snapAngle(a: number, step = ARC_SNAP): number {
  return Math.round(a / step) * step;
}

/** Vorzeichenbehafteter Winkel von a0 nach a1 in der gewählten Richtung (0 wird nicht zum Vollkreis).
 *  Die Welt-y-Achse zeigt nach unten: Gegen den Uhrzeigersinn bedeutet abnehmender Winkel. */
export function travelSweep(a0: number, a1: number, cw: boolean): number {
  const forward = norm(a1 - a0);
  return cw ? forward : -(norm(a0 - a1));
}

/** Neuer Bogen; alle Punkte beginnen am Klickpunkt. */
export function newArcDraft(mode: ArcMode, at: Pt): ArcDraft {
  const p = { x: at.x, y: at.y };
  return { mode, phase: 1, center: { ...p }, radius: 0, a0: 0, a1: 0, start: { ...p }, mid: { ...p }, end: { ...p } };
}

/** Analytischer Bogen des laufenden Entwurfs; null, solange er unvollständig oder ungültig ist. */
export function arcSpec(draft: ArcDraft, cw: boolean): ArcSpec | null {
  if (draft.mode === 'center') {
    if (!(draft.radius >= ARC_MIN_RADIUS)) return null;
    if (draft.phase < 3) return null;
    const sweep = travelSweep(draft.a0, draft.a1, cw);
    if (Math.abs(sweep) < ARC_MIN_SWEEP) return null;
    return { cx: draft.center.x, cy: draft.center.y, r: draft.radius, a0: draft.a0, sweep };
  }
  return arcFrom3Points(draft.start, draft.mid, draft.end);
}

/**
 * Fertiger offener Teilpfad des Entwurfs. Im Drei-Punkt-Modus bestimmen die Punkte die
 * Geometrie; die Richtungswahl kehrt dort die Knotenreihenfolge um (cin/cout werden getauscht).
 */
export function arcSubPath(draft: ArcDraft, cw: boolean): SubPath | null {
  const spec = arcSpec(draft, cw);
  if (!spec) return null;
  let nodes = arcNodes(spec.cx, spec.cy, spec.r, spec.a0, spec.sweep);
  if (!nodes.length) return null;
  if (draft.mode === '3point' && cw !== (spec.sweep > 0)) nodes = reverseNodes(nodes);
  return { nodes, closed: false };
}
