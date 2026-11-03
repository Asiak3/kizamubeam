// Einstellungen übertragen: Datenformat und Abgleich ohne Abhängigkeiten von der Oberfläche (testbar in Node).
//
// Alle übertragbaren Daten sind Einträge „bereich/kennung“ (z. B. „devices/e6pro“, „settings/kizamubeam.theme“,
// „library/Rose.kza“). Export/Import schreibt sie als eine .kzs-Datei. Beim Synchronisieren über einen Ordner
// schreibt jeder Rechner nur seine eigene Datei (<rechner>.kzsync) und liest die der anderen; so entstehen in
// iCloud, Dropbox oder Nextcloud keine Konfliktkopien. Je Eintrag gewinnt die neueste Änderung (Zeitstempel t),
// gelöschte Einträge bleiben als Grabstein (del) stehen, damit die Löschung bei den anderen ankommt.

export const SECTIONS = ['settings', 'devices', 'materials', 'library', 'templates', 'packs', 'ui', 'camera'] as const;
export type SectionId = (typeof SECTIONS)[number];

/** Bereiche, die beim Synchronisieren nie übertragen werden (gehören zum Rechner) */
export const LOCAL_ONLY: SectionId[] = ['camera'];

export const BUNDLE_FORMAT = 'kizamubeam-settings';
export const BUNDLE_EXT = 'kzs';
export const SYNC_FORMAT = 'kizamubeam-sync';
export const SYNC_EXT = 'kzsync';

/** Ein Eintrag im Abgleich: Prüfsumme h, Zeit der letzten Änderung t, Wert v (fehlt bei Grabsteinen) */
export interface Entry {
  h: string;
  t: number;
  v?: unknown;
  del?: true;
  /** Name des Rechners, auf dem die Änderung entstand */
  by?: string;
}
export type State = Record<string, Entry>;
/** Was dieser Rechner zuletzt abgeglichen hat: Prüfsumme und Zeit je Eintrag (ohne Werte) */
export type Known = Record<string, { h: string; t: number; del?: true }>;

export const sectionOf = (key: string) => key.slice(0, key.indexOf('/')) as SectionId;
export const itemOf = (key: string) => key.slice(key.indexOf('/') + 1);
export const keyOf = (s: SectionId, id: string) => `${s}/${id}`;

/** JSON mit sortierten Schlüsseln: gleiche Daten ergeben unabhängig von der Reihenfolge den gleichen Text */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/** Schnelle 53-Bit-Prüfsumme (cyrb53) als Text; reicht, um Änderungen zu erkennen */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const hashValue = (v: unknown) => hashText(typeof v === 'string' ? v : stableJson(v));

/** Lokaler Stand eines Eintrags: Prüfsumme und (bei Bedarf geladener) Wert */
export interface LocalItem {
  h: string;
  load: () => unknown | Promise<unknown>;
}

export interface MergeResult {
  /** Zusammengeführter Stand (Werte nur, wo bekannt; siehe needValues) */
  merged: State;
  /** Einträge, die lokal geändert werden müssen: neuer Wert oder null (löschen) */
  incoming: Record<string, Entry>;
  /** Lokal geänderte Einträge, die eine neuere Änderung eines anderen Rechners überschreibt */
  conflicts: { key: string; by?: string }[];
  /** Neuer bekannter Stand */
  known: Known;
}

const newer = (a: Entry, b: Entry) => a.t > b.t || (a.t === b.t && a.h > b.h);

/**
 * Lokalen Stand mit den Dateien der anderen Rechner abgleichen.
 * local: was jetzt auf diesem Rechner ist; known: Stand des letzten Abgleichs; remotes: Dateien aller Rechner
 * (auch die eigene); now: jetzige Zeit für lokale Änderungen. Nur Einträge der Bereiche in `sections` zählen.
 * Werte lokal geänderter Einträge fehlen in merged und werden erst beim Schreiben geladen (needValues).
 */
export function mergeStates(local: Record<string, LocalItem>, known: Known, remotes: State[], now: number, me: string, sections: SectionId[]): MergeResult {
  const on = new Set(sections);
  const use = (k: string) => on.has(sectionOf(k));
  // Lokaler Stand als Einträge: unverändert seit dem letzten Abgleich → alte Zeit, sonst jetzt
  const mine: State = {};
  for (const [k, it] of Object.entries(local)) {
    if (!use(k)) continue;
    const kn = known[k];
    mine[k] = kn && !kn.del && kn.h === it.h ? { h: it.h, t: kn.t } : { h: it.h, t: now, by: me };
  }
  for (const [k, kn] of Object.entries(known)) {
    if (!use(k) || k in mine) continue;
    mine[k] = kn.del ? { h: '', t: kn.t, del: true } : { h: '', t: now, del: true, by: me };
  }
  const changedHere = (k: string) => mine[k] && mine[k].t === now && (!known[k] || known[k].h !== mine[k].h || !!known[k].del !== !!mine[k].del);

  const merged: State = { ...mine };
  for (const r of remotes)
    for (const [k, e] of Object.entries(r)) {
      if (!use(k) || !e || typeof e.t !== 'number' || typeof e.h !== 'string') continue;
      const cur = merged[k];
      if (!cur || newer(e, cur)) merged[k] = e;
    }

  const incoming: Record<string, Entry> = {};
  const conflicts: { key: string; by?: string }[] = [];
  for (const [k, e] of Object.entries(merged)) {
    const l = local[k];
    const same = e.del ? !l : l && l.h === e.h;
    if (same) continue;
    if (e.del && !l) continue;
    incoming[k] = e;
    if (changedHere(k)) conflicts.push({ key: k, by: e.by });
  }
  const knownOut: Known = {};
  for (const [k, e] of Object.entries(merged)) knownOut[k] = e.del ? { h: '', t: e.t, del: true } : { h: e.h, t: e.t };
  return { merged, incoming, conflicts, known: knownOut };
}

/** Welche Einträge brauchen für die eigene Datei noch ihren Wert (lokal geändert, keine Kopie in einer Datei)? */
export function needValues(merged: State, ownFile: State | null): string[] {
  const out: string[] = [];
  for (const [k, e] of Object.entries(merged)) {
    if (e.del || e.v !== undefined) continue;
    const o = ownFile?.[k];
    if (o && o.h === e.h && o.v !== undefined) e.v = o.v;
    else out.push(k);
  }
  return out;
}

/** Hat sich der Inhalt gegenüber der eigenen Datei geändert (dann neu schreiben)? */
export function stateDiffers(a: State, b: State | null): boolean {
  if (!b) return true;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  if (ka.length !== kb.length) return true;
  return ka.some((k) => !b[k] || b[k].h !== a[k].h || b[k].t !== a[k].t || !!b[k].del !== !!a[k].del);
}

// ---------- Dateien ----------

export interface SyncFile {
  format: typeof SYNC_FORMAT;
  version: 1;
  machine: { id: string; name: string };
  app: string;
  written: number;
  items: State;
}

export function parseSyncFile(text: string): SyncFile | null {
  try {
    const o = JSON.parse(text);
    if (!o || o.format !== SYNC_FORMAT || typeof o.items !== 'object' || !o.items || Array.isArray(o.items)) return null;
    if (typeof o.version !== 'number' || o.version > 1) return null;
    const items: State = {};
    for (const [k, e] of Object.entries(o.items as Record<string, Entry>)) {
      if (!k.includes('/') || !(SECTIONS as readonly string[]).includes(sectionOf(k))) continue;
      if (!e || typeof e.h !== 'string' || typeof e.t !== 'number' || !isFinite(e.t)) continue;
      if (!e.del && e.v === undefined) continue;
      items[k] = e.del ? { h: '', t: e.t, del: true, ...(typeof e.by === 'string' ? { by: e.by } : {}) } : { h: e.h, t: e.t, v: e.v, ...(typeof e.by === 'string' ? { by: e.by } : {}) };
    }
    return { format: SYNC_FORMAT, version: 1, machine: { id: String(o.machine?.id ?? ''), name: String(o.machine?.name ?? '') }, app: String(o.app ?? ''), written: Number(o.written) || 0, items };
  } catch {
    return null;
  }
}

/** Dateiname der eigenen Datei im Sync-Ordner: lesbarer Rechnername plus Kennung */
export function syncFileName(name: string, id: string): string {
  const clean = name.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Rechner';
  return `${clean}-${id.slice(0, 8)}.${SYNC_EXT}`;
}

// ---------- Export-Datei ----------

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  app: string;
  created: string;
  machine?: string;
  sections: Partial<Record<SectionId, Record<string, unknown>>>;
}

export function makeBundle(sections: Bundle['sections'], app: string, machine?: string, created = new Date().toISOString()): Bundle {
  return { format: BUNDLE_FORMAT, version: 1, app, created, ...(machine ? { machine } : {}), sections };
}

export function parseBundle(text: string): Bundle {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error('invalid');
  }
  if (!o || o.format !== BUNDLE_FORMAT || typeof o.sections !== 'object' || !o.sections) throw new Error('invalid');
  if (typeof o.version !== 'number' || o.version > 1) throw new Error('newer');
  const sections: Bundle['sections'] = {};
  for (const s of SECTIONS) {
    const v = (o.sections as Record<string, unknown>)[s];
    if (v && typeof v === 'object' && !Array.isArray(v)) sections[s] = v as Record<string, unknown>;
  }
  return { format: BUNDLE_FORMAT, version: 1, app: String(o.app ?? ''), created: String(o.created ?? ''), ...(typeof o.machine === 'string' ? { machine: o.machine } : {}), sections };
}

// ---------- Geräte: Verbindung bleibt je Rechner ----------

/** Felder eines Geräts, die zum Rechner gehören (USB-Anschluss, Adresse, Ports, Verbindungsart) */
export const DEVICE_LOCAL_FIELDS = ['conn', 'port', 'host', 'tcpPort', 'wsPort', 'httpPort'] as const;

/** Prüfsumme eines Geräts ohne die Verbindungsangaben: ein anderer Anschluss ist keine Änderung */
export function deviceHash(d: unknown): string {
  if (!d || typeof d !== 'object') return hashValue(d);
  const c = { ...(d as Record<string, unknown>) };
  for (const f of DEVICE_LOCAL_FIELDS) delete c[f];
  return hashValue(c);
}

/** Übernommenes Gerät: Verbindung eines schon vorhandenen Geräts bleibt, neue Geräte bringen ihre mit */
export function mergeDevice(incoming: Record<string, unknown>, local: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!local) return { ...incoming };
  const out = { ...incoming };
  for (const f of DEVICE_LOCAL_FIELDS) if (f in local) out[f] = local[f];
  return out;
}
