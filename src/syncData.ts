// Einstellungen übertragen: lokale Daten je Bereich lesen und schreiben (siehe syncCore.ts für Format und Abgleich).
// Lädt bewusst keine Oberflächen-Module, weil der Abgleich beim Start läuft, bevor die App ihre Einstellungen liest.
import { deviceHash, hashText, hashValue, LocalItem, mergeDevice, SectionId } from './syncCore';

const PRE = 'kizamubeam.';

/** Allgemeine Einstellungen: Aussehen, Sprache, Fangen, Raster, zuletzt benutzte Werte der Dialoge */
export const SETTINGS_KEYS = [
  'theme', 'lang', 'snap', 'grid', 'boolean', 'updateChannel', 'updateAuto', 'fontFavorites', 'fontAutoInstall', 'imagePresets', 'check',
  'nest', 'joints', 'hinges', 'slots', 'qr', 'barcode', 'printcut', 'jigfill', 'focustest', 'materialtest', 'warp', 'calib', 'view3d',
  'workpieces',
].map((k) => PRE + k);
/** Schlüssel mit diesem Anfang zählen auch zu den Einstellungen (letzte Werte der Generatoren) */
export const SETTINGS_PREFIXES = [PRE + 'gen.'];
/** Oberfläche: Fenster, Leisten, Werkzeugkasten */
export const UI_KEYS = ['layout', 'toolbars', 'objectsPanel', 'apps'].map((k) => PRE + k);
export const CAMERA_KEYS = [PRE + 'camera'];
/** Bereiche mit eigenem Speicherort */
export const DEVICES_KEY = PRE + 'devices';
export const MATERIALS_KEY = PRE + 'materials';
const TEMPLATES_STORE = PRE + 'templates';
const PACKS_STORE = PRE + 'packs';
/**
 * Gehören immer zu diesem Rechner und werden nie übertragen: offene Dokumente, Update-Prüfung, Assistent,
 * Sicherungen der FluidNC-Konfiguration, altes Einzelgerät, Abgleich selbst. Jeder Schlüssel im Code muss in
 * einer dieser Listen stehen (npm run test:sync prüft das).
 */
export const LOCAL_KEYS = ['autosave', 'tabs', 'updateLastCheck', 'setupOffered', 'fluidBackups', 'materialtest.last', 'device', 'sync', 'syncKnown', 'syncFp', 'syncExport'].map(
  (k) => PRE + k,
);
export const BROWSER_STORES = [TEMPLATES_STORE, PACKS_STORE];

export interface Adapter {
  read(): Promise<Record<string, LocalItem>>;
  /** Änderungen schreiben: Wert oder null (löschen) je Kennung */
  write(changes: Record<string, unknown>): Promise<void>;
  /** Lässt sich bei laufender App übernehmen (sonst erst beim nächsten Start) */
  live: boolean;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(cmd, args);
}
const getItem = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const setItem = (k: string, v: string | null) => {
  if (v === null) localStorage.removeItem(k);
  else localStorage.setItem(k, v);
};
function storageKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(k);
    }
  } catch {
    /* kein Speicher */
  }
  return out;
}
const parse = <T>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) ?? d) : d;
  } catch {
    return d;
  }
};

/** Einzelne Schlüssel im lokalen Speicher; Kennung = Schlüssel, Wert = gespeicherter Text */
function keysAdapter(match: (k: string) => boolean): Adapter {
  return {
    live: false,
    async read() {
      const out: Record<string, LocalItem> = {};
      for (const k of storageKeys()) {
        if (!match(k)) continue;
        const v = getItem(k);
        if (v !== null) out[k] = { h: hashText(v), load: () => v };
      }
      return out;
    },
    async write(ch) {
      for (const [k, v] of Object.entries(ch)) if (match(k)) setItem(k, v === null ? null : String(v));
    },
  };
}

interface DeviceStoreRaw {
  devices: Record<string, unknown>[];
  current?: string;
}
const devicesAdapter: Adapter = {
  live: false,
  async read() {
    const st = parse<DeviceStoreRaw>(getItem(DEVICES_KEY), { devices: [] });
    const out: Record<string, LocalItem> = {};
    for (const d of Array.isArray(st.devices) ? st.devices : []) if (d && typeof d.id === 'string') out[d.id] = { h: deviceHash(d), load: () => d };
    return out;
  },
  async write(ch) {
    const st = parse<DeviceStoreRaw>(getItem(DEVICES_KEY), { devices: [] });
    let list = Array.isArray(st.devices) ? st.devices.filter((d) => d && typeof d.id === 'string') : [];
    for (const [id, v] of Object.entries(ch)) {
      const i = list.findIndex((d) => d.id === id);
      if (v === null) {
        if (i >= 0) list.splice(i, 1);
        continue;
      }
      if (!v || typeof v !== 'object') continue;
      const d = mergeDevice({ ...(v as Record<string, unknown>), id }, i >= 0 ? list[i] : undefined);
      if (i >= 0) list[i] = d;
      else list = [...list, d];
    }
    // Das gewählte Gerät bleibt je Rechner; fehlt es jetzt, nimmt die App das erste
    const current = list.some((d) => d.id === st.current) ? st.current : (list[0]?.id as string | undefined) ?? '';
    setItem(DEVICES_KEY, JSON.stringify({ devices: list, current }));
  },
};

interface MaterialStoreRaw {
  format?: string;
  version?: number;
  entries: Record<string, unknown>[];
}
const materialsAdapter: Adapter = {
  live: false,
  async read() {
    const st = parse<MaterialStoreRaw>(getItem(MATERIALS_KEY), { entries: [] });
    const out: Record<string, LocalItem> = {};
    for (const e of Array.isArray(st.entries) ? st.entries : []) if (e && typeof e.id === 'string') out[e.id] = { h: hashValue(e), load: () => e };
    return out;
  },
  async write(ch) {
    const st = parse<MaterialStoreRaw>(getItem(MATERIALS_KEY), { entries: [] });
    const list = Array.isArray(st.entries) ? st.entries.filter((e) => e && typeof e.id === 'string') : [];
    for (const [id, v] of Object.entries(ch)) {
      const i = list.findIndex((e) => e.id === id);
      if (v === null) {
        if (i >= 0) list.splice(i, 1);
      } else if (v && typeof v === 'object') {
        const e = { ...(v as Record<string, unknown>), id };
        if (i >= 0) list[i] = e;
        else list.push(e);
      }
    }
    setItem(MATERIALS_KEY, JSON.stringify({ format: 'kizamubeam-materials', version: 1, entries: list }));
  },
};

// ---------- Ordner: Bibliothek, Vorlagen, Erweiterungen ----------

type FolderKind = 'library' | 'templates' | 'packs';
const FOLDER_EXT: Record<FolderKind, RegExp> = { library: /\.kza$/i, templates: /\.kzt$/i, packs: /\.kzp$/i };
const FP_KEY = PRE + 'syncFp';

/** Gültiger Dateiname (wie in den Rust-Befehlen): kein Pfad, keine versteckte Datei, passende Endung */
export const validFile = (kind: FolderKind, f: string) => FOLDER_EXT[kind].test(f) && !f.startsWith('.') && !/[/\\:\0]/.test(f) && f.length <= 200;

/** Desktop: Dateien im Einstellungsordner; Prüfsummen werden nach Größe und Änderungszeit zwischengespeichert */
function folderAdapter(kind: FolderKind): Adapter {
  return {
    live: true,
    async read() {
      const rows = await invoke<[string, number, number][]>('sync_dir_stat', { kind });
      const cache = parse<Record<string, [string, string]>>(getItem(FP_KEY), {});
      const out: Record<string, LocalItem> = {};
      let dirty = false;
      for (const [file, size, mtime] of rows) {
        if (!validFile(kind, file)) continue;
        const fp = `${size}:${mtime}`;
        const ck = `${kind}/${file}`;
        const load = () => invoke<string>('sync_dir_read', { kind, file });
        if (cache[ck]?.[0] === fp) {
          out[file] = { h: cache[ck][1], load };
          continue;
        }
        const text = await load();
        const h = hashText(text);
        cache[ck] = [fp, h];
        dirty = true;
        out[file] = { h, load: () => text };
      }
      for (const ck of Object.keys(cache))
        if (ck.startsWith(kind + '/') && !(ck.slice(kind.length + 1) in out)) {
          delete cache[ck];
          dirty = true;
        }
      if (dirty)
        try {
          setItem(FP_KEY, JSON.stringify(cache));
        } catch {
          /* nur Zwischenspeicher */
        }
      return out;
    },
    async write(ch) {
      for (const [file, v] of Object.entries(ch)) {
        if (!validFile(kind, file)) continue;
        if (v === null) await invoke<void>('sync_dir_delete', { kind, file });
        else await invoke<void>('sync_dir_write', { kind, file, contents: String(v) });
      }
    },
  };
}

/** Browser: Vorlagen und Erweiterungen liegen als { Datei: Inhalt } im lokalen Speicher */
function storeAdapter(kind: FolderKind, key: string): Adapter {
  return {
    live: false,
    async read() {
      const out: Record<string, LocalItem> = {};
      for (const [f, v] of Object.entries(parse<Record<string, string>>(getItem(key), {}))) if (typeof v === 'string') out[f] = { h: hashText(v), load: () => v };
      return out;
    },
    async write(ch) {
      const s = parse<Record<string, string>>(getItem(key), {});
      for (const [f, v] of Object.entries(ch)) {
        if (!validFile(kind, f)) continue;
        if (v === null) delete s[f];
        else s[f] = String(v);
      }
      setItem(key, JSON.stringify(s));
    },
  };
}

/** Browser: Bibliothek in IndexedDB (über assetLibrary.ts) */
const browserLibrary: Adapter = {
  live: true,
  async read() {
    const { rawLibraryFiles } = await import('./assetLibrary');
    const out: Record<string, LocalItem> = {};
    for (const [f, v] of await rawLibraryFiles()) if (validFile('library', f)) out[f] = { h: hashText(v), load: () => v };
    return out;
  },
  async write(ch) {
    const { writeRawLibraryFiles } = await import('./assetLibrary');
    await writeRawLibraryFiles(Object.fromEntries(Object.entries(ch).filter(([f]) => validFile('library', f))) as Record<string, string | null>);
  },
};

const isSetting = (k: string) => SETTINGS_KEYS.includes(k) || SETTINGS_PREFIXES.some((p) => k.startsWith(p));

export function adapter(s: SectionId): Adapter {
  switch (s) {
    case 'settings':
      return keysAdapter(isSetting);
    case 'ui':
      return keysAdapter((k) => UI_KEYS.includes(k));
    case 'camera':
      return keysAdapter((k) => CAMERA_KEYS.includes(k));
    case 'devices':
      return devicesAdapter;
    case 'materials':
      return materialsAdapter;
    case 'library':
      return isTauri() ? folderAdapter('library') : browserLibrary;
    case 'templates':
      return isTauri() ? folderAdapter('templates') : storeAdapter('templates', TEMPLATES_STORE);
    case 'packs':
      return isTauri() ? folderAdapter('packs') : storeAdapter('packs', PACKS_STORE);
  }
}

/** Ist der Schlüssel im lokalen Speicher einem Bereich zugeordnet (oder bewusst lokal)? */
export function classifyKey(k: string): SectionId | 'local' | null {
  if (isSetting(k)) return 'settings';
  if (UI_KEYS.includes(k)) return 'ui';
  if (CAMERA_KEYS.includes(k)) return 'camera';
  if (k === DEVICES_KEY) return 'devices';
  if (k === MATERIALS_KEY) return 'materials';
  if (k === TEMPLATES_STORE) return 'templates';
  if (k === PACKS_STORE) return 'packs';
  if (LOCAL_KEYS.includes(k)) return 'local';
  return null;
}

/** Alle Einträge der gewählten Bereiche als „bereich/kennung“ */
export async function readLocal(sections: SectionId[]): Promise<Record<string, LocalItem>> {
  const out: Record<string, LocalItem> = {};
  for (const s of sections) {
    const items = await adapter(s).read();
    for (const [id, it] of Object.entries(items)) out[`${s}/${id}`] = it;
  }
  return out;
}

/** Änderungen („bereich/kennung“ → Wert oder null) in die Bereiche schreiben */
export async function writeLocal(changes: Record<string, unknown>): Promise<void> {
  const by: Partial<Record<SectionId, Record<string, unknown>>> = {};
  for (const [k, v] of Object.entries(changes)) {
    const i = k.indexOf('/');
    const s = k.slice(0, i) as SectionId;
    (by[s] ??= {})[k.slice(i + 1)] = v;
  }
  for (const [s, ch] of Object.entries(by)) await adapter(s as SectionId).write(ch!);
}
