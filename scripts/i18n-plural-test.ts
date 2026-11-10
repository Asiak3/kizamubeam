// Tests for singular/plural in translations (issue #193). Run: npm run test:i18n
import { strict as assert } from 'node:assert';
const g = globalThis as Record<string, unknown>;
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en', languages: ['en'] }, configurable: true });
g.localStorage = { getItem: () => null, setItem() {} };
g.document ??= { documentElement: { lang: 'en', dataset: {} } };
const { lang, pluralCategory, t, tn, tBackend } = await import('../src/i18n');

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

test('UI language of the test is English', () => assert.equal(lang, 'en'));

test('Plural categories follow the language rules', () => {
  assert.equal(pluralCategory(1, 'en'), 'one');
  assert.equal(pluralCategory(0, 'en'), 'other');
  assert.equal(pluralCategory(1, 'es'), 'one');
  assert.equal(pluralCategory(2, 'es'), 'other');
  assert.equal(pluralCategory(0, 'fr'), 'one');
  assert.equal(pluralCategory(21, 'ru'), 'one');
  assert.equal(pluralCategory(3, 'ru'), 'few');
  assert.equal(pluralCategory(5, 'ja'), 'other');
});

test('Singular and plural with different German texts', () => {
  assert.equal(tn('{n} Objekt', '{n} Objekte', 1), '1 object');
  assert.equal(tn('{n} Objekt', '{n} Objekte', 0), '0 objects');
  assert.equal(tn('{n} Objekt', '{n} Objekte', 2), '2 objects');
});

test('Same German text for singular and plural: the context tells them apart', () => {
  assert.equal(tn('{n} Fehler|one', '{n} Fehler', 1), '1 error');
  assert.equal(tn('{n} Fehler|one', '{n} Fehler', 3), '3 errors');
  assert.equal(tn(' · {n} Fehler|one', ' · {n} Fehler', 1), ' · 1 error');
  assert.equal(tn(' · {n} Fehler|one', ' · {n} Fehler', 2), ' · 2 errors');
});

test('Count is formatted for the UI language, other placeholders stay', () => {
  assert.equal(tn('{file}: {n} Eintrag hinzugefügt', '{file}: {n} Einträge hinzugefügt', 1200, { file: 'a.kzm' }), 'a.kzm: 1,200 entries added');
});

test('Missing translation falls back to German without the context', () => {
  assert.equal(tn('Nur deutsch {n}|one', 'Nur deutsch {n} mal', 1), 'Nur deutsch 1');
  assert.equal(tn('Nur deutsch {n}|one', 'Nur deutsch {n} mal', 2), 'Nur deutsch 2 mal');
  assert.equal(t('Nur deutsch|Kontext'), 'Nur deutsch');
});

test('Messages from the Rust part pick the plural form', () => {
  assert.equal(tBackend('Fertig nach 1:05 min, 1 Fehler'), 'Finished after 1:05 min, 1 error');
  assert.equal(tBackend('Fertig nach 1:05 min, 4 Fehler'), 'Finished after 1:05 min, 4 errors');
  assert.equal(tBackend('Fertig nach 1:05 min'), 'Finished after 1:05 min');
});

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
