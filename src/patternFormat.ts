// Pattern fill: data format of a pattern (tile + repeat settings) and the stored recipe of a pattern object.
// Kept free of geometry libraries so the library format (assetFormat.ts) and extension packs can check
// patterns without loading Clipper. The geometry lives in pattern.ts.
import type { SubPath } from './model';
import { t } from './i18n';

export type PatternRepeat = 'grid' | 'brick' | 'halfdrop' | 'mirror' | 'rotate' | 'hex';
export type PatternMirror = 'xy' | 'x' | 'y';
export type PatternEdge = 'clip' | 'whole' | 'touch';
export type PatternOutput = 'lines' | 'areas';

export const PATTERN_REPEATS: PatternRepeat[] = ['grid', 'brick', 'halfdrop', 'mirror', 'rotate', 'hex'];
export const PATTERN_MIRRORS: PatternMirror[] = ['xy', 'x', 'y'];
export const PATTERN_EDGES: PatternEdge[] = ['clip', 'whole', 'touch'];
export const PATTERN_OUTPUTS: PatternOutput[] = ['lines', 'areas'];

export const repeatLabel = (r: PatternRepeat): string =>
  ({
    grid: t('Raster|Muster'),
    brick: t('Ziegel (Zeilen versetzt)'),
    halfdrop: t('Halber Versatz (Spalten versetzt)'),
    mirror: t('Gespiegelt'),
    rotate: t('Um 90° gedreht (Windrad)'),
    hex: t('Sechseckig'),
  })[r];

export const mirrorLabel = (m: PatternMirror): string => ({ xy: t('Waagerecht und senkrecht'), x: t('Nur waagerecht'), y: t('Nur senkrecht') })[m];

export const edgeLabel = (e: PatternEdge): string =>
  ({ clip: t('Am Rand abschneiden'), whole: t('Nur ganze Kacheln'), touch: t('Berührende Kacheln behalten') })[e];

export const outputLabel = (o: PatternOutput): string => ({ lines: t('Linien (Gravieren, Ritzen, Schneiden)'), areas: t('Flächen (Füll-Layer)') })[o];

/**
 * The repeating unit. subs are in tile coordinates with the frame centred on the origin: the frame spans
 * -w/2 … w/2 and -h/2 … h/2 (mm). Parts of the motif may reach beyond the frame; they then continue into the
 * neighbouring tiles (“wrap edges”) or are cut at the frame.
 */
export interface PatternTile {
  w: number;
  h: number;
  subs: SubPath[];
}

/** Repeat settings that belong to a pattern (saved with it in the library) */
export interface PatternSettings {
  repeat: PatternRepeat;
  /** Offset of every second row (brick) or column (half drop) as a fraction of the tile */
  shift: number;
  mirror: PatternMirror;
  /** Extra space between tiles (mm, negative = overlap) */
  gapX: number;
  gapY: number;
  /** Size factor of the whole pattern */
  scale: number;
  /** Rotation of the whole pattern in degrees */
  angle: number;
  /** Motif parts beyond the frame continue in the neighbouring tile (otherwise they are cut at the frame) */
  wrap: boolean;
  output: PatternOutput;
}

export const DEFAULT_PATTERN_SETTINGS: PatternSettings = {
  repeat: 'grid', shift: 0.5, mirror: 'xy', gapX: 0, gapY: 0, scale: 1, angle: 0, wrap: true, output: 'lines',
};

/** A named pattern: tile and its settings (library entry, bundled pattern, pattern from an extension) */
export interface PatternSpec {
  tile: PatternTile;
  settings: PatternSettings;
}

/** Stored in a pattern object (generator parameter `recipe`), in the object's local coordinates (mm) */
export interface PatternRecipe {
  v: 1;
  tile: PatternTile;
  /** Outline of the area to fill (closed paths, even-odd) */
  target: SubPath[];
  /** Areas kept free (closed paths, e.g. around a text) */
  holes: SubPath[];
  /** Name of the library pattern the tile came from (only shown) */
  name?: string;
}

export class PatternError extends Error {}

/** Most path nodes in a tile or recipe, so a broken file cannot stall the app */
const MAX_NODES = 200_000;
const num = (v: unknown) => typeof v === 'number' && isFinite(v);
const pt = (v: unknown) => !!v && typeof v === 'object' && num((v as { x: unknown }).x) && num((v as { y: unknown }).y) && Math.abs((v as { x: number }).x) < 1e6 && Math.abs((v as { y: number }).y) < 1e6;

/** Check paths and copy only the known fields */
export function sanitizeSubs(raw: unknown, where: string, count = { n: 0 }): SubPath[] {
  if (!Array.isArray(raw)) throw new PatternError(t('{where}: Pfade fehlen', { where }));
  return raw.map((s) => {
    const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    if (typeof r.closed !== 'boolean' || !Array.isArray(r.nodes)) throw new PatternError(t('{where}: ungültiger Pfad', { where }));
    const nodes = r.nodes.map((n) => {
      if (++count.n > MAX_NODES) throw new PatternError(t('{where}: zu viele Knoten', { where }));
      const q = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
      if (!pt(q) || (q.cin !== undefined && !pt(q.cin)) || (q.cout !== undefined && !pt(q.cout))) throw new PatternError(t('{where}: ungültiger Pfad', { where }));
      const out: SubPath['nodes'][number] = { x: q.x as number, y: q.y as number };
      if (q.cin) out.cin = { x: (q.cin as { x: number }).x, y: (q.cin as { y: number }).y };
      if (q.cout) out.cout = { x: (q.cout as { x: number }).x, y: (q.cout as { y: number }).y };
      if (q.smooth === true) out.smooth = true;
      return out;
    });
    return { closed: r.closed, nodes };
  });
}

const clampNum = (v: unknown, min: number, max: number, def: number) => (num(v) ? Math.min(max, Math.max(min, v as number)) : def);
const pick = <T extends string>(v: unknown, list: T[], def: T): T => (list.includes(v as T) ? (v as T) : def);

export function sanitizeSettings(raw: unknown): PatternSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PATTERN_SETTINGS;
  return {
    repeat: pick(r.repeat, PATTERN_REPEATS, d.repeat),
    shift: clampNum(r.shift, 0, 1, d.shift),
    mirror: pick(r.mirror, PATTERN_MIRRORS, d.mirror),
    gapX: clampNum(r.gapX, -500, 500, d.gapX),
    gapY: clampNum(r.gapY, -500, 500, d.gapY),
    scale: clampNum(r.scale, 0.05, 20, d.scale),
    angle: clampNum(r.angle, -360, 360, d.angle),
    wrap: typeof r.wrap === 'boolean' ? r.wrap : d.wrap,
    output: pick(r.output, PATTERN_OUTPUTS, d.output),
  };
}

export function sanitizeTile(raw: unknown, where: string, count = { n: 0 }): PatternTile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!num(r.w) || !num(r.h) || (r.w as number) < 0.05 || (r.h as number) < 0.05 || (r.w as number) > 5000 || (r.h as number) > 5000)
    throw new PatternError(t('{where}: Kachelgröße fehlt oder liegt nicht zwischen 0,05 und 5000 mm', { where }));
  const subs = sanitizeSubs(r.subs, where, count).filter((s) => s.nodes.length >= 2);
  if (!subs.length) throw new PatternError(t('{where}: Die Kachel ist leer', { where }));
  return { w: r.w as number, h: r.h as number, subs };
}

/** Pattern from a library entry or an extension pack */
export function sanitizePatternSpec(raw: unknown, where: string): PatternSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { tile: sanitizeTile(r.tile, where), settings: sanitizeSettings(r.settings) };
}

export function parseRecipe(text: string): PatternRecipe {
  if (typeof text !== 'string' || !text || text.length > 40_000_000) throw new PatternError(t('Ungültiges Muster-Rezept.'));
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(text);
  } catch {
    throw new PatternError(t('Ungültiges Muster-Rezept.'));
  }
  if (!r || typeof r !== 'object' || r.v !== 1) throw new PatternError(t('Ungültiges Muster-Rezept.'));
  const where = t('Muster');
  const count = { n: 0 };
  const tile = sanitizeTile(r.tile, where, count);
  const target = sanitizeSubs(r.target, where, count).filter((s) => s.closed && s.nodes.length >= 2);
  const holes = r.holes === undefined ? [] : sanitizeSubs(r.holes, where, count).filter((s) => s.closed && s.nodes.length >= 2);
  const out: PatternRecipe = { v: 1, tile, target, holes };
  if (typeof r.name === 'string' && r.name) out.name = r.name.slice(0, 80);
  return out;
}

export const recipeJson = (r: PatternRecipe) => JSON.stringify(r);
