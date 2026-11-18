import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

// Native DOM and genuine feature factories; intentionally no application startup,
// machine modules or real hardware. The small editor double records feature calls.
const out = 'artifacts/toolbar-controls-browser';
await mkdir(out, { recursive: true });
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: String.raw`
import { bindEditorToolbarDialogs, createEditorToolbarControls } from './src/toolbars/controls';
import { createState } from './src/toolbars/model';
import { onFontListChanged, refreshFonts } from './src/fonts';
import './src/style.css';

window.runToolbarControlChecks = async () => {
  const passed = [], errors = [], calls = [], mounted = [];
  const check = (ok, name) => (ok ? passed : errors).push(name);
  const area = document.createElement('main'); document.body.append(area);
  let refreshes = 0, owner, snapshot, serial = 0, alive = true;
  const box = { x: 10, y: 20, w: 30, h: 40 };
  const obj = shape => ({ id: ++serial, m: [1, 0, 0, 1, 0, 0], layer: 'layer', shape });
  const rect = obj({ kind: 'rect', r: 2 }), polygon = obj({ kind: 'polygon', sides: 5, star: false });
  const defaults = { kind: 'text', text: 'Hello', font: 'Arial', size: 5, hSpace: 0, vSpace: 0, align: 'left', bold: false, italic: false, upper: false };
  const text = obj({ ...defaults });
  const ed = {
    doc: { bed: { w: 300, h: 200 } }, sel: [rect], tool: 'select', textDefaults: { ...defaults },
    rectRadius: 1, polySides: 6, polyStar: false, pencilTolerance: 0.1, pencilClosed: false,
    arcMode: 'center', arcCw: false, shaperRecognize: true, shaperCloseGap: 1, shaperSmoothing: 2, shaperTolerance: 1,
    nodeLasso: false, nodeSelCount: 0, shaperEdit: null,
    selBounds() { return this.sel.length ? { ...box } : null; },
    selTexts() { return this.sel.filter(o => o.shape.kind === 'text'); },
    selImages() { return this.sel.filter(o => o.shape.kind === 'image'); },
    selBarcodes() { return this.sel.filter(o => o.shape.kind === 'barcode'); },
    selGens() { return this.sel.filter(o => o.shape.kind === 'gen'); },
    emit() { refresh(); }, touch() {},
    setSelBox(values, ax, ay, lock) {
      calls.push({ type: 'box', values, ax, ay, lock });
      if (values.w !== undefined) box.w = values.w;
      if (values.h !== undefined) box.h = values.h;
      if (values.x !== undefined) box.x = values.x - ax * box.w;
      if (values.y !== undefined) box.y = values.y - ay * box.h;
      this.emit();
    },
    setObjBind(o, key, src, options) { calls.push({ type: 'formula', key, src, options }); return []; },
    dropObjBind() {}, rotateBy() {}, updateShapes(kind, values) { calls.push({ type: kind, values }); this.emit(); },
    updateTexts(values) { calls.push({ type: 'text', values }); Object.assign(this.textDefaults, values); this.selTexts().forEach(o => Object.assign(o.shape, values)); this.emit(); },
    updateTextPath() {}, applyPathToText() {}, removePathFromText() {}, toggleTextWrap() {}, canApplyPathToText() { return false; },
    nodeTargets() { return []; }, segmentSelection() { return new Set(); },
    setSegmentType() {}, setNodeType() {}, deleteNodes() {},
    setArcOptions(values) { calls.push({ type: 'arc', values }); if (values.mode) this.arcMode = values.mode; if (values.cw !== undefined) this.arcCw = values.cw; this.emit(); },
    shaperEditValid() { return false; }, shaperRebuild() { this.emit(); },
    imgOutput() { return { interval: 0.1 }; }, cropImageSel() {}, convertSelToPath() {},
  };
  const refresh = () => { refreshes++; for (const record of mounted) record.control.update(snapshot); };
  const mount = name => {
    const host = document.createElement('div'); area.append(host);
    const n = ++serial, context = { viewId: 'view-' + n, ownerId: 'numbar', controlId: 'control:' + name, instanceId: 'instance-' + n,
      id: suffix => 'fixture-' + n + '-' + suffix, isAvailable: () => alive };
    const control = owner.controls.find(c => c.id === context.controlId).create(context);
    const record = { control, host }; mounted.push(record); control.mount(host); return record;
  };
  const enter = input => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
  const change = input => input.dispatchEvent(new Event('change', { bubbles: true }));
  const next = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    bindEditorToolbarDialogs(ed, { corner() {}, adjust() {}, trace() {} });
    owner = createEditorToolbarControls(ed, refresh); snapshot = createState(owner.definitions);
    await next();
    check(owner.controls.length === 11 && owner.definitions.groups.every(g => g.kind === 'section' && g.items.length === 1 && g.items[0].kind === 'control'), 'all 11 feature factories registered as flat sections');
    check(owner.definitions.bars.map(b => b.id).join() === 'numbar,textbar' && owner.definitions.bars.every((b, i) => b.layout.placement.lane === i + 1 && b.layout.rows === 1 && b.layout.columns === 1 && b.layout.orientation === 'horizontal'), 'default properties/text bars use top lanes 1/2 and one horizontal row');
    const a = mount('geometry'), b = mount('geometry');
    check(a.host.querySelector('input') !== b.host.querySelector('input'), 'two geometry instances own independent native DOM');
    a.host.querySelectorAll('.anchor button')[0].click();
    a.host.querySelector('button.ib').click();
    check(b.host.querySelectorAll('.anchor button')[0].getAttribute('aria-pressed') === 'true' && b.host.querySelector('button.ib').getAttribute('aria-pressed') === 'false', 'anchor and aspect lock synchronize across geometry instances');
    const width = b.host.querySelectorAll('input')[2]; width.focus(); width.value = '55'; enter(width);
    const write = calls.filter(c => c.type === 'box').at(-1);
    check(write.values.w === 55 && write.ax === 0 && write.ay === 0 && write.lock === false && a.host.querySelectorAll('input')[2].value === '55.00', 'native geometry commit reuses shared anchor/lock and updates its peer');
    box.x = 81; ed.emit();
    check(a.host.querySelector('input').value === '81.00' && b.host.querySelector('input').value === '81.00', 'ordinary editor refresh updates both geometry views');
    const draft = a.host.querySelector('input'); draft.focus(); draft.value = 'Width + 10'; draft.setSelectionRange(2, 7); box.x = 82; refresh();
    check(draft.value === 'Width + 10' && draft.selectionStart === 2 && draft.selectionEnd === 7 && document.activeElement === draft && b.host.querySelector('input').value === '82.00', 'focused formula draft and caret survive refresh while peer updates');
    draft.value = '82'; draft.blur();
    a.host.classList.add('toolbar-view'); a.host.dataset.orientation = 'vertical';
    const geometry = a.host.firstElementChild, labels = geometry.querySelectorAll('label');
    const sideWidth = geometry.getBoundingClientRect().width;
    check(sideWidth < 200 && labels[1].getBoundingClientRect().top >= labels[0].getBoundingClientRect().bottom,
      'vertical geometry control stacks field units instead of reserving a horizontal toolbar width');
    a.host.dataset.orientation = 'horizontal';
    check(geometry.getBoundingClientRect().width > sideWidth && a.host.querySelector('input') === draft && draft.value === '82',
      'returning geometry to a horizontal bar restores its row without rebuilding or changing field state');
    a.host.classList.remove('toolbar-view'); delete a.host.dataset.orientation;
    ed.sel = []; refresh();
    check(a.host.firstElementChild.classList.contains('group-disabled'), 'geometry stays visible but disabled without selection');
    const writes = calls.length; draft.focus(); draft.value = '99'; enter(draft);
    check(calls.length === writes, 'geometry native commit rejects unavailable current selection');
    ed.sel = [rect]; ed.tool = 'arc'; refresh();
    const arcA = mount('arc'), arcB = mount('arc');
    const ids = [...area.querySelectorAll('[id]')].map(n => n.id);
    check(new Set(ids).size === ids.length && area.querySelectorAll('.arcbar').length === 2 && !document.getElementById('arc-mode') && !document.getElementById('arcbar'), 'arc helper IDs are namespaced with stable arcbar class');
    const mode = arcA.host.querySelector('select'); mode.value = '3point'; change(mode);
    const dir = arcA.host.querySelectorAll('select')[1]; dir.value = 'cw'; change(dir);
    check(arcB.host.querySelector('select').value === '3point' && arcB.host.querySelectorAll('select')[1].value === 'cw', 'native arc options synchronize across two views');
    ed.tool = 'select'; const beforeArc = calls.length; mode.value = 'center'; change(mode);
    check(calls.length === beforeArc, 'arc commits recheck current tool before update');
    ed.tool = 'pencil'; const pencil = mount('pencil'), pencilPeer = mount('pencil');
    const tolerance = pencil.host.querySelector('input'); tolerance.focus(); tolerance.value = '0.345'; ed.pencilTolerance = 0.2; refresh();
    check(tolerance.value === '0.345', 'focused pencil draft survives update');
    change(tolerance); tolerance.blur();
    check(ed.pencilTolerance === 0.345 && pencilPeer.host.querySelector('input').value === '0.345', 'pencil values synchronize through owner refresh');
    ed.tool = 'shaper'; const shaper = mount('shaper'); const smooth = shaper.host.querySelectorAll('input')[2];
    smooth.focus(); smooth.value = '3.4'; ed.shaperSmoothing = 5; refresh();
    check(smooth.value === '3.4', 'focused shaper numeric draft survives update'); smooth.blur();
    const cases = [
      ['rectangle', 'rect', [rect]], ['polygon', 'polygon', [polygon]], ['nodes', 'node', [rect]],
      ['image', 'select', [obj({ kind: 'image', w: 5, h: 8, pxW: 50, pxH: 80 })]],
      ['barcode', 'select', [obj({ kind: 'barcode', type: 'qr' })]],
      ['generator', 'select', [obj({ kind: 'gen', gen: 'fixture-missing', params: {} })]],
    ];
    for (const [name, tool, selection] of cases) {
      ed.tool = tool; ed.sel = selection; refresh(); const view = mount(name); view.control.update(snapshot);
      check(!!view.host.firstElementChild && !view.host.firstElementChild.hidden, name + ' factory mounts and updates in relevant editor context');
    }
    ed.tool = 'text'; ed.sel = [text]; refresh();
    const textA = mount('text'), textB = mount('text');
    textA.host.classList.add('toolbar-view');
    for (const [size, expected] of [['s', 24], ['m', 24], ['l', 40]]) {
      textA.host.dataset.size = size;
      const align = textA.host.querySelector('[data-align]'), icon = align.querySelector('svg');
      check(align.getBoundingClientRect().width === expected && icon.getBoundingClientRect().width <= expected,
        'text alignment button respects icon size without overflowing its button: ' + size);
    }
    textA.host.classList.remove('toolbar-view'); delete textA.host.dataset.size;
    const bold = [...textA.host.querySelectorAll('button')].find(n => n.style.fontWeight === '700'); bold.click();
    check(text.shape.bold && [...textB.host.querySelectorAll('button')].some(n => n.style.fontWeight === '700' && n.classList.contains('on')), 'text feature native commits update peer view');
    const originalAdd = EventTarget.prototype.addEventListener, originalRemove = EventTarget.prototype.removeEventListener;
    const listeners = new Map();
    EventTarget.prototype.addEventListener = function(type, fn, options) { if (this === document || this === window) listeners.set(fn, type); return originalAdd.call(this, type, fn, options); };
    EventTarget.prototype.removeEventListener = function(type, fn, options) { listeners.delete(fn); return originalRemove.call(this, type, fn, options); };
    try {
      textA.host.querySelector('.fontpick-btn').click();
      check(document.querySelector('.fontpick-pop') !== null && listeners.size >= 4, 'font popup installs native dismissal listeners');
      textA.control.dispose();
      check(document.querySelector('.fontpick-pop') === null && listeners.size === 0, 'disposing text instance removes popup and its document/window listeners');
    } finally { EventTarget.prototype.addEventListener = originalAdd; EventTarget.prototype.removeEventListener = originalRemove; }
    let notified = 0; const off = onFontListChanged(() => notified++); off(); off(); refreshFonts(); await next();
    check(notified === 0, 'font list unsubscribe is backward-compatible and idempotent');
    // Dispose while the async list refresh from refreshFonts is still pending.
    refreshFonts(); owner.dispose(); const afterDispose = refreshes; await next();
    refreshFonts(); await next();
    check(refreshes === afterDispose, 'owner disposal cancels pending font results and unsubscribes font list');
    check(mounted.every(v => !v.host.firstElementChild), 'owner disposal retires every mounted feature instance');
    const beforeDead = calls.length; draft.value = '123'; enter(draft); mode.value = 'center'; change(mode);
    check(calls.length === beforeDead, 'retained disposed native controls cannot commit');
    owner = createEditorToolbarControls(ed, refresh); snapshot = createState(owner.definitions);
    ed.sel = [rect]; ed.tool = 'arc'; const stale = mount('arc'); alive = false;
    stale.host.querySelector('select').value = 'center'; const beforeUnavailable = calls.length; change(stale.host.querySelector('select'));
    check(calls.length === beforeUnavailable, 'ControlContext.isAvailable is rechecked on native commit');
    owner.dispose();
  } catch (error) { errors.push(String(error.stack ?? error)); }
  finally { owner?.dispose(); area.remove(); }
  return { passed, errors, editor: 'minimal feature-call double; genuine controls and native DOM; no hardware' };
};
` },
  bundle: true, write: false, outfile: 'fixture.js', format: 'esm', metafile: true,
  loader: { '.woff': 'empty', '.woff2': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
});
if (Object.keys(result.metafile.inputs).some(path => path === 'src/ui.ts' || path === 'src/main.ts'))
  throw new Error('Control fixture must not import the application entry point');
for (const file of result.outputFiles)
  await writeFile(`${out}/${file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'}`, file.contents);
await writeFile(`${out}/index.html`, '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; img-src \'self\' data:; font-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; script-src \'self\'"><title>Offline toolbar feature-control checks</title><link rel="stylesheet" href="fixture.css"><body><script type="module" src="fixture.js"></script></body></html>');
console.log(`Built ${out}/index.html; call window.runToolbarControlChecks() in a native browser. Network blocked by CSP.`);
