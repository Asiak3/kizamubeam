// Layer-Kategorien und Layer-Vorgaben für neue Projekte (#265).
//
// Eine Kategorie ist eine benannte Voreinstellung (Art und Bearbeitungseinstellungen). Eingebaut sind Schneiden,
// Gravieren und Markieren mit den bisherigen Werten; eigene lassen sich anlegen. Jeder Layer 00–29 gehört zu einer
// Kategorie. Gespeichert wird global (kizamubeam.layerCategories, wird mit den Einstellungen übertragen), nicht im
// Projekt: Das Projekt bekommt die ausgefüllten Layer, so sieht eine Datei auf jedem Rechner gleich aus.
//
// Ohne gespeicherte Vorgaben ändert sich nichts gegenüber bisher (npm run test:layer-categories prüft das mit Hashes).
// Lädt keine Oberflächen-Module (läuft im Editor und in den Tests).
import { cleanLayerType, CutSettings, cutSettings, defaultCutSettings, defaultLayer, Doc, isCutLayer, Layer, LayerMode, LayerType, layerTypeName, LAYER_TYPES, normalizeCut } from './model';
import { cleanLook } from './view3d/looks';

export const LAYER_CATEGORIES_KEY = 'kizamubeam.layerCategories';

/** Layer, die eine Kategorie bekommen (T1/T2 sind Werkzeug-Layer und bleiben, wie sie sind) */
export const CATEGORY_LAYERS = 30;

export interface LayerCategory {
  /** Eingebaute: 'cut', 'engrave', 'mark'; eigene: zufällige Kennung */
  id: string;
  /** Leer = Name der Art (eingebaute, übersetzt angezeigt) */
  name: string;
  type: LayerType;
  /** Voreinstellung ohne Layer-Art (die steht in type) */
  cut: CutSettings;
}

export interface LayerDefaults {
  /** Neue Projekte bekommen die Layer ihrer Kategorien */
  apply: boolean;
  /** Eingebaute zuerst, immer alle drei */
  categories: LayerCategory[];
  /** Layer 00–29 → Kennung der Kategorie; fehlt = Standard (00 Gravieren, sonst Schneiden) */
  layers: Record<number, string>;
}

/** Bisherige Werte: Linie 600 mm/min 80 %, Füllen 3000/30 %, Beschriftung der Generatoren Linie 3000/15 % */
function builtinCut(type: LayerType): CutSettings {
  if (type === 'engrave') return defaultCutSettings('fill');
  if (type === 'mark') return { ...defaultCutSettings('line'), speed: 3000, power: 15 };
  return defaultCutSettings('line');
}

export const isBuiltinCategory = (id: string) => (LAYER_TYPES as string[]).includes(id);

/** Eingebaute Kategorie mit ihren Werkswerten (auch „Zurücksetzen“) */
export const builtinCategory = (type: LayerType): LayerCategory => ({ id: type, name: '', type, cut: builtinCut(type) });

/** Kategorie eines Layers ohne Zuordnung: 00 graviert (Füllen), die übrigen schneiden (wie defaultLayer) */
export const standardCategoryId = (index: number): LayerType => (index === 0 ? 'engrave' : 'cut');

export const defaultLayerDefaults = (): LayerDefaults => ({ apply: true, categories: LAYER_TYPES.map(builtinCategory), layers: {} });

/** Angezeigter Name einer Kategorie */
export const categoryName = (c: LayerCategory) => c.name || layerTypeName(c.type);

/** Bearbeitungseinstellungen aus dem Speicher prüfen und ergänzen (ohne Layer-Art) */
function cleanCut(v: unknown, fallback: CutSettings): CutSettings {
  if (!v || typeof v !== 'object') return structuredClone(fallback);
  const raw = v as Partial<CutSettings>;
  const mode: LayerMode = raw.mode === 'fill' ? 'fill' : 'line';
  const out = normalizeCut({ ...defaultCutSettings(mode), ...structuredClone(raw), mode } as CutSettings);
  const look = cleanLook(raw.look);
  if (look) out.look = look;
  else delete out.look;
  delete out.layerType;
  const s = cutSettings(out) as unknown as Record<string, unknown>;
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  return s as unknown as CutSettings;
}

/** Gespeicherte Vorgaben prüfen: eingebaute Kategorien immer vorhanden, unbekannte Zuordnungen fallen weg */
export function sanitizeLayerDefaults(raw: unknown): LayerDefaults {
  const d = defaultLayerDefaults();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof LayerDefaults, unknown>>;
  if (r.apply === false) d.apply = false;
  const seen = new Set<string>();
  const custom: LayerCategory[] = [];
  for (const c of Array.isArray(r.categories) ? r.categories : []) {
    if (!c || typeof c !== 'object') continue;
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (isBuiltinCategory(id)) {
      const b = d.categories.find((x) => x.id === id)!;
      b.name = name;
      b.cut = cleanCut(c.cut, b.cut);
    } else {
      const type = cleanLayerType(c.type) ?? 'cut';
      custom.push({ id, name, type, cut: cleanCut(c.cut, builtinCut(type)) });
    }
  }
  d.categories.push(...custom);
  if (r.layers && typeof r.layers === 'object') {
    for (const [k, v] of Object.entries(r.layers as Record<string, unknown>)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < CATEGORY_LAYERS && typeof v === 'string' && seen.has(v) && v !== standardCategoryId(i)) d.layers[i] = v;
    }
  }
  return d;
}

/** Gespeicherte Vorgaben; null, wenn keine da sind (dann gilt alles wie bisher) */
export function loadLayerDefaults(): LayerDefaults | null {
  try {
    const raw = localStorage.getItem(LAYER_CATEGORIES_KEY);
    return raw ? sanitizeLayerDefaults(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Vorgaben speichern; null löscht sie (alles wie bisher) */
export function saveLayerDefaults(d: LayerDefaults | null) {
  try {
    if (d) localStorage.setItem(LAYER_CATEGORIES_KEY, JSON.stringify(sanitizeLayerDefaults(d)));
    else localStorage.removeItem(LAYER_CATEGORIES_KEY);
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Kategorie eines Layers (ohne Vorgaben: die Standard-Kategorie mit Werkswerten) */
export function categoryOf(index: number, d: LayerDefaults | null = loadLayerDefaults()): LayerCategory {
  const id = d?.layers[index] ?? standardCategoryId(index);
  return d?.categories.find((c) => c.id === id) ?? d?.categories.find((c) => c.id === standardCategoryId(index)) ?? builtinCategory(standardCategoryId(index));
}

/** Art, die ein Layer ohne gespeicherte Art ohnehin hat (wie „Automatisch“ im Layer-Dialog) */
const impliedType = (L: Layer): LayerType => (isCutLayer(L) ? 'cut' : 'engrave');

/**
 * Vollständiger Layer index mit den Einstellungen der Kategorie. Die Art wird nur gespeichert, wenn sie von der
 * abweicht, die der Layer ohnehin hätte (so bleibt ein Layer mit unveränderter Kategorie wie defaultLayer).
 */
export function categoryLayer(index: number, c: LayerCategory): Layer {
  const L: Layer = { ...defaultLayer(index), ...structuredClone(c.cut) };
  if (!L.look) delete L.look;
  if (!L.sub) delete L.sub;
  delete L.layerType;
  if (c.type !== impliedType(L)) L.layerType = c.type;
  return L;
}

const sameCut = (a: Layer, b: Layer) => JSON.stringify(cutSettings(a)) === JSON.stringify(cutSettings(b));

/**
 * Neues Projekt: Layer 00–29 mit den Einstellungen ihrer Kategorien füllen. Nur Layer, die dadurch von den
 * Standardwerten abweichen, kommen ins Dokument (die übrigen legt layer() wie bisher an). Ohne gespeicherte Vorgaben
 * oder mit ausgeschaltetem „Auf neue Projekte anwenden“ bleibt das Dokument unverändert.
 */
export function applyLayerDefaults(doc: Doc, d: LayerDefaults | null = loadLayerDefaults()) {
  if (!d?.apply) return;
  for (let i = 0; i < CATEGORY_LAYERS; i++) {
    const L = categoryLayer(i, categoryOf(i, d));
    if (sameCut(L, normalizeCut(defaultLayer(i)))) continue;
    doc.layers[i] = L;
  }
}

/**
 * Einstellungen für den Beschriftungs-Layer der Generatoren (markLayer): die Kategorie Markieren. Ohne gespeicherte
 * Vorgaben genau die bisherigen Werte ohne Layer-Art.
 */
export function markLayerSettings(d: LayerDefaults | null = loadLayerDefaults()): Partial<Layer> {
  if (!d) return { ...defaultCutSettings('line'), mode: 'line', speed: 3000, power: 15 };
  const c = d.categories.find((x) => x.id === 'mark') ?? builtinCategory('mark');
  const s: Partial<Layer> = { look: undefined, sub: undefined, ...structuredClone(c.cut), layerType: 'mark' };
  return s;
}

/**
 * „Standardwerte“ im Layer-Dialog: die Voreinstellung der Kategorie des Layers, wenn sie denselben Modus hat, sonst die
 * Standardwerte des Modus (wie bisher). Ohne Aussehen, Sub-Layer und Art (die bleiben, wie sie im Dialog stehen).
 */
export function resetSettings(index: number, mode: LayerMode, d: LayerDefaults | null = loadLayerDefaults()): CutSettings {
  const c = d && index < CATEGORY_LAYERS ? categoryOf(index, d) : null;
  const s = c && c.cut.mode === mode ? structuredClone(c.cut) : defaultCutSettings(mode);
  delete s.look;
  delete s.sub;
  delete s.layerType;
  return s;
}
