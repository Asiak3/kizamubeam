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

test('preview timeline markers expose a 24 by 24 px target', () => {
  const marker = rule('.preview-marker');
  assert.match(marker, /width: 24px/);
  assert.match(marker, /height: 24px/);
});

test('preview process-change markers differ in shape, not only colour', () => {
  const normal = rule('.preview-marker::before');
  const change = rule('.preview-marker.change::before');
  assert.match(normal, /width: 2px/);
  assert.match(normal, /height: 8px/);
  assert.match(change, /width: 4px/);
  assert.match(change, /height: 12px/);
});

const channel = (h) => { const v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => 0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7));
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('preview marker ticks keep the 3:1 contrast floor at rest in both themes', () => {
  const muted = [...css.matchAll(/--muted:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  const surface = [...css.matchAll(/--surface:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(muted.length >= 2 && surface.length >= 2, 'Theme tokens are present');
  assert.match(rule('.preview-marker::before'), /opacity: 1/);
  assert.ok(contrast(muted[0], surface[0]) >= 3, `light marker contrast ${contrast(muted[0], surface[0]).toFixed(2)}`);
  assert.ok(contrast(muted[1], surface[1]) >= 3, `dark marker contrast ${contrast(muted[1], surface[1]).toFixed(2)}`);
});

test('dense preview markers are visual ticks only', () => {
  assert.match(rule('.preview-marker.static'), /pointer-events: none/);
});
