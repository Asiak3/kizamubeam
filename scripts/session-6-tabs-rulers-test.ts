// S6: gruppierte Tabs (Expand-Status, Persistenz, Opt-out) und Linealmenü.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc } from '../src/model';
import { hexHue, loadGroupedTabs, loadTabPages, makeTab, projectHue, tabColor, tabHue } from '../src/editor/tabs';
import { rulerContextGroups } from '../src/editorContext';
import { guideContextGroups } from '../src/guideDialog';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }

function editor(): Editor {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', nodeSets: new Map(), segmentSets: new Map(),
    handleSets: new Map(), nodeSel: new Set(), nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null,
    vectorPreview: null, drag: null, draft: null, history: new History(), batching: false,
    view: { zoom: 1, ox: 0, oy: 0 }, listeners: new Set(), isolation: null, builderSession: null,
    snapGrid: false, snapObjects: true, alignGuides: [], space: false, currentLayer: 0, snapHit: null,
    snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    tabs: [], tabIndex: 0, grid: { show: true, spacing: 10, divisions: 1, every: 0, opacity: 100 },
    canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.saveNow = () => {}; ed.syncTextLinks = () => {};
  ed.snapshot = () => {}; ed.emit = () => {};
  return ed;
}

await test('grouped tabs default to on', () => {
  assert.equal(loadGroupedTabs(), true);
});

await test('expand state toggles and serializes', () => {
  const ed = editor();
  const a = makeTab(newDoc(), 'A', false, true);
  const b = makeTab(newDoc(), 'B', false, false);
  ed.tabs = [a, b]; ed.tabIndex = 0; ed.doc = a.doc;
  assert.equal(ed.tabs[1].expanded, false);
  ed.toggleTabExpanded(1);
  assert.equal(ed.tabs[1].expanded, true);
  const json = ed.tabsJson(JSON.stringify(ed.doc));
  const parsed = JSON.parse(json) as { tabs: { expanded: boolean }[] };
  assert.deepEqual(parsed.tabs.map((x) => x.expanded), [true, true]);
});

await test('ruler menu offers grid, snap and guide actions', () => {
  const ed = editor();
  const groups = rulerContextGroups(ed, 100, 5);
  const ids = groups.flat().map((g) => g.id);
  for (const id of ['ruler-grid-show', 'ruler-grid-settings', 'ruler-snap-grid', 'ruler-snap-objects',
    'ruler-guides-show', 'ruler-guides-lock', 'ruler-guide-add']) assert.ok(ids.includes(id), id);
});

await test('ruler menu adds a vertical guide on top ruler', () => {
  const ed = editor();
  const before = (ed.doc.guides ?? []).length;
  const add = rulerContextGroups(ed, 100, 5).flat().find((g) => g.id === 'ruler-guide-add')!;
  assert.match(add.label, /Senkrechte/);
  (add.run as () => void)();
  assert.equal((ed.doc.guides ?? []).length, before + 1);
  assert.equal(ed.doc.guides!.at(-1)!.axis, 'x');
});

await test('ruler menu adds a horizontal guide on left ruler', () => {
  const ed = editor();
  const add = rulerContextGroups(ed, 5, 100).flat().find((g) => g.id === 'ruler-guide-add')!;
  assert.match(add.label, /Waagrechte/);
  (add.run as () => void)();
  assert.equal(ed.doc.guides!.at(-1)!.axis, 'y');
});

await test('guide position updates with undo stamp and doc event', () => {
  const ed = editor();
  let snapshots = 0, docs = 0;
  ed.snapshot = () => { snapshots++; };
  ed.emit = (w: string) => { if (w === 'doc') docs++; };
  ed.pushGuide({ axis: 'x', v: 10 });
  ed.setGuidePos(0, 42.5);
  assert.equal(ed.doc.guides![0].v, 42.5);
  assert.equal(snapshots, 1);
  assert.equal(docs, 1);
});

await test('guide position ignores invalid index, same value and NaN', () => {
  const ed = editor();
  let snapshots = 0;
  ed.snapshot = () => { snapshots++; };
  ed.pushGuide({ axis: 'y', v: 7 });
  ed.setGuidePos(3, 9);
  ed.setGuidePos(0, 7);
  ed.setGuidePos(0, NaN);
  assert.equal(ed.doc.guides![0].v, 7);
  assert.equal(snapshots, 0);
});

await test('guide menu offers position and single delete', () => {
  const ed = editor();
  ed.pushGuide({ axis: 'x', v: 10 });
  ed.pushGuide({ axis: 'y', v: 20 });
  const groups = guideContextGroups(ed, 0);
  const ids = groups.flat().map((g) => g.id);
  for (const id of ['guide-position', 'guide-delete', 'guide-clear']) assert.ok(ids.includes(id), id);
  assert.equal(guideContextGroups(ed, 5).length, 0);
});

await test('guide menu delete removes exactly that guide', () => {
  const ed = editor();
  ed.pushGuide({ axis: 'x', v: 10 });
  ed.pushGuide({ axis: 'y', v: 20 });
  const del = guideContextGroups(ed, 1).flat().find((g) => g.id === 'guide-delete')!;
  (del.run as () => void)();
  assert.deepEqual(ed.doc.guides!.map((g) => g.v), [10]);
});

await test('project accent hue is stable and in range', () => {
  assert.equal(projectHue(1), projectHue(1));
  assert.ok(projectHue(1) >= 0 && projectHue(1) < 360);
  assert.notEqual(projectHue(1), projectHue(2));
});

await test('manual tab color overrides the stable hue and persists', () => {
  assert.equal(hexHue('#ff0000'), 0);
  assert.equal(hexHue('#00ff00'), 120);
  assert.equal(hexHue('#0000ff'), 240);
  assert.equal(hexHue('rot'), null);
  assert.equal(hexHue('#12345'), null);
  const ed = editor();
  const a = makeTab(newDoc(), 'A');
  ed.tabs = [a]; ed.tabIndex = 0; ed.doc = a.doc;
  assert.equal(tabHue(a), projectHue(a.id));
  let redraws = 0, saves = 0;
  ed.redraw = () => { redraws++; };
  ed.saveNow = () => { saves++; };
  ed.setTabColor(0, '#00ff00');
  assert.equal(a.color, '#00ff00');
  assert.equal(tabHue(a), 120);
  assert.equal(saves, 1);
  const json = ed.tabsJson(JSON.stringify(ed.doc));
  assert.equal((JSON.parse(json) as { tabs: { color: string | null }[] }).tabs[0].color, '#00ff00');
  ed.setTabColor(0, 'ungültig');
  assert.equal(a.color, null);
  assert.equal(tabHue(a), projectHue(a.id));
});

await test('page sub-tabs default to visible', () => {
  assert.equal(loadTabPages(), true);
});

await test('guide highlight hovers, pins and resets', () => {
  const ed = editor();
  let redraws = 0;
  ed.redraw = () => { redraws++; };
  assert.equal(ed.guideHi(), -1);
  ed.setGuideHover(0);
  assert.equal(ed.guideHi(), -1);
  assert.equal(redraws, 0);
  ed.pushGuide({ axis: 'x', v: 10 });
  ed.pushGuide({ axis: 'y', v: 20 });
  ed.setGuideHover(1);
  assert.equal(ed.guideHi(), 1);
  assert.equal(redraws, 1);
  ed.setGuideHover(1);
  assert.equal(redraws, 1);
  ed.setGuideHover(null);
  assert.equal(ed.guideHi(), -1);
  ed.toggleGuidePin(0);
  assert.equal(ed.guideHi(), 0);
  ed.setGuideHover(1);
  assert.equal(ed.guideHi(), 1);
  ed.setGuideHover(null);
  assert.equal(ed.guideHi(), 0);
  ed.toggleGuidePin(0);
  assert.equal(ed.guideHi(), -1);
  ed.toggleGuidePin(5);
  assert.equal(ed.guideHi(), -1);
  ed.toggleGuidePin(0);
  ed.removeGuide(0);
  assert.equal(ed.guideHi(), -1);
});

await test('tabColor returns the manual choice verbatim, hue fallback otherwise', () => {
  const plain = makeTab(newDoc(), 'P');
  assert.equal(tabColor(plain), `hsl(${projectHue(plain.id)} 70% 55%)`);
  const gray = makeTab(newDoc(), 'G');
  gray.color = '#808080';
  assert.equal(tabColor(gray), '#808080');
  assert.equal(tabHue(gray), hexHue('#808080'));
  const black = makeTab(newDoc(), 'B');
  black.color = '#000000';
  assert.equal(tabColor(black), '#000000');
});

await test('foreign page rename goes through switch and undoable rename', () => {
  const ed = editor();
  const a = makeTab(newDoc(), 'A');
  const b = makeTab(newDoc(), 'B');
  for (const t of [a, b]) t.view = { zoom: 1, ox: 0, oy: 0 };
  ed.tabs = [a, b]; ed.tabIndex = 0; ed.doc = a.doc;
  let snapshots = 0, saves = 0, docs = 0;
  ed.snapshot = () => { snapshots++; };
  ed.saveNow = () => { saves++; };
  ed.emit = (w: string) => { if (w === 'doc') docs++; };
  ed.switchTab(1);
  assert.equal(ed.tabIndex, 1);
  assert.ok(saves >= 1);
  const oldName = ed.doc.pages[0].name;
  ed.renamePage(0, ' Neu ');
  assert.equal(ed.doc.pages[0].name, 'Neu');
  assert.equal(snapshots, 1);
  assert.ok(docs >= 1);
  ed.renamePage(0, 'Neu');
  ed.renamePage(0, '   ');
  assert.equal(snapshots, 1);
  assert.equal(ed.doc.pages[0].name, 'Neu');
  assert.notEqual(oldName, 'Neu');
  const json = JSON.parse(ed.tabsJson(JSON.stringify(ed.doc))) as { active: number; tabs: unknown[] };
  assert.equal(json.active, 1);
  assert.equal(json.tabs.length, 2);
});

console.log(`DONE ${count} tests`);
