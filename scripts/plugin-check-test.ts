// Host function check (#388): the geometric part of "Check design" on the parts of a plugin, findings as codes
// with numbers that the app turns into the texts of the design check. Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm, EngineError } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { hostCaller } = await import('../src/plugins/hostfns');
const { inProcess } = await import('../src/plugins/client');
const { checkIssues } = await import('../src/plugins/contract');
const { parsePack } = await import('../src/packs');
const { pluginWords } = await import('../src/plugins/words');
const { checkPlugin } = await import('../src/plugins/headless');

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

type F = { code: string; level: string; parts: string[]; values?: Record<string, number>; at?: [number, number] };
const rect = (x: number, y: number, w: number, h: number, closed = true) => ({ closed, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const call = (input: unknown, allowed = ['check']) => JSON.parse(hostCaller(allowed)('check', JSON.stringify(input))) as { ok?: F[]; error?: string };
const codes = (r: { ok?: F[] }) => r.ok!.map((f) => f.code).sort();

await test('a clean part has no findings', () => {
  assert.deepEqual(call({ parts: [{ key: 'side', subs: [rect(0, 0, 100, 60), rect(20, 20, 10, 10)] }] }), { ok: [] });
});

await test('open outline, line cut twice, thin web, cut-out lost to the kerf', () => {
  const open = call({ parts: [{ key: 'a', subs: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 0.4 }] }] }] });
  assert.deepEqual(codes(open), ['check-open']);
  assert.ok(Math.abs(open.ok![0].values!.gap - 0.4) < 1e-6, 'gap in mm');
  assert.deepEqual(open.ok![0].parts, ['a']);
  assert.ok(open.ok![0].at, 'a point to show');

  const twice = call({ parts: [{ key: 'b', subs: [rect(0, 0, 40, 40), rect(0, 0, 40, 40)] }] });
  assert.ok(codes(twice).includes('check-double-whole') || codes(twice).includes('check-double'), JSON.stringify(twice));

  const web = call({ parts: [{ key: 'c', subs: [rect(0, 0, 100, 100), rect(10, 10, 20, 20), rect(30.5, 10, 20, 20)] }], minWeb: 1 });
  assert.deepEqual(codes(web), ['check-web']);
  assert.ok(web.ok![0].values!.w < 1, 'web width');

  const lost = call({ parts: [{ key: 'd', subs: [rect(0, 0, 50, 50), rect(10, 10, 0.2, 0.2)] }], kerf: 0.15 });
  assert.ok(codes(lost).includes('check-hole-lost') || codes(lost).includes('check-hole-small'), JSON.stringify(lost));
});

await test('parts are checked on their own unless placed; at moves a part', () => {
  const same = [{ key: 'p', subs: [rect(0, 0, 30, 30)] }, { key: 'q', subs: [rect(0, 0, 30, 30)] }];
  assert.deepEqual(call({ parts: same }), { ok: [] }, 'on their own: both at the origin is fine');
  const placed = call({ parts: same, placed: true });
  assert.ok(placed.ok!.length > 0 && placed.ok!.every((f) => f.code.startsWith('check-double')), JSON.stringify(placed));
  assert.deepEqual(placed.ok![0].parts.sort(), ['p', 'q']);
  assert.deepEqual(call({ parts: [same[0], { ...same[1], at: [40, 0] }], placed: true }), { ok: [] }, 'moved apart');
  // The strip between two parts is offcut, not a web of either part
  assert.deepEqual(call({ parts: [same[0], { ...same[1], at: [30.4, 0] }], placed: true, minWeb: 1 }), { ok: [] });
});

await test('work area: a part that does not fit, also turned', () => {
  const r = call({ parts: [{ key: 'big', subs: [rect(0, 0, 500, 100)] }, { key: 'turn', subs: [rect(0, 0, 250, 350)] }], workArea: { width: 400, height: 300 } });
  assert.deepEqual(r.ok!.map((f) => [f.code, f.parts[0], f.level]), [['check-too-big', 'big', 'error']]);
  assert.deepEqual(r.ok![0].values, { w: 500, h: 100, aw: 400, ah: 300 });
});

await test('bad input and undeclared use are refused', () => {
  for (const input of [null, {}, { parts: 'x' }, { parts: [{ subs: [] }] }, { parts: [{ key: 'a', subs: 'x' }] }, { parts: [{ key: 'a', subs: [] }, { key: 'a', subs: [] }] },
    { parts: [], minWeb: -1 }, { parts: [], kerf: 'x' }, { parts: [], workArea: { width: 0, height: 10 } }, { parts: [{ key: 'a', subs: [], at: [1] }] }, { parts: Array.from({ length: 501 }, (_, i) => ({ key: `k${i}`, subs: [] })) }])
    assert.deepEqual(call(input), { error: 'host-bad-input' }, JSON.stringify(input).slice(0, 80));
  assert.deepEqual(call({ parts: [] }, ['boolean']), { error: 'host-not-allowed' });
});

await test('findings are capped', () => {
  const subs = Array.from({ length: 300 }, (_, i) => ({ closed: false, nodes: [{ x: i * 20, y: 0 }, { x: i * 20 + 10, y: 0 }, { x: i * 20 + 10, y: 10 }, { x: i * 20, y: 10 }, { x: i * 20, y: 0.3 }] }));
  assert.equal(call({ parts: [{ key: 'a', subs }] }).ok!.length, 200);
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PLUGIN = `globalThis.plugin = {
  validate: (p) => host.check({ parts: [{ key: 'side', subs: [
      { closed: true, nodes: [{x:0,y:0},{x:p.w,y:0},{x:p.w,y:50},{x:0,y:50}] },
      { closed: true, nodes: [{x:5,y:5},{x:15,y:5},{x:15,y:15},{x:5,y:15}] },
      { closed: true, nodes: [{x:15.4,y:5},{x:25,y:5},{x:25,y:15},{x:15.4,y:15}] }] }],
    minWeb: 1, workArea: { width: 400, height: 300 } }).map((f) => ({ key: f.code, level: f.level, code: f.code, values: f.values })),
  generate: (p) => ({ parts: [{ key: 'side', at: { x: 0, y: 0 }, subs: [{ closed: true, nodes: [{x:0,y:0},{x:p.w,y:0},{x:p.w,y:50},{x:0,y:50}] }] }], info: [] }),
};`;
const manifest = (host: string[]) =>
  parsePack(JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.check', version: '1.0.0', name: 'Check example',
    plugins: [{ id: 'com.example.checked', type: 'generator', api: 1, kind: 'part', runtime: 'js', code: PLUGIN, sha256: sha(PLUGIN), host,
      params: [{ key: 'w', type: 'number', def: 100, min: 1, max: 1000 }], texts: { en: { name: 'Checked', desc: 'Checks itself', w: 'Width' } } }],
  })).plugins[0];

await test('a plugin passes the findings on as issues; the app writes the text of the design check', async () => {
  const m = manifest(['check']);
  const p = inProcess('js', PLUGIN, m.host ?? []);
  const issues = checkIssues(await p.call('validate', { w: 500 }));
  assert.deepEqual(issues.map((i) => i.code).sort(), ['check-too-big', 'check-web']);
  const words = pluginWords(m);
  const msg = (code: string) => words.issue(issues.find((i) => i.code === code)!).msg;
  assert.match(msg('check-too-big'), /^The part \(500(?:[.,]0)? × 50(?:[.,]0)? mm\) does not fit on the work area \(400(?:[.,]0)? × 300(?:[.,]0)? mm\)\.$/);
  assert.match(msg('check-web'), /^Bridge only 0[.,]25 mm wide/, 'gap less the beam width');
  assert.match(words.render({ code: 'check-open', values: { gap: 0.25 } }), /0[.,]25 mm/);
  assert.equal(words.render({ code: 'check-nope' }), 'Error in the extension “Checked”: check-nope', 'unknown check code');
  const report = await checkPlugin(m);
  assert.deepEqual(report.errors, []);
  assert.ok(!report.warnings.some((w) => /check-/.test(w)), report.warnings.join('\n'));
});

await test('without host check in the manifest the call is refused', async () => {
  const p = inProcess('js', PLUGIN, []);
  try {
    await p.call('validate', { w: 100 });
    assert.fail('no error');
  } catch (e) {
    assert.ok(e instanceof EngineError && e.code === 'host-not-allowed', String(e));
  }
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall plugin check tests passed');
