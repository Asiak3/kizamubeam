import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { FireSession, fireRequest } from '../src/fire';
import { newDevice } from '../src/gcode';
import { machine } from '../src/machine';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`ok ${++passed} ${name}`);
}
const device = () => ({ ...newDevice({ fw: 'grbl' }), laser: { type: 'diode' as const }, fireEnabled: true });
await test('opt-in, local connection and supported firmware independent of laser module type', () => {
  assert.equal(newDevice({ fw: 'grbl' }).fireEnabled, false);
  const d = device();
  for (const type of ['diode', 'co2', 'ir', 'fiber', undefined] as const) {
    const profile = { ...d, laser: type === undefined ? undefined : { type } };
    assert.deepEqual(fireRequest(profile, 1, 1), fireRequest(d, 1, 1));
    assert.ok(fireRequest(profile, 1, 1));
    for (const patch of [{ fireEnabled: false }, { conn: 'remote' as const }, { fw: 'xtool' as const }, { fw: 'ruida' as const }])
      assert.equal(fireRequest({ ...profile, ...patch }, 1, 1), null);
  }
});
await test('invalid, empty-equivalent and unlimited limits fail closed; never clamp inputs', () => {
  const d = device();
  for (const n of [0, -1, NaN, Infinity, 601]) assert.equal(fireRequest({ ...d, fireMaxSeconds: n }, 1, 1), null);
  for (const n of [0, -1, NaN, Infinity, 101]) assert.equal(fireRequest({ ...d, fireMaxPower: n }, 1, 1), null);
  for (const n of [0, -1, NaN, Infinity, 2]) assert.equal(fireRequest(d, n, 1), null);
  for (const n of [0, -1, NaN, Infinity, 6]) assert.equal(fireRequest(d, 1, n), null);
  assert.equal(fireRequest({ ...d, sMax: NaN }, 1, 1), null);
});

function fixture() {
  let now = 0;
  const sent: string[] = [];
  const scheduled: (() => void)[] = [];
  const session = new FireSession({
    now: () => now,
    schedule: (fn) => { scheduled.push(fn); return () => {}; },
    send: async (line) => { sent.push(line); },
    stop: async () => { sent.push('STOP'); },
    changed: () => {},
  });
  return { session, sent, scheduled, advance: (ms: number) => { now += ms; scheduled.at(-1)!(); } };
}
await test('deadline uses elapsed time; repeated clicks do not restart; completion is not physical-off', async () => {
  const { session, sent, advance } = fixture();
  const request = fireRequest(device(), 1, 1)!;
  await session.start(request);
  assert.equal(session.state, 'firing');
  await session.start(request);
  assert.equal(sent.filter((s) => s.includes('M3')).length, 1);
  advance(1200);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(session.state, 'unknown');
  assert.equal(sent.at(-1), 'STOP');
  assert.equal(session.locked, true);
  assert.equal(session.confirmOff(), true);
  assert.equal(session.locked, false);
});
await test('stop during pending start prevents remaining activation and requires local recovery', async () => {
  let resolve!: () => void;
  const sent: string[] = [];
  const session = new FireSession({ now: () => 0, schedule: () => () => {}, changed: () => {},
    send: (line) => { sent.push(line); return new Promise<void>((r) => { resolve = r; }); },
    stop: async () => { sent.push('STOP'); },
  });
  const start = session.start(fireRequest(device(), 1, 1)!);
  await session.stop();
  assert.equal(session.confirmOff(), false);
  resolve();
  await start;
  assert.equal(sent.some((s) => s.includes('M3')), false);
  assert.equal(sent.at(-1), 'STOP');
  assert.equal(session.state, 'unknown');
  assert.equal(session.confirmOff(), true);
});
await test('transport errors remain unknown; repeated stop is allowed', async () => {
  const session = new FireSession({ now: () => 0, schedule: () => () => {}, changed: () => {},
    send: async () => { throw Error('write failed'); }, stop: async () => { throw Error('disconnected'); },
  });
  await session.start(fireRequest(device(), 1, 1)!);
  assert.equal(session.state, 'unknown');
  await session.stop();
  assert.equal(session.state, 'unknown');
});

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const storage = new Map<string, string>();
Object.assign(globalThis, { localStorage: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); } } });
const trusted = { isTrusted: true } as Event;
const connected = (d = device()) => {
  Object.assign(machine, { connected: true, connectedDevice: d.id, fwId: d.fw, remote: null, progress: null });
  machine.status.state = 'Idle';
  machine.status.ov = [100, 100, 100];
  return d;
};
await test('real machine boundary rejects untrusted, remote, busy, non-Idle and mismatched profiles', async () => {
  const d = connected();
  assert.equal(await machine.startFire(d, 1, 1, { isTrusted: false } as Event), false);
  for (const state of ['', 'Alarm', 'Door', 'Hold', 'Jog', 'Run', 'Home', 'Check', 'Sleep']) {
    machine.status.state = state;
    assert.equal(await machine.startFire(d, 1, 1, trusted), false, state);
  }
  machine.status.state = 'Idle';
  machine.remote = { role: 'operator', host: 'fake', state: null };
  assert.equal(await machine.startFire(d, 1, 1, trusted), false);
  machine.remote = null;
  machine.progress = { sent: 0, acked: 0, total: 1, errors: 0 };
  assert.equal(await machine.startFire(d, 1, 1, trusted), false);
  machine.progress = null;
  assert.equal(await machine.startFire({ ...d, id: 'other' }, 1, 1, trusted), false);
  assert.equal(calls.length, 0);
});
await test('real machine sends firmware-specific activation, blocks other dispatch and retains recovery marker', async () => {
  const d = connected();
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  assert.deepEqual(calls.map((c) => c.args.line), ['G1 F1000', 'M3 S10']);
  assert.equal(storage.get('kizamubeam.firePending'), '1');
  const n = calls.length;
  await machine.send('G0 X10');
  await machine.realtime(0x99);
  await machine.resume();
  await machine.runStored('sd', 'test.nc');
  assert.equal(await machine.runJob(['M3 S100'], null), false);
  assert.equal(calls.length, n);
  await machine.stop();
  assert.equal(calls.at(-1)!.cmd, 'machine_stop');
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(storage.get('kizamubeam.firePending'), '1');
  assert.equal(machine.fire.confirmOff(), true);
  assert.equal(storage.has('kizamubeam.firePending'), false);
});
await test('connection-generation change never sends a late activation or stop to a replacement connection', async () => {
  const d = connected();
  const n = calls.length;
  const pending = machine.startFire(d, 1, 5, trusted);
  Object.assign(machine, { connectionGeneration: 100 });
  await pending;
  assert.equal(calls.length, n);
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(machine.fire.confirmOff(), true);
});
await test('stop before the async transport import resolves prevents late activation', async () => {
  const d = connected();
  calls.length = 0;
  const pending = machine.startFire(d, 1, 5, trusted);
  await machine.fire.stop();
  await pending;
  assert.equal(calls.some((c) => c.cmd === 'machine_send'), false);
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(machine.fire.confirmOff(), true);
});
await test('Marlin uses immediate M3, and native errors never turn the session idle', async () => {
  const d = connected({ ...device(), fw: 'marlin', sMax: 255 });
  calls.length = 0;
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  assert.equal(calls[0].args.line, 'M3 S2.5');
  // Real controller-error entry point, not the session helper.
  (machine as unknown as { onLine(line: string): void }).onLine('error:9');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(calls.at(-1)!.cmd, 'machine_stop');
  machine.fire.confirmOff();
});
await test('Smoothieware uses percent fire and explicit fire off, not M3/M5 or normalized S', async () => {
  const d = connected({ ...device(), fw: 'smoothie', sMax: 1, fireMaxPower: 20 });
  calls.length = 0;
  assert.equal(await machine.startFire(d, 20, 5, trusted), true);
  assert.deepEqual(calls.map((c) => c.args.line), ['fire 20']);
  await machine.stop();
  assert.equal(calls.at(-1)!.cmd, 'machine_stop');
  assert.equal(calls.at(-1)!.args.fireSmoothie, true);
  assert.equal(calls.at(-1)!.args.fireSession, calls[0].args.fireSession);
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(machine.fire.confirmOff(), true);
});
await test('pending bound-connection write prevents reconnect and cannot dispatch a remaining activation after stop', async () => {
  const d = connected();
  calls.length = 0;
  let release!: () => void;
  Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'machine_send') await new Promise<void>((resolve) => { release = resolve; });
  } } });
  const pending = machine.startFire(d, 1, 5, trusted);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls[0].args.line, 'G1 F1000');
  await machine.stop();
  await machine.connect(device());
  assert.equal(calls.some((c) => c.cmd === 'machine_connect'), false);
  assert.equal(machine.fire.confirmOff(), false);
  release();
  await pending;
  assert.equal(calls.some((c) => String(c.args.line).includes('M3')), false);
  assert.equal(calls.at(-1)!.cmd, 'machine_stop');
  assert.equal(machine.fire.confirmOff(), true);
});
await test('restart restores uncertainty and blocks reconnect until physical-off acknowledgement', async () => {
  storage.set('kizamubeam.firePending', '1');
  const Machine = machine.constructor as new () => typeof machine;
  const restored = new Machine();
  const n = calls.length;
  assert.equal(restored.fire.state, 'unknown');
  assert.equal(restored.fire.locked, true);
  await restored.connect(device());
  assert.equal(calls.length, n);
  assert.equal(restored.fire.confirmOff(), true);
  assert.equal(storage.has('kizamubeam.firePending'), false);
});
console.log(`${passed} fire tests passed`);
await import('./fire-backend-test');
