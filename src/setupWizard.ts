// Assistent „Laser einrichten“: führt von der ersten Verbindung bis zum ersten sicheren Testauftrag.
// Er fasst vorhandene Funktionen (Geräte, Verbindung, Verschieben, Rahmen, Vorschau, Start) zu einem Ablauf zusammen.
// Regeln: Firmware-Einstellungen werden nur erklärt und vorgeschlagen, gesendet erst nach Klick und Rückfrage;
// keine Referenzfahrt ohne Endschalter; der Testauftrag startet nur nach ausdrücklicher Freigabe.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { Device, FIRMWARES, newDevice, rotaryOn, StartFrom } from './gcode';
import { presetList } from './packs';
import { presetSelect } from './packsDialog';
import { isTauri, machine, PortInfo } from './machine';
import { addDevice, deviceList, device, frameJob, JobSource, openDeviceDialog, openPreview, onDeviceChange, patchDevice, runBlocker, selectDevice, startJob } from './laser';
import { defaultImageLayer } from './model';
import {
  buildTestJob, checkConfig, DEFAULT_TEST_JOB, detectFirmware, directionFix, emptyFacts, Facts, Finding, Fix, homingAllowed, machineFacts, parseFluidConfig, parseGrblSettings,
  parseMarlin, stepsFix, Switches, switchesOf, TestJobOptions,
} from './setup';
import { parseConfigFile } from './fluidnc';
import { t, tBackend } from './i18n';

const OFFERED_KEY = 'kizamubeam.setupOffered';

/** Beim allerersten Start der Desktop-App (noch keine Geräte gespeichert) den Assistenten einmal öffnen */
export function maybeOfferSetup(ed: Editor) {
  if (!isTauri()) return;
  try {
    if (localStorage.getItem(OFFERED_KEY) || localStorage.getItem('kizamubeam.devices')) return;
    localStorage.setItem(OFFERED_KEY, '1');
  } catch {
    return;
  }
  openSetupWizard(ed);
}

/** Befehle senden und die Antworten sammeln, bis jede Zeile mit ok/error beantwortet ist oder die Zeit abläuft */
const query = (cmds: string[], ms = 2500) => machine.query(cmds, ms);

const waitFor = async (ok: () => boolean, ms: number) => {
  for (let waited = 0; !ok() && waited < ms; waited += 100) await new Promise((r) => setTimeout(r, 100));
};

const ICON: Record<Finding['level'], string> = { ok: '✓', info: 'i', warn: '!', error: '✕' };

/** Der offene Assistent (es gibt höchstens einen) */
let openDlg: HTMLDialogElement | null = null;

export function openSetupWizard(ed: Editor) {
  if (openDlg) return;
  const fw = () => FIRMWARES[device.fw];
  const STEPS = [t('Verbinden'), t('Erkennen'), t('Prüfen'), t('Bewegen'), t('Testauftrag')];
  let step = 0;
  let facts: Facts = emptyFacts();
  let detecting = false;
  /** Alle Antworten der Steuerung, solange der Assistent offen ist (z. B. die Begrüßung beim Verbinden) */
  const seen: string[] = [];
  const dir: { x?: 'ok' | 'reverse' | 'none'; y?: 'ok' | 'reverse' | 'none' } = {};
  const measured: { x?: number; y?: number } = {};
  const MEASURE = 50;
  const test: TestJobOptions = { ...DEFAULT_TEST_JOB };
  const ready = [false, false, false, false];
  let lastResult = '';
  /** Teile, die sich mit dem Maschinenzustand ändern (ohne die Eingabefelder neu zu bauen) */
  let live: (() => void)[] = [];

  const nav = h('ol', { class: 'setup-steps' });
  const body = h('div', { class: 'setup-body' });
  const statusLine = h('div', { class: 'setup-status' });
  const backBtn = h('button', { class: 'btn', onclick: () => go(step - 1) }, t('Zurück')) as HTMLButtonElement;
  const nextBtn = h('button', { class: 'btn primary', onclick: () => (step < STEPS.length - 1 ? go(step + 1) : dlg.close()) }) as HTMLButtonElement;

  // Kleine Konsole im Assistenten: Ausgabe der Steuerung mitlesen und eigene Befehle senden
  const log = h('div', { class: 'console-log setup-log' });
  const cmdIn = h('input', { type: 'text', placeholder: t('Befehl, z. B. $I oder G0 X10'), spellcheck: false }) as HTMLInputElement;
  cmdIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !cmdIn.value.trim()) return;
    const v = cmdIn.value.trim();
    cmdIn.value = '';
    if (v === '?' && fw().realtime) machine.realtime(0x3f);
    else machine.send(v);
  });
  const consoleBox = h('details', { class: 'setup-console' }, h('summary', {}, t('Konsole')), log, h('div', { class: 'console-input' }, cmdIn));

  const offMachine = machine.on((e) => {
    if (e.type === 'line') {
      if (e.dir === 'in' || e.dir === 'error') seen.push(e.line);
      if (seen.length > 2000) seen.splice(0, seen.length - 2000);
      const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
      log.append(h('div', { class: `ln ${e.dir}` }, e.dir === 'out' ? `> ${e.line}` : e.line));
      while (log.childElementCount > 300) log.firstChild!.remove();
      if (atEnd) log.scrollTop = log.scrollHeight;
      return;
    }
    if (e.type === 'done' && step === 4) {
      lastResult = e.ok
        ? t('Der Testauftrag ist fertig. Ist das Quadrat sauber und der Kreis rund, ist die Maschine eingerichtet. Für passende Leistung und Geschwindigkeit hilft danach der Materialtest.')
        : e.message;
      render();
      return;
    }
    refreshLive();
  });
  const offDevice = onDeviceChange(() => refreshLive());

  function refreshLive() {
    const st = machine.status;
    statusLine.textContent = machine.connecting
      ? t('Verbinde …')
      : machine.connected
        ? `${device.name} · ${machine.where} · ${st.state || t('Verbunden')}${st.wpos ? ` · X ${st.wpos[0].toFixed(1)} Y ${st.wpos[1].toFixed(1)}` : ''}`
        : t('{name}: nicht verbunden', { name: device.name });
    statusLine.classList.toggle('error', st.state.startsWith('Alarm') && machine.connected);
    live.forEach((f) => f());
  }

  function go(i: number) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    render();
    if (step === 1 && machine.connected && !facts.fw && !detecting) detect();
  }

  function render() {
    live = [];
    nav.textContent = '';
    STEPS.forEach((name, i) =>
      nav.append(h('li', { class: i === step ? 'cur' : i < step ? 'done' : '', onclick: () => go(i) }, h('span', { class: 'num' }, String(i + 1)), name)),
    );
    body.textContent = '';
    body.append(...[stepConnect, stepDetect, stepCheck, stepMove, stepTest][step]());
    backBtn.disabled = step === 0;
    nextBtn.textContent = step < STEPS.length - 1 ? t('Weiter') : t('Fertig');
    refreshLive();
  }

  const para = (text: string, cls = 'note') => h('p', { class: cls }, text);
  const needConn = () => para(t('Erst im Schritt „Verbinden“ eine Verbindung herstellen.'), 'note error');
  /** Knopf, der nur bei bestehender Verbindung (und ohne laufenden Auftrag) geht */
  const connBtn = (label: string, onclick: () => void, extra: () => boolean = () => true, cls = 'btn') => {
    const b = h('button', { class: cls, onclick }, label) as HTMLButtonElement;
    live.push(() => (b.disabled = !machine.connected || machine.running || !extra()));
    return b;
  };

  // ---------- 1. Verbinden ----------

  function stepConnect(): HTMLElement[] {
    const { devices } = deviceList();
    const devSel = h('select', { onchange: (e: Event) => (selectDevice(ed, (e.target as HTMLSelectElement).value), render()) },
      ...devices.map((d) => h('option', { value: d.id, selected: d === device }, `${d.name} (${FIRMWARES[d.fw].label})`)),
    ) as HTMLSelectElement;
    const presets = presetList();
    const presetSel = presetSelect(presets);
    const addBtn = h('button', {
      class: 'btn', onclick: () => {
        addDevice(ed, newDevice(presets[Number(presetSel.value)].preset));
        facts = emptyFacts();
        render();
      },
    }, t('Neues Gerät anlegen')) as HTMLButtonElement;
    live.push(() => (devSel.disabled = presetSel.disabled = addBtn.disabled = machine.connected || machine.connecting));

    const set = (patch: Partial<Device>) => patchDevice(ed, patch);
    const connSel = h('select', { onchange: (e: Event) => (set({ conn: (e.target as HTMLSelectElement).value as Device['conn'] }), render()) },
      h('option', { value: 'serial', selected: device.conn === 'serial' }, t('USB-Kabel')),
      h('option', { value: 'tcp', selected: device.conn === 'tcp' }, t('Netzwerk / WLAN (Telnet)')),
      h('option', { value: 'ws', selected: device.conn === 'ws' }, t('Netzwerk / WLAN (WebSocket)')),
    ) as HTMLSelectElement;
    const rows: (HTMLElement | string)[] = [h('label', {}, t('Anschluss')), connSel];
    const inputs: HTMLElement[] = [connSel];
    if (device.conn === 'serial') {
      const portSel = h('select', { onchange: (e: Event) => set({ port: (e.target as HTMLSelectElement).value }) }) as HTMLSelectElement;
      const fill = (ports: PortInfo[]) => {
        portSel.textContent = '';
        const names = ports.map((p) => p.name);
        if (device.port && !names.includes(device.port)) names.unshift(device.port);
        if (!names.length) portSel.append(h('option', { value: '' }, t('Keine serielle Schnittstelle gefunden')));
        for (const n of names) {
          const p = ports.find((x) => x.name === n);
          portSel.append(h('option', { value: n, selected: n === device.port }, p?.description ? `${n} (${p.description})` : n));
        }
        if (!device.port && names[0]) set({ port: names[0] });
      };
      const scan = () =>
        machine.ports().then(fill).catch((e) => {
          fill([]);
          machine.log(tBackend(String(e)), 'error');
        });
      scan();
      const scanBtn = h('button', { class: 'btn small', onclick: scan }, t('Neu suchen')) as HTMLButtonElement;
      const baud = h('select', { onchange: (e: Event) => set({ baud: Number((e.target as HTMLSelectElement).value) }) },
        ...[57600, 115200, 230400, 250000, 460800, 921600].map((b) => h('option', { value: String(b), selected: b === device.baud }, String(b))),
      ) as HTMLSelectElement;
      rows.push(h('label', {}, t('Schnittstelle')), h('div', { class: 'conn-row' }, portSel, scanBtn), h('label', {}, t('Baudrate')), baud);
      inputs.push(portSel, scanBtn, baud);
    } else {
      const host = h('input', { type: 'text', value: device.host, placeholder: t('z. B. 192.168.1.50 oder fluidnc.local'), onchange: (e: Event) => set({ host: (e.target as HTMLInputElement).value.trim() }) }) as HTMLInputElement;
      const isWs = device.conn === 'ws';
      const portIn = numInput('', (v) => v > 0 && set(isWs ? { wsPort: Math.round(v) } : { tcpPort: Math.round(v) }));
      portIn.value = String(isWs ? device.wsPort : device.tcpPort);
      rows.push(h('label', {}, t('Adresse')), host, h('label', {}, t('Port')), portIn);
      inputs.push(host, portIn);
    }
    live.push(() => inputs.forEach((el) => ((el as HTMLInputElement).disabled = machine.connected || machine.connecting)));

    const connectBtn = h('button', {
      class: 'btn primary', onclick: async () => {
        if (machine.connected) return machine.disconnect();
        (document.activeElement as HTMLElement | null)?.blur();
        facts = emptyFacts();
        // Der Assistent referenziert beim Verbinden nie; ob das sicher ist, klärt erst Schritt 3
        await machine.connect(device, false);
        if (machine.connected) go(1);
      },
    }) as HTMLButtonElement;
    live.push(() => {
      connectBtn.textContent = machine.connected ? t('Trennen') : machine.connecting ? t('Verbinde …') : t('Verbinden');
      connectBtn.disabled = machine.connecting || !isTauri();
    });

    return [
      h('h4', {}, t('Maschine finden und verbinden')),
      para(t('Schalte den Laser ein und verbinde ihn per USB-Kabel oder über das Netzwerk. Die meisten günstigen Diodenlaser mit GRBL hängen am USB-Kabel (115200 Baud); FluidNC-Steuerungen erreichst du meist über WLAN, die Adresse zeigt deren Weboberfläche.')),
      h('div', { class: 'form setup-form' },
        h('label', {}, t('Gerät')), h('div', { class: 'conn-row' }, devSel),
        h('label', {}, t('oder neu')), h('div', { class: 'conn-row' }, presetSel, addBtn),
        ...rows,
      ),
      h('div', { class: 'conn-row' }, connectBtn),
      isTauri() ? para(t('Der Assistent startet beim Verbinden keine Referenzfahrt.')) : para(t('Die Maschinenanbindung gibt es nur in der Desktop-App.'), 'note error'),
    ];
  }

  // ---------- 2. Erkennen ----------

  async function readSettings() {
    const k = facts.fw ?? device.fw;
    if (k === 'fluidnc') {
      facts.fluid = parseFluidConfig(await query(['$CD'], 5000));
      facts.fluidFile = parseConfigFile(await query(['$Config/Filename'])) ?? undefined;
      facts.grbl = parseGrblSettings(await query(['$$']));
    } else if (k === 'grbl' || k === 'grblhal') facts.grbl = parseGrblSettings(await query(['$$']));
    else if (k === 'marlin') facts.marlin = parseMarlin(await query(['M211', 'M503'], 3000));
  }

  async function detect() {
    if (!machine.connected || detecting) return;
    detecting = true;
    render();
    try {
      const lines = [...seen];
      let det = detectFirmware(lines);
      // Zuerst die Abfrage des eingestellten Profils, dann die übrigen; unbekannte Befehle beantwortet jede Steuerung nur mit einem Fehler
      const order = device.fw === 'marlin' ? ['M115', '$I', 'version'] : device.fw === 'smoothie' ? ['version', '$I', 'M115'] : ['$I', 'M115', 'version'];
      for (const c of order) {
        if (det) break;
        lines.push(...(await query([c])));
        det = detectFirmware(lines);
      }
      facts = { ...emptyFacts(), fw: det?.fw ?? null, version: det?.version ?? '' };
      await readSettings();
    } finally {
      detecting = false;
      render();
    }
  }

  function stepDetect(): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, t('Firmware und Einstellungen erkennen'))];
    if (!machine.connected) return [...out, needConn()];
    out.push(para(t('KizamuBeam fragt die Steuerung nach Firmware, Version und den wichtigsten Einstellungen. Dabei wird nur gelesen, nichts verändert.')));
    if (detecting) return [...out, para(t('Frage die Steuerung …'))];
    const mf = machineFacts(facts);
    const yes = t('ja'),
      no = t('nein'),
      unk = '–';
    const yn = (v: boolean | null) => (v === null ? unk : v ? yes : no);
    const rows: [string, string][] = [
      [t('Firmware'), facts.fw ? facts.version || FIRMWARES[facts.fw].label : t('nicht erkannt')],
      [t('Arbeitsbereich'), mf.bed ? `${mf.bed.w} × ${mf.bed.h} mm` : unk],
      [t('Leistungsskala ($30)'), mf.sMax !== null ? t('S{s} = 100 %', { s: mf.sMax }) : unk],
      [t('Lasermodus ($32)'), yn(mf.laserMode)],
      [t('Referenzfahrt ($22)'), yn(mf.homing)],
      [t('Endschalter überwacht ($21)'), yn(mf.hardLimits)],
      [t('Verfahrgrenzen ($20)'), yn(mf.softLimits)],
      [t('Endschalter angeschlossen'), mf.switches === null ? t('lässt sich nicht abfragen') : yn(mf.switches)],
      [t('Schritte je mm (X / Y)'), mf.steps ? `${mf.steps.x} / ${mf.steps.y}` : unk],
    ];
    out.push(h('table', { class: 'setup-facts' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));
    if (facts.fw === 'smoothie') out.push(para(t('Smoothieware meldet ihre Einstellungen nicht über die Verbindung; sie stehen in der config.txt auf der SD-Karte der Steuerung.')));
    out.push(h('div', { class: 'conn-row' }, connBtn(t('Erneut abfragen'), () => detect())));
    return out;
  }

  // ---------- 3. Prüfen ----------

  async function applyFix(fix: Fix) {
    if (fix.send) {
      if (machine.running) return;
      const msg =
        t('Diese Befehle werden an die Steuerung gesendet und dort dauerhaft gespeichert:') + '\n\n' + fix.send.join('\n') +
        (fix.undo ? '\n\n' + t('Zurücknehmen lässt sich die Änderung mit:') + '\n' + fix.undo.join('\n') : '') + '\n\n' + t('Jetzt senden?');
      if (!confirm(msg)) return;
      // FluidNC: Stand vor dem Speichern sichern (Laser → FluidNC → Konfiguration → Sicherungen)
      if (fix.send.some((l) => l.startsWith('$CD=')) && machine.fluid)
        (await import('./fluidncDialog')).addBackup(machine.fluid.text, machine.fluid.file, t('vor „{fix}“', { fix: fix.label }));
      for (const l of fix.send) await machine.send(l);
      if (fix.undo) machine.log(t('Zum Zurücknehmen: {cmds}', { cmds: fix.undo.join(' · ') }));
      await new Promise((r) => setTimeout(r, 300));
      await readSettings();
    } else if (fix.app) {
      const fwChange = fix.app.fw && fix.app.fw !== device.fw;
      const patch = { ...fix.app };
      // Leistungsskala mitziehen, wenn sie noch dem Standard des alten Profils entsprach
      if (fwChange && device.sMax === fw().sMax) patch.sMax = FIRMWARES[fix.app.fw!].sMax;
      patchDevice(ed, patch);
      if (fwChange && machine.connected) {
        // Das Protokoll (Echtzeitbefehle, Zeile für Zeile) hängt am Profil: neu verbinden
        await machine.disconnect();
        await waitFor(() => !machine.connected, 3000);
        await machine.connect(device, false);
        await readSettings();
      }
    } else if (fix.action === 'home') {
      if (!homingAllowed(device.limitSwitches, machineFacts(facts))) return;
      await machine.send(fw().home);
    } else if (fix.action === 'unlock' && fw().unlock) await machine.send(fw().unlock!);
    render();
  }

  function findingEl(f: Finding): HTMLElement {
    const el = h('div', { class: `setup-finding ${f.level}` },
      h('span', { class: 'icon' }, ICON[f.level]),
      h('div', {}, h('div', { class: 'title' }, f.title), f.text ? h('div', { class: 'text' }, f.text) : null),
    );
    if (f.fix) {
      const fix = f.fix;
      const label = fix.send ? `${fix.label} (${fix.send.join(' · ')})` : fix.label;
      const b = fix.app ? h('button', { class: 'btn small', onclick: () => applyFix(fix) }, label) : connBtn(label, () => applyFix(fix), () => true, 'btn small');
      el.lastElementChild!.append(h('div', { class: 'fix' }, b));
    }
    return el;
  }

  function stepCheck(): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, t('Maschinenkonfiguration überprüfen'))];
    if (!machine.connected) return [...out, needConn()];
    out.push(para(t('Der Assistent ändert an der Steuerung nichts von selbst. Vorschläge für die Firmware werden erst nach deinem Klick und einer Rückfrage gesendet; der alte Wert steht dabei, damit du ihn zurücksetzen kannst.')));
    const mf = machineFacts(facts);
    const ask = (v: Switches, label: string) =>
      h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'setup-switches', checked: device.limitSwitches === v, onchange: () => (patchDevice(ed, { limitSwitches: v }), render()) }),
        label,
      );
    out.push(
      h('div', { class: 'setup-question' },
        h('div', {}, t('Hat deine Maschine Endschalter (kleine Schalter oder Sensoren an den Enden der Achsen)?')),
        h('div', { class: 'checks' }, ask('yes', t('Ja')), ask('no', t('Nein')), ask('unknown', t('Weiß nicht'))),
        mf.switches !== null && device.limitSwitches === 'unknown'
          ? para(mf.switches ? t('Laut FluidNC-Konfiguration sind an X und Y Endschalter angeschlossen.') : t('Laut FluidNC-Konfiguration sind an X und Y keine Endschalter angeschlossen.'))
          : null,
      ),
    );
    const list = h('div', { class: 'setup-findings' });
    const fill = () => {
      list.textContent = '';
      const findings = checkConfig({
        facts, device, switches: device.limitSwitches, state: machine.status.state, mpos: machine.status.mpos, wco: machine.workOffset(),
      });
      // Probleme zuerst
      const rank = { error: 0, warn: 1, info: 2, ok: 3 };
      findings.sort((a, b) => rank[a.level] - rank[b.level]).forEach((f) => list.append(findingEl(f)));
    };
    fill();
    out.push(list);
    if (!facts.fw && !Object.keys(facts.grbl).length) out.push(para(t('Noch keine Einstellungen gelesen: Im Schritt „Erkennen“ die Steuerung abfragen.')));
    // Referenzfahrt nur mit Endschaltern
    const canHome = () => homingAllowed(device.limitSwitches, machineFacts(facts));
    const homeNote = para(
      switchesOf(device.limitSwitches, mf) === 'yes'
        ? mf.homing === false ? t('Die Referenzfahrt ist in der Steuerung ausgeschaltet.') : t('Bei der Referenzfahrt fährt der Kopf langsam an die Endschalter. Halte die Achsen frei.')
        : t('Ohne bestätigte Endschalter bietet der Assistent keine Referenzfahrt an.'),
    );
    out.push(
      h('h4', {}, t('Position')),
      homeNote,
      h('div', { class: 'conn-row' },
        connBtn(t('Referenzfahrt starten'), () => canHome() && machine.send(fw().home), canHome),
        ...(fw().unlock ? [connBtn(t('Entsperren ({cmd})', { cmd: fw().unlock! }), () => machine.send(fw().unlock!))] : []),
        connBtn(t('Erneut prüfen'), async () => (await readSettings(), render())),
      ),
    );
    // Zustand und Position fließen in die Prüfung ein; bei Änderung neu bewerten
    let lastKey = '';
    live.push(() => {
      const key = `${machine.status.state}|${machine.status.mpos?.map((v) => v.toFixed(0)).join(',')}|${JSON.stringify(machine.workOffset())}`;
      if (key !== lastKey) ((lastKey = key), fill());
    });
    return out;
  }

  // ---------- 4. Bewegen ----------

  function stepMove(): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, t('Bewegungen ohne Laser prüfen'))];
    if (!machine.connected) return [...out, needConn()];
    out.push(para(t('Der Laser bleibt bei diesem Schritt aus. Fahre den Kopf vorher ungefähr in die Mitte, damit in jede Richtung mindestens {d} mm Platz sind. KizamuBeam erwartet: X+ fährt nach rechts, Y+ fährt nach hinten (von dir weg).', { d: MEASURE + 10 })));
    if (rotaryOn(device) && device.rotary.axis === 'Y') out.push(para(t('Die Drehachse ist eingeschaltet und steckt am Y-Anschluss. Für diesen Test die normale Y-Achse anschließen oder die Drehachse ausschalten.'), 'note error'));
    const canMove = () => !machine.status.state.startsWith('Alarm');
    const move = (dx: number, dy: number) => {
      machine.send('M5');
      for (const l of fw().jog(dx, dy, 1000)) machine.send(l);
    };
    const alarmNote = para(t('Die Steuerung ist im Alarm. Erst im Schritt „Prüfen“ referenzieren oder entsperren.'), 'note error');
    live.push(() => (alarmNote.hidden = canMove()));
    out.push(alarmNote);

    const axisTest = (axis: 'x' | 'y') => {
      const X = axis === 'x';
      const box = h('div', { class: 'setup-axis' });
      const answer = (v: 'ok' | 'reverse' | 'none', label: string) =>
        h('button', { class: `btn small${dir[axis] === v ? ' primary' : ''}`, onclick: () => ((dir[axis] = v), render()) }, label);
      box.append(
        h('div', { class: 'conn-row' },
          connBtn(X ? t('X um 10 mm in Plusrichtung fahren') : t('Y um 10 mm in Plusrichtung fahren'), () => move(X ? 10 : 0, X ? 0 : 10), canMove),
          connBtn(t('Zurückfahren'), () => move(X ? -10 : 0, X ? 0 : -10), canMove, 'btn small'),
        ),
        h('div', { class: 'conn-row' },
          h('span', {}, t('Wohin ist der Kopf gefahren?')),
          answer('ok', X ? t('Nach rechts') : t('Nach hinten')),
          answer('reverse', X ? t('Nach links') : t('Nach vorne')),
          answer('none', t('Gar nicht')),
        ),
      );
      const r = dir[axis];
      if (r === 'ok') box.append(findingEl({ id: 'dir', level: 'ok', title: t('Richtung von {axis} stimmt', { axis: axis.toUpperCase() }), text: '' }));
      if (r === 'none')
        box.append(findingEl({
          id: 'dir', level: 'warn', title: t('Keine Bewegung'),
          text: t('Prüfe, ob die Steuerung im Alarm ist (Schritt „Prüfen“), ob die Motoren angeschlossen sind und Strom haben und ob in der Konsole eine Fehlermeldung steht.'),
        }));
      if (r === 'reverse') {
        const fix = directionFix(axis, facts);
        const k = facts.fw ?? device.fw;
        const text =
          k === 'fluidnc'
            ? fix
              ? t('Die Achse läuft verkehrt herum; Entwürfe kämen gespiegelt heraus. KizamuBeam kehrt dazu den direction_pin des Motors in der config.yaml um; wirksam wird das nach einem Neustart der Steuerung.')
              : t('In der config.yaml beim Motor der Achse {axis} den direction_pin umkehren: „:low“ anhängen oder entfernen (z. B. über die Weboberfläche von FluidNC), danach die Steuerung neu starten.', { axis: axis.toUpperCase() })
            : k === 'marlin'
              ? t('Bei Marlin ist die Richtung in der Firmware festgelegt (INVERT_X_DIR / INVERT_Y_DIR).')
              : k === 'smoothie'
                ? t('In der config.txt beim dir_pin der Achse ein „!“ anhängen oder entfernen.')
                : fix
                  ? t('Die Achse läuft verkehrt herum; Entwürfe kämen gespiegelt heraus. Die Richtung lässt sich in der Steuerung umkehren ($3). Mit Referenzfahrt wird deren Richtung ($23) mit umgekehrt.')
                  : t('Erst im Schritt „Erkennen“ die Einstellungen lesen, dann gibt es hier einen Vorschlag.');
        box.append(findingEl({ id: 'dir', level: 'warn', title: t('{axis} fährt verkehrt herum', { axis: axis.toUpperCase() }), text, fix: fix ?? undefined }));
      }

      // Weg nachmessen (Schritte je mm)
      const meas = numInput('', (v) => ((measured[axis] = v), render()), t('Gemessener Weg in mm'));
      meas.value = measured[axis] !== undefined ? String(measured[axis]) : '';
      const details = h('details', { class: 'setup-measure', open: measured[axis] !== undefined },
        h('summary', {}, t('Weg nachmessen (optional)')),
        para(t('Markiere die Position des Kopfes, fahre {d} mm und miss den tatsächlichen Weg mit einem Lineal.', { d: MEASURE })),
        h('div', { class: 'conn-row' },
          connBtn(t('{axis} um {d} mm fahren', { axis: axis.toUpperCase(), d: MEASURE }), () => move(X ? MEASURE : 0, X ? 0 : MEASURE), canMove, 'btn small'),
          connBtn(t('Zurückfahren'), () => move(X ? -MEASURE : 0, X ? 0 : -MEASURE), canMove, 'btn small'),
          h('label', {}, t('gemessen (mm)')), meas,
        ),
      );
      const m = measured[axis];
      if (m !== undefined) {
        const res = stepsFix(axis, MEASURE, m, facts);
        if (Math.abs(m - MEASURE) <= MEASURE * 0.005) details.append(findingEl({ id: 'steps', level: 'ok', title: t('Der Weg stimmt'), text: '' }));
        else
          details.append(findingEl({
            id: 'steps', level: 'warn', title: t('Gefahren: {m} mm statt {d} mm', { m, d: MEASURE }),
            text: res
              ? t('Richtig wären {steps} Schritte je mm. Miss lieber noch einmal über einen längeren Weg, bevor du die Steuerung änderst.', { steps: res.steps })
              : t('Die Schritte je mm der Steuerung sind nicht bekannt (Schritt „Erkennen“). Sie stehen bei GRBL in $100/$101, bei FluidNC in steps_per_mm.'),
            fix: res?.fix ?? undefined,
          }));
      }
      box.append(details);
      return box;
    };
    out.push(h('h4', {}, 'X'), axisTest('x'), h('h4', {}, 'Y'), axisTest('y'));
    return out;
  }

  // ---------- 5. Testauftrag ----------

  function stepTest(): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, t('Einen einfachen Testauftrag lasern'))];
    out.push(para(t('Ein Quadrat mit einem Kreis darin, als Linie mit niedriger Leistung. Der Test erscheint nicht auf der Arbeitsfläche. Lege ein Stück Pappe oder Restholz unter den Laser und stelle den Fokus ein.')));
    const source = (): JobSource => {
      const { doc, layer } = buildTestJob(test, ed.doc.bed);
      return { doc, layer: () => layer, imgLayer: () => defaultImageLayer(), name: t('Testauftrag'), color: () => '#d04020' };
    };
    const field = (label: string, key: keyof TestJobOptions, title: string) => {
      const el = numInput('', (v) => v > 0 && (test[key] = v), title);
      el.value = String(test[key]);
      return [h('label', { title }, label), el];
    };
    const startSel = h('select', { onchange: (e: Event) => (patchDevice(ed, { startFrom: (e.target as HTMLSelectElement).value as StartFrom }), render()) },
      h('option', { value: 'absolute', selected: device.startFrom === 'absolute' }, t('Absolute Koordinaten')),
      h('option', { value: 'user', selected: device.startFrom === 'user' }, t('Benutzer-Ursprung')),
      h('option', { value: 'current', selected: device.startFrom === 'current' }, t('Aktuelle Position')),
    );
    const where: Record<StartFrom, string> = {
      absolute: t('Der Test liegt in der Mitte des Arbeitsbereichs (X {x}, Y {y} mm).', { x: ed.doc.bed.w / 2, y: ed.doc.bed.h / 2 }),
      user: t('Der Test wird relativ zum gesetzten Ursprung gelasert (Job-Ursprung wie im Fenster „Laser“).'),
      current: t('Der Test wird an der jetzigen Position des Laserkopfs gelasert (Job-Ursprung wie im Fenster „Laser“).'),
    };
    out.push(
      h('div', { class: 'form setup-form' },
        ...field(t('Größe (mm)'), 'size', t('Kantenlänge des Quadrats')),
        ...field(t('Leistung (%)'), 'power', t('Niedrig anfangen; erhöhen, wenn kaum etwas zu sehen ist')),
        ...field(t('Geschwindigkeit (mm/min)'), 'speed', t('Vorschub beim Lasern')),
        h('label', {}, t('Starten ab')), startSel,
      ),
      para(where[device.startFrom]),
      h('div', { class: 'conn-row' },
        h('button', { class: 'btn', title: t('Ablauf und Dauer ansehen'), onclick: () => openPreview(ed, source()) }, t('Vorschau')),
        connBtn(t('Rahmen abfahren'), () => frameJob(ed, false, source()), () => !runBlocker()),
      ),
    );
    const checks = [
      t('Material liegt flach unter dem Laser, der Fokus ist eingestellt.'),
      t('Ich habe den Rahmen abgefahren, der Test liegt auf dem Material.'),
      t('Schutzbrille oder Abdeckung ist da, die Absaugung läuft, nichts Brennbares liegt herum.'),
      t('Ich bleibe an der Maschine und weiß, wo „Stopp“ ist.'),
    ];
    const startBtn = h('button', {
      class: 'btn primary', onclick: async () => {
        if (!ready.every(Boolean) || !confirm(t('Testauftrag jetzt starten? Der Laser schaltet sich ein.'))) return;
        lastResult = '';
        await startJob(ed, source());
      },
    }, t('Testauftrag starten')) as HTMLButtonElement;
    const stopBtn = h('button', { class: 'btn', onclick: () => machine.stop() }, t('Stopp')) as HTMLButtonElement;
    const blocker = para('', 'note error');
    live.push(() => {
      const why = runBlocker();
      blocker.textContent = why ?? '';
      blocker.hidden = !why;
      startBtn.disabled = !!why || !ready.every(Boolean);
      stopBtn.disabled = !machine.connected;
    });
    out.push(
      h('div', { class: 'setup-release' },
        h('div', { class: 'title' }, t('Freigabe')),
        ...checks.map((label, i) =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ready[i], onchange: (e: Event) => ((ready[i] = (e.target as HTMLInputElement).checked), refreshLive()) }), label),
        ),
      ),
      blocker,
      h('div', { class: 'conn-row' }, startBtn, stopBtn),
    );
    if (lastResult) out.push(para(lastResult));
    return out;
  }

  const dlg = h('dialog', { class: 'setup-dialog' },
    h('div', { class: 'setup-head' },
      h('h3', {}, t('Laser einrichten')),
      h('button', { class: 'ib setup-close', title: t('Schließen'), onclick: () => dlg.close() }, '✕'),
    ),
    statusLine,
    h('div', { class: 'setup-main' }, nav, h('div', { class: 'setup-right' }, body, consoleBox)),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', title: t('Alle Einstellungen des Geräts'), onclick: () => openDeviceDialog(ed, device, () => render()) }, t('Erweiterte Einstellungen …')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
      backBtn,
      nextBtn,
    ),
  ) as HTMLDialogElement;
  openDlg = dlg;
  dlg.addEventListener('close', () => {
    offMachine();
    offDevice();
    openDlg = null;
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  render();
  dlg.showModal();
  if (machine.connected) go(1);
}
