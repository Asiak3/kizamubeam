import { apply, inv, type Pt, type SubPath } from './model';
import { assembleExcludedOffset, exclusionBoundary, exclusionRuns, flattenExcludedOffset, type ExclusionRun } from './contourOffsetExclusions';
import { segments } from './curves';
import { extract } from './pathtools';
import { regionContains } from './shapeRegions';
import { mergedRanges } from './contourOffsetNetwork';
import { offsetRemainderKey, type OffsetRemainder, type TrimmedOffsetSpan, type ContourOffsetEdit, type ContourOffsetRecipe, type Member, type OffsetContours, type OffsetRange, type OffsetSource } from './contourOffset';
import { t } from './i18n';

const delta = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const ownerError = () => new Error(t('Versatz kann die Quellzuordnung dieser Teilkontur nicht erhalten. Kleineren Versatz wählen.'));
const sharedError = () => new Error(t('Diese Kontur teilt eine Kante mit einer anderen Kontur. Der Versatz würde deren Grenze mit verändern.'));
const polygon = (points: Pt[]): SubPath => ({ closed: true, nodes: points.map(p => ({ ...p })) });
const area = (p: Pt[]) => p.reduce((a, v, i) => a + cross(v, p[(i + 1) % p.length]), 0) / 2;

function seam(points: Pt[], index: number, amount: number): Pt {
  const p = points[index % points.length], before = points[(index + points.length - 1) % points.length], after = points[(index + 1) % points.length];
  const a = delta(p, before), b = delta(after, p), la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
  if (la < 1e-8 || lb < 1e-8) throw ownerError();
  a.x /= la; a.y /= la; b.x /= lb; b.y /= lb;
  const sign = Math.sign(area(points)), q = { x: p.x + a.y * sign * amount, y: p.y - a.x * sign * amount },
    r = { x: p.x + b.y * sign * amount, y: p.y - b.x * sign * amount }, den = cross(a, b);
  if (Math.abs(den) < 1e-9) {
    if (a.x * b.x + a.y * b.y < 0) throw ownerError();
    return q;
  }
  const along = cross(delta(r, q), b) / den;
  return { x: q.x + along * a.x, y: q.y + along * a.y };
}

function insertSeam(ring: Pt[], p: Pt): Pt {
  const exact = ring.filter(q => dist(p, q) <= 0.002);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw Object.assign(ownerError(), { cause: { reason: 'multiple-seam-vertices', point: p, matches: exact.length } });
  const hits: { index: number; point: Pt }[] = [];
  ring.forEach((a, index) => {
    const b = ring[(index + 1) % ring.length], d = delta(b, a), n = d.x * d.x + d.y * d.y;
    if (!n) return;
    const u = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / n;
    const q = { x: a.x + u * d.x, y: a.y + u * d.y };
    if (u > 0 && u < 1 && dist(p, q) <= 0.002) hits.push({ index, point: q });
  });
  if (hits.length !== 1) throw Object.assign(ownerError(), { cause: { reason: 'seam-not-on-ring', point: p, hits: hits.length, nearest: Math.min(...ring.map(q => dist(p,q))) } });
  ring.splice(hits[0].index + 1, 0, hits[0].point); return hits[0].point;
}

function portions(points: Pt[], ring: Pt[], members: Member[], amount: number): Pt[][] {
  if (members.length === 1) return [[...ring, ring[0]]];
  const seams = members.map(m => insertSeam(ring, seam(points, m.from, amount)));
  const first = ring.indexOf(seams[0]), ordered = ring.slice(first).concat(ring.slice(0, first));
  const indices = seams.map(p => ordered.indexOf(p));
  if (indices.some((n, i) => i > 0 && n <= indices[i - 1])) throw Object.assign(ownerError(), { cause: { reason: 'seam-order', indices } });
  return members.map((_m, i) => {
    const end = i + 1 === members.length ? ordered.length : indices[i + 1];
    const result = ordered.slice(indices[i], end);
    result.push(ordered[end % ordered.length]); return result;
  });
}

/** First transverse crossing on a bounded exact-source normal. Clipper can
 * legitimately remove a short offset edge at a tight curve; looking for that
 * edge's infinite-line miter then has no solution. The connector instead stops
 * at the first boundary, never jumps across a nearer boundary or guesses an
 * owner. Mixed-owner use requires an explicitly approved output owner. */
function insertExclusionSeam(ring: Pt[], boundary: { point: Pt; tangent: Pt }, sign: number, amount: number, cornerDirection?: Pt): Pt {
  const { point: p, tangent } = boundary, direction = cornerDirection ?? { x: tangent.y * sign * Math.sign(amount), y: -tangent.x * sign * Math.sign(amount) };
  const hits: { index: number; u: number; distance: number; point: Pt; crossing: number }[] = [];
  const limit = Math.abs(amount) * 10 + .002;
  ring.forEach((a, index) => {
    const b = ring[(index + 1) % ring.length], edge = delta(b, a), q = delta(a, p), den = cross(direction, edge);
    if (Math.abs(den) < 1e-12) {
      const from = q.x * direction.x + q.y * direction.y, to = (b.x - p.x) * direction.x + (b.y - p.y) * direction.y;
      if (Math.abs(cross(q, direction)) < 1e-10 && Math.max(from, to) > 0 && Math.min(from, to) <= limit) {
        throw Object.assign(ownerError(), { cause: { reason: 'exclusion-normal-overlaps-ring', point: p } });
      }
      return;
    }
    const distance = cross(q, edge) / den, u = cross(q, direction) / den;
    if (Math.abs(distance) <= 1e-8 && u >= -1e-9 && u <= 1 + 1e-9) {
      throw Object.assign(ownerError(), { cause: { reason: 'exclusion-origin-on-ring', point: p } });
    }
    if (distance > 1e-8 && distance <= limit && u >= -1e-9 && u <= 1 + 1e-9) {
      hits.push({ index, u, distance, point: { x: p.x + direction.x * distance, y: p.y + direction.y * distance },
        crossing: cross(edge, direction) * sign * Math.sign(amount) });
    }
  });
  hits.sort((a, b) => a.distance - b.distance);
  if (!hits.length) throw Object.assign(ownerError(), { cause: { reason: 'exclusion-normal-misses-ring', point: p, direction, tangent, cornerDirection, sign, amount, limit,
    nearest: [...ring].sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 4) } });
  const first = hits[0], coincident = hits.filter(h => Math.abs(h.distance - first.distance) < 1e-8);
  if (coincident.some(h => dist(h.point, first.point) > 1e-8 || h.crossing >= -1e-12) ||
    coincident.length > 2 || (coincident.length === 2 && !coincident.every(h => h.u < 1e-8 || h.u > 1 - 1e-8))) {
    throw Object.assign(ownerError(), { cause: { reason: 'ambiguous-exclusion-normal-crossing', point: p } });
  }
  if (first.u <= 1e-9) return ring[first.index];
  if (first.u >= 1 - 1e-9) return ring[(first.index + 1) % ring.length];
  ring.splice(first.index + 1, 0, first.point); return first.point;
}

function exclusionPortions(sources: OffsetSource[], points: Pt[], runs: ExclusionRun[], members: Member[], ring: Pt[], amount: number, approvedAssembly = false): SubPath[] {
  const sign = Math.sign(area(points)), seams = new Map<number, Pt>();
  // A source span can meet a different subpath in the middle of a Bézier at a
  // T-junction. There the connector follows the contour corner, not the tangent
  // of the source's unconsumed continuation beyond that junction.
  const junctions = new Set<string>(), key = (owner: number, sub: number, u: number) => `${owner}:${sub}:${u.toFixed(8)}`;
  members.forEach((m, i) => {
    const before = members[(i + members.length - 1) % members.length], u = m.ranges![0].u0, v = before.ranges!.at(-1)!.u1;
    if (before.owner !== m.owner || before.sub !== m.sub || Math.abs(u - v) > 1e-8) {
      junctions.add(key(m.owner, m.sub, u)); junctions.add(key(before.owner, before.sub, v));
    }
  });
  let work = 0;
  runs.forEach((run, i) => {
    const before = runs[(i + runs.length - 1) % runs.length];
    if (run.excluded === before.excluded) return;
    const preserved = run.excluded ? run : before;
    if ((work += ring.length + sources[preserved.owner].base[preserved.sub].nodes.length) > 4000000) {
      throw new Error(t('Arbeitsgrenze des Konturversatzes erreicht.'));
    }
    const u = run.excluded ? preserved.u0 : preserved.u1;
    let cornerDirection: Pt | undefined;
    if (Math.abs(u - Math.round(u)) < 1e-9 || junctions.has(key(preserved.owner, preserved.sub, u))) {
      const origin = points[run.from], shifted = seam(points, run.from, amount), d = delta(shifted, origin), length = Math.hypot(d.x, d.y);
      cornerDirection = { x: d.x / length, y: d.y / length };
    }
    if (approvedAssembly && junctions.has(key(preserved.owner, preserved.sub, u))) {
      // Quantized chords are particularly unstable at a near-cusp junction.
      // Derive the angle bisector from BOTH exact source traversal tangents,
      // not the tiny network chords adjoining the snapped junction.
      const at = members.findIndex((m, j) => {
        const before = members[(j + members.length - 1) % members.length];
        return key(m.owner, m.sub, m.ranges![0].u0) === key(preserved.owner, preserved.sub, u) ||
          key(before.owner, before.sub, before.ranges!.at(-1)!.u1) === key(preserved.owner, preserved.sub, u);
      });
      if (at >= 0) {
        const current = members[at], previous = members[(at + members.length - 1) % members.length];
        const tangent = (m: Member, end: boolean) => {
          const range = end ? m.ranges!.at(-1)! : m.ranges![0];
          return exclusionBoundary(sources[m.owner], { ...run, owner: m.owner, sub: m.sub, ...range }, end).tangent;
        };
        const a = tangent(previous, true), b = tangent(current, false), d = { x: (a.y + b.y) * sign * Math.sign(amount), y: -(a.x + b.x) * sign * Math.sign(amount) };
        const length = Math.hypot(d.x, d.y);
        if (length < 1e-10) throw ownerError();
        cornerDirection = { x: d.x / length, y: d.y / length };
      }
    }
    const boundary = exclusionBoundary(sources[preserved.owner], preserved, !run.excluded);
    let connector: Pt;
    try { connector = insertExclusionSeam(ring, boundary, sign, amount, cornerDirection); }
    catch (error) {
      // At a sharp inter-source junction the polygon miter can point along the
      // discarded corner rather than across the surviving inset. An approved
      // assembly has no ownership seam to preserve: try the exact source normal,
      // still bounded and stopping at its first transverse crossing. Never retry
      // an origin contact, overlapping ray or ambiguous crossing.
      if (!approvedAssembly || !cornerDirection || !junctions.has(key(preserved.owner, preserved.sub, u)) ||
        !(error instanceof Error) || (error.cause as { reason?: string } | undefined)?.reason !== 'exclusion-normal-misses-ring') throw error;
      try { connector = insertExclusionSeam(ring, boundary, sign, amount); }
      catch (normalError) {
        if (!(normalError instanceof Error) || (normalError.cause as { reason?: string } | undefined)?.reason !== 'exclusion-normal-misses-ring') throw normalError;
        // The entire sharp corner may have disappeared from the inset. Since
        // assembly explicitly removes inter-source seams, use a UNIQUE bounded
        // closest boundary point, not an infinite-line extrapolation or arbitrary
        // vertex. The same first-crossing/origin guards and final exact-curve
        // self-contact validation still apply to this straight connector.
        const candidates = ring.map((a, j) => {
          const b = ring[(j + 1) % ring.length], d = delta(b, a), length2 = d.x * d.x + d.y * d.y;
          const f = length2 ? Math.max(0, Math.min(1, ((boundary.point.x - a.x) * d.x + (boundary.point.y - a.y) * d.y) / length2)) : 0;
          const point = { x: a.x + f * d.x, y: a.y + f * d.y };
          return { point, distance: dist(point, boundary.point) };
        }).sort((a, b) => a.distance - b.distance);
        const nearest = candidates[0];
        if (!nearest || nearest.distance < 1e-8 || nearest.distance > Math.abs(amount) * 10 + .002 ||
          candidates.some(c => Math.abs(c.distance - nearest.distance) < 1e-8 && dist(c.point, nearest.point) > 1e-8)) throw normalError;
        const d = delta(nearest.point, boundary.point);
        connector = insertExclusionSeam(ring, boundary, sign, amount, { x: d.x / nearest.distance, y: d.y / nearest.distance });
      }
    }
    seams.set(i, connector);
  });
  const first = ring.indexOf([...seams.values()][0]), ordered = ring.slice(first).concat(ring.slice(0, first));
  const indices = [...seams.values()].map(p => ordered.indexOf(p));
  if (indices.some((n, i) => i > 0 && n <= indices[i - 1])) throw Object.assign(ownerError(), { cause: { reason: 'exclusion-seam-order', indices } });
  return runs.map((run, i) => {
    if (run.excluded) return { closed: false, nodes: [] };
    const start = ordered.indexOf(seams.get(i)!), next = ordered.indexOf(seams.get((i + 1) % runs.length)!);
    const end = next > start ? next : ordered.length + next;
    return { closed: false, nodes: Array.from({ length: end - start + 1 }, (_, k) => ordered[(start + k) % ordered.length]) };
  });
}

export function networkOffsetResults(sources: OffsetSource[], plan: OffsetContours, amounts: ReadonlyMap<string, number>, tolerance: number,
  offsetRing: (points: Pt[], amount: number) => Pt[], removeRemainders: ReadonlySet<string> = new Set(),
  exclusions: ReadonlyMap<number, readonly TrimmedOffsetSpan[]> = new Map(), assemblyOwners: ReadonlyMap<string, number> = new Map()): { recipes: (ContourOffsetRecipe | null)[]; preview: SubPath[]; remainders: OffsetRemainder[] } {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5 || [...amounts.keys()].some(key => !plan.contours.some(c => c.key === key))) throw ownerError();
  const rings = plan.contours.map(c => {
    const amount = amounts.get(c.key) ?? 0;
    if (!Number.isFinite(amount) || Math.abs(amount) > 20 || (amount !== 0 && Math.abs(amount) < 0.001)) throw ownerError();
    if (amount && c.blocked) throw new Error(c.blocked);
    if (amount && c.edges && plan.contours.some(other => other !== c && other.edges?.some(edge => c.edges!.includes(edge)))) throw sharedError();
    return amount ? offsetRing(c.points, amount) : c.points;
  });
  const excludedPaths = plan.contours.map((c, index): SubPath | null => {
    const amount = amounts.get(c.key) ?? 0;
    if (!amount) return null;
    const expanded = exclusionRuns(c, sources, exclusions, assemblyOwners.has(c.key));
    if (!expanded) return null;
    // Excluded curves can move the output origin away from the existing fixed
    // start seam. Do not silently relocate a user's fixed machine start point.
    if (c.members.some(m => sources[m.owner].base[m.sub].start)) throw ownerError();
    // A contour contained in one source already has a single output owner.
    // Its subpath junctions need the same exact-tangent connector construction
    // as an explicitly hosted assembly; no cross-object ownership is changed.
    const singleOwner = new Set(c.members.map(m => m.owner)).size === 1;
    const chunks = exclusionPortions(sources, expanded.points, expanded.runs, c.members, [...rings[index]], amount, assemblyOwners.has(c.key) || singleOwner);
    const result = assembleExcludedOffset(sources, expanded.runs, chunks);
    rings[index] = flattenExcludedOffset(result);
    return result;
  });
  let work = 0;
  const intersects = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    if (++work > 4000000) throw new Error(t('Arbeitsgrenze des Konturversatzes erreicht.'));
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - 1e-8 || Math.max(c.x, d.x) < Math.min(a.x, b.x) - 1e-8 ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) - 1e-8 || Math.max(c.y, d.y) < Math.min(a.y, b.y) - 1e-8) return false;
    const u = delta(b, a), v = delta(d, c), q = delta(c, a), den = cross(u, v);
    if (Math.abs(den) < 1e-10) return Math.abs(cross(q, u)) < 1e-8;
    const x = cross(q, v) / den, y = cross(q, u) / den;
    return x >= -1e-8 && x <= 1 + 1e-8 && y >= -1e-8 && y <= 1 + 1e-8;
  };
  const contains = (p: Pt[], q: Pt) => regionContains({ layer: 0, subs: [polygon(p)] }, q.x, q.y);
  const nearSegment = (p: Pt, a: Pt, b: Pt) => {
    const v = delta(b, a), len = v.x * v.x + v.y * v.y;
    const u = len ? Math.max(0, Math.min(1, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / len)) : 0;
    return dist(p, { x: a.x + u * v.x, y: a.y + u * v.y }) <= .00021;
  };
  const uncertainContact = (a: Pt, b: Pt, c: Pt, d: Pt) =>
    nearSegment(a, c, d) || nearSegment(b, c, d) || nearSegment(c, a, b) || nearSegment(d, a, b);
  rings.forEach((ring, index) => {
    if (!excludedPaths[index]) return;
    if (ring.length < 3 || Math.abs(area(ring)) < 1e-6 || Math.sign(area(ring)) !== Math.sign(area(plan.contours[index].points))) {
      throw Object.assign(ownerError(), { cause: { reason: 'excluded-ring-collapsed-or-reversed' } });
    }
    for (let i = 0; i < ring.length; i++) {
      if (dist(ring[i], ring[(i + 1) % ring.length]) < 1e-8) throw Object.assign(ownerError(), { cause: { reason: 'excluded-zero-length-edge', index: i } });
      const before = delta(ring[i], ring[(i + ring.length - 1) % ring.length]), after = delta(ring[(i + 1) % ring.length], ring[i]);
      if (Math.abs(cross(before, after)) < 1e-10 && before.x * after.x + before.y * after.y <= 0) {
        throw Object.assign(ownerError(), { cause: { reason: 'excluded-backtracking-edge', index: i } });
      }
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;
        if (intersects(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length]) ||
          uncertainContact(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])) {
          throw Object.assign(ownerError(), { cause: { reason: 'excluded-self-contact', segments: [i, j] } });
        }
      }
    }
  });
  const bounds = rings.map(p => ({ x0: Math.min(...p.map(q => q.x)), x1: Math.max(...p.map(q => q.x)), y0: Math.min(...p.map(q => q.y)), y1: Math.max(...p.map(q => q.y)) }));
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    if (!(amounts.get(plan.contours[i].key) || amounts.get(plan.contours[j].key))) continue;
    const a = rings[i], b = rings[j], box = bounds[i], other = bounds[j];
    // A retained legacy recipe can predate the newly detected subdivisions.
    if ((plan.contours[i].legacy || plan.contours[j].legacy) && plan.contours[i].members.some(m => plan.contours[j].members.some(n => m.owner === n.owner && m.sub === n.sub))) continue;
    if (contains(a, b[0]) !== contains(plan.contours[i].points, plan.contours[j].points[0]) ||
      contains(b, a[0]) !== contains(plan.contours[j].points, plan.contours[i].points[0])) throw Object.assign(new Error(t('Konturversatz würde die Verschachtelung der Konturen ändern.')),
        { cause: { reason: 'changed-contour-nesting', contours: [i + 1, j + 1] } });
    const margin = excludedPaths[i] || excludedPaths[j] ? .00021 : 0;
    if (box.x0 > other.x1 + margin || box.x1 < other.x0 - margin || box.y0 > other.y1 + margin || box.y1 < other.y0 - margin) continue;
    for (let x = 0; x < a.length; x++) for (let y = 0; y < b.length; y++) {
      if (intersects(a[x], a[(x + 1) % a.length], b[y], b[(y + 1) % b.length]) ||
        ((excludedPaths[i] || excludedPaths[j]) && uncertainContact(a[x], a[(x + 1) % a.length], b[y], b[(y + 1) % b.length]))) throw new Error(t('Konturversatz berührt oder überschneidet eine andere Kontur.'));
    }
  }
  type Replacement = { ranges: OffsetRange[]; output: SubPath | null; key: string };
  const replacements = sources.map(s => s.base.map(() => [] as Replacement[])), edits = sources.map(() => [] as ContourOffsetEdit[]);
  plan.contours.forEach((c, index) => {
    const amount = amounts.get(c.key) ?? 0; if (!amount) return;
    let ring = [...rings[index]];
    if (c.members.length === 1) {
      const m = c.members[0], original = sources[m.owner].base[m.sub], rs = mergedRanges(m.ranges!), period = segments(original).length;
      if (original.start && rs.length === 1 && rs[0].u0 < 1e-7 && Math.abs(rs[0].u1 - period) < 1e-7) {
        const world = apply(sources[m.owner].m, original.nodes[0].x, original.nodes[0].y);
        let index = 0; c.points.forEach((p, i) => { if (dist(p, world) < dist(c.points[index], world)) index = i; });
        const start = insertSeam(ring, seam(c.points, index, amount)), at = ring.indexOf(start);
        ring = ring.slice(at).concat(ring.slice(0, at));
      }
    }
    // A contour assembled from several subpaths of ONE leaf has no inter-object
    // ownership seam. Emit its ring once in that same leaf and remove only the
    // recorded source spans. Keep all original subpaths in the editable recipe.
    // Different leaves retain geometric seam splitting unless the user explicitly
    // chooses one contributing source as the host of a derived closed assembly.
    const outputOwner = assemblyOwners.get(c.key);
    const oneLeaf = outputOwner !== undefined || c.members.every(m => m.owner === c.members[0].owner);
    const host = outputOwner === undefined ? 0 : c.members.findIndex(m => sources[m.owner].id === outputOwner);
    if (host < 0) throw ownerError();
    const chunks = oneLeaf ? [] : portions(c.points, ring, c.members, amount);
    const owners = new Set(c.members.map(m => `${m.owner}:${m.sub}`));
    const grouped = new Map<string, { owner: number; sub: number; ranges: OffsetRange[] }>();
    c.members.forEach((m, i) => {
      const s = sources[m.owner], original = s.base[m.sub], period = segments(original).length, ranges = mergedRanges(m.ranges!);
      const whole = c.members.length === 1 && ranges.length === 1 && ranges[0].u0 < 1e-7 && Math.abs(ranges[0].u1 - period) < 1e-7;
      if (!whole && original.start && ranges.some(r => r.u0 < 1e-7)) throw new Error(t('Der feste Startpunkt dieser Teilkontur kann beim Aufteilen nicht erhalten werden. Startpunkt vor dem Versatz ausdrücklich freigeben.'));
      let output: SubPath | null;
      if (oneLeaf) {
        const inverse = inv(s.m);
        // The derived ring is closed in its chosen host. Every object and its
        // original geometry remain independent in their editable source recipes.
        output = i === host ? excludedPaths[index] ? { closed: true, nodes: excludedPaths[index]!.nodes.map(n => ({ ...n, ...apply(inverse, n.x, n.y),
          ...(n.cin ? { cin: apply(inverse, n.cin.x, n.cin.y) } : {}), ...(n.cout ? { cout: apply(inverse, n.cout.x, n.cout.y) } : {}) })) } :
          { closed: true, nodes: ring.map(p => apply(inverse, p.x, p.y)) } : null;
      } else {
        let points = chunks[i];
        if (m.ranges![0].u1 < m.ranges![0].u0) points = [...points].reverse();
        const inverse = inv(s.m);
        output = { closed: whole && original.closed, nodes: points.map(p => apply(inverse, p.x, p.y)) };
        if (output.closed) output.nodes.pop();
      }
      if (whole && original.start && output) output.start = true;
      const target = replacements[m.owner][m.sub];
      if (target.some(r => r.ranges.some(a => ranges.some(b => Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0) > 1e-7)))) throw sharedError();
      target.push({ ranges, output, key: c.key });
      const key = `${m.owner}:${m.sub}`, old = grouped.get(key);
      grouped.set(key, { owner: m.owner, sub: m.sub, ranges: [...(old?.ranges ?? []), ...ranges] });
    });
    for (const g of grouped.values()) {
      const anchor = apply(inv(sources[g.owner].m), c.points[0].x, c.points[0].y);
      edits[g.owner].push({ sub: g.sub, token: c.key, parts: owners.size, distance: amount, tolerance, anchor, spans: mergedRanges(g.ranges),
        ...(outputOwner !== undefined ? { outputOwner } : {}) });
    }
  });
  const remainders: OffsetRemainder[] = [], consumed = new Set<string>();
  const recipes = sources.map((s, owner): ContourOffsetRecipe | null => {
    if (!edits[owner].length) return null;
    const trimmed: TrimmedOffsetSpan[] = [];
    const result = s.base.flatMap((original, index) => {
      const changed = replacements[owner][index];
      if (!changed.length) return [structuredClone(original)];
      const ranges = mergedRanges(changed.flatMap(r => r.ranges)), period = segments(original).length;
      const output = changed.flatMap(r => r.output ? [{ u: r.ranges[0].u0, path: r.output }] : []);
      let from = 0;
      for (const range of [...ranges, { u0: period, u1: period }]) {
        if (range.u0 > from + 1e-7) {
          const kept = extract(original, from, range.u0);
          if (original.start && from === 0) kept.start = true;
          const span = { sub: index, u0: from, u1: range.u0 }, key = offsetRemainderKey(s.id, span);
          const worldPath = { ...kept, nodes: kept.nodes.map(n => {
            const p = apply(s.m,n.x,n.y);
            return { ...n, ...p, ...(n.cin ? {cin:apply(s.m,n.cin.x,n.cin.y)} : {}), ...(n.cout ? {cout:apply(s.m,n.cout.x,n.cout.y)} : {}) };
          }) };
          const controls = worldPath.nodes.flatMap(n => [n,n.cin,n.cout].filter((p): p is Pt => !!p));
          const box = {x0:Math.min(...controls.map(p=>p.x)),x1:Math.max(...controls.map(p=>p.x)),y0:Math.min(...controls.map(p=>p.y)),y1:Math.max(...controls.map(p=>p.y))};
           const protectedSpan = (exclusions.get(s.id) ?? []).some(r => r.sub === index && Math.min(r.u1, span.u1) - Math.max(r.u0, span.u0) > 1e-7) || plan.contours.some(c => !amounts.get(c.key) && ((c.blocked &&
            Math.max(...c.points.map(p=>p.x))>=box.x0-.002 && Math.min(...c.points.map(p=>p.x))<=box.x1+.002 &&
            Math.max(...c.points.map(p=>p.y))>=box.y0-.002 && Math.min(...c.points.map(p=>p.y))<=box.y1+.002) || c.members.some(m => m.owner === owner && m.sub === index &&
            m.ranges?.some(r => Math.min(Math.max(r.u0,r.u1),span.u1)-Math.max(Math.min(r.u0,r.u1),span.u0)>1e-7))));
          if (remainders.length >= 20000) throw ownerError();
          remainders.push({ ...span, key, owner, path: worldPath, protected: protectedSpan || !!kept.start });
          if (removeRemainders.has(key)) {
            if (protectedSpan || kept.start) throw new Error(t('Dieser Restabschnitt gehört zu einer ungewählten oder mehrdeutigen Kontur oder trägt einen festen Startpunkt und darf nicht entfernt werden.'));
            trimmed.push(span);consumed.add(key);
          } else output.push({ u: from, path: kept });
        }
        from = Math.max(from, range.u1);
      }
      return output.sort((a, b) => a.u - b.u).map(o => o.path);
    });
    const excluded = exclusions.get(s.id) ?? [];
    return { version: 2, source: structuredClone(s.source), base: structuredClone(s.base), edits: edits[owner], result, ...(trimmed.length ? {trimmed} : {}),
      ...(excluded.length ? { excluded: structuredClone([...excluded]) } : {}) };
  });
  if ([...removeRemainders].some(key => !consumed.has(key))) throw ownerError();
  return { recipes, preview: rings.flatMap((ring, i) => amounts.get(plan.contours[i].key) ? [excludedPaths[i] ?? polygon(ring)] : []), remainders };
}
