// Vorschau-Zoom/Pan für Bilddialoge: reine, DOM-freie Mathematik (testbar, DPR-unabhängig).
// view.z ist ein Faktor auf die Einpass-Skalierung (1 = Fit), ox/oy ein Offset in CSS-px.

export interface ZoomView {
  z: number;
  ox: number;
  oy: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.25;

export function fitScale(sw: number, sh: number, vw: number, vh: number): number {
  if (!(sw > 0) || !(sh > 0) || !(vw > 0) || !(vh > 0)) return 1;
  return Math.min(vw / sw, vh / sh);
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Einpass-Skalierung in Ausgabepixel je Bildpunkt, DPR-korrekt über CSS-px. */
export function zoomedScale(sw: number, sh: number, vw: number, vh: number, z: number): number {
  return fitScale(sw, sh, vw, vh) * clampZoom(z);
}

/** Linke/obere Bildecke in CSS-px bei gegebenem View (Bild zentriert + Offset). */
export function imageOrigin(sw: number, sh: number, vw: number, vh: number, view: ZoomView): { x: number; y: number; scale: number } {
  const scale = zoomedScale(sw, sh, vw, vh, view.z);
  return { x: (vw - sw * scale) / 2 + view.ox, y: (vh - sh * scale) / 2 + view.oy, scale };
}

/** Maximaler Pan-Offset, damit das Bild nicht aus der Ansicht verloren geht. */
export function panLimit(sw: number, sh: number, vw: number, vh: number, z: number): { x: number; y: number } {
  const scale = zoomedScale(sw, sh, vw, vh, z);
  return { x: Math.max(vw, sw * scale) / 2, y: Math.max(vh, sh * scale) / 2 };
}

export function clampPan(view: ZoomView, sw: number, sh: number, vw: number, vh: number): ZoomView {
  const lim = panLimit(sw, sh, vw, vh, view.z);
  return {
    z: view.z,
    ox: Math.min(lim.x, Math.max(-lim.x, view.ox)),
    oy: Math.min(lim.y, Math.max(-lim.y, view.oy)),
  };
}

/** Zoom auf die Cursorposition: Der Bildpunkt unter dem Cursor bleibt unter dem Cursor. */
export function zoomAtCursor(view: ZoomView, cx: number, cy: number, factor: number, sw: number, sh: number, vw: number, vh: number): ZoomView {
  if (!Number.isFinite(factor) || factor <= 0) return view;
  const z = clampZoom(view.z * factor);
  if (z === view.z) return view;
  const before = imageOrigin(sw, sh, vw, vh, view);
  const ix = (cx - before.x) / before.scale;
  const iy = (cy - before.y) / before.scale;
  const after = imageOrigin(sw, sh, vw, vh, { z, ox: 0, oy: 0 });
  const next: ZoomView = { z, ox: cx - (after.x + ix * after.scale), oy: cy - (after.y + iy * after.scale) };
  return clampPan(next, sw, sh, vw, vh);
}

export function panBy(view: ZoomView, dx: number, dy: number, sw: number, sh: number, vw: number, vh: number): ZoomView {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return view;
  return clampPan({ z: view.z, ox: view.ox + dx, oy: view.oy + dy }, sw, sh, vw, vh);
}

export function resetZoomView(): ZoomView {
  return { z: ZOOM_MIN, ox: 0, oy: 0 };
}

/** Sichtbarer Zoomfaktor in Prozent (100 % = Fit). */
export function zoomPercent(view: ZoomView): number {
  return Math.round(clampZoom(view.z) * 100);
}

/** Canvas-Backing-Store in Gerätepixeln zu CSS-Größe und DPR (für DPR=2/3-Teste). */
export function backingSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return { w: Math.max(1, Math.round(cssW * d)), h: Math.max(1, Math.round(cssH * d)) };
}
