// Projektfarbe per Rechtsklick auf einen Projekttab wählen: Farbvorschläge,
// eigene Farbe über den Systemdialog oder zurück zu „Automatisch“ (stabile
// Vorgabe aus der Tab-ID). Kein Undo, keine Sicherung nötig — Tabs speichern sich selbst.
import type { Editor } from './editor';
import { t } from './i18n';
import { h, showDialog } from './dom';
import { tabHue } from './editor/tabs';

/** Vorschlagspalette: über den Farbkreis verteilt, deckt die auto-Hues grob ab */
const PRESETS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#e93d82'];

const toHex = (hue: number) => {
  const h = hue / 60, c = 1, x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};

export function openTabColorDialog(ed: Editor, i: number) {
  const tab = ed.tabs[i];
  if (!tab) return;
  const current = tab.color ?? toHex(tabHue(tab));
  const custom = h('input', { type: 'color', value: current, class: 'tab-color-custom', 'aria-label': t('Eigene Farbe') }) as HTMLInputElement;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog tab-color-dialog' },
    h('h3', {}, t('Projektfarbe')),
    h('div', { class: 'form tab-color-presets' },
      ...PRESETS.map((hex) => h('button', {
        class: 'tab-color-swatch' + (tab.color === hex ? ' cur' : ''),
        style: `background:${hex}`,
        title: hex,
        'aria-label': hex,
        onclick: () => {
          ed.setTabColor(i, hex);
          dlg.close();
        },
      })),
      custom,
    ),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        title: t('Stabile Vorgabe aus der Tab-Nummer verwenden'),
        onclick: () => {
          ed.setTabColor(i, null);
          dlg.close();
        },
      }, t('Automatisch')),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          ed.setTabColor(i, custom.value);
          dlg.close();
        },
      }, t('OK')),
    ),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  showDialog(dlg);
}
