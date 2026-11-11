// Targeted deterministic extensions, separate from the immutable 60-case base matrix.
// node scripts/vector-offline-test.mjs scripts/contour-offset-study-followup.ts > artifacts/contour-offset-study/followup.json
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { IDENT, defaultLayer, defaultImageLayer, loadDoc, type SubPath, type Pt } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape, type TrimmedOffsetSpan } from '../src/contourOffset';
import { offsetContourSections, pickOffsetSections } from '../src/contourOffsetSections';
import { segments, bezierPt } from '../src/curves';
import { extract, pointAt } from '../src/pathtools';
import { checkDesign, DEFAULT_CHECK } from '../src/check';
import { buildJob, newDevice, estimate, writeGCode } from '../src/gcode';

const line = (p: number[][], closed = true): SubPath => ({ closed, nodes: p.map(([x, y]) => ({ x, y })) });
const rect = (w: number, h: number) => line([[0, 0], [w, 0], [w, h], [0, h]]);
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
function ellipse(): SubPath {
  const k = .5522847498307936, rx = 20, ry = .5;
  return { closed: true, nodes: [
    { x: rx, y: 0, cin: { x: rx, y: -k * ry }, cout: { x: rx, y: k * ry } },
    { x: 0, y: ry, cin: { x: k * rx, y: ry }, cout: { x: -k * rx, y: ry } },
    { x: -rx, y: 0, cin: { x: -rx, y: k * ry }, cout: { x: -rx, y: -k * ry } },
    { x: 0, y: -ry, cin: { x: -k * rx, y: -ry }, cout: { x: k * rx, y: -ry } },
  ] };
}
const sample = (sp: SubPath) => {
  const points = segments(sp).flatMap(s => s.curve ? Array.from({ length: 64 }, (_, i) => bezierPt(s.a, s.c1, s.c2, s.b, i / 64)) : [s.a]);
  if (!sp.closed) points.push(sp.nodes.at(-1)!);
  return points;
};
const area = (p: Pt[]) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0) / 2;
const err = (e: unknown) => e instanceof Error ? { name: e.name, message: e.message, cause: e.cause ?? null } : { message: String(e), cause: null };
interface Scenario { batch: string; label: string; amount: number; tolerance?: number; owners: SubPath[][]; masks?: TrimmedOffsetSpan[]; automatic?: boolean; expect?: 'accepted' | 'refusal'; rectDimensions?: [number, number]; jobMode?: 'line' | 'fill'; junctionX?: number }
const scenarios: Scenario[] = [];
// A 1.2mm slot reaches kerf width before mathematical collapse; integer Clipper
// coordinates also have an explicit quantization boundary just before collapse.
for (const inset of [.49, .5, .51, .57, .59, .599, .5995, .6, .601, .61]) scenarios.push({ batch: 'slot-width-collapse', label: `20x1.2 inset=${inset}`, owners: [[rect(20, 1.2)]], amount: -inset, rectDimensions: [20, 1.2], expect: inset >= .6 ? 'refusal' : inset <= .599 ? 'accepted' : undefined });
for (const inset of [0, .05, .1, .5, .8, .84, .86, .865, .866, .867]) scenarios.push({ batch: 'three-mm2-region-collapse', label: `sqrt3 square inset=${inset}`, owners: [[rect(Math.sqrt(3), Math.sqrt(3))]], amount: inset === 0 ? .001 : -inset, rectDimensions: [Math.sqrt(3), Math.sqrt(3)], expect: inset < .865 ? 'accepted' : inset >= .867 ? 'refusal' : undefined });
for (const amount of [-.005, -.01, -.025, -.05, -.075, -.1, -.15, -.2, .05, .1]) scenarios.push({ batch: 'skinny-ellipse-normal-connectors', label: `rx20 ry.5, protected u=.01-.05, amount=${amount}`, owners: [[ellipse()]], amount, masks: [{ sub: 0, u0: .01, u1: .05 }] });
for (const tolerance of [.001, .01, .02, .03, .039, .04, .041, .05, .1, .2]) scenarios.push({ batch: 'gap-tolerance-threshold', label: `four open edges gap=.04 tolerance=${tolerance}`, owners: [[line([[0, 0], [20, 0]], false), line([[20, 0], [20, 12]], false), line([[20, 12], [0, 12]], false), line([[0, 12], [0, .04]], false)]], amount: -.2, tolerance, expect: tolerance < .039 ? 'refusal' : tolerance > .041 ? 'accepted' : undefined });
// Move a real T-junction towards the source origin. Ordinary corners must not
// become sections; near-origin junctions may legitimately trigger tolerance guards.
for (const x of [10, 1, .3, .21, .2, .19, .05, .01, .001, 0]) scenarios.push({ batch: 'section-junction-origin-perturbation', label: `20x12 ring top junction x=${x}, bottom x10`, owners: [[rect(20, 12), line([[x, -4], [x, 0]], false), line([[10, 12], [10, 16]], false)]], amount: -.2, automatic: true, junctionX: x });
// Reproduce the initial base study's empty job and distinguish intentional fill
// behavior from a contour-output fault, without relaxing the line-job oracle.
for (const jobMode of ['line', 'fill'] as const) scenarios.push({ batch: 'multiowner-line-versus-fill', label: `two-owner20x12+spur layer=${jobMode}`, owners: [[line([[0, 0], [20, 0], [20, 12]], false), line([[10, -4], [10, 0]], false)], [line([[20, 12], [0, 12], [0, 0]], false)]], amount: .5, jobMode, expect: 'accepted' });

const rows: any[] = [];
for (const [index, scenario] of scenarios.entries()) {
  const { amount, batch, label } = scenario, tolerance = scenario.tolerance ?? .2;
  const sources = scenario.owners.map((subs, i) => offsetSource(2000 + i, { kind: 'path', subs }, [...IDENT]));
  const before = structuredClone(sources), failures: string[] = [], checks: string[] = [];
  const check = (name: string, fn: () => void) => { try { fn(); checks.push(name); } catch (e) { failures.push(`${name}: ${(e as Error).message}`); } };
  const row: any = { id: `E${index + 1}`, batch, label, amountMm: amount, toleranceMm: tolerance, sourceIDs: sources.map(s => s.id), geometry: scenario.owners, expected: scenario.expect ?? 'valid exact geometry or explicit safe guard', checks, failures };
  try {
    const plan = offsetContours(sources, tolerance), target = [...plan.contours].sort((a, b) => Math.abs(area(b.points)) - Math.abs(area(a.points)))[0];
    row.targetContourKey = target?.key ?? null;
    if (!target) { row.outcome = 'safe-refusal'; row.error = { message: 'no selectable contour', cause: null }; }
    else {
      const exclusions = new Map<number, TrimmedOffsetSpan[]>();
      if (scenario.masks) exclusions.set(sources[0].id, scenario.masks);
      if (scenario.automatic) {
        const sections = offsetContourSections(sources, plan, target.key, tolerance);
        row.sections = sections;
        check('two real junctions give two sections and preserve wrap grouping', () => {
          assert.equal(sections.length, 2);
          assert.ok(sections.every(s => !s.wholeContour));
          assert.ok(sections.every(s => s.sub === 0));
          // The origin itself is a real boundary only when x=0. Otherwise the
          // source parameter zero must stay inside the wrapped section.
          if (scenario.junctionX! > tolerance) assert.ok(sections.some(s => s.spans.length === 2));
        });
        check('junction click returns all coincident section alternatives', () => {
          const hits = pickOffsetSections(sources, sections, { x: scenario.junctionX!, y: 0 }, .002);
          assert.equal(new Set(hits.map(h => h.section.key)).size, 2);
        });
        const selected = sections.find(s => s.spans.length === 2) ?? sections[0];
        assert.ok(selected);
        exclusions.set(selected.id, selected.spans);
        row.selectedSectionKey = selected.key;
      }
      row.exclusionMasks = [...exclusions].map(([sourceID, spans]) => ({ sourceID, spans }));
      let result: ReturnType<typeof offsetResults> | undefined;
      try { result = offsetResults(sources, plan, new Map([[target.key, amount]]), tolerance, new Set(), exclusions); }
      catch (e) { row.outcome = 'safe-refusal'; row.error = err(e); }
      if (result) {
        row.outcome = 'accepted';
        row.paths = result.recipes.flatMap((r, owner) => (r?.result ?? sources[owner].base).map(sp => {
          const p = sample(sp), lens = segments(sp).map(s => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y));
          const w = Math.max(...p.map(q => q.x)) - Math.min(...p.map(q => q.x)), h = Math.max(...p.map(q => q.y)) - Math.min(...p.map(q => q.y));
          return { owner, closed: sp.closed, areaMm2: sp.closed ? area(p) : null, bboxMinimumSpanMm: Math.min(w, h), shortEndpointChordsBelow006: lens.filter(l => l < .06 - 1e-8).length, shortEndpointChordsBelow02: lens.filter(l => l < .2 - 1e-8).length };
        }));
        check('output finite and preview formally closed', () => {
          assert.ok(result!.preview.length > 0 && result!.preview.every(sp => sp.closed));
          for (const r of result!.recipes) for (const sp of r?.result ?? []) for (const n of sp.nodes) for (const p of [n, n.cin, n.cout]) if (p) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        });
        check('independent proper-crossing oracle', () => {
          const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          for (const sp of result!.preview) {
            const p = sample(sp);
            for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
              if (i === 0 && j === p.length - 1) continue;
              const a = p[i], b = p[(i + 1) % p.length], c = p[j], d = p[(j + 1) % p.length];
              assert.ok(!(cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12), `crossing ${i},${j}`);
            }
          }
        });
        check('exact excluded cubic segments survive in either orientation', () => {
          for (const [id, spans] of exclusions) {
            const owner = sources.findIndex(s => s.id === id), actual = result!.recipes[owner]!.result.flatMap(sp => segments(sp));
            for (const span of spans) for (const s of segments(extract(sources[owner].base[span.sub], span.u0, span.u1))) assert.ok(actual.some(q => near(q.a, s.a) && near(q.b, s.b) && near(q.c1, s.c1) && near(q.c2, s.c2) || near(q.b, s.a) && near(q.a, s.b) && near(q.c2, s.c1) && near(q.c1, s.c2)));
          }
        });
        if (scenario.rectDimensions) check('analytic area and positive dimensions', () => {
          const [w, h] = scenario.rectDimensions!;
          assert.ok(w + 2 * amount > 0 && h + 2 * amount > 0);
          const expectedArea = (w + 2 * amount) * (h + 2 * amount);
          row.analyticAreaMm2 = expectedArea;
          assert.ok(Math.abs(Math.abs(area(sample(result!.preview[0]))) - expectedArea) < .01);
          row.areaAtMost3StudyWarningOnly = expectedArea <= 3;
          row.analyticMinimumSpanMm = Math.min(w, h) + 2 * amount;
          row.widthToKerf006 = row.analyticMinimumSpanMm / .06;
          row.widthToKerf02 = row.analyticMinimumSpanMm / .2;
        });
        const objects = sources.map((s, i) => ({ id: s.id, m: s.m, layer: 0, shape: result!.recipes[i] ? contourOffsetShape(result!.recipes[i]!) : s.source }));
        const layer = () => ({ ...defaultLayer(0), mode: scenario.jobMode ?? 'line' as const, kerf: .2 });
        row.designAfter = checkDesign({ objs: objects, layer, bed: { w: 400, h: 400 }, settings: DEFAULT_CHECK }).map(i => ({ kind: i.kind, message: i.msg }));
        row.remainders = result.remainders.map(r => ({ sourceID: sources[r.owner].id, sub: r.sub, u0: r.u0, u1: r.u1, protected: r.protected, lengthMm: segments(r.path).reduce((n, s) => n + Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y), 0) }));
        check('save/reopen replay consistency', () => {
          const reopened = objects.map(o => offsetSource(o.id, JSON.parse(JSON.stringify(o.shape)), o.m)), p = offsetContours(reopened, tolerance);
          const replay = offsetResults(reopened, p, new Map(p.contours.filter(c => c.distance).map(c => [c.key, c.distance])), tolerance);
          replay.recipes.forEach((r, i) => assert.deepEqual(r?.result ?? reopened[i].base, result!.recipes[i]?.result ?? sources[i].base));
        });
        if (scenario.jobMode) {
          const device = newDevice({ fw: 'fluidnc' }), doc = loadDoc({ objs: objects, bed: { w: 400, h: 400 }, layers: [layer()] });
          const job = await buildJob({ doc, layer, imgLayer: () => defaultImageLayer(), device, forPreview: true });
          const code = writeGCode(job, device, estimate(job.moves, device));
          row.offlineJob = { mode: scenario.jobMode, moves: job.moves.n, warnings: job.warnings, footer: code.lines.slice(-2) };
          check('line creates motion, fill explicitly reports skipped open pieces', () => {
            if (scenario.jobMode === 'line') assert.ok(job.moves.n > 0);
            else { assert.equal(job.moves.n, 0); assert.ok(job.warnings.some(w => /offene Linien/.test(w))); }
            assert.deepEqual(code.lines.slice(-2), ['M5', 'M2']);
          });
        }
      }
    }
    if (scenario.expect) check('independent expected acceptance/refusal', () => assert.equal(row.outcome, scenario.expect === 'accepted' ? 'accepted' : 'safe-refusal'));
    // A refusal is not a pass if it is a TypeError, invalid-recipe error or missing
    // diagnostic; preserve unknown errors as failures rather than swallowing them.
    if (row.outcome === 'safe-refusal') check('refusal is an explicit geometric guard', () => {
      assert.ok(row.error.cause || /kollabier|Konturversatz|no selectable contour|überschneid|berühr|Verschachtel/i.test(row.error.message));
      assert.notEqual(row.error.name, 'TypeError'); assert.ok(!/Ungültig/.test(row.error.message));
    });
  } catch (e) { row.outcome = 'unhandled-failure'; row.error = err(e); failures.push('unhandled inspection/backend failure'); }
  check('source untouched even on refusal', () => assert.deepEqual(sources, before));
  row.classification = failures.length ? 'correctness-failure' : row.outcome;
  rows.push(row);
}
assert.equal(rows.length, 52);
const countBy = (key: string) => rows.reduce((a, r) => { const k = String(r[key]); a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>);
console.log(JSON.stringify({ schema: 1, deterministic: true, baseScenarioCount: 60, extensionScenarioCount: rows.length,
  rationale: 'Adaptive follow-up of actual base warnings/refusals: narrow width, 3mm2 region, source-normal connector, snap threshold, origin-adjacent junction, initial fill-layer zero job.',
  limits: 'Synthetic data, sampled proper crossings only; no hardware, no browser, no hard area cutoff, no automatic deletion. Near-threshold outcomes include integer quantization.',
  summary: { batches: countBy('batch'), outcomes: countBy('outcome'), classifications: countBy('classification'), failures: rows.filter(r => r.failures.length).map(r => ({ id: r.id, label: r.label, failures: r.failures })),
    errorTypes: rows.filter(r => r.error).reduce((a, r) => { const k = r.error.cause?.reason ?? r.error.message; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>) }, scenarios: rows }, null, 2));
if (rows.some(r => r.failures.length)) process.exitCode = 1;
