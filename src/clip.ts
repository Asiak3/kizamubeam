// Anbindung an Clipper (Angus Johnson, JS-Port): Kurven in Ganzzahl-Linienzüge zerlegen und Ergebnisse
// wieder als Bézierpfade einpassen. Ohne Abhängigkeit von geom.ts, damit auch die Schrift-Engine es nutzen kann.
import ClipperLib from 'clipper-lib';
import { apply, IDENT, Mat, Pt, SubPath } from './model';
import { bezierPt, segments } from './curves';
import { fitPolyline } from './fit';

/** Clipper rechnet mit Ganzzahlen: 1 Einheit = 1 µm */
export const SCALE = 1000;
/** Maximale Abweichung beim Zerlegen von Kurven in mm */
export const FLATTEN_TOL = 0.01;
/** Größter Punktabstand beim Zerlegen von Kurven (mm); längere Strecken erkennt die Kurvenrückführung als Gerade */
const FLATTEN_MAX_STEP = 1;
/** Erlaubte Abweichung der eingepassten Bézierkurven vom Ergebnis (mm) */
const FIT_TOL = 0.02;

export type Path = ClipperLib.Path;
export type Paths = ClipperLib.Paths;
const { Clipper, ClipType, PolyType, PolyFillType } = ClipperLib;

export function flattenSub(sp: SubPath, m: Mat, parameters?: number[]): Path {
  const out: Path = [];
  const push = (p: Pt, u: number) => {
    const q = apply(m, p.x, p.y);
    const X = Math.round(q.x * SCALE),
      Y = Math.round(q.y * SCALE);
    const l = out[out.length - 1];
    if (!l || l.X !== X || l.Y !== Y) { out.push({ X, Y }); parameters?.push(u); }
  };
  if (sp.nodes.length) push(sp.nodes[0], 0);
  for (const [index, s] of segments(sp).entries()) {
    if (!s.curve) {
      push(s.b, index + 1);
      continue;
    }
    // Anzahl Teilstücke aus der Länge des Kontrollpolygons (in Weltkoordinaten)
    const w = [s.a, s.c1, s.c2, s.b].map((p) => apply(m, p.x, p.y));
    const len = Math.hypot(w[1].x - w[0].x, w[1].y - w[0].y) + Math.hypot(w[2].x - w[1].x, w[2].y - w[1].y) + Math.hypot(w[3].x - w[2].x, w[3].y - w[2].y);
    const n = Math.max(4, Math.min(2048, Math.max(Math.ceil(Math.sqrt(len / FLATTEN_TOL) * 0.6), Math.ceil(len / FLATTEN_MAX_STEP))));
    for (let i = 1; i <= n; i++) push(bezierPt(s.a, s.c1, s.c2, s.b, i / n), index + i / n);
  }
  if (sp.closed && out.length > 1) {
    const a = out[0],
      b = out[out.length - 1];
    if (a.X === b.X && a.Y === b.Y) { out.pop(); parameters?.pop(); }
  }
  return out;
}

export function pathsToSubs(paths: Paths): SubPath[] {
  return Clipper.CleanPolygons(paths, 1)
    .filter((p) => p.length >= 3)
    .map((p) => fitPolyline(p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })), true, FIT_TOL));
}


export function execute(type: ClipperLib.ClipType, subj: Paths, clip: Paths, fill: ClipperLib.PolyFillType): Paths {
  const c = new Clipper();
  c.AddPaths(subj, PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, fill, fill);
  return out;
}

/**
 * Buchstaben schweißen: überlappende Glyphen zu einer Kontur vereinen.
 * Jede Glyphe wird zuerst für sich nach Gerade-Ungerade bereinigt (Löcher wie im „o“ bleiben, egal wie die Schrift
 * ihre Konturen dreht), danach werden alle Glyphen vereint. Ergebnis als Bézierpfade.
 */
export function weldGlyphs(glyphs: SubPath[][]): SubPath[] {
  const all: Paths = [];
  for (const subs of glyphs) {
    const own = subs.filter((sp) => sp.nodes.length > 1).map((sp) => flattenSub({ ...sp, closed: true }, IDENT));
    if (own.length) all.push(...execute(ClipType.ctUnion, own, [], PolyFillType.pftEvenOdd));
  }
  if (!all.length) return [];
  return pathsToSubs(execute(ClipType.ctUnion, all, [], PolyFillType.pftNonZero));
}
