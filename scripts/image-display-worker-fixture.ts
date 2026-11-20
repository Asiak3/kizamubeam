// Explicit synchronous worker adapter for the pre-existing synchronous render
// suites. Production and the async/real-worker suites never install this adapter.
import { ImageCache } from '../src/imageCache';
import { processEditedPixels, resample } from '../src/imagePixels';
import type { ImageDisplayRequest, ImageDisplayReply } from '../src/images';

export class SynchronousImageWorker {
  static processedJobs = 0;
  static paused = false;
  static pending: { worker: SynchronousImageWorker; request: ImageDisplayRequest }[] = [];
  private terminated = false;
  private jobs = new ImageCache<string, Uint8ClampedArray>(32 * 1024 * 1024, 4);
  onmessage: ((event: { data: ImageDisplayReply }) => void) | null = null;
  postMessage(input: ImageDisplayRequest) {
    const request = structuredClone(input);
    if (SynchronousImageWorker.paused) { SynchronousImageWorker.pending.push({ worker: this, request }); return; }
    this.compute(request);
  }
  private compute(request: ImageDisplayRequest) {
    if (this.terminated) return;
    let full = this.jobs.get(request.jobKey);
    if (!full) {
      SynchronousImageWorker.processedJobs++;
      full = processEditedPixels(request.source, request.shape, request.output, request.job.cols, request.job.rows, request.world);
      this.jobs.set(request.jobKey, full, full.byteLength);
    }
    const { cols, rows } = request.display;
    const values = cols === request.job.cols && rows === request.job.rows ? full.slice()
      : Uint8ClampedArray.from(resample(full, request.job.cols, request.job.rows, cols, rows));
    this.onmessage?.({ data: { id: request.id, values } });
  }
  static phase(phase: number) {
    const pending = this.pending[0];
    pending?.worker.onmessage?.({ data: { id: pending.request.id, phase } });
  }
  terminate() { this.terminated = true; }
}
(globalThis as any).Worker = SynchronousImageWorker;
// Sync seam for bundled Node tests, where `new URL('./imageDisplay.worker.ts',
// import.meta.url)` cannot resolve from a data: URL base. See createDisplayWorker.
(globalThis as any).__kizamubeamSyncDisplayWorker = () => new SynchronousImageWorker();
