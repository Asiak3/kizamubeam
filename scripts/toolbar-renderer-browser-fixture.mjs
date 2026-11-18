import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'artifacts/toolbar-framework-browser';
await mkdir(out, { recursive: true });
const result = await build({
  stdin: {
    resolveDir: process.cwd(), loader: 'ts', contents: String.raw`
import { ToolbarRegistry } from './src/toolbars/registry';
import { ToolbarRenderer } from './src/toolbars/renderer';
import { createState, DEFAULT_VIEW, ownEntry, setEntry } from './src/toolbars/model';
import './src/style.css';

window.runToolbarRendererChecks = () => {
  const errors = [], passed = [];
  const check = (ok, name) => (ok ? passed : errors).push(name);
  const area = document.createElement('div');
  document.body.append(area);
  const views = [];
  let mounts = 0, disposals = 0, controlActivations = 0;
  let runs = 0, choiceCalls = 0, enabled = true, active = false, dynamic = false;
  const strange = '__proto__', groupId = 'g"[x]#', controlId = 'input"[id]';
  const action = id => ({ kind: 'action', id });
  const control = { kind: 'control', id: controlId };
  const definitions = {
    bars: [{ id: 'owner', label: 'Owner', layout: DEFAULT_VIEW, items: [
      { kind: 'group', id: groupId }, { kind: 'group', id: 'section' },
      { kind: 'group', id: 'unknown-only' }, { kind: 'group', id: 'empty' },
      { kind: 'group', id: 'missing-group' }, { kind: 'legacy', id: 'missing-legacy' },
      { kind: 'control', id: 'missing-control' },
    ] }],
    groups: [
      { id: groupId, label: 'Drawing', kind: 'flyout', items: [action(strange), action('other'), action('small'), control, { kind: 'separator' }, action('missing')] },
      { id: 'section', label: 'Inline', kind: 'section', items: [control, action('other')] },
      { id: 'unknown-only', label: 'Unknown', kind: 'flyout', items: [action('absent')] },
      { id: 'empty', label: 'Empty', kind: 'flyout', items: [] },
    ],
  };
  let state = createState(definitions);
  setEntry(state.content.choices, groupId, 'other');
  const registry = new ToolbarRegistry(definitions);
  registry.registerAction({ id: strange, label: 'Prototype action', icon: 'select',
    run: () => runs++, enabled: () => enabled, on: () => active,
    dyn: () => ({ icon: dynamic ? 'isolate' : 'select', label: dynamic ? 'Changed' : 'Prototype action' }),
  });
  registry.registerAction({ id: 'other', label: 'Other', run: () => runs++ });
  registry.registerAction({ id: 'small', label: 'Options', small: true, run: () => runs++ });
  const opaqueActions = ['constructor', 'toString', 'action"[id]#'];
  for (const id of opaqueActions) {
    registry.registerAction({ id, label: id, run: () => runs++ });
    ownEntry(state.content.groups, groupId).items.push(action(id));
  }
  registry.registerAction({ id: 'keys', label: 'Keys demo (Ctrl+K)', run: () => runs++ });
  ownEntry(state.content.groups, groupId).items.push(action('keys'));
  registry.registerControl({ id: controlId, label: 'Draft', create(context) {
    let host, input, label;
    const instance = {
      mount(target) {
        mounts++;
        host = target;
        label = document.createElement('label'); label.textContent = 'Draft';
        input = document.createElement('input'); input.type = 'text';
        input.id = context.id('__proto__'); label.htmlFor = input.id;
        check(context.id('__proto__') === input.id, 'stable per-instance helper ID ' + input.id);
        input.dataset.instance = context.instanceId;
        input.value = 'committed';
        host.append(label, input);
      },
      update(snapshot) { if (document.activeElement !== input && input.value === 'committed') input.value = 'committed'; },
      activate(intent) { controlActivations++; },
      dispose() { disposals++; host.replaceChildren(); },
    };
    return instance;
  } });
  const refresh = () => views.forEach(view => view.update());
  const choose = (group, id) => { choiceCalls++; setEntry(state.content.choices, group, id); refresh(); };
  const mount = (viewId, detached = false) => {
    const host = document.createElement('div'); area.append(host);
    const view = new ToolbarRenderer({ viewId, ownerId: 'owner', groupId: detached ? groupId : undefined,
      registry, getState: () => state, choose,
      getItems: snapshot => detached ? ownEntry(snapshot.content.groups, groupId)?.items ?? [] : ownEntry(snapshot.content.bars, 'owner') ?? [],
    });
    views.push(view); view.mount(host); return { view, host };
  };
  const buttons = host => [...host.querySelectorAll('button[data-action]')];
  const button = (host, id) => buttons(host).find(node => node.dataset.action === id);
  const group = (host, id) => [...host.querySelectorAll('[data-action]')].find(node => node.dataset.action === id && node.classList.contains('ib-group'));
  const arrow = (host, id = groupId) => group(host, id).querySelector('.ib-more');
  const primary = host => group(host, groupId).querySelector('button');
  const popup = host => document.getElementById(arrow(host).getAttribute('aria-controls'));
  const before = JSON.stringify(state);
  try {
    const source = mount('source"[id]'), a = mount('detached-a', true), b = mount('detached-b', true);
    check(JSON.stringify(state) === before, 'mount and updates do not mutate persisted state');
    check(a.host.querySelector('input') !== b.host.querySelector('input'), 'two same-group views own separate control DOM');
    const allIds = [...area.querySelectorAll('[id]')].map(node => node.id);
    check(new Set(allIds).size === allIds.length, 'all view/control/helper IDs unique');
    check(area.querySelectorAll('label').length === 3 && [...area.querySelectorAll('label')].every(label => area.contains(document.getElementById(label.htmlFor))), 'control labels reference per-instance inputs');
    check(primary(source.host).dataset.cur === 'other', 'saved choice selected initially');
    active = true; dynamic = true; refresh();
    check(primary(source.host).dataset.cur === strange && primary(source.host).getAttribute('aria-pressed') === 'true', 'active non-small action overrides saved choice');
    check([primary(source.host), button(a.host, strange), button(b.host, strange)].every(node => node.dataset.icon === 'isolate' && node.title === 'Changed' && node.querySelector('svg')), 'dynamic icons and labels synchronize through existing callbacks');
    enabled = false; refresh();
    check([primary(source.host), button(a.host, strange), button(b.host, strange)].every(node => node.disabled), 'enabled state synchronizes all views');
    enabled = true; active = false; refresh();
    const input = a.host.querySelector('input'); input.focus(); input.value = 'uncommitted draft'; input.setSelectionRange(3, 9);
    refresh();
    check(document.activeElement === input && input.value === 'uncommitted draft' && input.selectionStart === 3 && input.selectionEnd === 9, 'focused input draft and caret survive update');
    const content = ownEntry(state.content.groups, groupId);
    content.items = [control, ...content.items.filter(leaf => leaf !== control)]; refresh();
    check(a.host.querySelector('input') === input && document.activeElement === input && input.selectionStart === 3 && input.selectionEnd === 9 && input.value === 'uncommitted draft', 'keyed reorder preserves input identity focus draft and selection');
    check(a.view.activate({ kind: 'control', instanceId: input.dataset.instance, intent: 'focus' }) && controlActivations === 1, 'control activate routes exactly once to owned instance');
    check(!b.view.activate({ kind: 'control', instanceId: input.dataset.instance }), 'control instances cannot be activated through another view');
    let n = runs, c = choiceCalls;
    button(a.host, strange).click();
    check(runs === n + 1 && choiceCalls === c + 1, 'detached action activation runs and chooses exactly once');
    check(ownEntry(state.content.choices, groupId) === strange && primary(source.host).dataset.cur === strange, 'detached choice synchronizes source and shared state');
    n = runs; c = choiceCalls; button(b.host, 'small').click();
    check(runs === n + 1 && choiceCalls === c && ownEntry(state.content.choices, groupId) === strange, 'small options never become remembered choice');
    enabled = false; n = runs;
    // The DOM still looks enabled here; predicate changed after the last refresh.
    button(a.host, strange).click();
    check(runs === n && !a.view.activate({ kind: 'action', id: strange, groupId }), 'late enabled predicate blocks stale button and imperative activation');
    enabled = true; refresh();
    check(source.host.querySelector('.toolbar-section input') && source.host.querySelector('.toolbar-section button[data-action]'), 'section renders leaves inline with common controls and actions');
    check(arrow(source.host, 'unknown-only').disabled && arrow(source.host, 'empty').disabled, 'unknown-only and empty flyouts are safely inert');
    check([...area.querySelectorAll('[data-unresolved="true"]')].length >= 5 && ownEntry(state.content.groups, 'unknown-only').items[0].id === 'absent', 'unknown groups and leaf references retained without active placeholders');
    check(!source.view.activate({ kind: 'action', id: 'missing' }), 'missing actions are inert');
    n = runs;
    for (const id of opaqueActions) button(b.host, id).click();
    check(runs === n + opaqueActions.length && primary(source.host).dataset.cur === opaqueActions.at(-1), 'prototype-member and selector-like action IDs resolve and activate through Maps');
    arrow(source.host).focus(); arrow(source.host).click();
    let menu = popup(source.host);
    check(menu?.getAttribute('role') === 'dialog' && menu.querySelector('input') && button(menu, strange) && menu.querySelector('.sep'), 'flyout popup renders the same action control and separator leaves');
    const popupInput = menu.querySelector('input'); popupInput.focus(); popupInput.value = 'popup draft'; popupInput.setSelectionRange(2, 5); refresh();
    check(popup(source.host) === menu && document.activeElement === popupInput && popupInput.value === 'popup draft' && popupInput.selectionStart === 2, 'open popup also preserves control drafts on update');
    const popupIds = [...document.querySelectorAll('[id]')].map(node => node.id);
    check(new Set(popupIds).size === popupIds.length, 'popup IDs do not collide with source or detached controls');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    check(!menu.isConnected && document.activeElement === arrow(source.host) && arrow(source.host).getAttribute('aria-expanded') === 'false', 'Escape closes owned popup and restores arrow focus');
    arrow(source.host).click(); menu = popup(source.host); n = runs; c = choiceCalls;
    button(menu, 'other').click();
    check(runs === n + 1 && choiceCalls === c + 1 && !menu.isConnected && primary(source.host).dataset.cur === 'other', 'popup activation executes once closes popup and synchronizes choice');
    arrow(source.host).click(); menu = popup(source.host);
    check(menu?.classList.contains('toolbar-menu'), 'popup carries menu styling hook');
    const rows = [...menu.querySelectorAll('button.toolbar-menu-item')];
    check(rows.length > 0 && rows.every(row => row.querySelector('.menu-label')?.textContent?.trim()), 'every popup row shows a text label');
    check(rows.find(row => row.dataset.action === 'keys')?.querySelector('kbd')?.textContent === 'Ctrl+K', 'shortcut suffix renders as kbd hint');
    check(rows.find(row => row.dataset.action === 'other')?.querySelector('.menu-check')?.textContent === '✓', 'remembered choice is marked in the popup');
    const menuSep = menu.querySelector('.sep');
    check(!!menuSep && menuSep.getBoundingClientRect().height <= 2 && menuSep.getBoundingClientRect().width > 40, 'popup separator renders as a horizontal rule');
    check(!menu.querySelector('[data-unresolved=\"true\"]'), 'popup renders no blank unresolved rows');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    arrow(source.host).click(); menu = popup(source.host);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    check(!menu.isConnected && document.activeElement === arrow(source.host), 'outside pointer closes popup and restores focus');
    const counts = { add: 0, remove: 0 };
    const add = document.addEventListener, remove = document.removeEventListener;
    document.addEventListener = function(type, ...args) { if (type === 'pointerdown' || type === 'keydown') counts.add++; return add.call(this, type, ...args); };
    document.removeEventListener = function(type, ...args) { if (type === 'pointerdown' || type === 'keydown') counts.remove++; return remove.call(this, type, ...args); };
    try {
      arrow(source.host).click(); menu = popup(source.host);
      source.view.dispose();
      check(!menu.isConnected && counts.add === 2 && counts.remove === 2, 'dispose removes owned popup and both document listeners');
      source.view.mount(source.host); arrow(source.host).click(); menu = popup(source.host);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      check(!menu.isConnected && counts.add === 4 && counts.remove === 4 && document.activeElement === arrow(source.host), 'remount installs only one clean popup lifecycle');
    } finally { document.addEventListener = add; document.removeEventListener = remove; }
    registry.unregisterAction(strange); refresh();
    check(!button(a.host, strange) && a.host.querySelector('input') === input, 'explicit registry update removes action without replacing neighboring control');
    registry.unregisterControl(controlId); refresh();
    check(!area.querySelector('input'), 'unregister disposes each control instance');
    check(ownEntry(state.content.groups, groupId).items.some(leaf => leaf.id === strange), 'unregistration never prunes persisted references');
    const immutable = JSON.stringify(state); refresh();
    check(JSON.stringify(state) === immutable, 'render remains state-pure after registry changes');
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { views.forEach(view => view.dispose()); area.remove(); }
  check(mounts === disposals, 'all mounted control instances disposed exactly once');
  // Regression: persisted group data is not proof that its plugin is registered.
  const regressionArea = document.createElement('div'); document.body.append(regressionArea);
  const regressionViews = [];
  try {
    const id = '__proto__"[group]', shared = 'shared';
    const defs = { bars: [{ id: 'owner', label: 'Owner', layout: DEFAULT_VIEW,
      items: [{ kind: 'group', id }] }], groups: [
      { id, label: 'Plugin group', kind: 'flyout', items: [action(shared), control] },
    ] };
    const snapshot = createState(defs), saved = JSON.stringify(snapshot);
    const reg = new ToolbarRegistry({ groups: [] });
    let calls = 0, controlCalls = 0, created = 0, disposed = 0, available = true;
    reg.registerAction({ id: shared, label: 'Shared', run: () => calls++ });
    reg.registerControl({ id: controlId, label: 'Control', create(context) {
      let input;
      return { mount(host) { created++; input = document.createElement('input'); input.id = context.id('input'); input.dataset.instance = context.instanceId; host.append(input); },
        update() {}, activate() { controlCalls++; }, dispose() { disposed++; input.remove(); } };
    } });
    const make = detached => {
      const host = document.createElement('div'); regressionArea.append(host);
      const view = new ToolbarRenderer({ viewId: 'regression-' + regressionViews.length, ownerId: 'owner',
        groupId: detached ? id : undefined, registry: reg, getState: () => snapshot,
        getItems: state => detached ? ownEntry(state.content.groups, id).items : state.content.bars.owner });
      view.mount(host); regressionViews.push(view); return { host, view };
    };
    const source = make(false), detached = make(true);
    source.view.activate({ kind: 'group', id });
    detached.view.activate({ kind: 'action', id: shared });
    check(calls === 0 && !source.host.querySelector('button') && !detached.host.querySelector('button,input'), 'persisted unregistered group is inert in source and detached views despite known shared actions');
    const legacyDefs = { ...defs, bars: [{ ...defs.bars[0], items: [{ kind: 'legacy', id }] }] };
    const legacyState = createState(legacyDefs), legacyRegistry = new ToolbarRegistry(defs);
    legacyRegistry.registerAction({ id: shared, label: 'Shared', run: () => calls++ });
    const legacyHost = document.createElement('div'); regressionArea.append(legacyHost);
    const legacy = new ToolbarRenderer({ viewId: 'legacy', ownerId: 'owner', registry: legacyRegistry,
      getState: () => legacyState, getItems: state => state.content.bars.owner });
    regressionViews.push(legacy); legacy.mount(legacyHost);
    check(!!legacyHost.querySelector('button'), 'registered group resolves a retained legacy reference without changing persisted kind');
    const registration = { id, label: 'Plugin group', enabled: () => available };
    reg.registerGroup(registration);
    const refreshGroups = () => regressionViews.forEach(view => view.update());
    refreshGroups();
    check(!!source.host.querySelector('button') && !!detached.host.querySelector('input'), 'late group registration restores source and detached content');
    const sourceRoot = source.host.firstElementChild, detachedInput = detached.host.querySelector('input');
    reg.registerGroup({ ...registration, label: 'Renamed plugin group' }); refreshGroups();
    check(source.host.firstElementChild === sourceRoot && detached.host.querySelector('input') === detachedInput && source.host.querySelector('[role="group"][aria-label="Renamed plugin group"]'), 'compatible group metadata update retains DOM and updates label');
    const open = () => { source.host.querySelector('.ib-more').click(); return document.getElementById(source.host.querySelector('.ib-more').getAttribute('aria-controls')); };
    let menu = open();
    check(menu.querySelector('input') !== detachedInput, 'restored source popup and detached group own independent DOM');
    const stalePrimary = source.host.querySelector('button'), staleLeaf = button(detached.host, shared), stalePopup = button(menu, shared);
    const staleControl = menu.querySelector('input').dataset.instance;
    available = false;
    stalePrimary.click(); staleLeaf.click(); stalePopup.click();
    source.view.activate({ kind: 'control', instanceId: staleControl });
    detached.view.activate({ kind: 'control', instanceId: detachedInput.dataset.instance });
    check(calls === 0 && controlCalls === 0, 'disabled group rejects stale source detached popup and control activation before update');
    refreshGroups();
    check(!menu.isConnected && !source.host.querySelector('button') && !detached.host.querySelector('input'), 'disabling group disposes popup and mounted group controls');
    available = true; refreshGroups(); menu = open();
    const oldPrimary = source.host.querySelector('button'), oldLeaf = button(detached.host, shared), oldPopup = button(menu, shared);
    reg.unregisterGroup(id);
    oldPrimary.click(); oldLeaf.click(); oldPopup.click();
    detached.view.activate({ kind: 'action', id: shared });
    check(calls === 0, 'unregistered group rejects all stale group activations before update');
    refreshGroups();
    check(!menu.isConnected && !source.host.querySelector('button') && !detached.host.querySelector('input'), 'unregister removes group DOM and owned popup');
    reg.registerGroup(registration); refreshGroups(); button(detached.host, shared).click();
    check(calls === 1 && JSON.stringify(snapshot) === saved, 're-registration restores original persisted refs without data loss or render writes');
    legacyRegistry.unregisterGroup(id); legacy.update();
    check(!legacyHost.querySelector('button') && legacyState.content.bars.owner[0].kind === 'legacy', 'legacy group unregister becomes inert without rewriting reference');
    legacyRegistry.registerGroup(registration); legacy.update();
    check(!!legacyHost.querySelector('button'), 'legacy group re-registration restores rendering');
    const oldLegacyPrimary = legacyHost.querySelector('button'), beforeCollision = calls;
    legacyRegistry.registerAction({ id, label: 'Collision', run: () => calls++ });
    oldLegacyPrimary.click();
    check(calls === beforeCollision, 'legacy group stale primary cannot activate after cross-kind collision');
    legacy.update();
    check(!legacyHost.querySelector('button'), 'ambiguous legacy action-group IDs are inert instead of silently changing kind');
    legacyRegistry.unregisterAction(id); legacy.update();
    check(!!legacyHost.querySelector('button'), 'removing ambiguous registration restores legacy group');
    let collisionDisposals = 0;
    legacyRegistry.registerControl({ id, label: 'Collision control', create() {
      let input;
      return { mount(host) { input = document.createElement('input'); host.append(input); }, update() {}, activate() {},
        dispose() { collisionDisposals++; input.remove(); } };
    } }); legacy.update();
    check(!legacyHost.querySelector('button,input'), 'legacy control-group collision is inert');
    legacyRegistry.registerAction({ id, label: 'Collision', run: () => calls++ });
    legacyRegistry.unregisterGroup(id); legacy.update();
    check(!legacyHost.querySelector('button,input'), 'legacy action-control collision is inert');
    legacyRegistry.unregisterAction(id); legacy.update();
    check(!!legacyHost.querySelector('input'), 'unambiguous legacy control resolves after group removal');
    legacyRegistry.registerGroup(registration); legacy.update();
    check(!legacyHost.querySelector('input') && collisionDisposals === 1, 'legacy kind ambiguity disposes previous control exactly once');
    legacyRegistry.unregisterControl(id); legacy.update();
    check(!!legacyHost.querySelector('button'), 'legacy control-to-group transition restores retained group');
    reg.registerAction({ id, label: 'Collision', run: () => calls++ }); refreshGroups();
    check(!!source.host.querySelector('.ib-group'), 'explicit group references ignore action namespace collisions');
    regressionViews.forEach(view => view.dispose());
    check(created === disposed, 'group transitions dispose every control instance exactly once');
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { regressionViews.forEach(view => view.dispose()); regressionArea.remove(); }
  // Real native target handlers must not bypass late availability checks.
  const nativeArea = document.createElement('div'); document.body.append(nativeArea);
  const nativeViews = [], instances = [];
  try {
    const sectionId = 'native-section', flyoutId = 'native-flyout';
    const defs = { bars: [{ id: 'owner', label: 'Owner', layout: DEFAULT_VIEW,
      items: [{ kind: 'group', id: sectionId }, { kind: 'group', id: flyoutId }] }], groups: [
      { id: sectionId, label: 'Native section', kind: 'section', items: [control] },
      { id: flyoutId, label: 'Native popup', kind: 'flyout', items: [control] },
    ] };
    const snapshot = createState(defs), saved = JSON.stringify(snapshot), reg = new ToolbarRegistry(defs);
    let commits = 0, enabled = true;
    const registration = { id: controlId, label: 'Native control', create(context) {
      const record = { context, input: undefined, removals: 0, disposed: false }; instances.push(record);
      return { mount(host) {
        const remove = host.removeEventListener;
        host.removeEventListener = function(...args) { if (args[2] === true) record.removals++; return remove.apply(this, args); };
        const input = record.input = document.createElement('input'); input.id = context.id('native');
        input.onchange = input.onclick = input.oninput = input.onkeydown = () => commits++;
        host.append(input);
      }, update() {}, activate() {}, dispose() {
        record.disposed = true;
        record.input.onchange = record.input.onclick = record.input.oninput = record.input.onkeydown = null;
        record.input.remove();
      } };
    } };
    reg.registerControl(registration);
    const make = detached => {
      const host = document.createElement('div'); nativeArea.append(host);
      const view = new ToolbarRenderer({ viewId: 'native-' + nativeViews.length, ownerId: 'owner',
        groupId: detached ? sectionId : undefined, registry: reg, getState: () => snapshot,
        getItems: state => detached ? ownEntry(state.content.groups, sectionId).items : state.content.bars.owner });
      nativeViews.push(view); view.mount(host); return { host, view };
    };
    const source = make(false), detached = make(true);
    const refresh = () => nativeViews.forEach(view => view.update());
    const open = () => { const arrow = source.host.querySelector('.ib-more'); arrow.click(); return document.getElementById(arrow.getAttribute('aria-controls')); };
    const dispatch = input => {
      for (const type of ['change', 'click', 'input']) input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    };
    let menu = open(), live = instances.filter(record => !record.disposed);
    live.forEach(record => dispatch(record.input));
    check(commits === 12, 'valid source detached and popup native target handlers run exactly once');
    for (const group of defs.groups) reg.registerGroup({ ...group, enabled: () => enabled });
    enabled = false;
    live.forEach(record => dispatch(record.input));
    check(commits === 12, 'disabled group blocks actual native change click input and keyboard target handlers before update');
    check(live.every(record => record.context.isAvailable() === false), 'provider availability accessor reports disabled groups for delayed callbacks');
    const popupInput = menu.querySelector('input');
    popupInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    check(!menu.isConnected && document.activeElement === source.host.querySelector('.ib-more') && commits === 12, 'stale native keyboard guard still closes owned popup on Escape without invoking feature handler');
    refresh(); enabled = true; refresh(); menu = open(); live = instances.filter(record => !record.disposed);
    for (const group of defs.groups) reg.unregisterGroup(group.id);
    live.forEach(record => dispatch(record.input));
    check(commits === 12 && live.every(record => !record.context.isAvailable()), 'unregistered group blocks native handlers and delayed availability before refresh');
    refresh(); for (const group of defs.groups) reg.registerGroup(group); refresh(); menu = open();
    live = instances.filter(record => !record.disposed);
    reg.registerControl({ ...registration });
    live.forEach(record => dispatch(record.input));
    check(commits === 12 && live.every(record => !record.context.isAvailable()), 'replaced control registration invalidates old native instances until remounted');
    refresh(); live = instances.filter(record => !record.disposed);
    live.forEach(record => dispatch(record.input));
    check(commits === 24 && live.every(record => record.context.isAvailable()), 'replacement factory remount restores exactly-once native events');
    reg.unregisterControl(controlId); live.forEach(record => dispatch(record.input));
    check(commits === 24 && live.every(record => !record.context.isAvailable()), 'control unregister blocks native handlers before update');
    refresh(); reg.registerControl(registration);
    ownEntry(snapshot.content.groups, sectionId).items = [{ kind: 'legacy', id: controlId }]; refresh();
    const legacyInputs = instances.filter(record => !record.disposed &&
      (record.input.closest('.toolbar-section') || detached.host.contains(record.input)));
    reg.registerAction({ id: controlId, label: 'Collision', run() {} });
    const beforeCollision = commits;
    legacyInputs.forEach(record => dispatch(record.input));
    check(legacyInputs.length === 2 && commits === beforeCollision && legacyInputs.every(record => !record.context.isAvailable()), 'legacy kind collision blocks old native control handlers before reconciliation');
    // Restore the deliberately edited test reference before checking renderer purity.
    ownEntry(snapshot.content.groups, sectionId).items = [control];
    nativeViews.forEach(view => view.dispose());
    check(instances.every(record => record.disposed && record.removals > 0 && !record.context.isAvailable()), 'dispose removes every native capture guard and invalidates provider contexts');
    check(JSON.stringify(snapshot) === saved, 'native event availability checks never mutate persisted state');
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { nativeViews.forEach(view => view.dispose()); nativeArea.remove(); }
  return { passed, errors };
};
`,
  },
  bundle: true, write: false, outfile: 'fixture.js', format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty' },
});
for (const file of result.outputFiles)
  await writeFile(`${out}/${file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'}`, file.contents);
await writeFile(`${out}/index.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Toolbar renderer regression fixture</title><link rel="stylesheet" href="fixture.css"><body><script type="module" src="fixture.js"></script></body></html>');
console.log(`Built ${out}/index.html; call window.runToolbarRendererChecks() in a native browser.`);
