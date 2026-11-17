// Erweiterungen (Inhaltspakete, .kzp): Gerätevorlagen, Vorlagen, Materialien und Bibliotheks-Einträge, die sich ohne App-Update
// nachladen lassen. Alles wird beim Lesen gegen das Format geprüft und auf erlaubte Felder beschränkt. Since format
// version 2 a pack may also bring plugins (program code, issue #205); they run only in the sandbox of src/plugins. Gespeichert wird in der Desktop-App im Einstellungsordner (Rust: packs.rs),
// im Browser im lokalen Speicher. Die Prüflogik wird mit `npm run test:packs` getestet.
import { Device, Firmware, FIRMWARES, LASER_TYPES, LaserModule, LaserType } from './gcode';
import { builtinPresetFiles } from './builtinPresets';
import { library, MaterialEntry, sanitizeEntry } from './materials';
import { loadDoc } from './model';
import { normalizeTemplate, TemplateInfo } from './templates';
import type { ProjectParam } from './params';
import { compareVersions } from './updates';
import { AssetData, AssetError, parseAsset } from './assetFormat';
import { localText, t, tn } from './i18n';
import { ManifestError, parsePlugin, type PluginManifest } from './plugins/manifest';

export { localText };
import { version as APP_VERSION } from '../package.json';

export const PACK_EXT = 'kzp';
export const PACK_FORMAT = 'kizamubeam-pack';
export const PACK_FORMAT_VERSION = 2;
/** Packs with plugins need format version 2, so older apps refuse them with an update hint */
export const PLUGIN_FORMAT_VERSION = 2;
/** Größte Paketdatei (Vorlagen können Bilder enthalten) */
export const PACK_MAX_BYTES = 20 * 1024 * 1024;

/** Text in mehreren Sprachen: „Text“ oder {"de": "…", "en": "…"} */
export type LocalText = string | Record<string, string>;

/** Gerätevorlage aus einem Paket: nur Felder, die keine Befehle an die Maschine enthalten */
export type PackDevice = Partial<Device> & { name: string; fw: Firmware };

/** A checked device preset. id and vendor stay outside `preset`, so they never end up in a stored device. */
export interface PresetEntry {
  preset: PackDevice;
  source?: string;
  /** Stable id such as „ortur.laser-master-3“; a pack preset with the id of a built-in one replaces it */
  id?: string;
  /** Manufacturer; presets without one are generic */
  vendor?: string;
  /** Link to the source (https only) */
  sourceUrl?: string;
  /** Date the values were last checked against the source (YYYY-MM-DD) */
  checked?: string;
  /** true when the work area was measured on a real machine, not only taken from the manufacturer */
  measured?: boolean;
  /** Equipment of the machine, informational (see PRESET_FEATURES) */
  features?: PresetFeature[];
  /** Variants of one model (e.g. laser modules with different work areas); the list shows one entry per variant */
  variants?: PresetVariant[];
  /** Set on entries expanded from a variant: id of the file they come from */
  base?: string;
}

/** Equipment a preset can list; shown next to the preset, never changes the generated G-code */
export const PRESET_FEATURES = ['air-assist', 'autofocus', 'camera', 'enclosure', 'wifi', 'bluetooth', 'offline'] as const;
export type PresetFeature = (typeof PRESET_FEATURES)[number];

/** One variant of a preset: its own name suffix and the values that differ */
export interface PresetVariant {
  id: string;
  name: string;
  bedW?: number;
  bedH?: number;
  laser?: LaserModule;
}

export interface PackTemplate {
  info: TemplateInfo;
  /** Inhalt wie eine .kzt-Datei, Titel und Beschreibung schon in der Sprache der Oberfläche */
  json: string;
}

export interface Pack {
  id: string;
  version: string;
  minApp?: string;
  name: string;
  description?: string;
  author?: string;
  homepage?: string;
  devices: PresetEntry[];
  templates: PackTemplate[];
  materials: MaterialEntry[];
  /** Einträge für die Bibliothek (Motive, Bilder, Designelemente); id = eigene Kennung im Paket */
  assets: (AssetData & { id: string })[];
  /** Plugins (program code, run in the sandbox); only in format version 2 */
  plugins: PluginManifest[];
}

export class PackError extends Error {}

const ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const PRESET_ID_RE = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

/** Presets may only point at this computer (e.g. the KizamuBeam Virtual Machine), never at other hosts. */
export function isLoopbackHost(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const host = v.trim().toLowerCase();
  if (host === 'localhost') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const numIn = (v: unknown, min: number, max: number) => (typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : undefined);

const VARIANT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_VARIANTS = 12;

/** Laser module: kind, optical power (W) and wavelength (nm); invalid parts are dropped, an empty module is undefined */
export function sanitizeLaser(v: unknown): LaserModule | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const m: LaserModule = {};
  if (LASER_TYPES.includes(r.type as LaserType)) m.type = r.type as LaserType;
  const power = numIn(r.power, 0.1, 1000);
  if (power !== undefined) m.power = power;
  const wavelength = numIn(r.wavelength, 200, 11_000);
  if (wavelength !== undefined) m.wavelength = Math.round(wavelength);
  return Object.keys(m).length ? m : undefined;
}

function sanitizeVariant(v: unknown, where: string): PresetVariant {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (typeof r.id !== 'string' || !VARIANT_ID_RE.test(r.id)) throw new PackError(t('{where}: Variante ohne gültige Kennung', { where }));
  const name = str(localText(r.name), 40);
  if (!name) throw new PackError(t('{where}: Variante „{id}“ ohne Name', { where, id: r.id }));
  const out: PresetVariant = { id: r.id, name };
  const bedW = numIn(r.bedW, 10, 5000);
  const bedH = numIn(r.bedH, 10, 5000);
  if (bedW !== undefined) out.bedW = bedW;
  if (bedH !== undefined) out.bedH = bedH;
  const laser = sanitizeLaser(r.laser);
  if (laser) out.laser = laser;
  return out;
}

/**
 * Gerätevorlage prüfen. Erlaubt sind Name, Firmware, Arbeitsbereich und Werte für Verbindung und Zeitschätzung,
 * plus laser module, Z axis, red-dot offset, receive buffer and metadata (source, equipment, variants).
 * Start-/End-Skripte, Drehachse, Rahmen mit Laser, Adressen und Grenzen für KI-Agenten fallen weg, weil sie Befehle,
 * Laserleistung oder persönliche Einstellungen sind. Only a loopback host (localhost, 127.x.x.x) is kept.
 * Built-in presets (presets/devices) go through the same check.
 */
export function sanitizeDevice(raw: unknown, where: string): PresetEntry {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = str(localText(r.name), 80);
  if (!name) throw new PackError(t('{where}: Name fehlt', { where }));
  const fw = r.fw as Firmware;
  if (typeof fw !== 'string' || !(fw in FIRMWARES)) throw new PackError(t('{where}: unbekannte Firmware „{fw}“', { where, fw: String(r.fw) }));
  const bedW = numIn(r.bedW, 10, 5000);
  const bedH = numIn(r.bedH, 10, 5000);
  if (bedW === undefined || bedH === undefined) throw new PackError(t('{where}: Arbeitsbereich (bedW, bedH) fehlt oder liegt nicht zwischen 10 und 5000 mm', { where }));
  const p: PackDevice = { name, fw, bedW, bedH };
  const baud = numIn(r.baud, 1200, 4_000_000);
  if (baud !== undefined) p.baud = Math.round(baud);
  const sMax = numIn(r.sMax, 1, 100_000);
  if (sMax !== undefined) p.sMax = sMax;
  const rapid = numIn(r.rapid, 100, 200_000);
  if (rapid !== undefined) p.rapid = rapid;
  const accel = numIn(r.accel, 10, 200_000);
  if (accel !== undefined) p.accel = accel;
  const junction = numIn(r.junction, 0.001, 1);
  if (junction !== undefined) p.junction = junction;
  if (r.conn === 'serial' || r.conn === 'tcp' || r.conn === 'ws') p.conn = r.conn;
  const tcpPort = numIn(r.tcpPort, 1, 65535);
  if (tcpPort !== undefined) p.tcpPort = Math.round(tcpPort);
  const wsPort = numIn(r.wsPort, 1, 65535);
  if (wsPort !== undefined) p.wsPort = Math.round(wsPort);
  if (r.airCmd === 'M7' || r.airCmd === 'M8') p.airCmd = r.airCmd;
  if (r.limitSwitches === 'yes' || r.limitSwitches === 'no' || r.limitSwitches === 'unknown') p.limitSwitches = r.limitSwitches;
  if (typeof r.homeOnConnect === 'boolean') p.homeOnConnect = r.homeOnConnect;
  const frameSpeed = numIn(r.frameSpeed, 10, 200_000);
  if (frameSpeed !== undefined) p.frameSpeed = frameSpeed;
  if (isLoopbackHost(r.host)) p.host = r.host.trim();
  const httpPort = numIn(r.httpPort, 1, 65535);
  if (httpPort !== undefined) p.httpPort = Math.round(httpPort);
  const rxBuffer = numIn(r.rxBuffer, 64, 16_384);
  if (rxBuffer !== undefined) p.rxBuffer = Math.round(rxBuffer);
  if (typeof r.zAxis === 'boolean') p.zAxis = r.zAxis;
  if (typeof r.zFlip === 'boolean') p.zFlip = r.zFlip;
  const po = r.pointerOffset as Record<string, unknown> | undefined;
  if (po && typeof po === 'object') {
    const x = numIn(po.x, -200, 200);
    const y = numIn(po.y, -200, 200);
    if (x !== undefined && y !== undefined) p.pointerOffset = { x, y, enabled: po.enabled === true };
  }
  const laser = sanitizeLaser(r.laser);
  if (laser) p.laser = laser;
  const entry: PresetEntry = { preset: p };
  const source = str(r.source, 300);
  if (source) entry.source = source;
  if (typeof r.id === 'string' && PRESET_ID_RE.test(r.id)) entry.id = r.id;
  const vendor = str(localText(r.vendor), 60);
  if (vendor) entry.vendor = vendor;
  const url = str(r.sourceUrl, 300);
  if (/^https:\/\/[^\s]+$/i.test(url)) entry.sourceUrl = url;
  if (typeof r.checked === 'string' && DATE_RE.test(r.checked)) entry.checked = r.checked;
  if (typeof r.measured === 'boolean') entry.measured = r.measured;
  if (Array.isArray(r.features)) {
    const f = PRESET_FEATURES.filter((x) => (r.features as unknown[]).includes(x));
    if (f.length) entry.features = f;
  }
  if (r.variants !== undefined) {
    if (!Array.isArray(r.variants) || !r.variants.length || r.variants.length > MAX_VARIANTS)
      throw new PackError(t('{where}: „variants“ muss 1 bis {n} Einträge haben', { where, n: MAX_VARIANTS }));
    const variants = r.variants.map((v) => sanitizeVariant(v, where));
    if (new Set(variants.map((v) => v.id)).size !== variants.length) throw new PackError(t('{where}: Varianten mit doppelter Kennung', { where }));
    entry.variants = variants;
  }
  return entry;
}

/** Vorlage prüfen: muss sich als Projekt laden lassen und Vorlagen-Angaben haben */
export function sanitizeTemplate(raw: unknown, where: string): PackTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PackError(t('{where}: keine Vorlage', { where }));
  const d = structuredClone(raw) as Record<string, unknown>;
  const tpl = d.template as Record<string, unknown> | undefined;
  if (!tpl || typeof tpl !== 'object') throw new PackError(t('{where}: keine Vorlage (Eintrag „template“ fehlt)', { where }));
  // Titel und Beschreibung dürfen mehrsprachig sein; in der Vorlage selbst stehen sie als Text
  tpl.title = localText(tpl.title) || t('Vorlage');
  const desc = localText(tpl.description);
  if (desc) tpl.description = desc;
  else delete tpl.description;
  try {
    loadDoc(structuredClone(d));
  } catch (e) {
    throw new PackError(`${where}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const info = normalizeTemplate(tpl, Array.isArray(d.params) ? (d.params as ProjectParam[]) : []);
  return { info, json: JSON.stringify(d) };
}

/**
 * Paketdatei lesen und prüfen. Fehler im Aufbau (Format, Kennung, Version) und in einzelnen Einträgen
 * lehnen das ganze Paket ab, damit nichts halb installiert wird.
 */
export function parsePack(text: string, appVersion: string = APP_VERSION): Pack {
  if (text.length > PACK_MAX_BYTES) throw new PackError(t('Das Paket ist größer als {mb} MB', { mb: PACK_MAX_BYTES / 1024 / 1024 }));
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PackError(t('Keine KizamuBeam-Erweiterung (kein gültiges JSON)'));
  }
  if (!raw || typeof raw !== 'object' || raw.format !== PACK_FORMAT) throw new PackError(t('Keine KizamuBeam-Erweiterung'));
  const fv = Number(raw.formatVersion ?? 1);
  if (!Number.isInteger(fv) || fv < 1) throw new PackError(t('Ungültige Formatversion'));
  if (fv > PACK_FORMAT_VERSION) throw new PackError(t('Die Erweiterung braucht eine neuere Version von KizamuBeam'));
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!ID_RE.test(id) || id.length > 64) throw new PackError(t('Ungültige Kennung „{id}“ (Kleinbuchstaben, Ziffern, Bindestriche, mit Punkt getrennt, z. B. „de.beispiel.werkstatt“)', { id }));
  const version = typeof raw.version === 'string' ? raw.version : '';
  if (!VERSION_RE.test(version)) throw new PackError(t('Ungültige Version „{version}“ (z. B. 1.0.0)', { version }));
  let minApp: string | undefined;
  if (raw.minApp !== undefined) {
    if (typeof raw.minApp !== 'string' || !VERSION_RE.test(raw.minApp)) throw new PackError(t('Ungültige Angabe minApp'));
    minApp = raw.minApp;
    if (compareVersions(appVersion, minApp) < 0) throw new PackError(t('Die Erweiterung braucht KizamuBeam {version} oder neuer', { version: minApp }));
  }
  const name = str(localText(raw.name), 80);
  if (!name) throw new PackError(t('Name der Erweiterung fehlt'));
  const list = (k: string) => {
    const v = raw[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new PackError(t('„{key}“ muss eine Liste sein', { key: k }));
    return v;
  };
  const devices = list('devices').map((d, i) => sanitizeDevice(d, t('Gerätevorlage {n}', { n: i + 1 })));
  const templates = list('templates').map((d, i) => sanitizeTemplate(d, t('Vorlage {n}', { n: i + 1 })));
  const materials = list('materials').map((m, i) => {
    const e = sanitizeEntry(m);
    if (!e) throw new PackError(t('Material {n}: Einstellungen fehlen', { n: i + 1 }));
    // Stabile Kennung, damit ein Update des Pakets dieselben Einträge ersetzt
    const own = m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? (m as { id: string }).id.slice(0, 40) : String(i + 1);
    return { ...e, id: `pk:${id}:${own}`, pack: id };
  });
  if (new Set(materials.map((m) => m.id)).size !== materials.length) throw new PackError(t('Materialien mit doppelter Kennung'));
  const assets = list('assets').map((a, i) => {
    const where = t('Bibliotheks-Eintrag {n}', { n: i + 1 });
    try {
      const own = a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string' ? (a as { id: string }).id.trim().slice(0, 40) : '';
      return { ...parseAsset(a, where), id: own || String(i + 1) };
    } catch (e) {
      throw new PackError(e instanceof AssetError && e.message.startsWith(where) ? e.message : `${where}: ${(e as Error).message}`);
    }
  });
  if (new Set(assets.map((a) => a.id)).size !== assets.length) throw new PackError(t('Bibliotheks-Einträge mit doppelter Kennung'));
  const pluginList = list('plugins');
  if (pluginList.length && fv < PLUGIN_FORMAT_VERSION) throw new PackError(t('Plugins brauchen „formatVersion“: {n}', { n: PLUGIN_FORMAT_VERSION }));
  const plugins = pluginList.map((x, i) => {
    try {
      return parsePlugin(x, t('Plugin {n}', { n: i + 1 }));
    } catch (e) {
      throw new PackError(e instanceof ManifestError ? e.message : String(e));
    }
  });
  if (new Set(plugins.map((x) => x.id)).size !== plugins.length) throw new PackError(t('Plugins mit doppelter Kennung'));
  if (!devices.length && !templates.length && !materials.length && !assets.length && !plugins.length) throw new PackError(t('Die Erweiterung ist leer'));
  const pack: Pack = { id, version, name, devices, templates, materials, assets, plugins };
  if (minApp) pack.minApp = minApp;
  const description = str(localText(raw.description), 1000);
  if (description) pack.description = description;
  const author = str(raw.author, 120);
  if (author) pack.author = author;
  const homepage = str(raw.homepage, 300);
  if (/^https:\/\/[^\s]+$/.test(homepage)) pack.homepage = homepage;
  return pack;
}

/** Kurzbeschreibung des Inhalts, z. B. „3 Gerätevorlagen · 1 Vorlage“ */
export const packSummary = (p: Pack) => countSummary(p.devices.length, p.templates.length, p.materials.length, p.assets.length, p.plugins.length);

export function countSummary(devices: number, templates: number, materials: number, assets = 0, plugins = 0): string {
  const parts: string[] = [];
  if (devices) parts.push(tn('{n} Gerätevorlage', '{n} Gerätevorlagen', devices));
  if (templates) parts.push(tn('{n} Vorlage', '{n} Vorlagen', templates));
  if (materials) parts.push(tn('{n} Material', '{n} Materialien', materials));
  if (assets) parts.push(tn('{n} Bibliotheks-Eintrag', '{n} Bibliotheks-Einträge', assets));
  if (plugins) parts.push(tn('{n} Plugin', '{n} Plugins', plugins));
  return parts.join(' · ');
}

// ---------- Installierte Pakete ----------

export interface InstalledPack {
  file: string;
  pack: Pack;
  /** SHA-256 of the installed file (hex), to compare with the catalogue */
  sha256: string;
  /** Switched off by the user: its content and plugins are not active (#206) */
  disabled: boolean;
  /** Version kept from before the last update or install, for one rollback */
  previous?: string;
}
export interface BrokenPack {
  file: string;
  error: string;
}

let installed: InstalledPack[] = [];
let all: InstalledPack[] = [];
let broken: BrokenPack[] = [];
let ready: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Active packs (installed and not switched off) */
export const installedPacks = () => installed;
/** All installed packs, switched off ones included (the Extensions window) */
export const allPacks = () => all;
export const brokenPacks = () => broken;
export const onPacksChanged = (f: () => void) => void listeners.add(f);
export const packFileName = (id: string) => `${id}.${PACK_EXT}`;

/** Built-in presets from presets/devices, checked like pack presets; a broken file is skipped (the tests catch it) */
export function builtinPresets(): PresetEntry[] {
  const out: PresetEntry[] = [];
  for (const [file, raw] of Object.entries(builtinPresetFiles())) {
    try {
      out.push(sanitizeDevice(raw, file));
    } catch (e) {
      console.warn(e);
    }
  }
  return out;
}

export type PresetListEntry = PresetEntry & { pack?: string };

/**
 * One list entry per variant: name „Model (variant)“, the variant's work area and laser module, id „base:variant“.
 * A preset without variants stays as it is.
 */
export function expandVariants<T extends PresetEntry>(e: T): T[] {
  if (!e.variants?.length) return [e];
  return e.variants.map((v) => {
    const { variants: _drop, ...rest } = e;
    const preset: PackDevice = { ...e.preset, name: `${e.preset.name} (${v.name})` };
    if (v.bedW !== undefined) preset.bedW = v.bedW;
    if (v.bedH !== undefined) preset.bedH = v.bedH;
    if (v.laser) preset.laser = { ...e.preset.laser, ...v.laser };
    return { ...rest, preset, id: e.id ? `${e.id}:${v.id}` : undefined, base: e.id } as unknown as T;
  });
}

/**
 * Gerätevorlagen: eingebaute zuerst, dann die aus Erweiterungen, variants expanded into one entry each. A pack
 * preset with the id of an earlier one replaces it (with all its variants) in place.
 */
export function presetList(): PresetListEntry[] {
  const list: PresetListEntry[] = builtinPresets().flatMap((e) => expandVariants(e));
  for (const { pack } of installed)
    for (const d of pack.devices) {
      const items = expandVariants({ ...d, pack: pack.name } as PresetListEntry);
      const key = d.id;
      const at = key ? list.findIndex((x) => (x.base ?? x.id) === key) : -1;
      if (at >= 0) {
        const n = list.filter((x) => (x.base ?? x.id) === key).length;
        list.splice(at, n, ...items);
      } else list.push(...items);
    }
  return list;
}

/** Group key for presets without a manufacturer */
export const GENERIC_VENDOR = '';

/**
 * Presets grouped by manufacturer for the „New device from template“ selects: manufacturers alphabetically,
 * models alphabetically within each, then generic presets, then extension presets without a manufacturer.
 * `index` points into `list`.
 */
export function groupPresets(list: PresetListEntry[], lang?: string): { vendor: string; fromPack: boolean; items: { entry: PresetListEntry; index: number }[] }[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, lang, { sensitivity: 'base', numeric: true });
  const groups = new Map<string, { vendor: string; fromPack: boolean; items: { entry: PresetListEntry; index: number }[] }>();
  list.forEach((entry, index) => {
    const vendor = entry.vendor ?? GENERIC_VENDOR;
    const fromPack = !entry.vendor && !!entry.pack;
    const key = entry.vendor ? `v:${entry.vendor.toLowerCase()}` : fromPack ? 'pack' : 'generic';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { vendor, fromPack, items: [] }));
    g.items.push({ entry, index });
  });
  const rank = (g: { vendor: string; fromPack: boolean }) => (g.vendor ? 0 : g.fromPack ? 2 : 1);
  const out = [...groups.values()].sort((a, b) => rank(a) - rank(b) || cmp(a.vendor, b.vendor));
  for (const g of out) g.items.sort((a, b) => cmp(a.entry.preset.name, b.entry.preset.name));
  return out;
}

/** Bibliotheks-Einträge aus Erweiterungen; key = „Paket-Kennung/Eintrag“ */
export function packAssets(): { asset: AssetData; key: string; pack: string }[] {
  return installed.flatMap(({ pack }) => pack.assets.map((asset) => ({ asset, key: `${pack.id}/${asset.id}`, pack: pack.name })));
}

/** Vorlagen aus Erweiterungen; key = „Paket-Kennung/Nummer“ */
export function packTemplates(): (PackTemplate & { key: string; pack: string })[] {
  return installed.flatMap(({ pack }) => pack.templates.map((tp, i) => ({ ...tp, key: `${pack.id}/${i + 1}`, pack: pack.name })));
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const hasPackFolder = isTauri;
const STORE_KEY = 'kizamubeam.packs';
const DISABLED_KEY = 'kizamubeam.packs.disabled';
const VERIFIED_KEY = 'kizamubeam.packs.verified';
/** File name of the version kept for a rollback; „~“ cannot occur in a pack id */
const PREV = '~prev';
export const previousFileName = (id: string) => `${id}${PREV}.${PACK_EXT}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* settings storage not available: the state is not remembered */
  }
}
const disabledIds = () => new Set(readJson<string[]>(DISABLED_KEY, []));
/** SHA-256 of pack files that came from the signed catalogue, per pack id (current and previous version) */
const verifiedShas = () => readJson<Record<string, string[]>>(VERIFIED_KEY, {});

export async function textSha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether this installed file is one the signed catalogue delivered */
export const packVerified = (p: InstalledPack) => verifiedShas()[p.pack.id]?.includes(p.sha256) ?? false;

/** Remember that the catalogue lists exactly this file (called after the catalogue was checked) */
export function markVerified(id: string, sha256: string) {
  const v = verifiedShas();
  const list = v[id] ?? [];
  if (list.includes(sha256)) return;
  v[id] = [sha256, ...list].slice(0, 2);
  writeJson(VERIFIED_KEY, v);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(cmd, args);
}
function store(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function setStore(s: Record<string, string>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    throw new Error(t('Der Speicher des Browsers ist voll.'));
  }
}

async function readAll(): Promise<[string, string][]> {
  if (isTauri()) return invoke<[string, string][]>('pack_list');
  return Object.entries(store()).sort(([a], [b]) => a.localeCompare(b));
}

/** Installierte Pakete (neu) lesen; kaputte oder zu neue Dateien landen in brokenPacks() */
export async function loadPacks(): Promise<void> {
  const ok: InstalledPack[] = [];
  const bad: BrokenPack[] = [];
  const files = await readAll();
  const prev = new Map<string, string>();
  for (const [file, text] of files) if (file.endsWith(`${PREV}.${PACK_EXT}`)) prev.set(file, text);
  const off = disabledIds();
  for (const [file, text] of files) {
    if (prev.has(file)) continue;
    try {
      const pack = parsePack(text);
      const old = prev.get(previousFileName(pack.id));
      let previous: string | undefined;
      if (old) {
        try {
          previous = parsePack(old).version;
        } catch {
          /* kept version no longer readable: no rollback */
        }
      }
      ok.push({ file, pack, sha256: await textSha256(text), disabled: off.has(pack.id), ...(previous ? { previous } : {}) });
    } catch (e) {
      bad.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }
  ok.sort((a, b) => a.pack.name.localeCompare(b.pack.name));
  all = ok;
  installed = ok.filter((x) => !x.disabled);
  broken = bad;
  listeners.forEach((f) => f());
}

/** Beim ersten Aufruf laden; spätere Aufrufe warten nur darauf */
export function ensurePacks(): Promise<void> {
  ready ??= loadPacks().catch(() => {
    /* Ordner nicht lesbar: ohne Erweiterungen weiter */
  });
  return ready;
}

/** Was eine Installation bewirkt: neu, Update, gleiche oder ältere Version */
export function installKind(p: Pack): { kind: 'new' | 'update' | 'same' | 'downgrade'; old?: Pack } {
  const old = all.find((x) => x.pack.id === p.id)?.pack;
  if (!old) return { kind: 'new' };
  const c = compareVersions(p.version, old.version);
  return { kind: c > 0 ? 'update' : c === 0 ? 'same' : 'downgrade', old };
}

async function writeFile(file: string, text: string) {
  if (isTauri()) await invoke<void>('pack_write', { file, contents: text });
  else {
    const s = store();
    s[file] = text;
    setStore(s);
  }
}
async function deleteFile(file: string) {
  if (isTauri()) await invoke<void>('pack_delete', { file });
  else {
    const s = store();
    delete s[file];
    setStore(s);
  }
}

/**
 * Geprüftes Paket speichern (ersetzt eine installierte Version) und seine Materialien übernehmen. The replaced
 * version is kept for one rollback. verified: the text came from the signed catalogue.
 */
export async function installPack(text: string, opts: { verified?: boolean } = {}): Promise<Pack> {
  const p = parsePack(text);
  const file = packFileName(p.id);
  const old = (await readAll()).find(([f]) => f === file)?.[1];
  if (old && old !== text) await writeFile(previousFileName(p.id), old);
  await writeFile(file, text);
  if (opts.verified) markVerified(p.id, await textSha256(text));
  if (!disabledIds().has(p.id)) library.syncPack(p.id, p.materials);
  await loadPacks();
  return p;
}

/** Go back to the version kept before the last update (the current one is kept instead) */
export async function restorePrevious(id: string): Promise<Pack> {
  const text = (await readAll()).find(([f]) => f === previousFileName(id))?.[1];
  if (!text) throw new Error(t('Keine frühere Version vorhanden.'));
  return installPack(text);
}

/** Switch a pack off (its content and plugins disappear until it is switched on again) or on */
export async function setPackDisabled(id: string, disabled: boolean) {
  const off = disabledIds();
  if (disabled) off.add(id);
  else off.delete(id);
  writeJson(DISABLED_KEY, [...off]);
  const p = all.find((x) => x.pack.id === id)?.pack;
  library.syncPack(id, disabled || !p ? [] : p.materials);
  await loadPacks();
}

/** Paket entfernen; unveränderte Materialien daraus verschwinden aus der Bibliothek */
export async function removePack(file: string) {
  const id = all.find((x) => x.file === file)?.pack.id;
  await deleteFile(file);
  if (id) {
    if ((await readAll()).some(([f]) => f === previousFileName(id))) await deleteFile(previousFileName(id));
    library.syncPack(id, []);
    const off = disabledIds();
    if (off.delete(id)) writeJson(DISABLED_KEY, [...off]);
    const v = verifiedShas();
    if (v[id]) (delete v[id], writeJson(VERIFIED_KEY, v));
  }
  await loadPacks();
}

export async function openPackFolder() {
  if (isTauri()) await invoke<string>('pack_open_folder');
}
