// Generator „Riemenscheibe“ für Zahnriemen (GT2, HTD).
// Außendurchmesser = Wirkdurchmesser (Zähne × Teilung / π) minus zweimal den Abstand der Riemen-Wirklinie
// (pitch line differential). Die Zahnlücke ist ein Halbkreis über der Lückenbreite, bei tieferen Profilen mit
// geraden Wänden verlängert, am Außendurchmesser mit kleinen Rundungen. Lückentiefe und -breite folgen den
// üblichen Werten je Profil; das Spiel der Zahnlücke macht sie breiter, damit der Riemen leicht einläuft.
// Ergebnis ist eine Näherung des Normprofils, die mit gedruckten und gelaserten Scheiben gut läuft.
import type { SubPath } from '../model';
import { t } from '../i18n';
import { flipY, PathBuilder } from './build';
import { boreIssues, boreOutline, boreSchema } from './bore';
import type { Generator, Issue, Params } from './types';

export interface BeltProfile {
  /** Teilung (mm) */
  pitch: number;
  /** Abstand der Wirklinie vom Zahngrund des Riemens (mm) */
  pld: number;
  /** Tiefe und Breite der Zahnlücke (mm) */
  depth: number;
  width: number;
}

export const BELTS: Record<string, BeltProfile> = {
  gt2_2: { pitch: 2, pld: 0.254, depth: 0.764, width: 1.494 },
  gt2_3: { pitch: 3, pld: 0.381, depth: 1.169, width: 2.31 },
  gt2_5: { pitch: 5, pld: 0.5715, depth: 1.969, width: 3.952 },
  htd_3: { pitch: 3, pld: 0.381, depth: 1.289, width: 2.27 },
  htd_5: { pitch: 5, pld: 0.5715, depth: 2.199, width: 3.781 },
};

export interface PulleyParams {
  profile: keyof typeof BELTS;
  teeth: number;
  /** zusätzliche Breite der Zahnlücke (mm) */
  play: number;
  kerf: number;
  boreType: string;
  boreDia: number;
}

/** Außendurchmesser ohne Fuge */
export function pulleyOD(p: PulleyParams): number {
  const b = BELTS[p.profile];
  return (p.teeth * b.pitch) / Math.PI - 2 * b.pld;
}

/** Lücke in eigenen Koordinaten (Lückenmitte auf der y-Achse, Öffnung oben), mit Fuge */
export function pulleyGap(p: PulleyParams) {
  const belt = BELTS[p.profile];
  const d = p.kerf / 2;
  const R = pulleyOD(p) / 2 + d;
  const rw = (belt.width + p.play) / 2 - d;
  const depth = belt.depth;
  // Tiefe Lücke: Halbkreis über der Breite plus gerade Wände; flache Lücke: Kreisabschnitt mit Sehne = Breite
  const deep = depth >= rw;
  const rg = deep ? rw : (rw * rw + depth * depth) / (2 * depth);
  const yc = R - depth + rg;
  const step = (2 * Math.PI) / p.teeth;
  // Rundung zwischen Außenkreis und Lücke: Mittelpunkt (−fx, fy) im Material
  const fillet = (tip: number) => {
    let fx = rw + tip,
      fy = Math.sqrt(Math.max(0, (R - tip) ** 2 - fx * fx));
    const wall = deep && fy >= yc;
    if (!wall) {
      // Berührt den Kreis der Lücke: Abstand rg + tip von dessen Mitte, R − tip vom Ursprung
      const a = R - tip,
        c = rg + tip;
      fy = (yc * yc + a * a - c * c) / (2 * yc);
      fx = Math.sqrt(Math.max(0, a * a - fy * fy));
    }
    // Zahnbreite (Winkel) am Außenkreis zwischen zwei Rundungen
    const land = 2 * Math.atan2(fy, fx) - Math.PI + step;
    return { tip, fx, fy, wall, land };
  };
  // Kleine Scheiben: Rundung so weit verkleinern, dass zwischen den Lücken ein Zahn bleibt
  let f = fillet(Math.min(0.05 * belt.pitch, rw / 2) + d);
  if (f.land < 0 && fillet(0).land > 0) {
    let lo = 0,
      hi = f.tip;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fillet(mid).land > 0.1 * step) lo = mid;
      else hi = mid;
    }
    f = fillet(lo);
  }
  const { tip, fx, fy, wall, land } = f;
  return { R, rw, rg, yc, tip, fx, fy, wall, land, depth, step };
}

/** Kontur (y nach oben, Ursprung = Mitte) */
export function pulleyOutline(p: PulleyParams): SubPath {
  const g = pulleyGap(p);
  const b = new PathBuilder();
  const aL = Math.atan2(g.fy, -g.fx);
  // Richtung von der Rundungsmitte zum Berührpunkt an der Lücke
  const aG = g.wall ? 0 : Math.atan2(g.yc - g.fy, g.fx);
  // Winkel des Berührpunkts auf dem Lückenkreis (von dessen Mitte), linke Seite, auf (π, 2π) gebracht
  let th = g.wall ? Math.PI : Math.atan2(g.fy - g.yc, -g.fx);
  if (th < 0) th += 2 * Math.PI;
  for (let i = 0; i < p.teeth; i++) {
    const rho = -i * g.step;
    const rot = (x: number, y: number) => ({ x: x * Math.cos(rho) - y * Math.sin(rho), y: x * Math.sin(rho) + y * Math.cos(rho) });
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
      const q = rot(cx, cy);
      b.arc(q.x, q.y, r, a0 + rho, a1 + rho);
    };
    // linke Rundung, linke Wand, Grund, rechte Wand, rechte Rundung, Außenkreis bis zur nächsten Lücke
    arc(-g.fx, g.fy, g.tip, aL, aG);
    if (g.wall) b.line(rot(-g.rw, g.yc));
    arc(0, g.yc, g.rg, th, 3 * Math.PI - th);
    if (g.wall) b.line(rot(g.rw, g.fy));
    arc(g.fx, g.fy, g.tip, Math.PI - aG, Math.PI - aL);
    arc(0, 0, g.R, Math.PI - aL, aL - g.step);
  }
  return b.close();
}

const P = (p: Params) => p as unknown as PulleyParams;
const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });
const PROFILE_NAMES: Record<string, string> = { gt2_2: 'GT2 2 mm', gt2_3: 'GT2 3 mm', gt2_5: 'GT2 5 mm', htd_3: 'HTD 3M', htd_5: 'HTD 5M' };

export const PULLEY: Generator = {
  id: 'pulley',
  version: 1,
  kind: 'part',
  name: t('Riemenscheibe'),
  icon: 'pulley',
  tile: {
    group: 'mech',
    text: (t) => ({
      name: t('Riemenscheibe'),
      desc: t('Zahnriemenscheibe für GT2- oder HTD-Riemen, mit Bordscheiben.'),
      keys: t('Riemen Zahnriemen GT2 HTD Pulley|Suchwörter'),
      action: t('Riemenscheibe erstellen (GT2, HTD; Parameter bleiben erhalten)'),
    }),
  },
  schema: [
    { key: 'profile', type: 'enum', label: t('Riemenprofil'), def: 'gt2_2', options: Object.entries(PROFILE_NAMES) },
    { key: 'teeth', type: 'int', label: t('Zähnezahl'), min: 8, max: 400, def: 20 },
    { key: 'play', type: 'length', label: t('Spiel der Zahnlücke'), min: -0.5, max: 1, def: 0, title: t('Macht jede Zahnlücke breiter, damit der Riemen leicht einläuft') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit die Scheibe die Sollmaße hat. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    ...boreSchema('', '', 'round', 5),
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    const g = pulleyGap(p);
    if (g.rw <= 0.05) out.push({ key: 'play', level: 'error', msg: t('Die Zahnlücke ist zu schmal.') });
    else {
      if (g.land <= 0) out.push({ key: 'teeth', level: 'error', msg: t('Zu wenige Zähne für dieses Profil: Die Lücken überlappen sich.') });
      else if (g.land * g.R < 0.15)
        out.push({ key: 'teeth', level: 'warn', msg: t('Sehr schmale Zähne ({w} mm): Bei so wenigen Zähnen besser weniger Spiel oder ein kleineres Profil.', { w: fmt(g.land * g.R) }) });
    }
    out.push(...boreIssues(raw, p.kerf, g.R - g.depth, 1));
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const subs = [pulleyOutline(p)];
    const hole = boreOutline(raw, p.kerf);
    if (hole) subs.push(hole);
    const belt = BELTS[p.profile];
    return {
      parts: [{ key: 'main', subs: subs.map(flipY), at: { x: 0, y: 0 } }],
      info: [
        [t('Außendurchmesser'), `⌀ ${fmt(pulleyOD(p))} mm`],
        [t('Wirkdurchmesser'), `⌀ ${fmt((p.teeth * belt.pitch) / Math.PI)} mm`],
        [t('Riemenweg je Umdrehung'), `${fmt(p.teeth * belt.pitch)} mm`],
      ],
    };
  },
  label(raw) {
    const p = P(raw);
    return t('Riemenscheibe {profile} z={z}', { profile: PROFILE_NAMES[p.profile] ?? p.profile, z: p.teeth });
  },
};
