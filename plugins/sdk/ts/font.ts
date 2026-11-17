// Single-stroke font for plugins (numbers on puzzle pieces, ruler scales, board coordinates). Plugins have no
// access to the app's fonts, so labels are drawn as open lines that the laser engraves in one pass.
// Glyphs sit on a grid 4 wide and 6 high (cap height), y pointing down; lower case is drawn as upper case.
import type { SubPath } from './index';

const G: Record<string, string> = {
  '0': '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  '1': '1,1 2,0 2,6|1,6 3,6',
  '2': '0,1 1,0 3,0 4,1 4,2 0,6 4,6',
  '3': '0,0 4,0 2,2.5 3,2.5 4,3.5 4,5 3,6 1,6 0,5',
  '4': '3,6 3,0 0,4 4,4',
  '5': '4,0 0,0 0,2.5 3,2.5 4,3.5 4,5 3,6 0,6',
  '6': '3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.5 3,2.5 0,2.5',
  '7': '0,0 4,0 1.5,6',
  '8': '3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1 0,2 1,3',
  '9': '4,3.5 1,3.5 0,2.5 0,1 1,0 3,0 4,1 4,5 3,6 1,6',
  A: '0,6 0,2 2,0 4,2 4,6|0,3.5 4,3.5',
  B: '0,3 3,3 4,4 4,5 3,6 0,6 0,0 3,0 4,1 4,2 3,3',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '4,0 0,0 0,6|0,3 3,3',
  G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.5 2,3.5',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '4,0 4,5 3,6 1,6 0,5',
  K: '0,0 0,6|4,0 0,3.5|1.3,2.7 4,6',
  L: '0,0 0,6 4,6',
  M: '0,6 0,0 2,3 4,0 4,6',
  N: '0,6 0,0 4,6 4,0',
  O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  P: '0,6 0,0 3,0 4,1 4,2 3,3 0,3',
  Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2.5,4.5 4,6',
  R: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6',
  S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
  T: '0,0 4,0|2,0 2,6',
  U: '0,0 0,5 1,6 3,6 4,5 4,0',
  V: '0,0 2,6 4,0',
  W: '0,0 1,6 2,3 3,6 4,0',
  X: '0,0 4,6|4,0 0,6',
  Y: '0,0 2,3 4,0|2,3 2,6',
  Z: '0,0 4,0 0,6 4,6',
  '-': '1,3 3,3',
  '+': '2,1.5 2,4.5|0.5,3 3.5,3',
  '.': '1.6,5.4 2.4,5.4 2.4,6 1.6,6 1.6,5.4',
  ',': '2.2,5.2 2.2,6 1.5,7',
  ':': '1.6,1.6 2.4,1.6 2.4,2.2 1.6,2.2 1.6,1.6|1.6,5.4 2.4,5.4 2.4,6 1.6,6 1.6,5.4',
  '/': '0,6 4,0',
  '°': '1,0 2.5,0 2.5,1.5 1,1.5 1,0',
  '"': '1.5,0 1.5,1.5|2.5,0 2.5,1.5',
  "'": '2,0 2,1.5',
  '=': '0.5,2 3.5,2|0.5,4 3.5,4',
  '(': '3,0 2,1 1.5,3 2,5 3,6',
  ')': '1,0 2,1 2.5,3 2,5 1,6',
  '%': '0,6 4,0|0,0 1,0 1,1 0,1 0,0|3,5 4,5 4,6 3,6 3,5',
};
const parsed = new Map<string, [number, number][][]>();
function glyph(ch: string): [number, number][][] {
  let g = parsed.get(ch);
  if (!g) {
    const src = G[ch] ?? G[ch.toUpperCase()];
    g = src ? src.split('|').map((s) => s.split(' ').map((p) => p.split(',').map(Number) as [number, number])) : [];
    parsed.set(ch, g);
  }
  return g;
}

/** Advance per character in grid units (the glyph is 4 wide) */
const ADVANCE = 5.5;
const NARROW = new Set(['.', ',', ':', "'", '1', 'I']);
const advance = (ch: string) => (ch === ' ' ? 4 : NARROW.has(ch) ? 4.5 : ADVANCE);

/** Characters the font can draw (others are left out, a space keeps its width) */
export const hasGlyph = (ch: string) => ch === ' ' || G[ch] !== undefined || G[ch.toUpperCase()] !== undefined;

/** Width of a text in mm at cap height `size` */
export function textWidth(text: string, size: number): number {
  const u = size / 6;
  let w = 0;
  for (const ch of text) w += advance(ch);
  return Math.max(0, w - 1.5) * u;
}

export interface TextOptions {
  /** Reference point (default 0, 0) */
  x?: number;
  y?: number;
  /** Horizontal alignment at x (default left) */
  align?: 'left' | 'center' | 'right';
  /** Vertical alignment at y: top of the capitals, middle or baseline (default baseline) */
  valign?: 'top' | 'middle' | 'baseline';
  /** Rotation around (x, y) in degrees, clockwise on screen */
  angle?: number;
}

/** Text as open single-stroke lines; `size` is the cap height in mm */
export function strokeText(text: string, size: number, o: TextOptions = {}): SubPath[] {
  const u = size / 6;
  // Align on the drawn strokes, so a narrow „1“ is centred as well as an „8“
  let lo = Infinity, hi = -Infinity, at = 0;
  for (const ch of text) {
    for (const stroke of glyph(ch)) for (const [gx] of stroke) (lo = Math.min(lo, at + gx), hi = Math.max(hi, at + gx));
    at += advance(ch);
  }
  if (lo > hi) lo = hi = 0;
  const dx = (o.align === 'center' ? -(lo + hi) / 2 : o.align === 'right' ? -hi : -lo) * u;
  const dy = o.valign === 'top' ? 0 : o.valign === 'middle' ? -size / 2 : -size;
  const a = ((o.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const x0 = o.x ?? 0, y0 = o.y ?? 0;
  const out: SubPath[] = [];
  let pen = 0;
  for (const ch of text) {
    for (const stroke of glyph(ch)) {
      out.push({
        closed: false,
        nodes: stroke.map(([gx, gy]) => {
          const lx = dx + pen + gx * u, ly = dy + gy * u;
          return { x: x0 + lx * cos - ly * sin, y: y0 + lx * sin + ly * cos };
        }),
      });
    }
    pen += advance(ch) * u;
  }
  return out;
}
