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
  /**
   * Page group (#387, 0 … 49): parts with the same number go on the same page; 0 is the page the user inserts on,
   * every further group gets new pages behind it. at is relative to the other parts of the group.
   */
  page?: number;
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
  /**
   * Spread the parts over as many pages as the work area needs, with the app's nesting (#387); rotate allows turning
   * parts by 90°, 180° and 270°. Each page group is spread on its own.
   */
  distribute?: { rotate?: boolean };
  /**
   * Where each part sits in space for the 3D view, by part key: a point (x, y) of the outline at height s lies at
   * o + x·u + y·v + s·n (mm; X right, Y back, Z up)
   */
  poses?: { poses: Record<string, Pose>; spin?: Record<string, number> };
}
export interface Pose {
  o: V3;
  u: V3;
  v: V3;
  n: V3;
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
/** Bytes of an image: RGBA (4 per pixel) for action inputs, one per pixel for Gray, row by row */
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
/**
 * An image the app keeps with the project (resource "image": "rgba1:<width>,<height>,<base64 RGBA>") as an Image,
 * or null for other data. pixels() turns its data into bytes.
 */
export function storedImage(data: string): Image | null {
  const m = /^rgba1:(\d+),(\d+),/.exec(data);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]), data: data.slice(m[0].length) };
}
/** Answer of onEvent and onSurface: parameters to change (e.g. new rows of a list), a short message for the dialog,
 * and for a drawing surface its new free state (null clears it), view and selected rows */
export interface EventResult {
  patch?: Params;
  message?: Text;
  state?: unknown;
  view?: string;
  select?: Record<string, number>;
}
/** The drawing surface as it is: view, the plugin's free state, selected row by list parameter (-1 = none) */
export interface Surface {
  view: string;
  state: unknown;
  selected: Record<string, number>;
}
export type Style = 'normal' | 'muted' | 'accent' | 'warn';
/** A shape on the surface (mm, y down); handles and lines with an id can be hit by the pointer */
export type Item =
  | { type: 'line'; pts: [number, number][]; closed?: boolean; style?: Style; width?: number; dash?: boolean; alpha?: number; id?: string }
  | { type: 'handle'; x: number; y: number; id: string; style?: Style; size?: number }
  /**
   * angle: degrees, counter-clockwise (90 = read from bottom to top); align: "start" (default) = 6 px after and above
   * the point, "center" = centred on it in both directions; both follow the angle (#412); bubble: a rounded, half
   * see-through patch of the background colour under the text, so it stays readable over lines
   */
  | { type: 'text'; x: number; y: number; text: Text; style?: Style; angle?: number; align?: 'start' | 'center'; bubble?: boolean };
/**
 * A region map on the surface: width × height cells over frame (mm), one byte per cell as base64 (0 = none,
 * n = region n − 1), filled with colors[n − 1] ("#rrggbb"). A click on a region arrives as hit "<layer key>:<region>";
 * `regionMap()` builds the data.
 */
export interface Regions {
  frame: { x0: number; y0: number; x1: number; y1: number };
  width: number;
  height: number;
  data: string;
  colors: string[];
}
/** A region map from region numbers per cell (-1 = none) */
export function regionMap(frame: Regions['frame'], width: number, height: number, cells: ArrayLike<number>, colors: string[]): Regions {
  const b = new Uint8Array(width * height);
  for (let i = 0; i < b.length; i++) b[i] = cells[i] >= 0 && cells[i] < 255 ? cells[i] + 1 : 0;
  return { frame, width, height, data: base64(b), colors };
}
/** What draw() returns: the area to show, layers the app keeps by key (send their content only when not in have), shapes */
export interface Drawing {
  frame: { x0: number; y0: number; x1: number; y1: number };
  layers?: { key: string; tris?: number[]; items?: Item[]; alpha?: number; regions?: Regions }[];
  items: Item[];
  /** Send pointer moves without a pressed button (e.g. while drawing a line), also when a modifier key changes */
  track?: boolean;
  /** Cursor over the whole surface, also over shapes with an id (newer apps); without it, move over those, normal elsewhere */
  cursor?: 'default' | 'crosshair';
  /** Escape to the plugin (true) or closing the dialog (false); without it, to the plugin while track is on (newer apps) */
  escape?: boolean;
  /**
   * Number fields in the right column of the dialog, e.g. the measures of the selected shape (mm; newer apps). A typed
   * value arrives as a "field" event with the field's id and the value.
   */
  fields?: { id: string; label: Text; value: number; min?: number; max?: number; readonly?: boolean; title?: Text }[];
  /** Parts of the preview to mark, by index in generate's parts: the whole part, or only subs in its coordinates (newer apps) */
  highlight?: { part: number; subs?: SubPath[] }[];
}
/** A pointer or key event on the surface; select: a row of a selectable list was clicked; field: a value typed into a field of the drawing */
export interface Pointer {
  type: 'down' | 'move' | 'up' | 'dblclick' | 'context' | 'key' | 'select' | 'field';
  x: number;
  y: number;
  hit?: string;
  from?: { x: number; y: number };
  drag?: boolean;
  key?: string;
  list?: string;
  row?: number;
  field?: string;
  value?: number;
  /** Modifier keys held during the event (only present when held); ctrl is Cmd on macOS */
  shift?: true;
  alt?: true;
  ctrl?: true;
}
export interface Plugin<P extends Params = Params> {
  validate(p: P): Issue[];
  /** Runs only when validate reported no error; throw new Error('code') to report a problem */
  generate(p: P): GenResult;
  /**
   * Optional: suggestions the dialog shows in empty text fields (autoText), a short text per row of a list
   * (rows, by the list's data parameter) and a suggestion for each row's empty first text cell (rowAuto)
   */
  view?(p: P): { autoText?: Record<string, Text>; rows?: Record<string, Text[]>; rowAuto?: Record<string, Text[]> };
  /**
   * Optional: called when the user commits a field, with its previous value. The patch is checked against the
   * schema like user input; a question is shown inside the dialog, Cancel restores the field.
   */
  onChange?(input: { key: string; old: Params[string]; params: P }): Change | null;
  /**
   * Optional: a button of the manifest's dialog.actions (or a row button of a list, with its row) was pressed;
   * inputs holds what the action declares, surface the drawing surface if the dialog has one
   */
  onEvent?(input: { action: string; params: P; inputs: EventInputs; row?: number; surface?: Surface }): EventResult | null;
  /**
   * Optional (dialog version 3, dialog.surface): what the drawing surface shows; have = layer keys the app keeps, size =
   * the surface in screen pixels (newer apps; draw is called again when it changes)
   */
  draw?(input: Surface & { have: string[]; size?: { width: number; height: number }; params: P }): Drawing;
  /** Optional: a pointer or key event on the drawing surface */
  onSurface?(input: { event: Pointer; surface: Surface; params: P }): EventResult | null;
  /** Optional: a dialog with the plugin opened (a session); do expensive work once and keep it for the following calls */
  open?(p: P): null;
  /** Optional: the dialog closed; drop what open kept */
  close?(): null;
  /**
   * Optional: parameters saved by an older version of the plugin (from = their version) → the parameters of this
   * version. Called when a project is opened; the stored geometry stays until the user edits the part.
   */
  migrate?(input: { params: Params; from: number }): Params;
  /**
   * Optional: data a parameter with "resource" names (kind "model3d": a 3D model, decode it with mesh()). Called
   * once before the first call that needs it, and again after the plugin was restarted; keep it by id.
   */
  resource?(input: { kind: string; id: string; data: string }): null;
}

/**
 * Host functions of the app (#211), callable while the plugin computes. The manifest lists the ones it uses under
 * "host" (progress needs no entry). They throw an Error whose message is a code (host-not-allowed, host-bad-input).
 */
export interface Host {
  /** Boolean operation on closed outlines: a op b */
  boolean(input: { op: 'union' | 'difference' | 'intersection' | 'xor'; a: SubPath[]; b?: SubPath[] }): SubPath[];
  /** Offset by delta mm (negative = inward); open sub-paths become a band */
  offset(input: { subs: SubPath[]; delta: number; join?: 'round' | 'miter' | 'square' }): SubPath[];
  /** Bézier curves through points */
  fit(input: { pts: [number, number][]; closed?: boolean; tolerance?: number }): SubPath;
  /** Outlines of the dark areas of a grayscale image (one byte per pixel, base64), in mm from the top left */
  trace(input: { width: number; height: number; data: string; threshold?: number; smooth?: number; ignoreLess?: number; scale?: number }): SubPath[];
  /**
   * Cross-sections of a 3D model the plugin got as a resource (by its id), at heights along frame.w. With size the
   * model is placed upright, scaled to that longest side and centred over the origin, like the built-in 3D-model
   * generators. Each layer is an area (Region) plus the number of chains that stayed open (holes in the mesh).
   */
  slice(input: { model: string; up?: 'z' | 'y'; size?: number; frame?: { u: V3; v: V3; w: V3 }; heights: number[]; gap?: number }): { min: V3; max: V3; layers: { region: Region; open: number }[] };
  /** Operations on areas (nonzero fill, points on a 1 µm grid) */
  region(input: { op: 'union' | 'intersection' | 'difference'; a: Region; b?: Region }): Region;
  region(input: { op: 'offset'; a: Region; delta: number }): Region;
  region(input: { op: 'loops'; loops: number[][] }): Region;
  region(input: { op: 'band'; line: number[]; radius: number }): Region;
  region(input: { op: 'clean'; a: Region; minArea?: number }): { polys: number[][]; islands: number };
  region(input: { op: 'islands'; a: Region; minArea?: number }): number[][][];
  region(input: { op: 'deepest'; polys: number[][] }): { p: [number, number]; r: number } | null;
  /** Where each part goes in a compact arrangement without rotation (outlines around each part's origin) */
  nest(input: { parts: { key?: string; subs: SubPath[] }[]; gap: number }): [number, number][];
  /**
   * Data from a server the manifest declares under "network" (#280). Throws net-pending the first time: let it end
   * the call; the app fetches the data and calls again, then the answer is here.
   */
  fetch(input: { host: string; path: string; query?: Record<string, string | number>; method?: 'GET' | 'POST'; body?: string }): NetResponse;
  /**
   * The geometric part of "Check design" on the plugin's cut lines (#388): lines cut twice, open outlines, webs
   * thinner than minWeb, cut-outs lost to the kerf, parts larger than the work area (turned too). Each part is
   * checked on its own unless placed is true (then they lie where they will be cut, moved by at). Pass the findings
   * on as issues of validate with their code and values: the app writes the texts.
   */
  check(input: {
    parts: { key: string; subs: SubPath[]; at?: [number, number] }[];
    placed?: boolean;
    minWeb?: number;
    beam?: number;
    kerf?: number;
    tol?: number;
    closeGap?: number;
    workArea?: { width: number; height: number };
  }): CheckFinding[];
  /**
   * Context the manifest declares under "context" (#386): the material of the layer the part goes on, or the
   * machine's work area. null when the app does not know it (a layer without material): report an issue then.
   * Another material or work area computes the part again.
   */
  context(what: 'material'): MaterialContext | null;
  context(what: 'workArea'): WorkArea | null;
  /**
   * The app's wood joints (#398). panel: the outline of a box panel (width × height, centred, y down) with finger
   * joints on its edges top, right, bottom, left (A starts with a finger, B with a gap, flat = none), like the box
   * generators. edge: a joint of the Joint tool on one or two straight edges (segment seg of sub-path sub) of the
   * outlines in parts; answers the changed outlines, added parts (wedges, hinge knuckles), info codes and, when the
   * joint does not fit, an error code instead. v is the version of the joint geometry: the same input and version
   * always give the same shapes. In 2 the clearance is the total play of the joint (#402); 1, the default, takes it
   * per side along fingers and tenons (see docs/plugins.md). Info and error codes (joint-…) have their texts in the app: pass them on as issue
   * codes or info texts with their values.
   */
  joints(input: { op: 'panel'; v?: JointVersion; width: number; height: number; thickness: number; finger: number; clearance?: number; kerf?: number; edges: [JointPattern, JointPattern, JointPattern, JointPattern]; corners?: boolean }): { v: JointVersion; outline: SubPath };
  joints(input: { op: 'edge'; v?: JointVersion; options: JointOptions; parts: Record<string, SubPath[]>; edges: { part: string; sub?: number; seg: number }[] }): JointAnswer;
  /** Report progress 0 … 1 of a long computation, optionally with a short text */
  progress(done: number, text?: string): void;
}
export type JointPattern = 'A' | 'B' | 'flat';
/** Version of the joint geometry: 2 = clearance is the total play of the joint; 1 (default) = per side along fingers and tenons */
export type JointVersion = 1 | 2;
/** Options of a joint, as in the Joint tool (mm unless noted); only kind is required */
export interface JointOptions {
  kind: 'finger' | 'tenon' | 'lap' | 'snap' | 'hook' | 'wedge' | 'tslot' | 'lidhinge';
  thickness?: number;
  fingerWidth?: number;
  direction?: 'in' | 'out';
  swap?: boolean;
  tenonCount?: number;
  tenonWidth?: number;
  slotOffset?: number;
  lapCount?: number;
  /** % of the panel width */
  lapDepth?: number;
  snapLip?: number;
  snapLength?: number;
  snapRelief?: number;
  hookLength?: number;
  hookFlip?: boolean;
  wedgeWidth?: number;
  wedgePull?: number;
  boltDia?: number;
  nutWidth?: number;
  nutHeight?: number;
  boltLength?: number;
  hingeCount?: number;
  pinDia?: number;
  pinPlay?: number;
  hingeWall?: number;
  kerf?: number;
  clearance?: number;
  /** Tenon family: play across the slot (slot width over the thickness); default clearance */
  slotClearance?: number;
}
/** A joint message: code joint-… with its numbers, translated by the app */
export interface JointMessage {
  code: string;
  values?: Record<string, number | string>;
}
export type JointAnswer =
  | { v: JointVersion; parts: Record<string, SubPath[]>; added: SubPath[]; info: JointMessage[]; error?: undefined }
  | { v: JointVersion; error: JointMessage };
/** host.context("material"): values from the material library entry on the layer, each null when unknown (mm) */
export interface MaterialContext {
  name: string | null;
  thickness: number | null;
  /** Calibrated kerf width */
  kerf: number | null;
  /** Calibrated play per side for two parts fitted together. Deprecated: use pairPlayTotal (the play is the total play of the joint since #402) */
  pairPlay: number | null;
  /** Calibrated total play (both sides together) for two parts fitted together, the meaning of `clearance` in `host.joints` with `"v": 2` */
  pairPlayTotal: number | null;
  /** Calibrated slot width over the thickness */
  slotPlay: number | null;
}
/** host.context("workArea"): the machine's work area in mm */
export interface WorkArea {
  width: number;
  height: number;
}
/** Answer of host.fetch: text for json, xml and text, base64 data for png and mvt, or an error code */
export interface NetResponse {
  status: number;
  type?: 'json' | 'xml' | 'text' | 'png' | 'mvt';
  text?: string;
  data?: string;
  error?: string;
}
/** A finding of host.check: code check-double, check-double-whole, check-unjoined, check-open, check-open-fill,
 * check-hole-lost, check-hole-small, check-web, check-web-cut or check-too-big; the parts it concerns by key */
export interface CheckFinding {
  code: string;
  level: 'error' | 'warn' | 'info';
  parts: string[];
  values?: Record<string, number>;
  at?: [number, number];
}
export type V3 = [number, number, number];
/** An area: closed polygons, each [x0, y0, x1, y1, …] in mm */
export type Region = number[][];
export const host: Host = (globalThis as unknown as { host: Host }).host;

/** Register the plugin's functions with the app */
export function definePlugin<P extends Params = Params>(plugin: Plugin<P>) {
  (globalThis as unknown as { plugin: Plugin<P> }).plugin = plugin;
}

/** An object of the selection a path tool gets: paths in mm (page coordinates, y down), texts as outlines */
export interface ToolObject {
  id: string;
  subs: SubPath[];
}
/** Answer of a path tool: the objects that replace the selection; `from` gives an object the layer of that input */
export interface PathToolResult {
  objects?: { from?: string; subs: SubPath[] }[];
  issues?: Issue[];
  info?: [Text, Text][];
}
/** A grayscale image: one byte per pixel (0 black … 255 white), row by row, base64 (decode with pixels()) */
export interface Gray {
  width: number;
  height: number;
  data: string;
}
/** Answer of an image filter: the new image (any size up to 8000 pixels a side and 16 million pixels) */
export interface ImageFilterResult {
  image?: Gray;
  issues?: Issue[];
  info?: [Text, Text][];
}
/** A path tool (#205 stage 3, "type": "pathtool"): parameters and the selected shapes → shapes that replace them */
export interface PathTool<P extends Params = Params> {
  apply(input: { params: P; objects: ToolObject[] }): PathToolResult;
  open?(p: P): null;
  close?(): null;
}
/** An image filter ("type": "imagefilter"): parameters and the selected image as grayscale → a new grayscale image */
export interface ImageFilter<P extends Params = Params> {
  apply(input: { params: P; image: Gray }): ImageFilterResult;
  open?(p: P): null;
  close?(): null;
}
/** Register a path tool's functions with the app */
export function definePathTool<P extends Params = Params>(tool: PathTool<P>) {
  (globalThis as unknown as { plugin: PathTool<P> }).plugin = tool;
}
/** Register an image filter's functions with the app */
export function defineImageFilter<P extends Params = Params>(filter: ImageFilter<P>) {
  (globalThis as unknown as { plugin: ImageFilter<P> }).plugin = filter;
}
/** Bytes as base64 (for Gray.data) */
export function base64(b: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += abc[n >> 18] + abc[(n >> 12) & 63] + (i + 1 < b.length ? abc[(n >> 6) & 63] : '=') + (i + 2 < b.length ? abc[n & 63] : '=');
  }
  return out;
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
