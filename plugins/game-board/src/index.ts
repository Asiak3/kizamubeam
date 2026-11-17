// Chessboard and game board generator (#309): n × m squares, dark squares as outlines (to fill), hatch, crosses or a
// small checkerboard, coordinates on the border, and the board outline to cut. Squares, patterns and coordinates
// are engraved (part marks); the outline is cut.
import { definePlugin, mm, roundedRect, strokeText, textWidth, type Issue, type SubPath } from '../../sdk/ts';

interface P {
  [k: string]: number | string | boolean;
  cols: number;
  rows: number;
  size: number;
  sizeIncludesBorder: boolean;
  style: string;
  spacing: number;
  gridLines: boolean;
  coords: boolean;
  coordSize: number;
  bothSides: boolean;
  border: number;
  corner: number;
}

const line = (x1: number, y1: number, x2: number, y2: number): SubPath => ({ closed: false, nodes: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
const square = (x: number, y: number, s: number): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });

/** Diagonal hatch inside the square at (x, y) with side s: lines u - v = d (dir 1) or u + v = d (dir -1), spacing sp */
function hatch(x: number, y: number, s: number, sp: number, dir: 1 | -1): SubPath[] {
  const out: SubPath[] = [];
  const step = sp * Math.SQRT2;
  const n = Math.floor(s / step);
  for (let i = -n; i <= n; i++) {
    const d = i * step;
    if (Math.abs(d) >= s - 1e-9) continue;
    // Segment of u - v = d inside [0, s]²
    const a = { u: Math.max(0, d), v: Math.max(0, -d) };
    const b = { u: Math.min(s, s + d), v: Math.min(s, s - d) };
    if (dir === 1) out.push(line(x + a.u, y + a.v, x + b.u, y + b.v));
    else out.push(line(x + a.u, y + s - a.v, x + b.u, y + s - b.v));
  }
  return out;
}

/** Column name: A … Z, then numbers for wide boards */
const colName = (c: number, cols: number) => (cols <= 26 ? String.fromCharCode(65 + c) : String(c + 1));

definePlugin<P>({
  validate(p) {
    const out: Issue[] = [];
    const inner = p.sizeIncludesBorder ? p.size - 2 * p.border : p.size;
    const cell = inner / p.cols;
    if (inner <= 0 || cell < 3) out.push({ key: 'size', level: 'error', code: 'squares-too-small', values: { min: 3 } });
    if (p.coords && p.coordSize > p.border - 1) out.push({ key: 'coordSize', level: 'warn', code: 'coords-too-large', values: { max: Math.max(0, p.border - 1) } });
    if (p.style !== 'fill' && p.style !== 'none' && p.spacing > cell / 3) out.push({ key: 'spacing', level: 'warn', code: 'spacing-wide' });
    if (p.corner > p.border + 1e-9 && p.border > 0) out.push({ key: 'corner', level: 'warn', code: 'corner-into-board' });
    return out;
  },
  generate(p) {
    const inner = p.sizeIncludesBorder ? p.size - 2 * p.border : p.size;
    const cell = inner / p.cols;
    const W = cell * p.cols, H = cell * p.rows;
    const x0 = -W / 2, y0 = -H / 2;
    const marks: SubPath[] = [];
    // Playing area: outer frame and grid lines
    marks.push({ closed: true, nodes: [{ x: x0, y: y0 }, { x: x0 + W, y: y0 }, { x: x0 + W, y: y0 + H }, { x: x0, y: y0 + H }] });
    if (p.gridLines) {
      for (let c = 1; c < p.cols; c++) marks.push(line(x0 + c * cell, y0, x0 + c * cell, y0 + H));
      for (let r = 1; r < p.rows; r++) marks.push(line(x0, y0 + r * cell, x0 + W, y0 + r * cell));
    }
    let dark = 0;
    for (let r = 0; r < p.rows; r++)
      for (let c = 0; c < p.cols; c++) {
        // The bottom-left square is dark, as on a chessboard (a1)
        if ((p.rows - 1 - r + c) % 2 !== 0) continue;
        dark++;
        const x = x0 + c * cell, y = y0 + r * cell;
        if (p.style === 'fill') marks.push(square(x, y, cell));
        else if (p.style === 'hatch') marks.push(...hatch(x, y, cell, p.spacing, 1));
        else if (p.style === 'crosshatch') marks.push(...hatch(x, y, cell, p.spacing, 1), ...hatch(x, y, cell, p.spacing, -1));
        else if (p.style === 'cross') marks.push(line(x, y, x + cell, y + cell), line(x + cell, y, x, y + cell));
        else if (p.style === 'mini') {
          const k = 4, s = cell / k;
          for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if ((i + j) % 2 === 1) marks.push(square(x + j * s, y + i * s, s));
        }
      }
    if (p.coords && p.border > 0) {
      const size = Math.min(p.coordSize, p.border * 0.8, cell * 0.6);
      const mid = p.border / 2;
      for (let c = 0; c < p.cols; c++) {
        const x = x0 + (c + 0.5) * cell, t = colName(c, p.cols);
        marks.push(...strokeText(t, size, { x, y: y0 + H + mid, align: 'center', valign: 'middle' }));
        if (p.bothSides) marks.push(...strokeText(t, size, { x, y: y0 - mid, align: 'center', valign: 'middle', angle: 180 }));
      }
      for (let r = 0; r < p.rows; r++) {
        const y = y0 + (r + 0.5) * cell, t = String(p.rows - r);
        const w = textWidth(t, size);
        if (w <= p.border * 0.9) {
          marks.push(...strokeText(t, size, { x: x0 - mid, y, align: 'center', valign: 'middle' }));
          if (p.bothSides) marks.push(...strokeText(t, size, { x: x0 + W + mid, y, align: 'center', valign: 'middle', angle: 180 }));
        }
      }
    }
    const OW = W + 2 * p.border, OH = H + 2 * p.border;
    return {
      parts: [{ key: 'board', subs: [roundedRect(OW, OH, p.corner)], marks, at: { x: 0, y: 0 } }],
      info: [
        ['square', `${mm(cell)} mm`],
        ['board-size', `${mm(OW)} × ${mm(OH)} mm`],
        ['dark-squares', String(dark)],
      ],
    };
  },
});
