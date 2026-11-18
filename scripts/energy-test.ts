import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { ELECTRICITY_CURRENCIES, electricityCurrency, electricityTariffText, emptyEnergySettings, energyDraft, estimateEnergy, formatCost, formatEnergyValue, laserElectricalWatts, parseEnergyNumber, setElectricityCurrency, setElectricityTariffText } from '../src/energy';
import { estimate, loadDevices, Moves, newDevice, saveDevices, writeGCode } from '../src/gcode';
import { applyChanges, loadValues, SettingsSection } from '../src/settings/registry';

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); passed++; console.log(`ok ${name}`);
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const moves = new Moves();
// Rapid on an air layer, 25% cut, 75% cut, feed with laser off, rapid outside air layer.
moves.push(1, 0, 0, 1, 1);
moves.push(2, 0, 60, 0.25, 1);
moves.push(3, 0, 60, 0.75, 2);
moves.push(4, 0, 60, 0, 2);
moves.push(5, 0, 0, 0, -1);
const timing = { t: new Float64Array([10, 30, 60, 100, 150]), total: 150, cutLength: 2, rapidLength: 3 };
const settings = { baseWatts: 100, laserWatts: [10, 50, 150] as [number, number, number], consumers: [
  { name: 'Fan', watts: 20, included: true, rule: 'job' as const },
  { name: 'Extraction', watts: 200, included: true, rule: 'laser' as const },
  { name: 'Compressor average', watts: 300, included: true, rule: 'air' as const },
  { name: 'Excluded unknown', watts: null, included: false, rule: 'air' as const },
] };

await test('piecewise electrical curve: zero, quarter, half, three quarters, full and clamp', () => {
  assert.deepEqual([-1, 0, 0.25, 0.5, 0.75, 1, 2].map(p => laserElectricalWatts(p, [10, 50, 150])), [10, 10, 30, 50, 100, 150, 150]);
});
await test('numerical fixture: base, standby throughout job, three accessory rules and exclusion', () => {
  const result = estimateEnergy(moves, timing, [1], settings);
  assert.deepEqual(result.durations, { job: 150, laser: 50, air: 30 });
  const ws = [15000, 4600, 3000, 10000, 9000];
  result.components.slice(0, 5).forEach((c, i) => near(c.kWh!, ws[i] / 3600000));
  near(result.total!, ws.reduce((a, b) => a + b) / 3600000);
});
await test('real estimator durations and G-code air switches agree without mutating moves', () => {
  const device = newDevice({ fw: 'fluidnc' });
  const before = JSON.stringify(moves);
  const est = estimate(moves, device);
  const result = estimateEnergy(moves, est, [1], settings);
  near(result.durations.air, est.t[1]);
  near(result.durations.laser, est.t[2] - est.t[0]);
  near(result.durations.job, est.total);
  const code = writeGCode({ moves, air: [1], bounds: null, travel: null, hull: [], warnings: [], offset: { x: 0, y: 0 } }, device, est);
  const switches = code.lines.filter(line => line === 'M8' || line === 'M9');
  assert.deepEqual(switches.slice(0, 2), ['M8', 'M9']);
  assert.equal(JSON.stringify(moves), before);
});
await test('unknown, invalid, empty and valid zero stay distinct; no incomplete total', () => {
  for (const text of ['', ' ', '-1', 'Infinity', 'NaN', '1w', '0.3EUR']) assert.equal(parseEnergyNumber(text), null);
  assert.equal(parseEnergyNumber('0'), 0);
  assert.equal(parseEnergyNumber('0.35'), 0.35);
  assert.equal(parseEnergyNumber('0,35'), 0.35);
  assert.equal(estimateEnergy(moves, timing, [], emptyEnergySettings()).total, null);
  for (const value of [null, -1, NaN, Infinity, '' as unknown as number]) {
    const draft = energyDraft(settings); draft.baseWatts = value;
    const result = estimateEnergy(moves, timing, [], draft);
    assert.equal(result.total, null); assert.notEqual(result.components[1].kWh, null);
  }
  const draft = energyDraft(settings); draft.laserWatts[1] = null;
  assert.equal(estimateEnergy(moves, timing, [], draft).total, null);
  draft.laserWatts = [0, 0, 0]; draft.baseWatts = 0; draft.consumers = [];
  assert.equal(estimateEnergy(moves, timing, [], draft).total, 0);
});
await test('currency default, allowlist rejection and cost formatting fallback', () => {
  assert.deepEqual([...ELECTRICITY_CURRENCIES].slice(0, 3), ['EUR', 'USD', 'GBP']);
  assert.equal(electricityCurrency(), 'EUR');
  assert.throws(() => setElectricityCurrency('XXX'));
  setElectricityCurrency('USD');
  assert.equal(electricityCurrency(), 'EUR');
  assert.equal(formatCost(10, 'USD').replace(/[\s ]/g, ''), '10,00$');
  assert.equal(formatCost(10, 'EUR').replace(/[\s ]/g, ''), '10,00€');
});
await test('included incomplete accessory blocks total; excluded data persists without blocking', () => {
  const draft = energyDraft(settings);
  draft.consumers[3].included = true;
  assert.equal(estimateEnergy(moves, timing, [], draft).total, null);
  draft.consumers[3].included = false;
  assert.notEqual(estimateEnergy(moves, timing, [], draft).total, null);
  draft.consumers[0].rule = 'invalid' as 'job';
  assert.equal(estimateEnergy(moves, timing, [], draft).total, null);
});
await test('empty job, tiny positive values and unrounded arithmetic', () => {
  const result = estimateEnergy(new Moves(), { t: new Float64Array(), total: 0, cutLength: 0, rapidLength: 0 }, [], settings);
  assert.equal(result.total, 0);
  assert.equal(formatEnergyValue(1e-8, 4), '<0.0001');
  assert.equal(formatEnergyValue(1e-8, 2), '<0.01');
  assert.equal(formatEnergyValue(0, 4), '0.0000');
  assert.equal(formatEnergyValue(0.1234567, 4), '0.1235');
});
await test('device storage roundtrip, old device and cancelled nested draft', () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  const device = newDevice({ fw: 'fluidnc' }); device.energy = energyDraft(settings);
  saveDevices({ devices: [device], current: device.id });
  const saved = loadDevices().devices[0];
  assert.deepEqual(saved.energy, settings);
  const draft = energyDraft(saved.energy); draft.laserWatts[0] = 999; draft.consumers[0].name = 'Cancelled';
  assert.deepEqual(loadDevices().devices[0].energy, settings);
  assert.deepEqual(saved.energy, settings);
  assert.deepEqual(energyDraft(undefined), emptyEnergySettings());
  data.clear(); assert.equal(loadDevices().devices[0].energy, undefined);
});
await test('tariff settings draft cancels without writes; apply persists, missing tariff does not change energy', async () => {
  const section: SettingsSection = { id: 'general', title: '', order: 0, fields: [{ kind: 'text', id: 'tariff', label: '', get: electricityTariffText, set: setElectricityTariffText }] };
  const before = await loadValues([section]);
  const draft = new Map(before); draft.set('tariff', '0.35');
  assert.equal(electricityTariffText(), '');
  const total = estimateEnergy(moves, timing, [], settings).total;
  assert.equal(parseEnergyNumber(electricityTariffText()), null);
  const applied = await applyChanges([section], before, draft);
  assert.deepEqual(applied.errors, []); assert.equal(electricityTariffText(), '0.35');
  assert.equal(estimateEnergy(moves, timing, [], settings).total, total);
  near(total! * parseEnergyNumber(electricityTariffText())!, total! * 0.35);
});
console.log(`${passed} energy tests passed`);
