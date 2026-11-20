import type { DitherMode, ImageAdjust, ImageOutput, ImageShape, Mat } from './model';
import { rasterizeImage } from './imageRaster';

/** Graustufen auf cols × rows bringen (Flächenmittel beim Verkleinern, bilinear beim Vergrößern). */
export function resample(src: Float32Array | Uint8ClampedArray, sw: number, sh: number, cols: number, rows: number): Float32Array {
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

/** Anzahl tatsächlich gebauter Mips (kein Zähler für Wiederverwendung oder kleine Quellen). */
export let downsampleRgbaCalls = 0;

/**
 * RGBA-Arbeitskopie für schnelle Vorschauen: längste Seite höchstens maxSide,
 * einfache (ungewichtete) Kastenmittelung über volle Quellpixel. Reine
 * Positionierungshilfe während des Ziehens — die Idle-/Job-Pfade rechnen
 * weiterhin ab der vollen Auflösung. Kleingerechnete Alpha-Anteile mitteln
 * sich wie die Farbkanäle (für die transiente Vorschau genau genug).
 */
export function downsampleRgba(src: Uint8ClampedArray, sw: number, sh: number, maxSide: number): { rgba: Uint8ClampedArray; width: number; height: number } {
  if (!(Math.max(sw, sh) > maxSide)) return { rgba: src, width: sw, height: sh };
  const cols = Math.max(1, Math.floor((sw * maxSide) / Math.max(sw, sh)));
  const rows = Math.max(1, Math.floor((sh * maxSide) / Math.max(sw, sh)));
  const fx = sw / cols, fy = sh / rows;
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) {
    const y0 = Math.max(0, Math.floor(y * fy)), y1 = Math.min(sh, Math.ceil((y + 1) * fy));
    for (let x = 0; x < cols; x++) {
      const x0 = Math.max(0, Math.floor(x * fx)), x1 = Math.min(sw, Math.ceil((x + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * sw;
        for (let sx = x0; sx < x1; sx++) {
          const i = (row + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const o = (y * cols + x) * 4, k = n ? 1 / n : 0;
      out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k; out[o + 3] = a * k;
    }
  }
  downsampleRgbaCalls++;
  return { rgba: out, width: cols, height: rows };
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

export type ImageProcessingErrorCode = 'geometry' | 'invalid-grid' | 'output-too-large' | 'asset-unavailable' | 'source-dimensions' | 'source-read' | 'display-unavailable';
export class ImageProcessingError extends Error {
  constructor(readonly code: ImageProcessingErrorCode, detail: string) {
    super(`Image processing (${code}): ${detail}`);
    this.name = 'ImageProcessingError';
  }
}
export function editedGrayPixels(source: { rgba: Uint8ClampedArray; width: number; height: number }, s: ImageShape, cols: number, rows: number, negative: boolean, world?: Mat, progress?: (phase: number) => void, sampling?: 'accurate' | 'fast') {
  const sampled = rasterizeImage(source, s, { width: cols, height: rows, world, sampling });
  if (!sampled.ok) throw new ImageProcessingError(sampled.reason === 'invalid' ? 'invalid-grid' : sampled.reason, 'Original image sampling failed');
  progress?.(1);
  const g = new Float32Array(cols * rows);
  for (let j = 0, i = 0; j < g.length; j++, i += 4) {
    const alpha = sampled.rgba[i + 3] / 255;
    g[j] = (0.299 * sampled.rgba[i] + 0.587 * sampled.rgba[i + 1] + 0.114 * sampled.rgba[i + 2]) * alpha + 255 * (1 - alpha);
  }
  applyAdjust(g, cols, rows, s.adjust, negative);
  progress?.(2);
  return { g, coverage: sampled.coverage };
}
export function maskExterior(values: Float32Array | Uint8ClampedArray, coverage: Uint8Array) {
  for (let i = 0; i < values.length; i++) if (!coverage[i]) values[i] = 255;
}
export function ditherOutput(g: Float32Array, cols: number, rows: number, L: ImageOutput) {
  const cellPx = 25.4 / Math.max(1, L.cells) / L.interval;
  return dither(g, cols, rows, { mode: L.dither, threshold: L.threshold, cellPx, angle: L.angle });
}
export function processEditedPixels(source: { rgba: Uint8ClampedArray; width: number; height: number }, s: ImageShape, L: ImageOutput, cols: number, rows: number, world?: Mat, progress?: (phase: number) => void, sampling?: 'accurate' | 'fast') {
  const { g, coverage } = editedGrayPixels(source, s, cols, rows, L.negative, world, progress, sampling);
  const values = ditherOutput(g, cols, rows, L);
  maskExterior(values, coverage);
  progress?.(3);
  return values;
}
