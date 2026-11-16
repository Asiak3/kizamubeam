// Main-thread side of a plugin: starts its Worker, sends calls one at a time and enforces the time limit by
// terminating the Worker (it is started again for the next call). Answers come back as checked JSON values.
import { createEngine, Engine, EngineError, unwrap, type Runtime } from './engine';
import { LIMITS, type PluginFn } from './contract';
import type { WorkerReply, WorkerRequest } from './worker';

export interface PluginProcess {
  /** Call a plugin function; rejects with EngineError (code: plugin-timeout, plugin-crash, or the plugin's own code) */
  call(fn: PluginFn, input: unknown): Promise<unknown>;
  dispose(): void;
}

type Pending = { req: WorkerRequest; resolve: (r: WorkerReply) => void };

/** Worker replies carry "code" or "code: detail" */
function replyError(msg: string): EngineError {
  const i = msg.indexOf(':');
  return i < 0 ? new EngineError(msg) : new EngineError(msg.slice(0, i), msg.slice(i + 1).trim());
}

/** Run a plugin in its own Worker (the app) */
export function workerProcess(runtime: Runtime, code: string | Uint8Array): PluginProcess {
  let worker: Worker | null = null;
  let loaded: Promise<void> | null = null;
  let seq = 0;
  const pending = new Map<number, Pending>();
  let chain: Promise<unknown> = Promise.resolve();

  const start = () => {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const p = pending.get(ev.data.seq);
      if (p) (pending.delete(ev.data.seq), p.resolve(ev.data));
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      kill('plugin-crash');
    };
    loaded = send({ seq: ++seq, op: 'load', runtime, code }, 30_000).then((r) => {
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

  return {
    call(fn, input) {
      // One call at a time per plugin; a timed-out call restarts the Worker for the next one
      const run = async () => {
        if (!worker) start();
        await loaded;
        const ms = LIMITS.callMs[fn];
        const r = await send({ seq: ++seq, op: 'call', fn, input: JSON.stringify(input), timeoutMs: ms }, ms + 500);
        if (r.error) {
          const err = replyError(r.error);
          // A Worker whose engine ran out of memory or crashed is not trusted for the next call
          if (err.code === 'plugin-memory' || err.code === 'plugin-crash') kill(err.code);
          throw err;
        }
        return unwrap(r.out ?? '');
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    },
    dispose: () => kill('plugin-disposed'),
  };
}

/** Run a plugin in the current thread (Node tests, headless runner); same answers, no hard time limit for WebAssembly */
export function inProcess(runtime: Runtime, code: string | Uint8Array): PluginProcess {
  let engine: Promise<Engine> | null = null;
  return {
    async call(fn, input) {
      const e = await (engine ??= createEngine(runtime, code));
      try {
        return unwrap(e.call(fn, JSON.stringify(input), LIMITS.callMs[fn]));
      } catch (x) {
        if (x instanceof EngineError && (x.code === 'plugin-memory' || x.code === 'plugin-crash')) engine = null;
        throw x;
      }
    },
    dispose() {
      engine?.then((e) => e.dispose());
      engine = null;
    },
  };
}
