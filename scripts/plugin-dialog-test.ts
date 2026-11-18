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
const { defaultParams } = await import('../src/generators/index');
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
  assert.throws(() => manifest(TRAY, { dialog: { version: 6 } }), /neuere Version|newer version/);
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
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, lists: [{ param: 'items', columns: [{ key: 'x', type: 'swatch' }] }] } }), /swatch/);
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

await test('stage 4: a drawing surface with views, pointer events, selectable rows and row buttons', async () => {
  // A polyline: click adds a point, dragging a handle moves it; the points are also a list with a delete button
  const code = `globalThis.plugin = {
    validate: (p) => JSON.parse(p.pts).length < 2 ? [{ level: 'error', code: 'few' }] : [],
    generate: (p) => ({ parts: [{ key: 'line', subs: [{ closed: false, nodes: JSON.parse(p.pts).map((q) => ({ x: q.x, y: q.y })) }], at: { x: 0, y: 0 } }], info: [] }),
    view: (p) => ({ rowAuto: { pts: JSON.parse(p.pts).map((_, i) => ({ code: 'point', values: { n: i + 1 } })) } }),
    draw: (req) => {
      const pts = (req.state && req.state.pts) || JSON.parse(req.params.pts);
      const flip = req.view === 'side' ? -1 : 1;
      return {
        // The surface size in pixels (#411), when the app gives it: the frame widens with it here
        frame: { x0: -50, y0: -50, x1: req.size ? req.size.width / 10 : 50, y1: 50 },
        layers: [{ key: 'grid', ...(req.have.includes('grid') ? {} : { items: [{ type: 'line', pts: [[-50, 0], [50, 0]], style: 'muted' }] }) }],
        items: [
          { type: 'line', pts: pts.map((q) => [q.x, q.y * flip]) },
          ...pts.map((q, i) => ({ type: 'handle', id: 'h' + i, x: q.x, y: q.y * flip, style: req.selected.pts === i ? 'accent' : 'normal' })),
          { type: 'text', x: 0, y: 0, text: { code: 'count', values: { n: pts.length } } },
        ],
        ...(req.state && req.state.drawing ? { track: true, cursor: 'crosshair', escape: true } : {}),
      };
    },
    onSurface: ({ event, surface, params }) => {
      const pts = (surface.state && surface.state.pts) || JSON.parse(params.pts);
      if (event.type === 'down' && event.hit) return { state: { pts, drag: Number(event.hit.slice(1)) }, select: { pts: Number(event.hit.slice(1)) } };
      if (event.type === 'down') return { patch: { pts: JSON.stringify([...pts, { name: '', x: event.x, y: event.y }]) }, message: { code: 'added' } };
      if (event.type === 'move' && surface.state) return { state: { ...surface.state, pts: pts.map((q, i) => (i === surface.state.drag ? { ...q, x: event.x, y: event.y } : q)) } };
      if (event.type === 'up' && surface.state) return { state: null, patch: { pts: JSON.stringify(pts) } };
      if (event.type === 'select') return { view: 'side' };
      return null;
    },
    onEvent: ({ action, row, params, surface }) => {
      const pts = JSON.parse(params.pts);
      if (action === 'del') return { patch: { pts: JSON.stringify(pts.filter((_, i) => i !== row)) }, select: { pts: -1 } };
      if (action === 'start') return { state: { drawing: true }, message: 'Click to add points (' + surface.view + ')' };
      return null;
    },
  };`;
  const dialog = {
    version: 3,
    surface: { views: [{ id: 'top', label: 'viewTop' }, { id: 'side', label: 'viewSide' }], height: 240, help: 'help' },
    lists: [{ param: 'pts', label: 'ptsLabel', select: true, rowActions: [{ id: 'del', label: 'delLabel', title: 'delTitle' }], columns: [
      { key: 'name', type: 'text', max: 20 },
      { key: 'x', type: 'length', min: -50, max: 50 },
      { key: 'y', type: 'length', min: -50, max: 50, placeholder: 'auto' },
    ] }],
    actions: [{ id: 'start', label: 'startLabel', showIf: { eq: ['pts', '[]'] } }],
  };
  const params = [{ key: 'pts', type: 'data', def: '[]' }];
  const texts = { en: { name: 'Line', desc: 'A line', pts: 'Points', viewTop: 'Top', viewSide: 'Side', help: 'Click to add', ptsLabel: 'Points', delLabel: 'Delete', delTitle: 'Delete the point', startLabel: 'Start', few: 'Two points needed', point: 'Point {n}', count: '{n} points', added: 'Point added', name: 'Name', x: 'X', y: 'Y', auto: 'auto' } };
  const m = manifest(code, { params, dialog, texts });
  const g = pluginGenerator(m, { id: 'p', name: 'P' });
  try {
    assert.deepEqual(g.surface, { views: [{ id: 'top', label: 'Top' }, { id: 'side', label: 'Side' }], height: 240, help: 'Click to add' });
    assert.deepEqual(g.lists![0].rowActions, [{ id: 'del', label: 'Delete', title: 'Delete the point' }]);
    assert.equal(g.lists![0].select, true);
    assert.equal((g.lists![0].columns[2] as { placeholder?: string }).placeholder, 'auto');
    assert.deepEqual(g.actions![0].showIf, { eq: ['pts', '[]'] });
    // Texts on the surface are translated, layers come once
    const p = { pts: JSON.stringify([{ name: '', x: 0, y: 0 }, { name: 'B', x: 10, y: 5 }]) };
    const d = await g.draw!({ view: 'side', state: null, selected: { pts: 1 }, have: [] }, p);
    assert.equal(d.items.length, 4);
    assert.deepEqual(d.items[2], { type: 'handle', id: 'h1', x: 10, y: -5, style: 'accent' });
    assert.deepEqual(d.items[3], { type: 'text', x: 0, y: 0, text: '2 points' });
    assert.equal(d.layers![0].items!.length, 1);
    assert.equal((await g.draw!({ view: 'top', state: null, selected: {}, have: ['grid'] }, p)).layers![0].items, undefined);
    assert.equal(d.frame.x1, 50, 'without a size');
    assert.equal((await g.draw!({ view: 'top', state: null, selected: {}, have: ['grid'], size: { width: 700, height: 500 } }, p)).frame.x1, 70, 'the size reaches the plugin');
    await g.prepare(p);
    assert.deepEqual(g.view!(p).rowAuto, { pts: ['Point 1', 'Point 2'] });
  } finally {
    g.dispose();
  }
  // Headless: the button with its condition, clicks, a drag and a row button
  const s = await runDialog(m, [
    { $action: 'start' },
    { $surface: [{ type: 'down', x: -20, y: 0 }, { type: 'down', x: 20, y: 10 }] },
    { $surface: [{ type: 'down', x: 20, y: 10, hit: 'h1' }, { type: 'move', x: 30, y: 15, drag: true, from: { x: 20, y: 10 } }, { type: 'up', x: 30, y: 15, from: { x: 20, y: 10 } }] },
    { $view: 'side' },
    { $action: 'del', $row: 0 },
  ]);
  assert.equal(s[0].surface!.view, 'top');
  assert.equal(s[1].message, 'Click to add points (top)');
  assert.equal(s[1].surface!.track, true);
  assert.deepEqual([s[1].surface!.cursor, s[1].surface!.escape], ['crosshair', true], 'cursor and Escape as the drawing asks (#411)');
  assert.deepEqual([s[0].surface!.cursor, s[0].surface!.escape], [undefined, undefined]);
  assert.equal(s[2].message, 'Point added');
  assert.equal(s[2].parts.length, 1);
  assert.deepEqual(JSON.parse(String(s[3].params.pts))[1], { name: '', x: 30, y: 15 });
  assert.deepEqual(s[3].surface!.selected, { pts: 1 });
  assert.equal(s[3].surface!.state, null);
  assert.equal(s[4].surface!.view, 'side');
  assert.equal(JSON.parse(String(s[5].params.pts)).length, 1);
  assert.deepEqual(s[5].surface!.selected, { pts: -1 });
  await assert.rejects(runDialog(m, [{ $view: 'front' }]), ScriptError);
  await assert.rejects(runDialog(m, [{ $action: 'start', $row: 0 }]), ScriptError);
  // The surface and the new list and button features need dialog version 3; bad drawings are refused
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, version: 2 } }), /Version 3|version 3/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, surface: { views: [] } } }), /dialog/);
  const { checkDrawing, checkEvent } = await import('../src/plugins/contract');
  assert.throws(() => checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [{ type: 'circle' }] }), /item type/);
  assert.throws(() => checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [], cursor: 'wait' }), /cursor/);
  assert.throws(() => checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [], escape: 'yes' }), /escape/);
  assert.equal(checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [], escape: false }).escape, false);
  assert.equal(checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [], cursor: 'default' }).cursor, 'default');
  assert.throws(() => checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [], layers: [{ key: 'a', tris: [1, 2, 3] }] }), /tris/);
  assert.throws(() => checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [{ type: 'line', pts: [[0, 0]], style: 'pink' }] }), /style/);
  assert.throws(() => checkEvent({ select: { pts: 1.5 } }), /select/);
  assert.throws(() => checkEvent({ state: { big: 'x'.repeat(2 * 1024 * 1024) } }), /state/);
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

await test('stage 6: images kept as resources, selectedImage and store need dialog version 4', async () => {
  const { storedImage } = await import('../plugins/sdk/ts/index');
  assert.deepEqual(storedImage('rgba1:2,1,AAAAAAAAAAA='), { width: 2, height: 1, data: 'AAAAAAAAAAA=' });
  assert.equal(storedImage('kzm1:AAAA'), null);
  const code = `let calls = 0; const imgs = {};
  globalThis.plugin = {
    resource: ({ kind, id, data }) => { calls++; if (kind === 'image') imgs[id] = data; return null; },
    validate: (p) => !p.photo || imgs[p.photo] ? [] : [{ level: 'error', code: 'noImage' }],
    generate: (p) => {
      const m = p.photo ? /^rgba1:([0-9]+),([0-9]+),/.exec(imgs[p.photo]) : null;
      const w = m ? Number(m[1]) : 1;
      return { parts: [{ key: 'a', subs: [{ closed: true, nodes: [{x:0,y:0},{x:w,y:0},{x:0,y:1}] }], at: { x: 0, y: 0 } }], info: [['calls', String(calls)]] };
    },
    onEvent: ({ action, inputs, params }) => ({ message: [action, ' ', inputs.image ? inputs.image.name : '-', ' ', params.photo ? 'kept' : 'none'] }),
  };`;
  const params = [{ key: 'photo', type: 'data', def: '', resource: 'image' }];
  const texts = { en: { name: 'Photo', desc: 'Photo', noImage: 'No image', calls: 'Calls' } };
  const dialog = { version: 4, actions: [{ id: 'pick', inputs: ['image'], store: 'photo' }, { id: 'sel', inputs: ['selectedImage'], store: 'photo' }] };
  const m = manifest(code, { params, texts, dialog });
  const px = (w: number, h: number) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4, 9).toString('base64') });
  const s = await runDialog(m, [{ $action: 'pick', $image: { ...px(5, 3), name: 'cat' } }, { $action: 'sel', $image: { ...px(7, 2), name: 'dog' } }]);
  assert.equal(s[1].message, 'pick cat kept', 'the id is stored before onEvent');
  assert.match(String(s[1].params.photo), /^[0-9a-f]{16}$/);
  assert.equal(s[1].parts[0].box.maxX, 5, 'generate sees the pixels through the resource');
  assert.equal(s[2].message, 'sel dog kept');
  assert.equal(s[2].parts[0].box.maxX, 7);
  // Version, resource kind and image input are checked
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, version: 3 } }), /4/);
  assert.throws(() => manifest(code, { params: [{ key: 'photo', type: 'data', def: '' }], texts, dialog }), /store/);
  assert.throws(() => manifest(code, { params, texts, dialog: { version: 4, actions: [{ id: 'x', inputs: ['camera'], store: 'photo' }] } }), /store/);
});

await test('stage 7: steps, sortable lists with a fixed tail, colour columns and region maps', async () => {
  const code = `globalThis.plugin = {
    validate: () => [],
    generate: (p) => ({ parts: [{ key: 'a', subs: [{ closed: true, nodes: [{x:0,y:0},{x:p.width,y:0},{x:0,y:1}] }], at: { x: 0, y: 0 } }], info: [['order', JSON.parse(p.levels).map((r) => r.c[1]).join(' ')]] }),
    draw: () => ({ frame: { x0: 0, y0: 0, x1: 4, y1: 2 }, items: [], layers: [{ key: 'map', regions: { frame: { x0: 0, y0: 0, x1: 4, y1: 2 }, width: 2, height: 1, data: 'AQI=', colors: ['#ff0000', '#00ff00'] } }] }),
    onSurface: ({ event }) => ({ message: String(event.hit) }),
  };`;
  const params = [
    { key: 'width', type: 'length', min: 1, max: 100, def: 10 },
    { key: 'levels', type: 'data', def: JSON.stringify([{ c: '#111111' }, { c: '#222222' }, { c: '#333333' }, { c: '#444444' }]) },
  ];
  const texts = { en: { name: 'Levels', desc: 'Levels', src: 'Source', lay: 'Layers', order: 'Order' } };
  const dialog = {
    version: 5,
    lists: [{ param: 'levels', columns: [{ key: 'c', type: 'color' }], sort: true, fixedLast: 1 }],
    actions: [{ id: 'go' }],
    surface: { views: [{ id: 'v' }] },
    steps: [{ id: 'src', label: 'src', items: ['width', 'go'] }, { id: 'lay', label: 'lay', items: ['levels', 'surface'] }],
  };
  const m = manifest(code, { params, texts, dialog });
  const g = pluginGenerator(m, { id: 'p', name: 'P' });
  assert.deepEqual(g.steps, [{ id: 'src', label: 'Source', items: ['width', 'go'] }, { id: 'lay', label: 'Layers', items: ['levels', 'surface'] }]);
  assert.equal(g.lists![0].sort, true);
  assert.equal(g.lists![0].fixedLast, 1);
  assert.deepEqual(g.lists![0].columns[0], { key: 'c', label: 'c', type: 'color' });
  // The region map arrives as bytes; a click on it reports the layer key and region
  const d = await g.draw!({ view: 'v', state: null, selected: {}, have: [] }, defaultParams(g));
  assert.deepEqual([...d.layers![0].regions!.data], [1, 2]);
  g.dispose();
  const { columnValue, moveRow } = await import('../src/generators/lists');
  assert.equal(columnValue({ key: 'c', label: 'c', type: 'color' }, '#ABCDEF'), '#abcdef');
  assert.equal(columnValue({ key: 'c', label: 'c', type: 'color' }, 'red'), '#000000');
  const lst = { param: 'levels', label: '', columns: [], sort: true, fixedLast: 1 };
  const p0 = { levels: params[1].def };
  assert.equal(moveRow(p0, lst, 2, 3), null, 'the fixed last row is not passed');
  assert.equal(moveRow(p0, lst, 3, 0), null, 'the fixed last row does not move');
  const s = await runDialog(m, [{ $move: { list: 'levels', from: 2, to: 0 } }, { $surface: [{ type: 'down', x: 3, y: 1, hit: 'map:1' }] }]);
  assert.deepEqual(s[1].info, [['Order', '3 1 2 4']]);
  await assert.rejects(runDialog(m, [{ $move: { list: 'levels', from: 0, to: 3 } }]), ScriptError);
  // Manifest checks: version 5, known and unique step items, fixedLast only with sort, region maps
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, version: 4 } }), /5/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, steps: [{ id: 'a', items: ['width'] }, { id: 'b', items: ['width'] }] } }), /width/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, steps: [{ id: 'a', items: ['nope'] }, { id: 'b', items: [] }] } }), /nope/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, steps: [{ id: 'a', items: [] }] } }), /2/);
  assert.throws(() => manifest(code, { params, texts, dialog: { ...dialog, lists: [{ ...dialog.lists[0], sort: false }] } }), /fixedLast/);
  const { checkDrawing } = await import('../src/plugins/contract');
  const bad = (regions: unknown) => assert.throws(() => checkDrawing({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [], layers: [{ key: 'k', regions }] }));
  bad({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, width: 2, height: 2, data: 'AQI=', colors: [] });
  bad({ frame: { x0: 0, y0: 0, x1: 1, y1: 1 }, width: 2, height: 1, data: 'AQI=', colors: ['red'] });
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

await test('surface events carry the held modifier keys (#385)', async () => {
  const { pointerMods } = await import('../src/generators/pointerMods');
  const k = (shiftKey: boolean, altKey: boolean, ctrlKey: boolean, metaKey: boolean) => pointerMods({ shiftKey, altKey, ctrlKey, metaKey });
  assert.deepEqual(k(false, false, false, false), {}, 'keys not held are left out');
  assert.deepEqual(k(true, false, false, false), { shift: true });
  assert.deepEqual(k(false, true, true, false), { alt: true, ctrl: true });
  assert.deepEqual(k(false, false, false, true), { ctrl: true }, 'Cmd counts as Ctrl');
  const code = `globalThis.plugin = {
    validate: () => [],
    generate: () => ({ parts: [{ key: 'a', subs: [{ closed: true, nodes: [{x:0,y:0},{x:1,y:0},{x:0,y:1}] }], at: { x: 0, y: 0 } }], info: [] }),
    draw: () => ({ frame: { x0: 0, y0: 0, x1: 10, y1: 10 }, items: [] }),
    onSurface: ({ event }) => ({ message: [event.type, event.shift ? '+shift' : '', event.alt ? '+alt' : '', event.ctrl ? '+ctrl' : ''] }),
  };`;
  const m = manifest(code, { params: [], texts: { en: { name: 'Mods', desc: 'Mods' } }, dialog: { version: 3, surface: { views: [{ id: 'v' }] } } });
  const s = await runDialog(m, [{ $surface: [{ type: 'down', x: 1, y: 1, shift: true }] }, { $surface: [{ type: 'key', x: 0, y: 0, key: 'Delete', alt: true, ctrl: true }] }, { $surface: [{ type: 'dblclick', x: 1, y: 1 }] }]);
  assert.deepEqual(s.slice(1).map((x) => x.message), ['down+shift', 'key+alt+ctrl', 'dblclick']);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
