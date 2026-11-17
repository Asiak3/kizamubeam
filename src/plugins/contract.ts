// Plugin contract (issue #205, stage 1): what a plugin may return, checked before anything reaches the editor.
// Plugins exchange JSON only. Calls: validate(params) → issues, generate(params) → parts, info, labels, poses, plan;
// optional (#335 stage 2): view(params) → suggested texts and row texts, onChange({ key, old, params }) → patch or a
// question; (#335 stage 3) onEvent({ action, params, inputs, row, surface }) → patch and a message; (#335 stage 4)
// draw({ view, state, selected, have, params }) → what the surface shows, onSurface({ event, surface, params }) →
// patch, message and the new surface state.
// No DOM, no Editor, so the same checks run in the Worker, in the app and in Node tests.
import type { Node, Pt, SubPath } from '../model';
import { fromBase64, toBase64 } from '../base64';
import type { GenDrawing, GenEvent, GenItem, GenLayer, GenStyle, Params, PlanSheet } from '../generators/types';
import type { AsmPoses, Pose, V3 } from '../generators/pose';

/** Version of the call protocol; a plugin built for a newer one is refused with an update hint */
export const PLUGIN_API = 1;

/** Plugin functions the app calls */
/** resource: data a parameter refers to (e.g. a 3D model), sent once per process before it is needed */
/** draw, onSurface: the drawing surface of the dialog */
/** open, close: a dialog with the plugin was opened or closed (a session: keep or drop expensive work) */
/** apply: a path tool or image filter computes its result for the selection (#205 stage 3) */
export type PluginFn = 'validate' | 'generate' | 'view' | 'onChange' | 'onEvent' | 'resource' | 'draw' | 'onSurface' | 'open' | 'close' | 'apply';

/** Limits for one plugin (#205: time, memory, output size) */
export const LIMITS = {
  /**
   * Time per call in ms; the Worker is terminated after it. Everything runs in a Worker (the editor stays usable).
   * Nesting many parts in QuickJS takes a while (a 400-tooth gear pair: about 20 s); validate may need the whole
   * layout too (a stack model slices the model to count its layers), resource decodes a 3D model; draw may compute
   * the layout for new parameters, onSurface answers pointer events (finishing a line may look into the model)
   */
  callMs: { validate: 10000, generate: 30000, view: 2000, onChange: 2000, onEvent: 10000, resource: 20000, draw: 30000, onSurface: 5000, open: 30000, close: 2000, apply: 30000 } as Record<PluginFn, number>,
  /** Options of a question (ask) */
  askOptions: 3,
  /** Memory of the JavaScript engine or the WebAssembly instance */
  memoryBytes: 512 * 1024 * 1024,
  /** Size of the plugin code */
  codeBytes: 8 * 1024 * 1024,
  /** Size of the JSON answer of one call */
  outputBytes: 32 * 1024 * 1024,
  parts: 2000,
  nodes: 500_000,
  issues: 200,
  info: 40,
  text: 400,
  /** Coordinates within ±range mm */
  range: 100_000,
  /** Shapes on the surface (items of one drawing or layer) and their points, triangles of a layer */
  items: 20_000,
  points: 1_000_000,
  tris: 2_000_000,
  layers: 4,
  /** Size of the surface state as JSON */
  stateBytes: 1024 * 1024,
  /** Pixels of an image a filter gets or returns, and the longest side */
  imagePixels: 16_000_000,
  imageSide: 8000,
  /** Objects a path tool gets or returns */
  objects: 5000,
};

/**
 * A text from a plugin: plain (shown as it is, numbers in the user's format), a text code of the manifest with
 * values for its placeholders (values may be texts again), or a list of texts shown one after the other.
 */
export type PluginText = string | { code: string; values?: Record<string, PluginText | number> } | PluginText[];

/** Issue as a plugin reports it: a code (translated through the manifest texts) and values */
export interface PluginIssue {
  key?: string;
  level: 'error' | 'warn';
  code: string;
  values?: Record<string, PluginText | number>;
}

export interface PluginPart {
  key: string;
  subs: SubPath[];
  at: Pt;
  marks?: SubPath[];
}

export interface PluginGenResult {
  parts: PluginPart[];
  /** Rows for the dialog: [label, value]; a plain label is looked up as a text code first */
  info: [PluginText, PluginText][];
  /** Name in the Objects window for these parameters (instead of the manifest text "label") */
  label?: PluginText;
  /** Names of the parts of an assembly by part key */
  labels?: Record<string, PluginText>;
  /** Position of every part in space (3D view, assembly check) */
  poses?: AsmPoses;
  plan?: PlanSheet;
}

/** Thrown when a plugin answer breaks the contract; the message is a code with details for the log */
export class ContractError extends Error {
  constructor(public code: string, detail: string) {
    super(`${code}: ${detail}`);
  }
}

const fail = (what: string): never => {
  throw new ContractError('plugin-bad-output', what);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, what: string, max = LIMITS.text): string => (typeof v === 'string' && v.length <= max ? v : fail(what));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMITS.range ? v : fail(what));
const pt = (v: unknown, what: string): Pt => (isObj(v) ? { x: num(v.x, what), y: num(v.y, what) } : fail(what));
const v3 = (v: unknown, what: string): V3 => (Array.isArray(v) && v.length === 3 ? [num(v[0], what), num(v[1], what), num(v[2], what)] : fail(what));

function subs(v: unknown, what: string, count: { nodes: number }): SubPath[] {
  if (!Array.isArray(v)) return fail(what);
  return v.map((s) => {
    if (!isObj(s) || !Array.isArray(s.nodes)) return fail(what);
    count.nodes += s.nodes.length;
    if (count.nodes > LIMITS.nodes) fail('too many nodes');
    const nodes = s.nodes.map((n): Node => {
      const p = pt(n, what);
      const o = n as Record<string, unknown>;
      return { ...p, ...(o.cin !== undefined ? { cin: pt(o.cin, what) } : {}), ...(o.cout !== undefined ? { cout: pt(o.cout, what) } : {}), ...(o.smooth === true ? { smooth: true } : {}) };
    });
    return { nodes, closed: s.closed === true };
  });
}

/** Sub-paths a plugin hands over (to a host function): checked like parts, at most LIMITS.nodes nodes */
export const checkSubPaths = (v: unknown, what = 'subs'): SubPath[] => subs(v, what, { nodes: 0 });

/** Check and copy the answer of validate(); anything outside the contract is an error */
export function checkIssues(v: unknown): PluginIssue[] {
  if (!Array.isArray(v) || v.length > LIMITS.issues) return fail('issues');
  return v.map((i) => {
    if (!isObj(i)) return fail('issue');
    const level = i.level === 'error' || i.level === 'warn' ? i.level : fail('issue level');
    const out: PluginIssue = { level, code: str(i.code, 'issue code', 80) };
    if (i.key !== undefined) out.key = str(i.key, 'issue key', 80);
    if (i.values !== undefined) out.values = checkValues(i.values);
    return out;
  });
}

function checkValues(v: unknown, depth = 0): Record<string, PluginText | number> {
  if (!isObj(v)) return fail('values');
  const out: Record<string, PluginText | number> = {};
  for (const [k, x] of Object.entries(v).slice(0, 20)) out[str(k, 'value name', 40)] = typeof x === 'number' && Number.isFinite(x) ? x : checkText(x, depth + 1);
  return out;
}

/** Check a plugin text: plain, { code, values } or a list, at most 4 levels deep and 40 list entries */
export function checkText(v: unknown, depth = 0): PluginText {
  if (depth > 4) return fail('text too deep');
  if (typeof v === 'string') return str(v, 'text');
  if (Array.isArray(v)) return v.length <= 40 ? v.map((x) => checkText(x, depth + 1)) : fail('text list');
  if (!isObj(v)) return fail('text');
  const out: { code: string; values?: Record<string, PluginText | number> } = { code: str(v.code, 'text code', 80) };
  if (v.values !== undefined) out.values = checkValues(v.values, depth);
  return out;
}

function checkPose(v: unknown): Pose {
  if (!isObj(v)) return fail('pose');
  return { o: v3(v.o, 'pose'), u: v3(v.u, 'pose'), v: v3(v.v, 'pose'), n: v3(v.n, 'pose') };
}

/** Check and copy the answer of generate() */
export function checkGenResult(v: unknown): PluginGenResult {
  if (!isObj(v) || !Array.isArray(v.parts)) return fail('result');
  if (v.parts.length > LIMITS.parts) fail('too many parts');
  const count = { nodes: 0 };
  const keys = new Set<string>();
  const parts = v.parts.map((p): PluginPart => {
    if (!isObj(p)) return fail('part');
    const key = str(p.key, 'part key', 80);
    if (keys.has(key)) fail(`duplicate part key ${key}`);
    keys.add(key);
    const part: PluginPart = { key, subs: subs(p.subs, 'part subs', count), at: pt(p.at, 'part at') };
    if (p.marks !== undefined) part.marks = subs(p.marks, 'part marks', count);
    return part;
  });
  const out: PluginGenResult = { parts, info: checkInfo(v.info) };
  if (v.label !== undefined) out.label = checkText(v.label);
  if (v.labels !== undefined) {
    if (!isObj(v.labels)) fail('labels');
    out.labels = {};
    for (const [k, x] of Object.entries(v.labels as Record<string, unknown>)) if (keys.has(k)) out.labels[k] = checkText(x);
  }
  if (v.poses !== undefined) {
    if (!isObj(v.poses) || !isObj(v.poses.poses)) fail('poses');
    const pv = v.poses as { poses: Record<string, unknown>; spin?: unknown };
    const poses: Record<string, Pose> = {};
    for (const [k, p] of Object.entries(pv.poses)) poses[str(k, 'pose key', 80)] = checkPose(p);
    out.poses = { poses };
    if (pv.spin !== undefined) {
      if (!isObj(pv.spin)) fail('spin');
      out.poses.spin = Object.fromEntries(Object.entries(pv.spin as Record<string, unknown>).map(([k, s]) => [str(k, 'spin key', 80), num(s, 'spin')]));
    }
  }
  if (v.plan !== undefined) {
    const p = v.plan;
    if (!isObj(p) || !Array.isArray(p.lines) || !Array.isArray(p.labels) || !Array.isArray(p.steps)) return fail('plan');
    out.plan = {
      title: str(p.title, 'plan title'),
      lines: p.lines.map((l) => (Array.isArray(l) ? l.map((q) => pt(q, 'plan line')) : fail('plan line'))),
      labels: p.labels.map((l) => (isObj(l) ? { x: num(l.x, 'label'), y: num(l.y, 'label'), text: str(l.text, 'label'), size: num(l.size, 'label') } : fail('label'))),
      steps: p.steps.map((s) => str(s, 'step', 2000)),
    };
  }
  return out;
}


/** Info rows of an answer: [label, value] texts */
function checkInfo(v: unknown): [PluginText, PluginText][] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > LIMITS.info) return fail('info');
  return v.map((r): [PluginText, PluginText] => (Array.isArray(r) && r.length === 2 ? [checkText(r[0]), checkText(r[1])] : fail('info')));
}

/** An object of the selection as a path tool gets it: its id and its paths in mm, page coordinates (y down) */
export interface PluginToolObject {
  id: string;
  subs: SubPath[];
}
/** Answer of a path tool: the objects that replace the selection; `from` names the input whose layer it takes */
export interface PluginPathResult {
  objects: { from?: string; subs: SubPath[] }[];
  issues: PluginIssue[];
  info: [PluginText, PluginText][];
}
/** A grayscale image: one byte per pixel (0 black … 255 white), row by row from the top left, base64 */
export interface PluginGray {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
/** Answer of an image filter: the new image (any size within the limits) */
export interface PluginFilterResult {
  image?: PluginGray;
  issues: PluginIssue[];
  info: [PluginText, PluginText][];
}

/** Check the answer of a path tool's apply(); `from` must name an input object */
export function checkPathResult(v: unknown, ids: ReadonlySet<string>): PluginPathResult {
  if (!isObj(v)) return fail('result');
  const issues = v.issues === undefined ? [] : checkIssues(v.issues);
  const raw = v.objects === undefined ? [] : Array.isArray(v.objects) && v.objects.length <= LIMITS.objects ? v.objects : fail('objects');
  const count = { nodes: 0 };
  const objects = raw.map((o) => {
    if (!isObj(o)) return fail('object');
    const out: PluginPathResult['objects'][number] = { subs: subs(o.subs, 'object subs', count) };
    if (o.from !== undefined) out.from = ids.has(String(o.from)) ? String(o.from) : fail('object from');
    return out;
  });
  return { objects, issues, info: checkInfo(v.info) };
}

/** Check a grayscale image from a plugin */
export function checkGray(v: unknown, what = 'image'): PluginGray {
  if (!isObj(v)) return fail(what);
  const side = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= LIMITS.imageSide ? x : fail(`${what} size`));
  const width = side(v.width), height = side(v.height);
  if (width * height > LIMITS.imagePixels) fail(`${what} too large`);
  if (typeof v.data !== 'string' || v.data.length > Math.ceil((width * height) / 3) * 4 + 4) return fail(`${what} data`);
  const data = fromBase64(v.data);
  if (data.length !== width * height) fail(`${what} data must have width × height bytes`);
  return { width, height, data };
}

/** Check the answer of an image filter's apply() */
export function checkFilterResult(v: unknown): PluginFilterResult {
  if (!isObj(v)) return fail('result');
  const out: PluginFilterResult = { issues: v.issues === undefined ? [] : checkIssues(v.issues), info: checkInfo(v.info) };
  if (v.image !== undefined) out.image = checkGray(v.image);
  return out;
}

/** Parameters handed to a plugin: plain JSON copy */
export const callInput = (p: Params): Params => JSON.parse(JSON.stringify(p));

/** Answer of view(): suggestions for empty text fields by parameter key */
export interface PluginView {
  autoText?: Record<string, PluginText>;
  /** A text per row of a list, by list parameter */
  rows?: Record<string, PluginText[]>;
  /** A suggestion per row for its empty first text cell, by list parameter */
  rowAuto?: Record<string, PluginText[]>;
}

/** An image as handed to a plugin: RGBA pixels as base64 (JSON has no bytes) */
export interface PluginImage {
  width: number;
  height: number;
  data: string;
}

const pluginImage = (im: { width: number; height: number; data: Uint8ClampedArray }): PluginImage => ({ width: im.width, height: im.height, data: toBase64(im.data) });

export { fromBase64, toBase64 };

/** Inputs of an action as JSON for a plugin: images as base64 */
export function eventInputs(inp: GenEvent['inputs']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (inp.selection) out.selection = inp.selection;
  if (inp.image) out.image = { ...pluginImage(inp.image), name: inp.image.name };
  if (inp.camera) out.camera = { ...pluginImage(inp.camera), bed: inp.camera.bed, ...(inp.camera.empty ? { empty: pluginImage(inp.camera.empty) } : {}) };
  return out;
}

/** Changes of the surface an answer may ask for: new free state (null clears it), view, selected rows */
export interface PluginSurfaceChange {
  state?: unknown;
  view?: string;
  select?: Record<string, number>;
}

/** Answer of onEvent(): parameters to change and a short message for the dialog */
export interface PluginEventResult extends PluginSurfaceChange {
  patch?: Record<string, unknown>;
  message?: PluginText;
}

/** Answer of onSurface(): like onEvent */
export type PluginSurfaceResult = PluginEventResult;

/** Answer of draw(): texts on the surface are plain (names the user typed, numbers) or codes */
export type PluginItem = Exclude<GenItem, { type: 'text' }> | { type: 'text'; x: number; y: number; text: PluginText; style?: GenStyle };
export interface PluginDrawing extends Omit<GenDrawing, 'items' | 'layers'> {
  layers?: (Omit<GenLayer, 'items'> & { items?: PluginItem[] })[];
  items: PluginItem[];
}

/** Answer of onChange(): parameters to change as well, or a question whose options each carry a patch */
export interface PluginChange {
  patch?: Record<string, unknown>;
  ask?: { question: PluginText; options: { label: PluginText; patch: Record<string, unknown> }[] };
}

/** A patch: plain values by parameter key (checked against the schema by the app like user input) */
function checkPatch(v: unknown): Record<string, unknown> {
  if (!isObj(v)) return fail('patch');
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v).slice(0, 200)) {
    if (typeof x === 'number' ? !Number.isFinite(x) : typeof x === 'string' ? x.length > 4_000_000 : typeof x !== 'boolean') fail(`patch value ${k}`);
    out[str(k, 'patch key', 80)] = x;
  }
  return out;
}

/** Check and copy the answer of view() */
export function checkView(v: unknown): PluginView {
  if (v === null || v === undefined) return {};
  if (!isObj(v)) return fail('view');
  const out: PluginView = {};
  if (v.autoText !== undefined) {
    if (!isObj(v.autoText)) fail('autoText');
    out.autoText = Object.fromEntries(Object.entries(v.autoText as Record<string, unknown>).slice(0, 200).map(([k, x]) => [str(k, 'autoText key', 80), checkText(x)]));
  }
  for (const f of ['rows', 'rowAuto'] as const) {
    const x0 = v[f];
    if (x0 === undefined) continue;
    if (!isObj(x0)) fail(f);
    out[f] = Object.fromEntries(
      Object.entries(x0 as Record<string, unknown>).slice(0, 8).map(([k, x]) => [str(k, `${f} key`, 80), Array.isArray(x) && x.length <= 2000 ? x.map((r) => checkText(r)) : fail(f)]),
    );
  }
  return out;
}

/** Check and copy the answer of onEvent() or onSurface(); null means nothing to do */
export function checkEvent(v: unknown): PluginEventResult {
  if (v === null || v === undefined) return {};
  if (!isObj(v)) return fail('event');
  const out: PluginEventResult = {};
  if (v.patch !== undefined) out.patch = checkPatch(v.patch);
  if (v.message !== undefined) out.message = checkText(v.message);
  if (v.state !== undefined) {
    // Plain JSON the app keeps and hands back; its size is limited
    const text = JSON.stringify(v.state);
    if (text === undefined || text.length > LIMITS.stateBytes) fail('surface state');
    out.state = JSON.parse(text);
  }
  if (v.view !== undefined) out.view = str(v.view, 'view', 40);
  if (v.select !== undefined) {
    if (!isObj(v.select)) fail('select');
    out.select = Object.fromEntries(Object.entries(v.select as Record<string, unknown>).slice(0, 8).map(([k, x]) => [str(k, 'select key', 80), typeof x === 'number' && Number.isInteger(x) && x >= -1 ? x : fail('select row')]));
  }
  return out;
}

const STYLES: GenStyle[] = ['normal', 'muted', 'accent', 'warn'];

/** Check and copy the shapes of a drawing; points and triangles are counted across the whole answer */
function checkItems(v: unknown, count: { points: number }): PluginItem[] {
  if (!Array.isArray(v) || v.length > LIMITS.items) return fail('items');
  const style = (x: unknown) => (x === undefined ? {} : STYLES.includes(x as GenStyle) ? { style: x as GenStyle } : fail('style'));
  const id = (x: unknown) => (x === undefined ? {} : { id: str(x, 'item id', 80) });
  return v.map((it): PluginItem => {
    if (!isObj(it)) return fail('item');
    if (it.type === 'line') {
      if (!Array.isArray(it.pts)) return fail('line');
      count.points += it.pts.length;
      if (count.points > LIMITS.points) fail('too many points');
      const pts = it.pts.map((q): [number, number] => (Array.isArray(q) && q.length === 2 ? [num(q[0], 'line point'), num(q[1], 'line point')] : fail('line point')));
      return {
        type: 'line', pts, ...style(it.style), ...id(it.id),
        ...(it.closed === true ? { closed: true } : {}),
        ...(it.dash === true ? { dash: true } : {}),
        ...(it.width !== undefined ? { width: Math.max(0.1, Math.min(10, num(it.width, 'width'))) } : {}),
        ...(it.alpha !== undefined ? { alpha: Math.max(0, Math.min(1, num(it.alpha, 'alpha'))) } : {}),
      };
    }
    if (it.type === 'handle')
      return { type: 'handle', x: num(it.x, 'handle'), y: num(it.y, 'handle'), id: str(it.id, 'handle id', 80), ...style(it.style), ...(it.size !== undefined ? { size: Math.max(1, Math.min(10, num(it.size, 'size'))) } : {}) };
    if (it.type === 'text') return { type: 'text', x: num(it.x, 'text'), y: num(it.y, 'text'), text: checkText(it.text), ...style(it.style) };
    return fail('item type');
  });
}

/** Check and copy the answer of draw() */
export function checkDrawing(v: unknown): PluginDrawing {
  if (!isObj(v) || !isObj(v.frame)) return fail('drawing');
  const f = v.frame;
  const frame = { x0: num(f.x0, 'frame'), y0: num(f.y0, 'frame'), x1: num(f.x1, 'frame'), y1: num(f.y1, 'frame') };
  const count = { points: 0 };
  const out: PluginDrawing = { frame, items: checkItems(v.items ?? [], count) };
  if (v.track === true) out.track = true;
  if (v.layers !== undefined) {
    if (!Array.isArray(v.layers) || v.layers.length > LIMITS.layers) fail('layers');
    out.layers = (v.layers as unknown[]).map((l) => {
      if (!isObj(l)) return fail('layer');
      const layer: NonNullable<PluginDrawing['layers']>[number] = { key: str(l.key, 'layer key', 400) };
      if (l.tris !== undefined) {
        if (!Array.isArray(l.tris) || l.tris.length % 6 || l.tris.length > LIMITS.tris * 6) fail('tris');
        layer.tris = (l.tris as unknown[]).map((x) => num(x, 'tris'));
      }
      if (l.items !== undefined) layer.items = checkItems(l.items, count);
      if (l.alpha !== undefined) layer.alpha = Math.max(0, Math.min(1, num(l.alpha, 'alpha')));
      return layer;
    });
  }
  return out;
}

/** Check and copy the answer of onChange(); null or {} means nothing to do */
export function checkChange(v: unknown): PluginChange {
  if (v === null || v === undefined) return {};
  if (!isObj(v)) return fail('change');
  const out: PluginChange = {};
  if (v.patch !== undefined) out.patch = checkPatch(v.patch);
  if (v.ask !== undefined) {
    const a = v.ask;
    if (!isObj(a) || !Array.isArray(a.options) || !a.options.length || a.options.length > LIMITS.askOptions) return fail('ask');
    out.ask = {
      question: checkText(a.question),
      options: a.options.map((o) => (isObj(o) ? { label: checkText(o.label), patch: checkPatch(o.patch ?? {}) } : fail('ask option'))),
    };
  }
  return out;
}
