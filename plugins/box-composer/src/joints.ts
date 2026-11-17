// Wood joints of the box composer, all through the app's host function joints (#398): no joint geometry of its own.
// A wall panel is drawn in its own plane: x along the wall, y down from the top edge (0) to the floor side (h).
import { host, type JointOptions, type SubPath } from '../../sdk/ts';

export interface Pt {
  x: number;
  y: number;
}
export type Parts = Record<string, SubPath[]>;
/** A joint that does not fit: a joint-… code with values, passed on as an issue */
export class JointError extends Error {
  constructor(public code: string, public values?: Record<string, number | string>) {
    super(code);
  }
}

const EPS = 1e-6;
const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;

/**
 * Closed panel outline w × h with extra corner-free nodes on the top and bottom edges (x positions), so that each
 * stretch between them is a segment of its own that a joint can be put on. Order: top left → right, right edge down,
 * bottom right → left, left edge up.
 */
export function panel(w: number, h: number, splits: { top?: number[]; bottom?: number[] } = {}): SubPath {
  const inner = (xs: number[] | undefined) => [...new Set((xs ?? []).filter((x) => x > EPS && x < w - EPS))].sort((a, b) => a - b);
  const top = inner(splits.top),
    bottom = inner(splits.bottom).reverse();
  return {
    closed: true,
    nodes: [{ x: 0, y: 0 }, ...top.map((x) => ({ x, y: 0 })), { x: w, y: 0 }, { x: w, y: h }, ...bottom.map((x) => ({ x, y: h })), { x: 0, y: h }],
  };
}

/** Index of the segment from a to b (either way round) in sub-path sub of subs, or -1 */
export function segOf(subs: SubPath[], a: Pt, b: Pt, sub = 0): number {
  const ns = subs[sub]?.nodes ?? [];
  for (let i = 0; i < ns.length; i++) {
    const p = ns[i],
      q = ns[(i + 1) % ns.length];
    if ((same(p, a) && same(q, b)) || (same(p, b) && same(q, a))) return i;
  }
  return -1;
}

/** An edge for a joint: part key and the segment between two corner points of its first sub-path */
export interface Pick {
  part: string;
  a: Pt;
  b: Pt;
}

/** Put a joint on one or two edges; returns the changed parts and the info codes, throws JointError when it does not fit */
export function joint(parts: Parts, options: JointOptions, picks: Pick[]): { parts: Parts; info: { code: string; values?: Record<string, number | string> }[] } {
  const own: Parts = {};
  const edges = picks.map((p) => {
    own[p.part] = parts[p.part];
    const seg = segOf(parts[p.part], p.a, p.b);
    if (seg < 0) throw new JointError('composer-edge-lost');
    return { part: p.part, seg };
  });
  const r = host.joints({ op: 'edge', options: { ...options, kerf: 0 }, parts: own, edges });
  if (r.error) throw new JointError(r.error.code, r.error.values);
  return { parts: { ...parts, ...r.parts }, info: r.info };
}

/**
 * Tenons on an edge of one part and the matching slots in another part along a guide line (from → to in the other
 * part's coordinates, as long as the edge): T joints and floor teeth. The slots are added to the other part's holes.
 */
export function tenonsInto(parts: Parts, options: JointOptions, edge: Pick, into: string, from: Pt, to: Pt): Parts {
  const GUIDE = '_guide';
  const r = joint({ ...parts, [GUIDE]: [{ closed: false, nodes: [from, to] }] }, { ...options, kind: 'tenon' }, [edge, { part: GUIDE, a: from, b: to }]);
  const out = { ...r.parts };
  out[into] = [...parts[into], ...(out[GUIDE] ?? [])];
  delete out[GUIDE];
  return out;
}

/** Widen every part by half the kerf: outline outwards, holes inwards, sharp corners (joints are computed with kerf 0) */
export function widen(subs: SubPath[], kerf: number): SubPath[] {
  return kerf > 0 ? host.offset({ subs, delta: kerf / 2, join: 'miter' }) : subs;
}
