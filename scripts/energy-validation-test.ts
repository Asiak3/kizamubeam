import './core-fixtures-env';
import assert from 'node:assert/strict';
import { energyDraft, setElectricityTariffText, electricityTariffText } from '../src/energy';
import { electricityTariffField, energyPreview, energySettingsRows, saveEnergySettings } from '../src/energyUi';
import { applyChanges, loadValues, SettingsSection } from '../src/settings/registry';

// Small offline DOM double: runs the actual h() controls and their event handlers.
class Element {
  children: (Element | string)[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, ((event: unknown) => void)[]>();
  className = ''; value = ''; id = ''; hidden = false;
  focused = false; reported = false; validationMessage = '';
  validity = { badInput: false, valid: true };
  classList = { add: (name: string) => { this.className += ` ${name}`; } };
  constructor(public tag: string) {}
  append(...nodes: (Element | string)[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: (Element | string)[]) { this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; if (key === 'value') this.value = value; if (key === 'id') this.id = value; }
  addEventListener(type: string, handler: (event: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]); }
  querySelectorAll(tag: string): Element[] { return this.children.flatMap(c => c instanceof Element ? [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)] : []); }
  querySelector(tag: string) { return this.querySelectorAll(tag)[0] ?? null; }
  get lastElementChild() { return this.children.filter(c => c instanceof Element).at(-1); }
  get tagName() { return this.tag.toUpperCase(); }
  setCustomValidity(message: string) { this.validationMessage = message; this.validity.valid = !message; }
  reportValidity() { this.reported = true; return this.validity.valid; }
  focus() { this.focused = true; }
  click() { this.listeners.get('click')?.forEach(handler => handler({ target: this })); }
  input(value: string, badInput = false) {
    this.value = value; this.validity = { badInput, valid: !badInput && (value === '' || Number(value) >= 0) };
    this.listeners.get('input')?.forEach(handler => handler({ target: this }));
  }
  get textContent(): string { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  set textContent(text: string) { this.children = [text]; }
}
Object.assign(document, { createElement: (tag: string) => new Element(tag) });
const controls = (rows: HTMLElement[]) => rows.flatMap(row => [(row as unknown as Element), ...(row as unknown as Element).querySelectorAll('input')]).filter(row => row.tag === 'input');
let failed = 0, passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); passed++; console.log(`ok ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}:`, error); }
}
await test('invalid rendered wattage preserves the last valid draft instead of becoming blank', () => {
  const draft = energyDraft({ baseWatts: 100, laserWatts: [10, 50, 100], consumers: [] });
  const [base] = controls(energySettingsRows(draft));
  base.input('-1');
  assert.equal(draft.baseWatts, 100);
});
await test('rendered field has an associated visible error naming the problem and fix', () => {
  const rows = energySettingsRows(energyDraft());
  const [base] = controls(rows);
  base.input('-1');
  const all = rows.flatMap(row => [row as unknown as Element, ...(row as unknown as Element).querySelectorAll('div')]);
  const error = all.find(el => el.id === base.attributes['aria-describedby'])!;
  assert.ok(error); assert.equal(error.hidden, false);
  assert.match(error.textContent, /endliche, nicht negative/);
  assert.match(error.textContent, /Geben Sie 0.*leeren Sie das Feld/);
  assert.equal(base.attributes['aria-invalid'], 'true');
  assert.equal(base.validationMessage, error.textContent);
  base.input('0');
  assert.equal(error.hidden, true); assert.equal(error.textContent, '');
  assert.equal(base.attributes['aria-invalid'], 'false');
});
await test('actual device save guard blocks all writes until correction; blank and zero save intentionally', () => {
  const saved = { baseWatts: 100, laserWatts: [10, 50, 100] as [number, number, number], consumers: [] };
  const draft = energyDraft(saved);
  const rows = energySettingsRows(draft);
  const [base, laser] = controls(rows);
  let writes = 0, shown = 0;
  const save = () => saveEnergySettings(rows, () => shown++, () => { writes++; Object.assign(saved, energyDraft(draft)); });
  laser.input('20'); base.input('-1');
  assert.equal(save(), false); assert.equal(writes, 0); assert.equal(shown, 1);
  assert.equal(base.focused, true); assert.equal(base.reported, true);
  assert.equal(saved.baseWatts, 100); assert.deepEqual(saved.laserWatts, [10, 50, 100]);
  base.input('', true); // Browser-native bad input can have an empty value: it is not an intentional blank.
  assert.equal(save(), false); assert.equal(draft.baseWatts, 100);
  base.input('125'); assert.equal(save(), true); assert.equal(saved.baseWatts, 125);
  assert.deepEqual(saved.laserWatts, [20, 50, 100]);
  base.input(''); assert.equal(save(), true); assert.equal(saved.baseWatts, null);
  base.input('0'); assert.equal(save(), true); assert.equal(saved.baseWatts, 0);
  assert.equal(writes, 3);
});
await test('accessory list changes retain invalid field state and cannot bypass the save guard', () => {
  const draft = energyDraft({ baseWatts: 100, laserWatts: [10, 50, 100], consumers: [{ name: 'Fan', watts: 20, included: true, rule: 'job' }] });
  const rows = energySettingsRows(draft);
  const watts = controls(rows).find(input => input.value === '20')!;
  watts.input('-1');
  const add = rows.find(row => (row as unknown as Element).tag === 'button') as unknown as Element;
  add.click();
  assert.ok(controls(rows).includes(watts)); assert.equal(watts.value, '-1');
  assert.equal(saveEnergySettings(rows, () => {}, () => assert.fail('invalid accessory saved')), false);
  assert.equal(draft.consumers[0].watts, 20);
});
await test('cancel leaves storage and source unchanged after valid and invalid field edits', () => {
  const saved = { baseWatts: 100, laserWatts: [10, 50, 100] as [number, number, number], consumers: [] };
  const rows = energySettingsRows(energyDraft(saved));
  const [base, laser] = controls(rows); base.input('125'); laser.input('-1');
  // Cancel deliberately does not cross the device's save boundary.
  assert.equal(saved.baseWatts, 100); assert.deepEqual(saved.laserWatts, [10, 50, 100]);
});
await test('tariff save rejects negative, non-finite and arbitrary input without overwriting storage', () => {
  const data = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  setElectricityTariffText('0.35');
  for (const invalid of ['-1', 'Infinity', 'NaN', 'abc', '0.35EUR']) {
    assert.throws(() => setElectricityTariffText(invalid));
    assert.equal(electricityTariffText(), '0.35');
  }
});
await test('actual General tariff field reports rejected saves through the settings registry and preserves stored value', async () => {
  setElectricityTariffText('0.35');
  const field = electricityTariffField();
  const section: SettingsSection = { id: 'general', title: '', order: 0, fields: [field] };
  for (const invalid of ['-1', 'Infinity', 'NaN', 'text', '0.35EUR']) {
    const before = await loadValues([section]);
    const draft = new Map(before); draft.set(field.id, invalid);
    const result = await applyChanges([section], before, draft);
    assert.deepEqual(result.changed, []); assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].id, field.id);
    assert.match((result.errors[0].error as Error).message, /Stromtarif.*endliche, nicht negative.*leeren Sie das Feld/);
    assert.equal(electricityTariffText(), '0.35');
  }
  for (const valid of ['', '0', '0.42']) {
    const before = await loadValues([section]); const draft = new Map(before); draft.set(field.id, valid);
    assert.equal(electricityTariffText(), before.get(field.id)); // Still only a draft (Cancel is safe).
    const result = await applyChanges([section], before, draft);
    assert.deepEqual(result.errors, []); assert.equal(electricityTariffText(), valid);
  }
});
await test('preview uses a headed numeric table, a distinct total and collapsed model help', () => {
  const result = { total: 0.00000001, components: [
    { name: '', included: true, kWh: 0.00000001 },
    { name: '', included: true, kWh: 0 },
    { name: 'Fan', included: false, kWh: null },
  ] } as Parameters<typeof energyPreview>[0];
  const before = JSON.stringify(result);
  const preview = energyPreview(result, 0.35) as unknown as Element;
  assert.equal(preview.querySelectorAll('table').length, 1);
  assert.equal(preview.querySelectorAll('thead').length, 1);
  assert.equal(preview.querySelectorAll('tfoot').length, 1);
  assert.match(preview.querySelector('thead')!.textContent, /kWh.*EUR/);
  assert.match(preview.querySelector('tbody')!.textContent, /<0\.0001/);
  assert.match(preview.querySelector('tbody')!.textContent, /Nicht einbezogen/);
  const help = preview.querySelector('details')!;
  assert.ok(help); assert.equal(help.attributes.open, undefined);
  assert.ok(help.querySelector('summary')!.textContent);
  assert.match(help.textContent, /XY-Bewegungszeit.*Controller-Verzögerungen/);
  const caveat = preview.querySelectorAll('p').find(p => p.className === 'note energy-caveat')!;
  assert.ok(caveat); assert.ok(caveat.textContent.length < 110);
  assert.equal(JSON.stringify(result), before);
});
await test('preview retains unknown and excluded states and hides tariff-less cost column', () => {
  const result = { total: null, components: [
    { name: '', included: true, kWh: null },
    { name: '', included: true, kWh: 0.5 },
    { name: 'Fan', included: false, kWh: null },
  ] } as Parameters<typeof energyPreview>[0];
  const preview = energyPreview(result, null) as unknown as Element;
  assert.doesNotMatch(preview.querySelector('thead')!.textContent, /EUR/);
  assert.match(preview.textContent, /Unbekannt.*Nicht einbezogen/);
  assert.match(preview.textContent, /Geräteeinstellungen → Energie/);
  assert.match(preview.textContent, /Stromtarif/);
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
