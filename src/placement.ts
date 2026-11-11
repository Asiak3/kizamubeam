// Freien Platz für neue Teile suchen: einfache First-Fit-Platzierung mit umschließenden Rechtecken, ohne Drehung
// und ohne Verschachteln. Koordinaten wie im Modell (mm, y nach unten); „unten links“ ist also großes y, kleines x.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

const EPS = 1e-6;

/** Passt ein Rechteck dieser Größe mit Randabstand überhaupt auf eine leere Fläche? */
export function fitsArea(size: Size, area: Size, margin: number): boolean {
  return size.w <= area.w - 2 * margin + EPS && size.h <= area.h - 2 * margin + EPS;
}

/**
 * Linke obere Ecke (Modell) des ersten freien Platzes für ein Rechteck der Größe size auf der Fläche area,
 * oder null, wenn keiner frei ist. Gesucht wird wie angezeigt von unten links: zuerst die unterste Reihe,
 * darin von links nach rechts. Zwischen Teilen bleibt mindestens gap frei, zum Rand der Fläche margin.
 * Hindernisse dürfen über die Fläche hinausragen; was ganz außerhalb liegt, stört nicht.
 *
 * Kandidaten sind nur die Lagen, an denen das Teil unten und links an den Rand oder an ein Hindernis stößt:
 * Jede freie Lage lässt sich so weit nach unten und links schieben, bis sie dort anliegt.
 */
export function findFreeSpot(obstacles: Rect[], size: Size, area: Size, gap: number, margin: number): { x: number; y: number } | null {
  if (!fitsArea(size, area, margin)) return null;
  const minX = margin, maxX = area.w - margin - size.w;
  const minTop = margin, maxBottom = area.h - margin;
  const xs = new Set<number>([minX]);
  const bottoms = new Set<number>([maxBottom]);
  for (const o of obstacles) {
    xs.add(o.x + o.w + gap);
    bottoms.add(o.y - gap);
  }
  const xList = [...xs].filter((x) => x >= minX - EPS && x <= maxX + EPS).sort((a, b) => a - b);
  const bList = [...bottoms].filter((b) => b - size.h >= minTop - EPS && b <= maxBottom + EPS).sort((a, b) => b - a);
  for (const bottom of bList) {
    const top = bottom - size.h;
    // Nur Hindernisse, die diese Reihe (samt Abstand) berühren, kommen für die x-Prüfung in Frage
    const row = obstacles.filter((o) => o.y < bottom + gap - EPS && o.y + o.h > top - gap + EPS);
    for (const x of xList) {
      const hit = row.some((o) => o.x < x + size.w + gap - EPS && o.x + o.w > x - gap + EPS);
      if (!hit) return { x, y: top };
    }
  }
  return null;
}
