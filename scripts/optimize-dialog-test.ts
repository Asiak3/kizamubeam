// Optimierer-Dialog (src/laser.ts openOptimizeDialog): Draft-Prinzip — Abbrechen
// verwirft, Zurücksetzen stellt DEFAULT_DEVICE wieder her, erst Übernehmen schreibt.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { DEFAULT_DEVICE } = await import('../src/gcode');
const { device, effOrder, openOptimizeDialog } = await import('../src/laser');

class FakeEl {
  tagName: string; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  children: (FakeEl | string)[] = []; listeners: Record<string, ((...a: any[]) => void)[]> = {};
  textContent = ''; value = ''; checked = false; className = ''; isConnected = true;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  addEventListener(type: string, fn: (...a: any[]) => void) { (this.listeners[type] ??= []).push(fn); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...kids: (FakeEl | string)[]) { this.children.push(...kids); }
  remove() { this.isConnected = false; }
  showModal() {}
  close() { this.fire('close'); }
  fire(type: string, more: Record<string, unknown> = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...more };
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}
const elements = (el: FakeEl): FakeEl[] => [el, ...el.children.flatMap((c) => c instanceof FakeEl ? elements(c) : [])];
const prevDoc = (globalThis as any).document;
const dialogs: FakeEl[] = [];
(globalThis as any).document = {
  ...prevDoc,
  createElement: (tag: string) => new FakeEl(tag),
  body: { append: (el: FakeEl) => dialogs.push(el) },
};
const open = () => { openOptimizeDialog(); return dialogs.at(-1)!; };
const checks = (dlg: FakeEl) => elements(dlg).filter((e) => e.tagName === 'INPUT');
const button = (dlg: FakeEl, text: string) => {
  const el = elements(dlg).find((e) => e.tagName === 'BUTTON' && e.children.includes(text));
  assert.ok(el, `missing button ${text}`); return el!;
};
const toggle = (input: FakeEl) => { input.checked = !input.checked; input.fire('change'); };

// 1. Sieben Schalter + Richtungs-Select in drei Gruppen, vorbelegt mit dem Geräte-Preset (Werksvorgabe literal gepinnt).
{
  assert.deepEqual(
    [DEFAULT_DEVICE.optInnerFirst, DEFAULT_DEVICE.optTravel, DEFAULT_DEVICE.optGroup, DEFAULT_DEVICE.optCornerStart,
      DEFAULT_DEVICE.optDirOrder, DEFAULT_DEVICE.optBestStart, DEFAULT_DEVICE.optBestDirection, DEFAULT_DEVICE.optLessTurns],
    [true, true, false, false, 'none', false, false, false], 'factory defaults are pinned');
  const dlg = open();
  const boxes = checks(dlg);
  // Reihenfolge der Schalter: innen, Leerwege, Gruppen, Richtungswechsel, Ecken, Start, Richtung
  const keys = ['optInnerFirst', 'optTravel', 'optGroup', 'optLessTurns', 'optCornerStart', 'optBestStart', 'optBestDirection'] as const;
  assert.equal(boxes.length, 7, 'seven optimizer switches');
  assert.deepEqual(boxes.map((b) => b.checked), keys.map((k) => (device as unknown as Record<string, boolean>)[k]));
  const sels = elements(dlg).filter((e) => e.tagName === 'SELECT');
  assert.equal(sels.length, 1, 'one direction select');
  assert.equal(sels[0].value, device.optDirOrder);
  assert.deepEqual(
    sels[0].children.filter((c): c is FakeEl => c instanceof FakeEl).map((c) => c.attrs.value),
    ['none', 'ltr', 'rtl', 'ttb', 'btt'], 'five direction choices');
  const groups = elements(dlg).filter((e) => e.tagName === 'FIELDSET');
  assert.equal(groups.length, 3, 'three option groups');
  assert.deepEqual(
    groups.map((g) => elements(g).find((e) => e.tagName === 'LEGEND')!.children[0]),
    ['Reihenfolge', 'Startpunkt & Richtung', 'Persönliche Vorgaben'], 'group legends');
  button(dlg, 'Abbrechen').fire('click');
  assert.equal(dlg.isConnected, false, 'cancel removes the dialog');
}

// 2. Übernehmen schreibt Draft ins Gerät, Abbrechen verwirft.
{
  const before = { ...effOrder() };
  const dlg = open();
  const boxes = checks(dlg);
  toggle(boxes[0]);
  button(dlg, 'Übernehmen').fire('click');
  assert.equal(dlg.isConnected, false, 'apply removes the dialog');
  assert.equal(device.optInnerFirst, !before.innerFirst, 'apply persists the draft');

  const dlg2 = open();
  const boxes2 = checks(dlg2);
  toggle(boxes2[0]);
  button(dlg2, 'Abbrechen').fire('click');
  assert.equal(device.optInnerFirst, !before.innerFirst, 'cancel discards the draft');
  assert.equal(dlg2.isConnected, false, 'cancel removes the dialog');
}

// 3. Zurücksetzen stellt die Werksvorgabe wieder her, schreibt aber nichts.
{
  const dlg = open();
  const boxes = checks(dlg);
  assert.equal(boxes.length, 7);
  const def = [DEFAULT_DEVICE.optInnerFirst, DEFAULT_DEVICE.optTravel, DEFAULT_DEVICE.optGroup,
    DEFAULT_DEVICE.optLessTurns, DEFAULT_DEVICE.optCornerStart, DEFAULT_DEVICE.optBestStart, DEFAULT_DEVICE.optBestDirection];
  boxes.forEach((b, i) => { b.checked = !def[i]; b.fire('change'); });
  const sel = elements(dlg).filter((e) => e.tagName === 'SELECT')[0];
  sel.value = 'ltr'; sel.fire('change');
  const deviceBefore = [device.optInnerFirst, device.optTravel, device.optGroup, device.optCornerStart,
    device.optDirOrder, device.optBestStart, device.optBestDirection, device.optLessTurns];
  button(dlg, 'Auf Standard zurücksetzen').fire('click');
  assert.deepEqual(checks(dlg).map((b) => b.checked), def, 'reset restores defaults in the draft');
  assert.equal(sel.value, DEFAULT_DEVICE.optDirOrder, 'reset restores the direction default');
  assert.deepEqual([device.optInnerFirst, device.optTravel, device.optGroup, device.optCornerStart,
    device.optDirOrder, device.optBestStart, device.optBestDirection, device.optLessTurns],
    deviceBefore, 'reset does not write to the device');
  button(dlg, 'Übernehmen').fire('click');
  assert.deepEqual([device.optInnerFirst, device.optTravel, device.optGroup, device.optCornerStart,
    device.optBestStart, device.optBestDirection, device.optLessTurns], def);
  assert.equal(device.optDirOrder, DEFAULT_DEVICE.optDirOrder);
  assert.deepEqual([effOrder().innerFirst, effOrder().travel, effOrder().group, effOrder().cornerStart], def.slice(0, 3).concat(def[4]),
    'applied defaults reach the job order');
}
// 4. Persönliche Vorgabe: speichern legt alle 8 Felder in localStorage, neuer Dialog lädt sie, Reset nutzt sie — Gerät unberührt.
{
  const prevLS = (globalThis as any).localStorage;
  const mem: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => { mem[k] = String(v); },
    removeItem: (k: string) => { delete mem[k]; },
  };
  try {
    const devOf = () => [device.optInnerFirst, device.optTravel, device.optGroup, device.optCornerStart,
      device.optDirOrder, device.optBestStart, device.optBestDirection, device.optLessTurns];
    const deviceBefore = devOf();
    const selOf = (dlg: FakeEl) => elements(dlg).filter((e) => e.tagName === 'SELECT')[0];
    const dlg = open();
    const boxes = checks(dlg);
    boxes.forEach((b) => { b.checked = !b.checked; b.fire('change'); });
    selOf(dlg).value = 'rtl'; selOf(dlg).fire('change');
    button(dlg, 'Als Vorgabe speichern').fire('click');
    const stored = JSON.parse(mem['kizamu.optDefaults'] ?? 'null');
    assert.ok(stored, 'preset stored in localStorage');
    assert.deepEqual(Object.keys(stored).sort(),
      ['optInnerFirst', 'optTravel', 'optGroup', 'optCornerStart', 'optDirOrder', 'optBestStart', 'optBestDirection', 'optLessTurns'].sort(),
      'eight stored fields');
    assert.equal(stored.optDirOrder, 'rtl');
    assert.deepEqual(devOf(), deviceBefore, 'saving writes storage, not the device');
    button(dlg, 'Abbrechen').fire('click');
    // Neuer Dialog lädt die Vorgabe statt des Geräte-Presets
    const dlg2 = open();
    assert.deepEqual(checks(dlg2).map((b) => b.checked), boxes.map((b) => b.checked), 'stored preset preloads into the draft');
    assert.equal(selOf(dlg2).value, 'rtl');
    // Entwurf ändern, Reset stellt die Vorgabe wieder her
    const re = checks(dlg2);
    re[0].checked = !re[0].checked; re[0].fire('change');
    selOf(dlg2).value = 'btt'; selOf(dlg2).fire('change');
    button(dlg2, 'Auf Standard zurücksetzen').fire('click');
    assert.deepEqual(checks(dlg2).map((b) => b.checked), boxes.map((b) => b.checked), 'reset restores the stored preset');
    assert.equal(selOf(dlg2).value, 'rtl');
    assert.deepEqual(devOf(), deviceBefore, 'reset does not write to the device');
    button(dlg2, 'Abbrechen').fire('click');
    assert.deepEqual(devOf(), deviceBefore);
  } finally {
    (globalThis as any).localStorage = prevLS;
  }
}

// 5. Reset ohne Vorgabe stellt die Werksvorgabe wieder her.
{
  const dlg = open();
  const boxes = checks(dlg);
  boxes.forEach((b) => { b.checked = !b.checked; b.fire('change'); });
  const sel = elements(dlg).filter((e) => e.tagName === 'SELECT')[0];
  sel.value = 'ttb'; sel.fire('change');
  button(dlg, 'Auf Standard zurücksetzen').fire('click');
  assert.deepEqual(boxes.map((b) => b.checked),
    [DEFAULT_DEVICE.optInnerFirst, DEFAULT_DEVICE.optTravel, DEFAULT_DEVICE.optGroup,
      DEFAULT_DEVICE.optLessTurns, DEFAULT_DEVICE.optCornerStart, DEFAULT_DEVICE.optBestStart, DEFAULT_DEVICE.optBestDirection]);
  assert.equal(sel.value, DEFAULT_DEVICE.optDirOrder);
  button(dlg, 'Abbrechen').fire('click');
  assert.equal(dlg.isConnected, false);
}
(globalThis as any).document = prevDoc;
console.log('optimize dialog: draft/cancel/reset/apply passed');
