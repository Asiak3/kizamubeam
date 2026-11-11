// Rasterbilder: Asset-Speicher (Bilddaten außerhalb von Undo und Dokument-JSON),
// Bildverarbeitung (Helligkeit, Kontrast, Gamma, Schärfen, Negativ, Dithering) und Zwischenspeicher der Ergebnisse.
import { DEFAULT_ADJUST, defaultImageLayer, DitherMode, ImageAdjust, ImageLayer, ImageShape, Mat } from './model';
import { t } from './i18n';
import { hasNative, native } from './native';

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

/** Graustufen auf cols × rows bringen (Flächenmittel beim Verkleinern, bilinear beim Vergrößern). */
export function resample(src: Float32Array, sw: number, sh: number, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const fx = sw / cols,
    fy = sh / rows;
  if (fx >= 1 && fy >= 1) {
    // Flächenmittel: jede Zielzelle mittelt die überdeckten Quellpunkte (gewichtet an den Rändern)
    for (let y = 0; y < rows; y++) {
      const y0 = y * fy,
        y1 = y0 + fy;
      for (let x = 0; x < cols; x++) {
        const x0 = x * fx,
          x1 = x0 + fx;
        let sum = 0,
          wsum = 0;
        for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy++) {
          const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
          const row = sy * sw;
          for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx++) {
            const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
            sum += src[row + sx] * w;
            wsum += w;
          }
        }
        out[y * cols + x] = wsum ? sum / wsum : 255;
      }
    }
    return out;
  }
  for (let y = 0; y < rows; y++) {
    const syf = Math.max(0, Math.min(sh - 1, (y + 0.5) * fy - 0.5));
    const sy0 = Math.floor(syf),
      sy1 = Math.min(sh - 1, sy0 + 1),
      ty = syf - sy0;
    for (let x = 0; x < cols; x++) {
      const sxf = Math.max(0, Math.min(sw - 1, (x + 0.5) * fx - 0.5));
      const sx0 = Math.floor(sxf),
        sx1 = Math.min(sw - 1, sx0 + 1),
        tx = sxf - sx0;
      const a = src[sy0 * sw + sx0] * (1 - tx) + src[sy0 * sw + sx1] * tx;
      const b = src[sy1 * sw + sx0] * (1 - tx) + src[sy1 * sw + sx1] * tx;
      out[y * cols + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Kastenunschärfe (horizontal + vertikal), dreimal angewendet ≈ Gauß */
function blur(v: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = v.slice();
  let b = new Float32Array(v.length);
  const pass = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
    const n = horiz ? w : h,
      lines = horiz ? h : w;
    for (let l = 0; l < lines; l++) {
      const at = (i: number) => (horiz ? l * w + i : i * w + l);
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[at(Math.max(0, Math.min(n - 1, i)))];
      for (let i = 0; i < n; i++) {
        dst[at(i)] = acc / (2 * r + 1);
        acc += src[at(Math.min(n - 1, i + r + 1))] - src[at(Math.max(0, i - r))];
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(a, b, true);
    pass(b, a, false);
  }
  return a;
}

/** Helligkeit, Kontrast, Gamma, Schärfen und Negativ auf Graustufen (in place) anwenden. */
export function applyAdjust(g: Float32Array, w: number, h: number, adj: ImageAdjust, negative: boolean) {
  if (adj.sharpen > 0) {
    const r = Math.max(1, Math.round(adj.sharpenRadius / 2));
    const bl = blur(g, w, h, r);
    const k = adj.sharpen / 100,
      thr = adj.denoise;
    for (let i = 0; i < g.length; i++) {
      const d = g[i] - bl[i];
      if (Math.abs(d) >= thr) g[i] += k * d;
    }
  }
  const C = Math.max(-99, Math.min(99, adj.contrast)) * 2.55;
  const cf = (259 * (C + 255)) / (255 * (259 - C));
  const B = adj.brightness * 2.55;
  const ig = 1 / Math.max(0.05, adj.gamma);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i - 128) * cf + 128 + B;
    v = Math.max(0, Math.min(255, v));
    v = 255 * Math.pow(v / 255, ig);
    lut[i] = negative ? 255 - v : v;
  }
  for (let i = 0; i < g.length; i++) {
    const v = g[i];
    const c = v <= 0 ? 0 : v >= 255 ? 255 : v;
    const lo = Math.floor(c),
      t = c - lo;
    g[i] = lo >= 255 ? lut[255] : lut[lo] * (1 - t) + lut[lo + 1] * t;
  }
}

const BAYER8 = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  return m.map((r) => r.map((v) => ((v + 0.5) / 64) * 255));
})();

// Fehlerverteilung: [dx, dy, Gewicht], Gewichte schon durch die Summe geteilt
const KERNELS: Record<string, [number, number, number][]> = {
  floyd: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]].map(([x, y, w]) => [x, y, w / 16]) as [number, number, number][],
  atkinson: [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]].map(([x, y]) => [x, y, 1 / 8]) as [number, number, number][],
  jarvis: [
    [1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
  ].map(([x, y, w]) => [x, y, w / 48]) as [number, number, number][],
  stucki: [
    [1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
  ].map(([x, y, w]) => [x, y, w / 42]) as [number, number, number][],
};

/** Skizze: Kantenstärke unter dieser Schwelle bleibt weiß (Rauschen), darüber wird sie verstärkt */
const SKETCH_FLOOR = 4,
  SKETCH_GAIN = 2;

export interface DitherOptions {
  mode: DitherMode;
  threshold: number;
  /** Halbton und Zeitungsdruck: Zellengröße in Ausgabepunkten und Winkel in Grad */
  cellPx: number;
  angle: number;
}

/**
 * Graustufen in Ausgabewerte umsetzen: 0 = volle Leistung (schwarz), 255 = aus.
 * Bei allen Verfahren außer Graustufen und Skizze sind die Werte nur 0 oder 255.
 */
export function dither(g: Float32Array, w: number, h: number, o: DitherOptions): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  switch (o.mode) {
    case 'grayscale':
      for (let i = 0; i < g.length; i++) out[i] = g[i];
      return out;
    case 'threshold':
      for (let i = 0; i < g.length; i++) out[i] = g[i] < o.threshold ? 0 : 255;
      return out;
    case 'ordered':
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = g[y * w + x] < BAYER8[y & 7][x & 7] ? 0 : 255;
      return out;
    case 'halftone': {
      // Runde Punkte in einem gedrehten Zellraster (Spot-Funktion (cos u + cos v) / 2)
      const a = (o.angle * Math.PI) / 180,
        ca = Math.cos(a),
        sa = Math.sin(a);
      const f = (2 * Math.PI) / Math.max(2, o.cellPx);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = (x * ca + y * sa) * f,
            v = (-x * sa + y * ca) * f;
          const spot = (Math.cos(u) + Math.cos(v)) * 0.25 + 0.5; // 0 … 1, Zellmitte = 1
          // Dunkle Bildstellen ergeben große Punkte, die von der Zellmitte aus wachsen
          out[y * w + x] = spot > g[y * w + x] / 255 ? 0 : 255;
        }
      return out;
    }
    case 'newsprint': {
      // Zeitungsdruck: ein runder Punkt je Zelle eines gedrehten Rasters, seine Fläche entspricht der mittleren
      // Dunkelheit der Zelle. Ab 50 % wachsen die Punkte zusammen und es bleiben helle Punkte in den Zellecken.
      const cell = Math.max(2, o.cellPx);
      const bl = blur(g, w, h, Math.max(1, Math.round(cell / 4)));
      const a = (o.angle * Math.PI) / 180,
        ca = Math.cos(a),
        sa = Math.sin(a);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = (x * ca + y * sa) / cell,
            v = (-x * sa + y * ca) / cell;
          const cu = Math.floor(u) + 0.5,
            cv = Math.floor(v) + 0.5;
          // Zellmitte zurück ins Bild, dort die (geglättete) Helligkeit lesen
          const px = Math.min(w - 1, Math.max(0, Math.floor((cu * ca - cv * sa) * cell))),
            py = Math.min(h - 1, Math.max(0, Math.floor((cu * sa + cv * ca) * cell)));
          const dark = Math.min(1, Math.max(0, 1 - bl[py * w + px] / 255));
          const du = u - cu,
            dv = v - cv;
          let black: boolean;
          if (dark <= 0.5) black = du * du + dv * dv < dark / Math.PI;
          else {
            const eu = 0.5 - Math.abs(du),
              ev = 0.5 - Math.abs(dv);
            black = eu * eu + ev * ev >= (1 - dark) / Math.PI;
          }
          out[y * w + x] = black ? 0 : 255;
        }
      return out;
    }
    case 'sketch': {
      // Skizze: Kanten (Sobel auf leicht geglättetem Bild) werden zu dunklen Strichen, gleichmäßige Flächen bleiben
      // weiß. Die Werte sind Graustufen, gelasert wird mit veränderlicher Leistung.
      const b = blur(g, w, h, 1);
      const at = (x: number, y: number) => b[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
          const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
          const mag = Math.sqrt(gx * gx + gy * gy) / 4;
          out[y * w + x] = 255 - Math.max(0, mag - SKETCH_FLOOR) * SKETCH_GAIN;
        }
      return out;
    }
    default: {
      const k = KERNELS[o.mode] ?? KERNELS.floyd;
      const e = g.slice();
      // Schlangenlinie: jede zweite Zeile rückwärts, vermeidet Richtungsmuster
      for (let y = 0; y < h; y++) {
        const rev = y & 1;
        for (let n = 0; n < w; n++) {
          const x = rev ? w - 1 - n : n;
          const i = y * w + x;
          const old = e[i];
          const nv = old < 128 ? 0 : 255;
          out[i] = nv;
          const err = old - nv;
          if (!err) continue;
          for (const [dx, dy, wt] of k) {
            const xx = rev ? x - dx : x + dx,
              yy = y + dy;
            if (xx < 0 || xx >= w || yy >= h) continue;
            e[yy * w + xx] += err * wt;
          }
        }
      }
      return out;
    }
  }
}

/** Ausgabepunkte eines Bildes für die gegebene Welt-Matrix und den Zeilenabstand. */
export function outputGrid(s: ImageShape, m: Mat, interval: number): { cols: number; rows: number; capped: boolean } {
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

/** Vollständige Verarbeitung: Ausgabewerte (0 = brennen … 255 = aus) im Raster cols × rows. */
export function processImage(s: ImageShape, L: ImageLayer, cols: number, rows: number): Uint8ClampedArray | null {
  const a = assets.get(s.asset);
  if (!a) return null;
  const src = sourceGray(a);
  if (!src) return null;
  const g = resample(src, a.w, a.h, cols, rows);
  applyAdjust(g, cols, rows, s.adjust, L.negative);
  const cellPx = 25.4 / Math.max(1, L.cells) / L.interval;
  return dither(g, cols, rows, { mode: L.dither, threshold: L.threshold, cellPx, angle: L.angle });
}

/** Einstellungen für den Rust-Kern; fehlende Felder (ältere Dateien) mit den Standardwerten */
const nativeLayer = (L: ImageLayer) => {
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
export async function processImageAsync(s: ImageShape, L: ImageLayer, cols: number, rows: number): Promise<Uint8Array | Uint8ClampedArray | null> {
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
export async function nativeScanLines(s: ImageShape, L: ImageLayer, cols: number, rows: number, m: Mat, im: Mat): Promise<Float64Array | null> {
  if (!(await nativeAsset(s))) return null;
  try {
    const buf = await native<ArrayBuffer>('image_scan', { id: s.asset, cols, rows, adjust: nativeAdjust(s), layer: nativeLayer(L), w: s.w, h: s.h, m, im });
    return new Float64Array(buf);
  } catch {
    return null;
  }
}

/** Graustufen nach den Anpassungen (ohne Dithering), z. B. zum Nachzeichnen. */
export function adjustedGray(s: ImageShape, cols: number, rows: number, negative = false): Float32Array | null {
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

function toCanvas(v: Uint8Array | Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
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

function resultKey(s: ImageShape, L: ImageLayer, cols: number, rows: number) {
  return JSON.stringify([s.asset, s.adjust, L.interval, L.dither, L.negative, L.threshold, L.cells, L.angle, cols, rows]);
}

/**
 * Verarbeitetes Bild für die Anzeige. Ändern sich Größe oder Einstellungen, wird kurz das alte Ergebnis
 * (gestreckt) gezeigt und das neue nach einer Pause berechnet, damit Ziehen und Schieberegler flüssig bleiben.
 */
export function displayCanvas(s: ImageShape, m: Mat, L: ImageLayer, immediate = false): HTMLCanvasElement | null {
  const a = assets.get(s.asset);
  if (!a?.img) return null;
  const { cols, rows } = outputGrid(s, m, L.interval);
  const key = resultKey(s, L, cols, rows);
  const c = results.get(s);
  if (c && c.key === key) return c.canvas;
  if (hasNative()) return nativeDisplay(s, L, cols, rows, key, c, immediate);
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

/**
 * Desktop-App: Ergebnis im Rust-Kern rechnen lassen. Bis es da ist, bleibt das alte Ergebnis (gestreckt) stehen;
 * danach zeichnen alle, die sich mit onImageReady angemeldet haben, neu. Während einer Rechnung wartet höchstens
 * ein neuer Auftrag je Bild, Zwischenstände beim Ziehen werden übersprungen.
 */
function nativeDisplay(s: ImageShape, L: ImageLayer, cols: number, rows: number, key: string, c: Cached | undefined, immediate: boolean) {
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
export async function processedPng(s: ImageShape, m: Mat, L: ImageLayer): Promise<string | null> {
  const { cols, rows } = outputGrid(s, m, L.interval);
  const v = await processImageAsync(s, L, cols, rows);
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
