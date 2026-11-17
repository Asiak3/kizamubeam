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
/** Address the last catalogue was loaded from; package files are resolved relative to it */
let catalogSource = CATALOG_URL;
export const CATALOG_FORMAT = 'kizamubeam-catalog';
/**
 * Öffentlicher Schlüssel (Ed25519, hex) zum Prüfen von catalog.json.sig; erzeugen mit scripts/catalog-keygen.mjs.
 * Leer = Katalog nicht eingerichtet; das Fenster Erweiterungen meldet das statt einer Liste.
 */
export const CATALOG_PUBKEY = '97302ac6a427ea28ce54058421152cbe1992f6985e09c6210d6efa47672b11f6';

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
  /** Paketdatei relativ zu catalog.json */
  file: string;
  sha256: string;
  size: number;
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

/**
 * Load the catalogue and check its signature. With several addresses, they are tried in order until one delivers
 * a correctly signed catalogue; if none does, a signature error wins over "not reachable".
 */
export async function fetchCatalog(url: string | string[] = CATALOG_URLS, pubHex = CATALOG_PUBKEY): Promise<Catalog> {
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
      return catalog;
    } catch (e) {
      error = e;
    }
  }
  throw badSignature ?? error;
}

/** Paketdatei eines Eintrags laden und gegen Prüfsumme und Kennung prüfen; liefert den Text zum Installieren */
export async function fetchCatalogPack(e: CatalogEntry, url = catalogSource): Promise<string> {
  const r = await fetch(new URL(e.file, url).href, { cache: 'no-cache' });
  if (!r.ok) throw new CatalogError(t('Paket nicht erreichbar ({status})', { status: r.status }));
  const text = await r.text();
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
      ...(sources[p.id] ? { source: sources[p.id] } : {}),
      file: name, sha256: await sha256Hex(text), size: new TextEncoder().encode(text).length,
    });
  }
  return JSON.stringify({ format: CATALOG_FORMAT, version: 1, generated, packs }, null, 1) + '\n';
}
