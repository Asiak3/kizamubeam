import './core-fixtures-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { IDENT, loadDoc, apply, type Mat, type SubPath } from '../src/model';
import { CONTOUR_OFFSET, offsetSource, offsetContours, offsetResults, contourOffsetShape, readContourOffset, offsetClosureOwners } from '../src/contourOffset';
import { buildGen } from '../src/generators';
import { offsetContourSections } from '../src/contourOffsetSections';
import { segments } from '../src/curves';
import { extract, reverseSub } from '../src/pathtools';

let count = 0;
function test(name: string, fn: () => void) { try { fn(); } catch (error) { console.error('FAIL', name, (error as Error).cause); throw error; } count++; console.log('PASS ' + name); }
function fixture(curved = false, reversed = false, matrix: Mat = [...IDENT]) {
  const top: SubPath = { closed: false, nodes: [{ x: 0, y: 0, ...(curved ? { cout: { x: 10, y: -15 } } : {}) },
    { x: 40, y: 0, ...(curved ? { cin: { x: 30, y: -15 } } : {}) }] };
  const rest: SubPath = { closed: false, nodes: [{ x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }] };
  if (reversed) reverseSub(top);
  const sources = [offsetSource(156, { kind: 'path', subs: [top] }, matrix), offsetSource(157, { kind: 'path', subs: [rest] }, matrix)];
  const plan = offsetContours(sources, .2), c = plan.contours[0];
  assert.equal(plan.contours.length, 1);
  return { sources, plan, c, amounts: new Map([[c.key, -.5]]), owners: new Map([[c.key, 157]]) };
}

test('whole split rectangle hosts exactly one closed ring and preserves empty participant recipe', () => {
  const { sources, plan, c, amounts, owners } = fixture(), before = structuredClone(sources);
  const result = offsetResults(sources, plan, amounts, .2, new Set(), undefined, owners);
  assert.deepEqual(result.recipes[0]!.result, []);
  assert.equal(result.recipes[1]!.result.length, 1);
  assert.equal(result.recipes[1]!.result[0].closed, true);
  assert.equal(result.remainders.length, 0);
  const regenerated = buildGen(CONTOUR_OFFSET, contourOffsetShape(result.recipes[0]!).params);
  assert.equal(regenerated.issues.length, 0); assert.equal(regenerated.parts.length, 1);
  assert.deepEqual(regenerated.parts[0].shape.subs, []);
  assert.deepEqual(readContourOffset(regenerated.parts[0].shape)!.source, sources[0].source);
  const ring = result.recipes[1]!.result[0].nodes;
  const area = Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - p.y * q.x; }, 0) / 2);
  assert.equal(area, 39 * 29);
  result.recipes.forEach((r, i) => {
    assert.deepEqual(r!.base, sources[i].base); assert.deepEqual(r!.source, sources[i].source);
    assert.ok(r!.edits.every(e => e.outputOwner === 157));
    assert.deepEqual(readContourOffset(contourOffsetShape(r!))!.result, r!.result);
  });
  assert.deepEqual(offsetClosureOwners(plan, sources, amounts, owners), [1]);
  const reopened = result.recipes.map((r, i) => offsetSource(sources[i].id, contourOffsetShape(r!), sources[i].m));
  const next = offsetContours(reopened, .2);
  assert.deepEqual(offsetResults(reopened, next, amounts, .2).recipes, result.recipes);
  const disabled = offsetResults(reopened, next, amounts, .2, new Set(), undefined, new Map());
  assert.ok(disabled.recipes.every(r => r!.result.length === 1 && !r!.result[0].closed));
  assert.ok(disabled.recipes.every(r => r!.edits.every(e => e.outputOwner === undefined)));
  assert.deepEqual(offsetResults(reopened, next, new Map(), .2).recipes, [null, null]);
  assert.deepEqual(sources, before);
  assert.throws(() => offsetContours([reopened[0]], .2));
  const bad = structuredClone(reopened); bad[0].edits[0].outputOwner = 156;
  assert.throws(() => offsetContours(bad, .2));
  assert.throws(() => offsetResults(sources, plan, amounts, .2, new Set(), undefined, new Map([[c.key, 999]])));
  assert.throws(() => offsetResults(sources, plan, amounts, .2, new Set(), undefined, new Map([['stale', 157]])));
  const invalid = structuredClone(result.recipes[0]!); delete invalid.edits[0].outputOwner;
  assert.throws(() => contourOffsetShape(invalid));
});

for (const reversed of [false, true]) for (const matrix of [[...IDENT], [-1, 0, 0, 1, 90, 10], [0, 1, -1, 0, 70, 20]] as Mat[]) {
  test(`exact curved exclusion in mixed-owner assembly reversed=${reversed} transform=${matrix}`, () => {
    const { sources, plan, amounts, owners } = fixture(true, reversed, matrix), before = structuredClone(sources);
    const exclusions = new Map([[156, [{ sub: 0, u0: .3, u1: .7 }]]]);
    assert.throws(() => offsetResults(sources, plan, amounts, .2, new Set(), exclusions),
      (e: unknown) => e instanceof Error && (e.cause as { reason: string }).reason === 'cross-owner-exclusion');
    const result = offsetResults(sources, plan, amounts, .2, new Set(), exclusions, owners);
    assert.deepEqual(result.recipes[0]!.result, []);
    const output = result.recipes[1]!.result[0]; assert.equal(output.closed, true);
    const expected = segments(extract(sources[0].base[0], .3, .7))[0];
    const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
    assert.ok(segments(output).some(q => close(q.a, expected.a) && close(q.b, expected.b) && close(q.c1, expected.c1) && close(q.c2, expected.c2) ||
      close(q.b, expected.a) && close(q.a, expected.b) && close(q.c2, expected.c1) && close(q.c1, expected.c2)));
    assert.deepEqual(sources, before);
    const reopened = result.recipes.map((r, i) => offsetSource(sources[i].id, contourOffsetShape(r!), sources[i].m));
    assert.deepEqual(offsetResults(reopened, offsetContours(reopened, .2), amounts, .2).recipes, result.recipes);
    assert.throws(() => offsetResults(reopened, offsetContours(reopened, .2), amounts, .2, new Set(), undefined, new Map()));
  });
}

test('different participant transforms retain exact world exclusion in the rotated output host', () => {
  const a=offsetSource(156,{kind:'path',subs:[{closed:false,nodes:[{x:0,y:0},{x:20,y:0}]}]},[...IDENT]);
  const b=offsetSource(157,{kind:'path',subs:[{closed:false,nodes:[{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}]}]},[0,1,-1,0,20,0]);
  const sources=[a,b],before=structuredClone(sources),plan=offsetContours(sources,.2),key=plan.contours[0].key;
  const result=offsetResults(sources,plan,new Map([[key,-.2]]),.2,new Set(),new Map([[156,[{sub:0,u0:.25,u1:.75}]]]),new Map([[key,157]]));
  assert.equal(result.recipes[0]!.result.length,0);
  const path=result.recipes[1]!.result[0];assert.equal(path.closed,true);
  const points=path.nodes.map(p=>apply(b.m,p.x,p.y));
  for(const x of [5,15])assert.ok(points.some(p=>Math.abs(p.x-x)<1e-8&&Math.abs(p.y)<1e-8));
  const reopened=sources.map((s,i)=>offsetSource(s.id,contourOffsetShape(result.recipes[i]!),s.m));
  assert.deepEqual(offsetResults(reopened,offsetContours(reopened,.2),new Map([[key,-.2]]),.2).recipes,result.recipes);
  assert.deepEqual(sources,before);
});
test('source fixed starts and malformed empty recipes remain refused', () => {
  const { sources, amounts, owners } = fixture(); sources[0].base[0].start = true;
  const plan = offsetContours(sources, .2);
  assert.throws(() => offsetResults(sources, plan, amounts, .2, new Set(), undefined, owners));
  const clean = fixture(), result = offsetResults(clean.sources, clean.plan, clean.amounts, .2, new Set(), undefined, clean.owners);
  for (const owner of [0, -1, 1.5, Infinity]) {
    const recipe = structuredClone(result.recipes[0]!); recipe.edits[0].outputOwner = owner;
    assert.throws(() => contourOffsetShape(recipe));
  }
});

// Optional private fixture: read-only, no embedded project geometry or project writes.
if (process.argv[3]) test('original frame mixed-owner exclusions 13/UI7 and 14/UI6', () => {
  const filename = process.argv[3], bytes = readFileSync(filename), hash = createHash('sha256').update(bytes).digest('hex');
  const doc = loadDoc(JSON.parse(bytes.toString('utf8')));
  const sources = doc.objs.filter(o => [154, 155, 156, 157, 158].includes(o.id)).map(o => offsetSource(o.id, o.shape, o.m));
  const plan = offsetContours(sources, .2);
  for (const [number, sub] of [[13, 6], [14, 5]]) for (const host of [156, 157]) {
    const c = plan.contours[number - 1], section = offsetContourSections(sources, plan, c.key, .2).find(s => s.id === 157 && s.sub === sub);
    assert.ok(section); assert.deepEqual([...new Set(c.members.map(m => sources[m.owner].id))].sort(), [156, 157]);
    const result = offsetResults(sources, plan, new Map([[c.key, -.5]]), .2, new Set(), new Map([[157, section.spans]]), new Map([[c.key, host]]));
    assert.equal(result.preview.length, 1); assert.equal(result.preview[0].closed, true);
    assert.equal(result.recipes.flatMap(r => r?.edits ?? []).every(e => e.outputOwner === host), true);
    const reopened = sources.map((s, i) => result.recipes[i] ? offsetSource(s.id, contourOffsetShape(result.recipes[i]!), s.m) : s);
    assert.deepEqual(offsetResults(reopened, offsetContours(reopened, .2), new Map([[c.key, -.5]]), .2).recipes, result.recipes);
    console.log(`fixture contour ${number}: closed assembly computed, excluded source 157/sub${sub}, host ${host}`);
  }
  assert.equal(createHash('sha256').update(readFileSync(filename)).digest('hex'), hash);
});
else console.log('SKIP optional original frame fixture (pass path as argument)');
console.log(`${count} contour assembly tests passed`);
