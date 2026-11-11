// Synthetic geometry and real editor methods; file/native/application boundaries are denied by the harness.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, newId, defaultLayer, defaultImageLayer } = await import('../src/model');
const { shapeRegions, regionContains, mergeRegions, regionsAlong } = await import('../src/shapeRegions');
const { canEnterIsolation, editorContextGroups } = await import('../src/editorContext');
const { commandKey, commandMatches } = await import('../src/commandKeys');
const { buildJob, newDevice } = await import('../src/gcode');
const { buildGen, defaultParams } = await import('../src/generators');
const { GEAR } = await import('../src/generators/gear');
type Obj = import('../src/model').Obj;
type E = import('../src/editor').Editor;
let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
const rect = (x = 30, y = 30, w = 20, h = 20): Obj => ({ id: newId(), m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w, h, r: 0 } });
function editor(objects: Obj[]): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets:new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: false, snapObjects: false, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.doc.objs = [...objects]; ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}
const event = (x: number, y: number, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1,
  shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...extra }) as PointerEvent;
const callbacks = { adjust() {}, trace() {}, background() {}, saveBitmap() {}, vectorFit() {}, builder() {}, library() {}, preview() {}, objects() {} };
const entries = (ed: E, blank = false) => editorContextGroups(ed, callbacks, blank).flat().flatMap((a) => [a, ...(a.items ?? [])]);

await test('overlapping rectangles form three exclusive clickable regions', () => {
  const faces = shapeRegions([rect(), rect(40)]);
  assert.equal(faces.length, 3);
  for (const x of [35, 45, 55]) assert.equal(faces.filter((f) => regionContains(f, x, 40)).length, 1);
  assert.equal(mergeRegions(faces).length, 1);
  assert.equal(regionsAlong(faces, { x: 31, y: 40 }, { x: 59, y: 40 }).length, 3);
});
await test('holes remain holes, including after merging', () => {
  const a = rect(); a.shape = { kind: 'path', subs: [
    { nodes: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], closed: true },
    { nodes: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }], closed: true }] };
  const faces = shapeRegions([a]); assert.equal(faces.length, 1); assert.equal(faces[0].subs.length, 2);
  assert.equal(regionContains(faces[0], 40, 40), false); assert.equal(regionContains(faces[0], 32, 32), true);
});
await test('work cap rejects excessive input', () => assert.throws(() => shapeRegions(Array.from({ length: 33 }, () => rect()))));
await test('Shape Builder preserves parametric source, transforms and parameters in one Undo', async () => {
  const result = buildGen(GEAR, defaultParams(GEAR)); assert.ok(result.parts.length);
  const source: Obj = { id: newId(), m: [1, 0, 0, 1, 100, 100], layer: 0, name: 'Synthetic parametric gear', shape: result.parts[0].shape };
  const before = JSON.stringify(source), ed = editor([source]);
  assert.ok(await ed.startShapeBuilder()); assert.equal(JSON.stringify(source), before); assert.equal(ed.history.position, 0);
  ed.builderSession!.picked.add(0); assert.ok(ed.commitShapeBuilder());
  assert.equal(source.shape.kind, 'gen'); assert.equal(source.noLaser, true);
  const copy = { ...source }; delete copy.noLaser; assert.equal(JSON.stringify(copy), before);
  assert.equal(ed.history.position, 1); assert.ok(ed.sel.every((o) => o.shape.kind === 'path'));
  ed.doUndo(); assert.equal(JSON.stringify(ed.doc.objs[0]), before); assert.equal(ed.builderSession, null);
});
await test('erase overlap preserves unselected faces and original source geometry', async () => {
  const a = rect(), b = rect(40), ed = editor([a, b]); assert.ok(await ed.startShapeBuilder());
  const s = ed.builderSession!; s.erase = true; s.picked.add(s.faces.findIndex((f) => regionContains(f, 45, 40)));
  assert.ok(ed.commitShapeBuilder()); assert.equal(ed.sel.length, 2); assert.equal(a.shape.kind, 'rect'); assert.equal(b.shape.kind, 'rect');
  assert.equal(ed.history.position, 1); assert.ok(ed.builderSession!.faces.every((f) => !regionContains(f, 45, 40)));
});
await test('pointer stroke connects regions; cancel makes no edit', async () => {
  const ed = editor([rect(), rect(40)]); await ed.startShapeBuilder(); const before = ed.state();
  ed.onDown(event(31, 40)); ed.onMove(event(59, 40)); ed.cancelDrag(); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
  ed.onDown(event(31, 40)); ed.onMove(event(59, 40)); ed.onUp(event(59, 40));
  assert.equal(ed.sel.length, 1); assert.equal(ed.history.position, 1);
});
await test('open lines and stale source are rejected without edits', async () => {
  const a = rect(); a.shape = { kind: 'path', subs: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 20, y: 20 }] }] };
  const ed = editor([a]), before = ed.state(); assert.equal(await ed.startShapeBuilder(), false); assert.equal(ed.state(), before);
  ed.doc.objs = [rect(), rect(40)]; ed.sel = [...ed.doc.objs]; assert.ok(await ed.startShapeBuilder());
  ed.builderSession!.picked.add(0); ed.sel[0].m[4] += 1; assert.equal(ed.commitShapeBuilder(), false); assert.equal(ed.history.position, 0);
});
await test('retained noLaser originals never become laser output implicitly', async () => {
  const a = rect(); a.noLaser = true; const ed = editor([a]); assert.ok(await ed.startShapeBuilder());
  ed.builderSession!.picked.add(0); ed.commitShapeBuilder(); assert.ok(ed.sel.every((o) => o.noLaser));
});
await test('async builder start rejects changed selection, tool and document', async () => {
  for (const change of [(ed: E) => ed.setSel([]), (ed: E) => ed.setTool('node'),
    (ed: E) => { ed.doc = newDoc(); }, (ed: E) => { ed.pickHandler = () => {}; }]) {
    const ed = editor([rect()]); let finish!: (objects: Obj[]) => void;
    ed.withTextOutlines = () => new Promise<Obj[]>((resolve) => { finish = resolve; });
    const objects = [...ed.sel], pending = ed.startShapeBuilder(); change(ed); finish(objects);
    assert.equal(await pending, false); assert.equal(ed.builderSession, null); assert.equal(ed.history.position, 0);
  }
});
await test('mixed output states are refused without mutation', async () => {
  const a = rect(), b = rect(40); b.noLaser = true;
  const ed = editor([a, b]), before = ed.state();
  assert.equal(await ed.startShapeBuilder(), false); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
});
await test('repeated builder strokes replace only derived objects and undo independently', async () => {
  const a = rect(), b = rect(40), ed = editor([a, b]), before = ed.state();
  assert.ok(await ed.startShapeBuilder()); ed.builderSession!.picked.add(0); assert.ok(ed.commitShapeBuilder());
  const first = ed.state(), derived = [...ed.sel];
  ed.builderSession!.picked.add(0); ed.builderSession!.erase = true; assert.ok(ed.commitShapeBuilder());
  assert.equal(ed.history.position, 2); assert.ok(ed.doc.objs.includes(a) && ed.doc.objs.includes(b));
  assert.ok(derived.every((o) => !ed.doc.objs.includes(o)));
  ed.doUndo(); assert.equal(ed.state(), first); ed.doUndo(); assert.equal(ed.state(), before);
});
await test('isolation and builder reset on history and page transitions', async () => {
  const ed = editor([rect()]), before = ed.state(); ed.isolateSelection();
  assert.ok(await ed.startShapeBuilder()); ed.builderSession!.picked.add(0); ed.commitShapeBuilder();
  ed.doUndo(); assert.equal(ed.isolation, null); assert.equal(ed.builderSession, null); assert.equal(ed.tool, 'select');
  assert.equal(ed.state(), before); ed.isolateSelection(); assert.ok(await ed.startShapeBuilder());
  ed.clearPageState(); assert.equal(ed.isolation, null); assert.equal(ed.builderSession, null); assert.equal(ed.tool, 'select');
});
await test('groups with unsupported nested content are refused intact', async () => {
  const group = rect(); group.shape = { kind: 'group', children: [rect(), { ...rect(), hidden: true }] };
  const ed = editor([group]), before = ed.state(); assert.equal(await ed.startShapeBuilder(), false);
  assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
});
await test('isolation is not serialized and does not alter properties, output or Undo', async () => {
  const a = rect(), b = rect(100), ed = editor([a]); ed.doc.objs.push(b); ed.doc.layers[0] = defaultLayer(0);
  const before = ed.state();
  const job = async () => { const j = await buildJob({ doc: ed.doc, layer: (i) => ({ ...defaultLayer(i), mode: 'line' }), imgLayer: defaultImageLayer, device: newDevice({ fw: 'grbl' }) });
    return { n: j.moves.n, x: Array.from(j.moves.x), y: Array.from(j.moves.y), power: Array.from(j.moves.s), feed: Array.from(j.moves.f), z: Array.from(j.moves.z), layer: Array.from(j.moves.layer) }; };
  const output = await job(); assert.ok(ed.isolateSelection());
  assert.equal(ed.state(), before); assert.deepEqual(await job(), output); assert.equal(ed.history.position, 0);
  assert.deepEqual(ed.viewObjects(), [a]); assert.equal(ed.selectable(b), false); ed.selectAll(); assert.deepEqual(ed.sel, [a]);
  ed.doc.objs = [b]; assert.equal(ed.hitTest({ x: 110, y: 40 }), null); ed.doc.objs = [a, b];
  ed.leaveIsolation(); assert.equal(ed.state(), before); assert.equal(ed.selectable(b), true);
});
await test('isolation adopts new objects but rejects selecting existing outsiders', () => {
  const a = rect(), b = rect(100), ed = editor([a]); ed.doc.objs.push(b); ed.isolateSelection();
  ed.setSel([b]); assert.equal(ed.sel.length, 0);
  const c = rect(150); ed.doc.objs.push(c); ed.setSel([c]); ed.emit('doc');
  assert.deepEqual(ed.viewObjects(), [a, c]); assert.deepEqual(ed.sel, [c]);
  ed.clearPageState(); assert.equal(ed.isolation, null);
});
await test('isolation snap set excludes outside geometry', () => {
  const a = rect(), b = rect(100), ed = editor([a]); ed.doc.objs.push(b); ed.isolateSelection();
  let seen: Obj[] | null = null; const previous = ed.viewObjects;
  ed.viewObjects = function () { seen = previous.call(this); return seen; }; ed.buildSnap(); assert.deepEqual(seen, [a]);
});
await test('menu variants gate bitmap, vector and node commands correctly', () => {
  const a = rect(), ed = editor([a]); assert.ok(entries(ed).some((e) => e.id === 'vectorfit'));
  assert.ok(!entries(ed).some((e) => e.id === 'trace'));
  ed.tool = 'node'; assert.ok(entries(ed).some((e) => e.label.includes('Knoten') && e.id === 'delete'));
  ed.tool = 'select'; const image = rect(); image.shape = { kind: 'image', asset: 'synthetic-not-loaded', w: 20, h: 20, adjust: {} } as Obj['shape'];
  ed.doc.objs.push(image); ed.setSel([image]); assert.ok(entries(ed).find((e) => e.id === 'trace')!.enabled);
  const image2 = { ...image, id: newId() }; ed.doc.objs.push(image2); ed.setSel([image, image2]);
  assert.equal(entries(ed).find((e) => e.id === 'trace')!.enabled, false); assert.equal(entries(ed).find((e) => e.id === 'save-bitmap')!.enabled, false);
  assert.ok(entries(ed, true).every((e) => e.id !== 'delete'));
});
await test('menu and keyboard use shared exact modifier bindings', () => {
  assert.equal(commandKey('copy'), 'Ctrl+C'); assert.equal(commandKey('paste-in-place'), '');
  assert.ok(commandMatches('copy', { key: 'c', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent));
  assert.ok(!commandMatches('copy', { key: 'c', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true } as KeyboardEvent));
});
await test('isolation action appears once at the top in vector, image, blank and node menus', () => {
  const a = rect(), ed = editor([a]);
  const check = (blank = false) => {
    const groups = editorContextGroups(ed, callbacks, blank);
    assert.equal(groups[0][0].id, 'isolate');
    assert.equal(groups.flat().filter((item) => item.id === 'isolate').length, 1);
  };
  check(); check(true); ed.tool = 'node'; check(); ed.tool = 'select';
  a.shape = { kind: 'image', asset: 'synthetic-not-loaded', w: 20, h: 20, adjust: {} } as Obj['shape']; check();
});
await test('isolation menu entry gates ongoing edits and enters then leaves real isolation', () => {
  const ed = editor([rect()]);
  const isolation = () => entries(ed).find((item) => item.id === 'isolate')!;
  assert.equal(canEnterIsolation(ed), true); assert.equal(isolation().enabled, true);
  isolation().run(); assert.ok(ed.isolation); assert.equal(canEnterIsolation(ed), false);
  assert.ok(isolation().label.includes('Isolation')); assert.equal(isolation().enabled, true);
  ed.setSel([]); assert.equal(isolation().enabled, true); isolation().run(); assert.equal(ed.isolation, null);
  ed.sel = []; assert.equal(isolation().enabled, false);
  ed.sel = [ed.doc.objs[0]]; ed.sel[0].locked = true; assert.equal(isolation().enabled, false); delete ed.sel[0].locked;
  for (const key of ['drag', 'draft', 'sketchEdit', 'pickHandler'] as const) {
    const previous = ed[key];
    Object.assign(ed, { [key]: key === 'pickHandler' ? () => {} : {} });
    assert.equal(canEnterIsolation(ed), false, key); assert.equal(isolation().enabled, false, key);
    Object.assign(ed, { [key]: previous });
  }
});
await test('right-click draft completion is reserved, not a context-menu gesture', () => {
  const ed = editor([]); ed.draft = { nodes: [{ x: 40, y: 40 }, { x: 60, y: 40 }], closed: false };
  ed.onDown(event(60, 40, { button: 2 })); assert.equal(ed.suppressContextMenu, true);
});
console.log(`Interaction prototypes: ${count} checks passed without hardware/app startup.`);
