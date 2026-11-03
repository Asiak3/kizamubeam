// Anbindung an PlaneGCS (Löser aus FreeCAD, als WebAssembly; LGPL-2.0-or-later): Skizze → Primitive → Lösung.
// Der Löser wird beim ersten Gebrauch geladen (loadSolver). Danach läuft solveSketch synchron.
import { GcsWrapper, init_planegcs_module, SolveStatus } from '@salusoft89/planegcs';
import { entOf, ptOf, Sketch, SkCon, SkEnt } from './model';

type Module = Awaited<ReturnType<typeof init_planegcs_module>>;
type Prim = Record<string, unknown> & { id: string; type: string };

let wasmUrl: string | undefined;
let mod: Module | null = null;
let loading: Promise<Module> | null = null;

/** Adresse der .wasm-Datei (im Browser von Vite geliefert, in Tests ein Dateipfad) */
export function setSolverWasm(url: string) {
  wasmUrl = url;
}
export const solverReady = () => !!mod;

export function loadSolver(): Promise<void> {
  const l = (loading ??= init_planegcs_module(wasmUrl ? { locateFile: () => wasmUrl! } : undefined).then((m: Module) => (mod = m)));
  return l.then(() => undefined);
}

export interface SolveResult {
  ok: boolean;
  /** Freiheitsgrade (0 = voll bestimmt) */
  dof: number;
  /** Beziehungen, die sich widersprechen bzw. überzählig sind (ids der Skizze) */
  conflicting: number[];
  redundant: number[];
}

const P = (id: number) => `p${id}`;
const E = (id: number) => `e${id}`;
const C = (id: number, suffix = '') => `c${id}${suffix}`;
const idOf = (s: string) => parseInt(s.slice(1), 10);

/** Primitive für PlaneGCS; drag hält einen Punkt an der gegebenen Stelle fest (Ziehen) */
export function toPrimitives(sk: Sketch, drag?: { pt: number; x: number; y: number }): Prim[] {
  const out: Prim[] = [];
  for (const p of sk.pts) {
    const d = drag && drag.pt === p.id;
    out.push({ id: P(p.id), type: 'point', x: d ? drag!.x : p.x, y: d ? drag!.y : p.y, fixed: !!d });
  }
  for (const e of sk.ents) {
    if (e.t === 'line') out.push({ id: E(e.id), type: 'line', p1_id: P(e.a), p2_id: P(e.b) });
    else if (e.t === 'circle') out.push({ id: E(e.id), type: 'circle', c_id: P(e.c), radius: e.r });
    else {
      out.push({ id: E(e.id), type: 'arc', c_id: P(e.c), start_id: P(e.s), end_id: P(e.e), radius: e.r, start_angle: e.a0, end_angle: e.a1 });
      out.push({ id: `r${e.id}`, type: 'arc_rules', a_id: E(e.id) });
    }
  }
  for (const c of sk.cons) out.push(...conPrims(sk, c));
  return out;
}

const isRound = (e: SkEnt | undefined): e is SkEnt & { t: 'circle' | 'arc' } => !!e && e.t !== 'line';

function conPrims(sk: Sketch, c: SkCon): Prim[] {
  const id = C(c.id);
  const r = c.r;
  const ent = (i: number) => entOf(sk, r[i]);
  const v = c.v ?? 0;
  switch (c.t) {
    case 'coincident':
      return [{ id, type: 'p2p_coincident', p1_id: P(r[0]), p2_id: P(r[1]) }];
    case 'horizontal':
    case 'vertical': {
      const h = c.t === 'horizontal';
      if (r.length === 1) return [{ id, type: h ? 'horizontal_l' : 'vertical_l', l_id: E(r[0]) }];
      return [{ id, type: h ? 'horizontal_pp' : 'vertical_pp', p1_id: P(r[0]), p2_id: P(r[1]) }];
    }
    case 'parallel':
      return [{ id, type: 'parallel', l1_id: E(r[0]), l2_id: E(r[1]) }];
    case 'perpendicular':
      return [{ id, type: 'perpendicular_ll', l1_id: E(r[0]), l2_id: E(r[1]) }];
    case 'equal': {
      const a = ent(0),
        b = ent(1);
      if (a?.t === 'line' && b?.t === 'line') return [{ id, type: 'equal_length', l1_id: E(a.id), l2_id: E(b.id) }];
      if (a?.t === 'circle' && b?.t === 'circle') return [{ id, type: 'equal_radius_cc', c1_id: E(a.id), c2_id: E(b.id) }];
      if (a?.t === 'arc' && b?.t === 'arc') return [{ id, type: 'equal_radius_aa', a1_id: E(a.id), a2_id: E(b.id) }];
      if (a?.t === 'circle' && b?.t === 'arc') return [{ id, type: 'equal_radius_ca', c1_id: E(a.id), a2_id: E(b.id) }];
      if (a?.t === 'arc' && b?.t === 'circle') return [{ id, type: 'equal_radius_ca', c1_id: E(b.id), a2_id: E(a.id) }];
      return [];
    }
    case 'fixed':
      return [
        { id: C(c.id, 'x'), type: 'coordinate_x', p_id: P(r[0]), x: c.x ?? ptOf(sk, r[0])?.x ?? 0 },
        { id: C(c.id, 'y'), type: 'coordinate_y', p_id: P(r[0]), y: c.y ?? ptOf(sk, r[0])?.y ?? 0 },
      ];
    case 'pointOnLine':
      return [{ id, type: 'point_on_line_pl', p_id: P(r[0]), l_id: E(r[1]) }];
    case 'pointOnCircle': {
      const e = ent(1);
      return e?.t === 'arc' ? [{ id, type: 'point_on_arc', p_id: P(r[0]), a_id: E(r[1]) }] : [{ id, type: 'point_on_circle', p_id: P(r[0]), c_id: E(r[1]) }];
    }
    case 'midpoint': {
      const l = ent(1);
      if (l?.t !== 'line') return [];
      return [{ id, type: 'p2p_symmetric_ppp', p1_id: P(l.a), p2_id: P(l.b), p_id: P(r[0]) }];
    }
    case 'symmetric':
      return [{ id, type: 'p2p_symmetric_ppl', p1_id: P(r[0]), p2_id: P(r[1]), l_id: E(r[2]) }];
    case 'tangent': {
      const a = ent(0),
        b = ent(1);
      if (!a || !b) return [];
      const line = a.t === 'line' ? a : b.t === 'line' ? b : null;
      const other = line === a ? b : a;
      if (line && other.t === 'circle') return [{ id, type: 'tangent_lc', l_id: E(line.id), c_id: E(other.id) }];
      if (line && other.t === 'arc') return [{ id, type: 'tangent_la', l_id: E(line.id), a_id: E(other.id) }];
      if (a.t === 'circle' && b.t === 'circle') return [{ id, type: 'tangent_cc', c1_id: E(a.id), c2_id: E(b.id) }];
      if (a.t === 'arc' && b.t === 'arc') return [{ id, type: 'tangent_aa', a1_id: E(a.id), a2_id: E(b.id) }];
      const circ = a.t === 'circle' ? a : b,
        arc = a.t === 'arc' ? a : b;
      return [{ id, type: 'tangent_ca', c_id: E(circ.id), a_id: E(arc.id) }];
    }
    case 'concentric': {
      const a = ent(0),
        b = ent(1);
      if (!isRound(a) || !isRound(b)) return [];
      return [{ id, type: 'p2p_coincident', p1_id: P(a.c), p2_id: P(b.c) }];
    }
    case 'distance': {
      if (r.length === 1) {
        const l = ent(0);
        if (l?.t !== 'line') return [];
        return [{ id, type: 'p2p_distance', p1_id: P(l.a), p2_id: P(l.b), distance: v }];
      }
      if (entOf(sk, r[1])?.t === 'line') return [{ id, type: 'p2l_distance', p_id: P(r[0]), l_id: E(r[1]), distance: v }];
      return [{ id, type: 'p2p_distance', p1_id: P(r[0]), p2_id: P(r[1]), distance: v }];
    }
    case 'hdistance':
    case 'vdistance': {
      let a = r[0],
        b = r[1];
      if (r.length === 1) {
        const l = ent(0);
        if (l?.t !== 'line') return [];
        a = l.a;
        b = l.b;
      }
      const pa = ptOf(sk, a),
        pb = ptOf(sk, b);
      if (!pa || !pb) return [];
      const prop = c.t === 'hdistance' ? 'x' : 'y';
      // Vorzeichen wie in der aktuellen Lage, damit die Teile nicht umklappen
      const sign = (pb[prop] - pa[prop]) < 0 ? -1 : 1;
      return [{ id, type: 'difference', param1: { o_id: P(a), prop }, param2: { o_id: P(b), prop }, difference: sign * v }];
    }
    case 'angle': {
      const l1 = ent(0),
        l2 = ent(1);
      if (l1?.t !== 'line' || l2?.t !== 'line') return [];
      const signed = signedLineAngle(sk, l1, l2);
      const rad = (v * Math.PI) / 180;
      return [{ id, type: 'l2l_angle_ll', l1_id: E(l1.id), l2_id: E(l2.id), angle: signed < 0 ? -rad : rad }];
    }
    case 'radius':
    case 'diameter': {
      const e = ent(0);
      if (!isRound(e)) return [];
      const rad = c.t === 'radius' ? v : v / 2;
      return [e.t === 'circle' ? { id, type: 'circle_radius', c_id: E(e.id), radius: rad } : { id, type: 'arc_radius', a_id: E(e.id), radius: rad }];
    }
  }
}

function signedLineAngle(sk: Sketch, l1: SkEnt & { t: 'line' }, l2: SkEnt & { t: 'line' }): number {
  const a1 = ptOf(sk, l1.a)!,
    b1 = ptOf(sk, l1.b)!,
    a2 = ptOf(sk, l2.a)!,
    b2 = ptOf(sk, l2.b)!;
  let d = Math.atan2(b2.y - a2.y, b2.x - a2.x) - Math.atan2(b1.y - a1.y, b1.x - a1.x);
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/**
 * Skizze lösen. Bei Erfolg werden Punkte, Radien und Bogenwinkel übernommen; sonst bleibt die Skizze, wie sie ist.
 * drag: Punkt, der beim Ziehen an der Mausposition festgehalten wird.
 */
export function solveSketch(sk: Sketch, opt: { drag?: { pt: number; x: number; y: number } } = {}): SolveResult {
  if (!mod) throw new Error('Löser nicht geladen (loadSolver)');
  const g = new GcsWrapper(new mod.GcsSystem());
  g.debug_mode = 0;
  try {
    g.push_primitives_and_params(toPrimitives(sk, opt.drag) as never);
    let status = g.solve();
    if (status !== SolveStatus.Success) status = g.solve(1 as never); // zweiter Versuch mit Levenberg-Marquardt
    const conflicting = [...new Set(g.get_gcs_conflicting_constraints().map(idOf))];
    const redundant = [...new Set(g.get_gcs_redundant_constraints().map(idOf))];
    const dof = g.gcs.dof();
    const ok = (status === SolveStatus.Success || status === SolveStatus.Converged) && !conflicting.length;
    if (ok) {
      g.apply_solution();
      const prims = g.sketch_index.get_primitives() as unknown as Prim[];
      const byId = new Map(prims.map((p) => [p.id, p]));
      for (const p of sk.pts) {
        const q = byId.get(P(p.id));
        if (q) {
          p.x = q.x as number;
          p.y = q.y as number;
        }
      }
      for (const e of sk.ents) {
        const q = byId.get(E(e.id));
        if (!q || e.t === 'line') continue;
        e.r = Math.abs(q.radius as number);
        if (e.t === 'arc') {
          let a0 = q.start_angle as number,
            a1 = q.end_angle as number;
          while (a1 <= a0) a1 += 2 * Math.PI;
          while (a1 - a0 > 2 * Math.PI) a1 -= 2 * Math.PI;
          e.a0 = a0;
          e.a1 = a1;
        }
      }
      // feste Punkte merken sich ihre Lage
      for (const c of sk.cons) if (c.t === 'fixed') {
        const p = ptOf(sk, c.r[0]);
        if (p) {
          c.x = p.x;
          c.y = p.y;
        }
      }
    }
    return { ok, dof, conflicting, redundant };
  } finally {
    g.destroy_gcs_module();
  }
}
