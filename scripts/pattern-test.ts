// Tests of the pattern fill (issue #245): repeats, wrap edges, target area, duplicate lines, area mode,
// library format and the parametric object. Run: npm run test:pattern
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { SubPath } from '../src/model';
const { computePattern, DEFAULT_PATTERN_OPTIONS, patternLattice, subLength, dedupeBits, PATTERN_GEN, paramsFromOptions, optionsFromParams, runPattern, MAX_TILES } = await import('../src/pattern');
const { parseRecipe, sanitizePatternSpec, DEFAULT_PATTERN_SETTINGS } = await import('../src/patternFormat');
const { builtinPatterns, patternAsset, patternPreviewSvg } = await import('../src/patternLibrary');
const { parseAsset, assetJson, assetMeta } = await import('../src/assetFormat');
const { buildGen, getGenerator, normalizeParams } = await import('../src/generators');
const { segments } = await import('../src/curves');
type Opts = typeof DEFAULT_PATTERN_OPTIONS;

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≠ ${b} (±${eps})`);

const rectSub = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const K = 0.5522847498;
const circleSub = (cx: number, cy: number, r: number): SubPath => {
  const k = r * K;
  return {
    closed: true,
    nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k } },
      { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r } },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k } },
      { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r } },
    ],
  };
};
const opts = (o: Partial<Opts>): Opts => ({ ...DEFAULT_PATTERN_OPTIONS, margin: 0, ...o });
const total = (subs: SubPath[]) => subs.reduce((s, sp) => s + subLength(sp), 0);
/** All nodes and handles inside the box (with tolerance) */
const allInside = (subs: SubPath[], x0: number, y0: number, x1: number, y1: number, tol = 0.02) =>
  subs.every((sp) => sp.nodes.every((n) => n.x >= x0 - tol && n.x <= x1 + tol && n.y >= y0 - tol && n.y <= y1 + tol));
const curveCount = (subs: SubPath[]) => subs.reduce((s, sp) => s + segments(sp).filter((g) => g.curve).length, 0);

// square tile 10 × 10 with a square outline: the classic case of shared edges
const squareTile = { w: 10, h: 10, subs: [rectSub(-5, -5, 10, 10)] };

test('grid of squares: shared edges merged into long lines', () => {
  const r = computePattern({ tile: squareTile, target: [rectSub(0, 0, 40, 30)], holes: [] }, opts({ edge: 'clip', offsetX: 5 }));
  assert.equal(r.error, undefined);
  // 4 × 3 squares fit exactly: 5 vertical + 4 horizontal lines, nothing doubled
  near(total(r.subs), 5 * 30 + 4 * 40, 0.05, 'length');
  assert.ok(r.removed > 100, `removed ${r.removed}`);
  assert.ok(r.subs.length <= 9, `paths ${r.subs.length}`);
});

test('without de-duplication the shared edges stay twice', () => {
  const r = computePattern({ tile: squareTile, target: [rectSub(0, 0, 40, 30)], holes: [] }, opts({ edge: 'whole', dedupe: false, offsetX: 5 }));
  assert.equal(r.tiles, 12);
  near(total(r.subs), 12 * 40, 0.05);
});

test('pattern is cut exactly at the target and stays inside', () => {
  const tile = { w: 8, h: 8, subs: [circleSub(0, 0, 3)] };
  const r = computePattern({ tile, target: [rectSub(0, 0, 50, 37)], holes: [] }, opts({ edge: 'clip', offsetX: 1.3, offsetY: 2.1 }));
  assert.equal(r.error, undefined);
  assert.ok(allInside(r.subs, 0, 0, 50, 37, 0.05), 'outside the target');
  // curves stay Bézier curves
  assert.ok(curveCount(r.subs) > r.tiles, 'curves were flattened');
});

test('margin keeps the pattern away from the outline', () => {
  const tile = { w: 4, h: 4, subs: [rectSub(-1.5, -1.5, 3, 3)] };
  const r = computePattern({ tile, target: [rectSub(0, 0, 50, 50)], holes: [] }, opts({ edge: 'clip', margin: 5, offsetX: 0.7 }));
  assert.ok(allInside(r.subs, 5, 5, 45, 45, 0.05));
});

test('whole tiles only: no cut tile, touching: tiles reach beyond', () => {
  const tile = { w: 8, h: 8, subs: [circleSub(0, 0, 3)] };
  const target = [circleSub(50, 50, 30)];
  const whole = computePattern({ tile, target, holes: [] }, opts({ edge: 'whole' }));
  const clip = computePattern({ tile, target, holes: [] }, opts({ edge: 'clip' }));
  const touch = computePattern({ tile, target, holes: [] }, opts({ edge: 'touch' }));
  assert.ok(whole.tiles < clip.tiles && clip.tiles <= touch.tiles, `${whole.tiles} ${clip.tiles} ${touch.tiles}`);
  // every whole circle is closed and inside the target circle
  assert.ok(whole.subs.every((s) => s.closed));
  for (const s of whole.subs) for (const n of s.nodes) assert.ok(Math.hypot(n.x - 50, n.y - 50) <= 30.01);
  assert.ok(touch.subs.some((s) => s.nodes.some((n) => Math.hypot(n.x - 50, n.y - 50) > 30.5)));
});

test('kept-free area (hole) stays empty', () => {
  const tile = { w: 5, h: 5, subs: [rectSub(-2, -2, 4, 4)] };
  const r = computePattern({ tile, target: [rectSub(0, 0, 60, 60)], holes: [rectSub(20, 25, 20, 10)] }, opts({ edge: 'clip', margin: 1 }));
  for (const s of r.subs)
    for (const n of s.nodes) assert.ok(!(n.x > 19.05 && n.x < 40.95 && n.y > 24.05 && n.y < 35.95), `node in hole ${n.x},${n.y}`);
});

test('wrap edges: motif across the frame is seamless; without wrap it is cut at the frame', () => {
  // circle centred on the right edge of the frame: with wrap, every circle is whole
  const tile = { w: 10, h: 10, subs: [circleSub(5, 0, 3)] };
  const target = [rectSub(0, 0, 60, 60)];
  const wrap = computePattern({ tile, target, holes: [] }, opts({ edge: 'whole', wrap: true }));
  assert.ok(wrap.subs.length > 10 && wrap.subs.every((s) => s.closed), 'whole circles');
  const cut = computePattern({ tile, target, holes: [] }, opts({ edge: 'whole', wrap: false, dedupe: false }));
  // only the left half of each circle is inside the frame
  near(total(cut.subs) / cut.tiles, Math.PI * 3, 0.05, 'half circle per tile');
});

test('repeat lattices: brick, half drop, hex, mirror, rotate', () => {
  const s = DEFAULT_PATTERN_SETTINGS;
  const tile = { w: 10, h: 6, subs: squareTile.subs };
  const L = (o: Partial<typeof s>) => patternLattice(tile, { ...s, ...o }) as Exclude<ReturnType<typeof patternLattice>, string>;
  assert.deepEqual(L({ repeat: 'brick' }).b, { x: 5, y: 6 });
  assert.deepEqual(L({ repeat: 'halfdrop', shift: 0.25 }).a, { x: 10, y: 1.5 });
  near(L({ repeat: 'hex' }).b.y, 4.5, 1e-9);
  assert.equal(L({ repeat: 'hex' }).frame.length, 6);
  assert.equal(L({ repeat: 'mirror' }).cells.length, 4);
  assert.equal(L({ repeat: 'mirror', mirror: 'x' }).cells.length, 2);
  const rot = L({ repeat: 'rotate' });
  assert.equal(rot.cells.length, 4);
  assert.deepEqual(rot.a, { x: 20, y: 0 });
  assert.equal(typeof patternLattice(tile, { ...s, gapX: -10 }), 'string');
});

test('honeycomb: hexagons share their edges, nothing lasered twice', () => {
  const p = builtinPatterns().find((x) => x.id === 'honeycomb')!;
  const r = computePattern({ tile: p.spec.tile, target: [rectSub(0, 0, 80, 60)], holes: [] }, opts({ ...p.spec.settings, edge: 'clip' }));
  assert.equal(r.error, undefined);
  const raw = computePattern({ tile: p.spec.tile, target: [rectSub(0, 0, 80, 60)], holes: [] }, opts({ ...p.spec.settings, edge: 'clip', dedupe: false }));
  // inside, every edge belongs to two hexagons: about half the length remains
  const ratio = total(r.subs) / total(raw.subs);
  assert.ok(ratio > 0.45 && ratio < 0.6, `ratio ${ratio}`);
  // no two segments on top of each other: run de-duplication again, nothing more to remove
  const again = dedupeBits(r.subs.map((sp) => ({ sp, cut: false })));
  assert.ok(again.removed < 0.01, `still doubled ${again.removed}`);
});

test('herringbone bricks tile the plane without overlap', () => {
  const p = builtinPatterns().find((x) => x.id === 'herringbone')!;
  // without rotation, in a square: total length of all brick edges after merging is finite and nothing doubled
  const r = computePattern({ tile: p.spec.tile, target: [rectSub(0, 0, 40, 40)], holes: [] }, opts({ ...p.spec.settings, angle: 0, output: 'areas', edge: 'clip' }));
  assert.equal(r.error, undefined);
  // as areas, all bricks unite into the full square (no gaps between bricks)
  assert.equal(r.subs.length, 1);
  const lines = computePattern({ tile: p.spec.tile, target: [rectSub(0, 0, 40, 40)], holes: [] }, opts({ ...p.spec.settings, angle: 0 }));
  const again = dedupeBits(lines.subs.map((sp) => ({ sp, cut: false })));
  assert.ok(again.removed < 0.01);
});

test('area mode unites overlapping shapes and keeps them closed', () => {
  const tile = { w: 8, h: 8, subs: [circleSub(0, 0, 5)] };
  const r = computePattern({ tile, target: [rectSub(0, 0, 40, 40)], holes: [] }, opts({ output: 'areas', edge: 'clip' }));
  assert.equal(r.error, undefined);
  assert.ok(r.subs.every((s) => s.closed));
  assert.ok(allInside(r.subs, 0, 0, 40, 40, 0.05));
});

test('fragments at the edge are dropped', () => {
  // dashes of 9 mm with 1 mm gaps; the target ends 0.25 mm after a dash starts
  const tile = { w: 10, h: 10, subs: [{ closed: false, nodes: [{ x: -5, y: 0 }, { x: 4, y: 0 }] }] };
  const r = computePattern({ tile, target: [rectSub(0, -20, 15.4, 40)], holes: [] }, opts({ edge: 'clip', offsetX: 2.45 }));
  assert.ok(r.subs.every((s) => subLength(s) >= 0.5 - 1e-6));
  assert.ok(r.warnings.length > 0);
});

test('tile count is limited', () => {
  const tile = { w: 0.1, h: 0.1, subs: [rectSub(-0.04, -0.04, 0.08, 0.08)] };
  const r = computePattern({ tile, target: [rectSub(0, 0, 500, 500)], holes: [] }, opts({}));
  assert.ok(r.error && r.error.includes(String(MAX_TILES).slice(0, 2)), r.error);
});

test('every bundled pattern fills a circle', () => {
  for (const p of builtinPatterns()) {
    const r = computePattern({ tile: p.spec.tile, target: [circleSub(50, 50, 40)], holes: [] }, opts({ ...p.spec.settings, margin: 2 }));
    assert.equal(r.error, undefined, `${p.id}: ${r.error}`);
    assert.ok(r.tiles > 5 && r.subs.length > 0, p.id);
    assert.ok(patternPreviewSvg(p.spec).startsWith('<svg'), p.id);
  }
});

test('library entry with a pattern survives saving and reading', () => {
  const p = builtinPatterns()[0];
  const a = patternAsset('Waben', p.spec, ['hex']);
  const back = parseAsset(assetJson(a));
  assert.equal(back.category, 'pattern');
  assert.deepEqual(back.pattern, p.spec);
  assert.equal((assetMeta(back) as Record<string, unknown>).pattern, undefined);
  // without pattern data a pattern entry becomes a motif
  const plain = parseAsset({ name: 'x', category: 'pattern', objs: a.objs });
  assert.equal(plain.category, 'motif');
  assert.throws(() => parseAsset({ name: 'x', category: 'pattern', objs: a.objs, pattern: { tile: { w: -1, h: 2, subs: [] } } }));
  const s = sanitizePatternSpec({ tile: p.spec.tile, settings: { repeat: 'nope', scale: 999 } }, 'x');
  assert.equal(s.settings.repeat, 'grid');
  assert.equal(s.settings.scale, 20);
});

test('parametric object: generator builds, edits and checks the recipe', () => {
  const g = getGenerator('pattern-fill')!;
  assert.ok(g === PATTERN_GEN);
  const recipe = { v: 1 as const, tile: squareTile, target: [rectSub(-20, -15, 40, 30)], holes: [], name: 'Quadrate' };
  const o = opts({ offsetX: 5 });
  const params = normalizeParams(g, paramsFromOptions(o, recipe));
  assert.deepEqual(optionsFromParams(params), o);
  const b = buildGen(g, params);
  assert.equal(b.issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(b.issues));
  assert.equal(b.parts.length, 1);
  near(total(b.parts[0].shape.subs), 5 * 30 + 4 * 40, 0.05);
  assert.ok(/Quadrate/.test(g.label(params)));
  assert.equal(parseRecipe(String(params.recipe)).name, 'Quadrate');
  const bad = buildGen(g, { ...params, recipe: '{"v":1}' });
  assert.equal(bad.parts.length, 0);
  assert.ok(bad.issues.some((i) => i.level === 'error'));
  // same input: the cached result is reused
  assert.equal(runPattern(String(params.recipe), o), runPattern(String(params.recipe), o));
});

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
console.log('all pattern tests passed');
