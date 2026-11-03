// Einstellungen übertragen: Export/Import als Datei und Abgleich über einen frei wählbaren Ordner (Desktop-App).
// Format und Regeln in syncCore.ts, lokale Daten in syncData.ts, Fenster in syncDialog.ts.
//
// Beim Start läuft ein Abgleich, bevor die App ihre Einstellungen liest (main.ts); dann wird alles sofort
// übernommen. Während die App läuft, gleicht sie alle 30 s, beim Wechsel zurück ins Fenster und kurz nach jeder
// Änderung ab. Bibliothek, Vorlagen und Erweiterungen kommen dann sofort an; Einstellungen, Geräte, Materialien
// und Oberfläche liegen schon im Arbeitsspeicher und werden erst nach „Neu laden“ übernommen (bis dahin bleiben
// sie lokal unverändert, damit die App sie nicht mit dem alten Stand überschreibt).
// Lädt keine Oberflächen-Module (auch nicht i18n), weil es vor ihnen läuft.
import {
  Bundle, itemOf, Known, LOCAL_ONLY, makeBundle, mergeStates, needValues, parseSyncFile, SectionId, SECTIONS, sectionOf, State, stateDiffers,
  SyncFile, syncFileName, SYNC_FORMAT,
} from './syncCore';
import { adapter, classifyKey, readLocal, writeLocal } from './syncData';
import { version as APP_VERSION } from '../package.json';

const CFG_KEY = 'kizamubeam.sync';
const KNOWN_KEY = 'kizamubeam.syncKnown';
const INTERVAL = 30_000;

export interface SyncConfig {
  enabled: boolean;
  folder: string;
  sections: SectionId[];
  machineId: string;
  machineName: string;
}
export interface SyncStatus {
  /** Zeit des letzten erfolgreichen Abgleichs */
  last: number;
  error: string;
  running: boolean;
  /** Änderungen anderer Rechner, die erst nach dem Neuladen gelten: Bereiche und Rechner */
  pending: { sections: SectionId[]; from: string[] };
  /** Lokale Änderungen, die eine neuere Änderung eines anderen Rechners ersetzt hat (seit dem Start) */
  conflicts: { key: string; by?: string }[];
  /** Andere Rechner im Ordner */
  machines: { name: string; written: number }[];
}

export const SYNC_DEFAULT_SECTIONS: SectionId[] = ['settings', 'devices', 'materials', 'library', 'templates', 'packs', 'ui'];
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(cmd, args);
}
const readJson = <T>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d;
  } catch {
    return d;
  }
};
const writeJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* nicht speicherbar */
  }
};
const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function syncConfig(): SyncConfig {
  const c = readJson<Partial<SyncConfig>>(CFG_KEY, {});
  const sections = Array.isArray(c.sections) ? c.sections.filter((s) => SECTIONS.includes(s) && !LOCAL_ONLY.includes(s)) : SYNC_DEFAULT_SECTIONS;
  return { enabled: !!c.enabled, folder: String(c.folder ?? ''), sections, machineId: c.machineId || newId(), machineName: String(c.machineName ?? '') };
}
export function setSyncConfig(c: SyncConfig) {
  writeJson(CFG_KEY, c);
}

// ---------- Export / Import ----------

/** Gewählte Bereiche als .kzs-Datei */
export async function exportBundle(sections: SectionId[], machine?: string): Promise<string> {
  const local = await readLocal(sections);
  const out: Bundle['sections'] = {};
  for (const [k, it] of Object.entries(local)) (out[sectionOf(k)] ??= {})[itemOf(k)] = await it.load();
  for (const s of sections) out[s] ??= {};
  return JSON.stringify(makeBundle(out, APP_VERSION, machine), null, 1);
}

/** Wie viele Einträge je Bereich die Datei enthält */
export const bundleCounts = (b: Bundle) => Object.fromEntries(Object.entries(b.sections).map(([s, v]) => [s, Object.keys(v ?? {}).length])) as Partial<Record<SectionId, number>>;

/**
 * Bereiche aus einer Datei übernehmen. merge: Einträge der Datei kommen dazu bzw. ersetzen gleichnamige, alle
 * anderen bleiben; replace: Einträge, die in der Datei fehlen, werden gelöscht. Verbindungsangaben schon
 * vorhandener Geräte bleiben. Gibt die Zahl der geänderten Einträge zurück; danach muss die App neu laden.
 */
export async function importBundle(b: Bundle, sections: SectionId[], mode: 'merge' | 'replace'): Promise<number> {
  const changes: Record<string, unknown> = {};
  for (const s of sections) {
    const items = b.sections[s];
    if (!items) continue;
    for (const [id, v] of Object.entries(items)) if (v !== null && v !== undefined) changes[`${s}/${id}`] = v;
    if (mode === 'replace') for (const id of Object.keys(await adapter(s).read())) if (!(id in items)) changes[`${s}/${id}`] = null;
  }
  await writeLocal(changes);
  return Object.keys(changes).length;
}

// ---------- Abgleich über einen Ordner ----------

const status: SyncStatus = { last: 0, error: '', running: false, pending: { sections: [], from: [] }, conflicts: [], machines: [] };
const statusListeners = new Set<(s: SyncStatus) => void>();
const liveListeners = new Set<(sections: SectionId[]) => void>();
export const syncStatus = () => status;
export const onSyncStatus = (f: (s: SyncStatus) => void) => (statusListeners.add(f), () => statusListeners.delete(f));
/** Bibliothek, Vorlagen oder Erweiterungen wurden während des Laufs geändert (Listen neu lesen) */
export const onLiveSync = (f: (sections: SectionId[]) => void) => (liveListeners.add(f), () => liveListeners.delete(f));
const emit = () => statusListeners.forEach((f) => f(status));

/** Eingelesene Dateien der Rechner, nach Name mit Änderungszeit (nur geänderte Dateien neu lesen) */
const fileCache = new Map<string, { mtime: number; file: SyncFile | null }>();
let running: Promise<void> | null = null;
let again = false;

/**
 * Einmal abgleichen. startup: alle Änderungen sofort übernehmen (die App hat noch nichts gelesen).
 * first: erster Abgleich mit einem Ordner, in dem schon Daten liegen: 'pull' = Ordner gilt, wo beide etwas
 * haben; 'push' = dieser Rechner gilt.
 */
export async function syncNow(opts: { startup?: boolean; first?: 'pull' | 'push' } = {}): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    status.running = true;
    emit();
    try {
      await syncOnce(opts);
      status.error = '';
      status.last = Date.now();
    } catch (e) {
      status.error = e instanceof Error ? e.message : String(e);
    } finally {
      status.running = false;
      running = null;
      emit();
    }
    if (again) {
      again = false;
      await syncNow();
    }
  })();
  return running;
}

/** Dateien der anderen Rechner im Ordner (ohne die eigene) */
export async function folderMachines(folder: string, ownName = ''): Promise<{ name: string; written: number; items: number }[]> {
  const rows = await invoke<[string, number, number][]>('sync_list', { folder });
  const out = [];
  for (const [name, mtime] of rows) {
    if (name === ownName) continue;
    const f = await readSyncFile(folder, name, mtime);
    if (f) out.push({ name: f.machine.name || name, written: f.written, items: Object.keys(f.items).length });
  }
  return out;
}

async function readSyncFile(folder: string, name: string, mtime: number): Promise<SyncFile | null> {
  const c = fileCache.get(`${folder}\n${name}`);
  if (c && c.mtime === mtime) return c.file;
  let file: SyncFile | null = null;
  try {
    file = parseSyncFile(await invoke<string>('sync_read', { folder, name }));
  } catch {
    /* gerade nicht lesbar (z. B. noch nicht heruntergeladen): beim nächsten Mal */
    return c?.file ?? null;
  }
  fileCache.set(`${folder}\n${name}`, { mtime, file });
  return file;
}

async function syncOnce(opts: { startup?: boolean; first?: 'pull' | 'push' }) {
  const cfg = syncConfig();
  if (!cfg.enabled || !cfg.folder || !isDesktop()) return;
  const sections = cfg.sections.filter((s) => !LOCAL_ONLY.includes(s));
  const me = cfg.machineName || 'KizamuBeam';
  const ownName = syncFileName(me, cfg.machineId);

  const rows = await invoke<[string, number, number][]>('sync_list', { folder: cfg.folder });
  let own: SyncFile | null = null;
  const remotes: State[] = [];
  const machines: SyncStatus['machines'] = [];
  for (const [name, mtime] of rows) {
    const f = await readSyncFile(cfg.folder, name, mtime);
    if (!f) continue;
    if (name === ownName || f.machine.id === cfg.machineId) {
      if (name === ownName) own = f;
      // eine umbenannte eigene Datei zählt wie ein anderer Rechner (ihr Stand ist ja bekannt)
      else remotes.push(f.items);
      continue;
    }
    remotes.push(f.items);
    machines.push({ name: f.machine.name || name, written: f.written });
  }
  if (own) remotes.push(own.items);

  const local = await readLocal(sections);
  const known = readJson<Known>(KNOWN_KEY, {});
  const now = Date.now();
  // Erster Abgleich „Ordner gilt“: lokale Einträge zählen als uralt, kommen aber dazu, wo der Ordner nichts hat
  const res = mergeStates(local, known, remotes, opts.first === 'pull' ? 0 : now, me, sections);

  // Übernehmen: beim Start alles, sonst nur, was die App sofort neu einlesen kann
  const apply: Record<string, unknown> = {};
  const live = new Set<SectionId>();
  const pending = new Set<SectionId>();
  const from = new Set<string>();
  for (const [k, e] of Object.entries(res.incoming)) {
    const s = sectionOf(k);
    if (opts.startup || adapter(s).live) {
      apply[k] = e.del ? null : e.v;
      live.add(s);
    } else {
      pending.add(s);
      if (e.by) from.add(e.by);
      // Bekannten Stand nicht vorziehen: sonst sähe der alte lokale Wert beim nächsten Mal wie eine Änderung aus
      if (known[k]) res.known[k] = known[k];
      else delete res.known[k];
    }
  }
  await writeLocal(apply);
  if (res.conflicts.length) status.conflicts = [...status.conflicts, ...res.conflicts].slice(-50);

  // Eigene Datei: zusammengeführter Stand mit allen Werten
  for (const k of needValues(res.merged, own?.items ?? null)) res.merged[k].v = await local[k]?.load();
  for (const [k, e] of Object.entries(res.merged)) if (!e.del && e.v === undefined) delete res.merged[k];
  if (stateDiffers(res.merged, own?.items ?? null)) {
    const file: SyncFile = { format: SYNC_FORMAT, version: 1, machine: { id: cfg.machineId, name: me }, app: APP_VERSION, written: now, items: res.merged };
    await invoke<void>('sync_write', { folder: cfg.folder, name: ownName, contents: JSON.stringify(file) });
  }
  writeJson(KNOWN_KEY, res.known);
  status.pending = { sections: [...pending], from: [...from] };
  status.machines = machines;
  if (!opts.startup && live.size) liveListeners.forEach((f) => f([...live]));
}

/** Bekannten Stand vergessen (neuer Ordner): der nächste Abgleich ist wieder ein erster */
export function resetSyncState() {
  try {
    localStorage.removeItem(KNOWN_KEY);
  } catch {
    /* egal */
  }
  fileCache.clear();
  status.conflicts = [];
  status.pending = { sections: [], from: [] };
}

/** Beim Start vor allen anderen Modulen: höchstens einige Sekunden warten, dann ohne Abgleich weiter */
export async function startupSync(): Promise<void> {
  const cfg = syncConfig();
  if (!cfg.enabled || !cfg.folder || !isDesktop()) return;
  await Promise.race([syncNow({ startup: true }), new Promise((r) => setTimeout(r, 8000))]);
}

let timer = 0;
let loopStarted = false;
/** Regelmäßig abgleichen, solange die App läuft */
export function startSyncLoop() {
  if (loopStarted || !isDesktop()) return;
  loopStarted = true;
  const tick = () => {
    if (syncConfig().enabled) void syncNow();
  };
  setInterval(tick, INTERVAL);
  window.addEventListener('focus', tick);
  // Kurz nach einer Änderung an übertragbaren Einstellungen abgleichen
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k: string, v: string) {
    set.call(this, k, v);
    if (this === localStorage && k.startsWith('kizamubeam.') && classifyKey(k) !== 'local' && classifyKey(k) !== null) {
      clearTimeout(timer);
      timer = window.setTimeout(tick, 3000);
    }
  };
}
/** Nach Änderungen an Bibliothek, Vorlagen oder Erweiterungen aufrufen */
export function syncSoon() {
  if (!isDesktop() || !syncConfig().enabled) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), 3000);
}
