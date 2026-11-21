// Hilfslinie auf eine exakte Position setzen: Rechtsklick auf eine Hilfslinie auf der
// Arbeitsfläche oder Zeile im Objekte-Panel. Eingabe in mm, Komma/Punkt und Einheiten
// wie überall (evalExpr); Fang findet beim Ziehen statt, hier gilt der eingegebene Wert.
import type { Editor } from './editor';
import { dec, t } from './i18n';
import { evalExpr, h, showDialog } from './dom';
import type { ContextAction } from './contextMenu';

export const guideAxisLabel = (axis: 'x' | 'y') =>
  axis === 'x' ? t('Senkrechte Hilfslinie') : t('Waagrechte Hilfslinie');

export const fmtGuide = (v: number) => dec(String(Math.round(v * 1000) / 1000));

export function openGuidePositionDialog(ed: Editor, i: number) {
  const g = ed.guideList()[i];
  if (!g) return;
  const input = h('input', { type: 'text', id: 'guide-pos', value: fmtGuide(g.v), style: 'width: 150px' }) as HTMLInputElement;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog guide-dialog' },
    h('h3', {}, t('Hilfslinie positionieren')),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'guide-pos', title: guideAxisLabel(g.axis) }, t('Position (mm)')),
      input,
    ),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const v = evalExpr(input.value);
          // Ungültig: auf den aktuellen Wert zurücksetzen und offen bleiben.
          if (v === null || !isFinite(v)) {
            input.value = fmtGuide(ed.guideList()[i]?.v ?? 0);
            input.focus();
            input.select();
            return;
          }
          ed.setGuidePos(i, Math.round(v * 1000) / 1000);
          dlg.close();
        },
      }, t('OK')),
    ),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  showDialog(dlg);
  input.focus();
  input.select();
}

/** Kontextmenü einer einzelnen Hilfslinie (Canvas-Rechtsklick und Objekte-Panel) */
export function guideContextGroups(ed: Editor, i: number): ContextAction[][] {
  const g = ed.guideList()[i];
  if (!g) return [];
  const single: ContextAction[] = [
    { id: 'guide-position', label: `${t('Position …')} (${guideAxisLabel(g.axis)} · ${fmtGuide(g.v)} mm)`,
      run: () => openGuidePositionDialog(ed, i) },
    { id: 'guide-delete', label: t('Diese Hilfslinie löschen'),
      run: () => {
        if (!ed.guideList()[i]) return;
        ed.snapshot(t('Hilfslinie löschen'));
        ed.removeGuide(i);
        ed.emit('doc');
      } },
  ];
  const all: ContextAction[] = ed.guideList().length > 1
    ? [{ id: 'guide-clear', label: t('Alle Hilfslinien löschen (rückgängig machbar)'), run: () => ed.clearGuides() }]
    : [];
  return [single, all].filter((items) => items.length);
}
