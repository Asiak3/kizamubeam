// The plugins in plugins/ that are written in TypeScript (#307–#309): built from source, the catalogue check, and
// the geometry each one promises.
// Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const { parsePack } = await import('../src/packs');
const { checkPlugin } = await import('../src/plugins/headless');
const { pluginGenerator } = await import('../src/plugins/generator');
const G = await import('../src/generators/index');
const font = await import('../plugins/sdk/ts/font');

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

/** Build a plugin folder (esbuild in a child process) and return its generator */
async function load(dir: string) {
  execFileSync('node', ['scripts/plugin-pack.mjs', '--build', dir], { stdio: 'ignore' });
  const m = parsePack(buildPluginPack(dir)).plugins[0];
  const r = await checkPlugin(m);
  assert.deepEqual(r.errors, [], `${dir}: catalogue check`);
  assert.deepEqual(r.warnings, [], `${dir}: catalogue check warnings`);
  return pluginGenerator(m, { id: dir, name: dir });
}
const run = (g: Awaited<ReturnType<typeof load>>, p: Record<string, unknown> = {}) => G.buildGenAsync(g, G.normalizeParams(g, { ...G.defaultParams(g), ...p }));

await test('stroke font: every digit and capital has a glyph, width and alignment', () => {
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.-°') assert.ok(font.hasGlyph(ch), ch);
  assert.ok(font.hasGlyph('a'), 'lower case is drawn as upper case');
  assert.equal(font.textWidth('8', 6), 4);
  const c = font.strokeText('10', 6, { align: 'center', valign: 'middle' });
  const xs = c.flatMap((s) => s.nodes.map((n) => n.x));
  const ys = c.flatMap((s) => s.nodes.map((n) => n.y));
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 0.8, 'centred');
  assert.ok(Math.abs(Math.min(...ys) + 3) < 1e-9 && Math.abs(Math.max(...ys) - 3) < 1e-9, 'middle');
  assert.ok(c.every((s) => !s.closed || s.nodes.length > 2));
});

await test('jigsaw (#307): one path per grid line, seed decides the tabs, frame and numbers', async () => {
  const g = await load('plugins/jigsaw');
  const r = await run(g);
  assert.equal(r.issues.length, 0);
  assert.equal(r.parts.length, 1);
  const subs = r.parts[0].shape.subs;
  // Border plus 3 inner rows and 5 inner columns for the default 6 × 4
  assert.equal(subs.length, 1 + 3 + 5);
  assert.ok(subs[0].closed);
  assert.ok(subs.slice(1).every((s) => !s.closed), 'inner lines are open, so no edge is cut twice');
  assert.deepEqual(r.info[0], ['Pieces', '24']);
  // Every inner line runs from border to border
  for (const s of subs.slice(1)) {
    const a = s.nodes[0], b = s.nodes.at(-1)!;
    assert.ok(Math.abs(Math.abs(a.x) - 100) < 1e-6 || Math.abs(Math.abs(a.y) - 75) < 1e-6);
    assert.ok(Math.abs(Math.abs(b.x) - 100) < 1e-6 || Math.abs(Math.abs(b.y) - 75) < 1e-6);
  }
  const same = await run(g);
  assert.deepEqual(same.parts[0].shape.subs, subs, 'same seed, same puzzle');
  const other = await run(g, { seed: 2 });
  assert.notDeepEqual(other.parts[0].shape.subs, subs, 'another seed, other tabs');
  const framed = await run(g, { frame: true, numbers: true });
  assert.deepEqual(framed.parts.map((p) => p.shape.part), ['puzzle', 'frame']);
  assert.ok((framed.parts[0].marks?.length ?? 0) >= 24, 'piece numbers engraved');
  const tiny = await run(g, { cols: 50, rows: 50, width: 100, height: 100 });
  assert.equal(tiny.parts.length, 0);
  assert.ok(tiny.issues.some((i) => i.code === 'pieces-too-small'));
  for (const shape of ['round', 'square']) assert.equal((await run(g, { shape })).issues.length, 0, shape);
  g.dispose();
});

await test('ruler (#308): ticks at exact positions, inch divisions, protractor, dial with own labels', async () => {
  const g = await load('plugins/ruler');
  const r = await run(g);
  assert.equal(r.issues.length, 0);
  const part = r.parts[0];
  // Ticks are the two-node marks that start on the top edge; 150 mm in 1 mm steps
  const top = -15;
  const xs = part.marks!.filter((s) => s.nodes.length === 2 && Math.abs(s.nodes[0].y - top) < 1e-9 && s.nodes[0].x === s.nodes[1].x).map((s) => s.nodes[0].x);
  assert.equal(xs.length, 151);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 1) < 1e-9, 'exactly 1 mm apart');
  assert.deepEqual(r.info.find(([k]) => k === 'Ticks'), ['Ticks', '151']);
  const inch = await run(g, { units: 'inch', inches: 6, sub: '16' });
  assert.deepEqual(inch.info.find(([k]) => k === 'Ticks'), ['Ticks', '97']);
  assert.deepEqual(inch.info[0], ['Scale length', '152.4 mm']);
  const pro = await run(g, { type: 'protractor' });
  assert.deepEqual(pro.info.find(([k]) => k === 'Ticks'), ['Ticks', '181']);
  assert.ok(pro.info.some(([k]) => k === 'Number height (fitted)'), 'numbers shrink so neighbours do not touch');
  const odd = await run(g, { type: 'protractor', sweep: 175 });
  assert.ok(odd.issues.some((i) => i.code === 'sweep-tens'));
  const dial = await run(g, { type: 'dial', sweep: 360, divisions: 12, minorPer: 5 });
  assert.deepEqual(dial.info.find(([k]) => k === 'Ticks'), ['Ticks', '60'], 'a full dial has no doubled tick at 360°');
  const own = await run(g, { type: 'dial', sweep: 270, labels: 'MIN,,MAX', divisions: 2, minorPer: 1 });
  const plain = await run(g, { type: 'dial', sweep: 270, labels: '', divisions: 2, minorPer: 1, numbers: false });
  assert.ok(own.parts[0].marks!.length > plain.parts[0].marks!.length + 4, 'own labels drawn');
  g.dispose();
});

await test('game board (#309): dark squares like a chessboard, styles, coordinates, size with border', async () => {
  const g = await load('plugins/game-board');
  const r = await run(g);
  assert.equal(r.issues.length, 0);
  assert.deepEqual(r.info, [['Square', '40 mm'], ['Board size', '350 × 350 mm'], ['Dark squares', '32']]);
  const marks = r.parts[0].marks!;
  // Fill style: 32 closed squares of 40 mm plus the frame; a1 (bottom left) is dark, h1 (bottom right) is light
  const squares = marks.filter((s) => s.closed && s.nodes.length === 4 && Math.abs(s.nodes[1].x - s.nodes[0].x - 40) < 1e-9);
  assert.equal(squares.length, 32);
  assert.ok(squares.some((s) => s.nodes[0].x === -160 && s.nodes[0].y === 120), 'a1 dark');
  assert.ok(!squares.some((s) => s.nodes[0].x === 120 && s.nodes[0].y === 120), 'h1 light');
  const hatch = await run(g, { style: 'hatch', coords: false });
  const diagonals = hatch.parts[0].marks!.filter((s) => !s.closed && s.nodes.length === 2 && s.nodes[0].x !== s.nodes[1].x && s.nodes[0].y !== s.nodes[1].y);
  assert.ok(diagonals.length > 100);
  assert.ok(diagonals.every((s) => s.nodes.every((n) => Math.abs(n.x) <= 160 + 1e-9 && Math.abs(n.y) <= 160 + 1e-9)), 'hatch stays inside the squares');
  const cross = await run(g, { style: 'crosshatch', coords: false });
  assert.ok(cross.parts[0].marks!.length > hatch.parts[0].marks!.length);
  const outer = await run(g, { sizeIncludesBorder: true, size: 350 });
  assert.deepEqual(outer.info[1], ['Board size', '350 × 350 mm']);
  assert.deepEqual(outer.info[0], ['Square', '40 mm']);
  const bare = await run(g, { coords: false });
  const coords = await run(g, { bothSides: true });
  assert.ok(coords.parts[0].marks!.length > r.parts[0].marks!.length && r.parts[0].marks!.length > bare.parts[0].marks!.length);
  const draughts = await run(g, { cols: 10, rows: 10 });
  assert.deepEqual(draughts.info[2], ['Dark squares', '50']);
  const tiny = await run(g, { cols: 30, rows: 30, size: 60 });
  assert.ok(tiny.issues.some((i) => i.code === 'squares-too-small'));
  g.dispose();
});

await test('stencil bridges (#311): counters and nested islands get bridges, the result is closed paths', async () => {
  const { pluginTool } = await import('../src/plugins/tool');
  execFileSync('node', ['scripts/plugin-pack.mjs', '--build', 'plugins/stencil-bridges'], { stdio: 'ignore' });
  const m = parsePack(buildPluginPack('plugins/stencil-bridges')).plugins[0];
  const check = await checkPlugin(m);
  assert.deepEqual(check.errors, [], 'catalogue check');
  assert.deepEqual(check.warnings, [], 'catalogue check warnings');
  const tool = pluginTool(m, { id: 'stencil', name: 'stencil' });
  const params = (p: Record<string, unknown>) => G.normalizeParams(tool, { ...G.defaultParams(tool), ...p });
  const sq = (x: number, y: number, w: number, h = w) => ({ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
  const circle = (cx: number, cy: number, r: number) => {
    const k = 0.5523 * r;
    return { closed: true, nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k } },
      { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r } },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k } },
      { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r } },
    ] };
  };
  // An "O" (ring), an "8"-like block with two counters, a ring inside a ring, and a plain bar
  const objects = [
    { id: 'o', subs: [circle(0, 0, 20), circle(0, 0, 12)] },
    { id: 'eight', subs: [sq(50, -20, 20, 40), sq(54, -16, 12, 12), sq(54, 4, 12, 12)] },
    { id: 'rings', subs: [circle(120, 0, 30), circle(120, 0, 24), circle(120, 0, 14), circle(120, 0, 8)] },
    { id: 'bar', subs: [sq(170, -5, 40, 10)] },
  ];
  const ys = (subs: { nodes: { y: number }[] }[]) => subs.flatMap((s) => s.nodes.map((n) => n.y));
  const r = await tool.run(params({ width: 2, count: '1', direction: 'vertical' }), { objects });
  const by = (id: string) => r.objects!.find((o) => o.from === id)!;
  assert.deepEqual(r.info, [['Islands', '5'], ['Bridges', '5']]);
  assert.deepEqual(r.issues, []);
  // The O is cut through above its counter: one closed outline (a "C" shape) instead of two
  assert.equal(by('o').subs.length, 1);
  assert.ok(by('o').subs.every((s) => s.closed));
  assert.equal(by('eight').subs.length, 1, 'both counters bridged upwards: one outline');
  assert.equal(by('rings').subs.length, 2, 'outer and inner ring each opened once');
  assert.deepEqual(by('bar').subs, objects[3].subs, 'nothing to bridge: unchanged');
  // Two bridges per island: the O falls into two halves
  const two = await tool.run(params({ width: 2, count: '2', direction: 'vertical' }), { objects: [objects[0]] });
  assert.equal(two.objects![0].subs.length, 2);
  assert.deepEqual(two.info[1], ['Bridges', '2']);
  // Horizontal bridges on the O leave the top and bottom of the ring whole
  const h = await tool.run(params({ width: 2, count: '1', direction: 'horizontal' }), { objects: [objects[0]] });
  assert.ok(Math.min(...ys(h.objects![0].subs)) < -19.9 && Math.max(...ys(h.objects![0].subs)) > 19.9);
  // Shortest: a wide frame with a thin top bar is bridged through the thin bar
  const frame = { id: 'f', subs: [sq(0, 0, 60, 40), sq(4, 1, 52, 30)] };
  const s = await tool.run(params({ width: 2, count: '1', direction: 'shortest' }), { objects: [frame] });
  const cut = s.objects![0].subs[0].nodes;
  assert.ok(cut.some((n) => n.y < 1e-6) && !cut.some((n) => Math.abs(n.y - 40) < 1e-6 && n.x > 29 && n.x < 31), 'cut at the top (1 mm), not the bottom (9 mm)');
  // Nested islands left out, auto count by size, nothing closed
  const nested = await tool.run(params({ width: 2, count: 'auto', autoSize: 25, nested: false }), { objects: [objects[2]] });
  assert.deepEqual(nested.info, [['Islands', '1'], ['Bridges', '2']]);
  assert.equal(nested.issues[0].msg, '1 nested islands stay without a bridge.');
  const none = await tool.run(params({}), { objects: [{ id: 'l', subs: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }] }] });
  assert.equal(none.objects, undefined);
  assert.equal(none.issues[0].msg, 'Select closed shapes or text.');
  const wide = await tool.run(params({ width: 15, count: '1' }), { objects: [objects[1]] });
  assert.equal(wide.issues[0].msg, '2 bridges are wider than their island.');
  tool.dispose();
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
