// Plugin contract (issue #205, stage 1): what a plugin may return, checked before anything reaches the editor.
// Plugins exchange JSON only. Calls: validate(params) → issues, generate(params) → parts, info, poses, plan.
// No DOM, no Editor, so the same checks run in the Worker, in the app and in Node tests.
import type { Node, Pt, SubPath } from '../model';
import type { Issue, Params, PlanSheet } from '../generators/types';
import type { AsmPoses, Pose, V3 } from '../generators/pose';

/** Version of the call protocol; a plugin built for a newer one is refused with an update hint */
export const PLUGIN_API = 1;

/** Plugin functions the app calls */
export type PluginFn = 'validate' | 'generate';

/** Limits for one plugin (#205: time, memory, output size) */
export const LIMITS = {
  /** Time per call in ms; the Worker is terminated after it */
  callMs: { validate: 2000, generate: 10000 } as Record<PluginFn, number>,
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
};

/** Issue as a plugin reports it: a code (translated through the manifest texts) and plain values */
export interface PluginIssue {
  key?: string;
  level: 'error' | 'warn';
  code: string;
  values?: Record<string, string | number>;
}

export interface PluginPart {
  key: string;
  subs: SubPath[];
  at: Pt;
  marks?: SubPath[];
}

export interface PluginGenResult {
  parts: PluginPart[];
  /** Rows for the dialog: [text code, value] */
  info: [string, string][];
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
      return { ...p, ...(o.cin !== undefined ? { cin: pt(o.cin, what) } : {}), ...(o.cout !== undefined ? { cout: pt(o.cout, what) } : {}) };
    });
    return { nodes, closed: s.closed === true };
  });
}

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

function checkValues(v: unknown): Record<string, string | number> {
  if (!isObj(v)) return fail('values');
  const out: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(v).slice(0, 20)) out[str(k, 'value name', 40)] = typeof x === 'number' && Number.isFinite(x) ? x : str(x, 'value', LIMITS.text);
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
  const info = v.info === undefined ? [] : Array.isArray(v.info) && v.info.length <= LIMITS.info ? v.info.map((r): [string, string] => (Array.isArray(r) && r.length === 2 ? [str(r[0], 'info'), str(r[1], 'info')] : fail('info'))) : fail('info');
  const out: PluginGenResult = { parts, info };
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

/** Turn plugin issues into app issues, with texts from the manifest (fallback: the code) */
export function toIssues(list: PluginIssue[], text: (code: string, values?: Record<string, string | number>) => string): Issue[] {
  return list.map((i) => ({ ...(i.key ? { key: i.key } : {}), level: i.level, code: i.code, msg: text(i.code, i.values) }));
}

/** Parameters handed to a plugin: plain JSON copy */
export const callInput = (p: Params): Params => JSON.parse(JSON.stringify(p));
