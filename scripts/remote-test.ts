// Tests for job bundles of the remote KizamuBeam (issue #188). Run: npm run test:remote
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const { defaultImageLayer, defaultLayer, newDoc } = await import('../src/model');
const { bundleFonts, bytesToBase64, docImgLayer, docLayer, fontsUsed, openBundle, REMOTE_PROTO, sourceProject } = await import('../src/remoteBundle');
type Obj = import('../src/model').Obj;

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
const text = (id: number, font: string, bold = false, italic = false): Obj =>
  ({ id, layer: 0, m: IDENT, shape: { kind: 'text', text: 'A', font, size: 5, bold, italic, hSpace: 0, vSpace: 0, align: 'left', upper: false } }) as unknown as Obj;
const rect = (id: number, layer: number): Obj =>
  ({ id, layer, m: IDENT, shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] } }) as unknown as Obj;
const image = (id: number, layer: number, asset: string): Obj =>
  ({ id, layer, m: IDENT, shape: { kind: 'image', asset, w: 10, h: 10, pxW: 10, pxH: 10 } }) as unknown as Obj;

test('Protocol version matches the Rust side', () => {
  const rs = readFileSync(new URL('../src-tauri/src/remote.rs', import.meta.url), 'utf8');
  assert.equal(Number(/pub const PROTO: u64 = (\d+);/.exec(rs)?.[1]), REMOTE_PROTO);
});

test('Fonts of text objects, each style once, also inside groups', () => {
  const group = { id: 9, layer: 0, m: IDENT, shape: { kind: 'group', children: [text(3, 'Roboto'), text(4, 'Roboto', true)] } } as unknown as Obj;
  const f = fontsUsed([text(1, 'Roboto'), text(2, 'Arial', false, true), rect(5, 1), group]);
  assert.deepEqual(f, [
    { family: 'Roboto', bold: false, italic: false },
    { family: 'Arial', bold: false, italic: true },
    { family: 'Roboto', bold: true, italic: false },
  ]);
});

test('Job document from a tool: current page, used layers with image settings, images', () => {
  const d = newDoc();
  d.pages[0].objs.push(rect(1, 2), image(2, 3, 'img-a'));
  const layers = new Map([[2, { ...defaultLayer(2), speed: 1234 }], [3, defaultLayer(3)]]);
  const json = sourceProject(d, (i) => layers.get(i)!, () => ({ ...defaultImageLayer(), dpi: 317 }), (id) => (id === 'img-a' ? 'data:image/png;base64,AAAA' : null));
  const raw = JSON.parse(json);
  assert.deepEqual(Object.keys(raw.layers).sort(), ['2', '3']);
  assert.equal(raw.layers['2'].speed, 1234);
  assert.equal(raw.layers['3'].img.dpi, 317);
  assert.equal(raw.layers['2'].img, undefined);
  assert.deepEqual(raw.assets, { 'img-a': 'data:image/png;base64,AAAA' });
  // the tool's layer objects are not changed
  assert.equal(layers.get(3)!.img, undefined);

  const back = openBundle({ name: 'Test', project: json, only: null, fonts: [], app: '' });
  assert.equal(back.doc.objs.length, 2);
  assert.equal(back.only, null);
  assert.deepEqual(back.assets, { 'img-a': 'data:image/png;base64,AAAA' });
  assert.equal(docLayer(back.doc)(2).speed, 1234);
  assert.equal(docImgLayer(back.doc)(3).dpi, 317);
  // unused layers get defaults
  assert.equal(docLayer(back.doc)(7).speed, defaultLayer(7).speed);
});

test('"Selection only" picks the sent top-level objects of the current page', () => {
  const d = newDoc();
  d.pages[0].objs.push(rect(1, 0), rect(2, 0), rect(3, 1));
  d.pages.push({ name: 'Seite 2', objs: [rect(4, 0)] });
  const project = JSON.stringify(d);
  const b = openBundle({ name: 'x', project, only: [3, 1, 4], fonts: [], app: '' });
  assert.deepEqual(b.only!.map((o) => o.id), [1, 3]);
});

test('Broken bundles are refused', () => {
  assert.throws(() => openBundle({ name: 'x', project: '{nope', only: null, fonts: [], app: '' }));
  assert.throws(() => openBundle(null as never));
  assert.throws(() => openBundle({ name: 'x', project: '"text"', only: null, fonts: [], app: '' }));
});

test('Font files are decoded; missing ones are listed', () => {
  const bytes = new Uint8Array([0, 1, 0, 0, 7, 8, 255]);
  const r = bundleFonts({
    name: 'x', project: '{}', only: null, app: '',
    fonts: [
      { family: 'Roboto', bold: false, italic: false, data: bytesToBase64(bytes) },
      { family: 'Gone', bold: true, italic: false, data: null },
      { family: 'Broken', bold: false, italic: false, data: '***' },
    ],
  });
  assert.equal(r.files.length, 1);
  assert.deepEqual([...new Uint8Array(r.files[0].buf)], [...bytes]);
  assert.deepEqual(r.missing.map((m) => m.family), ['Gone', 'Broken']);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
