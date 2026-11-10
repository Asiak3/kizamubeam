// Dialog „Print and Cut“: Passermarken setzen, gedrucktes Blatt mit Laserpunkt oder Kamera einmessen und das
// Design daran ausrichten. Rechenkern in printcut.ts.
import { Editor } from './editor';
import { check } from './arrayDialogs';
import { cameraViews } from './cameraui';
import { h } from './dom';
import { boundsOf } from './geom';
import { jogLines, pointerGCode, rotaryOn } from './gcode';
import { dec, t, tn } from './i18n';
import { device, setStartFrom } from './laser';
import { machine } from './machine';
import { mul, Pt } from './model';
import { findJigs, jigMarkCenters } from './jigUse';
import { designToMachine, findMarks, Fit, FitMode, fitTransform, machineToDesign, makeMark, markCenter, markPlaces, minMarks, nextMarkNr } from './printcut';

const KEY = 'kizamubeam.printcut';

interface Settings {
  size: number;
  margin: number;
  power: number;
  step: number;
  mode: FitMode | 'auto';
}
const DEFAULTS: Settings = { size: 6, margin: 4, power: 1, step: 1, mode: 'auto' };

function load(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Gemessene Markenmitten (Design-Koordinaten) je Objekt-ID; bleiben erhalten, solange das Programm läuft */
const measured = new Map<string, Pt>();

/** Eine Marke zum Einmessen: Passermarke (Objekt) oder gravierte Marke eines Jigs */
interface Target {
  key: string;
  label: string;
  center: Pt;
}

const f2 = (v: number) => dec(v.toFixed(2));

export function openPrintCutDialog(ed: Editor) {
  const st = load();
  const bed = ed.doc.bed;
  let dot = false;
  const info = h('p', { class: 'note pc-info' });
  const say = (msg: string, err = false) => {
    info.textContent = msg;
    info.classList.toggle('error', err);
  };

  const marks = () => findMarks(ed.doc.objs);

  // ----- 1. Marken -----
  const num = (get: () => number, set: (v: number) => void, min: number, max: number) => {
    const i = h('input', { type: 'number', min: String(min), max: String(max), step: '0.5', value: String(get()) }) as HTMLInputElement;
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (isFinite(v) && v >= min && v <= max) set(v);
      i.value = String(get());
    });
    return i;
  };
  const markInfo = h('span', { class: 'muted' });
  const insertBtn = h('button', { class: 'btn', title: t('Drei Passermarken in L-Form um die Auswahl oder, ohne Auswahl, um das ganze Design setzen') }, t('Marken setzen')) as HTMLButtonElement;
  insertBtn.addEventListener('click', () => {
    const old = marks();
    const design = (ed.sel.length ? ed.doc.objs.filter((o) => ed.sel.includes(o)) : ed.doc.objs).filter((o) => !o.reg && !o.hidden);
    const box = boundsOf(design);
    if (!box) return say(t('Kein Design auf dieser Seite.'), true);
    if (old.length && !confirm(t('Die vorhandenen Passermarken werden ersetzt.'))) return;
    ed.snapshot(t('Passermarken setzen'));
    ed.doc.objs = ed.doc.objs.filter((o) => !old.includes(o));
    old.forEach((o) => measured.delete(`o${o.id}`));
    const layer = design[0]?.layer ?? 0;
    const made = markPlaces(box, st.size, st.margin, bed).map((p, i) => makeMark(i + 1, p, st.size, layer, t('Passermarke {n}', { n: i + 1 })));
    ed.doc.objs.push(...made);
    ed.setSel(made);
    save(st);
    ed.emit('doc');
    render();
    say(t('Marken gesetzt. Sie werden gedruckt und exportiert, aber nie gelasert.'));
  });
  const fromSelBtn = h('button', { class: 'btn', title: t('Gewählte Objekte (z. B. eigene Kreuze) als Passermarken verwenden; die Mitte ihres Rahmens zählt') }, t('Auswahl als Marke')) as HTMLButtonElement;
  fromSelBtn.addEventListener('click', () => {
    const sel = ed.doc.objs.filter((o) => ed.sel.includes(o) && !o.reg);
    if (!sel.length) return say(t('Erst die Objekte auswählen, die als Marke dienen sollen.'), true);
    ed.snapshot(t('Passermarken setzen'));
    let nr = nextMarkNr(ed.doc.objs);
    for (const o of sel) {
      o.reg = nr;
      o.name = o.name || t('Passermarke {n}', { n: nr });
      nr++;
    }
    ed.emit('doc');
    render();
  });
  const clearBtn = h('button', { class: 'btn', title: t('Markierung als Passermarke entfernen; die Objekte bleiben und werden wieder gelasert') }, t('Keine Marke mehr')) as HTMLButtonElement;
  clearBtn.addEventListener('click', () => {
    const sel = ed.doc.objs.filter((o) => ed.sel.includes(o) && o.reg);
    if (!sel.length) return say(t('Keine Passermarke ausgewählt.'), true);
    ed.snapshot(t('Passermarke entfernen'));
    for (const o of sel) {
      delete o.reg;
      measured.delete(`o${o.id}`);
    }
    ed.emit('doc');
    render();
  });

  // ----- 3. Einmessen: Laser bewegen, Laserpunkt -----
  const canMove = () => machine.connected && !machine.running;
  const dotOn = () => {
    if (dot && canMove()) pointerGCode(device, true, st.power).forEach((l) => machine.send(l));
  };
  const setDot = (on: boolean) => {
    if (on && !canMove()) return say(t('Nicht verbunden.'), true);
    if (on && !confirm(t('Der Laser wird mit {p} % im Stand eingeschaltet, um die Marke zu treffen. Schutzbrille tragen und nicht in den Strahl sehen. Auf Papier kann schon dabei ein Punkt entstehen.', { p: dec(String(st.power)) }))) return;
    dot = on;
    if (machine.connected) pointerGCode(device, on, st.power).forEach((l) => machine.send(l));
    dotBtn.classList.toggle('primary', dot);
    dotBtn.textContent = dot ? t('Laserpunkt aus') : t('Laserpunkt an');
  };
  const dotBtn = h('button', { class: 'btn', title: t('Laser mit sehr kleiner Leistung einschalten, um die Mitte einer gedruckten Marke zu treffen') }, t('Laserpunkt an')) as HTMLButtonElement;
  dotBtn.addEventListener('click', () => setDot(!dot));
  const powerIn = num(() => st.power, (v) => ((st.power = v), dotOn()), 0.1, 10);
  const jog = (dx: number, dy: number) => {
    if (!canMove()) return say(t('Nicht verbunden.'), true);
    jogLines(device, dx * st.step, dy * st.step, 1500).forEach((l) => machine.send(l));
    dotOn();
  };
  const pad = h('div', { class: 'jog' });
  for (const [dx, dy, label] of [[-1, 1, '↖'], [0, 1, '↑'], [1, 1, '↗'], [-1, 0, '←'], [0, 0, ''], [1, 0, '→'], [-1, -1, '↙'], [0, -1, '↓'], [1, -1, '↘']] as [number, number, string][])
    pad.append(label ? h('button', { class: 'btn', onclick: () => jog(dx, dy) }, label) : h('span'));
  const stepSel = h('select', { onchange: (e: Event) => (st.step = Number((e.target as HTMLSelectElement).value)) },
    ...[0.1, 0.5, 1, 5, 10, 50].map((v) => h('option', { value: String(v), selected: v === st.step }, `${dec(String(v))} mm`)),
  );
  const posTxt = h('span', { class: 'muted' });
  const goTo = (p: Pt) => {
    if (!canMove()) return say(t('Nicht verbunden.'), true);
    const m = designToMachine(p, bed.h);
    machine.send(`G0 X${m.x.toFixed(3)} Y${m.y.toFixed(3)}`);
    dotOn();
  };
  const here = (): Pt | null => {
    const w = machine.status.wpos;
    return machine.connected && w ? machineToDesign(w[0], w[1], bed.h) : null;
  };

  // ----- Kamera: Ausschnitt um die Marke, Klick setzt die Mitte -----
  const views = cameraViews(ed);
  const camBox = h('div', { class: 'pc-cam', hidden: true });
  const camCv = h('canvas', { class: 'pc-cam-canvas', width: 320, height: 320, title: t('Mitte der Marke anklicken') }) as HTMLCanvasElement;
  const camTitle = h('div', { class: 'muted' });
  camBox.append(camTitle, camCv, h('div', { class: 'conn-row' },
    h('button', { class: 'btn small', onclick: () => views[0]?.refresh() && camShow() }, t('Neues Kamerabild')),
    h('button', { class: 'btn small', onclick: () => ((camFor = null), (camBox.hidden = true)) }, t('Schließen')),
  ));
  let camFor: Target | null = null;
  const CAM_MM = 30;
  let camC: Pt = { x: 0, y: 0 };
  const camShow = () => {
    const o = camFor;
    const img = views[0]?.image;
    if (!o || !img) return;
    camC = measured.get(o.key) ?? o.center;
    camTitle.textContent = t('Passermarke {n}: Mitte anklicken', { n: o.label });
    const ctx = camCv.getContext('2d')!;
    const kx = img.width / bed.w,
      ky = img.height / bed.h;
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, camCv.width, camCv.height);
    ctx.drawImage(img, (camC.x - CAM_MM / 2) * kx, (camC.y - CAM_MM / 2) * ky, CAM_MM * kx, CAM_MM * ky, 0, 0, camCv.width, camCv.height);
    const m = measured.get(o.key);
    if (m) {
      const px = ((m.x - camC.x + CAM_MM / 2) / CAM_MM) * camCv.width,
        py = ((m.y - camC.y + CAM_MM / 2) / CAM_MM) * camCv.height;
      ctx.strokeStyle = '#ff7a00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 10, py);
      ctx.lineTo(px + 10, py);
      ctx.moveTo(px, py - 10);
      ctx.lineTo(px, py + 10);
      ctx.stroke();
    }
    camBox.hidden = false;
  };
  camCv.addEventListener('click', (e) => {
    if (!camFor) return;
    const r = camCv.getBoundingClientRect();
    const p = { x: camC.x - CAM_MM / 2 + ((e.clientX - r.left) / r.width) * CAM_MM, y: camC.y - CAM_MM / 2 + ((e.clientY - r.top) / r.height) * CAM_MM };
    measured.set(camFor.key, p);
    camShow();
    render();
  });

  // ----- Tabelle -----
  const table = h('div', { class: 'pc-table' });
  const modeSel = h('select', { onchange: (e: Event) => ((st.mode = (e.target as HTMLSelectElement).value as Settings['mode']), render()) },
    h('option', { value: 'auto', selected: st.mode === 'auto' }, t('Automatisch')),
    h('option', { value: 'rigid', selected: st.mode === 'rigid' }, t('Verschieben und Drehen')),
    h('option', { value: 'similar', selected: st.mode === 'similar' }, t('Dazu Maßstab')),
    h('option', { value: 'affine', selected: st.mode === 'affine' }, t('Dazu Verzerrung (ab 3 Marken)')),
  ) as HTMLSelectElement;
  const result = h('p', { class: 'pc-result' });
  const absChk = check(true, () => {}, t('Danach Jobs mit absoluten Koordinaten starten (nötig für Print and Cut)'));
  const absInput = absChk.querySelector('input') as HTMLInputElement;
  const alignBtn = h('button', { class: 'btn primary' }, t('Ausrichten')) as HTMLButtonElement;

  let fit: Fit | null = null;
  let pairs: { o: Target; d: Pt; m: Pt }[] = [];
  /** Passermarken und die gravierten Marken aller Jigs der Seite */
  const targets = (): Target[] => [
    ...marks().map((o) => ({ key: `o${o.id}`, label: String(o.reg), center: markCenter(o)! })),
    ...findJigs(ed.doc.objs).flatMap((j, ji, all) =>
      jigMarkCenters(j).map((c, k) => ({ key: `j${j.part.id}-${k}`, label: (all.length > 1 ? `J${ji + 1}.` : 'J') + (k + 1), center: c })),
    ),
  ];
  const mode = (n: number): FitMode => (st.mode === 'auto' ? (n >= 3 ? 'affine' : 'rigid') : st.mode);

  function render() {
    const ms = targets();
    markInfo.textContent = tn('{n} Passermarke auf dieser Seite', '{n} Passermarken auf dieser Seite', ms.length);
    table.textContent = '';
    table.append(h('span', { class: 'pc-h' }, t('Marke')), h('span', { class: 'pc-h' }, t('Im Design (X / Y)')), h('span', { class: 'pc-h' }, t('Gemessen (X / Y)')), h('span'));
    for (const o of ms) {
      const c = o.center;
      const dm = designToMachine(c, bed.h);
      const m = measured.get(o.key);
      const mm = m ? designToMachine(m, bed.h) : null;
      const err = m ? Math.hypot(m.x - c.x, m.y - c.y) : null;
      table.append(
        h('span', {}, o.label),
        h('span', {}, `${f2(dm.x)} / ${f2(dm.y)}`),
        h('span', { class: mm ? '' : 'muted' }, mm ? `${f2(mm.x)} / ${f2(mm.y)}` + (err !== null ? `  (Δ ${f2(err)})` : '') : '–'),
        h('span', { class: 'pc-btns' },
          h('button', { class: 'btn small', title: t('Laser zur Marke fahren, wie sie im Design liegt (oder zur gemessenen Stelle)'), onclick: () => goTo(measured.get(o.key) ?? c) }, t('Hinfahren')),
          h('button', { class: 'btn small', title: t('Aktuelle Laserposition als Mitte dieser Marke übernehmen'), onclick: () => {
            const p = here();
            if (!p) return say(t('Die Laserposition ist nicht bekannt. Laser verbinden.'), true);
            measured.set(o.key, p);
            render();
          } }, t('Übernehmen')),
          views.length ? h('button', { class: 'btn small', title: t('Marke im Kamerabild anklicken'), onclick: () => ((camFor = o), camShow()) }, t('Kamera')) : null,
          m ? h('button', { class: 'btn small', title: t('Messung verwerfen'), onclick: () => (measured.delete(o.key), render()) }, '×') : null,
        ),
      );
    }
    pairs = ms.filter((o) => measured.has(o.key)).map((o) => ({ o, d: o.center, m: measured.get(o.key)! }));
    const md = mode(pairs.length);
    fit = fitTransform(pairs.map((p) => p.d), pairs.map((p) => p.m), md);
    if (!ms.length) result.textContent = t('Noch keine Passermarken. „Marken setzen“ oder eigene Objekte als Marke wählen.');
    else if (pairs.length < minMarks(md)) result.textContent = tn('Noch {n} Marke einmessen.', 'Noch {n} Marken einmessen.', minMarks(md) - pairs.length);
    else if (!fit) result.textContent = t('Die gemessenen Marken liegen zu nah beieinander oder auf einer Linie.');
    else {
      const parts = [
        t('Drehung {a}°', { a: dec(fit.angle.toFixed(2)) }),
        t('Maßstab {s} %', { s: dec((fit.scale * 100).toFixed(2)) }),
        t('Restfehler {e} mm', { e: f2(fit.max) }),
      ];
      if (fit.distRatio !== null && Math.abs(fit.distRatio - 1) > 0.003)
        parts.push(t('Der Abstand der Marken weicht um {p} % ab. Wurde das Blatt skaliert gedruckt?', { p: dec(((fit.distRatio - 1) * 100).toFixed(1)) }));
      result.textContent = parts.join(' · ');
    }
    result.classList.toggle('error', !!fit && fit.max > 1);
    alignBtn.disabled = !fit || rotaryOn(device);
    absChk.hidden = device.startFrom === 'absolute';
  }

  alignBtn.addEventListener('click', () => {
    if (!fit) return;
    ed.snapshot(t('An Passermarken ausrichten'));
    for (const o of ed.doc.objs) o.m = mul(fit.m, o.m);
    // Gemessene Mitten sind jetzt die Lage der Marken
    const now = new Map(targets().map((x) => [x.key, x.center]));
    for (const p of pairs) if (now.has(p.o.key)) measured.set(p.o.key, now.get(p.o.key)!);
    if (device.startFrom !== 'absolute' && absInput.checked) setStartFrom('absolute');
    ed.emit('doc');
    save(st);
    render();
    say(tn('Design an {n} Marke ausgerichtet. Mit „Rahmen“ prüfen, dann den Job starten.', 'Design an {n} Marken ausgerichtet. Mit „Rahmen“ prüfen, dann den Job starten.', pairs.length));
  });

  const unwatch = machine.on((e) => {
    if (e.type === 'line') return;
    const p = here();
    posTxt.textContent = p ? t('Laser bei X {x}  Y {y}', { x: f2(designToMachine(p, bed.h).x), y: f2(designToMachine(p, bed.h).y) }) : t('Nicht verbunden');
  });
  posTxt.textContent = t('Nicht verbunden');

  const dlg = h(
    'dialog',
    { class: 'offset-dialog pc-dialog' },
    h('h3', {}, t('Print and Cut')),
    h('p', { class: 'note' }, t('Ein gedrucktes Blatt passgenau schneiden: Passermarken mitdrucken, ihre Mitten mit dem Laserpunkt oder der Kamera einmessen, dann legt KizamuBeam das Design genau auf den Druck.')),
    h('h4', {}, t('1. Marken')),
    h('div', { class: 'form' },
      h('label', {}, t('Durchmesser (mm)')), num(() => st.size, (v) => (st.size = v), 2, 30),
      h('label', {}, t('Abstand zum Design (mm)')), num(() => st.margin, (v) => (st.margin = v), 0, 50),
    ),
    h('div', { class: 'conn-row' }, insertBtn, fromSelBtn, clearBtn, markInfo),
    h('h4', {}, t('2. Drucken')),
    h('p', { class: 'note' }, t('Als PDF oder SVG exportieren und in Originalgröße (100 %, nicht „an Seite anpassen“) drucken. Blatt flach ins Bett legen, nicht mehr verschieben.')),
    h('h4', {}, t('3. Einmessen')),
    rotaryOn(device) ? h('p', { class: 'note error' }, t('Mit eingeschalteter Drehachse geht Print and Cut nicht.')) : null,
    h('div', { class: 'move-row' }, pad,
      h('div', { class: 'form move-form' },
        h('label', {}, t('Schritt')), stepSel,
        h('label', {}, t('Leistung (%)')), powerIn,
      ),
      h('div', { class: 'pc-dot' }, dotBtn, posTxt),
    ),
    table,
    camBox,
    h('div', { class: 'form pc-mode' }, h('label', {}, t('Anpassung')), modeSel),
    result,
    absChk,
    info,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')), alignBtn),
  );
  dlg.addEventListener('close', () => {
    if (dot && machine.connected) pointerGCode(device, false, 0).forEach((l) => machine.send(l));
    unwatch();
    save(st);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  render();
  dlg.showModal();
}
