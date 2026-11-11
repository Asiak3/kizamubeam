// Tests for the settings window registry (sections, search, OK/Cancel). Run: npm run test:settings
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const {
  addSettingsFields, applyChanges, clearSettingsRegistry, fold, loadValues, matchesSearch, registerSettingsSection, sectionDefaults, settingsSections,
} = await import('../src/settings/registry');
type Section = Parameters<typeof registerSettingsSection>[0];

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

/** Section with an in-memory store; log records every setter and commit */
function fake(id: string, order: number, store: Record<string, unknown>, log: string[], extra: Partial<Section> = {}): Section {
  return {
    id, title: id.toUpperCase(), order,
    fields: [
      { kind: 'toggle', id: `${id}.a`, label: 'Alpha', keywords: 'Überlappung', def: false, get: () => store.a as boolean, set: (v) => void (log.push(`${id}.a=${v}`), (store.a = v)) },
      { kind: 'number', id: `${id}.n`, label: 'Number', def: 5, get: () => store.n as number, set: (v) => void (log.push(`${id}.n=${v}`), (store.n = v)) },
      { kind: 'select', id: `${id}.lang`, label: 'Language', late: true, options: () => [['de', 'de'], ['en', 'en']], get: () => store.lang as string, set: (v) => void (log.push(`${id}.lang=${v}`), (store.lang = v)) },
      { kind: 'action', id: `${id}.btn`, label: 'Open', button: 'Open', run: () => log.push('run') },
      { kind: 'toggle', id: `${id}.hidden`, label: 'Hidden', when: () => false, get: () => true, set: () => void log.push('hidden') },
    ],
    commit: () => void log.push(`${id}.commit`),
    ...extra,
  };
}

await test('Sections sorted by order; fields added before or after registering', () => {
  clearSettingsRegistry();
  addSettingsFields('b', [{ kind: 'action', id: 'b.early', label: 'Early', button: 'x', run: () => {} }]);
  registerSettingsSection(fake('b', 20, {}, []));
  registerSettingsSection(fake('a', 10, {}, []));
  addSettingsFields('a', [{ kind: 'action', id: 'a.late', label: 'Late', button: 'x', run: () => {} }]);
  addSettingsFields('a', [{ kind: 'action', id: 'a.late', label: 'Late 2', button: 'x', run: () => {} }]);
  const list = settingsSections();
  assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
  assert.ok(list[1].fields.some((f) => f.id === 'b.early'));
  assert.deepEqual(list[0].fields.filter((f) => f.id === 'a.late').map((f) => f.label), ['Late 2']);
});

await test('Search folds accents and needs every word', () => {
  const s = fake('x', 1, {}, []);
  assert.equal(fold('Überlappung'), 'uberlappung');
  assert.ok(matchesSearch(s.fields[0], s, 'uberlapp'));
  assert.ok(matchesSearch(s.fields[0], s, 'alpha X'));
  assert.ok(!matchesSearch(s.fields[0], s, 'alpha number'));
  assert.ok(matchesSearch(s.fields[1], s, ''));
});

await test('Only changed values are written, commit once per section, late fields last', async () => {
  const log: string[] = [];
  const s1 = { a: false, n: 5, lang: 'de' };
  const s2 = { a: false, n: 5, lang: 'de' };
  const list = [fake('p', 1, s1, log), fake('q', 2, s2, log)];
  const before = await loadValues(list);
  assert.ok(!before.has('p.hidden'), 'hidden fields are not read');
  assert.ok(!before.has('p.btn'), 'actions have no value');
  const draft = new Map(before);
  draft.set('p.lang', 'en');
  draft.set('p.n', 7);
  draft.set('q.a', false); // unchanged
  const res = await applyChanges(list, before, draft);
  assert.deepEqual(log, ['p.n=7', 'p.commit', 'p.lang=en']);
  assert.deepEqual(res.changed.sort(), ['p.lang', 'p.n']);
  assert.equal(s2.n, 5);
  assert.deepEqual(res.errors, []);
});

await test('Cancel = no applyChanges: nothing is written', async () => {
  const log: string[] = [];
  const st = { a: false, n: 5, lang: 'de' };
  const list = [fake('c', 1, st, log)];
  const before = await loadValues(list);
  const draft = new Map(before);
  draft.set('c.a', true);
  assert.deepEqual(log, []);
  assert.equal(st.a, false);
});

await test('Errors of a setter or commit are reported, the rest still applies', async () => {
  const log: string[] = [];
  const st = { a: false, n: 5, lang: 'de' };
  const s = fake('e', 1, st, log, { commit: () => { throw new Error('port busy'); } });
  s.fields[1] = { ...s.fields[1], set: () => { throw new Error('bad'); } } as typeof s.fields[1];
  const before = await loadValues([s]);
  const draft = new Map(before);
  draft.set('e.a', true);
  draft.set('e.n', 9);
  const res = await applyChanges([s], before, draft);
  assert.equal(st.a, true);
  assert.deepEqual(res.errors.map((x) => x.id), ['e.n', 'e']);
});

await test('prepare() runs before get(); a failing prepare does not block other sections', async () => {
  let ready = false;
  const ok: Section = { id: 'r', title: 'R', order: 1, prepare: async () => void (ready = true), fields: [{ kind: 'toggle', id: 'r.t', label: 'T', get: () => ready, set: () => {} }] };
  const bad: Section = { id: 'f', title: 'F', order: 2, prepare: async () => { throw new Error('offline'); }, fields: [{ kind: 'toggle', id: 'f.t', label: 'T', get: () => { throw new Error('no'); }, set: () => {} }] };
  const v = await loadValues([ok, bad]);
  assert.equal(v.get('r.t'), true);
  assert.ok(!v.has('f.t'));
});

await test('Defaults cover only fields with def', () => {
  const s = fake('d', 1, {}, []);
  assert.deepEqual([...sectionDefaults(s)], [['d.a', false], ['d.n', 5]]);
});

await test('Built-in sections: unique ids, translated labels, no own storage', () => {
  const src = readFileSync(new URL('../src/settings/core.ts', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/\bid: '([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 20, 'fields found');
  assert.equal(new Set(ids).size, ids.length, 'field ids are unique');
  for (const m of src.matchAll(/\b(label|title|hint|button): ([^,\n]+)/g)) {
    assert.ok(/^t\(/.test(m[2]) || m[2].startsWith("'MCP"), `${m[1]} without t(): ${m[2]}`);
  }
  assert.ok(!/localStorage/.test(src), 'settings sections use the setters of their features, not localStorage');
  const sections = [...src.matchAll(/registerSettingsSection\(\{\s*id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(sections, ['general', 'appearance', 'workspace', 'input', 'machines', 'extensions']);
  for (const id of ids) assert.ok(sections.includes(id.split('.')[0]), `${id} belongs to a known section`);
});

await test('Menu: Edit → Settings, overlap item gone from File', () => {
  const ui = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
  assert.ok(ui.includes("[t('Einstellungen …'), '', () => void openSettings()]"));
  assert.ok(!ui.includes('Überlappungsauswahl einstellen'));
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
