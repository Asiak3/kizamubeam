// Plugins in extension packs (issue #205, stage 1): pack format 2, manifest checks, plugin generators with their
// result cache, registration with the installed packs and saved parts when the extension is missing.
// Aufruf: npm run test:plugin-packs
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
gl.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { buildPluginPack } = await import('./plugin-pack.mjs');
const P = await import('../src/packs');
const { pluginGenerator, PENDING, onPluginResult, setPluginSpawn } = await import('../src/plugins/generator');
const { initPlugins, pluginGenerators, pluginProblems, testLoadPlugins } = await import('../src/plugins/registry');
const { inProcess } = await import('../src/plugins/client');
// Endless loops below should not wait for the full generate limit
(await import('../src/plugins/contract')).LIMITS.callMs.generate = 3000;
const G = await import('../src/generators/index');
await import('./builtin-generators');

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
const throws = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message), String(re));

const plateText: string = buildPluginPack('plugins/hole-plate');
const plate = () => JSON.parse(plateText);
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** A small JavaScript plugin pack */
function jsPack(code: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.js', version: '1.0.0', name: 'JS example',
    plugins: [{
      id: 'com.example.square', type: 'generator', api: 1, kind: 'assembly', runtime: 'js', code, sha256: sha(code),
      params: [
        { key: 'size', type: 'length', min: 1, max: 100, def: 10 },
        { key: 'twice', type: 'bool', def: false },
        { key: 'gap', type: 'length', min: 0, max: 20, def: 2, showIf: { eq: ['twice', true] } },
      ],
      texts: { en: { name: 'Square', size: 'Size', 'part.a': 'first', side: 'Side', big: 'Too big: {max} mm at most' }, de: { name: 'Quadrat', size: 'Größe', side: 'Seite', big: 'Zu groß: höchstens {max} mm' } },
      ...extra,
    }],
  });
}
const SQUARE = `globalThis.plugin = {
  validate: (p) => p.size > 50 ? [{ key: 'size', level: 'error', code: 'big', values: { max: 50 } }] : [],
  generate: (p) => {
    const s = p.size / 2, sq = { closed: true, nodes: [{x:-s,y:-s},{x:s,y:-s},{x:s,y:s},{x:-s,y:s}] };
    const parts = [{ key: 'a', subs: [sq], at: { x: 0, y: 0 } }];
    if (p.twice) parts.push({ key: 'b', subs: [sq], at: { x: p.size + p.gap, y: 0 } });
    return { parts, info: [['side', String(p.size)]] };
  },
};`;

await test('pack format 2: the hole plate pack is read with its plugin', () => {
  const p = P.parsePack(plateText);
  assert.equal(p.plugins.length, 1);
  const m = p.plugins[0];
  assert.equal(m.runtime, 'wasm');
  assert.ok(m.code instanceof Uint8Array && m.code.length > 1000);
  assert.deepEqual(m.schema.map((s) => s.key), ['width', 'height', 'holeDia', 'pitch', 'pattern', 'holeShape', 'margin', 'corner']);
  const pattern = m.schema.find((s) => s.key === 'pattern')!;
  assert.ok(pattern.type === 'enum' && pattern.options[0][1] === 'pattern.hex');
  assert.match(P.packSummary(p), /1 Plugin/);
});

await test('pack format 2: refused manifests', () => {
  const bad = (f: (x: Record<string, any>) => void, re: RegExp) => {
    const x = plate();
    f(x);
    throws(() => P.parsePack(JSON.stringify(x)), re);
  };
  bad((x) => (x.formatVersion = 1), /formatVersion/);
  bad((x) => (x.formatVersion = 3), /neuere Version/);
  bad((x) => (x.plugins[0].sha256 = '0'.repeat(64)), /Prüfsumme/);
  bad((x) => delete x.plugins[0].sha256, /sha256/);
  bad((x) => (x.plugins[0].api = 2), /neuere Version/);
  bad((x) => (x.plugins[0].type = 'exporter'), /unbekannte Art/);
  bad((x) => (x.plugins[0].runtime = 'python'), /runtime/);
  bad((x) => (x.plugins[0].code = 'AAAA'), /WebAssembly|Prüfsumme/);
  bad((x) => (x.plugins[0].params[0].def = 5000), /min ≤ def ≤ max/);
  bad((x) => (x.plugins[0].params[0].type = 'color'), /unbekannter Typ/);
  bad((x) => x.plugins[0].params.push({ ...x.plugins[0].params[0] }), /doppelte Parameter/);
  bad((x) => (x.plugins[0].params[6].showIf = { eq: ['nope', 1] }), /Bedingung/);
  bad((x) => (x.plugins[0].params[6].showIf = { matches: ['width', 1] }), /Bedingung/);
  bad((x) => delete x.plugins[0].texts.en, /Texte fehlen/);
  bad((x) => (x.plugins[0].texts.en['<b>'] = 'x'), /Ungültiger Text/);
  bad((x) => (x.plugins[0].id = 'Not An Id'), /ungültige Kennung/);
  bad((x) => (x.plugins[0].host = ['fit', 'network']), /Host-Funktion/);
  assert.deepEqual(P.parsePack(JSON.stringify({ ...plate(), plugins: [{ ...plate().plugins[0], host: ['fit', 'fit', 'trace'] }] })).plugins[0].host, ['fit', 'trace']);
  bad((x) => x.plugins.push(x.plugins[0]), /doppelter Kennung/);
  // A data-only pack in format 1 stays valid
  const old = { format: 'kizamubeam-pack', id: 'com.example.old', version: '1.0.0', name: 'Old', devices: [{ name: 'Old laser', fw: 'grbl', bedW: 400, bedH: 400 }] };
  assert.equal(P.parsePack(JSON.stringify(old)).plugins.length, 0);
});

await test('plugin generator: texts, pending result, cache, issues and labels (JavaScript)', async () => {
  const m = P.parsePack(jsPack(SQUARE)).plugins[0];
  const g = pluginGenerator(m, { id: 'com.example.js', name: 'JS example' });
  assert.equal(g.name, 'Quadrat');
  assert.equal(g.schema[0].label, 'Größe');
  assert.equal(g.schema[1].label, 'twice', 'missing text falls back to the key');
  assert.equal(g.icon, 'packs');
  const p = G.normalizeParams(g, { size: 20 });
  // First call: still computing, the dialog shows it and OK stays off
  const first = G.buildGen(g, p);
  assert.equal(first.parts.length, 0);
  assert.equal(first.issues[0].code, PENDING);
  let heard = '';
  const stop = onPluginResult((id) => (heard = id));
  await g.prepare(p);
  stop();
  assert.equal(heard, 'com.example.square');
  const r = G.buildGen(g, p);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].shape.gen, 'com.example.square');
  assert.equal(r.parts[0].shape.ext, 'JS example');
  assert.equal(r.parts[0].shape.part, 'a');
  assert.deepEqual(r.info, [['Seite', '20']]);
  assert.equal(g.label(p, 'a'), 'Quadrat · first');
  // Issue codes become the plugin's texts with values
  const big = G.normalizeParams(g, { size: 80 });
  await g.prepare(big);
  const rb = G.buildGen(g, big);
  assert.equal(rb.parts.length, 0);
  assert.equal(rb.issues[0].msg, 'Zu groß: höchstens 50 mm');
  assert.equal(rb.issues[0].key, 'size');
  // showIf rules from the manifest are evaluated by the app
  assert.equal(G.fieldActive(g.schema[2], p), false);
  assert.equal(G.fieldActive(g.schema[2], { ...p, twice: true }), true);
  const two = await G.buildGenAsync(g, G.normalizeParams(g, { size: 20, twice: true }));
  assert.equal(two.parts.length, 2);
  assert.equal(two.parts[1].at.x, 22);
  g.dispose();
});

await test('plugin generator: labels and texts computed by the plugin (codes, values, lists, numbers)', async () => {
  const code = `globalThis.plugin = {
    validate: (p) => p.size > 50 ? [{ level: 'warn', code: 'plugin-text', values: { text: ['(', { code: 'side' }, ') ', '1234.5'] } }] : [],
    generate: (p) => ({
      parts: [{ key: 'a', subs: [{ closed: true, nodes: [{x:0,y:0},{x:p.size,y:0},{x:0,y:p.size}] }], at: { x: 0, y: 0 } }],
      info: [[{ code: 'side' }, [{ code: 'big', values: { max: { code: 'side' } } }, ' / 2952 mm / M3000']]],
      label: { code: 'big', values: { max: p.size } },
      labels: { a: ['#', { code: 'side' }, ' ', String(p.size / 4)], zzz: 'not a part' },
    }),
  };`;
  const g = pluginGenerator(P.parsePack(jsPack(code)).plugins[0], { id: 'com.example.js', name: 'JS example' });
  const p = G.normalizeParams(g, { size: 22 });
  assert.equal(g.label(p), 'Quadrat', 'not computed yet: the manifest text');
  const r = await G.buildGenAsync(g, p);
  assert.deepEqual(r.info, [['Seite', 'Zu groß: höchstens Seite mm / 2,952 mm / M3000']]);
  assert.equal(g.label(p), 'Zu groß: höchstens 22 mm', 'whole numbers as they are, like t()');
  assert.equal(g.label(p, 'a'), '#Seite 5.5');
  const w = await G.buildGenAsync(g, G.normalizeParams(g, { size: 60 }));
  assert.deepEqual(w.issues.map((i) => i.msg), ['(Seite) 1,234.5']);
  assert.equal(w.parts.length, 1);
  // Labels outlive the result cache
  for (let i = 1; i <= 30; i++) await g.prepare(G.normalizeParams(g, { size: i }));
  assert.equal(g.label(p), 'Zu groß: höchstens 22 mm');
  // A label must be a text
  const bad = pluginGenerator(P.parsePack(jsPack(code.replace("label: {", "label: 5, other: {"))).plugins[0], { id: 'com.example.js', name: 'JS example' });
  const rb = await G.buildGenAsync(bad, p);
  assert.equal(rb.issues[0].code, 'plugin-bad-output');
  g.dispose();
  bad.dispose();
});

await test('plugin generator: crashes, timeouts and broken output become issues', async () => {
  const loop = `globalThis.plugin = { validate: () => [], generate: () => { for(;;){} } };`;
  const g1 = pluginGenerator(P.parsePack(jsPack(loop)).plugins[0], { id: 'x', name: 'Loop' });
  const r1 = await G.buildGenAsync(g1, G.defaultParams(g1));
  assert.equal(r1.parts.length, 0);
  assert.match(r1.issues.at(-1)!.msg, /zu lange gerechnet/);
  g1.dispose();
  const nan = `globalThis.plugin = { validate: () => [], generate: () => ({ parts: [{ key: 'a', at: {x:0,y:0}, subs: [{ closed: true, nodes: [{x: NaN, y: 0}] }] }], info: [] }) };`;
  const g2 = pluginGenerator(P.parsePack(jsPack(nan)).plugins[0], { id: 'x', name: 'NaN' });
  const r2 = await G.buildGenAsync(g2, G.defaultParams(g2));
  assert.match(r2.issues.at(-1)!.msg, /ungültige Geometrie/);
  g2.dispose();
  const two = `globalThis.plugin = { validate: () => [], generate: () => ({ parts: [], info: [] }) };`;
  const m4 = P.parsePack(jsPack(two)).plugins[0];
  const g4 = pluginGenerator({ ...m4, kind: 'part' }, { id: 'x', name: 'None' });
  const r4 = await G.buildGenAsync(g4, G.defaultParams(g4));
  assert.match(r4.issues.at(-1)!.msg, /ungültige Geometrie/, 'a part generator must return exactly one part');
  g4.dispose();
  const own = `globalThis.plugin = { validate: () => [], generate: () => { throw new Error('big'); } };`;
  const g3 = pluginGenerator(P.parsePack(jsPack(own)).plugins[0], { id: 'x', name: 'Own' });
  const r3 = await G.buildGenAsync(g3, G.defaultParams(g3));
  assert.equal(r3.issues.at(-1)!.msg, 'Zu groß: höchstens {max} mm', 'a code thrown by generate uses the plugin text');
  g3.dispose();
});

await test('plugin generator: progress in the pending message, cancel, recompute, sessions (#211)', async () => {
  const calls: string[] = [];
  let release: ((v: unknown) => void) | null = null;
  let fail: ((e: unknown) => void) | null = null;
  let proc: import('../src/plugins/client').PluginProcess;
  setPluginSpawn(() => (proc = {
    call: (fn, input) => {
      calls.push(fn);
      if (fn === 'generate') return new Promise((res, rej) => ((release = res), (fail = rej)));
      if (fn === 'validate') return Promise.resolve([]);
      if (fn === 'view') return Promise.reject(Object.assign(new Error('x'), { code: 'plugin-no-function' }));
      return Promise.resolve(fn === 'open' ? (input as { size: number }).size : null);
    },
    setResource() {},
    cancel: () => fail?.(Object.assign(new Error('plugin-cancelled'), { code: 'plugin-cancelled' })),
    dispose() {},
  }));
  try {
    const g = pluginGenerator(P.parsePack(jsPack(SQUARE)).plugins[0], { id: 'com.example.js', name: 'JS example' });
    const p = G.normalizeParams(g, { size: 20 });
    const done = g.prepare(p);
    await new Promise((r) => setTimeout(r, 0));
    proc!.onProgress!(0.42, 'Teil 3/7');
    assert.match(G.buildGen(g, p).issues[0].msg, /42 % · Teil 3\/7$/);
    g.cancel!();
    await done;
    assert.equal(G.buildGen(g, p).issues[0].code, 'plugin-cancelled');
    g.recompute!(p);
    await new Promise((r) => setTimeout(r, 0));
    release!({ parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [] }], info: [] });
    await g.prepare(p);
    assert.equal(G.buildGen(g, p).parts.length, 1);
    g.openSession!(p);
    g.closeSession!();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.filter((c) => c === 'open' || c === 'close'), ['open', 'close']);
    g.dispose();
  } finally {
    setPluginSpawn((m) => inProcess(m.runtime, m.code, m.host ?? []));
  }
});

await test('hole plate (WebAssembly) through the generator interface', async () => {
  const m = P.parsePack(plateText).plugins[0];
  const g = pluginGenerator(m, { id: 'org.kizamubeam.hole-plate', name: 'Lochplatte' });
  assert.equal(g.name, 'Lochplatte');
  assert.equal(g.icon, 'pattern');
  assert.deepEqual(g.preview, { center: true });
  const p = G.defaultParams(g);
  const r = await G.buildGenAsync(g, p);
  assert.equal(r.parts.length, 1);
  assert.ok(r.parts[0].shape.subs.length > 50);
  assert.equal(r.info[0][0], 'Löcher');
  assert.equal(g.label(p), 'Lochplatte 120 × 80');
  const touch = await G.buildGenAsync(g, { ...p, holeDia: 12 });
  assert.equal(touch.issues[0].msg, 'Die Löcher berühren sich: Lochgröße kleiner als den Abstand wählen.');
  assert.equal(touch.issues[0].key, 'holeDia');
  g.dispose();
});

await test('registry: installed packs register their plugins, removing the pack removes them', async () => {
  initPlugins((m) => inProcess(m.runtime, m.code));
  await P.installPack(plateText);
  const g = G.getGenerator('org.kizamubeam.hole-plate');
  assert.ok(g, 'registered');
  assert.deepEqual(pluginGenerators().map((x) => x.id), ['org.kizamubeam.hole-plate']);
  assert.ok(!g!.tile, 'the toolbox adds plugin tiles itself (group „From extensions“)');
  // Reinstalling the same version keeps the running generator
  await P.installPack(plateText);
  assert.equal(G.getGenerator('org.kizamubeam.hole-plate'), g);
  // A second pack may not take the id of a built-in generator or of another pack's plugin
  const clash = JSON.parse(jsPack(SQUARE));
  clash.plugins[0].id = 'gear';
  await P.installPack(JSON.stringify(clash));
  assert.equal((G.getGenerator('gear') as { manifest?: unknown }).manifest, undefined, 'gear stays built-in');
  assert.match(pluginProblems().join('\n'), /eingebauten Generator/);
  const files = P.installedPacks().map((x) => x.file);
  for (const f of files) await P.removePack(f);
  assert.equal(G.getGenerator('org.kizamubeam.hole-plate'), undefined);
  assert.deepEqual(pluginProblems(), []);
});

await test('extension management (#206): rollback, switch off, verified files, test load', async () => {
  initPlugins((m) => inProcess(m.runtime, m.code));
  const v1 = jsPack(SQUARE);
  const v2 = JSON.stringify({ ...JSON.parse(v1), version: '1.1.0' });
  await P.installPack(v1);
  assert.equal(P.allPacks()[0].previous, undefined, 'a first install keeps nothing');
  await P.installPack(v2, { verified: true });
  let ip = P.allPacks()[0];
  assert.equal(ip.pack.version, '1.1.0');
  assert.equal(ip.previous, '1.0.0');
  assert.ok(P.packVerified(ip), 'installed from the catalogue');
  assert.equal(P.allPacks().length, 1, 'the kept version is not listed as a pack');
  // Rollback swaps the versions; the old file was not from the catalogue
  await P.restorePrevious('com.example.js');
  ip = P.allPacks()[0];
  assert.equal(ip.pack.version, '1.0.0');
  assert.equal(ip.previous, '1.1.0');
  assert.ok(!P.packVerified(ip));
  // Switched off: no content and no plugins, but still listed for the window
  await P.setPackDisabled('com.example.js', true);
  assert.equal(P.installedPacks().length, 0);
  assert.ok(P.allPacks()[0].disabled);
  assert.equal(G.getGenerator('com.example.square'), undefined);
  assert.equal(P.installKind(P.parsePack(v1)).kind, 'same', 'a switched-off pack still counts as installed');
  await P.setPackDisabled('com.example.js', false);
  assert.ok(G.getGenerator('com.example.square'));
  // Removing deletes the kept version and the remembered state
  await P.removePack(P.allPacks()[0].file);
  assert.equal(P.allPacks().length, 0);
  assert.ok(![...mem.keys()].some((k) => k === 'kizamubeam.packs' && mem.get(k)!.includes('~prev')), 'kept version removed');
  await assert.rejects(() => P.restorePrevious('com.example.js'));
  // Test load before installing: a working plugin passes, a hanging or broken one is reported
  assert.equal(await testLoadPlugins(P.parsePack(v1)), null);
  const loop = P.parsePack(jsPack(`globalThis.plugin = { validate: () => [], generate: () => { for(;;){} } };`));
  assert.match((await testLoadPlugins(loop)) ?? '', /com\.example\.square.*zu lange gerechnet/);
  const none = P.parsePack(jsPack(`globalThis.plugin = { validate: () => [] };`));
  assert.match((await testLoadPlugins(none)) ?? '', /fehlt eine Funktion/);
  assert.equal(G.getGenerator('com.example.square'), undefined, 'a test load registers nothing');
});

await test('saved part of a missing extension keeps its geometry and names the extension', () => {
  const label = G.genLabel({ kind: 'gen', gen: 'org.kizamubeam.hole-plate', v: 1, params: { width: 10 }, subs: [], ext: 'Lochplatte (Beispiel-Plugin)' });
  assert.match(label, /Erweiterung „Lochplatte \(Beispiel-Plugin\)“ fehlt/);
  const s = { kind: 'gen' as const, gen: 'org.kizamubeam.hole-plate', v: 1, params: { width: 10 }, subs: [{ closed: true, nodes: [{ x: 0, y: 0 }] }] };
  G.loadGen(s);
  assert.equal(s.subs.length, 1);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
