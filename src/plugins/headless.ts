// Headless dialog runner (#335 stage 1): runs a plugin generator without the app window. It applies a script of
// field changes the way the dialog does (checked against the schema like user input) and returns what the dialog
// would show after each step: parameters, visible fields, issues, info rows and the parts. Plugin authors use it
// in their tests; `npm run plugin:check` uses it to check a pack before it goes into the catalogue.
import type { Pt } from '../model';
import type { GenEvent, GenImage, GenPointer, GenSurfaceResult, GenSurfaceState, Params } from '../generators/types';
import { fromBase64 } from './contract';
import { toBase64 } from '../base64';
import type { GenSelected } from '../generators/host';
import { buildGen, checkInput, defaultParams, fieldActive, normalizeParams } from '../generators/index';
import { moveRow } from '../generators/lists';
import { pluginGenerator } from './generator';
import { pluginText, type PluginContext, type PluginManifest } from './manifest';
import { sha256 } from '../pdfcrypt';
import { hex } from './manifest';
import { encodeMesh, meshId, weld } from '../model3d/mesh';
import { isToolType, pluginTool, sampleInput, type ToolInput, type ToolResult } from './tool';
import { clearNetCache, setNetConsent, setNetTransport } from './net';

/**
 * A recorded answer of a server for plugins with network access (#280): the headless runner has no network, so
 * requests are answered from these. A request matches the first answer with its server id, a path the URL starts
 * with below the server's base, and (if given) a text the URL or POST body contains.
 */
export interface NetAnswer {
  host: string;
  path: string;
  match?: string;
  status?: number;
  contentType?: string;
  text: string;
  /** Fail the request with this code instead of answering (net-failed: the server cannot be reached) */
  error?: string;
}

/** Answer the requests of a plugin from recorded answers (all servers allowed); unknown requests fail net-offline */
export function useNetAnswers(m: PluginManifest, answers: readonly NetAnswer[]) {
  clearNetCache();
  setNetConsent(() => Promise.resolve(true));
  setNetTransport(async (r) => {
    let what = r.url;
    try {
      what += ' ' + decodeURIComponent((r.body ?? '').replace(/\+/g, ' '));
    } catch {
      what += ' ' + (r.body ?? '');
    }
    const a = answers.find((x) => {
      const h = m.network?.find((n) => n.id === x.host);
      return h && r.url.startsWith(h.base + x.path) && (x.match === undefined || what.includes(x.match));
    });
    if (!a) throw new Error('net-offline');
    if (a.error) throw new Error(a.error);
    return { status: a.status ?? 200, contentType: a.contentType ?? 'application/json', bytes: new TextEncoder().encode(a.text) };
  });
}

/** Context a headless run hands to host.context (#386); null = the app has none (e.g. a layer without material) */
export type HeadlessContext = Partial<Record<PluginContext, unknown>>;
/** Context of headless runs unless a test gives its own: 3 mm plywood on a 400 × 300 mm machine */
export const SAMPLE_CONTEXT: Record<PluginContext, unknown> = {
  material: { name: 'Plywood 3 mm', thickness: 3, kerf: 0.1 },
  workArea: { width: 400, height: 300 },
};

export interface DialogState {
  params: Params;
  /** Keys of the fields the dialog shows (showIf), in schema order */
  visible: string[];
  issues: { key?: string; level: 'error' | 'warn'; code?: string; msg: string }[];
  info: [string, string][];
  parts: { key: string; at: Pt; subs: number; nodes: number; box: { minX: number; minY: number; maxX: number; maxY: number } }[];
  /** SHA-256 of the generated geometry, to compare runs */
  geometry: string;
  /** Suggestions the dialog shows in empty text fields (view) */
  autoText: Record<string, string>;
  /** Question the plugin asked in this step (onChange), with the option labels */
  ask?: { question: string; options: string[] };
  /** Text per row of each list (view) */
  rows: Record<string, string[]>;
  /** Message of an action or a surface event in this step (onEvent, onSurface) */
  message?: string;
  /** The drawing surface after the step: its view, state, selected rows and what draw() returned (counted) */
  surface?: GenSurfaceState & { items: number; layers: number; track: boolean; cursor?: 'default' | 'crosshair'; escape?: boolean };
}

/** Thrown when a script step does not fit the schema (unknown key, wrong type, out of range) */
export class ScriptError extends Error {}

/**
 * Run the dialog of a plugin generator: the default parameters first, then one state per step. A step is the
 * set of fields the user commits, one after the other; each goes through onChange like in the dialog. When the
 * plugin asks a question, `$answer` in the step picks the option (0, 1, 2); without it the user cancels and the
 * field gets its previous value back. `$action` clicks an action button after the fields, with `$selection` (a list
 * of { name, polys }) as the selection it hands over. `$model` opens a 3D model like the user importing one:
 * `{ name, data }` with data in the app's `kzm1:` format (see encodeMesh); it fills the parameters the manifest's
 * `inputs` name. `$image` is the picked (or selected) image of an action, { name?, width, height, data } with RGBA as
 * base64; an action with `store` keeps it in that parameter like the app does. `$move: { list, from, to }` drags a
 * row of a sortable list to another place. `$row` with `$action` clicks a button of that list row. `$view` switches the drawing surface to a
 * view, `$surface` sends it a list of pointer events ({ type, x, y, hit?, from?, drag?, key? }, mm in the view).
 */
export async function runDialog(m: PluginManifest, steps: Record<string, unknown>[] = [], opts: { context?: HeadlessContext } = {}): Promise<DialogState[]> {
  const models = new Map<string, string>();
  const images = new Map<string, string>();
  const ctx = { ...SAMPLE_CONTEXT, ...opts.context };
  const g = pluginGenerator(m, { id: 'headless', name: m.id }, {
    resource: (kind, id) => (kind === 'model3d' ? models.get(id) : kind === 'image' ? images.get(id) : undefined) ?? null,
    context: (w) => ctx[w] ?? null,
  });
  try {
    const out: DialogState[] = [];
    let p = defaultParams(g);
    const surf: GenSurfaceState = { view: g.surface?.views[0].id ?? '', state: null, selected: {} };
    /** Apply an answer of onEvent or onSurface like the dialog: parameters checked like user input, then the surface */
    const apply = (r: GenSurfaceResult | void) => {
      if (!r) return;
      if (r.patch) {
        const keys = Object.keys(r.patch).filter((k) => g.schema.some((s) => s.key === k));
        const np = normalizeParams(g, { ...p, ...r.patch }, p);
        for (const k of keys) p[k] = np[k];
      }
      if (r.state !== undefined) surf.state = r.state;
      if (r.view !== undefined && g.surface?.views.some((v) => v.id === r.view)) surf.view = r.view;
      if (r.select) Object.assign(surf.selected, r.select);
    };
    for (let i = 0; i <= steps.length; i++) {
      let ask: DialogState['ask'];
      let message: string | undefined;
      if (i > 0) {
        const { $answer, $action, $row, $selection, $image, $camera, $model, $view, $surface, $move, ...step } = steps[i - 1];
        if ($move !== undefined) {
          // A row dragged to another place in a sortable list, like the dialog does it
          const mv = $move as { list?: unknown; from?: unknown; to?: unknown };
          const list = g.lists?.find((l) => l.param === mv.list && l.sort);
          if (!list) throw new ScriptError(`step ${i}: $move needs a sortable list`);
          const v = moveRow(p, list, Number(mv.from), Number(mv.to));
          if (v === null) throw new ScriptError(`step ${i}: row ${String(mv.from)} cannot move to ${String(mv.to)}`);
          p = normalizeParams(g, { ...p, [list.param]: v }, p);
        }
        if ($model !== undefined) {
          const md = $model as { name?: unknown; data?: unknown };
          if (typeof md.data !== 'string' || !md.data.startsWith('kzm1:')) throw new ScriptError(`step ${i}: $model needs data in the kzm1: format`);
          if (!g.fromInputs) throw new ScriptError(`step ${i}: the plugin does not take a 3D model`);
          const id = meshId(md.data);
          models.set(id, md.data);
          p = normalizeParams(g, { ...p, ...(await g.fromInputs({ model: { id, name: String(md.name ?? '') } })) }, p);
        }
        if ($answer !== undefined && !(Number.isInteger($answer) && ($answer as number) >= 0)) throw new ScriptError(`step ${i}: $answer must be an option number`);
        const bad = checkInput(g, step).filter((x) => x.level === 'error');
        if (bad.length) throw new ScriptError(`step ${i}: ${bad.map((x) => x.msg).join('; ')}`);
        for (const [key, value] of Object.entries(step)) {
          const old = p[key];
          p = normalizeParams(g, { ...p, [key]: value }, p);
          if (p[key] === old) continue;
          const r = await g.onChange!(key, old, p);
          if (!r) continue;
          let patch = r.patch ?? {};
          if (r.ask) {
            ask = { question: r.ask.question, options: r.ask.options.map((o) => o.label) };
            const opt = $answer === undefined ? undefined : r.ask.options[$answer as number];
            if ($answer !== undefined && !opt) throw new ScriptError(`step ${i}: the question has no option ${$answer}`);
            if (!opt) {
              p = { ...p, [key]: old };
              continue;
            }
            patch = { ...patch, ...opt.patch };
          }
          const keys = Object.keys(patch).filter((k) => k !== key && g.schema.some((s) => s.key === k));
          const np = normalizeParams(g, { ...p, ...patch }, p);
          for (const k of keys) p[k] = np[k];
        }
        if ($view !== undefined) {
          if (!g.surface?.views.some((v) => v.id === $view)) throw new ScriptError(`step ${i}: no view "${String($view)}"`);
          surf.view = String($view);
        }
        if ($row !== undefined && !(Number.isInteger($row) && ($row as number) >= 0)) throw new ScriptError(`step ${i}: $row must be a row number`);
        if ($action !== undefined) {
          const rowAction = $row !== undefined ? g.lists?.flatMap((l) => l.rowActions ?? []).find((x) => x.id === $action) : undefined;
          const a = $row !== undefined ? rowAction && { id: rowAction.id, label: rowAction.label } : g.actions?.find((x) => x.id === $action);
          if (!a) throw new ScriptError(`step ${i}: no ${$row !== undefined ? 'row ' : ''}action "${String($action)}"`);
          if ($selection !== undefined && !Array.isArray($selection)) throw new ScriptError(`step ${i}: $selection must be a list`);
          const inputs: GenEvent['inputs'] = {};
          if (a.inputs?.includes('selection')) inputs.selection = ($selection ?? []) as GenSelected[];
          if ((a.inputs?.includes('image') || a.inputs?.includes('selectedImage')) && $image !== undefined) {
            inputs.image = { ...scriptImage($image, i), name: String(($image as { name?: unknown }).name ?? '') };
            const store = 'store' in a ? a.store : undefined;
            if (store) {
              // Kept like the app keeps the picked file: an image id in the store parameter, the pixels as resource
              const id = hex(sha256(new Uint8Array(inputs.image.data.buffer, inputs.image.data.byteOffset, inputs.image.data.length))).slice(0, 16);
              images.set(id, `rgba1:${inputs.image.width},${inputs.image.height},${toBase64(inputs.image.data)}`);
              p = { ...p, [store]: id };
            }
          }
          if (a.inputs?.includes('camera') && $camera !== undefined) {
            const c = $camera as { bed?: { w: number; h: number }; empty?: unknown };
            if (!c.bed || !(c.bed.w > 0 && c.bed.h > 0)) throw new ScriptError(`step ${i}: $camera needs bed: { w, h }`);
            inputs.camera = { ...scriptImage($camera, i), bed: { w: c.bed.w, h: c.bed.h }, ...(c.empty ? { empty: scriptImage(c.empty, i) } : {}) };
          }
          const ev: GenEvent = { action: a.id, inputs, ...($row !== undefined ? { row: $row as number } : {}), ...(g.surface ? { surface: { ...surf, selected: { ...surf.selected } } } : {}) };
          const r = await g.onEvent!(ev, p);
          if (r?.message !== undefined) message = r.message;
          apply(r);
        }
        if ($surface !== undefined) {
          if (!g.onSurface) throw new ScriptError(`step ${i}: the plugin has no drawing surface`);
          const events = Array.isArray($surface) ? $surface : [$surface];
          for (const ev of events as GenPointer[]) {
            if (!ev || typeof ev.type !== 'string' || !Number.isFinite(ev.x ?? 0) || !Number.isFinite(ev.y ?? 0)) throw new ScriptError(`step ${i}: a $surface event needs type, x and y`);
            const r = await g.onSurface(ev, { ...surf, selected: { ...surf.selected } }, p);
            if (r?.message !== undefined) message = r.message;
            apply(r);
          }
        }
      }
      await g.prepare(p);
      const r = buildGen(g, p);
      // As the app draws it at its smallest: about 560 px wide, the manifest's height
      const drawn = g.draw ? await g.draw({ ...surf, selected: { ...surf.selected }, have: [], size: { width: 560, height: g.surface?.height ?? 300 } }, p) : null;
      const parts = r.parts.map((x, k) => {
        const pts = x.shape.subs.flatMap((s) => s.nodes);
        const xs = pts.map((q) => q.x);
        const ys = pts.map((q) => q.y);
        return {
          key: x.shape.part ?? String(k),
          at: x.at,
          subs: x.shape.subs.length,
          nodes: pts.length,
          box: pts.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        };
      });
      out.push({
        params: { ...p },
        visible: g.schema.filter((s) => fieldActive(s, p)).map((s) => s.key),
        issues: r.issues.map((x) => ({ ...(x.key ? { key: x.key } : {}), level: x.level, ...(x.code ? { code: x.code } : {}), msg: x.msg })),
        info: r.info,
        parts,
        geometry: hex(sha256(new TextEncoder().encode(JSON.stringify(r.parts.map((x) => [x.shape.part, x.at, x.shape.subs, x.marks ?? null]))))),
        autoText: g.view?.(p).autoText ?? {},
        rows: g.view?.(p).rows ?? {},
        ...(ask ? { ask } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(drawn ? { surface: { ...surf, selected: { ...surf.selected }, items: drawn.items.length, layers: drawn.layers?.length ?? 0, track: !!drawn.track, ...(drawn.cursor ? { cursor: drawn.cursor } : {}), ...(drawn.escape !== undefined ? { escape: drawn.escape } : {}) } } : {}),
      });
    }
    return out;
  } finally {
    g.dispose();
  }
}

/** 3D model the check opens a plugin with when it takes one: an octahedron, 60 mm across */
const SAMPLE_MODEL = (() => {
  const v = [[30, 0, 0], [-30, 0, 0], [0, 30, 0], [0, -30, 0], [0, 0, 30], [0, 0, -30]];
  const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  return { name: 'Sample', data: encodeMesh(weld(Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i]))))) };
})();

/** Selection the check hands to an action that fills an empty dialog: a 40 × 30 mm rectangle with a round hole */
const SAMPLE_SELECTION: GenSelected[] = [{
  name: 'Sample',
  polys: [
    [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }],
    Array.from({ length: 16 }, (_, k) => ({ x: 20 + 5 * Math.cos((k * Math.PI) / 8), y: 15 + 5 * Math.sin((k * Math.PI) / 8) })),
  ],
}];

/**
 * The sample image of the catalogue check: 160 × 100 pixels, white with a dark disc, a red bar and a grey square
 * (a small logo with four colours)
 */
function sampleImage() {
  const w = 160, h = 100;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = Math.hypot(x - 50, y - 50) < 30 ? [30, 30, 40] : x > 95 && x < 145 && y > 15 && y < 40 ? [200, 30, 40] : x > 100 && x < 140 && y > 55 && y < 85 ? [140, 140, 140] : [255, 255, 255];
      px.set([...c, 255], (y * w + x) * 4);
    }
  return { name: 'sample', width: w, height: h, data: toBase64(px) };
}

/** An image of a script step: { width, height, data } with RGBA pixels as base64, like a plugin gets it */
function scriptImage(v: unknown, i: number): GenImage {
  const o = v as { width?: unknown; height?: unknown; data?: unknown };
  const w = Number(o?.width), h = Number(o?.height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 1200 || h > 1200 || typeof o.data !== 'string') throw new ScriptError(`step ${i}: an image needs width and height (1 … 1200) and data (RGBA as base64)`);
  const data = fromBase64(o.data);
  if (data.length !== w * h * 4) throw new ScriptError(`step ${i}: image data must have width × height × 4 bytes`);
  return { width: w, height: h, data };
}

export interface CheckReport {
  id: string;
  /** Problems that keep a plugin out of the catalogue */
  errors: string[];
  /** Things worth fixing */
  warnings: string[];
}

/**
 * Check a plugin like the catalogue does: the default parameters must give parts without errors (a dialog that
 * starts empty is first filled by its selection action with a sample selection), every enum option
 * and both values of every switch must run without a crash, every view of a drawing surface must draw, two runs must give the same geometry, and the issue codes
 * the plugin reports should have an English text.
 */
/** What a path tool or image filter returned for one set of parameters */
export interface ToolState {
  params: Params;
  issues: { key?: string; level: 'error' | 'warn'; code?: string; msg: string }[];
  info: [string, string][];
  /** Path tool: the objects that would replace the selection (input id, counts) */
  objects?: { from?: string; subs: number; nodes: number }[];
  /** Image filter: size of the new image */
  image?: { width: number; height: number };
  /** SHA-256 of the result, to compare runs */
  geometry: string;
  /** The full answer, to look at the paths or pixels */
  result: ToolResult;
}

/**
 * Run a path tool or image filter once (#205 stage 3): params are checked against the schema like the dialog
 * does, input defaults to a small sample (a square with a hole and a line, or a gray ramp).
 */
export async function runTool(m: PluginManifest, params: Record<string, unknown> = {}, input?: ToolInput): Promise<ToolState> {
  const x = pluginTool(m, { id: 'headless', name: 'headless' });
  try {
    const bad = checkInput(x, params);
    if (bad.length) throw new ScriptError(bad.map((i) => i.msg).join('; '));
    const p = normalizeParams(x, params);
    const r = await x.run(p, input ?? sampleInput(x.type));
    const out: ToolState = {
      params: p,
      issues: r.issues.map((i) => ({ ...(i.key ? { key: i.key } : {}), level: i.level, ...(i.code ? { code: i.code } : {}), msg: i.msg })),
      info: r.info,
      geometry: hex(sha256(new TextEncoder().encode(JSON.stringify(r.objects ?? (r.image ? [r.image.width, r.image.height, Array.from(r.image.data)] : null))))),
      result: r,
    };
    if (r.objects) out.objects = r.objects.map((o) => ({ ...(o.from ? { from: o.from } : {}), subs: o.subs.length, nodes: o.subs.reduce((n, sp) => n + sp.nodes.length, 0) }));
    if (r.image) out.image = { width: r.image.width, height: r.image.height };
    return out;
  } finally {
    x.dispose();
  }
}

/** Check a path tool or image filter: the defaults give a result on the sample, every choice runs, runs repeat */
async function checkTool(m: PluginManifest, errors: string[], codes: Set<string>) {
  const note = (st: ToolState, what: string) => {
    for (const i of st.issues) {
      if (i.code && /^plugin-/.test(i.code)) errors.push(`${what}: ${i.code} (${i.msg})`);
      else if (i.code) codes.add(i.code);
    }
  };
  const d = await runTool(m);
  note(d, 'defaults');
  if (d.issues.some((i) => i.level === 'error')) errors.push(`defaults: ${d.issues.filter((i) => i.level === 'error').map((i) => i.code ?? i.msg).join(', ')}`);
  else if (!d.objects && !d.image) errors.push('defaults: no result on the sample input');
  if ((await runTool(m)).geometry !== d.geometry) errors.push('defaults: two runs give different results (use a seed parameter instead of randomness or time)');
  for (const s of m.schema) {
    const steps = s.type === 'enum' ? s.options.filter(([v]) => v !== s.def).map(([v]) => ({ [s.key]: v })) : s.type === 'bool' ? [{ [s.key]: !s.def }] : [];
    for (const step of steps) note(await runTool(m, step), JSON.stringify(step));
  }
}

/** Check a generator plugin: defaults (with a sample model or selection when it needs one), every choice and view */
async function checkGenerator(m: PluginManifest, errors: string[], note: (states: DialogState[], what: string) => void) {
  // A plugin that is opened with a 3D model gets a sample model; a dialog that starts empty (a list filled from
  // the selection) is filled once with a sample selection
  let start: Record<string, unknown>[] = m.inputs?.some((x) => x.kind === 'model3d') ? [{ $model: SAMPLE_MODEL }] : [];
  let first = (await runDialog(m, start)).slice(start.length ? 1 : 0);
  const fill = m.actions?.find((a) => a.inputs?.includes('selection'));
  if (!first[0].parts.length && fill) {
    start = [...start, { $action: fill.id, $selection: SAMPLE_SELECTION }];
    first = await runDialog(m, start);
  }
  // A plugin that keeps an image (#211 stage 6) is opened once with a sample image
  const keep = m.actions?.find((a) => a.store);
  if (!first[first.length - 1].parts.length && keep) {
    start = [...start, { $action: keep.id, $image: sampleImage() }];
    first = await runDialog(m, start);
  }
  note(first, 'defaults');
  const d = first[first.length - 1];
  if (d.issues.some((i) => i.level === 'error')) errors.push(`defaults: ${d.issues.filter((i) => i.level === 'error').map((i) => i.code ?? i.msg).join(', ')}`);
  if (!d.parts.length) errors.push(fill || keep ? `defaults: no parts, even after action "${(fill ?? keep)!.id}" with a sample ${fill ? 'selection' : 'image'}` : 'defaults: no parts');
  const again = (await runDialog(m, start)).pop()!;
  if (again.geometry !== d.geometry || JSON.stringify(again.info) !== JSON.stringify(d.info)) errors.push('defaults: two runs give different results (use a seed parameter instead of randomness or time)');
  // Every choice once, starting from the defaults
  const steps: Record<string, unknown>[] = [];
  for (const s of m.schema) {
    if (s.type === 'enum') for (const [v] of s.options) if (v !== s.def) steps.push({ [s.key]: v });
    if (s.type === 'bool') steps.push({ [s.key]: !s.def });
  }
  // Every view of the drawing surface once (other than the first, which every run draws)
  for (const v of m.surface?.views.slice(1) ?? []) steps.push({ $view: v.id });
  for (const step of steps) note(await runDialog(m, [...start, step]), JSON.stringify(step));
  // Declared context the app may not have (a layer without material): the plugin answers with an issue, not a crash
  if (m.context?.length) {
    const none = await runDialog(m, start, { context: Object.fromEntries(m.context.map((w) => [w, null])) });
    note(none, 'without context');
    // An error the plugin did not write a text for is a crash in its code (e.g. reading the thickness of null)
    for (const i of none[none.length - 1].issues)
      if (i.code && !/^(plugin|net|host|check|joint)-/.test(i.code) && pluginText(m.texts, 'en', i.code) === undefined) errors.push(`without context: ${i.code} (report an issue when host.context answers null)`);
  }
}

export async function checkPlugin(m: PluginManifest, opts: { net?: readonly NetAnswer[] } = {}): Promise<CheckReport> {
  const errors: string[] = [];
  if (m.network?.length) useNetAnswers(m, opts.net ?? []);
  const warnings: string[] = [];
  const codes = new Set<string>();
  const crash = /^plugin-/;
  const note = (states: DialogState[], what: string) => {
    for (const s of states) {
      for (const i of s.issues) {
        if (i.code && crash.test(i.code)) errors.push(`${what}: ${i.code} (${i.msg})`);
        else if (i.code) codes.add(i.code);
      }
    }
  };
  try {
    if (isToolType(m.type)) await checkTool(m, errors, codes);
    else await checkGenerator(m, errors, note);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  if (m.network?.length && errors.some((e) => /net-offline/.test(e))) errors.push('the plugin loads data from the internet: give recorded answers for its requests (net-fixtures.json next to plugin.json, see docs/plugins.md)');
  for (const c of codes) if (c !== 'plugin-text' && !c.startsWith('net-') && !c.startsWith('check-') && !c.startsWith('joint-') && pluginText(m.texts, 'en', c) === undefined) warnings.push(`no English text for code "${c}"`);
  for (const s of m.schema) if (pluginText(m.texts, 'en', s.key) === undefined) warnings.push(`no English label for parameter "${s.key}"`);
  if (pluginText(m.texts, 'en', 'desc') === undefined) warnings.push('no English text "desc" (toolbox tooltip)');
  return { id: m.id, errors, warnings };
}
