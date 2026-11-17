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
  /** Handles stay in line when the user edits the node */
  smooth?: boolean;
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
/**
 * A text for the app: plain (shown as it is, numbers in the user's format), a text key of the manifest with values
 * for its placeholders (values may be texts again), or a list of texts shown one after the other
 */
export type Text = string | { code: string; values?: Record<string, Text | number> } | Text[];
/** A problem with the parameters: code is a text key of the manifest, values fill its placeholders */
export interface Issue {
  key?: string;
  level: 'error' | 'warn';
  code: string;
  values?: Record<string, Text | number>;
}
export interface GenResult {
  parts: Part[];
  /** Rows of the info table: [label, value]; a plain label is looked up as a text key first */
  info: [Text, Text][];
  /** Name in the Objects window for these parameters (instead of the manifest text "label") */
  label?: Text;
  /** Names of the parts of an assembly by part key */
  labels?: Record<string, Text>;
}
/** Answer of onChange: parameters to change as well, or a question (up to three options, each with a patch) */
export interface Change {
  patch?: Params;
  ask?: { question: Text; options: { label: Text; patch: Params }[] };
}
/** A selected object handed to an action with the input "selection": closed outlines in mm, holes included */
export interface Selected {
  name: string;
  polys: Pt[][];
}
/** An image handed to an action: RGBA pixels as base64, at most 1200 pixels on the longer side (see pixels()) */
export interface Image {
  width: number;
  height: number;
  data: string;
}
/** Inputs of an action, as declared in its `inputs` */
export interface EventInputs {
  selection?: Selected[];
  /** The image file the user picked, name without extension */
  image?: Image & { name: string };
  /** The calibrated camera image; it covers the bed (0 … bed.w × 0 … bed.h mm); empty = photo of the empty bed */
  camera?: Image & { bed: { w: number; h: number }; empty?: Image };
}
/** RGBA bytes of an image (4 per pixel, row by row) */
export function pixels(img: Image): Uint8Array {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map = new Uint8Array(128);
  for (let i = 0; i < 64; i++) map[abc.charCodeAt(i)] = i;
  const s = img.data.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = (map[s.charCodeAt(i)] << 18) | (map[s.charCodeAt(i + 1)] << 12) | (map[s.charCodeAt(i + 2)] << 6) | map[s.charCodeAt(i + 3)];
    out[j++] = v >> 16;
    if (j < out.length) out[j++] = (v >> 8) & 255;
    if (j < out.length) out[j++] = v & 255;
  }
  return out;
}
/** A 3D model as the app hands it to resource(): positions (x, y, z per vertex, mm) and triangles (3 indices each) */
export interface Mesh {
  pos: Float32Array;
  tri: Uint32Array;
}
/** Decode a 3D model (`kzm1:` + base64 of: vertex count, triangle count as uint32, then float32 positions and uint32 indices, little endian) */
export function mesh(data: string): Mesh | null {
  if (!data.startsWith('kzm1:')) return null;
  const b = pixels({ width: 0, height: 0, data: data.slice(5) });
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 8) return null;
  const nv = dv.getUint32(0, true), nt = dv.getUint32(4, true);
  if (8 + nv * 12 + nt * 12 !== b.length) return null;
  const pos = new Float32Array(nv * 3), tri = new Uint32Array(nt * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = dv.getFloat32(8 + i * 4, true);
  for (let i = 0; i < tri.length; i++) tri[i] = dv.getUint32(8 + nv * 12 + i * 4, true);
  return { pos, tri };
}
/** Answer of onEvent: parameters to change (e.g. new rows of a list) and a short message for the dialog */
export interface EventResult {
  patch?: Params;
  message?: Text;
}
export interface Plugin<P extends Params = Params> {
  validate(p: P): Issue[];
  /** Runs only when validate reported no error; throw new Error('code') to report a problem */
  generate(p: P): GenResult;
  /**
   * Optional: suggestions the dialog shows in empty text fields (autoText), and a short text per row of a list
   * (rows, by the list's data parameter), both by parameter key
   */
  view?(p: P): { autoText?: Record<string, Text>; rows?: Record<string, Text[]> };
  /**
   * Optional: called when the user commits a field, with its previous value. The patch is checked against the
   * schema like user input; a question is shown inside the dialog, Cancel restores the field.
   */
  onChange?(input: { key: string; old: Params[string]; params: P }): Change | null;
  /** Optional: a button of the manifest's dialog.actions was pressed; inputs holds what the action declares */
  onEvent?(input: { action: string; params: P; inputs: EventInputs }): EventResult | null;
  /**
   * Optional: data a parameter with "resource" names (kind "model3d": a 3D model, decode it with mesh()). Called
   * once before the first call that needs it, and again after the plugin was restarted; keep it by id.
   */
  resource?(input: { kind: string; id: string; data: string }): null;
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

/** Deterministic random numbers in [0, 1) from a seed (plugins have no Math.random worth trusting: use a seed parameter) */
export function random(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { strokeText, textWidth, hasGlyph, type TextOptions } from './font';
