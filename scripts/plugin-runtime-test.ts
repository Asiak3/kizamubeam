// Plugin runtimes and contract (issue #205): WebAssembly without imports, JavaScript in QuickJS, limits and output
// checks. Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const { createEngine, unwrap, EngineError, setQuickJSWasm } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { inProcess } = await import('../src/plugins/client');
const { checkGenResult, checkIssues, ContractError } = await import('../src/plugins/contract');

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
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof EngineError ? e.code : `other: ${e}`;
  }
  return 'no error';
};

const wasm = new Uint8Array(readFileSync(new URL('../plugins/hole-plate/dist/hole-plate.wasm', import.meta.url)));
const plate = { width: 100, height: 60, margin: 5, holeDia: 6, pitch: 10, pattern: 'hex', holeShape: 'circle', corner: 3 };

await test('WebAssembly plugin: validate and generate through the ABI', async () => {
  const p = inProcess('wasm', wasm);
  assert.deepEqual(await p.call('validate', plate), []);
  const r = checkGenResult(await p.call('generate', plate));
  assert.equal(r.parts.length, 1);
  assert.ok(r.parts[0].subs.length > 20, 'outline plus holes');
  assert.equal(r.info[0][0], 'holes');
  const issues = checkIssues(await p.call('validate', { ...plate, holeDia: 12 }));
  assert.equal(issues[0].code, 'holes-touch');
  assert.equal(await code(p.call('generate', { width: 'x' })), 'bad-input');
});

await test('WebAssembly modules with imports are refused', async () => {
  // (module (import "env" "f" (func)))
  const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 2, 9, 1, 3, 0x65, 0x6e, 0x76, 1, 0x66, 0, 0]);
  assert.equal(await code(createEngine('wasm', bytes)), 'plugin-imports');
  assert.equal(await code(createEngine('wasm', new Uint8Array([1, 2, 3]))), 'plugin-bad-code');
});

await test('JavaScript plugin in QuickJS: calls, plugin error codes, missing functions', async () => {
  const src = `globalThis.plugin = {
    validate: (p) => (p.n > 3 ? [{ key: 'n', level: 'error', code: 'too-big', values: { max: 3 } }] : []),
    generate: (p) => { if (p.n < 0) throw new Error('negative'); return { parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: p.n, y: 0 }, { x: 0, y: p.n }] }] }], info: [['n', String(p.n)]] }; },
  };`;
  const p = inProcess('js', src);
  assert.deepEqual(checkIssues(await p.call('validate', { n: 5 })), [{ key: 'n', level: 'error', code: 'too-big', values: { max: 3 } }]);
  assert.equal(checkGenResult(await p.call('generate', { n: 2 })).parts[0].subs[0].nodes[1].x, 2);
  assert.equal(await code(p.call('generate', { n: -1 })), 'negative');
  const q = inProcess('js', 'globalThis.plugin = {}');
  assert.equal(await code(q.call('generate', {})), 'plugin-no-function');
});

await test('JavaScript plugins cannot reach the host', async () => {
  const p = inProcess('js', `globalThis.plugin = { generate: () => ({ parts: [], info: [['env', [typeof fetch, typeof require, typeof process, typeof XMLHttpRequest, typeof WebAssembly, typeof setTimeout].join(',')]] }) };`);
  const r = checkGenResult(await p.call('generate', {}));
  assert.equal(r.info[0][1], 'undefined,undefined,undefined,undefined,undefined,undefined');
});

await test('JavaScript time limit stops endless loops; the engine stays usable', async () => {
  const e = await createEngine('js', 'globalThis.plugin = { validate: () => { for (;;) {} }, generate: () => ({ parts: [], info: [] }) };');
  const t0 = Date.now();
  assert.throws(() => e.call('validate', '{}', 300), (x: unknown) => x instanceof EngineError && x.code === 'plugin-timeout');
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(unwrap(e.call('generate', '{}', 1000)), { parts: [], info: [] });
});

await test('JavaScript memory limit', async () => {
  const p = inProcess('js', 'globalThis.plugin = { generate: () => { const a = []; for (;;) a.push(new Array(1e6).fill(1)); } };');
  const c = await code(p.call('generate', {}));
  assert.ok(c === 'plugin-memory' || c === 'plugin-crash' || c === 'plugin-timeout', c);
});

await test('every JavaScript engine gets its own random seed', async () => {
  // QuickJS seeds from a millisecond clock: engines started together used to give the same numbers
  const seen = new Set<number>();
  for (let i = 0; i < 50; i++) seen.add(unwrap((await createEngine('js', 'globalThis.plugin = { generate: () => Math.random() };')).call('generate', '{}', 5000)) as number);
  assert.equal(seen.size, 50);
});

await test('contract: bad output is refused', () => {
  const bad = (v: unknown) => assert.throws(() => checkGenResult(v), ContractError);
  bad(null);
  bad({ parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [{ closed: true, nodes: [{ x: NaN, y: 0 }] }] }] });
  bad({ parts: [{ key: 'a', at: { x: 1e9, y: 0 }, subs: [] }] });
  bad({ parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [] }, { key: 'a', at: { x: 0, y: 0 }, subs: [] }] });
  bad({ parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [] }], poses: { poses: { a: { o: [0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] } } } });
  assert.throws(() => checkIssues([{ level: 'fatal', code: 'x' }]), ContractError);
  // unknown fields are dropped, known ones copied
  const r = checkGenResult({ parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [{ closed: true, nodes: [{ x: 1, y: 2, evil: '<script>' }] }], extra: 1 }], info: [] });
  assert.deepEqual(r.parts[0].subs[0].nodes[0], { x: 1, y: 2 });
});

await test('host functions from JavaScript: boolean, offset, fit, trace, progress', async () => {
  const px = new Uint8Array(16).fill(255);
  px[5] = px[6] = px[9] = px[10] = 0;
  const gray = Buffer.from(px).toString('base64');
  const src = `globalThis.plugin = { generate: () => {
    const sq = (x, y, s) => ({ closed: true, nodes: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });
    const u = host.boolean({ op: 'union', a: [sq(0, 0, 10)], b: [sq(5, 5, 10)] });
    const o = host.offset({ subs: [sq(0, 0, 10)], delta: 1, join: 'miter' });
    const f = host.fit({ pts: [[0, 0], [5, 2], [10, 0]] });
    const t = host.trace({ width: 4, height: 4, data: '${gray}', smooth: 0, ignoreLess: 0, scale: 2 });
    host.progress(0.5); host.progress({ done: 2, text: 'fast' });
    let err = ''; try { host.boolean({ op: 'nope', a: [] }); } catch (e) { err = e.message; }
    return { parts: [{ key: 'u', at: { x: 0, y: 0 }, subs: u }, { key: 'o', at: { x: 0, y: 0 }, subs: o }, { key: 'f', at: { x: 0, y: 0 }, subs: [f] }, { key: 't', at: { x: 0, y: 0 }, subs: t }], info: [['err', err]] };
  } };`;
  const p = inProcess('js', src, ['boolean', 'offset', 'fit', 'trace']);
  const seen: [number, string | undefined][] = [];
  p.onProgress = (d, t) => seen.push([d, t]);
  const r = checkGenResult(await p.call('generate', {}));
  const box = (key: string) => {
    const xs = r.parts.find((q) => q.key === key)!.subs.flatMap((s) => s.nodes.map((n) => n.x));
    return [Math.min(...xs), Math.max(...xs)];
  };
  assert.equal(r.parts[0].subs.length, 1, 'union is one outline');
  assert.deepEqual(box('u').map((v) => Math.round(v * 100) / 100), [0, 15]);
  assert.deepEqual(box('o').map((v) => Math.round(v * 100) / 100), [-1, 11]);
  assert.equal(r.parts[2].subs[0].nodes[0].x, 0);
  assert.ok(r.parts[3].subs.length === 1 && box('t')[1] <= 6.01 && box('t')[0] >= 1.99, 'traced square, scaled ×2');
  assert.equal(r.info[0][1], 'host-bad-input');
  assert.deepEqual(seen, [[0.5, undefined], [1, 'fast']]);
});

await test('host functions the manifest does not name are refused', async () => {
  const p = inProcess('js', `globalThis.plugin = { generate: () => { host.fit({ pts: [[0, 0], [1, 1]] }); return { parts: [], info: [] }; } };`, ['boolean']);
  assert.equal(await code(p.call('generate', {})), 'host-not-allowed');
  const q = inProcess('js', `globalThis.plugin = { generate: () => { host.progress(0.3); return { parts: [], info: [] }; } };`);
  assert.deepEqual(checkGenResult(await q.call('generate', {})).parts, [], 'progress needs no entry');
});

await test('host functions slice and region: a 3D model the plugin got as a resource, cut like in the app', async () => {
  const { encodeMesh, meshId } = await import('../src/model3d/mesh');
  // Cube 0 … 10 mm, outward-facing triangles
  const pos = Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10]);
  const tri = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  const data = encodeMesh({ pos, tri });
  const id = meshId(data);
  const src = `globalThis.plugin = { resource: () => null, generate: (p) => {
    const raw = host.slice({ model: p.id, heights: [5, 20] });
    const fit = host.slice({ model: p.id, size: 20, up: 'y', frame: { u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, heights: [1] });
    const sq = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s];
    const u = host.region({ op: 'union', a: [sq(0, 0, 10)], b: [sq(5, 5, 10)] });
    const d = host.region({ op: 'difference', a: [sq(0, 0, 10)], b: [sq(2, 2, 2)] });
    const c = host.region({ op: 'clean', a: d, minArea: 1 });
    const c2 = host.region({ op: 'clean', a: d, minArea: 5 });
    const isl = host.region({ op: 'islands', a: [sq(0, 0, 1), sq(5, 0, 1)], minArea: 0 });
    const o = host.region({ op: 'offset', a: [sq(0, 0, 10)], delta: -1 });
    const b = host.region({ op: 'band', line: [0, 0, 10, 0], radius: 1 });
    const l = host.region({ op: 'loops', loops: [sq(0, 0, 10), sq(2, 2, 2)] });
    const deep = host.region({ op: 'deepest', polys: [sq(0, 0, 10)] });
    let err = ''; try { host.slice({ model: 'nope', heights: [1] }); } catch (e) { err = e.message; }
    return { raw, fit, u, c, c2, isl, o, b, l, deep, err };
  } };`;
  const p = inProcess('js', src, ['slice', 'region']);
  p.setResource({ kind: 'model3d', id, data });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (await p.call('generate', { id })) as any;
  const area = (polys: number[][]) => Math.abs(polys.reduce((a, q) => { let s = 0; for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; s += q[i] * q[j + 1] - q[j] * q[i + 1]; } return a + s / 2; }, 0));
  const xs = (polys: number[][]) => polys.flatMap((q) => q.filter((_, i) => i % 2 === 0));
  assert.deepEqual(r.raw.min, [0, 0, 0]);
  assert.deepEqual(r.raw.max, [10, 10, 10]);
  assert.equal(r.raw.layers.length, 2);
  assert.equal(area(r.raw.layers[0].region), 100, 'square cross-section');
  assert.equal(r.raw.layers[0].open, 0);
  assert.deepEqual(r.raw.layers[1].region, [], 'above the model');
  assert.deepEqual([Math.min(...xs(r.fit.layers[0].region)), Math.max(...xs(r.fit.layers[0].region))], [-10, 10], 'scaled to 20 mm and centred');
  assert.equal(area(r.u), 175);
  assert.equal(r.c.polys.length, 2, 'outline and hole');
  assert.equal(r.c.islands, 1);
  assert.equal(r.c2.polys.length, 1, 'small hole filled');
  assert.equal(r.isl.length, 2);
  assert.equal(area(r.o), 64);
  assert.ok(Math.abs(area(r.b) - (20 + Math.PI)) < 0.05, 'band around a line');
  assert.equal(area(r.l), 96, 'even-odd loops');
  assert.deepEqual(r.deep.p, [5, 5]);
  assert.equal(r.err, 'host-bad-input');
  // Without the entry in the manifest the plugin may neither slice nor keep the model
  const q = inProcess('js', src, ['region']);
  q.setResource({ kind: 'model3d', id, data });
  assert.equal(await code(q.call('generate', { id })), 'host-not-allowed');
});

// A Rust module (no_std) whose kzb_call hands its input to host "fit" and returns the answer envelope
const hostWasm = Uint8Array.from(atob('AGFzbQEAAAABEgNgBH9/f38BfmABfwF/YAABfwIRAQNremIJaG9zdF9jYWxsAAADBAMBAgAFAwEAEgYJAX8BQYCAwAALBysEBm1lbW9yeQIACWt6Yl9hbGxvYwABB2t6Yl9hcGkAAghremJfY2FsbAADCk8DMwEBf0EAQQBBACgChIDEgAAiASABIABqQYCABEsbIgEgAGo2AoSAxIAAIAFBhIDAgABqCwQAQQELFABBgIDAgABBAyACIAMQgICAgAALCwwBAEGAgMAACwNmaXQAbwRuYW1lAAcGdC53YXNtAT8EAB5fUk52Q3NlNG1wNlhMTWg5UV8xdDlob3N0X2NhbGwBCWt6Yl9hbGxvYwIHa3piX2FwaQMIa3piX2NhbGwHEgEAD19fc3RhY2tfcG9pbnRlcgkKAQAHLnJvZGF0YQA9CXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQVydXN0Yx0xLjk3LjAgKDJkODE0NGI3OCAyMDI2LTA3LTA3KQCUAQ90YXJnZXRfZmVhdHVyZXMIKwtidWxrLW1lbW9yeSsPYnVsay1tZW1vcnktb3B0KxZjYWxsLWluZGlyZWN0LW92ZXJsb25nKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrE25vbnRyYXBwaW5nLWZwdG9pbnQrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ='), (c) => c.charCodeAt(0));

await test('host functions from WebAssembly through the kzb.host_call import', async () => {
  const p = inProcess('wasm', hostWasm, ['fit']);
  const sub = (await p.call('generate', { pts: [[0, 0], [5, 2], [10, 0]] })) as { nodes: { x: number }[] };
  assert.equal(sub.nodes[0].x, 0);
  assert.equal(sub.nodes.at(-1)!.x, 10);
  assert.equal(await code(inProcess('wasm', hostWasm).call('generate', { pts: [[0, 0], [1, 1]] })), 'host-not-allowed');
  assert.equal(await code(p.call('generate', { pts: 'x' })), 'host-bad-input');
});

await test('the plugin Worker starts without the DOM (no document, no localStorage)', async () => {
  // Every module the Worker imports runs in a Worker scope; a module that touches document at import time
  // (i18n via model.ts) made every plugin crash in the app
  // Loaded at run time: run-ts bundles this test and cannot bundle esbuild itself
  const { createRequire } = await import('node:module');
  const name = 'esbuild';
  const { build } = createRequire(import.meta.url)(name) as typeof import('esbuild');
  const r = await build({ entryPoints: [new URL('../src/plugins/worker.ts', import.meta.url).pathname], bundle: true, format: 'iife', write: false, metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(r.metafile!.inputs).filter((k) => k.startsWith('src/'));
  for (const bad of ['src/i18n.ts', 'src/model.ts', 'src/dom.ts']) assert.ok(!inputs.includes(bad), `${bad} is in the Worker`);
  const { runInNewContext } = await import('node:vm');
  const self: Record<string, unknown> = {};
  runInNewContext(r.outputFiles[0].text, { self, console, URL, TextEncoder, TextDecoder, navigator: { languages: ['en'] }, crypto: globalThis.crypto, setTimeout, clearTimeout });
  assert.equal(typeof self.onmessage, 'function');
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
