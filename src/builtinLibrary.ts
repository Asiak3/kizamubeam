// Mitgelieferte Bibliothek: 400 Motive und Designelemente, die mit KizamuBeam ausgeliefert werden. Die
// Formen entstehen in scripts/build-library.ts (Quellen in scripts/library/) und liegen als kompakte
// SVG-Pfaddaten in src/library/builtin.json; die Datei wird erst geladen, wenn die Bibliothek gebraucht wird.
// Einträge haben die Kennung „builtin:<id>“ und lassen sich nicht ändern oder löschen.
import type { Obj } from './model';
import type { AssetData } from './assetFormat';
import { decodeD, f, GROUPS } from './builtinFormat';
import { lang } from './i18n';
import { BUILTIN_PATTERN_PREFIX, builtinPatternAssets } from './patternLibrary';

export { GROUPS };

// ---------- Einträge ----------

interface RawItem {
  id: string;
  /** m = Motiv, e = Designelement */
  c: 'm' | 'e';
  /** Gruppe (GROUPS) */
  g: string;
  /** Name deutsch, englisch */
  n: [string, string];
  /** Stichwörter: gleich in beiden Sprachen oder [deutsch, englisch] */
  t?: (string | [string, string])[];
  w: number;
  h: number;
  /** Pfaddaten in mm (encodeSubs) */
  d: string;
}

export interface BuiltinAsset {
  key: string;
  /** Gruppe (GROUPS) */
  group: string;
  /** Angaben ohne Objekte; vollständig über builtinAsset */
  asset: AssetData;
}

let loaded: Promise<BuiltinAsset[]> | null = null;
const raws = new Map<string, RawItem>();

const pick = (v: string | [string, string], de: boolean) => (typeof v === 'string' ? v : de ? v[0] : v[1]);

/** Name und Stichwörter in der Sprache der Oberfläche; die der anderen Sprache als weitere Stichwörter, damit die Suche beide findet */
function tagsOf(r: RawItem, de: boolean): string[] {
  const g = GROUPS[r.g];
  const own = [...(g ? [de ? g.de : g.en] : []), ...(r.t ?? []).map((x) => pick(x, de))];
  const other = [r.n[de ? 1 : 0], ...(g ? [de ? g.en : g.de] : []), ...(r.t ?? []).filter((x) => typeof x !== 'string').map((x) => pick(x, !de))];
  const name = r.n[de ? 0 : 1].toLowerCase();
  const seen = new Set<string>([name]);
  return [...own, ...other].filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 30);
}

/** Vorschau: quadratisch, Form mittig, gefüllt */
function previewOf(r: RawItem): string {
  const m = Math.max(r.w, r.h);
  const pad = m * 0.05;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-pad - (m - r.w) / 2)} ${f(-pad - (m - r.h) / 2)} ${f(m + 2 * pad)} ${f(m + 2 * pad)}"><path d="${r.d}" fill="#3a3a3a" fill-rule="evenodd"/></svg>`;
}

function toAsset(r: RawItem, de: boolean): AssetData {
  return {
    name: de ? r.n[0] : r.n[1],
    category: r.c === 'm' ? 'motif' : 'element',
    tags: tagsOf(r, de),
    w: r.w,
    h: r.h,
    preview: previewOf(r),
    objs: [],
    images: {},
    fill: [0],
  };
}

/** Alle mitgelieferten Einträge (die Datei wird beim ersten Aufruf geladen; Sprache wechselt erst nach Neustart) */
export function builtinAssets(): Promise<BuiltinAsset[]> {
  loaded ??= import('./library/builtin.json').then((m) => {
    const data = ((m as { default?: unknown }).default ?? m) as { items: RawItem[] };
    const de = lang === 'de';
    const items = data.items.map((r) => {
      raws.set(`builtin:${r.id}`, r);
      return { key: `builtin:${r.id}`, group: r.g, asset: toAsset(r, de) };
    });
    // bundled fill patterns (patternLibrary.ts) after the motifs
    return [...items, ...builtinPatternAssets().map(({ key, asset }) => ({ key, group: 'fillpatterns', asset }))];
  });
  return loaded;
}

/** Vollständiger Eintrag mit Objekten: ein Pfad auf Layer 0, Rahmen bei (0, 0); null, wenn es ihn nicht gibt */
export async function builtinAsset(key: string): Promise<AssetData | null> {
  if (key.startsWith(BUILTIN_PATTERN_PREFIX)) return structuredClone(builtinPatternAssets().find((x) => x.key === key)?.asset ?? null);
  const list = await builtinAssets();
  const it = list.find((x) => x.key === key);
  const r = raws.get(key);
  if (!it || !r) return null;
  const obj: Obj = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'path', subs: decodeD(r.d) } };
  return { ...structuredClone(it.asset), objs: [obj] };
}

/** Name einer Gruppe in der Sprache der Oberfläche */
export const groupLabel = (g: string) => (GROUPS[g] ? (lang === 'de' ? GROUPS[g].de : GROUPS[g].en) : g);
