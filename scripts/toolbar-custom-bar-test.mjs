// Eigene Funktionsleisten: Erstellen, Rekonstruieren, Umbenennen, Löschen, Größen.
// Aufruf: node scripts/toolbar-custom-bar-test.mjs (hängt in test:toolbar-layout).
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// ---------- Minimaler DOM-Stub (Baum, Tag/Klassen-Selektoren, Dialoge) ----------
class Style {
  setProperty(key, value) { this[key] = String(value); }
  getPropertyValue(key) { return this[key] ?? ''; }
  getPropertyPriority() { return ''; }
  removeProperty(key) { delete this[key]; }
}
function matches(el, selector) {
  if (!(el instanceof El)) return false;
  for (const part of String(selector).split(',').map((s) => s.trim())) {
    if (part.startsWith('.')) { if (el.classList.contains(part.slice(1))) return true; continue; }
    if (part.startsWith('#')) { if (el.id === part.slice(1)) return true; continue; }
    if (part.startsWith('[')) {
      const m = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (m && (m[2] === undefined ? el.dataset[m[1]] !== undefined : el.dataset[m[1]] === m[2])) return true;
      continue;
    }
    const dot = part.indexOf('.');
    if (dot > 0) {
      if (el.tag === part.slice(0, dot) && el.classList.contains(part.slice(dot + 1))) return true;
      continue;
    }
    if (/^[a-zA-Z][\w-]*$/.test(part) && el.tag === part) return true;
  }
  return false;
}
class El {
  constructor(tag) {
    this.tag = tag; this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null; this.ownerDocument = null;
    this.dataset = {}; this._attrs = new Map(); this._listeners = new Map();
    this._class = ''; this.style = new Style();
    this.hidden = false; this.disabled = false; this.checked = false;
    this._value = ''; this.textContent = ''; this.innerHTML = '';
    this.open = false; this.id = ''; this.title = ''; this.type = '';
    this.tabIndex = -1; this.clientWidth = 0; this.clientHeight = 0;
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v); }
  get classList() {
    const self = this;
    const list = () => self._class.split(/\s+/).filter(Boolean);
    const write = (l) => { self._class = l.join(' '); };
    return {
      add: (...c) => write([...new Set([...list(), ...c])]),
      remove: (...c) => write(list().filter((x) => !c.includes(x))),
      toggle: (c, force) => { const next = force ?? !list().includes(c); write(next ? [...new Set([...list(), c])] : list().filter((x) => x !== c)); return next; },
      contains: (c) => list().includes(c),
    };
  }
  get value() { return this._value; }
  set value(v) { this._value = String(v); this._attrs.set('value', String(v)); }
  get parentElement() { return this.parentNode instanceof El ? this.parentNode : null; }
  get firstChild() { return this.children.find((c) => c instanceof El) ?? null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children;
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  get isConnected() {
    let node = this;
    while (node) {
      if (node === document.body || node === document.documentElement) return true;
      node = node.parentNode;
    }
    return false;
  }
  get options() { return this.children.filter((c) => c instanceof El && c.tag === 'option'); }
  append(...nodes) {
    for (const node of nodes.flat()) {
      if (node == null || node === false) continue;
      if (typeof node === 'string') this.textContent += node;
      else { node.remove(); node.parentNode = this; this.children.push(node); }
    }
  }
  appendChild(node) { this.append(node); return node; }
  prepend(...nodes) {
    const els = [];
    for (const node of nodes.flat()) {
      if (node == null || node === false || typeof node === 'string') continue;
      node.remove(); node.parentNode = this; els.push(node);
    }
    this.children.unshift(...els);
  }
  insertBefore(node, before) {
    node.remove(); node.parentNode = this;
    const at = before ? this.children.indexOf(before) : -1;
    if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
    return node;
  }
  before(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(this);
    const els = [];
    for (const node of nodes.flat()) {
      if (typeof node === 'string' || node == null) continue;
      node.remove(); node.parentNode = parent; els.push(node);
    }
    parent.children.splice(at, 0, ...els);
  }
  replaceChildren(...nodes) {
    for (const child of this.children) if (child instanceof El) child.parentNode = null;
    this.children = []; this.textContent = '';
    this.append(...nodes);
  }
  remove() {
    const parent = this.parentNode;
    if (parent) parent.children = parent.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  getAttribute(key) { return this._attrs.has(key) ? this._attrs.get(key) : null; }
  setAttribute(key, value) {
    this._attrs.set(key, String(value));
    if (key === 'value') this._value = String(value);
    if (key === 'id') this.id = String(value);
    if (key === 'class') this._class = String(value);
  }
  removeAttribute(key) { this._attrs.delete(key); }
  hasAttribute(key) { return this._attrs.has(key); }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (list) this._listeners.set(type, list.filter((x) => x !== fn));
  }
  fire(type, extra = {}) {
    for (const fn of [...(this._listeners.get(type) ?? [])]) fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra });
  }
  click() { if (!this.disabled) this.fire('click'); }
  focus() {}
  blur() {}
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.fire('close'); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (el) => { for (const c of el.children) if (c instanceof El) { if (matches(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    let parent = node.parentNode;
    while (parent) { if (parent === this) return true; parent = parent.parentNode; }
    return false;
  }
  closest(sel) {
    let node = this;
    while (node) { if (matches(node, sel)) return node; node = node.parentNode; }
    return null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
const store = new Map();
const hostSelectors = new Map();
const body = new El('body');
const documentElement = new El('html');
documentElement.clientWidth = 1024; documentElement.clientHeight = 768;
const document = {
  createElement: (tag) => { const el = new El(tag); el.ownerDocument = document; return el; },
  createComment: (text) => { const el = new El('#comment'); el.ownerDocument = document; el.textContent = String(text); return el; },
  getElementById: () => null,
  querySelector: (sel) => {
    if (hostSelectors.has(sel)) return hostSelectors.get(sel);
    if (sel.startsWith('#')) { const el = document.createElement('div'); hostSelectors.set(sel, el); return el; }
    return body.querySelector(sel);
  },
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  body, documentElement, activeElement: null, defaultView: undefined,
  addEventListener() {}, removeEventListener() {},
};
Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
globalThis.HTMLElement = El;
globalThis.Element = El;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['de'], language: 'de' } });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => void store.set(key, String(value)),
  removeItem: (key) => void store.delete(key),
} });
let confirmResult = true;
const confirmations = [];
globalThis.confirm = (message) => { confirmations.push(message); return confirmResult; };

// ---------- Gebündelte Fassade (kein Browser, kein Storage-Zugriff von außen) ----------
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = await build({ entryPoints: ['src/toolbars.ts'], bundle: true, write: false, format: 'esm',
  platform: 'node', loader: { '.woff': 'empty', '.woff2': 'empty' }, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'kizamubeam-custom-bar-'));
const bundled = join(tmp, 'toolbars.mjs');
writeFileSync(bundled, out.outputFiles[0].text);
const tb = await import(pathToFileURL(bundled).href);

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}
const KEY = 'kizamubeam.toolbars';
const actions = [{ id: 'a', cat: 'Test', label: 'Aktion A', run() {} }];
const def = { main: ['a'], tools: [] };
const raw = () => store.get(KEY) ?? null;
const snap = () => JSON.parse(raw()).state;
const dialog = () => document.querySelector('.toolbar-dialog');
const barOptions = (dlg) => dlg.querySelectorAll('select')[0].querySelectorAll('option');
const optionByValue = (dlg, value) => barOptions(dlg).find((o) => o.value === value);
const customRow = (dlg) => dlg.querySelectorAll('.tb-top')[2];

// ---------- Gemeinsame Symbolgröße ----------
store.delete(KEY);
tb.initToolbars(actions, def);
test('gemeinsame Größe startet mit m', () => assert.equal(tb.toolbarIconSize(), 'm'));
tb.setAllToolbarIconSizes('l');
test('setAll schreibt jede Leiste und meldet l', () => {
  assert.ok(Object.values(snap().content.iconSizes).every((s) => s === 'l'));
  assert.equal(snap().content.iconSizes.main, 'l');
  assert.equal(tb.toolbarIconSize(), 'l');
});
test('gemischte Größen melden m', () => {
  const next = JSON.parse(raw());
  next.state.content.iconSizes.tools = 's';
  store.set(KEY, JSON.stringify(next));
  tb.initToolbars(actions, def);
  assert.equal(tb.toolbarIconSize(), 'm');
});
tb.disposeToolbars();
test('ohne System m und kein Absturz', () => {
  assert.equal(tb.toolbarIconSize(), 'm');
  tb.setAllToolbarIconSizes('s');
});

// ---------- Erstellen mit Validierung ----------
store.delete(KEY);
tb.initToolbars(actions, def);
test('leere Namen legen nichts an und öffnen nichts', () => {
  assert.equal(tb.createToolbar(''), undefined);
  assert.equal(tb.createToolbar('   '), undefined);
  assert.equal(tb.createToolbar(42), undefined);
  assert.equal(dialog(), null);
});
test('create legt custom-1 mit Label an und wählt sie vor', () => {
  assert.equal(tb.createToolbar('Meine Leiste'), 'custom-1');
  const s = snap();
  assert.deepEqual(s.content.bars['custom-1'], []);
  assert.equal(s.content.labels['custom-1'], 'Meine Leiste');
  const dlg = dialog();
  assert.ok(dlg && dlg.open);
  assert.equal(dlg.querySelectorAll('select')[0].value, 'custom-1');
  assert.equal(optionByValue(dlg, 'custom-1').textContent, 'Meine Leiste');
});
test('eingebaute und unbekannte Leisten sind geschützt', () => {
  assert.equal(tb.renameToolbar('main', 'X'), false);
  assert.equal(tb.renameToolbar('tools', 'X'), false);
  assert.equal(tb.deleteToolbar('main'), false);
  assert.equal(tb.deleteToolbar('tools'), false);
  assert.equal(tb.renameToolbar('custom-9', 'X'), false);
  assert.equal(tb.deleteToolbar('custom-9'), false);
  assert.equal(snap().content.labels['custom-1'], 'Meine Leiste');
});

// ---------- Rekonstruktion: Label und Layout ----------
test('rename ändert Label und übersteht Rekonstruktion', () => {
  assert.equal(tb.renameToolbar('custom-1', 'Umbenannt'), true);
  assert.equal(snap().content.labels['custom-1'], 'Umbenannt');
  tb.initToolbars(actions, def);
  tb.openToolbarDialog();
  assert.equal(optionByValue(dialog(), 'custom-1').textContent, 'Umbenannt');
  assert.equal(tb.renameToolbar('custom-1', '  '), false);
});
test('gespeichertes Layout übersteht Rekonstruktion, Ungültiges fällt auf Standard', () => {
  const next = JSON.parse(raw());
  next.state.layout.bars['custom-1'] = { placement: { kind: 'floating', x: 10, y: 20 },
    orientation: 'vertical', rows: 2, columns: 3 };
  store.set(KEY, JSON.stringify(next));
  tb.initToolbars(actions, def);
  tb.openToolbarDialog('custom-1');
  let dlg = dialog();
  assert.equal(dlg.querySelectorAll('select').length, 2);
  assert.equal(snap().layout.bars['custom-1'].orientation, 'vertical');
  assert.equal(dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'number')[0].value, '2');
  const bad = JSON.parse(raw());
  bad.state.layout.bars['custom-1'] = { bogus: true };
  store.set(KEY, JSON.stringify(bad));
  tb.initToolbars(actions, def);
  tb.openToolbarDialog('custom-1');
  dlg = dialog();
  assert.equal(dlg.querySelectorAll('select').length, 2);
  assert.equal(dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'number')[0].value, '1');
});
test('Dialog ohne Ausrichtung behält Zeilen, Spalten und Layoutsperre', () => {
  const dlg = dialog();
  assert.equal(dlg.querySelectorAll('select').length, 2);
  const counts = dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'number');
  counts[0].valueAsNumber = 2;
  counts[0].fire('change');
  counts[1].valueAsNumber = 3;
  counts[1].fire('change');
  assert.equal(snap().layout.bars['custom-1'].rows, 2);
  assert.equal(snap().layout.bars['custom-1'].columns, 3);
  const checkboxes = dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'checkbox');
  const layoutLock = checkboxes[1];
  layoutLock.checked = true;
  layoutLock.fire('change');
  assert.ok(counts.every((i) => i.disabled));
  const before = raw();
  counts[0].valueAsNumber = 4;
  counts[0].fire('change');
  assert.equal(raw(), before);
  layoutLock.checked = false;
  layoutLock.fire('change');
  assert.ok(counts.every((i) => !i.disabled));
});

// ---------- IDs, Löschen, Dialog-Abläufe ----------
test('IDs sind kleinste freie Nummern, Löschen entfernt Inhalt und Label', () => {
  store.delete(KEY);
  tb.initToolbars(actions, def);
  assert.equal(tb.createToolbar('A'), 'custom-1');
  assert.equal(tb.createToolbar('B'), 'custom-2');
  assert.equal(tb.deleteToolbar('custom-1'), true);
  let s = snap();
  assert.ok(!('custom-1' in s.content.bars));
  assert.ok(!('custom-1' in (s.content.labels ?? {})));
  assert.ok('custom-2' in s.content.bars);
  assert.equal(tb.createToolbar('C'), 'custom-1');
  assert.equal(snap().content.labels['custom-1'], 'C');
});
test('Dialog: eingebaute Leiste zeigt nur Erstellen, eigene zusätzlich Umbenennen und Löschen', () => {
  tb.openToolbarDialog('main');
  let row = customRow(dialog());
  assert.equal(row.querySelectorAll('input').length, 1);
  assert.equal(row.querySelectorAll('button').length, 1);
  tb.openToolbarDialog('custom-1');
  row = customRow(dialog());
  assert.equal(row.querySelectorAll('input').length, 2);
  assert.equal(row.querySelectorAll('button').length, 2);
});
test('Dialog: Erstellen per Knopf, Umbenennen per Feld, Löschen mit Bestätigung', () => {
  tb.openToolbarDialog('main');
  let row = customRow(dialog());
  row.querySelectorAll('input')[0].value = 'Dialog-Leiste';
  row.querySelectorAll('button')[0].click();
  let dlg = dialog();
  const created = barOptions(dlg).find((o) => o.textContent === 'Dialog-Leiste');
  assert.ok(created && /^custom-\d+$/.test(created.value));
  assert.equal(dlg.querySelectorAll('select')[0].value, created.value);
  row = customRow(dlg);
  row.querySelectorAll('input')[1].value = 'Via Dialog';
  row.querySelectorAll('input')[1].fire('change');
  assert.equal(snap().content.labels[created.value], 'Via Dialog');
  confirmations.length = 0;
  confirmResult = false;
  customRow(dialog()).querySelectorAll('button')[1].click();
  assert.ok(optionByValue(dialog(), created.value));
  assert.ok(confirmations.some((m) => m.includes('Via Dialog')));
  confirmResult = true;
  customRow(dialog()).querySelectorAll('button')[1].click();
  assert.equal(optionByValue(dialog(), created.value), undefined);
  assert.ok(!('Via Dialog' in Object.values(snap().content.labels ?? {})));
});

// ---------- Fremde Formate ----------
test('fremde Legacy-Leisten erscheinen mit ID als Name', () => {
  store.set(KEY, JSON.stringify({ v: 14, bars: { main: ['a'], tools: [], 'plugin-bar': ['a'] } }));
  tb.initToolbars(actions, def);
  tb.openToolbarDialog();
  const found = optionByValue(dialog(), 'plugin-bar');
  assert.ok(found);
  assert.equal(found.textContent, 'plugin-bar');
});
test('blockierter Storage wird nie überschrieben', () => {
  const future = '{"format":"toolbar-layout","version":999,"state":{}}';
  store.set(KEY, future);
  tb.initToolbars(actions, def);
  assert.equal(tb.createToolbar('Session'), 'custom-1');
  assert.equal(raw(), future);
  assert.equal(tb.deleteToolbar('custom-1'), true);
  assert.equal(raw(), future);
});

// ---------- Eigene Knopfgruppen (Einruecken) ----------
{
  store.delete(KEY);
  const gActions = [
    { id: 'a', cat: 'Test', label: 'Aktion A', run() {} },
    { id: 'b', cat: 'Test', label: 'Aktion B', run() {} },
    { id: 'c', cat: 'Test', label: 'Aktion C', run() {} },
    { id: 'g', cat: 'Test', label: 'Gruppe G', items: ['a', 'b'], run() {} },
  ];
  const gDef = { main: ['a', 'b', 'c'], tools: [] };
  tb.initToolbars(gActions, gDef);
  const rowsOf = (dlg) => dlg.querySelectorAll('.tb-list')[1].querySelectorAll('.tb-row');
  const clickBtn = (dlg, text) => dlg.querySelectorAll('button').find((b) => b.textContent === text).click();
  const groupsOf = () => { const r = raw(); return r ? JSON.parse(r).state.content.groups : {}; };
  const barsOf = () => JSON.parse(raw()).state.content.bars;

  test('Einruecken legt custom-group-1 mit Kopf-Aktion und Kind an', () => {
    tb.openToolbarDialog('main');
    let rows = rowsOf(dialog());
    assert.equal(rows.length, 3);
    rows[2].click();
    clickBtn(dialog(), '⇥');
    rows = rowsOf(dialog());
    assert.equal(rows.length, 4);
    assert.equal(rows[1].dataset.group, 'custom-group-1');
    assert.equal(rows[1].dataset.child, undefined);
    assert.equal(rows[2].dataset.child, '0');
    assert.equal(rows[3].dataset.child, '1');
    assert.equal(JSON.parse(raw()).state.content.labels['custom-group-1'], 'Gruppe 1');
    assert.deepEqual(groupsOf()['custom-group-1'], { kind: 'flyout', items: [{ kind: 'action', id: 'b' }, { kind: 'action', id: 'c' }] });
    assert.deepEqual(barsOf().main, [{ kind: 'legacy', id: 'a' }, { kind: 'group', id: 'custom-group-1' }]);
  });
  test('Rekonstruktion nach Re-Init behält Gruppe und Belegung', () => {
    tb.initToolbars(gActions, gDef);
    tb.openToolbarDialog('main');
    const rows = rowsOf(dialog());
    assert.equal(rows.length, 4);
    assert.equal(rows[1].dataset.group, 'custom-group-1');
    assert.equal(rows[2].dataset.child, '0');
    assert.equal(rows[3].dataset.child, '1');
    assert.deepEqual(barsOf().main, [{ kind: 'legacy', id: 'a' }, { kind: 'group', id: 'custom-group-1' }]);
    assert.deepEqual(groupsOf()['custom-group-1'].items, [{ kind: 'action', id: 'b' }, { kind: 'action', id: 'c' }]);
  });
  test('Ausruecken entfernt das Kind, letztes Kind löst die Gruppe auf', () => {
    tb.openToolbarDialog('main');
    rowsOf(dialog())[3].click();
    clickBtn(dialog(), '⇤');
    let rows = rowsOf(dialog());
    assert.equal(rows.length, 4);
    assert.deepEqual(groupsOf()['custom-group-1'].items, [{ kind: 'action', id: 'b' }]);
    assert.deepEqual(barsOf().main,
      [{ kind: 'legacy', id: 'a' }, { kind: 'group', id: 'custom-group-1' }, { kind: 'action', id: 'c' }]);
    rowsOf(dialog())[2].click();
    clickBtn(dialog(), '⇤');
    rows = rowsOf(dialog());
    assert.equal(rows.length, 3);
    assert.ok(!('custom-group-1' in groupsOf()));
    assert.ok(!('custom-group-1' in (JSON.parse(raw()).state.content.labels ?? {})));
    assert.deepEqual(barsOf().main, [{ kind: 'legacy', id: 'a' }, { kind: 'action', id: 'b' }, { kind: 'action', id: 'c' }]);
  });
  test('Tab rückt ein, IDs sind kleinste freie Nummern', () => {
    tb.openToolbarDialog('main');
    rowsOf(dialog())[2].click();
    rowsOf(dialog())[2].fire('keydown', { key: 'Tab' });
    const rows = rowsOf(dialog());
    assert.equal(rows.length, 4);
    assert.equal(rows[1].dataset.group, 'custom-group-1');
    assert.deepEqual(groupsOf()['custom-group-1'].items, [{ kind: 'action', id: 'b' }, { kind: 'action', id: 'c' }]);
  });
  test('eingebaute Gruppen zeigen Namen und auswählbare Kinder ohne Duplikate', () => {
    store.delete(KEY);
    tb.initToolbars(gActions, { main: ['g', 'c'], tools: ['g'] });
    tb.openToolbarDialog('main');
    const rows = rowsOf(dialog());
    assert.equal(rows.length, 4);
    assert.equal(rows[0].dataset.group, 'g');
    assert.equal(rows[0].querySelectorAll('span')[0].textContent, '▾');
    assert.equal(rows[0].querySelectorAll('span')[1].textContent, 'Gruppe G');
    assert.equal(rows[1].dataset.child, '0');
    assert.equal(rows[1].dataset.index, '0');
    assert.equal(rows[2].dataset.child, '1');
    assert.equal(rows[1].classList.contains('tb-readonly'), false);
  });
  test('eingebaute Mitglieder einrücken, hinzufügen und umsortieren wirkt geteilt', () => {
    rowsOf(dialog())[3].click();
    clickBtn(dialog(), '⇥');
    assert.equal(rowsOf(dialog())[3].classList.contains('sel'), true);
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b', 'c']);
    const available = dialog().querySelectorAll('.tb-list')[0].querySelectorAll('.tb-row');
    available.find((r) => r.dataset.action === 'a').fire('dblclick');
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b', 'c', 'a']);
    clickBtn(dialog(), '↑');
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b', 'a', 'c']);
    assert.deepEqual(barsOf().tools, [{ kind: 'group', id: 'g' }]);
    tb.initToolbars(gActions, { main: ['g', 'c'], tools: ['g'] });
    tb.openToolbarDialog('tools');
    assert.equal(rowsOf(dialog()).length, 5);
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b', 'a', 'c']);
  });
  test('eingebaute Kinder ausrücken, löschen und bis zur leeren Definition auflösen', () => {
    rowsOf(dialog())[4].click();
    clickBtn(dialog(), '⇤');
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b', 'a']);
    assert.deepEqual(barsOf().tools, [{ kind: 'group', id: 'g' }, { kind: 'action', id: 'c' }]);
    rowsOf(dialog())[3].fire('dblclick');
    rowsOf(dialog())[2].click();
    clickBtn(dialog(), '←');
    rowsOf(dialog())[1].click();
    clickBtn(dialog(), '⇤');
    assert.deepEqual(groupsOf().g.items, []);
    assert.deepEqual(barsOf().tools, [{ kind: 'action', id: 'a' }, { kind: 'action', id: 'c' }]);
    assert.deepEqual(barsOf().main, [{ kind: 'group', id: 'g' }]);
    assert.ok(!('custom-group-1' in groupsOf()));
    assert.equal(tb.deleteToolbar('main'), false);
  });
  test('Standard pro Leiste restauriert eingebaute Mitglieder auch nach Re-Init', () => {
    tb.initToolbars(gActions, { main: ['g', 'c'], tools: ['g'] });
    tb.openToolbarDialog('tools');
    clickBtn(dialog(), 'Standard wiederherstellen');
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b']);
    assert.deepEqual(barsOf().tools, [{ kind: 'group', id: 'g' }]);
    rowsOf(dialog())[0].click();
    clickBtn(dialog(), '←');
    assert.deepEqual(barsOf().tools, [{ kind: 'action', id: 'a' }, { kind: 'action', id: 'b' }]);
    assert.ok(groupsOf().g);
    rowsOf(dialog())[1].click();
    clickBtn(dialog(), '⇥');
    assert.ok(groupsOf()['custom-group-1']);
    clickBtn(dialog(), 'Standard wiederherstellen');
    assert.deepEqual(barsOf().tools, [{ kind: 'group', id: 'g' }]);
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b']);
    assert.ok(groupsOf()['custom-group-1']);
  });
  test('eingebaute Kinder ziehen: Reihenfolge, Einfügen, Ausrücken und Entfernen', () => {
    let rows = rowsOf(dialog());
    rows[2].fire('dragstart');
    dialog().querySelectorAll('.tb-list')[1].fire('drop', { target: rows[1], clientY: 0 });
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['b', 'a']);
    const available = dialog().querySelectorAll('.tb-list')[0];
    available.querySelectorAll('.tb-row').find((r) => r.dataset.action === 'c').fire('dragstart');
    dialog().querySelectorAll('.tb-list')[1].fire('drop', { target: rowsOf(dialog())[1], clientY: 0 });
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['c', 'b', 'a']);
    rowsOf(dialog())[1].fire('dragstart');
    dialog().querySelectorAll('.tb-list')[1].fire('drop', { clientY: 0 });
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['b', 'a']);
    assert.deepEqual(barsOf().tools, [{ kind: 'group', id: 'g' }, { kind: 'action', id: 'c' }]);
    rowsOf(dialog())[2].fire('dragstart');
    available.fire('drop');
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['b']);
    rowsOf(dialog())[1].fire('dragstart');
    available.fire('drop');
    assert.deepEqual(groupsOf().g.items, []);
    assert.deepEqual(barsOf().tools, [{ kind: 'action', id: 'c' }]);
  });
  test('Trennlinien bleiben nicht einrückbar', () => {
    rowsOf(dialog())[0].click();
    clickBtn(dialog(), 'Trennlinie');
    const withSep = rowsOf(dialog());
    assert.equal(withSep.length, 2);
    withSep[1].click();
    clickBtn(dialog(), '⇥');
    assert.equal(barsOf().tools.length, 2);
  });
  test('Kontextentfernung entfernt nur die Referenz; Refresh lässt Mitglieder unverändert', () => {
    clickBtn(dialog(), 'Standard wiederherstellen');
    const before = raw();
    tb.refreshBars();
    assert.equal(raw(), before);
    const host = hostSelectors.get('#tools');
    const entry = host.querySelector('[data-view]').children[0];
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 1024, innerHeight: 768 };
    try {
      host.fire('contextmenu', { target: entry, clientX: 10, clientY: 10 });
      document.querySelector('.ctx-menu').querySelectorAll('button')[1].click();
    } finally { globalThis.window = previousWindow; }
    assert.deepEqual(barsOf().tools, []);
    assert.deepEqual(groupsOf().g.items.map((i) => i.id), ['a', 'b']);
    assert.equal(tb.deleteToolbar('tools'), false);
  });
  test('Control-Abschnitte bleiben ohne bearbeitbare Kinder und kein Einrückziel', () => {
    store.delete(KEY);
    tb.setToolbarControls({
      definitions: { bars: [], groups: [{ id: 'section', label: 'Section', kind: 'section', items: [{ kind: 'control', id: 'feature' }] }] },
      controls: [], dispose() {},
    });
    tb.initToolbars(gActions, { main: ['section', 'a'], tools: [] });
    tb.setAllToolbarIconSizes('s');
    tb.openToolbarDialog('main');
    const rows = rowsOf(dialog());
    assert.equal(rows.length, 2);
    assert.equal(rows[0].dataset.group, undefined);
    rows[1].click();
    assert.equal(dialog().querySelectorAll('button').find((b) => b.textContent === '⇥').disabled, true);
    clickBtn(dialog(), '⇥');
    assert.deepEqual(groupsOf().section.items, [{ kind: 'control', id: 'feature' }]);
    assert.equal(barsOf().main.length, 2);
  });
}

tb.disposeToolbars();
assert.equal(document.querySelector('.toolbar-dialog'), null);
console.log(`${passed} custom toolbar tests passed`);
