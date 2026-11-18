import assert from 'node:assert/strict';
import { createToolbarRuntime, TOOLBAR_STORAGE_KEY } from '../src/toolbars/runtime';
import { DEFAULT_VIEW, clone, createState } from '../src/toolbars/model';
import type { Definitions, Result } from '../src/toolbars/model';
import { encode } from '../src/toolbars/migration';

let passed = 0, failed = 0;
function test(name: string, run: () => void) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}:`, error); }
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw Error(result.error);
  return result.value;
}
const definitions: Definitions = {
  bars: [{ id: '__proto__', label: 'Bar', items: [{ kind: 'group', id: 'constructor' }], layout: clone(DEFAULT_VIEW) }],
  groups: [{ id: 'constructor', label: 'Group', kind: 'flyout', items: [{ kind: 'action', id: 'draw' }, { kind: 'control', id: 'width' }] }],
};
class Storage {
  raw: string | null = null;
  writes = 0;
  getItem(key: string) { assert.equal(key, TOOLBAR_STORAGE_KEY); return this.raw; }
  setItem(key: string, value: string) { assert.equal(key, TOOLBAR_STORAGE_KEY); this.raw = value; this.writes++; }
}

test('construction and subscription do not write or dispatch feature actions', () => {
  const storage = new Storage(), runtime = createToolbarRuntime(definitions, { storage });
  let updates = 0;
  const off = runtime.subscribe(() => updates++);
  assert.equal(storage.writes, 0); assert.equal(updates, 0);
  value(runtime.choose('constructor', 'draw'));
  assert.equal(storage.writes, 1); assert.equal(updates, 1);
  off(); value(runtime.setIconSize('__proto__', 'l')); assert.equal(updates, 1);
});
test('snapshots, arguments and definitions cannot mutate live state', () => {
  const defs = clone(definitions), runtime = createToolbarRuntime(defs);
  defs.bars[0].items.length = 0;
  const snapshot = runtime.read(); snapshot.content.bars.__proto__.length = 0;
  assert.equal(runtime.read().content.bars.__proto__.length, 1);
  const items = [{ kind: 'action' as const, id: 'unknown-plugin-action' }];
  value(runtime.setBarItems('__proto__', items)); items[0].id = 'changed';
  assert.deepEqual(runtime.read().content.bars.__proto__, [{ kind: 'action', id: 'unknown-plugin-action' }]);
});
test('no-op changes neither persist nor notify', () => {
  const storage = new Storage(), runtime = createToolbarRuntime(definitions, { storage });
  let count = 0; runtime.subscribe(() => count++);
  assert.equal(value(runtime.lock(false)).changed, false);
  value(runtime.choose('constructor', 'draw'));
  assert.equal(value(runtime.choose('constructor', 'draw')).changed, false);
  assert.equal(storage.writes, 1); assert.equal(count, 1);
});
test('hiding an already hidden bar preserves order and is a semantic no-op', () => {
  const state = createState(definitions); state.layout.hidden = ['__proto__', 'absent'];
  const storage = new Storage(); storage.raw = value(encode(state));
  const runtime = createToolbarRuntime(definitions, { storage }); let count = 0;
  runtime.subscribe(() => count++);
  assert.equal(value(runtime.layout({ kind: 'visibility', barId: '__proto__', visible: false })).changed, false);
  assert.equal(storage.writes, 0); assert.equal(count, 0);
  assert.deepEqual(runtime.read().layout.hidden, ['__proto__', 'absent']);
});
test('future or invalid storage is retained through every kind of runtime edit', () => {
  for (const raw of ['{"format":"toolbar-layout","version":999}', 'not-json']) {
    const storage = new Storage(); storage.raw = raw;
    const runtime = createToolbarRuntime(definitions, { storage });
    assert.equal(runtime.persistence().writable, false);
    for (const result of [runtime.choose('constructor', 'draw'), runtime.setIconSize('__proto__', 'l'), runtime.lock(true), runtime.resetContent()])
      assert.equal(value(result).persisted, false);
    assert.equal(storage.raw, raw); assert.equal(storage.writes, 0);
  }
});
test('failed storage read blocks later writes; failed write keeps state usable', () => {
  let writes = 0;
  const unreadable = createToolbarRuntime(definitions, { storage: { getItem() { throw Error('denied'); }, setItem() { writes++; } } });
  value(unreadable.choose('constructor', 'draw')); assert.equal(writes, 0);
  const runtime = createToolbarRuntime(definitions, { storage: { getItem: () => null, setItem() { throw Error('quota'); } } });
  assert.equal(value(runtime.choose('constructor', 'draw')).persisted, false);
  assert.equal(runtime.read().content.choices.constructor, 'draw'); assert.ok(runtime.persistence().storageError);
});
test('native load preserves unknown data without writing it back', () => {
  const state = createState(definitions); state.content.choices.missing = 'missing-action'; state.layout.hidden.push('absent-bar');
  const storage = new Storage(); storage.raw = value(encode(state));
  const runtime = createToolbarRuntime(definitions, { storage });
  assert.deepEqual(runtime.read(), state); assert.equal(storage.writes, 0);
  value(runtime.setIconSize('__proto__', 's'));
  assert.equal(runtime.read().content.choices.missing, 'missing-action'); assert.ok(runtime.read().layout.hidden.includes('absent-bar'));
});
test('legacy load uses injected upgrader but persists only after a completed edit', () => {
  const storage = new Storage(); storage.raw = JSON.stringify({ v: 1 });
  let calls = 0;
  const runtime = createToolbarRuntime(definitions, { storage, upgradeLegacy(raw) {
    calls++; assert.deepEqual(raw, { v: 1 });
    return { v: 14, bars: Object.fromEntries([['__proto__', ['unknown-action']]]), size: {}, hidden: [], groups: {} };
  } });
  assert.equal(calls, 1); assert.equal(storage.writes, 0);
  assert.deepEqual(runtime.read().content.bars.__proto__, [{ kind: 'legacy', id: 'unknown-action' }]);
  value(runtime.lock(true)); assert.equal(storage.writes, 1);
  assert.equal(JSON.parse(storage.raw!).format, 'toolbar-layout');
});
test('locked layout rejects movement but leaves content and feature choices usable', () => {
  const runtime = createToolbarRuntime(definitions); value(runtime.lock(true));
  assert.equal(runtime.layout({ kind: 'visibility', barId: '__proto__', visible: false }).ok, false);
  value(runtime.choose('constructor', 'draw')); value(runtime.setIconSize('__proto__', 'l'));
  assert.equal(runtime.read().layout.locked, true); assert.equal(runtime.read().content.choices.constructor, 'draw');
});
test('layout reset preserves content/icons, separate content reset preserves layout/icons', () => {
  const runtime = createToolbarRuntime(definitions);
  value(runtime.choose('constructor', 'draw')); value(runtime.setIconSize('__proto__', 'l'));
  value(runtime.layout({ kind: 'visibility', barId: '__proto__', visible: false }));
  value(runtime.resetContent()); assert.ok(runtime.read().layout.hidden.includes('__proto__'));
  value(runtime.choose('constructor', 'draw')); value(runtime.layout({ kind: 'reset' }));
  assert.deepEqual(runtime.read().layout.hidden, []);
  assert.equal(runtime.read().content.choices.constructor, 'draw'); assert.equal(runtime.read().content.iconSizes.__proto__, 'l');
});
test('invalid items/group choice fail without state change or persistence', () => {
  const storage = new Storage(), runtime = createToolbarRuntime(definitions, { storage });
  assert.equal(runtime.choose('constructor', 'width').ok, false);
  assert.equal(runtime.choose('toString', 'draw').ok, false);
  assert.equal(runtime.setBarItems('toString', []).ok, false);
  assert.equal(runtime.setBarItems('__proto__', [{ kind: 'garbage' } as never]).ok, false);
  assert.equal(storage.writes, 0); assert.deepEqual(runtime.read(), createState(definitions));
});
test('one failing view cannot prevent remaining subscribers or undo persistence', () => {
  const errors: unknown[] = [], storage = new Storage();
  const runtime = createToolbarRuntime(definitions, { storage, reportListenerError: (error) => errors.push(error) });
  let count = 0;
  runtime.subscribe(() => { throw Error('bad view'); }); runtime.subscribe(() => count++);
  assert.equal(value(runtime.choose('constructor', 'draw')).persisted, true);
  assert.equal(count, 1); assert.equal(errors.length, 1); assert.equal(storage.writes, 1);
});
test('a throwing error reporter also cannot interrupt remaining subscribers', () => {
  const storage = new Storage(); let count = 0;
  const runtime = createToolbarRuntime(definitions, { storage, reportListenerError() { throw Error('report failed'); } });
  runtime.subscribe(() => { throw Error('view failed'); }); runtime.subscribe(() => count++);
  assert.equal(value(runtime.choose('constructor', 'draw')).persisted, true);
  assert.equal(count, 1); assert.equal(storage.writes, 1);
});
test('dock edge determines orientation on load, placement and custom-bar creation; floating preserves it', () => {
  const storage = new Storage();
  const state = createState(definitions);
  state.layout.bars.__proto__ = { ...clone(DEFAULT_VIEW), orientation: 'vertical' };
  // Existing saved layouts are accepted and canonicalized without a migration write.
  storage.raw = JSON.stringify({ format: 'toolbar-layout', version: 1, state });
  const runtime = createToolbarRuntime(definitions, { storage });
  assert.equal(runtime.read().layout.bars.__proto__.orientation, 'horizontal');
  assert.equal(storage.writes, 0);
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    value(runtime.layout({ kind: 'place', target: { barId: '__proto__' }, view: {
      ...clone(DEFAULT_VIEW), orientation: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
      placement: { kind: 'dock', edge, lane: 0, order: 0 },
    } }));
    assert.equal(runtime.read().layout.bars.__proto__.orientation, edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal');
  }
  value(runtime.layout({ kind: 'place', target: { barId: '__proto__' }, view: {
    ...clone(DEFAULT_VIEW), orientation: 'vertical', placement: { kind: 'floating', x: 93, y: 71 },
  } }));
  assert.equal(runtime.read().layout.bars.__proto__.orientation, 'vertical');
  value(runtime.addBar({ id: 'custom', label: 'Custom', layout: {
    ...clone(DEFAULT_VIEW), placement: { kind: 'dock', edge: 'right', lane: 0, order: 0 },
  } }));
  assert.equal(runtime.read().layout.bars.custom.orientation, 'vertical');
});
test('one-bar default reset restores built-in group members atomically without touching layout or other groups', () => {
  const defs = clone(definitions);
  defs.groups.push({ id: 'other', label: 'Other', kind: 'flyout', items: [] });
  const storage = new Storage(), runtime = createToolbarRuntime(defs, { storage });
  value(runtime.setGroupItems('constructor', { kind: 'flyout', items: [{ kind: 'action', id: 'customized' }] }));
  value(runtime.setGroupItems('other', { kind: 'flyout', items: [{ kind: 'action', id: 'keep' }] }));
  value(runtime.choose('constructor', 'customized'));
  value(runtime.setBarItems('__proto__', []));
  value(runtime.setIconSize('__proto__', 'l'));
  value(runtime.lock(true));
  const before = runtime.read(), writes = storage.writes;
  const reset = runtime as typeof runtime & { resetBarContent(id: string): Result<unknown> };
  value(reset.resetBarContent('__proto__'));
  const after = runtime.read();
  assert.deepEqual(after.content.bars.__proto__, defs.bars[0].items);
  assert.deepEqual(after.content.groups.constructor, { kind: defs.groups[0].kind, items: defs.groups[0].items });
  assert.deepEqual(after.content.groups.other, before.content.groups.other);
  assert.equal(Object.hasOwn(after.content.choices, 'constructor'), false);
  assert.equal(after.content.iconSizes.__proto__, 'l');
  assert.deepEqual(after.layout, before.layout);
  assert.equal(storage.writes, writes + 1);
  assert.equal(reset.resetBarContent('absent').ok, false);
  assert.equal(storage.writes, writes + 1);
});
test('per-bar reset never changes a group merely sharing an action or control id', () => {
  for (const kind of ['action', 'control'] as const) {
    const defs = clone(definitions);
    defs.bars.push({ id: 'unrelated', label: 'Unrelated', items: [{ kind, id: 'constructor' }], layout: clone(DEFAULT_VIEW) });
    const runtime = createToolbarRuntime(defs);
    value(runtime.setGroupItems('constructor', { kind: 'flyout', items: [{ kind: 'action', id: 'customized' }] }));
    value(runtime.choose('constructor', 'customized'));
    const before = runtime.read();
    value(runtime.resetBarContent('unrelated'));
    assert.deepEqual(runtime.read().content.groups, before.content.groups);
    assert.deepEqual(runtime.read().content.choices, before.content.choices);
  }
});
console.log(`Toolbar runtime: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
