// Shaper-Erkennung: grobe Freihand-Geste → saubere Grundform.
// Rein geometrisch-heuristisch, kein ML, keine neue Dependency.
// Pur: kein Editor-State, kein DOM — nur Welt-mm-Punkte rein, Formvorschlag raus.
// Unterhalb der Konfidenzschwelle liefert recognize() null: der Aufrufer behält
// dann die Freihand-Polyline (nie still verwerfen).
import type { Pt } from './model';

/** Erkennbare Grundformen (Kreis ist eine Ellipse mit rx≈ry). */
export type ShaperKind = 'line' | 'rect' | 'roundrect' | 'ellipse' | 'polygon';

/** Mindest-Konfidenz, ab der ein Vorschlag übernommen wird. */
export const SHAPER_MIN_CONFIDENCE = 0.6;

export interface ShaperLine { kind: 'line'; a: Pt; b: Pt; confidence: number }
export interface ShaperRect { kind: 'rect'; cx: number; cy: number; w: number; h: number; angle: number; confidence: number }
export interface ShaperRoundRect { kind: 'roundrect'; cx: number; cy: number; w: number; h: number; angle: number; r: number; confidence: number }
export interface ShaperEllipse { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle: number; confidence: number }
export interface ShaperPolygon { kind: 'polygon'; cx: number; cy: number; r: number; sides: number; rotation: number; confidence: number }
export type ShaperMatch = ShaperLine | ShaperRect | ShaperRoundRect | ShaperEllipse | ShaperPolygon;

const RESAMPLE_N = 64;
const CORNER_WIN = 4;
const CORNER_ANGLE = 0.6; // ~34° Richtungswechsel gilt als Ecke

/** Standard-Schließabstand in mm: liegt das Ende näher am Anfang, gilt die Geste als geschlossen. */
export const SHAPER_CLOSE_GAP = 2;

export interface ShaperClosure {
  closed: boolean;
  /** Abstand Ende→Anfang in Welt-mm. */
  gap: number;
  /** Erlaubter Abstand in Welt-mm (dieselbe Zahl für Vorschau und Auswertung). */
  limit: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Offen/geschlossen nach reinem Endpunktabstand in mm. EINE Regel für Vorschau
 * und Auswertung: was die Vorschau als geschlossen zeigt, wird auch geschlossen
 * verarbeitet.
 */
export function closureOf(points: Pt[], limit = SHAPER_CLOSE_GAP): ShaperClosure {
  const lim = Math.max(0.05, limit);
  if (points.length < 2) return { closed: false, gap: 0, limit: lim };
  const gap = dist(points[0], points[points.length - 1]);
  return { closed: gap <= lim, gap, limit: lim };
}

/**
 * Vorschaugeometrie der Schließung in WELT-mm (nicht Bildschirm): der Renderer
 * zeichnet sie im Welt-Transform, damit Zoom und Verschiebung keine Rolle spielen.
 */
export function closurePreview(points: Pt[], limit = SHAPER_CLOSE_GAP): (ShaperClosure & { start: Pt; end: Pt }) | null {
  if (points.length < 2) return null;
  return { ...closureOf(points, limit), start: { ...points[0] }, end: { ...points[points.length - 1] } };
}

/**
 * Glättet eine Freihand-Geste (Stärke in Welt-mm, 0 = aus): gewichtetes Mittel
 * über die Nachbarn im Abstand der Stärke. Anfang und Ende bleiben stehen, damit
 * Anfasserpunkte nicht wandern.
 */
export function smoothStroke(points: Pt[], strength: number): Pt[] {
  const clean = points.map((p) => ({ x: p.x, y: p.y }));
  const s = Number.isFinite(strength) ? strength : 0;
  if (s <= 0 || clean.length < 3) return clean;
  const n = clean.length;
  let step = 0;
  for (let i = 1; i < n; i++) step += dist(clean[i - 1], clean[i]);
  step /= n - 1;
  const radius = Math.max(1, Math.min(16, Math.round(s / Math.max(step, 1e-6))));
  const out = clean.map((p) => ({ ...p }));
  for (let i = 1; i < n - 1; i++) {
    let sx = 0, sy = 0, w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const c = radius + 1 - Math.abs(k);
      sx += clean[j].x * c; sy += clean[j].y * c; w += c;
    }
    out[i] = { x: sx / w, y: sy / w };
  }
  return out;
}

function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function bbox(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Resampling auf N äquidistante Punkte (Bogenlänge), Duplikate fallen weg. */
export function resampleShape(points: Pt[], n = RESAMPLE_N): Pt[] {
  const clean: Pt[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (!clean.length || dist(clean[clean.length - 1], p) > 1e-9) clean.push({ x: p.x, y: p.y });
  }
  if (clean.length < 2) return clean;
  const L = pathLength(clean);
  if (L <= 1e-9) return [clean[0]];
  const step = L / (n - 1);
  const out: Pt[] = [{ ...clean[0] }];
  let acc = 0;
  for (let i = 1; i < clean.length && out.length < n; i++) {
    let seg = dist(clean[i - 1], clean[i]);
    while (acc + seg >= out.length * step && out.length < n) {
      const t = (out.length * step - acc) / seg;
      const nx = clean[i - 1].x + (clean[i].x - clean[i - 1].x) * t;
      const ny = clean[i - 1].y + (clean[i].y - clean[i - 1].y) * t;
      out.push({ x: nx, y: ny });
      clean.splice(i, 0, { x: nx, y: ny });
      seg = dist(clean[i - 1], clean[i]);
    }
    acc += seg;
  }
  while (out.length < n) out.push({ ...clean[clean.length - 1] });
  return out;
}

function turnAngle(a: Pt, b: Pt, c: Pt): number {
  const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 <= 1e-9 || l2 <= 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  return Math.acos(cos);
}

/** Ecken-Indizes auf resampelten Punkten (closed: Umlauf, offen: nur innen). */
export function findCorners(pts: Pt[], closed: boolean): number[] {
  const n = pts.length;
  if (n < 2 * CORNER_WIN + 1) return [];
  const at = (i: number) => pts[((i % n) + n) % n];
  const lo = closed ? 0 : CORNER_WIN, hi = closed ? n : n - CORNER_WIN;
  const raw: number[] = [];
  for (let i = lo; i < hi; i++) {
    if (turnAngle(at(i - CORNER_WIN), pts[i], at(i + CORNER_WIN)) > CORNER_ANGLE) raw.push(i);
  }
  // Non-Max-Suppression: nur lokales Maximum im Fenster behalten
  const out: number[] = [];
  for (const i of raw) {
    const a0 = turnAngle(at(i - CORNER_WIN), pts[i], at(i + CORNER_WIN));
    let best = true;
    for (let k = 1; k <= CORNER_WIN; k++) {
      const t = Math.max(turnAngle(at(i - k - CORNER_WIN), at(i - k), at(i - k + CORNER_WIN)),
        turnAngle(at(i + k - CORNER_WIN), at(i + k), at(i + k + CORNER_WIN)));
      if (t > a0 + 1e-9) { best = false; break; }
    }
    if (best && (!out.length || i - out[out.length - 1] > CORNER_WIN / 2)) out.push(i);
  }
  return out;
}

interface Pca { cx: number; cy: number; angle: number; major: number; minor: number }

/** Hauptachsenlage + Halbausdehnung (2σ) der Punktwolke. */
function pca(pts: Pt[]): Pca {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Streuung entlang der Achsen
  let aMaj = 0, aMin = 0;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  for (const p of pts) {
    const t = (p.x - cx) * ux + (p.y - cy) * uy;
    const u = -(p.x - cx) * uy + (p.y - cy) * ux;
    aMaj += t * t; aMin += u * u;
  }
  return { cx, cy, angle, major: Math.sqrt(aMaj / n), minor: Math.sqrt(aMin / n) };
}

const rot = (p: Pt, cx: number, cy: number, a: number): Pt => {
  const c = Math.cos(a), s = Math.sin(a), dx = p.x - cx, dy = p.y - cy;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};

function lineDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
  if (den <= 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function fitLine(pts: Pt[], L: number): ShaperLine | null {
  const a = pts[0], b = pts[pts.length - 1];
  const len = dist(a, b);
  if (len <= 1e-9) return null;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, lineDist(p, a, b));
  // Abweichung relativ zur Sehne und Geradlinigkeit der Geste: ein Kritzel hat
  // eine lange Strichlänge bei kurzer Sehne und ist damit keine Linie.
  const deviation = clamp01(1 - worst / (0.04 * len + 1e-9));
  const directness = clamp01((len / L - 0.75) / 0.2);
  return { kind: 'line', a: { ...a }, b: { ...b }, confidence: deviation * directness };
}

function fitEllipse(pts: Pt[], pc: Pca): ShaperEllipse | null {
  // Halbausdehnung entlang der Hauptachsen (2σ unterschätzt den Umfang:
  // auf dem Kreis gilt σ = r/√2, nicht r/2).
  const ux = Math.cos(pc.angle), uy = Math.sin(pc.angle);
  let ax = 0, ay = 0;
  for (const p of pts) {
    const t = Math.abs((p.x - pc.cx) * ux + (p.y - pc.cy) * uy);
    const u = Math.abs(-(p.x - pc.cx) * uy + (p.y - pc.cy) * ux);
    if (t > ax) ax = t;
    if (u > ay) ay = u;
  }
  const rx = Math.max(ax, 1e-9), ry = Math.max(ay, 1e-9);
  if (Math.min(rx, ry) <= 1e-9) return null;
  let se = 0;
  for (const p of pts) {
    const q = rot(p, pc.cx, pc.cy, pc.angle);
    const v = (q.x * q.x) / (rx * rx) + (q.y * q.y) / (ry * ry) - 1;
    se += v * v;
  }
  const rms = Math.sqrt(se / pts.length);
  // Seitenverhältnis-Sanity: degenerierte Striche sind keine Ellipsen
  const aspect = Math.min(rx, ry) / Math.max(rx, ry);
  const confidence = clamp01(1 - rms / 0.3) * clamp01(aspect / 0.25);
  return { kind: 'ellipse', cx: pc.cx, cy: pc.cy, rx, ry, angle: pc.angle, confidence };
}

interface RectFrame { cx: number; cy: number; w: number; h: number; angle: number; sharp: number }

/** Rechteckrahmen in PCA-Lage + mittlere Randnähe (1 = alle Punkte am Rand). */
function rectFrame(pts: Pt[], pc: Pca, diag: number): RectFrame {
  const q = pts.map((p) => rot(p, pc.cx, pc.cy, pc.angle));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of q) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  let mean = 0;
  for (const p of q) {
    const d = Math.min(p.x - x0, x1 - p.x, p.y - y0, y1 - p.y);
    mean += Math.max(0, d);
  }
  mean /= q.length;
  return { cx: pc.cx, cy: pc.cy, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), angle: pc.angle, sharp: clamp01(1 - mean / (0.1 * diag + 1e-9)) };
}

function cornerRegularity(pts: Pt[], corners: number[]): number {
  // Kantensymmetrie: Variationskoeffizient der Kantenlängen → 1 bei Gleichmaß
  const lens: number[] = [];
  for (let i = 0; i < corners.length; i++) lens.push(dist(pts[corners[i]], pts[corners[(i + 1) % corners.length]]));
  const m = lens.reduce((a, b) => a + b, 0) / lens.length;
  if (m <= 1e-9) return 0;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - m) * (b - m), 0) / lens.length);
  return clamp01(1 - sd / (0.35 * m));
}

/**
 * Wie gerade verlaufen die Kanten zwischen den Ecken? 1 = geradlinig,
 * 0 = stark gekrümmt. Das trennt ein echtes Vieleck von einem Kreis, dessen
 * Rundung nur zufällig drei "Ecken" erzeugt.
 */
function edgeStraightness(pts: Pt[], corners: number[]): number {
  const c = corners.length;
  if (c < 3) return 0;
  let acc = 0;
  for (let i = 0; i < c; i++) {
    const i0 = corners[i], i1 = corners[(i + 1) % c];
    const a = pts[i0], b = pts[i1];
    const chord = dist(a, b);
    if (chord <= 1e-9) return 0;
    let worst = 0;
    for (let j = i0; j !== i1; j = (j + 1) % pts.length) worst = Math.max(worst, lineDist(pts[j], a, b));
    acc += clamp01(1 - worst / (0.08 * chord + 1e-9));
  }
  return acc / c;
}

/** Vieleck aus den erkannten Ecken: Mittelpunkt, mittlerer Radius, Lage der ersten Ecke. */
function polygonFromCorners(pts: Pt[], corners: number[]): ShaperPolygon | null {
  const n = corners.length;
  if (n < 3) return null;
  let cx = 0, cy = 0;
  for (const i of corners) { cx += pts[i].x; cy += pts[i].y; }
  cx /= n; cy /= n;
  let r = 0;
  for (const i of corners) r += dist(pts[i], { x: cx, y: cy });
  r /= n;
  if (r <= 1e-9) return null;
  // shapeSubs setzt die erste Ecke auf -90° + rotation
  const rotation = Math.atan2(pts[corners[0]].y - cy, pts[corners[0]].x - cx) + Math.PI / 2;
  return { kind: 'polygon', cx, cy, r, sides: n, rotation, confidence: 0 };
}

/**
 * Alle plausiblen Grundformen, bester Vorschlag zuerst. Die Formfamilien
 * konkurrieren offen miteinander (keine harte Eckenzahl-Weiche): ein Kreis mit
 * drei zufälligen Ecken bleibt eine Ellipse, weil das Vieleck an seinen
 * gekrümmten Kanten scheitert.
 */
export function recognizeCandidates(points: Pt[], opts: { closeGap?: number } = {}): ShaperMatch[] {
  if (points.length < 2) return [];
  const pts = resampleShape(points);
  if (pts.length < 2) return [];
  const L = pathLength(pts);
  const box = bbox(pts);
  const diag = Math.hypot(box.w, box.h);
  if (L <= 1e-9 || diag <= 1e-9) return [];
  // Kleinstgesten (<2 mm Pfadlänge) sind Taps, keine Formen
  if (L < 2) return [];

  const closed = closureOf(points, opts.closeGap ?? SHAPER_CLOSE_GAP).closed;
  const corners = findCorners(pts, closed);
  const pc = pca(pts);
  const cands: ShaperMatch[] = [];

  if (!closed) {
    const line = fitLine(pts, L);
    if (line && line.confidence > 0.25) cands.push(line);
    return rank(cands);
  }

  const frame = rectFrame(pts, pc, diag);
  const q = pts.map((p) => rot(p, frame.cx, frame.cy, frame.angle));
  const hx = frame.w / 2, hy = frame.h / 2;
  let near = 0;
  for (const i of corners) {
    const p = q[i];
    const dc = Math.min(...[[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]]
      .map(([ex, ey]) => Math.hypot(p.x - ex, p.y - ey)));
    if (dc < 0.2 * diag) near++;
  }
  const cornerScore = corners.length ? near / Math.max(4, corners.length) : 0;
  const base = clamp01(0.45 * frame.sharp + 0.35 * cornerScore + 0.2 * cornerRegularity(pts, corners));
  // Vier Ecken sind der Beweis für ein Rechteck; ohne sie bleibt es Kandidat,
  // aber deutlich schwächer (sonst gewinnt es gegen einen echten Kreis).
  const rectConf = corners.length === 4 ? base : base * 0.6;
  if (rectConf > 0.25)
    cands.push({ kind: 'rect', cx: frame.cx, cy: frame.cy, w: frame.w, h: frame.h, angle: frame.angle, confidence: rectConf });

  if (corners.length === 4) {
    // Abgerundet? Punkte weichen an den Ecken vom scharfen Rahmen ab,
    // folgen aber Kanten + Viertelkreisen mit Radius r.
    const r = 0.2 * Math.min(frame.w, frame.h);
    let se = 0;
    for (const p of q) {
      const ax = Math.abs(p.x), ay = Math.abs(p.y);
      const ex = hx - r, ey = hy - r;
      let d: number;
      if (ax <= ex || ay <= ey) {
        d = Math.min(hx - ax, hy - ay);
      } else {
        d = Math.abs(Math.hypot(ax - ex, ay - ey) - r);
      }
      se += d * d;
    }
    const rmsRound = Math.sqrt(se / q.length);
    let seSharp = 0;
    for (const p of q) seSharp += Math.pow(Math.min(hx - Math.abs(p.x), hy - Math.abs(p.y)), 2);
    const rmsSharp = Math.sqrt(seSharp / q.length);
    if (rmsRound < rmsSharp * 0.75 && rmsRound < 0.08 * diag) {
      const confidence = clamp01(0.5 * frame.sharp + 0.5 * clamp01(1 - rmsRound / (0.08 * diag)));
      cands.push({ kind: 'roundrect', cx: frame.cx, cy: frame.cy, w: frame.w, h: frame.h, angle: frame.angle, r, confidence: Math.min(confidence, 0.85) });
    }
  }

  const ell = fitEllipse(pts, pc);
  if (ell) {
    // Randnah + eckenlos spricht eher für die Rechteck-Familie
    if (frame.sharp > 0.85 && corners.length === 0) ell.confidence *= 0.8;
    cands.push(ell);
  }

  if (corners.length >= 3 && corners.length <= 8) {
    const poly = polygonFromCorners(pts, corners);
    if (poly) {
      const straight = edgeStraightness(pts, corners);
      poly.confidence = clamp01(0.35 * frame.sharp + 0.25 * cornerRegularity(pts, corners) + 0.4 * straight);
      if (poly.confidence > 0.25) cands.push(poly);
    }
  }

  return rank(cands);
}

/** Beste Form je Familie behalten, nach Konfidenz sortieren. */
function rank(cands: ShaperMatch[]): ShaperMatch[] {
  const best = new Map<ShaperKind, ShaperMatch>();
  for (const c of cands) {
    const prev = best.get(c.kind);
    if (!prev || c.confidence > prev.confidence) best.set(c.kind, c);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Bester Vorschlag über der Übernahmeschwelle, sonst null. Dünne Hülle um
 * recognizeCandidates(), damit Aufrufer ohne Auswahl weiter funktionieren.
 */
export function recognize(points: Pt[], opts: { closeGap?: number } = {}): ShaperMatch | null {
  const best = recognizeCandidates(points, opts)[0];
  return best && best.confidence >= SHAPER_MIN_CONFIDENCE ? best : null;
}
