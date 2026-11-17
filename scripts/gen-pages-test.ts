// Generator output over several pages (#387): page groups, distribution over pages with the app's nesting, parts
// larger than the work area, one undo step, save and reopen, and new parts after a parameter change.
// Run: npm run test:generators
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer, loadDoc, leaves } = await import('../src/model');
const { boundsOf } = await import('../src/geom');
const { register, buildGen, GENERATORS, getGenerator } = await import('../src/generators/index');
type Obj = import('../src/model').Obj;
type Params = import('../src/generators/types').Params;

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

const sq = (w: number, h = w) => [{ closed: true, nodes: [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }] }];
// n parts of size w × h; mode: flat (one block), groups (two parts per page group), auto (distribute)
register({
  id: 'pages-test', version: 1, kind: 'assembly', name: 'Pages', icon: 'box',
  schema: [
    { key: 'n', label: 'n', type: 'int', min: 1, max: 40, def: 6 },
    { key: 'w', label: 'w', type: 'length', min: 1, max: 1000, def: 150 },
    { key: 'h', label: 'h', type: 'length', min: 1, max: 1000, def: 150 },
    { key: 'big', label: 'big', type: 'length', min: 0, max: 2000, def: 0 },
    { key: 'mode', label: 'mode', type: 'enum', options: [['flat', 'flat'], ['groups', 'groups'], ['auto', 'auto']], def: 'auto' },
    { key: 'rotate', label: 'rotate', type: 'bool', def: false },
  ],
  validate: () => [],
  generate: (p: Params) => {
    const n = p.n as number, w = p.w as number, h = p.h as number;
    const parts = Array.from({ length: n }, (_, i) => ({ key: `p${i}`, subs: sq(w, h), at: { x: i * (w + 5), y: 0 }, ...(p.mode === 'groups' ? { page: Math.floor(i / 2) } : {}) }));
    if (p.big) parts.push({ key: 'big', subs: sq(p.big as number), at: { x: 0, y: -2000 } });
    return { parts, info: [], ...(p.mode === 'auto' ? { distribute: { rotate: !!p.rotate } } : {}) };
  },
  label: (_p: Params, part?: string) => part ?? 'Pages',
});
const g = getGenerator('pages-test')!;
const params = (o: Params = {}) => ({ ...Object.fromEntries(g.schema.map((s) => [s.key, s.def])), ...o });

function editor() {
  const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
  Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(), nodeSel: new Set(), nodeSets: new Map(),
    segmentSets: new Map(), handleSets: new Map(), clipboard: [], drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, hint: '',
    view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
  ed.doc.layers[0] = defaultLayer(0);
  ed.doc.bed = { w: 400, h: 300 };
  return ed;
}
const partsOn = (ed: import('../src/editor').Editor, i: number) =>
  [...leaves(ed.doc.pages[i].objs)].map(([l]) => l).filter((l) => l.shape.kind === 'gen').map((l) => (l.shape as { part?: string }).part!).sort();
const inside = (ed: import('../src/editor').Editor, objs: Obj[]) => {
  for (const o of objs) {
    const b = boundsOf([o])!;
    assert.ok(b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= ed.doc.bed.w + 1e-6 && b.y + b.h <= ed.doc.bed.h + 1e-6, `inside the work area: ${JSON.stringify(b)}`);
  }
};
const overlapFree = (objs: Obj[]) => {
  const bs = objs.map((o) => boundsOf([o])!);
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      assert.ok(a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6, 'parts do not overlap');
    }
};

test('a flat result without page groups behaves as before', () => {
  const ed = editor();
  const r = buildGen(g, params({ mode: 'flat', n: 2, w: 50 }));
  assert.equal(r.distribute, undefined);
  ed.addGen(r);
  assert.equal(ed.doc.pages.length, 1);
  assert.deepEqual(partsOn(ed, 0), ['p0', 'p1']);
});

test('distribute: 6 parts of 150 mm on a 400 × 300 work area take two pages, nothing overlaps, one undo step', () => {
  const ed = editor();
  const other: Obj = { id: 999, m: [1, 0, 0, 1, 10, 10], layer: 0, shape: { kind: 'rect', w: 50, h: 50, r: 0 } };
  ed.doc.objs.push(other);
  const r = buildGen(g, params());
  assert.deepEqual(r.distribute, { rotate: false });
  assert.ok(ed.genFitsPage(r), 'every part fits on its own');
  const objs = ed.addGen(r);
  assert.equal(objs.length, 6);
  assert.ok(ed.doc.pages.length >= 2, `pages: ${ed.doc.pages.length}`);
  const all = ed.doc.pages.flatMap((_, i) => partsOn(ed, i)).sort();
  assert.deepEqual(all, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  assert.deepEqual(other.m, [1, 0, 0, 1, 10, 10], 'the other object stays');
  for (const pg of ed.doc.pages) {
    inside(ed, pg.objs);
    overlapFree(pg.objs);
  }
  assert.equal(ed.doc.page, 0, 'stays on the current page');
  assert.ok(ed.sel.length > 0 && ed.sel.every((o) => ed.doc.objs.includes(o)), 'selects the parts on the current page');
  assert.match(ed.hint, /\d+ (Seiten|pages)/);
  // Same parameters, same places (one nesting order only)
  const ed2 = editor();
  ed2.doc.objs.push({ ...other });
  ed2.addGen(buildGen(g, params()));
  assert.deepEqual(ed2.doc.pages.map((p) => p.objs.map((o) => o.m)), ed.doc.pages.map((p) => p.objs.map((o) => o.m)));
  ed.doUndo();
  assert.equal(ed.doc.pages.length, 1, 'undo removes the new pages');
  assert.deepEqual(ed.doc.objs.map((o) => o.id), [999]);
});

test('distribute with rotation turns a part that only fits turned', () => {
  const ed = editor();
  const r = buildGen(g, params({ n: 1, w: 280, h: 390 }));
  assert.ok(!ed.genFitsPage(r), 'without rotation it does not fit');
  ed.addGen(r);
  assert.match(ed.hint, /größer als der Arbeitsbereich|larger than the work area/);
  const ed2 = editor();
  const r2 = buildGen(g, params({ n: 1, w: 280, h: 390, rotate: true }));
  assert.ok(ed2.genFitsPage(r2));
  ed2.addGen(r2);
  assert.doesNotMatch(ed2.hint, /größer als der Arbeitsbereich|larger than the work area/);
  inside(ed2, ed2.doc.objs);
});

test('a part larger than the work area goes alone into the middle of its own page', () => {
  const ed = editor();
  ed.addGen(buildGen(g, params({ n: 2, w: 100, big: 600 })));
  const pg = ed.doc.pages.findIndex((_, i) => partsOn(ed, i).includes('big'));
  assert.deepEqual(partsOn(ed, pg), ['big']);
  const b = boundsOf(ed.doc.pages[pg].objs)!;
  assert.ok(Math.abs(b.x + b.w / 2 - 200) < 1e-6 && Math.abs(b.y + b.h / 2 - 150) < 1e-6, 'centred');
  assert.match(ed.hint, /größer als der Arbeitsbereich|larger than the work area/);
});

test('page groups: each group on its own page, in order, behind the current one', () => {
  const ed = editor();
  ed.doc.pages.push({ name: 'Later', objs: [] });
  const r = buildGen(g, params({ mode: 'groups', n: 5, w: 60 }));
  assert.deepEqual(r.parts.map((p) => p.page ?? 0), [0, 0, 1, 1, 2]);
  ed.addGen(r);
  assert.deepEqual(ed.doc.pages.map((p) => p.name).at(-1), 'Later', 'new pages go right behind the current page');
  assert.deepEqual([0, 1, 2].map((i) => partsOn(ed, i)), [['p0', 'p1'], ['p2', 'p3'], ['p4']]);
  for (const pg of ed.doc.pages) inside(ed, pg.objs);
});

test('save and reopen keeps the pages; a parameter change updates parts on every page and places new ones', () => {
  const ed = editor();
  ed.addGen(buildGen(g, params({ mode: 'groups', n: 4, w: 60, h: 60 })));
  const saved = JSON.parse(JSON.stringify(ed.doc));
  const doc = loadDoc(saved);
  assert.deepEqual(doc.pages.map((p) => p.objs.length), ed.doc.pages.map((p) => p.objs.length));
  const ed2 = editor();
  ed2.doc = doc;
  assert.deepEqual([0, 1].map((i) => partsOn(ed2, i)), [['p0', 'p1'], ['p2', 'p3']]);
  // Edit: bigger parts and two more (p4, p5 in group 2); p2 keeps its place on page 2
  const p2 = [...leaves(ed2.doc.pages[1].objs)].find(([l]) => (l.shape as { part?: string }).part === 'p2')![0];
  const p0 = ed2.doc.objs.find((o) => (o.shape as { part?: string }).part === 'p0')!;
  ed2.updateGen(p0, buildGen(g, params({ mode: 'groups', n: 6, w: 70, h: 70 })));
  const sub = (o: Obj) => (o.shape as { subs: { nodes: { x: number }[] }[] }).subs[0].nodes[1].x;
  assert.equal(sub(p2), 35, 'part on the other page recomputed');
  assert.ok(ed2.doc.pages[1].objs.includes(p2), 'and still on its page');
  // Each page group still in its arrangement is laid out again with the new sizes, so nothing overlaps
  overlapFree(ed2.doc.pages[0].objs.filter((o) => ['p0', 'p1'].includes((o.shape as { part?: string }).part!)));
  overlapFree(ed2.doc.pages[1].objs);
  // A part the user moved stays where it is
  p2.m = [1, 0, 0, 1, 200, 200];
  ed2.updateGen(p0, buildGen(g, params({ mode: 'groups', n: 6, w: 72, h: 72 })));
  assert.deepEqual(p2.m, [1, 0, 0, 1, 200, 200]);
  ed2.doUndo();
  const all = ed2.doc.pages.flatMap((_, i) => partsOn(ed2, i)).sort();
  assert.deepEqual(all, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  // The new parts start a page group of their own: a free spot on the current page (there is room)
  const fresh = ed2.doc.pages.flatMap((p) => p.objs).filter((o) => ['p4', 'p5'].includes((o.shape as { part?: string }).part!));
  assert.equal(fresh.length, 2);
  inside(ed2, fresh);
  overlapFree(ed2.doc.pages[ed2.doc.pages.findIndex((p) => p.objs.includes(fresh[0]))].objs);
  ed2.doUndo();
  assert.deepEqual(ed2.doc.pages.flatMap((_, i) => partsOn(ed2, i)).sort(), ['p0', 'p1', 'p2', 'p3'], 'undo in one step');
});

GENERATORS.splice(GENERATORS.indexOf(g), 1);
if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall page tests passed');
