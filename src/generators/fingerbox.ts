// Experimenteller separater Generator; die vorhandene Box bleibt unverändert.
import { t, locale } from '../i18n';
import type { GenPart, Generator, Issue, Params } from './types';
import { fingerboxParts, fingerboxSegments, horizontalSegments, type FingerboxParams } from './fingerbox-experiment';
import { defaultDistribution, distributeGaps } from './fingerbox-distribution';
import { resizeDistribution } from './fingerbox-resize';
import { makeDividers, type DividerParams } from './fingerbox-dividers';
import { panelPolys, offsetOrtho, TURNED_OVER } from './box';
import { layoutParts, mirrorX } from './build';
import { boxPoses } from './box';
import { neg, pose, X, Y, Z, type AsmPoses } from './pose';

type FingerParams = FingerboxParams & { partLayout: string; faces: string; slotClearance: number; dividerClearance?: number; compartmentsX: number; compartmentsY: number; ratiosX: string; ratiosY: string; dividerDrop: number; kerf: number; clearance: number };
// clearance/kerf kommen aus dem Dialog; slotClearance folgt dem Steckspiel (Standard der Trennwand-Geometrie).
// dividerClearance: hidden, only in boxes saved before #402 (the old play of the dividers, see migrate); '' = clearance.
// faces: hidden, 'legacy' in boxes saved before #463 (back, left and lid lie inner face up, see boxPoses).
const values = (p: Params) => {
  const d = String(p.dividerClearance ?? '');
  return { ...p, clearance: Number(p.clearance ?? 0), kerf: Number(p.kerf ?? 0), dividerClearance: d === '' ? undefined : Number(d) } as unknown as FingerParams;
};
const names: Record<string, () => string> = {
  bottom: () => t('Boden'), top: () => t('Deckel'), front: () => t('Vorderwand'), back: () => t('Rückwand'),
  left: () => t('Seitenwand links'), right: () => t('Seitenwand rechts'),
};
/** Issue codes thrown by the box internals (fingerbox-*.ts) and their texts; the internals stay free of UI text */
const issues: Record<string, () => string> = {
  'clearance-invalid': () => t('Ungültiges Steckspiel.'),
  'clearance-too-large': () => t('Das Steckspiel ist für einen Zinkenabschnitt zu groß.'),
  'clearance-overlap': () => t('Steckspiel führt zu überlappenden Schlitzen und Zinken.'),
  'kerf-contour-invalid': () => t('Ungültige Kontur für die Schnittfuge.'),
  'kerf-too-large': () => t('Schnittfuge ist für eine Kontur oder einen Schlitz zu groß.'),
  'kerf-splits-contour': () => t('Schnittfuge erzeugt eine ungültige oder geteilte Kontur.'),
  'too-many-contours': () => t('Zu viele Konturen für die sichere Prüfung.'),
  'slot-outside': () => t('Ein Schlitz liegt auf oder außerhalb der Außenkontur.'),
  'slots-overlap': () => t('Schlitze überlappen oder berühren sich.'),
  'compartments-range': () => t('Fachzahl muss zwischen 1 und 100 liegen.'),
  'size-invalid': () => t('Ungültige Maße.'),
  'input-too-long': () => t('Eingabe ist zu lang.'),
  'no-space': () => t('Kein freier Platz für die Fächer.'),
  'ratio-count': () => t('Die Anzahl der Werte muss der Fachzahl entsprechen.'),
  'expr-invalid': () => t('Ungültiger Ausdruck.'),
  'expr-bracket': () => t('Klammer nicht geschlossen.'),
  'expr-div-zero': () => t('Division durch null.'),
  'expr-units': () => t('Ungültige Einheitenkombination.'),
  'ratio-not-positive': () => t('Jeder Wert muss größer als null sein.'),
  'ratio-too-large': () => t('Werte sind zu groß.'),
  'fixed-no-space': () => t('Die festen Millimetermaße lassen keinen Platz für die übrigen Fächer.'),
  'fixed-mismatch': () => t('Die festen Millimetermaße müssen zusammen genau dem freien Platz entsprechen.'),
  'gap-not-positive': () => t('Alle Fächer müssen einen positiven freien Abstand haben.'),
  'divider-height-invalid': () => t('Ungültige Trennwandhöhe oder Maße.'),
  'divider-into-lid': () => t('Trennwände reichen in den Deckel.'),
  'divider-fingers-short': () => t('Zinkenabschnitte der Trennwand sind zu kurz für die Materialdicke.'),
  'dividers-overlap': () => t('Trennwände überlappen oder liegen außerhalb des Innenraums.'),
  'narrow-no-bottom-fingers': () => t('Schmales Fach ohne Bodenzinken.'),
  'too-many-fingers': () => t('Zu viele Zinken für diese Kante.'),
  'finger-length-invalid': () => 'Länge und Zinkenbreite müssen positiv sein.',
  'outer-size-invalid': () => 'Ungültige Maße: positive Werte und jede Außenabmessung größer als die doppelte Materialdicke erforderlich.',
};
const message = (e: unknown) => { const s = e instanceof Error ? e.message : String(e); return issues[s]?.() ?? s; };
/** Issue with its code (Issue.code) and the translated text */
const issueOf = (e: unknown, level: Issue['level'], key?: string): Issue => {
  const code = e instanceof Error ? e.message : String(e);
  return { ...(key ? { key } : {}), level, msg: message(e), ...(issues[code] ? { code } : {}) };
};
const dividerParams = (p: FingerParams): DividerParams => ({ ...p, dividerHeight: p.height - p.dividerDrop });
const hasDividers = (p: FingerParams) => p.compartmentsX > 1 || p.compartmentsY > 1;
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(locale, { maximumFractionDigits: 3 });

// offsetOrtho rechnet nur mit 90°-Ecken: ein Zwischenpunkt auf einer Geraden würde doppelt versetzt (schiefe Kante).
function dropCollinear<T extends { x: number; y: number }>(pts: T[]): T[] {
  const eps = 1e-9;
  let cur = pts.filter((q, i) => { const n = pts[(i + 1) % pts.length]; return Math.hypot(q.x - n.x, q.y - n.y) > eps; });
  for (let again = true; again;) {
    again = false;
    const next = cur.filter((q, i) => {
      const a = cur[(i + cur.length - 1) % cur.length], c = cur[(i + 1) % cur.length];
      const keep = Math.abs((q.x - a.x) * (c.y - q.y) - (q.y - a.y) * (c.x - q.x)) > eps;
      if (!keep) again = true;
      return keep;
    });
    if (again && next.length >= 3) cur = next; else if (again) break;
  }
  return cur;
}

function adjustedParts(p: FingerParams): GenPart[] {
  const parts = fingerboxParts(p);
  if (p.jointLayout !== 'legacy') {
    // Use the original Box geometry for base and lid, while walls retain our vertical pattern.
    const plates = panelPolys({ sizeMode: 'outer', width: p.width, depth: p.depth, height: p.height,
      thickness: p.thickness, finger: p.finger, top: p.top === 'closed' ? 'closed' : 'open',
      clearance: p.clearance, kerf: 0 });
    for (const part of parts) if (part.key === 'bottom' || part.key === 'top') {
      const plate = plates.find((candidate) => candidate.key === part.key);
      if (!plate) throw new Error(`Missing Box plate: ${part.key}`);
      part.subs[0] = { closed: true, nodes: plate.pts };
    }
  }
  if (hasDividers(p)) {
    const extra = makeDividers(dividerParams(p));
    for (const part of parts) if (part.key in extra.holes) part.subs.push(...extra.holes[part.key as keyof typeof extra.holes]);
    let cursor = Infinity, bottom = -Infinity;
    for (const part of parts) for (const sub of part.subs) for (const q of sub.nodes) {
      cursor = Math.min(cursor, q.x + part.at.x);
      bottom = Math.max(bottom, q.y + part.at.y);
    }
    const y = bottom + 10 + (p.height-p.dividerDrop)/2;
    for (const divider of extra.dividers) {
      const a = divider.key.startsWith('divx-') ? p.depth : p.width;
      parts.push({ key: divider.key, subs: [divider.outline], at: { x: cursor+a/2, y } });
      cursor += a+10;
    }
  }
  // Kerf: Außenkontur um kerf/2 nach außen, Ausschnitte (Schlitze) um kerf/2 nach innen versetzen.
  if (p.kerf) for (const part of parts) part.subs = part.subs.map((sub, i) => ({ ...sub, nodes: offsetOrtho(dropCollinear(sub.nodes), i === 0 ? p.kerf / 2 : -p.kerf / 2) }));
  // Outer face up (#463): these parts are seen from outside, mirrored like their poses
  if (p.faces !== 'legacy') for (const part of parts) if (TURNED_OVER.includes(part.key)) part.subs = part.subs.map(mirrorX);
  // Saved boxes keep their row layout ('rows', set by migrate); new boxes are nested compactly.
  return layoutParts(parts, 5 + p.kerf, p.partLayout);
}

/** Fingerbox: reuse Box axes and place each divider at its calculated compartment centre. */
export function fingerboxPoses(raw: Params): AsmPoses | null {
  try {
    const p = raw as Params & { width: number; depth: number; height: number; thickness: number; compartmentsX: number; compartmentsY: number; ratiosX: string; ratiosY: string; dividerDrop: number };
    const shell = boxPoses({ sizeMode: 'outer', width: p.width, depth: p.depth, height: p.height,
      thickness: p.thickness, top: p.top === 'closed' ? 'closed' : 'open', finger: Number(p.finger),
      clearance: 0, kerf: 0 }, p.faces === 'legacy');
    const xs = distributeGaps(p.width, p.thickness, p.compartmentsX, p.ratiosX).centres;
    const ys = distributeGaps(p.depth, p.thickness, p.compartmentsY, p.ratiosY).centres;
    const hd = p.height - p.dividerDrop;
    xs.forEach((x, i) => { shell[`divx-${i + 1}`] = pose([x - p.thickness / 2, p.depth / 2, hd / 2], Y, neg(Z), X); });
    ys.forEach((y, i) => { shell[`divy-${i + 1}`] = pose([p.width / 2, y - p.thickness / 2, hd / 2], X, neg(Z), Y); });
    return { poses: shell };
  } catch {
    return null;
  }
}

export const FINGERBOX: Generator = {
  id: 'box-divided', version: 5, kind: 'assembly', icon: 'box',
  preview: { center: true },
  onChange(key, old, p) {
    // Changing the compartment count keeps the user's ratios: cut or extended with 1, asking before values are dropped
    const ratioKey = key === 'compartmentsX' ? 'ratiosX' : key === 'compartmentsY' ? 'ratiosY' : '';
    const count = Number(p[key]);
    if (!ratioKey || !Number.isInteger(count) || count < 1 || count > 20 || count === Number(old)) return;
    const resized = resizeDistribution(String(p[ratioKey] ?? ''), Number(old), count);
    if (!resized) return;
    const patch = { [ratioKey]: resized.text };
    if (!resized.removed.length) return { patch };
    return { ask: { question: t('Diese Fachwerte werden entfernt: {values}. Fortfahren?', { values: resized.removed.join(' : ') }), options: [{ label: t('OK'), patch }] } };
  },
  view: (p) => ({ autoText: { ratiosX: defaultDistribution(Number(p.compartmentsX)), ratiosY: defaultDistribution(Number(p.compartmentsY)) } }),
  texts: issues,
  poses: (p) => fingerboxPoses(p),
  tile: {
    group: 'box',
    before: 'lidhinge',
    text: (t) => ({
      name: t('Box mit Fingerzinken und Trennwänden'),
      desc: t('Box mit parametrischen Trennwänden.'),
      keys: t('Box Fächer Trennwände Fingerzinken|Suchwörter'),
      action: t('Box mit Fingerzinken und Trennwänden'),
    }),
  },
  name: t('Box mit Fingerzinken und Trennwänden'),
  schema: [
    { key: 'jointLayout', type: 'data', label: '', def: 'current', resetOnNew: true },
    { key: 'partLayout', type: 'data', label: '', def: 'nest', resetOnNew: true },
    { key: 'dividerClearance', type: 'data', label: '', def: '', resetOnNew: true },
    { key: 'faces', type: 'data', label: '', def: 'out', resetOnNew: true },
    { key: 'width', type: 'length', label: t('Breite'), min: 5, max: 3000, def: 100 },
    { key: 'depth', type: 'length', label: t('Tiefe'), min: 5, max: 3000, def: 80 },
    { key: 'height', type: 'length', label: t('Höhe'), min: 5, max: 3000, def: 50 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 3 },
    { key: 'top', type: 'enum', label: t('Oben'), def: 'open', options: [['open', t('Offen')], ['closed', t('Geschlossen (Deckel mit Zinken)')]] },
    { key: 'compartmentsX', type: 'int', label: t('Fächer in Breitenrichtung'), min: 1, max: 20, def: 1 },
    { key: 'ratiosX', type: 'text', label: t('Verteilung in Breitenrichtung'), def: '', title: t('Freie Fachbreiten als Verhältnis oder mm, getrennt mit Doppelpunkt, z. B. 50mm:1:2. Rechenzeichen + - * / und Klammern sind möglich.') },
    { key: 'compartmentsY', type: 'int', label: t('Fächer in Tiefenrichtung'), min: 1, max: 20, def: 1 },
    { key: 'ratiosY', type: 'text', label: t('Verteilung in Tiefenrichtung'), def: '', title: t('Freie Fachbreiten als Verhältnis oder mm, getrennt mit Doppelpunkt, z. B. 50mm:1:2. Rechenzeichen + - * / und Klammern sind möglich.') },
    { key: 'dividerDrop', type: 'length', label: t('Trennwände niedriger als Box'), min: 0, max: 3000, def: 10, showIf: { or: [{ gt: ['compartmentsX', 1] }, { gt: ['compartmentsY', 1] }] } },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit die Teile die Sollmaße haben. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    { key: 'finger', type: 'length', label: t('Zinkenbreite'), min: 0.5, max: 500, def: 10, advanced: true },
    { key: 'clearance', type: 'length', label: t('Steckspiel gesamt'), min: -2, max: 4, def: 0, playTotal: true, advanced: true, title: t('Gesamtspiel der Zinken: Lücke minus Zinke, auf beide Seiten verteilt; negativ = Presspassung') },
  ],
  validate(raw) {
    const p = values(raw), out: Issue[] = [];
    if (p.jointLayout === 'legacy' && p.top !== 'closed' && p.height > p.depth + 10) out.push({ level: 'warn', msg: t('Bei dieser Höhe können sich Teile in der 2D-Anordnung überlappen; Lage prüfen.') });
    if (Math.min(p.width, p.depth, p.height) <= 2 * p.thickness) {
      out.push({ key: 'thickness', level: 'error', msg: t('Alle Außenmaße müssen größer als die doppelte Materialdicke sein.') });
      return out;
    }
    if (Math.abs(p.clearance) >= p.finger / 2) out.push({ key: 'clearance', level: 'error', msg: t('Das Steckspiel ist zu groß für diese Zinkenbreite.') });
    const legacy = p.jointLayout === 'legacy';
    const lengths = [p.width - 2 * p.thickness, p.depth - 2 * p.thickness, legacy ? p.height : p.height - p.thickness * (p.top === 'closed' ? 2 : 1)];
    try {
      const widths = lengths.map((length, i) => length / (legacy || i === 2 ? fingerboxSegments(length, p.finger) : horizontalSegments(length, p.finger)));
      if (Math.min(...widths) <= p.thickness) out.push({ key: 'finger', level: 'warn', msg: t('Ein Zinkenabschnitt ist höchstens so breit wie die Materialdicke; die Geometrie kann ungeeignet sein.') });
    } catch { out.push({ key: 'finger', level: 'error', msg: t('Zu viele Zinken für diese Kante.') }); }
    for (const [key, length, count, spec] of [['ratiosX',p.width,p.compartmentsX,p.ratiosX],['ratiosY',p.depth,p.compartmentsY,p.ratiosY]] as const) {
      try { distributeGaps(length,p.thickness,count,spec); }
      catch (e) { out.push(issueOf(e, 'error', key)); }
    }
    if (out.some((i) => i.level === 'error')) return out;
    if (hasDividers(p)) {
      const estimate = (p.compartmentsX-1)*(Math.ceil(p.depth/p.finger)+3*p.compartmentsY+Math.ceil(p.height/p.finger))
        + (p.compartmentsY-1)*(Math.ceil(p.width/p.finger)+3*p.compartmentsX+Math.ceil(p.height/p.finger));
      if (estimate > 20000) {
        out.push({ level: 'error', msg: t('Zu viele Zinken und Schlitze für diese Vorschau. Weniger Fächer oder größere Zinken wählen.') });
        return out;
      }
    }
    if (hasDividers(p)) {
      try { for (const warning of new Set(makeDividers(dividerParams(p)).warnings)) out.push(issueOf(warning, 'warn')); }
      catch (e) { out.push(issueOf(e, 'error')); }
    }
    return out;
  },
  // 4 (#402): the clearance was per side at the corners (total 2c) and whole at the dividers (c); now it is the total
  // play: doubled, and the dividers keep theirs in dividerClearance. 5 (#463): saved boxes keep back, left and lid inner face up
  migrate(p, from) {
    const c = Number(p.clearance ?? 0);
    return { ...p, ...(from < 2 ? { jointLayout: 'legacy' } : {}), ...(from < 3 ? { partLayout: 'rows' } : {}), ...(from < 4 ? { clearance: 2 * c, dividerClearance: String(c) } : {}), ...(from < 5 ? { faces: 'legacy' } : {}) };
  },
  generate(raw) {
    const p = values(raw), parts = adjustedParts(p);
    const gx = distributeGaps(p.width,p.thickness,p.compartmentsX,p.ratiosX).gaps;
    const gy = distributeGaps(p.depth,p.thickness,p.compartmentsY,p.ratiosY).gaps;
    return { parts, info: [[t('Außenmaß'), `${fmt(p.width)} × ${fmt(p.depth)} × ${fmt(p.height)} mm`],
      [t('Freie Fachbreiten'), `${gx.map(fmt).join(' : ')} mm`], [t('Freie Fachtiefen'), `${gy.map(fmt).join(' : ')} mm`], [t('Teile'), String(parts.length)]] };
  },
  label(raw, part) {
    const p = values(raw), label = t('Box mit Trennwänden {w}×{d}×{h}', { w: p.width, d: p.depth, h: p.height });
    if (part && names[part]) return `${label}: ${names[part]()}`;
    const match = /^(divx|divy)-(\d+)$/.exec(part ?? '');
    return match ? `${label}: ${match[1] === 'divx' ? t('Trennwand Breite {n}', { n: match[2] }) : t('Trennwand Tiefe {n}', { n: match[2] })}` : label;
  },
};