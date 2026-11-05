// Kamera: USB-Kamerabild als Hintergrund der Arbeitsfläche, mit Linsenkorrektur und Ausrichtung auf das Bett.
//
// Modell: Bettpunkt (mm, Maschinenkoordinaten, y nach oben) → Homographie H → normiertes, unverzeichnetes Bild
// → radiale Verzeichnung (k1, k2) → Bildpunkt. Normiert heißt: Ursprung in der Bildmitte, Einheit = halbe längere
// Bildseite. Damit gilt eine Kalibrierung für jede Auflösung mit demselben Seitenverhältnis.
// Kalibriert wird mit gelaserten Markierungen bekannter Lage, die man im Kamerabild anklickt (wie LightBurns
// Ausrichtung). Ab 6 Markierungen wird die Linsenverzeichnung mitbestimmt.
//
// Kopfkamera: Die Kamera fährt mit dem Laserkopf. Die Kalibrierung gilt für die Kopfposition beim Foto (head);
// steht der Kopf woanders, ist das Bild um die Differenz verschoben. Ein Bettpunkt b erscheint bei Kopfposition P
// dort, wo bei der Kalibrierung der Punkt b − (P − head) erschien.

import type { Pt } from './model';
import { t } from './i18n';
import { hasNative, native } from './native';

export interface CameraCalib {
  /** Bildgröße bei der Kalibrierung in Pixeln */
  w: number;
  h: number;
  /** Radiale Verzeichnung in normierten Koordinaten */
  k1: number;
  k2: number;
  /** Homographie Bett (mm) → normiertes, unverzeichnetes Bild; zeilenweise 3×3, H[8] = 1 */
  H: number[];
  /** Mittlerer und größter Restfehler der Markierungen in mm */
  err: number;
  maxErr: number;
  /** Bettgröße bei der Kalibrierung */
  bedW: number;
  bedH: number;
  date: string;
  /** Nur Kopfkamera: Kopfposition (Werkstückkoordinaten, mm) beim Kalibrierfoto */
  head?: Pt;
}

/** Rechteck in Bettkoordinaten (mm, y nach oben) */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MarkSettings {
  /** Markierungen je Zeile und Spalte */
  n: number;
  /** Abstand der äußeren Markierungen vom Bettrand in mm */
  margin: number;
  /** Durchmesser einer Markierung in mm */
  size: number;
  speed: number;
  power: number;
  /** Nur Kopfkamera: Abstand der äußeren Markierungen voneinander in mm */
  field: number;
  /** Nur Kopfkamera: zuletzt gewählte Mitte des Markierungsfelds. */
  center?: Pt;
}

/** fixed: fest über dem Bett; head: am Laserkopf, fährt mit */
export type CameraMount = 'fixed' | 'head';

export interface CameraSettings {
  /** Eindeutige Kennung und Name in der Kameraliste */
  id: string;
  name: string;
  mount: CameraMount;
  /** Gewählte Kamera (MediaDeviceInfo.deviceId) und ihr Name zum Wiederfinden */
  cam: string;
  label: string;
  /** Network camera: MJPEG stream or single-image address (http://…); empty = USB camera */
  url?: string;
  /** Gewünschte Auflösung */
  width: number;
  height: number;
  show: boolean;
  /** Deckkraft 0 … 1 */
  opacity: number;
  live: boolean;
  calib: CameraCalib | null;
  marks: MarkSettings;
}

export const DEFAULT_CAMERA: CameraSettings = {
  id: '',
  name: '',
  mount: 'fixed',
  cam: '',
  label: '',
  width: 1920,
  height: 1080,
  show: true,
  opacity: 0.8,
  live: false,
  calib: null,
  marks: { n: 3, margin: 25, size: 10, speed: 1000, power: 20, field: 40 },
};

// ---------- Mathematik ----------

const norm = (w: number, h: number) => Math.max(w, h) / 2;

/** Pixel → normierte Bildkoordinaten */
export function toNorm(p: Pt, w: number, h: number): Pt {
  const f = norm(w, h);
  return { x: (p.x - w / 2) / f, y: (p.y - h / 2) / f };
}
export function fromNorm(q: Pt, w: number, h: number): Pt {
  const f = norm(w, h);
  return { x: q.x * f + w / 2, y: q.y * f + h / 2 };
}

export function distort(q: Pt, k1: number, k2: number): Pt {
  const r2 = q.x * q.x + q.y * q.y;
  const s = 1 + k1 * r2 + k2 * r2 * r2;
  return { x: q.x * s, y: q.y * s };
}

/** Umkehrung der Verzeichnung (Fixpunkt-Iteration, für kleine bis mittlere Verzeichnung ausreichend) */
export function undistort(d: Pt, k1: number, k2: number): Pt {
  let q = { ...d };
  for (let i = 0; i < 30; i++) {
    const r2 = q.x * q.x + q.y * q.y;
    const s = 1 + k1 * r2 + k2 * r2 * r2;
    q = { x: d.x / s, y: d.y / s };
  }
  return q;
}

export function applyH(H: number[], x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

export function invertH(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  return r.map((v) => v / r[8]);
}

/** Bettpunkt (mm) → Bildpunkt (Pixel) bei Bildgröße w × h */
export function bedToPixel(c: CameraCalib, x: number, y: number, w: number, h: number): Pt {
  return fromNorm(distort(applyH(c.H, x, y), c.k1, c.k2), w, h);
}

/** Bildpunkt (Pixel) → Bettpunkt (mm) */
export function pixelToBed(c: CameraCalib, p: Pt, w: number, h: number): Pt {
  const q = undistort(toNorm(p, w, h), c.k1, c.k2);
  return applyH(invertH(c.H), q.x, q.y);
}

/** Lineares Gleichungssystem A·x = b (Gauß mit Pivotsuche); null bei Singularität */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Homographie aus Punktpaaren (≥ 4) per kleinster Quadrate, h33 = 1 */
export function homography(src: Pt[], dst: Pt[]): number[] | null {
  // Für die Kondition beide Seiten auf Mittelpunkt 0 und mittleren Abstand √2 bringen
  const normT = (pts: Pt[]) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length,
      cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
    const k = Math.SQRT2 / d;
    return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
  };
  const Ts = normT(src),
    Td = normT(dst);
  const s = src.map((p) => applyH(Ts, p.x, p.y)),
    d = dst.map((p) => applyH(Td, p.x, p.y));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row: number[], v: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * v;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < s.length; i++) {
    const { x, y } = s[i],
      { x: u, y: v } = d[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  // H = Td⁻¹ · Hn · Ts
  const r = mul3(mul3(invertH(Td), Hn), Ts);
  return r.map((v) => v / r[8]);
}

function mul3(A: number[], B: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return r;
}

/**
 * Kalibrierung aus Markierungen: bed = Sollpositionen in mm, img = angeklickte Bildpunkte in Pixeln (Bild w × h).
 * lens: Linsenverzeichnung mitbestimmen (k1 ab 6 Punkten, k2 ab 16 Punkten).
 */
export function calibrate(bed: Pt[], img: Pt[], w: number, h: number, lens: boolean, bedW: number, bedH: number): CameraCalib | null {
  const n = bed.length;
  if (n < 4) return null;
  const q = img.map((p) => toNorm(p, w, h));
  const H0 = homography(bed, q);
  if (!H0) return null;
  const nk = !lens ? 0 : n >= 16 ? 2 : n >= 6 ? 1 : 0;
  // Parameter: H[0..7] und k1, k2; Bettkoordinaten in 100 mm, damit die Parameter ähnlich groß sind
  const S = 100;
  const Hs = mul3(H0, [S, 0, 0, 0, S, 0, 0, 0, 1]);
  let p = [...Hs.slice(0, 8).map((v) => v / Hs[8]), 0, 0].slice(0, 8 + nk);
  const bs = bed.map((b) => ({ x: b.x / S, y: b.y / S }));
  const resid = (p: number[]) => {
    const H = [...p.slice(0, 8), 1];
    const k1 = nk > 0 ? p[8] : 0,
      k2 = nk > 1 ? p[9] : 0;
    const r: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = distort(applyH(H, bs[i].x, bs[i].y), k1, k2);
      r.push(d.x - q[i].x, d.y - q[i].y);
    }
    return r;
  };
  const sq = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  // Levenberg-Marquardt mit numerischer Ableitung
  let r = resid(p),
    cost = sq(r),
    lambda = 1e-3;
  for (let it = 0; it < 200 && nk > 0; it++) {
    const m = p.length;
    const J: number[][] = r.map(() => new Array(m).fill(0));
    for (let j = 0; j < m; j++) {
      const e = 1e-7 * Math.max(1, Math.abs(p[j]));
      const pp = [...p];
      pp[j] += e;
      const rr = resid(pp);
      for (let i = 0; i < r.length; i++) J[i][j] = (rr[i] - r[i]) / e;
    }
    const JtJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jtr = Array.from({ length: m }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    while (lambda < 1e10) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const dp = solve(A, Jtr);
      if (!dp) break;
      const np = p.map((v, j) => v + dp[j]);
      const nr = resid(np),
        nc = sq(nr);
      if (nc < cost) {
        const done = cost - nc < 1e-14 * Math.max(1, cost);
        p = np;
        r = nr;
        cost = nc;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = !done;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  const Hsc = [...p.slice(0, 8), 1];
  const H = mul3(Hsc, [1 / S, 0, 0, 0, 1 / S, 0, 0, 0, 1]);
  const c: CameraCalib = {
    w, h, k1: nk > 0 ? p[8] : 0, k2: nk > 1 ? p[9] : 0, H: H.map((v) => v / H[8]), err: 0, maxErr: 0, bedW, bedH,
    date: new Date().toISOString(),
  };
  // Restfehler in mm: angeklickte Punkte zurück aufs Bett rechnen
  const errs = img.map((pt, i) => {
    const b = pixelToBed(c, pt, w, h);
    return Math.hypot(b.x - bed[i].x, b.y - bed[i].y);
  });
  c.err = errs.reduce((s, v) => s + v, 0) / n;
  c.maxErr = Math.max(...errs);
  if (!c.H.every(isFinite) || !isFinite(c.err)) return null;
  return c;
}

/** Sollpositionen der Markierungen (Maschinenkoordinaten, y nach oben), Reihenfolge: hinten links → vorne rechts */
export function markPositions(m: MarkSettings, bedW: number, bedH: number): Pt[] {
  return markPositionsIn(m, { x0: m.margin, y0: m.margin, x1: bedW - m.margin, y1: bedH - m.margin });
}

/** Markierungen im Rechteck r (äußere Markierungen auf dem Rand), Reihenfolge wie markPositions */
export function markPositionsIn(m: MarkSettings, r: Rect): Pt[] {
  const pts: Pt[] = [];
  const n = Math.max(2, m.n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) pts.push({ x: r.x0 + ((r.x1 - r.x0) * j) / (n - 1), y: r.y1 - ((r.y1 - r.y0) * i) / (n - 1) });
  return pts;
}

/** Markierungsfeld einer Kopfkamera um die Mitte c */
export function headMarkRect(m: MarkSettings, c: Pt): Rect {
  const f = m.field / 2;
  return { x0: c.x - f, y0: c.y - f, x1: c.x + f, y1: c.y + f };
}

/** Verschiebung des Kamerabilds einer Kopfkamera bei Kopfposition pos gegenüber der Kalibrierung */
export function headShift(c: CameraCalib, pos: Pt | null): Pt {
  return c.head && pos ? { x: pos.x - c.head.x, y: pos.y - c.head.y } : { x: 0, y: 0 };
}

/** Sichtbereich des Kamerabilds auf dem Bett (umschließendes Rechteck, bei Kopfkameras an der Kalibrierposition) */
export function footprint(c: CameraCalib, w: number, h: number): Rect {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const N = 16;
  for (let i = 0; i <= N; i++)
    for (const p of [{ x: (w * i) / N, y: 0 }, { x: (w * i) / N, y: h }, { x: 0, y: (h * i) / N }, { x: w, y: (h * i) / N }]) {
      const b = pixelToBed(c, p, w, h);
      if (!isFinite(b.x) || !isFinite(b.y)) continue;
      r.x0 = Math.min(r.x0, b.x);
      r.y0 = Math.min(r.y0, b.y);
      r.x1 = Math.max(r.x1, b.x);
      r.y1 = Math.max(r.y1, b.y);
    }
  return r;
}

/** Größtes achsparalleles Rechteck um die Bildmitte, das ganz im Kamerabild liegt (für lückenloses Abfahren) */
export function coverRect(c: CameraCalib, w: number, h: number): Rect {
  const f = footprint(c, w, h);
  const mid = pixelToBed(c, { x: w / 2, y: h / 2 }, w, h);
  const inside = (r: Rect) => {
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const x = r.x0 + ((r.x1 - r.x0) * i) / N,
        y = r.y0 + ((r.y1 - r.y0) * i) / N;
      for (const [X, Y] of [[x, r.y0], [x, r.y1], [r.x0, y], [r.x1, y]]) {
        const p = bedToPixel(c, X, Y, w, h);
        if (!(p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h)) return false;
      }
    }
    return true;
  };
  // Von der Bildmitte aus in beide Richtungen getrennt so weit wie möglich ausdehnen
  let r = { x0: mid.x, y0: mid.y, x1: mid.x, y1: mid.y };
  const steps = 40;
  const dx = (f.x1 - f.x0) / 2 / steps,
    dy = (f.y1 - f.y0) / 2 / steps;
  for (let k = 0; k < 4 * steps; k++) {
    let grew = false;
    for (const side of ['x0', 'x1', 'y0', 'y1'] as const) {
      const n = { ...r };
      n[side] += (side === 'x0' ? -dx : side === 'x1' ? dx : side === 'y0' ? -dy : dy);
      if (inside(n)) ((r = n), (grew = true));
    }
    if (!grew) break;
  }
  return r;
}

/** Passt die Kalibrierung zum Seitenverhältnis des Kamerabilds? */
export function calibFits(c: CameraCalib, w: number, h: number) {
  return Math.abs(c.w / c.h - w / h) < 0.01;
}

// ---------- Entzerrung ----------

/** Zuordnung Ausgabepixel (Bett, Weltkoordinaten y nach unten) → Quellpixel im Kamerabild */
export interface Remap {
  w: number;
  h: number;
  /** Quellkoordinaten (Pixel), NaN = außerhalb des Kamerabilds */
  sx: Float32Array;
  sy: Float32Array;
  srcW: number;
  srcH: number;
  /** Abgedeckter Bettbereich (die erste Zeile liegt bei y1) */
  rect: Rect;
}

export function buildRemap(c: CameraCalib, srcW: number, srcH: number, bedW: number, bedH: number, maxPx = 1600): Remap {
  const mmPx = Math.max(bedW, bedH) / maxPx;
  return buildRemapRect(c, srcW, srcH, { x0: 0, y0: 0, x1: bedW, y1: bedH }, mmPx);
}

/** Entzerrung für den Bettbereich r mit mmPx mm je Ausgabepixel; shift = Verschiebung einer Kopfkamera (headShift) */
export function buildRemapRect(c: CameraCalib, srcW: number, srcH: number, r: Rect, mmPx: number, shift: Pt = { x: 0, y: 0 }): Remap {
  const w = Math.max(1, Math.round((r.x1 - r.x0) / mmPx)),
    h = Math.max(1, Math.round((r.y1 - r.y0) / mmPx));
  const sx = new Float32Array(w * h),
    sy = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const Y = r.y1 - ((j + 0.5) * (r.y1 - r.y0)) / h - shift.y;
    for (let i = 0; i < w; i++) {
      const X = r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / w - shift.x;
      const p = bedToPixel(c, X, Y, srcW, srcH);
      const k = j * w + i;
      const inside = p.x >= 0 && p.y >= 0 && p.x <= srcW - 1 && p.y <= srcH - 1;
      sx[k] = inside ? p.x : NaN;
      sy[k] = inside ? p.y : NaN;
    }
  }
  return { w, h, sx, sy, srcW, srcH, rect: r };
}

/** Kamerabild entzerren (bilinear) */
export function warp(src: ImageData, r: Remap, out: ImageData) {
  const s = src.data,
    o = out.data,
    W = src.width;
  for (let k = 0, n = r.w * r.h; k < n; k++) {
    const x = r.sx[k],
      y = r.sy[k],
      ok = k * 4;
    if (x !== x) {
      o[ok + 3] = 0;
      continue;
    }
    const x0 = x | 0,
      y0 = y | 0,
      fx = x - x0,
      fy = y - y0;
    const x1 = Math.min(x0 + 1, W - 1),
      y1 = Math.min(y0 + 1, src.height - 1);
    const a = (y0 * W + x0) * 4,
      b = (y0 * W + x1) * 4,
      c = (y1 * W + x0) * 4,
      d = (y1 * W + x1) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const top = s[a + ch] + (s[b + ch] - s[a + ch]) * fx;
      const bot = s[c + ch] + (s[d + ch] - s[c + ch]) * fx;
      o[ok + ch] = top + (bot - top) * fy;
    }
    o[ok + 3] = 255;
  }
}

// ---------- Kamerazugriff ----------

export function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent);
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return mac
      ? t('Kein Zugriff auf die Kamera. In den Systemeinstellungen unter Datenschutz & Sicherheit › Kamera KizamuBeam erlauben (beim Start aus dem Terminal: das Terminal).')
      : t('Kein Zugriff auf die Kamera. Bitte den Zugriff erlauben.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('Keine Kamera gefunden.');
  if (name === 'NotReadableError') return t('Die Kamera wird gerade von einem anderen Programm benutzt.');
  if (!navigator.mediaDevices?.getUserMedia) return t('Diese Umgebung bietet keinen Kamerazugriff.');
  return t('Kamera-Fehler: {message}', { message: (e as Error)?.message ?? String(e) });
}

/** Default addresses of common network cameras, offered in the camera dialog */
export const NETCAM_EXAMPLES = ['http://127.0.0.1:8282/stream', 'http://192.168.4.1:81/stream'];

export class CameraStream {
  stream: MediaStream | null = null;
  readonly video = document.createElement('video');
  private grabCanvas = document.createElement('canvas');
  // Network camera (read in Rust, src-tauri/src/netcam.rs): latest decoded image and its number
  /** Preview of a network camera (the USB camera shows its video element) */
  private netView = document.createElement('canvas');
  private net: { id: number; url: string; image: ImageBitmap | null; seq: number; error: string; frames: number; timer: number } | null = null;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get open() {
    return !!this.stream || !!this.net;
  }
  /** Element showing the live image */
  get view(): HTMLVideoElement | HTMLCanvasElement {
    return this.net ? this.netView : this.video;
  }
  get width() {
    return this.net ? (this.net.image?.width ?? 0) : this.video.videoWidth;
  }
  get height() {
    return this.net ? (this.net.image?.height ?? 0) : this.video.videoHeight;
  }

  /** Open a network camera and wait for its first image */
  private async startNet(url: string) {
    if (!hasNative()) throw new Error(t('Netzwerk-Kameras gehen nur in der Desktop-App.'));
    const id = await native<number>('netcam_open', { url });
    const n: NonNullable<CameraStream['net']> = { id, url, image: null, seq: 0, error: '', frames: 0, timer: 0 };
    this.net = n;
    const pull = async () => {
      if (this.net !== n) return;
      try {
        const buf = await native<ArrayBuffer>('netcam_frame', { id, since: n.seq });
        n.error = '';
        if (buf.byteLength > 8) {
          const seq = Number(new DataView(buf).getBigUint64(0, true));
          const img = await createImageBitmap(new Blob([buf.slice(8)], { type: 'image/jpeg' }));
          if (this.net !== n) return img.close();
          n.image?.close();
          n.image = img;
          const v = this.netView;
          if (v.isConnected) {
            if (v.width !== img.width || v.height !== img.height) ((v.width = img.width), (v.height = img.height));
            v.getContext('2d')!.drawImage(img, 0, 0);
          }
          n.seq = seq;
          n.frames++;
        }
      } catch (e) {
        n.error = String((e as Error)?.message ?? e);
      }
      if (this.net === n) n.timer = window.setTimeout(pull, 40);
    };
    pull();
    for (let i = 0; i < 200 && !n.image; i++) {
      if (n.error && i > 20) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    if (!n.image) {
      const err = n.error || t('Keine Antwort');
      this.stop();
      throw new Error(t('Netzwerk-Kamera {url}: {error}', { url, error: err }));
    }
  }

  /** Angeschlossene Kameras; Namen gibt es erst nach der ersten Freigabe */
  static async list(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  }

  /** USB camera (cam = deviceId) or, with url, a network camera */
  async start(cam: string, width: number, height: number, url = '') {
    this.stop();
    if (url) return this.startNet(url);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('Kein Kamerazugriff in dieser Umgebung'));
    const video: MediaTrackConstraints = { width: { ideal: width }, height: { ideal: height } };
    if (cam) video.deviceId = { exact: cam };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      // Gespeicherte Kamera nicht mehr da: irgendeine nehmen
      if (!cam || (e as Error).name !== 'OverconstrainedError') throw e;
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: width }, height: { ideal: height } }, audio: false });
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    // Warten, bis Bilder kommen
    for (let i = 0; i < 100 && !this.video.videoWidth; i++) await new Promise((r) => setTimeout(r, 30));
  }

  /** deviceId der laufenden Kamera */
  get deviceId(): string {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
  }
  get label(): string {
    return this.net?.url ?? this.stream?.getVideoTracks()[0]?.label ?? '';
  }

  stop() {
    const n = this.net;
    if (n) {
      this.net = null;
      clearTimeout(n.timer);
      n.image?.close();
      native('netcam_close', { id: n.id }).catch(() => {});
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Warten, bis n neue Bilder angekommen sind (nach einer Kopfbewegung liegen noch alte im Puffer) */
  async freshFrames(n = 3) {
    const net = this.net;
    if (net) {
      const want = net.frames + n;
      for (let i = 0; i < 100 && this.net === net && net.frames < want; i++) await new Promise((r) => setTimeout(r, 30));
      return;
    }
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    for (let i = 0; i < n; i++)
      await new Promise<void>((res) => {
        const done = setTimeout(res, 250);
        v.requestVideoFrameCallback?.(() => (clearTimeout(done), res()));
      });
  }

  /** Aktuelles Bild als Canvas (Rohbild, unverzerrt) */
  grab(): HTMLCanvasElement | null {
    const w = this.width,
      h = this.height;
    if (!this.open || !w || !h) return null;
    const c = this.grabCanvas;
    if (c.width !== w || c.height !== h) ((c.width = w), (c.height = h));
    c.getContext('2d', { willReadFrequently: true })!.drawImage(this.net ? this.net.image! : this.video, 0, 0, w, h);
    return c;
  }
}
