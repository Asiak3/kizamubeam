// Box composer (#327): a box with freely placed inner walls (T joints, corners, free ends, crossings).
// Experimental (pack version 0.x). All wood joints come from the app through host.joints.
// Build: node scripts/plugin-pack.mjs --build plugins/box-composer
// Check: npm run plugin:check plugins/box-composer
import { definePlugin, host, mm, type Issue, type Part, type SubPath, type Text } from '../../sdk/ts';
import { JointError } from './joints';
import { buildModel, readLayout, type Model } from './model';
import { buildParts, innerHeight, poses, withKerf, type Dims } from './parts';

interface P {
  [k: string]: number | string | boolean;
  width: number;
  depth: number;
  height: number;
  fromMaterial: boolean;
  thickness: number;
  clearance: number;
  kerf: number;
  wallFront: boolean;
  wallBack: boolean;
  wallLeft: boolean;
  wallRight: boolean;
  lid: boolean;
  dividerDrop: number;
  finger: number;
  walls: string;
  wallsRef: string;
}

/** Values of the layer's material for the fields; slotPlay (slot width over the thickness) is the total play of a
 * joint, like the clearance here (#402) */
function fromMaterial(): { thickness: number; kerf: number | null; clearance: number | null; name: string | null } | null {
  const m = host.context('material');
  if (!m || m.thickness == null) return null;
  return { thickness: m.thickness, kerf: m.kerf, clearance: m.slotPlay, name: m.name };
}

/**
 * Sizes for the parts, always from the fields: the 3D view and the assembly check take the thickness from the
 * parameters too. "From material" copies the material into the fields when it is switched on (onChange) and warns
 * when the material of the layer no longer matches them.
 */
function dims(p: P): { d: Dims | null; issues: Issue[]; material: string | null } {
  const issues: Issue[] = [];
  let material: string | null = null;
  if (p.fromMaterial) {
    const m = fromMaterial();
    if (!m) return { d: null, issues: [{ key: 'fromMaterial', level: 'error', code: 'material-none' }], material: null };
    material = m.name;
    const off = (a: number | null, b: number) => a != null && Math.abs(a - b) > 1e-6;
    if (off(m.thickness, p.thickness) || off(m.kerf, p.kerf) || off(m.clearance, p.clearance))
      issues.push({ key: 'fromMaterial', level: 'warn', code: 'material-changed', values: { thickness: m.thickness } });
    if (m.kerf == null) issues.push({ key: 'fromMaterial', level: 'warn', code: 'material-no-kerf', values: { kerf: p.kerf } });
    if (m.clearance == null) issues.push({ key: 'fromMaterial', level: 'warn', code: 'material-no-play', values: { play: p.clearance } });
  }
  const sides = { x0: p.wallLeft, x1: p.wallRight, y0: p.wallBack, y1: p.wallFront };
  const any = sides.x0 || sides.x1 || sides.y0 || sides.y1;
  const d: Dims = { W: p.width, D: p.depth, H: p.height, t: p.thickness, finger: p.finger, clearance: p.clearance, kerf: p.kerf, sides, lid: any && p.lid, drop: any ? p.dividerDrop : 0 };
  return { d, issues, material };
}

/** The checked wall model, or the issue that keeps it from being built */
function model(p: P, d: Dims): Model | Issue {
  const t = d.t;
  const w = d.W - 2 * t,
    dd = d.D - 2 * t;
  if (!(w > 2 * t && dd > 2 * t)) return { level: 'error', code: 'box-small' };
  if (innerHeight(d) < 2 * t) return { key: 'height', level: 'error', code: 'walls-low', values: { min: 2 * t } };
  const l = readLayout(p.walls, p.wallsRef);
  if (!l) return { key: 'walls', level: 'error', code: 'walls-bad' };
  // Smallest sizes (user, 17 nov 2026; to be reviewed after the test cuts): one thickness of clear space between
  // walls and joints, walls and free ends two thicknesses long
  return buildModel(l, w, dd, { t, gap: t, minLen: 2 * t, freeLen: 2 * t });
}
const isIssue = (m: Model | Issue): m is Issue => 'code' in m;

/** Everything validate and generate need: issues, and the parts when there is no error */
function compute(p: P) {
  const { d, issues, material } = dims(p);
  if (!d) return { issues, d, material, built: null };
  const m = model(p, d);
  if (isIssue(m)) return { issues: [...issues, m], d, material, built: null };
  issues.push(...m.issues.map((i) => ({ key: 'walls', ...i })));
  if (issues.some((i) => i.level === 'error')) return { issues, d, material, built: null };
  try {
    return { issues, d, material, built: buildParts(m, d), m };
  } catch (e) {
    if (e instanceof JointError) return { issues: [...issues, { level: 'error' as const, code: e.code, ...(e.values ? { values: e.values } : {}) }], d, material, built: null };
    throw e;
  }
}

/** Check design on the cut lines (#388): thin webs, lines cut twice, parts larger than the work area */
function checkIssues(parts: Record<string, SubPath[]>, kerf: number): Issue[] {
  const area = host.context('workArea');
  const found = host.check({ parts: Object.entries(parts).map(([key, subs]) => ({ key, subs })), kerf, ...(area ? { workArea: area } : {}) });
  return found.filter((f) => f.level !== 'info').map((f) => ({ level: f.level as 'error' | 'warn', code: f.code, ...(f.values ? { values: f.values } : {}) }));
}

/** Does the block of parts (positions from nest) fit the work area, turned or not? */
function fitsArea(parts: Part[]): boolean {
  const area = host.context('workArea');
  if (!area) return true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts)
    for (const s of p.subs)
      for (const n of s.nodes) {
        x0 = Math.min(x0, n.x + p.at.x); x1 = Math.max(x1, n.x + p.at.x);
        y0 = Math.min(y0, n.y + p.at.y); y1 = Math.max(y1, n.y + p.at.y);
      }
  const w = x1 - x0, h = y1 - y0;
  return (w <= area.width && h <= area.height) || (h <= area.width && w <= area.height);
}

definePlugin<P>({
  // "From material" switched on: take over thickness, kerf and play of the layer's material (those it has)
  onChange({ key, params }) {
    if (key !== 'fromMaterial' || !params.fromMaterial) return null;
    const m = fromMaterial();
    if (!m) return null;
    return { patch: { thickness: m.thickness, ...(m.kerf != null ? { kerf: m.kerf } : {}), ...(m.clearance != null ? { clearance: m.clearance } : {}) } };
  },
  validate(p) {
    const c = compute(p);
    if (!c.built || !c.d) return c.issues;
    return [...c.issues, ...checkIssues(c.built.parts, c.d.kerf)];
  },
  generate(p) {
    const c = compute(p);
    if (!c.built || !c.d) throw new Error(c.issues.find((i) => i.level === 'error')?.code ?? 'walls-bad');
    const parts = withKerf(c.built.parts, c.d.kerf);
    const keys = Object.keys(parts);
    const at = host.nest({ parts: keys.map((key) => ({ key, subs: parts[key] })), gap: Math.max(3, 2 * c.d.kerf + 2) });
    const out: Part[] = keys.map((key, i) => ({ key, subs: parts[key], at: { x: at[i][0], y: at[i][1] } }));
    const labels: Record<string, Text> = {};
    for (const w of c.built.walls) labels[w.key] = { code: 'part.wall', values: { id: w.it.wall.id } };
    const info: [Text, Text][] = [
      ['info.walls', String(c.built.walls.length)],
      ['info.height', `${mm(innerHeight(c.d))} mm`],
    ];
    if (c.material) info.push(['info.material', `${c.material} · ${mm(c.d.t)} mm`]);
    // Larger than the work area as one block: the app spreads the parts over pages (#387), not turned (grain)
    const spread = fitsArea(out) ? {} : { distribute: { rotate: false } };
    return { parts: out, info, labels, poses: { poses: poses(c.built.walls, c.d, keys) }, ...spread };
  },
});
