// Eckenradius-Ziehen für Bild und Rechteck: reine, DOM-freie Mathematik (testbar).
// Bildradien sind angeforderte Welt-mm (die Geometrie begrenzt die wirksame Größe,
// die Anforderung bleibt erhalten); Rechteckradien klemmen auf 0..min(w,h)/2.

/** Bild: jede Anforderung >= 0 und endlich, sonst Fehlermeldung. */
export function clampImageRadius(radius: number): number | null {
  if (!Number.isFinite(radius) || radius < 0) return null;
  return radius;
}

/** Rechteck: Klemmen auf 0..min(w,h)/2; ungültige Maße geben 0. */
export function clampRectRadius(radius: number, w: number, h: number): number {
  const limit = Math.min(Math.abs(w), Math.abs(h)) / 2;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  if (!Number.isFinite(radius)) return 0;
  return Math.min(limit, Math.max(0, radius));
}

/** Radius aus Zeigerposition: Abstand zur Eckverankerung in lokalen mm. */
export function pointerCornerRadius(pointerLocal: { x: number; y: number }, anchorLocal: { x: number; y: number }): number {
  return Math.max(0, Math.hypot(pointerLocal.x - anchorLocal.x, pointerLocal.y - anchorLocal.y));
}

/** Rechteckradius aus Zeigerposition im Formlokal: min(lx,ly), geklemmt. */
export function rectRadiusFromLocal(lx: number, ly: number, w: number, h: number): number {
  if (!Number.isFinite(lx) || !Number.isFinite(ly)) return 0;
  return clampRectRadius(Math.min(lx, ly), w, h);
}

/** Delta auf eine oder alle Ecken anwenden (null = alle gemeinsam), Ergebnis >= 0. */
export function addCornerRadii(current: number[], count: number, index: number | null, delta: number): number[] {
  const d = Number.isFinite(delta) ? delta : 0;
  const next = Array.from({ length: Math.max(current.length, count) }, (_, i) => current[i] ?? 0);
  if (index === null) {
    for (let i = 0; i < count; i++) next[i] = Math.max(0, next[i] + d);
  } else if (Number.isInteger(index) && index >= 0 && index < count) {
    next[index] = Math.max(0, next[index] + d);
  }
  return next;
}
