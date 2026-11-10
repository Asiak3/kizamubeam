// Dialog „Auf Jig-Fächer legen“: das gewählte Design in jedes (gewählte) Fach eines Jigs kopieren, auf Wunsch mit
// variablem Text je Fach (Seriennummer, CSV-Zeile). Kern in jigUse.ts.
import { Editor } from './editor';
import { check } from './arrayDialogs';
import { h } from './dom';
import { boundsOf } from './geom';
import { t, tn } from './i18n';
import { IDENT, Mat, Obj } from './model';
import { fillJig, findJigs, JigRef, parseSlotRange, placeMatrix, refSlot } from './jigUse';

const KEY = 'kizamubeam.jigfill';

interface Settings {
  series: boolean;
  group: boolean;
  hideJig: boolean;
  hideTemplate: boolean;
}
const DEFAULTS: Settings = { series: true, group: false, hideJig: true, hideTemplate: true };

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

const hasVt = (objs: Obj[]): boolean =>
  objs.some((o) => ((o.shape.kind === 'text' || o.shape.kind === 'barcode') && !!o.shape.vt) || (o.shape.kind === 'group' && hasVt(o.shape.children)));

export function openJigFillDialog(ed: Editor) {
  const jigs = findJigs(ed.doc.objs);
  const say = (msg: string) => ((ed.hint = msg), ed.emit('tool'));
  if (!jigs.length) return say(t('Auf Jig-Fächer legen: auf dieser Seite gibt es keinen Jig. Erst mit dem Jig-Generator einen anlegen.'));
  const jigTops = new Set(jigs.map((j) => j.top));
  const design = ed.doc.objs.filter((o) => ed.sel.includes(o) && !jigTops.has(o) && !o.reg);
  if (!design.length) return say(t('Auf Jig-Fächer legen: erst das Design auswählen (zum Beispiel einen Namen auf einem Fach).'));
  const box = boundsOf(design);
  if (!box) return;
  const d = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  // Jig, auf dem das Design liegt, sonst einer, den der Nutzer mit ausgewählt hat, sonst der erste
  let jig: JigRef = jigs.find((j) => refSlot(j, box) >= 0) ?? jigs.find((j) => ed.sel.includes(j.top)) ?? jigs[0];
  const st = load();
  const vt = hasVt(design);
  ed.setSel(design);

  const jigSel = h('select') as HTMLSelectElement;
  jigs.forEach((j, i) => jigSel.append(h('option', { value: String(i), selected: j === jig }, tn('Jig {n} Fach', 'Jig {n} Fächer', j.layout.slots.length) + (j.top.hidden ? ` (${t('ausgeblendet')})` : ''))));
  const kindSel = h('select') as HTMLSelectElement;
  const range = h('input', { type: 'text', value: t('alle'), placeholder: t('z. B. 1-5, 8') }) as HTMLInputElement;
  const info = h('p', { class: 'note' });
  const err = h('p', { class: 'error' });
  const tplChk = check(st.hideTemplate, (v) => ((st.hideTemplate = v), update()), t('Vorlage danach ausblenden'));
  const seriesChk = check(st.series, (v) => ((st.series = v), update()), t('Variablen Text je Fach weiterzählen (Fach 1 = aktuelle Nummer bzw. CSV-Zeile)'));
  seriesChk.hidden = !vt;
  const run = h('button', { class: 'btn primary' }, t('Auf Fächer legen')) as HTMLButtonElement;

  let ref = -1;
  let picks: number[] = [];

  const fillKinds = () => {
    kindSel.textContent = '';
    kindSel.append(h('option', { value: '-1' }, t('Alle Werkstücke')));
    jig.shapes.forEach((s, i) => kindSel.append(h('option', { value: String(i) }, s.n || t('Werkstück {n}', { n: i + 1 }))));
    ref = refSlot(jig, box);
    kindSel.value = jig.shapes.length > 1 && ref >= 0 ? String(jig.layout.slots[ref].shape) : '-1';
    kindSel.hidden = kindLabel.hidden = jig.shapes.length < 2;
  };
  const kindLabel = h('label', {}, t('Werkstück'));

  const mats = (): Mat[] => picks.map((i) => placeMatrix(jig, i, ref, d));

  function update() {
    const all = parseSlotRange(range.value === t('alle') ? '' : range.value, jig.layout.slots.length);
    err.textContent = all ? '' : t('Fächer bitte als Nummern oder Bereiche angeben, z. B. 1-5, 8.');
    const kind = Number(kindSel.value);
    picks = (all ?? []).filter((i) => kind < 0 || jig.layout.slots[i].shape === kind);
    const onRef = ref >= 0 && picks.includes(ref);
    tplChk.hidden = ref >= 0;
    info.textContent =
      (ref >= 0 ? t('Das Design liegt auf Fach {n}; die Kopien behalten seine Lage im Fach.', { n: ref + 1 }) : t('Die Mitte des Designs kommt auf die Mitte jedes Fachs.')) +
      ' ' + tn('{n} Fach gewählt.', '{n} Fächer gewählt.', picks.length);
    run.disabled = !picks.length || (onRef && picks.length === 1 && !(vt && st.series));
    // Vorschau: erste Matrix = Original (wird nicht gezeichnet)
    ed.setArrayPreview([IDENT, ...mats().filter((_, k) => picks[k] !== ref)]);
  }

  jigSel.addEventListener('change', () => ((jig = jigs[Number(jigSel.value)]), fillKinds(), update()));
  kindSel.addEventListener('change', update);
  range.addEventListener('input', update);

  const apply = () => {
    if (!picks.length) return;
    save(st);
    ed.snapshot(t('Auf Jig-Fächer legen'));
    const made = fillJig(ed.doc.objs, design, jig, picks, { ...st, series: vt && st.series, groupName: (n) => t('Fach {n}', { n }) });
    ed.setSel(ref >= 0 ? [...design, ...made] : made);
    ed.hint = tn('Design auf {n} Fach gelegt.', 'Design auf {n} Fächer gelegt.', picks.length) + (st.hideJig ? ' ' + t('Der Jig ist ausgeblendet und wird nicht gelasert.') : '');
    ed.emit('doc');
  };

  let applied = false;
  run.addEventListener('click', () => ((applied = true), dlg.close()));
  const dlg = h(
    'dialog',
    { class: 'offset-dialog jigfill-dialog' },
    h('h3', {}, t('Auf Jig-Fächer legen')),
    h('div', { class: 'form' },
      jigs.length > 1 ? h('label', {}, t('Jig')) : null, jigs.length > 1 ? jigSel : null,
      kindLabel, kindSel,
      h('label', {}, t('Fächer')), range,
    ),
    h('span', { class: 'checks' },
      seriesChk,
      check(st.group, (v) => (st.group = v), t('Je Fach gruppieren')),
      check(st.hideJig, (v) => (st.hideJig = v), t('Jig ausblenden (ist schon gelasert)')),
      tplChk,
    ),
    info,
    err,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), run),
  );
  dlg.addEventListener('close', () => {
    ed.setArrayPreview(null);
    if (applied) apply();
    else save(st);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  fillKinds();
  update();
  dlg.showModal();
}
