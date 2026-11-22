// Geometrie: Formen in Pfade umwandeln, Begrenzungsrahmen, Text-Layout, Treffertest.
import { apply, IDENT, inv, mul, Mat, Node, Obj, Pt, Shape, SubPath, TextShape } from './model';
import { clampRectCorners, rectCorners } from './model';
import { fitText, loadedFont, onFontLoaded, textLines, textToSubs, wrapParagraph, wrapWidth } from './fonts';
import { bezierPt, segments } from './curves';
import { shownText } from './vartext';
import { barcodeExtent, barcodeOutline } from './barcode';
import { forgetCenters } from './arcs';
import { resolveImageEdits } from './imageEdits';
import { resolveImageContour, type ImageContour, type ImageCorner } from './imageContour';
import { t } from './i18n';

export { bezierPt, segments };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const K = 0.5522847498; // Bézier-Näherung für Viertelkreise

/** Kurvenqualität (Tempo vs. Genauigkeit) für die Kurven-Abtastung bei Rahmen und Treffertest. */
export type CurveQuality = 'coarse' | 'balanced' | 'fine';
const CURVE_QUALITY_KEY = 'kizamubeam.curveQuality';
export const DEFAULT_CURVE_QUALITY: CurveQuality = 'balanced';

export function loadCurveQuality(): CurveQuality {
  try {
    const v = JSON.parse(localStorage.getItem(CURVE_QUALITY_KEY) ?? JSON.stringify(DEFAULT_CURVE_QUALITY));
    if (v === 'coarse' || v === 'balanced' || v === 'fine') return v;
  } catch {
    /* Speicher nicht verfügbar oder beschädigt */
  }
  return DEFAULT_CURVE_QUALITY;
}

export function saveCurveQuality(q: CurveQuality) {
  if (q !== 'coarse' && q !== 'balanced' && q !== 'fine') throw new Error(t('Ungültige Kurvenqualität.'));
  try {
    localStorage.setItem(CURVE_QUALITY_KEY, JSON.stringify(q));
  } catch {
    /* Speicher nicht verfügbar */
  }
  curveQualityCache = q;
}

/** Zwischenspeicher: Rahmen/Treffertest sind heiß, kein Speicherzugriff pro Kurve. */
let curveQualityCache: CurveQuality | null = null;
function currentCurveQuality(): CurveQuality {
  if (!curveQualityCache) curveQualityCache = loadCurveQuality();
  return curveQualityCache;
}

/** Abtastschritt je Qualität: grob 1/8, ausgewogen 1/16 (heutiges Verhalten), fein 1/32. */
function curveStep(q: CurveQuality): number {
  return q === 'coarse' ? 1 / 8 : q === 'fine' ? 1 / 32 : 1 / 16;
}

/** Grundformen als Knotenpfade (lokale Koordinaten). */
export function shapeSubs(s: Shape): SubPath[] {
  switch (s.kind) {
    case 'path':
    case 'gen':
      return s.subs;
    case 'barcode':
      return barcodeOutline(s).subs;
    case 'image':
      if (s.edit !== undefined) {
        const resolved = resolveImageEdits(s);
        // Invalid edits have no valid contour; render/check expose the error.
        return resolved.ok ? [{ closed: true, nodes: resolved.quad.map(p => ({ ...p })) }] : [];
      }
      // Umriss des Bildes (für Begrenzung, Auswahl und Rahmen)
      return [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }] }];
    case 'rect': {
      const { w, h } = s;
      const [tl, tr, br, bl] = clampRectCorners(rectCorners(s), w, h);
      if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0)
        return [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }];
      // Kantenpunkte je Ecke (Umlauf oben-links → oben-rechts → unten-rechts → unten-links, y nach unten).
      const S0 = { x: tl, y: 0 }, E0 = { x: w - tr, y: 0 };
      const S1 = { x: w, y: tr }, E1 = { x: w, y: h - br };
      const S2 = { x: w - br, y: h }, E2 = { x: bl, y: h };
      const S3 = { x: 0, y: h - bl }, E3 = { x: 0, y: tl };
      const kTL = tl * K, kTR = tr * K, kBR = br * K, kBL = bl * K;
      const at = (p: Pt, extra?: Partial<Node>): Node => ({ ...p, ...extra });
      // Je Ecke: Austritt der Vorgängerkante (cout) und Eintritt der Folgekante (cin) für den Viertelkreis.
      const nodes: Node[] = [];
      const push = (p: Node) => {
        const last = nodes[nodes.length - 1];
        if (last && Math.abs(last.x - p.x) < 1e-12 && Math.abs(last.y - p.y) < 1e-12
          && !last.cin && !last.cout && !p.cin && !p.cout) return;
        nodes.push(p);
      };
      push(at({ ...S0 }, tl > 0 ? { cin: { x: S0.x - kTL, y: 0 } } : {}));
      push(at({ ...E0 }, tr > 0 ? { cout: { x: E0.x + kTR, y: 0 } } : {}));
      push(at({ ...S1 }, tr > 0 ? { cin: { x: w, y: S1.y - kTR } } : {}));
      push(at({ ...E1 }, br > 0 ? { cout: { x: w, y: E1.y + kBR } } : {}));
      push(at({ ...S2 }, br > 0 ? { cin: { x: S2.x + kBR, y: h } } : {}));
      push(at({ ...E2 }, bl > 0 ? { cout: { x: E2.x - kBL, y: h } } : {}));
      push(at({ ...S3 }, bl > 0 ? { cin: { x: 0, y: S3.y + kBL } } : {}));
      push(at({ ...E3 }, tl > 0 ? { cout: { x: 0, y: E3.y - kTL } } : {}));
      // Zusammenfallende Eckpunkte (Radius 0) zu einem scharfen Knoten vereinen.
      const merged: Node[] = [];
      for (const n of nodes) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.x - n.x) < 1e-12 && Math.abs(last.y - n.y) < 1e-12) {
          last.cin = n.cin ?? last.cin;
          last.cout = n.cout ?? last.cout;
          if (!last.cin && !last.cout) { last.cin = undefined; last.cout = undefined; }
        } else merged.push({ ...n });
      }
      if (merged.length > 1) {
        const first = merged[0], last = merged[merged.length - 1];
        if (Math.abs(first.x - last.x) < 1e-12 && Math.abs(first.y - last.y) < 1e-12) {
          first.cin = last.cin ?? first.cin;
          merged.pop();
        }
      }
      return [{ closed: true, nodes: merged }];
    }
    case 'ellipse': {
      const { rx, ry } = s;
      const kx = rx * K,
        ky = ry * K;
      return [
        {
          closed: true,
          nodes: [
            { x: rx, y: 0, cin: { x: rx, y: -ky }, cout: { x: rx, y: ky }, smooth: true },
            { x: 0, y: ry, cin: { x: kx, y: ry }, cout: { x: -kx, y: ry }, smooth: true },
            { x: -rx, y: 0, cin: { x: -rx, y: ky }, cout: { x: -rx, y: -ky }, smooth: true },
            { x: 0, y: -ry, cin: { x: -kx, y: -ry }, cout: { x: kx, y: -ry }, smooth: true },
          ],
        },
      ];
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(s.sides));
      const nodes: Node[] = [];
      const count = s.star ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
        const r = s.star && i % 2 === 1 ? s.r * s.inner : s.r;
        nodes.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return [{ closed: true, nodes }];
    }
    default:
      return [];
  }
}

export function subsToPath2D(subs: SubPath[], p = new Path2D()): Path2D {
  for (const sp of subs) {
    const ns = sp.nodes;
    if (!ns.length) continue;
    p.moveTo(ns[0].x, ns[0].y);
    const seg = (a: Node, b: Node) => {
      if (a.cout || b.cin) {
        const c1 = a.cout ?? a,
          c2 = b.cin ?? b;
        p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      } else p.lineTo(b.x, b.y);
    };
    for (let i = 1; i < ns.length; i++) seg(ns[i - 1], ns[i]);
    if (sp.closed && ns.length > 1) {
      seg(ns[ns.length - 1], ns[0]);
      p.closePath();
    }
  }
  return p;
}

const localCache = new WeakMap<Shape, Path2D>();
/** Lokaler Pfad, zwischengespeichert pro Form-Objekt. Nach Änderung invalidate() aufrufen. */
export function localPath(s: Shape, world: Mat = IDENT): Path2D {
  // QR-Codes mit variablem Inhalt ändern sich ohne touch(); barcode.ts prüft selbst, ob der Inhalt noch passt
  if (s.kind === 'barcode') return barcodeOutline(s).path;
  // Edits may change in place without touch(), including crop/perspective reset.
  if (s.kind === 'image' && s.edit !== undefined) {
    const resolved = resolveImageContour(s, world), p = new Path2D();
    if (resolved.ok) {
      // Preserve exact legacy local coordinates without a world/inverse round trip.
      if (resolved.contour.corners.every(c => c.radius === 0)) {
        const local = resolveImageContour(s);
        return local.ok ? subsToPath2D([{ closed: true, nodes: local.contour.polygon }]) : p;
      }
      p.addPath(imageContourPath(resolved.contour), new DOMMatrix(inv(world)));
    }
    return p;
  }
  let p = localCache.get(s);
  if (!p) {
    p = subsToPath2D(shapeSubs(s));
    localCache.set(s, p);
  }
  return p;
}
export function invalidate(s: Shape) {
  localCache.delete(s);
  forgetCenters(s);
}

export function worldPath(s: Shape, m: Mat): Path2D {
  const p = new Path2D();
  p.addPath(localPath(s, m), new DOMMatrix(m));
  return p;
}

/** Construct circles in final world mm before inverse-transforming for local display. */
function imageContourPath(contour: ImageContour): Path2D {
  const p = new Path2D();
  const first = contour.corners[0].start;
  p.moveTo(first.x, first.y);
  for (let i = 0; i < contour.corners.length; i++) {
    const c = contour.corners[i];
    if (i) p.lineTo(c.start.x, c.start.y);
    if (c.radius) p.arc(c.center.x, c.center.y, c.radius,
      Math.atan2(c.start.y - c.center.y, c.start.x - c.center.x),
      Math.atan2(c.end.y - c.center.y, c.end.x - c.center.x), !contour.clockwise);
  }
  p.closePath();
  return p;
}

function onImageArc(c: ImageCorner, p: Pt): boolean {
  // The fillet is the minor arc between tangent points, on the vertex side.
  return (p.x - c.start.x) * (c.start.x - c.vertex.x) + (p.y - c.start.y) * (c.start.y - c.vertex.y) <= 1e-10
    && (p.x - c.end.x) * (c.end.x - c.vertex.x) + (p.y - c.end.y) * (c.end.y - c.vertex.y) <= 1e-10;
}

function imageContourExtrema(contour: ImageContour): Pt[] {
  return contour.corners.flatMap(c => {
    const points = [c.start, c.end];
    if (c.radius) for (const p of [
      { x: c.center.x - c.radius, y: c.center.y }, { x: c.center.x + c.radius, y: c.center.y },
      { x: c.center.x, y: c.center.y - c.radius }, { x: c.center.x, y: c.center.y + c.radius },
    ]) if (onImageArc(c, p)) points.push(p);
    return points;
  });
}

/** Segment parameters at exact line/arc boundary intersections (including overlap endpoints). */
export function imageContourSegmentCuts(contour: ImageContour, a: Pt, b: Pt): number[] {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const cuts: number[] = [];
  for (let i = 0; i < contour.corners.length; i++) {
    const c = contour.corners[i], end = contour.corners[(i + 1) % contour.corners.length].start;
    const ex = end.x - c.end.x, ey = end.y - c.end.y;
    const qx = c.end.x - a.x, qy = c.end.y - a.y, den = dx * ey - dy * ex;
    if (den) {
      const t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) cuts.push(t);
    } else if (qx * dy - qy * dx === 0 && segHitsBox(c.end, end,
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(dx), h: Math.abs(dy) })) {
      if (!length2) cuts.push(0);
      else {
        const t = (qx * dx + qy * dy) / length2, u = ((end.x - a.x) * dx + (end.y - a.y) * dy) / length2;
        cuts.push(Math.max(0, Math.min(t, u)), Math.min(1, Math.max(t, u)));
      }
    }
    if (!length2) {
      const edge2 = ex * ex + ey * ey;
      const u = edge2 ? Math.max(0, Math.min(1, ((a.x - c.end.x) * ex + (a.y - c.end.y) * ey) / edge2)) : 0;
      if (Math.hypot(a.x - c.end.x - u * ex, a.y - c.end.y - u * ey) < 1e-10) cuts.push(0);
    }
    if (!c.radius) continue;
    if (!length2) {
      if (Math.abs(Math.hypot(a.x - c.center.x, a.y - c.center.y) - c.radius) < 1e-10 && onImageArc(c, a)) cuts.push(0);
      continue;
    }
    const t = ((c.center.x - a.x) * dx + (c.center.y - a.y) * dy) / length2;
    const nx = a.x + t * dx - c.center.x, ny = a.y + t * dy - c.center.y;
    const gap = c.radius * c.radius - nx * nx - ny * ny;
    const tolerance = Math.max(c.radius * c.radius, nx * nx + ny * ny) * Number.EPSILON * 128;
    if (gap < -tolerance) continue;
    const half = Math.sqrt(Math.max(0, gap) / length2);
    for (const u of [t - half, t + half]) {
      if (u >= 0 && u <= 1 && onImageArc(c, { x: a.x + u * dx, y: a.y + u * dy })) cuts.push(u);
    }
  }
  return cuts;
}

/** Exact line/arc boundary crossing, shared by image marquee and freehand lasso. */
export function imageContourHitsSegment(contour: ImageContour, a: Pt, b: Pt): boolean {
  return imageContourSegmentCuts(contour, a, b).length > 0;
}

function samplePoints(subs: SubPath[]): Pt[] {
  const pts: Pt[] = [];
  const step = curveStep(currentCurveQuality());
  for (const sp of subs) {
    if (sp.nodes.length === 1) pts.push(sp.nodes[0]);
    for (const s of segments(sp)) {
      if (!s.curve) pts.push(s.a, s.b);
      else for (let t = 0; t <= 1.0001; t += step) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, t));
    }
  }
  return pts;
}

// ---------- Text ----------

const BASE = 100; // Text wird mit 100px gesetzt und auf mm skaliert
let mctx: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d')!;
  return mctx;
}

export function fontString(t: TextShape) {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${BASE}px "${t.font}", sans-serif`;
}

export interface TextLayout {
  k: number;
  font: string;
  spacing: number; // in Basiseinheiten
  lines: { text: string; x: number; y: number; w: number }[];
  /** Begrenzung in lokalen mm */
  box: Box;
}

// Beide Zwischenspeicher merken sich den angezeigten Text: Variabler Text ändert sich ohne touch()
let layoutCache = new WeakMap<TextShape, TextLayout & { shown: string }>();
/** Schriftkonturen je Text: dieselbe Geometrie wie bei Umwandeln in Pfad, Offset und Booleschen Operationen */
let outlineCache = new WeakMap<TextShape, { subs: SubPath[]; path: Path2D; shown: string }>();
onFontLoaded(() => {
  layoutCache = new WeakMap();
  outlineCache = new WeakMap();
});

/** Konturen des Texts in lokalen mm, sobald die Schrift geladen ist; vorher null */
export function textOutline(t: TextShape): { subs: SubPath[]; path: Path2D } | null {
  const shown = shownText(t);
  let o = outlineCache.get(t);
  if (o && o.shown === shown) return o;
  const f = loadedFont(t.font, t.bold, t.italic);
  if (!f) return null;
  const subs = textToSubs(t, f.font);
  o = { subs, path: subsToPath2D(subs), shown };
  outlineCache.set(t, o);
  return o;
}
export function textLayout(src: TextShape): TextLayout {
  const shown = shownText(src);
  const cached = layoutCache.get(src);
  if (cached && cached.shown === shown) return cached;
  // Eingepasster Text (Höchsthöhe, Verkleinern): Rahmen mit der tatsächlichen Schriftgröße
  const lf = loadedFont(src.font, src.bold, src.italic);
  const t = lf ? fitText(src, lf.font) : src;
  const ctx = measureCtx();
  const k = t.size / BASE;
  const font = fontString(t);
  ctx.font = font;
  const spacing = t.hSpace / k;
  const lh = BASE * 1.2 + t.vSpace / k;
  const f = loadedFont(t.font, t.bold, t.italic);
  const ls = f ? textLines(t, f.font) : null;
  const ww = wrapWidth(t);
  const paras = (t.upper ? shown.toUpperCase() : shown).split('\n');
  // Textrahmen: Zeilen wie bei den Konturen umbrechen, solange die Schrift lädt mit der Browserschrift gemessen
  const measure = (s: string) => (ctx.measureText(s).width + spacing * Math.max(0, [...s].length - 1)) * k;
  const raw = ls ? ls.map((l) => l.text) : ww ? paras.flatMap((p) => wrapParagraph(p, ww, measure)) : paras;
  let minX = Infinity,
    maxX = -Infinity;
  const lines = raw.map((text, i) => {
    const chars = [...text];
    const w = ctx.measureText(text).width + spacing * Math.max(0, chars.length - 1);
    const x = t.align === 'left' ? 0 : t.align === 'center' ? -w / 2 : -w;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    return { text, x, y: i * lh, w };
  });
  // Mit geladener Schrift die echten Vorschübe verwenden, damit Rahmen und Konturen zusammenpassen
  if (ls) {
    minX = Math.min(...ls.map((l) => l.x)) / k;
    maxX = Math.max(...ls.map((l) => l.x + l.w)) / k;
  }
  // Textrahmen: Der Rahmen hat immer die eingestellte Breite, auch wenn die Zeilen kürzer sind
  if (ww) {
    const x0 = (t.align === 'left' ? 0 : t.align === 'center' ? -ww / 2 : -ww) / k;
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x0 + ww / k);
  }
  if (maxX - minX < BASE * 0.2) maxX = minX + BASE * 0.2; // leere Zeile bleibt anklickbar
  const top = -BASE * 0.8,
    bottom = (raw.length - 1) * lh + BASE * 0.22;
  let box = { x: minX * k, y: top * k, w: (maxX - minX) * k, h: (bottom - top) * k };
  // Text auf Pfad: Rahmen aus den gesetzten Konturen, solange die Schrift lädt aus der Kurve
  if (t.path) box = subsBox(textOutline(t)?.subs ?? [t.path.sub]) ?? box;
  const lay = { k, font, spacing, lines, box, shown };
  layoutCache.set(src, lay);
  return lay;
}
function subsBox(subs: SubPath[]): Box | null {
  const pts = samplePoints(subs);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function invalidateText(t: TextShape) {
  layoutCache.delete(t);
  outlineCache.delete(t);
}

/** Text zeichnen. ctx muss bereits die Ansichtstransformation tragen. */
export function drawText(ctx: CanvasRenderingContext2D, t: TextShape, m: Mat, mode: 'fill' | 'stroke', px: number) {
  const outline = textOutline(t);
  if (outline) {
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (mode === 'fill') ctx.fill(outline.path, 'evenodd');
    else {
      ctx.lineWidth = px / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      ctx.stroke(outline.path);
    }
    ctx.restore();
    return;
  }
  // Schrift noch nicht geladen: vorläufig mit der Browserschrift zeichnen
  const lay = textLayout(t);
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.scale(lay.k, lay.k);
  ctx.font = lay.font;
  ctx.textBaseline = 'alphabetic';
  // Schrift noch nicht geladen: Browser formt mit (arabische Verbindung inklusive);
  // Zeile rechtsbündig an ihrer rechten Kante ausrichten
  if (t.rtl) ctx.direction = 'rtl';
  ctx.textAlign = t.rtl ? 'right' : 'left';
  if (mode === 'stroke') {
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * lay.k;
    ctx.lineWidth = px / s;
  }
  for (const ln of lay.lines) {
    const lx = t.rtl ? ln.x + ln.w : ln.x;
    if (!lay.spacing) {
      if (mode === 'fill') ctx.fillText(ln.text, lx, ln.y);
      else ctx.strokeText(ln.text, lx, ln.y);
      continue;
    }
    let x = lx;
    for (const ch of ln.text) {
      if (mode === 'fill') ctx.fillText(ch, x, ln.y);
      else ctx.strokeText(ch, x, ln.y);
      x += (t.rtl ? -1 : 1) * (ctx.measureText(ch).width + lay.spacing);
    }
  }
  ctx.direction = 'ltr';
  ctx.textAlign = 'start';
  ctx.restore();
}

// ---------- Begrenzung ----------

export function emptyBox(): Box {
  return { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
}

function addPts(b: { x0: number; y0: number; x1: number; y1: number }, m: Mat, pts: Pt[]) {
  for (const p of pts) {
    const q = apply(m, p.x, p.y);
    b.x0 = Math.min(b.x0, q.x);
    b.y0 = Math.min(b.y0, q.y);
    b.x1 = Math.max(b.x1, q.x);
    b.y1 = Math.max(b.y1, q.y);
  }
}

function objExtents(o: Obj, parent: Mat, b: { x0: number; y0: number; x1: number; y1: number }) {
  const m = mul(parent, o.m);
  const s = o.shape;
  if (s.kind === 'group') s.children.forEach((c) => objExtents(c, m, b));
  else if (s.kind === 'text') {
    const bx = textLayout(s).box;
    addPts(b, m, [
      { x: bx.x, y: bx.y },
      { x: bx.x + bx.w, y: bx.y },
      { x: bx.x + bx.w, y: bx.y + bx.h },
      { x: bx.x, y: bx.y + bx.h },
    ]);
  } else if (s.kind === 'image' && s.edit !== undefined) {
    const resolved = resolveImageContour(s, m);
    if (resolved.ok) addPts(b, IDENT, imageContourExtrema(resolved.contour));
  } else addPts(b, m, samplePoints(shapeSubs(s)));
}

export function boundsOf(objs: Iterable<Obj>, parent: Mat = IDENT): Box | null {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const o of objs) objExtents(o, parent, b);
  if (!isFinite(b.x0)) return null;
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

// ---------- Treffertest ----------

let hctx: CanvasRenderingContext2D | null = null;
function hitCtx() {
  if (!hctx) hctx = document.createElement('canvas').getContext('2d')!;
  return hctx;
}

/** Trifft der Weltpunkt p ein Blatt-Objekt? tol in mm. */
export function hitLeaf(o: Obj, m: Mat, p: Pt, tol: number, inside: boolean): boolean {
  const s = o.shape;
  if (s.kind === 'text') {
    // Text auf Pfad: die Konturen treffen (der Rahmen umfasst oft viel leere Fläche, z. B. bei einem Kreis)
    const ol = s.path ? textOutline(s) : null;
    if (ol) {
      const ctx = hitCtx();
      const wp = new Path2D();
      wp.addPath(ol.path, new DOMMatrix(m));
      ctx.lineWidth = tol * 2 + s.size * 0.25 * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      return ctx.isPointInPath(wp, p.x, p.y, 'nonzero') || ctx.isPointInStroke(wp, p.x, p.y);
    }
    const q = apply(inv(m), p.x, p.y);
    const b = textLayout(s).box;
    const t = tol / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
    return q.x >= b.x - t && q.x <= b.x + b.w + t && q.y >= b.y - t && q.y <= b.y + b.h + t;
  }
  if ((s.kind === 'image' && s.edit === undefined) || s.kind === 'barcode') {
    // Bilder und QR-Codes: die ganze Fläche trifft (einzelne Module wären zu kleine Ziele)
    const q = apply(inv(m), p.x, p.y);
    const t = tol / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
    const e = s.kind === 'image' ? { x0: 0, y0: 0, x1: s.w, y1: s.h } : barcodeExtent(s);
    return q.x >= e.x0 - t && q.x <= e.x1 + t && q.y >= e.y0 - t && q.y <= e.y1 + t;
  }
  const ctx = hitCtx();
  const wp = worldPath(s, m);
  ctx.lineWidth = tol * 2;
  if (ctx.isPointInStroke(wp, p.x, p.y)) return true;
  return (inside || s.kind === 'image') && ctx.isPointInPath(wp, p.x, p.y, 'evenodd');
}

/** Schnell: Überschneidet die Kontur das Rechteck? (Für Kreuzungsauswahl) */
export function leafIntersectsBox(o: Obj, m: Mat, r: Box): boolean {
  const s = o.shape;
  const inBox = (q: Pt) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
  if (s.kind === 'text') {
    const b = boundsOf([o], mul(m, inv(o.m)));
    if (!b) return false;
    return !(b.x > r.x + r.w || b.x + b.w < r.x || b.y > r.y + r.h || b.y + b.h < r.y);
  }
  if (s.kind === 'image' && s.edit !== undefined) {
    const resolved = resolveImageContour(s, m);
    if (!resolved.ok) return false;
    const { contour } = resolved;
    const boxCorners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    if (boxCorners.some(contour.contains)) return true;
    return contour.corners.some(c => inBox(c.start) || inBox(c.end))
      || boxCorners.some((a, i) => imageContourHitsSegment(contour, a, boxCorners[(i + 1) % boxCorners.length]));
  }
  for (const sp of shapeSubs(s)) {
    const pts = samplePoints([sp]).map((p) => apply(m, p.x, p.y));
    if (pts.some(inBox)) return true;
    for (let i = 1; i < pts.length; i++) if (segHitsBox(pts[i - 1], pts[i], r)) return true;
  }
  return false;
}

function segHitsBox(a: Pt, b: Pt, r: Box): boolean {
  // Liang-Barsky
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y);
}

// ---------- SVG-Export ----------

const n2 = (v: number) => String(Math.round(v * 1000) / 1000);

export function subsToD(subs: SubPath[], m: Mat): string {
  const P = (p: Pt) => {
    const q = apply(m, p.x, p.y);
    return `${n2(q.x)} ${n2(q.y)}`;
  };
  let d = '';
  for (const sp of subs) {
    if (!sp.nodes.length) continue;
    d += `M${P(sp.nodes[0])}`;
    for (const s of segments(sp)) d += s.curve ? `C${P(s.c1)} ${P(s.c2)} ${P(s.b)}` : `L${P(s.b)}`;
    if (sp.closed) d += 'Z';
  }
  return d;
}
