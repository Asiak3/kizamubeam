// Beziehungen, die einmal angewendet werden (konzentrisch, gleich, parallel, senkrecht, horizontal, vertikal,
// tangential, Abstand), und Messwerte. Reine Geometrie in Welt-mm (y nach unten): liefert die Transformation,
// die das Zielobjekt bekommt. Das erste gewählte Element ist die Referenz und bleibt stehen.
import { about, Mat, Pt, rotate, scale, translate } from './model';
import { t } from './i18n';

export type RelMode = 'concentric' | 'equal' | 'parallel' | 'perpendicular' | 'horizontal' | 'vertical' | 'tangent' | 'distance';

export const REL_MODES: RelMode[] = ['concentric', 'equal', 'parallel', 'perpendicular', 'horizontal', 'vertical', 'tangent', 'distance'];

export const REL_LABELS: Record<RelMode, string> = {
  concentric: t('Konzentrisch'),
  equal: t('Gleich groß'),
  parallel: t('Parallel'),
  perpendicular: t('Senkrecht|Beziehung'),
  horizontal: t('Horizontal|Beziehung'),
  vertical: t('Vertikal|Beziehung'),
  tangent: t('Tangential'),
  distance: t('Abstand'),
};

export const REL_HINTS: Record<RelMode, string> = {
  concentric: t('Konzentrisch: zuerst den Kreis anklicken, der stehen bleibt, dann den Kreis (oder die Ellipse, das Vieleck), dessen Objekt verschoben wird.'),
  equal: t('Gleich groß: Referenz-Kreis oder -Kante anklicken, dann Kreis bzw. Kante des Objekts, das skaliert wird.'),
  parallel: t('Parallel: Referenzkante anklicken, dann die Kante des Objekts, das gedreht wird.'),
  perpendicular: t('Senkrecht: Referenzkante anklicken, dann die Kante des Objekts, das gedreht wird.'),
  horizontal: t('Horizontal: Kante anklicken, ihr Objekt wird so gedreht, dass sie waagrecht liegt.'),
  vertical: t('Vertikal: Kante anklicken, ihr Objekt wird so gedreht, dass sie senkrecht steht.'),
  tangent: t('Tangential: Kreis und Kante (oder zwei Kreise) anklicken; das zweite Objekt rückt, bis es den ersten berührt.'),
  distance: t('Abstand: Referenz (Kreis, Kante oder Punkt) anklicken, dann das Element, dessen Objekt verschoben wird; danach Abstand eingeben.'),
};

/** Gewähltes Element in Welt-mm */
export type RelElem =
  | { kind: 'circle'; c: Pt; r: number }
  | { kind: 'edge'; a: Pt; b: Pt }
  | { kind: 'point'; p: Pt };

/** Wie viele Elemente die Beziehung braucht */
export const relCount = (m: RelMode) => (m === 'horizontal' || m === 'vertical' ? 1 : 2);

/** Passt das Element an diese Stelle der Beziehung? (i = 0 Referenz, 1 Ziel) */
export function relAccepts(mode: RelMode, i: number, e: RelElem, first?: RelElem): boolean {
  switch (mode) {
    case 'concentric':
      return e.kind === 'circle';
    case 'equal':
      return i === 0 ? e.kind !== 'point' : e.kind !== 'point' && e.kind === first?.kind;
    case 'parallel':
    case 'perpendicular':
    case 'horizontal':
    case 'vertical':
      return e.kind === 'edge';
    case 'tangent':
      if (e.kind === 'point') return false;
      return i === 0 || first?.kind === 'circle' || e.kind === 'circle';
    case 'distance':
      return true;
  }
}

const dirOf = (e: { a: Pt; b: Pt }) => Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
const midOf = (e: { a: Pt; b: Pt }): Pt => ({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
const lenOf = (e: { a: Pt; b: Pt }) => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
/** kleinster Drehwinkel, der Richtung `from` auf `to` bringt, wobei Richtungen mod period gleich sind */
function minTurn(from: number, to: number, period: number): number {
  let d = (to - from) % period;
  if (d > period / 2) d -= period;
  if (d < -period / 2) d += period;
  return d;
}
const elemPoint = (e: RelElem): Pt => (e.kind === 'circle' ? e.c : e.kind === 'point' ? e.p : midOf(e));

/** Fehler als Text oder die Transformation (Welt), die vor das Zielobjekt multipliziert wird */
export type RelResult = { ok: true; T: Mat; scaled?: boolean } | { ok: false; msg: string };

/**
 * Transformation für das Ziel. ref = erstes Element (bei horizontal/vertikal das einzige), target = zweites.
 * dist: gewünschter Abstand für 'distance'.
 */
export function relationTransform(mode: RelMode, ref: RelElem, target: RelElem | null, dist = 0): RelResult {
  const fail = (msg: string): RelResult => ({ ok: false, msg });
  if (mode === 'horizontal' || mode === 'vertical') {
    if (ref.kind !== 'edge') return fail(t('Bitte eine gerade Kante wählen.'));
    const want = mode === 'horizontal' ? 0 : Math.PI / 2;
    const d = minTurn(dirOf(ref), want, Math.PI);
    const c = midOf(ref);
    return { ok: true, T: about(rotate(d), c.x, c.y) };
  }
  if (!target) return fail(t('Zweites Element fehlt.'));
  switch (mode) {
    case 'concentric': {
      if (ref.kind !== 'circle' || target.kind !== 'circle') return fail(t('Bitte zwei Kreise wählen.'));
      return { ok: true, T: translate(ref.c.x - target.c.x, ref.c.y - target.c.y) };
    }
    case 'equal': {
      if (ref.kind === 'circle' && target.kind === 'circle') {
        if (!(target.r > 0)) return fail(t('Kreis ohne Radius.'));
        const k = ref.r / target.r;
        return { ok: true, T: about(scale(k, k), target.c.x, target.c.y), scaled: true };
      }
      if (ref.kind === 'edge' && target.kind === 'edge') {
        const lt = lenOf(target);
        if (!(lt > 0)) return fail(t('Kante ohne Länge.'));
        const k = lenOf(ref) / lt,
          c = midOf(target);
        return { ok: true, T: about(scale(k, k), c.x, c.y), scaled: true };
      }
      return fail(t('Gleich groß braucht zwei Kreise oder zwei Kanten.'));
    }
    case 'parallel':
    case 'perpendicular': {
      if (ref.kind !== 'edge' || target.kind !== 'edge') return fail(t('Bitte zwei gerade Kanten wählen.'));
      const want = dirOf(ref) + (mode === 'perpendicular' ? Math.PI / 2 : 0);
      const d = minTurn(dirOf(target), want, Math.PI);
      const c = midOf(target);
      return { ok: true, T: about(rotate(d), c.x, c.y) };
    }
    case 'tangent': {
      // Kreis–Kreis: entlang der Mittelpunktlinie bis zur Berührung (außen, oder innen, wenn einer im anderen liegt)
      if (ref.kind === 'circle' && target.kind === 'circle') {
        const dx = target.c.x - ref.c.x,
          dy = target.c.y - ref.c.y;
        const d = Math.hypot(dx, dy);
        const inside = d < Math.abs(ref.r - target.r) || (d < 1e-9 && ref.r !== target.r);
        const want = inside ? Math.abs(ref.r - target.r) : ref.r + target.r;
        const ux = d > 1e-9 ? dx / d : 1,
          uy = d > 1e-9 ? dy / d : 0;
        return { ok: true, T: translate(ref.c.x + ux * want - target.c.x, ref.c.y + uy * want - target.c.y) };
      }
      // Kreis und Gerade: senkrecht zur Geraden verschieben, bis der Abstand Mitte–Gerade dem Radius entspricht
      const circle = ref.kind === 'circle' ? ref : target.kind === 'circle' ? target : null;
      const edge = ref.kind === 'edge' ? ref : target.kind === 'edge' ? target : null;
      if (!circle || !edge) return fail(t('Tangential braucht einen Kreis und eine Kante oder zwei Kreise.'));
      const L = lenOf(edge);
      if (!(L > 0)) return fail(t('Kante ohne Länge.'));
      const nx = -(edge.b.y - edge.a.y) / L,
        ny = (edge.b.x - edge.a.x) / L;
      const sd = (circle.c.x - edge.a.x) * nx + (circle.c.y - edge.a.y) * ny; // Abstand mit Vorzeichen
      const side = sd >= 0 ? 1 : -1;
      const move = side * circle.r - sd; // Kreis verschieben um move·n
      // Ziel bewegt sich: ist der Kreis das Ziel, wandert er; ist die Kante das Ziel, wandert sie entgegengesetzt
      const sgn = target === circle ? 1 : -1;
      return { ok: true, T: translate(sgn * move * nx, sgn * move * ny) };
    }
    case 'distance': {
      if (!(dist >= 0)) return fail(t('Ungültiger Abstand.'));
      // parallele Kanten: senkrechter Abstand
      if (ref.kind === 'edge' && target.kind === 'edge') {
        const turn = Math.abs(minTurn(dirOf(ref), dirOf(target), Math.PI));
        if (turn < 1e-3) {
          const L = lenOf(ref);
          const nx = -(ref.b.y - ref.a.y) / L,
            ny = (ref.b.x - ref.a.x) / L;
          const m = midOf(target);
          const sd = (m.x - ref.a.x) * nx + (m.y - ref.a.y) * ny;
          const side = sd >= 0 ? 1 : -1;
          const move = side * dist - sd;
          return { ok: true, T: translate(move * nx, move * ny) };
        }
      }
      // Kante und Punkt/Kreis: Abstand zur Geraden (Mittelpunkt)
      if (ref.kind === 'edge' && target.kind !== 'edge') {
        const L = lenOf(ref);
        const nx = -(ref.b.y - ref.a.y) / L,
          ny = (ref.b.x - ref.a.x) / L;
        const p = elemPoint(target);
        const sd = (p.x - ref.a.x) * nx + (p.y - ref.a.y) * ny;
        const move = (sd >= 0 ? 1 : -1) * dist - sd;
        return { ok: true, T: translate(move * nx, move * ny) };
      }
      // sonst: Punkt zu Punkt (Mittelpunkte, Kantenmitten) entlang ihrer Verbindung
      const a = elemPoint(ref),
        b = elemPoint(target);
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.hypot(dx, dy);
      const ux = d > 1e-9 ? dx / d : 1,
        uy = d > 1e-9 ? dy / d : 0;
      return { ok: true, T: translate(a.x + ux * dist - b.x, a.y + uy * dist - b.y) };
    }
  }
  return fail('?');
}

/** Aktueller Abstand der beiden Elemente, wie 'distance' ihn versteht (Vorschlag im Dialog) */
export function currentDistance(ref: RelElem, target: RelElem): number {
  if (ref.kind === 'edge') {
    const L = lenOf(ref);
    const nx = -(ref.b.y - ref.a.y) / L,
      ny = (ref.b.x - ref.a.x) / L;
    const p = target.kind === 'edge' && Math.abs(minTurn(dirOf(ref), dirOf(target), Math.PI)) < 1e-3 ? midOf(target) : target.kind === 'edge' ? null : elemPoint(target);
    if (p) return Math.abs((p.x - ref.a.x) * nx + (p.y - ref.a.y) * ny);
  }
  const a = elemPoint(ref),
    b = elemPoint(target);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Messwerte zweier Punkte (Welt, y nach unten): Länge, Δx, Δy (Maschinenrichtung) und Winkel gegen die x-Achse */
export function measureOf(a: Pt, b: Pt): { len: number; dx: number; dy: number; angle: number } {
  const dx = b.x - a.x,
    dy = -(b.y - a.y);
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return { len: Math.hypot(dx, dy), dx, dy, angle };
}

/** Winkel zwischen zwei Kanten (0 … 90°) */
export function angleBetween(e: { a: Pt; b: Pt }, f: { a: Pt; b: Pt }): number {
  const d = Math.abs(minTurn(dirOf(e), dirOf(f), Math.PI));
  return (d * 180) / Math.PI;
}

