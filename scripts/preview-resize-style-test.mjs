import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`) === -1
    ? css.indexOf(`${selector},`)
    : css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

test('preview splitter keeps a 24px target around a single app-line divider', () => {
  const split = rule('.preview-splitter');
  assert.match(split, /flex: 0 0 24px/);
  assert.match(split, /var\(--line\) 11px 12px/);
  assert.doesNotMatch(rule('.preview-side'), /border-left:/);
});

test('preview divider uses the dock accent on hover and keyboard focus', () => {
  assert.match(css, /\.preview-splitter:hover,\s*\.preview-splitter:focus-visible\s*\{[^}]*var\(--accent\)/);
});

test('preview grip retains a 24px target but the established 12px idle decoration', () => {
  const grip = rule("dialog[data-dialog-resize='true'] > .dlg-grip");
  assert.match(grip, /width: 24px/);
  assert.match(grip, /height: 24px/);
  assert.match(grip, /background-size: 12px 12px/);
  assert.match(grip, /background-position: right bottom/);
  assert.match(grip, /background-repeat: no-repeat/);
  assert.doesNotMatch(grip, /opacity:/);
});

test('preview keyboard focus remains visible without weakening the shared outline', () => {
  assert.match(rule("dialog[data-dialog-resize='true'] > .dlg-grip:focus-visible"), /outline: 2px solid var\(--text\)/);
  assert.match(rule("dialog[data-dialog-resize='true'] > .dlg-grip:focus-visible"), /opacity: 1/);
});
