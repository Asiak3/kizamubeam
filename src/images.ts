// Rasterbilder: Asset-Speicher (Bilddaten außerhalb von Undo und Dokument-JSON),
// Bildverarbeitung (Helligkeit, Kontrast, Gamma, Schärfen, Negativ, Dithering) und Zwischenspeicher der Ergebnisse.
import { DEFAULT_ADJUST, defaultImageLayer, ImageEdit, ImageOutput, ImageShape, Mat } from './model';
import { t } from './i18n';
import { hasNative, native } from './native';
import { DEFAULT_IMAGE_MAX_PIXELS, resolveImageRasterGeometry } from './imageRaster';
import { ImageCache } from './imageCache';
import { applyAdjust, resample, ditherOutput, editedGrayPixels, maskExterior, processEditedPixels, downsampleRgba, ImageProcessingError, type ImageProcessingErrorCode } from './imagePixels';
export { applyAdjust, resample, dither, ImageProcessingError } from './imagePixels';
export type { DitherOptions, ImageProcessingErrorCode } from './imagePixels';

// ---------- Asset-Speicher ----------

interface Asset {
  dataUrl: string;
  img: HTMLImageElement | null;
  /** Graustufen des Originals in voller Auflösung (0 = schwarz, 255 = weiß; Transparenz zählt als weiß) */
  gray: Float32Array | null;
  w: number;
  h: number;
  /** Graustufen liegen auch im Rust-Kern (Desktop-App); false = nicht dort, dann rechnet TypeScript */
  native: Promise<boolean>;
}

const assets = new Map<string, Asset>();
// Disposable copies only: original assets remain available for save/output.
// Sized for one 24 MP original (96 MB) plus working room; anything bigger
// re-reads per use instead of pinning unbounded heap.
const sourceRgba = new ImageCache<Asset, Uint8ClampedArray>(128 * 1024 * 1024, 4);
const listeners = new Set<() => void>();

/** Wird aufgerufen, sobald ein Bild dekodiert ist oder ein Ergebnis neu berechnet wurde. Liefert die Abmeldung. */
export function onImageReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const notify = () => listeners.forEach((f) => f());

export function assetUrl(id: string): string | null {
  return assets.get(id)?.dataUrl ?? null;
}
export function assetImage(id: string): HTMLImageElement | null {
  return assets.get(id)?.img ?? null;
}

/** Dekodiertes Original-RGBA für Exporte, die Bildbearbeitungen einbacken; null, solange nicht dekodiert. */
export function assetRgba(id: string): { rgba: Uint8ClampedArray; width: number; height: number } | null {
  const a = assets.get(id);
  if (!a?.img) return null;
  let rgba = sourceRgba.get(a);
  if (!rgba) {
    try {
      const c = document.createElement('canvas');
      c.width = a.w;
      c.height = a.h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(a.img, 0, 0);
      rgba = ctx.getImageData(0, 0, a.w, a.h).data;
      sourceRgba.set(a, rgba, rgba.byteLength);
    } catch {
      return null;
    }
  }
  return { rgba, width: a.w, height: a.h };
}

/** Verkleinerte Fassung (PNG, längste Seite max Bildpunkte) für Vorschauen; null, solange das Bild nicht dekodiert ist */
export function thumbnailUrl(id: string, max = 200): string | null {
  const a = assets.get(id);
  return a?.img ? scaledPng(a.img, max) : null;
}

/** Bild auf höchstens max Bildpunkte verkleinert als PNG-data:-URL */
export function scaledPng(img: HTMLImageElement, max = 200): string {
  const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * f));
  c.height = Math.max(1, Math.round(img.naturalHeight * f));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** Bilddaten dekodieren (ohne sie zu registrieren) */
export const decodeImage = (dataUrl: string) => decode(dataUrl);

/** Bild senkrecht spiegeln, Ergebnis als PNG-data:-URL (z. B. Bilder aus LightBurn-Projekten) */
export async function flipImageV(dataUrl: string): Promise<string> {
  const img = await decode(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.translate(0, c.height);
  ctx.scale(1, -1);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Bilddaten registrieren. Gleiche Daten ergeben dieselbe ID. */
export async function addAsset(dataUrl: string): Promise<{ id: string; w: number; h: number }> {
  const id = await hashId(dataUrl);
  const ex = assets.get(id);
  if (ex?.img) return { id, w: ex.w, h: ex.h };
  const img = await decode(dataUrl);
  const a: Asset = { dataUrl, img, gray: null, w: img.naturalWidth, h: img.naturalHeight, native: Promise.resolve(false) };
  a.native = toNative(id, a);
  assets.set(id, a);
  persist(id, dataUrl);
  return { id, w: img.naturalWidth, h: img.naturalHeight };
}

/** Bekannte Asset-ID mit Daten (z. B. aus einer Projektdatei) eintragen; dekodiert im Hintergrund. */
export function registerAsset(id: string, dataUrl: string) {
  if (assets.get(id)?.img) return;
  const a: Asset = { dataUrl, img: null, gray: null, w: 0, h: 0, native: Promise.resolve(false) };
  assets.set(id, a);
  persist(id, dataUrl);
  const decoded = decode(dataUrl).then((img) => {
    a.img = img;
    a.w = img.naturalWidth;
    a.h = img.naturalHeight;
  });
  a.native = decoded.then(
    () => toNative(id, a),
    () => false,
  );
  decoded.then(notify, () => {
    /* defektes Bild: bleibt als Platzhalter */
  });
}

/**
 * Graustufen an den Rust-Kern geben. Dekodiert hat die Webansicht (wie bisher, mit Farbprofil und Drehung),
 * damit Desktop-App und Browser aus derselben Datei dieselben Punkte lasern.
 */
async function toNative(id: string, a: Asset): Promise<boolean> {
  if (!hasNative()) return false;
  const g = sourceGray(a);
  if (!g) return false;
  try {
    await native('image_register', new Uint8Array(g.buffer, g.byteOffset, g.byteLength), { headers: { 'x-asset': id, 'x-size': `${a.w}x${a.h}` } });
    // Die Kopie hier braucht nur noch das Nachzeichnen, sourceGray berechnet sie dann neu
    a.gray = null;
    return true;
  } catch {
    return false;
  }
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(t('Bild konnte nicht gelesen werden (Format nicht unterstützt?)')));
    img.src = src;
  });
}

export async function hashId(s: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // ohne WebCrypto (unsicherer Kontext): FNV-1a über die Daten
    let h1 = 0x811c9dc5,
      h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
      h2 = Math.imul(h2 ^ s.charCodeAt(s.length - 1 - i), 2246822519);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
  }
}

// Bilddaten der automatischen Sicherung liegen in IndexedDB (localStorage ist für Bilder zu klein).
// Name aus der Zeit vor der Umbenennung in KizamuBeam, damit vorhandene Sicherungen erhalten bleiben
const DB_NAME = 'laserwerk';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('assets');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function persist(id: string, dataUrl: string) {
  db()
    .then((d) => d.transaction('assets', 'readwrite').objectStore('assets').put(dataUrl, id))
    .catch(() => {
      /* ohne IndexedDB nur für diese Sitzung */
    });
}
/** Fehlende Bilddaten aus der automatischen Sicherung nachladen. */
export function restoreAssets(ids: Iterable<string>) {
  const missing = [...new Set(ids)].filter((id) => !assets.has(id));
  if (!missing.length) return;
  db()
    .then((d) => {
      const st = d.transaction('assets', 'readonly').objectStore('assets');
      for (const id of missing) {
        const r = st.get(id);
        r.onsuccess = () => typeof r.result === 'string' && registerAsset(id, r.result);
      }
    })
    .catch(() => {
      /* nicht verfügbar */
    });
}

// ---------- Bildverarbeitung ----------

function sourceGray(a: Asset): Float32Array | null {
  if (a.gray) return a.gray;
  if (!a.img) return null;
  const c = document.createElement('canvas');
  c.width = a.w;
  c.height = a.h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, a.w, a.h);
  ctx.drawImage(a.img, 0, 0);
  const d = ctx.getImageData(0, 0, a.w, a.h).data;
  const g = new Float32Array(a.w * a.h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  a.gray = g;
  return g;
}

/** Ausgabepunkte eines Bildes für die gegebene Welt-Matrix und den Zeilenabstand. */
/** Visible original-local polygon and sampling rectangle; world affine stays external. */
export function imageRasterGeometry(s: ImageShape) {
  const resolved = resolveImageRasterGeometry(s);
  if (!resolved.ok) throw new ImageProcessingError('geometry', resolved.reason);
  return resolved;
}

function validateEditedGrid(cols: number, rows: number) {
  if (![cols, rows].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new ImageProcessingError('invalid-grid', 'Output dimensions must be positive safe integers');
  }
  if (cols * rows > DEFAULT_IMAGE_MAX_PIXELS) {
    throw new ImageProcessingError('output-too-large', `${cols} × ${rows} exceeds ${DEFAULT_IMAGE_MAX_PIXELS} pixels`);
  }
}

export function outputGrid(s: ImageShape, m: Mat, interval: number): { cols: number; rows: number; capped: boolean } {
  if (s.edit !== undefined) {
    const { bounds } = imageRasterGeometry(s);
    const det = m[0] * m[3] - m[1] * m[2];
    if (!Number.isFinite(interval) || interval <= 0 || !m.every(Number.isFinite) || !Number.isFinite(det) || det === 0) {
      throw new ImageProcessingError('invalid-grid', 'Invalid output interval or affine transform');
    }
    const cols = Math.max(1, Math.round(Math.hypot(m[0], m[1]) * bounds.width / interval)),
      rows = Math.max(1, Math.round(Math.hypot(m[2], m[3]) * bounds.height / interval));
    validateEditedGrid(cols, rows);
    return { cols, rows, capped: false };
  }
  const sx = Math.hypot(m[0], m[1]) * s.w,
    sy = Math.hypot(m[2], m[3]) * s.h;
  let cols = Math.max(1, Math.round(sx / interval)),
    rows = Math.max(1, Math.round(sy / interval));
  const MAX = 16e6;
  let capped = false;
  if (cols * rows > MAX) {
    const f = Math.sqrt(MAX / (cols * rows));
    cols = Math.max(1, Math.floor(cols * f));
    rows = Math.max(1, Math.floor(rows * f));
    capped = true;
  }
  return { cols, rows, capped };
}

function editedGray(s: ImageShape, cols: number, rows: number, negative: boolean, world?: Mat) {
  imageRasterGeometry(s);
  validateEditedGrid(cols, rows);
  const a = assets.get(s.asset);
  if (!a?.img) throw new ImageProcessingError('asset-unavailable', 'Original image is not decoded');
  let rgba = sourceRgba.get(a);
  if (!rgba) {
    try {
      const c = document.createElement('canvas');
      c.width = a.w; c.height = a.h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(a.img, 0, 0);
      rgba = ctx.getImageData(0, 0, a.w, a.h).data;
      sourceRgba.set(a, rgba, rgba.byteLength);
    } catch {
      throw new ImageProcessingError('source-read', 'Original RGBA could not be read');
    }
  }
  return editedGrayPixels({ rgba, width: a.w, height: a.h }, s, cols, rows, negative, world);
}

/** Vollständige Verarbeitung: Ausgabewerte (0 = brennen … 255 = aus) im Raster cols × rows. */
export function processImage(s: ImageShape, L: ImageOutput, cols: number, rows: number, world?: Mat): Uint8ClampedArray | null {
  if (s.edit !== undefined) {
    const { g, coverage } = editedGray(s, cols, rows, L.negative, world);
    const values = ditherOutput(g, cols, rows, L);
    maskExterior(values, coverage);
    return values;
  }
  const a = assets.get(s.asset);
  if (!a) return null;
  const src = sourceGray(a);
  if (!src) return null;
  const g = resample(src, a.w, a.h, cols, rows);
  applyAdjust(g, cols, rows, s.adjust, L.negative);
  return ditherOutput(g, cols, rows, L);
}

/** Einstellungen für den Rust-Kern; fehlende Felder (ältere Dateien) mit den Standardwerten */
const nativeLayer = (L: ImageOutput) => {
  const d = { ...defaultImageLayer(), ...L };
  return { power: d.power, minPower: d.minPower, interval: d.interval, dither: d.dither, negative: d.negative, cells: d.cells, angle: d.angle, threshold: d.threshold };
};
const nativeAdjust = (s: ImageShape) => ({ ...DEFAULT_ADJUST, ...s.adjust });

/** Liegen die Graustufen des Bildes im Rust-Kern? (Desktop-App; sonst rechnet TypeScript) */
async function nativeAsset(s: ImageShape): Promise<boolean> {
  const a = assets.get(s.asset);
  return !!a && (await a.native);
}

/**
 * Wie processImage, aber in der Desktop-App im Rust-Kern (mehrere Kerne, blockiert die Oberfläche nicht).
 * Ist das Bild dort nicht lesbar, rechnet TypeScript.
 */
export async function processImageAsync(s: ImageShape, L: ImageOutput, cols: number, rows: number, world?: Mat): Promise<Uint8Array | Uint8ClampedArray | null> {
  // Native processing currently knows only the unedited original. Keep edited
  // failures outside its catch/fallback; this TS work is still synchronous.
  if (s.edit !== undefined) return processImage(s, L, cols, rows, world);
  if (await nativeAsset(s)) {
    try {
      const buf = await native<ArrayBuffer>('image_process', { id: s.asset, cols, rows, adjust: nativeAdjust(s), layer: nativeLayer(L) });
      return new Uint8Array(buf);
    } catch {
      /* Rust-Kern nicht erreichbar: weiter in TypeScript */
    }
  }
  return processImage(s, L, cols, rows);
}

/**
 * Rasterzeilen eines Bildes aus dem Rust-Kern: je Zeile y, Anzahl der Läufe, dann x0, x1, Leistung je Lauf.
 * m bildet lokale mm des Bildes auf Ausgabekoordinaten ab, im ist die Umkehrung. null = im Rust-Kern nicht möglich.
 */
export async function nativeScanLines(s: ImageShape, L: ImageOutput, cols: number, rows: number, m: Mat, im: Mat): Promise<Float64Array | null> {
  if (s.edit !== undefined) return null;
  if (!(await nativeAsset(s))) return null;
  try {
    const buf = await native<ArrayBuffer>('image_scan', { id: s.asset, cols, rows, adjust: nativeAdjust(s), layer: nativeLayer(L), w: s.w, h: s.h, m, im });
    return new Float64Array(buf);
  } catch {
    return null;
  }
}

/** Graustufen nach den Anpassungen (ohne Dithering), z. B. zum Nachzeichnen. */
export function adjustedGray(s: ImageShape, cols: number, rows: number, negative = false, world?: Mat): Float32Array | null {
  if (s.edit !== undefined) {
    const { g, coverage } = editedGray(s, cols, rows, negative, world);
    maskExterior(g, coverage);
    return g;
  }
  const a = assets.get(s.asset);
  if (!a) return null;
  const src = sourceGray(a);
  if (!src) return null;
  const g = resample(src, a.w, a.h, cols, rows);
  applyAdjust(g, cols, rows, s.adjust, negative);
  return g;
}

export function sourceSize(id: string): { w: number; h: number } | null {
  const a = assets.get(id);
  return a?.img ? { w: a.w, h: a.h } : null;
}

function toCanvas(v: Uint8Array | Uint8ClampedArray | Float32Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0, j = 0; i < v.length; i++, j += 4) {
    d[j] = d[j + 1] = d[j + 2] = v[i];
    d[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---------- Zwischenspeicher der Ergebnisse für die Arbeitsfläche ----------

interface Cached {
  key: string;
  canvas: HTMLCanvasElement | null;
  pending: string | null;
}
const results = new WeakMap<ImageShape, Cached>();
const queue = new Map<ImageShape, () => void>();
let queueTimer = 0;

function resultKey(s: ImageShape, L: ImageOutput, cols: number, rows: number) {
  return JSON.stringify([s.asset, s.w, s.h, s.pxW, s.pxH, s.adjust, L.interval, L.dither, L.negative, L.threshold, L.cells, L.angle, cols, rows, s.edit]);
}

/**
 * Verarbeitetes Bild für die Anzeige. Ändern sich Größe oder Einstellungen, wird kurz das alte Ergebnis
 * (gestreckt) gezeigt und das neue nach einer Pause berechnet, damit Ziehen und Schieberegler flüssig bleiben.
 */
export function displayCanvas(s: ImageShape, m: Mat, L: ImageOutput, immediate = false, options?: ImageDisplayOptions): HTMLCanvasElement | null {
  const a = assets.get(s.asset);
  if (!a?.img) return null;
  if (s.edit !== undefined) return editedDisplayCanvas(s, m, L, a, options);
  const { cols, rows } = outputGrid(s, m, L.interval);
  const key = resultKey(s, L, cols, rows);
  const c = results.get(s);
  if (c && c.key === key) return c.canvas;
  // Edited processing is TS-only; keep its errors synchronous for the caller's boundary.
  if (s.edit === undefined && hasNative()) return nativeDisplay(s, L, cols, rows, key, c, immediate);
  const compute = () => {
    const v = processImage(s, L, cols, rows);
    if (!v) return;
    results.set(s, { key, canvas: toCanvas(v, cols, rows), pending: null });
  };
  if (!c || immediate) {
    compute();
    return results.get(s)?.canvas ?? null;
  }
  if (c.pending !== key) {
    c.pending = key;
    queue.set(s, compute);
    clearTimeout(queueTimer);
    queueTimer = window.setTimeout(() => {
      const jobs = [...queue.values()];
      queue.clear();
      jobs.forEach((f) => f());
      notify();
    }, 120);
  }
  return c.canvas;
}

const IMAGE_DRAFT_MAX_SIDE = 512;
// A validated full-detail canvas must fit: cache pressure evicts older images,
// never silently lowers the current image's view/DPR sampling density.
const editedDisplays = new ImageCache<string, { asset: Asset; canvas: HTMLCanvasElement }>(DEFAULT_IMAGE_MAX_PIXELS * 4, 4);
const reducedDisplays = new WeakSet<HTMLCanvasElement>();
const sourceIdentities = new WeakMap<Asset, number>();
let nextSourceIdentity = 0;

export interface ImageDisplayRequest {
  id: number;
  jobKey: string;
  source: { rgba: Uint8ClampedArray; width: number; height: number };
  shape: ImageShape;
  output: ImageOutput;
  world: Mat;
  job: { cols: number; rows: number };
  display: { cols: number; rows: number };
}
export interface ImageDisplayReply {
  id: number;
  phase?: number;
  values?: Uint8ClampedArray;
  error?: { name: string; message: string; code?: ImageProcessingErrorCode };
}
interface DisplayState { key: string; asset: Asset; pending: boolean; phase: number; cancelled?: boolean; error?: Error; canvas?: HTMLCanvasElement | null }
interface DisplayPending { owner: object; key: string; asset: Asset; reduced: boolean; request: Omit<ImageDisplayRequest, 'source'> }
const displayStates = new WeakMap<object, DisplayState>();
const displayQueue = new Map<object, DisplayPending>();
let displayWorker: Worker | undefined, displayRunning: DisplayPending | undefined, nextDisplayRequest = 0;

/**
 * Test-only seam: scripts/image-display-worker-fixture.ts installs a synchronous
 * Worker so bundled Node tests (data: URL base, where `new URL()` for the real
 * worker file cannot resolve) stay deterministic. Production never sets the hook
 * and always uses the real worker module.
 */
function createDisplayWorker(): Worker {
  const hook = (globalThis as Record<string, unknown>).__kizamubeamSyncDisplayWorker as (() => Worker) | undefined;
  if (hook) return hook();
  return new Worker(new URL('./imageDisplay.worker.ts', import.meta.url), { type: 'module' });
}

export function imageDisplayActivity(owner: object): { pending: true; phase: number } | null {
  const state = displayStates.get(owner);
  return state?.pending ? { pending: true, phase: state.phase } : null;
}

export function cancelImageDisplay(owner: object): void {
  const state = displayStates.get(owner);
  if (!state?.pending) return;
  state.pending = false; state.cancelled = true;
  displayQueue.delete(owner);
  if (displayRunning?.owner === owner) {
    displayWorker?.terminate(); displayWorker = undefined; displayRunning = undefined;
    pumpImageDisplay();
  }
  notify();
}

function finishImageDisplay(reply: ImageDisplayReply) {
  const current = displayRunning;
  if (!current || current.request.id !== reply.id) return;
  const state = displayStates.get(current.owner);
  const relevant = state?.key === current.key && state.asset === current.asset && !state.cancelled
    && assets.get(current.request.shape.asset) === current.asset;
  if (reply.phase !== undefined) {
    if (relevant) { state.phase = reply.phase; notify(); }
    return;
  }
  if (relevant) {
    state.pending = false;
    if (reply.error) {
      const error = new ImageProcessingError(reply.error.code ?? 'display-unavailable', reply.error.message);
      error.name = reply.error.name; state.error = error;
    } else if (reply.values) {
      try {
        const { cols, rows } = current.request.display;
        const canvas = toCanvas(reply.values, cols, rows);
        if (current.reduced) reducedDisplays.add(canvas);
        editedDisplays.set(current.key, { asset: current.asset, canvas }, cols * rows * 4);
        state.canvas = canvas;
      } catch (cause) {
        // Preserve unexpected presentation failures for the next render, while
        // still releasing the worker slot and notifying the editor.
        state.error = cause instanceof ImageProcessingError ? cause
          : new ImageProcessingError('display-unavailable', cause instanceof Error ? cause.message : String(cause));
      }
    } else state.error = new ImageProcessingError('display-unavailable', 'Image display worker returned no pixels');
  }
  displayRunning = undefined;
  pumpImageDisplay();
  notify();
}

function pumpImageDisplay() {
  if (displayRunning || !displayQueue.size) return;
  const [owner, pending] = displayQueue.entries().next().value!;
  displayQueue.delete(owner);
  displayRunning = pending;
  try {
    if (!displayWorker) {
      const worker = createDisplayWorker();
      displayWorker = worker;
      worker.onmessage = (event: MessageEvent<ImageDisplayReply>) => { if (displayWorker === worker) finishImageDisplay(event.data); };
      const fail = (message: string) => {
        if (displayWorker !== worker || !displayRunning) return;
        const id = displayRunning.request.id;
        worker.terminate(); displayWorker = undefined;
        finishImageDisplay({ id, error: { name: 'ImageProcessingError', message, code: 'display-unavailable' } });
      };
      worker.onerror = (event) => { event.preventDefault(); fail(event.message); };
      worker.onmessageerror = () => fail('Image display worker message could not be decoded');
    }
    if (assets.get(pending.request.shape.asset) !== pending.asset) throw new ImageProcessingError('asset-unavailable', 'Original image changed while the display was pending');
    const source = assetRgba(pending.request.shape.asset);
    if (!source) throw new ImageProcessingError('source-read', 'Original RGBA could not be read');
    // postMessage copies this disposable source; never transfer/detach the original.
    displayWorker.postMessage({ ...pending.request, source } satisfies ImageDisplayRequest);
  } catch (cause) {
    displayRunning = undefined;
    const state = displayStates.get(owner);
    if (cause instanceof ImageProcessingError) {
      // Expected display failure: surface it through the per-image boundary on
      // the next render instead of stopping the editor frame loop.
      if (state?.key === pending.key) { state.pending = false; state.error = cause; notify(); }
      return;
    }
    const name = cause instanceof Error ? cause.name : '';
    if (name === 'ReferenceError' || name === 'TypeError' || name === 'DOMException') {
      // Worker unavailable or unusable in this environment (e.g. no Worker
      // support, terminated port, undecodable message): per-image error.
      const wrapped = new ImageProcessingError('display-unavailable', cause instanceof Error ? cause.message : String(cause));
      if (state?.key === pending.key) { state.pending = false; state.error = wrapped; notify(); }
      return;
    }
    // Programmer error: fail fast, preserve propagation.
    if (state?.key === pending.key) { state.pending = false; state.error = cause instanceof Error ? cause : new Error(String(cause)); }
    throw cause;
  }
}

export interface ImageDisplayOptions {
  zoom?: number;
  dpr?: number;
  dragging?: boolean;
  /** Stable render owner, including while the render uses an ephemeral draft. */
  owner?: object;
}

/** Only deliberately reduced display rasters should blur when magnified. */
export function isReducedImageDisplay(canvas: HTMLCanvasElement): boolean {
  return reducedDisplays.has(canvas);
}

/** Validate the complete job grid before selecting a display-only sampling density. */
function editedDisplayGrid(s: ImageShape, m: Mat, L: ImageOutput, options?: ImageDisplayOptions) {
  const grid = outputGrid(s, m, L.interval);
  let f = 1;
  if (options?.zoom !== undefined) {
    const density = options.zoom * (options.dpr ?? 1);
    if (Number.isFinite(density) && density > 0) {
      const { bounds } = imageRasterGeometry(s);
      const width = Math.abs(m[0]) * bounds.width + Math.abs(m[2]) * bounds.height;
      const height = Math.abs(m[1]) * bounds.width + Math.abs(m[3]) * bounds.height;
      f = Math.min(1, Math.max(width * density / grid.cols, height * density / grid.rows));
    }
  }
  if (options?.dragging) f = Math.min(f, IMAGE_DRAFT_MAX_SIDE / Math.max(grid.cols, grid.rows));
  const cols = Math.max(1, Math.ceil(grid.cols * f)), rows = Math.max(1, Math.ceil(grid.rows * f));
  return { cols, rows, f: Math.min(cols / grid.cols, rows / grid.rows), job: grid };
}

/** Direct low-res live canvases: fast positioning aid, never a final display. */
const dragDisplays = new WeakSet<HTMLCanvasElement>();

/** Downscaled working copies for live drags, bounded like the other preview caches. */
const mipSources = new ImageCache<Asset, { rgba: Uint8ClampedArray; width: number; height: number }>(16 * 1024 * 1024, 8);
const MIP_MAX_SIDE = 1024;

function mipSource(asset: Asset, source: { rgba: Uint8ClampedArray; width: number; height: number }): { rgba: Uint8ClampedArray; width: number; height: number } {
  const cached = mipSources.get(asset);
  if (cached) return cached;
  const mip = downsampleRgba(source.rgba, source.width, source.height, MIP_MAX_SIDE);
  // Small sources return themselves; only real builds are cached.
  if (mip.rgba === source.rgba) return source;
  const entry = { rgba: mip.rgba, width: mip.width, height: mip.height };
  mipSources.set(asset, entry, entry.rgba.byteLength);
  return entry;
}

/**
 * Drag source without a full-res read whenever possible: huge sources are
 * sampled from the cached mip, so no per-frame getImageData stalls the UI.
 * Only a mip miss reads (and then builds) from the full original.
 */
function dragSource(asset: Asset, s: ImageShape): { rgba: Uint8ClampedArray; width: number; height: number } {
  if (Math.max(s.pxW, s.pxH) > MIP_MAX_SIDE) {
    const cached = mipSources.get(asset);
    if (cached) return cached;
  }
  const source = assetRgba(s.asset);
  if (!source) throw new ImageProcessingError('source-read', 'Original RGBA could not be read');
  return mipSource(asset, source);
}

function sourceIdentityOf(asset: Asset): number {
  let id = sourceIdentities.get(asset);
  if (id === undefined) { id = ++nextSourceIdentity; sourceIdentities.set(asset, id); }
  return id;
}

/**
 * Single composition site for display cache keys: jobKey covers the full job
 * raster (source + settings + linear affine), key additionally the display
 * grid (plus 'drag' for live previews). Both callers must stay identical.
 */
function displayKeys(asset: Asset, s: ImageShape, L: ImageOutput, m: Mat, cols: number, rows: number, display: { cols: number; rows: number }, tag?: string) {
  const jobKey = JSON.stringify([sourceIdentityOf(asset), resultKey(s, L, cols, rows), m.slice(0, 4)]);
  const key = tag === undefined ? JSON.stringify([jobKey, display.cols, display.rows]) : JSON.stringify([tag, jobKey, display.cols, display.rows]);
  return { jobKey, key };
}

/**
 * Live path while dragging image handles: synchronous low-res dither at display
 * density, no worker and no full job grid, so the image stays visible and follows
 * every move. Full job density is computed on release/idle via the worker path.
 */
function dragDisplayCanvas(s: ImageShape, m: Mat, L: ImageOutput, asset: Asset, cols: number, rows: number, owner: object): HTMLCanvasElement | null {
  const { key } = displayKeys(asset, s, L, m, cols, rows, { cols, rows }, 'drag');
  const state = displayStates.get(owner);
  if (state?.key === key && state.asset === asset) {
    if (state.error) throw state.error;
    if (state.canvas) return state.canvas;
  }
  const cached = editedDisplays.get(key);
  if (cached?.asset === asset) {
    displayQueue.delete(owner);
    displayStates.set(owner, { key, asset, pending: false, phase: 4, canvas: cached.canvas });
    return cached.canvas;
  }
  const mip = dragSource(asset, s);
  const sampling = mip.width === s.pxW && mip.height === s.pxH ? s : { ...s, pxW: mip.width, pxH: mip.height };
  // Fast bilinear sampling: transient positioning aid, never final quality.
  const values = processEditedPixels(mip, sampling, L, cols, rows, [...m], undefined, 'fast');
  const canvas = toCanvas(values, cols, rows);
  reducedDisplays.add(canvas);
  dragDisplays.add(canvas);
  editedDisplays.set(key, { asset, canvas }, cols * rows * 4);
  displayStates.set(owner, { key, asset, pending: false, phase: 4, canvas });
  return canvas;
}

/** Bounded display-only grid/cache. Job generation always uses outputGrid/processImage directly. */
function editedDisplayCanvas(s: ImageShape, m: Mat, L: ImageOutput, asset: Asset, options?: ImageDisplayOptions): HTMLCanvasElement | null {
  const { cols, rows, f, job } = editedDisplayGrid(s, m, L, options);
  if (asset.w !== s.pxW || asset.h !== s.pxH) throw new ImageProcessingError('source-dimensions', 'Original dimensions do not match the image');
  const owner = options?.owner ?? s;
  // Live drag: fast low-res only; full density follows on release/idle.
  if (options?.dragging) return dragDisplayCanvas(s, m, L, asset, cols, rows, owner);
  const { jobKey, key } = displayKeys(asset, s, L, m, job.cols, job.rows, { cols, rows });
  const cached = editedDisplays.get(key);
  const state = displayStates.get(owner);
  const prevCanvas = state?.asset === asset ? state.canvas : undefined;
  if (state?.key === key && state.asset === asset) {
    if (state.error) throw state.error;
    // A completed owner keeps its canvas outside the bounded shared cache, so
    // more images than cache entries cannot evict and recompute each other.
    // Drag-only canvases are interim: idle upgrades them to full density.
    if (state.canvas && !dragDisplays.has(state.canvas)) { displayQueue.delete(owner); return state.canvas; }
    if (state.pending) return state.canvas ?? null;
    // Cancelled, settled without a canvas, or only a drag canvas: queue the
    // full job below — but an Abort stays sticky (no silent requeue on the
    // identical key); the interim canvas stays visible meanwhile.
    if (state.cancelled) return state.canvas ?? null;
  }
  if (cached?.asset === asset && !dragDisplays.has(cached.canvas)) {
    displayQueue.delete(owner);
    displayStates.set(owner, { key, asset, pending: false, phase: 4, canvas: cached.canvas });
    return cached.canvas;
  }
  displayStates.set(owner, { key, asset, pending: true, phase: 0, canvas: prevCanvas });
  displayQueue.set(owner, { owner, key, asset, reduced: f < 1, request: {
    id: ++nextDisplayRequest, jobKey, shape: structuredClone(s), output: structuredClone(L), world: [...m],
    job: { cols: job.cols, rows: job.rows }, display: { cols, rows },
  } });
  pumpImageDisplay();
  // While the full-density worker runs, keep showing the interim canvas
  // (drag preview or previous image) instead of hiding the image.
  return editedDisplays.get(key)?.canvas ?? prevCanvas ?? null;
}

/** Draft values, not ephemeral shape identities, key the same bounded display cache. */
export function displayCanvasDraft(s: ImageShape, m: Mat, L: ImageOutput, edit: ImageEdit, options?: ImageDisplayOptions): HTMLCanvasElement | null {
  const a = assets.get(s.asset);
  if (!a?.img) return null;
  return editedDisplayCanvas({ ...s, edit }, m, L, a, { ...options, owner: options?.owner ?? s });
}

/**
 * Desktop-App: Ergebnis im Rust-Kern rechnen lassen. Bis es da ist, bleibt das alte Ergebnis (gestreckt) stehen;
 * danach zeichnen alle, die sich mit onImageReady angemeldet haben, neu. Während einer Rechnung wartet höchstens
 * ein neuer Auftrag je Bild, Zwischenstände beim Ziehen werden übersprungen.
 */
function nativeDisplay(s: ImageShape, L: ImageOutput, cols: number, rows: number, key: string, c: Cached | undefined, immediate: boolean) {
  let entry = c;
  if (!entry) results.set(s, (entry = { key: '', canvas: null, pending: null }));
  if (entry.pending === key) return entry.canvas;
  const e = entry;
  const run = () => {
    if (e.pending !== key) return;
    if (running.has(s)) return void waiting.set(s, run);
    running.add(s);
    processImageAsync(s, L, cols, rows)
      .then((v) => {
        // auch ohne Ergebnis als erledigt merken, sonst würde jedes Neuzeichnen es erneut versuchen
        e.key = key;
        if (v) e.canvas = toCanvas(v, cols, rows);
      })
      .catch(() => {
        e.key = key;
      })
      .finally(() => {
        if (e.pending === key) e.pending = null;
        running.delete(s);
        const next = waiting.get(s);
        waiting.delete(s);
        if (next) next();
        notify();
      });
  };
  e.pending = key;
  if (!e.canvas || immediate) run();
  else {
    clearTimeout(nativeTimers.get(s));
    nativeTimers.set(s, window.setTimeout(run, 120));
  }
  return e.canvas;
}
const running = new WeakSet<ImageShape>();
const waiting = new WeakMap<ImageShape, () => void>();
const nativeTimers = new WeakMap<ImageShape, number>();

/** Verarbeitetes Bild als PNG-Daten (für „Bearbeitetes Bild speichern“). */
export async function processedPng(s: ImageShape, m: Mat, L: ImageOutput): Promise<string | null> {
  const { cols, rows } = outputGrid(s, m, L.interval);
  const v = await processImageAsync(s, L, cols, rows, m);
  return v ? toCanvas(v, cols, rows).toDataURL('image/png') : null;
}

// ---------- Auflösung aus Dateikopf ----------

/** DPI aus PNG (pHYs), JPEG (JFIF) oder BMP lesen; null, wenn nicht angegeben. */
export function readDpi(bytes: Uint8Array): number | null {
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    let p = 8;
    while (p + 8 < bytes.length) {
      const len = u32(p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (type === 'pHYs' && bytes[p + 16] === 1) return u32(p + 8) * 0.0254;
      if (type === 'IDAT') break;
      p += 12 + len;
    }
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2;
    while (p + 4 < bytes.length && bytes[p] === 0xff) {
      const marker = bytes[p + 1];
      const len = (bytes[p + 2] << 8) | bytes[p + 3];
      if (marker === 0xe0 && String.fromCharCode(...bytes.slice(p + 4, p + 8)) === 'JFIF') {
        const unit = bytes[p + 11];
        const xd = (bytes[p + 12] << 8) | bytes[p + 13];
        if (unit === 1 && xd > 1) return xd;
        if (unit === 2 && xd > 1) return xd * 2.54;
        return null;
      }
      if (marker === 0xda) break;
      p += 2 + len;
    }
    return null;
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.length > 46) {
    const ppm = bytes[38] | (bytes[39] << 8) | (bytes[40] << 16) | (bytes[41] << 24);
    return ppm > 0 ? ppm * 0.0254 : null;
  }
  return null;
}
