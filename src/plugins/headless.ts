// Headless dialog runner (#335 stage 1): runs a plugin generator without the app window. It applies a script of
// field changes the way the dialog does (checked against the schema like user input) and returns what the dialog
// would show after each step: parameters, visible fields, issues, info rows and the parts. Plugin authors use it
// in their tests; `npm run plugin:check` uses it to check a pack before it goes into the catalogue.
import type { Pt } from '../model';
import type { Params } from '../generators/types';
import { buildGen, checkInput, defaultParams, fieldActive, normalizeParams } from '../generators/index';
import { pluginGenerator } from './generator';
import { pluginText, type PluginManifest } from './manifest';
import { sha256 } from '../pdfcrypt';
import { hex } from './manifest';

export interface DialogState {
  params: Params;
  /** Keys of the fields the dialog shows (showIf), in schema order */
  visible: string[];
  issues: { key?: string; level: 'error' | 'warn'; code?: string; msg: string }[];
  info: [string, string][];
  parts: { key: string; at: Pt; subs: number; nodes: number; box: { minX: number; minY: number; maxX: number; maxY: number } }[];
  /** SHA-256 of the generated geometry, to compare runs */
  geometry: string;
}

/** Thrown when a script step does not fit the schema (unknown key, wrong type, out of range) */
export class ScriptError extends Error {}

/**
 * Run the dialog of a plugin generator: the default parameters first, then one state per step. A step is the
 * set of fields the user changes at once.
 */
export async function runDialog(m: PluginManifest, steps: Record<string, unknown>[] = []): Promise<DialogState[]> {
  const g = pluginGenerator(m, { id: 'headless', name: m.id });
  try {
    const out: DialogState[] = [];
    let p = defaultParams(g);
    for (let i = 0; i <= steps.length; i++) {
      if (i > 0) {
        const bad = checkInput(g, steps[i - 1]).filter((x) => x.level === 'error');
        if (bad.length) throw new ScriptError(`step ${i}: ${bad.map((x) => x.msg).join('; ')}`);
        p = normalizeParams(g, { ...p, ...steps[i - 1] }, p);
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
      });
    }
    return out;
  } finally {
    g.dispose();
  }
}

export interface CheckReport {
  id: string;
  /** Problems that keep a plugin out of the catalogue */
  errors: string[];
  /** Things worth fixing */
  warnings: string[];
}

/**
 * Check a plugin like the catalogue does: the default parameters must give parts without errors, every enum option
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
    const first = await runDialog(m);
    note(first, 'defaults');
    const d = first[0];
    if (d.issues.some((i) => i.level === 'error')) errors.push(`defaults: ${d.issues.filter((i) => i.level === 'error').map((i) => i.code ?? i.msg).join(', ')}`);
    if (!d.parts.length) errors.push('defaults: no parts');
    const again = await runDialog(m);
    if (again[0].geometry !== d.geometry || JSON.stringify(again[0].info) !== JSON.stringify(d.info)) errors.push('defaults: two runs give different results (use a seed parameter instead of randomness or time)');
    // Every choice once, starting from the defaults
    const steps: Record<string, unknown>[] = [];
    for (const s of m.schema) {
      if (s.type === 'enum') for (const [v] of s.options) if (v !== s.def) steps.push({ [s.key]: v });
      if (s.type === 'bool') steps.push({ [s.key]: !s.def });
    }
    for (const step of steps) note(await runDialog(m, [step]), JSON.stringify(step));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  for (const c of codes) if (pluginText(m.texts, 'en', c) === undefined) warnings.push(`no English text for code "${c}"`);
  for (const s of m.schema) if (pluginText(m.texts, 'en', s.key) === undefined) warnings.push(`no English label for parameter "${s.key}"`);
  if (pluginText(m.texts, 'en', 'desc') === undefined) warnings.push('no English text "desc" (toolbox tooltip)');
  return { id: m.id, errors, warnings };
}
