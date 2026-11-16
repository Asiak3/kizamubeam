// Plugin Worker: one per plugin. Holds the engine and answers calls one at a time. The main thread terminates the
// Worker when a call takes too long (client.ts), which also stops WebAssembly that never returns.
import { createEngine, Engine, EngineError, type Runtime } from './engine';

export type WorkerRequest =
  | { seq: number; op: 'load'; runtime: Runtime; code: string | Uint8Array }
  | { seq: number; op: 'call'; fn: string; input: string; timeoutMs: number };
export type WorkerReply = { seq: number; out?: string; error?: string };

let engine: Engine | null = null;

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  try {
    if (m.op === 'load') {
      engine?.dispose();
      engine = await createEngine(m.runtime, m.code);
      (self as unknown as Worker).postMessage({ seq: m.seq, out: '' } satisfies WorkerReply);
    } else {
      if (!engine) throw new EngineError('plugin-not-loaded');
      (self as unknown as Worker).postMessage({ seq: m.seq, out: engine.call(m.fn, m.input, m.timeoutMs) } satisfies WorkerReply);
    }
  } catch (e) {
    const code = e instanceof EngineError ? e.message : `plugin-crash: ${String(e instanceof Error ? e.message : e)}`;
    (self as unknown as Worker).postMessage({ seq: m.seq, error: code } satisfies WorkerReply);
  }
};
