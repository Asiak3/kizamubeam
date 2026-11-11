// Pure pre-commit assessment. Reasons are stable codes, localized by callers.
import { checkDesign, DEFAULT_CHECK, type CheckIssue } from './check';
import type { ContourOffsetRecipe, OffsetSource } from './contourOffset';
import { flattenExcludedOffset } from './contourOffsetExclusions';
import { apply, type Layer, type Obj, type SubPath } from './model';
import { extract } from './pathtools';
import { segments } from './curves';
import { mergedRanges } from './contourOffsetNetwork';

export interface OffsetOutputAssessment {
  unsafe: string[];
  warnings: string[];
  metrics: { areaMm2: number; minSpanMm: number; kerfMm: number }[];
}

/** Layers are in source-owner order, not palette order. Baselines are original
 * base paths, never the cached result of an earlier offset recipe. No mutation,
 * automatic deletion, joining, or tolerance changes are performed here. */
export function assessOffsetOutput(sources: OffsetSource[], recipes: (ContourOffsetRecipe | null)[], preview: SubPath[], layers: Layer[]): OffsetOutputAssessment {
  const unsafe = new Set<string>(), warnings = new Set<string>();
  const metrics: OffsetOutputAssessment['metrics'] = [];
  const finish = () => ({ unsafe: [...unsafe], warnings: [...warnings], metrics });
  if (sources.length !== recipes.length || sources.length !== layers.length) {
    unsafe.add('invalid-output'); return finish();
  }
  const changed = new Set(sources.filter((_, i) => recipes[i] !== null).map(s => s.id));
  if (!changed.size) return finish();
  const cuts = (layer: Layer) => [layer, ...(layer.sub?.filter(s => s.output) ?? [])];
  const kerf = (layer: Layer) => Math.max(...cuts(layer).map(s => Math.abs(s.kerf)));
  const sensitive = (layer: Layer) => cuts(layer).some(s => s.kerf !== 0 || s.mode === 'fill');
  if (layers.some(l => !Number.isFinite(kerf(l)))) {
    unsafe.add('invalid-output'); return finish();
  }
  // Conservative attribution: a preview ring can combine multiple owners; use
  // the largest absolute layer kerf among all changed owners, not the first one.
  const kerfMm = Math.max(0, ...layers.filter((_, i) => recipes[i] !== null).map(kerf));
  let pointCount = 0;
  const mesh = (path: SubPath) => {
    if (path.nodes.length < 2 || path.nodes.some(n => [n, n.cin, n.cout].some(p => p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))))) throw Error('invalid');
    const points = flattenExcludedOffset(path);
    pointCount += points.length;
    if (pointCount > 100000 || points.length < (path.closed ? 3 : 2) || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('invalid');
    if (path.closed) {
      const origin = points[0];
      const twiceArea = points.reduce((a, p, i) => {
        const q = points[(i + 1) % points.length];
        return a + (p.x - origin.x) * (q.y - origin.y) - (q.x - origin.x) * (p.y - origin.y);
      }, 0);
      if (!Number.isFinite(twiceArea) || twiceArea === 0) throw Error('degenerate-output');
    }
    return points;
  };
  const world = (path: SubPath, owner: number): SubPath => ({ ...path, nodes: path.nodes.map(n => ({ ...n,
    ...apply(sources[owner].m, n.x, n.y), ...(n.cin ? { cin: apply(sources[owner].m, n.cin.x, n.cin.y) } : {}),
    ...(n.cout ? { cout: apply(sources[owner].m, n.cout.x, n.cout.y) } : {}),
  })) });
  try {
    for (const path of preview) {
      if (!path.closed) { unsafe.add('invalid-output'); continue; }
      const points = mesh(path), origin = points[0];
      let twiceArea = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      points.forEach((p, i) => {
        const q = points[(i + 1) % points.length];
        twiceArea += (p.x - origin.x) * (q.y - origin.y) - (q.x - origin.x) * (p.y - origin.y);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      });
      const areaMm2 = Math.abs(twiceArea) / 2, minSpanMm = Math.min(x1 - x0, y1 - y0);
      if (!Number.isFinite(areaMm2) || !Number.isFinite(minSpanMm) || areaMm2 <= 0 || minSpanMm <= 0) {
        unsafe.add('degenerate-output'); continue;
      }
      metrics.push({ areaMm2, minSpanMm, kerfMm });
      // Study heuristic only, not a material-specific manufacturing guarantee.
      if (areaMm2 <= 3) warnings.add('small-area');
      // Axis-aligned bounding-box span, NOT a general bottleneck measurement.
      // Twice kerf reflects the width lost to compensation on opposing sides.
      if (minSpanMm <= Math.max(.01, 2 * kerfMm)) warnings.add('narrow-span');
    }
    const objects = (result: boolean): Obj[] => sources.map((s, i) => {
      const subs = result && recipes[i] ? recipes[i]!.result : s.base;
      // Validate before the design checker (including open retained fragments).
      for (const path of subs) mesh(world(path, i));
      return { id: s.id, layer: i, m: [...s.m], shape: { kind: 'path', subs } };
    });
    const issues = (objs: Obj[]) => checkDesign({ objs, layer: i => layers[i], bed: { w: 1, h: 1 }, skipBed: true,
      settings: { ...DEFAULT_CHECK, engraveLayers: [] } });
    const counts = (list: CheckIssue[]) => {
      const out = new Map<string, { kind: 'open' | 'unjoined'; count: number }>();
      for (const issue of list) {
        if ((issue.kind !== 'open' && issue.kind !== 'unjoined') || !issue.objs.some(o => changed.has(o.id))) continue;
        // Checker keys contain subpath indices, which change when retained
        // fragments split. Compare multiplicity per kind + involved source IDs.
        const key = `${issue.kind}:${[...new Set(issue.objs.map(o => o.id))].sort((a, b) => a - b).join(',')}`;
        const old = out.get(key);
        out.set(key, { kind: issue.kind, count: (old?.count ?? 0) + 1 });
      }
      return out;
    };
    const baseline = counts(issues(objects(false))), result = counts(issues(objects(true)));
    for (const [key, value] of result) if (value.count > (baseline.get(key)?.count ?? 0)) unsafe.add(`new-${value.kind}-output`);
    const tokenOwners = new Map<string, Set<number>>();
    const tokenHosts = new Map<string, Set<number | undefined>>();
    recipes.forEach((recipe, owner) => recipe?.edits.forEach(edit => {
      const owners = tokenOwners.get(edit.token) ?? new Set<number>();
      owners.add(owner); tokenOwners.set(edit.token, owners);
      const hosts = tokenHosts.get(edit.token) ?? new Set<number | undefined>();
      hosts.add(edit.outputOwner); tokenHosts.set(edit.token, hosts);
    }));
    const assemblies = new Map<string, number>();
    for (const [token, hosts] of tokenHosts) if ([...hosts].some(id => id !== undefined)) {
      const id = [...hosts][0], host = sources.findIndex(s => s.id === id);
      if (hosts.size !== 1 || id === undefined || !Number.isInteger(id) || host < 0 || !tokenOwners.get(token)?.has(host)) unsafe.add('invalid-output');
      else assemblies.set(token, host);
    }
    for (let owner = 0; owner < recipes.length; owner++) {
      const count = [...assemblies.values()].filter(host => host === owner).length;
      if (!count) continue;
      const originals = new Set(sources[owner].base.map(p => JSON.stringify(p)));
      const freshClosed = recipes[owner]?.result.filter(p => p.closed && !originals.has(JSON.stringify(p))).length ?? 0;
      if (freshClosed < count) unsafe.add('invalid-output');
    }
    recipes.forEach((recipe, owner) => {
      if (!recipe) return;
      // Cross-owner rings remain separate open owner portions. Existing unjoined
      // warnings do not make a newly offset kerf/fill contour semantically safe.
      if (recipe.edits.some(e => (tokenOwners.get(e.token)?.size ?? 0) > 1 && !assemblies.has(e.token)) && sensitive(layers[owner])) unsafe.add('open-output-with-kerf-or-fill');
      if (sensitive(layers[owner]) && sources[owner].base.some(p => p.closed) &&
        recipe.result.filter(p => !p.closed).length > sources[owner].base.filter(p => !p.closed).length) {
        // Explicit assembly may intentionally leave exact source complements
        // as line cuts. Prove that provenance independently before offering an
        // acknowledgment; fill output must never silently omit those remnants.
        const provenAssembly = recipe.edits.every(e => assemblies.has(e.token));
        const expectedOpen = sources[owner].base.flatMap((base, sub) => {
          const changed = recipe.edits.filter(e => e.sub === sub);
          if (!changed.length) return base.closed ? [] : [base];
          const ranges = mergedRanges([...changed.flatMap(e => e.spans ?? []), ...(recipe.trimmed ?? []).filter(r => r.sub === sub)]);
          const kept: SubPath[] = []; let from = 0;
          for (const range of [...ranges, { u0: segments(base).length, u1: segments(base).length }]) {
            if (range.u0 > from + 1e-7) {
              const piece = extract(base, from, range.u0);
              if (base.start && from === 0) piece.start = true;
              kept.push(piece);
            }
            from = Math.max(from, range.u1);
          }
          return kept;
        });
        const samePaths = (a: SubPath[], b: SubPath[]) => {
          const keys = (paths: SubPath[]) => paths.map(p => JSON.stringify(p)).sort();
          return JSON.stringify(keys(a)) === JSON.stringify(keys(b));
        };
        if (provenAssembly && cuts(layers[owner]).every(c => c.mode === 'line') &&
          samePaths(recipe.result.filter(p => !p.closed), expectedOpen)) warnings.add('open-source-remainders');
        else unsafe.add('open-output-with-kerf-or-fill');
      }
    });
  } catch (error) {
    // Flattening budget exhaustion and malformed/degenerate geometry fail closed.
    unsafe.add(error instanceof Error && error.message === 'degenerate-output' ? 'degenerate-output' : 'invalid-output');
  }
  return finish();
}
