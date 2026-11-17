// Plugin dialogs, schema version 1 (#335 stage 1): sections, rules and the headless runner with its checks.
// Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const { parsePack } = await import('../src/packs');
const { pluginGenerator } = await import('../src/plugins/generator');
const { runDialog, checkPlugin, ScriptError } = await import('../src/plugins/headless');

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function manifest(code: string, extra: Record<string, unknown> = {}) {
  const text = JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.dlg', version: '1.0.0', name: 'Dialog example',
    plugins: [{
      id: 'com.example.tray', type: 'generator', api: 1, kind: 'assembly', runtime: 'js', code, sha256: sha(code), dialog: { version: 1 },
      params: [
        { key: 'width', type: 'length', min: 10, max: 300, def: 100 },
        { key: 'lid', type: 'bool', def: false },
        { key: 'lidStyle', type: 'enum', options: ['flat', 'sliding'], def: 'flat', section: 'lidSection', showIf: { eq: ['lid', true] } },
        { key: 'lidGap', type: 'length', min: 0, max: 5, def: 0.2, section: 'lidSection', showIf: { eq: ['lid', true] } },
        { key: 'kerf', type: 'length', min: 0, max: 1, def: 0.1, advanced: true, section: 'lidSection' },
      ],
      texts: { en: { name: 'Tray', desc: 'A tray', width: 'Width', lid: 'Lid', lidStyle: 'Lid style', lidGap: 'Gap', kerf: 'Kerf', lidSection: 'Lid', 'lidStyle.flat': 'Flat', 'lidStyle.sliding': 'Sliding', narrow: 'Too narrow' } },
      ...extra,
    }],
  });
  return parsePack(text).plugins[0];
}
const TRAY = `globalThis.plugin = {
  validate: (p) => p.width < 20 ? [{ key: 'width', level: 'error', code: 'narrow' }] : [],
  generate: (p) => {
    const w = p.width / 2, r = { closed: true, nodes: [{x:-w,y:-10},{x:w,y:-10},{x:w,y:10},{x:-w,y:10}] };
    const parts = [{ key: 'base', subs: [r], at: { x: 0, y: 0 } }];
    if (p.lid) parts.push({ key: 'lid', subs: [r], at: { x: 0, y: 30 + p.lidGap } });
    return { parts, info: [['width', String(p.width)]] };
  },
};`;

await test('schema v1: sections are translated, advanced wins, a newer dialog schema is refused', () => {
  const m = manifest(TRAY);
  assert.equal(m.schema[2].section, 'lidSection');
  const g = pluginGenerator(m, { id: 'p', name: 'P' });
  assert.equal(g.schema[2].section, 'Lid');
  assert.equal(g.schema[3].section, 'Lid');
  assert.equal(g.schema[4].advanced, true);
  assert.equal(g.schema[2].options[1][1], 'Sliding');
  g.dispose();
  assert.throws(() => manifest(TRAY, { dialog: { version: 2 } }), /neuere Version|newer version/);
  assert.throws(() => manifest(TRAY, { dialog: 'big' }), /dialog/);
  assert.throws(() => manifest(TRAY, { params: [{ key: 'a', type: 'bool', def: true, section: '<b>' }] }), /Abschnitt|section/);
});

await test('headless runner: steps, visible fields, issues and parts like the dialog', async () => {
  const m = manifest(TRAY);
  const states = await runDialog(m, [{ lid: true }, { lidGap: 2 }, { width: 15 }]);
  assert.equal(states.length, 4);
  assert.deepEqual(states[0].visible, ['width', 'lid', 'kerf']);
  assert.deepEqual(states[1].visible, ['width', 'lid', 'lidStyle', 'lidGap', 'kerf']);
  assert.deepEqual(states[1].parts.map((p) => p.key), ['base', 'lid']);
  assert.equal(states[2].parts[1].at.y, 32);
  assert.deepEqual(states[2].parts[0].box, { minX: -50, minY: -10, maxX: 50, maxY: 10 });
  assert.equal(states[3].parts.length, 0);
  assert.deepEqual(states[3].issues.map((i) => [i.key, i.code, i.msg]), [['width', 'narrow', 'Too narrow']]);
  assert.equal(states[0].info[0][0], 'Width');
  // Same parameters, same geometry
  assert.equal(states[0].geometry, (await runDialog(m))[0].geometry);
  // A script that does not fit the schema is a mistake of the script
  await assert.rejects(runDialog(m, [{ depth: 3 }]), ScriptError);
  await assert.rejects(runDialog(m, [{ width: 1000 }]), ScriptError);
});

await test('check: a good plugin passes, randomness, crashes and missing texts are found', async () => {
  const ok = await checkPlugin(manifest(TRAY));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
  const random = await checkPlugin(manifest(TRAY.replace("String(p.width)", "String(Math.random())")));
  assert.match(random.errors.join('\n'), /different results/);
  const crash = await checkPlugin(manifest(TRAY.replace("if (p.lid)", "if (p.lidStyle === 'sliding') throw new TypeError('boom'); if (p.lid)")));
  assert.deepEqual(crash.errors, [], 'a thrown error is the plugin\'s own code, not a crash');
  const loop = await checkPlugin(manifest(TRAY.replace("if (p.lid)", "if (p.lidStyle === 'sliding') for(;;){} if (p.lid)")));
  assert.match(loop.errors.join('\n'), /"lidStyle":"sliding".*plugin-timeout/);
  const noText = await checkPlugin(manifest(TRAY.replace("code: 'narrow'", "code: 'too-narrow'").replace('p.width < 20', 'p.width < 200')));
  assert.match(noText.errors.join('\n'), /defaults: too-narrow/);
  assert.match(noText.warnings.join('\n'), /no English text for code "too-narrow"/);
});

await test('check: the hole plate example passes without warnings', async () => {
  const m = parsePack(buildPluginPack('plugins/hole-plate')).plugins[0];
  const r = await checkPlugin(m);
  assert.deepEqual(r, { id: 'org.kizamubeam.hole-plate', errors: [], warnings: [] });
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
