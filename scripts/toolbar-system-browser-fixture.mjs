import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'artifacts/toolbar-system-browser';
await mkdir(out, { recursive: true });
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: String.raw`
import { initToolbars, disposeToolbars, refreshBars, toggleBar, showAllBars, openToolbarDialog, setToolbarControls } from './src/toolbars';
import { initToolbarFramework } from './src/toolbars/system';
import { DEFAULT_VIEW } from './src/toolbars/model';
import './src/style.css';

window.runToolbarSystemChecks = () => {
  const passed = [], errors = [];
  const check = (ok, name) => (ok ? passed : errors).push(name);
  const key = 'kizamubeam.toolbars', original = localStorage.getItem(key);
  const area = document.createElement('div');
  document.body.append(area);
  const makeHost = id => {
    const host = document.createElement('div'); host.id = id; area.append(host); return host;
  };
  const main = makeHost('toolbar'), tools = makeHost('tools');
  const numbar = makeHost('numbar'), textbar = makeHost('textbar');
  const palette = makeHost('palette'), status = makeHost('status');
  const paletteChild = document.createElement('button'), statusChild = document.createElement('span');
  palette.append(paletteChild); status.append(statusChild);
  const action = id => ({ kind: 'action', id });
  const group = id => ({ kind: 'group', id });
  let current;
  try {
    let runs = 0, enabled = true, active = false, dynamic = false, bundleDisposals = 0;
    const actions = [
      { id: 'one', cat: 'Test', label: 'One', icon: 'select', run: () => runs++, enabled: () => enabled,
        on: () => active, dyn: () => ({ icon: dynamic ? 'isolate' : 'select', label: dynamic ? 'Changed' : 'One' }) },
      { id: 'two', cat: 'Test', label: 'Two', run: () => runs++ },
      // Metadata only: this must never also be registered as a runnable action.
      { id: 'flyout', cat: 'Test', label: 'Flyout', items: ['one', 'two'], run: () => { throw Error('group metadata ran'); } },
    ];
    const defaults = { main: ['flyout', 'one'], tools: ['two'] };
    const legacy = JSON.stringify({ v: 14, bars: { main: ['flyout', 'missing', 'one'], tools: ['two'] },
      size: { main: 'l', tools: 's' }, hidden: ['plugin-hidden'], groups: { absent: 'unknown-choice' } });
    localStorage.setItem(key, legacy);
    initToolbars(actions, defaults);
    check(localStorage.getItem(key) === legacy, 'legacy load and real mount do not write');
    check(main.querySelector('.ib-group') !== null, 'legacy group resolves as group, not colliding action');
    toggleBar('main');
    const first = JSON.parse(localStorage.getItem(key));
    check(first.format === 'toolbar-layout' && first.state.content.bars.main[1].id === 'missing', 'first real facade write is native and retains unknown action order');
    check(first.state.content.choices.absent === 'unknown-choice' && first.state.layout.hidden.includes('plugin-hidden') && first.state.content.iconSizes.main === 'l', 'unknown choices/hidden and icon sizes survive facade cutover');
    showAllBars();

    const beforeRun = runs;
    initToolbars(actions, defaults); initToolbars(actions, defaults);
    check(main.querySelectorAll('[data-view]').length === 1, 'repeated init owns exactly one mounted view');
    main.querySelector('[data-action="one"]').click();
    check(runs === beforeRun + 1, 'repeated init action executes exactly once');
    enabled = false; refreshBars();
    const disabled = main.querySelector('[data-action="one"]'); disabled.click();
    disabled.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check(disabled.disabled && runs === beforeRun + 1, 'disabled native callbacks stay guarded');
    enabled = true; active = true; dynamic = true; refreshBars();
    check(main.querySelector('[data-action="one"]').getAttribute('aria-pressed') === 'true' && main.querySelector('[data-action="one"]').dataset.icon === 'isolate', 'active and dynamic icon state refresh through facade');

    // Context menus must resolve the top-level group wrapper, not its nested leaf.
    main.querySelector('.ib-group').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    check(document.querySelectorAll('.ctx-menu').length === 1, 'repeated init creates one owned context menu');
    const menuButtons = document.querySelectorAll('.ctx-menu button');
    menuButtons[1].click();
    check(JSON.parse(localStorage.getItem(key)).state.content.bars.main[0].id === 'missing', 'context removal targets top-level group index');
    tools.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    initToolbars(actions, defaults);
    check(!document.querySelector('.ctx-menu'), 'reinit disposes owned context popup');

    const controlsBundle = () => ({ definitions: { bars: [
      { id: 'numbar', label: 'Properties', layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 1, order: 0 } }, items: [] },
      { id: 'textbar', label: 'Text', layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 2, order: 0 } }, items: [] },
    ], groups: [] }, controls: [], dispose() { bundleDisposals++; } });
    setToolbarControls(controlsBundle());
    initToolbars(actions, defaults);
    check(bundleDisposals === 0, 'view reinit does not dispose control bundle owner');
    setToolbarControls(controlsBundle());
    check(bundleDisposals === 1, 'replacing control bundle disposes previous owner once');
    for (const id of ['main', 'tools', 'numbar', 'textbar', 'palette', 'status']) toggleBar(id);
    const hidden = JSON.parse(localStorage.getItem(key)).state.layout.hidden;
    check(['main', 'tools', 'numbar', 'textbar', 'palette', 'status'].every(id => hidden.includes(id)), 'all compatibility bars persist visibility through one runtime');
    check(palette.firstChild === paletteChild && status.firstChild === statusChild, 'palette/status visibility never replaces feature DOM');
    showAllBars();

    openToolbarDialog();
    const dialog = document.querySelector('.toolbar-dialog');
    check([...dialog.querySelectorAll('.tb-list')[1].querySelectorAll('.tb-row')].some(row => row.textContent.includes('missing')), 'customizer displays retained unknown ID, not a separator');
    const firstAvailable = dialog.querySelector('.tb-list .tb-row');
    firstAvailable.focus();
    firstAvailable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    check(document.activeElement?.classList.contains('tb-row') && document.activeElement.dataset.action === firstAvailable.dataset.action, 'keyboard selection retains focus on replacement available row');
    const firstCurrent = dialog.querySelectorAll('.tb-list')[1].querySelector('.tb-row');
    firstCurrent.focus();
    firstCurrent.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    check(document.activeElement?.classList.contains('tb-row') && dialog.contains(document.activeElement), 'keyboard current selection never loses focus');
    const selects = dialog.querySelectorAll('select');
    selects[1].value = 's'; selects[1].dispatchEvent(new Event('change'));
    check(JSON.parse(localStorage.getItem(key)).state.content.iconSizes.main === 's', 'customizer size operation writes native runtime');
    const buttons = [...dialog.querySelectorAll('.dialog-buttons button')];
    buttons[0].click();
    const reset = JSON.parse(localStorage.getItem(key));
    check(reset.state.content.bars.main.map(item => item.id).join(',') === 'flyout,one' && reset.state.content.iconSizes.main === 's', 'customizer resets content separately and preserves icon size');
    check([...selects[0].options].map(option => option.value).join(',') === 'main,tools,numbar,textbar', 'customizer addresses all rendered toolbar definitions');
    check(dialog.querySelector('select[aria-label]') === null && selects.length === 2, 'customizer has no orientation selector');
    const memberRows = () => dialog.querySelectorAll('.tb-list')[1];
    const memberIds = () => JSON.parse(localStorage.getItem(key)).state.content.groups.flyout.items.map(item => item.id).join(',');
    const groupCommands = dialog.querySelectorAll('.tb-btns button');
    check(memberRows().querySelector('[data-group="flyout"] .tb-icon').textContent === '▾' &&
      memberRows().querySelectorAll('[data-child]').length === 2 && !memberRows().querySelector('.tb-readonly'),
      'built-in group uses the same named header and editable child rows as custom groups');
    memberRows().querySelector('[data-child="0"]').click();
    groupCommands[3].click();
    check(memberIds() === 'two' && memberRows().querySelector('[data-index="1"]:not([data-child])'), 'native outdent edits built-in group without replacing its identity');
    memberRows().querySelector('[data-index="1"]:not([data-child])').click();
    groupCommands[2].click();
    check(memberIds() === 'two,one', 'native indent adds an action back to the built-in group');
    groupCommands[0].click();
    check(memberIds() === 'one,two', 'native reorder updates built-in members');
    memberRows().querySelector('[data-child="0"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    check(memberIds() === 'two', 'native removal edits a built-in member rather than its whole group');
    buttons[0].click();
    check(memberIds() === 'one,two' && JSON.parse(localStorage.getItem(key)).state.content.bars.main.map(item => item.id).join(',') === 'flyout,one',
      'native per-bar default restores original built-in membership and reference');
    const counts = dialog.querySelectorAll('input[type="number"]');
    counts[0].value = '2'; counts[0].dispatchEvent(new Event('change'));
    counts[1].value = '3'; counts[1].dispatchEvent(new Event('change'));
    let custom = JSON.parse(localStorage.getItem(key));
    check(custom.state.layout.bars.main.rows === 2 && custom.state.layout.bars.main.columns === 3, 'customizer commits explicit row/column counts');
    counts[0].value = '0'; counts[0].dispatchEvent(new Event('change'));
    check(counts[0].value === '2', 'invalid row count restores current value');
    const layoutLock = dialog.querySelectorAll('input[type="checkbox"]')[1];
    layoutLock.click();
    const lockedBytes = localStorage.getItem(key);
    counts[0].value = '4'; counts[0].dispatchEvent(new Event('change'));
    check(counts[0].disabled && counts[1].disabled && localStorage.getItem(key) === lockedBytes, 'global lock disables and rejects layout edits');
    layoutLock.click();
    buttons[1].click();
    custom = JSON.parse(localStorage.getItem(key));
    check(custom.state.layout.bars.main.orientation === 'horizontal' && custom.state.layout.bars.main.rows === 1 && custom.state.content.iconSizes.main === 's' && custom.state.content.bars.main.map(item => item.id).join(',') === 'flyout,one', 'layout reset preserves contents and icon sizes');
    counts[0].value = '2'; counts[0].dispatchEvent(new Event('change'));
    buttons[2].click();
    custom = JSON.parse(localStorage.getItem(key));
    check(custom.state.layout.bars.main.rows === 2 && custom.state.content.iconSizes.main === 's', 'explicit all-content reset preserves layout and icon sizes');
    dialog.close();
    disposeToolbars();
    check(bundleDisposals === 2 && main.querySelector('[data-view]') === null, 'shutdown disposes bundle and views');

    // Generic arbitrary names, inline section/control and shared flyout source + secondary view.
    const owner = makeHost('arbitrary-host'), secondary = makeHost('secondary-host');
    let controlMounts = 0, controlDisposals = 0, controlRuns = 0;
    const contexts = [];
    const definitions = { bars: [{ id: 'plugin:bar', label: 'Arbitrary bar', layout: DEFAULT_VIEW,
      items: [group('plugin:section'), group('plugin:flyout')] }], groups: [
      { id: 'plugin:section', label: 'Section', kind: 'section', items: [{ kind: 'control', id: 'plugin:input' }] },
      { id: 'plugin:flyout', label: 'Choices', kind: 'flyout', items: [action('one'), action('two')] },
    ] };
    localStorage.removeItem(key);
    current = initToolbarFramework({ definitions, actions: actions.filter(a => !a.items),
      storage: localStorage,
      hosts: new Map([['source', { ownerId: 'plugin:bar', element: owner }],
        ['secondary', { ownerId: 'plugin:bar', groupId: 'plugin:flyout', element: secondary }]]),
      controls: [{ id: 'plugin:input', label: 'Input', create(context) {
        contexts.push(context);
        let input;
        return { mount(host) { controlMounts++; input = document.createElement('button'); input.textContent = 'Input';
          input.id = context.id('input'); input.onclick = () => { if (context.isAvailable()) controlRuns++; }; host.append(input); },
          update() {}, activate() { if (context.isAvailable()) controlRuns++; }, dispose() { controlDisposals++; input.remove(); } };
      } }],
    });
    check(owner.querySelector('.toolbar-section button') && controlMounts === 1, 'generic arbitrary bar/section/control mounts without main/tools special cases');
    active = false; current.refresh();
    secondary.querySelector('[data-action="two"]').click();
    check(current.runtime.read().content.choices['plugin:flyout'] === 'two' && owner.querySelector('.ib-group [data-cur]').dataset.cur === 'two', 'secondary choice updates same source group through shared runtime subscription');
    current.runtime.choose('plugin:flyout', 'one');
    check(owner.querySelector('.ib-group [data-cur]').dataset.cur === 'one', 'runtime choice refreshes all views');
    current.runtime.layout({ kind: 'visibility', barId: 'plugin:bar', visible: false });
    check(owner.hidden && secondary.hidden && current.runtime.read().layout.hidden.includes('plugin:bar'), 'arbitrary registered bar visibility updates every view');
    current.runtime.layout({ kind: 'visibility', barId: 'plugin:bar', visible: true });
    current.runtime.lock(true);
    const layout = JSON.stringify(current.runtime.read().layout);
    current.refresh(); current.refresh();
    check(JSON.stringify(current.runtime.read().layout) === layout && current.runtime.read().layout.locked, 'refresh preserves geometry and layout lock');
    const stale = owner.querySelector('.toolbar-section button');
    current.dispose(); stale.click();
    check(controlDisposals === 1 && controlRuns === 0 && contexts.every(context => !context.isAvailable()), 'shutdown invalidates stale native controls and disposes once');
    current = undefined;

    // Floating torn-off groups: detach commit, close, raise, lock blocks grip tear, grip tear path, ESC abort, owner-hidden.
    const floatOwner = makeHost('float-owner');
    current = initToolbarFramework({ definitions: { bars: [{ id: 'float:bar', label: 'Float bar', layout: DEFAULT_VIEW,
      items: [group('float:flyout')] }], groups: [
      { id: 'float:flyout', label: 'Floater', kind: 'flyout', items: [action('one'), action('two')] },
    ] }, actions: actions.filter(a => !a.items), storage: localStorage,
      hosts: new Map([['floatsource', { ownerId: 'float:bar', element: floatOwner }]]) });
    check(document.querySelector('.toolbar-float') === null, 'no float before detach');
    current.runtime.lock(false);
    check(!current.runtime.read().layout.locked, 'lock is explicit after persisted lock from earlier suite');
    check(current.runtime.layout({ kind: 'detach', ownerId: 'float:bar', groupId: 'float:flyout',
      view: { ...DEFAULT_VIEW, placement: { kind: 'floating', x: 60, y: 70 } } }).ok, 'detach layout op commits');
    const float = document.querySelector('.toolbar-float');
    check(!!float && float.querySelector('.toolbar-float-title').textContent === 'Floater' && !!float.querySelector('.toolbar-float-close'), 'detach renders float shell with title and close');
    check(Math.abs(float.offsetLeft - 60) <= 2 && Math.abs(float.offsetTop - 70) <= 2, 'float position follows committed placement');
    check(float.querySelectorAll('button[data-action]').length === 2 && float.querySelector('.toolbar-menu-item') === null, 'float renders group leaves as compact icon strip');
    float.querySelector('.toolbar-float-close').click();
    check(document.querySelector('.toolbar-float') === null && Object.keys(current.runtime.read().layout.detached).length === 0, 'close removes float and detached state');
    current.runtime.layout({ kind: 'detach', ownerId: 'float:bar', groupId: 'float:flyout',
      view: { ...DEFAULT_VIEW, placement: { kind: 'floating', x: 120, y: 130 } } });
    const raised = document.querySelector('.toolbar-float');
    floatOwner.querySelector('.ib-group button').click();
    check(raised.classList.contains('flash') && !document.querySelector('.toolbar-popup'), 'source primary click raises torn-off float instead of popup');
    raised.querySelector('.toolbar-float-close').click();
    current.runtime.lock(true);
    floatOwner.querySelector('.ib-more').click();
    const gripMenu = document.querySelector('.toolbar-popup');
    check(!!gripMenu && !!gripMenu.querySelector('.toolbar-grip'), 'arrow opens popup with grip while attached');
    const grip = gripMenu.querySelector('.toolbar-grip');
    const press = (x, y, id) => grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: id, clientX: x, clientY: y }));
    const slide = (x, y, id) => document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: id, clientX: x, clientY: y }));
    const release = (x, y, id) => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: id, clientX: x, clientY: y }));
    press(200, 200, 7); slide(220, 200, 7); release(220, 200, 7);
    check(Object.keys(current.runtime.read().layout.detached).length === 0 && document.querySelectorAll('.toolbar-float').length === 0, 'locked layout blocks grip tear-off without float residue');
    current.runtime.lock(false);
    press(200, 200, 7); slide(230, 200, 7); release(230, 200, 7);
    const torn = document.querySelector('.toolbar-float');
    check(!!torn && Object.keys(current.runtime.read().layout.detached).length === 1, 'grip drag past threshold detaches and floats');
    torn.querySelector('.toolbar-float-close').click();
    floatOwner.querySelector('.ib-more').click();
    const abortGrip = document.querySelector('.toolbar-popup').querySelector('.toolbar-grip');
    abortGrip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 9, clientX: 200, clientY: 200 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 9, clientX: 202, clientY: 200 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 9, clientX: 202, clientY: 200 }));
    check(Object.keys(current.runtime.read().layout.detached).length === 0, 'escape aborts grip drag without detach');
    current.runtime.layout({ kind: 'detach', ownerId: 'float:bar', groupId: 'float:flyout',
      view: { ...DEFAULT_VIEW, placement: { kind: 'floating', x: 140, y: 150 } } });
    const owned = document.querySelector('.toolbar-float');
    current.runtime.layout({ kind: 'visibility', barId: 'float:bar', visible: false });
    check(owned.style.display === 'none', 'owner-hidden hides float');
    current.runtime.layout({ kind: 'visibility', barId: 'float:bar', visible: true });
    check(owned.style.display !== 'none', 'owner reshow reveals float');
    current.dispose(); current = undefined;

    for (const future of ['{"format":"toolbar-layout","version":999,"state":{"future":true}}', '{"v":15,"bars":{"main":["future"]}}', '{broken']) {
      localStorage.setItem(key, future);
      initToolbars(actions, defaults); toggleBar('main'); openToolbarDialog();
      document.querySelector('.toolbar-dialog .dialog-buttons button').click();
      refreshBars();
      check(localStorage.getItem(key) === future, 'future/invalid original bytes survive fallback customization: ' + future);
      disposeToolbars();
    }
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally {
    current?.dispose(); disposeToolbars(); area.remove();
    if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original);
  }
  return { passed, errors };
};

window.runToolbarDialogLifecycleChecks = async () => {
  const passed = [], errors = [];
  const key = 'kizamubeam.toolbars', original = localStorage.getItem(key);
  const area = document.createElement('div');
  for (const id of ['toolbar', 'tools']) { const host = document.createElement('div'); host.id = id; area.append(host); }
  document.body.append(area);
  try {
    localStorage.removeItem(key);
    initToolbars([{ id: 'one', cat: 'Test', label: 'One', run() {} }], { main: ['one'], tools: [] });
    openToolbarDialog(); const old = document.querySelector('.toolbar-dialog');
    openToolbarDialog(); const current = document.querySelector('.toolbar-dialog');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (current !== old && current.open && !old.isConnected) passed.push('replacement dialog survives queued close event');
    else errors.push('replacement dialog ownership');
    disposeToolbars();
    if (!document.querySelector('.toolbar-dialog')) passed.push('teardown owns replacement dialog after queued old close');
    else errors.push('replacement dialog leaked after teardown');
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { disposeToolbars(); area.remove(); if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original); }
  return { passed, errors };
};
` },
  bundle: true, write: false, outfile: 'fixture.js', format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty' },
});
for (const file of result.outputFiles)
  await writeFile(`${out}/${file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'}`, file.contents);
await writeFile(`${out}/index.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Toolbar system regression fixture</title><link rel="stylesheet" href="fixture.css"><body><script type="module" src="fixture.js"></script></body></html>');
console.log(`Built ${out}/index.html; call window.runToolbarSystemChecks() in a native browser.`);
