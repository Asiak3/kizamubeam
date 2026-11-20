// Konstruktionsansicht (Blueprint): Layout für 4 Ansichten (3D oben, Vorne/Oben/Seite unten),
// einheitlicher Orthografik-Maßstab und 2D-Bemaßungs-Overlay in mm. Ohne DOM-Abhängigkeit prüfbar.

export type BlueprintViewId = 'iso' | 'front' | 'top' | 'side';

export interface BlueprintViewport {
  id: BlueprintViewId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BlueprintLayout {
  iso: BlueprintViewport;
  front: BlueprintViewport;
  top: BlueprintViewport;
  side: BlueprintViewport;
}

export interface Size3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Aufteilung wie in einer klassischen Konstruktionszeichnung:
 * oben groß die 3D-Ansicht, unten links Vorne, unten rechts übereinander Oben und Seite.
 */
export function computeBlueprintLayout(w: number, h: number): BlueprintLayout {
  const W = Math.max(4, Math.round(w));
  const H = Math.max(4, Math.round(h));
  const topH = Math.round(H * 0.52);
  const botH = H - topH;
  const leftW = Math.round(W * 0.5);
  const rightW = W - leftW;
  const rightTopH = Math.round(botH * 0.5);
  const rightBotH = botH - rightTopH;
  return {
    iso: { id: 'iso', x: 0, y: 0, w: W, h: topH },
    front: { id: 'front', x: 0, y: topH, w: leftW, h: botH },
    top: { id: 'top', x: leftW, y: topH, w: rightW, h: rightTopH },
    side: { id: 'side', x: leftW, y: topH + rightTopH, w: rightW, h: rightBotH },
  };
}

/**
 * Einheitlicher Maßstab (Pixel pro mm) für Vorne (X×Z), Oben (X×Y) und Seite (Y×Z),
 * mit Rand für Maßlinien und Beschriftung.
 */
export function computeOrthoScale(size: Size3, layout: BlueprintLayout): number {
  const sx = Math.max(size.x, 1);
  const sy = Math.max(size.y, 1);
  const sz = Math.max(size.z, 1);
  const pad = 0.64;
  const fit = (vp: BlueprintViewport, mw: number, mh: number) => Math.min((vp.w * pad) / mw, (vp.h * pad) / mh);
  return Math.max(0.01, Math.min(fit(layout.front, sx, sz), fit(layout.top, sx, sy), fit(layout.side, sy, sz)));
}

export interface BlueprintLabels {
  iso: string;
  front: string;
  top: string;
  side: string;
  dims: boolean;
}

function fmtMm(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} mm`;
}

function drawHDim(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, extFromY: number, label: string) {
  if (x2 - x1 < 8) return;
  const dir = y >= extFromY ? 1 : -1;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 1;
  // Hilfslinien
  ctx.beginPath();
  ctx.moveTo(x1, extFromY + dir * 4);
  ctx.lineTo(x1, y + dir * 4);
  ctx.moveTo(x2, extFromY + dir * 4);
  ctx.lineTo(x2, y + dir * 4);
  // Maßlinie
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  // Endstriche (45°-Ticks)
  ctx.moveTo(x1 - 3, y + 3);
  ctx.lineTo(x1 + 3, y - 3);
  ctx.moveTo(x2 - 3, y + 3);
  ctx.lineTo(x2 + 3, y - 3);
  ctx.stroke();

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = dir > 0 ? 'top' : 'bottom';
  ctx.fillText(label, (x1 + x2) / 2, y + dir * 4);
  ctx.restore();
}

function drawVDim(ctx: CanvasRenderingContext2D, y1: number, y2: number, x: number, extFromX: number, label: string) {
  if (y2 - y1 < 8) return;
  const dir = x >= extFromX ? 1 : -1;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(extFromX + dir * 4, y1);
  ctx.lineTo(x + dir * 4, y1);
  ctx.moveTo(extFromX + dir * 4, y2);
  ctx.lineTo(x + dir * 4, y2);
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.moveTo(x - 3, y1 + 3);
  ctx.lineTo(x + 3, y1 - 3);
  ctx.moveTo(x - 3, y2 + 3);
  ctx.lineTo(x + 3, y2 - 3);
  ctx.stroke();

  ctx.translate(x + dir * 12, (y1 + y2) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/**
 * Zeichnet das Blueprint-Raster, die Trennlinien der 4 Ansichten, die Ansichtsnamen
 * sowie die Außenbemaßung in mm auf das 2D-Overlay.
 */
export function drawBlueprintOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layout: BlueprintLayout,
  size: Size3 | null,
  pxPerMm: number,
  labels: BlueprintLabels,
) {
  ctx.clearRect(0, 0, w, h);

  // Feines Blueprint-Raster über die gesamte Tafel
  const step = 24;
  ctx.save();
  for (let x = 0; x <= w; x += step) {
    ctx.strokeStyle = x % (step * 4) === 0 ? 'rgba(255, 255, 255, 0.11)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.strokeStyle = y % (step * 4) === 0 ? 'rgba(255, 255, 255, 0.11)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  // Trennlinien zwischen den 4 Ansichten
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, layout.front.y + 0.5);
  ctx.lineTo(w, layout.front.y + 0.5);
  ctx.moveTo(layout.top.x + 0.5, layout.front.y);
  ctx.lineTo(layout.top.x + 0.5, h);
  ctx.moveTo(layout.top.x, layout.side.y + 0.5);
  ctx.lineTo(w, layout.side.y + 0.5);
  ctx.stroke();

  // Ansichtstitel
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const [vp, text] of [
    [layout.iso, labels.iso],
    [layout.front, labels.front],
    [layout.top, labels.top],
    [layout.side, labels.side],
  ] as const) {
    ctx.fillText(text, vp.x + 10, vp.y + 8);
  }
  ctx.restore();

  if (!size || !labels.dims) return;

  const drawOrthoDims = (vp: BlueprintViewport, mw: number, mh: number) => {
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    const pw = mw * pxPerMm;
    const ph = mh * pxPerMm;
    const x1 = cx - pw / 2;
    const x2 = cx + pw / 2;
    const y1 = cy - ph / 2;
    const y2 = cy + ph / 2;
    const gap = 14;
    drawHDim(ctx, x1, x2, Math.min(vp.y + vp.h - 20, y2 + gap), y2, fmtMm(mw));
    drawVDim(ctx, y1, y2, Math.min(vp.x + vp.w - 22, x2 + gap), x2, fmtMm(mh));
  };

  drawOrthoDims(layout.front, size.x, size.z);
  drawOrthoDims(layout.top, size.x, size.y);
  drawOrthoDims(layout.side, size.y, size.z);
}
