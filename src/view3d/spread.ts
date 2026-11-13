// Baugruppen, Verbindungsgruppen und Mehrlagenarbeiten in der 3D-Ansicht voneinander trennen (Issue #260)
import { packParts, polySub } from '../generators/build';
import { Solid, solidBounds } from './solids';

/** Ein Block, der in der Ansicht zusammenbleibt: Baugruppe, Gruppe verbundener Teile oder Mehrlagenarbeit */
export interface Placement {
  parts: Solid[];
  /** Feste Reihenfolge (kleinste Objekt-ID des Blocks), damit die Anordnung zwischen zwei Aktualisierungen nicht springt */
  order: number;
}

/** Abstand zwischen auseinandergerückten Blöcken in mm */
export const SPREAD_GAP = 10;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const EPS = 1e-6;

/** Grundriss eines Blocks (Ausdehnung in X und Y der Welt) */
function footprint(parts: Solid[]): Rect {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of parts) {
    const b = solidBounds(p);
    r.x0 = Math.min(r.x0, b.min[0]);
    r.y0 = Math.min(r.y0, b.min[1]);
    r.x1 = Math.max(r.x1, b.max[0]);
    r.y1 = Math.max(r.y1, b.max[1]);
  }
  return r;
}

/** Überdecken sich die Grundrisse wirklich (Berühren zählt nicht)? */
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;

const byOrder = (items: Placement[]) => items.map((it, i) => ({ it, i })).sort((a, b) => a.it.order - b.it.order || a.i - b.i).map((x) => x.it);

function shift(p: Placement, r: Rect, dx: number, dy: number): Rect {
  for (const s of p.parts) s.pose = { ...s.pose, o: [s.pose.o[0] + dx, s.pose.o[1] + dy, s.pose.o[2]] };
  return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy };
}

/**
 * Blöcke, deren Grundrisse sich überdecken, in Reihen fast quadratisch nebeneinanderlegen (wie packParts bei den Teilen
 * einer Baugruppe). Die Gruppe bleibt um ihre bisherige Mitte; wer niemanden überdeckt, bleibt genau, wo er ist.
 * Erwartet mindestens zwei Blöcke.
 */
function spreadBlocks(items: Placement[], gap: number): void {
  const list = byOrder(items);
  const fp = list.map((it) => footprint(it.parts));
  // Jede Runde fasst mindestens zwei Gruppen zusammen, also höchstens list.length Runden
  for (let round = 0; round < list.length; round++) {
    const root = list.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    let any = false;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (!hit(fp[i], fp[j])) continue;
        root[find(j)] = find(i);
        any = true;
      }
    if (!any) break;
    const clusters = new Map<number, number[]>();
    list.forEach((_, i) => {
      const r = find(i);
      (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(i);
    });
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      const cx = (Math.min(...members.map((i) => fp[i].x0)) + Math.max(...members.map((i) => fp[i].x1))) / 2;
      const cy = (Math.min(...members.map((i) => fp[i].y0)) + Math.max(...members.map((i) => fp[i].y1))) / 2;
      const packed = packParts(
        members.map((i) => {
          const w = fp[i].x1 - fp[i].x0,
            h = fp[i].y1 - fp[i].y0;
          return { key: String(i), subs: [polySub([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }])] };
        }),
        gap,
      );
      packed.forEach((p, k) => {
        const i = members[k];
        fp[i] = shift(list[i], fp[i], cx + p.at.x - fp[i].x0, cy + p.at.y - fp[i].y0);
      });
    }
  }
}

/**
 * Überdeckungen in der Ansicht auflösen: Blöcke, die sich überdecken, werden nebeneinandergelegt (spreadBlocks).
 * Verändert die Lage (pose) der Teile.
 */
export function spreadApart(items: Placement[], gap = SPREAD_GAP): void {
  // Ein einzelner Block kann sich mit nichts überdecken
  if (items.length < 2) return;
  spreadBlocks(items, gap);
}
