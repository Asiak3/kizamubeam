// Achsbohrungen für runde Bauteile (Zahnrad, Riemenscheibe, Nocken, Zahnradpaar): rund, D-Profil, Passfedernut.
// Felder, Prüfung und Kontur an einer Stelle; mit suffix bekommen Baugruppen getrennte Bohrungen ('1', '2').
import type { SubPath } from '../model';
import { t, locale } from '../i18n';
import { PathBuilder } from './build';
import type { Issue, Params, ParamSpec } from './types';

const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(locale, { maximumFractionDigits: d });

/** Felder der Bohrung; label ergänzt die Beschriftung (z. B. „Rad 1“) */
export function boreSchema(suffix = '', label = '', def: 'none' | 'round' = 'round', dia = 6): ParamSpec[] {
  const k = (s: string) => s + suffix;
  const L = (s: string) => (label ? `${s} (${label})` : s);
  return [
    {
      key: k('boreType'), type: 'enum', label: L(t('Bohrung')), def,
      options: [['none', t('Keine')], ['round', t('Rund')], ['dflat', t('D-Profil (abgeflacht)')], ['key', t('Mit Passfedernut')]],
    },
    { key: k('boreDia'), type: 'length', label: L(t('Bohrungsdurchmesser')), min: 0.5, max: 2000, def: dia, showIf: { ne: [k('boreType'), 'none'] } },
    { key: k('boreFlat'), type: 'length', label: L(t('Maß über Abflachung')), min: 0.1, max: 2000, def: Math.round(dia * 0.917 * 10) / 10, showIf: { eq: [k('boreType'), 'dflat'] }, title: t('Abstand von der Abflachung zur gegenüberliegenden Seite der Bohrung') },
    { key: k('keyWidth'), type: 'length', label: L(t('Nutbreite')), min: 0.1, max: 200, def: 2, showIf: { eq: [k('boreType'), 'key'] } },
    { key: k('keyDepth'), type: 'length', label: L(t('Nuttiefe')), min: 0.1, max: 200, def: 1, showIf: { eq: [k('boreType'), 'key'] }, title: t('Tiefe der Nut über den Bohrungsrand hinaus') },
  ];
}

interface Bore {
  type: string;
  dia: number;
  flat: number;
  keyWidth: number;
  keyDepth: number;
}
const read = (p: Params, suffix: string): Bore => ({
  type: String(p['boreType' + suffix]),
  dia: Number(p['boreDia' + suffix]),
  flat: Number(p['boreFlat' + suffix]),
  keyWidth: Number(p['keyWidth' + suffix]),
  keyDepth: Number(p['keyDepth' + suffix]),
});

/** Weitester Radius der Bohrung (mit Nut) */
export function boreReach(p: Params, suffix = ''): number {
  const b = read(p, suffix);
  if (b.type === 'none') return 0;
  return b.type === 'key' ? b.dia / 2 + b.keyDepth : b.dia / 2;
}

/** Bohrung um den Ursprung (y nach oben); die halbe Fuge macht sie kleiner */
export function boreOutline(p: Params, kerf: number, suffix = ''): SubPath | null {
  const b = read(p, suffix);
  const k2 = kerf / 2;
  const r = b.dia / 2 - k2;
  if (b.type === 'none' || r <= 0) return null;
  const pb = new PathBuilder();
  if (b.type === 'dflat') {
    const yf = b.flat - b.dia / 2 - k2;
    const a = Math.atan2(yf, Math.sqrt(Math.max(0, r * r - yf * yf)));
    pb.arc(0, 0, r, a, -Math.PI - a);
    return pb.close();
  }
  if (b.type === 'key') {
    const hw = (b.keyWidth - kerf) / 2;
    const top = b.dia / 2 + b.keyDepth - k2;
    const a = Math.atan2(Math.sqrt(Math.max(0, r * r - hw * hw)), hw);
    pb.arc(0, 0, r, a, a - 2 * Math.PI + (Math.PI - 2 * a));
    pb.line({ x: -hw, y: top });
    pb.line({ x: hw, y: top });
    return pb.close();
  }
  pb.arc(0, 0, r, 0, 2 * Math.PI);
  return pb.close();
}

/** Prüfung: Bohrung muss mit Wandstärke minWall in den Radius rMax passen */
export function boreIssues(p: Params, kerf: number, rMax: number, minWall: number, suffix = '', toothed = true): Issue[] {
  const b = read(p, suffix);
  const out: Issue[] = [];
  if (b.type === 'none') return out;
  const wall = rMax - boreReach(p, suffix);
  if (wall <= 0) out.push({ key: 'boreDia' + suffix, level: 'error', msg: toothed ? t('Die Bohrung ist größer als der Fußkreis.') : t('Die Bohrung reicht über den Rand.') });
  else if (wall < minWall)
    out.push({
      key: 'boreDia' + suffix, level: 'warn',
      msg: toothed ? t('Nur {w} mm Material zwischen Bohrung und Zahnfuß.', { w: fmt(wall) }) : t('Nur {w} mm Material zwischen Bohrung und Rand.', { w: fmt(wall) }),
    });
  if (b.type === 'dflat' && (b.flat <= b.dia / 2 || b.flat >= b.dia))
    out.push({ key: 'boreFlat' + suffix, level: 'error', msg: t('Das Maß über der Abflachung muss zwischen Radius und Durchmesser der Bohrung liegen.') });
  if (b.type === 'key' && b.keyWidth >= b.dia) out.push({ key: 'keyWidth' + suffix, level: 'error', msg: t('Die Nut ist breiter als die Bohrung.') });
  if (b.dia / 2 - kerf / 2 <= 0) out.push({ key: 'boreDia' + suffix, level: 'error', msg: t('Bohrung kleiner als die Schnittfuge.') });
  return out;
}
