// Bibliothek: eigene Motive, Bilder und Designelemente zum Wiederverwenden. Die Einträge (.kza, Format in
// assetFormat.ts) liegen in der Desktop-App im Bibliotheks-Ordner im Einstellungsordner (Rust: library.rs),
// im Browser in IndexedDB (Bilder sind für den lokalen Speicher zu groß). Dazu kommen die Einträge aus
// installierten Erweiterungen und die mitgelieferten (builtinLibrary.ts); beide lassen sich nicht ändern oder
// löschen.
import { AssetData, AssetMeta, assetFileName, assetJson, assetMeta, parseAsset, searchAssets, AssetCategory } from './assetFormat';
import { ensurePacks, onPacksChanged, packAssets } from './packs';
import { builtinAsset, builtinAssets } from './builtinLibrary';
import { t } from './i18n';

export interface LibraryItem {
  /** Kennung: Dateiname im Ordner (z. B. „Rose.kza“), „pack:Paket/Eintrag“ oder „builtin:Eintrag“ */
  key: string;
  meta: AssetMeta;
  /** Name der Erweiterung, aus der der Eintrag kommt (nicht änderbar) */
  pack?: string;
  /** Mitgelieferter Eintrag (nicht änderbar) mit seiner Gruppe (GROUPS in builtinFormat.ts) */
  builtin?: string;
  /** Reihenfolge in der Liste: eigene (0), aus Erweiterungen (1), mitgelieferte (2) */
  source?: number;
  /** Datei ließ sich nicht lesen */
  broken?: string;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const hasLibraryFolder = isTauri;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(cmd, args);
}

// ---------- Browser: IndexedDB (ohne IndexedDB, z. B. in Tests: nur im Arbeitsspeicher) ----------

const DB_NAME = 'kizamubeam-library';
const STORE = 'files';
const memory = new Map<string, string>();
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((res) => {
    if (typeof indexedDB === 'undefined') return res(null);
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  return dbp;
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll(): Promise<[string, string][]> {
  const d = await db();
  if (!d) return [...memory.entries()];
  const st = d.transaction(STORE).objectStore(STORE);
  const [keys, vals] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
  return keys.map((k, i) => [String(k), String(vals[i])]);
}
async function idbGet(file: string): Promise<string | undefined> {
  const d = await db();
  if (!d) return memory.get(file);
  return req(d.transaction(STORE).objectStore(STORE).get(file));
}
async function idbPut(file: string, text: string | null) {
  const d = await db();
  if (!d) {
    if (text === null) memory.delete(file);
    else memory.set(file, text);
    return;
  }
  const st = d.transaction(STORE, 'readwrite').objectStore(STORE);
  try {
    if (text === null) await req(st.delete(file));
    else await req(st.put(text, file));
  } catch {
    throw new Error(t('Der Speicher des Browsers ist voll.'));
  }
}

// ---------- Ordner ----------

let cache: LibraryItem[] | null = null;
const listeners = new Set<() => void>();
export const onLibraryChanged = (f: () => void) => (listeners.add(f), () => listeners.delete(f));
const changed = () => {
  cache = null;
  listeners.forEach((f) => f());
};
onPacksChanged(changed);

/** Eigene Einträge: Angaben ohne Objekte und Bilder */
async function ownItems(): Promise<LibraryItem[]> {
  const rows: [string, string][] = isTauri() ? await invoke<[string, string][]>('library_list') : await idbAll();
  return rows
    .filter(([file]) => /\.kza$/i.test(file))
    .map(([file, json]): LibraryItem => {
      try {
        // Die Desktop-App liefert nur die Angaben; Objekte fehlen dort, damit die Liste schnell bleibt
        const raw = JSON.parse(json);
        if (raw === null) throw new Error(t('Datei nicht lesbar'));
        const meta = isTauri() ? metaOnly(raw, file) : assetMeta(parseAsset(raw));
        return { key: file, meta };
      } catch (e) {
        return { key: file, meta: { name: file.replace(/\.kza$/i, ''), category: 'motif', tags: [], w: 0, h: 0 }, broken: (e as Error).message };
      }
    });
}

/** Angaben aus der Liste der Desktop-App (ohne Objekte) bereinigen */
function metaOnly(raw: Record<string, unknown>, file: string): AssetMeta {
  // parseAsset braucht Objekte: mit einem Platzhalter prüfen und nur die Angaben übernehmen
  return assetMeta(parseAsset({ ...raw, name: raw.name || file.replace(/\.kza$/i, ''), objs: [{ m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'path', subs: [] } }] }));
}

/** Alle Einträge: eigene, dann die aus Erweiterungen */
export async function libraryItems(): Promise<LibraryItem[]> {
  if (cache) return cache;
  await ensurePacks();
  let own: LibraryItem[] = [];
  try {
    own = await ownItems();
  } catch {
    /* Ordner nicht lesbar: nur Erweiterungen */
  }
  own.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  const packs = packAssets().map(({ asset, key, pack }): LibraryItem => ({ key: `pack:${key}`, meta: assetMeta(asset), pack, source: 1 }));
  let builtin: LibraryItem[] = [];
  try {
    builtin = (await builtinAssets()).map(({ key, asset, group }): LibraryItem => ({ key, meta: assetMeta(asset), builtin: group, source: 2 }));
  } catch {
    /* mitgelieferte Einträge nicht ladbar: ohne sie */
  }
  cache = [...own, ...packs, ...builtin];
  return cache;
}

/** Einträge suchen (siehe searchAssets) */
export async function findAssets(query = '', category: AssetCategory | '' = ''): Promise<LibraryItem[]> {
  return searchAssets(await libraryItems(), query, category);
}

/** Vollständigen Eintrag laden */
export async function loadLibraryAsset(key: string): Promise<AssetData> {
  if (key.startsWith('builtin:')) {
    const a = await builtinAsset(key);
    if (!a) throw new Error(t('Eintrag „{name}“ nicht gefunden', { name: key }));
    return a;
  }
  if (key.startsWith('pack:')) {
    await ensurePacks();
    const p = packAssets().find((x) => `pack:${x.key}` === key);
    if (!p) throw new Error(t('Eintrag „{name}“ nicht gefunden', { name: key }));
    return structuredClone(p.asset);
  }
  const text = isTauri() ? await invoke<string>('library_read', { file: key }) : await idbGet(key);
  if (text === undefined) throw new Error(t('Eintrag „{name}“ nicht gefunden', { name: key }));
  return parseAsset(text);
}

/** Neuen Eintrag speichern; liefert den Dateinamen (aus dem Namen, bei Gleichheit mit Nummer) */
export async function addToLibrary(a: AssetData): Promise<string> {
  const own = (await libraryItems()).filter((x) => !x.source).map((x) => x.key);
  const file = assetFileName(a.name, own);
  await writeFile(file, assetJson({ ...a, created: a.created ?? new Date().toISOString() }));
  return file;
}

/** Eigenen Eintrag ersetzen (z. B. Name, Art, Stichwörter geändert) */
export async function updateLibraryAsset(file: string, a: AssetData) {
  if (file.startsWith('pack:')) throw new Error(t('Einträge aus Erweiterungen lassen sich nicht ändern.'));
  if (file.startsWith('builtin:')) throw new Error(t('Mitgelieferte Einträge lassen sich nicht ändern. Füge den Eintrag ein und speichere ihn mit „+ Auswahl“ als eigenen.'));
  await writeFile(file, assetJson(a));
}

async function writeFile(file: string, json: string) {
  if (isTauri()) await invoke<void>('library_write', { file, contents: json });
  else await idbPut(file, json);
  changed();
}

export async function removeFromLibrary(file: string) {
  if (file.startsWith('pack:')) throw new Error(t('Einträge aus Erweiterungen lassen sich nicht löschen. Entferne dazu die Erweiterung.'));
  if (file.startsWith('builtin:')) throw new Error(t('Mitgelieferte Einträge lassen sich nicht löschen.'));
  if (isTauri()) await invoke<void>('library_delete', { file });
  else await idbPut(file, null);
  changed();
}

export async function openLibraryFolder() {
  if (isTauri()) await invoke<string>('library_open_folder');
}

/** Liste neu lesen (z. B. nachdem Dateien von Hand in den Ordner gelegt wurden) */
export const reloadLibrary = changed;

/** Browser: alle eigenen Dateien unverändert (für Einstellungen übertragen, syncData.ts) */
export const rawLibraryFiles = (): Promise<[string, string][]> => idbAll();

/** Browser: Dateien unverändert schreiben (Inhalt) oder löschen (null) */
export async function writeRawLibraryFiles(files: Record<string, string | null>) {
  for (const [f, v] of Object.entries(files)) await idbPut(f, v);
  changed();
}
