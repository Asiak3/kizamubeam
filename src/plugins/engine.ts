// The two plugin runtimes (issue #205): JavaScript in QuickJS compiled to WebAssembly, and WebAssembly modules
// instantiated without imports. Both get JSON in and give JSON out; neither can reach files, network, the DOM or
// Tauri. Runs inside the plugin Worker (worker.ts) and in Node tests.
//
// Answer envelope of every call: {"ok": result} or {"error": "code"}.
//
// WebAssembly ABI (version 1), all integers u32 unless noted:
//   export memory
//   export kzb_api() -> i32                 protocol version, must be 1
//   export kzb_alloc(len) -> ptr            buffer for the host to write into
//   export kzb_call(fn_ptr, fn_len, in_ptr, in_len) -> i64
//                                           UTF-8 function name and JSON input; result = (ptr << 32) | len of the
//                                           UTF-8 JSON envelope, valid until the next call
//   import kzb.host_call(name_ptr, name_len, in_ptr, in_len) -> i64   (optional, the only import allowed)
//                                           a host function (hostfns.ts) with JSON input; result packed like
//                                           kzb_call, an envelope in a buffer from kzb_alloc
// JavaScript: the script sets globalThis.plugin = { validate(params), generate(params), … }; an Error thrown with a
// code as message becomes {"error": code}. Host functions are globalThis.host.boolean(…), .offset, .fit, .trace and
// .progress(done, text); they throw an Error with the code on failure.
import type { QuickJSContext, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';
import { LIMITS, PLUGIN_API } from './contract';
import { HOST_FNS, hostCaller, type NetRequest } from './hostfns';

/** What an engine may use besides the plugin code: host functions its manifest names, and where progress goes */
export interface EngineOptions {
  host?: readonly string[];
  onProgress?: (done: number, text?: string) => void;
  /** A data request of host.fetch the app has not answered yet (#280) */
  onWant?: (r: NetRequest) => void;
}

export interface Engine {
  /** Call a plugin function: JSON input in, JSON envelope out. Throws on a crash or timeout. */
  call(fn: string, input: string, timeoutMs: number): string;
  dispose(): void;
}

export type Runtime = 'js' | 'wasm';

export class EngineError extends Error {
  constructor(public code: string, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
  }
}

const FN = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;

let quickjs: Promise<QuickJSWASMModule> | null = null;
let quickjsWasm: ArrayBuffer | undefined;
/** The QuickJS .wasm itself (Node tests and bundles where the package cannot find its file next to itself) */
export function setQuickJSWasm(bytes: ArrayBuffer) {
  quickjsWasm = bytes;
  quickjs = null;
}
/** QuickJS is loaded once per Worker; the variant brings its own .wasm file */
function loadQuickJS(): Promise<QuickJSWASMModule> {
  return (quickjs ??= (async () => {
    const [{ newQuickJSWASMModuleFromVariant, newVariant }, variant] = await Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-wasmfile-release-sync')]);
    return newQuickJSWASMModuleFromVariant(quickjsWasm ? newVariant(variant.default, { wasmBinary: quickjsWasm }) : variant.default);
  })());
}

export async function createJsEngine(source: string, opts: EngineOptions = {}): Promise<Engine> {
  if (source.length > LIMITS.codeBytes) throw new EngineError('plugin-too-large');
  const QJ = await loadQuickJS();
  const rt: QuickJSRuntime = QJ.newRuntime();
  rt.setMemoryLimit(LIMITS.memoryBytes);
  rt.setMaxStackSize(4 * 1024 * 1024);
  let deadline = Date.now() + 5000;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const ctx: QuickJSContext = rt.newContext();
  const run = (code: string, name: string): string => {
    const r = ctx.evalCode(code, name);
    if (r.error) {
      const e = ctx.dump(r.error) as { message?: string; name?: string } | string;
      r.error.dispose();
      const msg = typeof e === 'string' ? e : (e?.message ?? String(e));
      if (/interrupted/i.test(msg)) throw new EngineError('plugin-timeout');
      if (/out of memory/i.test(msg)) throw new EngineError('plugin-memory');
      throw new EngineError('plugin-crash', msg);
    }
    const out = ctx.typeof(r.value) === 'string' ? ctx.getString(r.value) : '';
    r.value.dispose();
    return out;
  };
  // QuickJS seeds Math.random from a clock with millisecond steps, so engines started in the same millisecond
  // would give the same numbers; seed every engine from the host's random source instead (xorshift128+)
  const seed = crypto.getRandomValues(new Uint32Array(4));
  run(
    `(() => { let a = ${seed[0] | 1}, b = ${seed[1]}, c = ${seed[2]}, d = ${seed[3]};
      Math.random = () => { let t = a ^ (a << 11); a = b; b = c; c = d; d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) | 0;
        return ((d >>> 0) + ((c >>> 0) & 0x1fffff) * 4294967296) / 9007199254740992; }; })();`,
    'seed.js',
  );
  // Host functions before the plugin code, so it may keep a reference; the raw bridge is removed again
  const caller = hostCaller(opts.host ?? [], opts.onProgress, opts.onWant);
  const bridge = ctx.newFunction('__kzbHost', (n, j) => ctx.newString(caller(ctx.getString(n), ctx.getString(j))));
  ctx.setProp(ctx.global, '__kzbHost', bridge);
  bridge.dispose();
  run(
    `globalThis.host = (() => {
      const h = globalThis.__kzbHost;
      delete globalThis.__kzbHost;
      const call = (n, x) => { const r = JSON.parse(h(n, JSON.stringify(x === undefined ? null : x))); if (r.error) throw new Error(r.error); return r.ok; };
      const fns = { progress: (done, text) => call('progress', text === undefined ? done : { done, text }) };
      for (const n of ${JSON.stringify(HOST_FNS)}) fns[n] = (x) => call(n, x);
      return Object.freeze(fns);
    })();`,
    'bridge.js',
  );
  // The envelope wrapper is fixed app code; the plugin only provides globalThis.plugin
  run(source, 'plugin.js');
  run(
    `globalThis.__kzbCall = (fn, input) => {
      const p = globalThis.plugin;
      if (!p || typeof p[fn] !== 'function') return JSON.stringify({ error: 'plugin-no-function' });
      try { return JSON.stringify({ ok: p[fn](JSON.parse(input)) }); }
      catch (e) { if (typeof InternalError !== 'undefined' && e instanceof InternalError) throw e; return JSON.stringify({ error: String(e && e.message !== undefined ? e.message : e) }); }
    };`,
    'host.js',
  );
  return {
    call(fn, input, timeoutMs) {
      if (!FN.test(fn)) throw new EngineError('plugin-no-function');
      deadline = Date.now() + timeoutMs;
      // A fetched response is for host.fetch only
      if (fn === 'resource' && caller.resource(input)) return JSON.stringify({ ok: null });
      const s = ctx.newString(input);
      ctx.setProp(ctx.global, '__kzbIn', s);
      s.dispose();
      return run(`globalThis.__kzbCall(${JSON.stringify(fn)}, globalThis.__kzbIn)`, 'call.js');
    },
    dispose() {
      ctx.dispose();
      rt.dispose();
    },
  };
}

export async function createWasmEngine(bytes: Uint8Array, opts: EngineOptions = {}): Promise<Engine> {
  if (bytes.length > LIMITS.codeBytes) throw new EngineError('plugin-too-large');
  let mod: WebAssembly.Module;
  try {
    mod = await WebAssembly.compile(bytes as BufferSource);
  } catch (e) {
    throw new EngineError('plugin-bad-code', String(e));
  }
  // Pure computation only: a module that wants anything from outside but the host functions is refused
  const imports = WebAssembly.Module.imports(mod);
  const foreign = imports.filter((i) => !(i.module === 'kzb' && i.name === 'host_call' && i.kind === 'function'));
  if (foreign.length) throw new EngineError('plugin-imports', foreign.map((i) => `${i.module}.${i.name}`).join(', '));
  const caller = hostCaller(opts.host ?? [], opts.onProgress, opts.onWant);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const hostCall = (np: number, nl: number, ip: number, il: number): bigint => {
    const mem = new Uint8Array(ex.memory!.buffer);
    if (np + nl > mem.length || ip + il > mem.length || nl > 64) throw new EngineError('plugin-crash', 'host_call out of bounds');
    const name = dec.decode(mem.slice(np, np + nl)), input = dec.decode(mem.slice(ip, ip + il));
    const out = enc.encode(caller(name, input));
    const ptr = put(out);
    return (BigInt(ptr) << 32n) | BigInt(out.length);
  };
  const inst = await WebAssembly.instantiate(mod, imports.length ? { kzb: { host_call: hostCall } } : {});
  const ex = inst.exports as {
    memory?: WebAssembly.Memory;
    kzb_api?: () => number;
    kzb_alloc?: (len: number) => number;
    kzb_call?: (fp: number, fl: number, ip: number, il: number) => bigint;
  };
  if (!ex.memory || !ex.kzb_alloc || !ex.kzb_call) throw new EngineError('plugin-bad-code', 'missing exports');
  const api = ex.kzb_api?.() ?? 0;
  if (api > PLUGIN_API) throw new EngineError('plugin-newer-api');
  if (api < 1) throw new EngineError('plugin-bad-code', `api ${api}`);
  const put = (b: Uint8Array): number => {
    const ptr = ex.kzb_alloc!(b.length) >>> 0;
    new Uint8Array(ex.memory!.buffer, ptr, b.length).set(b);
    return ptr;
  };
  return {
    call(fn, input) {
      if (!FN.test(fn)) throw new EngineError('plugin-no-function');
      if (fn === 'resource' && caller.resource(input)) return JSON.stringify({ ok: null });
      const f = enc.encode(fn), i = enc.encode(input);
      let packed: bigint;
      try {
        const fp = put(f), ip = put(i);
        packed = ex.kzb_call!(fp, f.length, ip, i.length);
      } catch (e) {
        throw new EngineError('plugin-crash', String(e));
      }
      if (ex.memory!.buffer.byteLength > LIMITS.memoryBytes) throw new EngineError('plugin-memory');
      const ptr = Number(BigInt.asUintN(64, packed) >> 32n), len = Number(BigInt.asUintN(32, packed));
      if (len > LIMITS.outputBytes || ptr + len > ex.memory!.buffer.byteLength) throw new EngineError('plugin-bad-output', 'result out of bounds');
      return dec.decode(new Uint8Array(ex.memory!.buffer, ptr, len));
    },
    dispose() {},
  };
}

export const createEngine = (runtime: Runtime, code: string | Uint8Array, opts: EngineOptions = {}): Promise<Engine> =>
  runtime === 'js'
    ? createJsEngine(typeof code === 'string' ? code : new TextDecoder().decode(code), opts)
    : createWasmEngine(typeof code === 'string' ? base64ToBytes(code) : code, opts);

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse an answer envelope; errors become EngineError with the plugin's code */
export function unwrap(json: string): unknown {
  if (json.length > LIMITS.outputBytes) throw new EngineError('plugin-bad-output', 'too large');
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new EngineError('plugin-bad-output', 'not JSON');
  }
  if (!v || typeof v !== 'object') throw new EngineError('plugin-bad-output', 'no envelope');
  const e = v as { ok?: unknown; error?: unknown };
  if (e.error !== undefined) throw new EngineError(typeof e.error === 'string' ? e.error.slice(0, 80) : 'plugin-error');
  if (!('ok' in e)) throw new EngineError('plugin-bad-output', 'no envelope');
  return e.ok;
}
