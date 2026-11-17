// Network access of plugins (#280 stage 9): manifest servers, host.fetch with the pending round trip, the app's
// checks in net.ts (URL, consent, offline switch, cache, types, size) and the generator calling again with the data.
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
const { parsePack } = await import('../src/packs');
const { inProcess } = await import('../src/plugins/client');
const { netRequest, netKey } = await import('../src/plugins/hostfns');
const net = await import('../src/plugins/net');
const { pluginGenerator } = await import('../src/plugins/generator');
const { buildGenAsync, normalizeParams, defaultParams } = await import('../src/generators/index');

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
const OSM = { id: 'osm', base: 'https://nominatim.openstreetmap.org', purpose: 'netOsm', attribution: '© OpenStreetMap contributors', types: ['json'], rate: 5 };
function manifest(code: string, extra: Record<string, unknown> = {}) {
  const text = JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.net', version: '1.0.0', name: 'Net example',
    plugins: [{
      id: 'com.example.place', type: 'generator', api: 1, kind: 'part', runtime: 'js', code, sha256: sha(code), host: ['fetch'],
      network: [OSM],
      params: [{ key: 'q', type: 'text', def: 'Berlin' }],
      texts: { en: { name: 'Place', desc: 'A place', q: 'Place', netOsm: 'Finds the place you type' } },
      ...extra,
    }],
  });
  return parsePack(text).plugins[0];
}

const PLACE = `globalThis.plugin = {
  validate: () => [],
  generate: (p) => {
    const r = host.fetch({ host: 'osm', path: '/search', query: { q: p.q, format: 'json' } });
    if (r.error) throw new Error(r.error);
    const hit = JSON.parse(r.text)[0];
    const w = Number(hit.size);
    return { parts: [{ key: 'a', at: { x: 0, y: 0 }, subs: [{ closed: true, nodes: [{x:0,y:0},{x:w,y:0},{x:0,y:w}] }] }], info: [['place', hit.name]] };
  },
};`;

const enc = (s: string) => new TextEncoder().encode(s);
let calls: { url: string; method: string; body?: string }[] = [];
let reply: (url: string) => { status: number; contentType: string; bytes: Uint8Array } = () => ({ status: 200, contentType: 'application/json', bytes: enc('[{"name":"Berlin","size":20}]') });
net.setNetTransport(async (r) => {
  calls.push({ url: r.url, method: r.method, ...(r.body !== undefined ? { body: r.body } : {}) });
  return reply(r.url);
});
let asked = 0;
let answer = true;
net.setNetConsent(async () => (asked++, answer));
const reset = () => {
  calls = [];
  asked = 0;
  answer = true;
  mem.delete('kizamubeam.pluginNet');
  mem.delete('kizamubeam.pluginNetOff');
  net.clearNetCache();
};

await test('manifest: servers are https to a named host, need host fetch, rate is capped', () => {
  const m = manifest(PLACE);
  assert.equal(m.network![0].hostname, 'nominatim.openstreetmap.org');
  assert.deepEqual(m.network![0].methods, ['GET']);
  assert.equal(m.network![0].rate, 2);
  for (const base of ['http://example.org', 'https://192.168.178.48', 'https://[::1]', 'https://user:pw@example.org', 'https://example.org/?k=1', 'https://localhost', 'https://*.example.org'])
    assert.throws(() => manifest(PLACE, { network: [{ ...OSM, base }] }), /base/, base);
  assert.throws(() => manifest(PLACE, { host: [] }), /fetch/);
  assert.throws(() => manifest(PLACE, { network: undefined }), /fetch/);
  assert.throws(() => manifest(PLACE, { network: [{ ...OSM, types: ['html'] }] }), /types/);
  assert.throws(() => manifest(PLACE, { network: [OSM, OSM] }), /network/);
  assert.throws(() => manifest(PLACE, { network: [1, 2, 3, 4, 5].map((i) => ({ ...OSM, id: `h${i}` })) }), /network/);
});

await test('host.fetch: requests are checked, a missing answer goes to the app and the call fails with net-pending', async () => {
  assert.throws(() => netRequest({ host: 'osm', path: '/a/../b' }), /path/);
  assert.throws(() => netRequest({ host: 'osm', path: '/a/%2e%2e/b' }), /path/);
  assert.throws(() => netRequest({ host: 'osm', path: '//evil.example/x' }), /path/);
  assert.throws(() => netRequest({ host: 'osm', path: 'https://evil.example/' }), /path/);
  assert.throws(() => netRequest({ host: 'osm', path: '/x', body: 'a' }), /body/);
  const r = netRequest({ host: 'osm', path: '/search', query: { z: 1, a: 'b' } });
  assert.deepEqual(Object.keys(r.query), ['a', 'z']);
  assert.equal(r.query.z, '1');

  const wants: unknown[] = [];
  const p = inProcess('js', PLACE, ['fetch']);
  p.onWant = (w) => wants.push(w);
  await assert.rejects(p.call('generate', { q: 'Berlin' }), (e: Error & { code?: string }) => (e.code ?? e.message) === 'net-pending');
  assert.equal(wants.length, 1);
  const want = wants[0] as ReturnType<typeof netRequest>;
  assert.deepEqual(want, { host: 'osm', path: '/search', query: { format: 'json', q: 'Berlin' }, method: 'GET' });
  p.setResource({ kind: 'net', id: netKey(want), data: JSON.stringify({ status: 200, type: 'json', text: '[{"name":"Berlin","size":20}]' }) });
  const out = (await p.call('generate', { q: 'Berlin' })) as { info: string[][] };
  assert.deepEqual(out.info, [['place', 'Berlin']]);
  // A plugin without the fetch permission gets no network at all
  const q = inProcess('js', PLACE, []);
  await assert.rejects(q.call('generate', { q: 'Berlin' }), /host-not-allowed/);
  p.dispose();
  q.dispose();
});

await test('net.ts: URL from the declared base, consent once, offline switch, cache, types and size', async () => {
  reset();
  const m = manifest(PLACE);
  const h = m.network![0];
  assert.equal(net.netUrl(h, { host: 'osm', path: '/search', query: { q: 'Köln', format: 'json' }, method: 'GET' }), 'https://nominatim.openstreetmap.org/search?format=json&q=K%C3%B6ln');
  assert.equal(net.netUrl({ ...h, base: 'https://tiles.example.org/v1' }, { host: 'osm', path: '/../v2/x', query: {}, method: 'GET' }), null);
  assert.equal(net.netUrl({ ...h, base: 'https://tiles.example.org/v1' }, { host: 'osm', path: 'x', query: {}, method: 'GET' }), null);

  const req = { host: 'osm', path: '/search', query: { q: 'Berlin' }, method: 'GET' as const };
  answer = false;
  assert.equal((await net.pluginFetch(m, req)).error, 'net-denied');
  assert.equal(asked, 1);
  assert.equal(net.netAllowed(m), false);
  assert.equal((await net.pluginFetch(m, req)).error, 'net-denied');
  assert.equal(asked, 1, 'the answer is kept');
  assert.equal(calls.length, 0);

  net.setNetAllowed(m, true);
  const ok = await net.pluginFetch(m, req);
  assert.equal(ok.status, 200);
  assert.equal(ok.type, 'json');
  assert.equal(JSON.parse(ok.text!)[0].name, 'Berlin');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://nominatim.openstreetmap.org/search?q=Berlin');
  assert.equal((await net.pluginFetch(m, req)).text, ok.text);
  assert.equal(calls.length, 1, 'answers are reused');
  assert.equal(net.netLog(m.id).at(-1)!.cached, true);

  // Another server list asks again
  const m2 = manifest(PLACE, { network: [{ ...OSM, base: 'https://photon.komoot.io' }] });
  assert.equal(net.netAllowed(m2), undefined);

  assert.equal((await net.pluginFetch(m, { ...req, host: 'other' })).error, 'net-unknown-host');
  assert.equal((await net.pluginFetch(m, { ...req, method: 'POST', body: 'x' })).error, 'net-method');
  net.setNetOff(true);
  assert.equal((await net.pluginFetch(m, { ...req, query: { q: 'Paris' } })).error, 'net-offline');
  net.setNetOff(false);

  reply = () => ({ status: 200, contentType: 'text/html', bytes: enc('<html>') });
  assert.equal((await net.pluginFetch(m, { ...req, query: { q: 'html' } })).error, 'net-type');
  reply = () => ({ status: 404, contentType: 'text/html', bytes: enc('<html>') });
  const nf = await net.pluginFetch(m, { ...req, query: { q: 'nothing' } });
  assert.equal(nf.status, 404);
  assert.equal(nf.error, 'net-status');
  reply = () => ({ status: 200, contentType: 'application/json', bytes: new Uint8Array(net.NET_LIMITS.maxBytes + 1) });
  assert.equal((await net.pluginFetch(m, { ...req, query: { q: 'big' } })).error, 'net-too-large');
  net.setNetTransport(async () => Promise.reject(new Error('net-local')));
  assert.equal((await net.pluginFetch(m, { ...req, query: { q: 'local' } })).error, 'net-local');
  net.setNetTransport(async () => Promise.reject(new TypeError('Failed to fetch')));
  assert.equal((await net.pluginFetch(m, { ...req, query: { q: 'down' } })).error, 'net-failed');
  net.setNetTransport(async (r) => {
    calls.push({ url: r.url, method: r.method });
    return reply(r.url);
  });
  assert.ok(net.netLog(m.id).length >= 9);
});

await test('net.ts: png data comes as base64, requests to one server are spaced by its rate', async () => {
  reset();
  const m = manifest(PLACE, { network: [{ ...OSM, types: ['png'], rate: 2 }] });
  net.setNetAllowed(m, true);
  reply = () => ({ status: 200, contentType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) });
  const t0 = Date.now();
  const rs = await Promise.all([1, 2, 3].map((i) => net.pluginFetch(m, { host: 'osm', path: `/t/${i}.png`, query: {}, method: 'GET' })));
  assert.equal(rs[0].data, 'iVBORw==');
  assert.ok(Date.now() - t0 >= 900, `three requests at 2 per second take a second, took ${Date.now() - t0} ms`);
});

await test('generator: a plugin asking for data is computed again with the answer, attribution is shown', async () => {
  reset();
  reply = () => ({ status: 200, contentType: 'application/json; charset=utf-8', bytes: enc('[{"name":"Berlin","size":20}]') });
  const m = manifest(PLACE);
  const g = pluginGenerator(m, { id: 'p', name: 'P' });
  const r = await buildGenAsync(g, normalizeParams(g, { ...defaultParams(g), q: 'Berlin' }));
  assert.equal(asked, 1, 'the user is asked before the first request');
  assert.equal(calls.length, 1);
  assert.deepEqual(r.info.at(-1), ['Data', '© OpenStreetMap contributors']);
  assert.equal(r.info[0][1], 'Berlin');
  assert.equal(r.parts[0].shape.subs[0].nodes[1].x, 20);
  // Denied: the plugin gets the error code; passed on, the app explains it
  reset();
  answer = false;
  const g2 = pluginGenerator(m, { id: 'p', name: 'P' });
  const r2 = await buildGenAsync(g2, normalizeParams(g2, { ...defaultParams(g2), q: 'Hamburg' }));
  assert.equal(r2.issues[0].code, 'net-denied');
  assert.ok(!/net-denied/.test(r2.issues[0].msg), `the app explains the code: ${r2.issues[0].msg}`);
  assert.equal(calls.length, 0);
  g.dispose();
  g2.dispose();
});

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
console.log('plugin network tests passed');
