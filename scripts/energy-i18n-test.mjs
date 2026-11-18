// Exercise Vite's real import.meta.glob locale loading, without the application or hardware.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const files = ['src/energy.ts', 'src/energyUi.ts'];
const keys = [...new Set(files.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/\bt\('([^']+)'/g)].map(match => match[1])))];
assert.match(readFileSync('src/laser.ts', 'utf8'), /newTab\(t\('Energie'\)\)/);
keys.push('Energie');
assert.equal(keys.length, 42);
const english = JSON.parse(readFileSync('src/locales/en.json', 'utf8'));
for (const key of keys) assert.notEqual(key, english[key], `Feature text must use a German source key: ${key}`);
const labels = { de: 'Stromtarif (EUR/kWh)', en: 'Electricity tariff (EUR/kWh)', es: 'Tarifa eléctrica (EUR/kWh)', it: 'Tariffa elettrica (EUR/kWh)', 'pt-BR': 'Tarifa de eletricidade (EUR/kWh)' };
let passed = 0;
let failed = 0;
for (const [language, label] of Object.entries(labels)) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['en-US'] } });
  globalThis.localStorage = { getItem: key => key === 'kizamubeam.lang' ? language : null };
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { lang, t, LANGUAGES } = await server.ssrLoadModule('/src/i18n.ts');
    const { electricityTariffField } = await server.ssrLoadModule('/src/energyUi.ts');
    assert.equal(lang, language);
    assert.equal(LANGUAGES.length, 5);
    assert.equal(electricityTariffField().label, label);
    const dictionary = language === 'de' ? null : JSON.parse(readFileSync(`src/locales/${language}.json`, 'utf8'));
    for (const key of keys) {
      if (dictionary) assert.ok(dictionary[key], `${language}: missing feature translation: ${key}`);
      assert.equal(t(key, { n: 2 }), (dictionary?.[key] ?? key).replace('{n}', '2'));
    }
    assert.equal(t('Zubehör {n}', { n: 2 }), { de: 'Zubehör 2', en: 'Accessory 2', es: 'Accesorio 2', it: 'Accessorio 2', 'pt-BR': 'Acessório 2' }[language]);
    passed++;
    console.log(`ok ${language}: language preference, settings field label, ${keys.length} feature keys and placeholder`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${language}: ${error.message}`);
  } finally {
    await server.close();
  }
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
