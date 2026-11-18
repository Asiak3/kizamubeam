import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'artifacts/toolbar-docking-browser';
await mkdir(out, { recursive: true });
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: String.raw`
import { initToolbarFramework } from './src/toolbars/system';
import { DEFAULT_VIEW, detachedId } from './src/toolbars/model';
import { createToolbarDocking } from './src/toolbars/docking';
import './src/style.css';

window.runToolbarDockingChecks = () => {
  // Synchronous geometry assertions use reduced motion. The async companion
  // below exercises the real animated docking path, not just the motion helper.
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = query => query === '(prefers-reduced-motion: reduce)'
    ? { matches: true, addEventListener() {}, removeEventListener() {} } : originalMatchMedia.call(window, query);
  const passed = [], errors = [];
  const check = (ok, name) => (ok ? passed : errors).push(name);
  const originalApp = document.getElementById('app');
  if (originalApp) originalApp.hidden = true;
  const app = document.createElement('div'); app.id = 'app'; document.body.append(app);
  const make = (id, parent = app) => { const el = document.createElement('div'); el.id = id; parent.append(el); return el; };
  make('menubar'); const toolbar = make('toolbar'), numbar = make('numbar'), textbar = make('textbar');
  const main = make('main'), tools = make('tools', main); make('dock-left', main); make('center', main); make('dock-right', main);
  const palette = make('palette'), status = make('status');
  const hosts = new Map([['main', { element: toolbar, ownerId: 'main' }], ['numbar', { element: numbar, ownerId: 'numbar' }],
    ['textbar', { element: textbar, ownerId: 'textbar' }], ['tools', { element: tools, ownerId: 'tools' }]]);
  const definitions = { bars: [...hosts.keys()].map((id, i) => ({ id, label: id,
    items: id === 'main' || id === 'tools' ? [{ kind: 'group', id: 'fly' }, { kind: 'action', id: 'one' }] : id === 'textbar' ? [{ kind: 'control', id: 'field' }] : [{ kind: 'action', id: 'one' }],
    layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: id === 'tools' ? 'left' : 'top', lane: id === 'tools' ? 0 : i, order: 0 },
      orientation: id === 'tools' ? 'vertical' : 'horizontal' } })),
    groups: [{ id: 'fly', label: 'Flyout', kind: 'flyout', items: [{ kind: 'action', id: 'one' }, { kind: 'action', id: 'two' }] }] };
  let writes = 0, raw = null, runs = 0, system;
  const storage = { getItem() { return raw; }, setItem(key, value) { writes++; raw = value; } };
  const options = { definitions, hosts, storage, actions: ['one', 'two'].map(id => ({ id, label: id, icon: 'select', run() { runs++; } })),
    controls: [{ id: 'field', label: 'Field', create() { const input = document.createElement('input'); input.setAttribute('aria-label', 'Field');
      return { mount(host) { host.append(input); }, update() {}, activate() { input.focus(); }, dispose() { input.remove(); } }; } }],
    visibilityHosts: new Map([['palette', palette], ['status', status]]) };
  const pointer = (target, type, x, y, pointerId = 7) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, button: 0, isPrimary: true, pointerId, clientX: x, clientY: y }));
  const start = (element = toolbar, id = 7) => {
    const grip = element.querySelector('.toolbar-grip, .toolbar-float-head');
    const r = grip.getBoundingClientRect(); pointer(grip, 'pointerdown', r.left + 12, r.top + 12, id);
    return { grip, r };
  };
  const move = (x, y, id = 7) => pointer(document, 'pointermove', x, y, id);
  const end = (x, y, id = 7) => pointer(document, 'pointerup', x, y, id);
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const place = (view, barId = 'main') => system.runtime.layout({ kind: 'place', target: { barId }, view });
  const floating = (x = 180, y = 170) => ({ ...DEFAULT_VIEW, placement: { kind: 'floating', x, y } });
  const snapshot = () => JSON.stringify(system.runtime.read());
  try {
    system = initToolbarFramework(options);
    check(writes === 0, 'mount does not persist');
    check(document.querySelectorAll('.toolbar-dock-zone').length === 4 && main.parentElement === app,
      'four app-grid dock zones preserve the existing canvas/panel container');
    check(toolbar.closest('[data-edge="top"]') && tools.closest('[data-edge="left"]'), 'default main/top tools/left');
    check(toolbar.parentElement !== numbar.parentElement && numbar.parentElement !== textbar.parentElement, 'default top lanes remain separate');

    const originalTheme = document.documentElement.getAttribute('data-theme');
    const originalMain = system.runtime.read().layout.bars.main;
    const panelProbe = document.createElement('div'); panelProbe.className = 'bar'; app.append(panelProbe);
    try {
      for (const theme of ['light', 'dark']) {
        document.documentElement.setAttribute('data-theme', theme);
        for (const edge of ['top', 'bottom', 'left', 'right']) {
          place({ ...DEFAULT_VIEW, orientation: edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal',
            placement: { kind: 'dock', edge, lane: 0, order: 0 } });
          const lane = toolbar.parentElement, zone = lane.parentElement, panel = getComputedStyle(panelProbe).backgroundColor;
          check(getComputedStyle(lane).backgroundColor === panel && getComputedStyle(zone).backgroundColor === panel,
            theme + '/' + edge + ': dock lane and unused trailing space match the toolbar panel color');
          if (edge === 'top' || edge === 'bottom') {
            const laneStyle = getComputedStyle(lane);
            const side = edge === 'top' ? 'Bottom' : 'Top';
            check(lane.getBoundingClientRect().width >= zone.clientWidth - 1 && laneStyle['border' + side + 'Width'] !== '0px' &&
              laneStyle['border' + side + 'Style'] !== 'none',
              theme + '/' + edge + ': horizontal row and separator continue beyond the toolbar end');
          }
        }
      }
    } finally {
      panelProbe.remove(); place(originalMain);
      if (originalTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', originalTheme);
    }

    for (const [size, buttonSize, iconSize] of [['s', 24, 16], ['m', 30, 20], ['l', 40, 28]]) {
      system.runtime.setIconSize('main', size); system.runtime.setIconSize('tools', size);
      const button = toolbar.querySelector('.ib'), svg = button.querySelector('svg');
      check(button.getBoundingClientRect().width === buttonSize && svg.getBoundingClientRect().width === iconSize,
        'generic host renders requested button/icon size: ' + size);
      const side = tools.querySelector('[data-view]');
      check(side.scrollWidth <= side.clientWidth && side.scrollHeight <= side.clientHeight,
        'side toolbar fits its flyout arrows without spurious cross-axis scrollbar: ' + size);
      side.style.maxHeight = '24px';
      check(side.scrollHeight > side.clientHeight && side.scrollWidth <= side.clientWidth,
        'height-constrained side toolbar scrolls vertically without inducing horizontal overflow: ' + size);
      side.style.maxHeight = '';
      system.runtime.layout({ kind: 'detach', ownerId: 'main', groupId: 'fly', view: floating() });
      const detached = document.querySelector('.toolbar-float-body .ib');
      check(detached.getBoundingClientRect().width === buttonSize && detached.querySelector('svg').getBoundingClientRect().width === iconSize,
        'detached group inherits source button/icon size: ' + size);
      system.runtime.layout({ kind: 'close', ownerId: 'main', groupId: 'fly' });
    }
    system.runtime.setIconSize('main', 'm'); system.runtime.setIconSize('tools', 'm');

    // Exercise computed legacy-ID CSS, not just the layout data attributes.
    const leftPanel = document.getElementById('dock-left'), rightPanel = document.getElementById('dock-right');
    leftPanel.style.width = '120px'; rightPanel.style.width = '140px';
    const center = document.getElementById('center');
    const work = main.getBoundingClientRect(), left = leftPanel.getBoundingClientRect(), right = rightPanel.getBoundingClientRect(), canvas = center.getBoundingClientRect();
    check(Math.abs(left.left - work.left) < 1 && Math.abs(canvas.left - left.right) < 1
      && Math.abs(canvas.right - right.left) < 1 && Math.abs(right.right - work.right) < 1
      && canvas.width >= work.width - left.width - right.width - 1,
      'workspace uses all remaining width between real side panels without a phantom grid column');
    const checkShellAxis = (element, orientation, name) => {
      const grip = element.querySelector('.toolbar-grip').getBoundingClientRect();
      const body = element.querySelector('[data-view]').getBoundingClientRect();
      check(getComputedStyle(element).flexDirection === (orientation === 'horizontal' ? 'row' : 'column')
        && (orientation === 'horizontal' ? grip.right <= body.left + 1 && Math.abs((grip.top + grip.bottom) - (body.top + body.bottom)) <= 2
          : grip.bottom <= body.top + 1 && Math.abs((grip.left + grip.right) - (body.left + body.right)) <= 2), name);
      const mark = element.querySelector('.toolbar-grip-mark');
      check(!!mark && mark.textContent === (orientation === 'vertical' ? '⋯' : '⋮'),
        name + ': grip dots rotate with the live orientation');
      const shell = element.getBoundingClientRect();
      check(orientation === 'horizontal' ? Math.abs((grip.top + grip.bottom) / 2 - (shell.top + shell.bottom) / 2) <= 1
        : Math.abs((grip.left + grip.right) / 2 - (shell.left + shell.right) / 2) <= 1,
        name + ': grip is centered across the whole shell');
    };
    // Use the actual pointer path for both transitions, including preview/commit.
    start(tools); let target = toolbar.getBoundingClientRect();
    move(target.left + 1, target.top + target.height / 2);
    checkShellAxis(tools, 'horizontal', 'left-to-top preview moves the tools grip to the left of its content');
    end(target.left + 1, target.top + target.height / 2);
    checkShellAxis(tools, 'horizontal', 'left-to-top commit retains a horizontal shell and compact top lane');
    start(numbar); target = app.getBoundingClientRect();
    move(target.left + 2, target.top + target.height / 2);
    checkShellAxis(numbar, 'vertical', 'top-to-left preview moves the grip above its content');
    end(target.left + 2, target.top + target.height / 2);
    checkShellAxis(numbar, 'vertical', 'top-to-left commit retains a vertical shell');
    place(definitions.bars.find(bar => bar.id === 'tools').layout, 'tools');
    place(definitions.bars.find(bar => bar.id === 'numbar').layout, 'numbar');
    leftPanel.style.width = ''; rightPanel.style.width = '';

    const priorText = system.runtime.read().layout.bars.textbar;
    const propertyBody = numbar.querySelector('[data-view]'), textBody = textbar.querySelector('[data-view]');
    propertyBody.style.minHeight = '31px'; textBody.style.minHeight = '24px';
    place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 1, order: 1 } }, 'textbar');
    check(Math.abs(numbar.getBoundingClientRect().height - textbar.getBoundingClientRect().height) <= 1,
      'adjacent property and text toolbars share one lane height despite different control heights');
    for (const element of [numbar, textbar]) {
      const body = element.querySelector('[data-view]').getBoundingClientRect(), shell = element.getBoundingClientRect();
      check(Math.abs((body.top + body.bottom) / 2 - (shell.top + shell.bottom) / 2) <= 1,
        element.id + ': controls remain vertically centered in the shared lane');
    }
    propertyBody.style.minHeight = ''; textBody.style.minHeight = ''; place(priorText, 'textbar');

    // Lane insertion is distinct from ordering bars inside a lane or their button grid.
    const setupRows = (edge) => {
      for (const id of hosts.keys()) place(floating(), id);
      const orientation = edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal';
      for (const [barId, lane] of [['numbar', 0], ['textbar', 1]])
        place({ ...DEFAULT_VIEW, orientation, placement: { kind: 'dock', edge, lane, order: 0 } }, barId);
    };
    const rowPoint = (edge, position) => {
      const vertical = edge === 'left' || edge === 'right';
      const first = numbar.parentElement.getBoundingClientRect(), second = textbar.parentElement.getBoundingClientRect();
      const cross = position === 'prepend' ? (vertical ? first.left : first.top)
        : position === 'append' ? (vertical ? second.right : second.bottom)
        : vertical ? (first.right + second.left) / 2 : (first.bottom + second.top) / 2;
      return vertical ? { x: cross, y: (first.top + first.bottom) / 2 } : { x: (first.left + first.right) / 2, y: cross };
    };
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      for (const position of ['prepend', 'between', 'append']) {
        setupRows(edge);
        const p = rowPoint(edge, position), baseline = writes, before = snapshot();
        const firstLane = numbar.parentElement, secondLane = textbar.parentElement;
        start(); move(p.x, p.y);
        const temporary = toolbar.parentElement, previewRect = toolbar.getBoundingClientRect();
        const rank = position === 'prepend' ? 0 : position === 'between' ? 1 : 2;
        check(temporary.dataset.previewLane === 'true' && temporary !== firstLane && temporary !== secondLane &&
          Number(temporary.style.order) === rank && Number(firstLane.style.order) === (rank === 0 ? 1 : 0) &&
          Number(secondLane.style.order) === (rank <= 1 ? 2 : 1) && writes === baseline && snapshot() === before,
          edge + '/' + position + ': distinct new-row preview shifts following lane ranks without writes');
        for (let i = 0; i < 8; i++) move(p.x, p.y);
        const repeated = toolbar.getBoundingClientRect();
        check(toolbar.parentElement === temporary && Math.abs(repeated.left - previewRect.left) < 1 && Math.abs(repeated.top - previewRect.top) < 1,
          edge + '/' + position + ': repeated identical coordinates keep preview geometry stable');
        const vertical = edge === 'left' || edge === 'right';
        for (const delta of [-2, 2, -1, 1]) move(p.x + (vertical ? delta : 0), p.y + (vertical ? 0 : delta));
        check(toolbar.parentElement === temporary && Number(temporary.style.order) === rank,
          edge + '/' + position + ': small separator jitter retains the insertion target');
        system.refresh();
        check(toolbar.parentElement === temporary && writes === baseline && snapshot() === before,
          edge + '/' + position + ': refresh preserves transient new-row preview');
        end(p.x, p.y);
        const bars = system.runtime.read().layout.bars;
        check(writes === baseline + 1 && bars.main.placement.lane === rank && bars.main.placement.order === 0 &&
          bars.numbar.placement.lane === (rank === 0 ? 1 : 0) && bars.textbar.placement.lane === (rank <= 1 ? 2 : 1) &&
          !document.querySelector('[data-preview-lane]') && toolbar.parentElement !== numbar.parentElement && toolbar.parentElement !== textbar.parentElement,
          edge + '/' + position + ': new row commits all lane ranks exactly once');
      }
    }
    for (const reason of ['esc', 'blur', 'cancel', 'resize', 'scroll', 'lock']) {
      setupRows('top');
      const p = rowPoint('top', 'between'), before = snapshot(), baseline = writes;
      const parent = toolbar.parentNode, shellStyle = toolbar.getAttribute('style');
      const laneStyles = [numbar.parentElement, textbar.parentElement].map(lane => [lane, lane.getAttribute('style')]);
      start(); move(p.x, p.y);
      if (reason === 'esc') escape();
      else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else if (reason === 'cancel') pointer(document, 'pointercancel', p.x, p.y);
      else if (reason === 'resize') window.dispatchEvent(new Event('resize'));
      else if (reason === 'scroll') numbar.parentElement.parentElement.dispatchEvent(new Event('scroll'));
      else system.runtime.lock(true);
      check(!document.querySelector('[data-preview-lane]') && !document.querySelector('.toolbar-drop-preview') &&
        toolbar.parentNode === parent && toolbar.getAttribute('style') === shellStyle &&
        laneStyles.every(([lane, style]) => lane.getAttribute('style') === style) && writes === baseline + (reason === 'lock' ? 1 : 0) &&
        (reason === 'lock' || snapshot() === before), reason + ': new-row rollback restores shell and lane styles without a placement write');
      if (reason === 'lock') system.runtime.lock(false);
    }
    setupRows('top');
    system.runtime.layout({ kind: 'detach', ownerId: 'main', groupId: 'fly', view: floating() });
    {
      const detached = document.querySelector('.toolbar-float'), p = rowPoint('top', 'between'), baseline = writes;
      start(detached); move(p.x, p.y); end(p.x, p.y);
      const layout = system.runtime.read().layout;
      check(writes === baseline + 1 && layout.detached[detachedId('main', 'fly')].layout.placement.lane === 1 &&
        layout.bars.textbar.placement.lane === 2 && !document.querySelector('[data-preview-lane]'), 'existing detached group inserts a new middle row in one commit');
    }
    system.runtime.layout({ kind: 'close', ownerId: 'main', groupId: 'fly' });
    for (const bar of definitions.bars) place(bar.layout, bar.id);

    for (const edge of ['top', 'bottom', 'left', 'right']) {
      place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge, lane: 2, order: 3 } });
      check(toolbar.closest('.toolbar-dock-zone').dataset.edge === edge && toolbar.parentElement.dataset.lane === '2' && toolbar.style.order === '3',
        'persisted dock side/lane/order: ' + edge);
    }
    place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 3, order: 0 } }, 'numbar');
    place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 3, order: 1 } });
    let orderBaseline = writes;
    const orderState = snapshot(), mainStyle = toolbar.getAttribute('style'), numStyle = numbar.getAttribute('style');
    start();
    let orderRect = numbar.getBoundingClientRect(); move(orderRect.left + 2, orderRect.top + orderRect.height / 2);
    check(writes === orderBaseline && snapshot() === orderState && Number(toolbar.style.order) < Number(numbar.style.order)
      && toolbar.getBoundingClientRect().left < numbar.getBoundingClientRect().left, 'insert-before preview immediately ranks every visible sibling without writes');
    system.refresh();
    check(Number(toolbar.style.order) < Number(numbar.style.order) && toolbar.getBoundingClientRect().left < numbar.getBoundingClientRect().left,
      'refresh preserves preview sibling order');
    escape();
    check(writes === orderBaseline && snapshot() === orderState && toolbar.getAttribute('style') === mainStyle && numbar.getAttribute('style') === numStyle,
      'cancel restores all temporary sibling orders and exact shell styles');
    start(); orderRect = numbar.getBoundingClientRect(); move(orderRect.left + 2, orderRect.top + orderRect.height / 2); end(orderRect.left + 2, orderRect.top + orderRect.height / 2);
    const ordered = system.runtime.read().layout.bars;
    check(writes === orderBaseline + 1 && ordered.main.placement.order < ordered.numbar.placement.order,
      'insert-before reindexes siblings in one completed commit');
    const textLayout = system.runtime.read().layout.bars.textbar;
    place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 3, order: 0 } }, 'textbar');
    place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 3, order: 1 } });
    place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 3, order: 2 } }, 'numbar');
    system.runtime.layout({ kind: 'visibility', barId: 'textbar', visible: false });
    const hiddenLayout = JSON.stringify(system.runtime.read().layout.bars.textbar);
    place(floating(), 'tools');
    {
      const savedWrites = writes, before = snapshot();
      start(tools); const r = numbar.getBoundingClientRect(); move(r.left + 1, r.top + r.height / 2);
      check(writes === savedWrites && snapshot() === before && toolbar.getBoundingClientRect().left < tools.getBoundingClientRect().left
        && tools.getBoundingClientRect().left < numbar.getBoundingClientRect().left, 'hidden peer does not distort visible insertion preview');
      end(r.left + 1, r.top + r.height / 2);
      const bars = system.runtime.read().layout.bars;
      check(writes === savedWrites + 1 && bars.main.placement.order === 0 && bars.tools.placement.order === 1 && bars.numbar.placement.order === 2
        && JSON.stringify(bars.textbar) === hiddenLayout, 'hidden peer does not distort completed insertion or lose its saved layout');
    }
    system.runtime.layout({ kind: 'visibility', barId: 'textbar', visible: true }); place(textLayout, 'textbar');
    place({ ...DEFAULT_VIEW, orientation: 'vertical', placement: { kind: 'dock', edge: 'left', lane: 0, order: 0 } }, 'tools');
    place(floating());
    check(toolbar.classList.contains('toolbar-layout-floating') && toolbar.parentElement.classList.contains('toolbar-float-layer'), 'whole bar floats inside app, not OS window');
    check(toolbar.querySelector('[data-action="one"]'), 'floating whole bar retains actions');
    const orientationBefore = snapshot(), orientationWrites = writes;
    start();
    const appRect = app.getBoundingClientRect(); move(appRect.left + 2, appRect.top + appRect.height / 2);
    check(toolbar.querySelector('[data-view]').dataset.orientation === 'vertical', 'side-dock preview changes live orientation');
    system.refresh();
    check(toolbar.querySelector('[data-view]').dataset.orientation === 'vertical' && snapshot() === orientationBefore && writes === orientationWrites,
      'feature refresh reapplies preview orientation without replacing committed state');
    // Back into the center: a previous dock preview must not act as its own hit target.
    move(appRect.left + appRect.width / 2, appRect.top + appRect.height / 2);
    check(toolbar.dataset.placement === 'floating', 'moving view cannot pollute dock geometry or trap a drag in its own lane');
    escape();
    for (const reason of ['esc', 'blur', 'cancel']) {
      const baseline = writes, before = snapshot();
      start(); move(appRect.left + 2, appRect.top + appRect.height / 2);
      check(toolbar.querySelector('.toolbar-grip-mark').textContent === '⋯', reason + ': side preview actually changes grip direction before cancellation');
      if (reason === 'esc') escape();
      else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else pointer(document, 'pointercancel', appRect.left + 2, appRect.top + appRect.height / 2);
      check(toolbar.querySelector('.toolbar-grip-mark').textContent === '⋮' && writes === baseline && snapshot() === before,
        reason + ': cancel restores original grip direction and layout without saving');
    }
    for (const reason of ['esc', 'blur', 'cancel']) {
      const before = snapshot(), parent = toolbar.parentNode, style = toolbar.getAttribute('style'), baseline = writes;
      start(); move(320, 250);
      check(writes === baseline && snapshot() === before && document.querySelector('.toolbar-drop-preview'), reason + ': preview makes zero writes');
      if (reason === 'esc') escape();
      else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else pointer(document, 'pointercancel', 320, 250);
      check(writes === baseline && snapshot() === before && toolbar.parentNode === parent && toolbar.getAttribute('style') === style && !document.querySelector('.toolbar-drop-preview'),
        reason + ': exact placement/DOM rollback, zero writes');
    }
    let baseline = writes; start(); move(330, 270, 99); end(330, 270, 99);
    check(writes === baseline && document.querySelector('.toolbar-drop-preview'), 'unrelated pointer cannot move or complete drag');
    move(330, 270); end(330, 270);
    check(writes === baseline + 1 && !document.querySelector('.toolbar-drop-preview'), 'completed float drop persists exactly once');

    for (const edge of ['top', 'bottom', 'left', 'right']) {
      place(floating()); baseline = writes; start();
      const zone = document.querySelector('.toolbar-dock-zone[data-edge="' + edge + '"]');
      const r = zone.getBoundingClientRect(), a = app.getBoundingClientRect();
      const x = edge === 'left' ? a.left + 2 : edge === 'right' ? a.right - 2 : a.left + a.width / 2;
      const y = edge === 'top' ? r.top + 2 : edge === 'bottom' ? r.bottom - 2 : a.top + a.height / 2;
      move(x, y); check(writes === baseline, edge + ' docking preview makes zero writes'); end(x, y);
      check(writes === baseline + 1 && system.runtime.read().layout.bars.main.placement.edge === edge, edge + ' drag drop docks once');
    }
    place(floating()); baseline = writes; start(); move(350, 280);
    system.runtime.lock(true);
    check(writes === baseline + 1 && !document.querySelector('.toolbar-drop-preview') && toolbar.style.left === '180px', 'lock flip cancels active movement; only lock writes');
    baseline = writes; const lockedState = snapshot(); start(); move(350, 280); end(350, 280);
    check(writes === baseline && snapshot() === lockedState, 'locked grip cannot move or persist');
    toolbar.querySelector('[data-action="one"]').click();
    check(runs === 1, 'locked layout leaves action and shared choice usable');
    const input = textbar.querySelector('input'); input.value = 'draft'; input.focus(); input.setSelectionRange(1, 4, 'backward');
    check(!input.disabled && input.value === 'draft', 'locked layout leaves fields usable');
    check(!system.runtime.layout({ kind: 'reset' }).ok, 'locked reset rejected');
    system.runtime.lock(false);
    const floatLayer = document.querySelector('.toolbar-float-layer'), moveDescriptor = Object.getOwnPropertyDescriptor(floatLayer, 'moveBefore');
    Object.defineProperty(floatLayer, 'moveBefore', { configurable: true, value: undefined });
    try { place(floating(140, 150), 'textbar'); }
    finally { if (moveDescriptor) Object.defineProperty(floatLayer, 'moveBefore', moveDescriptor); else delete floatLayer.moveBefore; }
    check(textbar.querySelector('input') === input && input.value === 'draft' && document.activeElement === input
      && input.selectionStart === 1 && input.selectionEnd === 4 && input.selectionDirection === 'backward', 'fallback native reparent preserves focused formula draft and exact caret selection');

    const dv = { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'right', lane: 1, order: 4 }, orientation: 'vertical', rows: 2, columns: 2 };
    system.runtime.layout({ kind: 'detach', ownerId: 'main', groupId: 'fly', view: dv });
    let detached = document.querySelector('.toolbar-float');
    check(detached.closest('.toolbar-dock-zone').dataset.edge === 'right' && detached.querySelector('[data-view]').dataset.orientation === 'vertical'
      && detached.querySelector('[data-view]').style.getPropertyValue('--toolbar-columns') === '2', 'detached group shares saved docking/orientation/grid');
    baseline = writes; const priorDetached = snapshot(); start(detached); move(360, 290); escape();
    check(writes === baseline && snapshot() === priorDetached && detached.closest('[data-edge="right"]'), 'detached dock drag cancels without writes');
    start(detached); move(360, 290); end(360, 290);
    check(writes === baseline + 1 && system.runtime.read().layout.detached[detachedId('main', 'fly')].layout.placement.kind === 'floating', 'detached dock can float with one write');
    system.runtime.layout({ kind: 'visibility', barId: 'main', visible: false });
    check(toolbar.hidden && detached.style.display === 'none', 'owner hidden retains but hides detached placement');
    system.runtime.layout({ kind: 'visibility', barId: 'main', visible: true });
    check(!toolbar.hidden && detached.style.display !== 'none', 'owner visibility restores both placements');
    system.runtime.layout({ kind: 'close', ownerId: 'main', groupId: 'fly' });

    // Exercise the real renderer tear callback; the popup grip crosses the native tear threshold.
    const openAndTear = () => {
      const more = toolbar.querySelector('.ib-more'); if (!document.querySelector('.toolbar-popup')) more.click();
      const popup = document.querySelector('.toolbar-popup'), grip = popup?.querySelector('.toolbar-grip');
      if (!grip) throw Error('Renderer tear grip not found');
      const r = grip.getBoundingClientRect(); pointer(grip, 'pointerdown', r.left + 5, r.top + 5);
      move(r.left + 90, r.top + 70);
      return popup;
    };
    setupRows('top');
    {
      const p = rowPoint('top', 'between'), baseline = writes;
      openAndTear(); move(p.x, p.y);
      check(writes === baseline && document.querySelector('.toolbar-float').parentElement.dataset.previewLane === 'true',
        'new tear-off previews a distinct middle row without saving');
      end(p.x, p.y);
      const layout = system.runtime.read().layout;
      check(writes === baseline + 1 && layout.detached[detachedId('main', 'fly')].layout.placement.lane === 1 &&
        layout.bars.textbar.placement.lane === 2 && !document.querySelector('[data-preview-lane]'), 'new tear-off commits detachment and lane insertion atomically');
      system.runtime.layout({ kind: 'close', ownerId: 'main', groupId: 'fly' });
    }
    for (const bar of definitions.bars) place(bar.layout, bar.id);
    for (const reason of ['esc', 'blur', 'cancel', 'drop']) {
      baseline = writes; const before = snapshot(); const popup = openAndTear();
      check(document.querySelector('.toolbar-float') && writes === baseline && snapshot() === before, 'tear ' + reason + ': temporary float, zero writes');
      if (reason === 'esc') escape(); else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else if (reason === 'cancel') pointer(document, 'pointercancel', 400, 300);
      else { move(420, 310); end(420, 310); }
      check(reason === 'drop' ? writes === baseline + 1 && Object.keys(system.runtime.read().layout.detached).length === 1
        : writes === baseline && snapshot() === before && !document.querySelector('.toolbar-float'), 'tear ' + reason + ': transactional completion/abort');
      check(reason === 'drop' ? !popup.isConnected : popup.isConnected && !popup.hidden && getComputedStyle(popup).visibility !== 'hidden',
        'tear ' + reason + ': original popup DOM is restored on abort and removed on commit');
      if (reason === 'drop') system.runtime.layout({ kind: 'close', ownerId: 'main', groupId: 'fly' });
    }
    system.runtime.layout({ kind: 'detach', ownerId: 'main', groupId: 'fly', view: floating() });
    const savedOwner = JSON.stringify(system.runtime.read().layout.detached); system.dispose();
    system = initToolbarFramework({ ...options, definitions: { ...definitions, bars: definitions.bars.filter(bar => bar.id !== 'main') },
      hosts: new Map([...hosts].filter(([id]) => id !== 'main')) });
    check(!document.querySelector('.toolbar-float') && JSON.stringify(system.runtime.read().layout.detached) === savedOwner,
      'absent owner keeps saved detachment inert despite registered shared group');
    system.dispose(); system = initToolbarFramework(options);
    check(document.querySelector('.toolbar-float') && JSON.stringify(system.runtime.read().layout.detached) === savedOwner,
      'returning owner restores detachment without losing saved placement');
    system.runtime.layout({ kind: 'close', ownerId: 'main', groupId: 'fly' });
    place({ ...floating(), orientation: 'vertical', rows: 2, columns: 3 });
    const root = toolbar.querySelector('[data-view]');
    check(root.dataset.orientation === 'vertical' && root.style.getPropertyValue('--toolbar-columns') === '3' && getComputedStyle(root).overflowX === 'auto', 'bounded rows/columns retain inner scrolling');
    place(floating(100000, 100000)); baseline = writes; window.dispatchEvent(new Event('resize'));
    const gripRect = toolbar.querySelector('.toolbar-grip').getBoundingClientRect();
    check(gripRect.left >= 0 && gripRect.top >= 0 && gripRect.right <= innerWidth && gripRect.bottom <= innerHeight && writes === baseline, 'viewport clamp keeps actual grip reachable without persistence');
    const persisted = snapshot(); baseline = writes; system.dispose(); system = initToolbarFramework(options);
    check(snapshot() === persisted && writes === baseline && document.querySelectorAll('.toolbar-dock-zone').length === 4, 'dispose/re-init restores saved layout without writes or duplicate containers');
    const frame = document.createElement('iframe'); frame.width = '500'; frame.height = '360'; document.body.append(frame);
    const fd = frame.contentDocument, frameHost = fd.createElement('div'); fd.body.append(frameHost);
    const frameCss = fd.createElement('style'); frameCss.textContent = '.toolbar-layout-floating{position:absolute}.toolbar-grip{display:block;width:24px;height:24px}.toolbar-float-layer{position:fixed;inset:0}'; fd.head.append(frameCss);
    const small = initToolbarFramework({ definitions: { bars: [{ id: 'small', label: 'Small', items: [], layout: floating(460, 310) }], groups: [] },
      actions: [], hosts: new Map([['small', { ownerId: 'small', element: frameHost }]]), storage: { getItem() { return null; }, setItem() { writes++; } } });
    baseline = writes; frame.width = '220'; frame.height = '160'; frame.contentWindow.dispatchEvent(new Event('resize'));
    const smallGrip = frameHost.querySelector('.toolbar-grip').getBoundingClientRect();
    check(smallGrip.left >= 0 && smallGrip.top >= 0 && smallGrip.right <= fd.documentElement.clientWidth && smallGrip.bottom <= fd.documentElement.clientHeight && writes === baseline,
      'actual viewport shrink reclamps the grip, not an arbitrary rectangle strip');
    small.dispose(); frame.remove();
    for (const edge of ['top', 'bottom', 'left', 'right']) for (const before of [true, false]) {
      for (const [barId, lane] of [['main', 0], ['numbar', 1], ['tools', 0]])
        place({ ...DEFAULT_VIEW, placement: { kind: 'dock', edge, lane, order: barId === 'tools' ? 1 : 0 } }, barId);
      place(floating(220, 220), 'textbar');
      const grip = tools.querySelector('.toolbar-grip'); grip.focus();
      const savedWrites = writes;
      grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, shiftKey: true,
        key: edge === 'left' || edge === 'right' ? before ? 'ArrowLeft' : 'ArrowRight' : before ? 'ArrowUp' : 'ArrowDown' }));
      const bars = system.runtime.read().layout.bars;
      check(bars.tools.placement.edge === edge && bars.tools.placement.lane === (before ? 0 : 1) &&
        bars.main.placement.lane === (before ? 1 : 0) && bars.numbar.placement.lane === 2 && writes === savedWrites + 1,
        edge + ': keyboard inserts a new dock lane ' + (before ? 'before' : 'after') + ' and atomically shifts followers');
    }
    start(); move(380, 300); baseline = writes; system.dispose();
    end(380, 300); move(420, 320);
    check(writes === baseline && !document.querySelector('.toolbar-drop-preview') && !document.querySelector('.toolbar-float-layer'), 'dispose mid-drag aborts and removes all drag/layer listeners');

    // A rejected operation must not leave an uncommitted DOM preview behind.
    const rejectLayer = document.createElement('div'); rejectLayer.className = 'toolbar-float-layer'; document.body.append(rejectLayer);
    let rejected = 0;
    const docking = createToolbarDocking(document, rejectLayer, { locked: () => false,
      commit(target, view, participants, insertLane) { rejected++; check(insertLane === true, 'rejected commit receives transient lane insertion intent'); return false; } });
    const rejectHost = document.createElement('div'), rejectGrip = document.createElement('div');
    rejectGrip.className = 'toolbar-grip'; rejectHost.append(rejectGrip); app.append(rejectHost);
    const peer = document.createElement('div'), peerGrip = document.createElement('div');
    peerGrip.className = 'toolbar-grip'; peer.append(peerGrip); app.append(peer);
    try {
      docking.mount(rejectHost, rejectGrip, { barId: 'reject' }, floating()); docking.update(rejectHost, floating());
      const peerView = { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 0, order: 0 } };
      docking.mount(peer, peerGrip, { barId: 'peer' }, peerView); docking.update(peer, peerView);
      const parent = rejectHost.parentNode, style = rejectHost.getAttribute('style'), peerLane = peer.parentElement;
      const laneStyle = peerLane.getAttribute('style'), r = peerLane.getBoundingClientRect(), savedWrites = writes;
      start(rejectHost); move(r.left + r.width / 2, r.bottom); end(r.left + r.width / 2, r.bottom);
      check(rejected === 1 && rejectHost.parentNode === parent && rejectHost.getAttribute('style') === style &&
        peerLane.getAttribute('style') === laneStyle && !document.querySelector('[data-preview-lane]') && writes === savedWrites,
        'rejected new-row commit restores exact placement and lane styles without persistence');
      start(rejectHost); move(r.left + r.width / 2, r.bottom); docking.dispose();
      check(!document.querySelector('[data-preview-lane]') && !document.querySelector('.toolbar-drop-preview') && writes === savedWrites,
        'dispose during new-row preview removes temporary lane and restores without writes');
    } finally { docking.dispose(); rejectHost.remove(); peer.remove(); rejectLayer.remove(); }
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { system?.dispose(); app.remove(); window.matchMedia = originalMatchMedia; if (originalApp) originalApp.hidden = false; }
  return { passed, errors };
};

window.runToolbarDockingMotionChecks = async () => {
  const passed = [], errors = [];
  const check = (ok, name) => (ok ? passed : errors).push(name);
  const app = document.createElement('div'); app.id = 'app'; document.body.append(app);
  const make = id => { const element = document.createElement('div'); element.id = id; app.append(element); return element; };
  make('menubar'); const workspace = make('main'); make('palette'); make('status');
  const first = make('motion-first'), second = make('motion-second'), moving = make('motion-moving');
  const bars = [first, second, moving].map((element, index) => ({ id: element.id, label: element.id,
    items: [{ kind: 'action', id: 'one' }], layout: { ...DEFAULT_VIEW,
      placement: { kind: 'dock', edge: index === 2 ? 'left' : 'top', lane: index === 2 ? 0 : index, order: 0 } } }));
  const system = initToolbarFramework({ definitions: { bars, groups: [] },
    actions: [{ id: 'one', label: 'One', icon: 'select', run() {} }],
    hosts: new Map(bars.map((bar, index) => [bar.id, { ownerId: bar.id, element: [first, second, moving][index] }])),
  });
  const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, button: 0, isPrimary: true, pointerId: 94, clientX: x, clientY: y }));
  try {
    const grip = moving.querySelector('.toolbar-grip'), handle = grip.getBoundingClientRect();
    const row = first.parentElement.getBoundingClientRect();
    const x = row.left + row.width / 2, y = row.bottom - 1;
    pointer(grip, 'pointerdown', handle.left + 12, handle.top + 12);
    pointer(document, 'pointermove', x, y);
    const peers = [...first.getAnimations(), ...second.getAnimations(), ...workspace.getAnimations()];
    check(peers.length > 0 && peers.every(animation => animation.effect.getTiming().duration === 150), 'real docking animates settling peers/workspace for 150 ms');
    check(moving.getAnimations().length === 0, 'dragged toolbar remains direct rather than animated');
    check(workspace.getAnimations().length > 0, 'real workspace size/position change is animated');
    const marker = document.querySelector('.toolbar-drop-preview');
    const before = marker.getBoundingClientRect();
    const animations = new Set(peers);
    pointer(document, 'pointermove', x, y);
    const after = marker.getBoundingClientRect();
    check(Math.abs(before.left - after.left) < 0.1 && Math.abs(before.top - after.top) < 0.1 &&
      Math.abs(before.width - after.width) < 0.1 && Math.abs(before.height - after.height) < 0.1,
      'animation never changes the stationary pointer target');
    check([...first.getAnimations(), ...second.getAnimations(), ...workspace.getAnimations()].every(animation => animations.has(animation)),
      'repeating a target does not restart settling animations');
    // Seek native WAAPI end states: headless paint clocks can remain suspended.
    peers.forEach(animation => animation.finish());
    await Promise.all(peers.map(animation => animation.finished));
    check(!first.getAnimations().length && !second.getAnimations().length && !workspace.getAnimations().length,
      'settling completes without a persistent visual transform');
    pointer(document, 'pointerup', x, y);
    check(system.runtime.read().layout.bars['motion-moving'].placement.lane === 1 &&
      system.runtime.read().layout.bars['motion-second'].placement.lane === 2, 'animated between-row preview commits matching dock lanes');
  } catch (error) { errors.push(String(error?.stack ?? error)); }
  finally { system.dispose(); app.remove(); }
  return { passed, errors };
};
` },
  bundle: true, write: false, outfile: 'fixture.js', format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty' },
});
for (const file of result.outputFiles)
  await writeFile(`${out}/${file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'}`, file.contents);
await writeFile(`${out}/index.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Toolbar docking regression fixture</title><link rel="stylesheet" href="fixture.css"><body><script type="module" src="fixture.js"></script></body></html>');
console.log(`Built ${out}/index.html; call window.runToolbarDockingChecks() in a native browser.`);
