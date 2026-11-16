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

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
