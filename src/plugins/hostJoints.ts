// Host function joints (#398): the app's wood joints for plugins, so a plugin does not carry its own copy.
// - panel: the outline of a box panel with finger joints on its four edges (the code of the box, drawer and finger-box
//   generators, src/generators/panelJoints.ts)
// - edge: the joints of the Joint tool (finger, tenon, lap, snap, hook, wedge, T-slot, lid hinge) on one or two
//   straight edges of the plugin's outlines (src/jointsGeom.ts)
// v is the version of the joint geometry: the same input and version always give the same shapes. Problems and
// notes come back as codes joint-… with numbers; the app writes their texts (jointText.ts, plugins/words.ts).
// Runs inside the plugin Worker: no i18n here.
import type { SubPath } from '../model';
import { segments } from '../curves';
import { computeJointGeom, DEFAULT_JOINT, JOINT_GEOMETRY_VERSION, type JointKind, type JointMsg, type JointOptions } from '../jointsGeom';
import { fieldCount, panelCut, type Pattern } from '../generators/panelJoints';

type Bad = (what: string) => never;
type Num = (v: unknown, what: string, min?: number, max?: number) => number;
type Subs = (v: unknown, what: string) => SubPath[];

const KINDS: JointKind[] = ['finger', 'tenon', 'lap', 'snap', 'hook', 'wedge', 'tslot', 'lidhinge'];
const PATTERNS: Pattern[] = ['A', 'B', 'flat'];
/** Numeric options of the Joint tool and their ranges (mm, counts, %) */
const NUM_OPTS: Record<string, [number, number]> = {
  thickness: [0.1, 100], fingerWidth: [0.5, 1000], tenonCount: [1, 100], tenonWidth: [0.1, 1000], slotOffset: [-1000, 1000],
  lapCount: [1, 100], lapDepth: [1, 99], snapLip: [0, 50], snapLength: [0, 100], snapRelief: [0, 1000], hookLength: [0, 1000],
  wedgeWidth: [0, 100], wedgePull: [-50, 50], boltDia: [0, 50], nutWidth: [0, 100], nutHeight: [0, 100], boltLength: [0, 1000],
  hingeCount: [1, 99], pinDia: [0, 50], pinPlay: [-5, 5], hingeWall: [0, 50], kerf: [0, 5], clearance: [-5, 5], slotClearance: [-5, 5],
};
/** Most cells of a panel's finger grid (the generators allow 3 m panels with 0.5 mm fingers; keeps larger requests from taking the Worker's time) */
const MAX_FIELDS = 20000;

const msg = (m: JointMsg) => ({ code: `joint-${m.code}`, ...(m.values ? { values: m.values } : {}) });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function jointsFn(input: unknown, subsOf: Subs, num: Num, bad: Bad): unknown {
  if (!isObj(input)) return bad('joints');
  const v = input.v === undefined ? JOINT_GEOMETRY_VERSION : input.v;
  // Only versions this app knows; a newer plugin on an older app fails clearly instead of getting other shapes
  if (v !== 1) return bad('v');
  if (input.op === 'panel') {
    const a = num(input.width, 'width', 0.1, 1e5), b = num(input.height, 'height', 0.1, 1e5);
    const th = num(input.thickness, 'thickness', 0.1, 100);
    const finger = num(input.finger, 'finger', 0.5, 1e5);
    const clearance = input.clearance === undefined ? 0 : num(input.clearance, 'clearance', -5, 5);
    const kerf = input.kerf === undefined ? 0 : num(input.kerf, 'kerf', 0, 5);
    if (2 * th >= Math.min(a, b)) return bad('thickness');
    if (!Array.isArray(input.edges) || input.edges.length !== 4 || !input.edges.every((e) => (PATTERNS as unknown[]).includes(e))) return bad('edges');
    if (fieldCount(a - 2 * th, finger) + fieldCount(b - 2 * th, finger) > MAX_FIELDS) return bad('finger');
    const edges = (input.edges as Pattern[]).map((pattern) => ({ pattern })) as [{ pattern: Pattern }, { pattern: Pattern }, { pattern: Pattern }, { pattern: Pattern }];
    const pts = panelCut({ key: '', a, b, edges, corners: input.corners === true }, th, finger, clearance, kerf);
    return { v, outline: { closed: true, nodes: pts } };
  }
  if (input.op === 'edge') {
    const o: JointOptions = { ...DEFAULT_JOINT };
    if (!isObj(input.options)) return bad('options');
    for (const [k, x] of Object.entries(input.options)) {
      if (k === 'kind') o.kind = (KINDS as unknown[]).includes(x) ? (x as JointKind) : bad('kind');
      else if (k === 'direction') o.direction = x === 'in' || x === 'out' ? x : bad('direction');
      else if (k === 'swap' || k === 'hookFlip') o[k] = typeof x === 'boolean' ? x : bad(k);
      else if (NUM_OPTS[k]) (o as unknown as Record<string, number>)[k] = num(x, k, ...NUM_OPTS[k]);
      else return bad(k);
    }
    if (!isObj(input.parts)) return bad('parts');
    const keys = Object.keys(input.parts);
    if (!keys.length || keys.length > 2) return bad('parts');
    const parts = new Map(keys.map((k) => [k, subsOf((input.parts as Record<string, unknown>)[k], `parts.${k}`)]));
    if (!Array.isArray(input.edges) || input.edges.length < 1 || input.edges.length > 2) return bad('edges');
    const edges = input.edges.map((e, i) => {
      if (!isObj(e) || typeof e.part !== 'string' || !parts.has(e.part)) return bad(`edges[${i}].part`);
      const subs = parts.get(e.part)!;
      const sub = num(e.sub ?? 0, `edges[${i}].sub`, 0, subs.length - 1);
      const seg = num(e.seg, `edges[${i}].seg`, 0, 1e6);
      const s = Number.isInteger(sub) && Number.isInteger(seg) ? segments(subs[sub])[seg] : undefined;
      // Joints go on straight edges only, like in the Joint tool
      if (!s || s.curve || Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 1e-6) return bad(`edges[${i}].seg`);
      return { obj: e.part, subs, sub, seg };
    });
    const r = computeJointGeom(edges, o);
    if (r.error) return { v, error: msg(r.error) };
    const out: Record<string, SubPath[]> = {};
    for (const k of keys) out[k] = r.changes.get(k) ?? parts.get(k)!;
    return { v, parts: out, added: r.added, info: r.info.map(msg) };
  }
  return bad('op');
}
