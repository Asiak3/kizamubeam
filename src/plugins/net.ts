// Controlled network access for plugins (#280). A plugin never talks to the network itself: it asks with
// host.fetch for a path on a server its manifest declares, the Worker hands the request to the app, and the app
// fetches it here after its checks, then gives the answer back to the plugin as a resource (kind "net").
//
// Checks: the server is declared (HTTPS, a named host, the app builds the URL from the declared base, the path and
// query values), the method is allowed, the user agreed to this plugin's server list, plugin network access is not
// switched off, at most `rate` requests per second per server (the app caps it), no cookies, credentials, referrer
// or redirects, at most MAX_BYTES and only the declared content types. In the app the request runs in the Rust
// backend (plugin_fetch), which also refuses servers whose name resolves to a local or private address. Answers are
// cached for an hour, so a live preview does not ask the server again; every request is logged per plugin.
// No DOM here: the consent question and the transport are set by the app (netUi.ts), tests set their own.
import type { NetRequest, NetResponse } from './hostfns';
import type { NetType, PluginManifest, PluginNetHost } from './manifest';

/** Largest answer, time limit and how long answers are reused */
export const NET_LIMITS = { maxBytes: 10 * 1024 * 1024, timeoutMs: 20_000, cacheMs: 60 * 60 * 1000, cacheBytes: 50 * 1024 * 1024, log: 100 };

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  maxBytes: number;
  timeoutMs: number;
}
export interface TransportResponse {
  status: number;
  /** Content-Type header */
  contentType: string;
  bytes: Uint8Array;
}
/** Performs one request without cookies, credentials, referrer or redirects; rejects with a short code on failure */
export type Transport = (r: TransportRequest) => Promise<TransportResponse>;

/** Asks the user whether a plugin may use its servers (once per server list); true = allowed */
export type ConsentAsk = (m: PluginManifest) => Promise<boolean>;

let transport: Transport = () => Promise.reject(new Error('net-failed'));
let ask: ConsentAsk = () => Promise.resolve(false);
export const setNetTransport = (t: Transport) => void (transport = t);
export const setNetConsent = (a: ConsentAsk) => void (ask = a);

// ---------------------------------------------------------------- settings (localStorage, synced)
const CONSENT_KEY = 'kizamubeam.pluginNet';
const OFF_KEY = 'kizamubeam.pluginNetOff';

/** The servers of a plugin as the user agreed to them; another list asks again */
export const netSignature = (m: PluginManifest) => (m.network ?? []).map((h) => `${h.id}=${h.base}`).sort().join(' ');

type ConsentStore = Record<string, { hosts: string; allowed: boolean }>;
function readConsent(): ConsentStore {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeConsent(s: ConsentStore) {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(s));
  } catch {
    // Without storage the question comes again next time
  }
}

/** Whether a plugin may fetch: true, false, or undefined when the user was not asked for this server list */
export function netAllowed(m: PluginManifest): boolean | undefined {
  const c = readConsent()[m.id];
  return c && c.hosts === netSignature(m) ? c.allowed : undefined;
}
/** The switch per plugin in the Extensions window (also the answer to the first question) */
export function setNetAllowed(m: PluginManifest, allowed: boolean) {
  const s = readConsent();
  s[m.id] = { hosts: netSignature(m), allowed };
  writeConsent(s);
}
/** All plugin network access off (offline) */
export function netOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}
export function setNetOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // ignored
  }
}

// ---------------------------------------------------------------- log
export interface NetLogEntry {
  time: number;
  host: string;
  method: string;
  path: string;
  status: number;
  bytes: number;
  cached: boolean;
  error?: string;
}
const logs = new Map<string, NetLogEntry[]>();
/** Requests of a plugin in this session, newest last */
export const netLog = (pluginId: string): NetLogEntry[] => [...(logs.get(pluginId) ?? [])];
function log(id: string, e: NetLogEntry) {
  const l = logs.get(id) ?? [];
  l.push(e);
  if (l.length > NET_LIMITS.log) l.splice(0, l.length - NET_LIMITS.log);
  logs.set(id, l);
}

// ---------------------------------------------------------------- URL, type, cache, rate
/** The URL of a request: the declared base, the plugin's path, its query values sorted; null if it leaves the base */
export function netUrl(h: PluginNetHost, r: NetRequest): string | null {
  const u = new URL(h.base + r.path);
  const base = new URL(h.base);
  if (u.origin !== base.origin || !(u.pathname === base.pathname || u.pathname.startsWith(base.pathname.replace(/\/?$/, '/')))) return null;
  for (const [k, v] of Object.entries(r.query).sort(([a], [b]) => (a < b ? -1 : 1))) u.searchParams.append(k, v);
  return u.toString();
}

/** The content type of an answer as a NetType, or null for one the app does not hand to plugins */
export function netType(contentType: string): NetType | null {
  const t = contentType.split(';')[0].trim().toLowerCase();
  if (t === 'application/json' || t.endsWith('+json')) return 'json';
  if (t === 'application/xml' || t === 'text/xml' || t.endsWith('+xml')) return 'xml';
  if (t === 'text/plain' || t === 'text/csv') return 'text';
  if (t === 'image/png') return 'png';
  if (t === 'application/vnd.mapbox-vector-tile' || t === 'application/x-protobuf' || t === 'application/protobuf') return 'mvt';
  return null;
}

const cache = new Map<string, { time: number; bytes: number; resp: NetResponse }>();
let cacheBytes = 0;
function cached(key: string): NetResponse | null {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() - c.time > NET_LIMITS.cacheMs) {
    cache.delete(key);
    cacheBytes -= c.bytes;
    return null;
  }
  return c.resp;
}
function store(key: string, resp: NetResponse) {
  const bytes = (resp.text?.length ?? 0) + (resp.data?.length ?? 0);
  cache.set(key, { time: Date.now(), bytes, resp });
  cacheBytes += bytes;
  while (cacheBytes > NET_LIMITS.cacheBytes && cache.size) {
    const [k, v] = cache.entries().next().value!;
    cache.delete(k);
    cacheBytes -= v.bytes;
  }
}
/** Forget cached answers (tests, and the Extensions window after switching a plugin off) */
export function clearNetCache() {
  cache.clear();
  cacheBytes = 0;
}

/** Per server: when the next request may start */
const nextAt = new Map<string, Promise<void>>();
function slot(hostname: string, rate: number): Promise<void> {
  const gap = 1000 / rate;
  const prev = nextAt.get(hostname) ?? Promise.resolve();
  const mine = prev.then(() => new Promise<void>((res) => setTimeout(res, 0)));
  // The following request waits until this one started plus the gap
  nextAt.set(hostname, mine.then(() => new Promise<void>((res) => setTimeout(res, gap))));
  return mine;
}

/** One question at a time per plugin */
const asking = new Map<string, Promise<boolean>>();

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Fetch a request of a plugin after all checks. Never rejects: problems come back as { status: 0, error } with a
 * code the plugin can report (net-unknown-host, net-method, net-offline, net-denied, net-failed, net-too-large,
 * net-type) and HTTP errors with their status.
 */
export async function pluginFetch(m: PluginManifest, r: NetRequest): Promise<NetResponse> {
  const h = m.network?.find((x) => x.id === r.host);
  const entry = (resp: NetResponse, extra: Partial<NetLogEntry> = {}) => {
    log(m.id, { time: Date.now(), host: h?.hostname ?? r.host, method: r.method, path: r.path, status: resp.status, bytes: (resp.text?.length ?? 0) + (resp.data?.length ?? 0), cached: false, ...(resp.error ? { error: resp.error } : {}), ...extra });
    return resp;
  };
  if (!h) return entry({ status: 0, error: 'net-unknown-host' });
  if (!h.methods.includes(r.method)) return entry({ status: 0, error: 'net-method' });
  if (netOff()) return entry({ status: 0, error: 'net-offline' });
  let allowed = netAllowed(m);
  if (allowed === undefined) {
    let q = asking.get(m.id);
    if (!q) {
      q = ask(m).then((ok) => (setNetAllowed(m, ok), ok)).finally(() => asking.delete(m.id));
      asking.set(m.id, q);
    }
    allowed = await q;
  }
  if (!allowed) return entry({ status: 0, error: 'net-denied' });
  const url = netUrl(h, r);
  if (!url) return entry({ status: 0, error: 'net-unknown-host' });
  const key = JSON.stringify([url, r.method, r.body ?? null]);
  const hit = cached(key);
  if (hit) return entry(hit, { cached: true });
  await slot(h.hostname, h.rate);
  let res: TransportResponse;
  try {
    res = await transport({ url, method: r.method, ...(r.body !== undefined ? { body: r.body } : {}), maxBytes: NET_LIMITS.maxBytes, timeoutMs: NET_LIMITS.timeoutMs });
  } catch (e) {
    const code = e instanceof Error && /^net-[a-z-]+$/.test(e.message) ? e.message : 'net-failed';
    return entry({ status: 0, error: code });
  }
  if (res.bytes.length > NET_LIMITS.maxBytes) return entry({ status: res.status, error: 'net-too-large' });
  const type = netType(res.contentType);
  // An error page (HTML) is reported by its status; a successful answer must have a declared type
  if (res.status < 200 || res.status >= 300) return entry({ status: res.status, error: 'net-status' });
  if (!type || !h.types.includes(type)) return entry({ status: res.status, error: 'net-type' });
  const resp: NetResponse = type === 'png' || type === 'mvt' ? { status: res.status, type, data: toBase64(res.bytes) } : { status: res.status, type, text: new TextDecoder().decode(res.bytes) };
  store(key, resp);
  return entry(resp);
}
