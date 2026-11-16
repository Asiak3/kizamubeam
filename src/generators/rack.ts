// Generator „Zahnstange“: gerade Verzahnung passend zum Zahnrad (gleiches Modul und gleicher Eingriffswinkel).
// Das Profil ist das Bezugsprofil selbst: gerade Flanken unter dem Eingriffswinkel, Fußrundung als Kreisbogen.
// Flankenspiel macht die Zähne um die Hälfte des Spiels dünner (die andere Hälfte trägt das Rad), die Schnittfuge
// versetzt die ganze Kontur um die halbe Fuge nach außen (Flanken parallel, Fußrundung kleiner).
import type { Pt, SubPath } from '../model';
import { t } from '../i18n';
import { flipY, PathBuilder } from './build';
import type { Generator, Issue, Params } from './types';

export interface RackParams {
  teeth: number;
  module: number;
  pressureAngle: number;
  backlash: number;
  kerf: number;
  /** Material unter dem Zahnfuß (mm) */
  back: number;
  rootFillet: number;
  clearance: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Kenngrößen der Zahnstange (y nach oben, Teilungslinie bei y = 0, erste Lückenmitte bei x = 0) */
export function rackGeometry(p: RackParams) {
  const m = p.module,
    alpha = rad(p.pressureAngle);
  const pitch = Math.PI * m;
  const d = p.kerf / 2;
  const ta = Math.tan(alpha),
    ca = Math.cos(alpha),
    sa = Math.sin(alpha);
  const s = pitch / 2 - p.backlash / 2 + (2 * d) / ca;
  const yTip = m + d;
  const yRoot = -(1 + p.clearance) * m + d;
  const yBack = -(1 + p.clearance) * m - p.back - d;
  // Linke Flanke des Zahns um xc: x = xc − s/2 + y·tanα
  const xl0 = -s / 2;
  // Fußrundung: höchstens so groß, dass sie die Lückenmitte erreicht
  const room = xl0 + yRoot * ta + pitch / 2;
  const rho = Math.max(0, Math.min(p.rootFillet * m - d, room / (1 / ca - ta)));
  const tipWidth = s - 2 * yTip * ta;
  const rootGap = pitch - s - 2 * -yRoot * ta;
  return { m, alpha, pitch, d, ta, ca, sa, s, yTip, yRoot, yBack, rho, tipWidth, rootGap, length: p.teeth * pitch + 2 * d };
}

/** Kontur (y nach oben), von x = −d bis teeth·p + d */
function rackOutline(p: RackParams): SubPath {
  const g = rackGeometry(p);
  const b = new PathBuilder();
  const L = p.teeth * g.pitch;
  b.line({ x: -g.d, y: g.yBack });
  b.line({ x: -g.d, y: g.yRoot });
  const cy = g.yRoot + g.rho;
  for (let k = 0; k < p.teeth; k++) {
    const xc = g.pitch / 2 + k * g.pitch;
    const xl = (y: number) => xc - g.s / 2 + y * g.ta;
    const xr = (y: number) => xc + g.s / 2 - y * g.ta;
    // linke Fußrundung, linke Flanke, Kopf, rechte Flanke, rechte Fußrundung
    const cl = xl(cy) - g.rho / g.ca;
    if (g.rho > 0) b.arc(cl, cy, g.rho, -Math.PI / 2, -g.alpha);
    else b.line({ x: xl(g.yRoot), y: g.yRoot });
    b.line({ x: xl(g.yTip), y: g.yTip });
    b.line({ x: xr(g.yTip), y: g.yTip });
    const cr = xr(cy) + g.rho / g.ca;
    if (g.rho > 0) b.arc(cr, cy, g.rho, Math.PI + g.alpha, (3 * Math.PI) / 2);
    else b.line({ x: xr(g.yRoot), y: g.yRoot });
  }
  b.line({ x: L + g.d, y: g.yRoot });
  b.line({ x: L + g.d, y: g.yBack });
  return b.close();
}

const P = (p: Params) => p as unknown as RackParams;
const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Lage der Teilungslinie und der ersten Lückenmitte im Teil (Mitte des Teils = Ursprung, y nach oben) */
export function rackOrigin(p: RackParams): Pt {
  const g = rackGeometry(p);
  return { x: -(p.teeth * g.pitch) / 2, y: -(g.yTip + g.yBack) / 2 };
}

export const RACK: Generator = {
  id: 'rack',
  version: 1,
  kind: 'part',
  name: t('Zahnstange'),
  icon: 'rack',
  tile: {
    group: 'mech',
    text: (t) => ({
      name: t('Zahnstange'),
      desc: t('Gerade Zahnstange, die zum Zahnrad mit gleichem Modul passt.'),
      keys: t('Zahnstange Linearantrieb Zahnrad|Suchwörter'),
      action: t('Zahnstange erstellen (passend zum Zahnrad, Parameter bleiben erhalten)'),
    }),
  },
  schema: [
    { key: 'teeth', type: 'int', label: t('Zähnezahl'), min: 1, max: 1000, def: 20 },
    { key: 'module', type: 'length', label: t('Modul'), min: 0.3, max: 20, def: 2, title: t('Muss zum Modul des Zahnrads passen') },
    { key: 'pressureAngle', type: 'angle', label: t('Eingriffswinkel'), min: 10, max: 35, def: 20, title: t('Muss zum Eingriffswinkel des Zahnrads passen') },
    { key: 'backlash', type: 'length', label: t('Flankenspiel'), min: 0, max: 3, def: 0.1, title: t('Spiel der Paarung auf der Teilungslinie; die Zahnstange wird um die Hälfte dünner, das Rad um die andere Hälfte') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit die Zahnstange die Sollmaße hat. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    { key: 'back', type: 'length', label: t('Rückenhöhe'), min: 0.5, max: 500, def: 6, title: t('Material unter dem Zahnfuß') },
    { key: 'rootFillet', type: 'number', label: t('Fußrundung (× Modul)'), min: 0, max: 0.45, def: 0.38, advanced: true, title: t('Radius der Rundung im Zahnfuß, Norm: 0,38') },
    { key: 'clearance', type: 'number', label: t('Kopfspiel (× Modul)'), min: 0.1, max: 0.5, def: 0.25, advanced: true, title: t('Abstand zwischen Zahnkopf des Rads und Zahnfuß der Stange, Norm: 0,25') },
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (p.backlash / 2 >= (Math.PI * p.module) / 4) out.push({ key: 'backlash', level: 'error', msg: t('Flankenspiel zu groß für dieses Modul.') });
    const g = rackGeometry(p);
    if (g.tipWidth <= 0.01 * p.module) out.push({ key: 'pressureAngle', level: 'error', msg: t('Die Zähne laufen spitz zu: Eingriffswinkel verringern.') });
    if (g.rootGap <= 0) out.push({ key: 'kerf', level: 'error', msg: t('Die Schnittfuge ist breiter als die Zahnlücke.') });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const g = rackGeometry(p);
    const o = rackOrigin(p);
    const sub = rackOutline(p);
    sub.nodes = sub.nodes.map((n) => ({
      x: n.x + o.x, y: n.y + o.y,
      ...(n.cin ? { cin: { x: n.cin.x + o.x, y: n.cin.y + o.y } } : {}),
      ...(n.cout ? { cout: { x: n.cout.x + o.x, y: n.cout.y + o.y } } : {}),
    }));
    const H = g.yTip - g.yBack;
    return {
      parts: [{ key: 'main', subs: [flipY(sub)], at: { x: 0, y: 0 } }],
      info: [
        [t('Länge'), `${fmt(g.length)} mm`],
        [t('Höhe'), `${fmt(H)} mm`],
        [t('Teilung'), `${fmt(g.pitch, 3)} mm`],
        [t('Teilungslinie über Unterkante'), `${fmt(-g.yBack - g.d)} mm`],
        [t('Achse des Zahnrads über Unterkante'), t('{h} mm + halber Teilkreis', { h: fmt(-g.yBack - g.d) })],
      ],
    };
  },
  label(raw) {
    const p = P(raw);
    return t('Zahnstange z={z} m={m}', { z: p.teeth, m: fmt(p.module, 3) });
  },
};
