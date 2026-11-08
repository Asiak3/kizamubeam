// node scripts/camera-overlay-toggle-test.mjs
// Reuse only the offline harness setup; never bootstrap the app or access hardware.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const harnessURL = new URL('./camera-ui-offline-test.mjs', import.meta.url);
let setup = (await readFile(harnessURL, 'utf8')).split('const tab = cameraTab(ed);')[0];
assert.ok(setup.includes('export { units as testUnits, cfg as testConfig };'), 'Offline harness export boundary changed');
setup = setup
  .replace("from 'esbuild'", `from ${JSON.stringify(import.meta.resolve('esbuild'))}`)
  .replaceAll('import.meta.url', JSON.stringify(harnessURL.href))
  .replace('export { units as testUnits, cfg as testConfig };', 'export { units as testUnits, cfg as testConfig, devCams as testDeviceCams, cameraOverlaysVisible, toggleCameraOverlays };')
  .replace('const { cameraTab, cameraViews, testUnits, testConfig }', 'const { cameraTab, cameraViews, testUnits, testConfig, testDeviceCams, cameraOverlaysVisible, toggleCameraOverlays }');
const checks = `
let redraws = 0, notifications = 0;
ed.redraw = () => redraws++;
ed.emit = what => { assert.equal(what, 'tool'); notifications++; };
const tab = cameraTab(ed);
document.body.append(tab);
await Promise.resolve();
const checkbox = text => {
  const label = all(tab, 'label').find(el => el.textContent === translate(text));
  assert.ok(label, 'Missing checkbox: ' + text);
  return all(label, 'input')[0];
};
const master = checkbox('Alle Kameraüberlagerungen anzeigen');
const perCamera = checkbox('Auf der Arbeitsfläche zeigen');
assert.equal(cameraOverlaysVisible(), true, 'New sessions preserve the previous visible behavior');
assert.equal(master.checked, true);
const settings = testConfig();
settings.show = true;
settings.calib = { H: [1,0,0,0,1,0,0,0,1], head: { x: 0, y: 0 } };
const cameras = testDeviceCams().cams;
cameras.push({ ...settings, id: 'hidden-camera', show: false });
let painted = 0, outlines = 0;
for (const camera of cameras) testUnits.set(camera.id, {
  ready: true, overlay: {}, calib: () => camera.calib,
  footprint: () => ({ x0: 0, x1: 10, y0: 0, y1: 10 }),
  update: deny('unit.update'), setLive: deny('unit.setLive'),
  connect: deny('unit.connect'), disconnect: deny('unit.disconnect'),
});
machine.connected = true;
machine.status.wpos = [0, 0, 0];
const ctx = {
  drawImage: () => painted++, strokeRect: () => outlines++, setLineDash() {},
  getTransform: () => ({ a: 1 }),
};
ed.background(ctx);
assert.equal(painted, 1, 'Only individually enabled camera images are painted');
assert.equal(outlines, 1, 'Only individually enabled camera outlines are painted');
const cameraBefore = JSON.stringify(cameras);
const storageBefore = [...storage.entries()];
const timersBefore = [...intervals.entries()];
const selectedBefore = perCamera.checked;
toggleCameraOverlays(ed);
assert.equal(cameraOverlaysVisible(), false);
assert.equal(master.checked, false, 'External top/menu/toolbar action synchronizes the Camera master checkbox');
const deniedContext = new Proxy({}, { get: deny('hidden canvas access'), set: deny('hidden canvas mutation') });
ed.background(deniedContext);
assert.equal(painted, 1);
assert.equal(outlines, 1, 'Head camera outline is hidden too');
assert.equal(perCamera.checked, selectedBefore, 'Per-camera checkbox remains independent');
assert.equal(JSON.stringify(cameras), cameraBefore, 'No per-camera setting is changed');
assert.deepEqual([...storage.entries()], storageBefore, 'No settings are persisted');
assert.deepEqual([...intervals.entries()], timersBefore, 'Live timers are untouched');
// The global gate applies to the current device, not only the originally selected camera.
device.id = 'offline-other';
ed.background(deniedContext);
assert.equal(cameraOverlaysVisible(), false, 'Device changes do not silently reset the session gate');
device.id = 'offline-a';
master.checked = true;
await master.emit('change');
assert.equal(cameraOverlaysVisible(), true, 'Camera master checkbox uses the same state');
assert.equal(master.checked, true);
ed.background(ctx);
assert.equal(painted, 2, 'Previously visible images are restored without acquisition');
assert.equal(outlines, 2, 'Previously visible head outlines are restored');
assert.equal(cameras[1].show, false, 'An individually hidden camera stays hidden');
assert.equal(JSON.stringify(cameras), cameraBefore);
assert.equal(redraws, 2);
assert.equal(notifications, 2);
assert.deepEqual(forbidden, [], 'No camera acquisition, network, hardware, timer or update operation');
assert.equal(listCalls, 1, 'Only the original offline mocked list call at panel startup');
`;
await import(`data:text/javascript;base64,${Buffer.from(setup + checks).toString('base64')}`);

const ui = await readFile(new URL('../src/ui.ts', import.meta.url), 'utf8');
assert.match(ui, /\[t\('Alle Kameraüberlagerungen anzeigen'\), '', \(\) => toggleCameraOverlays\(ed\), cameraOverlaysVisible\]/, 'Checked View menu uses shared gate');
assert.ok(!ui.includes('const overlayButton'), 'No text button is appended to the menu bar');
assert.match(ui, /'grp:zoom', 'view3d', 'camera-overlays'/, 'Overlay icon is in the main toolbar defaults');
assert.match(ui, /icon: 'cameraOverlay'[\s\S]*?cameraOverlaysVisible\(\) \? 'cameraOverlay' : 'cameraOverlayOff'/, 'Camera-specific icon reflects the display gate');
assert.match(ui, /id: 'camera-overlays',[\s\S]*?run: \(\) => toggleCameraOverlays\(ed\), on: cameraOverlaysVisible/, 'Customizable action uses the same state');
console.log('Camera overlay toggle: offline rendering, shared master state, restoration, per-camera independence and denied hardware boundary passed.');
