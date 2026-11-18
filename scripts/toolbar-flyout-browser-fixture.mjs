import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'artifacts/toolbar-flyout-browser';
await mkdir(out, { recursive: true });
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: String.raw`
import { ToolbarRenderer } from './src/toolbars/renderer';
import { ToolbarRegistry } from './src/toolbars/registry';
import { createState, DEFAULT_VIEW } from './src/toolbars/model';
import './src/style.css';

window.runToolbarFlyoutChecks = async () => {
  const passed = [], errors = [];
  const check = (value, name) => (value ? passed : errors).push(name);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const definitions = { bars: [{ id: 'bar', label: 'Bar', layout: DEFAULT_VIEW,
    items: [{ kind: 'group', id: 'group' }] }], groups: [{ id: 'group', label: 'Group', kind: 'flyout',
    items: [{ kind: 'action', id: 'one' }, { kind: 'action', id: 'two' }] }] };
  const state = createState(definitions), registry = new ToolbarRegistry(definitions);
  let runs = 0, menus = 0;
  registry.registerAction({ id: 'one', label: 'Horizontal spiegeln (Ctrl+Shift+H)', run() { runs++; } });
  registry.registerAction({ id: 'two', label: 'Second', run() { runs++; } });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:40px;top:60px;width:32px';
  host.addEventListener('contextmenu', () => menus++);
  document.body.append(host);
  const view = new ToolbarRenderer({ viewId: 'source', ownerId: 'bar', registry,
    getState: () => state, getItems: snapshot => snapshot.content.bars.bar });
  const pointer = (target, type) => target.dispatchEvent(new PointerEvent(type,
    { bubbles: true, cancelable: true, button: 0, pointerId: 31, isPrimary: true }));
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  try {
    view.mount(host);
    const main = host.querySelector('.ib-group button'), arrow = host.querySelector('.ib-more');
    pointer(main, 'pointerdown'); pointer(main, 'pointerup'); main.click();
    check(runs === 1 && !document.querySelector('.toolbar-popup'), 'short click activates current action');
    pointer(main, 'pointerdown'); await wait(390);
    check(!!document.querySelector('.toolbar-popup'), '350 ms primary hold opens flyout');
    pointer(main, 'pointerup'); main.click();
    check(runs === 1 && !!document.querySelector('.toolbar-popup'), 'release after hold neither activates nor closes');
    const popup = document.querySelector('.toolbar-popup'), anchor = main.parentElement.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    check(bounds.left >= anchor.right + 7 && Math.abs(bounds.top - (anchor.top - 1)) <= 1, 'flyout is beside whole button with eight pixel gap, including horizontal source');
    check(bounds.width >= 250 && popup.querySelectorAll('.toolbar-menu-item').length === 2 && !!popup.querySelector('kbd'), 'named icon/action rows retain shortcut and reference minimum width');
    const gripBounds = popup.querySelector('.toolbar-grip').getBoundingClientRect();
    const listBounds = popup.querySelector('.toolbar-menu-list').getBoundingClientRect();
    check(gripBounds.left >= listBounds.right - 1, 'tear-off grip is on the right: ' + JSON.stringify({ gripLeft: gripBounds.left, listRight: listBounds.right, display: getComputedStyle(popup).display }));
    const list = popup.querySelector('.toolbar-menu-list');
    check(popup.scrollWidth <= popup.clientWidth && popup.scrollHeight <= popup.clientHeight
      && list.scrollWidth <= list.clientWidth && list.scrollHeight <= list.clientHeight,
      'ordinary named flyout fits long labels and shortcuts without scrollbars');
    check(gripBounds.width >= 24 && Math.abs(gripBounds.top - listBounds.top) < 1
      && Math.abs(gripBounds.bottom - listBounds.bottom) < 1,
      'tear-off grip is a full-height right-edge target at least 24px wide');
    const gripMark = getComputedStyle(popup.querySelector('.toolbar-grip'), '::after');
    check(parseFloat(gripMark.width) <= gripBounds.width && parseFloat(gripMark.height) > parseFloat(gripMark.width),
      'right-edge tear-off marker is vertical and contained inside the grip');
    popup.style.minWidth = '0'; popup.style.maxWidth = '220px'; popup.style.maxHeight = '60px';
    check(list.scrollHeight > list.clientHeight && list.scrollWidth <= list.clientWidth
      && popup.scrollWidth <= popup.clientWidth && popup.scrollHeight <= popup.clientHeight,
      'bounded flyout scrolls its rows internally without horizontal or outer scrollbars');
    escape();
    check(!document.querySelector('.toolbar-popup') && document.activeElement === arrow, 'Escape closes and returns focus');
    main.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    check(!!document.querySelector('.toolbar-popup') && menus === 0, 'right click opens immediately without toolbar customization menu');
    escape();
    pointer(main, 'pointerdown'); window.dispatchEvent(new Event('blur')); await wait(390);
    check(!document.querySelector('.toolbar-popup'), 'focus loss cancels pending hold');
    pointer(main, 'pointerdown'); escape(); await wait(390);
    check(!document.querySelector('.toolbar-popup'), 'Escape cancels pending hold');
    host.style.left = (document.documentElement.clientWidth - 40) + 'px';
    arrow.click();
    const leftBounds = document.querySelector('.toolbar-popup').getBoundingClientRect();
    check(leftBounds.right <= host.getBoundingClientRect().left - 7 && leftBounds.left >= 0, 'right edge flyout flips toward available workspace');
    escape();
    pointer(main, 'pointerdown'); view.dispose(); await wait(390);
    check(!document.querySelector('.toolbar-popup'), 'dispose cancels hold and releases popup listeners');
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { view.dispose(); host.remove(); }
  return { passed, errors };
};
` },
  bundle: true, write: false, outfile: 'fixture.js', format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty' },
});
for (const file of result.outputFiles)
  await writeFile(`${out}/${file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'}`, file.contents);
await writeFile(`${out}/index.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Toolbar flyout interaction regression</title><link rel="stylesheet" href="fixture.css"><body><script type="module" src="fixture.js"></script></body></html>');
console.log(`Built ${out}/index.html; call window.runToolbarFlyoutChecks() in a native browser.`);
