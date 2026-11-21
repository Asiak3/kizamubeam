// Laser-Panel (Laser, Verschieben, Konsole), Geräteeinstellungen, Vorschau und G-Code-Ausgabe.
import type { Editor } from './editor';
import { commandMatches } from './commandKeys';
import { escapeXml, h, numInput, setIcon, setTrustedSvg } from './dom';
import { saveBinary, saveText } from './files';
import { native } from './native';
import {
  anchorOf, BedCheck, Box, buildJob, burns, checkBed, DEFAULT_DEVICE, DEFAULT_ROTARY, Device, DirOrder, effOrderOf, estimate, Firmware, FinishMode, FIRMWARES, liveStatus, formatDuration, frameGCode, isManualOrder, Job, jogHoldLines, jogHoldSupported, jogLines, jogToLines, LASER_TYPES, moveLines, LaserModule, LaserType, loadDevices, Moves, newDevice, OrderOpts, OrderOverride,
  posShift, prepareGCode, Rotary, RotaryAxis, rotaryCirc, rotaryOn, rotaryTestLines, RuidaLaser, RuidaMagic, RuidaOrigin, sameMoves, sanitizeRuidaFilename, saveDevices, StartFrom, startHere, zJogLines,
} from './gcode';
import { isTauri, machine, PortInfo } from './machine';
import type { PreparedGCode } from './gcode';
import { airProblem, digitalOutputs, FluidFs, listCmd, outputCmd, OVERRIDE, parseFileList, pinNames, RAPID_OVERRIDE, TOGGLE_FLOOD, TOGGLE_MIST } from './fluidnc';
import type { Doc, ImageLayer, Layer, Obj } from './model';
import { cutOrderGroupOverride } from './lbrn';
import { forgetHost, openHostDiscovery, openPairDialog, pairedHost, remoteFrame, remoteJob } from './remote';
import { materialTab } from './materialui';
import { cameraTab } from './cameraui';
import { dockWindow, isShown, windowBody } from './dock';
import { loadCheckSettings } from './check';
import { loadCutSelectedDefault, loadJobOriginDefault } from './editor/document';
import { openCheck } from './checkPanel';
import { presetList } from './packs';
import { laserTypeLabel, presetPicker } from './packsDialog';
import { dec, locale, t, tBackend, tn } from './i18n';
import { getTypography, groupFactor, onTypographyChange, resolveTypography } from './uiTypography';
import { isNightly } from './updates';
import { version as APP_VERSION } from '../package.json';
import { electricityTariffText, energyDraft, estimateEnergy, parseEnergyNumber } from './energy';
import { energyPreview, energySettingsRows, saveEnergySettings } from './energyUi';
import { previewSplitter } from './previewLayout';
import { advancePlayback, analyzePlayback, computeFactors, DEFAULT_TARGET, MAX_MARKERS, MAX_TARGET, MIN_TARGET } from './previewPlayback';
import type { PlaybackSettings } from './previewPlayback';
import { fireLockMessage } from './fire';
import { fireControls, fireSettings, installFireOverlay } from './fireUi';

const store = loadDevices();
/** Das gewählte Gerät (live gebunden: wechselt mit der Auswahl) */
export let device: Device = store.devices.find((d) => d.id === store.current) ?? store.devices[0];
const deviceListeners = new Set<() => void>();
export function deviceChanged() {
  if (machine.fire.locked && machine.fire.state !== 'unknown') void machine.fire.stop();
  saveDevices(store);
  deviceListeners.forEach((f) => f());
}
/** Wird bei jedem Geräte- oder Einstellungswechsel aufgerufen; liefert eine Abmeldefunktion */
export const onDeviceChange = (f: () => void) => (deviceListeners.add(f), () => deviceListeners.delete(f));
/** Job-Overrides der Schnittreihenfolge (V3, #153): null = Geräte-Preset; sitzungsweit pro Job, nicht gespeichert */
const jobOrder: OrderOverride = { innerFirst: null, travel: null, group: null, cornerStart: null };
/** Effektive Schalter: Override oder Geräte-Preset — eine Stelle für Job, Prüfung (manualOrder) und Anzeige */
export const effOrder = (): OrderOpts => effOrderOf(device, jobOrder);
/** Overrides verwerfen: die nächsten Jobs folgen wieder dem Geräte-Preset */
export const resetJobOrder = () => {
  jobOrder.innerFirst = jobOrder.travel = jobOrder.group = jobOrder.cornerStart = null;
  deviceChanged();
};
/**
 * CutOrder aus einer LightBurn-Datei für diesen Job übernehmen (#153-Nr.3): nur der
 * Gruppen-Schalter ist mappbar (Ebenen laufen ohnehin in Prioritäts-Reihenfolge). Null-if-equal
 * wie die Checkboxen (Preset-gleich → kein Override, kein Reset-Button). Panel-Refresh über
 * deviceChanged; Rückgängig per resetJobOrder („Zurück zum Preset“). Sitzungsweit (V3-Semantik):
 * ein früherer Import überlebt bis zum nächsten Override/Reset.
 */
export function applyImportedCutOrder(co: { byGroup?: number } | undefined) {
  const g = cutOrderGroupOverride(co);
  jobOrder.group = g === null || g === device.optGroup ? null : g;
  deviceChanged();
}
const fw = () => FIRMWARES[device.fw];
const sendAll = (lines: string[]) => {
  for (const l of lines) machine.send(l);
};

// Die Klickfahrt teilen sich das Verschieben-Tab und der Toolbar-Knopf (linke Leiste,
// LightBurn-Vorbild): ein Zustand je Editor, die Geschwindigkeit liefert das Verschieben-Tab.
const posPickSpeed = new WeakMap<Editor, () => number>();
const posPickActive = new WeakSet<Editor>();
const posPickListeners = new WeakMap<Editor, Set<() => void>>();
function emitPosPick(ed: Editor) {
  posPickListeners.get(ed)?.forEach((f) => f());
  ed.emit('tool');
}
/** Klickfahrt-Ziel anfahren: je nach Zeiger-Modus landet Rotpunkt oder Werkzeug am Ziel. */
export function positionGoTo(ed: Editor, p: { x: number; y: number }) {
  if (!machine.connected) return notify(t('Nicht verbunden.'), true);
  if (machine.running) return notify(t('Während eines Jobs nicht möglich.'), true);
  const bed = ed.doc.bed;
  if (p.x < 0 || p.y < 0 || p.x > bed.w || p.y > bed.h) return notify(t('Die Position liegt außerhalb des Arbeitsbereichs.'), true);
  // Werkstückkoordinaten wie die Laserkopf-Anzeige (y nach oben); mit Drehachse nur X.
  // Ob der Kopf das Ziel erreicht, meldet die Steuerung (der Zeiger reicht ggf. über den Kopf-Fahrweg hinaus).
  const po = posShift(device);
  const tx = p.x - po.x, ty = rotaryOn(device) ? null : bed.h - p.y - po.y;
  const f = posPickSpeed.get(ed)?.() ?? 3000;
  for (const l of jogToLines(device, tx, ty, f)) machine.send(l);
}
/** Klickfahrt umschalten (Verschieben-Tab und Toolbar nutzen denselben Zustand) */
export function togglePositionPick(ed: Editor) {
  if (posPickActive.has(ed) && ed.pickHandler) return ed.endPick();
  posPickActive.add(ed);
  ed.startPick(
    (p) => positionGoTo(ed, p),
    () => {
      posPickActive.delete(ed);
      emitPosPick(ed);
    },
    t('Klick auf die Arbeitsfläche fährt den Laser dorthin. Esc beendet.'),
  );
  emitPosPick(ed);
  if (rotaryOn(device)) notify(t('Mit Drehachse fährt der Klick nur in X.'));
}
/** Läuft die Klickfahrt für diesen Editor? (Toolbar- und Button-Zustand) */
export const isPositionPick = (ed: Editor) => posPickActive.has(ed) && !!ed.pickHandler;
/** Startmodus des gewählten Geräts ändern (z. B. Print and Cut braucht absolute Koordinaten) */
export function setStartFrom(v: StartFrom) {
  device.startFrom = v;
  deviceChanged();
}

/** Arbeitsfläche an das Bett des gewählten Geräts anpassen */
function applyBed(ed: Editor) {
  if (ed.doc.bed.w === device.bedW && ed.doc.bed.h === device.bedH) return;
  ed.doc.bed.w = device.bedW;
  ed.doc.bed.h = device.bedH;
  ed.emit('doc');
  ed.zoomPage();
}

export function selectDevice(ed: Editor, id: string) {
  if (deviceEditBlocked()) return;
  const d = store.devices.find((x) => x.id === id);
  if (!d || d === device) return;
  if (machine.connected || machine.connecting) {
    notify(t('Zum Wechseln des Geräts erst die Verbindung trennen.'), true);
    deviceChanged();
    return;
  }
  device = d;
  store.current = id;
  applyBed(ed);
  deviceChanged();
}

/** Einstellungen des gewählten Geräts ändern und speichern (Assistent „Laser einrichten“) */
export function patchDevice(ed: Editor, patch: Partial<Device>) {
  if (deviceEditBlocked()) return;
  Object.assign(device, patch);
  applyBed(ed);
  deviceChanged();
}

/**
 * Dateiwerte für Nur-Auswahl/Ursprung aufs Gerät übernehmen (pro Datei gespeichert,
 * Stand aus dem geöffneten Dokument). Fehlt der Wert (alte Datei), bleibt das Gerät.
 */
export function applyDocJobSettings(ed: Editor) {
  if (deviceEditBlocked()) return;
  const d = ed.doc;
  let touched = false;
  if (typeof d.cutSelected === 'boolean' && device.cutSelected !== d.cutSelected) { device.cutSelected = d.cutSelected; touched = true; }
  if (Number.isInteger(d.jobOrigin) && (d.jobOrigin as number) >= 0 && (d.jobOrigin as number) <= 8 && device.jobOrigin !== d.jobOrigin) {
    device.jobOrigin = d.jobOrigin as number; touched = true;
  }
  if (touched) deviceChanged();
}

/** Neue Datei: Gerät auf die Standardwerte aus den Einstellungen setzen (passiert sonst nichts) */
export function applyNewDocDefaults() {
  if (deviceEditBlocked()) return;
  const cut = loadCutSelectedDefault(), origin = loadJobOriginDefault();
  let touched = false;
  if (device.cutSelected !== cut) { device.cutSelected = cut; touched = true; }
  if (origin !== null && device.jobOrigin !== origin) { device.jobOrigin = origin; touched = true; }
  if (touched) deviceChanged();
}

/** Neues Gerät anlegen und auswählen */
export function addDevice(ed: Editor, d: Device) {
  if (deviceEditBlocked()) return;
  store.devices.push(d);
  deviceChanged();
  selectDevice(ed, d.id);
}

/** Kurze Meldung im Laser-Panel (und in der Konsole) */
let notify: (msg: string, error?: boolean) => void = (m) => machine.log(m);
/** Meldung im Laser-Panel, auch für Aktionen von KI-Agenten */
export const laserNotify = (msg: string, error = false) => notify(msg, error);

// ---------- Job ----------

/**
 * Woher ein Job kommt: normalerweise das Dokument im Editor, beim Materialtest ein eigenes Testdokument
 * mit eigenen Layern, das nie auf der Arbeitsfläche erscheint.
 */
export interface JobSource {
  doc: Doc;
  layer: (i: number) => Layer;
  imgLayer: (i: number) => ImageLayer;
  /** Name in der G-Code-Datei und Vorschlag für den Dateinamen */
  name: string;
  /** Farbe je Layer in der Vorschau */
  color: (i: number) => string;
  /** Only these top-level objects (remote jobs with "selection only"); default: all */
  only?: Obj[] | null;
}

export async function makeJob(ed: Editor, forPreview: boolean, src?: JobSource): Promise<Job> {
  const pos = machine.status.wpos;
  return buildJob({
    doc: src?.doc ?? ed.doc,
    layer: src?.layer ?? ((i) => ed.layer(i)),
    imgLayer: src?.imgLayer ?? ((i) => ed.imgLayer(i)),
    device,
    order: effOrder(),
    only: src ? (src.only ?? null) : device.cutSelected ? ed.sel : null,
    position: pos ? { x: pos[0], y: pos[1] } : null,
    forPreview,
  });
}

function nothingToDo(job: Job): boolean {
  if (job.moves.n) return false;
  notify(device.cutSelected ? t('Nichts zu lasern: Die Auswahl ist leer oder liegt nur auf Layern ohne Ausgabe.') : t('Nichts zu lasern: Keine Objekte auf Layern mit Ausgabe.'), true);
  return true;
}

/** Fahrwege des Jobs gegen den Arbeitsbereich prüfen, mit dem Werkstück-Nullpunkt, den die Steuerung meldet */
export const bedCheck = (ed: Editor, job: Job): BedCheck => checkBed(job.travel, ed.doc.bed, device, machine.workOffset());

const mm = (v: number) => dec(v.toFixed(1));
const range = (b: Box) => ({ x0: mm(b.x0), x1: mm(b.x1), y0: mm(b.y0), y1: mm(b.y1) });

/** Warnung zur Prüfung (null = alles im Arbeitsbereich) */
export function bedProblem(ed: Editor, job: Job, c = bedCheck(ed, job)): string | null {
  const { w, h: bh } = ed.doc.bed;
  if (c.kind === 'ok') return null;
  if (c.kind === 'unknown')
    return (
      t('Start ab Benutzer-Ursprung: Die Steuerung hat noch nicht gemeldet, wo der Ursprung liegt. Ob der Job im Arbeitsbereich ({w} × {bh} mm) bleibt, lässt sich deshalb nicht prüfen.', { w, bh }) +
      '\n' +
      t('Vom Ursprung aus reicht er von X {x0} … {x1}, Y {y0} … {y1} mm (inkl. Überfahrweg).', range(job.travel!))
    );
  const o = machine.workOffset();
  return (
    t('Der Job reicht über den Arbeitsbereich ({w} × {bh} mm) hinaus:', { w, bh }) +
    '\n' +
    (c.measured && o && (o.x || o.y)
      ? t('Mit dem Ursprung der Steuerung (X {ox}, Y {oy}) liegen die Fahrwege bei X {x0} … {x1}, Y {y0} … {y1} mm Maschinenkoordinaten (inkl. Überfahrweg).', { ox: mm(o.x), oy: mm(o.y), ...range(c.box) })
      : t('X {x0} … {x1}, Y {y0} … {y1} mm (inkl. Überfahrweg).', range(c.box)))
  );
}

/** Liegt der Job (inkl. Überfahrwegen) im Arbeitsbereich? Sonst deutlich warnen und nachfragen. */
function boundsOk(ed: Editor, job: Job): boolean {
  const c = bedCheck(ed, job);
  const why = bedProblem(ed, job, c);
  if (!why) return true;
  const hint =
    c.kind === 'unknown'
      ? t('Prüfe vor dem Start, dass vom Ursprung aus genug Platz ist, zum Beispiel mit dem Rahmen.') +
        (liveStatus(fw()) ? ' ' + t('Den Ursprung meldet die Steuerung meist nach wenigen Sekunden, dann prüft KizamuBeam selbst.') : '')
      : device.startFrom === 'user'
        ? t('Wahrscheinlich ist der Ursprung falsch gesetzt oder der Job-Ursprung passt nicht dazu.')
        : '';
  notify(why.split('\n')[0], true);
  return confirm(t('⚠ Achtung') + '\n\n' + why + (hint ? '\n\n' + hint : '') + '\n\n' + t('Trotzdem starten?'));
}

/** Konstruktion prüfen vor dem Start: bei Fehlern oder Warnungen nachfragen, sonst die Stellen zeigen */
function designOk(ed: Editor): boolean {
  if (!loadCheckSettings().beforeLaser) return true;
  let xs = ed.runCheck().filter((x) => x.level !== 'info');
  if (device.cutSelected) xs = xs.filter((x) => x.objs.some((o) => ed.sel.includes(o)));
  if (!xs.length) return true;
  const lines = xs.slice(0, 6).map((x) => '• ' + x.msg);
  if (xs.length > 6) lines.push(tn('… und {n} weitere|one', '… und {n} weitere', xs.length - 6));
  const ok = confirm(
    tn('Konstruktion prüfen hat {n} Problem gefunden:', 'Konstruktion prüfen hat {n} Probleme gefunden:', xs.length) +
      '\n\n' + lines.join('\n') + '\n\n' + t('Trotzdem starten? (Abbrechen zeigt die Stellen im Fenster Prüfung.)'),
  );
  if (!ok) openCheck();
  return ok;
}

/** Warum gerade kein Job oder Rahmen laufen kann (null = es geht) */
export function runBlocker(): string | null {
  if (machine.fire.locked) return fireLockMessage();
  if (device.startLocked) return t('Der Start ist in den Geräteeinstellungen gesperrt.');
  if (!machine.connected) return t('Nicht verbunden.');
  if (machine.running || uploading) return t('Es läuft bereits ein Auftrag.');
  if (machine.remote) {
    // The host checks alarm state, start position and work area with its own device
    if (machine.remote.role === 'viewer') return t('Nur zuschauen: Der Host hat diesem Rechner die Rolle „Zuschauer“ gegeben.');
    if (machine.remote.state && !machine.remote.state.machine.connected) return t('Der Host ist gerade nicht mit dem Laser verbunden.');
    return null;
  }
  if (machine.status.state.startsWith('Alarm'))
    return fw().unlock
      ? t('Die Maschine ist im Alarmzustand. Erst referenzieren (Home) oder entsperren ({unlock}).', { unlock: fw().unlock! })
      : t('Die Maschine ist im Alarmzustand. Erst referenzieren (Home).');
  if (device.startFrom === 'current' && !machine.status.wpos) return t('Die aktuelle Position ist noch nicht bekannt.');
  return null;
}

/** Air Assist ist auf einem Layer an, die FluidNC-Konfiguration hat aber keinen passenden Ausgang: nachfragen */
function airOk(job: Job): boolean {
  if (!job.air.length || !machine.fluid) return true;
  const why = airProblem(machine.fluid.values, device.airCmd);
  return !why || confirm(t('⚠ Achtung') + '\n\n' + why + '\n\n' + t('Trotzdem starten?'));
}

/** Datei, unter der Jobs auf SD-Karte/Flash landen; wird jedes Mal überschrieben */
const JOB_FILE = 'kizamubeam.gcode';

/**
 * Dateiname für Steuerungs-Uploads (#08): ohne Inkrement unverändert (überschreibt wie bisher),
 * mit Inkrement Zähler-Suffix vor der Endung. Reine Vorschau ohne Nebeneffekt.
 */
export function suggestStoredName(base: string): string {
  if (!device.uploadIncrement) return base;
  const n = device.uploadCounter ?? 0;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${stem}_${n}${ext}`;
}

/** Wie suggestStoredName, zählt den Geräte-Zähler danach hoch (persistiert via deviceChanged) */
export function confirmStoredName(base: string): string {
  const name = suggestStoredName(base);
  if (device.uploadIncrement) {
    device.uploadCounter = (device.uploadCounter ?? 0) + 1;
    deviceChanged();
  }
  return name;
}
/** Fortschritt beim Hochladen auf die Steuerung */
let uploading: { sent: number; total: number } | null = null;
const uploadListeners = new Set<() => void>();
const uploadChanged = () => uploadListeners.forEach((f) => f());

/**
 * G-Code auf SD-Karte oder Flash der FluidNC-Steuerung laden und die Größe in der Dateiliste prüfen.
 * Liefert die Größe in Bytes oder null (Fehler schon gemeldet).
 */
export async function uploadGCode(g: PreparedGCode, fs: FluidFs, file: string): Promise<number | null> {
  const where = fs === 'sd' ? t('SD-Karte') : t('Flash');
  if (uploading) return notify(t('Es wird schon eine Datei hochgeladen.'), true), null;
  uploading = { sent: 0, total: 1 };
  uploadChanged();
  let size = 0;
  try {
    size = await machine.upload(device, fs, file, g, (sent, total) => ((uploading = { sent, total }), uploadChanged()));
  } catch (e) {
    notify(t('Hochladen auf die {where} fehlgeschlagen: {error}', { where, error: (e as Error).message }), true);
    return null;
  } finally {
    uploading = null;
    uploadChanged();
  }
  // Angekommen? Größe in der Dateiliste vergleichen (fehlt die Datei in der Liste, trotzdem weiter)
  const f = parseFileList(await machine.query([listCmd(fs)], 4000, true)).find((x) => x.name.replace(/^\//, '') === file);
  if (f && f.size !== size) {
    notify(t('Die Datei auf der {where} ist unvollständig ({got} von {size} Bytes).', { where, got: f.size, size }), true);
    return null;
  }
  machine.log(t('{file} auf die {where} geladen ({size} kB).', { file, where, size: Math.ceil(size / 1024) }));
  return size;
}

/** Job senden: vom Rechner aus oder (FluidNC, Einstellung „Job ausführen“) erst hochladen und auf der Steuerung starten */
export async function runGCode(g: PreparedGCode): Promise<boolean> {
  if (device.runFrom === 'stream' || fw().read !== 'fluidnc') return machine.runPrepared(g);
  const file = confirmStoredName(JOB_FILE);
  if ((await uploadGCode(g, device.runFrom, file)) === null) return false;
  await machine.runStored(device.runFrom, file);
  return true;
}

/** Aktuellen Job berechnen und als Datei auf die Steuerung laden (ohne zu starten) */
export async function uploadJob(ed: Editor, fs: FluidFs, file: string): Promise<number | null> {
  if (machine.remote) return notify(t('Über einen anderen KizamuBeam nicht möglich.'), true), null;
  const job = await makeJob(ed, false);
  if (nothingToDo(job)) return null;
  job.warnings.forEach((w) => notify(w));
  const g = await prepareGCode(job, device, estimate(job.moves, device), undefined, (i) => ed.layer(i));
  return uploadGCode(g, fs, confirmStoredName(file));
}

/** Nightly builds remind once per session that they are untested on hardware */
let nightlyWarned = false;

function canRun(): boolean {
  const why = runBlocker();
  if (why) notify(why, true);
  else if (isNightly(APP_VERSION) && !nightlyWarned) {
    nightlyWarned = true;
    notify(t('Nightly-Build {version}: nicht an echter Hardware getestet. Ersten Job bitte beobachten.', { version: APP_VERSION }));
  }
  return !why;
}

export async function startJob(ed: Editor, src?: JobSource) {
  if (!canRun()) return;
  if (machine.remote) {
    if (!src && !designOk(ed)) return;
    if ((await remoteJob(ed, src, device.cutSelected, notify)) && !src) ed.afterJob();
    return;
  }
  const job = await makeJob(ed, false, src);
  if (nothingToDo(job) || (!src && !designOk(ed)) || !boundsOk(ed, job) || !airOk(job)) return;
  job.warnings.forEach((w) => notify(w));
  const est = estimate(job.moves, device);
  const g = await prepareGCode(job, device, est, src?.name, src?.layer ?? ((i) => ed.layer(i)));
  notify(t('Job gestartet, geschätzt {total}.', { total: formatDuration(est.total) }));
  if ((await runGCode(g)) && !src) ed.afterJob();
}

/**
 * „Start Here“: den Job ab einer Stelle der Vorschau lasern. preview sind die Bewegungen der Vorschau,
 * die Stelle ist Bewegung i bei Anteil frac. Der Job wird neu berechnet und muss zur Vorschau passen.
 */
export async function startJobAt(ed: Editor, preview: Moves, i: number, frac: number, src?: JobSource): Promise<boolean> {
  if (!canRun()) return false;
  if (machine.remote) return notify(t('„Start hier“ geht über einen anderen KizamuBeam noch nicht.'), true), false;
  const job = await makeJob(ed, false, src);
  if (nothingToDo(job) || (!src && !designOk(ed)) || !boundsOk(ed, job) || !airOk(job)) return false;
  if (!sameMoves(preview, job.moves, job.offset)) {
    notify(t('Die Vorschau passt nicht mehr zum Job (z. B. weil sich die Laserposition geändert hat). Bitte die Vorschau neu öffnen.'), true);
    return false;
  }
  const total = estimate(job.moves, device).total;
  job.moves = startHere(job.moves, i, frac);
  if (!burns(job.moves)) {
    notify(t('Ab dieser Stelle gibt es nichts mehr zu lasern.'), true);
    return false;
  }
  job.warnings.forEach((w) => notify(w));
  const est = estimate(job.moves, device);
  const at = formatDuration(Math.max(0, total - est.total));
  const g = await prepareGCode(job, device, est, t('{name} ab {at}', { name: src?.name ?? 'KizamuBeam', at }), src?.layer ?? ((i) => ed.layer(i)));
  notify(t('Job ab {at} gestartet, geschätzt {total}.', { at, total: formatDuration(est.total) }));
  return runGCode(g);
}

export async function frameJob(ed: Editor, contour: boolean, src?: JobSource) {
  if (!canRun()) return;
  if (machine.remote) return void (await remoteFrame(ed, src, device.cutSelected, contour, notify));
  const job = await makeJob(ed, false, src);
  const lines = frameGCode(job, device, contour);
  if (!lines) return void nothingToDo(job);
  if (!boundsOk(ed, job)) return;
  await machine.runJob(lines, null, true);
}

export async function saveGCode(ed: Editor, src?: JobSource) {
  const job = await makeJob(ed, false, src);
  if (nothingToDo(job)) return;
  if (device.startFrom === 'current') notify(t('Hinweis: Die Datei enthält die aktuelle Laserposition als Startpunkt.'));
  const g = await prepareGCode(
    job,
    device,
    estimate(job.moves, device),
    src?.name,
    src?.layer ?? ((i) => ed.layer(i)),
    device.fw === 'ruida' ? { filename: src?.name || 'KIZAMU' } : undefined,
  );
  const slug = src ? src.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-') : 'projekt';
  if (device.fw === 'ruida') {
    const name = `${slug}.rd`;
    const saved = g.ruida
      ? await saveBinary(name, 'Ruida (.rd)', 'rd', g.ruida)
      : (await native<string | null>('ruida_save', { id: g.id, defaultName: name, filterName: 'Ruida (.rd)' })) !== null;
    if (saved && !src) ed.afterJob();
    return;
  }
  const name = `${slug}.gcode`;
  const saved = g.lines
    ? await saveText(name, 'G-Code', 'gcode', 'text/plain', g.lines.join('\n') + '\n')
    : (await native<string | null>('gcode_save', { id: g.id, defaultName: name, filterName: 'G-Code' })) !== null;
  if (saved && !src) ed.afterJob();
}

export async function uploadRuidaToController(ed: Editor, src?: JobSource) {
  if (!canRun()) return;
  const job = await makeJob(ed, false, src);
  if (nothingToDo(job) || (!src && !designOk(ed)) || !boundsOk(ed, job) || !airOk(job)) return;
  const defName = suggestStoredName(sanitizeRuidaFilename(src?.name || 'KIZAMU'));
  const raw = prompt(t('Dateiname im Ruida-Speicher (max. 8 Zeichen, A–Z / 0–9):'), defName);
  if (!raw) return;
  const fname = sanitizeRuidaFilename(raw);
  job.warnings.forEach((w) => notify(w));
  const est = estimate(job.moves, device);
  const g = await prepareGCode(job, device, est, fname, src?.layer ?? ((i) => ed.layer(i)), { filename: fname, upload: true });
  const ok = await machine.runPrepared(g);
  if (ok && fname === suggestStoredName(fname)) confirmStoredName(fname);
  if (ok && !src) ed.afterJob();
}

/** Job und Zeitschätzung des Dokuments ohne Ausgabe (für KI-Agenten) */
export async function jobInfo(ed: Editor) {
  const job = await makeJob(ed, true);
  return { job, est: job.moves.n ? estimate(job.moves, device) : null, device };
}

/** Alle Geräte und die ID des gewählten */
export const deviceList = () => ({ devices: store.devices, current: device.id });

// ---------- Laser-Panel ----------

export function buildLaser(ed: Editor) {
  installFireOverlay();
  applyBed(ed);
  // Die Lage auf dem Bett zählt nur, wenn absolut gelasert wird und keine Drehachse läuft
  ed.checkBedApplies = () => device.startFrom === 'absolute' && !rotaryOn(device);
  // Manuell ist die Reihenfolge nur, wenn kein Optimierer umsortiert (#153: dann warnt die Prüfung vor innen-vor-außen)
  ed.manualOrder = () => isManualOrder(effOrder());
  // Jeder Bereich ist ein eigenes Fenster (andockbar, als Reiter stapelbar, siehe dock.ts)
  const wins: [string, string, HTMLElement, (() => void)?][] = [
    ['laser', t('Laser'), laserTab(ed)],
    ['move', t('Verschieben'), moveTab(ed)],
    ['console', t('Konsole'), consoleTab(), () => windowBody('console').querySelector('input')?.focus()],
    ['material', t('Material'), materialTab(ed)],
    ['camera', t('Kamera'), cameraTab(ed)],
  ];
  for (const [id, title, el, onShow] of wins) dockWindow(id, title, { onShow }).append(el);
  // Laserkopf auf der Arbeitsfläche
  machine.on((e) => {
    if (e.type !== 'status' && e.type !== 'connection') return;
    const p = machine.connected ? machine.status.wpos : null;
    const old = ed.laserPos;
    if (!p) {
      if (old) ((ed.laserPos = null), ed.redraw());
    } else if (!old || Math.abs(old.x - p[0]) > 1e-3 || Math.abs(old.y - p[1]) > 1e-3) {
      ed.laserPos = { x: p[0], y: p[1] };
      ed.redraw();
    }
  });
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (!e.defaultPrevented && commandMatches('preview', e)) {
      e.preventDefault();
      openPreview(ed);
    }
  });
}

function stateText(): [string, string] {
  if (machine.fire.locked) return [t('Testfeuer'), 'busy'];
  if (machine.connecting) return [t('Verbinde …'), 'busy'];
  if (!machine.connected) return [t('Nicht verbunden'), ''];
  const s = machine.status.state;
  const names: Record<string, string> = {
    Idle: t('Bereit'), Run: t('Läuft'), Hold: t('Angehalten'), Jog: t('Fährt'), Alarm: t('Alarm'), Door: t('Tür offen'), Home: t('Referenzfahrt'), Check: t('Prüfmodus'), Sleep: t('Ruhezustand'),
  };
  const label = names[s] ?? (s || t('Verbunden'));
  return [label, s === 'Alarm' || s === 'Door' ? 'error' : s === 'Idle' || !s ? 'ok' : 'busy'];
}

// Zeiger-Modus (#213, Follow-up): Framing und Klickfahrt gemeinsam — Rotpunkt (kompensiert,
// Default) oder Werkzeug (LightBurn-Verhalten + Kollisionsprüfung). Eine Zeile je Panel (Laser
// und Verschieben), beide zeigen denselben Stand. Sichtbar nur mit aktivem Offset.
function buildFrameViewRow() {
  const pointerB = h('button', {
    class: 'btn small', title: t('Framing und Positionieren mit dem Rotpunkt (kompensiert, zeigt den echten Laserbereich)'),
    onclick: () => ((device.frameView = 'pointer'), deviceChanged()),
  }, t('Rotpunkt')) as HTMLButtonElement;
  const toolB = h('button', {
    class: 'btn small', title: t('Framing und Positionieren mit dem Werkzeuglaser (wie LightBurn, zugleich Prüfung, ob der Kopf nirgends anstößt)'),
    onclick: () => ((device.frameView = 'tool'), deviceChanged()),
  }, t('Werkzeug')) as HTMLButtonElement;
  const row = h('div', { class: 'conn-row frame-view' },
    h('label', {}, t('Positionieren mit')), pointerB, toolB);
  const update = () => {
    pointerB.classList.toggle('cur', device.frameView !== 'tool');
    toolB.classList.toggle('cur', device.frameView === 'tool');
    row.hidden = !device.pointerOffset?.enabled;
  };
  deviceListeners.add(update);
  update();
  return { row, pointerB, toolB };
}

/**
 * Schnittreihenfolge für diesen Job (V3, #153; V4: plus Ecke-Start): vier Override-Checkboxen mit den gleichen Texten wie das
 * Geräte-Preset; ein gesetzter Haken gilt nur für die nächsten Jobs (sitzungsweit, nicht gespeichert),
 * ein Wert gleich dem Preset folgt wieder dem Preset. Zurücksetzen verwirft alle Overrides.
 */
function jobOrderBox(ed: Editor, check: (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => HTMLElement): HTMLElement {
  const preset = { innerFirst: () => device.optInnerFirst, travel: () => device.optTravel, group: () => device.optGroup, cornerStart: () => device.optCornerStart };
  const box = (key: keyof typeof preset, label: string, title: string) =>
    check(label, title, () => jobOrder[key] ?? preset[key](), (v) => {
      jobOrder[key] = v === preset[key]() ? null : v;
      if (isShown('check')) ed.runCheck();
    });
  const reset = h('button', { class: 'btn small', onclick: () => { resetJobOrder(); if (isShown('check')) ed.runCheck(); } }, t('Zurück zum Preset')) as HTMLButtonElement;
  const refresh = () => {
    reset.hidden = jobOrder.innerFirst === null && jobOrder.travel === null && jobOrder.group === null && jobOrder.cornerStart === null;
  };
  deviceListeners.add(refresh);
  refresh();
  return h('details', { class: 'job-order' },
    h('summary', { title: t('Abweichend vom Geräte-Preset nur für die nächsten Jobs (wird nicht gespeichert).') }, t('Schnittreihenfolge für diesen Job')),
    box('innerFirst', t('Innere Formen zuerst'), t('Löcher und Innenkonturen vor ihrer Außenkontur schneiden')),
    box('travel', t('Leerwege verkürzen'), t('Nächstgelegene Form als nächste schneiden (Alternative zur manuellen Reihenfolge)')),
    box('group', t('Gruppen zusammenhalten'), t('Formen eines Objekts bzw. einer Gruppe bevorzugt nacheinander schneiden')),
    box('cornerStart', t('In Ecken beginnen'), t('Geschlossene Konturen an der schärfsten Ecke beginnen (Einstich unauffällig)')),
    reset,
  );
}


/**
 * Optimierung der Schnittreihenfolge als eigener Dialog (Geräte-Preset, wie bei anderen Lösungen am Markt üblich): acht Umsortier-Schalter in drei Gruppen als Entwurf,
 * der erst bei Übernehmen ins Geräte-Preset geschrieben wird (Abbrechen verwirft). Job-Overrides
 * („Schnittreihenfolge für diesen Job") und CutOrder-Import wirken auf die vier ursprünglichen
 * Schalter und gehen dort vor; für die vier neuen Schalter (Richtung, Start, Vorgaben) gilt
 * stets das Geräte-Preset.
 * „Persönliche Vorgaben" speichert/lädt den Entwurf als JSON unter 'kizamu.optDefaults'
 * (localStorage, nur dieses Gerät-Rechners) und schreibt nie direkt ins Gerät.
 */
export function openOptimizeDialog() {
  if (deviceEditBlocked()) return;
  // Acht Opt-Felder direkt aus dem Geräte-Modell (Engine führt sie seit Schritt 3).
  type OptDraft = Pick<Device,
    'optInnerFirst' | 'optTravel' | 'optGroup' | 'optCornerStart' |
    'optDirOrder' | 'optBestStart' | 'optBestDirection' | 'optLessTurns'>;
  type BoolKey = 'optInnerFirst' | 'optTravel' | 'optGroup' | 'optCornerStart' | 'optBestStart' | 'optBestDirection' | 'optLessTurns';
  const OPT_STORE = 'kizamu.optDefaults';
  const DIRS: DirOrder[] = ['none', 'ltr', 'rtl', 'ttb', 'btt'];
  // Werksvorgabe aus dem Geräte-Modell
  const factoryBase: OptDraft = {
    optInnerFirst: DEFAULT_DEVICE.optInnerFirst,
    optTravel: DEFAULT_DEVICE.optTravel,
    optGroup: DEFAULT_DEVICE.optGroup,
    optCornerStart: DEFAULT_DEVICE.optCornerStart,
    optDirOrder: DEFAULT_DEVICE.optDirOrder,
    optBestStart: DEFAULT_DEVICE.optBestStart,
    optBestDirection: DEFAULT_DEVICE.optBestDirection,
    optLessTurns: DEFAULT_DEVICE.optLessTurns,
  };
  // Persönliche Vorgabe: nur bekannte Felder mit passendem Typ übernehmen
  const loadStored = (): Partial<OptDraft> | null => {
    try {
      const raw = localStorage.getItem(OPT_STORE);
      if (!raw) return null;
      const p = JSON.parse(raw) as Partial<OptDraft>;
      if (!p || typeof p !== 'object') return null;
      const out: Partial<OptDraft> = {};
      (['optInnerFirst', 'optTravel', 'optGroup', 'optCornerStart', 'optBestStart', 'optBestDirection', 'optLessTurns'] as BoolKey[])
        .forEach((k) => { if (typeof p[k] === 'boolean') out[k] = p[k]; });
      if (DIRS.includes(p.optDirOrder as DirOrder)) out.optDirOrder = p.optDirOrder;
      return out;
    } catch {
      return null;
    }
  };
  const d: OptDraft = {
    optInnerFirst: device.optInnerFirst,
    optTravel: device.optTravel,
    optGroup: device.optGroup,
    optCornerStart: device.optCornerStart,
    optDirOrder: device.optDirOrder,
    optBestStart: device.optBestStart,
    optBestDirection: device.optBestDirection,
    optLessTurns: device.optLessTurns,
    ...loadStored(),
  };
  const inputs = new Map<BoolKey, HTMLInputElement>();
  const box = (key: BoolKey, label: string, title: string) => {
    const c = h('input', { type: 'checkbox', onchange: (e: Event) => (d[key] = (e.target as HTMLInputElement).checked) }) as HTMLInputElement;
    c.checked = d[key];
    inputs.set(key, c);
    return h('label', { class: 'check', title }, c, label);
  };
  const dirSel = h('select', { onchange: (e: Event) => (d.optDirOrder = (e.target as HTMLSelectElement).value as DirOrder) }) as HTMLSelectElement;
  ([
    ['none', t('Aus')],
    ['ltr', t('Links nach rechts')],
    ['rtl', t('Rechts nach links')],
    ['ttb', t('Oben nach unten')],
    ['btt', t('Unten nach oben')],
  ] as [DirOrder, string][]).forEach(([v, label]) => dirSel.append(h('option', { value: v }, label)));
  dirSel.value = d.optDirOrder;
  const sync = () => {
    inputs.forEach((c, k) => (c.checked = d[k]));
    dirSel.value = d.optDirOrder;
  };
  const group = (legend: string, ...body: HTMLElement[]) =>
    h('fieldset', {}, h('legend', {}, legend), h('div', { class: 'form' }, ...body));
  const dlg = h('dialog', { class: 'device-dialog' },
    h('h3', {}, t('Optimierung der Schnittreihenfolge')),
    group(t('Reihenfolge'),
      box('optInnerFirst', t('Innere Formen zuerst'), t('Löcher und Innenkonturen vor ihrer Außenkontur schneiden')),
      box('optTravel', t('Leerwege verkürzen'), t('Nächstgelegene Form als nächste schneiden (Alternative zur manuellen Reihenfolge)')),
      box('optGroup', t('Gruppen zusammenhalten'), t('Formen eines Objekts bzw. einer Gruppe bevorzugt nacheinander schneiden')),
      h('label', {}, t('Richtungsreihenfolge')), dirSel,
      box('optLessTurns', t('Richtungswechsel reduzieren'), t('Bevorzugt Bahnen in aktueller Fahrtrichtung (kein Backlash-Ausgleich)')),
    ),
    group(t('Startpunkt & Richtung'),
      box('optCornerStart', t('In Ecken beginnen'), t('Geschlossene Konturen an der schärfsten Ecke beginnen (Einstich unauffällig)')),
      box('optBestStart', t('Besten Startpunkt wählen'), t('Geschlossene Konturen: Start am nächsten Eckpunkt, ohne Umsortierung')),
      box('optBestDirection', t('Beste Richtung wählen'), t('Offene Konturen ab dem näheren Ende; geschlossene werden nie umgedreht')),
    ),
    group(t('Persönliche Vorgaben'),
      h('button', {
        class: 'btn', title: t('Entwurf auf die persönliche Vorgabe zurücksetzen (sonst Werksvorgabe)'),
        onclick: () => {
          Object.assign(d, loadStored() ?? factoryBase);
          sync();
        },
      }, t('Auf Standard zurücksetzen')),
      h('button', {
        class: 'btn', title: t('Aktuellen Entwurf als persönliche Vorgabe speichern'),
        onclick: () => {
          try {
            localStorage.setItem(OPT_STORE, JSON.stringify(d));
          } catch {
            notify(t('Einstellung konnte nicht gespeichert werden.'), true);
          }
        },
      }, t('Als Vorgabe speichern')),
    ),
    h('div', { class: 'note' }, t('Geräte-Preset: gilt für alle Jobs dieses Geräts. Abweichungen nur für diesen Job unter „Schnittreihenfolge für diesen Job“.')),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => done() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          (document.activeElement as HTMLElement | null)?.blur();
          Object.assign(device, d);
          deviceChanged();
          done();
        },
      }, t('Übernehmen')),
    ),
  );
  // Explizit entfernen: Der close-Listener räumt Esc ab, die Buttons räumen selbst ab
  // (nicht jede Umgebung stellt das close-Event zuverlässig zu).
  const done = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}

function laserTab(ed: Editor): HTMLElement {
  const root = h('div', { class: 'laser-tab' });
  const big = (icon: string, label: string, title: string, onclick: () => void) =>
    h('button', { class: 'btn', title, onclick }, h('span', { icon }), label);
  const dot = h('span', { class: 'dot' });
  const stTxt = h('span', {});
  const posTxt = h('span', { class: 'pos' });
  const portSel = h('select', { class: 'port', title: t('Schnittstelle oder Netzwerk') }) as HTMLSelectElement;
  const refreshBtn = h('button', { class: 'ib small', title: t('Schnittstellen neu suchen'), icon: 'refresh', onclick: () => loadPorts() });
  const connBtn = h('button', { class: 'btn' }, t('Verbinden')) as HTMLButtonElement;
  connBtn.addEventListener('click', async () => {
    if (machine.connected) return machine.disconnect();
    applyPortChoice();
    await machine.connect(device);
  });
  const startB = big('play', t('Start'), t('Job starten'), () => startJob(ed));
  const pauseB = big('pause', t('Pause'), t('Anhalten / fortsetzen'), () => (machine.status.state.startsWith('Hold') ? machine.resume() : machine.pause()));
  const stopB = big('stop', t('Stopp'), t('Job abbrechen'), () => machine.stop());
  const frameB = big('frame', t('Rahmen'), t('Rechteck um den Job abfahren'), () => frameJob(ed, false));
  const contourB = big('contour', t('Kontur'), t('Umriss des Jobs abfahren (Gummiband)'), () => frameJob(ed, true));
  const homeB = big('home', t('Home'), t('Referenzfahrt'), () => {
    if (device.limitSwitches === 'no' && !confirm(t('Für dieses Gerät ist angegeben, dass es keine Endschalter hat. Eine Referenzfahrt fährt dann bis zum Anschlag.\n\nTrotzdem referenzieren?'))) return;
    if (rotaryOn(device) && device.rotary.axis === 'Y' && !confirm(t('Die Drehachse steckt am Y-Anschluss. Eine Referenzfahrt kann sie endlos drehen lassen, weil es dort keinen Endschalter gibt.\n\nTrotzdem referenzieren?'))) return;
    machine.send((machine.remote ? machine.fw : fw()).home);
  });
  const originB = big('origin', t('Ursprung'), t('Zum Nullpunkt fahren'), () => sendAll(moveLines(device, 'X0 Y0')));
  const previewB = big('preview', t('Vorschau'), t('Vorschau mit Zeitschätzung (Alt+P)'), () => openPreview(ed));
  const saveB = big('gcode', 'G-Code', t('G-Code speichern'), () => saveGCode(ed));
  const ruidaMemB = h('button', {
    class: 'btn',
    title: t('Job als benannte Datei im internen Speicher der Ruida-Steuerung ablegen (ohne sofortigen Start)'),
    onclick: () => uploadRuidaToController(ed),
  }, t('In Steuerung speichern …')) as HTMLButtonElement;
  const bar = h('div', { class: 'progress' }, h('div', { class: 'fill' }));
  const progTxt = h('div', { class: 'progress-text' });
  const msg = h('div', { class: 'note laser-msg' });
  const startFrom = h('select', { onchange: (e: Event) => ((device.startFrom = (e.target as HTMLSelectElement).value as StartFrom), deviceChanged()) },
    h('option', { value: 'absolute' }, t('Absolute Koordinaten')),
    h('option', { value: 'user' }, t('Benutzer-Ursprung')),
    h('option', { value: 'current' }, t('Aktuelle Position')),
  ) as HTMLSelectElement;
  const originGrid = h('div', { class: 'origin-grid', title: t('Job-Ursprung: dieser Punkt des Jobs liegt am Startpunkt') });
  const originBtns = Array.from({ length: 9 }, (_, k) => {
    const b = h('button', { onclick: () => ((device.jobOrigin = k), deviceChanged()) });
    originGrid.append(b);
    return b;
  });
  const check = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const c = h('input', { type: 'checkbox', onchange: (e: Event) => (set((e.target as HTMLInputElement).checked), deviceChanged()) }) as HTMLInputElement;
    deviceListeners.add(() => (c.checked = get()));
    c.checked = get();
    return h('label', { class: 'check', title }, c, label);
  };
  // Während des Jobs nachsteuern: Overrides für Leistung, Vorschub und Eilgang, Air Assist, Ausgänge (GRBL-Familie)
  const ovVal: Record<'feed' | 'power', HTMLButtonElement> = {} as never;
  const ovRow = (kind: 'feed' | 'power', label: string, title: string) => {
    const c = OVERRIDE[kind];
    const b = (txt: string, code: number, tip: string) => h('button', { class: 'btn small', title: tip, onclick: () => machine.realtime(code) }, txt);
    ovVal[kind] = h('button', { class: 'btn small ov-val', title: t('Auf 100 % zurücksetzen'), onclick: () => machine.realtime(c.reset) }, '100 %') as HTMLButtonElement;
    return [h('label', { title }, label), h('div', { class: 'ov-row' }, b('−10', c.minus10, t('10 % weniger')), b('−1', c.minus1, t('1 % weniger')), ovVal[kind], b('+1', c.plus1, t('1 % mehr')), b('+10', c.plus10, t('10 % mehr')))];
  };
  const rapidBtns = ([25, 50, 100] as const).map((p) => h('button', { class: 'btn small', onclick: () => machine.realtime(RAPID_OVERRIDE[p]) }, `${p} %`) as HTMLButtonElement);
  const airBtn = h('button', {
    class: 'btn small',
    title: t('Air Assist sofort ein- oder ausschalten, auch während des Jobs'),
    onclick: () => machine.realtime(device.airCmd === 'M7' ? TOGGLE_MIST : TOGGLE_FLOOD),
  }, t('Air Assist')) as HTMLButtonElement;
  const { row: frameViewRow, pointerB: framePointerB, toolB: frameToolB } = buildFrameViewRow();
  const outRow = h('div', { class: 'ov-row' });
  // Zu, solange nichts läuft (spart Platz); beim Start eines Jobs geht es von selbst auf
  const ovBox = h('details', { class: 'ov-box' },
    h('summary', {}, t('Nachsteuern')),
    h('div', { class: 'form' },
      ...ovRow('power', t('Leistung'), t('Laserleistung des laufenden Jobs in Prozent der eingestellten Werte (10 … 200 %)')),
      ...ovRow('feed', t('Geschwindigkeit'), t('Vorschub des laufenden Jobs in Prozent der eingestellten Werte (10 … 200 %)')),
      h('label', { title: t('Eilgang (Leerfahrten) in Prozent') }, t('Eilgang')), h('div', { class: 'ov-row' }, ...rapidBtns),
      h('label', {}, t('Zubehör')), h('div', { class: 'ov-row' }, airBtn),
      h('label', { class: 'ov-out-label', title: t('Freie Ausgänge der FluidNC-Konfiguration (user_outputs), z. B. für Absaugung oder Licht') }, t('Ausgänge')), outRow,
    ),
  );
  const fillOutputs = () => {
    outRow.textContent = '';
    const outs = machine.fluid ? digitalOutputs(machine.fluid.values) : [];
    for (const o of outs)
      outRow.append(h('span', { class: 'ov-out', title: o.pin }, `P${o.n}`,
        h('button', { class: 'btn small', onclick: () => machine.send(outputCmd(o.n, true)) }, t('an')),
        h('button', { class: 'btn small', onclick: () => machine.send(outputCmd(o.n, false)) }, t('aus'))));
    outRow.hidden = !outs.length;
    (ovBox.querySelector('.ov-out-label') as HTMLElement).hidden = !outs.length;
  };
  fillOutputs();
  let ovOpened = false;
  const pinTxt = h('div', { class: 'note pins' });
  const devSel = h('select', { class: 'port', title: t('Gerät'), onchange: (e: Event) => selectDevice(ed, (e.target as HTMLSelectElement).value) }) as HTMLSelectElement;
  const fillDevices = () => {
    devSel.textContent = '';
    for (const d of store.devices) devSel.append(h('option', { value: d.id }, `${d.name} (${FIRMWARES[d.fw].label})`));
    devSel.value = device.id;
  };
  root.append(
    h('div', { class: 'conn-row' }, devSel, h('button', { class: 'btn', title: t('Geräte hinzufügen, bearbeiten, löschen'), onclick: () => openDevicesDialog(ed) }, t('Geräte …'))),
    h('div', { class: 'laser-status' }, h('span', {}, dot, stTxt), posTxt),
    pinTxt,
    h('div', { class: 'conn-row' }, portSel, refreshBtn, connBtn),
    h('div', { class: 'laser-grid' }, startB, pauseB, stopB, frameB, contourB, homeB, originB, previewB, saveB),
    ruidaMemB,
    frameViewRow,
    bar,
    progTxt,
    ovBox,
    h('div', { class: 'form' },
      h('label', {}, t('Starten ab')), startFrom,
      h('label', {}, t('Job-Ursprung')), originGrid,
    ),
    h('div', { class: 'checks' },
      check(t('Nur Auswahl'), t('Nur die ausgewählten Objekte lasern'), () => device.cutSelected, (v) => (device.cutSelected = v)),
      check(t('Drehachse'), t('Rotary einschalten: Y wird zur Umfangsrichtung des Objekts'), () => device.rotary.enabled, (v) => (device.rotary = { ...device.rotary, enabled: v })),
      h('button', { class: 'btn small', title: t('Drehachse (Rotary) einrichten'), onclick: () => openRotaryDialog() }, t('Drehachse …')),
    ),
    jobOrderBox(ed, check),
    h('div', { class: 'conn-row' },
      h('button', { class: 'btn', title: t('Umsortier-Schalter des Geräte-Presets einstellen (Innen zuerst, Leerwege, Gruppen, Ecken)'), onclick: () => openOptimizeDialog() }, t('Optimierung …')),
      h('button', { class: 'btn', onclick: () => openDeviceDialog(ed) }, h('span', { icon: 'settings' }), t('Geräteeinstellungen')),
      h('button', { class: 'btn', title: t('Schritt für Schritt von der Verbindung bis zum ersten Testauftrag'), onclick: () => import('./setupWizard').then((m) => m.openSetupWizard(ed)) }, t('Laser einrichten …')),
    ),
    msg,
  );
  let msgTimer = 0;
  notify = (m, error = false) => {
    machine.log(m, error ? 'error' : 'info');
    msg.textContent = m;
    msg.classList.toggle('error', error);
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msg.textContent = ''), 12000);
  };

  let ports: PortInfo[] = [];
  const NET = '__net__';
  const NET_WS = '__ws__';
  const REMOTE = '__remote__';
  const fillPorts = () => {
    portSel.textContent = '';
    const names = ports.map((p) => p.name);
    if (device.port && !names.includes(device.port)) names.unshift(device.port);
    for (const n of names) {
      const p = ports.find((x) => x.name === n);
      portSel.append(h('option', { value: n }, p?.description ? `${n} (${p.description})` : n));
    }
    if (!names.length) portSel.append(h('option', { value: '', disabled: true }, t('Keine serielle Schnittstelle gefunden')));
    if (device.fw === 'ruida') {
      portSel.append(h('option', { value: NET }, t('Netzwerk (UDP): {address}', { address: `${device.host}:${device.ruidaPort || 50200}` })));
    } else {
      portSel.append(h('option', { value: NET }, t('WLAN: {address}', { address: `${device.host}:${device.tcpPort}` })));
      portSel.append(h('option', { value: NET_WS }, t('WLAN (WebSocket): {address}', { address: `${device.host}:${device.wsPort}` })));
    }
    if (device.conn === 'remote' || device.remoteFp) portSel.append(h('option', { value: REMOTE }, t('Anderer KizamuBeam: {address}', { address: `${device.host}:${device.remotePort}` })));
    portSel.value = device.conn === 'tcp' || (device.fw === 'ruida' && device.conn === 'ws') ? NET : device.conn === 'ws' ? NET_WS : device.conn === 'remote' ? REMOTE : device.port || names[0] || NET;
  };
  const applyPortChoice = () => {
    if (portSel.value === NET) device.conn = 'tcp';
    else if (portSel.value === NET_WS) device.conn = 'ws';
    else if (portSel.value === REMOTE) device.conn = 'remote';
    else if (portSel.value) ((device.conn = 'serial'), (device.port = portSel.value));
    deviceChanged();
  };
  portSel.addEventListener('change', applyPortChoice);
  const loadPorts = async () => {
    try {
      ports = await machine.ports();
    } catch (e) {
      notify(t('Schnittstellen konnten nicht gelesen werden: {error}', { error: tBackend(String(e)) }), true);
    }
    fillPorts();
  };
  if (isTauri()) loadPorts();
  else fillPorts();

  const refresh = () => {
    const [stateLabel, cls] = stateText();
    stTxt.textContent = stateLabel + (machine.connected ? ` · ${machine.where}` : '');
    dot.className = `dot ${cls}`;
    const p = machine.connected ? machine.status.wpos : null;
    posTxt.textContent = p ? `X ${dec(p[0].toFixed(2))}  Y ${dec(p[1].toFixed(2))}` : '';
    devSel.disabled = machine.connected || machine.connecting || machine.fire.locked;
    const on = machine.connected,
      busy = machine.running || !!uploading || machine.fire.locked;
    connBtn.textContent = on ? t('Trennen') : machine.connecting ? t('Verbinde …') : t('Verbinden');
    connBtn.disabled = machine.connecting || (!isTauri() && !on) || (!on && machine.fire.locked);
    portSel.disabled = on || machine.connecting || !isTauri();
    refreshBtn.disabled = portSel.disabled;
    for (const b of [startB, frameB, contourB, homeB, originB]) b.disabled = !on || busy;
    pauseB.disabled = !on || machine.fire.locked;
    stopB.disabled = !on;
    saveB.lastChild!.textContent = device.fw === 'ruida' ? '.rd' : 'G-Code';
    saveB.title = device.fw === 'ruida' ? t('Als Ruida-Datei (.rd) speichern') : t('G-Code speichern');
    ruidaMemB.hidden = device.fw !== 'ruida';
    ruidaMemB.disabled = !on || busy;
    const hold = machine.status.state.startsWith('Hold');
    pauseB.lastChild!.textContent = hold ? t('Weiter') : t('Pause');
    setIcon(pauseB.firstChild as HTMLElement, hold ? 'play' : 'pause');
    const pr = machine.progress;
    const stored = machine.storedJob;
    const showProg = (!!pr && !machine.jobIsFrame) || !!stored || !!uploading;
    bar.hidden = progTxt.hidden = !showProg;
    const el = (since: number) => t('{time} vergangen', { time: formatDuration((performance.now() - since) / 1000) });
    if (uploading) {
      const f = uploading.total ? uploading.sent / uploading.total : 0;
      (bar.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(1)}%`;
      progTxt.textContent = t('Lade auf die Steuerung … {pct} %', { pct: Math.floor(f * 100) });
    } else if (stored) {
      const f = (machine.status.sd?.pct ?? 0) / 100;
      (bar.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(1)}%`;
      progTxt.textContent = `${Math.floor(f * 100)} % · ${t('läuft auf der Steuerung')} · ${el(stored.started)}`;
    } else if (pr && showProg) {
      const f = pr.total ? pr.acked / pr.total : 0;
      (bar.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(1)}%`;
      const rest = machine.remaining();
      progTxt.textContent = `${Math.floor(f * 100)} % · ${el(machine.jobStarted)}${rest !== null ? t(' · noch etwa {rest}', { rest: formatDuration(rest) }) : ''}${pr.errors ? tn(' · {n} Fehler|one', ' · {n} Fehler', pr.errors) : ''}`;
    }
    // Nachsteuern: nur GRBL-Familie; Ov meldet die Steuerung nur ab und zu
    ovBox.hidden = !on || !fw().overrides;
    if (busy && !ovOpened) ((ovBox as HTMLDetailsElement).open = true), (ovOpened = true);
    if (!busy) ovOpened = false;
    const ov = machine.status.ov;
    ovVal.feed.textContent = `${ov ? ov[0] : 100} %`;
    ovVal.power.textContent = `${ov ? ov[2] : 100} %`;
    ovVal.feed.classList.toggle('changed', !!ov && ov[0] !== 100);
    ovVal.power.classList.toggle('changed', !!ov && ov[2] !== 100);
    rapidBtns.forEach((b, i) => b.classList.toggle('cur', (ov ? ov[1] : 100) === [25, 50, 100][i]));
    airBtn.classList.toggle('cur', /[FM]/.test(machine.status.acc));
    const pins = on ? pinNames(machine.status.pins) : [];
    pinTxt.textContent = pins.length ? t('Aktive Eingänge: {pins}', { pins: pins.join(', ') }) : '';
    pinTxt.hidden = !pins.length;
    startFrom.value = device.startFrom;
    originBtns.forEach((b, k) => b.classList.toggle('cur', k === device.jobOrigin));
    originGrid.classList.toggle('disabled', device.startFrom === 'absolute');
    framePointerB.classList.toggle('cur', device.frameView !== 'tool');
    frameToolB.classList.toggle('cur', device.frameView === 'tool');
    frameViewRow.hidden = !device.pointerOffset?.enabled;
  };
  machine.on((e) => {
    if (e.type === 'done') notify(e.message, !e.ok);
    if (e.type === 'config' || e.type === 'connection') fillOutputs();
    if (e.type !== 'line') refresh();
  });
  uploadListeners.add(refresh);
  deviceListeners.add(() => (fillDevices(), fillPorts(), refresh()));
  fillDevices();
  // Fortschrittstext auch ohne neue Ereignisse aktualisieren (vergangene Zeit)
  setInterval(() => machine.running && refresh(), 1000);
  refresh();
  return root;
}

// ---------- Verschieben ----------

function moveTab(ed: Editor): HTMLElement {
  const root = h('div', { class: 'move-tab' });
  const st = { step: 10, speed: 3000 };
  const jog = (dx: number, dy: number) => {
    if (!machine.connected) return notify(t('Nicht verbunden.'), true);
    for (const l of jogLines(device, dx * st.step, dy * st.step, st.speed)) machine.send(l);
  };
  const pad = h('div', { class: 'jog' });
  const arrows: [number, number, string][] = [
    [-1, 1, '↖'], [0, 1, '↑'], [1, 1, '↗'],
    [-1, 0, '←'], [0, 0, '⌖'], [1, 0, '→'],
    [-1, -1, '↙'], [0, -1, '↓'], [1, -1, '↘'],
  ];
  for (const [dx, dy, label] of arrows) {
    const b = h('button', {
      class: 'btn',
      title: dx || dy ? t('{step} mm verfahren', { step: st.step }) : t('Zum Nullpunkt fahren'),
      onclick: () => (dx || dy ? jog(dx, dy) : sendAll(moveLines(device, 'X0 Y0'))),
    }, label) as HTMLButtonElement;
    // Hold-to-Jog (#10): Halten fährt (nur $J-Firmwares), Loslassen stoppt per Jog-Cancel.
    // Sonst und bei kurzem Klick bleibt es beim Einzelschritt (heutiges Verhalten).
    if (dx || dy) {
      let timer = 0;
      let held = false;
      let suppress = false;
      const stop = () => {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (held) { held = false; b.classList.remove('held'); void machine.realtime(0x85); suppress = true; }
      };
      b.onpointerdown = (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (!jogHoldSupported(device) || !machine.connected) return;
        timer = window.setTimeout(() => {
          timer = 0; held = true; b.classList.add('held');
          for (const l of jogHoldLines(device, dx * st.step, dy * st.step, st.speed)) machine.send(l);
        }, 250);
      };
      b.onpointerup = stop;
      b.onpointercancel = stop;
      b.onpointerleave = () => { if (held) stop(); else if (timer) { clearTimeout(timer); timer = 0; } };
      b.addEventListener('click', (e) => { if (suppress) { suppress = false; e.stopImmediatePropagation(); } }, true);
    }
    pad.append(b);
  }
  const stepSel = h('select', { onchange: (e: Event) => (st.step = Number((e.target as HTMLSelectElement).value)) },
    ...[0.1, 1, 5, 10, 50, 100].map((v) => h('option', { value: String(v), selected: v === st.step }, `${dec(String(v))} mm`)),
  );
  const speed = numInput('', (v) => v > 0 && (st.speed = v), t('Geschwindigkeit in mm/min'));
  speed.value = String(st.speed);
  const pos = h('div', { class: 'move-pos' });
  const toSelection = () => {
    const b = ed.selBounds();
    if (!b) return notify(t('Keine Auswahl.'), true);
    const box = { x0: b.x, y0: ed.doc.bed.h - b.y - b.h, x1: b.x + b.w, y1: ed.doc.bed.h - b.y };
    const a = anchorOf(box, device.jobOrigin);
    // Zeiger-Modus (#213): Je nach Stellung landet Rotpunkt oder Werkzeug auf der Auswahl.
    const po = posShift(device);
    sendAll(moveLines(device, `X${(a.x - po.x).toFixed(3)} Y${(a.y - po.y).toFixed(3)}`));
  };
  // Laser zur Klickposition: teilt sich den Zustand mit dem Toolbar-Knopf (linke Leiste).
  posPickSpeed.set(ed, () => st.speed);
  const clickB = h('button', {
    class: 'btn', title: t('Danach fährt jeder Klick auf die Arbeitsfläche den Laser dorthin (Esc beendet)'),
    onclick: () => togglePositionPick(ed),
  }, t('Laser zur Klickposition')) as HTMLButtonElement;
  const syncClickB = () => clickB.classList.toggle('on', isPositionPick(ed));
  if (!posPickListeners.get(ed)) posPickListeners.set(ed, new Set());
  posPickListeners.get(ed)!.add(syncClickB);
  syncClickB();
  const modeRow = buildFrameViewRow().row;
  const setO = h('button', { class: 'btn', title: t('Werkstück-Nullpunkt an die aktuelle Position legen'), onclick: () => machine.send(fw().setOrigin) }, t('Ursprung hier setzen')) as HTMLButtonElement;
  const clearO = h('button', { class: 'btn', title: t('Werkstück-Nullpunkt auf den Maschinen-Nullpunkt zurücksetzen'), onclick: () => fw().clearOrigin && machine.send(fw().clearOrigin!) }, t('Ursprung löschen')) as HTMLButtonElement;
  const unlock = h('button', { class: 'btn', title: t('Alarm aufheben'), onclick: () => fw().unlock && machine.send(fw().unlock!) }, t('Entsperren')) as HTMLButtonElement;
  // Z (nur mit motorischer Z-Achse): eigene Schrittweite/Geschwindigkeit, strenge Gates, kein Fokusbezug
  const zst = { step: 0.1, speed: 60 };
  const zKnown = () => {
    const p = machine.status.wpos;
    return !!p && Number.isFinite(p[2]);
  };
  const zBlocker = (): string | null => {
    if (machine.fire.locked) return fireLockMessage();
    if (!machine.connected || machine.running) return t('Nicht verbunden oder Maschine beschäftigt.');
    if (device.fw !== 'marlin' && machine.status.state !== 'Idle') return t('Z-Jog nur bei Stillstand (Idle).');
    if (!zKnown()) return t('Position unbekannt. Auf eine gültige Positionsmeldung warten.');
    if ((device.zJogStrict ?? true) && !machine.homed) return t('Z-Achse noch nicht referenziert. Erst eine Referenzfahrt ausführen — oder in den Geräteeinstellungen „Z-Jog nur nach Referenzfahrt“ ausschalten.');
    if (rotaryOn(device) && device.rotary.axis === 'Z') return t('Drehachse auf Z: Z-Jog ist im Drehachsenmodus blockiert.');
    if (!(zst.step > 0) || !(zst.speed >= 1)) return t('Positive Schrittweite und Geschwindigkeit (mindestens 1 mm/min) eingeben.');
    return null;
  };
  const zJog = (dir: 1 | -1) => {
    const why = zBlocker();
    if (why) return notify(why, true);
    for (const l of zJogLines(device, dir * zst.step, zst.speed)) machine.send(l);
  };
  const zStepSel = h('select', { onchange: (e: Event) => (zst.step = Number((e.target as HTMLSelectElement).value)) },
    ...[0.1, 0.5, 1, 5].map((v) => h('option', { value: String(v), selected: v === zst.step }, `${dec(String(v))} mm`)),
  );
  const zSpeed = numInput('', (v) => v > 0 && (zst.speed = v), t('Geschwindigkeit in mm/min'));
  zSpeed.value = String(zst.speed);
  const zMinus = h('button', { class: 'btn', title: t('Negative Steuerungsrichtung Z verfahren'), onclick: () => zJog(-1) }, 'Z−') as HTMLButtonElement;
  const zPlus = h('button', { class: 'btn', title: t('Positive Steuerungsrichtung Z verfahren'), onclick: () => zJog(1) }, 'Z+') as HTMLButtonElement;
  const zSection = h('div', { class: 'move-row' }, zMinus, zPlus,
    h('div', { class: 'form move-form' },
      h('label', {}, t('Schritt')), zStepSel,
      h('label', {}, 'mm/min'), zSpeed,
    ),
  );
  const zNote = h('div', { class: 'note' }, t('Z+/Z− verfahren die Achse in Steuerungsrichtung (unabhängig von „Z+ fährt Richtung Material“). Freiraum prüfen. Hinweis Kopfkamera: Nach einer Z-Fahrt stimmt der Maßstab des Kamera-Overlays nicht mehr.'));
  const fire = fireControls(() => device, () => openDeviceDialog(ed, device, undefined, 'fire'));
  root.append(
    pos,
    h('div', { class: 'move-row' }, pad,
      h('div', { class: 'form move-form' },
        h('label', {}, t('Schritt')), stepSel,
        h('label', {}, 'mm/min'), speed,
      ),
    ),
    zSection,
    zNote,
    h('div', { class: 'move-buttons' },
      setO,
      clearO,
      h('button', { class: 'btn', title: t('Laser zum Job-Ursprung der Auswahl fahren (absolute Koordinaten)'), onclick: toSelection }, t('Laser zur Auswahl')),
      clickB,
      unlock,
    ),
    fire.root,
    modeRow,
  );
  const refresh = () => {
    const s = machine.status;
    pos.textContent = machine.connected && s.wpos
      ? t('Position X {x}  Y {y} mm', { x: dec(s.wpos[0].toFixed(2)), y: dec(s.wpos[1].toFixed(2)) }) + (device.zAxis && Number.isFinite(s.wpos[2]) ? `  Z ${dec(s.wpos[2].toFixed(2))}` : '') + (s.mpos && (Math.abs(s.mpos[0] - s.wpos[0]) > 1e-3 || Math.abs(s.mpos[1] - s.wpos[1]) > 1e-3) ? t(' (Maschine {x} / {y})', { x: dec(s.mpos[0].toFixed(2)), y: dec(s.mpos[1].toFixed(2)) }) : '')
      : t('Nicht verbunden');
    root.querySelectorAll('button').forEach((b) => {
      if (!fire.root.contains(b)) b.disabled = !machine.connected || machine.running || machine.fire.locked;
    });
    zSection.hidden = !device.zAxis;
    zNote.hidden = !device.zAxis;
    const zWhy = device.zAxis ? zBlocker() : null;
    zMinus.disabled = zPlus.disabled = !machine.connected || machine.running || !!zWhy;
    // Der Zeiger-Modus ist kein Fahrbefehl und bleibt immer verstellbar.
    modeRow.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = false));
    syncClickB();
    if (!fw().clearOrigin) clearO.disabled = true;
    if (!fw().unlock) unlock.disabled = true;
    fire.refresh();
  };
  machine.on((e) => e.type !== 'line' && refresh());
  deviceListeners.add(refresh);
  refresh();
  return root;
}

// ---------- Konsole ----------

function consoleTab(): HTMLElement {
  const root = h('div', { class: 'console-tab' });
  const log = h('div', { class: 'console-log' });
  const input = h('input', { type: 'text', placeholder: t('Befehl, z. B. $I oder G0 X10'), spellcheck: false }) as HTMLInputElement;
  const history: string[] = [];
  let hi = 0;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) {
      const v = input.value.trim();
      history.push(v);
      hi = history.length;
      input.value = '';
      if (v === '?' && liveStatus(fw())) machine.realtime(0x3f);
      else machine.send(v);
    } else if (e.key === 'ArrowUp' && hi > 0) {
      e.preventDefault();
      input.value = history[--hi];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      hi = Math.min(history.length, hi + 1);
      input.value = history[hi] ?? '';
    }
  });
  const quick = (label: string, cmd: string, title: string) => h('button', { class: 'btn', title, onclick: () => machine.send(cmd) }, label);
  const quickRow = h('div', { class: 'console-quick' });
  // Schnellknöpfe passend zur Firmware des gewählten Geräts
  const fillQuick = () => {
    quickRow.textContent = '';
    const f = fw();
    if (device.fw === 'marlin') quickRow.append(quick('M115', 'M115', t('Firmware-Version')), quick('M114', 'M114', t('Position')), quick('M503', 'M503', t('Einstellungen anzeigen')));
    else {
      if (f.unlock) quickRow.append(quick(f.unlock, f.unlock, t('Entsperren')));
      quickRow.append(quick(f.home, f.home, t('Referenzfahrt')));
      if (device.fw !== 'smoothie') quickRow.append(quick('$I', '$I', t('Version und Gerät')), quick('$$', '$$', t('Einstellungen anzeigen')));
    }
    quickRow.append(h('button', { class: 'btn', title: t('Konsole leeren'), onclick: () => (log.textContent = '') }, t('Leeren')));
  };
  fillQuick();
  deviceListeners.add(fillQuick);
  root.append(log, h('div', { class: 'console-input' }, input), quickRow);
  machine.on((e) => {
    if (e.type !== 'line') return;
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.append(h('div', { class: `ln ${e.dir}` }, e.dir === 'out' ? `> ${e.line}` : e.line));
    while (log.childElementCount > 1000) log.firstChild!.remove();
    if (atEnd) log.scrollTop = log.scrollHeight;
  });
  if (!isTauri()) machine.log(t('Im Browser gibt es keine Maschinenanbindung. Vorschau und G-Code speichern funktionieren.'));
  return root;
}

// ---------- Geräteeinstellungen ----------

// Merkt sich den zuletzt geöffneten Tab des Einstellungsdialogs (nur UI-Zustand).
let lastDeviceTab = 0;

/** Einstellungen eines Geräts bearbeiten (ohne Angabe: das gewählte) */
function deviceEditBlocked(): boolean {
  if (!machine.fire.locked) return false;
  notify(fireLockMessage(), true);
  return true;
}

export function openDeviceDialog(ed: Editor, target: Device = device, onDone?: () => void, initialSection?: 'fire') {
  if (deviceEditBlocked()) return;
  const d = { ...target, energy: energyDraft(target.energy) };
  const bed = { w: d.bedW, h: d.bedH };
  const isCurrent = target === device;
  // FR #235: Tabs statt Scroll-Liste — gleiche Felder, gleiche Speicherung, nur sortiert.
  const tabs: { label: string; rows: (HTMLElement | string)[] }[] = [];
  let rows: (HTMLElement | string)[] = [];
  const newTab = (label: string) => {
    rows = [];
    tabs.push({ label, rows });
  };
  const num = (label: string, get: () => number, set: (v: number) => void, title?: string) => {
    const el = numInput('', (v) => v > 0 && set(v), title);
    el.value = String(get());
    rows.push(h('label', { title }, label), el);
    return el;
  };
  const text = (label: string, get: () => string, set: (v: string) => void) => {
    const el = h('input', { type: 'text', value: get(), oninput: (e: Event) => set((e.target as HTMLInputElement).value) }) as HTMLInputElement;
    rows.push(h('label', {}, label), el);
  };
  const bool = (label: string, get: () => boolean, set: (v: boolean) => void, title?: string) => {
    const el = h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
    rows.push(h('label', { title }, label), h('span', {}, el));
  };
  const head = (txt: string) => {
    const el = h('div', { class: 'sub' }, txt);
    rows.push(el);
    return el;
  };
  /** Zahleneingabe mit 0-Sinn (leer/0/ungültig = unset = heutiges Verhalten), optional gedeckelt */
  const optNum = (label: string, get: () => number | undefined, set: (v: number | undefined) => void, title?: string, max?: number) => {
    const el = numInput('', (v) => set(!Number.isFinite(v) || v <= 0 ? undefined : max === undefined ? v : Math.min(v, max)), title);
    el.value = get() === undefined ? '' : String(get());
    rows.push(h('label', { title }, label), el);
    return el;
  };
  const ruidaEls: HTMLElement[] = [];
  const nonRuidaEls: HTMLElement[] = [];
  newTab(t('Allgemein'));
  text(t('Name'), () => d.name, (v) => (d.name = v));
  text(t('Dateiname für Controller-Uploads'), () => d.uploadName ?? '', (v) => (d.uploadName = v.trim() || undefined));
  bool(t('Dateiname hochzählen'), () => d.uploadIncrement ?? false, (v) => (d.uploadIncrement = v), t('Pro Upload _2, _3 … anhängen (braucht eine Ziffer im Namen). Aus = überschreiben wie bisher.'));
  bool(t('Start sperren'), () => d.startLocked ?? false, (v) => (d.startLocked = v), t('Start- und Rahmen-Buttons bleiben gesperrt, bis die Sperre hier aufgehoben wird.'));
  const sMaxRef: { el?: HTMLInputElement; lab?: HTMLElement } = {};
  const fwSel = h('select', {
    onchange: (e: Event) => {
      const old = FIRMWARES[d.fw];
      d.fw = (e.target as HTMLSelectElement).value as Firmware;
      // Leistungsskala mitziehen, wenn sie noch dem Standard der alten Firmware entsprach
      if (d.sMax === old.sMax && sMaxRef.el) ((d.sMax = FIRMWARES[d.fw].sMax), (sMaxRef.el.value = String(d.sMax)));
      readBtn.disabled = !canRead();
      syncFw();
    },
  }, ...(Object.keys(FIRMWARES) as Firmware[]).map((k) => h('option', { value: k, selected: k === d.fw }, FIRMWARES[k].label))) as HTMLSelectElement;
  rows.push(h('label', {}, t('Steuerung (Firmware)')), fwSel);
  const bw = num(t('Breite (mm)'), () => bed.w, (v) => (bed.w = v), t('Arbeitsbereich X'));
  const bh = num(t('Höhe (mm)'), () => bed.h, (v) => (bed.h = v), t('Arbeitsbereich Y'));
  {
    const title = t('GRBL $30 bzw. FluidNC speed_map (meist 1000), Marlin meist 255, Smoothieware 1');
    const lab = h('label', { title }, t('S-Wert für 100 %'));
    const el = numInput('', (v) => v > 0 && (d.sMax = v), title);
    el.value = String(d.sMax);
    rows.push(lab, el);
    sMaxRef.el = el;
    sMaxRef.lab = lab;
    nonRuidaEls.push(lab, el);
  }
  {
    const ruidaHead = head('Ruida DSP');
    const origLab = h('label', { title: t('Ecke des Arbeitsbereichs, in der die Ruida-Steuerung ihren Maschinennullpunkt (0, 0) hat') }, t('Maschinennullpunkt'));
    const origSel = h('select', { onchange: (e: Event) => (d.ruidaOrigin = (e.target as HTMLSelectElement).value as RuidaOrigin) },
      h('option', { value: 'top-right', selected: (d.ruidaOrigin ?? 'top-right') === 'top-right' }, t('Hinten rechts (Standard)')),
      h('option', { value: 'top-left', selected: d.ruidaOrigin === 'top-left' }, t('Hinten links')),
      h('option', { value: 'bottom-left', selected: d.ruidaOrigin === 'bottom-left' }, t('Vorne links')),
      h('option', { value: 'bottom-right', selected: d.ruidaOrigin === 'bottom-right' }, t('Vorne rechts')),
    );
    const magicLab = h('label', { title: t('Byte-Verschleierung für .rd-Dateien und Direktverbindung (meist 0x88 für RDC6442/RDC6445)') }, t('Paket-Codierung (Magic)'));
    const magicSel = h('select', { onchange: (e: Event) => (d.ruidaMagic = (e.target as HTMLSelectElement).value as RuidaMagic) },
      h('option', { value: 'auto', selected: (d.ruidaMagic ?? '88') === 'auto' }, t('Automatisch erkennen')),
      h('option', { value: '88', selected: (d.ruidaMagic ?? '88') === '88' }, '0x88 (RDC6442 / RDC6445)'),
      h('option', { value: '11', selected: d.ruidaMagic === '11' }, '0x11 (RDC6342G / 634XG)'),
      h('option', { value: '38', selected: d.ruidaMagic === '38' }, '0x38 (RDL9635)'),
    );
    const laserLab = h('label', { title: t('Welche Laserröhre im Auftrag angesteuert wird') }, t('Laserröhre'));
    const laserSel = h('select', { onchange: (e: Event) => (d.ruidaLaser = (e.target as HTMLSelectElement).value as RuidaLaser) },
      h('option', { value: '1', selected: (d.ruidaLaser ?? '1') === '1' }, t('Laser 1')),
      h('option', { value: '2', selected: d.ruidaLaser === '2' }, t('Laser 2')),
      h('option', { value: 'both', selected: d.ruidaLaser === 'both' }, t('Laser 1 + 2')),
    );
    const ruidaNote = h('div', { class: 'note wide' }, t('Ruida-Direktsteuerung ist experimentell: Vor dem ersten Auftrag Fahrtrichtungen, Nullpunkt und Rahmen prüfen. Für den Dateiexport über RDWorks oder USB-Stick genügt „.rd speichern“.'));
    rows.push(origLab, origSel, magicLab, magicSel, laserLab, laserSel, ruidaNote);
    ruidaEls.push(ruidaHead, origLab, origSel, magicLab, magicSel, laserLab, laserSel, ruidaNote);
  }
  head(t('Lasermodul'));
  {
    const laserTip = t('Nur zur Information, z. B. für passende Materialeinstellungen; ändert den G-Code nicht');
    const setLaser = (patch: Partial<LaserModule>) => {
      const m: LaserModule = { ...d.laser, ...patch };
      for (const k of Object.keys(m) as (keyof LaserModule)[]) if (m[k] === undefined) delete m[k];
      d.laser = Object.keys(m).length ? m : undefined;
    };
    rows.push(h('label', { title: laserTip }, t('Art')), h('select', { onchange: (e: Event) => setLaser({ type: ((e.target as HTMLSelectElement).value || undefined) as LaserType | undefined }) },
      h('option', { value: '', selected: !d.laser?.type }, t('unbekannt')),
      ...LASER_TYPES.map((k) => h('option', { value: k, selected: d.laser?.type === k }, laserTypeLabel(k))),
    ));
    const opt = (label: string, get: () => number | undefined, set: (v: number | undefined) => void) => {
      const el = h('input', { type: 'text', inputmode: 'decimal', value: String(get() ?? ''), placeholder: t('unbekannt'), oninput: (e: Event) => {
        const v = parseFloat((e.target as HTMLInputElement).value.replace(/,/g, '.'));
        set(Number.isFinite(v) && v > 0 ? v : undefined);
      } });
      rows.push(h('label', { title: laserTip }, label), el);
    };
    opt(t('Optische Leistung (W)'), () => d.laser?.power, (v) => setLaser({ power: v }));
    opt(t('Wellenlänge (nm)'), () => d.laser?.wavelength, (v) => setLaser({ wavelength: v === undefined ? undefined : Math.round(v) }));
  }
  head(t('Bewegung (für die Zeitschätzung)'));
  const rapid = num(t('Eilgang (mm/min)'), () => d.rapid, (v) => (d.rapid = v));
  const accel = num(t('Beschleunigung (mm/s²)'), () => d.accel, (v) => (d.accel = v));
  optNum(t('Leerfahrt über Leeres (mm/min)'), () => d.whitespaceSpeed, (v) => (d.whitespaceSpeed = v), t('Höhere Verfahrgeschwindigkeit über leeren Bildbereichen (nur GRBL/Marlin/FluidNC). Leer oder 0 = Eilgang wie bisher.'), 100000);
  bool(t('Nach dem Job zurück zum Start'), () => d.returnHome, (v) => (d.returnHome = v));
  {
    const modeLabel = t('Ziel nach dem Job');
    const modeSel = h('select', { onchange: (e: Event) => { d.finishMode = (e.target as HTMLSelectElement).value as FinishMode; syncFinishXY(); } },
      h('option', { value: 'start', selected: (d.finishMode ?? (d.returnHome === false ? 'stay' : 'start')) === 'start' }, t('Zum Laserstart')),
      h('option', { value: 'origin', selected: (d.finishMode ?? '') === 'origin' }, t('Zum Ursprung (0,0)')),
      h('option', { value: 'stay', selected: (d.finishMode ?? (d.returnHome === false ? 'stay' : '')) === 'stay' }, t('Verweilen')),
      h('option', { value: 'custom', selected: (d.finishMode ?? '') === 'custom' }, t('Eigene XY')),
    ) as HTMLSelectElement;
    const xLab = h('label', {}, t('Ziel-X (mm)'));
    const xEl = numInput('', (v) => (d.finishX = Number.isFinite(v) ? v : undefined));
    xEl.value = d.finishX === undefined ? '' : String(d.finishX);
    const yLab = h('label', {}, t('Ziel-Y (mm)'));
    const yEl = numInput('', (v) => (d.finishY = Number.isFinite(v) ? v : undefined));
    yEl.value = d.finishY === undefined ? '' : String(d.finishY);
    const syncFinishXY = () => {
      const show = (d.finishMode ?? (d.returnHome === false ? 'stay' : 'start')) === 'custom';
      for (const el of [xLab, xEl, yLab, yEl]) el.style.display = show ? '' : 'none';
    };
    modeSel.addEventListener('change', syncFinishXY);
    rows.push(h('label', { title: t('Wohin der Kopf nach dem Job fährt (nur Absolut- und Benutzer-Position).') }, modeLabel), modeSel, xLab, xEl, yLab, yEl);
    syncFinishXY();
  }
  head(t('Achsen'));
  bool(t('Motorische Z-Achse vorhanden'), () => d.zAxis, (v) => (d.zAxis = v), t('Layer dürfen den Fokus verschieben (Z-Versatz, tiefer je Durchgang). Z fährt relativ zur Höhe beim Start und am Ende zurück.'));
  optNum(t('Materialhöhe (mm)'), () => d.zMaterial, (v) => (d.zMaterial = v), t('Vertrag für den Z-Verfahrweg: warnt, wenn der Fokus tiefer als das Material fahren würde. 0 oder leer = kein Vertrag.'));
  bool(t('Z+ fährt Richtung Material'), () => d.zFlip, (v) => (d.zFlip = v), t('Einschalten, wenn bei dieser Maschine positive Z-Werte den Tisch anheben oder den Kopf absenken'));
  bool(t('Z-Jog nur nach Referenzfahrt'), () => d.zJogStrict ?? true, (v) => (d.zJogStrict = v), t('Bewegen-Fenster: Z-Tasten bleiben gesperrt, bis einmal referenziert wurde (pro Verbindung). Aus = lax: dann genügt eine bekannte Position.'));
  rows.push(h('label', {}, t('Drehachse')), h('span', {}, h('button', { class: 'btn small', onclick: () => openRotaryDialog() }, t('Drehachse (Rotary) …'))));
  {
    const airHead = head(t('Air Assist & Ausgänge'));
    const airLab = h('label', { title: t('Wird auf Layern mit „Air Assist“ vor dem Lasern gesendet, ausgeschaltet wird mit M9') }, t('Einschalten mit'));
    const airSel = h('select', { onchange: (e: Event) => (d.airCmd = (e.target as HTMLSelectElement).value as Device['airCmd']) },
      h('option', { value: 'M8', selected: d.airCmd !== 'M7' }, t('M8 (Flood, üblich)')),
      h('option', { value: 'M7', selected: d.airCmd === 'M7' }, 'M7 (Mist)'),
    );
    const outsLab = h('label', { title: t('Digitale Ausgänge (user_outputs, M64/M65 P…), die während jedes Jobs an sind, z. B. Absaugung') }, t('Ausgänge im Job'));
    const outsIn = h('input', {
      type: 'text', value: d.jobOutputs.join(', '), placeholder: t('z. B. 0, 1'),
      onchange: (e: Event) => {
        const el = e.target as HTMLInputElement;
        d.jobOutputs = [...new Set(el.value.split(/[\s,;]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 8))];
        el.value = d.jobOutputs.join(', ');
      },
    }) as HTMLInputElement;
    rows.push(airLab, airSel, outsLab, outsIn);
    nonRuidaEls.push(airHead, airLab, airSel, outsLab, outsIn);
  }
  rows.push(h('div', { class: 'note wide' }, t('Startreferenz und Job-Ursprung stehen im Laser-Fenster.')));
  newTab(t('Verbindung|Gerät'));
  const connTcpOpt = h('option', { value: 'tcp', selected: d.conn === 'tcp' }, t('WLAN (Telnet)')) as HTMLOptionElement;
  const connWsOpt = h('option', { value: 'ws', selected: d.conn === 'ws' }, t('WLAN (WebSocket)')) as HTMLOptionElement;
  const connSel: HTMLSelectElement = h('select', { onchange: (e: Event) => (d.conn = (e.target as HTMLSelectElement).value as Device['conn']) },
    h('option', { value: 'serial', selected: d.conn === 'serial' }, t('USB (seriell)')),
    connTcpOpt,
    connWsOpt,
    h('option', { value: 'remote', selected: d.conn === 'remote' }, t('Anderer KizamuBeam (Netzwerk)')),
  ) as HTMLSelectElement;
  rows.push(h('label', {}, t('Anschluss')), connSel);
  // Schnittstelle frei eintragbar (z. B. COM3, /dev/ttyUSB0), erkannte Schnittstellen als Vorschlag
  const portList = h('datalist', { id: `ports-${Math.random().toString(36).slice(2)}` });
  const portIn = h('input', { type: 'text', value: d.port, placeholder: t('z. B. COM3 oder /dev/ttyUSB0'), oninput: (e: Event) => (d.port = (e.target as HTMLInputElement).value.trim()) });
  portIn.setAttribute('list', portList.id);
  rows.push(h('label', { title: t('Feste USB-Schnittstelle dieses Geräts') }, t('USB-Schnittstelle')), portIn, portList);
  machine.ports().then((ps) => ps.forEach((p) => portList.append(h('option', { value: p.name }, p.description || p.name)))).catch(() => {});
  const baudLab = h('label', {}, t('Baudrate'));
  const baud = h('select', { onchange: (e: Event) => (d.baud = Number((e.target as HTMLSelectElement).value)) },
    ...[57600, 115200, 230400, 250000, 460800, 921600].map((b) => h('option', { value: String(b), selected: b === d.baud }, String(b))),
  );
  rows.push(baudLab, baud);
  nonRuidaEls.push(baudLab, baud);
  const dtrLab = h('label', { title: t('DTR-Signal beim Öffnen der USB-Schnittstelle. Auto = unverändert (heutiges Verhalten).') }, t('DTR-Signal'));
  const dtrSel = h('select', { onchange: (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    d.dtr = v === 'auto' ? undefined : v === 'on';
  } },
    h('option', { value: 'auto', selected: d.dtr === undefined }, t('Automatisch')),
    h('option', { value: 'on', selected: d.dtr === true }, t('An')),
    h('option', { value: 'off', selected: d.dtr === false }, t('Aus')),
  ) as HTMLSelectElement;
  rows.push(dtrLab, dtrSel);
  nonRuidaEls.push(dtrLab, dtrSel);
  const hostIn = h('input', { type: 'text', value: d.host, oninput: (e: Event) => (d.host = (e.target as HTMLInputElement).value.trim()) }) as HTMLInputElement;
  const fluidDiscoverBtn = h('button', {
    class: 'btn small', title: t('FluidNC-Steuerungen im lokalen Netzwerk suchen'),
    onclick: () => import('./fluidncDialog').then((m) => m.openDiscovery(d.httpPort || 80, (host) => ((d.host = host), (hostIn.value = host)))),
  }, t('Suchen …'));
  rows.push(h('label', {}, t('WLAN-Adresse')), h('span', { class: 'conn-row' }, hostIn, fluidDiscoverBtn));
  {
    const rPortTitle = t('UDP-Zielport der Ruida-Steuerung (Standard 50200)');
    const rPortLab = h('label', { title: rPortTitle }, t('UDP-Datenport'));
    const rPortEl = numInput('', (v) => v > 0 && v <= 65535 && (d.ruidaPort = Math.round(v)), rPortTitle);
    rPortEl.value = String(d.ruidaPort || 50200);
    const jPortTitle = t('UDP-Port für Ruida-Tastenbefehle (Standard 50207, 0 = aus)');
    const jPortLab = h('label', { title: jPortTitle }, t('UDP-Tastenport'));
    const jPortEl = numInput('', (v) => v >= 0 && v <= 65535 && (d.ruidaJogPort = Math.round(v)), jPortTitle);
    jPortEl.value = String(d.ruidaJogPort ?? 50207);
    rows.push(rPortLab, rPortEl, jPortLab, jPortEl);
    ruidaEls.push(rPortLab, rPortEl, jPortLab, jPortEl);
  }
  {
    const tcpEl = num(t('Telnet-Port'), () => d.tcpPort, (v) => (d.tcpPort = Math.round(v)));
    const tcpLab = rows[rows.length - 2] as HTMLElement;
    const wsEl = num(t('WebSocket-Port'), () => d.wsPort, (v) => (d.wsPort = Math.round(v)), t('FluidNC: 81; ist er nicht erreichbar, wird 80 versucht'));
    const wsLab = rows[rows.length - 2] as HTMLElement;
    const httpEl = num(t('Web-Port'), () => d.httpPort, (v) => (d.httpPort = Math.round(v)), t('Weboberfläche von FluidNC (meist 80): zum Hochladen auf SD-Karte/Flash und für die Suche'));
    const httpLab = rows[rows.length - 2] as HTMLElement;
    nonRuidaEls.push(tcpLab, tcpEl, wsLab, wsEl, httpLab, httpEl);
  }
  // Remote KizamuBeam: host address is the network address above
  const remotePortIn = num(t('Host-Port'), () => d.remotePort, (v) => (d.remotePort = Math.round(v)), t('Port eines anderen KizamuBeam im Host-Modus (Standard 47900)'));
  const pairState = h('span', { class: 'note' });
  const showPair = async () => {
    const name = await pairedHost(d.remoteFp);
    pairState.textContent = name ? t('Gekoppelt mit {host}', { host: name }) : t('Nicht gekoppelt');
    forgetBtn.hidden = !name;
  };
  const forgetBtn = h('button', {
    class: 'btn small', title: t('Den Schlüssel für diesen Host auf diesem Rechner löschen'),
    onclick: async () => {
      if (!confirm(t('Kopplung mit diesem Host auf diesem Rechner aufheben?'))) return;
      await forgetHost(d.remoteFp).catch(() => {});
      d.remoteFp = '';
      void showPair();
    },
  }, t('Aufheben')) as HTMLButtonElement;
  const pair = async () => {
    const r = await openPairDialog(d.host, d.remotePort);
    if (!r) return;
    d.remoteFp = r.fingerprint;
    d.conn = 'remote';
    connSel.value = 'remote';
    void showPair();
  };
  rows.push(h('label', { title: t('Laser an einem anderen Rechner mit KizamuBeam steuern. Dort unter Laser → Fernsteuerung den Host-Modus einschalten.') }, t('Kopplung')),
    h('span', { class: 'conn-row' }, pairState,
      h('button', {
        class: 'btn small', title: t('Rechner im Host-Modus im lokalen Netzwerk suchen'),
        onclick: async () => {
          const f = await openHostDiscovery(d.remotePort || 47900);
          if (!f) return;
          d.host = hostIn.value = f.host;
          d.remotePort = f.port;
          remotePortIn.value = String(f.port);
          d.conn = 'remote';
          connSel.value = 'remote';
          // Already paired on this computer: use the stored key, otherwise pair right away
          if (f.paired) {
            d.remoteFp = f.fingerprint;
            void showPair();
          } else await pair();
        },
      }, t('Host suchen …')),
      h('button', { class: 'btn small', onclick: pair }, t('Koppeln …')),
      forgetBtn));
  void showPair();
  // Empfangspuffer für die Zeichenzählung; größer = flüssiger bei vielen kurzen Zeilen (Bildgravur)
  const bufNote = h('div', { class: 'note wide' });
  const bufSel = h('select', { onchange: (e: Event) => (d.rxBuffer = Number((e.target as HTMLSelectElement).value)) },
    ...[127, 256, 512, 1024].map((b) => h('option', { value: String(b), selected: b === d.rxBuffer }, b === 127 ? t('127 Bytes (sicher)') : t('{n} Bytes', { n: b }))),
  ) as HTMLSelectElement;
  if (![127, 256, 512, 1024].includes(d.rxBuffer)) bufSel.append(h('option', { value: String(d.rxBuffer), selected: true }, t('{n} Bytes', { n: d.rxBuffer })));
  const measureBuf = () => {
    const bf = machine.status.bf;
    if (!isCurrent || !machine.connected) return void (bufNote.textContent = t('Zum Messen erst verbinden.'));
    if (machine.running || machine.status.state !== 'Idle') return void (bufNote.textContent = t('Zum Messen muss die Maschine still stehen.'));
    if (!bf) return void (bufNote.textContent = t('Die Steuerung meldet ihren Puffer nicht (Bf: im Statusbericht; bei GRBL mit $10=2). Größere Werte nur ausprobieren: treten Fehler oder Aussetzer auf, zurück auf 127.'));
    const free = Math.max(64, bf[1] - 1);
    if (![...bufSel.options].some((o) => o.value === String(free))) bufSel.append(h('option', { value: String(free) }, t('{n} Bytes', { n: free })));
    bufSel.value = String(free);
    d.rxBuffer = free;
    bufNote.textContent = t('Die Steuerung meldet {n} Bytes freien Empfangspuffer; eingestellt auf {m}.', { n: bf[1], m: free });
  };
  {
    const bufLab = h('label', { title: t('Wie viele Zeichen KizamuBeam an die Steuerung schickt, bevor sie bestätigt hat. Wirkt beim nächsten Verbinden.') }, t('Empfangspuffer'));
    const bufRow = h('span', { class: 'conn-row' }, bufSel, h('button', { class: 'btn small', title: t('Pufferstand der verbundenen Steuerung lesen'), onclick: measureBuf }, t('Messen')));
    rows.push(bufLab, bufRow, bufNote);
    nonRuidaEls.push(bufLab, bufRow, bufNote);
  }
  bool(t('Beim Verbinden referenzieren'), () => d.homeOnConnect, (v) => (d.homeOnConnect = v), t('Nach dem Verbinden eine Referenzfahrt starten'));
  rows.push(h('label', { title: t('Ohne Endschalter bietet der Assistent „Laser einrichten“ keine Referenzfahrt an') }, t('Endschalter')), h('select', { onchange: (e: Event) => (d.limitSwitches = (e.target as HTMLSelectElement).value as Device['limitSwitches']) },
    h('option', { value: 'unknown', selected: d.limitSwitches === 'unknown' }, t('Unbekannt')),
    h('option', { value: 'yes', selected: d.limitSwitches === 'yes' }, t('Vorhanden')),
    h('option', { value: 'no', selected: d.limitSwitches === 'no' }, t('Keine')),
  ));
  newTab(t('Rahmen & Zeiger'));
  head(t('Rahmen'));
  num(t('Geschwindigkeit (mm/min)'), () => d.frameSpeed, (v) => (d.frameSpeed = v));
  bool(t('Mit Laser (schwach)'), () => d.frameLaser, (v) => (d.frameLaser = v), t('Rahmen mit niedriger Leistung sichtbar machen'));
  num(t('Leistung (%)'), () => d.framePower, (v) => (d.framePower = Math.min(100, v)));
  head(t('Testfeuer im Bewegen-Fenster'));
  const fireRows = fireSettings(d);
  const fireTabIndex = tabs.length - 1;
  rows.push(...fireRows.rows);
  // Rotpunkt-Zeiger (Issue #213): Versatz je Gerät, mit visueller Darstellung statt Vorzeichenrätsel
  head(t('Rotpunkt-Zeiger (Pointer-Offset)'));
  if (!d.pointerOffset) d.pointerOffset = { x: 0, y: 0, enabled: false }; // Altgeräte aus localStorage/Presets ohne Feld
  const poDiagram = h('div', { class: 'wide pointer-diagram' });
  const poSentence = h('div', { class: 'note wide' });
  const poRotNote = h('div', { class: 'note wide' });
  const poFmt = (v: number) => `${v < 0 ? '' : '+'}${v.toFixed(1)}`;
  const updatePointer = () => {
    const o = d.pointerOffset;
    const s = 4, cx = 110, cy = 60; // px pro mm; Zeigerpunkt in der Mitte
    // Technisch: Diagrammtexte im Geräteeinstellungs-Dialog (Baseline: 9/10/10)
    const fTe = groupFactor(resolveTypography(getTypography()), 'technical');
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const bx = clamp(cx + o.x * s, 14, 206), by = clamp(cy - o.y * s, 14, 106); // +Y = hinten/oben
    setTrustedSvg(
      poDiagram,
      `<svg viewBox="0 0 220 120" width="220" height="120" role="img">` +
      `<rect x="4" y="4" width="212" height="112" fill="none" stroke="currentColor" stroke-opacity="0.3" rx="4"/>` +
      `<text x="10" y="18" font-size="${9 * fTe}" fill="currentColor" fill-opacity="0.6">+Y ↑ · +X →</text>` +
      `<line x1="${cx}" y1="${cy}" x2="${bx}" y2="${by}" stroke="currentColor" stroke-dasharray="4 3"/>` +
      `<circle cx="${cx}" cy="${cy}" r="5" fill="#4da3ff"/>` +
      `<text x="${cx + 9}" y="${cy + 4}" font-size="${10 * fTe}" fill="#4da3ff">${escapeXml(t('Zeiger'))}</text>` +
      `<g stroke="#ff5252" stroke-width="2"><line x1="${bx - 6}" y1="${by}" x2="${bx + 6}" y2="${by}"/><line x1="${bx}" y1="${by - 6}" x2="${bx}" y2="${by + 6}"/></g>` +
      `<text x="${bx + 9}" y="${by + 4}" font-size="${10 * fTe}" fill="#ff5252">${escapeXml(t('Strahl'))}</text></svg>`,
    );
    poSentence.textContent =
      (o.enabled ? '' : t('Derzeit ausgeschaltet. ')) +
      t('Der Strahl trifft {x} mm in X und {y} mm in Y vom Zeigerpunkt entfernt.', { x: poFmt(o.x), y: poFmt(o.y) });
    poRotNote.textContent = rotaryOn(d) ? t('Mit Drehachse wirkt nur X; Y ist abgeschaltet.') : '';
    poRotNote.hidden = !rotaryOn(d);
  };
  const poEnabled = h('input', {
    type: 'checkbox', checked: d.pointerOffset.enabled,
    onchange: (e: Event) => ((d.pointerOffset.enabled = (e.target as HTMLInputElement).checked), updatePointer()),
  });
  rows.push(h('label', { title: t('Versatz aktivieren: Positionieren und Startreferenz (Aktuell/Benutzer) verschieben sich um den Offset') }, t('Zeigerversatz einschalten')), h('span', {}, poEnabled));
  const poNum = (label: string, title: string, get: () => number, set: (v: number) => void) => {
    const max = Math.max(bed.w, bed.h, 1);
    const el = numInput('', (v) => {
      if (!Number.isFinite(v)) return;
      set(Math.max(-max, Math.min(max, v)));
      el.value = dec(get().toFixed(2));
      updatePointer();
    }, title);
    el.value = dec(get().toFixed(2));
    rows.push(h('label', { title }, label), el);
  };
  poNum(t('Versatz X (mm)'), t('Lage des Strahls gegenüber dem Zeigerpunkt in X, aus der Kalibrierung (Position Strahl minus Position Zeiger)'), () => d.pointerOffset.x, (v) => (d.pointerOffset.x = v));
  poNum(t('Versatz Y (mm)'), t('Lage des Strahls gegenüber dem Zeigerpunkt in Y (mit Drehachse ohne Wirkung)'), () => d.pointerOffset.y, (v) => (d.pointerOffset.y = v));
  rows.push(poDiagram, poSentence, poRotNote);
  rows.push(h('div', { class: 'note wide' }, t('Nur für Positionieren, Startreferenz (Aktuelle Position/Benutzer-Ursprung) und Rotpunkt-Framing. Geometrie, Schnitt und G-Code-Export bleiben Werkzeuglaser.')));
  updatePointer();
  // Typografie live nachführen, beim Schließen abmelden
  const offTypo = onTypographyChange(() => updatePointer());
  newTab(t('Energie'));
  const energyTabIndex = tabs.length - 1;
  const energyRows = energySettingsRows(d.energy);
  rows.push(...energyRows);
  newTab(t('G-Code'));
  {
    const fncHead = head('FluidNC');
    const fncLab = h('label', { title: t('Bei WLAN-Aussetzern läuft ein Job von SD-Karte oder Flash weiter; er wird vor dem Start über die Weboberfläche hochgeladen') }, t('Job ausführen'));
    const fncSel = h('select', { onchange: (e: Event) => (d.runFrom = (e.target as HTMLSelectElement).value as Device['runFrom']) },
      h('option', { value: 'stream', selected: d.runFrom === 'stream' }, t('Vom Rechner senden')),
      h('option', { value: 'sd', selected: d.runFrom === 'sd' }, t('Auf SD-Karte laden und dort starten')),
      h('option', { value: 'localfs', selected: d.runFrom === 'localfs' }, t('Im Flash speichern und dort starten')),
    );
    const fncEmpty = h('label', {}, '');
    const fncBtns = h('span', { class: 'conn-row' },
      h('button', { class: 'btn small', title: t('config.yaml der verbundenen Steuerung lesen und ändern'), onclick: () => import('./fluidncDialog').then((m) => m.openFluidConfig()) }, t('Konfiguration …')),
      h('button', { class: 'btn small', title: t('Dateien auf SD-Karte und Flash'), onclick: () => import('./fluidncDialog').then((m) => m.openFluidFiles(ed)) }, t('Dateien …')),
    );
    const scrHead = head(t('G-Code-Skripte'));
    rows.push(fncLab, fncSel, fncEmpty, fncBtns);
    // Move scrHead after fncBtns in rows
    rows.splice(rows.indexOf(scrHead), 1);
    rows.push(scrHead);
    nonRuidaEls.push(fncHead, fncLab, fncSel, fncEmpty, fncBtns, scrHead);
  }
  const script = (label: string, title: string, get: () => string, set: (v: string) => void) => {
    const el = h('textarea', { class: 'script', rows: 3, spellcheck: false, placeholder: t('Eine Zeile je Befehl'), oninput: (e: Event) => set((e.target as HTMLTextAreaElement).value) }) as HTMLTextAreaElement;
    el.value = get();
    const lab = h('label', { class: 'wide', title }, label);
    rows.push(lab, el);
    nonRuidaEls.push(lab, el);
  };
  script(t('Vor dem Job'), t('Wird nach G21, G90 und dem Laser-Modus gesendet, vor der ersten Bewegung'), () => d.startScript, (v) => (d.startScript = v));
  script(t('Nach dem Job'), t('Wird nach dem Ausschalten des Lasers (M5) gesendet, vor dem Programmende'), () => d.endScript, (v) => (d.endScript = v));
  {
    const gcodeNote = h('div', { class: 'note wide' }, t('Gilt für Jobs und gespeicherten G-Code, nicht für Rahmenfahrten. Die Zeilen werden unverändert gesendet.'));
    const ruidaGcodeNote = h('div', { class: 'note wide' }, t('Ruida-Steuerungen verwenden binäre .rd-Aufträge statt G-Code. Start- und Endskripte entfallen.'));
    rows.push(gcodeNote, ruidaGcodeNote);
    nonRuidaEls.push(gcodeNote);
    ruidaEls.push(ruidaGcodeNote);
  }
  const syncFw = () => {
    const isRuida = d.fw === 'ruida';
    for (const el of ruidaEls) el.hidden = !isRuida;
    for (const el of nonRuidaEls) el.hidden = isRuida;
    connTcpOpt.textContent = isRuida ? t('Netzwerk (UDP)') : t('WLAN (Telnet)');
    connWsOpt.hidden = isRuida;
    fluidDiscoverBtn.hidden = isRuida;
    if (isRuida && d.conn === 'ws') {
      d.conn = 'tcp';
      connSel.value = 'tcp';
    }
  };
  syncFw();
  newTab(t('Erweitert'));
  head(t('KI-Agenten'));
  const limit = (label: string, title: string, get: () => number, set: (v: number) => void) => {
    const el = numInput('', (v) => {
      set(v);
      el.value = String(get());
    }, title);
    el.value = String(get());
    rows.push(h('label', { title }, label), el);
  };
  limit(t('Höchste Leistung (%)'), t('Jobs, die ein KI-Agent anfordert, dürfen auf keinem Layer mehr Leistung haben'),
    () => d.agentMaxPower, (v) => (d.agentMaxPower = Math.max(0, Math.min(100, v))));
  limit(t('Kleinste Geschwindigkeit (mm/min)'), t('Jobs, die ein KI-Agent anfordert, dürfen nirgends langsamer sein (0 = keine Grenze)'),
    () => d.agentMinSpeed, (v) => (d.agentMinSpeed = Math.max(0, v)));
  rows.push(h('div', { class: 'note wide' }, t('Gerätevorlagen für neue Geräte stehen im Dialog „Geräte …“.')));
  const readNote = h('div', { class: 'note wide' });
  // Lesen nur vom verbundenen Gerät und nur bei FluidNC, GRBL-artigen Steuerungen und Ruida
  const canRead = () => isCurrent && machine.connected && !machine.running && FIRMWARES[d.fw].read !== null;
  const readBtn: HTMLButtonElement = h('button', {
    class: 'btn',
    disabled: !canRead(),
    title: t('Arbeitsbereich, Eilgang, Beschleunigung und Leistungsskala aus der Steuerung lesen (FluidNC, GRBL, grblHAL)'),
    onclick: () => {
      readNote.textContent = t('Lese Einstellungen …');
      const got: Record<string, number> = {};
      const off = machine.on((e) => {
        if (e.type !== 'line') return;
        // FluidNC: $/axes/x/max_travel_mm=400.000 · GRBL/Ruida: $130=400.000
        let m = /\/axes\/([xy])\/(max_travel_mm|max_rate_mm_per_min|acceleration_mm_per_sec2)\s*[=:]\s*([\d.]+)/i.exec(e.line);
        if (m) got[`${m[1].toLowerCase()}.${m[2]}`] = Number(m[3]);
        m = /^\$(30|11[01]|12[01]|13[01])=([\d.]+)/.exec(e.line);
        if (m) {
          const key: Record<string, string> = { '30': 'smax', '110': 'x.max_rate_mm_per_min', '111': 'y.max_rate_mm_per_min', '120': 'x.acceleration_mm_per_sec2', '121': 'y.acceleration_mm_per_sec2', '130': 'x.max_travel_mm', '131': 'y.max_travel_mm' };
          got[key[m[1]]] = Number(m[2]);
        }
      });
      if (FIRMWARES[d.fw].read === 'fluidnc') {
        for (const ax of ['x', 'y']) for (const k of ['max_travel_mm', 'max_rate_mm_per_min', 'acceleration_mm_per_sec2']) machine.send(`$/axes/${ax}/${k}`);
      } else machine.send('$$');
      setTimeout(() => {
        off();
        const found: string[] = [];
        if (got['x.max_travel_mm'] && got['y.max_travel_mm']) {
          bed.w = got['x.max_travel_mm'];
          bed.h = got['y.max_travel_mm'];
          bw.value = String(bed.w);
          bh.value = String(bed.h);
          found.push(t('Arbeitsbereich {w} × {h} mm', { w: bed.w, h: bed.h }));
        }
        const r = Math.min(got['x.max_rate_mm_per_min'] || Infinity, got['y.max_rate_mm_per_min'] || Infinity);
        if (isFinite(r)) ((d.rapid = r), (rapid.value = String(r)), found.push(t('Eilgang {r} mm/min', { r })));
        const a = Math.min(got['x.acceleration_mm_per_sec2'] || Infinity, got['y.acceleration_mm_per_sec2'] || Infinity);
        if (isFinite(a)) ((d.accel = a), (accel.value = String(a)), found.push(t('Beschleunigung {a} mm/s²', { a })));
        if (got.smax && sMaxRef.el && d.fw !== 'ruida') ((d.sMax = got.smax), (sMaxRef.el.value = String(got.smax)), found.push(t('S-Wert für 100 % {smax}', { smax: got.smax })));
        readNote.textContent = found.length ? t('Gelesen: {found}. Mit „Übernehmen“ speichern.', { found: found.join(', ') }) : t('Keine Werte erhalten. Details stehen in der Konsole.');
      }, 2500);
    },
  }, t('Von der Maschine lesen'));
  // „Von der Maschine lesen“ gehört zu Allgemein (erster Tab), nicht ans Ende.
  tabs[0].rows.push(
    h('label', {}, ''),
    h('span', { class: 'conn-row' }, readBtn),
    readNote,
  );
  let activeTab = initialSection === 'fire' ? fireTabIndex : lastDeviceTab < tabs.length ? lastDeviceTab : 0;
  const selectTab = (i: number) => {
    activeTab = lastDeviceTab = i;
    tabBtns.forEach((b, k) => b.classList.toggle('cur', k === i));
    panels.forEach((p, k) => (p.hidden = k !== i));
  };
  const tabBtns = tabs.map((tb, i) =>
    h('button', { class: 'btn small' + (i === activeTab ? ' cur' : ''), onclick: () => selectTab(i) }, tb.label),
  );
  const panels = tabs.map((tb, i) => h('div', { class: 'form', hidden: i !== activeTab }, ...tb.rows));
  const dlg = h('dialog', { class: 'device-dialog' },
    h('h3', {}, t('Geräteeinstellungen: {name}', { name: target.name })),
    h('div', { class: 'dtab-bar' }, ...tabBtns),
    ...panels,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          // Felder, die noch den Fokus haben, zuerst übernehmen
          if (deviceEditBlocked()) return;
          (document.activeElement as HTMLElement | null)?.blur();
          if (!fireRows.save(() => selectTab(fireTabIndex))) return;
          saveEnergySettings(energyRows, () => selectTab(energyTabIndex), () => {
            if (deviceEditBlocked()) return;
            Object.assign(target, d, { bedW: bed.w, bedH: bed.h });
            if (isCurrent) applyBed(ed);
            deviceChanged();
            dlg.close();
            onDone?.();
          });
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => (offTypo(), dlg.remove()));
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  // Stabile Dialoggröße: größter Tab als Referenz, kein Springen beim Wechsel.
  // Nur offsetHeight (durch max-height begrenzt): min-height darf die innere
  // Scrollbegrenzung nicht aushebeln, sonst scrollt der ganze Dialog und
  // Abbrechen/Übernehmen rutschen bei niedrigen Fenstern aus dem Sichtfeld.
  {
    const prevVis = dlg.style.visibility;
    dlg.style.visibility = 'hidden';
    let max = 0;
    panels.forEach((_p, i) => {
      panels.forEach((q, k) => (q.hidden = k !== i));
      const p = panels[i] as HTMLElement;
      max = Math.max(max, p.offsetHeight);
    });
    panels.forEach((q, k) => (q.hidden = k !== activeTab));
    if (max > 0) panels.forEach((p) => ((p as HTMLElement).style.minHeight = `${max}px`));
    dlg.style.visibility = prevVis;
  }
  if (initialSection === 'fire') fireRows.focusEnabled();
}

// ---------- Drehachse ----------

/** Drehachse (Rotary) des gewählten Geräts einrichten, wie „Rotary Setup“ in LightBurn */
export function openRotaryDialog() {
  if (deviceEditBlocked()) return;
  const target = device;
  const r: Rotary = { ...DEFAULT_ROTARY, ...target.rotary };
  const rows: HTMLElement[] = [];
  const row = (label: string, el: HTMLElement, title?: string) => {
    const lab = h('label', { title }, label);
    rows.push(lab, el);
    return [lab, el];
  };
  const numField = (get: () => number, set: (v: number) => void, title?: string) => {
    const el = numInput('', (v) => v > 0 && (set(v), update()), title);
    el.value = String(get());
    return el;
  };
  const enabled = h('input', { type: 'checkbox', checked: r.enabled, onchange: (e: Event) => ((r.enabled = (e.target as HTMLInputElement).checked), update()) });
  row(t('Drehachse einschalten'), h('span', {}, enabled));
  const kind = h('select', { onchange: (e: Event) => ((r.kind = (e.target as HTMLSelectElement).value as Rotary['kind']), update()) },
    h('option', { value: 'roller', selected: r.kind === 'roller' }, t('Walzen')),
    h('option', { value: 'chuck', selected: r.kind === 'chuck' }, t('Futter')),
  );
  row(t('Art'), kind);
  const axis = h('select', { onchange: (e: Event) => ((r.axis = (e.target as HTMLSelectElement).value as RotaryAxis), update()) },
    h('option', { value: 'Y', selected: r.axis === 'Y' }, t('Y (Rotary statt Y-Motor angeschlossen)')),
    ...(['A', 'B', 'C', 'Z'] as RotaryAxis[]).map((a) => h('option', { value: a, selected: r.axis === a }, t('{axis} (eigene Achse)', { axis: a }))),
  );
  row(t('Achse'), axis, t('Wo der Rotary an der Steuerung hängt'));
  const perRevLabel = h('span', {});
  const perRev = numField(() => r.perRev, (v) => (r.perRev = v), t('Achsweg, den die Steuerung für eine volle Umdrehung der Walze bzw. des Futters fährt'));
  rows.push(h('label', {}, perRevLabel), perRev);
  const [rollerLab, rollerEl] = row(t('Walzendurchmesser (mm)'), numField(() => r.rollerDiam, (v) => (r.rollerDiam = v)), t('Durchmesser der angetriebenen Walze'));
  const objDiam = numField(() => r.objectDiam, (v) => ((r.objectDiam = v), (circ.value = dec((Math.PI * v).toFixed(2)))), t('Am breitesten Punkt der Gravur messen'));
  row(t('Objektdurchmesser (mm)'), objDiam);
  const circ = numInput('', (v) => v > 0 && ((r.objectDiam = v / Math.PI), (objDiam.value = dec(r.objectDiam.toFixed(2))), update()), t('Umfang statt Durchmesser eingeben, z. B. mit einem Maßband gemessen'));
  circ.value = dec((Math.PI * r.objectDiam).toFixed(2));
  row(t('Objektumfang (mm)'), circ);
  const taper = h('input', { type: 'checkbox', checked: r.taper, onchange: (e: Event) => ((r.taper = (e.target as HTMLInputElement).checked), update()) });
  row(t('Konisches Objekt'), h('span', {}, taper), t('Für Becher und andere Objekte, die zu einem Ende dünner werden: die Gravur bleibt überall maßhaltig'));
  const taperRows = [
    ...row(t('Durchmesser am linken Rand (mm)'), numField(() => r.taperLeft, (v) => (r.taperLeft = v)), t('Durchmesser des Objekts dort, wo der Job links beginnt (kleinstes X); mit dem Rahmen anfahren und messen')),
    ...row(t('Durchmesser am rechten Rand (mm)'), numField(() => r.taperRight, (v) => (r.taperRight = v)), t('Durchmesser des Objekts dort, wo der Job rechts endet (größtes X)')),
  ];
  const taperNote = h('div', { class: 'note' }, t('Konisch: Das Objekt so unterlegen, dass seine Oberseite waagerecht liegt. Die Mitte des Jobs in Y bleibt eine gerade Linie, nach oben und unten wird zum dünnen Ende hin stärker gedreht. Bei Walzen wird angenommen, dass das Objekt am dickeren Ende aufliegt. Ändert sich der Job, die Durchmesser an den neuen Rändern messen.'));
  const mirror = h('input', { type: 'checkbox', checked: r.mirror, onchange: (e: Event) => ((r.mirror = (e.target as HTMLInputElement).checked), update()) });
  row(t('Drehrichtung umkehren'), h('span', {}, mirror), t('Wenn die Gravur gespiegelt herauskommt'));
  const info = h('div', { class: 'note' });
  const testNote = h('div', { class: 'note' });
  const testBtn = h('button', {
    class: 'btn',
    title: t('Das Objekt mit den eingegebenen Werten genau einmal herumdrehen'),
    onclick: () => {
      const why = runBlocker();
      if (why) return void (testNote.textContent = why);
      for (const l of rotaryTestLines({ ...target, rotary: { ...r, enabled: true } })) machine.send(l);
      testNote.textContent = t('Das Objekt sollte sich jetzt genau einmal drehen. Dreht es zu weit oder zu kurz, den Achsweg pro Umdrehung im gleichen Verhältnis anpassen.');
    },
  }, t('Testdrehung')) as HTMLButtonElement;
  const update = () => {
    const deg = r.axis !== 'Y' && r.axis !== 'Z';
    perRevLabel.textContent = deg ? t('Achsweg pro Umdrehung (meist 360°)') : t('Achsweg pro Umdrehung (mm)');
    rollerLab.hidden = rollerEl.hidden = r.kind !== 'roller';
    for (const el of taperRows) el.hidden = !r.taper;
    taperNote.hidden = !r.taper;
    const c = rotaryCirc(r);
    const k = c > 0 ? r.perRev / c : 0;
    info.textContent =
      t('1 mm auf dem Objekt = {k} {unit} auf Achse {axis}.', { k: k.toFixed(4), unit: deg ? '°' : 'mm', axis: r.axis }) +
      ' ' +
      (r.axis === 'Y'
        ? t('Am Y-Anschluss: Soft-Limits bzw. Endschalter der Y-Achse dürfen nicht stören, und nicht referenzieren, solange der Rotary steckt.')
        : t('Eigene Achse: Sie muss in der Steuerung eingerichtet sein (bei FluidNC in der config.yaml). KizamuBeam setzt zu Beginn jedes Jobs die aktuelle Stellung mit G92 auf 0.'));
  };
  update();
  const dlg = h('dialog', { class: 'device-dialog' },
    h('h3', {}, t('Drehachse: {name}', { name: target.name })),
    h('div', { class: 'form' }, ...rows),
    info,
    taperNote,
    h('div', { class: 'note' }, t('Die Y-Richtung des Entwurfs wird zur Umfangsrichtung des Objekts. Den Laserkopf vor dem Start über die höchste Stelle des Objekts stellen und fokussieren; als Startpunkt eignet sich „Aktuelle Position“.')),
    h('div', { class: 'conn-row' }, testBtn),
    testNote,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          (document.activeElement as HTMLElement | null)?.blur();
          if (deviceEditBlocked()) return;
          target.rotary = { ...r };
          deviceChanged();
          dlg.close();
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Geräteliste ----------

/** Geräte verwalten: aus Vorlagen anlegen, bearbeiten, kopieren, löschen, auswählen */
export function openDevicesDialog(ed: Editor) {
  if (deviceEditBlocked()) return;
  const list = h('table', { class: 'devices' });
  const fill = () => {
    list.textContent = '';
    list.append(h('tr', {}, h('th', {}), h('th', {}, t('Name')), h('th', {}, t('Steuerung')), h('th', {}, t('Bereich (mm)')), h('th', {})));
    for (const d of store.devices) {
      const radio = h('input', {
        type: 'radio', name: 'cur-device', checked: d === device, title: t('Dieses Gerät verwenden'),
        disabled: machine.connected || machine.connecting,
        onchange: () => (selectDevice(ed, d.id), fill()),
      });
      const btn = (label: string, title: string, f: () => void, disabled = false) => h('button', { class: 'btn', title, disabled, onclick: f }, label);
      list.append(h('tr', { class: d === device ? 'active' : '' },
        h('td', {}, radio),
        h('td', {}, d.name),
        h('td', {}, FIRMWARES[d.fw].label),
        h('td', {}, `${d.bedW} × ${d.bedH}`),
        h('td', {}, h('div', { class: 'actions' },
          btn(t('Bearbeiten'), t('Einstellungen dieses Geräts'), () => openDeviceDialog(ed, d, fill)),
          btn(t('Kopieren'), t('Als neues Gerät kopieren'), () => {
            if (deviceEditBlocked()) return;
            store.devices.push({ ...d, rotary: { ...d.rotary }, id: newDevice(d).id, name: t('{name} (Kopie)', { name: d.name }) });
            deviceChanged();
            fill();
          }),
          btn(t('Löschen'), store.devices.length < 2 ? t('Das letzte Gerät kann nicht gelöscht werden') : t('Gerät löschen'), () => {
            if (deviceEditBlocked()) return;
            if (!confirm(t('Gerät „{name}“ löschen?', { name: d.name }))) return;
            store.devices = store.devices.filter((x) => x !== d);
            if (d === device) selectDevice(ed, store.devices[0].id);
            deviceChanged();
            fill();
          }, store.devices.length < 2 || (d === device && (machine.connected || machine.connecting))),
        )),
      ));
    }
  };
  const presets = presetList();
  const { select: presetSel, details: presetInfo } = presetPicker(presets);
  const add = () => {
    if (deviceEditBlocked()) return;
    const d = newDevice(presets[Number(presetSel.value)].preset);
    store.devices.push(d);
    deviceChanged();
    fill();
    openDeviceDialog(ed, d, fill);
  };
  const dlg = h('dialog', { class: 'devices-dialog' },
    h('h3', {}, t('Geräte')),
    list,
    h('div', { class: 'conn-row' }, h('label', {}, t('Neues Gerät aus Vorlage')), presetSel, h('button', { class: 'btn primary', onclick: add }, t('Hinzufügen'))),
    presetInfo,
    h('div', { class: 'note' }, t('Die Maße der Vorlagen stammen aus den Herstellerangaben. Bitte vor dem ersten Job prüfen, am einfachsten mit „Von der Maschine lesen“ in den Geräteeinstellungen (FluidNC, GRBL, grblHAL).')),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  );
  fill();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Vorschau ----------

export async function openPreview(ed: Editor, src?: JobSource) {
  const job = await makeJob(ed, true, src);
  if (nothingToDo(job)) return;
  const est = estimate(job.moves, device);
  const mv = job.moves;
  const bed = ed.doc.bed;
  const cv = h('canvas', { class: 'preview-canvas' }) as HTMLCanvasElement;
  const acc = document.createElement('canvas');
  const slider = h('input', { type: 'range', min: '0', max: '1000', value: '1000', step: '1' }) as HTMLInputElement;
  const timeTxt = h('span', { class: 'preview-time' });
  const playBtn = h('button', { class: 'btn', title: t('Abspielen') }, h('span', { icon: 'play' }));
  const hereBtn = h('button', {
    class: 'btn',
    title: t('Den Job ab der Stelle des Schiebereglers lasern, z. B. nach einem Abbruch'),
    onclick: async () => {
      setPlaying(false);
      const i = indexAt(time);
      const t0 = i ? est.t[i - 1] : 0,
        t1 = i < mv.n ? est.t[i] : t0;
      const frac = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
      if (await startJobAt(ed, mv, i, frac, src)) dlg.close();
    },
  }, t('Hier starten')) as HTMLButtonElement;
  const updateHere = () => {
    const why = runBlocker();
    hereBtn.disabled = !!why;
    hereBtn.title = why ?? t('Den Job ab der Stelle des Schiebereglers lasern, z. B. nach einem Abbruch');
  };
  const offMachine = machine.on(updateHere);
  const speedSelect = (value: number) => {
    const sel = h('select', { title: t('Abspielgeschwindigkeit') },
      ...[1, 2, 5, 10, 20, 50, 100, 200, 400, 1000].map((v) => h('option', { value: String(v), selected: v === value }, `${v}×`)),
    ) as HTMLSelectElement;
    sel.value = String(value);
    return sel;
  };
  const engraveSel = speedSelect(50);
  engraveSel.classList.add('preview-engrave');
  const cutSel = speedSelect(10);
  cutSel.classList.add('preview-cut');
  const pauseChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
  pauseChk.classList.add('preview-pause');
  const smoothChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
  smoothChk.classList.add('preview-smooth');
  const targetInp = h('input', { type: 'number', min: String(MIN_TARGET), max: String(MAX_TARGET), step: '1', value: String(DEFAULT_TARGET), class: 'preview-target', 'aria-describedby': 'preview-target-error' }) as HTMLInputElement;
  const targetErr = h('span', { class: 'preview-error', id: 'preview-target-error', role: 'status', hidden: true }, t('Ziel muss zwischen 1 und 600 Sekunden liegen.'));
  const factorTxt = h('span', { class: 'preview-factors' });
  const status = h('span', { class: 'preview-status', role: 'status' });
  const layerOf = (i: number) => (src ? src.layer(i) : ed.layer(i));
  const layerColor = (i: number) => (src ? src.color(i) : ed.layerDrawColor(i));
  const pct = (v: number) => `${(v * 100).toLocaleString(locale, { maximumFractionDigits: 1 })} %`;
  const readPlayback = (): PlaybackSettings => ({
    engrave: Number(engraveSel.value),
    cut: Number(cutSel.value),
    smooth: smoothChk.checked,
    target: Number(targetInp.value),
  });
  let analysis = analyzePlayback(mv, est, readPlayback());
  const stat = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
  const subLabel = (layer: number, sub: number) => {
    const L = layerOf(layer);
    if (sub === -2) return `${L.name} – ${t('Bildschnitt')}`;
    if (sub < 0) return L.name;
    const custom = L.sub?.[sub]?.name?.trim();
    return `${L.name} – ${custom || t('Sublayer {n}', { n: sub + 1 })}`;
  };
  const layerRows = analysis.layerTimes.map((lt) => {
    const swatch = h('span', { class: 'preview-layer-swatch' });
    swatch.style.background = layerColor(lt.layer);
    return h('div', { class: `preview-layer${lt.sub >= 0 ? ' sub' : ''}${lt.sub === -2 ? ' cut' : ''}` },
      swatch,
      h('span', { class: 'preview-layer-name' }, subLabel(lt.layer, lt.sub)),
      h('span', { class: 'preview-layer-time' }, formatDuration(lt.seconds)),
      h('span', { class: 'preview-layer-share' }, pct(lt.share)),
    );
  });
  const breakdown = h('details', { class: 'preview-breakdown' },
    h('summary', {}, t('Zeit je Layer und Prozessart')),
    h('div', { class: 'preview-layer-list' }, ...layerRows),
    h('dl', { class: 'preview-stats preview-process-times' },
      ...stat(t('Gravieren'), formatDuration(analysis.processTimes.engrave)),
      ...stat(t('Schneiden'), formatDuration(analysis.processTimes.cut)),
      ...stat(t('Laserlose Fahrzeit'), formatDuration(analysis.processTimes.travel)),
    ),
  ) as HTMLDetailsElement;
  breakdown.open = true;
  const jumpTo = (m: (typeof analysis.markers)[number]) => {
    setPlaying(false);
    status.textContent = '';
    time = m.time;
    render();
  };
  const markers = h('div', { class: 'preview-markers' });
  // Bei sehr vielen Layern liegen 24-px-Ziele übereinander; dann führt eine einzelne Auswahl zum Layer.
  const dense = analysis.markers.length > MAX_MARKERS;
  for (const m of analysis.markers) {
    const name = subLabel(m.layer, m.sub);
    const change = m.change ? `, ${t('Prozesswechsel')}` : '';
    if (dense) {
      const tick = h('span', { class: `preview-marker static${m.change ? ' change' : ''}`, 'aria-hidden': 'true' });
      tick.style.left = `${est.total ? (m.time / est.total) * 100 : 0}%`;
      markers.append(tick);
      continue;
    }
    const marker = h('button', {
      type: 'button',
      class: `preview-marker${m.change ? ' change' : ''}`,
      title: `${name}${change}`,
      'aria-label': t('Zu Layer „{name}“ springen', { name }) + change,
    }) as HTMLButtonElement;
    marker.style.left = `${est.total ? (m.time / est.total) * 100 : 0}%`;
    marker.addEventListener('click', () => jumpTo(m));
    markers.append(marker);
  }
  const layerJump = dense
    ? (h('select', { class: 'preview-layer-jump', 'aria-label': t('Zu Layer springen') },
        h('option', { value: '', selected: true, disabled: true }, t('Zu Layer springen')),
        ...analysis.markers.map((m, i) => h('option', { value: String(i) }, `${subLabel(m.layer, m.sub)} · ${formatDuration(m.time)}${m.change ? `, ${t('Prozesswechsel')}` : ''}`)),
      ) as HTMLSelectElement)
    : null;
  layerJump?.addEventListener('change', () => {
    const m = analysis.markers[Number(layerJump.value)];
    if (m) jumpTo(m);
  });
  const timeline = h('div', { class: 'preview-timeline' }, markers, slider);
  const syncFactors = () => {
    analysis.factors = computeFactors(analysis.processTimes, readPlayback());
    factorTxt.textContent = t('Faktor Gravieren {engrave}×, Schneiden {cut}×', {
      engrave: Number(analysis.factors.engrave.toFixed(1)).toLocaleString(locale),
      cut: Number(analysis.factors.cut.toFixed(1)).toLocaleString(locale),
    });
    factorTxt.hidden = !smoothChk.checked;
  };
  const validTarget = () => {
    const v = Number(targetInp.value);
    return Number.isFinite(v) && v >= MIN_TARGET && v <= MAX_TARGET;
  };
  const validateTarget = () => {
    const ok = validTarget();
    targetInp.setAttribute('aria-invalid', ok ? 'false' : 'true');
    targetErr.hidden = ok;
    if (ok) syncFactors();
  };
  const syncMode = () => {
    const smooth = smoothChk.checked;
    engraveSel.disabled = smooth;
    cutSel.disabled = smooth;
    targetInp.disabled = !smooth;
    if (smooth) validateTarget();
    else {
      targetInp.setAttribute('aria-invalid', 'false');
      targetErr.hidden = true;
      syncFactors();
    }
  };
  engraveSel.addEventListener('change', syncFactors);
  cutSel.addEventListener('change', syncFactors);
  smoothChk.addEventListener('change', syncMode);
  targetInp.addEventListener('input', validateTarget);
  syncMode();
  const rapidChk = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const shadeChk = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const b = job.bounds!;
  const info = h('dl', { class: 'preview-stats' },
    ...stat(t('Geschätzte Dauer'), formatDuration(est.total)),
    ...stat(t('Laserweg'), `${dec((est.cutLength / 1000).toFixed(2))} m`),
    ...stat(t('Leerweg'), `${dec((est.rapidLength / 1000).toFixed(2))} m`),
    ...stat(t('Bereich'), `${dec((b.x1 - b.x0).toFixed(1))} × ${dec((b.y1 - b.y0).toFixed(1))} mm`),
    ...stat(t('Bewegungen'), mv.n.toLocaleString(locale)),
    ...(rotaryOn(device) ? stat(t('Drehachse'), t('Achse {axis}, Umfang {c} mm', { axis: device.rotary.axis, c: dec((Math.PI * device.rotary.objectDiam).toFixed(1)) })) : []),
    ...((job.dedup?.length
      ? stat(t('Doppelte Linien'), t('{len} mm zusammengefasst', { len: dec(job.dedup.reduce((s, d) => s + d.len, 0).toFixed(1)) }))
      : [])),
  );
  const warn = h('div', { class: 'note' }, ...job.warnings.map((w) => h('div', {}, w)));
  const dlg = h('dialog', { class: 'preview-dialog', 'data-dialog-resize': 'true', 'data-dialog-min-width': '480', 'data-dialog-min-height': '360' },
    h('h3', {}, t('Vorschau')),
    h('div', { class: 'preview-main' },
      cv,
      h('div', { class: 'preview-side' },
        info,
        breakdown,
        energyPreview(estimateEnergy(mv, est, job.air, energyDraft(device.energy)), parseEnergyNumber(electricityTariffText())),
        h('label', { class: 'check' }, rapidChk, t('Leerwege zeigen')),
        h('label', { class: 'check' }, shadeChk, t('Nach Leistung schattieren')),
        warn,
        h('div', { class: 'note' }, t('Mausrad zoomt, Ziehen verschiebt, Doppelklick passt ein. Die Zeit ist eine Schätzung aus Eilgang und Beschleunigung in den Geräteeinstellungen.')),
        h('div', { class: 'dialog-buttons' },
          h('button', { class: 'btn', onclick: () => saveGCode(ed, src) }, device.fw === 'ruida' ? t('.rd speichern') : t('G-Code speichern')),
          h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen')),
        ),
      ),
    ),
    h('div', { class: 'preview-bar' },
      playBtn,
      timeline,
      ...(layerJump ? [layerJump] : []),
      timeTxt,
      hereBtn,
      h('div', { class: 'preview-process' },
        h('label', {}, t('Gravieren'), engraveSel),
        h('label', {}, t('Schneiden'), cutSel),
        h('label', { class: 'check' }, pauseChk, t('Bei Prozesswechsel pausieren')),
        h('label', { class: 'check' }, smoothChk, t('Prozessarten angleichen')),
        h('label', {}, t('Ziel pro Prozessart (s)'), targetInp),
        factorTxt,
        targetErr,
      ),
      status,
    ),
  );
  const main = dlg.querySelector<HTMLElement>('.preview-main')!;
  const side = dlg.querySelector<HTMLElement>('.preview-side')!;
  main.insertBefore(previewSplitter(main, side, t('Breite der Vorschauinformationen')), side);
  document.body.append(dlg);
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.showModal();

  // Ansicht: mm → Pixel, y nach oben
  let view = { z: 1, ox: 0, oy: 0 };
  let W = 0,
    H = 0,
    dpr = 1;
  const fit = () => {
    const r = cv.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cv.width = acc.width = W * dpr;
    cv.height = acc.height = H * dpr;
    const bx0 = Math.min(0, job.travel?.x0 ?? 0),
      by0 = Math.min(0, job.travel?.y0 ?? 0),
      bx1 = Math.max(bed.w, job.travel?.x1 ?? 0),
      by1 = Math.max(bed.h, job.travel?.y1 ?? 0);
    const z = Math.min((W - 30) / (bx1 - bx0), (H - 30) / (by1 - by0));
    view = { z, ox: (W - (bx1 - bx0) * z) / 2 - bx0 * z, oy: (H + (by1 - by0) * z) / 2 + by0 * z };
    accN = 0;
  };
  const sx = (x: number) => x * view.z + view.ox;
  const sy = (y: number) => view.oy - y * view.z;

  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const css = getComputedStyle(document.documentElement);
  const bedColor = css.getPropertyValue('--surface').trim() || '#fff';
  const lineColor = css.getPropertyValue('--line').trim() || '#ccc';
  const colorOf = (layer: number) => (layer < 0 ? '#888' : src ? src.color(layer) : ed.layerDrawColor(layer));

  // Schattierung relativ zur höchsten Leistung des Layers, damit Graustufenbilder auch bei wenig Leistung lesbar sind
  const maxS = new Map<number, number>();
  for (let i = 0; i < mv.n; i++) if (mv.s[i] > (maxS.get(mv.layer[i]) ?? 0)) maxS.set(mv.layer[i], mv.s[i]);

  /** Bewegungen bis Index n (ausschließlich) in den Zwischenspeicher zeichnen, ab dem bereits gezeichneten Stand */
  let accN = 0;
  const drawUpTo = (n: number) => {
    const c = acc.getContext('2d')!;
    if (n < accN || accN === 0) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = dark ? '#15171b' : '#d9dce1';
      c.fillRect(0, 0, W, H);
      c.fillStyle = bedColor;
      c.fillRect(sx(0), sy(bed.h), bed.w * view.z, bed.h * view.z);
      c.strokeStyle = lineColor;
      c.lineWidth = 1;
      c.strokeRect(sx(0), sy(bed.h), bed.w * view.z, bed.h * view.z);
      accN = 0;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineWidth = Math.max(1, Math.min(3, view.z * 0.1));
    const batches = new Map<string, Path2D>();
    const rapids = new Path2D();
    let px = accN ? mv.x[accN - 1] : mv.x0,
      py = accN ? mv.y[accN - 1] : mv.y0;
    for (let i = accN; i < n; i++) {
      const x = mv.x[i],
        y = mv.y[i];
      if (mv.f[i] === 0 || mv.s[i] === 0) {
        if (mv.f[i] === 0 && rapidChk.checked) {
          rapids.moveTo(sx(px), sy(py));
          rapids.lineTo(sx(x), sy(y));
        }
      } else {
        const lvl = shadeChk.checked ? Math.max(1, Math.round((mv.s[i] / (maxS.get(mv.layer[i]) || 1)) * 16)) : 16;
        const key = `${mv.layer[i]}|${lvl}`;
        let p = batches.get(key);
        if (!p) batches.set(key, (p = new Path2D()));
        p.moveTo(sx(px), sy(py));
        p.lineTo(sx(x), sy(y));
      }
      px = x;
      py = y;
    }
    for (const [key, p] of batches) {
      const [layer, lvl] = key.split('|').map(Number);
      c.strokeStyle = colorOf(layer);
      c.globalAlpha = 0.1 + (0.9 * lvl) / 16;
      c.stroke(p);
    }
    c.globalAlpha = 1;
    if (rapidChk.checked) {
      c.strokeStyle = 'rgba(230,60,40,0.55)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.stroke(rapids);
      c.setLineDash([]);
    }
    // Zusammengefasste Doppel-Linien (Issue #221): gestrichelt orange über der Bahn
    if (job.dedup?.length) {
      c.strokeStyle = 'rgba(230,130,0,0.9)';
      c.lineWidth = Math.max(1.5, Math.min(3.5, view.z * 0.15));
      c.setLineDash([5, 3]);
      c.beginPath();
      for (const d of job.dedup)
        for (const l of d.lines) {
          if (l.length < 2) continue;
          c.moveTo(sx(l[0].x), sy(l[0].y));
          for (let k = 1; k < l.length; k++) c.lineTo(sx(l[k].x), sy(l[k].y));
        }
      c.stroke();
      c.setLineDash([]);
    }
    accN = n;
  };

  let time = est.total;
  const indexAt = (t: number) => {
    let lo = 0,
      hi = mv.n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (est.t[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const render = () => {
    const i = indexAt(time);
    drawUpTo(Math.min(i, mv.n));
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(acc, 0, 0);
    // Laserkopf mit Teilstück der aktuellen Bewegung
    let hx = mv.x0,
      hy = mv.y0;
    if (i < mv.n) {
      const t0 = i ? est.t[i - 1] : 0,
        t1 = est.t[i];
      const f = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 1;
      const ax = i ? mv.x[i - 1] : mv.x0,
        ay = i ? mv.y[i - 1] : mv.y0;
      hx = ax + (mv.x[i] - ax) * f;
      hy = ay + (mv.y[i] - ay) * f;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (mv.f[i] > 0 && mv.s[i] > 0) {
        c.strokeStyle = colorOf(mv.layer[i]);
        c.lineWidth = Math.max(1, Math.min(3, view.z * 0.1));
        c.beginPath();
        c.moveTo(sx(ax), sy(ay));
        c.lineTo(sx(hx), sy(hy));
        c.stroke();
      }
    } else if (mv.n) {
      hx = mv.x[mv.n - 1];
      hy = mv.y[mv.n - 1];
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = '#e02020';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(sx(hx), sy(hy), 5, 0, Math.PI * 2);
    c.stroke();
    timeTxt.textContent = `${formatDuration(time)} / ${formatDuration(est.total)}`;
    slider.value = String(est.total ? Math.round((time / est.total) * 1000) : 1000);
  };

  let playing = false,
    last = 0;
  const step = (now: number) => {
    if (!playing || !dlg.open) return;
    const next = advancePlayback(mv, est, analysis, time, (now - last) / 1000, pauseChk.checked);
    time = next.time;
    last = now;
    render();
    if (next.paused) {
      setPlaying(false);
      status.textContent = t('Bei Prozesswechsel pausiert');
      return;
    }
    if (time >= est.total) return setPlaying(false);
    requestAnimationFrame(step);
  };
  const setPlaying = (p: boolean) => {
    playing = p;
    setIcon(playBtn, p ? 'pause' : 'play');
    if (p) {
      status.textContent = '';
      if (time >= est.total) time = 0;
      last = performance.now();
      requestAnimationFrame(step);
    }
  };
  playBtn.addEventListener('click', () => setPlaying(!playing));
  slider.addEventListener('input', () => {
    status.textContent = '';
    time = (Number(slider.value) / 1000) * est.total;
    render();
  });
  const redrawAll = () => ((accN = 0), render());
  rapidChk.addEventListener('change', redrawAll);
  shadeChk.addEventListener('change', redrawAll);

  // Zoomen und Verschieben
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.25 : 0.8;
    view.ox = mx - (mx - view.ox) * k;
    view.oy = my - (my - view.oy) * k;
    view.z *= k;
    redrawAll();
  }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.ox += e.clientX - drag.x;
    view.oy += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    redrawAll();
  });
  cv.addEventListener('pointerup', () => (drag = null));
  cv.addEventListener('dblclick', () => (fit(), render()));
  const ro = new ResizeObserver(() => (fit(), render()));
  ro.observe(cv);
  updateHere();
  dlg.addEventListener('close', () => {
    playing = false;
    offMachine();
    ro.disconnect();
    dlg.remove();
  });
}
