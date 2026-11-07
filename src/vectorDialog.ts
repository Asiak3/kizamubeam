import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
import { vectorError } from './vectorMessages';

export function openVectorFitDialog(ed: Editor) {
  if (ed.drag) ed.cancelDrag();
  if (ed.draft) ed.finishLine();
  const tolerance = h('input', { type: 'number', min: 0.002, max: 100, step: 0.01, value: '0.1', id: 'vector-fit-tolerance' });
  const curves = h('input', { type: 'checkbox', checked: true, id: 'vector-fit-curves' });
  const corners = h('input', { type: 'checkbox', checked: true, id: 'vector-fit-corners' });
  const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const apply = h('button', { class: 'btn primary' }, t('Übernehmen'));
  const refresh = () => {
    try {
      const stats = ed.previewVectorFit({ tolerance: tolerance.valueAsNumber, curves: curves.checked, preserveCorners: corners.checked });
      info.textContent = t('{before} → {after} Knoten. Orange: Vorschau; Original bleibt bis zum Übernehmen unverändert.', stats);
      apply.disabled = false;
    } catch (error) {
      ed.vectorPreview = null; ed.redraw(); apply.disabled = true;
      info.textContent = vectorError(error);
    }
  };
  const dlg = h('dialog', { class: 'offset-dialog array-dialog vector-fit-dialog' },
    h('h3', {}, t('Pfade vereinfachen / glätten')),
    h('div', { class: 'form' },
      h('label', { for: tolerance.id }, t('Maximale Abweichung (mm)')), tolerance,
      h('label', { for: curves.id }, t('Bézierkurven anpassen (aus: gerade Linien)')), curves,
      h('label', { for: corners.id }, t('Scharfe Ecken erhalten')), corners),
    info,
    h('p', { class: 'note' }, t('Wirkt auf ganze ausgewählte Pfade/Grundformen. Formen werden zu Pfaden. Endpunkte, geschlossene Konturen und Teilpfade bleiben erhalten. Enge Details können ihre Topologie ändern; kleine Löcher und Schnittpunkte prüfen.')),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), apply));
  for (const input of [tolerance, curves, corners]) input.addEventListener('input', refresh);
  apply.addEventListener('click', () => {
    try { ed.applyVectorFit(); dlg.close(); }
    catch (error) { info.textContent = vectorError(error); apply.disabled = true; }
  });
  const changed = (what: string) => {
    if (what === 'doc' || what === 'sel') { ed.vectorPreview = null; ed.redraw(); apply.disabled = true; info.textContent = t('Quelle geändert. Eine Option ändern, um die Vorschau zu aktualisieren.'); }
  };
  ed.on(changed);
  dlg.addEventListener('close', () => { ed.off(changed); ed.vectorPreview = null; ed.redraw(); dlg.remove(); });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg); dlg.showModal(); refresh();
}
