// Job bundles for a remote KizamuBeam (issue #188): what a client sends so that the host computes the job
// itself with its own device. Kept free of editor and window code so it can be tested on its own.
import { t } from './i18n';
import { stableJson } from './syncCore';
import { defaultImageLayer, defaultLayer, Doc, ImageLayer, Layer, leaves, loadDoc, normalizeLayer, Obj } from './model';

/** Protocol version of the remote connection (must match REMOTE PROTO in src-tauri/src/remote.rs) */
export const REMOTE_PROTO = 1;
/** Largest bundle a client sends (the host accepts up to 256 MB per message) */
export const MAX_BUNDLE = 200 * 1024 * 1024;

export interface FontRef {
  family: string;
  bold: boolean;
  italic: boolean;
}

export interface BundleFont extends FontRef {
  /** Font file (TTF/OTF) as base64; null = the sender did not have it either */
  data: string | null;
}

export interface JobBundle {
  /** Name of the job (project or tool name) */
  name: string;
  /** Project as in a .kzb file, images included; the current page is the one to laser */
  project: string;
  /** "Selection only": ids of top-level objects on the current page; null = the whole page */
  only: number[] | null;
  fonts: BundleFont[];
  /** KizamuBeam version of the sender */
  app: string;
}

/** Summary of a job on the host, as clients see it */
export interface RemoteJobInfo {
  id: number;
  name: string;
  sender: string;
  /** Received (ms since 1970) */
  at: number;
  /** Estimated duration in seconds */
  total: number;
  warnings: string[];
  /** Small preview as PNG data URL */
  preview: string;
}

const fontKey = (f: FontRef) => `${f.family}|${f.bold}|${f.italic}`;

/** Fonts (family and style) used by text objects, each once */
export function fontsUsed(objs: Obj[]): FontRef[] {
  const out = new Map<string, FontRef>();
  for (const [o] of leaves(objs)) {
    const s = o.shape;
    if (s.kind !== 'text') continue;
    const f = { family: s.font, bold: !!s.bold, italic: !!s.italic };
    out.set(fontKey(f), f);
  }
  return [...out.values()];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Project JSON for a job document that is not in the editor (material test, focus test, setup test job):
 * only the current page, the layers it uses and its images.
 */
export function sourceProject(doc: Doc, layer: (i: number) => Layer, imgLayer: (i: number) => ImageLayer, assetUrl: (id: string) => string | null): string {
  const layers: Record<number, Layer> = {};
  const assets: Record<string, string> = {};
  for (const [o] of leaves(doc.objs)) {
    layers[o.layer] ??= clone(layer(o.layer));
    if (o.shape.kind === 'image') {
      layers[o.layer].img = clone(imgLayer(o.layer));
      const url = assetUrl(o.shape.asset);
      if (url) assets[o.shape.asset] = url;
    }
  }
  const raw: Record<string, unknown> = { version: 2, bed: doc.bed, pages: [{ name: doc.pages[doc.page]?.name ?? '', objs: doc.objs }], page: 0, layers, assets };
  if (doc.vt) raw.vt = doc.vt;
  if (doc.params) raw.params = doc.params;
  return JSON.stringify(raw);
}

/** Host side: the bundle's project as a document, the objects to laser and the image data */
export function openBundle(b: JobBundle): { doc: Doc; only: Obj[] | null; assets: Record<string, string> } {
  if (!b || typeof b.project !== 'string') throw new Error(t('Ungültiger Auftrag'));
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(b.project);
  } catch {
    throw new Error(t('Ungültiger Auftrag'));
  }
  const assets = raw.assets && typeof raw.assets === 'object' ? (raw.assets as Record<string, string>) : {};
  delete raw.assets;
  delete raw.meshes;
  const doc = loadDoc(raw);
  const ids = Array.isArray(b.only) ? new Set(b.only) : null;
  const only = ids ? doc.objs.filter((o) => ids.has(o.id)) : null;
  return { doc, only, assets };
}

/** Layer settings of a bundle document (as the editor does it for its own document) */
export const docLayer = (doc: Doc) => (i: number): Layer => normalizeLayer((doc.layers[i] ??= defaultLayer(i)));
export const docImgLayer = (doc: Doc) => (i: number): ImageLayer => (docLayer(doc)(i).img ??= defaultImageLayer());

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Font files of a bundle; missing ones are listed separately (the host then uses its own or a fallback) */
export function bundleFonts(b: JobBundle): { files: (FontRef & { buf: ArrayBuffer })[]; missing: FontRef[] } {
  const files: (FontRef & { buf: ArrayBuffer })[] = [];
  const missing: FontRef[] = [];
  for (const f of Array.isArray(b.fonts) ? b.fonts : []) {
    const ref = { family: String(f.family), bold: !!f.bold, italic: !!f.italic };
    if (typeof f.data !== 'string' || !f.data) {
      missing.push(ref);
      continue;
    }
    try {
      const bytes = base64ToBytes(f.data);
      files.push({ ...ref, buf: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
    } catch {
      missing.push(ref);
    }
  }
  return { files, missing };
}

/** Name of a font for messages, e.g. "Roboto (bold)" */
export function fontLabel(f: FontRef): string {
  const style = [f.bold ? t('fett') : '', f.italic ? t('kursiv') : ''].filter(Boolean).join(', ');
  return style ? `${f.family} (${style})` : f.family;
}

/** What a host offers to take over (request "sync"): its current device without connection details, its
 * material library and its cameras (settings and calibration; the image comes through the connection) */
export interface HostSync {
  device: Record<string, unknown>;
  materials: unknown[];
  cameras: import('./cameraui').SharedCamera[];
}

/** Device fields that differ between the host's device and this one (connection and name do not count) */
export function deviceDifferences(host: Record<string, unknown>, local: Record<string, unknown>, skip: readonly string[]): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(host)) {
    if (k === 'id' || k === 'name' || skip.includes(k)) continue;
    if (stableJson(v) !== stableJson(local[k])) out.push(k);
  }
  return out;
}

