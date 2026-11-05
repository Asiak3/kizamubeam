import { h } from './dom';
import { FIRMWARES, jogLines, rotaryOn } from './gcode';
import { device, onDeviceChange, runBlocker } from './laser';
import { isTauri, machine } from './machine';
import { t, tBackend } from './i18n';

export interface CalibrationMachineControlsOptions {
  /** Invalidate captured calibration data before a user-requested jog or home. */
  onMotion?: () => void;
}

/** No discovery, connection, polling or motion is initiated by creating/discarding this panel. */
export function calibrationMachineControls(options: CalibrationMachineControlsOptions = {}): {
  element: HTMLElement;
  dispose: () => void;
} {
  let disposed = false;
  let pending = false;
  let awaitingStatus = false;
  let requestFailed = false;
  let lastStatusAt = -Infinity;
  const element = h('section', { class: 'calibration-machine-controls', 'aria-label': t('Maschinenbedienung zur Kalibrierung') });
  const status = h('div', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const position = h('div', { class: 'move-pos' });
  const reason = h('div', { class: 'note' });
  const error = h('div', { class: 'note error', role: 'alert' });
  const motionButtons: HTMLButtonElement[] = [];
  const fields: HTMLInputElement[] = [];
  const button = (label: string, onclick: () => void, title = label) =>
    h('button', { type: 'button', class: 'btn', title, onclick }, label);
  const numeric = (label: string, value: number, min: number) => {
    const input = h('input', {
      type: 'number', value: String(value), min: String(min), step: 'any',
      'aria-label': label, oninput: () => refresh(),
    });
    fields.push(input);
    return input;
  };
  // Keep the previous calibration jog defaults; Z remains deliberately slower.
  const distance = numeric(t('XY-Schrittweite (mm)'), 10, 0.001);
  const speed = numeric(t('XY-Geschwindigkeit (mm/min)'), 3000, 1);
  const zDistance = numeric(t('Z-Schrittweite (mm)'), 0.1, 0.001);
  const zSpeed = numeric(t('Z-Geschwindigkeit (mm/min)'), 60, 1);
  const valid = (input: HTMLInputElement) => input.validity.valid && Number.isFinite(input.valueAsNumber) && input.valueAsNumber > 0;
  const knownPosition = (z = false) => {
    const p = machine.status.wpos;
    const count = z ? 3 : 2;
    return !!p && p.length >= count && p.slice(0, count).every(Number.isFinite);
  };
  const idleBlocker = (): string | null => {
    if (disposed) return t('Bedienung geschlossen.');
    if (!isTauri()) return t('Die Maschinenbedienung ist nur in der Desktop-App verfügbar.');
    if (pending || machine.connecting) return t('Eine Maschinenanfrage läuft.');
    if (!machine.connected) return t('Nicht verbunden. Mit den gewählten Geräteeinstellungen verbinden.');
    // runBlocker also covers uploads; state/SD checks below are deliberately stricter.
    if (machine.running || machine.status.sd || runBlocker()) return t('Maschine beschäftigt oder im Alarm. Auftrag beenden und auf Idle warten.');
    if (device.fw === 'marlin') return t('Marlin-Positionsmeldungen bestätigen hier keinen Idle-Zustand. Verfahren/Referenzfahrt sind in diesem Dialog nicht verfügbar; das Bewegen-Fenster verwenden.');
    if (machine.status.state !== 'Idle') return t('Vor Kalibrierbewegungen muss die Maschine Idle melden.');
    if (Date.now() - lastStatusAt > 3000) return t('Warte auf aktuellen Maschinenstatus (höchstens 3 Sekunden alt).');
    if (awaitingStatus) return t('Warte auf neuen Maschinenstatus nach der letzten Bewegungsanfrage.');
    if (rotaryOn(device)) return t('Drehachsenmodus vor Kalibrierbewegungen deaktivieren.');
    return null;
  };
  const jogBlocker = (z = false): string | null => {
    const why = idleBlocker();
    if (why) return why;
    if (z && !device.zAxis) return t('Dieses Gerät hat keine konfigurierte Z-Achse.');
    if (!knownPosition(z)) return t('Position unbekannt. Auf eine gültige Positionsmeldung warten.');
    if (!valid(z ? zDistance : distance) || !valid(z ? zSpeed : speed)) return t('Positive Schrittweite und Geschwindigkeit (mindestens 1 mm/min) eingeben.');
    return null;
  };
  const connectionBlocker = (): string | null => {
    if (disposed || pending || machine.connecting || !isTauri()) return t('Verbindungsbedienung nicht verfügbar.');
    const unreportedMarlinState = device.fw === 'marlin' && machine.status.state === '';
    if (machine.running || machine.status.sd || (machine.connected && machine.status.state !== 'Idle' && !unreportedMarlinState)) return t('Vor Verbindungsänderungen auf Idle warten.');
    if (machine.connected && (awaitingStatus || runBlocker())) return t('Auf das Ende des aktuellen Maschinenvorgangs warten.');
    if (!machine.connected && (device.conn === 'serial' ? !device.port.trim() : !device.host.trim())) return t('Zuerst die Verbindung des gewählten Geräts im Laser-Fenster konfigurieren.');
    return null;
  };
  const perform = async (action: () => Promise<unknown>, motion = false) => {
    pending = true;
    requestFailed = false;
    error.textContent = '';
    refresh();
    try {
      if (motion) {
        options.onMotion?.();
        // A callback may close the dialog; never send a request after disposal.
        if (disposed) return;
        if (!machine.connected || machine.connecting || machine.running || machine.status.sd || machine.status.state !== 'Idle' || rotaryOn(device) || runBlocker()) {
          throw new Error(t('Maschine nicht mehr bereit für Kalibrierbewegungen.'));
        }
      }
      await action();
      if (motion && !requestFailed) awaitingStatus = true;
    } catch (e) {
      requestFailed = true;
      if (!disposed) error.textContent = t('Maschinenanfrage fehlgeschlagen: {error}', { error: tBackend(e instanceof Error ? e.message : String(e)) });
    } finally {
      pending = false;
      if (!disposed) refresh();
    }
  };
  const jog = (dx: number, dy: number, z = false) => {
    const why = jogBlocker(z);
    if (why) { error.textContent = why; refresh(); return; }
    const f = (z ? zSpeed : speed).valueAsNumber;
    const step = (z ? zDistance : distance).valueAsNumber;
    // Mirror moveTab: up is +Y, right is +X. Z labels are controller signs,
    // not focus directions: zFlip describes job focus offsets, not manual axes.
    const lines = z ? FIRMWARES[device.fw].jog(0, dy * step, f, 'Z') : jogLines(device, dx * step, dy * step, f);
    void perform(async () => {
      if (disposed || !knownPosition(z)) return;
      for (const line of lines) {
        if (!machine.connected || machine.running || machine.status.sd) break;
        // Finish the generated modal sequence if the dialog is closed mid-request.
        // On error, skip further movement but retain its generated G90 cleanup.
        if (requestFailed && line !== lines[lines.length - 1]) continue;
        if (requestFailed && lines.length === 1) break;
        await machine.send(line);
      }
    }, true);
  };
  const connect = button(t('Verbinden'), () => {
    const why = connectionBlocker();
    if (why) { error.textContent = why; return; }
    if (machine.connected && device.fw === 'marlin' && machine.status.state === '' &&
      !confirm(t('Marlin trennen? Positionsmeldungen bestätigen keinen Stillstand. Trennen ist kein Stoppbefehl.'))) return;
    void perform(async () => {
      if (machine.connected) await machine.disconnect();
      else {
        await machine.connect(device, false);
        if (!machine.connected && !requestFailed) error.textContent = t('Verbindung fehlgeschlagen. Geräteeinstellungen und Maschinenprotokoll prüfen.');
      }
    });
  });
  const home = button(t('Referenzfahrt…'), () => {
    const why = idleBlocker();
    if (why) { error.textContent = why; return; }
    const warning = device.limitSwitches === 'yes' ? '' : '\n' + t('Endschalter fehlen oder sind unbestätigt. Eine Referenzfahrt kann eine Achse an den Anschlag fahren.');
    if (!confirm(t('Referenzfahrt starten? Alle Referenzachsen können sich bewegen. Arbeitsbereich zuerst freiräumen.') + warning)) return;
    // Recheck after confirmation; no alarm unlock or implicit home is offered.
    const changed = idleBlocker();
    if (changed) { error.textContent = changed; refresh(); return; }
    const command = FIRMWARES[device.fw].home;
    void perform(() => machine.send(command), true);
  }, t('Referenzfahrt ausdrücklich bestätigen'));
  const pad = h('div', { class: 'jog' });
  const arrows: [number, number, string][] = [
    [-1, 1, '↖'], [0, 1, '↑'], [1, 1, '↗'],
    [-1, 0, '←'], [0, 0, ''], [1, 0, '→'],
    [-1, -1, '↙'], [0, -1, '↓'], [1, -1, '↘'],
  ];
  for (const [dx, dy, label] of arrows) {
    if (!dx && !dy) { pad.append(h('span')); continue; }
    const b = button(label, () => jog(dx, dy), t('Verfahren X {x}, Y {y}', { x: `${dx > 0 ? '+' : ''}${dx}`, y: `${dy > 0 ? '+' : ''}${dy}` }));
    motionButtons.push(b);
    pad.append(b);
  }
  const zMinus = button('Z−', () => jog(0, -1, true), t('Negative Steuerungsrichtung Z verfahren'));
  const zPlus = button('Z+', () => jog(0, 1, true), t('Positive Steuerungsrichtung Z verfahren'));
  const zSection = h('div', {},
    h('div', { class: 'form' }, h('label', {}, t('Z-Schrittweite (mm)')), zDistance, h('label', {}, t('Z-Geschwindigkeit (mm/min)')), zSpeed),
    h('div', { class: 'conn-row' }, zMinus, zPlus),
    h('div', { class: 'note' }, t('Z+/Z− sind Steuerungsrichtungen. Freiraum vor jeder Bewegung prüfen.')),
  );
  element.append(
    h('h3', {}, t('Maschinenbedienung')), status, position,
    h('div', { class: 'conn-row' }, connect, home),
    h('div', { class: 'move-row' }, pad, h('div', { class: 'form move-form' },
      h('label', {}, t('XY-Schrittweite (mm)')), distance, h('label', {}, t('XY-Geschwindigkeit (mm/min)')), speed)),
    zSection, reason, error,
    h('div', { class: 'note' }, t('Verbinden verwendet die gewählten Geräteeinstellungen ohne automatische Referenzfahrt. Bewegungen erfolgen manuell; Arbeitsbereich freihalten. Schließen stoppt keine Bewegung und trennt keine Verbindung.')),
  );
  function refresh() {
    if (disposed) return;
    const endpoint = device.conn === 'serial' ? device.port : `${device.host}:${device.conn === 'ws' ? device.wsPort : device.tcpPort}`;
    status.textContent = machine.connecting ? t('Verbinde…') : machine.connected
      ? t('Verbunden: {where} · {state}', { where: machine.where, state: machine.status.state || t('Zustand unbekannt') })
      : t('Getrennt · {device} · {endpoint}', { device: device.name, endpoint: endpoint || t('Verbindung nicht konfiguriert') });
    const p = machine.connected ? machine.status.wpos : null;
    position.textContent = p && knownPosition() ? `X ${p[0].toFixed(2)}  Y ${p[1].toFixed(2)}${device.zAxis && Number.isFinite(p[2]) ? `  Z ${p[2].toFixed(2)}` : ''} mm` : t('Position unbekannt');
    connect.textContent = machine.connected ? t('Trennen') : t('Verbinden');
    connect.disabled = !!connectionBlocker();
    home.disabled = !!idleBlocker();
    for (const b of motionButtons) b.disabled = !!jogBlocker();
    zSection.hidden = !device.zAxis;
    zMinus.disabled = zPlus.disabled = !!jogBlocker(true);
    for (const input of fields) input.disabled = pending || machine.connecting || awaitingStatus || machine.running || !!machine.status.sd || (machine.connected && machine.status.state !== 'Idle');
    reason.textContent = jogBlocker() ?? t('Bereit zum manuellen Verfahren. Jeder Klick bewegt um die eingegebene Schrittweite.');
  }
  const offMachine = machine.on((event) => {
    if (disposed) return;
    if (event.type === 'line') {
      // send/connect report many failures as events instead of rejected promises.
      if (event.dir === 'error') {
        requestFailed = true;
        awaitingStatus = false;
        error.textContent = t('Maschinenfehler: {error}', { error: tBackend(event.line) });
        refresh();
      }
      return;
    }
    if (event.type === 'status' && machine.connected) {
      lastStatusAt = Date.now();
      if (!pending) awaitingStatus = false;
    }
    if (event.type === 'connection') {
      lastStatusAt = -Infinity;
      if (!machine.connected) awaitingStatus = false;
    }
    refresh();
  });
  const offDevice = onDeviceChange(refresh);
  const freshnessTimer = setInterval(refresh, 500);
  refresh();
  return {
    element,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offMachine();
      offDevice();
      clearInterval(freshnessTimer);
      // Detached DOM references cannot issue commands after disposal either.
      element.querySelectorAll('button, input').forEach((el) => { (el as HTMLButtonElement | HTMLInputElement).disabled = true; });
    },
  };
}
