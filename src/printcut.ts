// Print and Cut: Passermarken (Registrierungsmarken) und Ausrichten des Designs an eingemessenen Marken.
// Kern ohne DOM: Marken erzeugen und finden, Transformation aus 2 oder mehr Punktpaaren schätzen.
// Ein gedrucktes Blatt liegt nie genau dort, wo es im Design steht. Misst man die Mitte von 2 oder 3 gedruckten
// Marken mit dem Laser (oder der Kamera) ein, ergibt sich daraus Verschiebung, Drehung, Maßstab und mit 3 Marken
// auch die Verzerrung des Druckers. Das ganze Design wird damit auf das Blatt gelegt.
import { boundsOf, Box } from './geom';
import { apply, IDENT, Mat, newId, Node, Obj, Pt, SubPath } from './model';

/** Wie eng die Transformation an die Marken angepasst wird */
export type FitMode = 'rigid' | 'similar' | 'affine';

export interface Fit {
  m: Mat;
  /** Mittlerer Restfehler (RMS) in mm; mit genau so vielen Marken wie Freiheitsgraden 0 */
  rms: number;
  /** Größter Restfehler einer Marke in mm */
  max: number;
  /** Restfehler je Marke in mm */
  errs: number[];
  /** Maßstab (Mittel aus x und y) */
  scale: number;
  /** Drehung in Grad (mathematisch positiv im Design, y nach unten = im Uhrzeigersinn) */
  angle: number;
  /** Bei 2 Marken ohne Maßstabsanpassung: Abstand gemessen / Abstand im Design (zur Kontrolle des Drucks) */
  distRatio: number | null;
}

/** Kleinste Zahl Marken je Modus */
export const minMarks = (mode: FitMode) => (mode === 'affine' ? 3 : 2);

/**
 * Transformation, die die Design-Punkte src möglichst genau auf die gemessenen Punkte dst legt.
 * rigid: nur Verschieben und Drehen; similar: dazu gleichmäßiger Maßstab; affine: Maßstab je Richtung und Scherung.
 * Liefert null, wenn die Punkte zu wenige sind oder zusammenfallen (bzw. bei affine auf einer Linie liegen).
 */
export function fitTransform(src: Pt[], dst: Pt[], mode: FitMode): Fit | null {
  const n = Math.min(src.length, dst.length);
  if (n < minMarks(mode)) return null;
  const s = src.slice(0, n),
    d = dst.slice(0, n);
  const mean = (p: Pt[]) => ({ x: p.reduce((a, q) => a + q.x, 0) / n, y: p.reduce((a, q) => a + q.y, 0) / n });
  const cs = mean(s),
    cd = mean(d);
  let m: Mat;
  if (mode === 'affine') {
    // Kleinste Quadrate für [a c; b d] mit zentrierten Punkten: M = (D·Sᵀ)(S·Sᵀ)⁻¹
    let sxx = 0, sxy = 0, syy = 0, dxx = 0, dxy = 0, dyx = 0, dyy = 0;
    for (let i = 0; i < n; i++) {
      const ux = s[i].x - cs.x, uy = s[i].y - cs.y;
      const vx = d[i].x - cd.x, vy = d[i].y - cd.y;
      sxx += ux * ux; sxy += ux * uy; syy += uy * uy;
      dxx += vx * ux; dxy += vx * uy; dyx += vy * ux; dyy += vy * uy;
    }
    const det = sxx * syy - sxy * sxy;
    const span = Math.max(sxx, syy);
    if (!(span > 1e-9) || Math.abs(det) < 1e-9 * span * span) return null;
    const i00 = syy / det, i01 = -sxy / det, i11 = sxx / det;
    const a = dxx * i00 + dxy * i01;
    const c = dxx * i01 + dxy * i11;
    const b = dyx * i00 + dyy * i01;
    const dd = dyx * i01 + dyy * i11;
    m = [a, b, c, dd, cd.x - a * cs.x - c * cs.y, cd.y - b * cs.x - dd * cs.y];
  } else {
    // Procrustes/Umeyama in 2D
    let sab = 0, scr = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const ux = s[i].x - cs.x, uy = s[i].y - cs.y;
      const vx = d[i].x - cd.x, vy = d[i].y - cd.y;
      sab += ux * vx + uy * vy;
      scr += ux * vy - uy * vx;
      ss += ux * ux + uy * uy;
    }
    if (!(ss > 1e-9)) return null;
    const ang = Math.atan2(scr, sab);
    const k = mode === 'similar' ? Math.hypot(sab, scr) / ss : 1;
    const cos = Math.cos(ang) * k,
      sin = Math.sin(ang) * k;
    m = [cos, sin, -sin, cos, cd.x - (cos * cs.x - sin * cs.y), cd.y - (sin * cs.x + cos * cs.y)];
  }
  const errs = s.map((p, i) => {
    const q = apply(m, p.x, p.y);
    return Math.hypot(q.x - d[i].x, q.y - d[i].y);
  });
  const rms = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / n);
  const sx = Math.hypot(m[0], m[1]),
    sy = Math.hypot(m[2], m[3]);
  let distRatio: number | null = null;
  if (n === 2) {
    const ds = Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
    const dm = Math.hypot(d[1].x - d[0].x, d[1].y - d[0].y);
    distRatio = ds > 1e-9 ? dm / ds : null;
  }
  return { m, rms, max: Math.max(...errs), errs, scale: (sx + sy) / 2, angle: (Math.atan2(m[1], m[0]) * 180) / Math.PI, distRatio };
}

// ---------- Marken ----------

const K = 0.5522847498;

/** Kreis mit Fadenkreuz um den Ursprung (lokale Koordinaten), Durchmesser size; das Kreuz ragt etwas heraus */
export function markSubs(size: number): SubPath[] {
  const r = size / 2;
  const c = r * K;
  const circle: Node[] = [
    { x: r, y: 0, cin: { x: r, y: -c }, cout: { x: r, y: c }, smooth: true },
    { x: 0, y: r, cin: { x: c, y: r }, cout: { x: -c, y: r }, smooth: true },
    { x: -r, y: 0, cin: { x: -r, y: c }, cout: { x: -r, y: -c }, smooth: true },
    { x: 0, y: -r, cin: { x: -c, y: -r }, cout: { x: c, y: -r }, smooth: true },
  ];
  const a = r * 1.4;
  return [
    { nodes: circle, closed: true },
    { nodes: [{ x: -a, y: 0 }, { x: a, y: 0 }], closed: false },
    { nodes: [{ x: 0, y: -a }, { x: 0, y: a }], closed: false },
  ];
}

/** Neue Passermarke Nummer nr mit der Mitte bei c (Design-Koordinaten) */
export function makeMark(nr: number, c: Pt, size: number, layer: number, name: string): Obj {
  return { id: newId(), m: [1, 0, 0, 1, c.x, c.y], layer, shape: { kind: 'path', subs: markSubs(size) }, reg: nr, name };
}

/**
 * Lage für drei Marken um ein Design: oben links, oben rechts, unten links, jeweils margin außerhalb der Ecke
 * (die Mitte der Marke liegt margin + size/2 vom Design entfernt). Die L-Form macht ein gedrehtes oder
 * vertauschtes Blatt erkennbar. Marken, die über das Bett hinausragen würden, rücken nach innen.
 */
export function markPlaces(box: Box, size: number, margin: number, bed: { w: number; h: number }): Pt[] {
  const o = margin + size / 2;
  const half = size * 0.7;
  const clamp = (v: number, hi: number) => Math.min(hi - half, Math.max(half, v));
  const pts = [
    { x: box.x - o, y: box.y - o },
    { x: box.x + box.w + o, y: box.y - o },
    { x: box.x - o, y: box.y + box.h + o },
  ];
  return pts.map((p) => ({ x: clamp(p.x, bed.w), y: clamp(p.y, bed.h) }));
}

/** Passermarken der obersten Ebene, nach Nummer sortiert */
export function findMarks(objs: Obj[]): Obj[] {
  return objs.filter((o) => typeof o.reg === 'number' && o.reg > 0).sort((a, b) => a.reg! - b.reg!);
}

/** Mitte einer Marke: Mitte ihres Rahmens in Design-Koordinaten */
export function markCenter(o: Obj): Pt | null {
  const b = boundsOf([o], IDENT);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
}

/** Nächste freie Markennummer */
export const nextMarkNr = (objs: Obj[]) => findMarks(objs).reduce((a, o) => Math.max(a, o.reg!), 0) + 1;

// ---------- Maschinenkoordinaten ----------

/** Laserposition (Arbeitskoordinaten, y nach oben) → Design (y nach unten) */
export const machineToDesign = (x: number, y: number, bedH: number): Pt => ({ x, y: bedH - y });
/** Design → Maschine */
export const designToMachine = (p: Pt, bedH: number): Pt => ({ x: p.x, y: bedH - p.y });
