// Tests zum Zeigerversatz (Issue #213, RUN-26-05). Aufruf: npm run test:pointer
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, DEFAULT_ROTARY, frameGCode, Moves, newDevice, pointerShift, posShift, sameMoves } from '../src/gcode';
import { defaultImageLayer, defaultLayer, loadDoc, Obj } from '../src/model';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const objs: Obj[] = [{ id: 1, m: [1, 0, 0, 1, 50, 200], layer: 1, shape: { kind: 'rect', w: 20, h: 10, r: 0 } as never }];
const doc = () => loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
const inp = (device: ReturnType<typeof newDevice>, position?: { x: number; y: number }) => ({
  doc: doc(),
  layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }),
  imgLayer: () => defaultImageLayer(),
  device,
  ...(position ? { position } : {}),
});

await test('pointerShift: aus ist (0,0), an übernimmt die Werte', () => {
  assert.deepEqual(pointerShift(newDevice({ fw: 'fluidnc' })), { x: 0, y: 0 });
  const d = { ...newDevice({ fw: 'fluidnc' }), pointerOffset: { x: 2.5, y: -16.5, enabled: true } };
  assert.deepEqual(pointerShift(d), { x: 2.5, y: -16.5 });
  assert.deepEqual(pointerShift({ ...d, pointerOffset: { ...d.pointerOffset, enabled: false } }), { x: 0, y: 0 });
});

await test('pointerShift: mit Drehachse wirkt nur X, Unendliches wird 0', () => {
  const d = {
    ...newDevice({ fw: 'fluidnc' }),
    pointerOffset: { x: 2.5, y: -16.5, enabled: true },
    rotary: { ...DEFAULT_ROTARY, enabled: true, perRev: 360, rollerDiam: 63, objectDiam: 80 },
  };
  assert.deepEqual(pointerShift(d), { x: 2.5, y: 0 });
  const nan = { ...newDevice({ fw: 'fluidnc' }), pointerOffset: { x: NaN, y: Infinity, enabled: true } };
  assert.deepEqual(pointerShift(nan), { x: 0, y: 0 });
});

await test('Absolut + Offset: Bahnen unverändert (kein Eingriff in Geometrie/Export)', async () => {
  const off = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false, pointerOffset: { x: 2.5, y: -16.5, enabled: true } };
  const plain = { ...off, pointerOffset: { x: 0, y: 0, enabled: false } };
  const a = await buildJob(inp(off));
  const b = await buildJob(inp(plain));
  assert.ok(a.moves.n > 0);
  assert.ok(sameMoves(a.moves, b.moves, { x: 0, y: 0 }), 'Bahnen müssen identisch sein');
});

await test('Aktuell + Offset: nur die Startreferenz verschiebt sich um +Offset', async () => {
  const pos = { x: 123, y: 77 };
  const off = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'current' as const, jobOrigin: 6, returnHome: false, optimize: false, pointerOffset: { x: 2.5, y: -16.5, enabled: true } };
  const plain = { ...off, pointerOffset: { x: 0, y: 0, enabled: false } };
  const a = await buildJob(inp(off, pos));
  const b = await buildJob(inp(plain, pos));
  assert.ok(a.moves.n > 0 && b.moves.n === a.moves.n);
  // Kopf startet an der gemeldeten Position (kein Teleport), Geometrie ist rein um +Offset verschoben
  assert.deepEqual([a.moves.x0, a.moves.y0], [pos.x, pos.y]);
  assert.deepEqual([a.offset.x - b.offset.x, a.offset.y - b.offset.y], [2.5, -16.5]);
  assert.ok(sameMoves(a.moves, b.moves, { x: -2.5, y: 16.5 }), 'reine Verschiebung, keine Verzerrung');
  // Vorschau passt zum Job (wichtig für „Start hier")
  const prev = await buildJob({ ...inp(off, pos), forPreview: true });
  assert.ok(sameMoves(prev.moves, a.moves, a.offset));
});

await test('Benutzer-Ursprung + Offset: Geometrie verschiebt sich um +Offset', async () => {
  const off = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'user' as const, jobOrigin: 6, returnHome: false, optimize: false, pointerOffset: { x: 2.5, y: -16.5, enabled: true } };
  const plain = { ...off, pointerOffset: { x: 0, y: 0, enabled: false } };
  const a = await buildJob(inp(off));
  const b = await buildJob(inp(plain));
  assert.deepEqual([a.offset.x - b.offset.x, a.offset.y - b.offset.y], [2.5, -16.5]);
  assert.ok(sameMoves(a.moves, b.moves, { x: -2.5, y: 16.5 }));
});

await test('Framing: Rotpunkt um −Offset, Werkzeug unverändert', () => {
  const job = { moves: new Moves(0, 0), bounds: { x0: 10, y0: 0, x1: 20, y1: 5 }, travel: null, hull: [], warnings: [], offset: { x: 0, y: 0 }, air: [] };
  const d = { ...newDevice({ fw: 'fluidnc' }), pointerOffset: { x: 2.5, y: -16.5, enabled: true } };
  const pointer = frameGCode(job, d, false)!;
  assert.ok(pointer.includes('G0 X7.5 Y16.5'), pointer.join('\n'));
  assert.ok(pointer.includes('G1 X17.5 Y16.5 S0 F3000'), pointer.join('\n'));
  const tool = frameGCode(job, { ...d, frameView: 'tool' }, false)!;
  assert.ok(tool.includes('G0 X10 Y0'), tool.join('\n'));
  // Ohne Offset sind beide Modi identisch
  const plain = frameGCode(job, newDevice({ fw: 'fluidnc' }), false)!;
  assert.deepEqual(frameGCode(job, { ...newDevice({ fw: 'fluidnc' }), frameView: 'tool' }, false), plain);
});

await test('posShift: Werkzeug fährt direkt, Rotpunkt um −Offset', () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), pointerOffset: { x: 2.5, y: -16.5, enabled: true } };
  assert.deepEqual(posShift(d), { x: 2.5, y: -16.5 });
  assert.deepEqual(posShift({ ...d, frameView: 'tool' }), { x: 0, y: 0 });
  assert.deepEqual(posShift({ ...d, pointerOffset: { ...d.pointerOffset, enabled: false } }), { x: 0, y: 0 });
});

process.exit(failed ? 1 : 0);
