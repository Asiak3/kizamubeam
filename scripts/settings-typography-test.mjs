// Offline DOM harness: real settings dialog, fields and typography adapters; only i18n is stubbed.
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.value = '';
    this.className = '';
    this.props = new Map();
    this.style = { setProperty: (key, value) => this.props.set(key, value) };
    this.classList = { add: () => {}, toggle: () => {} };
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
    if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
    if (key === 'id') this.id = value;
    if (key === 'class') this.className = value;
  }
  addEventListener(name, fn) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  async dispatchEvent(event) {
    event.target ??= this;
    for (const fn of this.listeners.get(event.type) ?? []) await fn(event);
    await this[`on${event.type}`]?.(event);
    // Native modal-dialog default action, not an application Escape handler.
    if (event.type === 'keydown' && event.key === 'Escape') this.close();
  }
  append(...children) {
    for (const child of children) {
      this.children.push(child);
      if (typeof child !== 'string') child.parent = this;
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelectorAll(selector) {
    const match = (el) => selector.startsWith('.') ? el.className.split(' ').includes(selector.slice(1))
      : selector.startsWith('#') ? el.id === selector.slice(1)
      : selector.startsWith('[data-') ? el.attributes[selector.slice(1).split('=')[0]] === selector.split('"')[1]
      : el.tagName === selector.toUpperCase();
    return this.children.flatMap((child) => typeof child === 'string' ? [] : [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  showModal() { this.modal = true; }
  close() { this.modal = false; void this.dispatchEvent({ type: 'close' }); }
}
globalThis.document = {
  createElement: (tag) => new Element(tag), body: new Element('body'), documentElement: new Element('html'),
  getElementById: (id) => document.body.querySelector(`#${id}`),
};
const storage = new Map();
let writes = 0;
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { writes++; storage.set(key, value); } };
const bundle = await build({
  stdin: {
    contents: `export * from './src/settings/registry'; export * from './src/settings/dialog'; export * from './src/settings/typography'; export * from './src/uiTypography'; export * from './src/uiTypographyDom';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'offline-i18n', setup(build) {
    build.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'offline' }));
    build.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({ contents: 'export const t = s => s; export const dec = s => s;' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const groups = api.TYPOGRAPHY_GROUPS;
let theme = 'dark';
api.registerSettingsSection({ id: 'appearance', title: 'Darstellung', order: 1, fields: [
  { kind: 'select', id: 'appearance.theme', label: 'Design', options: () => [['dark', 'Dark'], ['light', 'Light']], def: 'light', get: () => theme, set: (value) => { theme = value; } },
  ...api.typographySettingsFields(),
] });
api.registerSettingsSection({ id: 'other', title: 'Other', order: 2, fields: [] });
const off = api.initTypographyDom();
const dialog = () => document.body.querySelector('dialog');
const slider = (group) => document.getElementById(`set-appearance.typography.${group}`);
const presets = [80, 100, 125, 150];
const assertValue = (group, value) => {
  const el = slider(group);
  assert.equal(el.value, String(presets.indexOf(value)));
  assert.equal(el.attributes['aria-valuetext'], `${value} %`);
  assert.equal(el.parent.querySelector('.settings-slider-value').textContent, `${value} %`);
};
const preview = () => dialog().querySelector('.settings-typography-preview');
const click = (el) => el.dispatchEvent({ type: 'click' });
const button = (text) => dialog().querySelectorAll('button').find((el) => el.children.includes(text));
const change = async (group, value) => {
  assert.ok(presets.includes(value));
  slider(group).value = String(presets.indexOf(value));
  await slider(group).dispatchEvent({ type: 'input' });
  assertValue(group, value);
};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok   ${name}`); }

await test('Real fields expose native discrete ranges, defaults, visible percentages and associated labels', async () => {
  await api.openSettings('appearance');
  for (const group of groups) {
    const el = slider(group);
    assert.equal(el.tagName, 'INPUT');
    assert.equal(el.attributes.type, 'range');
    assert.equal(el.attributes.min, '0');
    assert.equal(el.attributes.max, '3');
    assert.equal(el.attributes.step, '1');
    assertValue(group, 100);
    assert.ok(dialog().querySelectorAll('label').some((label) => label.attributes.for === el.id));
  }
});
await test('Every slider index maps exactly to a preset including both endpoints, on input only', async () => {
  for (const group of groups) {
    for (const value of presets) {
      await change(group, value);
      assert.equal(preview().props.get(`--ty-${group}`), String(value / 100));
    }
    await change(group, 100);
  }
  assert.equal(writes, 0);
});
await test('Every draft control updates only its own preview factor, without storage or global changes', async () => {
  const values = [125, 80, 150, 125];
  for (const [i, group] of groups.entries()) {
    await change(group, values[i]);
    assert.equal(preview().props.get(`--ty-${group}`), String(values[i] / 100));
    assert.equal(document.documentElement.props.get(`--ty-${group}`), '1');
  }
  assert.equal(writes, 0);
  assert.deepEqual(Object.values(api.getTypography()), [100, 100, 100, 100]);
});
await test('Section changes and search recreate preview from the same draft', async () => {
  await click(button('Other'));
  await click(button('Darstellung'));
  assertValue('technical', 150);
  const search = dialog().querySelector('.settings-search');
  search.value = 'Schrift';
  await search.dispatchEvent({ type: 'input' });
  assert.equal(preview().props.get('--ty-technical'), '1.5');
  assertValue('technical', 150);
  await change('technical', 125);
  assert.equal(preview().props.get('--ty-technical'), '1.25');
  search.value = '';
  await search.dispatchEvent({ type: 'input' });
});
await test('Cancel discards all draft changes', async () => {
  await click(button('Abbrechen'));
  assert.equal(dialog(), null);
  assert.equal(writes, 0);
  await api.openSettings('appearance');
  assertValue('technical', 100);
});
await test('OK uses live setters and updates the global adapter without restart', async () => {
  await change('interface', 150);
  await change('supporting', 80);
  await click(button('OK'));
  assert.equal(dialog(), null);
  assert.equal(writes, 2);
  assert.equal(api.getTypography().interface, 150);
  assert.equal(document.documentElement.props.get('--ty-interface'), '1.5');
});
await test('Non-identity global factors never multiply local preview baselines', async () => {
  await api.openSettings('appearance');
  await change('interface', 125);
  assert.equal(preview().props.get('--ty-interface'), '1.25');
  assert.equal(document.documentElement.props.get('--ty-interface'), '1.5');
  for (const el of preview().children) assert.match(el.attributes.style, /^font-size:calc\((11|12)px \* var\(--ty-/);
});
await test('Single-group reset and all-text reset affect draft only, preserving theme', async () => {
  await change('interface', 100);
  assert.equal(preview().props.get('--ty-interface'), '1');
  assert.equal(preview().props.get('--ty-supporting'), '0.8');
  await click(button('Alle Schriftgruppen zurücksetzen'));
  for (const group of groups) {
    assertValue(group, 100);
    assert.equal(preview().props.get(`--ty-${group}`), '1');
  }
  assert.equal(document.getElementById('set-appearance.theme').value, 'dark');
  assert.equal(theme, 'dark');
  assert.equal(writes, 2);
  assert.equal(document.activeElement.id, 'settings-reset-typography');
});
await test('Section Defaults refresh preview without applying; native Escape discards draft', async () => {
  await change('workspace', 150);
  await click(button('Standard'));
  for (const group of groups) {
    assert.equal(preview().props.get(`--ty-${group}`), '1');
    assertValue(group, 100);
  }
  assert.equal(document.getElementById('set-appearance.theme').value, 'light');
  assert.equal(theme, 'dark');
  await dialog().dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation() {} });
  assert.equal(dialog(), null);
  assert.equal(writes, 2);
  assert.equal(api.getTypography().interface, 150);
});
await test('All-text reset persists only after OK, preserving other appearance settings', async () => {
  await api.openSettings('appearance');
  await click(button('Alle Schriftgruppen zurücksetzen'));
  await click(button('OK'));
  assert.deepEqual(Object.values(api.getTypography()), [100, 100, 100, 100]);
  assert.equal(theme, 'dark');
  assert.equal(writes, 4);
});
off();
console.log(`${passed} settings typography tests passed`);
