// Einheitliche Kontur-Topologie (Issue #219): ein kanonischer Enthaltenstest für
// Schnittreihenfolge (`orderPolys`), Haltesteg-Ausschluss (`withTabs`) und
// Lochmarkierung (`markHoles`). Alle drei Stellen teilen sich Box-Aufbau,
// Enthaltensregel und Baum; Füllen und Kerf bleiben bewusst bei ihrer
// Even-Odd-Parität (Clipper/`fillLines`) — der Baum dient dort nur als
// Cross-Check (Tiefe vs. Parität), nicht als Ersatz.
//
// Kanonische Regel (aus der Schnittreihenfolge übernommen, Maintainer-Entscheid
// vom 2026-11-13): Rahmen-Prefilter, identische Rahmen nur in einer Richtung
// gezählt, dann erster Punkt ODER Rahmenmitte im Container. Offene und
// berührende Konturen gelten nie als innen; die Sehnenstrategie für Kurven
// teilen sich alle über `flatten` (`FLATTEN_TOL`).
import type { Pt } from './model';
import type { Box } from './gcode';

/** Kontur für Topologiezwecke: nur Punkte und geschlossen-Flag zählen */
export interface TopoPoly {
  pts: Pt[];
  closed: boolean;
}

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function addPt(b: Box, x: number, y: number) {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
}

/** Hülle einer Punktfolge */
export function boxOf(pts: Pt[]): Box {
  const b = emptyBox();
  for (const q of pts) addPt(b, q.x, q.y);
  return b;
}

/** Hülle je Form, parallel zum Eingabe-Array */
export function boxesOf(polys: readonly TopoPoly[]): Box[] {
  return polys.map((p) => boxOf(p.pts));
}

/** Rahmenmitte (Fallback, wenn der erste Punkt auf der Containerkante liegt) */
export const midOf = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Punkt in geschlossener Kontur (Gerade-Ungerade-Regel; Punkte auf der Kante zählen als draußen) */
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Strikte Enthaltung von Form i in der geschlossenen Form j: Rahmen-Prefilter,
 * identische Rahmen nur in einer Richtung (`i < j` gewinnt nie) — sonst
 * blockieren sich deckungsgleiche Formen gegenseitig —, dann erster Punkt
 * oder Rahmenmitte im Container.
 */
export function containsStrict(polys: readonly TopoPoly[], boxes: readonly Box[], i: number, j: number): boolean {
  if (i === j || !polys[j].closed) return false;
  const a = boxes[i],
    c = boxes[j];
  if (a.x0 < c.x0 || a.y0 < c.y0 || a.x1 > c.x1 || a.y1 > c.y1) return false;
  // gleich große Rahmen: nur eine Richtung zählen, sonst blockieren sich deckungsgleiche Formen
  if (a.x0 === c.x0 && a.y0 === c.y0 && a.x1 === c.x1 && a.y1 === c.y1 && i < j) return false;
  return pointInPoly(polys[i].pts[0], polys[j].pts) || pointInPoly(midOf(a), polys[j].pts);
}

/** Enthaltenbaum: je Form der engste Container und die Even-Odd-Tiefe */
export interface Containment {
  /** engster Container je Form (-1 = keiner); bei Flächengleichstand der erste */
  parent: Int32Array;
  /** Anzahl aller Container je Form (Even-Odd-Tiefe; ungerade = Loch) */
  depth: Int32Array;
}

/** Baum und Tiefe über alle Paare mit `containsStrict` aufbauen */
export function buildContainment(polys: readonly TopoPoly[], boxes: readonly Box[] = boxesOf(polys)): Containment {
  const n = polys.length;
  const parent = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n);
  const area = boxes.map((b) => (b.x1 - b.x0) * (b.y1 - b.y0));
  for (let i = 0; i < n; i++) {
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (!containsStrict(polys, boxes, i, j)) continue;
      depth[i]++;
      if (best < 0 || area[j] < area[best]) best = j;
    }
    parent[i] = best;
  }
  return { parent, depth };
}
