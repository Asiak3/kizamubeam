// Baugruppe „Zahnradpaar“: zwei passende Stirnräder im richtigen Achsabstand, optional eine Grundplatte mit den
// beiden Achslöchern. Die Räder kommen aus dem Zahnradgenerator; Profilverschiebung wird als x₁ = −x₂ verteilt,
// damit der Achsabstand m·(z₁ + z₂)/2 bleibt.
import type { SubPath } from '../model';
import { t } from '../i18n';
import { flipY, layoutParts, PathBuilder } from './build';
import { boreIssues, boreSchema } from './bore';
import { GEAR, gearGeometry, GearParams } from './gear';
import type { GenPart, Generator, Issue, Params } from './types';

export interface GearPairParams {
  teeth1: number;
  teeth2: number;
  module: number;
  pressureAngle: number;
  backlash: number;
  kerf: number;
  plate: boolean;
  axleDia: number;
  margin: number;
  profileShift: number;
  rootFillet: number;
  clearance: number;
}

const P = (p: Params) => p as unknown as GearPairParams;
const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Parameter des Zahnradgenerators für Rad i (1 oder 2) */
export function pairGear(raw: Params, i: 1 | 2): Params {
  const p = P(raw);
  const s = String(i);
  const g: GearParams = {
    teeth: i === 1 ? p.teeth1 : p.teeth2,
    module: p.module,
    pressureAngle: p.pressureAngle,
    backlash: p.backlash,
    kerf: p.kerf,
    profileShift: i === 1 ? p.profileShift : -p.profileShift,
    rootFillet: p.rootFillet,
    clearance: p.clearance,
    boreType: raw['boreType' + s] as GearParams['boreType'],
    boreDia: Number(raw['boreDia' + s]),
    boreFlat: Number(raw['boreFlat' + s]),
    keyWidth: Number(raw['keyWidth' + s]),
    keyDepth: Number(raw['keyDepth' + s]),
  };
  return g as unknown as Params;
}

export const centerDistance = (p: GearPairParams) => (p.module * (p.teeth1 + p.teeth2)) / 2;

/** Grundplatte (y nach oben, Mitte im Ursprung) mit Löchern an den Achsen x1, x2 */
function plateOutline(p: GearPairParams, w: number, h: number, x1: number, x2: number): SubPath[] {
  const d = p.kerf / 2;
  const W = w / 2 + d,
    H = h / 2 + d;
  const cr = Math.min(3, p.margin) + d;
  const b = new PathBuilder();
  b.arc(W - cr, H - cr, cr, 0, Math.PI / 2);
  b.arc(-W + cr, H - cr, cr, Math.PI / 2, Math.PI);
  b.arc(-W + cr, -H + cr, cr, Math.PI, (3 * Math.PI) / 2);
  b.arc(W - cr, -H + cr, cr, (3 * Math.PI) / 2, 2 * Math.PI);
  const out = [b.close()];
  const r = p.axleDia / 2 - d;
  for (const x of [x1, x2]) {
    const hb = new PathBuilder();
    hb.arc(x, 0, r, 0, 2 * Math.PI);
    out.push(hb.close());
  }
  return out;
}

export const GEARPAIR: Generator = {
  id: 'gearpair',
  version: 2,
  kind: 'assembly',
  name: t('Zahnradpaar'),
  icon: 'gearpair',
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest' },
    { key: 'teeth1', type: 'int', label: t('Zähnezahl Rad 1'), min: 5, max: 400, def: 18 },
    { key: 'teeth2', type: 'int', label: t('Zähnezahl Rad 2'), min: 5, max: 400, def: 36 },
    { key: 'module', type: 'length', label: t('Modul'), min: 0.3, max: 20, def: 2, title: t('Teilkreisdurchmesser geteilt durch Zähnezahl') },
    { key: 'pressureAngle', type: 'angle', label: t('Eingriffswinkel'), min: 10, max: 35, def: 20, title: t('Üblich sind 20°') },
    { key: 'backlash', type: 'length', label: t('Flankenspiel'), min: 0, max: 3, def: 0.1, title: t('Spiel der Paarung auf dem Teilkreis; jedes Rad wird um die Hälfte dünner') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Konturen werden um die Hälfte nach außen versetzt, Löcher werden kleiner. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    ...boreSchema('1', t('Rad 1')),
    ...boreSchema('2', t('Rad 2')),
    { key: 'plate', type: 'bool', label: t('Grundplatte mit Achslöchern'), def: false },
    { key: 'axleDia', type: 'length', label: t('Achslochdurchmesser'), min: 0.5, max: 500, def: 6, showIf: (p) => !!p.plate },
    { key: 'margin', type: 'length', label: t('Rand der Grundplatte'), min: 0, max: 500, def: 8, showIf: (p) => !!p.plate, title: t('Überstand der Platte über die Kopfkreise') },
    { key: 'profileShift', type: 'number', label: t('Profilverschiebung Rad 1'), min: -0.8, max: 1, def: 0, advanced: true, title: t('Rad 2 bekommt die negative Verschiebung, der Achsabstand bleibt. Positiv vermeidet Unterschnitt am kleinen Rad.') },
    { key: 'rootFillet', type: 'number', label: t('Fußrundung (× Modul)'), min: 0, max: 0.45, def: 0.38, advanced: true, title: t('Radius der Werkzeugkopfrundung, Norm: 0,38') },
    { key: 'clearance', type: 'number', label: t('Kopfspiel (× Modul)'), min: 0.1, max: 0.5, def: 0.25, advanced: true, title: t('Abstand zwischen Zahnkopf und Fußkreis des Gegenrads, Norm: 0,25') },
  ],
  // Saved gear pairs keep their row layout; new ones are nested compactly.
  migrate(p, from) { return from < 2 ? { ...p, partLayout: 'rows' } : p; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    for (const i of [1, 2] as const) {
      const gp = pairGear(raw, i);
      // Bohrungen getrennt prüfen (eigene Feldnamen), Verzahnung über den Zahnradgenerator
      for (const is of GEAR.validate({ ...gp, boreType: 'none' })) {
        const key = is.key === 'teeth' ? 'teeth' + i : is.key === 'profileShift' ? 'profileShift' : is.key;
        out.push({ ...is, key, msg: `${t('Rad {i}', { i })}: ${is.msg}` });
      }
      if (out.some((x) => x.level === 'error')) continue;
      out.push(...boreIssues(raw, p.kerf, gearGeometry(gp as unknown as GearParams).rf, Math.max(1, p.module), String(i)));
    }
    if (p.plate) {
      if (p.axleDia >= centerDistance(p)) out.push({ key: 'axleDia', level: 'error', msg: t('Die Achslöcher überschneiden sich.') });
      if (p.axleDia / 2 - p.kerf / 2 <= 0) out.push({ key: 'axleDia', level: 'error', msg: t('Achsloch kleiner als die Schnittfuge.') });
    }
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const r1 = GEAR.generate(pairGear(raw, 1)).parts[0];
    const r2 = GEAR.generate(pairGear(raw, 2)).parts[0];
    const g1 = gearGeometry(pairGear(raw, 1) as unknown as GearParams);
    const g2 = gearGeometry(pairGear(raw, 2) as unknown as GearParams);
    const a = centerDistance(p);
    const gap = 5 + p.kerf;
    // Reihen (gespeicherte Paare): Räder nebeneinander, die Platte darunter. Neue Paare werden danach kompakt verschachtelt.
    const W = 2 * g1.ra + gap + 2 * g2.ra;
    let parts: GenPart[] = [
      { key: 'gear1', subs: r1.subs, at: { x: -W / 2 + g1.ra, y: 0 } },
      { key: 'gear2', subs: r2.subs, at: { x: W / 2 - g2.ra, y: 0 } },
    ];
    if (p.plate) {
      const ra1 = g1.ra - p.kerf / 2,
        ra2 = g2.ra - p.kerf / 2;
      const w = a + ra1 + ra2 + 2 * p.margin,
        h = 2 * Math.max(ra1, ra2) + 2 * p.margin;
      const c0 = (ra2 - ra1) / 2;
      const subs = plateOutline(p, w, h, -a / 2 - c0, a / 2 - c0).map(flipY);
      parts.push({ key: 'plate', subs, at: { x: 0, y: Math.max(g1.ra, g2.ra) + gap + h / 2 + p.kerf / 2 } });
    }
    parts = layoutParts(parts, gap, raw.partLayout);
    return {
      parts,
      info: [
        [t('Achsabstand'), `${fmt(a, 3)} mm`],
        [t('Übersetzung'), `1 : ${fmt(p.teeth2 / p.teeth1, 3)}`],
        [t('Kopfkreise'), `⌀ ${fmt(2 * g1.ra)} / ⌀ ${fmt(2 * g2.ra)} mm`],
        [t('Teile'), String(parts.length)],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Zahnradpaar {z1}:{z2} m={m}', { z1: p.teeth1, z2: p.teeth2, m: fmt(p.module, 3) });
    const names: Record<string, string> = { gear1: t('Rad 1'), gear2: t('Rad 2'), plate: t('Grundplatte') };
    return part && names[part] ? `${base}: ${names[part]}` : base;
  },
};
