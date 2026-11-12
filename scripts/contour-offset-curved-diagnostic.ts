// Read-only: bundle in memory with vector-offline-test.mjs; never writes a project.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDoc, apply, type Pt } from '../src/model';
import { segments, bezierPt } from '../src/curves';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape } from '../src/contourOffset';
import { worldExcludedOffsetPaths } from '../src/contourOffsetExclusions';
const file = process.argv[3], bytes = readFileSync(file), hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const ids = (process.argv[4] ?? '154,155,156,157,158').split(',').map(Number);
const doc = loadDoc(JSON.parse(bytes.toString('utf8'))), sources = doc.objs.filter(o => ids.includes(o.id)).map(o => offsetSource(o.id, o.shape, o.m));
const before = structuredClone(sources), plan = offsetContours(sources, .2), reports: unknown[] = [];
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
for (const [index, c] of plan.contours.entries()) {
  const owners = [...new Set(c.members.map(m => sources[m.owner].id))];
  if (c.blocked) { reports.push({ contour: index + 1, owners, blocked: c.blockedReason }); continue; }
  try { offsetResults(sources, plan, new Map([[c.key, -.2]]), .2); } catch { continue; }
  // Deliberately sample the most curved interval, not the first interval that passes.
  const candidates = c.members.flatMap(m => (m.ranges ?? []).flatMap(r => {
    const u0 = Math.min(r.u0, r.u1), u1 = Math.max(r.u0, r.u1), seg = segments(sources[m.owner].base[m.sub])[Math.floor((u0 + u1) / 2)];
    if (!seg || u1 - u0 < 1e-5) return [];
    const point = (u: number) => { const p = bezierPt(seg.a, seg.c1, seg.c2, seg.b, u - Math.floor((u0 + u1) / 2)); return apply(sources[m.owner].m, p.x, p.y); };
    const a = point(u0), b = point(u1), mid = point((u0 + u1) / 2);
    const curvature = Math.hypot(mid.x - (a.x + b.x) / 2, mid.y - (a.y + b.y) / 2);
    return [{ owner: m.owner, sub: m.sub, u0: u0 + (u1 - u0) * .23, u1: u0 + (u1 - u0) * .79, curvature }];
  })).sort((a, b) => b.curvature - a.curvature);
  const chosen = candidates[0]; if (!chosen || chosen.curvature < 1e-6) continue;
  const { owner, curvature, ...span } = chosen;
  try {
    const result = offsetResults(sources, plan, new Map([[c.key, -.2]]), .2, new Set(), new Map([[sources[owner].id, [span]]]));
    const expected = worldExcludedOffsetPaths(sources[owner], [span]).flatMap(segments), actual = result.preview.flatMap(segments);
    for (const s of expected) assert.ok(actual.some(q =>
      (near(q.a, s.a) && near(q.b, s.b) && near(q.c1, s.c1) && near(q.c2, s.c2)) ||
      (near(q.b, s.a) && near(q.a, s.b) && near(q.c2, s.c1) && near(q.c1, s.c2))), 'exact world-space source curve retained');
    assert.equal(result.preview.length, 1); assert.equal(result.preview[0].closed, true);
    const reopened = sources.map((s, i) => result.recipes[i] ? offsetSource(s.id, contourOffsetShape(result.recipes[i]!), s.m) : s);
    const repeated = offsetResults(reopened, offsetContours(reopened, .2), new Map([[c.key, -.2]]), .2);
    assert.deepEqual(repeated.recipes.map(r => r?.result), result.recipes.map(r => r?.result));
    reports.push({ contour: index + 1, owners, span, curvature, result: 'ok', verifiedExactCurves: expected.length, closed: true, reopenIdentical: true });
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    reports.push({ contour: index + 1, owners, span, curvature, error: String(error), cause: (error as Error).cause });
  }
}
assert.deepEqual(sources, before);
if (hash(readFileSync(file)) !== hash(bytes)) throw Error('Project changed during read-only diagnosis');
console.log(JSON.stringify({ sha256: hash(bytes), ids, detected: plan.contours.length, reports, noProjectWrites: true }, null, 2));
