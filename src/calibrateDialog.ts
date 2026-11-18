// Dialog „Passung kalibrieren“: 1. Testteile für Schnittfuge, Zapfen und Schlitze auf einer neuen Seite erzeugen,
// 2. nach dem Lasern Messwert und beste Passung eintragen; das Ergebnis landet beim Material in der Bibliothek.
// Generatoren und das Verbindungs-Werkzeug schlagen die Werte dann vor, „Konstruktion prüfen“ vergleicht damit.
import type { Editor } from './editor';
import { numField, select } from './arrayDialogs';
import { h } from './dom';
import { dec, t } from './i18n';
import { defaultCutSettings, defaultLayer, layerLabel, leaves, translate, mul } from './model';
import { entryLabel, library } from './materials';
import { loadCheckSettings } from './check';
import { buildCalibParts, CalibOptions, calibResult, CalibSteps, defaultSteps, loadCalibTest, saveCalibTest, SQUARE, stepValues } from './calibrate';

const f2 = (v: number) => dec((Math.round(v * 100) / 100).toFixed(2));
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±') + f2(Math.abs(v));

export function openCalibrateDialog(ed: Editor) {
  const test = loadCalibTest();
  const entries = library.entries.filter((e) => e.thickness !== null && e.thickness > 0);
  const name = (i: number) => `${layerLabel(i)} ${ed.doc.layers[i]?.name ?? defaultLayer(i).name}`;
  const isLine = (i: number) => (ed.doc.layers[i]?.mode ?? defaultLayer(i).mode) === 'line';
  const used = ed.usedLayers().filter(isLine);
  let cut = isLine(ed.currentLayer) ? ed.currentLayer : used[0] ?? 1;
  let entryId = library.get(ed.doc.layers[cut]?.material)?.id ?? entries[0]?.id ?? '';
  let th = library.get(entryId)?.thickness ?? 3;
  const beam = loadCheckSettings().beam;
  const steps = defaultSteps(beam, ed.doc.layers[cut]?.kerf ?? 0);
  const opt: CalibOptions = { th, pair: steps.pair, slot: steps.slot };

  const stepsRow = (id: string, label: string, title: string, s: CalibSteps) => [
    h('label', { for: `${id}-from`, title }, label),
    h('div', { class: 'fitcal-steps' },
      numField(`${id}-from`, s.from, (v) => (s.from = v), t('Erste Stufe (mm)')),
      h('span', { class: 'muted' }, t('Schritt')),
      numField(`${id}-step`, s.step, (v) => (s.step = v), t('Abstand der Stufen (mm)')),
      h('span', { class: 'muted' }, t('Anzahl')),
      numField(`${id}-n`, s.count, (v) => (s.count = Math.max(2, Math.min(12, Math.round(v)))), t('Anzahl der Stufen (2 bis 12)')),
    ),
  ];
  const entryOpts = (): [string, string][] => [['', t('(kein Eintrag)')], ...entries.map((e) => [e.id, entryLabel(e)] as [string, string])];
  const thField = numField('cal-th', th, (v) => ((th = v), (opt.th = v)), t('Nenndicke, mit der die Teile gezeichnet werden'));
  const form1 = h('div', { class: 'form' },
    h('label', { for: 'cal-mat' }, t('Material')),
    select('cal-mat', entryId, entryOpts(), (v) => {
      entryId = v;
      const e = library.get(v);
      if (e?.thickness) ((th = opt.th = e.thickness), ((thField as HTMLInputElement).value = dec(String(e.thickness))));
    }),
    h('label', { for: 'cal-th' }, t('Materialdicke (mm)')),
    thField,
    h('label', { for: 'cal-layer' }, t('Schnitt-Layer')),
    select('cal-layer', String(cut), Array.from({ length: 30 }, (_, i) => [String(i), name(i)] as [string, string]), (v) => (cut = Number(v))),
    ...stepsRow('cal-pair', t('Spiel Zapfen (mm)'), t('Spiel je Seite zwischen Zapfen und Loch; negativ = Pressung'), opt.pair),
    ...stepsRow('cal-slot', t('Schlitz-Zugabe (mm)'), t('Um so viel ist ein Schlitz breiter als die Materialdicke gezeichnet'), opt.slot),
  );

  const create = () => {
    const kl = ed.layer(cut).kerf;
    // Freier Layer für die gravierten Nummern: auf keiner Seite benutzt und nicht der Schnitt-Layer
    const onPages = new Set<number>();
    for (const p of ed.doc.pages) for (const [o] of leaves(p.objs)) onPages.add(o.layer);
    let label = -1;
    for (let i = 0; i < 30 && label < 0; i++) if (i !== cut && !onPages.has(i) && !ed.doc.layers[i]) label = i;
    for (let i = 0; i < 30 && label < 0; i++) if (i !== cut && !onPages.has(i)) label = i;
    if (label < 0) label = cut;
    const { objs, h: hh } = buildCalibParts(opt, cut, label, ed.textDefaults.font);
    const bed = ed.doc.bed;
    // Untere linke Ecke 10 mm vom Maschinenursprung
    for (const o of objs) o.m = mul(translate(10, bed.h - 10 - hh), o.m);
    ed.snapshot(t('Passungstest erzeugen'));
    if (label !== cut) {
      const L = ed.layer(label);
      Object.assign(L, defaultCutSettings('fill'), { mode: 'fill', power: 20, name: t('Beschriftung'), output: true });
    }
    const at = ed.doc.page + 1;
    ed.doc.pages.splice(at, 0, { name: t('Passungstest'), objs });
    ed.clearPageState();
    ed.doc.page = at;
    saveCalibTest({
      th: opt.th, kl, layer: cut, entry: entryId || undefined,
      pair: stepValues(opt.pair), slot: stepValues(opt.slot), date: new Date().toISOString().slice(0, 10),
    });
    ed.hint = t('Testteile auf der Seite „Passungstest“. Lasern, dann Laser → Passung kalibrieren … erneut öffnen und das Ergebnis eintragen.');
    ed.emit('doc');
    ed.emit('sel');
    dlg.close();
  };

  // Schritt 2: Ergebnis eintragen
  const part2: (HTMLElement | string)[] = [];
  if (test) {
    let square: number | null = null;
    let bestPair = Math.ceil(test.pair.length / 2), bestSlot = Math.ceil(test.slot.length / 2);
    let saveId = test.entry && library.get(test.entry) ? test.entry : entryId;
    const out = h('div', { class: 'note' });
    const sqIn = h('input', { type: 'text', id: 'cal-sq', placeholder: t('nicht gemessen'), title: t('Seitenlänge des gelaserten Quadrats, mit dem Messschieber gemessen') }) as HTMLInputElement;
    const result = () => {
      const s = sqIn.value.trim().replace(/,/g, '.');
      square = s ? Number(s) : null;
      if (square !== null && !Number.isFinite(square)) square = NaN;
      const r = calibResult(test, square, bestPair, bestSlot);
      out.classList.toggle('error', 'error' in r);
      saveBtn.disabled = 'error' in r || !library.get(saveId);
      if ('error' in r) {
        out.textContent = r.error === 'square'
          ? t('Das Quadrat sollte knapp unter {s} mm messen. Bitte den Messwert prüfen.', { s: SQUARE })
          : t('Bitte die beste Passung auswählen.');
        return;
      }
      const f = r.fit;
      out.textContent = [
        f.kerf !== null ? t('Schnittfuge {k} mm.', { k: f2(f.kerf) }) : t('Schnittfuge nicht gemessen.'),
        t('Zapfen in Loch: {c} mm je Seite gezeichnet.', { c: signed(f.pair) }),
        t('Schlitz für {th} mm: {d} mm über der Dicke gezeichnet.', { th: f2(f.th), d: signed(f.slot) }),
        library.get(saveId) ? '' : t('Zum Speichern einen Eintrag der Material-Bibliothek wählen.'),
      ].filter(Boolean).join(' ');
    };
    sqIn.addEventListener('input', result);
    const saveBtn = h('button', {
      class: 'btn primary',
      onclick: () => {
        const r = calibResult(test, square, bestPair, bestSlot);
        const e = library.get(saveId);
        if ('error' in r || !e) return;
        library.update(e.id, { fit: r.fit });
        saveCalibTest(null);
        ed.hint = t('Kalibrierung bei „{entry}“ gespeichert. Generatoren schlagen die Werte vor, wenn der Layer dieses Material nutzt.', { entry: entryLabel(e) });
        ed.emit('tool');
        ed.emit('doc');
        dlg.close();
      },
    }, t('Beim Material speichern')) as HTMLButtonElement;
    part2.push(
      h('h4', {}, t('2. Ergebnis eintragen')),
      h('p', { class: 'note' }, t('Quadrat messen. Jeden Zapfen in ein Loch der Lochplatte stecken und das Quadrat (volle Materialdicke) in die Schlitze: Welche Nummer sitzt so, wie Steckverbindungen sitzen sollen?')),
      h('div', { class: 'form' },
        h('label', { for: 'cal-sq' }, t('Quadrat gemessen (mm)')),
        sqIn,
        h('label', { for: 'cal-bp' }, t('Bester Zapfen')),
        select('cal-bp', String(bestPair), test.pair.map((c, i) => [String(i + 1), `${i + 1} (${t('Spiel {c} mm', { c: signed(c) })})`] as [string, string]), (v) => ((bestPair = Number(v)), result())),
        h('label', { for: 'cal-bs' }, t('Bester Schlitz')),
        select('cal-bs', String(bestSlot), test.slot.map((d, i) => [String(i + 1), `${i + 1} (${f2(test.th + d)} mm)`] as [string, string]), (v) => ((bestSlot = Number(v)), result())),
        h('label', { for: 'cal-save' }, t('Speichern bei')),
        select('cal-save', saveId, entryOpts(), (v) => ((saveId = v), result())),
      ),
      test.kl ? h('p', { class: 'note' }, t('Der Schnitt-Layer hatte beim Erzeugen {kl} mm Kerf-Versatz; er ist eingerechnet.', { kl: f2(test.kl) })) : '',
      out,
      h('div', { class: 'dialog-buttons' }, saveBtn),
    );
    queueMicrotask(result);
  }

  const dlg = h('dialog', { class: 'offset-dialog fitcal-dialog' },
    h('h3', {}, t('Passung kalibrieren')),
    h('p', { class: 'note' }, t('Ermittelt Schnittfuge und Steckspiel für ein Material. Die Werte werden in der Material-Bibliothek gespeichert; Generatoren und das Verbindungs-Werkzeug schlagen sie vor, „Konstruktion prüfen“ vergleicht damit.')),
    h('h4', {}, t('1. Testteile lasern')),
    form1,
    h('p', { class: 'note' }, t('Es entstehen ein Quadrat {s} × {s} mm, ein Schlitzkamm, eine Lochplatte und ein Zapfenkamm auf einer neuen Seite. Die Nummern werden auf einem freien Layer graviert. Den Schnitt-Layer vorher wie für das Material einstellen.', { s: SQUARE })),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
      h('button', { class: test ? 'btn' : 'btn primary', onclick: create }, t('Testteile erzeugen')),
    ),
    ...part2,
  ) as HTMLDialogElement;
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
