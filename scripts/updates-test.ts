// Tests für die Auswahl von Updates. Aufruf: npm run test:updates
import { strict as assert } from 'node:assert';
const { compareVersions, defaultChannel, pickRelease } = await import('../src/updates');

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

test('Vorgabe-Kanal folgt der installierten Version', () => {
  assert.equal(defaultChannel('1.2.0-beta'), 'beta');
  assert.equal(defaultChannel('1.2.0'), 'stable');
});

const list = [rel('v1.3.0-beta', true), rel('v1.2.1', false), rel('v1.4.0-beta', true, false), rel('v1.5.0', false, true, true), rel('v1.2.0-beta', true)];

test('Beta nimmt die neueste Vorabversion mit latest.json', () => {
  assert.equal(pickRelease(list, 'beta', '1.2.0-beta')?.version, '1.3.0-beta');
});

test('Stabil überspringt Vorabversionen und Entwürfe', () => {
  assert.equal(pickRelease(list, 'stable', '1.2.0-beta')?.version, '1.2.1');
});

test('Nichts Neueres: kein Update', () => {
  assert.equal(pickRelease(list, 'beta', '1.3.0-beta'), null);
  assert.equal(pickRelease(list, 'stable', '1.2.1'), null);
});

test('Adresse zeigt auf die latest.json des Releases', () => {
  assert.equal(pickRelease(list, 'beta', '1.2.0-beta')?.manifest, 'https://github.com/negurvulkan/kizamubeam/releases/download/v1.3.0-beta/latest.json');
});

test('Releases der Virtual Machine (vm-v…) sind keine App-Updates', () => {
  const withVm = [rel('vm-v0.2.0', false), rel('vm-v0.3.0-beta', true), ...list];
  assert.equal(pickRelease(withVm, 'stable', '1.2.0-beta')?.version, '1.2.1');
  assert.equal(pickRelease(withVm, 'beta', '1.2.0-beta')?.version, '1.3.0-beta');
  assert.equal(pickRelease([rel('vm-v9.0.0', false)], 'stable', '1.0.0'), null);
});

if (failed) {
  console.log(`${failed} fehlgeschlagen`);
  process.exit(1);
}
