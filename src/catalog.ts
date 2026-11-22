// Katalog der Erweiterungen: eine Liste offizieller Pakete auf GitHub Pages (Quellen in packs/ im Repository),
// signiert mit einem eigenen Ed25519-Schlüssel (nicht dem des Updaters). Die App lädt die Liste, prüft die
// Signatur und für jedes geladene Paket die SHA-256-Prüfsumme aus der Liste. Erzeugt wird der Katalog beim
// Veröffentlichen der Website (scripts/build-catalog.ts, scripts/sign-catalog.mjs).
// Die Logik wird mit `npm run test:catalog` getestet.
import { etc, verifyAsync } from '@noble/ed25519';
import { compareVersions } from './updates';
import { localText, Pack, parsePack, PACK_EXT } from './packs';
import { t } from './i18n';
import { PLUGIN_API } from './plugins/contract';
import { codeBytes } from './plugins/manifest';

/**
 * Where the signed catalogue is published, tried in this order. GitHub Pages of the KizamuBeam organization first,
 * then the webspace mirror of kizamubeam.com (pages.yml, branch `webspace`). The signature is checked either way,
 * so any mirror is fine. The repository used to live at negurvulkan/kizamubeam; its old Pages address is kept
 * last in case it is still served.
 */
export const CATALOG_URLS = [
  'https://kizamubeam.github.io/kizamubeam/catalog/catalog.json',
  'https://kizamubeam.com/catalog/catalog.json',
  'https://negurvulkan.github.io/kizamubeam/catalog/catalog.json',
];
export const CATALOG_URL = CATALOG_URLS[0];
/** Separate signed catalogues hosted by the three content repositories */
export const CATALOG_SOURCES: string[][] = [
  ['https://kizamubeam.github.io/kizamubeam-packs/catalog.json'],
  ['https://kizamubeam.github.io/kizamubeam-plugins/catalog.json'],
  ['https://kizamubeam.github.io/kizamubeam-devices/catalog.json'],
];
/** Address the last catalogue was loaded from; package files are resolved relative to it */
let catalogSource = CATALOG_URL;
export const CATALOG_FORMAT = 'kizamubeam-catalog';
/**
 * Öffentlicher Schlüssel (Ed25519, hex) zum Prüfen von catalog.json.sig; erzeugen mit scripts/catalog-keygen.mjs.
 * Leer = Katalog nicht eingerichtet; das Fenster Erweiterungen meldet das statt einer Liste.
 */
export const CATALOG_PUBKEY = 'add263ac33d1cfeb3e28265b3a2db89155641ff578664e4031cc016f8ee31359';

export interface CatalogEntry {
  id: string;
  version: string;
  minApp?: string;
  /** Mehrsprachig wie im Paket; anzeigen mit localText() */
  name: unknown;
  description?: unknown;
  author?: string;
  homepage?: string;
  devices: number;
  templates: number;
  materials: number;
  /** Bibliotheks-Einträge (fehlt in älteren Katalogen) */
  assets: number;
  /** Plugins (program code, #205); 0 in older catalogues */
  plugins: number;
  /** Runtimes of the plugins */
  runtimes?: ('js' | 'wasm')[];
  /** Highest plugin call protocol the pack needs */
  pluginApi?: number;
  /** Size of all plugin code in bytes */
  codeSize?: number;
  /** Where the source of the plugins is (https only) */
  source?: string;
  /** Servers the plugins may fetch data from (#280), host names */
  network?: string[];
  /** Paketdatei relativ zu catalog.json */
  file: string;
  sha256: string;
  size: number;
  /** Runtime-only: URL des Katalogs, aus dem dieser Eintrag stammt */
  catalogUrl?: string;
}

export interface Catalog {
  generated: string;
  packs: CatalogEntry[];
}

export class CatalogError extends Error {}

const HEX64 = /^[0-9a-f]{64}$/;
const FILE_RE = /^[a-z0-9][a-z0-9.-]*\.kzp$/;

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return etc.bytesToHex(new Uint8Array(d));
}

/** Signatur (Base64, 64 Byte) über den genauen Text von catalog.json prüfen */
export async function verifyCatalog(text: string, sigB64: string, pubHex: string = CATALOG_PUBKEY): Promise<boolean> {
  if (!HEX64.test(pubHex)) return false;
  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(atob(sigB64.trim()), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return await verifyAsync(sig, new TextEncoder().encode(text), etc.hexToBytes(pubHex));
  } catch {
    return false;
  }
}

/** Liste lesen und prüfen; fehlerhafte Einträge fallen weg */
export function parseCatalog(text: string): Catalog {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CatalogError(t('Der Katalog ist kein gültiges JSON'));
  }
  if (!raw || raw.format !== CATALOG_FORMAT || !Array.isArray(raw.packs)) throw new CatalogError(t('Kein KizamuBeam-Katalog'));
  const packs: CatalogEntry[] = [];
  for (const p of raw.packs as Record<string, unknown>[]) {
    if (!p || typeof p !== 'object') continue;
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
    if (typeof p.id !== 'string' || typeof p.version !== 'string' || typeof p.file !== 'string' || !FILE_RE.test(p.file)) continue;
    if (typeof p.sha256 !== 'string' || !HEX64.test(p.sha256) || !localText(p.name)) continue;
    packs.push({
      id: p.id, version: p.version, ...(typeof p.minApp === 'string' ? { minApp: p.minApp } : {}),
      name: p.name, ...(p.description ? { description: p.description } : {}),
      ...(typeof p.author === 'string' ? { author: p.author } : {}),
      ...(typeof p.homepage === 'string' && p.homepage.startsWith('https://') ? { homepage: p.homepage } : {}),
      devices: n(p.devices), templates: n(p.templates), materials: n(p.materials), assets: n(p.assets), plugins: n(p.plugins),
      ...(Array.isArray(p.runtimes) ? { runtimes: p.runtimes.filter((r): r is 'js' | 'wasm' => r === 'js' || r === 'wasm') } : {}),
      ...(n(p.pluginApi) ? { pluginApi: n(p.pluginApi) } : {}),
      ...(n(p.codeSize) ? { codeSize: n(p.codeSize) } : {}),
      ...(typeof p.source === 'string' && p.source.startsWith('https://') ? { source: p.source } : {}),
      ...(Array.isArray(p.network) && p.network.length ? { network: p.network.filter((x): x is string => typeof x === 'string' && /^[a-z0-9.-]{1,253}$/.test(x)).slice(0, 16) } : {}),
      file: p.file, sha256: p.sha256, size: n(p.size),
    });
  }
  return { generated: typeof raw.generated === 'string' ? raw.generated : '', packs };
}

export type CatalogState = 'install' | 'update' | 'installed' | 'newer-installed' | 'needs-app';

/** Was der Knopf eines Eintrags anbietet, je nach installierter Version und App-Version */
export function catalogState(e: CatalogEntry, installed: Pack | undefined, appVersion: string): CatalogState {
  if (e.minApp && compareVersions(appVersion, e.minApp) < 0) return 'needs-app';
  if (e.pluginApi && e.pluginApi > PLUGIN_API) return 'needs-app';
  if (!installed) return 'install';
  const c = compareVersions(e.version, installed.version);
  return c > 0 ? 'update' : c === 0 ? 'installed' : 'newer-installed';
}

async function fetchSingleCatalog(url: string | string[], pubHex: string): Promise<Catalog> {
  if (!HEX64.test(pubHex)) throw new CatalogError(t('Diese Version kennt noch keinen Schlüssel für den Katalog.'));
  const get = async (u: string) => {
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) throw new CatalogError(t('Katalog nicht erreichbar ({status})', { status: r.status }));
    return r.text();
  };
  let error: unknown;
  let badSignature: CatalogError | undefined;
  for (const u of Array.isArray(url) ? url : [url]) {
    try {
      const [text, sig] = await Promise.all([get(u), get(u + '.sig')]);
      if (!(await verifyCatalog(text, sig, pubHex))) {
        badSignature = new CatalogError(t('Die Signatur des Katalogs stimmt nicht. Er wird nicht benutzt.'));
        continue;
      }
      const catalog = parseCatalog(text);
      catalogSource = u;
      for (const p of catalog.packs) p.catalogUrl = u;
      return catalog;
    } catch (e) {
      error = e;
    }
  }
  throw badSignature ?? error;
}

/**
 * Load one catalogue (string | string[] mirrors) or merge multiple independent catalogues (string[][]).
 * Signature errors always win over reachability errors; if at least one source in a multi-source list
 * succeeds without signature errors, its packs are returned.
 */
export async function fetchCatalog(
  url: string | string[] | string[][] = CATALOG_SOURCES,
  pubHex = CATALOG_PUBKEY,
): Promise<Catalog> {
  if (!Array.isArray(url) || url.length === 0 || typeof url[0] === 'string') {
    return fetchSingleCatalog(url as string | string[], pubHex);
  }
  const results = await Promise.allSettled((url as string[][]).map((mirrors) => fetchSingleCatalog(mirrors, pubHex)));
  const merged: CatalogEntry[] = [];
  const seen = new Set<string>();
  let generated = '';
  let lastError: unknown;
  let badSignature: CatalogError | undefined;
  let okCount = 0;

  for (const r of results) {
    if (r.status === 'fulfilled') {
      okCount++;
      if (r.value.generated > generated) generated = r.value.generated;
      for (const p of r.value.packs) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(p);
      }
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      if (/Signatur/i.test(msg) || /Schlüssel/i.test(msg)) badSignature = r.reason as CatalogError;
      lastError = r.reason;
    }
  }

  if (badSignature) throw badSignature;
  if (okCount === 0) throw lastError ?? new CatalogError(t('Katalog nicht erreichbar ({status})', { status: 0 }));
  merged.sort((a, b) => a.id.localeCompare(b.id));
  return { generated, packs: merged };
}

export type CatalogFetchPhase = 'download' | 'verify';

export interface CatalogFetchProgress {
  phase: CatalogFetchPhase;
  /** Bytes loaded so far (UTF-8 bytes) */
  loaded: number;
  /** Expected total bytes (from catalog entry or Content-Length), 0 if unknown */
  total: number;
}

/** Paketdatei eines Eintrags laden und gegen Prüfsumme und Kennung prüfen; liefert den Text zum Installieren */
export async function fetchCatalogPack(
  e: CatalogEntry,
  url = e.catalogUrl ?? catalogSource,
  onProgress?: (progress: CatalogFetchProgress) => void,
): Promise<string> {
  const knownTotal = e.size > 0 ? e.size : 0;
  onProgress?.({ phase: 'download', loaded: 0, total: knownTotal });
  const r = await fetch(new URL(e.file, url).href, { cache: 'no-cache' });
  if (!r.ok) throw new CatalogError(t('Paket nicht erreichbar ({status})', { status: r.status }));
  const headerLen = Number(r.headers?.get?.('content-length') ?? 0);
  const total = knownTotal || (Number.isFinite(headerLen) && headerLen > 0 ? headerLen : 0);
  let text: string;
  let loaded = 0;
  if (r.body && typeof r.body.getReader === 'function') {
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    onProgress?.({ phase: 'download', loaded: 0, total });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        loaded += value.byteLength;
        parts.push(decoder.decode(value, { stream: true }));
        onProgress?.({ phase: 'download', loaded, total: total > 0 ? Math.max(total, loaded) : 0 });
      }
    }
    parts.push(decoder.decode());
    text = parts.join('');
  } else {
    text = await r.text();
    loaded = new TextEncoder().encode(text).length;
    onProgress?.({ phase: 'download', loaded, total: total > 0 ? Math.max(total, loaded) : loaded });
  }
  const finalTotal = total > 0 ? Math.max(total, loaded) : loaded;
  onProgress?.({ phase: 'verify', loaded: finalTotal, total: finalTotal });
  if ((await sha256Hex(text)) !== e.sha256) throw new CatalogError(t('Die Prüfsumme des Pakets stimmt nicht mit dem Katalog überein.'));
  const p = parsePack(text);
  if (p.id !== e.id || p.version !== e.version) throw new CatalogError(t('Das Paket passt nicht zum Eintrag im Katalog.'));
  return text;
}

/**
 * Katalog aus Paketdateien bauen (beim Veröffentlichen der Website). Jede Datei muss „<Kennung>.kzp“ heißen
 * und gültig sein; Fehler brechen ab, damit kein fehlerhaftes Paket in den Katalog gerät. sources: link to the
 * source of a plugin pack by pack id (packs built from plugins/ in this repository).
 */
export async function buildCatalog(files: [name: string, text: string][], generated: string, sources: Record<string, string> = {}): Promise<string> {
  const packs: CatalogEntry[] = [];
  for (const [name, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    // App-Version sehr hoch: minApp darf neuer sein als diese Version der Werkzeuge
    const p = parsePack(text, '9999.0.0');
    if (name !== `${p.id}.${PACK_EXT}`) throw new CatalogError(`${name}: Datei muss ${p.id}.${PACK_EXT} heißen`);
    const raw = JSON.parse(text) as Record<string, unknown>;
    packs.push({
      id: p.id, version: p.version, ...(p.minApp ? { minApp: p.minApp } : {}),
      name: raw.name, ...(raw.description ? { description: raw.description } : {}),
      ...(p.author ? { author: p.author } : {}), ...(p.homepage ? { homepage: p.homepage } : {}),
      devices: p.devices.length, templates: p.templates.length, materials: p.materials.length, assets: p.assets.length, plugins: p.plugins.length,
      ...(p.plugins.length
        ? {
            runtimes: [...new Set(p.plugins.map((x) => x.runtime))].sort(),
            pluginApi: Math.max(...p.plugins.map((x) => x.api)),
            codeSize: p.plugins.reduce((s, x) => s + codeBytes(x.code).length, 0),
          }
        : {}),
      ...(p.plugins.some((x) => x.network?.length) ? { network: [...new Set(p.plugins.flatMap((x) => (x.network ?? []).map((h) => h.hostname)))].sort() } : {}),
      ...(sources[p.id] ? { source: sources[p.id] } : {}),
      file: name, sha256: await sha256Hex(text), size: new TextEncoder().encode(text).length,
    });
  }
  return JSON.stringify({ format: CATALOG_FORMAT, version: 1, generated, packs }, null, 1) + '\n';
}
