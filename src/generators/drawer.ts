// Baugruppe „Schublade“: Korpus (vorne offener Kasten) mit passendem Schubkasten und Blende mit Griffloch.
// Korpus und Schubkasten sind Boxen mit Fingerzinken aus dem Boxgenerator: Der Korpus ist eine Box, deren offene
// Seite nach vorne zeigt (Breite × Tiefe × Höhe vertauscht), der Schubkasten eine oben offene Box.
// Maße: Außenmaß des Korpus; der Schubkasten bekommt seitlich, oben und hinten Luft.
import type { Pt, SubPath } from '../model';
import { t } from '../i18n';
import { arrangeParts, flipY, PathBuilder, polySub } from './build';
import { BoxParams, panelPolys } from './box';
import type { Generator, Issue, Params } from './types';

export interface DrawerParams {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  carcass: boolean;
  sidePlay: number;
  topPlay: number;
  backPlay: number;
  front: 'none' | 'overlay' | 'inset';
  frontGap: number;
  handle: 'none' | 'slot' | 'hole';
  handleWidth: number;
  handleHeight: number;
  finger: number;
  clearance: number;
  kerf: number;
}

const P = (p: Params) => p as unknown as DrawerParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Maße von Korpus, Schubkasten und Blende (Außenmaße) */
export function drawerDims(p: DrawerParams) {
  const t2 = 2 * p.thickness;
  // Ohne Korpus sind die Maße die des Fachs, in das der Schubkasten kommt
  const opening = p.carcass ? { W: p.width - t2, H: p.height - t2, D: p.depth - p.thickness } : { W: p.width, H: p.height, D: p.depth };
  const inset = p.front === 'inset' ? p.thickness : 0;
  const box = { W: opening.W - 2 * p.sidePlay, H: opening.H - p.topPlay, D: opening.D - p.backPlay - inset };
  const front =
    p.front === 'overlay'
      ? { W: (p.carcass ? p.width : opening.W) - 2 * p.frontGap, H: (p.carcass ? p.height : opening.H) - 2 * p.frontGap }
      : p.front === 'inset'
        ? { W: opening.W - 2 * p.frontGap, H: opening.H - 2 * p.frontGap }
        : null;
  return { opening, box, front };
}

const boxOf = (p: DrawerParams, W: number, D: number, H: number): BoxParams => ({
  sizeMode: 'outer', width: W, depth: D, height: H, thickness: p.thickness, top: 'open', finger: p.finger, clearance: p.clearance, kerf: p.kerf,
});

/** Blende (y nach oben, Mitte im Ursprung) mit Griffloch */
function frontPlate(p: DrawerParams, W: number, H: number): SubPath[] {
  const d = p.kerf / 2;
  const outer: Pt[] = [{ x: -W / 2 - d, y: -H / 2 - d }, { x: W / 2 + d, y: -H / 2 - d }, { x: W / 2 + d, y: H / 2 + d }, { x: -W / 2 - d, y: H / 2 + d }];
  const subs: SubPath[] = [polySub(outer)];
  const b = new PathBuilder();
  if (p.handle === 'hole') {
    b.arc(0, 0, p.handleWidth / 2 - d, 0, 2 * Math.PI);
    subs.push(b.close());
  } else if (p.handle === 'slot') {
    // Langloch mit runden Enden
    const r = p.handleHeight / 2 - d,
      hx = p.handleWidth / 2 - p.handleHeight / 2;
    b.arc(hx, 0, r, -Math.PI / 2, Math.PI / 2);
    b.arc(-hx, 0, r, Math.PI / 2, (3 * Math.PI) / 2);
    subs.push(b.close());
  }
  return subs;
}

const PART_NAMES: Record<string, () => string> = {
  c_back: () => t('Korpus Rückwand'),
  c_bottom: () => t('Korpus Boden'),
  c_top: () => t('Korpus Deckel'),
  c_left: () => t('Korpus Seite links'),
  c_right: () => t('Korpus Seite rechts'),
  d_bottom: () => t('Schubkasten Boden'),
  d_front: () => t('Schubkasten Vorderwand'),
  d_back: () => t('Schubkasten Rückwand'),
  d_left: () => t('Schubkasten Seite links'),
  d_right: () => t('Schubkasten Seite rechts'),
  front: () => t('Blende'),
};

export const DRAWER: Generator = {
  id: 'drawer',
  version: 2,
  kind: 'assembly',
  name: t('Schublade'),
  icon: 'drawer',
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest' },
    { key: 'width', type: 'length', label: t('Breite'), min: 20, max: 3000, def: 160, title: t('Außenmaß des Korpus (ohne Korpus: Breite des Fachs)') },
    { key: 'height', type: 'length', label: t('Höhe'), min: 15, max: 3000, def: 80 },
    { key: 'depth', type: 'length', label: t('Tiefe'), min: 20, max: 3000, def: 150 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 3 },
    { key: 'carcass', type: 'bool', label: t('Mit Korpus'), def: true },
    { key: 'front', type: 'enum', label: t('Blende'), def: 'overlay', options: [['overlay', t('Vorgesetzt (deckt den Korpus ab)')], ['inset', t('Eingelegt (in der Öffnung)')], ['none', t('Keine')]] },
    { key: 'handle', type: 'enum', label: t('Griff'), def: 'slot', options: [['slot', t('Griffloch (Langloch)')], ['hole', t('Rundes Loch')], ['none', t('Keiner')]], showIf: (p) => p.front !== 'none' },
    { key: 'handleWidth', type: 'length', label: t('Griffbreite'), min: 3, max: 1000, def: 50, showIf: (p) => p.front !== 'none' && p.handle !== 'none', title: t('Länge des Langlochs bzw. Durchmesser des runden Lochs') },
    { key: 'handleHeight', type: 'length', label: t('Griffhöhe'), min: 3, max: 500, def: 18, showIf: (p) => p.front !== 'none' && p.handle === 'slot' },
    { key: 'sidePlay', type: 'length', label: t('Luft seitlich'), min: 0, max: 20, def: 1, title: t('Abstand zwischen Schubkasten und Korpus auf jeder Seite') },
    { key: 'topPlay', type: 'length', label: t('Luft oben'), min: 0, max: 50, def: 2 },
    { key: 'backPlay', type: 'length', label: t('Luft hinten'), min: 0, max: 100, def: 2 },
    { key: 'frontGap', type: 'length', label: t('Fuge um die Blende'), min: 0, max: 20, def: 1, showIf: (p) => p.front !== 'none', title: t('Die Blende wird ringsum um so viel kleiner') },
    { key: 'finger', type: 'length', label: t('Zinkenbreite'), min: 0.5, max: 500, def: 10, advanced: true },
    { key: 'clearance', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0, advanced: true, title: t('Jede Zinke wird um so viel schmaler; negativ = Presspassung') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, Löcher werden kleiner. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  // Saved objects keep their packParts layout; new ones are nested compactly.
  migrate(p, from) { return from < 2 ? { ...p, partLayout: 'packed' } : p; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    const { box, front } = drawerDims(p);
    const th = p.thickness;
    if (Math.min(box.W, box.H, box.D) <= 4 * th)
      out.push({ key: 'thickness', level: 'error', msg: t('Der Schubkasten wird zu klein für diese Materialdicke (jede Seite braucht mehr als die vierfache Materialdicke).') });
    if (p.carcass && Math.min(p.width, p.height, p.depth) <= 4 * th) out.push({ key: 'thickness', level: 'error', msg: t('Die Platten sind zu dick für diese Maße (jede Seite braucht mehr als die vierfache Materialdicke).') });
    if (Math.abs(p.clearance) >= p.finger / 4) out.push({ key: 'clearance', level: 'error', msg: t('Das Steckspiel ist zu groß für diese Zinkenbreite.') });
    if (p.finger < th) out.push({ key: 'finger', level: 'warn', msg: t('Zinken schmaler als die Materialdicke brechen leicht.') });
    if (front && p.handle !== 'none') {
      const hw = p.handleWidth,
        hh = p.handle === 'slot' ? p.handleHeight : p.handleWidth;
      if (p.handle === 'slot' && p.handleHeight > p.handleWidth) out.push({ key: 'handleHeight', level: 'error', msg: t('Das Griffloch ist höher als breit.') });
      if (hw > front.W - 2 * th || hh > front.H - 2 * th) out.push({ key: 'handleWidth', level: 'error', msg: t('Der Griff passt nicht in die Blende.') });
      // Der Griff liegt vor der Vorderwand des Schubkastens: dort muss Platz sein
      else if (hh > box.H - 2 * th) out.push({ key: 'handleWidth', level: 'warn', msg: t('Der Griff reicht über die Vorderwand des Schubkastens hinaus.') });
    }
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const { box, front } = drawerDims(p);
    const items: { key: string; subs: SubPath[] }[] = [];
    const add = (prefix: string, b: BoxParams, map: Record<string, string> = {}) => {
      for (const panel of panelPolys(b)) items.push({ key: prefix + (map[panel.key] ?? panel.key), subs: [polySub(panel.pts)] });
    };
    // Korpus: Box mit Breite × Höhe (als Tiefe) × Tiefe (als Höhe), offene Seite vorne
    if (p.carcass) add('c_', boxOf(p, p.width, p.height, p.depth), { bottom: 'back', front: 'bottom', back: 'top' });
    add('d_', boxOf(p, box.W, box.D, box.H));
    if (front) items.push({ key: 'front', subs: frontPlate(p, front.W, front.H).map(flipY) });
    const parts = arrangeParts(items, 5 + p.kerf, raw.partLayout);
    return {
      parts,
      info: [
        [t('Korpus außen'), p.carcass ? `${fmt(p.width)} × ${fmt(p.height)} × ${fmt(p.depth)} mm` : '–'],
        [t('Schubkasten außen'), `${fmt(box.W)} × ${fmt(box.H)} × ${fmt(box.D)} mm`],
        [t('Schubkasten innen'), `${fmt(box.W - 2 * p.thickness)} × ${fmt(box.H - p.thickness)} × ${fmt(box.D - 2 * p.thickness)} mm`],
        [t('Blende'), front ? `${fmt(front.W)} × ${fmt(front.H)} mm` : '–'],
        [t('Teile'), String(parts.length)],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Schublade {w}×{h}×{d}', { w: fmt(p.width), h: fmt(p.height), d: fmt(p.depth) });
    const name = part && PART_NAMES[part];
    return name ? `${base}: ${name()}` : base;
  },
};
