// Plugin Worker: one per plugin. Holds the engine and answers calls one at a time. The main thread terminates the
// Worker when a call takes too long (client.ts), which also stops WebAssembly that never returns.
// Progress reports of a call (host.progress) are posted while it runs, at most a few per second.
import { createEngine, Engine, EngineError, type Runtime } from './engine';
import type { NetRequest } from './hostfns';

export type WorkerRequest =
  | { seq: number; op: 'load'; runtime: Runtime; code: string | Uint8Array; host?: string[] }
  | { seq: number; op: 'call'; fn: string; input: string; timeoutMs: number };
export type WorkerReply = { seq: number; out?: string; error?: string; progress?: number; text?: string; want?: NetRequest };

let engine: Engine | null = null;
/** The call running now (progress belongs to it) */
let current = 0;
let lastProgress = 0;
const PROGRESS_MS = 150;
const progress = (done: number, text?: string) => {
  const now = Date.now();
  if (now - lastProgress < PROGRESS_MS && done < 1) return;
  lastProgress = now;
  (self as unknown as Worker).postMessage({ seq: current, progress: done, ...(text !== undefined ? { text } : {}) } satisfies WorkerReply);
};

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  try {
    if (m.op === 'load') {
      engine?.dispose();
      engine = await createEngine(m.runtime, m.code, {
        host: m.host ?? [],
        onProgress: progress,
        // A data request goes to the app at once; the call then fails with net-pending
        onWant: (want) => (self as unknown as Worker).postMessage({ seq: current, want } satisfies WorkerReply),
      });
      (self as unknown as Worker).postMessage({ seq: m.seq, out: '' } satisfies WorkerReply);
    } else {
      if (!engine) throw new EngineError('plugin-not-loaded');
      current = m.seq;
      lastProgress = 0;
      (self as unknown as Worker).postMessage({ seq: m.seq, out: engine.call(m.fn, m.input, m.timeoutMs) } satisfies WorkerReply);
    }
  } catch (e) {
    const code = e instanceof EngineError ? e.message : `plugin-crash: ${String(e instanceof Error ? e.message : e)}`;
    (self as unknown as Worker).postMessage({ seq: m.seq, error: code } satisfies WorkerReply);
  }
};
