// Real display/stream code with strict memory-only DOM and native boundaries.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let draws = 0, reads = 0, writes = 0;
class Canvas {
  width = 32; height = 18; isConnected = false; visible = true;
  getClientRects() { return this.visible ? [{}] : []; }
  getContext() { return {
    drawImage() { draws++; },
    getImageData(_x, _y, w, h) { reads++; return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { writes++; },
  }; }
}
class Video { videoWidth = 32; videoHeight = 18; pause() {} srcObject = null; }
const pulls = new Map();
let timer = 1, sequence = 0;
const calls = [];
globalThis.document = { hidden: false, createElement: (tag) => tag === 'video' ? new Video() : new Canvas() };
globalThis.HTMLVideoElement = Video;
globalThis.window = {
  setTimeout(fn) { const id = timer++; pulls.set(id, fn); return id; },
};
const clear = globalThis.clearTimeout;
globalThis.clearTimeout = (id) => { if (!pulls.delete(id)) clear(id); };
globalThis.createImageBitmap = async () => ({ width: 32, height: 18, close() {} });
globalThis.__previewMocks = {
  t: (key) => key, hasNative: () => true,
  native: async (command) => {
    calls.push(command);
    if (command === 'netcam_open') return 7;
    if (command === 'netcam_close') return;
    assert.equal(command, 'netcam_frame', 'No other native operation allowed');
    const data = new ArrayBuffer(9);
    new DataView(data).setBigUint64(0, BigInt(++sequence), true);
    return data;
  },
};
const bundle = await build({
  stdin: { contents: "export { CameraStream } from './src/camera'; export { drawCameraPreview, cameraImageIsIdentity } from './src/cameraDisplay';", resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'strict-native-boundaries', setup(b) {
    b.onResolve({ filter: /^\.\/(i18n|native)$/ }, (args) => ({ path: args.path, namespace: 'offline' }));
    b.onLoad({ filter: /.*/, namespace: 'offline' }, (args) => ({ loader: 'js', contents:
      `export const {${args.path === './i18n' ? 't' : 'native,hasNative'}} = globalThis.__previewMocks;` }));
  } }],
});
const { CameraStream, drawCameraPreview, cameraImageIsIdentity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const identity = { brightness: 1, contrast: 1, saturation: 1, gamma: 1, grayscale: false };
assert.ok(cameraImageIsIdentity(identity));
drawCameraPreview(new Canvas(), new Video(), identity);
assert.equal(draws, 1); assert.equal(reads, 0); assert.equal(writes, 0);
drawCameraPreview(new Canvas(), new Video(), { ...identity, brightness: 1.2 });
assert.equal(reads, 1); assert.equal(writes, 1);

draws = 0;
const stream = new CameraStream();
await stream.start('', 32, 18, 'http://memory.invalid');
assert.equal(draws, 0, 'Detached unused network canvas is not copied');
const canvas = stream.view;
assert.equal(draws, 1, 'Explicit detached consumer gets latest frame');
assert.equal(stream.view, canvas);
assert.equal(draws, 1, 'Repeated reads of same sequence do not copy');
const pull = async () => {
  const [id, fn] = pulls.entries().next().value;
  pulls.delete(id); await fn();
};
await pull(); assert.equal(draws, 1, 'New frame with no consumer does not copy');
void stream.view; assert.equal(draws, 2, 'Detached active consumer receives newer frame');
canvas.isConnected = true;
await pull(); assert.equal(draws, 3, 'Displayed raw canvas updates without getter');
canvas.visible = false;
await pull(); assert.equal(draws, 3, 'Hidden raw canvas does not copy');
canvas.visible = true; document.hidden = true;
await pull(); assert.equal(draws, 3, 'Background document does not copy');
document.hidden = false; canvas.isConnected = false;
stream.stop();
assert.equal(pulls.size, 0, 'Stop cancels network pull');
assert.ok(calls.includes('netcam_close'));
assert.equal(reads, 1, 'Stream preview never reads pixel data');
console.log('Camera previews: identity bypass, corrected pixels, demand-driven network canvas, visibility and stop cleanup passed (memory only).');
