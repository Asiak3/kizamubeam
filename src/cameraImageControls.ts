import type { CameraImageAdjustments } from './cameraProfile';
import { t } from './i18n';

export interface CameraHardwareChange {
  field: string;
  geometryChanged: boolean;
}

interface Options {
  getTrack: () => MediaStreamTrack | null;
  getSettings: () => CameraImageAdjustments;
  onChange: (settings: CameraImageAdjustments) => void;
  onBeforeHardwareChange?: (change: CameraHardwareChange) => void;
  onHardwareChange?: (change: CameraHardwareChange) => void;
}

// These Image Capture extensions are not present in every TypeScript DOM lib.
type NativeValues = Record<string, unknown>;
type NativeTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & NativeValues;
};
interface NumericCapability { min: number; max: number; step?: number }
const hardwareFields = () => [
  ['exposureMode', t('Belichtungsmodus'), 'mode'],
  ['exposureTime', t('Belichtungszeit'), 'number'],
  ['exposureCompensation', t('Belichtungskorrektur'), 'number'],
  ['focusMode', t('Fokusmodus'), 'mode'],
  ['focusDistance', t('Fokusabstand'), 'number'],
  ['whiteBalanceMode', t('Weißabgleichsmodus'), 'mode'],
  ['colorTemperature', t('Farbtemperatur'), 'number'],
  ['zoom', t('Zoom'), 'number'],
  ['sharpness', t('Schärfe'), 'number'],
] as const;

function numericCapability(value: unknown): NumericCapability | null {
  if (!value || typeof value !== 'object') return null;
  const range = value as NumericCapability;
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min) return null;
  return {
    min: range.min, max: range.max,
    step: Number.isFinite(range.step) && range.step! > 0 ? range.step : undefined,
  };
}

/** Software correction plus explicitly requested controls on the already-open track.
 * No acquisition, enumeration, device selection, persistence, or automatic apply.
 */
export function cameraImageControls(options: Options): {
  element: HTMLElement; refresh: () => void; dispose: () => void;
} {
  const element = document.createElement('section');
  element.className = 'camera-image-controls';
  const heading = document.createElement('h4');
  heading.textContent = t('Bildanpassungen');
  element.append(heading);
  const software = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = t('Softwarekorrektur');
  software.append(legend);
  element.append(software);
  let disposed = false;
  const cleanup: (() => void)[] = [];
  const syncSoftware: (() => void)[] = [];
  const listen = (target: HTMLElement, event: string, handler: () => void) => {
    target.addEventListener(event, handler);
    cleanup.push(() => target.removeEventListener(event, handler));
  };
  for (const [key, label, min, max] of [
    ['brightness', t('Helligkeit'), 0, 3], ['contrast', t('Kontrast'), 0, 3],
    ['saturation', t('Sättigung'), 0, 3], ['gamma', t('Gamma'), 0.1, 5],
  ] as const) {
    const row = document.createElement('label');
    row.append(`${label} `);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = '0.01';
    const output = document.createElement('output');
    const sync = () => {
      const raw = options.getSettings()[key];
      const value = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : 1;
      input.value = String(value); output.textContent = value.toFixed(2);
    };
    syncSoftware.push(sync);
    listen(input, 'input', () => {
      if (disposed) return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      options.onChange({ ...options.getSettings(), [key]: Math.max(min, Math.min(max, value)) });
      sync();
    });
    row.append(input, output); software.append(row);
  }
  const grayscaleRow = document.createElement('label');
  const grayscale = document.createElement('input');
  grayscale.type = 'checkbox';
  grayscaleRow.append(grayscale, ' ' + t('Graustufen')); software.append(grayscaleRow);
  syncSoftware.push(() => { grayscale.checked = options.getSettings().grayscale; });
  listen(grayscale, 'change', () => {
    if (!disposed) options.onChange({ ...options.getSettings(), grayscale: grayscale.checked });
  });
  const reset = document.createElement('button');
  reset.type = 'button'; reset.textContent = t('Softwareanpassungen zurücksetzen');
  software.append(reset);
  listen(reset, 'click', () => {
    if (disposed) return;
    options.onChange({ brightness: 1, contrast: 1, saturation: 1, gamma: 1, grayscale: false });
    syncSoftware.forEach(sync => sync());
  });

  const hardware = document.createElement('fieldset');
  const hardwareLegend = document.createElement('legend');
  hardwareLegend.textContent = t('Kamerahardware (nur aktuelle Sitzung)');
  hardware.append(hardwareLegend);
  const note = document.createElement('p');
  note.textContent = t('Nur von der gewählten geöffneten Kamera gemeldete Regler sind verfügbar. Werte verwenden Geräteeinheiten. Hardwareänderungen können eine Neukalibrierung erfordern.');
  hardware.append(note);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  hardware.append(status);
  const rows = document.createElement('div'); hardware.append(rows); element.append(hardware);
  let generation = 0;
  let observedTrack: MediaStreamTrack | null = null;
  let pending: { track: MediaStreamTrack; generation: number } | null = null;
  const unavailable = new Set<string>();
  let hardwareCleanup: (() => void)[] = [];

  function renderHardware(): void {
    for (const remove of hardwareCleanup) remove();
    hardwareCleanup = [];
    rows.replaceChildren();
    const track = options.getTrack();
    if (track !== observedTrack) {
      generation++; observedTrack = track; unavailable.clear(); pending = null;
      status.textContent = '';
    }
    if (!track || track.readyState !== 'live') {
      status.textContent = t('Hardwareregler nicht verfügbar: keine gewählte geöffnete Kamera.');
      return;
    }
    let caps: NativeValues;
    let actual: NativeValues;
    try {
      const native = track as NativeTrack;
      if (typeof native.getCapabilities !== 'function') throw new Error(t('Abfrage der Kamerafähigkeiten nicht unterstützt.'));
      caps = native.getCapabilities() as NativeValues;
      actual = track.getSettings() as NativeValues;
    } catch (error) {
      status.textContent = t('Hardwareregler nicht verfügbar: {error}', { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const [key, label, kind] of hardwareFields()) {
      const row = document.createElement('label');
      row.append(`${label}: `); rows.append(row);
      const value = actual[key];
      const range = kind === 'number' ? numericCapability(caps[key]) : null;
      const modes = kind === 'mode' && Array.isArray(caps[key])
        ? (caps[key] as unknown[]).filter((v): v is string =>
          typeof v === 'string' && ['manual', 'continuous', 'single-shot', 'auto'].includes(v)) : [];
      const readable = kind === 'mode' ? typeof value === 'string' && modes.includes(value)
        : typeof value === 'number' && Number.isFinite(value) && !!range && value >= range.min && value <= range.max;
      if (unavailable.has(key) || !readable || (kind === 'mode' ? !modes.length : !range)) {
        row.append(unavailable.has(key) ? t('Nicht verfügbar (Kamera hat den angeforderten Wert nicht bestätigt)') : t('Nicht verfügbar (nicht von der Kamera gemeldet)'));
        continue;
      }
      const control = kind === 'mode' ? document.createElement('select') : document.createElement('input');
      if (control instanceof HTMLSelectElement) {
        for (const mode of modes) {
          const option = document.createElement('option');
          option.value = mode; option.textContent = mode === 'continuous' || mode === 'auto' ? t('Automatisch') : mode === 'manual' ? t('Manuell') : t('Einzelaufnahme');
          control.append(option);
        }
      } else if (range) {
        control.type = 'number'; control.min = String(range.min); control.max = String(range.max);
        control.step = range.step ? String(range.step) : 'any';
      }
      control.value = String(value); control.disabled = pending !== null;
      row.append(control);
      const change = () => {
        if (disposed || pending || options.getTrack() !== track || track.readyState !== 'live') return;
        const requested = kind === 'mode' ? control.value : Number(control.value);
        if (requested === value) return;
        if (kind === 'mode' ? !modes.includes(String(requested))
          : control.value.trim() === '' || !Number.isFinite(requested) || !range || Number(requested) < range.min || Number(requested) > range.max) {
          status.textContent = t('{label}: ungültiger Wert.', { label }); control.value = String(value); return;
        }
        if (['zoom', 'focusMode', 'focusDistance'].includes(key)) {
          // Invalidate the selected calibration before the async request. It must
          // stay invalid even if the user switches cameras or closes the panel.
          options.onBeforeHardwareChange?.({ field: key, geometryChanged: true });
          if (disposed || options.getTrack() !== track || track.readyState !== 'live') return;
        }
        const operation = { track, generation };
        pending = operation;
        status.textContent = t('{label} wird angewendet…', { label });
        renderHardware();
        const current = () => !disposed && options.getTrack() === track && track.readyState === 'live'
          && operation.generation === generation && pending === operation;
        void (async () => {
          try {
            // The nonstandard named fields are gated by this exact track's capabilities.
            const previous = track.getConstraints() as MediaTrackConstraints & NativeValues;
            const constraints = { ...previous };
            delete constraints[key];
            constraints.advanced = (previous.advanced ?? []).map((entry) => {
              const retained = { ...entry } as MediaTrackConstraintSet & NativeValues;
              delete retained[key];
              return retained;
            });
            constraints.advanced.push({ [key]: requested } as MediaTrackConstraintSet);
            await track.applyConstraints(constraints);
            if (!current()) return;
            const after = track.getSettings() as NativeValues;
            const readback = after[key];
            const matches = typeof requested === 'number'
              ? typeof readback === 'number' && Number.isFinite(readback)
                && Math.abs(readback - requested) <= Math.max(1e-7, Math.abs(requested) * 1e-7)
              : readback === requested;
            const resized = ['width', 'height'].some((dimension) => typeof actual[dimension] === 'number'
              && after[dimension] !== actual[dimension]);
            if (resized) {
              status.textContent = t('Kamerabildgröße geändert. Auflösung prüfen und vor Verwendung der Überlagerung neu kalibrieren.');
            } else if (!matches) {
              unavailable.add(key);
              status.textContent = t('{label} nicht verfügbar: Kamera hat den angeforderten Wert nicht bestätigt.', { label });
            } else status.textContent = t('{label} angewendet und bestätigt.', { label });
            // Even a partial/ignored request may have changed related device state.
            options.onHardwareChange?.({ field: key,
              geometryChanged: resized || ['zoom', 'focusMode', 'focusDistance'].includes(key) });
          } catch (error) {
            if (!current()) return;
            status.textContent = t('{label} fehlgeschlagen: {error}', { label, error: error instanceof Error ? error.message : String(error) });
            // A rejected optical request may still have partially changed device state.
            if (['zoom', 'focusMode', 'focusDistance'].includes(key))
              options.onHardwareChange?.({ field: key, geometryChanged: true });
          } finally {
            if (current()) { pending = null; renderHardware(); }
          }
        })();
      };
      control.addEventListener('change', change);
      hardwareCleanup.push(() => control.removeEventListener('change', change));
    }
  }
  function refresh(): void {
    if (disposed) return;
    syncSoftware.forEach(sync => sync());
    renderHardware();
  }
  refresh();
  return {
    element, refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true; generation++; pending = null;
      cleanup.forEach(remove => remove()); hardwareCleanup.forEach(remove => remove());
      software.disabled = true; hardware.disabled = true;
    },
  };
}
