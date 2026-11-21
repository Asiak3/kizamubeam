// #453: Customizable keyboard shortcuts.
//
// shortcuts-fixtures.json records what every key did in the editor before #453 (write it again with --write, only on
// that code): for each key, modifier set and context, the editor methods called and whether the browser default was
// prevented. The default bindings must reproduce it, except: accidental modifier variants (droppedAlias), Shift on
// symbol keys (ignored now), and plain keys whose toolbar button is unavailable (they pass on instead of doing nothing).
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { EditorKeyboard } from '../src/editor/keyboard';

const FIXTURES = new URL('./shortcuts-fixtures.json', import.meta.url);
const write = process.argv.includes('--write');

// ---------- Recording the editor's reaction to a key ----------

const KEYS: [key: string, code: string][] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c): [string, string] => [c, `Key${c.toUpperCase()}`]),
  ...'0123456789'.split('').map((c): [string, string] => [c, `Digit${c}`]),
  ['+', 'BracketRight'], ['-', 'Slash'], ['*', 'NumpadMultiply'], ['=', 'Digit0'], ['.', 'Period'], [',', 'Comma'],
  ['`', 'Backquote'], ['Dead', 'Backquote'], ['±', 'BracketRight'], ['–', 'Slash'], ['+', 'NumpadAdd'], ['-', 'NumpadSubtract'],
  ['F1', 'F1'], ['PageUp', 'PageUp'], ['PageDown', 'PageDown'], ['Delete', 'Delete'], ['Backspace', 'Backspace'],
  ['Escape', 'Escape'], ['Enter', 'Enter'], ['ArrowLeft', 'ArrowLeft'], ['ArrowUp', 'ArrowUp'], ['Tab', 'Tab'],
];
const MODS = ['', 'Ctrl', 'Alt', 'Shift', 'Ctrl+Shift', 'Ctrl+Alt', 'Alt+Shift', 'Meta'];
const CONTEXTS = ['empty', 'two', 'node'] as const;
type Context = (typeof CONTEXTS)[number];

interface Pressed { calls: string[]; prevented: boolean }

function keyEvent(key: string, code: string, mods: string, onPrevent: () => void): KeyboardEvent {
  const m = mods.split('+');
  const shift = m.includes('Shift');
  return {
    key: shift && key.length === 1 ? key.toUpperCase() : key, code,
    ctrlKey: m.includes('Ctrl'), metaKey: m.includes('Meta'), altKey: m.includes('Alt'), shiftKey: shift,
    repeat: false, target: null, defaultPrevented: false, preventDefault: onPrevent,
  } as unknown as KeyboardEvent;
}

/** Editor stand-in: state for the context, every other member records its call */
function spyEditor(ctx: Context, calls: string[], extra: Record<string, unknown>) {
  const state: Record<string, unknown> = {
    outlinePreview: null, pickHandler: null, tool: ctx === 'node' ? 'node' : 'select', imageDraft: undefined,
    sel: ctx === 'two' ? [{}, {}] : ctx === 'node' ? [{}] : [], drag: null, draft: null, isolation: null, sketchEdit: null,
    jointPicks: [], relPicks: [], measure: null, arcDraft: null, space: false, pasteTimer: 0, filled: true, doc: { page: 1 },
    nodeTarget: () => (ctx === 'node' ? {} : null), selectedNodes: () => (ctx === 'node' ? [{}] : []), nodeTargets: () => [],
    segmentSelection: () => new Set(), nudgeSt: () => ({ normal: 1, shift: 10, alt: 0.1 }), ...extra,
  };
  const ed: object = new Proxy({}, {
    get(_, p: string) {
      if (p === 'onKey') return EditorKeyboard.prototype.onKey.bind(ed);
      if (Object.prototype.hasOwnProperty.call(state, p)) return state[p];
      return (...args: unknown[]) => void calls.push(`${p}(${args.map((a) => JSON.stringify(a)).join(',')})`);
    },
    set(_, p: string, v) { state[p] = v; return true; },
  });
  return ed as { onKey(e: KeyboardEvent): void };
}

/** Paste runs on a timer; run it at once so it is recorded */
(globalThis as { window: unknown }).window = { ...(globalThis as { window: object }).window, setTimeout: (f: () => void) => (f(), 1) };
(globalThis as { clearTimeout: unknown }).clearTimeout = () => {};

function press(ctx: Context, key: string, code: string, mods: string, extra: Record<string, unknown> = {}): Pressed {
  const calls: string[] = [];
  let prevented = false;
  spyEditor(ctx, calls, extra).onKey(keyEvent(key, code, mods, () => (prevented = true)));
  return { calls, prevented };
}

const caseId = (ctx: Context, key: string, code: string, mods: string) => `${ctx} ${mods || '-'} ${key}/${code}`;

function recordAll(extra: Record<string, unknown> = {}): Record<string, Pressed> {
  const out: Record<string, Pressed> = {};
  for (const ctx of CONTEXTS) for (const [key, code] of KEYS) for (const mods of MODS) {
    const r = press(ctx, key, code, mods, extra);
    if (r.calls.length || r.prevented) out[caseId(ctx, key, code, mods)] = r;
  }
  return out;
}

if (write) {
  writeFileSync(FIXTURES, JSON.stringify(recordAll(), null, 1) + '\n');
  console.log('shortcuts-fixtures.json written');
  process.exit(0);
}

// ---------- The default bindings reproduce the recording ----------

const commandKeys = await import('../src/commandKeys');
const { commandFor, bindings, setBindings, resetAllBindings, resetBindings, bindingConflicts, eventBinding, normalizeBinding, bindingRefusal, bindingNote, commandKey, reloadShortcuts } = commandKeys;

/** What each toolbar action runs (ui.ts) as the editor call the old key code made; others are recorded by id */
const ACTION_CALL: Record<string, string> = {
  import: 'onImport()', undo: 'doUndo()', redo: 'doRedo()', cut: 'cut()', copy: 'copy()', duplicate: 'duplicate()', selectall: 'selectAll()',
  tolines: 'convertSelToPath()', join: 'joinSel()', breakapart: 'breakApartSel()', zoomin: 'zoomAt(1.25)', zoomout: 'zoomAt(0.8)',
  zoompage: 'zoomPage()', wire: 'setFilled(false)', group: 'group()', ungroup: 'ungroup()', mirrorh: 'mirror(true)', mirrorv: 'mirror(false)',
  rotccw: 'rotateBy(90)', rotcw: 'rotateBy(-90)', alignl: 'align("left")', alignhc: 'align("hcenter")', alignr: 'align("right")',
  alignt: 'align("top")', alignvc: 'align("vcenter")', alignb: 'align("bottom")', 'tool:node': 'setTool("node")', 'tool:line': 'setTool("line")',
  'tool:rect': 'setTool("rect")', 'tool:ellipse': 'setTool("ellipse")', 'tool:text': 'setTool("text")', 'tool:trim': 'setTool("trim")',
  union: 'booleanSel("union")', subtract: 'booleanSel("subtract")', intersect: 'booleanSel("intersect")', gridarray: 'onGridArray()',
  prevpage: 'setPage(0)', nextpage: 'setPage(2)',
};
/** Action.enabled (ui.ts) of the commands that have a plain default key; pages are in the middle of the document */
const sel2 = (c: Context) => c === 'two', sel1 = (c: Context) => c !== 'empty';
const ENABLED: Record<string, (ctx: Context) => boolean> = {
  alignl: sel2, alignhc: sel2, alignr: sel2, alignt: sel2, alignvc: sel2, alignb: sel2, rotcw: sel1, rotccw: sel1,
};

/** Same rules as the dispatcher in ui.ts; every command with a default key is in the main menu (checked below) */
function dispatcher(ctx: Context, calls: string[]) {
  return (e: KeyboardEvent) => {
    const id = commandFor(e);
    if (!id) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!(ctrl || e.altKey) && ENABLED[id] && !ENABLED[id](ctx)) return false;
    e.preventDefault();
    calls.push(ACTION_CALL[id] ?? `run:${id}`);
    return true;
  };
}

function pressNew(ctx: Context, key: string, code: string, mods: string): Pressed {
  const calls: string[] = [];
  let prevented = false;
  spyEditor(ctx, calls, { onCommandKey: dispatcher(ctx, calls) }).onKey(keyEvent(key, code, mods, () => (prevented = true)));
  return { calls, prevented };
}

/** Keys that other listeners handled before #453 (tabsBar, laser.ts, ui.ts); now they are commands like the rest */
function formerlyElsewhere(ctx: Context, key: string, mods: string): string | null {
  const ctrl = mods === 'Ctrl' || mods === 'Meta';
  if (ctrl && key === 'n') return 'run:new';
  if (ctrl && key === 'o') return 'run:open';
  if (ctrl && key === 's') return 'run:save';
  if (mods === 'Alt' && key === 'p') return 'run:preview';
  // Before only with an image or a selection; now like the menu: the dialog itself says what to select
  if (mods === 'Alt' && key === 't') return 'run:trace';
  if (mods === 'Alt' && key === 'o') return 'run:offset';
  if (mods === '' && key === 'F1') return 'run:help';
  return null;
}

/**
 * Before #453 some keys ignored a modifier by accident (Ctrl+Shift+R = rectangle, Ctrl+Alt+E = ellipse, which is AltGr+E,
 * Alt+L = align, Alt+. = rotate, Shift+PageUp). Now a binding means exactly its modifiers. Such a key may lose its action
 * only if the same key without the extra modifiers still does the same thing.
 */
function droppedAlias(ctx: Context, key: string, code: string, mods: string, old: Record<string, Pressed>): boolean {
  const m = mods.split('+').filter(Boolean);
  const fewer = [m.filter((x) => x !== 'Shift'), m.filter((x) => x !== 'Alt'), m.filter((x) => x !== 'Alt' && x !== 'Shift')]
    .map((x) => x.join('+')).filter((x) => x !== mods);
  const mine = JSON.stringify(old[caseId(ctx, key, code, mods)]);
  return fewer.some((f) => JSON.stringify(old[caseId(ctx, key, code, f)]) === mine);
}

test0();
function test0() {
  // The dispatcher runs menu commands with Ctrl/Alt regardless of the toolbar's availability; the fixture relies on it
  const ui = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
  for (const id of [...Object.keys(ACTION_CALL), 'new', 'open', 'save', 'paste', 'trace', 'preview', 'offset', 'help'])
    assert.ok(ui.includes(`), '${id}', `), `${id} is in the main menu`);
}

let count = 0;
function test(name: string, fn: () => void) {
  fn();
  count++;
  console.log(`PASS ${name}`);
}

test('default bindings reproduce the keys from before #453', () => {
  resetAllBindings();
  const old = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, Pressed>;
  const empty: Pressed = { calls: [], prevented: false };
  const dropped: string[] = [], gained: string[] = [], unavailable: string[] = [];
  for (const ctx of CONTEXTS) for (const [key, code] of KEYS) for (const mods of MODS) {
    const id = caseId(ctx, key, code, mods);
    const now = pressNew(ctx, key, code, mods);
    const elsewhere = formerlyElsewhere(ctx, key, mods);
    const before = old[id] ?? empty;
    if (elsewhere) { assert.deepEqual(now, { calls: [elsewhere], prevented: true }, id); continue; }
    if (JSON.stringify(now) === JSON.stringify(before)) continue;
    // Shift on a symbol key is not part of a binding (it types another character on most layouts): acts as without Shift
    if (mods.includes('Shift') && (key === 'Dead' || (key.length === 1 && !/[a-z]/.test(key)))) {
      assert.deepEqual(now, pressNew(ctx, key, code, mods.split('+').filter((x) => x !== 'Shift').join('+')), id);
      gained.push(id);
      continue;
    }
    assert.deepEqual(now, empty, `${id}: ${JSON.stringify(before)} → ${JSON.stringify(now)}`);
    // A plain key whose button is unavailable passes on (before: the same call, which did nothing)
    const cmd = commandFor(keyEvent(key, code, mods, () => {}));
    if (cmd && ENABLED[cmd] && !ENABLED[cmd](ctx) && JSON.stringify(before.calls) === JSON.stringify([ACTION_CALL[cmd]])) { unavailable.push(id); continue; }
    assert.ok(droppedAlias(ctx, key, code, mods, old), `${id} lost ${JSON.stringify(before)}`);
    dropped.push(id);
  }
  console.log(`  ${dropped.length} accidental modifier variants no longer act; ${gained.length} symbol keys with Shift act as without; ${unavailable.length} unavailable plain keys pass on`);
});

// ---------- Registry ----------

const ev = (key: string, code: string, mods = '') =>
  ({ key, code, ctrlKey: mods.includes('Ctrl'), metaKey: mods.includes('Meta'), altKey: mods.includes('Alt'), shiftKey: mods.includes('Shift') }) as KeyboardEvent;

test('key events become layout-aware canonical bindings', () => {
  assert.equal(eventBinding(ev('z', 'KeyY', 'Ctrl')), 'Ctrl+Z', 'QWERTZ: the key labelled Z');
  assert.equal(eventBinding(ev('∆', 'KeyJ', 'Alt')), 'Alt+J', 'macOS Option+J');
  assert.equal(eventBinding(ev('±', 'BracketRight', 'Alt')), 'Alt++', 'macOS Option++');
  assert.equal(eventBinding(ev('±', 'Backquote')), '±', 'a real ± key without Option stays');
  assert.equal(eventBinding(ev('+', 'NumpadAdd', 'Alt')), 'Alt++');
  assert.equal(eventBinding(ev('Dead', 'Backquote', 'Ctrl')), 'Ctrl+`', 'German ^ key is a dead key');
  assert.equal(eventBinding(ev('+', 'BracketRight', 'Alt+Shift')), 'Alt++', 'Shift does not count on symbols');
  assert.equal(eventBinding(ev('A', 'KeyA', 'Ctrl+Shift')), 'Ctrl+Shift+A');
  assert.equal(eventBinding(ev('c', 'KeyC', 'Meta')), 'Ctrl+C', 'Cmd counts as Ctrl');
  assert.equal(eventBinding(ev('PageUp', 'PageUp', 'Shift')), 'Shift+PageUp');
  assert.equal(eventBinding(ev('Shift', 'ShiftLeft', 'Shift')), null);
  assert.equal(normalizeBinding('ctrl+shift+c'), 'Ctrl+Shift+C');
  assert.equal(normalizeBinding('Alt++'), 'Alt++');
  assert.equal(normalizeBinding('+'), '+');
  assert.equal(normalizeBinding('Shift+.'), '.');
  assert.equal(normalizeBinding('Hyper+X'), null);
  assert.equal(normalizeBinding(''), null);
});

/** localStorage that keeps what is written */
const store = new Map<string, string>();
(globalThis as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
};
const stored = () => JSON.parse(store.get('kizamubeam.shortcuts') ?? '{}');

test('assigning a taken key moves it; reset gives it back', () => {
  resetAllBindings();
  assert.deepEqual(bindingConflicts('theme', ['Ctrl+Z']), [{ binding: 'Ctrl+Z', id: 'undo' }]);
  setBindings('theme', ['Ctrl+Z']);
  assert.equal(commandFor(ev('z', 'KeyZ', 'Ctrl')), 'theme');
  assert.deepEqual(bindings('undo'), []);
  assert.deepEqual(stored(), { theme: ['Ctrl+Z'], undo: [] });
  resetBindings('undo');
  assert.deepEqual(bindings('undo'), ['Ctrl+Z']);
  assert.deepEqual(bindings('theme'), []);
  assert.equal(store.has('kizamubeam.shortcuts'), false, 'all defaults again: nothing stored');
});

test('a command with two defaults keeps the other one', () => {
  resetAllBindings();
  setBindings('help', ['Ctrl+Shift+Z']);
  assert.deepEqual(bindings('redo'), ['Ctrl+Y']);
  assert.deepEqual(bindings('help'), ['Ctrl+Shift+Z']);
  assert.deepEqual(stored(), { help: ['Ctrl+Shift+Z'], redo: ['Ctrl+Y'] });
});

test('stored bindings are read back; invalid and reserved ones are dropped', () => {
  resetAllBindings();
  store.set('kizamubeam.shortcuts', JSON.stringify({ 'tofront': ['ctrl+shift+f', 'Escape', 'Nope+X', 3], copy: [], cut: 'Ctrl+X' }).replace('{', '{"__proto__": ["Ctrl+Q"], '));
  reloadShortcuts();
  assert.equal(commandFor(ev('q', 'KeyQ', 'Ctrl')), undefined, 'no command named __proto__');
  assert.deepEqual(bindings('tofront'), ['Ctrl+Shift+F']);
  assert.deepEqual(bindings('copy'), []);
  assert.deepEqual(bindings('cut'), ['Ctrl+X'], 'not a list: default');
  store.set('kizamubeam.shortcuts', '{broken');
  reloadShortcuts();
  assert.deepEqual(bindings('copy'), ['Ctrl+C']);
});

test('fixed keys are refused, node and sketch letters get a note', () => {
  for (const b of ['Escape', 'Enter', 'Space', 'Ctrl+Tab', 'Delete', 'Shift+ArrowLeft', 'Backspace']) assert.ok(bindingRefusal(b), b);
  for (const b of ['Ctrl+K', 'F2', 'Q', 'Alt+D']) assert.equal(bindingRefusal(b), null, b);
  assert.ok(bindingNote('D'), 'node: delete');
  assert.ok(bindingNote('H'), 'sketch: horizontal');
  assert.equal(bindingNote('Ctrl+D'), null);
  assert.equal(bindingNote('Q'), null);
});

test('menus show the current key', () => {
  resetAllBindings();
  assert.equal(commandKey('copy'), 'Ctrl+C');
  assert.equal(commandKey('paste-in-place'), '');
  assert.equal(commandKey('prevpage'), 'Bild ↑');
  assert.equal(commandKey('delete'), 'Entf', 'fixed key');
  assert.equal(commandKey('tool:select'), 'Esc', 'fixed key');
  setBindings('tool:select', ['V']);
  assert.equal(commandKey('tool:select'), 'V', 'own shortcut first');
  assert.equal(commandKeys.withShortcut('Auswählen', 'tool:select'), 'Auswählen (V)');
  setBindings('copy', []);
  assert.equal(commandKey('copy'), '');
  resetAllBindings();
});

test('changed bindings act in the editor, after the keys of the current mode', () => {
  resetAllBindings();
  setBindings('tool:rect', ['Ctrl+Shift+R']);
  assert.deepEqual(pressNew('empty', 'r', 'KeyR', 'Ctrl+Shift'), { calls: ['setTool("rect")'], prevented: true });
  assert.deepEqual(pressNew('empty', 'r', 'KeyR', 'Ctrl'), { calls: [], prevented: false }, 'old key is free');
  setBindings('tool:rect', ['D']);
  assert.deepEqual(pressNew('empty', 'd', 'KeyD', ''), { calls: ['setTool("rect")'], prevented: true });
  assert.deepEqual(pressNew('node', 'd', 'KeyD', ''), { calls: ['deleteNodes()'], prevented: true }, 'node keys come first');
  setBindings('help', ['Alt+J']);
  assert.deepEqual(pressNew('empty', 'j', 'KeyJ', 'Alt'), { calls: ['run:help'], prevented: true });
  assert.deepEqual(bindings('join'), []);
  setBindings('alignl', ['Q']);
  assert.deepEqual(pressNew('two', 'q', 'KeyQ', ''), { calls: ['align("left")'], prevented: true });
  assert.deepEqual(pressNew('empty', 'q', 'KeyQ', ''), { calls: [], prevented: false }, 'not available: the key passes on');
  setBindings('paste', ['Ctrl+Shift+P']);
  assert.deepEqual(pressNew('empty', 'p', 'KeyP', 'Ctrl+Shift'), { calls: ['paste()'], prevented: false }, 'paste keeps the browser paste event');
  resetAllBindings();
});

console.log(`${count} shortcut tests passed`);
