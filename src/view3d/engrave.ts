// Gravuren für die 3D-Ansicht: Füllungen, gravierte Linien, Texte und Bilder, die auf einer Platte liegen, werden
// in ein Bild der Plattenoberfläche gezeichnet. Der Viewer legt es auf die Seite der Platte, die beim Lasern oben
// lag. Die Farbe hängt vom Material ab: dunkle Brandspur auf Holz, hell auf Schiefer, milchig auf Acryl.
import type { Editor } from '../editor';
import type { ImageShape, Mat, Obj, TextShape } from '../model';
import { apply, inv, leaves, mul, outputLeaves } from '../model';
import { boundsOf, drawText, subsToPath2D, worldPath } from '../geom';
import { displayCanvas } from '../images';
import { cross, dot } from './poses';
import type { Solid } from './solids';

/** Wo eine Platte auf der Arbeitsfläche liegt: Seite und Abbildung von Arbeitsflächen- in Plattenkoordinaten */
export interface CanvasPlace {
  page: number;
  toLocal: Mat;
}

/** Bild der Gravuren auf einer Platte (lokale Koordinaten: Pixel = (x − x0, y − y0) · k) */
export interface Engraving {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  k: number;
  /** Seite der Platte: true = Höhe Dicke, false = Höhe 0 */
  top: boolean;
}

/** Farbe der Gravur, wenn das Material keine eigene hat: Brandspur auf Holz */
export const BURN = { color: '#3a2210', alpha: 0.88 };
/** Breite gravierter Linien in mm */
const LINE_MM = 0.25;
/** Größte Kantenlänge des Bildes in Pixeln und höchste Auflösung */
const MAX_PX = 2048;
const MAX_K = 10;

interface Mark {
  o: Obj;
  m: Mat;
  kind: 'fill' | 'line' | 'text-fill' | 'text-line' | 'image';
  box: [number, number, number, number];
}

/** Was auf einer Seite gelasert wird und nicht selbst Platte oder Loch ist (Issue #217: hidden zählt mit) */
function pageMarks(ed: Editor, page: number): Mark[] {
  const pg = ed.doc.pages[page];
  if (!pg) return [];
  const out: Mark[] = [];
  for (const [o, m] of outputLeaves(pg.objs)) {
    const L = ed.layer(o.layer);
    if (!L.output) continue;
    const s = o.shape;
    let kind: Mark['kind'] | null = null;
    if (s.kind === 'image') kind = 'image';
    else if (s.kind === 'text') kind = L.mode === 'fill' ? 'text-fill' : 'text-line';
    else if (L.mode === 'fill') kind = 'fill';
    // Auf Schnitt-Layern sind geschlossene Formen Schnitte (Platten oder Löcher); offene Linien werden graviert
    else if (s.kind === 'path' && (s.mark || s.subs.some((sp) => !sp.closed))) kind = 'line';
    if (!kind) continue;
    const b = boundsOf([o], mul(m, inv(o.m)));
    if (!b) continue;
    out.push({ o, m, kind, box: [b.x, b.y, b.x + b.w, b.y + b.h] });
  }
  return out;
}

/** Farbe einer Gravur (#rrggbb und Deckkraft 0..1) */
export interface MarkColor {
  color: string;
  alpha: number;
}
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (c: MarkColor) => `rgba(${rgbOf(c.color).join(', ')}, ${c.alpha})`;

/** Alpha aus der Helligkeit: Schwarz (Laser an) wird Gravur in der Farbe des Materials, Weiß durchsichtig */
const burnCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
function burnImage(cv: HTMLCanvasElement, mc: MarkColor): HTMLCanvasElement {
  const key = `${mc.color}|${mc.alpha}`;
  const byColor = burnCache.get(cv) ?? new Map<string, HTMLCanvasElement>();
  burnCache.set(cv, byColor);
  const c = byColor.get(key);
  if (c) return c;
  const [r, g, b] = rgbOf(mc.color);
  const out = document.createElement('canvas');
  out.width = cv.width;
  out.height = cv.height;
  const src = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = 255 - (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a * Math.min(1, mc.alpha * 1.05) * (d[i + 3] / 255);
  }
  out.getContext('2d')!.putImageData(src, 0, 0);
  byColor.set(key, out);
  return out;
}

/**
 * Gravuren je Platte. places: Lage auf der Arbeitsfläche je Schlüssel der Platte (ohne Eintrag keine Gravur).
 * Liefert nur Einträge für Platten, auf denen wirklich etwas graviert wird. colorOf: Farbe der Gravur je Platte.
 */
export function engravings(ed: Editor, solids: Solid[], places: Map<string, CanvasPlace>, colorOf: (s: Solid) => MarkColor = () => BURN): Map<string, Engraving> {
  const out = new Map<string, Engraving>();
  if (typeof document === 'undefined') return out;
  const marksOf = new Map<number, Mark[]>();
  for (const s of solids) {
    const pl = places.get(s.key);
    if (!pl) continue;
    if (!marksOf.has(pl.page)) marksOf.set(pl.page, pageMarks(ed, pl.page));
    const marks = marksOf.get(pl.page)!;
    if (!marks.length) continue;
    // Ausdehnung der Platte lokal und auf der Arbeitsfläche
    const pts = s.polys.flat();
    if (!pts.length) continue;
    const xs = pts.map((q) => q.x),
      ys = pts.map((q) => q.y);
    const x0 = Math.min(...xs),
      y0 = Math.min(...ys),
      x1 = Math.max(...xs),
      y1 = Math.max(...ys);
    const fromLocal = inv(pl.toLocal);
    const corners = [apply(fromLocal, x0, y0), apply(fromLocal, x1, y0), apply(fromLocal, x0, y1), apply(fromLocal, x1, y1)];
    const cb = [Math.min(...corners.map((q) => q.x)), Math.min(...corners.map((q) => q.y)), Math.max(...corners.map((q) => q.x)), Math.max(...corners.map((q) => q.y))];
    const hits = marks.filter((mk) => mk.box[0] < cb[2] && mk.box[2] > cb[0] && mk.box[1] < cb[3] && mk.box[3] > cb[1]);
    if (!hits.length) continue;
    const w = x1 - x0,
      h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    const k = Math.min(MAX_K, MAX_PX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * k));
    canvas.height = Math.max(1, Math.ceil(h * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const t = pl.toLocal;
    // Arbeitsfläche → Platte → Pixel
    ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
    const scaleT = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) || 1;
    const lineW = Math.max(LINE_MM, 1 / k) / scaleT;
    const mc = colorOf(s);
    ctx.fillStyle = ctx.strokeStyle = css(mc);
    ctx.lineCap = ctx.lineJoin = 'round';
    // Bilder zuerst, Vektoren darüber (wie auf der Arbeitsfläche)
    for (const mk of hits) {
      if (mk.kind !== 'image') continue;
      const sh = mk.o.shape as ImageShape;
      const cv = displayCanvas(sh, mk.m, ed.imgOutput(mk.o.layer), true);
      if (!cv) continue;
      ctx.save();
      ctx.transform(mk.m[0], mk.m[1], mk.m[2], mk.m[3], mk.m[4], mk.m[5]);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(burnImage(cv, mc), 0, 0, sh.w, sh.h);
      ctx.restore();
    }
    for (const mk of hits) {
      const sh = mk.o.shape;
      if (mk.kind === 'fill') {
        // Offene Pfade werden auf Füll-Layern nicht gefüllt
        const subs = sh.kind === 'path' ? sh.subs.filter((sp) => sp.closed) : null;
        const p = new Path2D();
        if (subs) p.addPath(subsToPath2D(subs), new DOMMatrix(mk.m));
        else p.addPath(worldPath(sh, mk.m));
        ctx.fill(p, 'evenodd');
      } else if (mk.kind === 'line' && sh.kind === 'path') {
        const p = new Path2D();
        p.addPath(subsToPath2D(sh.subs.filter((sp) => !sp.closed)), new DOMMatrix(mk.m));
        ctx.lineWidth = lineW;
        ctx.stroke(p);
      } else if (mk.kind === 'text-fill' || mk.kind === 'text-line') {
        // drawText teilt die Linienbreite selbst durch die Skalierung des Objekts
        drawText(ctx, sh as TextShape, mk.m, mk.kind === 'text-fill' ? 'fill' : 'stroke', lineW);
      }
    }
    // Gravur liegt auf der Seite, die beim Lasern nach oben zeigte; ist die Platte gespiegelt, ist das die andere
    const det = t[0] * t[3] - t[1] * t[2];
    const top = det * dot(cross(s.pose.u, s.pose.v), s.pose.n) < 0;
    out.set(s.key, { canvas, x0, y0, k, top });
  }
  return out;
}

/** Abbildung Arbeitsfläche → Teil für ein Objekt einer Baugruppe (inklusive Gruppen, in denen es steckt) */
export function memberPlace(ed: Editor, o: Obj): CanvasPlace | null {
  for (let i = 0; i < ed.doc.pages.length; i++)
    for (const [l, m] of leaves(ed.doc.pages[i].objs)) if (l === o) return { page: i, toLocal: inv(m) };
  return null;
}
