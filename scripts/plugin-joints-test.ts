// Host function joints (#398): the app's wood joints for plugins. Box panels like the box generators, edge joints
// like the Joint tool, versioned, with codes the app turns into texts. Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Obj, SubPath } from '../src/model';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm, EngineError } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { hostCaller } = await import('../src/plugins/hostfns');
const { inProcess } = await import('../src/plugins/client');
const { checkGenResult } = await import('../src/plugins/contract');
const { parsePack } = await import('../src/packs');
const { pluginWords } = await import('../src/plugins/words');
const { panelPolys } = await import('../src/generators/box');
const { computeJoint, DEFAULT_JOINT } = await import('../src/joints');
const { IDENT } = await import('../src/model');

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

const call = (input: unknown, allowed = ['joints']) => JSON.parse(hostCaller(allowed)('joints', JSON.stringify(input))) as { ok?: Record<string, unknown>; error?: string };
const rectSub = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const round = (subs: unknown) => JSON.parse(JSON.stringify(subs), (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));

await test('panel: the same outline as the box generator', () => {
  const box = { sizeMode: 'outer' as const, width: 120, depth: 80, height: 60, thickness: 3, top: 'closed' as const, finger: 10, clearance: 0.1, kerf: 0.15 };
  const polys = panelPolys(box);
  // front: width × height, top B (closed lid), sides A, bottom B, with corners; bottom/top plates: all A, no corners
  const front = call({ op: 'panel', width: 120, height: 60, thickness: 3, finger: 10, clearance: 0.1, kerf: 0.15, edges: ['B', 'A', 'B', 'A'], corners: true });
  assert.equal(front.ok!.v, 1);
  assert.deepEqual(round((front.ok!.outline as SubPath).nodes), round(polys.find((p) => p.key === 'front')!.pts));
  const bottom = call({ op: 'panel', width: 120, height: 80, thickness: 3, finger: 10, clearance: 0.1, kerf: 0.15, edges: ['A', 'A', 'A', 'A'] });
  assert.deepEqual(round((bottom.ok!.outline as SubPath).nodes), round(polys.find((p) => p.key === 'bottom')!.pts));
  const left = call({ op: 'panel', v: 1, width: 80, height: 60, thickness: 3, finger: 10, clearance: 0.1, kerf: 0.15, edges: ['B', 'B', 'B', 'B'] });
  assert.deepEqual(round((left.ok!.outline as SubPath).nodes), round(polys.find((p) => p.key === 'left')!.pts));
});

await test('edge: finger joints and tenons like the Joint tool', () => {
  const a = rectSub(0, 0, 100, 50), b = rectSub(0, 60, 100, 50);
  const o = { kind: 'finger' as const, thickness: 3, fingerWidth: 10, kerf: 0.1 };
  const r = call({ op: 'edge', options: o, parts: { a: [a], b: [b] }, edges: [{ part: 'a', seg: 2 }, { part: 'b', seg: 0 }] });
  const obj = (sub: SubPath): Obj => ({ id: 1, m: IDENT, layer: 0, shape: { kind: 'path', subs: [sub] } });
  const oa = obj(a), ob = { ...obj(b), id: 2 };
  const tool = computeJoint([{ obj: oa, m: IDENT, sub: 0, seg: 2 }, { obj: ob, m: IDENT, sub: 0, seg: 0 }], { ...DEFAULT_JOINT, ...o });
  assert.deepEqual(round((r.ok!.parts as Record<string, SubPath[]>).a), round(tool.changes.get(oa)!.subs));
  assert.deepEqual(round((r.ok!.parts as Record<string, SubPath[]>).b), round(tool.changes.get(ob)!.subs));
  assert.deepEqual(r.ok!.info, [{ code: 'joint-finger-info', values: { n: 11, width: 100 / 11 } }]);
  // Tenons on a's bottom edge, slots in b at 5 mm from its top edge
  const t = call({ op: 'edge', options: { kind: 'tenon', thickness: 3, tenonCount: 2, tenonWidth: 15, slotOffset: 5 }, parts: { a: [a], b: [b] }, edges: [{ part: 'a', seg: 2 }, { part: 'b', seg: 0 }] });
  assert.equal((t.ok!.parts as Record<string, SubPath[]>).b.length, 3, 'outline plus two slots');
  assert.deepEqual((t.ok!.info as { code: string }[]).map((m) => m.code), ['joint-tenon-info', 'joint-slot-count']);
  // Wedges come back as added parts
  const w = call({ op: 'edge', options: { kind: 'wedge', thickness: 3, tenonCount: 1, tenonWidth: 12 }, parts: { a: [a] }, edges: [{ part: 'a', seg: 2 }] });
  assert.equal((w.ok!.added as SubPath[]).length, 1);
});

await test('edge: a joint that does not fit answers with an error code; the app writes the text', () => {
  const r = call({ op: 'edge', options: { kind: 'finger', thickness: 3, fingerWidth: 0.5, kerf: 1 }, parts: { a: [rectSub(0, 0, 20, 20)] }, edges: [{ part: 'a', seg: 0 }] });
  assert.deepEqual(r.ok, { v: 1, error: { code: 'joint-fingers-narrow' } });
});

await test('bad input is refused', () => {
  const a = [rectSub(0, 0, 50, 50)];
  const curved: SubPath = { closed: true, nodes: [{ x: 0, y: 0, cout: { x: 10, y: -10 } }, { x: 50, y: 0, cin: { x: 40, y: -10 } }, { x: 50, y: 50 }] };
  for (const input of [
    null, { op: 'nope' }, { op: 'panel', v: 2, width: 10, height: 10, thickness: 1, finger: 2, edges: ['A', 'A', 'A', 'A'] },
    { op: 'panel', width: 10, height: 10, thickness: 6, finger: 2, edges: ['A', 'A', 'A', 'A'] },
    { op: 'panel', width: 10, height: 10, thickness: 1, finger: 2, edges: ['A', 'A', 'A'] },
    { op: 'panel', width: 10, height: 10, thickness: 1, finger: 2, edges: ['A', 'A', 'A', 'X'] },
    { op: 'panel', width: 50000, height: 50000, thickness: 1, finger: 0.5, edges: ['A', 'A', 'A', 'A'] },
    { op: 'edge', options: { kind: 'dovetail' }, parts: { a }, edges: [{ part: 'a', seg: 0 }] },
    { op: 'edge', options: { kind: 'finger', evil: 1 }, parts: { a }, edges: [{ part: 'a', seg: 0 }] },
    { op: 'edge', options: { kind: 'finger', thickness: -1 }, parts: { a }, edges: [{ part: 'a', seg: 0 }] },
    { op: 'edge', options: { kind: 'finger' }, parts: { a }, edges: [{ part: 'b', seg: 0 }] },
    { op: 'edge', options: { kind: 'finger' }, parts: { a }, edges: [{ part: 'a', seg: 9 }] },
    { op: 'edge', options: { kind: 'finger' }, parts: { a: [curved] }, edges: [{ part: 'a', seg: 0 }] },
    { op: 'edge', options: { kind: 'finger' }, parts: { a, b: a, c: a }, edges: [{ part: 'a', seg: 0 }] },
  ])
    assert.deepEqual(call(input), { error: 'host-bad-input' }, JSON.stringify(input)?.slice(0, 90));
  assert.deepEqual(call({ op: 'panel' }, ['nest']), { error: 'host-not-allowed' });
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PLUGIN = `globalThis.plugin = {
  validate: (p) => {
    const r = host.joints({ op: 'edge', options: { kind: 'finger', thickness: 3, fingerWidth: p.finger, kerf: 1 }, parts: { a: [{ closed: true, nodes: [{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}] }] }, edges: [{ part: 'a', seg: 0 }] });
    return r.error ? [{ level: 'error', code: r.error.code, values: r.error.values }] : [];
  },
  generate: (p) => {
    const lid = host.joints({ op: 'panel', width: 100, height: 60, thickness: 3, finger: p.finger, edges: ['A', 'A', 'A', 'A'] });
    const e = host.joints({ op: 'edge', options: { kind: 'finger', thickness: 3, fingerWidth: p.finger }, parts: { a: [{ closed: true, nodes: [{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}] }] }, edges: [{ part: 'a', seg: 0 }] });
    return { parts: [{ key: 'lid', at: { x: 0, y: 0 }, subs: [lid.outline] }, { key: 'side', at: { x: 0, y: 0 }, subs: e.parts.a }], info: [['fields', e.info]] };
  },
};`;
const manifest = (host: string[]) =>
  parsePack(JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.joints', version: '1.0.0', name: 'Joints example',
    plugins: [{ id: 'com.example.jointed', type: 'generator', api: 1, kind: 'assembly', runtime: 'js', code: PLUGIN, sha256: sha(PLUGIN), host,
      params: [{ key: 'finger', type: 'length', def: 10, min: 0.5, max: 100 }], texts: { en: { name: 'Jointed', desc: 'Uses joints', finger: 'Finger', fields: 'Fields' } } }],
  })).plugins[0];

await test('a JS plugin uses host.joints; info and errors in the interface language', async () => {
  const m = manifest(['joints']);
  const p = inProcess('js', PLUGIN, m.host ?? []);
  const r = checkGenResult(await p.call('generate', { finger: 10 }));
  assert.equal(r.parts.length, 2);
  assert.ok(r.parts[0].subs[0].nodes.length > 20, 'finger outline');
  const words = pluginWords(m);
  assert.equal(words.render(r.info[0][1]), '5 fields of 8 mm');
  const issues = await p.call('validate', { finger: 0.5 }) as { level: 'error'; code: string }[];
  assert.equal(words.issue(issues[0]).msg, 'Fingers too narrow for kerf and clearance.');
  const q = inProcess('js', PLUGIN, []);
  try {
    await q.call('generate', { finger: 10 });
    assert.fail('no error');
  } catch (e) {
    assert.ok(e instanceof EngineError && e.code === 'host-not-allowed', String(e));
  }
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall plugin joint tests passed');
