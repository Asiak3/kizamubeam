// Referenzfahrt-Erkennung für strengen Z-Jog: homesZ je Firmware, losesPosition für Alarm/Neustart.
// Aufruf: npm run test:machine
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { homesZ, losesPosition } from '../src/machine';

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

test('GRBL-Familie: $H und $HZ decken Z ab, $HX nicht, G28 nie', () => {
  for (const fw of ['fluidnc', 'grbl', 'grblhal'] as const) {
    assert.equal(homesZ(fw, '$H'), true, fw);
    assert.equal(homesZ(fw, '$HZ'), true, fw);
    assert.equal(homesZ(fw, '  $h  '), true, fw);
    assert.equal(homesZ(fw, '$HX'), false, fw);
    assert.equal(homesZ(fw, '$HY'), false, fw);
    assert.equal(homesZ(fw, 'G28'), false, fw);
    assert.equal(homesZ(fw, 'G28 Z'), false, fw);
  }
});

test('Marlin/Smoothie: G28 ohne Achsen oder mit Z, sonst nicht', () => {
  for (const fw of ['marlin', 'smoothie'] as const) {
    assert.equal(homesZ(fw, 'G28'), true, fw);
    assert.equal(homesZ(fw, 'G28 Z'), true, fw);
    assert.equal(homesZ(fw, 'g28 z0'), true, fw);
    assert.equal(homesZ(fw, 'G28 X Y'), false, fw);
    assert.equal(homesZ(fw, 'G28 X'), false, fw);
    assert.equal(homesZ(fw, 'G28 X0 Y0'), false, fw);
    assert.equal(homesZ(fw, 'G28 ; alles'), true, fw);
    assert.equal(homesZ(fw, 'G28 X ; Kommentar mit Z'), false, fw);
    assert.equal(homesZ(fw, 'G28.1 Z'), false, fw);
    assert.equal(homesZ(fw, '$H'), false, fw);
  }
});

test('Positionsverlust: ALARM, Boot-Banner und Marlin-start', () => {
  assert.equal(losesPosition('ALARM:9'), true);
  assert.equal(losesPosition('alarm:3'), true);
  assert.equal(losesPosition("Grbl 1.1h ['$' for help]"), true);
  assert.equal(losesPosition('FluidNC v3.7.8 (wifi)'), true);
  assert.equal(losesPosition('start'), true);
  assert.equal(losesPosition('ok'), false);
  assert.equal(losesPosition('<Idle|MPos:0,0,0|FS:0,0>'), false);
  assert.equal(losesPosition('[VER:1.1h.20190825:]'), false);
  assert.equal(losesPosition('error:9'), false);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
