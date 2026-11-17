// Main-thread side of a plugin: starts its Worker, sends calls one at a time and enforces the time limit by
// terminating the Worker (it is started again for the next call). Answers come back as checked JSON values.
import { createEngine, Engine, EngineError, unwrap, type EngineOptions, type Runtime } from './engine';
import { LIMITS, type PluginFn } from './contract';
import type { WorkerReply, WorkerRequest } from './worker';
import type { NetRequest } from './hostfns';

export interface PluginProcess {
  /** Call a plugin function; rejects with EngineError (code: plugin-timeout, plugin-crash, or the plugin's own code) */
  call(fn: PluginFn, input: unknown): Promise<unknown>;
  /**
   * Data a parameter refers to (a 3D model): handed to the plugin's `resource` function before the next call, and
   * again after the plugin was restarted. The newest few are kept.
   */
  setResource(r: PluginResource): void;
  /** Progress of the call running now (the plugin reports it with host.progress) */
  onProgress?: (done: number, text?: string) => void;
  /** A data request of host.fetch (#280): the app fetches it and hands the answer over as a resource of kind net */
  onWant?: (r: NetRequest) => void;
  /** Stop the running call (and those waiting): they fail with plugin-cancelled; the next call starts afresh */
  cancel(): void;
  dispose(): void;
}

export interface PluginResource {
  kind: string;
  id: string;
  data: string;
}

/** Resources a process keeps for restarts (fetched responses apart); older ones are handed again only when set again */
const KEEP_RESOURCES = 4;
const KEEP_NET = 24;

/** The resources of one process and which of them the running engine already has */
function resourceSet() {
  const all = new Map<string, PluginResource>();
  let sent = new Set<string>();
  return {
    set(r: PluginResource) {
      const k = `${r.kind}:${r.id}`;
      all.delete(k);
      all.set(k, r);
      for (const net of [false, true]) {
        const keys = [...all.keys()].filter((x) => x.startsWith('net:') === net);
        for (const x of keys.slice(0, Math.max(0, keys.length - (net ? KEEP_NET : KEEP_RESOURCES)))) all.delete(x);
      }
    },
    /** Resources the engine does not have yet; marked as sent */
    pending(): PluginResource[] {
      const out = [...all].filter(([k]) => !sent.has(k));
      for (const [k] of out) sent.add(k);
      return out.map(([, r]) => r);
    },
    /** A new engine has none */
    reset: () => void (sent = new Set()),
  };
}

/** A plugin without a resource function simply does not use resources */
const noResourceFn = (e: unknown) => e instanceof EngineError && e.code === 'plugin-no-function';

type Pending = { req: WorkerRequest; resolve: (r: WorkerReply) => void };

/** Worker replies carry "code" or "code: detail" */
function replyError(msg: string): EngineError {
  const i = msg.indexOf(':');
  return i < 0 ? new EngineError(msg) : new EngineError(msg.slice(0, i), msg.slice(i + 1).trim());
}

/** Run a plugin in its own Worker (the app) */
export function workerProcess(runtime: Runtime, code: string | Uint8Array, host: string[] = []): PluginProcess {
  let worker: Worker | null = null;
  let loaded: Promise<void> | null = null;
  let seq = 0;
  const pending = new Map<number, Pending>();
  let chain: Promise<unknown> = Promise.resolve();
  const resources = resourceSet();

  const start = () => {
    resources.reset();
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      if (ev.data.want !== undefined) {
        if (pending.has(ev.data.seq)) proc.onWant?.(ev.data.want);
        return;
      }
      if (ev.data.progress !== undefined) {
        if (pending.has(ev.data.seq)) proc.onProgress?.(ev.data.progress, ev.data.text);
        return;
      }
      const p = pending.get(ev.data.seq);
      if (p) (pending.delete(ev.data.seq), p.resolve(ev.data));
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      kill('plugin-crash');
    };
    loaded = send({ seq: ++seq, op: 'load', runtime, code, host }, 30_000).then((r) => {
      if (r.error) throw replyError(r.error);
    });
    loaded.catch(() => kill('plugin-crash'));
  };
  const kill = (code: string) => {
    worker?.terminate();
    worker = null;
    loaded = null;
    for (const p of pending.values()) p.resolve({ seq: p.req.seq, error: code });
    pending.clear();
  };
  const send = (req: WorkerRequest, ms: number) =>
    new Promise<WorkerReply>((resolve) => {
      const timer = setTimeout(() => kill('plugin-timeout'), ms);
      pending.set(req.seq, { req, resolve: (r) => (clearTimeout(timer), resolve(r)) });
      worker!.postMessage(req);
    });

  const proc: PluginProcess = {
    call(fn, input) {
      // One call at a time per plugin; a timed-out call restarts the Worker for the next one
      const one = async (f: PluginFn, inp: unknown) => {
        if (!worker) start();
        await loaded;
        const ms = LIMITS.callMs[f];
        const r = await send({ seq: ++seq, op: 'call', fn: f, input: JSON.stringify(inp), timeoutMs: ms }, ms + 500);
        if (r.error) {
          const err = replyError(r.error);
          // A Worker whose engine ran out of memory or crashed is not trusted for the next call
          if (err.code === 'plugin-memory' || err.code === 'plugin-crash') kill(err.code);
          throw err;
        }
        return unwrap(r.out ?? '');
      };
      const run = async () => {
        if (!worker) start();
        for (const res of resources.pending()) await one('resource', res).catch((e) => { if (!noResourceFn(e)) throw e; });
        return one(fn, input);
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    },
    setResource: (r) => resources.set(r),
    cancel: () => {
      if (pending.size) kill('plugin-cancelled');
    },
    dispose: () => kill('plugin-disposed'),
  };
  return proc;
}

/** Run a plugin in the current thread (Node tests, headless runner); same answers, no hard time limit for WebAssembly */
export function inProcess(runtime: Runtime, code: string | Uint8Array, host: string[] = []): PluginProcess {
  let engine: Promise<Engine> | null = null;
  const resources = resourceSet();
  const opts: EngineOptions = { host, onProgress: (done, text) => proc.onProgress?.(done, text), onWant: (r) => proc.onWant?.(r) };
  const proc: PluginProcess = {
    async call(fn, input) {
      if (!engine) resources.reset();
      const e = await (engine ??= createEngine(runtime, code, opts));
      try {
        for (const res of resources.pending()) {
          try {
            unwrap(e.call('resource', JSON.stringify(res), LIMITS.callMs.resource));
          } catch (x) {
            if (!noResourceFn(x)) throw x;
          }
        }
        return unwrap(e.call(fn, JSON.stringify(input), LIMITS.callMs[fn]));
      } catch (x) {
        if (x instanceof EngineError && (x.code === 'plugin-memory' || x.code === 'plugin-crash')) engine = null;
        throw x;
      }
    },
    setResource: (r) => resources.set(r),
    // The current thread cannot be interrupted; a call here always runs to its end or its time limit
    cancel() {},
    dispose() {
      engine?.then((e) => e.dispose());
      engine = null;
    },
  };
  return proc;
}
