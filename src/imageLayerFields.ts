import type { Editor } from './editor';
import { h, numInput } from './dom';
import { DITHER_MODES, DitherMode, ImageLayer, isCellMode } from './model';
import { t } from './i18n';

/**
 * Fields for the image settings of a layer (layer panel, layer settings and the "Adjust Image" dialog).
 * Speed, power and passes are not here: images use those of the layer. live = change without an undo step
 * (the dialogs commit or revert the whole change themselves).
 */
export function imageLayerFields(ed: Editor, i: number, live: boolean, onChange?: () => void): HTMLElement[] {
  const IL = ed.imgLayer(i);
  const set = (patch: Partial<ImageLayer>) => {
    ed.updateImgLayer(i, patch, !live);
    onChange?.();
  };
  const num = (key: 'overscan' | 'cells' | 'angle' | 'threshold', min: number, max: number, int = false) => {
    const el = numInput('', (v) => set({ [key]: Math.max(min, Math.min(max, int ? Math.round(v) : v)) } as Partial<ImageLayer>));
    el.value = String(IL[key]);
    return el;
  };
  const interval = numInput('', (v) => {
    const c = Math.max(0.01, Math.min(2, v));
    set({ interval: c });
    dpi.value = String(Math.round(25.4 / c));
  }, t('Zeilenabstand in mm'));
  interval.value = String(IL.interval);
  const dpi = numInput('', (v) => {
    const c = Math.max(12.7, Math.min(2540, v));
    set({ interval: Math.round((25.4 / c) * 10000) / 10000 });
    interval.value = String(ed.imgLayer(i).interval);
  }, t('Auflösung in Punkten pro Zoll'));
  dpi.value = String(Math.round(25.4 / IL.interval));
  const modeSel = h('select', {}, ...DITHER_MODES.map(([v, t]) => h('option', { value: v, selected: IL.dither === v }, t))) as HTMLSelectElement;
  const extra = h('div', { class: 'form sub' });
  const renderExtra = () => {
    const d = ed.imgLayer(i).dither;
    extra.replaceChildren(
      ...(d === 'threshold' ? [h('label', {}, t('Schwellwert (0–255)')), num('threshold', 0, 255, true)] : []),
      ...(isCellMode(d) ? [h('label', {}, t('Zellen pro Zoll')), num('cells', 2, 300), h('label', {}, t('Rasterwinkel (°)')), num('angle', -90, 90)] : []),
    );
    extra.hidden = !extra.childElementCount;
  };
  modeSel.addEventListener('change', () => {
    set({ dither: modeSel.value as DitherMode });
    renderExtra();
  });
  renderExtra();
  const check = (key: 'negative' | 'bidirectional', label: string) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: IL[key], onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked }) }), label);
  return [
    h('label', {}, t('Bildmodus')), modeSel,
    extra,
    h('label', {}, t('Zeilenabstand (mm)')), interval,
    h('label', {}, 'DPI'), dpi,
    h('span', { class: 'checks' }, check('negative', t('Negativ')), check('bidirectional', t('Bidirektional'))),
    h('label', {}, t('Überfahrweg (%)')), num('overscan', 0, 50),
  ];
}
