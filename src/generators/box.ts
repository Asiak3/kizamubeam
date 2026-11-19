// Generator „Box“ (erste Baugruppe): Kasten aus fünf oder sechs Platten mit Fingerzinken an allen Kanten.
//
// Aufbau: Vorder- und Rückwand besitzen die acht Eckwürfel, Seitenwände, Boden und Deckel sind dort ausgespart.
// Jede Kante ist zwischen den Ecken in eine ungerade Zahl gleich breiter Felder geteilt; die beiden Platten
// einer Kante haben genau entgegengesetzte Felder (Muster A: äußere Felder Material, Muster B: ausgespart).
// - Steckspiel macht jedes Materialfeld um das Spiel schmaler (negativ = Presspassung).
// - Die Schnittfuge versetzt danach die ganze Kontur um die halbe Fuge nach außen, wie beim Zahnrad.
// Alle Kanten sind gerade Linien; Lage und Drehung der Teile bleiben beim Neuberechnen erhalten.
import type { Pt, SubPath } from '../model';
import { t, locale } from '../i18n';
import type { Generator, GenPart, Issue, Params } from './types';
import { layoutParts } from './build';
import { neg, pose, X, Y, Z, type Pose } from './pose';
import { fieldCount, panelCut, type EdgeSpec, type PanelSpec, type Pattern } from './panelJoints';

export { cleanup, fieldCount, offsetOrtho } from './panelJoints';

export interface BoxParams {
  sizeMode: 'outer' | 'inner';
  width: number;
  depth: number;
  height: number;
  thickness: number;
  top: 'open' | 'closed';
  finger: number;
  clearance: number;
  kerf: number;
}

/** Außenmaße der Box */
export function boxOuter(p: BoxParams) {
  const t2 = 2 * p.thickness;
  if (p.sizeMode === 'outer') return { W: p.width, D: p.depth, H: p.height };
  return { W: p.width + t2, D: p.depth + t2, H: p.height + (p.top === 'closed' ? t2 : p.thickness) };
}

const P = (p: Params) => p as unknown as BoxParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(locale, { maximumFractionDigits: d });

/** Platten der Box mit Kantenmustern */
export function boxPanels(p: BoxParams): PanelSpec[] {
  const { W, D, H } = boxOuter(p);
  const top: Pattern = p.top === 'closed' ? 'B' : 'flat';
  const E = (x: Pattern): EdgeSpec => ({ pattern: x });
  const wall = (key: string, a: number, side: Pattern, corners: boolean): PanelSpec => ({
    key, a, b: H, corners, edges: [E(top), E(side), E('B'), E(side)],
  });
  const plate = (key: string): PanelSpec => ({ key, a: W, b: D, corners: false, edges: [E('A'), E('A'), E('A'), E('A')] });
  const out = [plate('bottom'), wall('front', W, 'A', true), wall('back', W, 'A', true), wall('left', D, 'B', false), wall('right', D, 'B', false)];
  if (p.top === 'closed') out.splice(1, 0, plate('top'));
  return out;
}

/** Umrisse aller Platten (Mitte im Ursprung, y nach unten, mit Schnittfuge) */
export function panelPolys(p: BoxParams): { key: string; a: number; b: number; pts: Pt[] }[] {
  return boxPanels(p).map((panel) => ({
    key: panel.key,
    a: panel.a,
    b: panel.b,
    pts: panelCut(panel, p.thickness, p.finger, p.clearance, p.kerf),
  }));
}

const PART_NAMES: Record<string, () => string> = {
  bottom: () => t('Boden'),
  top: () => t('Deckel'),
  front: () => t('Vorderwand'),
  back: () => t('Rückwand'),
  left: () => t('Seitenwand links'),
  right: () => t('Seitenwand rechts'),
};

/** Box: Boden auf Z = 0, Vorderwand bei Y = 0, linke Wand bei X = 0 */
export function boxPoses(p: BoxParams): Record<string, Pose> {
  const { W, D, H } = boxOuter(p);
  const th = p.thickness;
  const down = neg(Z);
  return {
    bottom: pose([W / 2, D / 2, 0], X, Y, Z),
    top: pose([W / 2, D / 2, H - th], X, Y, Z),
    front: pose([W / 2, 0, H / 2], X, down, Y),
    back: pose([W / 2, D - th, H / 2], X, down, Y),
    left: pose([0, D / 2, H / 2], Y, down, X),
    right: pose([W - th, D / 2, H / 2], Y, down, X),
  };
}

export const BOX: Generator = {
  id: 'box',
  version: 3,
  kind: 'assembly',
  name: t('Box'),
  icon: 'box',
  poses: (p) => ({ poses: boxPoses({ ...(p as unknown as BoxParams), kerf: 0 }) }),
  fit: { kind: 'pair', play: 'clearance', total: true },
  assemblyCheck: true,
  tile: {
    group: 'box',
    before: 'lidhinge',
    text: (t) => ({
      name: t('Box mit Fingerzinken'),
      desc: t('Kiste aus Platten mit Fingerzinken, mit oder ohne Deckel, als Baugruppe.'),
      keys: t('Kiste Kasten Gehäuse Schachtel Fingerzinken Deckel|Suchwörter'),
      action: t('Box mit Fingerzinken erstellen (Baugruppe, Parameter bleiben erhalten)'),
    }),
  },
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest', resetOnNew: true },
    { key: 'sizeMode', type: 'enum', label: t('Maße'), def: 'outer', options: [['outer', t('Außenmaß')], ['inner', t('Innenmaß')]] },
    { key: 'width', type: 'length', label: t('Breite'), min: 5, max: 3000, def: 100 },
    { key: 'depth', type: 'length', label: t('Tiefe'), min: 5, max: 3000, def: 80 },
    { key: 'height', type: 'length', label: t('Höhe'), min: 5, max: 3000, def: 50 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 3 },
    { key: 'top', type: 'enum', label: t('Oben'), def: 'open', options: [['open', t('Offen')], ['closed', t('Geschlossen (Deckel mit Zinken)')]] },
    { key: 'finger', type: 'length', label: t('Zinkenbreite'), min: 0.5, max: 500, def: 10, title: t('Mindestbreite der Zinken; jede Kante bekommt eine ungerade Zahl gleich breiter Zinken') },
    { key: 'clearance', type: 'length', label: t('Steckspiel gesamt'), min: -2, max: 4, def: 0, playTotal: true, title: t('Gesamtspiel der Zinken: Lücke minus Zinke, auf beide Seiten verteilt; negativ = Presspassung') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit die Teile die Sollmaße haben. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  // Saved boxes keep their row layout; new boxes are nested compactly.
  // 2: saved boxes keep their row layout; 3 (#402): the clearance was per side, now it is the total play
  migrate(p, from) { return { ...p, ...(from < 2 ? { partLayout: 'rows' } : {}), ...(from < 3 ? { clearance: 2 * Number(p.clearance ?? 0) } : {}) }; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    const { W, D, H } = boxOuter(p);
    const th = p.thickness;
    const minSide = Math.min(W, D, H);
    if (minSide <= 4 * th) out.push({ key: 'thickness', level: 'error', msg: t('Die Platten sind zu dick für diese Maße (jede Seite braucht mehr als die vierfache Materialdicke).') });
    if (p.finger < th) out.push({ key: 'finger', level: 'warn', msg: t('Zinken schmaler als die Materialdicke brechen leicht.') });
    if (Math.abs(p.clearance) >= p.finger / 2) out.push({ key: 'clearance', level: 'error', msg: t('Das Steckspiel ist zu groß für diese Zinkenbreite.') });
    if (minSide - 2 * th < p.finger) out.push({ key: 'finger', level: 'warn', msg: t('Die Zinken sind breiter als die kürzeste Kante: Dort gibt es nur eine Zinke.') });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const th = p.thickness;
    const panels = boxPanels(p);
    // Reihen (gespeicherte Boxen): oben Boden, Vorder- und Rückwand; unten Deckel, Seitenwände. Neue Boxen werden danach kompakt verschachtelt.
    const gap = 5 + p.kerf;
    const rows = [panels.filter((x) => ['bottom', 'front', 'back'].includes(x.key)), panels.filter((x) => ['top', 'left', 'right'].includes(x.key))];
    const rowW = rows.map((r) => r.reduce((s, x) => s + x.a, 0) + gap * (r.length - 1));
    const rowH = rows.map((r) => Math.max(0, ...r.map((x) => x.b)));
    const totalH = rowH[0] + gap + rowH[1];
    let parts: GenPart[] = [];
    rows.forEach((r, ri) => {
      let x = -rowW[ri] / 2;
      const y0 = -totalH / 2 + (ri ? rowH[0] + gap : 0);
      for (const panel of r) {
        const sub: SubPath = { closed: true, nodes: panelCut(panel, th, p.finger, p.clearance, p.kerf) };
        parts.push({ key: panel.key, subs: [sub], at: { x: x + panel.a / 2, y: y0 + panel.b / 2 } });
        x += panel.a + gap;
      }
    });
    parts = layoutParts(parts, gap, raw.partLayout);
    const { W, D, H } = boxOuter(p);
    const inner = { W: W - 2 * th, D: D - 2 * th, H: H - (p.top === 'closed' ? 2 : 1) * th };
    return {
      parts,
      info: [
        [t('Außenmaß'), `${fmt(W)} × ${fmt(D)} × ${fmt(H)} mm`],
        [t('Innenmaß'), `${fmt(inner.W)} × ${fmt(inner.D)} × ${fmt(inner.H)} mm`],
        [t('Felder je Kante (B / T / H)'), `${fieldCount(W - 2 * th, p.finger)} / ${fieldCount(D - 2 * th, p.finger)} / ${fieldCount(H - 2 * th, p.finger)}`],
        [t('Teile'), String(parts.length)],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const { W, D, H } = boxOuter(p);
    const box = t('Box {w}×{d}×{h}', { w: fmt(W), d: fmt(D), h: fmt(H) });
    const name = part && PART_NAMES[part];
    return name ? `${box}: ${name()}` : box;
  },
};
