// Experimenteller separater Generator; die vorhandene Box bleibt unverändert.
import { t } from '../i18n';
import type { GenPart, Generator, Issue, Params } from './types';
import { fingerboxParts, fingerboxSegments, horizontalSegments, type FingerboxParams } from './fingerbox-experiment';
import { defaultDistribution, distributeGaps } from './fingerbox-distribution';
import { makeDividers, type DividerParams } from './fingerbox-dividers';
import { panelPolys, offsetOrtho } from './box';

type FingerParams = FingerboxParams & { slotClearance: number; compartmentsX: number; compartmentsY: number; ratiosX: string; ratiosY: string; dividerDrop: number; kerf: number; clearance: number };
// clearance/kerf kommen aus dem Dialog; slotClearance folgt dem Steckspiel (Standard der Trennwand-Geometrie).
const values = (p: Params) => ({ ...p, clearance: Number(p.clearance ?? 0), kerf: Number(p.kerf ?? 0) }) as unknown as FingerParams;
const names: Record<string, () => string> = {
  bottom: () => t('Boden'), top: () => t('Deckel'), front: () => t('Vorderwand'), back: () => t('Rückwand'),
  left: () => t('Seitenwand links'), right: () => t('Seitenwand rechts'),
};
const issues: Record<string, () => string> = {
  'Ungültiges Steckspiel.': () => t('Ungültiges Steckspiel.'),
  'Das Steckspiel ist für einen Zinkenabschnitt zu groß.': () => t('Das Steckspiel ist für einen Zinkenabschnitt zu groß.'),
  'Steckspiel führt zu überlappenden Schlitzen und Zinken.': () => t('Steckspiel führt zu überlappenden Schlitzen und Zinken.'),
  'Ungültige Kontur für die Schnittfuge.': () => t('Ungültige Kontur für die Schnittfuge.'),
  'Schnittfuge ist für eine Kontur oder einen Schlitz zu groß.': () => t('Schnittfuge ist für eine Kontur oder einen Schlitz zu groß.'),
  'Schnittfuge erzeugt eine ungültige oder geteilte Kontur.': () => t('Schnittfuge erzeugt eine ungültige oder geteilte Kontur.'),
  'Zu viele Konturen für die sichere Prüfung.': () => t('Zu viele Konturen für die sichere Prüfung.'),
  'Ein Schlitz liegt auf oder außerhalb der Außenkontur.': () => t('Ein Schlitz liegt auf oder außerhalb der Außenkontur.'),
  'Schlitze überlappen oder berühren sich.': () => t('Schlitze überlappen oder berühren sich.'),
  'Fachzahl muss zwischen 1 und 100 liegen.': () => t('Fachzahl muss zwischen 1 und 100 liegen.'),
  'Ungültige Maße.': () => t('Ungültige Maße.'),
  'Eingabe ist zu lang.': () => t('Eingabe ist zu lang.'),
  'Kein freier Platz für die Fächer.': () => t('Kein freier Platz für die Fächer.'),
  'Die Anzahl der Werte muss der Fachzahl entsprechen.': () => t('Die Anzahl der Werte muss der Fachzahl entsprechen.'),
  'Ungültiger Ausdruck.': () => t('Ungültiger Ausdruck.'),
  'Klammer nicht geschlossen.': () => t('Klammer nicht geschlossen.'),
  'Division durch null.': () => t('Division durch null.'),
  'Ungültige Einheitenkombination.': () => t('Ungültige Einheitenkombination.'),
  'Jeder Wert muss größer als null sein.': () => t('Jeder Wert muss größer als null sein.'),
  'Werte sind zu groß.': () => t('Werte sind zu groß.'),
  'Die festen Millimetermaße lassen keinen Platz für die übrigen Fächer.': () => t('Die festen Millimetermaße lassen keinen Platz für die übrigen Fächer.'),
  'Die festen Millimetermaße müssen zusammen genau dem freien Platz entsprechen.': () => t('Die festen Millimetermaße müssen zusammen genau dem freien Platz entsprechen.'),
  'Alle Fächer müssen einen positiven freien Abstand haben.': () => t('Alle Fächer müssen einen positiven freien Abstand haben.'),
  'Ungültige Trennwandhöhe oder Maße.': () => t('Ungültige Trennwandhöhe oder Maße.'),
  'Trennwände reichen in den Deckel.': () => t('Trennwände reichen in den Deckel.'),
  'Zinkenabschnitte der Trennwand sind zu kurz für die Materialdicke.': () => t('Zinkenabschnitte der Trennwand sind zu kurz für die Materialdicke.'),
  'Trennwände überlappen oder liegen außerhalb des Innenraums.': () => t('Trennwände überlappen oder liegen außerhalb des Innenraums.'),
  'Schmales Fach ohne Bodenzinken.': () => t('Schmales Fach ohne Bodenzinken.'),
  'Zu viele Zinken für diese Kante.': () => t('Zu viele Zinken für diese Kante.'),
};
const message = (e: unknown) => { const s = e instanceof Error ? e.message : String(e); return issues[s]?.() ?? s; };
const dividerParams = (p: FingerParams): DividerParams => ({ ...p, dividerHeight: p.height - p.dividerDrop });
const hasDividers = (p: FingerParams) => p.compartmentsX > 1 || p.compartmentsY > 1;
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

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
  return parts;
}

export const FINGERBOX: Generator = {
  id: 'box-divided', version: 2, kind: 'assembly', icon: 'box',
  name: t('Box mit Fingerzinken und Trennwänden'),
  schema: [
    { key: 'jointLayout', type: 'data', label: '', def: 'current' },
    { key: 'width', type: 'length', label: t('Breite'), min: 5, max: 3000, def: 100 },
    { key: 'depth', type: 'length', label: t('Tiefe'), min: 5, max: 3000, def: 80 },
    { key: 'height', type: 'length', label: t('Höhe'), min: 5, max: 3000, def: 50 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 3 },
    { key: 'top', type: 'enum', label: t('Oben'), def: 'open', options: [['open', t('Offen')], ['closed', t('Geschlossen (Deckel mit Zinken)')]] },
    { key: 'compartmentsX', type: 'int', label: t('Fächer in Breitenrichtung'), min: 1, max: 20, def: 1 },
    { key: 'ratiosX', type: 'text', label: t('Verteilung in Breitenrichtung'), def: '', autoText: (p) => defaultDistribution(Number(p.compartmentsX)), title: t('Freie Fachbreiten als Verhältnis oder mm, getrennt mit Doppelpunkt, z. B. 50mm:1:2. Rechenzeichen + - * / und Klammern sind möglich.') },
    { key: 'compartmentsY', type: 'int', label: t('Fächer in Tiefenrichtung'), min: 1, max: 20, def: 1 },
    { key: 'ratiosY', type: 'text', label: t('Verteilung in Tiefenrichtung'), def: '', autoText: (p) => defaultDistribution(Number(p.compartmentsY)), title: t('Freie Fachbreiten als Verhältnis oder mm, getrennt mit Doppelpunkt, z. B. 50mm:1:2. Rechenzeichen + - * / und Klammern sind möglich.') },
    { key: 'dividerDrop', type: 'length', label: t('Trennwände niedriger als Box'), min: 0, max: 3000, def: 10, showIf: (p) => Number(p.compartmentsX) > 1 || Number(p.compartmentsY) > 1 },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit die Teile die Sollmaße haben. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    { key: 'finger', type: 'length', label: t('Zinkenbreite'), min: 0.5, max: 500, def: 10, advanced: true },
    { key: 'clearance', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0, advanced: true, title: t('Jede Zinke wird um so viel schmaler; negativ = Presspassung') },
  ],
  validate(raw) {
    const p = values(raw), out: Issue[] = [];
    out.push({ level: 'warn', msg: t('Experimenteller Generator: Noch nicht für den Laserschnitt verwenden.') });
    if (p.jointLayout === 'legacy' && p.top !== 'closed' && p.height > p.depth + 10) out.push({ level: 'warn', msg: t('Bei dieser Höhe können sich Teile in der 2D-Anordnung überlappen; Lage prüfen.') });
    if (Math.min(p.width, p.depth, p.height) <= 2 * p.thickness) {
      out.push({ key: 'thickness', level: 'error', msg: t('Alle Außenmaße müssen größer als die doppelte Materialdicke sein.') });
      return out;
    }
    if (Math.abs(p.clearance) >= p.finger / 4) out.push({ key: 'clearance', level: 'error', msg: t('Das Steckspiel ist zu groß für diese Zinkenbreite.') });
    const legacy = p.jointLayout === 'legacy';
    const lengths = [p.width - 2 * p.thickness, p.depth - 2 * p.thickness, legacy ? p.height : p.height - p.thickness * (p.top === 'closed' ? 2 : 1)];
    try {
      const widths = lengths.map((length, i) => length / (legacy || i === 2 ? fingerboxSegments(length, p.finger) : horizontalSegments(length, p.finger)));
      if (Math.min(...widths) <= p.thickness) out.push({ key: 'finger', level: 'warn', msg: t('Ein Zinkenabschnitt ist höchstens so breit wie die Materialdicke; die Geometrie kann ungeeignet sein.') });
    } catch { out.push({ key: 'finger', level: 'error', msg: t('Zu viele Zinken für diese Kante.') }); }
    for (const [key, length, count, spec] of [['ratiosX',p.width,p.compartmentsX,p.ratiosX],['ratiosY',p.depth,p.compartmentsY,p.ratiosY]] as const) {
      try { distributeGaps(length,p.thickness,count,spec); }
      catch (e) { out.push({ key, level: 'error', msg: message(e) }); }
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
      try { for (const warning of new Set(makeDividers(dividerParams(p)).warnings)) out.push({ level: 'warn', msg: message(warning) }); }
      catch (e) { out.push({ level: 'error', msg: message(e) }); }
    }
    return out;
  },
  migrate(p, from) { return from < 2 ? { ...p, jointLayout: 'legacy' } : p; },
  generate(raw) {
    const p = values(raw), parts = adjustedParts(p);
    const gx = distributeGaps(p.width,p.thickness,p.compartmentsX,p.ratiosX).gaps;
    const gy = distributeGaps(p.depth,p.thickness,p.compartmentsY,p.ratiosY).gaps;
    return { parts, info: [[t('Außenmaß'), `${p.width} × ${p.depth} × ${p.height} mm`],
      [t('Freie Fachbreiten'), `${gx.map(fmt).join(' : ')} mm`], [t('Freie Fachtiefen'), `${gy.map(fmt).join(' : ')} mm`], [t('Teile'), String(parts.length)]] };
  },
  label(raw, part) {
    const p = values(raw), label = t('Box mit Trennwänden {w}×{d}×{h}', { w: p.width, d: p.depth, h: p.height });
    if (part && names[part]) return `${label}: ${names[part]()}`;
    const match = /^(divx|divy)-(\d+)$/.exec(part ?? '');
    return match ? `${label}: ${match[1] === 'divx' ? t('Trennwand Breite {n}', { n: match[2] }) : t('Trennwand Tiefe {n}', { n: match[2] })}` : label;
  },
};