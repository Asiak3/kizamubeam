import type { Estimate, Moves } from './gcode';
import { segmentFraction } from './previewPlayback';

export interface PreviewView {
  z: number;
  ox: number;
  oy: number;
}

export const previewX = (x: number, view: PreviewView) => x * view.z + view.ox;
export const previewY = (y: number, view: PreviewView) => view.oy - y * view.z;

/** Zeichnet den Laserkopf und das laufende Teilstück über die gespeicherte Bahn. */
export function drawPreviewHead(
  c: CanvasRenderingContext2D,
  mv: Moves,
  est: Estimate,
  i: number,
  time: number,
  view: PreviewView,
  dpr: number,
  colorOf: (layer: number) => string,
): void {
  let hx = mv.x0,
    hy = mv.y0;
  if (i < mv.n) {
    // Während der Pause steht der Kopf am Bahnanfang; erst danach fährt er los.
    const f = segmentFraction(mv, est, i, time);
    const ax = i ? mv.x[i - 1] : mv.x0,
      ay = i ? mv.y[i - 1] : mv.y0;
    hx = ax + (mv.x[i] - ax) * f;
    hy = ay + (mv.y[i] - ay) * f;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mv.f[i] > 0 && mv.s[i] > 0) {
      c.strokeStyle = colorOf(mv.layer[i]);
      c.lineWidth = Math.max(1, Math.min(3, view.z * 0.1));
      c.beginPath();
      c.moveTo(previewX(ax, view), previewY(ay, view));
      c.lineTo(previewX(hx, view), previewY(hy, view));
      c.stroke();
    }
  } else if (mv.n) {
    hx = mv.x[mv.n - 1];
    hy = mv.y[mv.n - 1];
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.strokeStyle = '#e02020';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(previewX(hx, view), previewY(hy, view), 5, 0, Math.PI * 2);
  c.stroke();
}
