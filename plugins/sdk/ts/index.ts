// SDK for KizamuBeam plugins in TypeScript/JavaScript (issue #205). The plugin is bundled into one script
// (esbuild recipe in plugin.json) and runs in QuickJS: no DOM, no network, no files, no clock or randomness.
// It gets parameters as JSON and returns issues or geometry as JSON; see docs/plugins.md.
//
//   import { definePlugin, rect, circle } from '../../sdk/ts';
//   definePlugin({
//     validate: (p) => (p.width < 10 ? [{ key: 'width', level: 'error', code: 'too-small' }] : []),
//     generate: (p) => ({ parts: [{ key: 'plate', subs: [rect(p.width, p.height)], at: { x: 0, y: 0 } }], info: [] }),
//   });

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

/** A point in mm, y pointing down */
export interface Pt {
  x: number;
  y: number;
}
/** A path node; cin/cout are the Bézier handles before and after it (absolute coordinates) */
export interface Node extends Pt {
  cin?: Pt;
  cout?: Pt;
}
export interface SubPath {
  nodes: Node[];
  closed: boolean;
}
/** A generated part: outline and holes in local coordinates (centre at the origin), suggested position at */
export interface Part {
  key: string;
  subs: SubPath[];
  at: Pt;
  /** Engraving on the part, same coordinates as subs */
  marks?: SubPath[];
}
/** A problem with the parameters: code is a text key of the manifest, values fill its placeholders */
export interface Issue {
  key?: string;
  level: 'error' | 'warn';
  code: string;
  values?: Record<string, string | number>;
}
export interface GenResult {
  parts: Part[];
  /** Rows of the info table: [text code, value] */
  info: [string, string][];
}
export interface Plugin<P extends Params = Params> {
  validate(p: P): Issue[];
  /** Runs only when validate reported no error; throw new Error('code') to report a problem */
  generate(p: P): GenResult;
}

/** Register the plugin's functions with the app */
export function definePlugin<P extends Params = Params>(plugin: Plugin<P>) {
  (globalThis as unknown as { plugin: Plugin<P> }).plugin = plugin;
}

/** Handle length for a quarter circle */
export const K = 0.5522847498307934;

/** Closed polygon through the points */
export const polygon = (pts: [number, number][]): SubPath => ({ closed: true, nodes: pts.map(([x, y]) => ({ x, y })) });

/** Rectangle of width × height, centred on the origin */
export function rect(w: number, h: number): SubPath {
  const x = w / 2, y = h / 2;
  return polygon([[-x, -y], [x, -y], [x, y], [-x, y]]);
}

/** Circle around (cx, cy) */
export function circle(cx: number, cy: number, r: number): SubPath {
  const k = r * K;
  const n = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Node => ({ x, y, cin: { x: ix, y: iy }, cout: { x: ox, y: oy } });
  return {
    closed: true,
    nodes: [
      n(cx + r, cy, cx + r, cy - k, cx + r, cy + k),
      n(cx, cy + r, cx + k, cy + r, cx - k, cy + r),
      n(cx - r, cy, cx - r, cy + k, cx - r, cy - k),
      n(cx, cy - r, cx - k, cy - r, cx + k, cy - r),
    ],
  };
}

/** Regular polygon with n corners on a circle of radius r, first corner at angle start (radians) */
export function regular(cx: number, cy: number, r: number, n: number, start = 0): SubPath {
  return polygon(Array.from({ length: n }, (_, i): [number, number] => {
    const a = start + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }));
}

/** Rectangle with rounded corners (radius 0 = sharp), centred on the origin */
export function roundedRect(w: number, h: number, r: number): SubPath {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r <= 0) return rect(w, h);
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2, k = r * K;
  const n = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Node => ({ x, y, cin: { x: ix, y: iy }, cout: { x: ox, y: oy } });
  return {
    closed: true,
    nodes: [
      n(x0 + r, y0, x0 + r - k, y0, x0 + r, y0),
      n(x1 - r, y0, x1 - r, y0, x1 - r + k, y0),
      n(x1, y0 + r, x1, y0 + r - k, x1, y0 + r),
      n(x1, y1 - r, x1, y1 - r, x1, y1 - r + k),
      n(x1 - r, y1, x1 - r + k, y1, x1 - r, y1),
      n(x0 + r, y1, x0 + r, y1, x0 + r - k, y1),
      n(x0, y1 - r, x0, y1 - r + k, x0, y1 - r),
      n(x0, y0 + r, x0, y0 + r, x0, y0 + r - k),
    ],
  };
}

/** Round to 1/1000 mm for info texts (the app shows numbers in the user's format) */
export const mm = (v: number) => String(Math.round(v * 1000) / 1000);
