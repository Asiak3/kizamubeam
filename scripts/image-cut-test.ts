import { strict as assert } from 'node:assert';
import {
  assignImageContour, expandImageCutSelection, imageCutSettings,
  resolveImageCutPath, unassignImageContour,
} from '../src/imageCut';
import { cloneObjs, defaultCutSettings, type ImageLayer, type Obj, type Pt } from '../src/model';
import { IDENT, apply, type Mat } from '../src/mat';
import { resolveImageContour } from '../src/imageContour';

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`ok ${checks} - ${name}`);
};
const near = (a: number, b: number, eps = 1e-7) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const samePt = (a: Pt, b: Pt, eps = 1e-7) => { near(a.x, b.x, eps); near(a.y, b.y, eps); };
let nextId = 1;
const imageObj = (m: Mat = IDENT): Obj => ({ id: nextId++, m, layer: 0,
  shape: { kind: 'image', asset: 'original', w: 100, h: 60, pxW: 100, pxH: 60,
    adjust: {} as ImageShapeAdjust } });
type ImageShapeAdjust = Extract<Obj['shape'], { kind: 'image' }>['adjust'];
const pathObj = (pts: Pt[]): Obj => ({ id: nextId++, m: IDENT, layer: 0,
  shape: { kind: 'path', subs: [{ nodes: pts.map(p => ({ ...p })), closed: true }] } });
const localPts: Pt[] = [{ x: 10, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 45 }, { x: 10, y: 45 }];
const W: Mat = [1.1, 0.35, -0.2, 0.8, 45, -12];
const worldPts = () => localPts.map(p => apply(W, p.x, p.y));
const nodesOf = (o: Obj): Pt[] => (o.shape as { subs: { nodes: Pt[] }[] }).subs[0].nodes;

check('legacy JSON and default boundary path are unchanged', () => {
  const legacy = imageObj();
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), legacy);
  assert.equal((legacy.shape as { cut?: unknown }).cut, undefined);
  const r = resolveImageCutPath(legacy, IDENT, () => undefined);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.closed, true);
  assert.equal(r.polygon.length, 4);
  samePt(r.polygon[0], { x: 0, y: 0 });
  samePt(r.polygon[2], { x: 100, y: 60 });
});

check('cut settings default off with full line controls', () => {
  const s = imageCutSettings(undefined);
  assert.equal(s.output, false);
  assert.equal('mode' in s, false);
  assert.equal('sub' in s, false);
  assert.equal('look' in s, false);
  const d = defaultCutSettings('line');
  const keys = ['speed', 'power', 'minPower', 'passes', 'air', 'kerf', 'tabs', 'fillStyle', 'interval',
    'angle', 'crossHatch', 'bidirectional', 'overscan', 'perf', 'lead', 'ramp', 'dedup', 'dedupTol',
    'zOffset', 'zStep'] as const;
  for (const k of keys) assert.deepEqual((s as unknown as Record<string, unknown>)[k],
    (d as unknown as Record<string, unknown>)[k], k);
  const L: ImageLayer = { dither: 'jarvis', negative: false, cells: 50, angle: 45, threshold: 128,
    cut: { ...s, output: true, speed: 777 } };
  const stored = imageCutSettings(L);
  assert.equal(stored.output, true);
  assert.equal(stored.speed, 777);
});

check('assign and unassign roundtrip under rotation, shear and scale', () => {
  const img = imageObj(W);
  const expected = worldPts();
  const c = pathObj(expected);
  assert.equal(assignImageContour(img, c, W), true);
  assert.deepEqual((img.shape as { cut?: unknown }).cut, { mode: 'contour', contourId: c.id });
  assert.deepEqual(c.cutLink, { imageId: img.id, prevNoLaser: false });
  assert.equal(c.noLaser, true);
  const r = resolveImageCutPath(img, W, id => id === c.id ? c : undefined);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.closed, true);
  assert.equal(r.polygon.length, 4);
  for (let i = 0; i < 4; i++) samePt(r.polygon[i], expected[i]);
  assert.equal(unassignImageContour(img, c, W), true);
  assert.equal((img.shape as { cut?: unknown }).cut, undefined);
  assert.equal(c.cutLink, undefined);
  assert.equal(c.noLaser, undefined);
  for (let i = 0; i < 4; i++) samePt(nodesOf(c)[i], expected[i]);
  assert.equal(img.shape.asset, 'original');
});

check('crop does not alter assigned contour but changes the boundary', () => {
  const img = imageObj(W);
  const c = pathObj(worldPts());
  assert.equal(assignImageContour(img, c, W), true);
  const before = resolveImageCutPath(img, W, id => id === c.id ? c : undefined);
  (img.shape as { edit?: unknown }).edit = { crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 } };
  const after = resolveImageCutPath(img, W, id => id === c.id ? c : undefined);
  assert.ok(before.ok && after.ok, JSON.stringify([before, after]));
  for (let i = 0; i < 4; i++) samePt(before.polygon[i], after.polygon[i]);
  const boundary = imageObj();
  const b0 = resolveImageCutPath(boundary, IDENT, () => undefined);
  (boundary.shape as { edit?: unknown }).edit = { crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 } };
  const b1 = resolveImageCutPath(boundary, IDENT, () => undefined);
  assert.ok(b0.ok && b1.ok);
  samePt(b1.polygon[0], { x: 25, y: 15 });
});

check('perspective change follows assigned contour', () => {
  const quad = [{ x: -10, y: -5 }, { x: 130, y: 0 }, { x: 110, y: 70 }, { x: 0, y: 65 }];
  const img = imageObj(W);
  const c = pathObj(worldPts());
  assert.equal(assignImageContour(img, c, W), true);
  const before = resolveImageCutPath(img, W, id => id === c.id ? c : undefined);
  (img.shape as { edit?: unknown }).edit = { perspective: quad };
  const after = resolveImageCutPath(img, W, id => id === c.id ? c : undefined);
  assert.ok(before.ok && after.ok);
  assert.ok(Math.hypot(after.polygon[0].x - before.polygon[0].x,
    after.polygon[0].y - before.polygon[0].y) > 1, 'perspective must move the cut path');
  const boundary = imageObj();
  (boundary.shape as { edit?: unknown }).edit = { perspective: quad };
  const b = resolveImageCutPath(boundary, IDENT, () => undefined);
  assert.ok(b.ok);
  samePt(b.polygon[0], quad[0]);
});

check('boundary path reflects crop, perspective and world-mm rounding', () => {
  const img = imageObj([2, 0.4, 0, 1.5, 30, -20]);
  (img.shape as { edit?: unknown }).edit = { crop: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
    perspective: [{ x: -5, y: -3 }, { x: 110, y: 2 }, { x: 105, y: 65 }, { x: 4, y: 58 }],
    cornerRadii: [3, 4, 5, 6] };
  const r = resolveImageCutPath(img, img.m, () => undefined);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.closed, true);
  assert.ok(r.polygon.length >= 4);
  assert.ok(r.polygon.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const rounded = resolveImageContour(img.shape as Extract<Obj['shape'], { kind: 'image' }>, img.m);
  assert.ok(rounded.ok);
  for (const [i, c] of rounded.contour.corners.entries()) near(c.radius, [3, 4, 5, 6][i]);
  // Der geschnittene Pfad selbst muss die Rundung enthalten, nicht nur die Konturprüfung.
  assert.ok(r.polygon.every(p => rounded.contour.contains(p)), 'scharfe Eckpunkte dürfen nicht geschnitten werden');
  assert.ok(r.polygon.length > 4, 'gerundeter Pfad braucht Zwischenpunkte auf den Bögen');
});

check('boundary cut keeps rounding under a reflecting world matrix', () => {
  const m: Mat = [-2, 0.4, 0, 1.5, 30, -20]; // det = -3
  const img = imageObj(m);
  (img.shape as { edit?: unknown }).edit = { cornerRadii: [3, 4, 5, 6] };
  const r = resolveImageCutPath(img, m, () => undefined);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.polygon.length > 4, 'Bögen auch bei Spiegelung mit Zwischenpunkten');
  const rounded = resolveImageContour(img.shape as Extract<Obj['shape'], { kind: 'image' }>, m);
  assert.ok(rounded.ok);
  assert.ok(r.polygon.every(p => rounded.contour.contains(p)), 'gespiegelter Schnitt darf keine scharfe Ecke treffen');
});

check('invalid open and self-crossing contours are rejected', () => {
  const img = imageObj();
  const open: Obj = { id: nextId++, m: IDENT, layer: 0,
    shape: { kind: 'path', subs: [{ nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false }] } };
  assert.equal(assignImageContour(img, open, IDENT), false);
  const cross = pathObj([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }]);
  assert.equal(assignImageContour(img, cross, IDENT), false);
  assert.equal((img.shape as { cut?: unknown }).cut, undefined);
  assert.equal(cross.cutLink, undefined);
  const cut = imageObj();
  (cut.shape as { cut?: unknown }).cut = { mode: 'contour', contourId: cross.id };
  const r = resolveImageCutPath(cut, IDENT, id => id === cross.id ? cross : undefined);
  assert.ok(!r.ok);
  assert.equal(r.reason, 'invalid-contour');
});

check('missing or dangling contour blocks an activated cut', () => {
  const img = imageObj();
  (img.shape as { cut?: unknown }).cut = { mode: 'contour', contourId: 999999 };
  const missing = resolveImageCutPath(img, IDENT, () => undefined);
  assert.ok(!missing.ok);
  assert.equal(missing.reason, 'missing-contour');
  const wrongKind = imageObj();
  const r = resolveImageCutPath(img, IDENT, id => id === 999999 ? wrongKind : undefined);
  assert.ok(!r.ok);
  assert.equal(r.reason, 'missing-contour');
  const found = resolveImageCutPath(img, IDENT, id => id === 999999 ? pathObj(localPts) : undefined);
  assert.ok(found.ok);
});

check('clone keeps dangling contour id but remaps a cloned image/contour pair', () => {
  const img = imageObj();
  const c = pathObj(localPts);
  assert.equal(assignImageContour(img, c, IDENT), true);
  const pair = cloneObjs([img, c]);
  const [ci, cc] = pair;
  assert.notEqual(ci.id, img.id);
  assert.notEqual(cc.id, c.id);
  assert.deepEqual((ci.shape as { cut?: unknown }).cut, { mode: 'contour', contourId: cc.id });
  assert.deepEqual(cc.cutLink, { imageId: ci.id, prevNoLaser: false });
  assert.equal(cc.noLaser, true);
  const r = resolveImageCutPath(ci, IDENT, id => pair.find(o => o.id === id));
  assert.ok(r.ok);
  const solo = cloneObjs([img])[0];
  assert.deepEqual((solo.shape as { cut?: unknown }).cut, { mode: 'contour', contourId: c.id });
  const dangling = resolveImageCutPath(solo, IDENT, () => undefined);
  assert.ok(!dangling.ok);
  assert.equal(dangling.reason, 'missing-contour');
});

check('unassign restores the previous noLaser state', () => {
  const img = imageObj();
  const c = pathObj(localPts);
  c.noLaser = true;
  assert.equal(assignImageContour(img, c, IDENT), true);
  assert.deepEqual(c.cutLink, { imageId: img.id, prevNoLaser: true });
  assert.equal(unassignImageContour(img, c, IDENT), true);
  assert.equal(c.noLaser, true);
  assert.equal(c.cutLink, undefined);
});

check('selection expansion pulls linked contours and their images once in stable order', () => {
  const imgA = imageObj();
  const cA = pathObj(localPts);
  assert.equal(assignImageContour(imgA, cA, IDENT), true);
  const imgB = imageObj();
  const lone = pathObj([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);
  const pool = [imgA, imgB, cA, lone];
  const sel = expandImageCutSelection([lone, imgA], pool);
  assert.deepEqual(sel.map(o => o.id), [lone.id, imgA.id, cA.id]);
  const sel2 = expandImageCutSelection([cA], pool);
  assert.deepEqual(sel2.map(o => o.id), [cA.id, imgA.id]);
  assert.equal(sel.filter(o => o.id === cA.id).length, 1);
});

check('read-only functions leave frozen inputs untouched and assign keeps the asset', () => {
  const frozen = imageObj();
  Object.freeze(frozen.shape);
  Object.freeze(frozen);
  const before = JSON.stringify(frozen);
  assert.ok(resolveImageCutPath(frozen, IDENT, () => undefined).ok);
  expandImageCutSelection([frozen], [frozen]);
  assert.equal(JSON.stringify(frozen), before);
  const img = imageObj(W);
  (img.shape as { edit?: unknown }).edit = { cornerRadii: [2, 2, 2, 2] };
  const asset = JSON.stringify({ asset: img.shape.asset, edit: img.shape.edit, w: img.shape.w, h: img.shape.h });
  assert.equal(assignImageContour(img, pathObj(worldPts()), W), true);
  assert.equal(JSON.stringify({ asset: img.shape.asset, edit: img.shape.edit, w: img.shape.w, h: img.shape.h }), asset);
});

console.log(`image cut model: ${checks}/${checks} passed`);
