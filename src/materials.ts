// Material-Bibliothek (wie die Material Library in LightBurn): Layer-Einstellungen je Material und Dicke.
// Ein Eintrag hält die Bearbeitungseinstellungen eines Layers und wahlweise die Bild-Einstellungen.
// Gespeichert wird im Browser-Speicher der App; Austausch über .kzm-Dateien (JSON, früher .lwm). LightBurn-
// Bibliotheken (.clb) lassen sich einlesen, soweit ihre Felder hier eine Entsprechung haben.
import { CutSettings, cutSettings, defaultCutSettings, normalizeCut, defaultImageLayer, stripImageOutput, defaultTabs, DitherMode, ImageLayer, Layer, LayerMode } from './model';
import { dec, t } from './i18n';
import { cleanLook } from './view3d/looks';

export interface MaterialEntry {
  id: string;
  /** z. B. „Sperrholz Pappel“ */
  material: string;
  /** Dicke in mm; null = ohne Dicke (z. B. Gravur auf Schiefer) */
  thickness: number | null;
  /** z. B. „Schneiden“, „Gravieren“, „Markieren“ */
  title: string;
  desc: string;
  settings: CutSettings;
  /** Bild-Einstellungen, falls aus einem Layer mit Bildern erstellt */
  img?: ImageLayer;
  /** Ergebnis des Kalibrierassistenten für Schnittfuge und Steckspiel */
  fit?: MaterialFit;
  /** Kennung der Erweiterung, aus der der Eintrag stammt; fällt weg, sobald er hier geändert wird */
  pack?: string;
}

/**
 * Kalibrierte Passung eines Materials. Alle Werte beziehen sich auf die gezeichneten Maße samt Kerf-Versatz des
 * Layers (ohne Schnittfuge des Lasers), so lassen sie sich direkt mit den Maßen einer Konstruktion vergleichen.
 */
export interface MaterialFit {
  /** Gemessene Breite der Schnittfuge (mm); null = nicht gemessen */
  kerf: number | null;
  /** Bestes Spiel je Seite für zwei gelaserte Teile ineinander (Zinken, Zapfen in Loch), gezeichnet */
  pair: number;
  /** Beste Schlitzbreite über der Nenndicke th für eine Platte dieses Materials, gezeichnet */
  slot: number;
  /** Nenndicke bei der Kalibrierung (mm) */
  th: number;
  /** Datum (ISO) */
  date: string;
}

function sanitizeFit(f: unknown): MaterialFit | undefined {
  const o = f as Partial<MaterialFit> | undefined;
  if (!o || typeof o !== 'object') return undefined;
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
  const pair = n(o.pair), slot = n(o.slot), th = n(o.th);
  if (pair === null || slot === null || th === null || th <= 0) return undefined;
  const kerf = n(o.kerf);
  return { kerf: kerf !== null && kerf >= 0 ? kerf : null, pair, slot, th, date: typeof o.date === 'string' ? o.date : '' };
}

const STORE_KEY = 'kizamubeam.materials';
const FORMAT = 'kizamubeam-materials';

const newEntryId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function sanitize(e: Partial<MaterialEntry>): MaterialEntry | null {
  if (!e || typeof e !== 'object' || !e.settings) return null;
  const mode: LayerMode = e.settings.mode === 'fill' ? 'fill' : 'line';
  const settings = { ...defaultCutSettings(mode), ...e.settings, mode };
  normalizeCut(settings);
  settings.look = cleanLook(e.settings.look);
  if (!settings.look) delete settings.look;
  const th = Number(e.thickness);
  return {
    id: typeof e.id === 'string' && e.id ? e.id : newEntryId(),
    material: String(e.material ?? '').trim() || t('Ohne Namen'),
    thickness: e.thickness === null || e.thickness === undefined || !isFinite(th) || th <= 0 ? null : th,
    title: String(e.title ?? '').trim(),
    desc: String(e.desc ?? ''),
    settings,
    img: e.img ? { ...defaultImageLayer(), ...e.img } : undefined,
    fit: sanitizeFit(e.fit),
    ...(typeof e.pack === 'string' && e.pack ? { pack: e.pack } : {}),
  };
}

/** Eintrag aus einer Datei oder Erweiterung prüfen und ergänzen; null, wenn die Einstellungen fehlen */
export const sanitizeEntry = (e: unknown) => sanitize(e as Partial<MaterialEntry>);

class Library {
  entries: MaterialEntry[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.entries = (JSON.parse(raw).entries ?? []).map(sanitize).filter(Boolean) as MaterialEntry[];
    } catch {
      /* leer beginnen */
    }
  }
  on(f: () => void) {
    this.listeners.add(f);
  }
  private changed() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ format: FORMAT, version: 1, entries: this.entries }));
    } catch {
      /* nicht speicherbar, z. B. privates Fenster */
    }
    this.listeners.forEach((f) => f());
  }
  get(id: string | undefined) {
    return id ? this.entries.find((e) => e.id === id) : undefined;
  }
  materials(): string[] {
    return [...new Set(this.entries.map((e) => e.material))].sort((a, b) => a.localeCompare(b, 'de'));
  }
  add(e: Omit<MaterialEntry, 'id'>): MaterialEntry {
    const entry = { ...structuredClone(e), id: newEntryId() };
    this.entries.push(entry);
    this.changed();
    return entry;
  }
  update(id: string, patch: Partial<Omit<MaterialEntry, 'id'>>) {
    const e = this.get(id);
    if (!e) return;
    Object.assign(e, structuredClone(patch));
    // Geändert gehört der Eintrag der Person; ein Update der Erweiterung überschreibt ihn nicht mehr
    delete e.pack;
    this.changed();
  }
  remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.changed();
  }
  /** Einträge zusammenführen: gleiche Kombination aus Material, Dicke und Titel wird ersetzt */
  merge(list: MaterialEntry[]): { added: number; replaced: number } {
    let added = 0,
      replaced = 0;
    for (const n of list) {
      const k = entryKey(n);
      const i = this.entries.findIndex((e) => e.id === n.id || entryKey(e) === k);
      if (i >= 0) {
        this.entries[i] = { ...n, id: this.entries[i].id };
        replaced++;
      } else {
        this.entries.push({ ...n, id: this.entries.some((e) => e.id === n.id) ? newEntryId() : n.id });
        added++;
      }
    }
    this.changed();
    return { added, replaced };
  }
  /**
   * Einträge einer Erweiterung übernehmen: eigene unveränderte Einträge werden ersetzt oder entfernt, wenn
   * die Erweiterung sie nicht mehr hat; hier geänderte (ohne pack) bleiben, wie sie sind.
   */
  syncPack(pack: string, list: MaterialEntry[]) {
    const ids = new Set(list.map((e) => e.id));
    this.entries = this.entries.filter((e) => e.pack !== pack || ids.has(e.id));
    for (const n of list) {
      const i = this.entries.findIndex((e) => e.id === n.id);
      if (i < 0) this.entries.push({ ...structuredClone(n), pack });
      else if (this.entries[i].pack === pack) this.entries[i] = { ...structuredClone(n), pack };
    }
    this.changed();
  }
  serialize(): string {
    return JSON.stringify({ format: FORMAT, version: 1, entries: this.entries }, null, 1);
  }
}

export const library = new Library();

const entryKey = (e: MaterialEntry) => `${e.material.toLowerCase()}|${e.thickness ?? ''}|${e.title.toLowerCase()}`;

const fmt = (v: number) => dec(String(Math.round(v * 100) / 100));
export const thicknessLabel = (th: number | null) => (th === null ? t('ohne Dicke') : `${fmt(th)} mm`);
export const entryLabel = (e: MaterialEntry) =>
  [e.material, e.thickness === null ? '' : `${fmt(e.thickness)} mm`, e.title].filter(Boolean).join(' ');
/** Kurzbeschreibung einer Kalibrierung (Tooltip in der Bibliothek) */
export const fitSummary = (f: MaterialFit) => {
  const v = (x: number) => dec((Math.round(x * 100) / 100).toFixed(2));
  return [
    f.kerf !== null ? t('Schnittfuge {k} mm', { k: v(f.kerf) }) : '',
    t('Zapfen in Loch {c} mm je Seite', { c: v(f.pair) }),
    t('Schlitz {w} mm für {th} mm', { w: v(f.th + f.slot), th: v(f.th) }),
    f.date,
  ].filter(Boolean).join(' · ');
};
export const settingsSummary = (s: CutSettings) =>
  `${s.mode === 'fill' ? t('Füllen') : t('Linie')}, ${fmt(s.speed)} mm/min, ${fmt(s.power)} %${s.passes > 1 ? `, ${s.passes}×` : ''}`;

/** Neuer Eintrag aus den Einstellungen eines Layers */
export function entryFromLayer(L: Layer, withImg: boolean): Pick<MaterialEntry, 'settings' | 'img'> {
  return { settings: cutSettings(L), img: withImg && L.img ? structuredClone(L.img) : undefined };
}

/**
 * Änderung für einen Layer, der einen Eintrag übernimmt. imagesOnly: the layer holds only images, so
 * older entries that kept image speed and power separately apply those to the layer
 */
export function layerPatch(e: MaterialEntry, imagesOnly = false): Partial<Layer> {
  // Ohne eigenes Aussehen im Eintrag gilt wieder das automatische (aus dem Materialnamen)
  const p: Partial<Layer> = { look: undefined, sub: undefined, ...structuredClone(e.settings), material: e.id, name: entryLabel(e) };
  if (e.img) {
    if (imagesOnly) for (const k of ['speed', 'power', 'minPower', 'passes'] as const) if (typeof e.img[k] === 'number') p[k] = e.img[k];
    p.img = stripImageOutput(e.img);
  }
  return p;
}

/** Weichen die Einstellungen des Layers vom Eintrag ab? */
export function differsFrom(L: Layer, e: MaterialEntry): boolean {
  if (JSON.stringify(cutSettings(L)) !== JSON.stringify(cutSettings(e.settings))) return true;
  return !!e.img && JSON.stringify(L.img) !== JSON.stringify(stripImageOutput(e.img));
}

// ---------- Import ----------

/** Inhalt einer .kzm-/.lwm- oder .clb-Datei lesen */
export function parseLibrary(text: string): MaterialEntry[] {
  const src = text.trimStart();
  if (src.startsWith('<')) return parseClb(src);
  const data = JSON.parse(src);
  const list = Array.isArray(data) ? data : data?.entries;
  if (!Array.isArray(list)) throw new Error(t('Keine KizamuBeam-Materialbibliothek'));
  return list.map(sanitize).filter(Boolean) as MaterialEntry[];
}

/**
 * Eine CutSetting von LightBurn (.clb-Bibliothek oder .lbrn2-Projekt) in Layer-Einstellungen übersetzen.
 * val liefert den Wert des ersten vorhandenen Felds (Value-Attribut) oder null. LightBurn speichert
 * Geschwindigkeiten in mm/s, Leistung in %, und lässt Felder mit Standardwert weg.
 */
export function lbCutSetting(type: string, imgTag: boolean, val: (...names: string[]) => string | null): { settings: CutSettings; img?: ImageLayer } {
  const num = (d: number, ...names: string[]) => {
    const raw = val(...names);
    const v = Number(raw);
    return raw === null || !isFinite(v) ? d : v;
  };
  const bool = (d: boolean, ...names: string[]) => {
    const v = val(...names);
    return v === null ? d : v === '1' || v.toLowerCase() === 'true';
  };
  const ty = type.toLowerCase();
  const isImg = ty === 'image' || imgTag;
  const mode = ty === 'scan' || ty === 'offset' || ty === 'scan+cut' || isImg ? 'fill' : 'line';
  const d = defaultCutSettings(mode);
  const speed = Math.round(num(d.speed / 60, 'speed') * 60 * 100) / 100;
  const dt = defaultTabs();
  const settings: CutSettings = {
    ...d,
    speed,
    power: num(d.power, 'maxPower'),
    minPower: num(d.minPower, 'minPower'),
    passes: Math.max(1, Math.round(num(d.passes, 'numPasses'))),
    air: bool(d.air, 'enableAir', 'airAssist', 'air'),
    kerf: num(d.kerf, 'kerf'),
    tabs: {
      ...dt,
      enabled: bool(dt.enabled, 'enableTabs', 'tabsEnabled', 'useTabs'),
      size: num(dt.size, 'tabSize'),
      useCount: !bool(!dt.useCount, 'tabsUseSpacing'),
      count: Math.max(1, Math.round(num(dt.count, 'tabCount'))),
      spacing: num(dt.spacing, 'tabSpacing'),
    },
    fillStyle: ty === 'offset' ? 'offset' : 'scan',
    interval: num(d.interval, 'interval'),
    angle: num(d.angle, 'angle', 'scanAngle'),
    crossHatch: bool(d.crossHatch, 'crossHatch'),
    bidirectional: bool(d.bidirectional, 'bidir'),
    overscan: num(d.overscan, 'overscanPercent'),
    perf: {
      enabled: bool(d.perf.enabled, 'perforate'),
      on: Math.max(0.01, num(d.perf.on, 'perfLen')),
      off: Math.max(0, num(d.perf.off, 'perfSkip')),
    },
    lead: {
      leadIn: bool(d.lead.leadIn, 'leadIn', 'enableLeadIn'),
      leadOut: bool(d.lead.leadOut, 'leadOut', 'enableLeadOut'),
      length: Math.max(0, num(d.lead.length, 'leadLength', 'leadInLength')),
      // LightBurn: positiv = außen, negativ = innen; KizamuBeam legt den Anschnitt immer auf die Abfallseite
      angle: Math.min(180, Math.abs(num(d.lead.angle, 'leadAngle', 'leadInAngle'))),
      arc: (val('leadStyle') ?? '').toLowerCase() === 'arc',
      overcut: Math.max(0, num(d.lead.overcut, 'overcut', 'overCut')),
    },
    // LightBurn rampt die Leistung an Anfang und Ende eines Schnitts
    ramp: { ...d.ramp, enabled: bool(d.ramp.enabled, 'enablePowerRamp', 'rampEnabled'), ends: bool(d.ramp.enabled, 'enablePowerRamp', 'rampEnabled'), length: Math.max(0.05, num(d.ramp.length, 'rampLength')) },
    zOffset: num(d.zOffset, 'zOffset'),
    zStep: num(d.zStep, 'zPerPass', 'zStep'),
  };
  if (settings.lead.arc && settings.lead.angle < 1) settings.lead.angle = d.lead.angle;
  if (!isImg) return { settings };
  const dither: Record<string, DitherMode> = {
    threshold: 'threshold', ordered: 'ordered', atkinson: 'atkinson', dither: 'floyd', stucki: 'stucki', jarvis: 'jarvis', newsprint: 'newsprint', halftone: 'halftone', sketch: 'sketch', grayscale: 'grayscale',
  };
  const di = defaultImageLayer();
  const img: ImageLayer = {
    ...di,
    speed: settings.speed, power: settings.power, minPower: settings.minPower, passes: settings.passes,
    interval: settings.interval, bidirectional: settings.bidirectional, overscan: settings.overscan, angle: settings.angle,
    dither: dither[(val('ditherMode') ?? '').toLowerCase()] ?? di.dither,
    negative: bool(di.negative, 'negativeImage'),
  };
  return { settings, img };
}

/**
 * LightBurn-Bibliothek (.clb, XML): Material → Entry (Thickness, Desc, NoThickTitle) → CutSetting.
 * LightBurn speichert Geschwindigkeiten in mm/s, Leistung in %. Unbekannte Felder werden ignoriert.
 */
function parseClb(xml: string): MaterialEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('Die XML-Datei ist fehlerhaft'));
  const out: MaterialEntry[] = [];
  for (const mat of Array.from(doc.getElementsByTagName('Material'))) {
    const material = mat.getAttribute('name') ?? '';
    for (const en of Array.from(mat.getElementsByTagName('Entry'))) {
      const cs = en.getElementsByTagName('CutSetting')[0] ?? en.getElementsByTagName('CutSetting_Img')[0];
      if (!cs) continue;
      const val = (...names: string[]) => {
        for (const n of names) {
          const el = Array.from(cs.children).find((c) => c.tagName === n);
          const v = el?.getAttribute('Value');
          if (v !== null && v !== undefined && v !== '') return v;
        }
        return null;
      };
      const { settings, img } = lbCutSetting(cs.getAttribute('type') ?? 'Cut', cs.tagName === 'CutSetting_Img', val);
      const thickness = Number(en.getAttribute('Thickness'));
      const e = sanitize({
        material,
        thickness: isFinite(thickness) && thickness > 0 ? thickness : null,
        title: en.getAttribute('Desc') || en.getAttribute('NoThickTitle') || '',
        desc: '',
        settings,
      });
      if (!e) continue;
      if (img) e.img = img;
      out.push(e);
    }
  }
  if (!out.length) throw new Error(t('Keine Einträge gefunden'));
  return out;
}
