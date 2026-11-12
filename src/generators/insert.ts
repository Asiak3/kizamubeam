// Baugruppe „Einsatz“: Fächergitter aus gesteckten Stegen für eine Box oder Schublade.
// Stege in Längsrichtung (teilen die Breite) haben Schlitze von oben, Stege in Querrichtung Schlitze von unten,
// jeweils bis zur halben Höhe. Die Fächer sind gleich groß. Die Stege sind um die Endluft kürzer als das Innenmaß.
import type { Pt } from '../model';
import { t } from '../i18n';
import { arrangeParts, polySub } from './build';
import { offsetOrtho } from './box';
import type { Generator, Issue, Params } from './types';

export interface InsertParams {
  width: number;
  depth: number;
  height: number;
  thickness: number;
  cellsX: number;
  cellsY: number;
  play: number;
  endPlay: number;
  kerf: number;
}

const P = (p: Params) => p as unknown as InsertParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Lage der Stegmitten über eine Innenlänge L bei n gleichen Fächern (Stege der Dicke th) */
export function dividerCenters(L: number, n: number, th: number): number[] {
  const cell = (L - (n - 1) * th) / n;
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) * cell + i * th + th / 2);
}

/**
 * Steg der Länge L und Höhe h (lokal 0..L × 0..h, y nach unten) mit Schlitzen der Breite w und Tiefe h/2
 * an den Stellen xs, von oben (fromTop) oder von unten.
 */
export function stripOutline(L: number, h: number, xs: number[], w: number, fromTop: boolean): Pt[] {
  const slots = [...xs].sort((a, b) => a - b);
  const edge: Pt[] = [];
  // Kante mit den Schlitzen von links nach rechts, Schlitzgrund bei h/2
  const y0 = fromTop ? 0 : h;
  for (const x of slots) edge.push({ x: x - w / 2, y: y0 }, { x: x - w / 2, y: h / 2 }, { x: x + w / 2, y: h / 2 }, { x: x + w / 2, y: y0 });
  if (fromTop) return [{ x: 0, y: 0 }, ...edge, { x: L, y: 0 }, { x: L, y: h }, { x: 0, y: h }];
  return [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: h }, ...edge.reverse(), { x: 0, y: h }];
}

/** Stege: Längsstege (x1 …, Länge = Tiefe) und Querstege (y1 …, Länge = Breite), Mitte im Ursprung, mit Fuge */
export function insertStrips(p: InsertParams): { key: string; L: number; pts: Pt[] }[] {
  const xs = dividerCenters(p.width, p.cellsX, p.thickness);
  const ys = dividerCenters(p.depth, p.cellsY, p.thickness);
  const e = p.endPlay / 2;
  const w = p.thickness + p.play;
  const out: { key: string; L: number; pts: Pt[] }[] = [];
  const add = (key: string, L: number, cuts: number[], fromTop: boolean) => {
    const pts = offsetOrtho(stripOutline(L, p.height, cuts, w, fromTop), p.kerf / 2).map((q) => ({ x: q.x - L / 2, y: q.y - p.height / 2 }));
    out.push({ key, L, pts });
  };
  xs.forEach((_, i) => add(`x${i + 1}`, p.depth - p.endPlay, ys.map((y) => y - e), true));
  ys.forEach((_, i) => add(`y${i + 1}`, p.width - p.endPlay, xs.map((x) => x - e), false));
  return out;
}

export const INSERT: Generator = {
  id: 'insert',
  version: 2,
  kind: 'assembly',
  name: t('Einsatz'),
  icon: 'insert',
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest' },
    { key: 'width', type: 'length', label: t('Innenbreite'), min: 10, max: 3000, def: 150, title: t('Innenmaß der Box oder Schublade, in die der Einsatz kommt') },
    { key: 'depth', type: 'length', label: t('Innentiefe'), min: 10, max: 3000, def: 100 },
    { key: 'height', type: 'length', label: t('Höhe der Stege'), min: 4, max: 1000, def: 40 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 3 },
    { key: 'cellsX', type: 'int', label: t('Fächer in der Breite'), min: 1, max: 50, def: 3 },
    { key: 'cellsY', type: 'int', label: t('Fächer in der Tiefe'), min: 1, max: 50, def: 2 },
    { key: 'play', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0.1, title: t('Die Schlitze werden um so viel breiter als die Materialdicke; negativ = Presspassung') },
    { key: 'endPlay', type: 'length', label: t('Endluft'), min: 0, max: 20, def: 0.5, title: t('Die Stege werden um so viel kürzer als das Innenmaß, damit sie sich leicht einsetzen lassen') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, Schlitze werden schmaler. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  // Saved objects keep their packParts layout; new ones are nested compactly.
  migrate(p, from) { return from < 2 ? { ...p, partLayout: 'packed' } : p; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (p.cellsX === 1 && p.cellsY === 1) out.push({ key: 'cellsX', level: 'error', msg: t('Mindestens eine Richtung braucht zwei Fächer.') });
    const cx = (p.width - (p.cellsX - 1) * p.thickness) / p.cellsX,
      cy = (p.depth - (p.cellsY - 1) * p.thickness) / p.cellsY;
    if (Math.min(cx, cy) < p.thickness + p.play + 1) out.push({ key: 'thickness', level: 'error', msg: t('Die Fächer werden zu schmal.') });
    else if (Math.min(cx, cy) < 3 * p.thickness) out.push({ key: 'cellsX', level: 'warn', msg: t('Sehr schmale Fächer: Zwischen den Schlitzen bleibt wenig Material.') });
    if (p.thickness + p.play <= p.kerf) out.push({ key: 'play', level: 'error', msg: t('Die Schlitze werden schmaler als die Schnittfuge.') });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const strips = insertStrips(p);
    const parts = arrangeParts(strips.map((s) => ({ key: s.key, subs: [polySub(s.pts)] })), 5 + p.kerf, raw.partLayout);
    const cx = (p.width - (p.cellsX - 1) * p.thickness) / p.cellsX,
      cy = (p.depth - (p.cellsY - 1) * p.thickness) / p.cellsY;
    return {
      parts,
      info: [
        [t('Fachgröße'), `${fmt(cx)} × ${fmt(cy)} mm`],
        [t('Stege'), `${p.cellsX - 1} × ${fmt(p.depth - p.endPlay)} mm + ${p.cellsY - 1} × ${fmt(p.width - p.endPlay)} mm`],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Einsatz {nx}×{ny} Fächer', { nx: p.cellsX, ny: p.cellsY });
    if (!part) return base;
    const n = part.slice(1);
    return `${base}: ${part[0] === 'x' ? t('Längssteg {n}', { n }) : t('Quersteg {n}', { n })}`;
  },
};
