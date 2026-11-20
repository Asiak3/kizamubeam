// Source-boundary audit, not a claim of a native authorization lock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); console.log(`ok route ${++passed} ${name}`); };
const laser = read('src/laser.ts');
check('device selector stays disabled after disconnect until physical-off confirmation', () => {
  const expression = laser.match(/devSel\.disabled = ([^;]+);/)[1];
  for (const connected of [false, true]) for (const connecting of [false, true]) {
    for (const locked of [false, true]) {
      const disabled = runInNewContext(expression, { machine: { connected, connecting, fire: { locked } } });
      assert.equal(disabled, connected || connecting || locked, JSON.stringify({ connected, connecting, locked }));
    }
  }
});
check('device editing entry points reject unresolved Fire before any mutation', () => {
  for (const name of ['selectDevice', 'patchDevice', 'addDevice', 'openDeviceDialog', 'openRotaryDialog', 'openDevicesDialog'])
    assert.match(laser, new RegExp(`export function ${name}\\([^\\n]*\\) \\{\\s*if \\(deviceEditBlocked\\(\\)\\) return;`), name);
  assert.match(laser, /if \(deviceEditBlocked\(\)\) return;\s*Object\.assign\(target, d/);
  assert.match(laser, /if \(!fireRows\.save\(\(\) => selectTab\(fireTabIndex\)\)\) return;/);
  assert.match(laser, /const add = \(\) => \{\s*if \(deviceEditBlocked\(\)\) return;/);
});
check('Move panel opens the device dialog directly at the Fire settings', () => {
  assert.match(laser, /fireControls\(\(\) => device, \(\) => openDeviceDialog\(ed, device, undefined, 'fire'\)\)/);
  assert.match(laser, /let activeTab = initialSection === 'fire' \? fireTabIndex/);
  assert.match(laser, /if \(initialSection === 'fire'\) fireRows\.focusEnabled\(\)/);
});
check('native remote and agent requests are forwarded to the frontend, not native machine commands', () => {
  const remote = read('src-tauri/src/remote.rs');
  const agent = read('src-tauri/src/agent.rs');
  assert.match(remote, /"remote-request"/);
  assert.match(agent, /app\.emit\("agent-request"/);
  for (const code of [remote, agent]) {
    assert.doesNotMatch(code, /crate::machine::|Cmd::(?:Line|Job|Realtime|Resume)|machine_send\(/);
  }
  const native = read('src-tauri/src/machine.rs');
  assert.match(native, /\n    tx: Mutex<Option<Sender<Cmd>>>/);
  assert.match(native, /\n    fn send\(&self, c: Cmd\)/); // private, not a remote/agent API
});
check('remote host machine requests explicitly reject Fire, except stop', () => {
  const remote = read('src/remoteHost.ts');
  assert.match(remote, /const needMachine = \(allowStop = false\)/);
  assert.match(remote, /machine\.fire\.locked && !allowStop/);
  for (const method of ['line', 'realtime', 'pause', 'resume', 'job_start', 'frame'])
    assert.match(remote, new RegExp(`case '${method}':\\s*needMachine\\(\\);`), method);
  assert.match(remote, /case 'stop':\s*needMachine\(true\);/);
  assert.doesNotMatch(remote, /invoke\(['"]machine_|native(?:<[^>]*>)?\(['"]machine_/);
});
console.log(`${passed} source-boundary audits passed; privileged direct Tauri invocations remain outside this frontend lock`);
