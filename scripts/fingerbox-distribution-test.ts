import { strict as assert } from 'node:assert';
import { defaultDistribution, distributeGaps } from '../src/generators/fingerbox-distribution';
const eq = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 1e-8, `${x} != ${expected[i]}`));
};
assert.equal(defaultDistribution(3), '1:1:1');
const equal = distributeGaps(300, 6, 3, '1:1:1');
eq(equal.gaps, [92, 92, 92]);
eq(equal.centres, [101, 199]);
eq(distributeGaps(300, 6, 3, '').gaps, [92, 92, 92]);
eq(distributeGaps(300, 6, 3, '50mm:1:1').gaps, [50, 113, 113]);
eq(distributeGaps(300, 6, 3, '33mm:50mm*2:1').gaps, [33, 100, 143]);
eq(distributeGaps(300, 6, 3, '(50mm+10mm)/2:1:2').gaps, [30, 82, 164]);
eq(distributeGaps(300, 6, 3, '50mm-2:1:1').gaps, [48, 114, 114]);
eq(distributeGaps(300, 6, 3, '2+2*3:1:1').gaps, [220.8, 27.6, 27.6]);
eq(distributeGaps(300, 6, 3, '1,5:1:0,5').gaps, [138, 92, 46]);
eq(distributeGaps(300, 6, 3, '50mm:100mm:126mm').gaps, [50, 100, 126]);
eq(distributeGaps(300, 6, 1, '288mm').gaps, [288]);
for (const input of ['300mm:1:1', '100mm:100mm:100mm', '50mm:50mm:50mm', '1:1', '1:1:0', '1:1:1/0', '1:1:2mm*2mm', '1:1:xyz', '1:1:(2+3', '1:1:1e4', '1:1:-1', '1:1:']) {
  assert.throws(() => distributeGaps(300, 6, 3, input), undefined, input);
}
for (let n = 1; n <= 25; n++) {
  const result = distributeGaps(1000, 3, n, defaultDistribution(n));
  const available = 1000 - 6 - (n-1)*3;
  eq(result.gaps, Array(n).fill(available / n));
  const expected = Array.from({ length: n-1 }, (_, i) => 3 + (i+1)*available/n + (i+0.5)*3);
  eq(result.centres, expected);
}
assert.throws(() => distributeGaps(10, 6, 3, '1:1:1'));
assert.throws(() => distributeGaps(300, 6, 0, ''));
assert.throws(() => distributeGaps(300, 6, 101, ''));
console.log('ok   Fingerbox: Fachverteilung, Rechenausdrücke und Eingabeprüfung');
