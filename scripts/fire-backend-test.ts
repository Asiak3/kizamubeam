import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { machine, emptyStatus } from '../src/machine';
import { newDevice } from '../src/gcode';

let passed = 0, failed = 0;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const storage = new Map<string, string>();
let storageFails = false;
Object.assign(globalThis, { localStorage: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { if (storageFails) throw Error('QuotaExceededError'); storage.set(key, value); },
  removeItem: (key: string) => storage.delete(key),
} });
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); } } });
const trusted = { isTrusted: true } as Event;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const line = (text: string) => (machine as unknown as { onLine(line: string): void }).onLine(text);
const connected = (fw: 'grbl' | 'grblhal' | 'fluidnc' | 'marlin' | 'smoothie' = 'grbl') => {
  const d = { ...newDevice({ fw }), fireEnabled: true };
  Object.assign(machine, { connected: true, connectedDevice: d.id, fwId: fw, remote: null, progress: null, storedJob: null });
  machine.status = { ...emptyStatus(), state: 'Idle', ov: [100, 100, 100] };
  calls.length = 0;
  return d;
};
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}`, e); }
  finally { storageFails = false; await machine.fire.stop(); await turn(); machine.fire.confirmOff(); }
}
await test('F1 rejects unknown and non-default power override without changing the controller', async () => {
  for (const fw of ['grbl', 'grblhal', 'fluidnc'] as const) {
    const d = connected(fw);
    for (const ov of [null, [100, 100, 200], [100, 100, 50], [100, 100, NaN]] as const) {
      machine.status.ov = ov ? [...ov] : null;
      assert.equal(machine.canStartFire(d), false);
      assert.equal(await machine.startFire(d, 1, 5, trusted), false);
      assert.equal(calls.length, 0);
    }
  }
});
const invalidOverrideReports = [
  ['missing value', '<Idle|Ov>'],
  ['empty tuple', '<Idle|Ov:>'],
  ['truncated tuple', '<Idle|Ov:100,100>'],
  ['empty spindle value', '<Idle|Ov:100,100,>'],
  ['zero spindle value', '<Idle|Ov:100,100,0>'],
  ['NaN spindle value', '<Idle|Ov:100,100,NaN>'],
  ['infinite spindle value', '<Idle|Ov:100,100,Infinity>'],
  ['negative infinite spindle value', '<Idle|Ov:100,100,-Infinity>'],
  ['overflow spindle value', '<Idle|Ov:100,100,1e309>'],
  ['invalid spindle value', '<Idle|Ov:100,100,garbage>'],
  ['negative spindle value', '<Idle|Ov:100,100,-100>'],
] as const;
for (const fw of ['grbl', 'grblhal', 'fluidnc'] as const) {
  await test(`F1 ${fw} absent incoming override stays unknown`, async () => {
    const d = connected(fw);
    machine.status = emptyStatus();
    line('<Idle|FS:0,0>');
    assert.equal(machine.status.ov, null);
    assert.equal(machine.canStartFire(d), false);
    assert.equal(await machine.startFire(d, 1, 5, trusted), false);
    assert.equal(calls.length, 0);
  });
  for (const [name, report] of invalidOverrideReports) {
    await test(`F1 ${fw} incoming ${name} invalidates known override`, async () => {
      const d = connected(fw);
      line('<Idle|Ov:100,100,100>');
      line(report);
      assert.equal(machine.status.ov, null);
      assert.equal(machine.canStartFire(d), false);
      assert.equal(await machine.startFire(d, 1, 5, trusted), false);
      assert.equal(calls.length, 0, 'no activation or automatic override reset');
    });
    await test(`F1 ${fw} incoming ${name} during Fire stops with uncertainty`, async () => {
      const d = connected(fw);
      line('<Idle|Ov:100,100,100>');
      assert.equal(await machine.startFire(d, 1, 5, trusted), true);
      line(report);
      await turn();
      assert.equal(machine.fire.state, 'unknown');
      assert.equal(calls.at(-1)?.cmd, 'machine_stop');
      assert.equal(calls.some((c) => c.cmd === 'machine_realtime'), false);
    });
  }
  await test(`F1 ${fw} real parser accepts only known 100 and retains periodic telemetry`, async () => {
    const d = connected(fw);
    machine.status = emptyStatus();
    for (const power of [50, 200]) {
      line(`<Idle|Ov:100,100,${power}>`);
      assert.equal(machine.status.ov?.[2], power);
      assert.equal(machine.canStartFire(d), false);
      assert.equal(await machine.startFire(d, 1, 5, trusted), false);
      assert.equal(calls.length, 0);
    }
    line('<Idle|Ov:100,100,100>');
    assert.deepEqual(machine.status.ov, [100, 100, 100]);
    assert.equal(machine.canStartFire(d), true);
    assert.equal(await machine.startFire(d, 1, 5, trusted), true);
    const activationCalls = [...calls];
    line('<Idle|FS:0,0>');
    await turn();
    assert.deepEqual(machine.status.ov, [100, 100, 100]);
    assert.equal(machine.fire.state, 'firing');
    assert.deepEqual(calls, activationCalls, 'periodic report omission must not stop or reset overrides');
    assert.ok(calls.length > 0 && calls.every((c) => c.cmd === 'machine_send'));
  });
}
await test('F1 override changes during Fire stop and retain uncertainty', async () => {
  const d = connected();
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  line('<Idle|Ov:100,100,200>');
  await turn();
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(calls.at(-1)?.cmd, 'machine_stop');
});
await test('F2 Smoothie activation and stop share a native cancellation token', async () => {
  const d = connected('smoothie');
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  const token = calls[0]?.args.fireSession;
  assert.equal(typeof token, 'number');
  await machine.stop();
  assert.equal(calls.at(-1)?.cmd, 'machine_stop');
  assert.equal(calls.at(-1)?.args.fireSession, token);
  assert.equal(calls.at(-1)?.args.fireSmoothie, true);
});
await test('F2 physical-off confirmation waits for the native cancellation/write barrier', async () => {
  const d = connected('smoothie');
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  let release!: () => void;
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'machine_stop') await new Promise<void>((resolve) => { release = resolve; });
  };
  try {
    const stopping = machine.stop();
    await turn();
    assert.equal(machine.fire.state, 'unknown');
    assert.equal(machine.fire.canConfirm, false);
    assert.equal(machine.fire.confirmOff(), false);
    release();
    await stopping;
    assert.equal(machine.fire.canConfirm, true);
  } finally { window.__TAURI_INTERNALS__.invoke = original; }
});
await test('eligibility is pure and uses profile, connection, running state, lock and override gates', async () => {
  const d = connected();
  storageFails = true;
  assert.equal(machine.canStartFire(d), true);
  assert.equal(storage.has('kizamubeam.firePending'), false);
  assert.equal(calls.length, 0);
  for (const patch of [{ fireEnabled: false }, { conn: 'remote' as const }, { fw: 'xtool' as const }, { id: 'other' }])
    assert.equal(machine.canStartFire({ ...d, ...patch }), false);
  machine.status.state = 'Run';
  assert.equal(machine.canStartFire(d), false);
  machine.status.state = 'Idle';
  machine.progress = { sent: 0, acked: 0, total: 1, errors: 0 };
  assert.equal(machine.canStartFire(d), false);
  machine.progress = null;
  machine.remote = { role: 'operator', host: 'fake', state: null };
  assert.equal(machine.canStartFire(d), false);
  machine.remote = null;
  machine.connected = false;
  assert.equal(machine.canStartFire(d), false);
  machine.connected = true;
});
await test('F3 quiet capture cannot swallow Fire errors, alarms or reset safety handling', async () => {
  for (const text of ['error:9', 'ALARM:1', 'Grbl 1.1h']) {
    const d = connected();
    assert.equal(await machine.startFire(d, 1, 5, trusted), true);
    let captured = '';
    Object.assign(machine, { capture: { quiet: true, fn: (s: string) => { captured = s; } }, homed: true });
    line(text);
    Object.assign(machine, { capture: null });
    await turn();
    assert.equal(captured, text);
    assert.equal(machine.fire.state, 'unknown', text);
    assert.equal(calls.at(-1)?.cmd, 'machine_stop');
    if (text !== 'error:9') assert.equal(machine.homed, false);
    assert.equal(machine.fire.confirmOff(), true);
  }
});
await test('F3 error during a real quiet $CD query stops Fire and completes capture', async () => {
  const d = connected();
  const query = machine.query(['$CD'], 200, true);
  await turn();
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  line('error:9');
  assert.deepEqual(await query, ['error:9']);
  await turn();
  assert.equal(machine.fire.state, 'unknown');
  assert.equal(calls.at(-1)?.cmd, 'machine_stop');
});
await test('review reset banners during quiet capture cancel activation before async dispatch', async () => {
  for (const [fw, text] of [
    ['smoothie', 'Smoothie'], ['smoothie', 'Smoothie build version: edge'],
    ['grbl', 'Grbl 1.1h'], ['grblhal', 'GrblHAL 1.1f'],
    ['fluidnc', 'FluidNC v3.9.1'], ['marlin', 'start'],
  ] as const) {
    const d = connected(fw);
    Object.assign(machine, { homed: true, capture: { quiet: true, fn: () => {} } });
    const starting = machine.startFire(d, 1, 5, trusted);
    line(text);
    Object.assign(machine, { capture: null });
    await starting;
    await turn();
    assert.equal(calls.some((c) => c.cmd === 'machine_send'), false, text);
    assert.equal(machine.fire.state, 'unknown', text);
    assert.equal(machine.homed, false, text);
    assert.equal(machine.fire.confirmOff(), true);
  }
});
await test('review missing Smoothie off ACK permits real teardown without clearing uncertainty', async () => {
  const d = connected('smoothie');
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  const original = window.__TAURI_INTERNALS__.invoke;
  const releases: (() => void)[] = [];
  let disconnected = false;
  window.__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'machine_stop') await new Promise<void>((resolve) => { releases.push(resolve); });
    if (cmd === 'machine_disconnect') {
      disconnected = true;
      // A real native teardown drops every pending off-response sender.
      for (const release of releases) release();
    }
  };
  let stopping: Promise<void> | undefined;
  let disconnecting: Promise<void> | undefined;
  try {
    stopping = machine.stop();
    await turn();
    assert.equal(machine.fire.canConfirm, false);
    disconnecting = machine.disconnect();
    await turn();
    await turn();
    assert.equal(disconnected, true, 'native disconnect must not wait for the missing off ACK');
    await disconnecting;
    await stopping;
    assert.equal(machine.fire.state, 'unknown');
    assert.equal(storage.get('kizamubeam.firePending'), '1');
    const disconnect = calls.find((c) => c.cmd === 'machine_disconnect')!;
    assert.equal(disconnect.args.fireSession, calls[0].args.fireSession);
    assert.equal(disconnect.args.fireSmoothie, true);
    assert.equal(machine.fire.canConfirm, true);
  } finally {
    for (const release of releases) release();
    await stopping;
    await disconnecting;
    window.__TAURI_INTERNALS__.invoke = original;
  }
});
await test('F4 durable marker failure refuses activation and explains why', async () => {
  const d = connected();
  storageFails = true;
  const messages: string[] = [];
  const unlisten = machine.on((e) => { if (e.type === 'line') messages.push(e.line); });
  try {
    assert.equal(await machine.startFire(d, 1, 5, trusted), false);
    assert.equal(calls.length, 0);
    assert.equal(machine.fire.state, 'idle');
    assert.ok(machine.fireStartError);
    assert.ok(messages.some((s) => /speicher|stor|save/i.test(s)), messages.join('\n'));
  } finally { unlisten(); }
});
await test('review disconnect from firing holds confirmation until native teardown completes', async () => {
  const d = connected('smoothie');
  assert.equal(await machine.startFire(d, 1, 5, trusted), true);
  const original = window.__TAURI_INTERNALS__.invoke;
  let release!: () => void;
  window.__TAURI_INTERNALS__.invoke = async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'machine_disconnect') await new Promise<void>((resolve) => { release = resolve; });
  };
  const disconnecting = machine.disconnect();
  try {
    await turn();
    assert.equal(calls.at(-1)?.cmd, 'machine_disconnect');
    assert.equal(machine.fire.state, 'unknown');
    assert.equal(machine.fire.confirmOff(), false);
    assert.equal(storage.get('kizamubeam.firePending'), '1');
    release();
    await disconnecting;
    assert.equal(machine.fire.canConfirm, true);
    assert.equal(machine.fire.locked, true);
  } finally {
    release?.();
    await disconnecting;
    window.__TAURI_INTERNALS__.invoke = original;
  }
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
