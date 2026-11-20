import type { ImageDisplayRequest, ImageDisplayReply } from './images';
import { ImageCache } from './imageCache';
import { ImageProcessingError, processEditedPixels, resample } from './imagePixels';

const jobs = new ImageCache<string, Uint8ClampedArray>(32 * 1024 * 1024, 4);
globalThis.onmessage = (event: MessageEvent<ImageDisplayRequest>) => {
  const request = event.data;
  const progress = (phase: number) => globalThis.postMessage({ id: request.id, phase } satisfies ImageDisplayReply);
  try {
    let full = jobs.get(request.jobKey);
    if (!full) {
      full = processEditedPixels(request.source, request.shape, request.output, request.job.cols, request.job.rows, request.world, progress);
      jobs.set(request.jobKey, full, full.byteLength);
    } else progress(3);
    const { cols, rows } = request.display;
    const values = cols === request.job.cols && rows === request.job.rows ? full.slice()
      : Uint8ClampedArray.from(resample(full, request.job.cols, request.job.rows, cols, rows));
    globalThis.postMessage({ id: request.id, values } satisfies ImageDisplayReply, { transfer: [values.buffer] });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    globalThis.postMessage({ id: request.id, error: {
      name: error.name, message: error.message, code: cause instanceof ImageProcessingError ? cause.code : undefined,
    } } satisfies ImageDisplayReply);
  }
};
