// Dialog „Gitter einstellen“ (Ansicht → Gitter): Änderungen wirken sofort auf der Arbeitsfläche,
// „Abbrechen“ stellt den vorherigen Zustand wieder her.
import type { Editor } from './editor';
import { evalExpr, h } from './dom';
import { dec, t } from './i18n';
import { cleanGrid, DEFAULT_GRID, finestStep, GridSettings } from './grid';

export function openGridDialog(ed: Editor) {
  const before = { ...ed.grid };
  let st: GridSettings = { ...ed.grid };
  const fmt = (v: number) => dec(String(Math.round(v * 1000) / 1000));

  const show = h('input', { type: 'checkbox', id: 'grid-show' }) as HTMLInputElement;
  const spacing = h('input', { type: 'text', id: 'grid-spacing' }) as HTMLInputElement;
  const divisions = h('input', { type: 'number', id: 'grid-div', min: '1', max: '50', step: '1' }) as HTMLInputElement;
  const every = h('input', { type: 'number', id: 'grid-every', min: '0', max: '50', step: '1' }) as HTMLInputElement;
  const themeColor = h('input', { type: 'checkbox', id: 'grid-theme' }) as HTMLInputElement;
  const color = h('input', { type: 'color', id: 'grid-color', style: 'width: 48px; padding: 0' }) as HTMLInputElement;
  const opacity = h('input', { type: 'range', id: 'grid-opacity', min: '5', max: '100', step: '5', style: 'flex: 1; min-width: 0' }) as HTMLInputElement;
  const opacityVal = h('span', { style: 'min-width: 40px; text-align: right' });
  const toSnap = h('input', { type: 'checkbox', id: 'grid-snap' }) as HTMLInputElement;
  const info = h('div', { class: 'note' });

  const fill = () => {
    show.checked = st.show;
    spacing.value = fmt(st.spacing);
    divisions.value = String(st.divisions);
    every.value = String(st.every);
    themeColor.checked = !st.color;
    color.value = st.color || (ed.dark ? '#8a929c' : '#808080');
    color.disabled = !st.color;
    opacity.value = String(st.opacity);
    opacityVal.textContent = `${st.opacity} %`;
    const parts = [t('Hauptlinien alle {mm} mm', { mm: fmt(st.spacing) })];
    if (st.divisions > 1) parts.unshift(t('feine Linien alle {mm} mm', { mm: fmt(st.spacing / st.divisions) }));
    if (st.every > 1) parts.push(t('kräftige Linien alle {mm} mm', { mm: fmt(st.spacing * st.every) }));
    info.textContent = parts.join(' · ');
    toSnap.nextSibling!.textContent = ' ' + t('Fangraster auf {mm} mm setzen', { mm: fmt(finestStep(st)) });
  };
  const apply = (patch: Partial<GridSettings>) => {
    st = cleanGrid({ ...st, ...patch });
    ed.setGrid(st);
    fill();
  };
  show.onchange = () => apply({ show: show.checked });
  spacing.onchange = () => {
    const v = evalExpr(spacing.value);
    if (v && v > 0) apply({ spacing: v });
    else fill();
  };
  divisions.onchange = () => apply({ divisions: Number(divisions.value) || 1 });
  every.onchange = () => apply({ every: Number(every.value) || 0 });
  themeColor.onchange = () => apply({ color: themeColor.checked ? '' : color.value });
  color.oninput = () => apply({ color: color.value });
  opacity.oninput = () => apply({ opacity: Number(opacity.value) });

  const dlg = h(
    'dialog',
    { class: 'offset-dialog grid-dialog' },
    h('h3', {}, t('Gitter einstellen')),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'grid-show' }, t('Gitter anzeigen')), h('div', {}, show),
      h('label', { for: 'grid-spacing', title: t('Abstand der Hauptlinien') }, t('Linienabstand (mm)')), spacing,
      h('label', { for: 'grid-div', title: t('Feine Linien zwischen zwei Hauptlinien; 1 = keine feinen Linien') }, t('Unterteilungen')), divisions,
      h('label', { for: 'grid-every', title: t('Jede n-te Hauptlinie kräftiger zeichnen; 0 = aus') }, t('Kräftig alle n Linien')), every,
      h('label', { for: 'grid-theme' }, t('Farbe')),
      h('div', { class: 'radios' }, h('label', {}, themeColor, ' ' + t('Wie Design')), color),
      h('label', { for: 'grid-opacity' }, t('Deckkraft')), h('div', { class: 'radios' }, opacity, opacityVal),
    ),
    info,
    h('label', { style: 'display: block; margin-top: 6px' }, toSnap, ' '),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', style: 'margin-right: auto', onclick: () => apply({ ...DEFAULT_GRID }) }, t('Standard')),
      h('button', {
        class: 'btn',
        onclick: () => {
          ed.setGrid(before);
          dlg.close();
        },
      }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          ed.setGrid(st);
          if (toSnap.checked) ed.setSnap({ step: finestStep(st) });
          dlg.close();
        },
      }, t('OK')),
    ),
  );
  // Esc wirkt wie „Abbrechen“
  dlg.addEventListener('cancel', () => ed.setGrid(before));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  fill();
  dlg.showModal();
}
