// Issue #341: the core must not branch on generator ids. Everything it needs comes from the Generator object
// (fit, assemblyCheck, tile, inputs …). This test greps the decoupled core files for the ids of the registered
// generators. Icon names, toolbox group ids and finding kinds that happen to match an id are allowed.
// Aufruf: npm run test:gen-decoupling
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
const { GENERATORS, register, getGenerator, ruleHolds, fieldActive, autoText, buildGen, defaultParams } = await import('../src/generators/index');
const { appList } = await import('../src/apps');
const { genFit } = await import('../src/fitcheck');

/** Core files that must stay free of generator ids (acceptance of #341) */
const DECOUPLED = ['src/fitcheck.ts', 'src/asmcheck.ts', 'src/apps.ts', 'src/ui.ts', 'src/files.ts', 'src/generators/dialog.ts', ...readdirSync(new URL('../src/view3d/', import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => `src/view3d/${f}`)];
/** Uses of a matching word that are not a generator id */
const ALLOWED = /type \w+ = [^;]+;|(icon|group|kind): '[\w-]+'( \| '[\w-]+')*|\?\? '[\w-]+'|ICONS\[\w+\] \? \w+ : '[\w-]+'|\{ id: '[\w-]+', label:|ICONS\.\w+|\[a-z]/g;

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
  const asKey = new RegExp(`^\\s*(${ids.filter((i) => /^\w+$/.test(i)).join('|')})\\s*:\\s*\\{`);
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

test('assembly poses come from the generator', () => {
  for (const g of GENERATORS) {
    if (!g.poses) continue;
    const p = Object.fromEntries(g.schema.map((s) => [s.key, s.def]));
    const r = g.poses(p, 3);
    if (g.inputs?.some((i) => i.kind === 'model3d')) continue; // needs a loaded model
    assert.ok(r && Object.keys(r.poses).length, g.id);
  }
  assert.equal(getGenerator('gear')?.poses, undefined);
});

test('showIf rules are data and evaluate like the old functions', () => {
  const p = { a: 'x', n: 2, b: true, s: '' };
  assert.ok(ruleHolds({ eq: ['a', 'x'] }, p) && !ruleHolds({ ne: ['a', 'x'] }, p));
  assert.ok(ruleHolds({ gt: ['n', 1] }, p) && !ruleHolds({ lt: ['n', 2] }, p) && ruleHolds({ le: ['n', 2] }, p) && ruleHolds({ ge: ['n', 2] }, p));
  assert.ok(ruleHolds({ in: ['a', ['y', 'x']] }, p) && !ruleHolds({ in: ['a', ['y']] }, p));
  assert.ok(ruleHolds({ and: [{ eq: ['b', true] }, { eq: ['s', ''] }] }, p));
  assert.ok(ruleHolds({ or: [{ eq: ['b', false] }, { gt: ['n', 1] }] }, p));
  assert.ok(ruleHolds({ not: { eq: ['b', false] } }, p));
  for (const g of GENERATORS) for (const s of g.schema) if (s.showIf) assert.equal(typeof s.showIf, 'object', `${g.id}.${s.key}`);
  // drawer: handle height only with a front and a slot handle
  const d = getGenerator('drawer')!, hh = d.schema.find((s) => s.key === 'handleHeight')!;
  const dp = defaultParams(d);
  assert.equal(fieldActive(hh, { ...dp, front: 'overlay', handle: 'slot' }), true);
  assert.equal(fieldActive(hh, { ...dp, front: 'none', handle: 'slot' }), false);
  assert.equal(fieldActive(hh, { ...dp, front: 'overlay', handle: 'hole' }), false);
});

test('suggested texts come from view(), issues carry codes', () => {
  const g = getGenerator('box-divided')!;
  const p = { ...defaultParams(g), compartmentsX: 3 };
  assert.equal(autoText(g, 'ratiosX', p), '1:1:1');
  assert.equal(autoText(g, 'width', p), '');
  const r = buildGen(g, { ...p, ratiosX: '1:(2:1' });
  const i = r.issues.find((x) => x.key === 'ratiosX');
  assert.equal(i?.code, 'expr-bracket');
  assert.ok(i && i.msg && i.msg !== i.code, 'translated text, not the code');
});

test('onChange: box-divided keeps ratios and asks before dropping values', () => {
  const g = getGenerator('box-divided')!;
  const p = { ...defaultParams(g), compartmentsX: 4, ratiosX: '1:2:3' };
  assert.deepEqual(g.onChange!('compartmentsX', 3, p), { patch: { ratiosX: '1:2:3:1' } });
  const r = g.onChange!('compartmentsX', 3, { ...p, compartmentsX: 2 });
  assert.ok(r && r.ask && r.ask.options[0].patch.ratiosX === '1:2');
  assert.equal(g.onChange!('width', 100, p), undefined);
  assert.equal(g.preview?.center, true);
});

test('inputs: selection and 3D model become parameters through fromInputs', () => {
  const jig = getGenerator('jig')!;
  const sq = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  const p = jig.fromInputs!({ selection: [{ name: 'Tag', polys: [sq] }] })!;
  assert.ok(String(p.shapes).includes('Tag'));
  assert.equal(jig.fromInputs!({ selection: [] }), undefined);
  for (const id of ['stack', 'ribs']) assert.deepEqual(getGenerator(id)!.fromInputs!({ model: { id: 'm1', name: 'cat' } }), { model: 'm1', name: 'cat' });
  assert.equal(typeof getGenerator('ribs')!.panel, 'function');
  assert.equal(typeof jig.panel, 'function');
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
