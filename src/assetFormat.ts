// Bibliothek: Format der Einträge (Motive, Bilder, Designelemente). Ein Eintrag ist eine Datei .kza mit
// Objekten wie in einer Projektdatei, den Bilddaten dazu, Name, Art, Stichwörtern und einer kleinen Vorschau.
// Einträge kommen aus dem Bibliotheks-Ordner (assetLibrary.ts) oder aus Erweiterungen (packs.ts); beide werden
// hier geprüft und auf erlaubte Felder beschränkt. Getestet mit `npm run test:library`.
import { LINEAR_TYPES } from './barcode1d';
import type { LinearType } from './model';
import { DEFAULT_ADJUST, Obj, SubPath } from './model';
import { localText, t } from './i18n';
import { PatternError, PatternSpec, sanitizePatternSpec } from './patternFormat';

export const ASSET_EXT = 'kza';
export const ASSET_FORMAT = 'kizamubeam-asset';
export const ASSET_FORMAT_VERSION = 1;
/** Größte Datei (Bilder sind eingebettet) */
export const ASSET_MAX_BYTES = 20 * 1024 * 1024;
/** Höchstens so viele Objekte (samt Inhalt von Gruppen) je Eintrag */
const MAX_OBJS = 20_000;

export type AssetCategory = 'motif' | 'image' | 'element' | 'pattern';
export const ASSET_CATEGORIES: AssetCategory[] = ['motif', 'image', 'element', 'pattern'];

export function categoryLabel(c: AssetCategory): string {
  return c === 'motif' ? t('Motiv') : c === 'image' ? t('Bild') : c === 'pattern' ? t('Muster|Bibliothek') : t('Designelement');
}
export function categoryPlural(c: AssetCategory): string {
  return c === 'motif' ? t('Motive') : c === 'image' ? t('Bilder') : c === 'pattern' ? t('Muster|Mehrzahl') : t('Designelemente');
}

/** Angaben für Liste und Suche (ohne Objekte und Bilddaten) */
export interface AssetMeta {
  name: string;
  category: AssetCategory;
  tags: string[];
  /** Größe in mm */
  w: number;
  h: number;
  /** Kleine SVG-Vorschau */
  preview?: string;
  /** Wann angelegt (ISO-Zeit) */
  created?: string;
}

export interface AssetData extends AssetMeta {
  /** Objekte, deren Rahmen bei (0, 0) beginnt; IDs werden beim Einfügen neu vergeben */
  objs: Obj[];
  /** Bilddaten nach Asset-ID (data:-URL) */
  images: Record<string, string>;
  /** Layer, deren Inhalt in der Vorschau gefüllt erscheint */
  fill?: number[];
  /** Pattern for the pattern fill (category 'pattern'): tile and repeat settings */
  pattern?: PatternSpec;
}

export class AssetError extends Error {}

const num = (v: unknown) => typeof v === 'number' && isFinite(v);
const IMAGE_URL_RE = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/;
const KINDS = new Set(['rect', 'ellipse', 'polygon', 'path', 'text', 'image', 'barcode', 'gen', 'group']);

function checkSubs(v: unknown, where: string): SubPath[] {
  if (!Array.isArray(v)) throw new AssetError(t('{where}: Pfad fehlt', { where }));
  for (const s of v) {
    if (!s || !Array.isArray(s.nodes) || typeof s.closed !== 'boolean') throw new AssetError(t('{where}: ungültiger Pfad', { where }));
    for (const n of s.nodes) {
      const ok = n && num(n.x) && num(n.y) && (n.cin === undefined || (num(n.cin?.x) && num(n.cin?.y))) && (n.cout === undefined || (num(n.cout?.x) && num(n.cout?.y)));
      if (!ok) throw new AssetError(t('{where}: ungültiger Pfad', { where }));
    }
  }
  return v as SubPath[];
}

/**
 * Objekte prüfen: Matrix, Layer und Form jedes Objekts (auch in Gruppen). Formeln mit Projekt-Parametern,
 * Sichtbarkeits-Bedingungen, Ausblenden und Sperren fallen weg, weil sie zum Projekt gehören, aus dem der
 * Eintrag stammt. Bilder müssen in images liegen.
 */
export function sanitizeObjs(raw: unknown, images: Record<string, string>, where = t('Eintrag')): Obj[] {
  if (!Array.isArray(raw) || !raw.length) throw new AssetError(t('{where}: keine Objekte', { where }));
  let count = 0;
  let nextId = 1;
  const walk = (o: unknown, depth: number): Obj => {
    if (++count > MAX_OBJS) throw new AssetError(t('{where}: mehr als {n} Objekte', { where, n: MAX_OBJS }));
    if (depth > 30) throw new AssetError(t('{where}: Gruppen zu tief verschachtelt', { where }));
    const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    const m = r.m;
    if (!Array.isArray(m) || m.length !== 6 || !m.every(num)) throw new AssetError(t('{where}: ungültige Lage eines Objekts', { where }));
    const layer = r.layer;
    if (typeof layer !== 'number' || !Number.isInteger(layer) || layer < 0 || layer > 31) throw new AssetError(t('{where}: ungültiger Layer', { where }));
    const s = (r.shape && typeof r.shape === 'object' ? r.shape : {}) as Record<string, unknown>;
    const kind = String(s.kind);
    if (!KINDS.has(kind)) throw new AssetError(t('{where}: unbekannte Form „{kind}“', { where, kind }));
    const bad = () => new AssetError(t('{where}: ungültige Form „{kind}“', { where, kind }));
    switch (kind) {
      case 'rect':
        if (!num(s.w) || !num(s.h)) throw bad();
        if (!num(s.r)) s.r = 0;
        break;
      case 'ellipse':
        if (!num(s.rx) || !num(s.ry)) throw bad();
        break;
      case 'polygon':
        if (!num(s.sides) || !num(s.r) || (s.sides as number) < 3 || (s.sides as number) > 1000) throw bad();
        s.star = !!s.star;
        if (!num(s.inner)) s.inner = 0.5;
        break;
      case 'path':
        checkSubs(s.subs, where);
        break;
      case 'gen':
        if (typeof s.gen !== 'string' || !s.params || typeof s.params !== 'object') throw bad();
        checkSubs(s.subs, where);
        if (!num(s.v)) s.v = 1;
        delete s.bind;
        break;
      case 'text':
        if (typeof s.text !== 'string' || typeof s.font !== 'string' || !num(s.size) || (s.size as number) <= 0) throw bad();
        for (const k of ['bold', 'italic', 'upper']) s[k] = !!s[k];
        if (s.align !== 'left' && s.align !== 'center' && s.align !== 'right') s.align = 'left';
        if (!num(s.hSpace)) s.hSpace = 0;
        if (!num(s.vSpace)) s.vSpace = 0;
        if (s.path !== undefined) {
          const p = s.path as Record<string, unknown>;
          if (!p || typeof p !== 'object') throw bad();
          checkSubs([p.sub], where);
        }
        break;
      case 'image':
        if (typeof s.asset !== 'string' || !(s.asset in images) || !num(s.w) || !num(s.h)) throw new AssetError(t('{where}: Bilddaten fehlen', { where }));
        if (!num(s.pxW)) s.pxW = 1;
        if (!num(s.pxH)) s.pxH = 1;
        s.adjust = { ...DEFAULT_ADJUST, ...(s.adjust && typeof s.adjust === 'object' ? s.adjust : {}) };
        break;
      case 'barcode':
        if ((s.type !== 'qr' && !LINEAR_TYPES.includes(s.type as LinearType)) || typeof s.data !== 'string' || !num(s.size)) throw bad();
        if (!['L', 'M', 'Q', 'H'].includes(String(s.ec))) s.ec = 'M';
        s.invert = !!s.invert;
        if (!num(s.quiet)) s.quiet = s.type === 'qr' ? 4 : 10;
        if (s.type !== 'qr') {
          if (!num(s.height) || (s.height as number) <= 0) s.height = 15;
          s.text = !!s.text;
          s.check = !!s.check;
          if (!num(s.bwr) || (s.bwr as number) < 0) s.bwr = 0;
        }
        break;
      case 'group': {
        const ch = s.children;
        if (!Array.isArray(ch) || !ch.length) throw bad();
        s.children = ch.map((c) => walk(c, depth + 1));
        break;
      }
    }
    const out: Obj = { id: typeof r.id === 'number' && Number.isInteger(r.id) ? r.id : 1_000_000 + nextId++, m: m as Obj['m'], layer, shape: s as unknown as Obj['shape'] };
    if (typeof r.name === 'string' && r.name) out.name = r.name.slice(0, 200);
    if (Array.isArray(r.mates)) out.mates = r.mates as Obj['mates'];
    return out;
  };
  return structuredClone(raw).map((o: unknown) => walk(o, 0));
}

/** Bilddaten prüfen: nur eingebettete Bilder (data:-URL) in gängigen Formaten */
export function sanitizeImages(raw: unknown, where = t('Eintrag')): Record<string, string> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AssetError(t('{where}: ungültige Bilddaten', { where }));
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[\w-]{1,64}$/.test(id) || typeof url !== 'string' || !IMAGE_URL_RE.test(url)) throw new AssetError(t('{where}: ungültige Bilddaten', { where }));
    out[id] = url;
  }
  return out;
}

/** Stichwörter: Text mit Kommas oder Liste; klein, ohne doppelte, höchstens 30 */
export function parseTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map((x) => localText(x)) : typeof v === 'string' ? v.split(/[,;]/) : [];
  const out: string[] = [];
  for (const x of list) {
    const s = String(x).trim().replace(/\s+/g, ' ').slice(0, 40);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, 30);
}

const isCategory = (v: unknown): v is AssetCategory => typeof v === 'string' && (ASSET_CATEGORIES as string[]).includes(v);

/** Art aus dem Inhalt raten: nur Bilder = Bild, sonst Motiv */
export function guessCategory(objs: Obj[]): AssetCategory {
  const kinds = new Set<string>();
  const walk = (o: Obj) => (o.shape.kind === 'group' ? o.shape.children.forEach(walk) : kinds.add(o.shape.kind));
  objs.forEach(walk);
  return kinds.size === 1 && kinds.has('image') ? 'image' : 'motif';
}

/**
 * Eintrag lesen und prüfen (Inhalt einer .kza-Datei oder ein Eintrag „assets“ einer Erweiterung).
 * Name, Stichwörter dürfen mehrsprachig sein. Fehler lehnen den ganzen Eintrag ab.
 */
export function parseAsset(raw: unknown, where = t('Eintrag')): AssetData {
  if (typeof raw === 'string') {
    if (raw.length > ASSET_MAX_BYTES) throw new AssetError(t('Der Eintrag ist größer als {mb} MB', { mb: ASSET_MAX_BYTES / 1024 / 1024 }));
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new AssetError(t('Kein Bibliotheks-Eintrag (kein gültiges JSON)'));
    }
  }
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!r) throw new AssetError(t('Kein Bibliotheks-Eintrag'));
  if (r.format !== undefined && r.format !== ASSET_FORMAT) throw new AssetError(t('Kein Bibliotheks-Eintrag'));
  const fv = Number(r.formatVersion ?? 1);
  if (!Number.isInteger(fv) || fv < 1) throw new AssetError(t('Ungültige Formatversion'));
  if (fv > ASSET_FORMAT_VERSION) throw new AssetError(t('Der Eintrag braucht eine neuere Version von KizamuBeam'));
  const name = localText(r.name).slice(0, 80);
  if (!name) throw new AssetError(t('{where}: Name fehlt', { where }));
  const images = sanitizeImages(r.images, where);
  const objs = sanitizeObjs(r.objs, images, where);
  // Nur benutzte Bilder behalten
  const used = new Set<string>();
  const walk = (o: Obj) => (o.shape.kind === 'group' ? o.shape.children.forEach(walk) : o.shape.kind === 'image' && used.add(o.shape.asset));
  objs.forEach(walk);
  for (const id of Object.keys(images)) if (!used.has(id)) delete images[id];
  const a: AssetData = {
    name,
    category: isCategory(r.category) ? r.category : guessCategory(objs),
    tags: parseTags(r.tags),
    w: num(r.w) && (r.w as number) >= 0 ? (r.w as number) : 0,
    h: num(r.h) && (r.h as number) >= 0 ? (r.h as number) : 0,
    objs,
    images,
  };
  if (typeof r.preview === 'string' && r.preview.startsWith('<svg') && r.preview.length < 400_000) a.preview = r.preview;
  if (typeof r.created === 'string' && !isNaN(Date.parse(r.created))) a.created = r.created;
  if (r.pattern !== undefined) {
    try {
      a.pattern = sanitizePatternSpec(r.pattern, where);
    } catch (e) {
      throw new AssetError(e instanceof PatternError ? e.message : String(e));
    }
  }
  // A pattern entry needs its pattern; without one it is an ordinary motif
  if (a.category === 'pattern' && !a.pattern) a.category = 'motif';
  if (Array.isArray(r.fill)) {
    const fill = [...new Set(r.fill.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 31))];
    if (fill.length) a.fill = fill;
  }
  return a;
}

/** Inhalt der .kza-Datei */
export function assetJson(a: AssetData): string {
  const out: Record<string, unknown> = {
    format: ASSET_FORMAT, formatVersion: ASSET_FORMAT_VERSION, name: a.name, category: a.category, tags: a.tags,
    w: +a.w.toFixed(3), h: +a.h.toFixed(3),
  };
  if (a.created) out.created = a.created;
  if (a.fill?.length) out.fill = a.fill;
  if (a.preview) out.preview = a.preview;
  if (a.pattern) out.pattern = a.pattern;
  out.objs = a.objs;
  if (Object.keys(a.images).length) out.images = a.images;
  return JSON.stringify(out);
}

/** Nur die Angaben für die Liste */
export const assetMeta = (a: AssetData): AssetMeta => {
  const { objs: _o, images: _i, fill: _f, pattern: _p, ...meta } = a;
  return meta;
};

/** Dateiname aus dem Namen; existing: vorhandene Dateien, dann wird „Name (2).kza“ daraus */
export function assetFileName(name: string, existing: Iterable<string> = []): string {
  const base = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80) || t('Eintrag');
  const taken = new Set([...existing].map((f) => f.toLowerCase()));
  let file = `${base}.${ASSET_EXT}`;
  for (let i = 2; taken.has(file.toLowerCase()); i++) file = `${base} (${i}).${ASSET_EXT}`;
  return file;
}

// ---------- Suche ----------

/** Klein, ohne Akzente, ß = ss */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');

export interface SearchItem {
  meta: AssetMeta;
  /** Name der Erweiterung, aus der der Eintrag kommt */
  pack?: string;
  /** Reihenfolge bei gleichem Rang (z. B. eigene vor mitgelieferten) */
  source?: number;
}

/**
 * Einträge filtern: Jedes Wort der Suche muss im Namen, in einem Stichwort, in der Art oder im Namen der
 * Erweiterung vorkommen. Treffer am Namensanfang zuerst, dann nach Herkunft (source) und Name.
 */
export function searchAssets<T extends SearchItem>(items: T[], query: string, category: AssetCategory | '' = ''): T[] {
  const words = fold(query).split(/[\s,]+/).filter(Boolean);
  const q = fold(query.trim());
  const hits = items.filter((it) => {
    if (category && it.meta.category !== category) return false;
    if (!words.length) return true;
    const hay = fold([it.meta.name, ...it.meta.tags, categoryLabel(it.meta.category), categoryPlural(it.meta.category), it.pack ?? ''].join('\n'));
    return words.every((w) => hay.includes(w));
  });
  const rank = (it: T) => (q && fold(it.meta.name).startsWith(q) ? 0 : q && it.meta.tags.some((tg) => fold(tg) === q) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b) || (a.source ?? 0) - (b.source ?? 0) || a.meta.name.localeCompare(b.meta.name));
}
