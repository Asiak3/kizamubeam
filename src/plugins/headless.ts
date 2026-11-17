// Headless dialog runner (#335 stage 1): runs a plugin generator without the app window. It applies a script of
// field changes the way the dialog does (checked against the schema like user input) and returns what the dialog
// would show after each step: parameters, visible fields, issues, info rows and the parts. Plugin authors use it
// in their tests; `npm run plugin:check` uses it to check a pack before it goes into the catalogue.
import type { Pt } from '../model';
import type { GenEvent, GenImage, Params } from '../generators/types';
import { fromBase64 } from './contract';
import type { GenSelected } from '../generators/host';
import { buildGen, checkInput, defaultParams, fieldActive, normalizeParams } from '../generators/index';
import { pluginGenerator } from './generator';
import { pluginText, type PluginManifest } from './manifest';
import { sha256 } from '../pdfcrypt';
import { hex } from './manifest';
import { encodeMesh, meshId, weld } from '../model3d/mesh';

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
  /** Message of an action in this step (onEvent) */
  message?: string;
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
 * `inputs` name.
 */
export async function runDialog(m: PluginManifest, steps: Record<string, unknown>[] = []): Promise<DialogState[]> {
  const models = new Map<string, string>();
  const g = pluginGenerator(m, { id: 'headless', name: m.id }, { resource: (kind, id) => (kind === 'model3d' ? models.get(id) ?? null : null) });
  try {
    const out: DialogState[] = [];
    let p = defaultParams(g);
    for (let i = 0; i <= steps.length; i++) {
      let ask: DialogState['ask'];
      let message: string | undefined;
      if (i > 0) {
        const { $answer, $action, $selection, $image, $camera, $model, ...step } = steps[i - 1];
        if ($model !== undefined) {
          const md = $model as { name?: unknown; data?: unknown };
          if (typeof md.data !== 'string' || !md.data.startsWith('kzm1:')) throw new ScriptError(`step ${i}: $model needs data in the kzm1: format`);
          if (!g.fromInputs) throw new ScriptError(`step ${i}: the plugin does not take a 3D model`);
          const id = meshId(md.data);
          models.set(id, md.data);
          p = normalizeParams(g, { ...p, ...g.fromInputs({ model: { id, name: String(md.name ?? '') } }) }, p);
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
        if ($action !== undefined) {
          const a = g.actions?.find((x) => x.id === $action);
          if (!a) throw new ScriptError(`step ${i}: no action "${String($action)}"`);
          if ($selection !== undefined && !Array.isArray($selection)) throw new ScriptError(`step ${i}: $selection must be a list`);
          const inputs: GenEvent['inputs'] = {};
          if (a.inputs?.includes('selection')) inputs.selection = ($selection ?? []) as GenSelected[];
          if (a.inputs?.includes('image') && $image !== undefined) inputs.image = { ...scriptImage($image, i), name: String(($image as { name?: unknown }).name ?? '') };
          if (a.inputs?.includes('camera') && $camera !== undefined) {
            const c = $camera as { bed?: { w: number; h: number }; empty?: unknown };
            if (!c.bed || !(c.bed.w > 0 && c.bed.h > 0)) throw new ScriptError(`step ${i}: $camera needs bed: { w, h }`);
            inputs.camera = { ...scriptImage($camera, i), bed: { w: c.bed.w, h: c.bed.h }, ...(c.empty ? { empty: scriptImage(c.empty, i) } : {}) };
          }
          const r = await g.onEvent!({ action: a.id, inputs }, p);
          if (r?.message !== undefined) message = r.message;
          if (r?.patch) {
            const keys = Object.keys(r.patch).filter((k) => g.schema.some((s) => s.key === k));
            const np = normalizeParams(g, { ...p, ...r.patch }, p);
            for (const k of keys) p[k] = np[k];
          }
        }
      }
      await g.prepare(p);
      const r = buildGen(g, p);
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
 * and both values of every switch must run without a crash, two runs must give the same geometry, and the issue codes
 * the plugin reports should have an English text.
 */
export async function checkPlugin(m: PluginManifest): Promise<CheckReport> {
  const errors: string[] = [];
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
    // A plugin that is opened with a 3D model gets a sample model; a dialog that starts empty (a list filled from
    // the selection) is filled once with a sample selection
    let start: Record<string, unknown>[] = m.inputs?.some((x) => x.kind === 'model3d') ? [{ $model: SAMPLE_MODEL }] : [];
    let first = (await runDialog(m, start)).slice(start.length ? 1 : 0);
    const fill = m.actions?.find((a) => a.inputs?.includes('selection'));
    if (!first[0].parts.length && fill) {
      start = [...start, { $action: fill.id, $selection: SAMPLE_SELECTION }];
      first = await runDialog(m, start);
    }
    note(first, 'defaults');
    const d = first[first.length - 1];
    if (d.issues.some((i) => i.level === 'error')) errors.push(`defaults: ${d.issues.filter((i) => i.level === 'error').map((i) => i.code ?? i.msg).join(', ')}`);
    if (!d.parts.length) errors.push(fill ? `defaults: no parts, even after action "${fill.id}" with a sample selection` : 'defaults: no parts');
    const again = (await runDialog(m, start)).pop()!;
    if (again.geometry !== d.geometry || JSON.stringify(again.info) !== JSON.stringify(d.info)) errors.push('defaults: two runs give different results (use a seed parameter instead of randomness or time)');
    // Every choice once, starting from the defaults
    const steps: Record<string, unknown>[] = [];
    for (const s of m.schema) {
      if (s.type === 'enum') for (const [v] of s.options) if (v !== s.def) steps.push({ [s.key]: v });
      if (s.type === 'bool') steps.push({ [s.key]: !s.def });
    }
    for (const step of steps) note(await runDialog(m, [...start, step]), JSON.stringify(step));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  for (const c of codes) if (c !== 'plugin-text' && pluginText(m.texts, 'en', c) === undefined) warnings.push(`no English text for code "${c}"`);
  for (const s of m.schema) if (pluginText(m.texts, 'en', s.key) === undefined) warnings.push(`no English label for parameter "${s.key}"`);
  if (pluginText(m.texts, 'en', 'desc') === undefined) warnings.push('no English text "desc" (toolbox tooltip)');
  return { id: m.id, errors, warnings };
}
