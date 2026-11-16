// Issue #341: the core must not branch on generator ids. Everything it needs comes from the Generator object
// (fit, assemblyCheck, tile, inputs …). This test greps the decoupled core files for the ids of the registered
// generators. Icon names, toolbox group ids and finding kinds that happen to match an id are allowed.
// Aufruf: npm run test:gen-decoupling
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const { GENERATORS, register, getGenerator } = await import('../src/generators/index');
const { appList } = await import('../src/apps');
const { genFit } = await import('../src/fitcheck');

/** Core files that are already free of generator ids; later steps of #341 add the remaining ones */
const DECOUPLED = ['src/fitcheck.ts', 'src/asmcheck.ts', 'src/apps.ts', 'src/ui.ts'];
/** Uses of a matching word that are not a generator id */
const ALLOWED = /type \w+ = [^;]+;|(icon|group|kind): '[\w-]+'( \| '[\w-]+')*|\?\? '[\w-]+'|\{ id: '[\w-]+', label:|ICONS\.\w+|\[a-z]/g;

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

const ids = GENERATORS.map((g) => g.id);

test('decoupled core files contain no generator ids', () => {
  const quoted = new RegExp(`['"\`](${ids.map((i) => i.replace('-', '\\-')).join('|')})['"\`]`);
  const asKey = new RegExp(`^\\s*(${ids.filter((i) => /^\w+$/.test(i)).join('|')})\\s*:`);
  const hits: string[] = [];
  for (const f of DECOUPLED) {
    readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        const rest = line.replace(ALLOWED, '');
        if (quoted.test(rest) || asKey.test(rest)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('every generator tile shows up in the toolbox, in its group and order', () => {
  const apps = appList().map((a) => a.id);
  for (const g of GENERATORS.filter((x) => x.tile)) assert.ok(apps.includes(g.id), g.id);
  // before: placed directly ahead of the named core tile (or ahead of another generator that is)
  for (const g of GENERATORS) {
    const b = g.tile?.before;
    if (b) assert.ok(apps.indexOf(g.id) < apps.indexOf(b), `${g.id} before ${b}`);
  }
});

test('fit and assembly check come from the generator', () => {
  assert.deepEqual(genFit('box'), { kind: 'pair', play: 'clearance' });
  assert.deepEqual(genFit('insert'), { kind: 'slot', play: 'play' });
  assert.equal(genFit('gear'), undefined);
  assert.equal(getGenerator('gearpair')?.assemblyCheck, undefined, 'gear pair: wheels sit on axles');
  assert.equal(getGenerator('stack')?.assemblyCheck, true);
});

test('register adds a generator and replaces one with the same id', () => {
  const n = GENERATORS.length;
  const g = { ...getGenerator('gear')!, id: 'test-plugin', tile: { group: 'mech', text: (t: (s: string) => string) => ({ name: t('X'), desc: 'x', keys: 'x', action: 'x' }) } };
  register(g);
  assert.equal(GENERATORS.length, n + 1);
  assert.ok(appList().some((a) => a.id === 'test-plugin'));
  register({ ...g, version: 9 });
  assert.equal(GENERATORS.length, n + 1);
  assert.equal(getGenerator('test-plugin')?.version, 9);
  GENERATORS.splice(GENERATORS.indexOf(getGenerator('test-plugin')!), 1);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
