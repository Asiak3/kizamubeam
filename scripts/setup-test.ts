// Tests für den Assistenten „Laser einrichten“: Firmware erkennen, Einstellungen lesen, Befunde. Aufruf: npm run test:setup
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { newDevice } from '../src/gcode';
import {
  buildTestJob, checkConfig, CheckInput, detectFirmware, directionFix, emptyFacts, Facts, homingAllowed, machineFacts, parseFluidConfig, parseGrblSettings, parseMarlin, stepsFix,
} from '../src/setup';
import { boundsOf } from '../src/geom';

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

const GRBL_SETTINGS = ['$0=10', '$3=0', '$13=0', '$20=0', '$21=0', '$22=0', '$23=0', '$30=1000', '$31=0', '$32=1', '$100=80.000', '$101=80.000', '$130=400.000', '$131=400.000', 'ok'];
const grblFacts = (over: Record<number, number> = {}): Facts => ({ ...emptyFacts(), fw: 'grbl', version: 'GRBL 1.1h', grbl: { ...parseGrblSettings(GRBL_SETTINGS), ...over } });
const input = (facts: Facts, over: Partial<CheckInput> = {}): CheckInput => ({
  facts, device: newDevice({ fw: 'grbl', bedW: 400, bedH: 400 }), switches: 'unknown', state: 'Idle', mpos: [0, 0, 0], wco: null, ...over,
});
const ids = (inp: CheckInput) => checkConfig(inp).filter((f) => f.level !== 'ok').map((f) => f.id);
const find = (inp: CheckInput, id: string) => checkConfig(inp).find((f) => f.id === id);

const FLUID_CD = `
name: Swiitol E6 Pro
board: MKS DLC32
start:
  must_home: false
axes:
  shared_stepper_disable_pin: gpio.13
  x:
    steps_per_mm: 80.000
    max_rate_mm_per_min: 6000.000
    acceleration_mm_per_sec2: 1000.000
    max_travel_mm: 400.000
    soft_limits: false
    homing:
      cycle: 1
      positive_direction: false
      mpos_mm: 0.000
    motor0:
      limit_neg_pin: gpio.36:low
      limit_pos_pin: NO_PIN
      limit_all_pin: NO_PIN
      hard_limits: false
      stepstick:
        step_pin: i2so.1
        direction_pin: i2so.2:low
  y:
    steps_per_mm: 80.000
    max_travel_mm: 400.000
    soft_limits: false
    homing:
      cycle: 2
    motor0:
      limit_neg_pin: gpio.35:low
      limit_pos_pin: NO_PIN
      limit_all_pin: NO_PIN
      hard_limits: false
Laser:
  pwm_hz: 1000
  output_pin: gpio.32
  speed_map: 0=0.000% 1000=100.000%
ok`.split('\n');

test('Firmware an $I, M115 und version erkennen', () => {
  assert.deepEqual(detectFirmware(['[VER:1.1h.20190825:]', '[OPT:V,15,128]', 'ok']), { fw: 'grbl', version: 'GRBL 1.1h.20190825' });
  assert.equal(detectFirmware(['[VER:3.7 FluidNC v3.7.8:]', '[OPT:PHSH]', 'ok'])?.fw, 'fluidnc');
  assert.equal(detectFirmware(['[VER:3.7 FluidNC v3.7.8:]'])?.version, 'FluidNC 3.7.8');
  assert.equal(detectFirmware(['[VER:1.1f.20230108:]', '[OPT:VNMSL,35,1024,3,0]', '[FIRMWARE:grblHAL]', 'ok'])?.fw, 'grblhal');
  assert.equal(detectFirmware(['FIRMWARE_NAME:Marlin 2.1.2 (Sep  1 2023) SOURCE_CODE_URL:github.com/MarlinFirmware/Marlin', 'ok'])?.version, 'Marlin 2.1.2');
  assert.equal(detectFirmware(['Build version: edge-3332442, Build date: Jun 1 2020, MCU: LPC1769', 'ok'])?.fw, 'smoothie');
  assert.equal(detectFirmware(["Grbl 1.1f ['$' for help]"])?.fw, 'grbl');
  assert.deepEqual(detectFirmware(['[XTool D1 V40.30.002.01]', 'ok']), { fw: 'xtool', version: 'xTool D1 V40.30.002.01' });
  assert.equal(detectFirmware(["Grbl 1.1f ['$' for help]", '[XTool]', 'ok'])?.fw, 'xtool');
  assert.equal(detectFirmware(['error:20', 'ok']), null);
});

test('GRBL-Einstellungen lesen', () => {
  const mf = machineFacts(grblFacts());
  assert.deepEqual(mf.bed, { w: 400, h: 400 });
  assert.equal(mf.sMax, 1000);
  assert.equal(mf.laserMode, true);
  assert.equal(mf.homing, false);
  assert.equal(mf.switches, null, 'GRBL kann Endschalter nicht melden');
  // grblHAL: $22 ist eine Bitmaske, Bit 0 = Referenzfahrt
  assert.equal(machineFacts(grblFacts({ 22: 5 })).homing, true);
  assert.equal(machineFacts(grblFacts({ 22: 4 })).homing, false);
});

test('FluidNC-Konfiguration ($CD) lesen', () => {
  const fluid = parseFluidConfig(FLUID_CD);
  assert.equal(fluid['axes/x/motor0/limit_neg_pin'], 'gpio.36:low');
  assert.equal(fluid['laser/speed_map'], '0=0.000% 1000=100.000%');
  const mf = machineFacts({ ...emptyFacts(), fw: 'fluidnc', fluid });
  assert.deepEqual(mf.bed, { w: 400, h: 400 });
  assert.equal(mf.sMax, 1000);
  assert.equal(mf.laserMode, true);
  assert.equal(mf.homing, true);
  assert.equal(mf.switches, true);
  assert.equal(mf.mustHome, false);
  assert.deepEqual(mf.steps, { x: 80, y: 80 });
  // Ohne Endschalter-Pins und mit PWM-Spindel
  const noPins = parseFluidConfig(FLUID_CD.map((l) => l.replace(/limit_neg_pin: .*/, 'limit_neg_pin: NO_PIN').replace(/^Laser:/, 'PWM:')));
  const mf2 = machineFacts({ ...emptyFacts(), fw: 'fluidnc', fluid: noPins });
  assert.equal(mf2.switches, false);
  assert.equal(mf2.laserMode, false);
});

test('Marlin: M211 und M92 lesen', () => {
  const m = parseMarlin(['echo:Soft endstops: On   Min: X0.00 Y0.00 Z0.00   Max: X300.00 Y280.00 Z0.00', 'echo:  M92 X80.00 Y80.00 Z400.00 E93.00', 'ok']);
  assert.deepEqual(m, { soft: true, maxX: 300, maxY: 280, stepsX: 80, stepsY: 80 });
});

test('Saubere GRBL-Konfiguration ohne Probleme', () => {
  assert.deepEqual(ids(input(grblFacts(), { switches: 'no' })), ['origin']);
});

test('Lasermodus aus: nur ein Vorschlag mit Rücknahme', () => {
  const f = find(input(grblFacts({ 32: 0 })), 'laser')!;
  assert.equal(f.level, 'warn');
  assert.deepEqual(f.fix?.send, ['$32=1']);
  assert.deepEqual(f.fix?.undo, ['$32=0']);
});

test('Leistungsskala und Arbeitsbereich weichen ab: Geräteeinstellung vorschlagen', () => {
  const inp = input(grblFacts({ 30: 255, 130: 410, 131: 400 }));
  assert.deepEqual(find(inp, 'smax')?.fix?.app, { sMax: 255 });
  assert.deepEqual(find(inp, 'bed')?.fix?.app, { bedW: 410, bedH: 400 });
  assert.equal(find(inp, 'smax')?.fix?.send, undefined, 'nichts an die Steuerung');
});

test('Falsches Firmware-Profil erkennen', () => {
  const inp = input({ ...grblFacts(), fw: 'fluidnc' });
  assert.deepEqual(find(inp, 'fw')?.fix?.app, { fw: 'fluidnc' });
});

test('Ohne Endschalter: Referenzfahrt ausschalten vorschlagen, nie anbieten', () => {
  const facts = grblFacts({ 22: 1, 21: 1 });
  const inp = input(facts, { switches: 'no', state: 'Alarm' });
  assert.deepEqual(find(inp, 'homing')?.fix?.send, ['$22=0']);
  assert.deepEqual(find(inp, 'hard')?.fix?.send, ['$21=0']);
  assert.equal(find(inp, 'alarm')?.fix?.action, 'unlock');
  assert.equal(homingAllowed('no', machineFacts(facts)), false);
  assert.equal(homingAllowed('unknown', machineFacts(facts)), false);
  assert.equal(homingAllowed('yes', machineFacts(facts)), true);
  assert.equal(homingAllowed('yes', machineFacts(grblFacts({ 22: 0 }))), false);
  // „Beim Verbinden referenzieren“ ohne Endschalter
  const d = { ...newDevice({ fw: 'grbl' }), homeOnConnect: true };
  assert.deepEqual(find(input(facts, { switches: 'no', device: d }), 'homeconnect')?.fix?.app, { homeOnConnect: false });
});

test('FluidNC: Endschalter aus der Konfiguration, Vorschlag ändert die config.yaml', () => {
  const fluid = parseFluidConfig(FLUID_CD.map((l) => l.replace(/limit_neg_pin: .*/, 'limit_neg_pin: NO_PIN')));
  const facts: Facts = { ...emptyFacts(), fw: 'fluidnc', fluid };
  const inp = input(facts, { device: newDevice({ fw: 'fluidnc' }) });
  const f = find(inp, 'homing')!;
  assert.equal(f.level, 'warn');
  // Gesetzt und in der Konfigurationsdatei gespeichert, Rücknahme mit den alten Werten
  assert.deepEqual(f.fix?.send, ['$/axes/x/homing/cycle=0', '$/axes/y/homing/cycle=0', '$CD=config.yaml']);
  assert.deepEqual(f.fix?.undo, ['$/axes/x/homing/cycle=1', '$/axes/y/homing/cycle=2', '$CD=config.yaml']);
  assert.equal(homingAllowed('unknown', machineFacts(facts)), false);
  // Mit Endschaltern im Alarm: Referenzfahrt anbieten
  const ok: Facts = { ...emptyFacts(), fw: 'fluidnc', fluid: parseFluidConfig(FLUID_CD) };
  assert.equal(find(input(ok, { device: newDevice({ fw: 'fluidnc' }), state: 'Alarm' }), 'alarm')?.fix?.action, 'home');
});

test('Widersprüche: Verfahrgrenzen ohne Referenzfahrt, Zoll, negative Koordinaten', () => {
  assert.equal(find(input(grblFacts({ 20: 1, 22: 0 })), 'soft')?.level, 'error');
  assert.deepEqual(find(input(grblFacts({ 13: 1 })), 'inches')?.fix?.send, ['$13=0']);
  const neg = find(input(grblFacts({ 22: 1 }), { switches: 'yes', mpos: [-399, -399, 0] }), 'negative')!;
  assert.equal(neg.level, 'warn');
  assert.deepEqual(neg.fix?.app, { startFrom: 'current' });
  assert.equal(find(input(grblFacts(), { wco: { x: 10, y: 5 } }), 'wco')?.fix?.send?.[0], 'G10 L2 P1 X0 Y0');
});

test('Richtung umkehren: $3 und mit Referenzfahrt auch $23', () => {
  assert.deepEqual(directionFix('x', grblFacts({ 3: 0 }))?.send, ['$3=1']);
  assert.deepEqual(directionFix('y', grblFacts({ 3: 3 }))?.send, ['$3=1']);
  const f = directionFix('y', grblFacts({ 3: 1, 22: 1, 23: 3 }))!;
  assert.deepEqual(f.send, ['$3=3', '$23=1']);
  assert.deepEqual(f.undo, ['$3=1', '$23=3']);
  // FluidNC: direction_pin des Motors umkehren
  assert.deepEqual(directionFix('x', { ...emptyFacts(), fw: 'fluidnc', fluid: parseFluidConfig(FLUID_CD) })?.send, ['$/axes/x/motor0/stepstick/direction_pin=i2so.2', '$CD=config.yaml']);
  assert.equal(directionFix('y', { ...emptyFacts(), fw: 'fluidnc', fluid: parseFluidConfig(FLUID_CD) }), null);
});

test('Schritte je mm aus dem gemessenen Weg', () => {
  const r = stepsFix('x', 50, 49, grblFacts())!;
  assert.equal(r.steps, 81.633);
  assert.deepEqual(r.fix?.send, ['$100=81.633']);
  assert.deepEqual(r.fix?.undo, ['$100=80']);
  assert.equal(stepsFix('x', 50, 0, grblFacts()), null);
  const m = stepsFix('y', 50, 51, { ...emptyFacts(), fw: 'marlin', marlin: { stepsX: 80, stepsY: 80 } })!;
  assert.deepEqual(m.fix?.send, ['M92 Y78.431', 'M500']);
});

test('Testauftrag liegt mittig auf dem Bett', () => {
  const { doc, layer } = buildTestJob({ size: 20, power: 10, speed: 1000 }, { w: 400, h: 300 });
  assert.equal(layer.mode, 'line');
  assert.equal(layer.power, 10);
  assert.equal(doc.objs.length, 2);
  const b = boundsOf([doc.objs[0]])!;
  assert.deepEqual([b.x, b.y, b.w, b.h], [190, 140, 20, 20]);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
