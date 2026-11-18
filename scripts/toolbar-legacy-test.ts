import assert from 'node:assert/strict';
import { upgradeLegacyConfig, type LegacyMigrations, type LegacyConfig } from '../src/toolbars/legacy';
import { decode } from '../src/toolbars/migration';
import { createToolbarRuntime } from '../src/toolbars/runtime';
import { DEFAULT_VIEW } from '../src/toolbars/model';

let passed = 0;
function test(name: string, run: () => void) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}
const defaults = { main: ['default-main'], tools: ['default-tools'] };
function upgrade(raw: unknown, migrations: LegacyMigrations = []): LegacyConfig {
  const result = upgradeLegacyConfig(raw, defaults, migrations);
  if (!result.ok) throw Error(`${result.error.code}: ${result.error.message}`);
  return result.config;
}

test('v1 folds multiple matching sequences before additions and removals', () => {
  const result = upgrade({ v: 1, bars: {
    main: ['check', 'preview', 'devsettings', '|', 'group'],
    tools: ['a', 'b', '|', 'a', 'b', 'tool:line', 'custom'],
  } }, [[['a', 'b'], 'grp:gen']]);
  assert.deepEqual(result.bars.main, ['devsettings', 'check', 'preview', '|', 'group', 'camera-overlays', 'isolate']);
  assert.deepEqual(result.bars.tools, ['apps', '|', 'grp:gen', 'grp:draw', 'tool:shaper', 'custom', 'grp:relate', 'tool:measure']);
  assert.equal(result.v, 14);
});
test('unversioned actual legacy bars use v1, not a fabricated full schema', () => {
  assert.deepEqual(upgrade({ bars: { main: ['a', 'b'] } }, [[['a', 'b'], 'folded']]).bars.main,
    ['folded', 'camera-overlays', 'isolate', 'devsettings']);
  assert.deepEqual(upgrade({ bars: { tools: [] } }).bars.main, defaults.main);
});
test('missing old fields default independently without upgrading missing bars', () => {
  const c = upgrade({ v: 3, bars: { main: ['mine'] }, size: { main: 'l', tools: 'invalid' } });
  assert.deepEqual(c.bars.tools, defaults.tools);
  assert.deepEqual(c.size, { main: 'l', tools: 'm' });
  assert.deepEqual(c.hidden, []);
  assert.deepEqual(c.groups, {});
  assert.deepEqual(upgrade({ v: 14 }).bars, defaults);
});
test('v10 placement and pre-v11 customized isolate stay on tools only', () => {
  const c = upgrade({ v: 9, bars: { main: ['ungroup', 'check'], tools: ['isolate', 'custom', 'tool:node'] } });
  assert.deepEqual(c.bars.main, ['ungroup', 'devsettings', 'check']);
  assert.deepEqual(c.bars.tools, ['isolate', 'custom', 'tool:node', 'tool:curvature', 'tool:shaper']);
  assert.ok(upgrade({ v: 10, bars: { main: ['ungroup'], tools: ['tool:node', 'vectorfit', 'shape-builder', 'isolate'] } }).bars.main.includes('isolate'));
  assert.ok(upgrade({ v: 11, bars: { main: ['isolate'], tools: ['isolate'] } }).bars.main.includes('isolate'));
});
test('custom old orders survive sequence removals', () => {
  const c = upgrade({ v: 3, bars: { tools: ['grp:gen', 'tool:select', 'apps', 'hinge', 'tool:joint'] } });
  assert.deepEqual(c.bars.tools, ['grp:gen', 'grp:select', 'apps', 'hinge', 'tool:joint', 'grp:relate', 'tool:measure', 'tool:pencil', 'tool:curvature', 'tool:shaper']);
});
test('v14 deliberate removals and separators remain unchanged', () => {
  const bars = { main: ['|', 'save', '|', '|'], tools: ['custom', '|'] };
  assert.deepEqual(upgrade({ v: 14, bars }).bars, bars);
  assert.deepEqual(upgrade({ v: 14, bars: { main: [], tools: [] } }).bars, { main: [], tools: [] });
});
test('unknown references, every hidden ID, choices and icon sizes survive', () => {
  const raw = { v: 14, bars: { main: ['missing-action', 'missing-group'], tools: ['tool:unknown'] },
    hidden: ['main', 'tools', 'numbar', 'textbar', 'palette', 'status', 'plugin-bar'],
    groups: { 'missing-group': 'missing-choice' }, size: { main: 's', tools: 'l' } };
  assert.deepEqual(upgrade(raw), raw);
});
test('prototype-like IDs are ordinary data in all positions', () => {
  const raw = JSON.parse('{"v":14,"bars":{"main":["constructor","toString","__proto__"],"tools":[]},"hidden":["constructor","toString","__proto__"],"groups":{"__proto__":"toString","constructor":"__proto__","toString":"constructor"},"size":{"main":"l","tools":"s"}}');
  const c = upgrade(raw);
  assert.deepEqual(c, raw);
  assert.equal(Object.getPrototypeOf(c.groups), Object.prototype);
  assert.ok(Object.hasOwn(c.groups, '__proto__'));
});
test('unknown bar IDs and their icon sizes survive the helper and the runtime bridge', () => {
  const raw = JSON.parse('{"v":14,"bars":{"main":[],"tools":[],"plugin":["missing-action"],"__proto__":["constructor"]},"size":{"plugin":"s","__proto__":"l"}}');
  const original = JSON.stringify(raw), config = upgrade(raw);
  assert.deepEqual(config.bars.plugin, ['missing-action']);
  assert.deepEqual(config.bars.__proto__, ['constructor']);
  assert.equal(config.size.plugin, 's'); assert.equal(config.size.__proto__, 'l');
  let stored = original;
  const runtime = createToolbarRuntime({ bars: [], groups: [] }, { upgradeLegacy: (value) => upgrade(value), storage: {
    getItem: () => stored, setItem(_key, value) { stored = value; },
  } });
  assert.equal(runtime.lock(true).ok, true);
  assert.equal(JSON.parse(stored).state.content.bars.plugin[0].id, 'missing-action');
  assert.equal(JSON.parse(stored).state.content.iconSizes.__proto__, 'l');
  config.bars.plugin.push('changed'); assert.equal(JSON.stringify(raw), original);
});
test('malformed and future data return explicit failures, never defaults', () => {
  for (const raw of [null, [], 'bad', { v: 14, bars: { main: [1] } }, { v: 14, hidden: [null] }, { v: 14, groups: { bad: 1 } }]) {
    const r = upgradeLegacyConfig(raw, defaults);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'invalid-config');
  }
  for (const v of [null, undefined, '1', '14', 0, -1, 1.5, NaN, Infinity]) {
    const r = upgradeLegacyConfig({ v, bars: { main: [] } }, defaults);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'invalid-version');
  }
  for (const raw of [{}, { hidden: [] }, { bars: {} }, { bars: { main: 'bad' } }])
    assert.equal(upgradeLegacyConfig(raw, defaults).ok, false);
  const r = upgradeLegacyConfig({ v: 15, bars: { main: [] } }, defaults);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, 'future-version');
});
test('input/defaults/migrations remain immutable and outputs are detached', () => {
  const raw = { v: 1, bars: { main: ['a', 'b'] }, hidden: ['unknown'], groups: { group: 'choice' }, size: { main: 'l' } };
  const migrations: [string[], string][] = [[['a', 'b'], 'group']];
  const before = JSON.stringify({ raw, defaults, migrations });
  const c = upgrade(raw, migrations);
  assert.equal(JSON.stringify({ raw, defaults, migrations }), before);
  c.bars.main.push('mutated'); c.bars.tools.push('mutated'); c.hidden.push('mutated'); c.groups.group = 'mutated'; c.size.main = 's';
  assert.equal(JSON.stringify({ raw, defaults, migrations }), before);
});
test('complete upgrader connects to the new decoder for every supported legacy shape', () => {
  const definitions = { bars: [{ id: 'main', label: 'Main', items: [], layout: DEFAULT_VIEW }], groups: [] };
  const options = { upgradeLegacy(raw: unknown) { return upgrade(raw); } };
  for (const raw of [{ bars: { main: ['missing'] } }, { v: 3, bars: { main: ['missing'] } }, { v: 14, bars: { main: ['missing'] } }]) {
    const result = decode(JSON.stringify(raw), definitions, options);
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(result.value.state.content.bars.main.some((item) => 'id' in item && item.id === 'missing'));
  }
});
test('future or invalid declared versions never reach the injected upgrader', () => {
  let calls = 0;
  for (const v of [15, '14', 0, null]) {
    assert.equal(decode(JSON.stringify({ v, bars: { main: [] } }), { bars: [], groups: [] }, {
      upgradeLegacy() { calls++; return upgrade({ v: 14 }); },
    }).ok, false);
  }
  assert.equal(calls, 0);
});
test('complete legacy load through runtime retains original until the first real edit', () => {
  const definitions = { bars: [{ id: 'main', label: 'Main', items: [], layout: DEFAULT_VIEW }], groups: [] };
  const original = JSON.stringify({ bars: { main: ['plugin-action'] } }); let stored = original, writes = 0;
  const runtime = createToolbarRuntime(definitions, { upgradeLegacy: (raw) => upgrade(raw), storage: {
    getItem: () => stored, setItem(_key, value) { stored = value; writes++; },
  } });
  assert.equal(runtime.persistence().writable, true);
  assert.equal(stored, original); assert.equal(writes, 0);
  assert.equal(runtime.lock(true).ok, true);
  assert.equal(writes, 1); assert.equal(JSON.parse(stored).format, 'toolbar-layout');
});
test('empty caller migration cannot make the fold unbounded', () => {
  assert.ok(upgrade({ v: 1, bars: { main: ['mine'] } }, [[[], 'invalid']]).bars.main.includes('mine'));
});

// Exercise the real legacy facade save guard with an empty UI, without a browser or hardware.
let stored: string | null = null;
let writes = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['de'], language: 'de' } });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => key === 'kizamubeam.lang' ? 'de' : stored,
  setItem: (_key: string, value: string) => { stored = value; writes++; },
} });
// Only empty renderer trees are mounted here; native event/control behavior lives in the browser fixture.
const doc: any = { documentElement: {}, activeElement: null };
const element = (): any => ({ ownerDocument: doc, dataset: {}, hidden: false,
  children: [], firstChild: null, style: { setProperty() {} }, classList: { add() {} },
  replaceChildren() { this.children = []; }, append(child: unknown) { this.children.push(child); },
  remove() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {},
  querySelector() { return this.children[0] ?? null; }, querySelectorAll: () => [],
});
const hosts = new Map<string, any>();
doc.querySelector = (selector: string) => {
  if (!hosts.has(selector)) hosts.set(selector, element());
  return hosts.get(selector);
};
doc.createElement = element;
Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
const { initToolbars, toggleBar, showAllBars, upgradeBar } = await import('../src/toolbars');
test('facade reexports upgradeBar compatibility API', () => {
  assert.deepEqual(upgradeBar('main', ['mine'], 14), ['mine']);
});
test('real facade refuses saving future, invalid-version and malformed stored originals', () => {
  for (const original of ['{"v":15,"bars":{"main":["future"]}}', '{"v":"14"}', '{broken', 'null']) {
    stored = original; writes = 0;
    initToolbars([], { main: [], tools: [] });
    toggleBar('main'); showAllBars();
    assert.equal(stored, original);
    assert.equal(writes, 0);
  }
});
test('real facade allows saving valid or absent legacy data', () => {
  for (const original of [null, '{"v":14,"bars":{"main":[],"tools":[]}}']) {
    stored = original; writes = 0;
    initToolbars([], { main: [], tools: [] }); toggleBar('main');
    assert.equal(writes, 1);
    assert.equal(JSON.parse(stored!).format, 'toolbar-layout');
    assert.equal(JSON.parse(stored!).state.layout.hidden.includes('main'), true);
  }
});
console.log(`${passed} legacy toolbar tests passed`);
