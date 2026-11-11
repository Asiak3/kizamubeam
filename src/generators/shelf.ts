// Baugruppe „Steckregal“: zwei Seiten und mehrere Böden, ohne Leim und Schrauben gesteckt (Kreuzschlitze).
// Die Seiten haben Schlitze von der Rückkante bis zur halben Tiefe, die Böden Schlitze von der Vorderkante bis
// zur halben Tiefe; der Boden wird von vorne über die Seiten geschoben. Die Böden stehen um den Überstand über.
import type { Pt } from '../model';
import { t } from '../i18n';
import { arrangeParts, polySub } from './build';
import { cleanup, offsetOrtho } from './box';
import type { Generator, Issue, Params } from './types';

export interface ShelfParams {
  width: number;
  depth: number;
  height: number;
  thickness: number;
  shelves: number;
  bottomGap: number;
  topGap: number;
  overhang: number;
  play: number;
  kerf: number;
}

const P = (p: Params) => p as unknown as ShelfParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Höhe der Bodenunterkanten über dem Fußboden, von unten nach oben */
export function shelfHeights(p: ShelfParams): number[] {
  const top = p.height - p.topGap - p.thickness;
  if (p.shelves === 1) return [p.bottomGap];
  const step = (top - p.bottomGap) / (p.shelves - 1);
  return Array.from({ length: p.shelves }, (_, i) => p.bottomGap + i * step);
}

/** Seite (lokal: x = Tiefe von vorne, y = Höhe von oben nach unten) mit Schlitzen von der Rückkante */
export function sideOutline(p: ShelfParams): Pt[] {
  const D = p.depth,
    H = p.height,
    w = p.thickness + p.play;
  const pts: Pt[] = [{ x: 0, y: 0 }, { x: D, y: 0 }];
  // Rückkante von oben nach unten; Bodenunterkante z → Schlitz um die Bodenmitte (Höhe H − z − t/2 von oben)
  const slots = shelfHeights(p)
    .map((z) => H - z - p.thickness / 2)
    .sort((a, b) => a - b);
  for (const yc of slots) pts.push({ x: D, y: Math.max(0, yc - w / 2) }, { x: D / 2, y: Math.max(0, yc - w / 2) }, { x: D / 2, y: Math.min(H, yc + w / 2) }, { x: D, y: Math.min(H, yc + w / 2) });
  pts.push({ x: D, y: H }, { x: 0, y: H });
  return cleanup(pts);
}

/** Lage der Seitenmitten im Boden (x von links) */
export const sideCenters = (p: ShelfParams) => [p.overhang + p.thickness / 2, p.width - p.overhang - p.thickness / 2];

/** Boden (lokal: x = Breite, y = Tiefe von vorne) mit Schlitzen von der Vorderkante */
export function boardOutline(p: ShelfParams): Pt[] {
  const W = p.width,
    D = p.depth,
    w = p.thickness + p.play;
  const pts: Pt[] = [{ x: 0, y: 0 }];
  for (const xc of sideCenters(p)) pts.push({ x: Math.max(0, xc - w / 2), y: 0 }, { x: Math.max(0, xc - w / 2), y: D / 2 }, { x: Math.min(W, xc + w / 2), y: D / 2 }, { x: Math.min(W, xc + w / 2), y: 0 });
  pts.push({ x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D });
  return cleanup(pts);
}

export const SHELF: Generator = {
  id: 'shelf',
  version: 2,
  kind: 'assembly',
  name: t('Steckregal'),
  icon: 'shelf',
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest' },
    { key: 'width', type: 'length', label: t('Breite'), min: 30, max: 3000, def: 300, title: t('Länge der Böden') },
    { key: 'depth', type: 'length', label: t('Tiefe'), min: 20, max: 1000, def: 150 },
    { key: 'height', type: 'length', label: t('Höhe'), min: 30, max: 3000, def: 300 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 4 },
    { key: 'shelves', type: 'int', label: t('Anzahl Böden'), min: 1, max: 30, def: 3 },
    { key: 'bottomGap', type: 'length', label: t('Unterster Boden über Grund'), min: 0, max: 1000, def: 30, title: t('Höhe der Unterkante des untersten Bodens') },
    { key: 'topGap', type: 'length', label: t('Oberster Boden unter Oberkante'), min: 0, max: 1000, def: 20, title: t('Abstand von der Oberkante der Seiten zur Oberseite des obersten Bodens') },
    { key: 'overhang', type: 'length', label: t('Überstand der Böden'), min: 0, max: 500, def: 20, title: t('So weit ragen die Böden seitlich über die Seiten hinaus') },
    { key: 'play', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0.1, title: t('Die Schlitze werden um so viel breiter als die Materialdicke; negativ = Presspassung') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, Schlitze werden schmaler. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  // Saved objects keep their packParts layout; new ones are nested compactly.
  migrate(p, from) { return from < 2 ? { ...p, partLayout: 'packed' } : p; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    const zs = shelfHeights(p);
    const top = p.height - p.topGap - p.thickness;
    if (top < p.bottomGap) out.push({ key: 'height', level: 'error', msg: t('Die Böden passen nicht in die Höhe.') });
    else if (zs.length > 1 && zs[1] - zs[0] < p.thickness + p.play + 5) out.push({ key: 'shelves', level: 'error', msg: t('Zu viele Böden für diese Höhe.') });
    if (p.width - 2 * p.overhang < 3 * p.thickness) out.push({ key: 'overhang', level: 'error', msg: t('Der Überstand ist zu groß für diese Breite.') });
    if (p.thickness + p.play <= p.kerf) out.push({ key: 'play', level: 'error', msg: t('Die Schlitze werden schmaler als die Schnittfuge.') });
    if (p.overhang < p.thickness) out.push({ key: 'overhang', level: 'warn', msg: t('Wenig Material neben den Schlitzen der Böden: Überstand mindestens so groß wie die Materialdicke wählen.') });
    if (p.topGap < p.thickness) out.push({ key: 'topGap', level: 'warn', msg: t('Über dem obersten Boden bleibt wenig Material an den Seiten.') });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const d = p.kerf / 2;
    const side = offsetOrtho(sideOutline(p), d).map((q) => ({ x: q.x - p.depth / 2, y: q.y - p.height / 2 }));
    const board = offsetOrtho(boardOutline(p), d).map((q) => ({ x: q.x - p.width / 2, y: q.y - p.depth / 2 }));
    const items = [
      { key: 'side1', subs: [polySub(side)] },
      { key: 'side2', subs: [polySub(side)] },
      ...shelfHeights(p).map((_, i) => ({ key: `board${i + 1}`, subs: [polySub(board)] })),
    ];
    const parts = arrangeParts(items, 5 + p.kerf, raw.partLayout);
    const zs = shelfHeights(p);
    return {
      parts,
      info: [
        [t('Lichte Höhe zwischen Böden'), zs.length > 1 ? `${fmt(zs[1] - zs[0] - p.thickness)} mm` : '–'],
        [t('Lichte Breite zwischen Seiten'), `${fmt(p.width - 2 * p.overhang - 2 * p.thickness)} mm`],
        [t('Teile'), String(parts.length)],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Steckregal {w}×{h}', { w: fmt(p.width), h: fmt(p.height) });
    if (!part) return base;
    const n = part.replace(/\D/g, '');
    return `${base}: ${part.startsWith('side') ? t('Seite {n}', { n }) : t('Boden {n}', { n })}`;
  },
};
