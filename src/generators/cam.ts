// Generator „Nocken“: Scheibennocken für einen Stößel, der sich radial zur Drehachse bewegt.
// Bewegungsablauf je Umdrehung: Hub, Rast oben, Rückhub, Rast unten. Bewegungsgesetze mit stetiger
// Geschwindigkeit an den Übergängen (Zykloide, harmonisch, Polynom 5. Grades), damit der Stößel nicht schlägt.
// Mit Rolle ist die Kontur die nach innen versetzte Bahn des Rollenmittelpunkts; die Schnittfuge verringert den
// Versatz um die halbe Fuge (Kontur wächst nach außen), die Bohrung wird kleiner.
// Winkel θ zählt im Uhrzeigersinn ab der Spitze oben (0° = Stößel ganz unten, Beginn des Hubs).
import type { Pt } from '../model';
import { t, locale } from '../i18n';
import { flipY, PathBuilder } from './build';
import { boreIssues, boreOutline, boreSchema } from './bore';
import type { Generator, Issue, Params } from './types';

export const CAM_TOL = 0.004;

export interface CamParams {
  baseRadius: number;
  lift: number;
  rise: number;
  dwellTop: number;
  fall: number;
  law: 'cycloid' | 'harmonic' | 'poly5';
  follower: 'knife' | 'roller';
  rollerDia: number;
  kerf: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Normierter Weg 0..1 über x = 0..1 */
export function lawCurve(law: CamParams['law'], x: number): number {
  if (law === 'harmonic') return (1 - Math.cos(Math.PI * x)) / 2;
  if (law === 'poly5') return x * x * x * (10 - 15 * x + 6 * x * x);
  return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
}

/** Hubverlauf und Bahn des Stößels (Spitze bzw. Rollenmitte), y nach oben */
export function camMotion(p: CamParams) {
  const b1 = rad(p.rise),
    b2 = b1 + rad(p.dwellTop),
    b3 = b2 + rad(p.fall);
  const rr = p.follower === 'roller' ? p.rollerDia / 2 : 0;
  const s = (th: number) => {
    if (th <= b1) return p.lift * lawCurve(p.law, th / b1);
    if (th <= b2) return p.lift;
    if (th <= b3) return p.lift * (1 - lawCurve(p.law, (th - b2) / (b3 - b2)));
    return 0;
  };
  const pitch = (th: number): Pt => {
    const r = p.baseRadius + rr + s(th);
    return { x: r * Math.sin(th), y: r * Math.cos(th) };
  };
  /** Abschnitte mit glattem Verlauf (Grenzen in Bogenmaß) */
  const breaks = [0, b1, b2, b3, 2 * Math.PI].filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-9);
  return { s, pitch, rr, breaks };
}

/** Punkt der Kontur: Bahn um (Rollenradius − halbe Fuge) nach innen versetzt (Spitze: halbe Fuge nach außen) */
function contour(p: CamParams) {
  const m = camMotion(p);
  const off = m.rr - p.kerf / 2;
  return (th: number): Pt => {
    const h = 1e-6;
    const a = m.pitch(th - h),
      b = m.pitch(th + h),
      c = m.pitch(th);
    const tx = b.x - a.x,
      ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    // Laufrichtung im Uhrzeigersinn: außen liegt links der Tangente gedreht um +90°
    return { x: c.x - (off * -ty) / l, y: c.y - (off * tx) / l };
  };
}

/** Krümmungsradius der Bahn (positiv = konvex) und Druckwinkel, abgetastet */
export function camAnalysis(p: CamParams) {
  const m = camMotion(p);
  let minConvex = Infinity,
    maxPressure = 0,
    rMax = 0;
  const N = 1440;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * 2 * Math.PI;
    const h = 1e-4;
    const p0 = m.pitch(th - h),
      p1 = m.pitch(th),
      p2 = m.pitch(th + h);
    const dx = (p2.x - p0.x) / (2 * h),
      dy = (p2.y - p0.y) / (2 * h);
    const ddx = (p2.x - 2 * p1.x + p0.x) / (h * h),
      ddy = (p2.y - 2 * p1.y + p0.y) / (h * h);
    // Uhrzeigersinn: konvex bei negativem Kreuzprodukt
    const cross = dx * ddy - dy * ddx;
    const speed = Math.hypot(dx, dy);
    if (Math.abs(cross) > 1e-9) {
      const rho = -(speed ** 3) / cross;
      if (rho > 0) minConvex = Math.min(minConvex, rho);
    }
    const r = Math.hypot(p1.x, p1.y);
    const ds = (m.s(th + h) - m.s(th - h)) / (2 * h);
    maxPressure = Math.max(maxPressure, Math.abs(Math.atan2(ds, r)));
    rMax = Math.max(rMax, r);
  }
  return { minConvex, maxPressure: (maxPressure * 180) / Math.PI, rMax: rMax - m.rr };
}

const P = (p: Params) => p as unknown as CamParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(locale, { maximumFractionDigits: d });

export const CAM: Generator = {
  id: 'cam',
  version: 1,
  kind: 'part',
  name: t('Nocken'),
  icon: 'cam',
  tile: {
    group: 'mech',
    text: (t) => ({
      name: t('Nocken'),
      desc: t('Nockenscheibe für Rolle oder Spitze mit Hub, Rast und Rückhub.'),
      keys: t('Nocke Kurvenscheibe Hub Exzenter Automat|Suchwörter'),
      action: t('Nocken erstellen (Hub, Rast, Rückhub; Parameter bleiben erhalten)'),
    }),
  },
  schema: [
    { key: 'baseRadius', type: 'length', label: t('Grundkreisradius'), min: 2, max: 1000, def: 20, title: t('Kleinster Radius des Nockens: Hier steht der Stößel ganz unten') },
    { key: 'lift', type: 'length', label: t('Hub'), min: 0.1, max: 1000, def: 8 },
    { key: 'rise', type: 'angle', label: t('Hubwinkel'), min: 10, max: 340, def: 120, title: t('Drehwinkel, über den der Stößel steigt') },
    { key: 'dwellTop', type: 'angle', label: t('Rast oben'), min: 0, max: 320, def: 30, title: t('Drehwinkel, über den der Stößel oben stehen bleibt') },
    { key: 'fall', type: 'angle', label: t('Rückhubwinkel'), min: 10, max: 340, def: 120, title: t('Drehwinkel, über den der Stößel wieder sinkt; der Rest der Umdrehung ist Rast unten') },
    {
      key: 'law', type: 'enum', label: t('Bewegungsgesetz'), def: 'cycloid',
      options: [['cycloid', t('Zykloide (ruckarm)')], ['poly5', t('Polynom 5. Grades')], ['harmonic', t('Harmonisch')]],
    },
    { key: 'follower', type: 'enum', label: t('Stößel'), def: 'roller', options: [['roller', t('Mit Rolle')], ['knife', t('Spitze')]] },
    { key: 'rollerDia', type: 'length', label: t('Rollendurchmesser'), min: 0.5, max: 500, def: 10, showIf: { eq: ['follower', 'roller'] } },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit der Nocken die Sollmaße hat. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    ...boreSchema('', '', 'round', 6),
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (p.rise + p.dwellTop + p.fall > 360) out.push({ key: 'fall', level: 'error', msg: t('Hub, Rast oben und Rückhub zusammen dürfen höchstens 360° sein.') });
    if (out.length) return out;
    const a = camAnalysis(p);
    const rr = p.follower === 'roller' ? p.rollerDia / 2 : 0;
    if (rr && a.minConvex <= rr - p.kerf / 2 + 1e-6)
      out.push({ key: 'rollerDia', level: 'error', msg: t('Die Rolle ist zu groß für die engste Stelle der Bahn: Kleinere Rolle, größeren Grundkreis oder flachere Bewegung wählen.') });
    if (a.maxPressure > 30) out.push({ key: 'baseRadius', level: 'warn', msg: t('Druckwinkel bis {a}°: Über 30° klemmt der Stößel leicht. Größerer Grundkreis oder längerer Hubwinkel hilft.', { a: fmt(a.maxPressure) }) });
    out.push(...boreIssues(raw, p.kerf, p.baseRadius, 2, '', false));
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const m = camMotion(p);
    const f = contour(p);
    const b = new PathBuilder();
    for (let i = 0; i + 1 < m.breaks.length; i++) b.curve(f, m.breaks[i], m.breaks[i + 1], CAM_TOL);
    const subs = [b.close()];
    const hole = boreOutline(raw, p.kerf);
    if (hole) subs.push(hole);
    const a = camAnalysis(p);
    return {
      parts: [{ key: 'main', subs: subs.map(flipY), at: { x: 0, y: 0 } }],
      info: [
        [t('Größter Radius'), `${fmt(p.baseRadius + p.lift, 2)} mm`],
        [t('Größter Druckwinkel'), `${fmt(a.maxPressure)}°`],
        [t('Rast unten'), `${fmt(360 - p.rise - p.dwellTop - p.fall)}°`],
      ],
    };
  },
  label(raw) {
    const p = P(raw);
    return t('Nocken Hub {h} mm', { h: fmt(p.lift, 2) });
  },
};
