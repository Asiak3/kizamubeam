// Tests für „Einstellungen übertragen“: Abgleich, Export/Import, Geräte-Verbindung je Rechner. Aufruf: npm run test:sync
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Lokaler Speicher mit key()/length, wie im Browser
class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const store = new MemStorage();
(globalThis as Record<string, unknown>).localStorage = store;

const core = await import('../src/syncCore');
const data = await import('../src/syncData');
const sync = await import('../src/sync');
const { mergeStates, needValues, hashValue, parseBundle, parseSyncFile, deviceHash, stableJson } = core;

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

type Item = { h: string; load: () => unknown };
const items = (o: Record<string, unknown>): Record<string, Item> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { h: hashValue(v), load: () => v }]));
const ALL = [...core.SECTIONS];

/** Ein Rechner im Test: lokaler Stand, bekannter Stand und eigene Datei */
class Machine {
  local: Record<string, unknown> = {};
  known: core.Known = {};
  file: core.State = {};
  constructor(public name: string) {}
  sync(folder: Map<string, core.State>, now: number, first?: 'pull') {
    const remotes = [...folder.values()];
    const res = mergeStates(items(this.local), this.known, remotes, first ? 0 : now, this.name, ALL);
    for (const [k, e] of Object.entries(res.incoming)) {
      if (e.del) delete this.local[k];
      else this.local[k] = e.v;
    }
    for (const k of needValues(res.merged, folder.get(this.name) ?? null)) res.merged[k].v = this.local[k];
    this.known = res.known;
    folder.set(this.name, res.merged);
    return res;
  }
}

await test('Zwei Rechner: Änderungen und Löschungen kommen an', () => {
  const folder = new Map<string, core.State>();
  const a = new Machine('A'),
    b = new Machine('B');
  a.local = { 'settings/kizamubeam.theme': 'dark', 'materials/m1': { id: 'm1', material: 'Pappel' } };
  a.sync(folder, 100);
  b.sync(folder, 110);
  assert.deepEqual(b.local, a.local);
  // B ändert und löscht, A übernimmt
  b.local['settings/kizamubeam.theme'] = 'light';
  delete b.local['materials/m1'];
  b.sync(folder, 200);
  a.sync(folder, 210);
  assert.deepEqual(a.local, { 'settings/kizamubeam.theme': 'light' });
  // gelöscht bleibt gelöscht, auch nach weiteren Abgleichen
  b.sync(folder, 220);
  a.sync(folder, 230);
  assert.equal('materials/m1' in a.local, false);
  assert.equal(folder.get('A')!['materials/m1'].del, true);
});

await test('Gleichzeitige Änderung: die neuere gewinnt und wird als Konflikt gemeldet', () => {
  const folder = new Map<string, core.State>();
  const a = new Machine('A'),
    b = new Machine('B');
  a.local = { 'settings/kizamubeam.grid': '5' };
  a.sync(folder, 100);
  b.sync(folder, 110);
  a.local['settings/kizamubeam.grid'] = '10';
  b.local['settings/kizamubeam.grid'] = '20';
  a.sync(folder, 300);
  // B bemerkt seine Änderung beim Abgleich um 200, A seine um 300 → A gewinnt
  const r = b.sync(folder, 200);
  assert.equal(b.local['settings/kizamubeam.grid'], '10');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].by, 'A');
  a.sync(folder, 310);
  assert.equal(a.local['settings/kizamubeam.grid'], '10');
});

await test('Unterschiedliche Einträge werden zusammengeführt, nichts geht verloren', () => {
  const folder = new Map<string, core.State>();
  const a = new Machine('A'),
    b = new Machine('B');
  a.local = { 'library/Rose.kza': 'rose' };
  b.local = { 'library/Stern.kza': 'stern' };
  a.sync(folder, 100);
  b.sync(folder, 110);
  a.sync(folder, 120);
  assert.deepEqual(Object.keys(a.local).sort(), ['library/Rose.kza', 'library/Stern.kza']);
  assert.deepEqual(a.local, b.local);
});

await test('Erster Abgleich „Ordner übernehmen“: Ordner gilt, nur lokale Einträge kommen dazu', () => {
  const folder = new Map<string, core.State>();
  const a = new Machine('A'),
    b = new Machine('B');
  a.local = { 'settings/kizamubeam.theme': 'dark', 'devices/x': { id: 'x', bedW: 400 } };
  a.sync(folder, 100);
  b.local = { 'settings/kizamubeam.theme': 'light', 'materials/m9': { id: 'm9' } };
  b.sync(folder, 500, 'pull');
  assert.equal(b.local['settings/kizamubeam.theme'], 'dark');
  assert.deepEqual(b.local['devices/x'], { id: 'x', bedW: 400 });
  assert.ok('materials/m9' in b.local);
  a.sync(folder, 510);
  assert.ok('materials/m9' in a.local);
  assert.equal(a.local['settings/kizamubeam.theme'], 'dark');
});

await test('Nicht gewählte Bereiche bleiben unberührt', () => {
  const r = mergeStates(items({ 'ui/kizamubeam.layout': 'x' }), {}, [{ 'settings/kizamubeam.theme': { h: 'h', t: 1, v: 'dark' } }], 10, 'A', ['ui']);
  assert.deepEqual(Object.keys(r.merged), ['ui/kizamubeam.layout']);
  assert.deepEqual(r.incoming, {});
});

await test('Prüfsumme hängt nicht von der Reihenfolge der Schlüssel ab', () => {
  assert.equal(stableJson({ b: 1, a: [1, { d: 2, c: 3 }] }), stableJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(hashValue({ b: 1, a: 2 }), hashValue({ a: 2, b: 1 }));
  assert.notEqual(hashValue('a'), hashValue('b'));
});

await test('Geräte: Anschluss und Adresse zählen nicht als Änderung und bleiben je Rechner', () => {
  const d = { id: 'e6', name: 'E6 Pro', bedW: 365, conn: 'tcp', host: '192.168.178.48', port: '' };
  assert.equal(deviceHash(d), deviceHash({ ...d, conn: 'serial', port: 'COM3', host: '' }));
  assert.notEqual(deviceHash(d), deviceHash({ ...d, bedW: 400 }));
  assert.deepEqual(core.mergeDevice({ ...d, bedW: 400, port: '/dev/tty.usb' }, { ...d, conn: 'serial', port: 'COM3' }), { ...d, bedW: 400, conn: 'serial', port: 'COM3' });
  assert.deepEqual(core.mergeDevice(d, undefined), d);
});

await test('Geräte schreiben: Verbindung und gewähltes Gerät bleiben', async () => {
  store.clear();
  store.setItem('kizamubeam.devices', JSON.stringify({ devices: [{ id: 'a', name: 'A', conn: 'serial', port: 'COM3', bedW: 300 }], current: 'a' }));
  await data.writeLocal({ 'devices/a': { id: 'a', name: 'A2', conn: 'tcp', port: '', host: '10.0.0.2', bedW: 310 }, 'devices/b': { id: 'b', name: 'B', host: 'h' } });
  const st = JSON.parse(store.getItem('kizamubeam.devices')!);
  assert.equal(st.current, 'a');
  assert.deepEqual(st.devices[0], { id: 'a', name: 'A2', conn: 'serial', port: 'COM3', host: '10.0.0.2', bedW: 310 });
  assert.equal(st.devices[1].host, 'h');
  await data.writeLocal({ 'devices/a': null });
  const st2 = JSON.parse(store.getItem('kizamubeam.devices')!);
  assert.deepEqual(st2.devices.map((d: { id: string }) => d.id), ['b']);
  assert.equal(st2.current, 'b');
});

await test('Export und Import einer Datei', async () => {
  store.clear();
  store.setItem('kizamubeam.theme', 'dark');
  store.setItem('kizamubeam.gen.gear', '{"teeth":20}');
  store.setItem('kizamubeam.autosave', '{"doc":1}');
  store.setItem('kizamubeam.layout', '{"v":1}');
  store.setItem('kizamubeam.camera', '{"calib":1}');
  store.setItem('kizamubeam.materials', JSON.stringify({ format: 'kizamubeam-materials', version: 1, entries: [{ id: 'm1', material: 'Pappel' }] }));
  store.setItem('kizamubeam.templates', JSON.stringify({ 'Schild.kzt': '{"x":1}' }));
  const text = await sync.exportBundle(['settings', 'materials', 'templates', 'ui']);
  const b = parseBundle(text);
  assert.deepEqual(b.sections.settings, { 'kizamubeam.theme': 'dark', 'kizamubeam.gen.gear': '{"teeth":20}' });
  assert.equal('camera' in b.sections, false);
  assert.ok(!text.includes('autosave'));
  assert.deepEqual(sync.bundleCounts(b), { settings: 2, materials: 1, templates: 1, ui: 1 });

  // Auf einem anderen Rechner: zusammenführen behält eigene Einträge
  store.clear();
  store.setItem('kizamubeam.theme', 'light');
  store.setItem('kizamubeam.snap', '{"grid":true}');
  store.setItem('kizamubeam.materials', JSON.stringify({ entries: [{ id: 'm2', material: 'MDF' }] }));
  await sync.importBundle(b, ['settings', 'materials'], 'merge');
  assert.equal(store.getItem('kizamubeam.theme'), 'dark');
  assert.equal(store.getItem('kizamubeam.snap'), '{"grid":true}');
  assert.deepEqual(JSON.parse(store.getItem('kizamubeam.materials')!).entries.map((e: { id: string }) => e.id), ['m2', 'm1']);
  assert.equal(store.getItem('kizamubeam.templates'), null);
  // Ersetzen löscht, was in der Datei fehlt
  await sync.importBundle(b, ['settings', 'materials'], 'replace');
  assert.equal(store.getItem('kizamubeam.snap'), null);
  assert.deepEqual(JSON.parse(store.getItem('kizamubeam.materials')!).entries.map((e: { id: string }) => e.id), ['m1']);
});

await test('Ungültige und neuere Dateien werden abgelehnt', () => {
  assert.throws(() => parseBundle('kein json'), /invalid/);
  assert.throws(() => parseBundle('{"format":"x"}'), /invalid/);
  assert.throws(() => parseBundle('{"format":"kizamubeam-settings","version":2,"sections":{}}'), /newer/);
  assert.deepEqual(parseBundle('{"format":"kizamubeam-settings","version":1,"sections":{"settings":{"a":"1"},"fremd":{"x":1},"devices":[1]}}').sections, { settings: { a: '1' } });
  assert.equal(parseSyncFile('{"format":"x"}'), null);
  const f = parseSyncFile(JSON.stringify({ format: 'kizamubeam-sync', version: 1, machine: { id: '1', name: 'A' }, written: 5, items: { 'settings/a': { h: 'x', t: 1, v: '1' }, 'böse/a': { h: 'x', t: 1, v: 1 }, 'settings/b': { h: 'x', t: 'nan' }, 'settings/c': { h: 'x', t: 2 }, 'library/d': { h: '', t: 3, del: true } } }));
  assert.deepEqual(Object.keys(f!.items), ['settings/a', 'library/d']);
});

await test('Dateiname der eigenen Datei', () => {
  assert.equal(core.syncFileName('Hanjos MacBook Pro', 'abcdef1234'), 'Hanjos-MacBook-Pro-abcdef12.kzsync');
  assert.equal(core.syncFileName('../..', 'x1'), 'Rechner-x1.kzsync');
  assert.ok(data.validFile('library', 'Rose.kza'));
  assert.ok(!data.validFile('library', '../Rose.kza'));
  assert.ok(!data.validFile('templates', 'Rose.kza'));
});

await test('Jeder Speicher-Schlüssel im Code ist einem Bereich zugeordnet', () => {
  const missing: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f))
        for (const m of readFileSync(p, 'utf8').matchAll(/['"`](kizamubeam\.[A-Za-z0-9_.-]+?)(\$\{|['"`])/g)) {
          const key = m[2] === '${' ? m[1] + 'x' : m[1];
          if (key.endsWith('.gcode') || key.endsWith('.kzb')) continue; // Dateinamen, keine Schlüssel
          if (key === 'kizamubeam.camera-profile') continue; // Kennung des Dateiformats, kein Schlüssel
          if (!data.classifyKey(key)) missing.push(`${p}: ${key}`);
        }
    }
  };
  walk('src');
  assert.deepEqual(missing, [], 'Neue Schlüssel in syncData.ts einer Liste zuordnen');
  assert.equal(data.classifyKey('kizamubeam.autosave'), 'local');
  assert.equal(data.classifyKey('kizamubeam.camera'), 'camera');
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
