// Verbindung zur Maschine (FluidNC/GRBL). Die eigentliche Kommunikation läuft im Rust-Kern (src-tauri/src/machine.rs);
// hier liegen Zustand, Statusauswertung und die Befehle für die Oberfläche.
import { Device, Firmware, FIRMWARES, PreparedGCode } from './gcode';
import type { RemoteJobInfo } from './remoteBundle';
import { t, tBackend } from './i18n';
import { configText, FluidFs, OVERRIDE, overrideSteps, parseConfigFile, runCmd } from './fluidnc';
import { parseFluidConfig } from './setup';

export const isTauri = () => '__TAURI_INTERNALS__' in window;

export interface MachineStatus {
  /** Idle, Run, Hold, Jog, Alarm, Door, Home, Check, Sleep */
  state: string;
  /** Maschinenposition */
  mpos: [number, number, number] | null;
  /** Werkstückposition (Maschinenposition minus Werkstück-Nullpunkt) */
  wpos: [number, number, number] | null;
  feed: number;
  power: number;
  /** Overrides in Prozent: Vorschub, Eilgang, Leistung (GRBL/FluidNC melden sie nur ab und zu, Ov:) */
  ov: [number, number, number] | null;
  /** Aktive Eingänge, z. B. „XP“ = Endschalter X und Taster (Pn:) */
  pins: string;
  /** Zubehör: S/C Laser an, F Flood, M Mist (A:) */
  acc: string;
  /** FluidNC: Job läuft von SD-Karte oder Flash (SD:Prozent,Datei) */
  sd: { pct: number; file: string } | null;
  /** Freie Plätze: Planer-Blöcke und Empfangspuffer in Bytes (Bf:), nur wenn die Steuerung es meldet */
  bf: [number, number] | null;
}

export const emptyStatus = (): MachineStatus => ({ state: '', mpos: null, wpos: null, feed: 0, power: 0, ov: null, pins: '', acc: '', sd: null, bf: null });

export interface Progress {
  sent: number;
  acked: number;
  total: number;
  errors: number;
}

export type MachineEvent =
  | { type: 'line'; line: string; dir: 'in' | 'out' | 'info' | 'error' }
  | { type: 'status' }
  | { type: 'connection' }
  | { type: 'progress' }
  | { type: 'done'; ok: boolean; message: string }
  /** FluidNC-Konfiguration wurde (neu) gelesen */
  | { type: 'config' };

/** Gelesene FluidNC-Konfiguration: Pfade (axes/x/max_travel_mm …), Text für Sicherungen, Dateiname */
export interface FluidConfig {
  values: Record<string, string>;
  text: string;
  file: string;
}

/** Steuerung mit FluidNC, gefunden bei der Suche im Netzwerk */
export interface FoundController {
  host: string;
  info: string;
}

export interface PortInfo {
  name: string;
  description: string;
}

/** Klartext für FluidNC-/GRBL-Alarme und häufige Fehler */
const ALARMS: Record<string, string> = {
  '1': t('Endschalter ausgelöst, Position unsicher. Neu referenzieren (Home).'),
  '2': t('Ziel außerhalb des Arbeitsbereichs (Soft-Limit).'),
  '3': t('Zurückgesetzt während der Bewegung, Position unsicher. Neu referenzieren.'),
  '4': t('Sonde nicht im erwarteten Zustand.'),
  '5': t('Sonde hat nicht ausgelöst.'),
  '6': t('Referenzfahrt abgebrochen.'),
  '7': t('Referenzfahrt: Tür geöffnet.'),
  '8': t('Referenzfahrt: Endschalter nicht freigefahren.'),
  '9': t('Referenzfahrt: Endschalter nicht gefunden.'),
  '10': t('Referenzfahrt: Endschalter doppelt ausgelöst.'),
};
const ERRORS: Record<string, string> = {
  '1': t('Befehl ohne Buchstaben'),
  '2': t('Zahl fehlt oder ist ungültig'),
  '3': t('Unbekannter $-Befehl'),
  '9': t('Gesperrt (Alarm). Mit $X entsperren oder Home fahren.'),
  '15': t('Fahrweg außerhalb des Arbeitsbereichs'),
  '20': t('Nicht unterstützter G-Code-Befehl'),
  '22': t('Vorschub fehlt'),
  '24': t('Zwei G-Code-Befehle derselben Gruppe in einer Zeile'),
  '33': t('Ziel ungültig'),
};

export function explain(line: string): string | null {
  let m = /^ALARM:(\d+)/i.exec(line);
  if (m) return ALARMS[m[1]] ?? null;
  m = /^error:(\d+)/i.exec(line);
  if (m) return ERRORS[m[1]] ?? null;
  return null;
}

/** Werkstück-Nullpunkt in Maschinenkoordinaten; known = von der Steuerung gemeldet (WCO oder MPos und WPos zugleich) */
export interface WorkOffset {
  v: [number, number, number];
  known: boolean;
}

/** Statusbericht auswerten, z. B. <Idle|MPos:1.000,2.000,0.000|FS:0,0|WCO:0.000,0.000,0.000> */
export function parseStatus(line: string, prev: MachineStatus, wco: WorkOffset): MachineStatus {
  const body = line.replace(/^<|>$/g, '').split('|');
  // Pn, A und SD fehlen, wenn nichts aktiv ist; Ov und Bf bleiben bis zur nächsten Meldung
  const st: MachineStatus = { ...prev, state: body[0].split(':')[0], pins: '', acc: '', sd: null };
  const vec = (s: string) => {
    const v = s.split(',').map(Number);
    return [v[0] || 0, v[1] || 0, v[2] || 0] as [number, number, number];
  };
  let mpos: [number, number, number] | null = null,
    wpos: [number, number, number] | null = null;
  for (const f of body.slice(1)) {
    const [k, v] = f.split(':');
    if (k === 'MPos') mpos = vec(v);
    else if (k === 'WPos') wpos = vec(v);
    else if (k === 'WCO') {
      wco.v = vec(v);
      wco.known = true;
    } else if (k === 'FS' || k === 'F') {
      const p = v.split(',').map(Number);
      st.feed = p[0] || 0;
      st.power = p[1] || 0;
    } else if (k === 'Ov') {
      const p = v.split(',').map(Number);
      st.ov = [p[0] || 100, p[1] || 100, p[2] || 100];
    } else if (k === 'Pn') st.pins = v;
    else if (k === 'A') st.acc = v;
    else if (k === 'Bf') {
      const p = v.split(',').map(Number);
      st.bf = [p[0] || 0, p[1] || 0];
    } else if (k === 'SD') {
      // Dateiname kann Kommas und Doppelpunkte enthalten: nur am ersten Komma trennen
      const rest = f.slice(3);
      const i = rest.indexOf(',');
      st.sd = { pct: Number(i < 0 ? rest : rest.slice(0, i)) || 0, file: i < 0 ? '' : rest.slice(i + 1) };
    }
  }
  const o = wco.v;
  if (mpos && wpos) {
    // z. B. Smoothieware meldet beide: daraus ergibt sich der Nullpunkt
    st.mpos = mpos;
    st.wpos = wpos;
    wco.v = [mpos[0] - wpos[0], mpos[1] - wpos[1], mpos[2] - wpos[2]];
    wco.known = true;
  } else if (mpos) {
    st.mpos = mpos;
    st.wpos = [mpos[0] - o[0], mpos[1] - o[1], mpos[2] - o[2]];
  } else if (wpos) {
    st.wpos = wpos;
    st.mpos = [wpos[0] + o[0], wpos[1] + o[1], wpos[2] + o[2]];
  }
  return st;
}

/**
 * Deckt diese Zeile eine Referenzfahrt mit Z-Abdeckung ab? GRBL-Familie nur `$H`/`$HZ`
 * (`G28` fährt dort bloß eine gespeicherte Position an, referenziert nicht);
 * Marlin/Smoothie: `G28` ohne Achsbuchstaben oder mit `Z` (Kommentare zählen nicht).
 */
export function homesZ(fw: Firmware, line: string): boolean {
  const t = line.trim();
  if (fw === 'fluidnc' || fw === 'grbl' || fw === 'grblhal') return /^\$H(Z)?$/i.test(t);
  if (!/^G28(?=\s|$)/i.test(t)) return false;
  const code = t.slice(3).split(';')[0].replace(/\(.*?\)/g, '');
  return !/[XYZ]/i.test(code) || /Z/i.test(code);
}

/**
 * Position nach dieser Controller-Meldung als verloren werten: `ALARM` oder Boot-Banner
 * (Anker `^`, damit `$I`-/`M115`-Antworten nicht zurücksetzen). Marlin meldet Neustart nur mit `start`.
 */
export function losesPosition(line: string): boolean {
  const t = line.trim();
  return /^ALARM/i.test(t) || /^Grbl\s+[\w.]+/i.test(t) || /^FluidNC\s+v?[\w.\-]+/i.test(t) || /^start$/i.test(t);
}

type Unlisten = () => void;

/** State of a remote host as its clients see it (sent by remoteHost.ts) */
export interface RemoteHostState {
  machine: { connected: boolean; where: string; device: string; fw: Firmware; bedW: number; bedH: number; running: boolean };
  progress: Progress | null;
  jobs: RemoteJobInfo[];
  /** Host asks before a remote job starts */
  confirm: boolean;
}

/** Connection through another KizamuBeam (Device.conn = 'remote') */
export interface RemoteLink {
  role: 'viewer' | 'operator';
  /** Name of the host computer */
  host: string;
  state: RemoteHostState | null;
}

/** Commands of the machine boundary and their names on a remote host */
const REMOTE_METHOD: Record<string, string> = {
  machine_send: 'line',
  machine_realtime: 'realtime',
  machine_pause: 'pause',
  machine_resume: 'resume',
  machine_stop: 'stop',
};

class Machine {
  connected = false;
  connecting = false;
  /** Referenzfahrt mit Z-Abdeckung in dieser Verbindung ausgeführt (für strengen Z-Jog) */
  homed = false;
  /** Beschreibung der Verbindung, z. B. „COM3“ oder „fluidnc.local:23“ */
  where = '';
  status: MachineStatus = emptyStatus();
  progress: Progress | null = null;
  /** Geschätzte Zeiten je Zeile des laufenden Jobs */
  jobTimes: Float64Array | null = null;
  jobStarted = 0;
  /** Laufender Auftrag ist eine Rahmenfahrt (keine Fortschrittsanzeige) */
  jobIsFrame = false;
  private wco: WorkOffset = { v: [0, 0, 0], known: false };
  /** Firmware der aktuellen Verbindung */
  fw = FIRMWARES.fluidnc;
  /** Firmware-Schlüssel zu `fw` (für protokollabhängige Erkennung, z. B. Referenzfahrt) */
  fwId: Firmware = 'fluidnc';
  /** Konfiguration der verbundenen FluidNC-Steuerung (nach dem Verbinden still gelesen); null = unbekannt */
  fluid: FluidConfig | null = null;
  /** Job, der auf der Steuerung von SD-Karte oder Flash läuft (FluidNC meldet SD: im Status) */
  storedJob: { file: string; started: number; seen: boolean; aborted?: boolean } | null = null;
  /** Set while connected through another KizamuBeam; then the host runs the laser */
  remote: RemoteLink | null = null;
  private listeners = new Set<(e: MachineEvent) => void>();
  /** Läuft gerade eine Abfrage (query), gehen die Antworten an sie; quiet = nicht in die Konsole */
  private capture: { fn: (line: string) => void; quiet: boolean } | null = null;
  private queryChain: Promise<unknown> = Promise.resolve();
  private unlisten: Unlisten[] = [];

  on(fn: (e: MachineEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: MachineEvent) {
    this.listeners.forEach((f) => f(e));
  }
  log(line: string, dir: 'in' | 'out' | 'info' | 'error' = 'info') {
    this.emit({ type: 'line', line, dir });
  }

  get busy() {
    return !!this.progress;
  }

  /** Ein Job läuft, gesendet von hier oder von SD-Karte/Flash der Steuerung (or on the remote host) */
  get running() {
    return !!this.progress || !!this.storedJob || !!this.remote?.state?.machine.running;
  }

  /** Command of the machine boundary, or the same request to the remote host */
  private async call(cmd: string, args: Record<string, unknown> = {}) {
    const { invoke } = await import('@tauri-apps/api/core');
    if (!this.remote) return invoke(cmd, args);
    const method = REMOTE_METHOD[cmd];
    if (!method) throw new Error(t('Über einen anderen KizamuBeam nicht möglich.'));
    return invoke('remote_request', { method, params: args });
  }

  /** Request to the remote host (job_submit, job_start, frame, jobs …) */
  async remoteRequest<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.remote) throw new Error(t('Nicht verbunden.'));
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke<T>('remote_request', { method, params });
    } catch (e) {
      throw new Error(tBackend(String(e)));
    }
  }

  /** Apply the host's state: firmware for commands, running job */
  private applyRemoteState() {
    const st = this.remote?.state;
    if (!st) return;
    this.fw = FIRMWARES[st.machine.fw] ?? FIRMWARES.fluidnc;
    this.fwId = st.machine.fw;
    if (st.progress && !this.progress) this.progress = st.progress;
    if (!st.machine.running && this.progress && !st.progress) {
      this.progress = null;
      this.jobTimes = null;
      this.jobIsFrame = false;
    }
  }

  private onRemoteEvent(e: string, d: unknown) {
    const link = this.remote;
    if (!link) return;
    if (e === 'state') {
      link.state = d as RemoteHostState;
      this.applyRemoteState();
      this.emit({ type: 'progress' });
      this.emit({ type: 'connection' });
    } else if (e === 'role') {
      link.role = d === 'viewer' ? 'viewer' : 'operator';
      this.log(link.role === 'viewer' ? t('Der Host hat diesem Rechner die Rolle „Zuschauer“ gegeben.') : t('Der Host hat diesem Rechner die Rolle „Bediener“ gegeben.'));
      this.emit({ type: 'connection' });
    } else if (e === 'machine_closed') {
      this.log(t('Der Host hat die Verbindung zum Laser verloren.') + (d ? ` ${tBackend(String(d))}` : ''), 'error');
    } else if (e === 'notice') {
      this.log(String(d));
    } else if (e === 'error') {
      this.log(tBackend(String(d)), 'error');
    }
  }

  async ports(): Promise<PortInfo[]> {
    if (!isTauri()) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<PortInfo[]>('machine_ports');
  }

  private async listen() {
    if (this.unlisten.length) return;
    const { listen } = await import('@tauri-apps/api/event');
    this.unlisten.push(
      await listen<string>('machine-line', (e) => this.onLine(e.payload)),
      await listen<Progress>('machine-progress', (e) => {
        this.progress = e.payload;
        this.emit({ type: 'progress' });
      }),
      await listen<{ ok: boolean; message: string }>('machine-done', (e) => {
        const frame = this.jobIsFrame;
        this.progress = null;
        this.jobTimes = null;
        this.jobIsFrame = false;
        this.emit({ type: 'progress' });
        if (!frame || !e.payload.ok) this.emit({ type: 'done', ok: e.payload.ok, message: tBackend(e.payload.message) });
      }),
      await listen<{ e: string; d: unknown }>('remote-event', (e) => this.onRemoteEvent(e.payload.e, e.payload.d)),
      await listen<string>('machine-closed', (e) => {
        this.connected = false;
        this.remote = null;
        this.progress = null;
        this.fluid = null;
        this.storedJob = null;
        this.status = emptyStatus();
        if (e.payload) this.log(tBackend(e.payload), 'error');
        this.log(t('Verbindung getrennt.'));
        this.emit({ type: 'connection' });
      }),
    );
  }

  private onLine(line: string) {
    // Marlin: Antwort auf M114 („X:10.00 Y:20.00 Z:0.00 E:0.00 Count …“)
    const m114 = /^X:(-?[\d.]+)\s*Y:(-?[\d.]+)(?:\s*Z:(-?[\d.]+))?/.exec(line);
    if (m114) {
      const p: [number, number, number] = [+m114[1], +m114[2], +(m114[3] ?? 0)];
      // M114 meldet Werkstückkoordinaten; einen G92-Versatz verrät Marlin nicht (wco bleibt unbekannt)
      this.status = { ...this.status, mpos: p, wpos: p };
      this.emit({ type: 'status' });
      return;
    }
    if (line.startsWith('<')) {
      this.status = parseStatus(line, this.status, this.wco);
      // Alarm heißt Positionsverlust (auch nach $X-Entsperrung neu referenzieren)
      if (this.status.state.startsWith('Alarm')) this.homed = false;
      this.trackStoredJob();
      this.emit({ type: 'status' });
      return;
    }
    if (this.capture) {
      this.capture.fn(line);
      if (this.capture.quiet) return;
    }
    const isErr = /^(error|alarm)/i.test(line);
    // Alarm oder Controller-Neustart: Referenz ist verloren (wird beim nächsten Homing neu gesetzt)
    if (losesPosition(line)) this.homed = false;
    const why = explain(line);
    this.log(why ? `${line}  (${why})` : line, isErr ? 'error' : 'in');
  }

  /** Verbinden; `home` = danach referenzieren (Standard: Einstellung des Geräts) */
  async connect(d: Device, home = d.homeOnConnect) {
    if (!isTauri()) {
      this.log(t('Die Maschinenanbindung gibt es nur in der Desktop-App.'), 'error');
      return;
    }
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.wco = { v: [0, 0, 0], known: false };
    this.homed = false;
    this.emit({ type: 'connection' });
    try {
      await this.listen();
      const { invoke } = await import('@tauri-apps/api/core');
      if (d.conn === 'remote') return await this.connectRemote(d);
      const netPort = d.conn === 'ws' ? d.wsPort : d.tcpPort;
      const where = d.conn === 'serial' ? d.port : `${d.conn === 'ws' ? 'ws://' : ''}${d.host}:${netPort}`;
      this.log(t('Verbinde mit {where} …', { where }));
      const fw = FIRMWARES[d.fw];
      this.fw = fw;
      this.fwId = d.fw;
      await invoke('machine_connect', {
        kind: d.conn, port: d.port, baud: d.baud, host: d.host, tcpPort: netPort,
        sync: fw.sync, realtime: fw.realtime, poll: fw.poll, rxBuffer: d.rxBuffer || 127,
      });
      this.connected = true;
      this.where = where;
      this.log(t('Verbunden mit {where}.', { where }));
      // Ohne Endschalter nie referenzieren, die Achsen würden bis zum Anschlag fahren
      if (home && d.limitSwitches !== 'no') await this.send(fw.home);
      // FluidNC: Konfiguration im Hintergrund lesen (Kühlmittel, Ausgänge, Dateiname)
      if (fw.read === 'fluidnc') this.readFluidConfig().catch(() => {});
    } catch (e) {
      this.log(t('Verbindung fehlgeschlagen: {error}', { error: tBackend(String(e)) }), 'error');
    } finally {
      this.connecting = false;
      this.emit({ type: 'connection' });
    }
  }

  /** Connect through another KizamuBeam (host); it computes and runs the jobs */
  private async connectRemote(d: Device) {
    const { invoke } = await import('@tauri-apps/api/core');
    const addr = `${d.host}:${d.remotePort}`;
    if (!d.remoteFp) throw new Error(t('Dieser Rechner ist mit dem Host noch nicht gekoppelt. Erst in den Geräteeinstellungen koppeln.'));
    this.log(t('Verbinde mit {where} …', { where: addr }));
    const name = await invoke<string>('sync_machine_name').catch(() => '');
    const w = await invoke<{ role: string; host: string; state: RemoteHostState | null }>('remote_connect', { host: d.host, port: d.remotePort, fingerprint: d.remoteFp, name });
    const hasState = w.state && typeof w.state === 'object' && 'machine' in w.state;
    this.remote = { role: w.role === 'viewer' ? 'viewer' : 'operator', host: w.host, state: hasState ? w.state : null };
    this.applyRemoteState();
    this.connected = true;
    this.where = `${w.host} (${addr})`;
    this.log(t('Verbunden mit {where}.', { where: this.where }));
    if (this.remote.role === 'viewer') this.log(t('Nur zuschauen: Der Host hat diesem Rechner die Rolle „Zuschauer“ gegeben.'));
    if (this.remote.state && !this.remote.state.machine.connected) this.log(t('Der Host ist gerade nicht mit dem Laser verbunden.'), 'error');
    // The host computes jobs with its own device; a different work area here makes the preview misleading
    const hm = this.remote.state?.machine;
    if (hm && (hm.bedW !== d.bedW || hm.bedH !== d.bedH || hm.fw !== d.fw))
      this.log(t('Der Host arbeitet mit „{device}“ ({w} × {h} mm), dieses Gerät mit {lw} × {lh} mm. Laser → Fernsteuerung → Vom Host übernehmen gleicht es an.',
        { device: hm.device, w: hm.bedW, h: hm.bedH, lw: d.bedW, lh: d.bedH }));
  }

  async disconnect() {
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(this.remote ? 'remote_disconnect' : 'machine_disconnect');
  }

  /** Werkstück-Nullpunkt (X, Y) in Maschinenkoordinaten, wie ihn die Steuerung zuletzt gemeldet hat; null = unbekannt */
  workOffset(): { x: number; y: number } | null {
    return this.connected && this.wco.known ? { x: this.wco.v[0], y: this.wco.v[1] } : null;
  }

  /** Eine Zeile senden (Konsole, Bewegen, Home …). Wird abgelehnt, solange ein Job läuft. */
  async send(line: string, quiet = false) {
    if (!this.connected) return this.log(t('Nicht verbunden.'), 'error');
    if (!quiet) this.log(line, 'out');
    // Nullpunkt oder Koordinatensystem ändert sich: bis zur nächsten Meldung der Steuerung gilt er als unbekannt
    if (/G\s*(10|92|5[4-9])\b/i.test(line)) this.wco.known = false;
    try {
      await this.call('machine_send', { line });
      // Referenzfahrt merken — schon beim Senden: Scheitern landet nie in Idle, das Z-Gate bleibt dann zu.
      if (homesZ(this.fwId, line)) this.homed = true;
    } catch (e) {
      this.log(tBackend(String(e)), 'error');
    }
  }

  /**
   * Befehle senden und die Antworten sammeln, bis jede Zeile mit ok/error beantwortet ist oder die Zeit abläuft.
   * quiet = Antworten nicht in die Konsole schreiben (z. B. die lange Ausgabe von $CD). Abfragen laufen nacheinander.
   */
  query(cmds: string[], ms = 2500, quiet = false): Promise<string[]> {
    const run = () =>
      new Promise<string[]>((resolve) => {
        const got: string[] = [];
        let answered = 0;
        let timer = 0;
        const done = () => {
          this.capture = null;
          clearTimeout(timer);
          resolve(got);
        };
        this.capture = {
          quiet,
          fn: (line) => {
            got.push(line);
            if (/^(ok|error)\b/i.test(line) && ++answered >= cmds.length) {
              clearTimeout(timer);
              timer = window.setTimeout(done, 150);
            }
          },
        };
        timer = window.setTimeout(done, ms);
        if (!this.connected) return done();
        (async () => {
          for (const c of cmds) await this.send(c, quiet);
        })();
      });
    const p = this.queryChain.then(run, run);
    this.queryChain = p.catch(() => {});
    return p;
  }

  /** FluidNC-Konfiguration ($CD) und ihren Dateinamen lesen */
  async readFluidConfig(): Promise<FluidConfig | null> {
    if (!this.connected || this.busy || this.remote) return this.fluid;
    const lines = await this.query(['$CD'], 6000, true);
    const values = parseFluidConfig(lines);
    if (!Object.keys(values).length) return this.fluid;
    const file = parseConfigFile(await this.query(['$Config/Filename'], 2000, true)) ?? this.fluid?.file ?? 'config.yaml';
    this.fluid = { values, text: configText(lines), file };
    this.emit({ type: 'config' });
    return this.fluid;
  }

  /** Override auf einen Prozentwert bringen (Vorschub oder Laserleistung, 10 … 200 %) */
  async setOverride(kind: keyof typeof OVERRIDE, pct: number) {
    const ov = this.status.ov;
    const cur = ov ? (kind === 'feed' ? ov[0] : ov[2]) : NaN;
    for (const b of overrideSteps(kind, cur, pct)) await this.realtime(b);
  }

  /** Datei auf SD-Karte oder Flash starten; Fortschritt kommt über den Statusbericht (SD:) */
  async runStored(fs: FluidFs, name: string) {
    if (!this.connected) return this.log(t('Nicht verbunden.'), 'error');
    if (this.running) return this.log(t('Es läuft bereits ein Auftrag.'), 'error');
    this.storedJob = { file: name, started: performance.now(), seen: false };
    this.emit({ type: 'progress' });
    await this.send(runCmd(fs, name));
  }

  /** Läuft ein Job von SD/Flash an, ist er im Status zu sehen; verschwindet er wieder, ist er zu Ende */
  private trackStoredJob() {
    const j = this.storedJob;
    if (!j) return;
    if (this.status.sd) {
      j.seen = true;
      return;
    }
    const alarm = this.status.state.startsWith('Alarm');
    // Startet die Datei nicht (z. B. nicht gefunden), meldet die Steuerung nie SD:; nach 5 s aufgeben
    if (!j.seen && !alarm && performance.now() - j.started < 5000) return;
    if (this.status.state === 'Run' || this.status.state.startsWith('Hold')) return;
    this.storedJob = null;
    this.emit({ type: 'progress' });
    const secs = Math.round((performance.now() - j.started) / 1000);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (j.aborted) this.emit({ type: 'done', ok: false, message: t('Abgebrochen') });
    else if (!j.seen) this.emit({ type: 'done', ok: false, message: t('Die Steuerung hat {file} nicht gestartet. Details stehen in der Konsole.', { file: j.file }) });
    else if (alarm) this.emit({ type: 'done', ok: false, message: t('Alarm, Job abgebrochen') });
    else this.emit({ type: 'done', ok: true, message: t('Fertig nach {time} min', { time }) });
  }

  /** G-Code auf die Steuerung hochladen (Weboberfläche von FluidNC); liefert die Größe in Bytes */
  async upload(d: Device, fs: FluidFs, name: string, g: PreparedGCode, onProgress?: (sent: number, total: number) => void): Promise<number> {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    const off = await listen<{ sent: number; total: number }>('fluid-upload-progress', (e) => onProgress?.(e.payload.sent, e.payload.total));
    try {
      return await invoke<number>('fluid_upload', { host: d.host, port: d.httpPort || 80, fs, name, id: g.lines ? null : g.id, lines: g.lines });
    } catch (e) {
      throw new Error(tBackend(String(e)));
    } finally {
      off();
    }
  }

  /** FluidNC-Steuerungen im lokalen Netz suchen (fluidnc.local und das eigene /24-Netz) */
  async discover(httpPort = 80): Promise<FoundController[]> {
    if (!isTauri()) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<FoundController[]>('fluid_discover', { port: httpPort });
  }

  /** Echtzeitbefehl: ? Status, ! Halt, ~ Weiter, 0x18 Reset, 0x85 Jog abbrechen, 0x90 … Overrides */
  async realtime(byte: number) {
    if (!this.connected) return;
    try {
      await this.call('machine_realtime', { byte });
    } catch (e) {
      this.log(tBackend(String(e)), 'error');
    }
  }

  /** Auftrag senden: fertige Zeilen oder G-Code, den der Rust-Kern schon vorbereitet hat (prepareGCode) */
  async runJob(lines: string[], times: Float64Array | null, frame = false) {
    return this.startJob(lines.length, times, frame, { cmd: 'machine_job', args: { lines } });
  }
  async runPrepared(g: PreparedGCode) {
    if (g.lines) return this.runJob(g.lines, g.times);
    return this.startJob(g.count, g.times, false, { cmd: 'machine_job_prepared', args: { id: g.id } });
  }
  /** true, wenn der Auftrag angenommen wurde */
  private async startJob(total: number, times: Float64Array | null, frame: boolean, call: { cmd: string; args: Record<string, unknown> }): Promise<boolean> {
    if (!this.connected) return this.log(t('Nicht verbunden.'), 'error'), false;
    if (this.busy) return this.log(t('Es läuft bereits ein Auftrag.'), 'error'), false;
    if (this.remote) return this.log(t('Über einen anderen KizamuBeam laufen nur Aufträge, die der Host selbst berechnet (Start, Rahmen, Material- und Fokustest).'), 'error'), false;
    const { invoke } = await import('@tauri-apps/api/core');
    this.jobTimes = times;
    this.jobIsFrame = frame;
    this.jobStarted = performance.now();
    this.progress = { sent: 0, acked: 0, total, errors: 0 };
    this.emit({ type: 'progress' });
    try {
      await invoke(call.cmd, call.args);
    } catch (e) {
      this.progress = null;
      this.jobTimes = null;
      this.emit({ type: 'progress' });
      this.log(tBackend(String(e)), 'error');
      return false;
    }
    return true;
  }

  /** Anhalten: GRBL-Familie per Echtzeitbefehl !, Marlin durch Zurückhalten weiterer Zeilen (im Rust-Kern) */
  async pause() {
    if (!this.connected) return;
    await this.call('machine_pause').catch((e) => this.log(tBackend(String(e)), 'error'));
  }
  async resume() {
    if (!this.connected) return;
    await this.call('machine_resume').catch((e) => this.log(tBackend(String(e)), 'error'));
  }
  async stop() {
    if (!this.connected) return;
    // Ein Job von SD/Flash endet mit dem Reset; Meldung kommt über den Status
    if (this.storedJob) ((this.storedJob.seen = true), (this.storedJob.aborted = true));
    try {
      await this.call('machine_stop');
    } catch (e) {
      return this.log(tBackend(String(e)), 'error');
    }
    this.log(t('Gestoppt.'), 'info');
  }

  /** Geschätzte Restzeit des laufenden Jobs in Sekunden */
  remaining(): number | null {
    const p = this.progress,
      t = this.jobTimes;
    if (!p || !t || !t.length) return null;
    const i = Math.min(t.length - 1, Math.max(0, p.acked - 1));
    return Math.max(0, t[t.length - 1] - (p.acked ? t[i] : 0));
  }
}

export const machine = new Machine();
