import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const workers = [];
let constructionError = false;
class WorkerStub {
  constructor(url, options) {
    if (constructionError) throw new Error('Worker blocked');
    assert.ok(url.pathname.endsWith('/slotPreview.worker.ts'));
    assert.equal(options.type, 'module');
    this.messages = []; this.terminated = false; workers.push(this);
  }
  postMessage(message) { if (this.postError) throw new Error('Cannot post'); this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(id, extra = {}) { this.onmessage({ data: { id, ...extra } }); }
}
globalThis.Worker = WorkerStub;
globalThis.document = { documentElement: {} };
globalThis.localStorage = { getItem: () => 'en' };
const clientBundle = await build({
  entryPoints: ['src/slotPreviewClient.ts'], bundle: true, write: false, format: 'esm', platform: 'browser',
});
// Give import.meta.url a real base for the production Worker URL expression.
const source = clientBundle.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify('file:///src/slotPreviewClient.ts'));
const { createSlotPreviewClient } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const recipe = { source: {}, base: [], slots: [] };
const replies = [];
const client = createSlotPreviewClient();
const shownIds = ['projected'];
client.request(recipe, 30, r => replies.push(r), shownIds);
shownIds.length = 0;
const worker = workers.at(-1);
assert.deepEqual(worker.messages[0].visibleSlotIds, ['projected'], 'Visibility is captured with the recipe, not shared with future UI edits');
client.request(recipe, 40, r => replies.push(r));
client.request(recipe, 50, r => replies.push(r));
recipe.slots.push({ id: 'later' });
assert.equal(worker.messages.length, 1);
worker.reply(999);
assert.equal(worker.messages.length, 1);
worker.reply(1);
assert.deepEqual(worker.messages.map(m => m.id), [1, 3]);
assert.equal(worker.messages[1].recipe.slots.length, 0);
assert.equal(replies.length, 0);
worker.reply(1);
worker.reply(3, { error: 'Invalid geometry' });
assert.deepEqual(replies, [{ id: 3, error: 'Invalid geometry' }]);
client.request(recipe, 60, r => replies.push(r));
client.request(recipe, 70, r => replies.push(r));
worker.onerror({ message: 'Worker crashed', preventDefault() {} });
assert.ok(worker.terminated);
assert.equal(replies.at(-1).id, 5);
assert.match(replies.at(-1).error, /reopen.*Worker crashed/);
client.request(recipe, 80, r => replies.push(r));
assert.equal(replies.at(-1).id, 6);
client.dispose();
const count = replies.length;
worker.reply(5); client.request(recipe, 90, r => replies.push(r));
assert.equal(replies.length, count);
constructionError = true;
const blocked = createSlotPreviewClient();
blocked.request(recipe, 30, r => assert.match(r.error, /Worker blocked/));
blocked.dispose(); constructionError = false;
const posting = createSlotPreviewClient();
posting.request(recipe, 30, () => assert.fail('Superseded callback'));
const postWorker = workers.at(-1); postWorker.postError = true;
posting.request(recipe, 30, r => assert.match(r.error, /Cannot post/));
postWorker.reply(1); assert.ok(postWorker.terminated); posting.dispose();
const disposed = createSlotPreviewClient();
disposed.request(recipe, 30, () => assert.fail('Disposed callback'));
const disposedWorker = workers.at(-1); disposed.dispose(); disposedWorker.reply(1);
assert.ok(disposedWorker.terminated);

// Run the actual bundled worker in an isolated worker-like global, without DOM/native shims.
const workerBundle = await build({ entryPoints: ['src/slotPreview.worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', metafile: true });
assert.ok(!Object.keys(workerBundle.metafile.inputs).some(p => /(?:native|machine|laser)\.ts$|@tauri-apps/.test(p)), 'Worker must not import hardware/native modules');
const output = [];
const context = vm.createContext({ postMessage: reply => output.push(structuredClone(reply)), console });
vm.runInContext(workerBundle.outputFiles[0].text, context);
const base = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] }];
await context.onmessage({ data: { id: 7, recipe: { source: {}, base, slots: [] }, cornerAngle: 30, lang: 'en' } });
assert.equal(output[0].id, 7);
assert.equal(output[0].error, undefined);
assert.equal(output[0].result.edges.length, 4);
assert.equal(output[0].result.vertices.length, 4);
const slot = {
  id: 'projected', x: -100, y: -100, angle: 0, width: 4, depth: 5, clearance: 0, factor: 1,
  projection: { edge: output[0].result.edges[0].key, origin: { kind: 'vertex', sub: 0, node: 0 }, target: 'start', distance: 5, direction: 1, cornerAngle: 30 },
};
await context.onmessage({ data: { id: 9, recipe: { source: {}, base, slots: [slot] }, cornerAngle: 30, lang: 'en' } });
assert.equal(output[1].error, undefined);
assert.equal(output[1].result.slots[0].x, 0, 'Resolved x/y contain the projection origin, not stale recipe coordinates');
assert.equal(output[1].result.slots[0].y, 0);
assert.ok(output[1].result.subs.length);
await context.onmessage({ data: { id: 8, recipe: { source: {}, base, slots: [] }, cornerAngle: 0, lang: 'en' } });
assert.equal(output[2].id, 8); assert.ok(output[2].error);
// Feature settings, not the legacy request fallback, govern all recognition.
const featureRecipe = { source: {}, base, slots: [slot], settings: { cornerAngle: 45 }, helpers: [{
  id: 'mid', first: { kind: 'vertex', sub: 0, node: 0 }, second: { kind: 'vertex', sub: 0, node: 2 }, edge: '0:0:0',
}] };
await context.onmessage({ data: { id: 10, recipe: featureRecipe, cornerAngle: 0, lang: 'en' } });
assert.equal(output[3].error, undefined);
assert.equal(output[3].result.slots[0].projection.cornerAngle, 45);
assert.equal(output[3].result.helpers.length, 1);
assert.equal(output[3].result.helpers[0].point.x, 20);
assert.equal(output[3].result.helpers[0].intersections.length, 2);
assert.ok(output[3].result.helpers[0].intersections.every(i => i.origin.helperId === 'mid'));
featureRecipe.slots.push({ ...slot, id: 'reflected', projection: undefined, mirror: { slotId: 'projected', axis: { kind: 'helper', helperId: 'mid' } } });
await context.onmessage({ data: { id: 11, recipe: featureRecipe, cornerAngle: 30, lang: 'en', visibleSlotIds: [] } });
assert.equal(output[4].error, undefined);
const reflectedFrame = output[4].result.frames.find(f => f.id === 'reflected').frame;
assert.equal(reflectedFrame.a.x, 35, 'Semantic reflected start survives the structured-clone worker boundary');
assert.equal(reflectedFrame.b.x, 31);
assert.equal(reflectedFrame.edge.tangent.x, -1);
assert.equal(output[4].result.slots.length, 2, 'Hiding geometry never removes dependency resolution');
assert.equal(output[4].result.subs[0].nodes.length, 4, 'All cutters hidden: preview contains original rectangle');
featureRecipe.slots[1].mirror.slotId = 'missing';
await context.onmessage({ data: { id: 12, recipe: featureRecipe, cornerAngle: 30, lang: 'en', visibleSlotIds: [] } });
assert.ok(output[5].error, 'Hidden geometry cannot conceal an invalid mirror dependency');
console.log('Slot preview: coalescing, stale replies, snapshots, errors, disposal and worker bootstrap passed (no hardware).');
