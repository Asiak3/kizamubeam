// Exactly 60 deterministic synthetic cases. No private resources, transport or native app.
// node scripts/vector-offline-test.mjs scripts/contour-offset-parameter-study.ts > artifacts/contour-offset-study/results.json
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { IDENT, defaultLayer, defaultImageLayer, loadDoc, type Obj, type Pt, type SubPath } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape, type TrimmedOffsetSpan } from '../src/contourOffset';
import { offsetContourSections, pickOffsetSections, toggleOffsetSection } from '../src/contourOffsetSections';
import { segments, bezierPt } from '../src/curves';
import { extract, pointAt } from '../src/pathtools';
import { checkDesign, DEFAULT_CHECK } from '../src/check';
import { buildJob, newDevice, estimate, writeGCode } from '../src/gcode';

const line = (pts: number[][], closed = true): SubPath => ({ closed, nodes: pts.map(([x, y]) => ({ x, y })) });
const rect = (w: number, h: number, x = 0, y = 0) => line([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
function ellipse(rx: number, ry: number): SubPath {
  const k = .5522847498307936;
  return { closed: true, nodes: [
    { x: rx, y: 0, cin: { x: rx, y: -k * ry }, cout: { x: rx, y: k * ry } },
    { x: 0, y: ry, cin: { x: k * rx, y: ry }, cout: { x: -k * rx, y: ry } },
    { x: -rx, y: 0, cin: { x: -rx, y: k * ry }, cout: { x: -rx, y: -k * ry } },
    { x: 0, y: -ry, cin: { x: -k * rx, y: -ry }, cout: { x: k * rx, y: -ry } },
  ] };
}
const near = (a: Pt, b: Pt, eps = 1e-7) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;
const signedArea = (p: Pt[]) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0) / 2;
// Independent sampling, not production flattening/Clipper. Straight segments stay single edges.
function sample(sp: SubPath): Pt[] {
  const points = segments(sp).flatMap(s => s.curve ? Array.from({ length: 48 }, (_, i) => bezierPt(s.a, s.c1, s.c2, s.b, i / 48)) : [{ x: s.a.x, y: s.a.y }]);
  if (!sp.closed) points.push({ ...sp.nodes.at(-1)! });
  return points;
}
const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function properCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  return cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12;
}
function selfCrosses(p: Pt[], closed: boolean) {
  let count = 0;
  const n = closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (closed && i === 0 && j === n - 1) continue;
    if (properCross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) count++;
  }
  return count;
}
function contains(poly: Pt[], p: Pt) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segmentLengths(sp: SubPath): number[] {
  return segments(sp).map(s => {
    if (!s.curve) return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    let length = 0, prev: Pt = s.a;
    for (let i = 1; i <= 48; i++) { const q = bezierPt(s.a, s.c1, s.c2, s.b, i / 48); length += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
    return length;
  });
}
function metrics(sp: SubPath, kerf: number, sourceLengths: number[]) {
  const p = sample(sp), lengths = segmentLengths(sp);
  // Minimum projection span over sampled edge normals; not a local medial-axis web width.
  let minSpan = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) continue;
    const values = p.map(q => (-q.x * (b.y - a.y) + q.y * (b.x - a.x)) / len);
    minSpan = Math.min(minSpan, Math.max(...values) - Math.min(...values));
  }
  const area = sp.closed ? signedArea(p) : null;
  const short = lengths.filter(l => l < kerf - 1e-8);
  return { closed: sp.closed, nodes: sp.nodes.length, areaMm2: area, minimumProjectionSpanMm: minSpan,
    spanToKerf: minSpan / kerf, shortestSegmentMm: Math.min(...lengths), segmentsBelowKerf: short.length,
    sourceSegmentsBelowKerf: sourceLengths.filter(l => l < kerf - 1e-8).length,
    newShortLengthsMm: short.filter(l => !sourceLengths.some(s => Math.abs(s - l) < 1e-7)),
    endpointGapMm: sp.closed ? 0 : Math.hypot(p[0].x - p.at(-1)!.x, p[0].y - p.at(-1)!.y),
    properSelfCrossings: selfCrosses(p, sp.closed),
    warnings: [area !== null && Math.abs(area) <= 3 ? 'area-at-most-3mm2-study-warning-only' : '', sp.closed && minSpan <= kerf + 1e-8 ? 'projection-span-at-or-below-selected-kerf' : '', short.length ? 'segments-below-selected-kerf' : ''].filter(Boolean) };
}
type Mode = 'none' | 'advanced' | 'automatic';
interface Fixture { category: string; dimensions: string; owners: SubPath[][]; mode: Mode; masks?: TrimmedOffsetSpan[]; inner?: boolean; tolerance?: number; expected?: string }
function fixture(category: number, v: number): Fixture {
  switch (category) {
    case 0: return { category: 'circle', dimensions: 'r=10mm exact cubic source', owners: [[ellipse(10, 10)]], mode: v === 0 ? 'automatic' : v === 1 ? 'advanced' : 'none', masks: [{ sub: 0, u0: 0, u1: .15 }, { sub: 0, u0: 3.85, u1: 4 }] };
    case 1: return { category: 'ellipse', dimensions: 'rx=20 ry=4mm', owners: [[ellipse(20, 4)]], mode: v === 1 ? 'advanced' : v === 0 ? 'automatic' : 'none', masks: [{ sub: 0, u0: .17, u1: .63 }] };
    case 2: return { category: 'skinny-ellipse', dimensions: 'rx=20 ry=.5mm', owners: [[ellipse(20, .5)]], mode: v < 2 ? 'advanced' : 'none', masks: [{ sub: 0, u0: .01, u1: .05 }] };
    case 3: return { category: 'rectangle', dimensions: '30x20mm', owners: [[rect(30, 20)]], mode: v === 0 ? 'automatic' : 'none' };
    case 4: return { category: 'narrow-slot', dimensions: '20x1.2mm', owners: [[rect(20, 1.2)]], mode: 'none' };
    case 5: return { category: 'concave-neck', dimensions: '20x12mm dumbbell,2mm neck', owners: [[line([[0, 0], [8, 0], [8, 5], [12, 5], [12, 0], [20, 0], [20, 12], [12, 12], [12, 7], [8, 7], [8, 12], [0, 12]])]], mode: v === 1 ? 'advanced' : 'none', masks: [{ sub: 0, u0: .2, u1: .8 }] };
    case 6: return { category: 'sharp-corner', dimensions: 'triangle base20 height.5mm', owners: [[line([[0, 0], [20, 0], [10, .5]])]], mode: 'none' };
    case 7: return { category: 'nested-hole', dimensions: 'outer30x20 inner10x6 @10,7mm; inner selected', owners: [[rect(30, 20), rect(10, 6, 10, 7)]], mode: v === 1 ? 'advanced' : 'none', masks: [{ sub: 1, u0: .2, u1: .7 }], inner: true };
    case 8: return { category: 'single-leaf-T', dimensions: 'closed20x12 + two 4mm spurs at (10,0),(10,12)', owners: [[rect(20, 12), line([[10, -4], [10, 0]], false), line([[10, 12], [10, 16]], false)]], mode: 'automatic' };
    case 9: return { category: 'multi-owner-T', dimensions: '20x12 two open owners +4mm spur top midpoint', owners: [[line([[0, 0], [20, 0], [20, 12]], false), line([[10, -4], [10, 0]], false)], [line([[20, 12], [0, 12], [0, 0]], false)]], mode: v < 2 ? 'automatic' : 'none' };
    case 10: return { category: 'tiny-hole', dimensions: 'outer20x20 inner sqrt(3) square @9,9mm; area3mm2 source', owners: [[rect(20, 20), rect(Math.sqrt(3), Math.sqrt(3), 9, 9)]], mode: 'none', inner: true };
    default: {
      const gap = v % 2 ? .24 : .04, tolerance = v === 1 ? .05 : .3;
      return { category: 'near-gap-snap', dimensions: `four open edges20x12; last endpoint gap=${gap}mm`, owners: [[line([[0, 0], [20, 0]], false), line([[20, 0], [20, 12]], false), line([[20, 12], [0, 12]], false), line([[0, 12], [0, gap]], false)]], mode: v === 2 ? 'automatic' : 'none', tolerance, expected: gap > tolerance ? 'no-target-safe-refusal' : undefined };
    }
  }
}
function errorInfo(error: unknown): unknown {
  if (!(error instanceof Error)) return { thrown: String(error) };
  return { name: error.name, message: error.message, cause: error.cause ?? null };
}
const outcomes: any[] = [];
for (let category = 0; category < 12; category++) for (let v = 0; v < 5; v++) {
  const f = fixture(category, v), magnitude = [.1, .2, .5, .8, 2][v], amount = magnitude * ((category + v) % 2 ? 1 : -1);
  const tolerance = f.tolerance ?? .2, kerf = v % 2 ? .06 : .2;
  const objects: Obj[] = f.owners.map((subs, i) => ({ id: 1000 + category * 10 + i, m: [...IDENT], layer: 0, shape: { kind: 'path', subs: structuredClone(subs) } }));
  const sources = objects.map(o => offsetSource(o.id, o.shape, o.m)), original = structuredClone(objects), before = structuredClone(sources);
  const failures: string[] = [], checks: string[] = [];
  const verify = (name: string, fn: () => void) => { try { fn(); checks.push(name); } catch (e) { failures.push(`${name}: ${(e as Error).message}`); } };
  const row: any = { id: `${String(category + 1).padStart(2, '0')}-${v + 1}`, category: f.category, dimensions: f.dimensions, amountMm: amount, toleranceMm: tolerance, selectedLayerKerfMm: kerf,
    sourceIDs: sources.map(s => s.id), sourceGeometry: f.owners, mode: f.mode, targetContourKey: null, exclusionMasks: [], backendAmounts: [],
    expected: f.expected ?? 'valid topology or explicit geometric/ownership guard; no silent invalid output', checks, failures };
  let result: ReturnType<typeof offsetResults> | undefined;
  try {
    const plan = offsetContours(sources, tolerance);
    row.contours = plan.contours.map(c => ({ key: c.key, blocked: c.blocked ?? null, members: c.members }));
    const sorted = [...plan.contours].sort((a, b) => Math.abs(signedArea(a.points)) - Math.abs(signedArea(b.points)));
    const contour = f.inner ? sorted[0] : sorted.at(-1);
    if (!contour) {
      row.outcome = f.expected === 'no-target-safe-refusal' ? 'safe-refusal' : 'unexpected-refusal';
      row.error = { message: 'no selectable contour', cause: null };
      if (row.outcome === 'unexpected-refusal') failures.push('expected synthetic fixture to have a selectable face');
    } else {
      row.targetContourKey = contour.key;
      const amounts = new Map([[contour.key, amount]]), exclusions = new Map<number, TrimmedOffsetSpan[]>();
      if (f.mode === 'advanced') exclusions.set(sources[0].id, f.masks!);
      if (f.mode === 'automatic') {
        const sections = offsetContourSections(sources, plan, contour.key, tolerance);
        row.sections = sections;
        verify('automatic sections cover selected source ranges without overlap', () => {
          for (const member of contour.members) for (const range of member.ranges ?? []) {
            const lo = Math.min(range.u0, range.u1), hi = Math.max(range.u0, range.u1);
            const spans = sections.filter(s => s.id === sources[member.owner].id && s.sub === member.sub).flatMap(s => s.spans);
            const total = spans.reduce((n, s) => n + Math.max(0, Math.min(hi, s.u1) - Math.max(lo, s.u0)), 0);
            assert.ok(Math.abs(total - (hi - lo)) < 1e-6, `range coverage ${total} vs ${hi - lo}`);
          }
        });
        const section = sections[0];
        assert.ok(section, 'at least one automatic section');
        verify('source midpoint picks intended automatic section', () => {
          const span = section.spans[0], source = sources.find(s => s.id === section.id)!;
          const p = pointAt(source.base[span.sub], (span.u0 + span.u1) / 2);
          assert.ok(pickOffsetSections(sources, sections, p, .001).some(h => h.section.key === section.key));
        });
        verify('section toggle is reversible', () => assert.deepEqual(toggleOffsetSection(section, toggleOffsetSection(section, [])), []));
        if (category === 8) verify('two real T-junctions split ring, not ordinary corners or parameter zero', () => {
          assert.equal(sections.length, 2); assert.ok(sections.every(s => !s.wholeContour));
          const spans = sections.flatMap(s => s.spans);
          assert.ok(spans.some(s => Math.abs(s.u0 - .5) < 1e-6 || Math.abs(s.u1 - .5) < 1e-6));
          assert.ok(spans.some(s => Math.abs(s.u0 - 2.5) < 1e-6 || Math.abs(s.u1 - 2.5) < 1e-6));
          assert.ok(sections.some(s => s.spans.length === 2), 'continuous origin wraps into one section');
        });
        if (section.wholeContour) { amounts.delete(contour.key); row.action = 'wholeContour-click-removes-offset-no-full-mask-backend-call'; }
        else exclusions.set(section.id, toggleOffsetSection(section, []));
      }
      row.exclusionMasks = [...exclusions].map(([sourceID, spans]) => ({ sourceID, spans }));
      row.backendAmounts = [...amounts];
      row.expected = row.action ? 'unchanged source/no recipe' : f.expected ?? row.expected;
      try { result = offsetResults(sources, plan, amounts, tolerance, new Set(), exclusions); }
      catch (error) {
        row.error = errorInfo(error);
        const message = error instanceof Error ? error.message : String(error);
        const guarded = /kollabier|überschneid|berühr|Verschachtel|Zuordnung|zu spitze|eindeutig|mehrdeutig|Arbeitsgrenze|Quell|Abschnitt/i.test(message) || !!(error instanceof Error && error.cause);
        row.outcome = guarded ? 'safe-refusal' : 'unexpected-refusal';
        // Unexcluded wide rectangles, circles and ellipses have known noncollapsing solutions.
        if (!guarded || (['circle', 'ellipse', 'rectangle'].includes(f.category) && f.mode === 'none')) failures.push('unexpected refusal of independently noncollapsing fixture');
      }
      if (result) {
        row.outcome = row.action ? 'whole-contour-disabled' : 'accepted';
        const paths = result.recipes.flatMap((r, i) => (r?.result ?? sources[i].base).map(sp => ({ owner: i, sp })));
        verify('all output nodes and handles finite', () => {
          for (const { sp } of paths) for (const n of sp.nodes) for (const p of [n, n.cin, n.cout]) if (p) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        });
        verify('formal preview closure', () => assert.ok(result!.preview.every(sp => sp.closed && sp.nodes.length >= 3)));
        if (row.action) verify('wholeContour action produces no replacement', () => { assert.ok(result!.recipes.every(r => r === null)); assert.equal(result!.preview.length, 0); assert.equal(exclusions.size, 0); });
        else verify('selected contour actually replaced', () => { assert.ok(result!.preview.length > 0); assert.ok(result!.recipes.some(Boolean)); });
        const sourceLengths = sources.map(s => s.base.flatMap(segmentLengths));
        row.paths = paths.map(({ owner, sp }) => ({ sourceID: sources[owner].id, ...metrics(sp, kerf, sourceLengths[owner]) }));
        row.previewMetrics = result.preview.map(sp => metrics(sp, kerf, sourceLengths.flat()));
        verify('independent sampled proper self-crossing oracle', () => assert.ok([...row.paths, ...row.previewMetrics].every(m => m.properSelfCrossings === 0)));
        verify('single-owner selected ring formally closed', () => {
          if (!row.action && new Set(contour.members.map(m => m.owner)).size === 1) assert.ok(paths.some(p => p.owner === contour.members[0].owner && p.sp.closed));
        });
        // Multi-owner output intentionally consists of open spans. Each preview endpoint must
        // have an exact counterpart in the assembled owner pieces, not an invented closure.
        if (!row.action && new Set(contour.members.map(m => m.owner)).size > 1) verify('multi-owner intended seams meet without owner gaps', () => {
          const opens = paths.filter(p => !p.sp.closed).map(p => p.sp);
          const ends = opens.flatMap(sp => [sp.nodes[0], sp.nodes.at(-1)!]);
          const unmatched = ends.filter((p, i) => !ends.some((q, j) => i !== j && near(p, q)));
          row.unmatchedOwnerEndpoints = unmatched;
          // The explicit 4mm spur has exactly one free outer endpoint.
          assert.ok(unmatched.every(p => near(p, { x: 10, y: -4 }) || near(p, { x: 10, y: 0 })), 'new unmatched owner seam');
        });
        verify('excluded exact source segments survive, either orientation', () => {
          for (const [id, spans] of exclusions) {
            const owner = sources.findIndex(s => s.id === id), actual = paths.filter(p => p.owner === owner).flatMap(p => segments(p.sp));
            for (const span of spans) for (const s of segments(extract(sources[owner].base[span.sub], span.u0, span.u1))) {
              assert.ok(actual.some(q => (near(q.a, s.a) && near(q.b, s.b) && near(q.c1, s.c1) && near(q.c2, s.c2)) || (near(q.b, s.a) && near(q.a, s.b) && near(q.c2, s.c1) && near(q.c1, s.c2))), `lost source ${id} interval ${span.u0}-${span.u1}`);
            }
          }
        });
        verify('preview winding follows selected source face', () => {
          for (const sp of result!.preview) assert.equal(Math.sign(signedArea(sample(sp))), Math.sign(signedArea(contour.points)));
        });
        if (f.inner && !row.action) verify('nesting and unselected outer exactness', () => {
          const r = result!.recipes[0]!;
          assert.ok(r.result.some(sp => JSON.stringify(sp) === JSON.stringify(sources[0].base[0])), 'unselected outer changed');
          for (const p of sample(result!.preview[0])) assert.ok(contains(sample(sources[0].base[0]), p), 'inner left outer');
        });
        if (['rectangle', 'narrow-slot', 'tiny-hole'].includes(f.category) && !row.action && !exclusions.size) verify('independent analytic rectangular area', () => {
          const w = category === 3 ? 30 : category === 4 ? 20 : Math.sqrt(3), h = category === 3 ? 20 : category === 4 ? 1.2 : Math.sqrt(3);
          assert.ok(w + 2 * amount > 0 && h + 2 * amount > 0, 'accepted collapsed dimensions');
          assert.ok(Math.abs(Math.abs(signedArea(sample(result!.preview[0]))) - (w + 2 * amount) * (h + 2 * amount)) < .01);
        });
        const changedObjects = objects.map((o, i) => ({ ...o, shape: result!.recipes[i] ? contourOffsetShape(result!.recipes[i]!) : o.shape }));
        const layer = () => ({ ...defaultLayer(0), mode: 'line' as const, kerf });
        const design = (objs: Obj[]) => checkDesign({ objs, layer, bed: { w: 400, h: 400 }, settings: { ...DEFAULT_CHECK, beam: kerf } }).map(issue => ({ kind: issue.kind, message: issue.msg }));
        row.designBefore = design(objects); row.designAfter = design(changedObjects);
        row.openUnjoinedDelta = row.designAfter.filter(i => i.kind === 'open' || i.kind === 'unjoined').length - row.designBefore.filter(i => i.kind === 'open' || i.kind === 'unjoined').length;
        // These findings are recorded, not declared topology failures by themselves:
        // intentional remnants and multi-owner open pieces are legal design-check inputs.
        verify('persisted recipe source retains all original Béziers', () => {
          result!.recipes.forEach((r, i) => { if (r) { assert.deepEqual(r.source, sources[i].source); assert.deepEqual(r.base, sources[i].base); } });
        });
        verify('JSON save/reopen and replay output consistency', () => {
          const reopened = changedObjects.map(o => offsetSource(o.id, JSON.parse(JSON.stringify(o.shape)), o.m));
          const nextPlan = offsetContours(reopened, tolerance);
          const nextAmounts = new Map(nextPlan.contours.filter(c => c.distance).map(c => [c.key, c.distance]));
          const replay = offsetResults(reopened, nextPlan, nextAmounts, tolerance);
          replay.recipes.forEach((r, i) => assert.deepEqual(r?.result ?? reopened[i].base, result!.recipes[i]?.result ?? sources[i].base));
        });
        if (v === 2 && [0, 3, 7, 9, 10].includes(category)) {
          try {
            const doc = loadDoc({ objs: changedObjects, layers: [layer()], bed: { w: 400, h: 400 } });
            const device = newDevice({ fw: 'fluidnc' });
            const job = await buildJob({ doc, layer, imgLayer: () => defaultImageLayer(), device, forPreview: true });
            const code = writeGCode(job, device, estimate(job.moves, device));
            row.offlineJob = { moves: job.moves.n, warnings: job.warnings, lines: code.lines.length, footer: code.lines.slice(-2) };
            verify('offline job finite and ends laser-off', () => {
              assert.ok(job.moves.n > 0);
              for (let i = 0; i < job.moves.n; i++) assert.ok([job.moves.x[i], job.moves.y[i], job.moves.f[i], job.moves.s[i]].every(Number.isFinite));
              assert.deepEqual(code.lines.slice(-2), ['M5', 'M2']);
              assert.ok(!code.lines.some(l => /NaN|Infinity/.test(l)));
            });
          } catch (e) { row.offlineJob = { error: errorInfo(e) }; failures.push('offline job threw'); }
        }
      }
    }
  } catch (e) { row.outcome = 'study-or-unhandled-failure'; row.error = errorInfo(e); failures.push('uncaught fixture/inspection/backend failure'); }
  verify('original objects and offset sources never mutated, including refusal', () => { assert.deepEqual(objects, original); assert.deepEqual(sources, before); });
  if (failures.length) row.classification = 'correctness-failure';
  else row.classification = row.outcome === 'safe-refusal' ? 'legitimate-guard-refusal' : row.paths?.some(p => p.warnings.length) ? 'accepted-with-manufacturability-warning' : row.outcome;
  outcomes.push(row);
}
assert.equal(outcomes.length, 60);
const countBy = (key: string) => outcomes.reduce((a, row) => { const k = String(row[key]); a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>);
const report = { schema: 1, deterministic: true, scenarioCount: outcomes.length, categories: 12, variantsPerCategory: 5,
  limitations: ['Synthetic geometry only; private resource/browser supplemental study handled separately.', '48 samples per cubic: area/span/crossing/length approximate; proper-crossing oracle does not prove absence of tangential contacts.', 'Minimum projection span is not a local web-width oracle. New short lengths compare approximate lengths, not full geometric identity.', 'area <=3mm2 is only a study warning, never an acceptance threshold.', 'Offline jobs are not hardware certification.'],
  summary: { outcomes: countBy('outcome'), classifications: countBy('classification'), failures: outcomes.filter(r => r.failures.length).map(r => ({ id: r.id, category: r.category, failures: r.failures })),
    errorTypes: outcomes.filter(r => r.error).reduce((a, r) => { const k = r.error.cause?.reason ?? r.error.message; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>), offlineJobs: outcomes.filter(r => r.offlineJob).length }, scenarios: outcomes };
console.log(JSON.stringify(report, null, 2));
if (report.summary.failures.length) process.exitCode = 1;
