// Path tools and image filters from extensions (#205 stage 3): manifest, registry, the contract of apply(), the
// headless runner and check, applying a path tool to the selection as one undo step, the MCP tool.
// Aufruf: npm run test:plugins
import './core-fixtures-env';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
gl.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const P = await import('../src/packs');
const { pluginTool, sampleInput } = await import('../src/plugins/tool');
const { runTool, checkPlugin } = await import('../src/plugins/headless');
const { checkPathResult, checkFilterResult, ContractError } = await import('../src/plugins/contract');
const { initPlugins, pluginTools, getPluginTool, syncPlugins } = await import('../src/plugins/registry');
const { inProcess } = await import('../src/plugins/client');
const { getGenerator } = await import('../src/generators/index');
const { toolTarget, applyToolResult, toolNeeds } = await import('../src/plugins/toolDialog');
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer, translate } = await import('../src/model');
const { EDIT_TOOLS } = await import('../src/agentedit');
type Obj = import('../src/model').Obj;

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

/** Path tool: a rectangle around each object, `margin` mm larger; open paths give a warning */
const FRAME = `globalThis.plugin = {
  apply({ params, objects }) {
    const out = [];
    let open = 0;
    for (const o of objects) {
      const ns = o.subs.flatMap((s) => (s.closed ? s.nodes : (open++, s.nodes)));
      if (!ns.length) continue;
      const m = params.margin;
      const x0 = Math.min(...ns.map((n) => n.x)) - m, x1 = Math.max(...ns.map((n) => n.x)) + m;
      const y0 = Math.min(...ns.map((n) => n.y)) - m, y1 = Math.max(...ns.map((n) => n.y)) + m;
      out.push({ from: o.id, subs: [{ closed: true, nodes: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] }] });
    }
    if (params.margin > 40) return { issues: [{ key: 'margin', level: 'error', code: 'too-wide', values: { max: 40 } }] };
    return { objects: out, issues: open ? [{ level: 'warn', code: 'open-paths', values: { n: open } }] : [], info: [['count', String(out.length)]] };
  },
};`;
/** Image filter: threshold, or a bad answer (wrong data length) when mode is "broken" */
const THRESHOLD = `globalThis.plugin = {
  apply({ params, image }) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const map = {}; for (let i = 0; i < 64; i++) map[abc[i]] = i;
    const s = image.data.replace(/=+$/, ''), px = [];
    for (let i = 0; i < s.length; i += 4) {
      const v = (map[s[i]] << 18) | (map[s[i + 1]] << 12) | ((map[s[i + 2]] ?? 0) << 6) | (map[s[i + 3]] ?? 0);
      px.push(v >> 16, (v >> 8) & 255, v & 255);
    }
    const n = image.width * image.height, out = [];
    for (let i = 0; i < n; i++) out.push(px[i] < params.level ? 0 : 255);
    if (params.mode === 'broken') out.pop();
    let b = '';
    for (let i = 0; i < out.length; i += 3) {
      const v = (out[i] << 16) | ((out[i + 1] ?? 0) << 8) | (out[i + 2] ?? 0);
      b += abc[v >> 18] + abc[(v >> 12) & 63] + (i + 1 < out.length ? abc[(v >> 6) & 63] : '=') + (i + 2 < out.length ? abc[v & 63] : '=');
    }
    return { image: { width: image.width, height: image.height, data: b }, info: [['level', String(params.level)]] };
  },
};`;

const plugin = (id: string, type: string, code: string, params: unknown[], texts: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id, type, api: 1, runtime: 'js', code, sha256: sha(code), params, texts: { en: texts }, ...extra,
});
const framePlugin = plugin('com.example.frame', 'pathtool', FRAME, [{ key: 'margin', type: 'length', min: 0, max: 100, def: 2 }],
  { name: 'Frame', desc: 'Rectangle around each shape', margin: 'Margin', count: 'Frames', 'too-wide': 'At most {max} mm', 'open-paths': '{n} open paths' });
const thresholdPlugin = plugin('com.example.threshold', 'imagefilter', THRESHOLD, [
  { key: 'level', type: 'int', min: 0, max: 255, def: 128 },
  { key: 'mode', type: 'enum', options: [['normal', 'mode.normal'], ['broken', 'mode.broken']], def: 'normal' },
], { name: 'Threshold', desc: 'Black and white', level: 'Level', mode: 'Mode', 'mode.normal': 'Normal', 'mode.broken': 'Broken' });
const pack = (plugins: unknown[]) => JSON.stringify({ format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.tools', version: '1.0.0', name: 'Tools', plugins });

await test('manifest: path tools and image filters are read; generator-only parts are refused', () => {
  const p = P.parsePack(pack([framePlugin, thresholdPlugin]));
  assert.deepEqual(p.plugins.map((m) => m.type), ['pathtool', 'imagefilter']);
  assert.throws(() => P.parsePack(pack([{ ...framePlugin, type: 'filter' }])), /unbekannte Art/);
  assert.throws(() => P.parsePack(pack([{ ...framePlugin, dialog: { version: 2, actions: [{ id: 'x', label: 'x' }] } }])), /nur bei Generatoren/);
  assert.match(P.packSummary(p), /2 Plugins/);
});

await test('path tool: apply on the sample, issues and info in the interface language, errors keep the result back', async () => {
  const m = P.parsePack(pack([framePlugin])).plugins[0];
  const x = pluginTool(m, { id: 'com.example.tools', name: 'Tools' });
  assert.equal(x.type, 'pathtool');
  assert.equal(x.schema[0].label, 'Margin');
  const r = await x.run({ margin: 1 }, sampleInput('pathtool'));
  assert.equal(r.objects!.length, 2);
  assert.deepEqual(r.objects![0].from, 'sample-a');
  assert.deepEqual(r.objects![0].subs[0].nodes[0], { x: -1, y: -1 });
  assert.deepEqual(r.info, [['Frames', '2']]);
  assert.equal(r.issues[0].msg, '1 open paths');
  const bad = await x.run({ margin: 50 }, sampleInput('pathtool'));
  assert.equal(bad.objects, undefined);
  assert.equal(bad.issues[0].msg, 'At most 40 mm');
  x.dispose();
});

await test('contract: tool answers outside the contract are refused', () => {
  const ids = new Set(['a']);
  assert.throws(() => checkPathResult({ objects: [{ from: 'b', subs: [] }] }, ids), ContractError);
  assert.throws(() => checkPathResult({ objects: [{ subs: [{ closed: true, nodes: [{ x: NaN, y: 0 }] }] }] }, ids), ContractError);
  assert.deepEqual(checkPathResult({}, ids), { objects: [], issues: [], info: [] });
  assert.throws(() => checkFilterResult({ image: { width: 2, height: 2, data: 'AAA=' } }), /width × height/);
  assert.throws(() => checkFilterResult({ image: { width: 9000, height: 1, data: '' } }), ContractError);
  assert.deepEqual(Array.from(checkFilterResult({ image: { width: 2, height: 1, data: 'AP8=' } }).image!.data), [0, 255]);
});

await test('image filter: grayscale in and out, a broken answer becomes plugin-bad-output', async () => {
  const m = P.parsePack(pack([thresholdPlugin])).plugins[0];
  const s = await runTool(m, { level: 100 });
  assert.deepEqual(s.image, { width: 32, height: 24 });
  const px = s.result.image!.data;
  assert.ok(px.every((v) => v === 0 || v === 255) && px.includes(0) && px.includes(255));
  assert.deepEqual(s.info, [['Level', '100']]);
  const broken = await runTool(m, { mode: 'broken' });
  assert.equal(broken.issues[0].code, 'plugin-bad-output');
  await assert.rejects(runTool(m, { level: 300 }), /zwischen/);
});

await test('check: a good tool passes; a broken choice is found', async () => {
  const good = await checkPlugin(P.parsePack(pack([framePlugin])).plugins[0]);
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.warnings, []);
  const filter = await checkPlugin(P.parsePack(pack([thresholdPlugin])).plugins[0]);
  assert.match(filter.errors.join('\n'), /"mode":"broken".*plugin-bad-output/);
});

await test('registry: tools are listed apart from generators and go with their pack', async () => {
  initPlugins((m) => inProcess(m.runtime, m.code, m.host ?? []));
  const before = pluginTools().length;
  await P.installPack(pack([framePlugin, thresholdPlugin]));
  assert.equal(pluginTools().length, before + 2);
  assert.equal(getPluginTool('com.example.frame')?.pack.name, 'Tools');
  assert.equal(getGenerator('com.example.frame'), undefined, 'a tool is no generator');
  // Reinstalling the same version keeps the running tool
  const x = getPluginTool('com.example.frame');
  await P.installPack(pack([framePlugin, thresholdPlugin]));
  syncPlugins();
  assert.equal(getPluginTool('com.example.frame'), x);
});

// Editor without a window, like the other editor tests
const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, {
  doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(), nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(),
  handleSets: new Map(), clipboard: [], isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, activeLayer: 0, hint: '',
  view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
});
ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
for (const i of [0, 1, 2]) ed.doc.layers[i] = defaultLayer(i);
const square: Obj['shape'] = { kind: 'path', subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }] };

await test('editor: the selection goes in as world paths, the result replaces it on the inputs\' layers, one undo step', async () => {
  const x = pluginTool(P.parsePack(pack([framePlugin])).plugins[0], { id: 'com.example.tools', name: 'Tools' });
  const a: Obj = { id: 1, m: translate(100, 50), layer: 1, shape: square };
  const b: Obj = { id: 2, m: translate(0, 0), layer: 2, shape: square };
  const c: Obj = { id: 3, m: translate(0, 0), layer: 0, shape: square };
  ed.doc.objs = [c, a, b];
  ed.setSel([]);
  assert.match(toolNeeds(ed, x) ?? '', /erst passende Objekte/);
  ed.setSel([a, b]);
  const target = await toolTarget(ed, x);
  assert.ok(target && target.type === 'pathtool');
  assert.deepEqual(target.input.objects.map((o) => o.id), ['1', '2']);
  assert.deepEqual(target.input.objects[0].subs[0].nodes[0], { x: 100, y: 50 }, 'world coordinates');
  const r = await x.run({ margin: 1 }, target.input);
  assert.ok(await applyToolResult(ed, x, target, r));
  assert.equal(ed.doc.objs.length, 3);
  assert.equal(ed.doc.objs[0], c, 'other objects stay');
  assert.deepEqual(ed.doc.objs.slice(1).map((o) => o.layer), [1, 2], 'each result on the layer of its input');
  assert.deepEqual(ed.sel, ed.doc.objs.slice(1));
  assert.equal(ed.history.position, 1, 'one undo step');
  ed.doUndo();
  assert.deepEqual(ed.doc.objs.map((o) => o.id), [3, 1, 2]);
  x.dispose();
});

await test('MCP: run_extension_tool applies a path tool to ids and reports info and warnings', async () => {
  const tool = EDIT_TOOLS.find((t) => t.name === 'run_extension_tool');
  assert.ok(tool);
  const a: Obj = { id: 11, m: translate(0, 0), layer: 0, shape: square };
  ed.doc.objs = [a];
  const r = (await tool.run(ed, { tool: 'com.example.frame', ids: [11], params: { margin: 3 } })) as { info: Record<string, string> };
  assert.equal(r.info.Frames, '1');
  assert.equal(ed.doc.objs.length, 1);
  assert.notEqual(ed.doc.objs[0].id, 11);
  await assert.rejects(tool.run(ed, { tool: 'com.example.frame', ids: [ed.doc.objs[0].id], params: { margin: 1000 } }), /margin/);
  await assert.rejects(tool.run(ed, { tool: 'nope', ids: [1] }), /Unbekanntes Werkzeug/);
  for (const f of P.installedPacks().map((y) => y.file)) await P.removePack(f);
  assert.equal(getPluginTool('com.example.frame'), undefined, 'removing the pack removes its tools');
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
process.exit(0);
