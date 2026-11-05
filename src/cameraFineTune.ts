import type { CameraCalib } from './camera';
import type { CameraFineTune } from './cameraProfile';
import { fineTunePoint, inverseFineTunePoint } from './cameraProfile';
import { h } from './dom';
import { t } from './i18n';

/** Compose bed-space adjustment after the base calibration, never edit its H. */
export function fineTunedCalibration(c: CameraCalib, fine: CameraFineTune): CameraCalib {
  const p = inverseFineTunePoint({ x: 0, y: 0 }, fine, c.bedW, c.bedH);
  const x = inverseFineTunePoint({ x: 1, y: 0 }, fine, c.bedW, c.bedH);
  const y = inverseFineTunePoint({ x: 0, y: 1 }, fine, c.bedW, c.bedH);
  const a = [x.x - p.x, y.x - p.x, p.x, x.y - p.y, y.y - p.y, p.y, 0, 0, 1];
  const H = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++)
    for (let k = 0; k < 3; k++) H[row * 3 + col] += c.H[row * 3 + k] * a[k * 3 + col];
  return { ...c, H, ...(c.head ? { head: { ...c.head } } : {}) };
}

/** Apply the same bed-space affine transform to head translation, without translation twice. */
export function fineTunedHeadShift(c: CameraCalib, pos: { x: number; y: number } | null, fine: CameraFineTune) {
  if (!c.head || !pos) return { x: 0, y: 0 };
  const a = fineTunePoint(pos, fine, c.bedW, c.bedH);
  const b = fineTunePoint(c.head, fine, c.bedW, c.bedH);
  return { x: a.x - b.x, y: a.y - b.y };
}

export function fineTuneControls(get: () => CameraFineTune, set: (fine: CameraFineTune) => void) {
  const form = h('div', { class: 'camera-adjustment-fields' });
  const fields: { input: HTMLInputElement; key: keyof CameraFineTune; percent: boolean }[] = [];
  const specs: [keyof CameraFineTune, string, number, number, number, boolean][] = [
    ['offsetX', t('X-Verschiebung (mm)'), -10000, 10000, 0.1, false],
    ['offsetY', t('Y-Verschiebung (mm, positiv = oben)'), -10000, 10000, 0.1, false],
    ['scaleX', t('Breitenkorrektur (%)'), -90, 900, 0.1, true],
    ['scaleY', t('Höhenkorrektur (%)'), -90, 900, 0.1, true],
    ['rotation', t('Drehung (° gegen den Uhrzeigersinn)'), -180, 180, 0.1, false],
  ];
  for (const [key, label, min, max, step, percent] of specs) {
    const input = h('input', { type: 'number', min, max, step, 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || value < min || value > max) { refresh(); return; }
      set({ ...get(), [key]: percent ? (100 + value) / 100 : value });
      refresh();
    });
    fields.push({ input, key, percent });
    const caption = key === 'offsetY' ? t('Y-Verschiebung (mm)') : key === 'rotation' ? t('Drehung (°)') : label;
    form.append(h('label', { class: 'camera-adjustment-field', title: label },
      h('span', { class: 'camera-adjustment-label' }, caption), input));
  }
  const refresh = () => {
    const fine = get();
    for (const { input, key, percent } of fields) {
      if (document.activeElement !== input) input.value = String(Number((percent ? (fine[key] - 1) * 100 : fine[key]).toFixed(5)));
    }
  };
  const element = h('details', { open: true, class: 'camera-overlay-adjustments' }, h('summary', {}, t('Kameraüberlagerung anpassen')),
    h('p', { class: 'note' }, t('Nur Bildabbildung; Kalibrierung bleibt erhalten. Skalierung/Drehung verwenden die kalibrierte Bettmitte. 0% erhält die Größe. +Y ist oben; +Drehung ist gegen den Uhrzeigersinn.')),
    form, h('button', { class: 'btn', onclick: () => {
      set({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 }); refresh();
    } }, t('Überlagerungsanpassung zurücksetzen')));
  refresh();
  return { element, refresh };
}
