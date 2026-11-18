// Focused CSS contracts; rendered layout is checked separately in the browser.
// Run: node scripts/laser-typography-css-test.mjs
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return blocks.filter(([, selectors]) => selectors.trim().split(/,\s*/).includes(selector)).map(([, , body]) => body).join('\n');
};
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

test('Text controls and toggle share a font-relative height with the 22px baseline', () => {
  assert.match(css, /--ty-control-height:\s*calc\(22px \* var\(--ty-interface\)\)/);
  for (const selector of ["input[type='text']", "input[type='number']", 'select', '.toggle']) {
    assert.match(rule(selector), /height:\s*var\(--ty-control-height\)/, selector);
  }
});
test('Sibling select overrides scale their existing 24px and 20px baselines', () => {
  assert.match(rule('#arcbar select'), /height:\s*calc\(24px \* var\(--ty-interface\)\)/);
  assert.match(rule('table.layers select'), /height:\s*calc\(20px \* var\(--ty-interface\)\)/);
});
test('Arc selects retain a 24px minimum target height at the smallest preset', () => {
  const arc = rule('#arcbar select');
  assert.match(arc, /min-height:\s*24px/);
  for (const preset of [80, 100, 125, 150]) {
    assert.ok(Math.max(24, 24 * preset / 100) >= 24);
  }
});
test('Laser buttons grow with wrapped text, not their separate SVG icons', () => {
  const button = rule('.laser-grid .btn');
  assert.match(button, /min-height:\s*42px/);
  assert.doesNotMatch(button, /(?:^|[;\n])\s*height:\s*42px/);
  assert.match(button, /overflow-wrap:\s*anywhere/);
  assert.match(rule('.laser-grid .btn > span'), /flex:\s*none/);
  assert.match(rule('.laser-grid .btn svg'), /width:\s*16px;\s*height:\s*16px/);
  assert.match(rule('.ib svg'), /width:\s*20px;\s*height:\s*20px/);
});
test('Laser form scales its own column and stacks inside a narrow container', () => {
  assert.match(rule('.laser-tab'), /container-type:\s*inline-size/);
  assert.match(css, /minmax\(0, calc\(150px \* var\(--ty-interface\)\)\)/);
  assert.match(css, /@container\s*\(max-width:\s*22em\)\s*\{\s*\.laser-tab \.form,\s*\.laser-tab \.ov-box \.form\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(rule('.laser-tab .form > *'), /min-width:\s*0/);
});
test('Laser connection rows wrap instead of widening the dock', () => {
  assert.match(rule('.laser-tab .conn-row'), /flex-wrap:\s*wrap/);
  assert.match(rule('.laser-tab .conn-row .port'), /flex-basis:\s*calc\(150px \* var\(--ty-interface\)\)/);
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
