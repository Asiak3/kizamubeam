import type { Editor } from '../editor';
import { ICONS } from '../icons';
import type { BarcodeShape, GenShape, ImageShape, Obj, ObjBindKey, TextShape } from '../model';
import { evaluate, formatNumber, namesIn } from '../params';
import { onFontListChanged, refreshFonts, requestLocalFonts, systemFonts } from '../fonts';
import { openFontManager } from '../fontManager';
import { createFontPicker } from '../fontPicker';
import { f2, h, iconBtn, numInput, sep, setIcon, setVal } from '../dom';
import { openBackgroundDialog } from '../bgDialog';
import { openQrDialog, openVarTextDialog } from '../qrDialog';
import { openBarcodeDialog } from '../barcodeDialog';
import { LINEAR_NAMES } from '../barcode1d';
import { genLabel, getGenerator } from '../generators';
import { outputGrid } from '../images';
import { shaperName } from '../editor/shaper';
import type { ShaperKind } from '../shaper';
import { t, tn } from '../i18n';
import type { Definitions } from './model';
import type { ControlContext, ControlDefinition, ToolbarControl } from './registry';

interface ToolbarDialogs {
  corner(): void;
  adjust(): void;
  trace(): void;
}
const dialogs = new WeakMap<Editor, ToolbarDialogs>();
/** Keep the existing UI-owned dialogs without importing the UI entry point. */
export function bindEditorToolbarDialogs(ed: Editor, callbacks: ToolbarDialogs): void {
  dialogs.set(ed, callbacks);
}

const FONT_CANDIDATES = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Times New Roman', 'Georgia',
  'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
  'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Noto Sans', 'Noto Serif', 'Ubuntu', 'Cantarell',
  'Roboto', 'Open Sans', 'Helvetica Neue', 'Menlo', 'Monaco', 'Avenir', 'Futura', 'Gill Sans',
];
function availableFonts(): string[] {
  const c = document.createElement('canvas').getContext('2d')!;
  const sample = 'abcdefghijklmnopqrstuvwxyzWMI0123456789';
  const widths = (fb: string) => { c.font = `40px ${fb}`; return c.measureText(sample).width; };
  const base = { monospace: widths('monospace'), serif: widths('serif'), 'sans-serif': widths('sans-serif') };
  const found = FONT_CANDIDATES.filter((f) =>
    (Object.keys(base) as (keyof typeof base)[]).some((fb) => {
      c.font = `40px "${f}", ${fb}`;
      return c.measureText(sample).width !== base[fb];
    }),
  );
  return [...found, 'sans-serif', 'serif', 'monospace'];
}

/** One owner per editor; only anchor/aspect lock are shared between geometry views. */
export function createEditorToolbarControls(ed: Editor, refresh: () => void): {
  definitions: Definitions; controls: ControlDefinition[]; dispose(): void;
} {
  let ax = 0.5, ay = 0.5, lock = true, disposed = false, fontRequest = 0;
  const editorDialogs = dialogs.get(ed);
  let fontNames = availableFonts();
  const instances = new Set<ToolbarControl>();
  const pickers = new Set<ReturnType<typeof createFontPicker>>();
  const loadFontList = async () => {
    const request = ++fontRequest;
    const list = await systemFonts();
    if (disposed || request !== fontRequest) return;
    if (list?.length) fontNames = list;
    for (const picker of pickers) picker.rebuild(fontNames);
    refresh();
  };
  const unsubscribeFonts = onFontListChanged(() => void loadFontList());
  void loadFontList();
  const single = () => ed.sel.length === 1 ? ed.sel[0] : null;
  const say = (msg: string) => ((ed.hint = msg), ed.emit('tool'));
  const formula = (key: ObjBindKey) => (src: string): boolean => {
    const o = single();
    if (!src) {
      if (!o?.bind?.[key]) return false;
      ed.setObjBind(o, key, '');
      return true;
    }
    if (!namesIn(src).length) return false;
    if (!o) return say(t('Formeln gehen nur bei einem einzelnen Objekt. Mehrere Objekte vorher gruppieren.')), false;
    if ((key === 'w' || key === 'h') && o.shape.kind === 'gen') return say(t('Die Größe parametrischer Bauteile kommt aus ihren Parametern; dort eine Formel eintragen.')), false;
    const issues = ed.setObjBind(o, key, src, { anchor: [ax, ay], lock });
    say(issues.length ? issues.map((i) => i.msg).join('; ') : t('Formel gesetzt: ändert sich ein Parameter, wird der Wert neu berechnet. Eine Zahl eintragen löst die Formel.'));
    return true;
  };
  const plain = (keys: ObjBindKey[], f: (v: number) => void) => (v: number) => {
    f(v);
    ed.dropObjBind(ed.sel, keys);
    refresh();
  };
  const bindField = (el: HTMLInputElement, key: ObjBindKey, fallback: string, objOk: (o: Obj) => boolean = () => true) => {
    const o = single();
    const src = o && objOk(o) ? o.bind?.[key] : undefined;
    el.classList.toggle('bound', !!src);
    if (!el.dataset.title) el.dataset.title = el.title;
    if (src) {
      setVal(el, src);
      let v = '';
      try { const r = evaluate(src); v = typeof r === 'number' ? formatNumber(r) : String(r); }
      catch (e) { v = e instanceof Error ? e.message : String(e); }
      el.title = `${el.dataset.title}\n${t('Formel: {src} = {v}', { src, v })}`;
    } else { setVal(el, fallback); el.title = el.dataset.title; }
  };
  const controls: ControlDefinition[] = [];
  type View = { el: HTMLElement; update(): void; dispose?(): void };
  const register = (name: string, label: string, enabled: () => boolean,
    build: (context: ControlContext, available: () => boolean) => View) => {
    controls.push({ id: `control:${name}`, label, create(context) {
      if (disposed) return { mount() {}, update() {}, activate() {}, dispose() {} };
      let dead = false;
      const available = () => !dead && !disposed && context.isAvailable() && enabled();
      const view = build(context, available);
      // Capture native events before their target handlers. Recheck current editor
      // context, not the last render's disabled appearance (including blur commits).
      const guard = (event: Event) => {
        if (!available() || (event.target instanceof Element && event.target.closest('[hidden], .group-disabled'))) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      };
      for (const event of ['click', 'change', 'input', 'keydown', 'focusout', 'blur']) view.el.addEventListener(event, guard, true);
      const instance: ToolbarControl = {
        mount(host) { if (!dead && !disposed) { host.append(view.el); view.update(); } },
        update() { if (!dead && !disposed) view.update(); },
        activate() { if (available()) view.el.querySelector<HTMLElement>('input, select, button')?.focus(); },
        dispose() {
          if (dead) return;
          dead = true;
          view.dispose?.();
          // Keep the local guard on retired DOM: a retained input must not commit
          // through its original native handlers after this instance is disposed.
          view.el.remove();
          instances.delete(instance);
        },
      };
      instances.add(instance);
      return instance;
    } });
  };
  const currentRot = () => ed.sel.length === 1 ? (-Math.atan2(ed.sel[0].m[1], ed.sel[0].m[0]) * 180) / Math.PI : 0;
  register('geometry', t('Bezugspunkt'), () => !!ed.selBounds(), () => {
    const fx = numInput('num', plain(['x'], (v) => ed.setSelBox({ x: v }, ax, ay, lock)), t('X-Position (mm)'), formula('x'));
    const fy = numInput('num', plain(['y'], (v) => ed.setSelBox({ y: ed.doc.bed.h - v }, ax, ay, lock)), t('Y-Position (mm, Ursprung unten links)'), formula('y'));
    const fw = numInput('num', plain(['w', 'h'], (v) => ed.setSelBox({ w: v }, ax, ay, lock)), t('Breite (mm)'), formula('w'));
    const fh = numInput('num', plain(['w', 'h'], (v) => ed.setSelBox({ h: v }, ax, ay, lock)), t('Höhe (mm)'), formula('h'));
    const fwp = numInput('small', (v) => { const b = ed.selBounds(); if (b) ed.setSelBox({ w: b.w * v / 100 }, ax, ay, lock); }, t('Breite in %'));
    const fhp = numInput('small', (v) => { const b = ed.selBounds(); if (b) ed.setSelBox({ h: b.h * v / 100 }, ax, ay, lock); }, t('Höhe in %'));
    const fr = numInput('small', plain(['rot'], (v) => {
      const b = ed.selBounds();
      if (b) ed.rotateBy(v - currentRot(), { x: b.x + ax * b.w, y: b.y + ay * b.h });
    }), t('Drehung in Grad (gegen den Uhrzeigersinn)'), formula('rot'));
    const lockBtn = h('button', { class: 'ib on', title: t('Seitenverhältnis sperren'), icon: 'lock', onclick: () => { lock = !lock; refresh(); } });
    const anchor = h('div', { class: 'anchor', title: t('Bezugspunkt') });
    const anchorBtns: HTMLButtonElement[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const b = h('button', { 'aria-label': `${t('Bezugspunkt')} ${r + 1}, ${c + 1}`, onclick: () => { ax = c / 2; ay = r / 2; refresh(); } });
      anchorBtns.push(b); anchor.append(b);
    }
    const el = h('div', { class: 'field' },
      h('label', {}, 'X', fx), h('label', {}, 'Y', fy), anchor,
      h('label', {}, t('B'), fw), h('label', {}, t('H'), fh), lockBtn,
      h('label', {}, fwp, '%'), h('label', {}, fhp, '%'),
      h('label', {}, '↻', fr, '°'), h('span', { class: 'toggle', title: t('Einheit') }, 'mm'));
    return { el, update() {
      const b = ed.selBounds();
      el.classList.toggle('group-disabled', !b);
      lockBtn.classList.toggle('on', lock); setIcon(lockBtn, lock ? 'lock' : 'unlock');
      lockBtn.setAttribute('aria-pressed', String(lock));
      anchorBtns.forEach((button, i) => {
        const on = i % 3 / 2 === ax && Math.floor(i / 3) / 2 === ay;
        button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
      });
      if (b) {
        bindField(fx, 'x', f2(b.x + ax * b.w)); bindField(fy, 'y', f2(ed.doc.bed.h - (b.y + ay * b.h)));
        bindField(fw, 'w', f2(b.w)); bindField(fh, 'h', f2(b.h));
        setVal(fwp, '100'); setVal(fhp, '100'); bindField(fr, 'rot', f2(currentRot()));
      } else [fx, fy, fw, fh, fwp, fhp, fr].forEach((f) => setVal(f, ''));
    } };
  });
  register('rectangle', t('Radius'), () => ed.tool === 'rect' || ed.sel.some((o) => o.shape.kind === 'rect'), () => {
    const fRad = numInput('small', plain(['r'], (v) => ed.updateShapes('rect', { r: Math.max(0, v) })), t('Eckenradius (mm)'), formula('r'));
    const el = h('label', {}, t('Radius'), fRad);
    return { el, update() {
      const rect = ed.sel.find((o) => o.shape.kind === 'rect');
      el.hidden = !(rect || ed.tool === 'rect');
      bindField(fRad, 'r', f2(rect && rect.shape.kind === 'rect' ? rect.shape.r : ed.rectRadius), (o) => o.shape.kind === 'rect');
    } };
  });
  register('polygon', t('Ecken'), () => ed.tool === 'polygon' || ed.sel.some((o) => o.shape.kind === 'polygon'), () => {
    const fSides = numInput('small', plain(['sides'], (v) => ed.updateShapes('polygon', { sides: Math.max(3, Math.min(64, Math.round(v))) })), t('Anzahl Ecken'), formula('sides'));
    const starBtn = h('button', { class: 'toggle', title: t('Stern'), onclick: () => ed.updateShapes('polygon', { star: !starBtn.classList.contains('on') }) }, t('Stern'));
    const el = h('span', { class: 'field' }, h('label', {}, t('Ecken'), fSides), starBtn);
    return { el, update() {
      const poly = ed.sel.find((o) => o.shape.kind === 'polygon');
      el.hidden = !(poly || ed.tool === 'polygon');
      const pv = poly && poly.shape.kind === 'polygon' ? poly.shape : { sides: ed.polySides, star: ed.polyStar };
      bindField(fSides, 'sides', String(pv.sides), (o) => o.shape.kind === 'polygon'); starBtn.classList.toggle('on', pv.star);
    } };
  });
  register('text', t('Textleiste'), () => !!ed.selTexts().length || ed.tool === 'text', (_context, available) => {
    const fontPicker = createFontPicker(ed, {
      initial: fontNames,
      current: () => { const ts = ed.selTexts(); return ts.length ? (ts[0].shape as TextShape).font : ed.textDefaults.font; },
      commit: (family) => {
        if (!available()) return;
        ed.updateTexts({ font: family });
        void requestLocalFonts().then((ok) => { if (ok && available()) refreshFonts(); });
      },
      openManager: () => { if (available()) void openFontManager(ed); },
    });
    pickers.add(fontPicker);
    const fSize = numInput('small', plain(['size'], (v) => v > 0 && ed.updateTexts({ size: v })), t('Schriftgröße (mm)'), formula('size'));
    const fHs = numInput('small', (v) => ed.updateTexts({ hSpace: v }), t('Zeichenabstand (mm)'));
    const fVs = numInput('small', (v) => ed.updateTexts({ vSpace: v }), t('Zeilenabstand (mm)'));
    const tog = (label: string, key: 'bold' | 'italic' | 'upper', title: string) => {
      const b = h('button', { class: 'toggle', title }, label);
      b.addEventListener('click', () => ed.updateTexts({ [key]: !b.classList.contains('on') } as Partial<TextShape>)); return b;
    };
    const bBold = tog(t('F'), 'bold', t('Fett')); bBold.style.fontWeight = '700';
    const bItal = tog(t('K'), 'italic', t('Kursiv')); bItal.style.fontStyle = 'italic';
    const bUp = tog('AB', 'upper', t('Großbuchstaben'));
    const alignBtns = (['left', 'center', 'right'] as const).map((a) => {
      const b = iconBtn(a === 'left' ? 'alignTextL' : a === 'center' ? 'alignTextC' : 'alignTextR', a === 'left' ? t('Ausrichtung links') : a === 'center' ? t('Ausrichtung mittig') : t('Ausrichtung rechts'), () => ed.updateTexts({ align: a }));
      b.classList.add('toolbar-text-align'); b.dataset.align = a; return b;
    });
    const bWeld = h('button', { class: 'toggle', title: t('Buchstaben schweißen: überlappende Zeichen zu einer Kontur verschmelzen') }, t('Schweißen'));
    bWeld.addEventListener('click', () => ed.updateTexts({ weld: !bWeld.classList.contains('on') }));
    const bOnPath = h('button', { class: 'toggle', title: t('Text folgt der gewählten Form (Text und eine Form auswählen)'), onclick: () => ed.applyPathToText() }, t('Auf Pfad'));
    const fPOff = numInput('small', (v) => ed.updateTextPath({ offset: v }), t('Verschiebung entlang der Kurve (mm)'));
    const fPDist = numInput('small', (v) => ed.updateTextPath({ dist: v }), t('Abstand der Grundlinie zur Kurve (mm)'));
    const bPFlip = h('button', { class: 'toggle', title: t('Text auf die andere Seite der Kurve legen') }, t('Seite|Text auf Pfad'));
    bPFlip.addEventListener('click', () => ed.updateTextPath({ flip: !bPFlip.classList.contains('on') }));
    const bPOff = h('button', { class: 'toggle', title: t('Text wieder gerade setzen'), onclick: () => ed.removePathFromText() }, t('Lösen'));
    const bVar = h('button', { class: 'toggle', title: t('Variabler Text: Platzhalter wie %# (Seriennummer), %Y (Jahr) oder %0 (CSV-Spalte) ersetzen') }, t('Variabel'));
    bVar.addEventListener('click', () => {
      const on = !bVar.classList.contains('on'); ed.updateTexts({ vt: on ? { offset: 0 } : undefined });
      if (on && !ed.selTexts().some((o) => /%/.test((o.shape as TextShape).text)))
        (ed.hint = t('Variabler Text an. Platzhalter wie %# in den Text schreiben; Übersicht unter „Variabler Text …“.')), ed.emit('tool');
    });
    const fVtOff = numInput('small', (v) => ed.updateTexts({ vt: { offset: Math.round(v) } }), t('Versatz: wird zur aktuellen Nummer addiert'));
    const bVtDlg = h('button', { class: 'toggle', title: t('Nummer, CSV-Datei und Platzhalter'), onclick: () => openVarTextDialog(ed) }, '…');
    const vtProps = h('span', { class: 'field' }, h('label', {}, t('Versatz|Variabler Text'), fVtOff), bVtDlg);
    const fMaxW = numInput('small', plain(['maxW'], (v) => ed.updateTexts({ maxW: Math.max(0, v) })), t('Höchstbreite (mm): breitere Zeilen werden gestaucht (mit „Verkleinern“ verkleinert, mit „Umbrechen“ umbrochen), 0 = aus'), formula('maxW'));
    const fMaxH = numInput('small', plain(['maxH'], (v) => ed.updateTexts({ maxH: Math.max(0, v) })), t('Höchsthöhe (mm): ein höherer Textblock wird gleichmäßig verkleinert, 0 = aus'), formula('maxH'));
    const bShrink = h('button', { class: 'toggle', title: t('Text in Rahmen einpassen: zu breiten Text gleichmäßig verkleinern statt stauchen') }, t('Verkleinern|Text einpassen'));
    bShrink.addEventListener('click', () => ed.updateTexts({ fit: bShrink.classList.contains('on') ? undefined : 'shrink' }));
    const bWrap = h('button', { class: 'toggle', title: t('Textrahmen: Zeilen an der Max. Breite umbrechen, die Höhe wächst mit (Rahmen auch mit dem Textwerkzeug aufziehen)'), onclick: () => ed.toggleTextWrap() }, t('Umbrechen|Textrahmen'));
    const pathProps = h('span', { class: 'field' }, h('label', {}, t('Versatz'), fPOff), h('label', {}, t('Abstand|Text auf Pfad'), fPDist), bPFlip, bPOff);
    const el = h('div', { class: 'field' },
      h('span', { icon: 'text', class: 'icon-inline', style: 'color: var(--muted)', title: t('Textleiste') }),
      h('label', {}, t('Schrift'), fontPicker.el), h('label', {}, t('Höhe'), fSize), bBold, bItal, bUp, ...alignBtns, sep(),
      h('label', {}, t('Abst. H'), fHs), h('label', {}, 'V', fVs), sep(),
      h('label', {}, t('Max. Breite'), fMaxW), h('label', {}, t('Max. Höhe'), fMaxH), bShrink, bWrap, sep(),
      bWeld, bOnPath, pathProps, bVar, vtProps);
    return { el, dispose() { pickers.delete(fontPicker); fontPicker.close(); }, update() {
      const ts = ed.selTexts(), tx = ts.length ? ts[0].shape as TextShape : ed.textDefaults;
      el.classList.toggle('group-disabled', !ts.length && ed.tool !== 'text');
      if (!available()) fontPicker.close();
      fontPicker.sync(tx.font); bindField(fSize, 'size', f2(tx.size), (o) => o.shape.kind === 'text');
      setVal(fHs, f2(tx.hSpace)); setVal(fVs, f2(tx.vSpace));
      bBold.classList.toggle('on', tx.bold); bItal.classList.toggle('on', tx.italic); bUp.classList.toggle('on', tx.upper);
      alignBtns.forEach((b) => b.classList.toggle('on', b.dataset.align === tx.align)); bWeld.classList.toggle('on', !!tx.weld);
      const tvt = ts.length ? (ts[0].shape as TextShape).vt : undefined;
      bVar.classList.toggle('on', !!tvt); bVar.hidden = !ts.length; vtProps.hidden = !tvt;
      if (tvt) setVal(fVtOff, String(tvt.offset));
      bindField(fMaxW, 'maxW', f2(ts.length ? (ts[0].shape as TextShape).maxW ?? 0 : 0), (o) => o.shape.kind === 'text');
      bindField(fMaxH, 'maxH', f2(ts.length ? (ts[0].shape as TextShape).maxH ?? 0 : 0), (o) => o.shape.kind === 'text');
      bShrink.classList.toggle('on', ts.length > 0 && (ts[0].shape as TextShape).fit === 'shrink');
      bWrap.classList.toggle('on', ts.length > 0 && (ts[0].shape as TextShape).fit === 'wrap');
      bOnPath.hidden = !ed.canApplyPathToText();
      const tp = ts.length ? (ts[0].shape as TextShape).path : undefined;
      pathProps.hidden = !tp;
      if (tp) { setVal(fPOff, f2(tp.offset)); setVal(fPDist, f2(tp.dist)); bPFlip.classList.toggle('on', tp.flip); }
    } };
  });
  register('nodes', t('Knoten-Lasso'), () => ed.tool === 'node' && !!ed.sel.length, () => {
    const nodeBtn = (label: string, title: string, f: () => void) => h('button', { class: 'toggle', title, onclick: f }, label);
    const info = h('span', { class: 'muted' });
    const lasso = nodeBtn(t('Knoten-Lasso'), t('Lasso statt Rahmen für Knoten und Anfasser; Alt zieht auch direkt über einer Komponente'), () => { ed.nodeLasso = !ed.nodeLasso; ed.emit('tool'); });
    const el = h('div', { class: 'field' }, info, lasso,
      nodeBtn(t('Gerade'), t('Segmente zwischen den ausgewählten Knoten in Geraden umwandeln (L)'), () => ed.setSegmentType(false)),
      nodeBtn(t('Kurve'), t('Segmente zwischen den ausgewählten Knoten in Kurven umwandeln (C)'), () => ed.setSegmentType(true)),
      nodeBtn(t('Ecke'), t('Ausgewählte Knoten zu Ecken machen, Anfasser entfernen (E)'), () => ed.setNodeType(false)),
      nodeBtn(t('Glatt'), t('Ausgewählte Knoten glätten (S)'), () => ed.setNodeType(true)),
      nodeBtn(t('Löschen'), t('Ausgewählte Knoten löschen (Entf)'), () => ed.deleteNodes()),
      nodeBtn(t('Ecken …'), t('Ausgewählte Ecken runden, innen runden oder fasen'), () => editorDialogs?.corner()));
    return { el, update() {
      el.hidden = ed.tool !== 'node'; el.classList.toggle('group-disabled', !ed.sel.length);
      lasso.setAttribute('aria-pressed', String(ed.nodeLasso)); lasso.classList.toggle('active', ed.nodeLasso);
      const nn = ed.nodeSelCount, ns = ed.nodeTargets().reduce((n, o) => n + ed.segmentSelection(o).size, 0);
      info.textContent = [tn('{n} Knoten|one', '{n} Knoten', nn), tn('{n} Segment', '{n} Segmente', ns), tn('{n} Objekt', '{n} Objekte', ed.nodeTargets().length)].join(' · ');
    } };
  });
  register('pencil', t('Freihand'), () => ed.tool === 'pencil', () => {
    const tolerance = h('input', { type: 'number', min: 0.001, max: 100, step: 0.01, 'aria-label': t('Freihandtoleranz in Millimetern'), style: 'width: 7ch' });
    tolerance.addEventListener('change', () => {
      const v = tolerance.valueAsNumber;
      if (Number.isFinite(v) && v >= 0.001 && v <= 100) { ed.pencilTolerance = v; refresh(); }
      else tolerance.value = String(ed.pencilTolerance);
    });
    const closed = h('input', { type: 'checkbox' });
    closed.addEventListener('change', () => { ed.pencilClosed = closed.checked; refresh(); });
    const el = h('span', { class: 'field' }, h('label', {}, t('Anpassungstoleranz (mm)'), tolerance), h('label', { class: 'check' }, closed, t('Geschlossener Pfad')));
    return { el, update() { el.hidden = ed.tool !== 'pencil'; setVal(tolerance, String(ed.pencilTolerance)); closed.checked = ed.pencilClosed; } };
  });
  register('arc', t('Bogen'), () => ed.tool === 'arc', (context) => {
    const mode = h('select', { id: context.id('arc-mode'), title: t('Modus: Mitte–Radius–Winkel oder drei Punkte'), onchange: () => ed.setArcOptions({ mode: mode.value === '3point' ? '3point' : 'center' }) },
      h('option', { value: 'center' }, t('Mitte–Radius–Winkel')), h('option', { value: '3point' }, t('3-Punkt')));
    const direction = h('select', { id: context.id('arc-direction'), title: t('Richtung: wählt im Mitte-Modus den Komplementärbogen, im 3-Punkt-Modus kehrt sie die Knotenreihenfolge um'), onchange: () => ed.setArcOptions({ cw: direction.value === 'cw' }) },
      h('option', { value: 'ccw' }, t('Gegen den Uhrzeigersinn')), h('option', { value: 'cw' }, t('Im Uhrzeigersinn')));
    const el = h('span', { class: 'field arcbar', id: context.id('arcbar') }, h('label', {}, t('Bogen'), mode), h('label', {}, t('Richtung'), direction));
    return { el, update() {
      el.hidden = ed.tool !== 'arc';
      if (document.activeElement !== mode) mode.value = ed.arcMode;
      if (document.activeElement !== direction) direction.value = ed.arcCw ? 'cw' : 'ccw';
    } };
  });
  register('shaper', t('Form erkennen'), () => ed.tool === 'shaper', () => {
    const recognize = h('input', { type: 'checkbox' });
    recognize.addEventListener('change', () => { ed.shaperRecognize = recognize.checked; ed.shaperRebuild(); refresh(); });
    const shaperNum = (get: () => number, min: number, max: number, aria: string, set: (v: number) => void) => {
      const input = h('input', { type: 'number', min, max, step: 0.1, 'aria-label': aria, style: 'width: 7ch' });
      input.addEventListener('change', () => {
        const v = input.valueAsNumber;
        if (Number.isFinite(v) && v >= min && v <= max) { set(v); ed.shaperRebuild(); refresh(); }
        else input.value = String(get());
      }); return input;
    };
    const close = shaperNum(() => ed.shaperCloseGap, 0.2, 20, t('Schließabstand in Millimetern'), (v) => (ed.shaperCloseGap = v));
    const smooth = shaperNum(() => ed.shaperSmoothing, 0, 20, t('Glättung in Millimetern'), (v) => (ed.shaperSmoothing = v));
    const tolerance = shaperNum(() => ed.shaperTolerance, 0.2, 20, t('Schnittbreite in Millimetern'), (v) => (ed.shaperTolerance = v));
    const pick = h('select', { 'aria-label': t('Formvorschlag der letzten Geste') });
    pick.addEventListener('change', () => { const s = ed.shaperEdit; if (!s || !ed.shaperEditValid()) return; s.pick = pick.value as ShaperKind | 'freehand'; ed.shaperRebuild(); });
    const el = h('span', { class: 'field' }, h('label', { class: 'check' }, recognize, t('Form erkennen')), h('label', {}, t('Schließen (mm)'), close), h('label', {}, t('Glättung (mm)'), smooth), h('label', {}, t('Schnittbreite (mm)'), tolerance), pick);
    return { el, update() {
      el.hidden = ed.tool !== 'shaper'; recognize.checked = ed.shaperRecognize;
      setVal(close, String(ed.shaperCloseGap)); setVal(smooth, String(ed.shaperSmoothing)); setVal(tolerance, String(ed.shaperTolerance));
      const sk = ed.shaperEditValid() ? ed.shaperEdit : null;
      pick.hidden = !sk || sk.op === 'union' || sk.op === 'subtract';
      if (sk && !pick.hidden && document.activeElement !== pick) {
        const key = [...sk.cands.map((c) => `${c.kind}:${shaperName(c)}`), 'freehand'].join('|');
        if (pick.dataset.key !== key) { pick.replaceChildren(...sk.cands.map((c) => h('option', { value: c.kind }, shaperName(c))), h('option', { value: 'freehand' }, t('Freihand'))); pick.dataset.key = key; }
        if (pick.value !== sk.pick) pick.value = sk.pick;
      }
    } };
  });
  register('image', t('Anpassen …'), () => !!ed.selImages().length, () => {
    const info = h('span', { class: 'muted' });
    const cropBtns = [
      h('button', { class: 'toggle', title: t('Bild auf den Rahmen der gewählten Form zuschneiden'), onclick: () => { if (ed.selImages().length === 1 && ed.sel.length > 1) ed.cropImageSel(false); } }, t('Zuschneiden')),
      h('button', { class: 'toggle', title: t('Nur das Innere der gewählten geschlossenen Formen vom Bild behalten'), onclick: () => { if (ed.selImages().length === 1 && ed.sel.length > 1) ed.cropImageSel(true); } }, t('Maske')),
    ];
    const el = h('div', { class: 'field' }, h('span', { icon: 'image', class: 'muted icon-inline' }), info,
      h('button', { class: 'toggle', title: t('Helligkeit, Kontrast, Gamma, Schärfen, Bildmodus'), onclick: () => editorDialogs?.adjust() }, t('Anpassen …')),
      h('button', { class: 'toggle', title: t('Bild in Vektoren umwandeln (Alt+T)'), onclick: () => editorDialogs?.trace() }, t('Nachzeichnen …')),
      h('button', { class: 'toggle', title: t('Hintergrund freistellen: ähnliche Farben werden transparent und nicht gelasert'), onclick: () => openBackgroundDialog(ed) }, t('Freistellen …')), ...cropBtns);
    return { el, update() {
      const imgs = ed.selImages(); el.hidden = !imgs.length;
      cropBtns.forEach((b) => (b.hidden = !(imgs.length === 1 && ed.sel.length > 1)));
      if (imgs.length) {
        const o = imgs[0], s = o.shape as ImageShape, L = ed.imgOutput(o.layer), g = outputGrid(s, o.m, L.interval);
        info.textContent = imgs.length > 1 ? t('{n} Bilder', { n: imgs.length }) : t('{pxW} × {pxH} px → {cols} × {rows} Punkte ({dpi} DPI)', { pxW: s.pxW, pxH: s.pxH, cols: g.cols, rows: g.rows, dpi: Math.round(25.4 / L.interval) });
      }
    } };
  });
  register('barcode', t('QR-Code'), () => !!ed.selBarcodes().length, () => {
    const info = h('span', { class: 'muted' });
    const el = h('div', { class: 'field' }, h('span', { icon: 'qr', class: 'muted icon-inline' }), info,
      h('button', { class: 'toggle', title: t('Inhalt, Größe und Einstellungen ändern (Doppelklick)'), onclick: () => {
        const o = ed.selBarcodes()[0]; if (!o) return;
        if (o.shape.kind === 'barcode' && o.shape.type !== 'qr') openBarcodeDialog(ed, o); else openQrDialog(ed, o);
      } }, t('Bearbeiten …')));
    return { el, update() {
      const qrs = ed.selBarcodes(); el.hidden = !qrs.length;
      if (qrs.length) { const q = qrs[0].shape as BarcodeShape; info.textContent = qrs.length > 1 ? t('{n} Codes', { n: qrs.length }) : `${q.type === 'qr' ? t('QR-Code') : LINEAR_NAMES[q.type]}${q.vt ? ` (${t('variabel')})` : ''}`; }
    } };
  });
  register('generator', t('Parameter …'), () => !!ed.selGens().length, () => {
    const info = h('span', { class: 'muted' }), icon = h('span', { icon: 'gear', class: 'muted icon-inline' });
    const el = h('div', { class: 'field' }, icon, info,
      h('button', { class: 'toggle', title: t('Parameter ändern, die Kontur wird neu berechnet (Doppelklick)'), onclick: () => ed.selGens()[0] && ed.onGenEdit?.(ed.selGens()[0]) }, t('Parameter …')),
      h('button', { class: 'toggle', title: t('In gewöhnliche Pfade umwandeln; die Parameter gehen verloren (Ctrl+Shift+C)'), onclick: () => ed.convertSelToPath() }, t('In Pfade umwandeln')));
    return { el, update() {
      const gens = ed.selGens(); el.hidden = !gens.length;
      if (gens.length) { const gs = gens[0].shape as GenShape; info.textContent = gens.length > 1 ? t('{n} Bauteile', { n: gens.length }) : genLabel(gs); const gi = getGenerator(gs.gen)?.icon ?? ''; setIcon(icon, ICONS[gi] ? gi : 'gear'); }
    } };
  });
  const groups = controls.map((control) => ({ id: control.id.replace('control:', 'options:'), label: control.label, kind: 'section' as const, items: [{ kind: 'control' as const, id: control.id }] }));
  const names = ['geometry', 'pencil', 'arc', 'shaper', 'nodes', 'image', 'barcode', 'generator', 'rectangle', 'polygon'];
  const bar = (id: string, label: string, lane: number, features: string[]) => ({
    id, label, items: features.map((name) => ({ kind: 'group' as const, id: `options:${name}` })),
    layout: { placement: { kind: 'dock' as const, edge: 'top' as const, lane, order: 0 }, orientation: 'horizontal' as const, rows: 1, columns: 1 },
  });
  return {
    definitions: { groups, bars: [bar('numbar', t('Eigenschaftenleiste'), 1, names), bar('textbar', t('Textleiste'), 2, ['text'])] },
    controls,
    dispose() {
      if (disposed) return;
      disposed = true; ++fontRequest; unsubscribeFonts();
      for (const instance of [...instances]) instance.dispose();
      if (dialogs.get(ed) === editorDialogs) dialogs.delete(ed);
    },
  };
}
