// Tests für den Katalog der Erweiterungen: bauen, signieren, Signatur und Prüfsummen prüfen, Zustände.
// Aufruf: npm run test:catalog
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { etc, getPublicKeyAsync, signAsync } from '@noble/ed25519';
const g = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const C = await import('../src/catalog');
const P = await import('../src/packs');

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

const secret = etc.hexToBytes('11'.repeat(32));
const pub = etc.bytesToHex(await getPublicKeyAsync(secret));
const sign = async (text: string) => Buffer.from(await signAsync(new TextEncoder().encode(text), secret)).toString('base64');
const pack = (version: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  format: 'kizamubeam-pack', id: 'de.test.katalog', version, name: { de: 'Katalogtest', en: 'Catalogue test' },
  devices: [{ name: 'Testlaser', fw: 'grbl', bedW: 300, bedH: 200 }], ...extra,
});

await test('Eingetragener Schlüssel ist leer (noch nicht eingerichtet) oder ein Ed25519-Schlüssel (hex, 32 Byte)', async () => {
  assert.match(C.CATALOG_PUBKEY, /^([0-9a-f]{64})?$/);
  if (!C.CATALOG_PUBKEY) await assert.rejects(() => C.fetchCatalog(), /keinen Schlüssel/);
});

await test('buildCatalog: Einträge mit Prüfsumme; Dateiname muss zur Kennung passen', async () => {
  const text = pack('1.0.0');
  const cat = C.parseCatalog(await C.buildCatalog([['de.test.katalog.kzp', text]], '2026-10-20T00:00:00Z'));
  assert.equal(cat.packs.length, 1);
  const e = cat.packs[0];
  assert.equal(e.sha256, await C.sha256Hex(text));
  assert.deepEqual([e.devices, e.templates, e.materials], [1, 0, 0]);
  assert.equal(e.file, 'de.test.katalog.kzp');
  await assert.rejects(() => C.buildCatalog([['falsch.kzp', text]], ''), /heißen/);
  await assert.rejects(() => C.buildCatalog([['de.test.katalog.kzp', '{']], ''), /JSON/);
});

await test('buildCatalog: alle Pakete in packs/ sind gültig', async () => {
  const dir = new URL('../packs/', import.meta.url);
  const names = readdirSync(dir).filter((f) => f.endsWith('.kzp'));
  assert.ok(names.length > 0);
  await C.buildCatalog(names.map((n) => [n, readFileSync(new URL(n, dir), 'utf8')]), '');
});

await test('verifyCatalog: echte Signatur ja, geänderter Text, falscher Schlüssel oder Unsinn nein', async () => {
  const text = await C.buildCatalog([['de.test.katalog.kzp', pack('1.0.0')]], '');
  const sig = await sign(text);
  assert.equal(await C.verifyCatalog(text, sig, pub), true);
  assert.equal(await C.verifyCatalog(text.replace('1.0.0', '9.9.9'), sig, pub), false);
  assert.equal(await C.verifyCatalog(text, sig, C.CATALOG_PUBKEY), false);
  assert.equal(await C.verifyCatalog(text, 'kaputt', pub), false);
  assert.equal(await C.verifyCatalog(text, sig, ''), false);
});

await test('parseCatalog: fehlerhafte Einträge fallen weg, falsches Format wird abgelehnt', () => {
  const ok = { id: 'a.b', version: '1.0.0', name: 'A', file: 'a.b.kzp', sha256: 'a'.repeat(64) };
  const cat = C.parseCatalog(JSON.stringify({ format: 'kizamubeam-catalog', packs: [ok, { ...ok, file: '../x.kzp' }, { ...ok, sha256: 'xyz' }, { ...ok, name: '' }, null] }));
  assert.equal(cat.packs.length, 1);
  assert.throws(() => C.parseCatalog('{"format":"anders","packs":[]}'), /Kein KizamuBeam-Katalog/);
});

await test('catalogState: installieren, aktualisieren, installiert, neuer installiert, App zu alt', () => {
  const e = C.parseCatalog(JSON.stringify({ format: 'kizamubeam-catalog', packs: [{ id: 'de.test.katalog', version: '1.1.0', minApp: '1.2.0', name: 'x', file: 'de.test.katalog.kzp', sha256: 'a'.repeat(64) }] })).packs[0];
  const v = (s: string) => P.parsePack(pack(s));
  assert.equal(C.catalogState(e, undefined, '1.2.1'), 'install');
  assert.equal(C.catalogState(e, v('1.0.0'), '1.2.1'), 'update');
  assert.equal(C.catalogState(e, v('1.1.0'), '1.2.1'), 'installed');
  assert.equal(C.catalogState(e, v('2.0.0'), '1.2.1'), 'newer-installed');
  assert.equal(C.catalogState(e, undefined, '1.1.9'), 'needs-app');
});

await test('fetchCatalog + fetchCatalogPack: Signatur und Prüfsumme werden geprüft', async () => {
  const text = pack('1.0.0');
  const catText = await C.buildCatalog([['de.test.katalog.kzp', text]], '');
  const files = new Map<string, string>([
    ['https://x.test/c/catalog.json', catText],
    ['https://x.test/c/catalog.json.sig', await sign(catText)],
    ['https://x.test/c/de.test.katalog.kzp', text],
  ]);
  g.fetch = async (u: string) => ({ ok: files.has(u), status: files.has(u) ? 200 : 404, text: async () => files.get(u) ?? '' });
  const cat = await C.fetchCatalog('https://x.test/c/catalog.json', pub);
  assert.equal(await C.fetchCatalogPack(cat.packs[0], 'https://x.test/c/catalog.json'), text);
  // Paket auf dem Server ausgetauscht → Prüfsumme passt nicht
  files.set('https://x.test/c/de.test.katalog.kzp', pack('1.0.0', { author: 'jemand' }));
  await assert.rejects(() => C.fetchCatalogPack(cat.packs[0], 'https://x.test/c/catalog.json'), /Prüfsumme/);
  // Katalog ausgetauscht → Signatur passt nicht
  files.set('https://x.test/c/catalog.json', catText.replace('"1.0.0"', '"1.0.1"'));
  await assert.rejects(() => C.fetchCatalog('https://x.test/c/catalog.json', pub), /Signatur/);
  files.delete('https://x.test/c/catalog.json.sig');
  await assert.rejects(() => C.fetchCatalog('https://x.test/c/catalog.json', pub), /nicht erreichbar/);
});

await test('fetchCatalog: falls back to the next mirror, packages come from the mirror that answered', async () => {
  const text = pack('1.0.0');
  const catText = await C.buildCatalog([['de.test.katalog.kzp', text]], '');
  const files = new Map<string, string>([
    ['https://bad.test/catalog.json', catText.replace('"1.0.0"', '"9.0.0"')],
    ['https://bad.test/catalog.json.sig', await sign(catText)],
    ['https://b.test/c/catalog.json', catText],
    ['https://b.test/c/catalog.json.sig', await sign(catText)],
    ['https://b.test/c/de.test.katalog.kzp', text],
  ]);
  g.fetch = async (u: string) => ({ ok: files.has(u), status: files.has(u) ? 200 : 404, text: async () => files.get(u) ?? '' });
  const cat = await C.fetchCatalog(['https://gone.test/catalog.json', 'https://bad.test/catalog.json', 'https://b.test/c/catalog.json'], pub);
  assert.equal(cat.packs[0].id, 'de.test.katalog');
  assert.equal(await C.fetchCatalogPack(cat.packs[0]), text);
  // nothing usable: a wrong signature is reported rather than "not reachable"
  await assert.rejects(() => C.fetchCatalog(['https://gone.test/catalog.json', 'https://bad.test/catalog.json'], pub), /Signatur/);
  await assert.rejects(() => C.fetchCatalog(['https://gone.test/catalog.json'], pub), /nicht erreichbar/);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
