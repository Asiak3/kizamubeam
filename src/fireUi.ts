import { h } from './dom';
import { Device } from './gcode';
import { fireRequest } from './fire';
import { t } from './i18n';
import { machine } from './machine';

const uncertainty = () => t('Laserstatus unbekannt – direkt am Gerät abschalten');
export const fireWarning = () => t('Der Laser feuert im Stand. Brand- und Verletzungsgefahr. Nur unter Aufsicht verwenden. Bei App- oder Verbindungsfehlern kann die automatische Abschaltung ausfallen. Ausschalter am Gerät bereithalten.');
const warning = () => t('Nur vor Ort am Laser verwenden. Software versucht nach Ablauf zu stoppen; keine unabhängige Abschaltgarantie. Bei Störung am Gerät abschalten.');
const blocked = () => machine.connected && ['grbl', 'grblhal', 'fluidnc'].includes(machine.fwId) && machine.status.ov?.[2] !== 100 ?
  t('Testfeuer blockiert: Laser-Override muss als 100 % bestätigt sein. Laser-Override auf 100 % setzen und aktuelle Statusmeldung abwarten.') :
  t('Testfeuer blockiert: Gerät mit unterstützter Firmware lokal verbinden, Idle abwarten und gültige Leistung und Dauer innerhalb der Gerätegrenzen eingeben.');
const statusText = () => machine.fire.state === 'unknown' ? uncertainty() :
  t('Testfeuer läuft oder startet · noch höchstens {s} s (Software-Zeit)', { s: machine.fire.remaining });

// Keep the visible draft intact and accept either decimal separator, not grouping or partial parses.
function readDecimal(input: HTMLInputElement): number {
  const raw = input.value.trim();
  return /^(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw.replace(',', '.')) : NaN;
}

const inRange = (value: number, max: number) => Number.isFinite(value) && value > 0 && value <= max;

let overlayInstalled = false;
let refreshOverlay = () => {};
let inlineAction: HTMLButtonElement | undefined;
let inlineVisible = false;
let hideOverlayInPanel = false;
const overlayKey = 'kizamubeam.fireOverlayInPanel';
try { hideOverlayInPanel = localStorage.getItem(overlayKey) === 'hide'; } catch { /* Default to visible. */ }

export const fireOverlayInPanel = () => !hideOverlayInPanel;
export function setFireOverlayInPanel(show: boolean) {
  hideOverlayInPanel = !show;
  try { localStorage.setItem(overlayKey, show ? 'show' : 'hide'); } catch { /* Session preference only. */ }
  refreshOverlay();
}

const stopAvailable = () => machine.connected && !machine.remote;
const stopUnavailable = () => t('Software-Stopp nicht verfügbar: keine lokale Verbindung. Direkt am Gerät abschalten.');
const fireActive = () => machine.fire.state === 'starting' || machine.fire.state === 'firing';
const panelAction = () => machine.fire.state === 'unknown' ? 'confirm' : fireActive() ? 'stop' : 'start';

// App surface roots from dock.ts, contextMenu.ts, toolbars/ and style.css. Check roots,
// not every DOM node: even a narrow intersection between hit-test probes is uncertain.
const fireOccludingSurfaces = 'dialog[open], .dock-group.floating, .toolbar-popup, .toolbar-float, .toolbar-layout-floating, ' +
  '.menu-items, .editor-context-submenu, .fontpick-pop, .overlap-picker, .sync-banner, .editor-isolation-badge, ' +
  '.slot-placement-badge, .sketch-bar, .dock-ghost, .dock-mark, .toolbar-drop-preview, #texteditor';

function inlineActionVisible(overlay: HTMLElement): boolean {
  try {
    const action = inlineAction;
    if (!inlineVisible || !action || document.hidden ||
        !action.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ||
        typeof document.elementsFromPoint !== 'function') return false;
    const r = action.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 ||
        r.right > window.innerWidth || r.bottom > window.innerHeight) return false;
    for (const surface of document.querySelectorAll<HTMLElement>(fireOccludingSurfaces)) {
      if (surface.contains(action) || overlay.contains(surface) ||
          !surface.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      // Modal backdrops block the action even outside the dialog's own rectangle.
      if (surface.matches(':modal')) return false;
      const bounds = surface.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      if (!(bounds.right <= r.left || bounds.left >= r.right || bounds.bottom <= r.top || bounds.top >= r.bottom)) return false;
    }
    // Viewport coordinates already include docking, CSS transforms, scrolling and browser zoom.
    // Ignore only our own fallback so showing it cannot keep it visible forever.
    // Cross probes avoid the button's intentionally unpainted rounded corners.
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    for (const [x, y] of [[cx, cy], [r.left + 0.5, cy], [r.right - 0.5, cy], [cx, r.top + 0.5], [cx, r.bottom - 0.5]]) {
      const top = document.elementsFromPoint(x, y).find((element) => !overlay.contains(element));
      if (!top || !action.contains(top)) return false;
    }
    return true;
  } catch { return false; } // A failed visibility query must never hide the fallback.
}

function fireOverlayHost(): HTMLElement {
  const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')];
  if (modals.length === 0) return document.body;
  if (modals.length === 1) return modals[0];
  // Top-layer order is not DOM order. A modal's backdrop participates in hit
  // testing even outside its box, while older modal contents are inert.
  try {
    for (const element of document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)) {
      const modal = element.closest<HTMLDialogElement>('dialog:modal');
      if (modal && modals.includes(modal)) return modal;
    }
  } catch { /* Keep state updates working; native modal focus is the next-best cue. */ }
  const focused = document.activeElement?.closest<HTMLDialogElement>('dialog:modal');
  return focused && modals.includes(focused) ? focused : modals[modals.length - 1];
}

export function installFireOverlay() {
  if (overlayInstalled) return;
  overlayInstalled = true;
  const status = h('span', { role: 'status', 'aria-live': 'polite' });
  const stop = h('button', { class: 'btn', type: 'button', onclick: () => void machine.fire.stop() }, t('Testfeuer stoppen')) as HTMLButtonElement;
  const confirm = h('button', { class: 'btn fire-confirm', type: 'button', onclick: (e: Event) => {
    if (e.isTrusted) machine.fire.confirmOff();
  } }, t('Am Gerät geprüft: Laser ist aus')) as HTMLButtonElement;
  const stopReason = h('span', { role: 'status' });
  const overlay = h('div', { class: 'fire-overlay', role: 'region', 'aria-label': t('Testfeuer') }, status, stop, stopReason, confirm);
  const origin = document.body;
  origin.append(overlay);
  let visibilityFrame: number | undefined;
  const refresh = () => {
    const host = machine.fire.locked ? fireOverlayHost() : origin;
    if (overlay.parentElement !== host) {
      const focused = overlay.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      host.append(overlay);
      focused?.focus({ preventScroll: true });
    }
    overlay.hidden = !machine.fire.locked || (hideOverlayInPanel && inlineActionVisible(overlay));
    const text = machine.fire.locked ? statusText() : '';
    if (status.textContent !== text) status.textContent = text;
    confirm.hidden = machine.fire.state !== 'unknown';
    confirm.disabled = !machine.fire.canConfirm;
    stop.disabled = !stopAvailable();
    const reason = stop.disabled ? stopUnavailable() : '';
    if (stopReason.textContent !== reason) stopReason.textContent = reason;
    // Occlusion and floating-window movement need not emit an intersection/resize event.
    // Recheck only while this preference can suppress a required fallback.
    if (machine.fire.locked && hideOverlayInPanel && inlineVisible && !document.hidden && visibilityFrame === undefined) {
      visibilityFrame = window.requestAnimationFrame(() => {
        visibilityFrame = undefined;
        refresh();
      });
    }
  };
  refreshOverlay = refresh;
  // Discover modals and rescue the fallback on removal even with a static,
  // offscreen Fire session. Ignore our own moves and status/text mutations.
  new MutationObserver((records) => {
    if (records.some((record) => record.type === 'attributes' ? (record.target as Element).matches('dialog') :
      [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 &&
        ((node === overlay && !overlay.isConnected) || (node as Element).matches('dialog') ||
          (node as Element).querySelector('dialog'))))) refresh();
  }).observe(origin, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('focusin', refresh, true);
  document.addEventListener('close', refresh, true);
  machine.on((e) => { if (e.type === 'fire' || e.type === 'connection') refresh(); });
  const stopOnLeave = () => {
    if (machine.fire.locked && machine.fire.state !== 'unknown') void machine.fire.stop();
  };
  window.addEventListener('blur', stopOnLeave);
  window.addEventListener('pagehide', stopOnLeave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopOnLeave(); refresh(); });
  window.addEventListener('resize', refresh);
  document.addEventListener('scroll', refresh, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && machine.fire.locked) void machine.fire.stop();
  }, true);
  refresh();
}

let nextControlsId = 0;
/** Panel is only a view; the session and its stop overlay outlive panel hiding/rebuilding. */
export function fireControls(getDevice: () => Device, openSettings: () => void) {
  const id = `fire-controls-${++nextControlsId}`;
  const power = h('input', { type: 'text', inputmode: 'decimal', class: 'move-fire-power',
    id: `${id}-power`, 'aria-label': t('Leistung (%)'), value: String(getDevice().fireMaxPower) }) as HTMLInputElement;
  const seconds = h('input', { type: 'text', inputmode: 'decimal', class: 'move-fire-secs',
    id: `${id}-seconds`, 'aria-label': t('Dauer (s)'), value: String(getDevice().fireMaxSeconds) }) as HTMLInputElement;
  const error = h('span', { role: 'status', 'aria-live': 'polite' });
  const run = async (e: Event) => {
    if (!await machine.startFire(getDevice(), readDecimal(power), readDecimal(seconds), e)) {
      error.textContent = machine.fireStartError || blocked();
    }
  };
  let pressedAction: ReturnType<typeof panelAction> | null = null;
  const action = h('button', { class: 'btn fire-action', type: 'button', onclick: async (e: MouseEvent) => {
    const intended = pressedAction;
    pressedAction = null;
    if (!e.isTrusted || e.detail > 1 || action.disabled) return;
    const current = panelAction();
    // Never turn a press on “Stop” into an acknowledgement if time expires before release.
    if (intended !== null ? intended !== current : e.detail > 0) return;
    if (current === 'confirm') machine.fire.confirmOff();
    else if (current === 'stop') await machine.fire.stop();
    else await run(e);
  } });
  action.addEventListener('pointerdown', (e) => {
    if (e.isTrusted && e.isPrimary && e.button === 0) pressedAction = panelAction();
  });
  action.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.code !== 'Space') return;
    if (e.repeat) e.preventDefault();
    else if (e.isTrusted) pressedAction = panelAction();
  });
  action.addEventListener('blur', () => { pressedAction = null; });
  // One explicit press owns this hold, never a click, a repeated key, or the next session.
  let held: number | 'space' | null = null;
  const endHold = () => {
    if (held === null) return;
    held = null;
    if (fireActive()) void machine.fire.stop();
  };
  const hold = h('button', { class: 'btn fire-hold', type: 'button' }, t('Zum Testfeuer gedrückt halten'));
  hold.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || !e.isPrimary || e.button !== 0 || hold.disabled || held !== null) return;
    e.preventDefault();
    try { hold.setPointerCapture(e.pointerId); } catch { return; }
    if (!hold.hasPointerCapture(e.pointerId)) return;
    hold.focus({ preventScroll: true });
    held = e.pointerId;
    void run(e).finally(() => { if (!fireActive() && held === e.pointerId) held = null; });
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    hold.addEventListener(event, (e) => { if (held === e.pointerId) endHold(); });
  }
  hold.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.isTrusted || e.repeat || hold.disabled || held !== null) return;
    held = 'space';
    void run(e).finally(() => { if (!fireActive() && held === 'space') held = null; });
  });
  hold.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    e.stopPropagation();
    if (held === 'space') endHold();
  });
  hold.addEventListener('blur', endHold);
  const settings = h('button', { class: 'fire-settings-link', type: 'button', onclick: openSettings }, t('Testfeuer-Einstellungen öffnen')) as HTMLButtonElement;
  const hint = h('div', { class: 'note' }, t('Testfeuer wird pro Gerät in den Geräteeinstellungen freigegeben.'), ' ', settings);
  const status = h('div', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const controls = h('div', { class: 'move-row move-fire-controls' }, action, hold,
    h('div', { class: 'form move-form' },
      h('label', { for: `${id}-power` }, t('Leistung (%)')), power,
      h('label', { for: `${id}-seconds` }, t('Dauer (s)')), seconds),
    error);
  const root = h('section', { class: 'move-fire', 'aria-labelledby': `${id}-title` },
    h('h4', { id: `${id}-title` }, t('Testfeuer')), controls, status, hint, h('div', { class: 'note' }, warning()));
  if (typeof IntersectionObserver !== 'undefined') {
    inlineAction = action;
    inlineVisible = false;
    let observedRatio = 1;
    let observe: IntersectionObserver;
    const watch = () => {
      observe?.disconnect();
      // Bracket the last ratio with adjacent Float32 values: a double-only
      // epsilon could collapse to identical thresholds in the browser engine.
      const threshold = new Float32Array([observedRatio]);
      const bits = new Uint32Array(threshold.buffer);
      if (threshold[0] > observedRatio) bits[0]--;
      const lower = threshold[0];
      bits[0]++;
      const upper = Math.min(1, threshold[0]);
      observe = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target !== action) continue;
          const r = entry.boundingClientRect, i = entry.intersectionRect, ratio = entry.intersectionRatio;
          const validRatio = Number.isFinite(ratio) && ratio >= 0 && ratio <= 1;
          // Chromium's intersection edges can be rounded to Float32 even when the
          // bounding rectangle is not. Compare at that precision, not by area percentage.
          const visible = entry.isIntersecting && validRatio && r.width > 0 && r.height > 0 && i.width > 0 && i.height > 0 &&
            (['left', 'top', 'right', 'bottom'] as const).every((edge) =>
              Number.isFinite(r[edge]) && Number.isFinite(i[edge]) &&
              (edge === 'left' || edge === 'top' ? Math.fround(i[edge]) <= Math.fround(r[edge]) :
                Math.fround(i[edge]) >= Math.fround(r[edge])));
          if (inlineAction === action) {
            inlineVisible = visible;
            refreshOverlay();
          }
          if (!visible) endHold();
          // A full intersection can have a ratio below 1. Track either direction
          // from the last ratio so subsequent clipping/recovery still notifies.
          // The initial notification after re-observing has the same ratio and settles.
          if (validRatio && ratio !== observedRatio) {
            observedRatio = ratio;
            watch();
          }
        }
      }, { threshold: [lower, upper] });
      observe.observe(action);
    };
    watch();
  }
  let previous = getDevice();
  const refresh = () => {
    const d = getDevice();
    if (previous !== d) {
      previous = d;
      power.value = String(d.fireMaxPower);
      seconds.value = String(d.fireMaxSeconds);
      error.textContent = '';
    }
    const powerValue = readDecimal(power);
    const secondsValue = readDecimal(seconds);
    const enabled = d.fireEnabled === true;
    controls.classList.toggle('fire-disabled', !enabled);
    power.disabled = seconds.disabled = !enabled || machine.fire.locked;
    const canStart = machine.canStartFire(d) && !!fireRequest(d, powerValue, secondsValue);
    const confirming = machine.fire.state === 'unknown';
    if (!fireActive()) held = null;
    action.disabled = confirming ? !machine.fire.canConfirm : fireActive() ? !stopAvailable() : !canStart;
    const label = confirming ? t('Am Gerät geprüft: Laser ist aus') : fireActive() ? t('Testfeuer stoppen') : t('Testfeuer starten');
    if (action.textContent !== label) action.textContent = label;
    action.classList.toggle('fire-confirm', confirming);
    hold.disabled = held === null && !canStart;
    const message = !machine.fire.locked ? '' : statusText() + (!stopAvailable() ? ` ${stopUnavailable()}` : '');
    if (status.textContent !== message) status.textContent = message;
    power.setAttribute('aria-invalid', String(enabled && !inRange(powerValue, d.fireMaxPower)));
    seconds.setAttribute('aria-invalid', String(enabled && !inRange(secondsValue, d.fireMaxSeconds)));
    const text = !canStart && !machine.fire.locked && d.fireEnabled ? blocked() : '';
    if (error.textContent !== text) error.textContent = text;
    settings.disabled = machine.fire.locked;
  };
  power.addEventListener('input', refresh);
  seconds.addEventListener('input', refresh);
  machine.on((e) => { if (e.type !== 'line') refresh(); });
  refresh();
  return { root, refresh };
}

/** Fire alone uses raw numeric drafts: invalid visible text must never reuse a previous value. */
export function fireSettings(d: Device) {
  const id = `fire-settings-${++nextControlsId}`;
  const enabled = h('input', { id: `${id}-enabled`, type: 'checkbox', checked: d.fireEnabled,
    onchange: (e: Event) => { d.fireEnabled = (e.target as HTMLInputElement).checked; } }) as HTMLInputElement;
  const error = h('div', { role: 'status', 'aria-live': 'polite', class: 'note wide' });
  const power = h('input', { id: `${id}-power`, type: 'text', inputmode: 'decimal', value: String(d.fireMaxPower) }) as HTMLInputElement;
  const seconds = h('input', { id: `${id}-seconds`, type: 'text', inputmode: 'decimal', value: String(d.fireMaxSeconds) }) as HTMLInputElement;
  const validate = () => {
    const badPower = !inRange(readDecimal(power), 100);
    const badSeconds = !inRange(readDecimal(seconds), 600);
    power.setAttribute('aria-invalid', String(badPower));
    seconds.setAttribute('aria-invalid', String(badSeconds));
    error.textContent = badPower ? t('Maximale Leistung: einen Wert größer 0 bis 100 % eingeben.') :
      badSeconds ? t('Maximale Laufzeit: einen Wert größer 0 bis 600 Sekunden eingeben.') : '';
    return !badPower && !badSeconds;
  };
  power.addEventListener('input', validate);
  seconds.addEventListener('input', validate);
  validate();
  return {
    focusEnabled: () => enabled.focus(),
    rows: [h('div', { class: 'note wide' }, fireWarning()),
      h('div', { class: 'note wide' }, t('Nur vor Ort mit unterstützter Firmware; standardmäßig aus. Keine Fernsteuerung und kein KI-Agent. Software-Zeitlimit ist keine unabhängige Abschaltgarantie.')),
      h('label', { for: `${id}-enabled` }, t('Testfeuer aktivieren')), enabled,
      h('label', { for: `${id}-power` }, t('Maximale Leistung (%)')), power,
      h('label', { for: `${id}-seconds` }, t('Maximale Laufzeit (s)')), seconds, error],
    save: (showError: () => void = () => {}) => {
      if (machine.fire.locked) { error.textContent = uncertainty(); return false; }
      if (!validate()) { showError(); (power.getAttribute('aria-invalid') === 'true' ? power : seconds).focus(); return false; }
      d.fireMaxPower = readDecimal(power);
      d.fireMaxSeconds = readDecimal(seconds);
      return true;
    },
  };
}
