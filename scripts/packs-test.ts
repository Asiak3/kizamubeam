// Tests für Erweiterungen (Inhaltspakete .kzp): Format prüfen, erlaubte Felder, Versionen, Materialien,
// Installieren und Entfernen im Browser-Speicher.
// Aufruf: npm run test:packs
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const g = globalThis as Record<string, unknown>;
// Meldungen auf Deutsch prüfen, unabhängig von der Sprache des Systems
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const P = await import('../src/packs');
const { library } = await import('../src/materials');
const { builtinTemplates } = await import('../src/builtinTemplates');
const { setBuiltinPresetFiles } = await import('../src/builtinPresets');
const { newDevice } = await import('../src/gcode');

// Built-in presets: read the files like Vite would bundle them (the test runner has no import.meta.glob)
const PRESET_DIR = 'presets/devices';
const presetFiles: Record<string, unknown> = {};
for (const e of readdirSync(PRESET_DIR, { recursive: true, withFileTypes: true }))
  if (e.isFile() && e.name.endsWith('.json')) {
    const path = join(e.parentPath, e.name);
    presetFiles[relative(PRESET_DIR, path)] = JSON.parse(readFileSync(path, 'utf8'));
  }
setBuiltinPresetFiles(presetFiles);
const PRESET_COUNT = Object.keys(presetFiles).length;
const LIST_COUNT = Object.values(presetFiles).reduce<number>((n, f) => n + ((f as { variants?: unknown[] }).variants?.length ?? 1), 0);

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

const base = (extra: Record<string, unknown> = {}) => ({
  format: 'kizamubeam-pack',
  formatVersion: 1,
  id: 'de.test.werkstatt',
  version: '1.0.0',
  name: { de: 'Werkstatt', en: 'Workshop' },
  devices: [{ name: 'Testlaser', fw: 'grbl', bedW: 300, bedH: 200 }],
  ...extra,
});
const pack = (extra: Record<string, unknown> = {}) => JSON.stringify(base(extra));
const throws = (text: string, re: RegExp) => assert.throws(() => P.parsePack(text, '1.2.1-beta'), (e: Error) => e instanceof P.PackError && re.test(e.message));

await test('parsePack: gültiges Paket, Name in der Sprache der Oberfläche', () => {
  const p = P.parsePack(pack());
  assert.equal(p.id, 'de.test.werkstatt');
  assert.equal(p.name, 'Werkstatt');
  assert.equal(p.devices.length, 1);
  assert.equal(P.localText({ en: 'Workshop', de: 'Werkstatt' }, 'en'), 'Workshop');
  assert.equal(P.localText({ fr: 'Atelier' }, 'en'), 'Atelier');
});

await test('parsePack: Aufbau-Fehler lehnen das ganze Paket ab', () => {
  throws('nicht json', /JSON/);
  throws(JSON.stringify({ ...base(), format: 'etwas' }), /Keine KizamuBeam-Erweiterung/);
  throws(pack({ formatVersion: 2 }), /neuere Version/);
  throws(pack({ id: 'Ohne Punkt' }), /Kennung/);
  throws(pack({ id: 'werkstatt' }), /Kennung/);
  throws(pack({ version: '1.0' }), /Version/);
  throws(pack({ name: '' }), /Name/);
  throws(pack({ devices: [] }), /leer/);
  throws(pack({ devices: {} }), /Liste/);
});

await test('parsePack: minApp gegen die App-Version', () => {
  assert.doesNotThrow(() => P.parsePack(pack({ minApp: '1.2.0' }), '1.2.1-beta'));
  throws(pack({ minApp: '1.3.0' }), /1\.3\.0 oder neuer/);
  throws(pack({ minApp: 'bald' }), /minApp/);
});

await test('Gerätevorlagen: nur erlaubte Felder, keine Skripte oder Adressen', () => {
  const p = P.parsePack(pack({
    devices: [{
      name: 'Laser', fw: 'fluidnc', bedW: 400, bedH: 300, baud: 230400, sMax: 1000, conn: 'ws', wsPort: 81, airCmd: 'M7',
      startScript: '$32=0', endScript: 'M3 S1000', host: '10.0.0.1', rotary: { mode: 'roller' }, agentMaxPower: 100, source: 'https://example.com',
    }],
  }));
  const d = p.devices[0];
  assert.deepEqual(d.preset, { name: 'Laser', fw: 'fluidnc', bedW: 400, bedH: 300, baud: 230400, sMax: 1000, conn: 'ws', wsPort: 81, airCmd: 'M7' });
  assert.equal(d.source, 'https://example.com');
});

await test('Gerätevorlagen: id, vendor, frameSpeed und nur Loopback-Adressen', () => {
  const dev = (extra: Record<string, unknown>) => P.parsePack(pack({ devices: [{ name: 'L', fw: 'grbl', bedW: 300, bedH: 200, ...extra }] })).devices[0];
  const d = dev({ id: 'acme.l1', vendor: { de: 'Acme', en: 'Acme Inc.' }, frameSpeed: 1500, host: '127.0.0.1' });
  assert.equal(d.id, 'acme.l1');
  assert.equal(d.vendor, 'Acme');
  assert.equal(d.preset.frameSpeed, 1500);
  assert.equal(d.preset.host, '127.0.0.1');
  // id and vendor never reach the device itself
  assert.equal((d.preset as Record<string, unknown>).vendor, undefined);
  assert.equal(dev({ host: 'localhost' }).preset.host, 'localhost');
  assert.equal(dev({ host: '127.10.0.255' }).preset.host, '127.10.0.255');
  for (const host of ['10.0.0.1', '192.168.1.5', 'fluidnc.local', '127.0.0.256', '127.0.0.1.evil.com', 'localhost:80', '::1', 5])
    assert.equal(dev({ host }).preset.host, undefined, String(host));
  assert.equal(dev({ id: 'Bad Id' }).id, undefined);
  assert.equal(dev({ vendor: '   ' }).vendor, undefined);
});

await test('Eingebaute Gerätevorlagen: jede Datei gültig, id passt zum Pfad, keine doppelten', () => {
  assert.ok(PRESET_COUNT >= 20);
  const ids = new Set<string>();
  for (const [file, raw] of Object.entries(presetFiles)) {
    const e = P.sanitizeDevice(raw, file);
    const expected = file.replace(/\\/g, '/').replace(/\.json$/, '').replace('/', '.');
    assert.equal(e.id, expected, file);
    assert.ok(!ids.has(e.id!), `doppelte id ${e.id}`);
    ids.add(e.id!);
    // Every field in the file must survive the check, otherwise it is silently lost
    const kept = { ...e.preset, id: e.id, vendor: e.vendor, source: e.source, sourceUrl: e.sourceUrl, checked: e.checked, measured: e.measured, features: e.features, variants: e.variants };
    for (const k of Object.keys(raw as object)) if (k !== 'name' && k !== 'vendor') assert.deepEqual(kept[k as keyof typeof kept], (raw as Record<string, unknown>)[k], `${file}: ${k}`);
    // Manufacturer presets name a source; generic ones have no manufacturer and live in generic/
    if (e.vendor) assert.ok(e.source, `${file}: source fehlt`);
    if (e.vendor) assert.ok(e.checked, `${file}: checked fehlt`);
    else assert.ok(file.replace(/\\/g, '/').startsWith('generic/'), `${file}: vendor fehlt`);
  }
  assert.equal(P.builtinPresets().length, PRESET_COUNT);
  const vm = P.builtinPresets().find((e) => e.id === 'kizamubeam.virtual-machine')!;
  assert.equal(vm.preset.host, '127.0.0.1');
  assert.equal(vm.preset.tcpPort, 2323);
});

await test('Gerätevorlagen gruppieren: Hersteller alphabetisch, dann allgemein, dann Pakete ohne Hersteller', () => {
  const e = (name: string, vendor?: string, pack?: string) => ({ preset: { name, fw: 'grbl' as const }, vendor, pack });
  const list = [e('Zeta Z', 'zeta'), e('GRBL'), e('Acme B', 'Acme'), e('Fremd', undefined, 'Paket'), e('Acme A', 'Acme', 'Paket'), e('Alpha', undefined)];
  const g = P.groupPresets(list, 'de');
  assert.deepEqual(g.map((x) => [x.vendor, x.fromPack]), [['Acme', false], ['zeta', false], ['', false], ['', true]]);
  assert.deepEqual(g[0].items.map((x) => x.entry.preset.name), ['Acme A', 'Acme B']);
  assert.deepEqual(g[0].items.map((x) => x.index), [4, 2]);
  assert.deepEqual(g[2].items.map((x) => x.entry.preset.name), ['Alpha', 'GRBL']);
});

await test('Paket-Vorlage mit der id einer eingebauten ersetzt diese', async () => {
  const before = P.presetList();
  const lm3 = before.filter((x) => (x.base ?? x.id) === 'ortur.laser-master-3').length;
  assert.ok(lm3 > 1, 'LM3 hat Varianten');
  // A pack preset without variants replaces the built-in one with all its variants, in the same place
  const at = before.findIndex((x) => x.base === 'ortur.laser-master-3');
  await P.installPack(pack({ id: 'de.test.fix', devices: [{ id: 'ortur.laser-master-3', vendor: 'Ortur', name: 'Ortur Laser Master 3', fw: 'grbl', bedW: 390, bedH: 390 }] }));
  const list = P.presetList();
  assert.equal(list.length, before.length - lm3 + 1);
  const e = list.find((x) => x.id === 'ortur.laser-master-3')!;
  assert.equal(list.indexOf(e), at);
  assert.equal(e.preset.bedW, 390);
  assert.equal(e.pack, 'Werkstatt');
  await P.removePack(P.installedPacks()[0].file);
  assert.equal(P.presetList().find((x) => x.id === 'ortur.laser-master-3:lu2-10a')!.preset.bedW, 400);
});

await test('Gerätevorlagen: Lasermodul, Ausstattung, Herkunft, Z-Achse, Zeiger-Versatz und Puffer', () => {
  const dev = (extra: Record<string, unknown>) => P.parsePack(pack({ devices: [{ name: 'L', fw: 'grbl', bedW: 300, bedH: 200, ...extra }] })).devices[0];
  const d = dev({
    laser: { type: 'diode', power: 10, wavelength: 455.4 }, features: ['air-assist', 'wifi', 'teleport'], sourceUrl: 'https://example.com/l', checked: '2026-11-16', measured: true,
    zAxis: true, zFlip: false, pointerOffset: { x: 20.5, y: -3, enabled: true }, rxBuffer: 1024, httpPort: 8080,
  });
  assert.deepEqual(d.preset.laser, { type: 'diode', power: 10, wavelength: 455 });
  assert.deepEqual(d.features, ['air-assist', 'wifi']);
  assert.equal(d.sourceUrl, 'https://example.com/l');
  assert.equal(d.checked, '2026-11-16');
  assert.equal(d.measured, true);
  assert.equal(d.preset.zAxis, true);
  assert.equal(d.preset.zFlip, false);
  assert.deepEqual(d.preset.pointerOffset, { x: 20.5, y: -3, enabled: true });
  assert.equal(d.preset.rxBuffer, 1024);
  assert.equal(d.preset.httpPort, 8080);
  // Metadata never ends up in a stored device
  for (const k of ['features', 'sourceUrl', 'checked', 'measured', 'variants']) assert.equal((d.preset as Record<string, unknown>)[k], undefined, k);
  // Invalid parts are dropped
  const bad = dev({ laser: { type: 'plasma', power: -1 }, sourceUrl: 'javascript:alert(1)', checked: '16.11.2026', features: 'wifi', pointerOffset: { x: 999, y: 0 }, rxBuffer: 10 });
  assert.equal(bad.preset.laser, undefined);
  assert.equal(bad.sourceUrl, undefined);
  assert.equal(bad.checked, undefined);
  assert.equal(bad.features, undefined);
  assert.equal(bad.preset.pointerOffset, undefined);
  assert.equal(bad.preset.rxBuffer, undefined);
  assert.equal(dev({ sourceUrl: 'http://example.com' }).sourceUrl, undefined);
  // A new device takes the laser module and pointer offset over, never the metadata
  const nd = newDevice(d.preset);
  assert.deepEqual(nd.laser, { type: 'diode', power: 10, wavelength: 455 });
  assert.notEqual(nd.laser, d.preset.laser);
  assert.deepEqual(nd.pointerOffset, { x: 20.5, y: -3, enabled: true });
  assert.equal(newDevice({ fw: 'grbl' }).laser, undefined);
});

await test('Gerätevorlagen: Varianten werden zu eigenen Einträgen', () => {
  const p = P.parsePack(pack({ devices: [{
    id: 'acme.l', vendor: 'Acme', name: 'Acme L', fw: 'grbl', bedW: 400, bedH: 400, laser: { type: 'diode', wavelength: 455 },
    variants: [{ id: '10w', name: '10 W', laser: { power: 10 } }, { id: 'ir', name: { de: 'IR 2 W', en: 'IR 2 W' }, bedH: 380, laser: { type: 'ir', power: 2 } }],
  }] }));
  const [a, b] = P.expandVariants(p.devices[0]);
  assert.equal(a.id, 'acme.l:10w');
  assert.equal(a.base, 'acme.l');
  assert.equal(a.preset.name, 'Acme L (10 W)');
  assert.deepEqual(a.preset.laser, { type: 'diode', wavelength: 455, power: 10 });
  assert.equal(a.preset.bedH, 400);
  assert.equal(b.preset.name, 'Acme L (IR 2 W)');
  assert.equal(b.preset.bedH, 380);
  assert.deepEqual(b.preset.laser, { type: 'ir', wavelength: 455, power: 2 });
  assert.equal((a as Record<string, unknown>).variants, undefined);
  const v = (variants: unknown) => pack({ devices: [{ name: 'x', fw: 'grbl', bedW: 300, bedH: 200, variants }] });
  throws(v([]), /variants/);
  throws(v([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]), /doppelter/);
  throws(v([{ id: 'A B', name: 'A' }]), /Kennung/);
  throws(v([{ id: 'a' }]), /ohne Name/);
  throws(v(Array.from({ length: 13 }, (_, i) => ({ id: `v${i}`, name: `V${i}` }))), /variants/);
});

await test('Gerätevorlagen: fehlende Pflichtfelder und Unsinn', () => {
  throws(pack({ devices: [{ fw: 'grbl', bedW: 300, bedH: 200 }] }), /Gerätevorlage 1: Name/);
  throws(pack({ devices: [{ name: 'x', fw: 'mach3', bedW: 300, bedH: 200 }] }), /Firmware/);
  throws(pack({ devices: [{ name: 'x', fw: 'grbl', bedW: 1, bedH: 200 }] }), /Arbeitsbereich/);
  // Ungültige freiwillige Werte fallen weg statt das Paket abzulehnen
  const p = P.parsePack(pack({ devices: [{ name: 'x', fw: 'grbl', bedW: 300, bedH: 200, baud: -5, conn: 'usb' }] }));
  assert.equal(p.devices[0].preset.baud, undefined);
  assert.equal(p.devices[0].preset.conn, undefined);
});

await test('Vorlagen: .kzt-Inhalt mit mehrsprachigem Titel; ohne „template“ abgelehnt', () => {
  const kzt = JSON.parse(builtinTemplates()[0].json());
  kzt.template.title = { de: 'Anhänger', en: 'Key fob' };
  const p = P.parsePack(pack({ templates: [kzt] }));
  assert.equal(p.templates[0].info.title, 'Anhänger');
  assert.equal(JSON.parse(p.templates[0].json).template.title, 'Anhänger');
  delete kzt.template;
  throws(pack({ templates: [kzt] }), /Vorlage 1/);
  throws(pack({ templates: [{ template: {} }] }), /Vorlage 1/);
});

await test('Materialien: stabile Kennungen mit Paket-Präfix, doppelte abgelehnt', () => {
  const m = { id: 'pappel3', material: 'Pappel', thickness: 3, title: 'Schneiden', settings: { mode: 'line', speed: 600, power: 80 } };
  const p = P.parsePack(pack({ materials: [m, { ...m, id: undefined, title: 'Gravieren' }] }));
  assert.equal(p.materials[0].id, 'pk:de.test.werkstatt:pappel3');
  assert.equal(p.materials[1].id, 'pk:de.test.werkstatt:2');
  assert.equal(p.materials[0].pack, 'de.test.werkstatt');
  throws(pack({ materials: [m, m] }), /doppelter/);
  throws(pack({ materials: [{ material: 'x' }] }), /Material 1/);
});

await test('Installieren, Update, Materialien übernehmen und Entfernen', async () => {
  const m = (title: string, power: number) => ({ id: title, material: 'Pappel', thickness: 3, title, settings: { mode: 'line', speed: 600, power } });
  await P.installPack(pack({ materials: [m('cut', 80), m('mark', 10)] }));
  assert.equal(P.installedPacks().length, 1);
  assert.equal(P.presetList().length, LIST_COUNT + 1);
  assert.equal(P.presetList().at(-1)!.pack, 'Werkstatt');
  assert.deepEqual(library.entries.map((e) => e.id), ['pk:de.test.werkstatt:cut', 'pk:de.test.werkstatt:mark']);
  // Hier geänderter Eintrag gehört danach der Person und bleibt beim Update
  library.update('pk:de.test.werkstatt:mark', { desc: 'eigene Notiz' });
  assert.equal(library.get('pk:de.test.werkstatt:mark')!.pack, undefined);

  assert.equal(P.installKind(P.parsePack(pack({ version: '1.1.0' }))).kind, 'update');
  assert.equal(P.installKind(P.parsePack(pack({ version: '0.9.0' }))).kind, 'downgrade');
  assert.equal(P.installKind(P.parsePack(pack())).kind, 'same');

  await P.installPack(pack({ version: '1.1.0', materials: [m('cut', 90), m('mark', 20)] }));
  assert.equal(P.installedPacks().length, 1);
  assert.equal(P.installedPacks()[0].pack.version, '1.1.0');
  assert.equal(library.get('pk:de.test.werkstatt:cut')!.settings.power, 90);
  assert.equal(library.get('pk:de.test.werkstatt:mark')!.settings.power, 10);

  await P.removePack(P.installedPacks()[0].file);
  assert.equal(P.installedPacks().length, 0);
  assert.deepEqual(library.entries.map((e) => e.id), ['pk:de.test.werkstatt:mark']);
});

await test('Kaputte Datei im Speicher erscheint als fehlerhaft, nicht als Absturz', async () => {
  mem.set('kizamubeam.packs', JSON.stringify({ 'de.kaputt.x.kzp': '{' }));
  await P.loadPacks();
  assert.equal(P.installedPacks().length, 0);
  assert.equal(P.brokenPacks()[0].file, 'de.kaputt.x.kzp');
  await P.removePack('de.kaputt.x.kzp');
  assert.equal(P.brokenPacks().length, 0);
});

await test('Beispielpaket in packs/ ist gültig', () => {
  const p = P.parsePack(readFileSync(new URL('../packs/org.kizamubeam.example.kzp', import.meta.url), 'utf8'));
  assert.ok(p.devices.length && p.materials.length && p.templates.length);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
