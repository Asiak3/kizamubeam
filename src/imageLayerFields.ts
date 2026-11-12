import type { Editor } from './editor';
import { h, numInput } from './dom';
import { CutSettings, DITHER_MODES, DitherMode, ImageLayer, isCellMode } from './model';
import { t } from './i18n';

/** Layer settings that images share with fills: line interval, bidirectional, overscan */
export type RasterSettings = Pick<CutSettings, 'interval' | 'bidirectional' | 'overscan'>;

/** Where the shared raster settings are read and written (the layer, or a dialog's working copy) */
export interface RasterAccess {
  get: () => RasterSettings;
  set: (patch: Partial<RasterSettings>) => void;
}

/**
 * Fields for the images of a layer (layer panel, layer settings and the "Adjust Image" dialog).
 * Speed, power and passes are not here: images use those of the layer. The image-specific settings
 * (mode, negative, threshold, cells) are written to the layer's image settings; live = without an undo
 * step (the dialogs commit or revert the whole change themselves). raster: line interval/DPI,
 * bidirectional and overscan, which belong to the layer; null leaves them out (shown elsewhere).
 */
export function imageLayerFields(ed: Editor, i: number, live: boolean, onChange?: () => void, raster: RasterAccess | null = null): HTMLElement[] {
  const IL = ed.imgLayer(i);
  const set = (patch: Partial<ImageLayer>) => {
    ed.updateImgLayer(i, patch, !live);
    onChange?.();
  };
  const setRaster = (patch: Partial<RasterSettings>) => {
    raster?.set(patch);
    onChange?.();
  };
  const num = (key: 'cells' | 'angle' | 'threshold', min: number, max: number, int = false) => {
    const el = numInput('', (v) => set({ [key]: Math.max(min, Math.min(max, int ? Math.round(v) : v)) } as Partial<ImageLayer>));
    el.value = String(IL[key]);
    return el;
  };
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
  const negative = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: IL.negative, onchange: (e: Event) => set({ negative: (e.target as HTMLInputElement).checked }) }), t('Negativ'));
  const head = [h('label', {}, t('Bildmodus')), modeSel, extra];
  if (!raster) return [...head, h('span', { class: 'checks' }, negative)];

  const R = raster.get();
  const interval = numInput('', (v) => {
    const c = Math.max(0.01, Math.min(2, v));
    setRaster({ interval: c });
    interval.value = String(c);
    dpi.value = String(Math.round(25.4 / c));
  }, t('Zeilenabstand in mm'));
  interval.value = String(R.interval);
  const dpi = numInput('', (v) => {
    const c = Math.round((25.4 / Math.max(12.7, Math.min(2540, v))) * 10000) / 10000;
    setRaster({ interval: c });
    interval.value = String(c);
  }, t('Auflösung in Punkten pro Zoll'));
  dpi.value = String(Math.round(25.4 / R.interval));
  const overscan = numInput('', (v) => {
    const c = Math.max(0, Math.min(50, v));
    setRaster({ overscan: c });
    overscan.value = String(c);
  });
  overscan.value = String(R.overscan);
  const bidi = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: R.bidirectional, onchange: (e: Event) => setRaster({ bidirectional: (e.target as HTMLInputElement).checked }) }), t('Bidirektional'));
  return [
    ...head,
    h('label', {}, t('Zeilenabstand (mm)')), interval,
    h('label', {}, 'DPI'), dpi,
    h('span', { class: 'checks' }, negative, bidi),
    h('label', {}, t('Überfahrweg (%)')), overscan,
  ];
}

/** The layer itself as raster settings: changes without an undo step (the dialogs handle undo) */
export const liveLayerRaster = (ed: Editor, i: number): RasterAccess => ({
  get: () => ed.layer(i),
  set: (patch) => {
    Object.assign(ed.layer(i), patch);
    ed.emit('doc');
  },
});
