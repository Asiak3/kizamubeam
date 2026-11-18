// Zoom and pan of a generator dialog's drawing surface (#411): the arithmetic, without the DOM. Untouched, the surface
// fits the drawing's frame; once the user zooms in or pans, the view keeps its scale and the point in its middle (mm)
// until it is fitted again, whatever the drawing or the size of the surface does. The view never gets smaller than the
// fitted drawing, and the frame cannot be moved away: along an axis where it is larger than the surface its edges stop
// at the fitted margin, where it is smaller it stays in the middle. Plugins keep working in mm.

export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Screen px = o + mm × k */
export interface Fit {
  k: number;
  ox: number;
  oy: number;
}
/** A view the user chose: the scale (px per mm) and the point (mm) in the middle of the surface */
export interface UserView {
  k: number;
  cx: number;
  cy: number;
}

/** Zoom limit, relative to the fitted drawing (which is the smallest) */
export const MAX_ZOOM = 40;
/** The fitted frame takes this share of the width and of the height; the rest is its margin */
const FILL_X = 0.92;
const FILL_Y = 0.9;

/** The frame fitted into the surface (w × h px), with a small margin */
export function fitFrame(f: Frame, w: number, h: number): Fit {
  const fw = Math.max(1e-6, f.x1 - f.x0), fh = Math.max(1e-6, f.y1 - f.y0);
  const k = Math.min((w * FILL_X) / fw, (h * FILL_Y) / fh);
  return { k, ox: w / 2 - ((f.x0 + f.x1) / 2) * k, oy: h / 2 - ((f.y0 + f.y1) / 2) * k };
}

/** Along one axis: the offset that keeps the frame [a0, a1] (mm) at scale k on a surface of n px */
const keepIn = (o: number, a0: number, a1: number, k: number, n: number, fill: number) => {
  const m = (n * (1 - fill)) / 2;
  if ((a1 - a0) * k <= n - 2 * m + 1e-9) return n / 2 - ((a0 + a1) / 2) * k;
  if (o + a0 * k > m) return m - a0 * k;
  if (o + a1 * k < n - m) return n - m - a1 * k;
  return o;
};

/** A view within the limits: not smaller than fitted, not larger than MAX_ZOOM, the frame kept in */
function limit(fit: Fit, f: Frame, w: number, h: number): Fit {
  const base = fitFrame(f, w, h).k;
  const k = Math.max(base, Math.min(base * MAX_ZOOM, fit.k));
  // A changed scale keeps the point in the middle
  const cx = (w / 2 - fit.ox) / fit.k, cy = (h / 2 - fit.oy) / fit.k;
  const ox = w / 2 - cx * k, oy = h / 2 - cy * k;
  return { k, ox: keepIn(ox, f.x0, f.x1, k, w, FILL_X), oy: keepIn(oy, f.y0, f.y1, k, h, FILL_Y) };
}

/** Where the drawing is: the user's view (within the limits for this frame and size), or the fitted frame */
export function viewFit(v: UserView | null, f: Frame, w: number, h: number): Fit {
  if (!v) return fitFrame(f, w, h);
  return limit({ k: v.k, ox: w / 2 - v.cx * v.k, oy: h / 2 - v.cy * v.k }, f, w, h);
}

/** The view to keep for a fit: none when it is the fitted one (zoomed out all the way) */
const keep = (fit: Fit, f: Frame, w: number, h: number): UserView | null => {
  const g = limit(fit, f, w, h);
  if (g.k <= fitFrame(f, w, h).k * (1 + 1e-9)) return null;
  return { k: g.k, cx: (w / 2 - g.ox) / g.k, cy: (h / 2 - g.oy) / g.k };
};

/** Zoom by a factor around a point of the surface (px): the mm under it stay under it, as far as the limits allow */
export function zoomAt(v: UserView | null, f: Frame, w: number, h: number, factor: number, px: number, py: number): UserView | null {
  const cur = viewFit(v, f, w, h);
  if (!Number.isFinite(factor) || factor <= 0) return keep(cur, f, w, h);
  // The limits first, so the point under the pointer also holds at the largest and smallest zoom
  const base = fitFrame(f, w, h).k;
  const k = Math.max(base, Math.min(base * MAX_ZOOM, cur.k * factor));
  const x = (px - cur.ox) / cur.k, y = (py - cur.oy) / cur.k;
  return keep({ k, ox: px - x * k, oy: py - y * k }, f, w, h);
}

/** Move the drawing by dx, dy (px), as far as the limits allow */
export function panBy(v: UserView | null, f: Frame, w: number, h: number, dx: number, dy: number): UserView | null {
  const cur = viewFit(v, f, w, h);
  return keep({ k: cur.k, ox: cur.ox + (Number.isFinite(dx) ? dx : 0), oy: cur.oy + (Number.isFinite(dy) ? dy : 0) }, f, w, h);
}

/**
 * The size `draw` is told (px): the surface times the zoom. A plugin that works out the scale from its frame and the
 * size, as the app fits it, then gets the scale the drawing is shown at, and places its texts right at any zoom.
 */
export function drawSize(v: UserView | null, f: Frame | null, w: number, h: number): { width: number; height: number } {
  const z = v && f ? viewFit(v, f, w, h).k / fitFrame(f, w, h).k : 1;
  return { width: Math.round(w * z), height: Math.round(h * z) };
}
