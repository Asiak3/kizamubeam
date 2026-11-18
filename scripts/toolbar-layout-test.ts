import assert from 'node:assert/strict';
import { clone, createState, DEFAULT_VIEW, detachedId } from '../src/toolbars/model';
import type { Definitions, DockEdge, Result, ToolbarState, ViewLayout } from '../src/toolbars/model';
import { applyLayout, clampReachable, normalizeView, resetContent, resolveDetached, setLayoutLocked } from '../src/toolbars/state';
import { decode, encode, FORMAT, VERSION } from '../src/toolbars/migration';
import { createToolbarRuntime } from '../src/toolbars/runtime';

let passed = 0;
let failed = 0;
function test(name: string, run: () => void) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}:`, error);
  }
}
function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const floating: ViewLayout = { placement: { kind: 'floating', x: 120, y: 80 }, orientation: 'vertical', rows: 2, columns: 3 };
const definitions: Definitions = {
  bars: [
    { id: 'main', label: 'Main', items: [{ kind: 'action', id: 'save' }], layout: clone(DEFAULT_VIEW) },
    { id: 'tools', label: 'Tools', items: [{ kind: 'group', id: 'grp:draw' }], layout: { ...clone(DEFAULT_VIEW), placement: { kind: 'dock', edge: 'left', lane: 0, order: 0 } } },
  ],
  groups: [{ id: 'grp:draw', label: 'Draw', kind: 'flyout', items: [{ kind: 'action', id: 'line' }, { kind: 'control', id: 'width' }] }],
};
const initial = () => createState(definitions);
const detached = () => value(applyLayout(initial(), { kind: 'detach', ownerId: 'tools', groupId: 'grp:draw', view: floating }, definitions));
const roundtrip = (state: ToolbarState, defs = definitions) => value(decode(value(encode(state)), defs)).state;

for (const edge of ['top', 'right', 'bottom', 'left'] as DockEdge[]) {
  for (const lane of [0, 1, 6]) test(`insert dock lane ${lane} on ${edge} shifts hidden, absent and detached peers atomically`, () => {
    const state = initial();
    const view = (rank: number): ViewLayout => ({ ...clone(DEFAULT_VIEW), placement: { kind: 'dock', edge, lane: rank, order: 0 } });
    state.layout.bars.main = view(4);
    state.layout.bars.tools = view(0);
    state.layout.bars.absent = view(1);
    state.layout.bars.peer = view(3);
    state.content.bars.absent = [{ kind: 'action', id: 'absent-plugin' }];
    state.content.bars.peer = [];
    state.layout.hidden.push('absent');
    const id = detachedId('tools', 'grp:draw');
    state.layout.detached[id] = { ownerId: 'tools', groupId: 'grp:draw', layout: view(1) };
    state.layout.bars.otherEdge = { ...clone(DEFAULT_VIEW), placement: { kind: 'dock', edge: edge === 'top' ? 'left' : 'top', lane: 1, order: 0 } };
    const before = clone(state);
    const placed = value(applyLayout(state, { kind: 'place', target: { barId: 'main' }, view: view(lane), insert: true, insertLane: true,
      participants: [] }, definitions));
    const rank = (v: ViewLayout) => v.placement.kind === 'dock' ? v.placement.lane : -1;
    assert.equal(rank(placed.layout.bars.main), lane);
    assert.equal(rank(placed.layout.bars.tools), 0 >= lane ? 1 : 0);
    assert.equal(rank(placed.layout.bars.absent), 1 >= lane ? 2 : 1);
    assert.equal(rank(placed.layout.bars.peer), 3 >= lane ? 4 : 3);
    assert.equal(rank(placed.layout.detached[id].layout), 1 >= lane ? 2 : 1);
    assert.deepEqual(placed.layout.bars.otherEdge, before.layout.bars.otherEdge);
    assert.deepEqual(placed.content, before.content);
    assert.deepEqual(state, before);
  });
}
test('new tear-off can insert a lane; repeated detach and rejected operations never shift it again', () => {
  const state = initial();
  const view: ViewLayout = { ...clone(DEFAULT_VIEW), placement: { kind: 'dock', edge: 'top', lane: 0, order: 0 } };
  const operation = { kind: 'detach' as const, ownerId: 'tools', groupId: 'grp:draw', view, insert: true, insertLane: true };
  const next = value(applyLayout(state, operation, definitions));
  assert.equal(next.layout.bars.main.placement.kind === 'dock' && next.layout.bars.main.placement.lane, 1);
  assert.deepEqual(value(applyLayout(next, operation, definitions)), next);
  assert.equal(applyLayout(setLayoutLocked(state, true), operation, definitions).ok, false);
  const runtime = createToolbarRuntime(definitions);
  value(runtime.layout(operation));
  assert.equal(value(runtime.layout(operation)).changed, false);
});
test('defaults: unlocked, visible, medium icons, CSS-pixel/count defaults', () => {
  const s = initial();
  assert.equal(s.layout.locked, false);
  assert.deepEqual(s.layout.hidden, []);
  assert.equal(s.content.iconSizes.tools, 'm');
  assert.deepEqual(s.layout.bars.main, DEFAULT_VIEW);
});
test('definitions and independent states are deeply cloned', () => {
  const before = clone(definitions), a = initial(), b = initial();
  a.content.groups['grp:draw'].items.length = 0;
  a.layout.bars.main.rows = 5;
  assert.deepEqual(definitions, before);
  assert.equal(b.content.groups['grp:draw'].items.length, 2);
  assert.equal(b.layout.bars.main.rows, 1);
});
for (const edge of ['top', 'right', 'bottom', 'left'] as DockEdge[]) {
  test(`new named bars restore on ${edge} with lane/order/rows/columns`, () => {
    const defs = clone(definitions);
    for (let order = 0; order < 2; order++) defs.bars.push({
      id: `plugin:${edge}:${order}`, label: 'Plugin', items: [{ kind: 'control', id: 'option' }],
      layout: { placement: { kind: 'dock', edge, lane: 2, order }, orientation: 'vertical', rows: 2, columns: 4 },
    });
    const state = createState(defs);
    assert.deepEqual(roundtrip(state, defs), state);
  });
}
test('new definitions merge without changing persisted positions', () => {
  const defs = clone(definitions);
  defs.bars.push({ id: 'options', label: 'Options', items: [], layout: floating, visible: false });
  const state = value(decode(value(encode(initial())), defs)).state;
  assert.deepEqual(state.layout.bars.options, floating);
  assert.deepEqual(state.content.bars.options, []);
  assert.deepEqual(state.layout.hidden, ['options']);
  const shown = value(applyLayout(state, { kind: 'visibility', barId: 'options', visible: true }, defs));
  // Once the bar is persisted, explicit visibility wins over its definition.
  assert.deepEqual(roundtrip(shown, defs).layout.hidden, []);
});
test('stable group identity does not depend on first tool', () => {
  const s = detached();
  s.content.groups['grp:draw'].items.reverse();
  assert.equal(Object.keys(s.layout.detached)[0], detachedId('tools', 'grp:draw'));
  assert.equal(s.content.bars.tools[0].kind, 'group');
  assert.deepEqual(resolveDetached(s, 'tools', 'grp:draw')?.items, s.content.groups['grp:draw'].items);
});
test('detached view reads live common content and selection; resolver clones', () => {
  const s = detached();
  s.content.choices['grp:draw'] = 'plugin:pen';
  s.content.groups['grp:draw'].items.push({ kind: 'action', id: 'plugin:pen' });
  const resolved = resolveDetached(s, 'tools', 'grp:draw')!;
  assert.equal(resolved.selected, 'plugin:pen');
  assert.equal(resolved.items.length, 3);
  resolved.items.length = 0;
  resolved.layout.rows = 99;
  assert.equal(s.content.groups['grp:draw'].items.length, 3);
  assert.equal(s.layout.detached[detachedId('tools', 'grp:draw')].layout.rows, 2);
});
test('one detached view per owner/group, collision-free IDs', () => {
  const s = detached();
  const again = value(applyLayout(s, { kind: 'detach', ownerId: 'tools', groupId: 'grp:draw', view: DEFAULT_VIEW }, definitions));
  assert.deepEqual(again, s);
  assert.notEqual(detachedId('a/b', 'c'), detachedId('a', 'b/c'));
});
test('same group can be viewed by another owner without a content copy', () => {
  const s = detached();
  s.content.bars.main.push({ kind: 'group', id: 'grp:draw' });
  const next = value(applyLayout(s, { kind: 'detach', ownerId: 'main', groupId: 'grp:draw', view: floating }, definitions));
  assert.equal(Object.keys(next.layout.detached).length, 2);
  assert.deepEqual(resolveDetached(next, 'main', 'grp:draw')?.items, resolveDetached(next, 'tools', 'grp:draw')?.items);
});
test('bar and detached flyout use identical dock/float placement path', () => {
  let s = detached();
  for (const view of [DEFAULT_VIEW, floating]) {
    s = value(applyLayout(s, { kind: 'place', target: { barId: 'tools' }, view }, definitions));
    s = value(applyLayout(s, { kind: 'place', target: { ownerId: 'tools', groupId: 'grp:draw' }, view }, definitions));
    assert.deepEqual(s.layout.bars.tools, resolveDetached(s, 'tools', 'grp:draw')?.layout);
  }
  assert.deepEqual(roundtrip(s), s);
});
test('owner hidden suppresses detached view without losing its placement', () => {
  const s = detached();
  const hidden = value(applyLayout(s, { kind: 'visibility', barId: 'tools', visible: false }, definitions));
  assert.equal(resolveDetached(hidden, 'tools', 'grp:draw')?.visible, false);
  assert.deepEqual(hidden.layout.detached, s.layout.detached);
  const shown = value(applyLayout(hidden, { kind: 'visibility', barId: 'tools', visible: true }, definitions));
  assert.equal(resolveDetached(shown, 'tools', 'grp:draw')?.visible, true);
});
test('visible sections are flat, non-detachable groups', () => {
  const s = initial();
  s.content.groups['grp:draw'].kind = 'section';
  assert.equal(applyLayout(s, { kind: 'detach', ownerId: 'tools', groupId: 'grp:draw', view: floating }, definitions).ok, false);
  assert.deepEqual(roundtrip(s), s);
});
test('legacy v14 customized arrays/separators/unknown IDs/choices/hidden/sizes survive', () => {
  const legacy = { v: 14, bars: { main: ['plugin:unknown', '|', 'grp:absent', '|'], tools: ['grp:draw', 'tool:shaper', '|', 'custom'] },
    size: { main: 's', tools: 'l' }, hidden: ['tools', 'numbar', 'textbar', 'palette', 'status', 'plugin:hidden'],
    groups: { 'grp:draw': 'tool:arc', 'grp:absent': 'plugin:absent' } };
  const text = JSON.stringify(legacy);
  const decoded = value(decode(text, definitions));
  assert.equal(decoded.source, 'legacy-v14');
  const s = roundtrip(decoded.state);
  for (const id of ['main', 'tools']) assert.deepEqual(s.content.bars[id].map((i) => i.kind === 'separator' ? '|' : i.id), legacy.bars[id]);
  assert.deepEqual(s.content.choices, legacy.groups);
  assert.deepEqual(s.content.iconSizes, legacy.size);
  assert.deepEqual(s.layout.hidden, legacy.hidden);
  assert.equal(JSON.stringify(legacy), text);
  assert.deepEqual(s.content.bars.main[2], { kind: 'legacy', id: 'grp:absent' });
});
test('legacy adapter uses supplied layout defaults, not toolbar-name switches', () => {
  const defs = clone(definitions);
  defs.bars[0].layout = clone(floating);
  const s = value(decode(JSON.stringify({ v: 14, bars: { main: [], tools: [] }, size: {}, hidden: [], groups: {} }), defs)).state;
  assert.deepEqual(s.layout.bars.main, floating);
});
test('earlier legacy versions require an explicit injected full upgrader', () => {
  const raw = JSON.stringify({ v: 13, bars: { tools: ['custom'] }, size: {}, hidden: [], groups: {} });
  assert.equal(decode(raw, definitions).ok, false);
  let calls = 0;
  const decoded = decode(raw, definitions, { upgradeLegacy: (old) => { calls++; return { ...old as object, v: 14 }; } });
  assert.equal(decoded.ok, true);
  assert.equal(calls, 1);
});
test('future versions/formats, malformed JSON/content fail without replacement state', () => {
  for (const raw of ['{', 'null', '{"v":15}', JSON.stringify({ format: FORMAT, version: VERSION + 1, state: initial() }),
    JSON.stringify({ format: 'other', version: VERSION, state: initial() })]) {
    const result = decode(raw, definitions);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
  const s = initial();
  (s.content.groups['grp:draw'].items as unknown[]).push({ kind: 'group', id: 'nested' });
  assert.equal(encode(s).ok, false);
});
test('lock persists and rejects all layout changes, including reset and close', () => {
  const s = setLayoutLocked(detached(), true), before = clone(s);
  for (const op of [
    { kind: 'reset' }, { kind: 'visibility', barId: 'tools', visible: false },
    { kind: 'place', target: { barId: 'tools' }, view: floating },
    { kind: 'close', ownerId: 'tools', groupId: 'grp:draw' },
    { kind: 'detach', ownerId: 'tools', groupId: 'grp:draw', view: floating },
  ] as const) assert.equal(applyLayout(s, op, definitions).ok, false);
  assert.deepEqual(s, before);
  assert.equal(roundtrip(s).layout.locked, true);
  assert.equal(setLayoutLocked(s, false).layout.locked, false);
});
test('layout reset preserves customized content/selection/icon sizes only', () => {
  const s = detached();
  s.content.bars.main.push({ kind: 'legacy', id: 'plugin:unknown' });
  s.content.choices['grp:draw'] = 'width';
  s.content.iconSizes.main = 'l';
  s.layout.bars.main = clone(floating);
  s.layout.hidden.push('tools', 'palette');
  const reset = value(applyLayout(s, { kind: 'reset' }, definitions));
  assert.deepEqual(reset.content, s.content);
  assert.deepEqual(reset.layout, initial().layout);
});
test('content reset is distinct and retains layout/icon sizes', () => {
  const s = detached();
  s.content.bars.main.length = 0;
  s.content.iconSizes.main = 's';
  const reset = resetContent(s, definitions);
  assert.deepEqual(reset.layout, s.layout);
  assert.deepEqual(reset.content.bars, initial().content.bars);
  assert.equal(reset.content.iconSizes.main, 's');
});
test('operation boundaries clone input state and requested view', () => {
  const s = initial(), before = clone(s), request = clone(floating);
  const next = value(applyLayout(s, { kind: 'place', target: { barId: 'main' }, view: request }, definitions));
  request.rows = 99;
  next.content.bars.tools.length = 0;
  assert.deepEqual(s, before);
  assert.equal(next.layout.bars.main.rows, 2);
});
test('normalization rejects non-finite/fractional/negative/unknown geometry without mutation', () => {
  for (const bad of [null, {}, { ...floating, rows: 0 }, { ...floating, columns: 1.5 },
    { ...floating, placement: { kind: 'floating', x: NaN, y: 0 } },
    { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'middle', lane: 0, order: 0 } },
    { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: -1, order: 0 } }]) {
    const before = clone(bad);
    assert.deepEqual(normalizeView(bad), DEFAULT_VIEW);
    assert.deepEqual(bad, before);
  }
});
test('restored invalid geometry falls back while content/unknown references survive', () => {
  const s = initial();
  s.layout.bars.main.rows = -1;
  s.content.bars['unknown:bar'] = [{ kind: 'action', id: 'unknown:action' }];
  const raw = JSON.stringify({ format: FORMAT, version: VERSION, state: s });
  const out = value(decode(raw, definitions)).state;
  assert.deepEqual(out.layout.bars.main, DEFAULT_VIEW);
  assert.deepEqual(out.layout.bars['unknown:bar'], DEFAULT_VIEW);
  assert.deepEqual(out.content.bars['unknown:bar'], s.content.bars['unknown:bar']);
  assert.equal(encode(s).ok, false);
});
test('clamp keeps floating grip reachable, handles oversized views, and is pure', () => {
  const s = clone(floating);
  s.placement = { kind: 'floating', x: -10000, y: 10000 };
  const before = clone(s);
  const bounds = { width: 800, height: 600, viewWidth: 1000, viewHeight: 900, grip: 24 };
  const out = value(clampReachable(s, bounds));
  assert.deepEqual(out.placement, { kind: 'floating', x: -976, y: 576 });
  assert.deepEqual(s, before);
  assert.deepEqual(value(clampReachable(out, bounds)), out);
  assert.deepEqual(value(clampReachable(DEFAULT_VIEW, bounds)), DEFAULT_VIEW);
});
test('invalid bounds fail explicitly, including zero/NaN/infinity/negative', () => {
  const bounds = { width: 800, height: 600, viewWidth: 200, viewHeight: 50, grip: 24 };
  for (const key of Object.keys(bounds)) for (const invalid of [0, -1, NaN, Infinity])
    assert.equal(clampReachable(floating, { ...bounds, [key]: invalid }).ok, false);
  assert.equal(clampReachable(floating, {} as typeof bounds).ok, false);
});
test('preview draft/cancel leaves persisted snapshot unchanged; commit explicitly encodes result', () => {
  const s = initial(), saved = value(encode(s));
  const draft = value(applyLayout(s, { kind: 'place', target: { barId: 'main' }, view: floating }, definitions));
  // ESC/focus loss/pointer cancel belong to the future renderer: discard draft, not save it.
  assert.equal(value(encode(s)), saved);
  assert.notEqual(value(encode(draft)), saved);
  assert.deepEqual(roundtrip(draft).layout.bars.main, floating);
});
test('closing detached view preserves source and shared group data', () => {
  const s = detached();
  const next = value(applyLayout(s, { kind: 'close', ownerId: 'tools', groupId: 'grp:draw' }, definitions));
  assert.deepEqual(next.content, s.content);
  assert.deepEqual(next.layout.detached, {});
});
test('duplicate detached identities are rejected on read, without selecting a winner', () => {
  const s = detached();
  s.layout.detached.alias = clone(Object.values(s.layout.detached)[0]);
  assert.equal(decode(JSON.stringify({ format: FORMAT, version: VERSION, state: s }), definitions).ok, false);
});
for (const id of ['__proto__', 'constructor', 'toString']) {
  test(`defined opaque bar/group ID ${id} roundtrips and resolves without inherited selection`, () => {
    const defs: Definitions = {
      bars: [{ id, label: id, items: [{ kind: 'group', id }], layout: clone(floating) }],
      groups: [{ id, label: id, kind: 'flyout', items: [{ kind: 'action', id: 'plugin:action' }] }],
    };
    const fixture = JSON.parse(JSON.stringify({ format: FORMAT, version: VERSION, state: createState(defs) }));
    const state = value(decode(JSON.stringify(fixture), defs)).state;
    assert.deepEqual(roundtrip(state, defs), state);
    const next = value(applyLayout(state, { kind: 'detach', ownerId: id, groupId: id, view: floating }, defs));
    const view = resolveDetached(next, id, id)!;
    assert.equal(view.selected, undefined);
    assert.deepEqual(view.items, defs.groups[0].items);
    assert.deepEqual(value(applyLayout(next, { kind: 'reset' }, defs)).layout.bars[id], floating);
  });
  test(`unknown opaque bar/group ID ${id} gets own defaults and survives roundtrip/reset`, () => {
    const state = initial();
    state.content.bars = Object.fromEntries([[id, [{ kind: 'group', id }]]]);
    state.content.groups = Object.fromEntries([[id, { kind: 'flyout', items: [{ kind: 'action', id: 'absent:action' }] }]]);
    state.content.choices = Object.fromEntries([[id, 'absent:action']]);
    state.content.iconSizes = Object.fromEntries([[id, 'l']]);
    state.layout.bars = {};
    const fixture = JSON.parse(JSON.stringify({ format: FORMAT, version: VERSION, state }));
    const loaded = value(decode(JSON.stringify(fixture), definitions)).state;
    assert.equal(Object.hasOwn(loaded.layout.bars, id), true);
    assert.deepEqual(loaded.layout.bars[id], DEFAULT_VIEW);
    assert.deepEqual(roundtrip(loaded), loaded);
    const reset = value(applyLayout(loaded, { kind: 'reset' }, definitions));
    assert.deepEqual(reset.content, loaded.content);
    assert.equal(Object.hasOwn(reset.layout.bars, id), true);
    assert.deepEqual(reset.layout.bars[id], DEFAULT_VIEW);
  });
  test(`missing opaque owner ${id} rejects detach without throwing`, () => {
    assert.equal(applyLayout(initial(), { kind: 'detach', ownerId: id, groupId: 'grp:draw', view: floating }, definitions).ok, false);
  });
  test(`persisted unknown opaque bar ${id} resets to a real default view`, () => {
    const state = initial();
    state.content.bars = Object.fromEntries([[id, []]]);
    state.layout.bars = Object.fromEntries([[id, clone(floating)]]);
    const loaded = value(decode(JSON.stringify({ format: FORMAT, version: VERSION, state }), definitions)).state;
    const reset = value(applyLayout(loaded, { kind: 'reset' }, definitions));
    assert.deepEqual(reset.layout.bars[id], DEFAULT_VIEW);
  });
  test(`missing opaque source group ${id} resolves to undefined`, () => {
    const state = initial();
    state.content.bars.tools = [{ kind: 'group', id }];
    state.layout.detached = Object.fromEntries([[detachedId('tools', id), { ownerId: 'tools', groupId: id, layout: clone(floating) }]]);
    assert.equal(resolveDetached(state, 'tools', id), undefined);
  });
  test(`stale detached view with missing opaque owner ${id} resolves to undefined`, () => {
    const state = initial();
    state.layout.detached = Object.fromEntries([[detachedId(id, 'grp:draw'), { ownerId: id, groupId: 'grp:draw', layout: clone(floating) }]]);
    assert.equal(resolveDetached(state, id, 'grp:draw'), undefined);
  });
  test(`placing opaque owner ${id} with no layout entry creates own entry`, () => {
    const state = initial();
    state.content.bars = Object.fromEntries([[id, []]]);
    const next = value(applyLayout(state, { kind: 'place', target: { barId: id }, view: floating }, definitions));
    assert.equal(Object.hasOwn(next.layout.bars, id), true);
    assert.deepEqual(next.layout.bars[id], floating);
    assert.equal(Object.getPrototypeOf(next.layout.bars), Object.prototype);
  });
  test(`legacy opaque ID ${id} preserves its own default icon size`, () => {
    const fixture = JSON.parse(JSON.stringify({ v: 14, bars: Object.fromEntries([[id, [id, '|']]]), size: {}, hidden: [id], groups: Object.fromEntries([[id, 'absent:action']]) }));
    const state = value(decode(JSON.stringify(fixture), definitions)).state;
    assert.equal(Object.hasOwn(state.content.iconSizes, id), true);
    assert.equal(state.content.iconSizes[id], 'm');
    assert.deepEqual(roundtrip(state), state);
  });
}
test('changing shared flyout to section suppresses detached view but retains placement', () => {
  const state = detached();
  const placement = clone(state.layout.detached);
  state.content.groups['grp:draw'].kind = 'section';
  assert.equal(resolveDetached(state, 'tools', 'grp:draw'), undefined);
  assert.deepEqual(state.layout.detached, placement);
});
test('completed dock insertion reindexes siblings atomically without mutating the source', () => {
  const original = initial(), snapshot = clone(original);
  const placed = value(applyLayout(original, { kind: 'place', target: { barId: 'main' }, insert: true,
    view: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'left', lane: 0, order: 0 } } }, definitions));
  assert.deepEqual(original, snapshot);
  assert.deepEqual(placed.layout.bars.main.placement, { kind: 'dock', edge: 'left', lane: 0, order: 0 });
  assert.deepEqual(placed.layout.bars.tools.placement, { kind: 'dock', edge: 'left', lane: 0, order: 1 });
  const moved = value(applyLayout(placed, { kind: 'place', target: { barId: 'main' }, insert: true,
    view: { ...placed.layout.bars.main, placement: { kind: 'dock', edge: 'left', lane: 0, order: 2 } } }, definitions));
  assert.deepEqual(moved.layout.bars.tools.placement, { kind: 'dock', edge: 'left', lane: 0, order: 0 });
  assert.deepEqual(moved.layout.bars.main.placement, { kind: 'dock', edge: 'left', lane: 0, order: 1 });
  assert.deepEqual(moved.content, original.content);
});
test('newly docked tear-off shares insertion order with source bars', () => {
  const placed = value(applyLayout(initial(), { kind: 'detach', ownerId: 'tools', groupId: 'grp:draw', insert: true,
    view: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 0, order: 0 } } }, definitions));
  assert.deepEqual(placed.layout.bars.main.placement, { kind: 'dock', edge: 'top', lane: 0, order: 1 });
  assert.deepEqual(placed.layout.detached[detachedId('tools', 'grp:draw')].layout.placement, { kind: 'dock', edge: 'top', lane: 0, order: 0 });
  const repeated = value(applyLayout(placed, { kind: 'detach', ownerId: 'tools', groupId: 'grp:draw', insert: true, view: floating }, definitions));
  assert.deepEqual(repeated, placed);
});
test('dock ordering excludes unavailable peers without losing their saved layout', () => {
  const state = initial();
  state.content.bars.absent = [{ kind: 'action', id: 'missing:tool' }];
  state.content.bars.extra = [];
  state.layout.bars.absent = { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 0, order: 1 } };
  state.layout.bars.tools = { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 0, order: 2 } };
  state.layout.bars.extra = clone(floating);
  const unavailable = clone(state.layout.bars.absent);
  const placed = value(applyLayout(state, { kind: 'place', target: { barId: 'extra' }, insert: true,
    participants: [{ barId: 'main' }, { barId: 'tools' }],
    view: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 0, order: 2 } } }, definitions));
  assert.deepEqual(placed.layout.bars.tools.placement, { kind: 'dock', edge: 'top', lane: 0, order: 1 });
  assert.deepEqual(placed.layout.bars.extra.placement, { kind: 'dock', edge: 'top', lane: 0, order: 2 });
  assert.deepEqual(placed.layout.bars.absent, unavailable);
  assert.deepEqual(placed.content.bars.absent, state.content.bars.absent);
});
function fails<T>(result: Result<T>): string {
  assert.equal(result.ok, false, 'expected failure');
  if (result.ok) throw new Error('expected failure');
  return result.error;
}
test('custom bar add sets items/icon size/label/layout and trims the label', () => {
  const runtime = createToolbarRuntime(definitions);
  const added = value(runtime.addBar({ id: 'custom:1', label: '  My Bar  ',
    items: [{ kind: 'action', id: 'save' }], layout: floating, iconSize: 'l' }));
  assert.equal(added.changed, true);
  const s = runtime.read();
  assert.deepEqual(s.content.bars['custom:1'], [{ kind: 'action', id: 'save' }]);
  assert.equal(s.content.iconSizes['custom:1'], 'l');
  assert.equal(s.content.labels['custom:1'], 'My Bar');
  assert.deepEqual(s.layout.bars['custom:1'], floating);
  const minimal = value(createToolbarRuntime(definitions).addBar({ id: 'custom:2', label: 'Plain' }));
  assert.equal(minimal.changed, true);
});
test('custom bar add defaults to empty items, medium icons and the default view', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: 'custom:plain', label: 'Plain' }));
  const s = runtime.read();
  assert.deepEqual(s.content.bars['custom:plain'], []);
  assert.equal(s.content.iconSizes['custom:plain'], 'm');
  assert.deepEqual(s.layout.bars['custom:plain'], DEFAULT_VIEW);
});
test('custom bar add rejects bad ids, duplicates, labels, views and icon sizes', () => {
  const runtime = createToolbarRuntime(definitions);
  for (const id of ['', 'x'.repeat(65)]) assert.equal(fails(runtime.addBar({ id, label: 'Ok' })), 'Invalid bar id');
  assert.equal(fails(runtime.addBar({ id: 42 as unknown as string, label: 'Ok' })), 'Invalid bar id');
  assert.equal(fails(runtime.addBar({ id: 'main', label: 'Ok' })), 'Bar already exists');
  value(runtime.addBar({ id: 'custom:dup', label: 'Dup' }));
  assert.equal(fails(runtime.addBar({ id: 'custom:dup', label: 'Dup' })), 'Bar already exists');
  for (const label of ['', '   ', 'x'.repeat(41)]) assert.equal(fails(runtime.addBar({ id: 'custom:x', label })), 'Invalid bar label');
  assert.equal(fails(runtime.addBar({ id: 'custom:x', label: 'Ok', layout: { ...floating, rows: 0 } })), 'Invalid view');
  assert.equal(fails(runtime.addBar({ id: 'custom:x', label: 'Ok', iconSize: 'xl' as never })), 'Invalid icon size');
  assert.equal(Object.hasOwn(runtime.read().content.bars, 'custom:x'), false);
});
test('custom bar add rejects ids of built-in bars', () => {
  const runtime = createToolbarRuntime(definitions);
  assert.equal(fails(runtime.addBar({ id: 'tools', label: 'Tools copy' })), 'Bar already exists');
});
test('custom bar label rename trims and rejects unknown/built-in/invalid labels', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: 'custom:rename', label: 'Before' }));
  value(runtime.setBarLabel('custom:rename', '  After  '));
  assert.equal(runtime.read().content.labels['custom:rename'], 'After');
  assert.equal(fails(runtime.setBarLabel('missing', 'Name')), 'Unknown bar');
  assert.equal(fails(runtime.setBarLabel('main', 'Name')), 'Built-in bar');
  for (const label of ['', '  ', 'x'.repeat(41)]) assert.equal(fails(runtime.setBarLabel('custom:rename', label)), 'Invalid bar label');
  assert.equal(runtime.read().content.labels['custom:rename'], 'After');
});
test('custom bar remove deletes entries and cleans hidden/detached views', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: 'custom:gone', label: 'Gone', items: [{ kind: 'group', id: 'grp:draw' }] }));
  value(runtime.layout({ kind: 'detach', ownerId: 'custom:gone', groupId: 'grp:draw', view: floating }));
  value(runtime.layout({ kind: 'visibility', barId: 'custom:gone', visible: false }));
  assert.ok(runtime.read().layout.hidden.includes('custom:gone'));
  const removed = value(runtime.removeBar('custom:gone'));
  assert.equal(removed.changed, true);
  const s = runtime.read();
  assert.equal(Object.hasOwn(s.content.bars, 'custom:gone'), false);
  assert.equal(Object.hasOwn(s.content.iconSizes, 'custom:gone'), false);
  assert.equal(Object.hasOwn(s.content.labels, 'custom:gone'), false);
  assert.equal(Object.hasOwn(s.layout.bars, 'custom:gone'), false);
  assert.equal(s.layout.hidden.includes('custom:gone'), false);
  assert.equal(Object.values(s.layout.detached).some((v) => v.ownerId === 'custom:gone'), false);
  assert.equal(fails(runtime.removeBar('custom:gone')), 'Unknown bar');
  assert.equal(fails(runtime.removeBar('main')), 'Built-in bar');
  assert.equal(fails(runtime.removeBar('missing')), 'Unknown bar');
});
test('custom bar labels survive encode/decode roundtrip', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: 'custom:round', label: 'Round', items: [{ kind: 'action', id: 'save' }] }));
  const s = roundtrip(runtime.read());
  assert.equal(s.content.labels['custom:round'], 'Round');
  assert.deepEqual(s.content.bars['custom:round'], [{ kind: 'action', id: 'save' }]);
});
test('payloads without labels load with empty labels (backward compatible)', () => {
  const s = initial();
  const raw = JSON.parse(value(encode(s)));
  delete raw.state.content.labels;
  assert.equal('labels' in raw.state.content, false);
  const loaded = value(decode(JSON.stringify(raw), definitions)).state;
  assert.deepEqual(loaded.content.labels, {});
  assert.deepEqual(roundtrip(loaded), loaded);
});
test('orphaned labels for unknown bars are dropped on load', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: 'custom:kept', label: 'Kept' }));
  const s = runtime.read();
  s.content.labels['ghost:bar'] = 'Ghost';
  const loaded = value(decode(JSON.stringify({ format: FORMAT, version: VERSION, state: s }), definitions)).state;
  assert.equal(loaded.content.labels['custom:kept'], 'Kept');
  assert.equal(Object.hasOwn(loaded.content.labels, 'ghost:bar'), false);
  assert.deepEqual(roundtrip(loaded), loaded);
});
test('content reset preserves custom bars, restores built-in content', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: 'custom:safe', label: 'Safe', items: [{ kind: 'action', id: 'save' }], iconSize: 'l' }));
  const customized = runtime.read();
  customized.content.bars.main.push({ kind: 'legacy', id: 'plugin:unknown' });
  const reset = resetContent(customized, definitions);
  assert.deepEqual(reset.content.bars['custom:safe'], [{ kind: 'action', id: 'save' }]);
  assert.equal(reset.content.iconSizes['custom:safe'], 'l');
  assert.equal(reset.content.labels['custom:safe'], 'Safe');
  assert.deepEqual(reset.content.bars.main, initial().content.bars.main);
  assert.deepEqual(reset.layout, customized.layout);
});
test('opaque custom bar id roundtrips with its label', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addBar({ id: '__proto__', label: 'Proto' }));
  const s = roundtrip(runtime.read());
  assert.equal(Object.hasOwn(s.content.bars, '__proto__'), true);
  assert.equal(s.content.labels['__proto__'], 'Proto');
  assert.deepEqual(s.layout.bars['__proto__'], DEFAULT_VIEW);
});
test('custom bars inside definitions stay removable, renamable and reset-safe', () => {
  // Facade flow: addBar persists labels; a fresh runtime built with the custom
  // bar appended to definitions must still treat it as custom, not built-in.
  let stored: string | null = null;
  const storage = { getItem: () => stored, setItem: (_key: string, v: string) => { stored = v; } };
  const first = createToolbarRuntime(definitions, { storage });
  value(first.addBar({ id: 'custom-1', label: 'Eigen', items: [{ kind: 'action', id: 'save' }] }));
  assert.ok(stored !== null);
  const extended: Definitions = { bars: [...clone(definitions.bars),
    { id: 'custom-1', label: 'Eigen', items: [], layout: clone(DEFAULT_VIEW) }], groups: clone(definitions.groups) };
  const second = createToolbarRuntime(extended, { storage });
  value(second.setBarLabel('custom-1', 'Neu'));
  assert.equal(second.read().content.labels['custom-1'], 'Neu');
  const reset = resetContent(second.read(), extended);
  assert.deepEqual(reset.content.bars['custom-1'], [{ kind: 'action', id: 'save' }]);
  value(second.removeBar('custom-1'));
  assert.equal(Object.hasOwn(second.read().content.bars, 'custom-1'), false);
  assert.equal(fails(second.removeBar('main')), 'Built-in bar');
  assert.equal(fails(second.setBarLabel('main', 'X')), 'Built-in bar');
});
test('custom group add sets flyout items and trims the label', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addGroup({ id: 'custom-group-1', label: '  Mine  ', items: [{ kind: 'action', id: 'save' }] }));
  const s = runtime.read();
  assert.deepEqual(s.content.groups['custom-group-1'], { kind: 'flyout', items: [{ kind: 'action', id: 'save' }] });
  assert.equal(s.content.labels['custom-group-1'], 'Mine');
  value(createToolbarRuntime(definitions).addGroup({ id: 'custom-group-2', label: 'Plain' }));
  assert.deepEqual(runtime.read().content.groups['custom-group-1'].items, [{ kind: 'action', id: 'save' }]);
});

test('custom group add defaults to empty leaf items', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addGroup({ id: 'custom-group-plain', label: 'Plain' }));
  assert.deepEqual(runtime.read().content.groups['custom-group-plain'], { kind: 'flyout', items: [] });
});

test('custom group add rejects bad ids, duplicates, built-in ids and invalid labels', () => {
  const runtime = createToolbarRuntime(definitions);
  for (const id of ['', 'x'.repeat(65)]) assert.equal(fails(runtime.addGroup({ id, label: 'Ok' })), 'Invalid group id');
  assert.equal(fails(runtime.addGroup({ id: 42 as unknown as string, label: 'Ok' })), 'Invalid group id');
  assert.equal(fails(runtime.addGroup({ id: 'grp:draw', label: 'Copy' })), 'Group already exists');
  value(runtime.addGroup({ id: 'custom-group-dup', label: 'Dup' }));
  assert.equal(fails(runtime.addGroup({ id: 'custom-group-dup', label: 'Dup' })), 'Group already exists');
  for (const label of ['', '   ', 'x'.repeat(41)]) assert.equal(fails(runtime.addGroup({ id: 'custom-group-x', label })), 'Invalid group label');
  assert.equal(Object.hasOwn(runtime.read().content.groups, 'custom-group-x'), false);
});

test('custom group remove cleans bar references, detached views and choices', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addGroup({ id: 'custom-group-1', label: 'Mine', items: [{ kind: 'action', id: 'save' }] }));
  const before = runtime.read();
  value(runtime.setBarItems('main', [...before.content.bars.main, { kind: 'group', id: 'custom-group-1' }]));
  value(runtime.layout({ kind: 'detach', ownerId: 'main', groupId: 'custom-group-1', view: floating }));
  value(runtime.choose('custom-group-1', 'save'));
  assert.ok(Object.keys(runtime.read().layout.detached).some((id) => id === detachedId('main', 'custom-group-1')));
  value(runtime.removeGroup('custom-group-1'));
  const s = runtime.read();
  assert.equal(Object.hasOwn(s.content.groups, 'custom-group-1'), false);
  assert.equal(Object.hasOwn(s.content.labels, 'custom-group-1'), false);
  assert.equal(s.content.bars.main.some((i) => i.kind === 'group' && i.id === 'custom-group-1'), false);
  assert.equal(Object.values(s.layout.detached).some((v) => v.groupId === 'custom-group-1'), false);
  assert.equal(Object.hasOwn(s.content.choices, 'custom-group-1'), false);
  // Built-in group reference survives the cleanup.
  assert.equal(s.content.bars.tools.some((i) => i.kind === 'group' && i.id === 'grp:draw'), true);
});

test('custom group remove rejects unknown and built-in groups', () => {
  const runtime = createToolbarRuntime(definitions);
  assert.equal(fails(runtime.removeGroup('missing')), 'Unknown group');
  assert.equal(fails(runtime.removeGroup('grp:draw')), 'Built-in group');
  value(runtime.addGroup({ id: 'custom-group-gone', label: 'Gone' }));
  value(runtime.removeGroup('custom-group-gone'));
  assert.equal(fails(runtime.removeGroup('custom-group-gone')), 'Unknown group');
  assert.deepEqual(runtime.read().content.groups['grp:draw'], initial().content.groups['grp:draw']);
});

test('custom group label rename trims and rejects unknown/built-in/invalid labels', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addGroup({ id: 'custom-group-rename', label: 'Before' }));
  value(runtime.setGroupLabel('custom-group-rename', '  After  '));
  assert.equal(runtime.read().content.labels['custom-group-rename'], 'After');
  assert.equal(fails(runtime.setGroupLabel('missing', 'Name')), 'Unknown group');
  assert.equal(fails(runtime.setGroupLabel('grp:draw', 'Name')), 'Built-in group');
  for (const label of ['', '  ', 'x'.repeat(41)]) assert.equal(fails(runtime.setGroupLabel('custom-group-rename', label)), 'Invalid group label');
  assert.equal(runtime.read().content.labels['custom-group-rename'], 'After');
});

test('built-in group content stays editable via setGroupItems', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.setGroupItems('grp:draw', { kind: 'section', items: [{ kind: 'action', id: 'save' }] }));
  assert.deepEqual(runtime.read().content.groups['grp:draw'], { kind: 'section', items: [{ kind: 'action', id: 'save' }] });
  assert.equal(fails(runtime.setGroupItems('missing', { kind: 'flyout', items: [] })), 'Unknown group');
});

test('custom groups survive encode/decode roundtrip; group labels are kept', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addGroup({ id: 'custom-group-round', label: 'Round', items: [{ kind: 'action', id: 'save' }] }));
  const s = roundtrip(runtime.read());
  assert.deepEqual(s.content.groups['custom-group-round'], { kind: 'flyout', items: [{ kind: 'action', id: 'save' }] });
  assert.equal(s.content.labels['custom-group-round'], 'Round');
  s.content.labels['ghost:bar'] = 'Ghost';
  const loaded = value(decode(JSON.stringify({ format: FORMAT, version: VERSION, state: s }), definitions)).state;
  assert.equal(loaded.content.labels['custom-group-round'], 'Round');
  assert.equal(Object.hasOwn(loaded.content.labels, 'ghost:bar'), false);
  assert.deepEqual(roundtrip(loaded), loaded);
});

test('content reset preserves custom groups and their choices, restores built-in content', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.addGroup({ id: 'custom-group-safe', label: 'Safe', items: [{ kind: 'action', id: 'save' }] }));
  value(runtime.choose('custom-group-safe', 'save'));
  const customized = runtime.read();
  customized.content.groups['grp:draw'].items.length = 0;
  const reset = resetContent(customized, definitions);
  assert.deepEqual(reset.content.groups['custom-group-safe'], { kind: 'flyout', items: [{ kind: 'action', id: 'save' }] });
  assert.equal(reset.content.labels['custom-group-safe'], 'Safe');
  assert.equal(reset.content.choices['custom-group-safe'], 'save');
  assert.deepEqual(reset.content.groups['grp:draw'], initial().content.groups['grp:draw']);
  assert.deepEqual(reset.layout, customized.layout);
});
console.log(`${passed} tests passed; ${failed} failed`);
if (failed) process.exitCode = 1;
