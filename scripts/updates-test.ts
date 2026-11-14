// Tests für die Auswahl von Updates. Aufruf: npm run test:updates
import { strict as assert } from 'node:assert';
const { compareVersions, defaultChannel, isNightly, pickRelease, resolveChannel } = await import('../src/updates');

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

const rel = (tag: string, prerelease: boolean, manifest = true, draft = false) => ({
  tag_name: tag,
  prerelease,
  draft,
  assets: manifest ? [{ name: 'KizamuBeam.dmg', browser_download_url: 'x' }, { name: 'latest.json', browser_download_url: `https://github.com/negurvulkan/kizamubeam/releases/download/${tag}/latest.json` }] : [],
});

test('Versionen mit Vorabversion richtig sortiert', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-beta', '1.0.0', '1.2.0-beta', '1.2.0-beta.2', '1.2.0-beta.10', '1.2.0', 'v1.10.0'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(compareVersions(order[i], order[i + 1]) < 0, `${order[i]} < ${order[i + 1]}`);
    assert.ok(compareVersions(order[i + 1], order[i]) > 0, `${order[i + 1]} > ${order[i]}`);
  }
  assert.equal(compareVersions('v1.2.0-beta', '1.2.0-beta'), 0);
});

test('Nightly-Versionen: nach dem Stand davor, vor RC und stabiler Version, nach Datum und Lauf sortiert', () => {
  const order = ['2.8.0', '2.9.0-nightly.20261114.3', '2.9.0-nightly.20261114.12', '2.9.0-nightly.20261115.13', '2.9.0-rc.1', '2.9.0'];
  for (let i = 0; i < order.length - 1; i++) assert.ok(compareVersions(order[i], order[i + 1]) < 0, `${order[i]} < ${order[i + 1]}`);
  assert.ok(isNightly('2.9.0-nightly.20261114.3'));
  assert.ok(!isNightly('2.9.0-rc.1') && !isNightly('2.9.0') && !isNightly('1.2.0-beta'));
});

test('Vorgabe-Kanal: nur Nightly-Builds bleiben auf Nightly', () => {
  assert.equal(defaultChannel('2.9.0-nightly.20261114.3'), 'nightly');
  assert.equal(defaultChannel('1.2.0-beta'), 'stable');
  assert.equal(defaultChannel('2.9.0-rc.1'), 'stable');
  assert.equal(defaultChannel('1.2.0'), 'stable');
});

test('Gespeicherter Kanal: alter Beta-Kanal wird Stabil, nie Nightly', () => {
  assert.equal(resolveChannel('beta', '1.2.0-beta'), 'stable');
  assert.equal(resolveChannel('beta', '2.8.0'), 'stable');
  assert.equal(resolveChannel('nightly', '2.8.0'), 'nightly');
  assert.equal(resolveChannel('stable', '2.9.0-nightly.20261114.3'), 'stable');
  assert.equal(resolveChannel('unsinn', '2.8.0'), 'stable');
  assert.equal(resolveChannel(null, '2.9.0-nightly.20261114.3'), 'nightly');
  assert.equal(resolveChannel(null, '2.8.0'), 'stable');
});

const list = [rel('v1.3.0-beta', true), rel('v1.2.1', false), rel('v1.4.0-beta', true, false), rel('v1.5.0', false, true, true), rel('v1.2.0-beta', true)];

test('Nightly nimmt die neueste Vorabversion mit latest.json', () => {
  assert.equal(pickRelease(list, 'nightly', '1.2.0-beta')?.version, '1.3.0-beta');
});

test('Stabil überspringt Vorabversionen und Entwürfe', () => {
  assert.equal(pickRelease(list, 'stable', '1.2.0-beta')?.version, '1.2.1');
});

test('Nichts Neueres: kein Update', () => {
  assert.equal(pickRelease(list, 'nightly', '1.3.0-beta'), null);
  assert.equal(pickRelease(list, 'stable', '1.2.1'), null);
});

test('Adresse zeigt auf die latest.json des Releases', () => {
  assert.equal(pickRelease(list, 'nightly', '1.2.0-beta')?.manifest, 'https://github.com/negurvulkan/kizamubeam/releases/download/v1.3.0-beta/latest.json');
});

test('Releases der Virtual Machine (vm-v…) sind keine App-Updates', () => {
  const withVm = [rel('vm-v0.2.0', false), rel('vm-v0.3.0-beta', true), ...list];
  assert.equal(pickRelease(withVm, 'stable', '1.2.0-beta')?.version, '1.2.1');
  assert.equal(pickRelease(withVm, 'nightly', '1.2.0-beta')?.version, '1.3.0-beta');
  assert.equal(pickRelease([rel('vm-v9.0.0', false)], 'stable', '1.0.0'), null);
});

test('Nightly-Kanal: Nightly, Release-Kandidat und stabile Version, je nachdem was am neuesten ist', () => {
  const rels = [rel('v2.8.0', false), rel('v2.9.0-nightly.20261114.3', true), rel('v2.9.0-nightly.20261115.4', true), rel('v2.9.0-nightly.20261116.5', true, false)];
  assert.equal(pickRelease(rels, 'nightly', '2.8.0')?.version, '2.9.0-nightly.20261115.4');
  assert.equal(pickRelease(rels, 'stable', '2.8.0'), null);
  const withRc = [...rels, rel('v2.9.0-rc.1', true)];
  assert.equal(pickRelease(withRc, 'nightly', '2.9.0-nightly.20261115.4')?.version, '2.9.0-rc.1');
  assert.equal(pickRelease([...withRc, rel('v2.9.0', false)], 'nightly', '2.9.0-rc.1')?.version, '2.9.0');
});

if (failed) {
  console.log(`${failed} fehlgeschlagen`);
  process.exit(1);
}
