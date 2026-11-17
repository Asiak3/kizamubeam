// Host function check (#388): the geometric part of "Check design" for the parts a plugin computes, before they
// reach the canvas: lines cut twice, outlines left open, webs too thin for the beam, cut-outs lost to the kerf
// offset, parts larger than the work area. The plugin hands over its cut lines and gets findings as codes with
// numbers (check-double, check-web, …); it passes them on as issues of validate and the app writes the text.
// Runs inside the plugin Worker (no i18n here: the texts are in the app, see checkText.ts).
import type { Obj, SubPath } from '../model';
import { IDENT, type Mat } from '../mat';
import { checkDouble, checkOpen, checkWebsAndHoles, DEFAULT_CHECK, makeContour, type CheckLevel, type CheckSettings, type Contour, type GeomIssue } from '../checkGeom';

/** Most parts and findings per call */
export const CHECK_LIMITS = { parts: 500, findings: 200 };

export interface CheckPart {
  /** The plugin's name for the part; findings name the parts they concern by it */
  key: string;
  /** Cut lines in mm */
  subs: SubPath[];
  /** Move the part by this before checking (where it lies in the output) */
  at?: [number, number];
}

/** A finding: code check-<what>, the parts it concerns, numbers for its text and a point to show */
export interface CheckFinding {
  code: string;
  level: CheckLevel;
  parts: string[];
  values?: Record<string, number>;
  at?: [number, number];
}

type Bad = (what: string) => never;
type Num = (v: unknown, what: string, min?: number, max?: number) => number;

/**
 * { parts: [{ key, subs, at? }], placed?, minWeb?, beam?, kerf?, tol?, closeGap?, workArea?: { width, height } }
 * → findings. Without `placed` each part is checked on its own; with it the parts lie where they will be cut and
 * are also checked against each other (shared lines, webs between neighbours).
 */
export function checkFn(input: unknown, subsOf: (v: unknown, what: string) => SubPath[], num: Num, bad: Bad): CheckFinding[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('check');
  const x = input as Record<string, unknown>;
  if (!Array.isArray(x.parts) || x.parts.length > CHECK_LIMITS.parts) return bad('parts');
  const opt = (k: string, min: number, max: number, def: number) => (x[k] === undefined ? def : num(x[k], k, min, max));
  const s: CheckSettings = {
    ...DEFAULT_CHECK,
    minWeb: opt('minWeb', 0, 50, DEFAULT_CHECK.minWeb),
    beam: opt('beam', 0, 5, DEFAULT_CHECK.beam),
    tol: opt('tol', 0.001, 1, DEFAULT_CHECK.tol),
    closeGap: opt('closeGap', 0, 50, DEFAULT_CHECK.closeGap),
  };
  const kerf = opt('kerf', 0, 2.5, 0);
  let area: { width: number; height: number } | undefined;
  if (x.workArea !== undefined) {
    const w = x.workArea as Record<string, unknown>;
    if (!w || typeof w !== 'object') return bad('workArea');
    area = { width: num(w.width, 'workArea', 0.1, 1e5), height: num(w.height, 'workArea', 0.1, 1e5) };
  }
  const seen = new Set<string>();
  const parts = x.parts.map((p, i): { key: string; top: Obj; cs: Contour[] } => {
    if (!p || typeof p !== 'object') return bad(`parts[${i}]`);
    const q = p as Record<string, unknown>;
    const key = typeof q.key === 'string' && q.key.length > 0 && q.key.length <= 100 && !seen.has(q.key) ? q.key : bad(`parts[${i}].key`);
    seen.add(key);
    let m: Mat = IDENT;
    if (q.at !== undefined) {
      if (!Array.isArray(q.at) || q.at.length !== 2) return bad(`parts[${i}].at`);
      m = [1, 0, 0, 1, num(q.at[0], `parts[${i}].at`), num(q.at[1], `parts[${i}].at`)];
    }
    // Stand-ins for objects: the checks only read their id (keys of findings) and shape kind (fixes, not passed on)
    const top = { id: i, shape: { kind: 'plugin' } } as unknown as Obj;
    const cs: Contour[] = [];
    subsOf(q.subs, `parts[${i}].subs`).forEach((sp, sub) => {
      const c = makeContour(sp, m, { idx: 0, top, leaf: top, sub, layer: 0, fill: false, cut: true, kerf, beam: kerf > 0 ? 2 * kerf : s.beam, text: false });
      if (c) cs.push(c);
    });
    return { key, top, cs };
  });

  const out: CheckFinding[] = [];
  const push = (f: CheckFinding) => {
    if (out.length < CHECK_LIMITS.findings) out.push(f);
  };
  if (area) {
    for (const p of parts) {
      if (!p.cs.length) continue;
      const x0 = Math.min(...p.cs.map((c) => c.box.x0)), x1 = Math.max(...p.cs.map((c) => c.box.x1));
      const y0 = Math.min(...p.cs.map((c) => c.box.y0)), y1 = Math.max(...p.cs.map((c) => c.box.y1));
      const w = x1 - x0, h = y1 - y0;
      // Turned by 90° it may still fit
      const fits = (a: number, b: number) => a <= area!.width + 1e-6 && b <= area!.height + 1e-6;
      if (!fits(w, h) && !fits(h, w)) push({ code: 'check-too-big', level: 'error', parts: [p.key], values: { w, h, aw: area.width, ah: area.height } });
    }
  }
  const run = (cs: Contour[]) => {
    cs.forEach((c, i) => (c.idx = i));
    const found: GeomIssue[] = [];
    checkDouble(cs, s, found);
    checkOpen(cs, s, found);
    checkWebsAndHoles(cs, s, found);
    for (const f of found) {
      const pt = f.pts[0] ?? f.lines[0]?.[0];
      push({
        code: `check-${f.code}`,
        level: f.level,
        parts: [...new Set(f.objs.map((o) => parts[o.id].key))],
        ...(f.values ? { values: f.values } : {}),
        ...(pt ? { at: [pt.x, pt.y] } : {}),
      });
    }
  };
  if (x.placed === true) run(parts.flatMap((p) => p.cs));
  else for (const p of parts) run(p.cs);
  return out;
}
