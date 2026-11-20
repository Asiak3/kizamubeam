import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
const bundle = async (entry) => {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'error' });
  for (const path of Object.keys(result.metafile.inputs)) assert.ok(!/src\/(?:images|native|i18n|machine|laser|camera)\.ts$/.test(path), `Worker must stay pure: ${path}`);
  return `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
};
const workerUrl = await bundle('src/imageDisplay.worker.ts');
const { processEditedPixels, resample } = await import(await bundle('src/imagePixels.ts'));
const worker = new Worker(`const { parentPort }=require('node:worker_threads');globalThis.postMessage=(message,options)=>parentPort.postMessage(message,options?.transfer);import(${JSON.stringify(workerUrl)}).then(()=>parentPort.on('message',data=>globalThis.onmessage({data})));`, { eval: true });
const phases = [];
let nextId = 0;
const request = (message) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const listener = (reply) => {
    if (reply.id !== id) return;
    if (reply.phase !== undefined) { phases.push(reply.phase); return; }
    worker.off('message', listener);
    worker.off('error', reject);
    if (reply.error) reject(new Error(reply.error.message)); else resolve(reply.values);
  };
  worker.on('message', listener); worker.once('error', reject);
  worker.postMessage({ ...message, id });
});
const source = { width: 101, height: 59, rgba: Uint8ClampedArray.from({ length: 101 * 59 * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % 101 % 2 ? 220 : 30)) };
const shape = { kind: 'image', asset: 'synthetic', w: 10.1, h: 5.9, pxW: 101, pxH: 59, adjust: { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, sharpenRadius: 1, denoise: 0 }, edit: { crop: { left: .001, top: 0, right: 1, bottom: 1 } } };
const world = [1.1, .2, -.15, .9, 17, 13], job = { cols: 150, rows: 72 }, display = { cols: 46, rows: 23 };
try {
  for (const dither of ['threshold', 'ordered', 'atkinson', 'floyd', 'stucki', 'jarvis', 'newsprint', 'halftone', 'sketch', 'grayscale']) {
    const output = { interval: .075, dither, negative: false, threshold: 128, cells: 50, angle: 45 };
    const full = processEditedPixels(source, shape, output, job.cols, job.rows, world);
    const expected = Uint8ClampedArray.from(resample(full, job.cols, job.rows, display.cols, display.rows));
    const actual = await request({ source, shape, output, world, job, display, jobKey: dither });
    assert.deepEqual(actual, expected, `${dither}: actual Worker output equals reduced full-job signal`);
  }
  assert.ok(phases.includes(1) && phases.includes(2) && phases.includes(3));
  assert.equal(source.rgba.byteLength, 101 * 59 * 4, 'original source was not detached');
  let ticks = 0, maxGap = 0, last = performance.now();
  const largeSource = { width: 1200, height: 800, rgba: new Uint8ClampedArray(1200 * 800 * 4).fill(128) };
  const heartbeat = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 10);
  const start = performance.now();
  const result = request({ source: largeSource, shape: { ...shape, pxW: 1200, pxH: 800 }, output: { interval: .075, dither: 'jarvis', negative: false, threshold: 128, cells: 50, angle: 45 }, world,
    job: { cols: 2500, rows: 1667 }, display: { cols: 300, rows: 201 }, jobKey: 'large' });
  const dispatchMs = performance.now() - start;
  await result; clearInterval(heartbeat);
  const elapsedMs = performance.now() - start;
  assert.ok(ticks > 5, 'main event loop remains responsive during full-job processing');
  worker.postMessage({ id: ++nextId, source: largeSource, shape: { ...shape, pxW: 1200, pxH: 800 },
    output: { interval: .075, dither: 'jarvis', negative: false, threshold: 128, cells: 50, angle: 45 }, world,
    job: { cols: 2500, rows: 1667 }, display, jobKey: 'cancel-inflight' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const cancelStart = performance.now(); await worker.terminate();
  const cancelMs = performance.now() - cancelStart;
  assert.ok(cancelMs < 100, 'expensive work can be cancelled without waiting for pixel processing');
  console.log(JSON.stringify({ actualWorkerModes: 10, jobPixels: 2500 * 1667, dispatchMs: +dispatchMs.toFixed(2), elapsedMs: +elapsedMs.toFixed(2), mainHeartbeatTicks: ticks, maxMainHeartbeatGapMs: +maxGap.toFixed(2), cancelMs: +cancelMs.toFixed(2) }));
} finally { await worker.terminate(); }
