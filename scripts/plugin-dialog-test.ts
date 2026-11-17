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
// Endless loops below should not wait for the full generate limit
(await import('../src/plugins/contract')).LIMITS.callMs.generate = 3000;

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
  assert.throws(() => manifest(TRAY, { dialog: { version: 3 } }), /neuere Version|newer version/);
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

await test('stage 2: view suggests texts, onChange patches fields or asks inside the dialog', async () => {
  const code = `globalThis.plugin = {
    validate: () => [],
    generate: (p) => ({ parts: [{ key: 'base', subs: [{ closed: true, nodes: [{x:0,y:0},{x:p.width,y:0},{x:0,y:10}] }], at: { x: 0, y: 0 } }], info: [] }),
    view: (p) => ({ autoText: { note: { code: 'noteFor', values: { w: p.width } } } }),
    onChange: ({ key, old, params }) => {
      if (key === 'lid' && params.lid) return { patch: { lidGap: 1, nope: 3, width: 999 } };
      if (key === 'width' && params.width < old) return { ask: { question: { code: 'shrink', values: { from: old } }, options: [{ label: 'keep', patch: { lidGap: 2 } }, { label: { code: 'half' }, patch: { lidGap: old / 100, width: 1 } }] } };
      return null;
    },
  };`;
  const params = [
    { key: 'width', type: 'length', min: 10, max: 300, def: 100 },
    { key: 'lid', type: 'bool', def: false },
    { key: 'lidGap', type: 'length', min: 0, max: 5, def: 0.2 },
    { key: 'note', type: 'text', def: '' },
  ];
  const m = manifest(code, { params, texts: { en: { name: 'Tray', desc: 'A tray', width: 'Width', lid: 'Lid', lidGap: 'Gap', note: 'Note', noteFor: 'Tray {w}', shrink: 'Smaller than {from}?', keep: 'Keep', half: 'Half' } } });
  const s = await runDialog(m, [{ lid: true }, { width: 50 }, { width: 50, $answer: 1 }, { width: 40, $answer: 0 }]);
  assert.deepEqual(s[0].autoText, { note: 'Tray 100' });
  // A patch goes through the schema: unknown keys are dropped, values clamped to their range
  assert.equal(s[1].params.lidGap, 1);
  assert.equal(s[1].params.width, 300, 'patched values are clamped to the schema');
  assert.equal('nope' in s[1].params, false);
  // Question without an answer: Cancel restores the field
  assert.deepEqual(s[2].ask, { question: 'Smaller than 300?', options: ['keep', 'Half'] }, 'plain texts as they are, codes translated');
  assert.equal(s[2].params.width, 300);
  assert.equal(s[3].params.lidGap, 3, 'second option');
  assert.equal(s[3].params.width, 50, 'a patch does not change the field the user committed');
  assert.equal(s[3].autoText.note, 'Tray 50');
  assert.equal(s[4].params.lidGap, 2, 'first option');
  assert.equal(s[4].params.width, 40);
  await assert.rejects(runDialog(m, [{ width: 20, $answer: 5 }]), ScriptError);
  // Without view and onChange the plugin is asked once and then left alone
  const plain = manifest(TRAY);
  const r = await runDialog(plain, [{ width: 50 }, { width: 60 }]);
  assert.deepEqual(r[2].autoText, {});
  assert.equal(r[2].params.width, 60);
});

await test('stage 3: lists of rows and actions with the selection', async () => {
  const code = `globalThis.plugin = {
    validate: (p) => JSON.parse(p.items).length ? [] : [{ level: 'error', code: 'empty' }],
    generate: (p) => ({
      parts: JSON.parse(p.items).flatMap((r, i) => Array.from({ length: r.count }, (_, k) => ({ key: 'p' + i + '-' + k, subs: [{ closed: true, nodes: [{x:0,y:0},{x:r.w,y:0},{x:0,y:r.w}] }], at: { x: 0, y: 0 } }))),
      info: [],
    }),
    view: (p) => ({ rows: { items: JSON.parse(p.items).map((r) => ({ code: 'size', values: { w: r.w } })) } }),
    onEvent: ({ action, params, inputs }) => {
      if (action === 'clear') return { patch: { items: '[]' }, message: { code: 'cleared' } };
      if (!inputs.selection.length) return { message: 'Nothing selected' };
      const add = inputs.selection.map((s) => ({ name: s.name, count: 1, w: Math.max(...s.polys[0].map((q) => q.x)) }));
      return { patch: { items: JSON.stringify([...JSON.parse(params.items), ...add]) } };
    },
  };`;
  const dialog = {
    version: 2,
    lists: [{ param: 'items', label: 'itemsLabel', empty: 'none', remove: true, columns: [
      { key: 'what', type: 'text', max: 40 },
      { key: 'count', type: 'int', min: 0, max: 9, label: 'countLabel' },
      { key: 'side', type: 'enum', options: [['l', 'left'], ['r', 'right']] },
    ] }],
    actions: [{ id: 'add', label: 'addLabel', inputs: ['selection'] }, { id: 'clear' }],
  };
  const params = [{ key: 'items', type: 'data', def: '[]' }];
  const texts = { en: { name: 'Plates', desc: 'Plates', items: 'Items', itemsLabel: 'Workpieces', none: 'No workpieces yet', count: 'c', countLabel: 'Count', side: 'Side', left: 'Left', right: 'Right', addLabel: 'Add selection', clear: 'Clear', size: '{w} mm', cleared: 'List cleared', empty: 'Add a workpiece' } };
  const m = manifest(code, { params, dialog, texts });
  const g = pluginGenerator(m, { id: 'p', name: 'P' });
  assert.deepEqual(g.lists, [{ param: 'items', label: 'Workpieces', empty: 'No workpieces yet', remove: true, columns: [
    { key: 'what', type: 'text', max: 40, label: 'what' },
    { key: 'count', type: 'int', min: 0, max: 9, label: 'Count' },
    { key: 'side', type: 'enum', options: [['l', 'Left'], ['r', 'Right']], label: 'Side' },
  ] }]);
  assert.deepEqual(g.actions, [{ id: 'add', label: 'Add selection', inputs: ['selection'] }, { id: 'clear', label: 'Clear' }]);
  g.dispose();
  const sel = [{ name: 'A', polys: [[{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 0, y: 25 }]] }];
  const s = await runDialog(m, [{ $action: 'add', $selection: sel }, { $action: 'add', $selection: [] }, { $action: 'add', $selection: sel }, { $action: 'clear' }]);
  assert.equal(s[0].parts.length, 0);
  assert.deepEqual(s[1].rows, { items: ['25 mm'] });
  assert.equal(s[1].parts.length, 1);
  assert.equal(s[2].message, 'Nothing selected');
  assert.deepEqual(s[3].rows, { items: ['25 mm', '25 mm'] });
  assert.equal(s[4].message, 'List cleared');
  assert.equal(s[4].params.items, '[]');
  await assert.rejects(runDialog(m, [{ $action: 'nope' }]), ScriptError);
  // Edits in the dialog are checked like fields: numbers clamped and rounded, options checked, text cut
  const { setCell, removeRow, readRows } = await import('../src/generators/lists');
  const list = m.lists![0];
  const p0 = { items: JSON.stringify([{ what: 'A', count: 1, side: 'l' }, { what: 'B', count: 2, side: 'r' }]) };
  assert.deepEqual(JSON.parse(setCell(p0, list, 0, 'count', '12.7'))[0].count, 9);
  assert.deepEqual(JSON.parse(setCell(p0, list, 0, 'count', '3.4'))[0].count, 3);
  assert.deepEqual(JSON.parse(setCell(p0, list, 1, 'side', 'x'))[1].side, 'l');
  assert.equal(JSON.parse(setCell(p0, list, 0, 'what', 'x'.repeat(99)))[0].what.length, 40);
  assert.equal(setCell(p0, list, 5, 'count', 1), p0.items, 'no such row');
  assert.deepEqual(JSON.parse(removeRow(p0, list, 0)).map((r: { what: string }) => r.what), ['B']);
  assert.deepEqual(readRows({ items: '{"a":1}' }, list), []);
  assert.deepEqual(readRows({ items: '[1, null, {"a":1}]' }, list), [{ a: 1 }]);
  // The check fills an empty list through the selection action
  assert.deepEqual((await checkPlugin(m)).errors, []);
  // Lists and actions need dialog version 2, a data parameter, valid columns and known inputs
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, version: 1 } }), /Version 2|version 2/);
  assert.throws(() => manifest(code, { params: [{ key: 'items', type: 'text', def: '' }], texts, dialog }), /data/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, lists: [{ param: 'items', columns: [{ key: 'x', type: 'int', min: 5, max: 1 }] }] } }), /min/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, lists: [{ param: 'items', columns: [{ key: 'x', type: 'color' }] }] } }), /color/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, actions: [{ id: 'a', inputs: ['video'] }] } }), /Eingabe|input/);
});

await test('stage 3: image and camera inputs, a field next to a button, placeholders', async () => {
  const { toBase64, fromBase64 } = await import('../src/plugins/contract');
  const { pixels: sdkPixels } = await import('../plugins/sdk/ts/index');
  for (const n of [0, 1, 2, 3, 4, 5, 1000]) {
    const b = Uint8ClampedArray.from({ length: n }, (_, i) => (i * 37) & 255);
    assert.deepEqual(fromBase64(toBase64(b)), b, `base64 of ${n} bytes`);
    assert.equal(toBase64(b), Buffer.from(b).toString('base64'));
    assert.deepEqual([...sdkPixels({ width: 1, height: 1, data: toBase64(b) })], [...b], `SDK pixels() of ${n} bytes`);
  }
  const code = `globalThis.plugin = {
    validate: () => [],
    generate: (p) => ({ parts: [{ key: 'a', subs: [{ closed: true, nodes: [{x:0,y:0},{x:p.scale,y:0},{x:0,y:1}] }], at: { x: 0, y: 0 } }], info: [] }),
    onEvent: ({ action, inputs, params }) => {
      const im = action === 'pic' ? inputs.image : inputs.camera;
      if (!im) return { message: 'none' };
      return { message: [im.name ?? 'cam', ' ', String(im.width), 'x', String(im.height), ' ', String(im.data.length), ' ', String(params.scale), ' ', im.bed ? String(im.bed.w) : '-', im.empty ? '+' : ''] };
    },
  };`;
  const params = [{ key: 'items', type: 'data', def: '[]' }, { key: 'scale', type: 'length', min: 1, max: 100, def: 20 }];
  const dialog = {
    version: 2,
    lists: [{ param: 'items', columns: [{ key: 'n', type: 'text', placeholder: 'rowName' }] }],
    actions: [{ id: 'pic', inputs: ['image'], field: 'scale' }, { id: 'cam', inputs: ['camera'] }],
  };
  const texts = { en: { name: 'Pics', desc: 'Pics', rowName: 'Piece {n}' } };
  const m = manifest(code, { params, dialog, texts });
  const g = pluginGenerator(m, { id: 'p', name: 'P' });
  assert.equal((g.lists![0].columns[0] as { placeholder?: string }).placeholder, 'Piece {n}');
  assert.equal(g.actions![0].field, 'scale');
  g.dispose();
  const px = (w: number, h: number) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4, 7).toString('base64') });
  const s = await runDialog(m, [
    { scale: 30, $action: 'pic', $image: { ...px(3, 2), name: 'tag' } },
    { $action: 'cam', $camera: { ...px(4, 4), bed: { w: 365, h: 305 }, empty: px(4, 4) } },
    { $action: 'cam' },
  ]);
  assert.equal(s[1].message, 'tag 3x2 32 30 -', 'the plugin gets RGBA as base64');
  assert.equal(s[2].message, 'cam 4x4 88 30 365+');
  assert.equal(s[3].message, 'none');
  await assert.rejects(runDialog(m, [{ $action: 'pic', $image: { width: 3, height: 2, data: 'AAAA' } }]), ScriptError);
  await assert.rejects(runDialog(m, [{ $action: 'cam', $camera: px(2, 2) }]), ScriptError);
  // field must be a number parameter, inputs must be known
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, actions: [{ id: 'pic', inputs: ['image'], field: 'items' }] } }), /field/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, actions: [{ id: 'pic', inputs: ['video'] }] } }), /Eingabe|input/);
});

await test('3D model input: resource sent once per engine, opened through inputs, checked with a sample', async () => {
  const { encodeMesh, meshId, weld } = await import('../src/model3d/mesh');
  const code = `let calls = 0; const models = {};
  globalThis.plugin = {
    resource: ({ kind, id, data }) => { calls++; models[id] = data.length; return null; },
    validate: (p) => models[p.model] ? [] : [{ level: 'error', code: 'noModel' }],
    generate: (p) => ({ parts: [{ key: 'a', subs: [{ closed: true, nodes: [{x:0,y:0},{x:models[p.model] / 10,y:0},{x:0,y:1}] }], at: { x: 0, y: 0 } }], info: [['calls', String(calls)], ['name', p.name]] }),
  };`;
  const params = [{ key: 'model', type: 'data', def: '', resource: 'model3d' }, { key: 'name', type: 'data', def: '' }, { key: 'size', type: 'length', min: 1, max: 100, def: 10 }];
  const texts = { en: { name: 'Model', desc: 'Model', noModel: 'No model', calls: 'Calls' } };
  const m = manifest(code, { params, texts, inputs: [{ kind: 'model3d', param: 'model', name: 'name' }] });
  assert.deepEqual(m.inputs, [{ kind: 'model3d', param: 'model', name: 'name' }]);
  const tet = encodeMesh(weld(Float32Array.from([[0, 0, 0], [9, 0, 0], [0, 9, 0], [0, 0, 0], [0, 0, 9], [9, 0, 0], [0, 0, 0], [0, 9, 0], [0, 0, 9], [9, 0, 0], [0, 0, 9], [0, 9, 0]].flat())));
  const { mesh: sdkMesh } = await import('../plugins/sdk/ts/index');
  const { decodeMesh } = await import('../src/model3d/mesh');
  assert.deepEqual(sdkMesh(tet), decodeMesh(tet), 'SDK mesh() reads the app format');
  assert.equal(sdkMesh('kzm1:AAAA'), null);
  const s = await runDialog(m, [{ $model: { name: 'tet', data: tet } }, { size: 20 }, { size: 30 }]);
  assert.deepEqual(s[0].issues.map((i) => i.code), ['noModel']);
  assert.equal(s[1].params.model, meshId(tet));
  assert.equal(s[1].params.name, 'tet');
  assert.equal(s[1].parts[0].box.maxX, tet.length / 10);
  assert.deepEqual(s[3].info, [['Calls', '1'], ['Model', 'tet']], 'the model is sent once');
  await assert.rejects(runDialog(m, [{ $model: { data: 'stl' } }]), ScriptError);
  // The catalogue check opens it with a sample model
  assert.deepEqual((await checkPlugin(m)).errors, []);
  // A plugin without resource() still computes; the app does not send what it cannot use
  const plain = manifest(code.replace(/resource: .*?\n/, ''), { params, texts, inputs: [{ kind: 'model3d', param: 'model' }] });
  const r = await runDialog(plain, [{ $model: { data: tet } }]);
  assert.deepEqual(r[1].issues.map((i) => i.code), ['noModel']);
  // Manifest: resource kinds and inputs are checked
  assert.throws(() => manifest(code, { params: [{ key: 'model', type: 'data', def: '', resource: 'video' }], texts }), /video/);
  assert.throws(() => manifest(code, { params: [{ key: 'model', type: 'data', def: '' }], texts, inputs: [{ kind: 'model3d', param: 'model' }] }), /resource/);
  assert.throws(() => manifest(code, { params, texts, inputs: [{ kind: 'model3d', param: 'model', name: 'size' }] }), /name/);
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
