// Local contour offsets with explicit subpath ownership. No layer or machine settings.
import ClipperLib from 'clipper-lib';
import { flattenSub, SCALE } from './clip';
import { apply, inv, Mat, Pt, Shape, SubPath, GenShape } from './model';
import { shapeSubs } from './geom';
import type { Generator } from './generators/types';
import { t } from './i18n';
import { networkOffsetContours, mergedRanges } from './contourOffsetNetwork';
import { networkOffsetResults } from './contourOffsetNetworkResult';
import { segments } from './curves';
import { normalizeOffsetExclusions } from './contourOffsetExclusions';

export const LEGACY_CONTOUR_OFFSET_ID = 'local-contour-offset-v1';
export const CONTOUR_OFFSET_ID = 'local-contour-offset-v2';
export const isContourOffsetGenerator = (id: string) => id === CONTOUR_OFFSET_ID || id === LEGACY_CONTOUR_OFFSET_ID;
export interface OffsetRange { u0: number; u1: number }
export interface ContourOffsetEdit { sub: number; token: string; parts: number; distance: number; tolerance: number; anchor: Pt; spans?: OffsetRange[]; outputOwner?: number }
export interface TrimmedOffsetSpan extends OffsetRange { sub: number }
export interface OffsetRemainder extends TrimmedOffsetSpan { key: string; owner: number; path: SubPath; protected: boolean }
export interface ContourOffsetRecipe { version: 1 | 2; source: Shape; base: SubPath[]; edits: ContourOffsetEdit[]; result: SubPath[]; trimmed?: TrimmedOffsetSpan[]; excluded?: TrimmedOffsetSpan[] }
export interface OffsetSource { id: number; m: Mat; source: Shape; base: SubPath[]; edits: ContourOffsetEdit[]; version?: number; root?: number; trimmed?: TrimmedOffsetSpan[]; excluded?: TrimmedOffsetSpan[] }
export interface Member { owner: number; sub: number; reversed: boolean; from: number; to: number; ranges?: OffsetRange[] }
export interface OffsetContour { key: string; points: Pt[]; members: Member[]; distance: number; edges?: number[]; blocked?: string; blockedReason?: string; legacy?: boolean }
export interface OffsetContours { contours: OffsetContour[]; unused: number; network?: boolean }
const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const area = (p: Pt[]) => p.reduce((a, v, i) => a + cross(v, p[(i + 1) % p.length]), 0) / 2;
const invalid = () => new Error(t('Ungültiges Konturversatz-Rezept.'));
const stale = () => new Error(t('Konturzugehörigkeit geändert oder unvollständig. Alle beteiligten Quellobjekte gemeinsam auswählen.'));
const budget = () => new Error(t('Arbeitsgrenze des Konturversatzes erreicht.'));
const path = (points: Pt[]): SubPath => ({ closed: true, nodes: points.map(p => ({ ...p })) });

function validateSubs(subs: SubPath[], allowEmpty = false): void {
  if (!Array.isArray(subs) || (!allowEmpty && !subs.length) || subs.length > 2048) throw invalid();
  let count = 0;
  for (const s of subs) {
    if (typeof s?.closed !== 'boolean' || !Array.isArray(s.nodes) || s.nodes.length < 2) throw invalid();
    for (const n of s.nodes) {
      if (++count > 30000) throw budget();
      for (const p of [n, n.cin, n.cout]) if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6)) throw invalid();
    }
  }
}

export function readContourOffset(shape: Shape): ContourOffsetRecipe | null {
  if (shape.kind !== 'gen' || !isContourOffsetGenerator(shape.gen)) return null;
  const expected = shape.gen === LEGACY_CONTOUR_OFFSET_ID ? 1 : 2;
  if (shape.v !== expected || typeof shape.params?.recipe !== 'string' || shape.params.recipe.length > 12000000) throw invalid();
  const r = JSON.parse(shape.params.recipe) as ContourOffsetRecipe;
  if (r?.version !== expected || !r.source || !['path', 'rect', 'ellipse', 'polygon', 'gen'].includes(r.source.kind) ||
    (r.source.kind === 'gen' && isContourOffsetGenerator(r.source.gen)) || !Array.isArray(r.edits) || r.edits.length > 2048) throw invalid();
  validateSubs(r.base); validateSubs(r.result, r.version === 2);
  if (r.excluded !== undefined) {
    if (r.version !== 2) throw invalid();
    normalizeOffsetExclusions(r.base, r.excluded);
  }
  if (r.trimmed !== undefined && (r.version !== 2 || !Array.isArray(r.trimmed) || r.trimmed.length > 20000 || r.trimmed.some(span =>
    !Number.isInteger(span.sub) || span.sub < 0 || span.sub >= r.base.length || !Number.isFinite(span.u0) || !Number.isFinite(span.u1) ||
    span.u0 < 0 || span.u1 <= span.u0 || span.u1 > segments(r.base[span.sub]).length + 1e-7))) throw invalid();
  if (r.version === 1 && r.result.length !== r.base.length) throw invalid();
  const seen = new Set<string>();
  for (const e of r.edits) {
    const identity = r.version === 1 ? String(e.sub) : `${e.sub}:${e.token}`;
    if (!Number.isInteger(e.sub) || e.sub < 0 || e.sub >= r.base.length || seen.has(identity) ||
      typeof e.token !== 'string' || !e.token.length || e.token.length > 65536 ||
      !Number.isInteger(e.parts) || e.parts < 1 || e.parts > 2048 ||
      !Number.isFinite(e.distance) || Math.abs(e.distance) > 20 || Math.abs(e.distance) < 0.001 ||
      !Number.isFinite(e.tolerance) || e.tolerance < 0 || e.tolerance > 0.5 ||
      !e.anchor || !Number.isFinite(e.anchor.x) || !Number.isFinite(e.anchor.y) ||
      (e.outputOwner !== undefined && (r.version !== 2 || !Number.isSafeInteger(e.outputOwner) || e.outputOwner <= 0))) throw invalid();
    if (r.version === 2) {
      const period = segments(r.base[e.sub]).length;
      if (!Array.isArray(e.spans) || !e.spans.length || e.spans.length > 20000 || e.spans.some(s =>
        !Number.isFinite(s.u0) || !Number.isFinite(s.u1) || s.u0 < 0 || s.u1 > period + 1e-7 || s.u1 <= s.u0)) throw invalid();
    }
    seen.add(identity);
  }
  if (!r.result.length && (!r.edits.length || r.edits.some(e => e.outputOwner === undefined))) throw invalid();
  return r;
}

export function offsetSource(id: number, shape: Shape, m: Mat): OffsetSource {
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (!m.every(Number.isFinite) || Math.abs(determinant) < 1e-10) throw invalid();
  const r = readContourOffset(shape), source = r?.source ?? shape;
  if (!['path', 'rect', 'ellipse', 'polygon', 'gen'].includes(source.kind) ||
    (source.kind === 'path' && source.mark) || (source.kind === 'gen' && (source.asm || source.bind)))
    throw new Error(t('Konturversatz: nur unabhängige Vektorformen ohne Baugruppen- oder Generatorbindungen auswählen.'));
  const base = structuredClone(r?.base ?? shapeSubs(source)); validateSubs(base);
  return { id, m: [...m], source: structuredClone(source), base, edits: structuredClone(r?.edits ?? []), version: r?.version ?? 0, trimmed: structuredClone(r?.trimmed ?? []), excluded: structuredClone(r?.excluded ?? []) };
}

export const offsetRemainderKey = (id: number, span: TrimmedOffsetSpan) => `${id}:${span.sub}:${span.u0.toFixed(10)}:${span.u1.toFixed(10)}`;

/** Closed output assembled from formerly open spans newly participates in normal layer Kerf. */
export function offsetClosureOwners(plan: OffsetContours, sources: OffsetSource[], amounts: ReadonlyMap<string, number>, assemblyOwners?: ReadonlyMap<string, number>): number[] {
  const chosen = offsetAssemblyOwners(sources, plan, assemblyOwners);
  return [...new Set(plan.contours.filter(c => amounts.get(c.key) && c.members.length &&
    (chosen.has(c.key) || c.members.every(m => m.owner === c.members[0].owner)) &&
    (chosen.has(c.key) || c.members.some(m => !sources[m.owner].base[m.sub].closed)))
    .map(c => chosen.has(c.key) ? sources.findIndex(s => s.id === chosen.get(c.key)) : c.members[0].owner))];
}

/** Undefined restores the distributed recipe choice; an explicit empty map disables assembly. */
export function offsetAssemblyOwners(sources: OffsetSource[], plan: OffsetContours, requested?: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const result = requested === undefined ? new Map<string, number>() : new Map(requested);
  if (requested === undefined) for (const c of plan.contours) {
    const edits = sources.flatMap(s => s.edits.filter(e => e.token === c.key));
    const selected = edits.find(e => e.outputOwner !== undefined);
    if (selected) {
      if (edits.some(e => e.outputOwner !== selected.outputOwner)) throw stale();
      result.set(c.key, selected.outputOwner!);
    }
  }
  for (const [key, id] of result) {
    const c = plan.contours.find(c => c.key === key);
    if (!Number.isSafeInteger(id) || id <= 0 || !c || !c.members.some(m => sources[m.owner].id === id)) throw stale();
  }
  return result;
}

/** Only unambiguous endpoint chains are joined. Crossings never acquire a guessed owner. */
export function legacyOffsetContours(sources: OffsetSource[], tolerance: number): OffsetContours {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) throw invalid();
  const pieces = sources.flatMap((s, owner) => s.base.map((sp, index) => ({ owner, sub: index, closed: sp.closed,
    points: flattenSub(sp, s.m).map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })) })));
  if (pieces.some(p => p.points.some(q => !Number.isFinite(q.x) || !Number.isFinite(q.y) || Math.abs(q.x) > 1e6 || Math.abs(q.y) > 1e6))) throw invalid();
  if (pieces.length > 2048 || pieces.reduce((n, p) => n + p.points.length, 0) > 20000) throw budget();
  const contours: OffsetContour[] = [], used = new Set<number>();
  let unused = 0;
  const add = (chain: { index: number; reversed: boolean }[]) => {
    const points: Pt[] = [], members: Member[] = [];
    for (const item of chain) {
      const p = pieces[item.index], list = structuredClone(p.points);
      if (item.reversed) list.reverse();
      if (points.length) {
        const a = points[points.length - 1], b = list[0];
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        points[points.length - 1] = midpoint; list[0] = midpoint;
      }
      const from = Math.max(0, points.length - 1);
      if (points.length) points.push(...list.slice(1)); else points.push(...list);
      members.push({ owner: p.owner, sub: p.sub, reversed: item.reversed, from, to: points.length - 1 });
    }
    if (!pieces[chain[0].index].closed) {
      const a = points[0], b = points.pop()!;
      points[0] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else members[0].to = points.length;
    if (points.length < 3 || Math.abs(area(points)) < 1e-6) { unused += chain.length; return; }
    const edits = members.map(m => sources[m.owner].edits.find(e => e.sub === m.sub));
    let distance = 0;
    if (edits.some(Boolean)) {
      const first = edits.find(Boolean)!;
      const anchors = edits.map((e, i) => e ? apply(sources[members[i].owner].m, e.anchor.x, e.anchor.y) : null);
      if (edits.some(e => !e || e.token !== first.token || e.parts !== members.length || e.distance !== first.distance) ||
        anchors.some(p => !p || Math.hypot(p.x - anchors[0]!.x, p.y - anchors[0]!.y) > 0.002)) throw stale();
      distance = first.distance;
    }
    const key = members.map(m => `${sources[m.owner].id}:${m.sub}`).sort().join('|');
    contours.push({ key, points, members, distance });
  };
  pieces.forEach((p, i) => {
    if (p.points.length < 2) { used.add(i); unused++; return; }
    if (p.closed) { used.add(i); add([{ index: i, reversed: false }]); }
  });
  const ends = pieces.flatMap((p, i) => used.has(i) ? [] : [{ index: i, end: 0, p: p.points[0] }, { index: i, end: 1, p: p.points[p.points.length - 1] }]);
  const links = new Map<number, number>(), candidates = ends.map(() => [] as number[]);
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (distance(ends[i].p, ends[j].p) <= tolerance + 1e-9) {
      if (candidates[i].length < 2) candidates[i].push(j);
      if (candidates[j].length < 2) candidates[j].push(i);
    }
  }
  candidates.forEach((c, i) => { if (c.length === 1 && candidates[c[0]].length === 1) links.set(i, c[0]); });
  const endpoint = new Map<string, number>(); ends.forEach((e, i) => endpoint.set(`${e.index}:${e.end}`, i));
  for (const end of ends) {
    if (used.has(end.index)) continue;
    const chain: { index: number; reversed: boolean }[] = [];
    let index = end.index, enter = 0, closed = false;
    for (;;) {
      if (used.has(index)) break;
      used.add(index); chain.push({ index, reversed: enter === 1 });
      const link = links.get(endpoint.get(`${index}:${1 - enter}`)!);
      if (link === undefined) break;
      const next = ends[link];
      if (next.index === end.index && next.end === 0) { closed = true; break; }
      index = next.index; enter = next.end;
    }
    if (closed) add(chain); else unused += chain.length;
  }
  const resolved = new Set(contours.flatMap(c => c.members.map(m => `${m.owner}:${m.sub}`)));
  sources.forEach((s, owner) => s.edits.forEach(e => { if (!resolved.has(`${owner}:${e.sub}`)) throw stale(); }));
  return { contours, unused };
}

/** Same face detection as the exterior tool. V1 edits are adopted only when
 * ownership matches; otherwise their original contour remains explicitly available. */
export function offsetContours(sources: OffsetSource[], tolerance: number): OffsetContours {
  const plan = networkOffsetContours(sources, tolerance), consumed = new Set<ContourOffsetEdit>();
  for (const c of plan.contours) {
    if (c.blocked) continue;
    const groups = new Map<string, { owner: number; sub: number; ranges: OffsetRange[] }>();
    for (const m of c.members) {
      const key = `${m.owner}:${m.sub}`, old = groups.get(key);
      groups.set(key, { owner: m.owner, sub: m.sub, ranges: [...(old?.ranges ?? []), ...m.ranges!] });
    }
    const matches = [...groups.values()].map(g => {
      const rs = mergedRanges(g.ranges), s = sources[g.owner], period = segments(s.base[g.sub]).length;
      return { source: s, edit: s.edits.find(e => e.sub === g.sub && (e.spans ?
        JSON.stringify(mergedRanges(e.spans).map(r => [Number(r.u0.toFixed(7)), Number(r.u1.toFixed(7))])) === JSON.stringify(rs.map(r => [Number(r.u0.toFixed(7)), Number(r.u1.toFixed(7))])) :
        rs.length === 1 && Math.abs(rs[0].u0) < 1e-7 && Math.abs(rs[0].u1 - period) < 1e-7)) };
    });
    if (!matches.some(m => m.edit)) continue;
    if (matches.some(m => !m.edit)) continue; // Legacy fallback below, never guess missing participants.
    const first = matches[0].edit!, anchors = matches.map(m => apply(m.source.m, m.edit!.anchor.x, m.edit!.anchor.y));
    if (matches.some(m => m.edit!.token !== first.token || m.edit!.parts !== groups.size || m.edit!.distance !== first.distance || m.edit!.outputOwner !== first.outputOwner) ||
      (first.outputOwner !== undefined && ![...groups.values()].some(g => sources[g.owner].id === first.outputOwner)) ||
      anchors.some(p => distance(p, anchors[0]) > 0.002)) throw stale();
    c.distance = first.distance; matches.forEach(m => consumed.add(m.edit!));
  }
  if (sources.some(s => s.version === 1 && s.edits.some(e => !consumed.has(e)))) {
    const legacy = legacyOffsetContours(sources.map(s => ({ ...s, edits: s.version === 1 ? s.edits : [] })), tolerance);
    for (const c of legacy.contours.filter(c => c.distance)) {
      const entries = c.members.map(m => sources[m.owner].edits.find(e => e.sub === m.sub));
      if (!entries.some(e => e && !consumed.has(e))) continue;
      c.legacy = true;
      c.members.forEach(m => { const n = segments(sources[m.owner].base[m.sub]).length;
        m.ranges = [{ u0: m.reversed ? n : 0, u1: m.reversed ? 0 : n }]; m.reversed = false; });
      plan.contours.push(c); entries.forEach(e => { if (e) consumed.add(e); });
    }
  }
  sources.forEach(s => s.edits.forEach(e => { if (!consumed.has(e)) throw stale(); }));
  return { ...plan, network: true };
}

let checks = 0;
function intersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  if (++checks > 4000000) throw budget();
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - 1e-8 || Math.max(c.x, d.x) < Math.min(a.x, b.x) - 1e-8 ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) - 1e-8 || Math.max(c.y, d.y) < Math.min(a.y, b.y) - 1e-8) return false;
  const u = sub(b, a), v = sub(d, c), q = sub(c, a), den = cross(u, v);
  if (Math.abs(den) < 1e-10) return Math.abs(cross(q, u)) < 1e-8;
  const t = cross(q, v) / den, s = cross(q, u) / den;
  return t >= -1e-8 && t <= 1 + 1e-8 && s >= -1e-8 && s <= 1 + 1e-8;
}
function simple(points: Pt[]): void {
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    if (intersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length]))
      throw new Error(t('Konturversatz würde eine mehrdeutige, sich berührende oder überschneidende Kontur erzeugen.'));
  }
}
function shifted(points: Pt[], amount: number): Pt[] {
  simple(points);
  const sign = Math.sign(area(points));
  const tangents = points.map((p, i) => {
    const v = sub(points[(i + 1) % points.length], p), len = Math.hypot(v.x, v.y);
    if (len < 1e-6) throw invalid();
    return { x: v.x / len, y: v.y / len };
  });
  const result = points.map((p, i) => {
    const a = tangents[(i + points.length - 1) % points.length], b = tangents[i];
    const q = { x: p.x + sign * a.y * amount, y: p.y - sign * a.x * amount };
    const r = { x: p.x + sign * b.y * amount, y: p.y - sign * b.x * amount }, den = cross(a, b);
    let out: Pt;
    if (Math.abs(den) < 1e-9) {
      if (a.x * b.x + a.y * b.y < 0) throw invalid();
      out = { x: (q.x + r.x) / 2, y: (q.y + r.y) / 2 };
    } else {
      const t = cross(sub(r, q), b) / den; out = { x: q.x + t * a.x, y: q.y + t * a.y };
    }
    if (distance(out, p) > Math.abs(amount) * 10 + 0.002) throw new Error(t('Konturversatz: zu spitze Ecke. Kleineren Versatz wählen.'));
    return out;
  });
  if (Math.sign(area(result)) !== sign || Math.abs(area(result)) < 1e-6 || result.some((p, i) => {
    const edge = sub(result[(i + 1) % result.length], p), t = tangents[i]; return edge.x * t.x + edge.y * t.y <= 1e-7;
  })) throw new Error(t('Konturversatz lässt eine Kontur kollabieren.'));
  simple(result); return result;
}

/** A whole subpath has one owner, so Clipper may safely remove collapsed local
 * curve segments without losing provenance. Split-owner chains keep the stricter
 * one-edge-to-one-owner construction above. */
function shiftedWhole(points: Pt[], amount: number): Pt[] {
  simple(points);
  const input = points.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
  if (!ClipperLib.Clipper.Orientation(input)) input.reverse();
  const co = new ClipperLib.ClipperOffset(2, 1), out: ClipperLib.Paths = [];
  co.AddPath(input, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  co.Execute(out, amount * SCALE);
  if (out.length !== 1 || out[0].length < 3 || Math.abs(ClipperLib.Clipper.Area(out[0])) < 1)
    throw new Error(t('Konturversatz lässt eine Kontur kollabieren.'));
  const result = out[0].map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
  if (result.length > 20000) throw budget();
  if (Math.sign(area(result)) !== Math.sign(area(points))) result.reverse();
  let start = 0;
  result.forEach((p, i) => { if (distance(p, points[0]) < distance(result[start], points[0])) start = i; });
  const ordered = result.slice(start).concat(result.slice(0, start));
  simple(ordered); return ordered;
}

/** Build every replacement first. Caller mutates original leaf objects only after success. */
export function offsetResults(sources: OffsetSource[], plan: OffsetContours, amounts: ReadonlyMap<string, number>, tolerance: number,
  removeRemainders: ReadonlySet<string> = new Set(), exclusions?: ReadonlyMap<number, readonly TrimmedOffsetSpan[]>, assemblyOwners?: ReadonlyMap<string, number>): { recipes: (ContourOffsetRecipe | null)[]; preview: SubPath[]; remainders: OffsetRemainder[] } {
  checks = 0;
  const excluded = new Map(sources.map(s => [s.id, normalizeOffsetExclusions(s.base, exclusions === undefined ? s.excluded ?? [] : exclusions.get(s.id) ?? [])]));
  if (exclusions && [...exclusions.keys()].some(id => !sources.some(s => s.id === id))) throw invalid();
  if (plan.network) {
    const result = networkOffsetResults(sources, plan, amounts, tolerance, shiftedWhole, removeRemainders, excluded, offsetAssemblyOwners(sources, plan, assemblyOwners));
    result.recipes.forEach(r => { if (r) validateSubs(r.result, true); }); return result;
  }
  if (removeRemainders.size) throw invalid();
  if (offsetAssemblyOwners(sources, plan, assemblyOwners).size) throw invalid();
  if ([...excluded.values()].some(spans => spans.length)) throw invalid();
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5 || [...amounts.keys()].some(key => !plan.contours.some(c => c.key === key))) throw invalid();
  const results = sources.map(s => structuredClone(s.base)), edits = sources.map(() => [] as ContourOffsetEdit[]);
  const rings = plan.contours.map(c => {
    const amount = amounts.get(c.key) ?? 0;
    if (!Number.isFinite(amount) || Math.abs(amount) > 20 || (amount !== 0 && Math.abs(amount) < 0.001)) throw invalid();
    return amount ? (c.members.length === 1 ? shiftedWhole(c.points, amount) : shifted(c.points, amount)) : c.points;
  });
  const contains = (p: Pt[], q: Pt) => ClipperLib.Clipper.PointInPolygon({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }, p.map(v => ({ X: Math.round(v.x * SCALE), Y: Math.round(v.y * SCALE) }))) === 1;
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    if (!(amounts.get(plan.contours[i].key) || amounts.get(plan.contours[j].key))) continue;
    const a = rings[i], b = rings[j];
    for (let x = 0; x < a.length; x++) for (let y = 0; y < b.length; y++) {
      if (intersect(a[x], a[(x + 1) % a.length], b[y], b[(y + 1) % b.length]))
        throw new Error(t('Konturversatz berührt oder überschneidet eine andere Kontur.'));
    }
    if (contains(a, b[0]) !== contains(plan.contours[i].points, plan.contours[j].points[0]) ||
      contains(b, a[0]) !== contains(plan.contours[j].points, plan.contours[i].points[0]))
      throw new Error(t('Konturversatz würde die Verschachtelung der Konturen ändern.'));
  }
  plan.contours.forEach((c, i) => {
    const amount = amounts.get(c.key) ?? 0;
    if (!amount) return;
    const ring = rings[i], anchor = c.points[0];
    for (const member of c.members) {
      const s = sources[member.owner], inverse = inv(s.m);
      const points: Pt[] = [];
      if (c.members.length === 1) points.push(...ring, ring[0]);
      else for (let k = member.from; k <= member.to; k++) points.push(ring[k % ring.length]);
      if (member.reversed) points.reverse();
      const original = s.base[member.sub];
      if (original.closed) points.pop();
      results[member.owner][member.sub] = { ...original, nodes: points.map(p => apply(inverse, p.x, p.y)) };
      edits[member.owner].push({ sub: member.sub, token: c.key, parts: c.members.length, distance: amount, tolerance, anchor: apply(inverse, anchor.x, anchor.y) });
    }
  });
  results.forEach(subs => validateSubs(subs));
  return { recipes: sources.map((s, i) => edits[i].length ? { version: 1, source: structuredClone(s.source), base: structuredClone(s.base), edits: edits[i], result: results[i] } : null),
    preview: rings.flatMap((p, i) => amounts.get(plan.contours[i].key) ? [path(p)] : []), remainders: [] };
}

export function contourOffsetShape(recipe: ContourOffsetRecipe): GenShape {
  const shape: GenShape = { kind: 'gen', gen: recipe.version === 1 ? LEGACY_CONTOUR_OFFSET_ID : CONTOUR_OFFSET_ID, v: recipe.version, params: { recipe: JSON.stringify(recipe) }, subs: structuredClone(recipe.result) };
  readContourOffset(shape); return shape;
}

export const CONTOUR_OFFSET: Generator = {
  id: CONTOUR_OFFSET_ID, version: 2, kind: 'part', name: t('Lokaler Konturversatz'), icon: 'offset',
  schema: [{ key: 'recipe', type: 'data', label: t('Konturversatz-Rezept'), def: '' }],
  validate(p) { try { const version = JSON.parse(String(p.recipe)).version; readContourOffset({ kind: 'gen', gen: version === 1 ? LEGACY_CONTOUR_OFFSET_ID : CONTOUR_OFFSET_ID, v: version, params: p, subs: [] }); return []; }
    catch (error) { return [{ level: 'error', msg: error instanceof Error ? error.message : String(error) }]; } },
  generate(p) { const version = JSON.parse(String(p.recipe)).version; const r = readContourOffset({ kind: 'gen', gen: version === 1 ? LEGACY_CONTOUR_OFFSET_ID : CONTOUR_OFFSET_ID, v: version, params: p, subs: [] })!;
    return { parts: [{ key: 'main', at: { x: 0, y: 0 }, subs: r.result }], info: [] }; },
  label: () => t('Lokaler Konturversatz'),
};
