
// Maschinenausgabe: aus dem Dokument einen Job berechnen (Linien, Füllen, Bilder), G-Code schreiben,
// Laufzeit schätzen und Rahmenfahrten erzeugen. Alles in Maschinenkoordinaten (mm, Ursprung unten links, y nach oben).
import ClipperLib from 'clipper-lib';
import type { EnergySettings } from './energy';
import { apply, CutSettings, Doc, ImageLayer, ImageOutput, imageOutput, ImageShape, inv, isGrayMode, laserLeaves, Layer, LeadSettings, Mat, mul, normalizeLayer, Obj, outputLeaves, PerfSettings, Pt, RampSettings, SubLayer, SubPath, TabSettings } from './model';
import { bezierPt, segments, shapeSubs } from './geom';
import { loadFont, textToSubs } from './fonts';
import { ImageProcessingError, imageRasterGeometry, nativeScanLines, outputGrid, processImage } from './images';
import { resolveImageContour, type ImageContour } from './imageContour';
import { imageCutSettings, objectsById, resolveImageCutPath } from './imageCut';
import { hasNative, native } from './native';
import { locale, t, tn } from './i18n';
import { dedupPolys } from './dedup';
import { jobOutputsOff, jobOutputsOn } from './fluidnc';
import { parkedObjs } from './parking';
import { addPt, boxesOf, buildContainment, containsStrict, emptyBox } from './polyTopology';
import { ruidaParamsForJob, sanitizeRuidaFilename, writeRuida } from './ruida';
export { sanitizeRuidaFilename };

// ---------- Geräte und Firmware ----------

export type StartFrom = 'absolute' | 'user' | 'current';

export type Firmware = 'fluidnc' | 'grbl' | 'grblhal' | 'marlin' | 'smoothie' | 'xtool' | 'ruida';
export type RuidaOrigin = 'top-right' | 'top-left' | 'bottom-left' | 'bottom-right';
export type RuidaMagic = 'auto' | '88' | '11' | '38';
export type RuidaLaser = '1' | '2' | 'both';

/** Was je Steuerung anders ist: Übertragung, Laserbefehle, Maschinenbefehle */
export interface FirmwareInfo {
  label: string;
  /** Übliche Leistungsskala (S-Wert für 100 %) */
  sMax: number;
  /** Zeile für Zeile senden statt Zeichenzählung */
  sync: boolean;
  /** Echtzeitbefehle ? ! ~ 0x18 */
  realtime: boolean;
  /**
   * Positionsabfrage per Befehlszeile, nur im Leerlauf (Marlin: M114, xTool: ?). Set means the controller has no
   * real-time status report: the job ends with its last `ok` and KizamuBeam reports Idle/Run itself.
   */
  poll: string | null;
  /** Laser vorbereiten (vor der ersten Bewegung) */
  laserOn: string[];
  /** Laser für den Rahmen mit fester Leistung einschalten */
  frameOn: string[];
  /** Ende des Jobs */
  footer: string[];
  home: string;
  unlock: string | null;
  /** Relativ verfahren; axis ist der Buchstabe für die Y-Richtung (bei Rotary z. B. A) */
  jog: (x: number, y: number, f: number, axis?: string) => string[];
  setOrigin: string;
  clearOrigin: string | null;
  /** Einstellungen der Maschine lesen: FluidNC-Pfade, GRBL-$$, Ruida-Speicher oder gar nicht */
  read: 'fluidnc' | 'grbl' | 'ruida' | null;
  /** Echtzeit-Overrides für Vorschub, Eilgang und Leistung (0x90 …), Kühlmittel umschalten (0xA0/0xA1) */
  overrides: boolean;
  /** Queued motion only runs after a program end (M2), so every motion sequence must end with it (xTool) */
  runsOnM2?: boolean;
}

const grblJog = (x: number, y: number, f: number, axis = 'Y') => [`$J=G91 G21${x ? ` X${num(x)}` : ''}${y ? ` ${axis}${num(y)}` : ''} F${Math.round(f)}`];
const relJog = (x: number, y: number, f: number, axis = 'Y') => ['G91', `G0${x ? ` X${num(x)}` : ''}${y ? ` ${axis}${num(y)}` : ''} F${Math.round(f)}`, 'G90'];
/**
 * xTool firmware (D1 family over USB): ignores `$J=` and only runs queued motion after a program end (M2).
 * Sequence documented by OpenBurn (github.com/SJLS27/openburn, MIT), the same one LightBurn uses for jogging.
 */
const xtoolJog = (x: number, y: number, f: number, axis = 'Y') => ['G91', `G1${x ? ` X${num(x)}` : ''}${y ? ` ${axis}${num(y)}` : ''} F${Math.round(f)} S0`, 'G90', 'M2'];
const GRBL_BASE = {
  sync: false, realtime: true, poll: null, laserOn: ['M4 S0'], frameOn: ['M3 S0'], footer: ['M5', 'M2'],
  home: '$H', unlock: '$X', jog: grblJog, setOrigin: 'G10 L20 P1 X0 Y0', clearOrigin: 'G10 L2 P1 X0 Y0', overrides: true,
};

export const FIRMWARES: Record<Firmware, FirmwareInfo> = {
  fluidnc: { ...GRBL_BASE, label: 'FluidNC', sMax: 1000, read: 'fluidnc' },
  grbl: { ...GRBL_BASE, label: 'GRBL 1.1', sMax: 1000, read: 'grbl' },
  grblhal: { ...GRBL_BASE, label: 'grblHAL', sMax: 1000, read: 'grbl' },
  marlin: {
    label: 'Marlin (Laser)', sMax: 255, sync: true, realtime: false, poll: 'M114',
    // Inline-Modus: S an jedem G1 setzt die Leistung, G0 fährt aus
    laserOn: ['M3 I S0'], frameOn: ['M3 I S0'], footer: ['M5', 'M400'],
    home: 'G28 X Y', unlock: null, jog: relJog, setOrigin: 'G92 X0 Y0', clearOrigin: null, read: null, overrides: false,
  },
  smoothie: {
    label: 'Smoothieware', sMax: 1, sync: true, realtime: true, poll: null,
    // Smoothieware feuert nur bei G1, S ist der Anteil 0 … 1
    laserOn: [], frameOn: [], footer: [],
    home: '$H', unlock: '$X', jog: relJog, setOrigin: 'G10 L20 P1 X0 Y0', clearOrigin: 'G10 L2 P1 X0 Y0', read: null, overrides: false,
  },
  // xTool D1 family over USB: GRBL dialect, but the real-time `?` corrupts the next line and its status reply
  // `<MPos:…>` has no state word and an extra `ok`, so the status is polled as a line while idle only.
  // Pause/stop keep the GRBL real-time bytes (! ~ 0x18); overrides and $$ are not known to work.
  xtool: { ...GRBL_BASE, label: 'xTool (USB)', sMax: 1000, poll: '?', jog: xtoolJog, read: null, overrides: false, runsOnM2: true },
  ruida: {
    ...GRBL_BASE,
    label: 'Ruida (DSP / CO2)',
    sMax: 100,
    sync: true,
    laserOn: [],
    frameOn: [],
    footer: [],
    unlock: null,
    setOrigin: 'G92 X0 Y0',
    clearOrigin: 'G92.1',
    read: 'ruida',
    overrides: false,
  },
};

/** Controller sends real-time status reports on `?` (GRBL family, Smoothieware); otherwise it is polled as a line */
export const liveStatus = (fw: FirmwareInfo): boolean => fw.realtime && !fw.poll;

/** Achse, auf der die Drehung ausgegeben wird: Y = Rotary steckt am Y-Anschluss, sonst eine eigene Achse */
export type RotaryAxis = 'Y' | 'Z' | 'A' | 'B' | 'C';

/** Kind of laser source; decides which material settings fit */
export type LaserType = 'diode' | 'ir' | 'co2' | 'fiber';
export const LASER_TYPES: LaserType[] = ['diode', 'ir', 'co2', 'fiber'];

/** The laser module in a device: kind, optical output power in W and wavelength in nm (each optional) */
export interface LaserModule {
  type?: LaserType;
  power?: number;
  wavelength?: number;
}

/** Drehachse (Rotary): Die Y-Richtung des Entwurfs wird zur Umfangsrichtung des Objekts */
export interface Rotary {
  enabled: boolean;
  /** Walzen (Objekt liegt auf zwei Rollen) oder Futter (Objekt ist eingespannt) */
  kind: 'roller' | 'chuck';
  axis: RotaryAxis;
  /** Achsweg für eine volle Umdrehung der Walze bzw. des Futters, in den Einheiten der Steuerung (mm, bei A/B/C meist Grad) */
  perRev: number;
  /** Durchmesser der angetriebenen Walze in mm (nur Walzen) */
  rollerDiam: number;
  /** Durchmesser des Objekts in mm (Futter: bestimmt den Maßstab; Walzen: nur für den Umfang-Hinweis und die Testdrehung) */
  objectDiam: number;
  /** Drehrichtung umkehren */
  mirror: boolean;
  /** Konisches Objekt (Becher): der Durchmesser ändert sich entlang X linear von taperLeft zu taperRight */
  taper: boolean;
  /** Objektdurchmesser in mm am linken bzw. rechten Rand des Jobs (kleinstes bzw. größtes X) */
  taperLeft: number;
  taperRight: number;
}

export const DEFAULT_ROTARY: Rotary = { enabled: false, kind: 'roller', axis: 'Y', perRev: 360, rollerDiam: 25, objectDiam: 80, mirror: false, taper: false, taperLeft: 80, taperRight: 70 };

export interface Device {
  energy?: EnergySettings;
  id: string;
  name: string;
  fw: Firmware;
  /** Arbeitsbereich in mm */
  bedW: number;
  bedH: number;
  /**
   * Verbindung: USB-Seriell oder Netzwerk (Telnet, z. B. FluidNC Port 23, oder WebSocket, FluidNC Port 81),
   * or 'remote': another KizamuBeam on the network (host) runs the laser (see remote.ts)
   */
  conn: 'serial' | 'tcp' | 'ws' | 'remote';
  port: string;
  baud: number;
  host: string;
  tcpPort: number;
  wsPort: number;
  /** Port der Weboberfläche (FluidNC: Dateien hochladen, Suche im Netzwerk) */
  httpPort: number;
  /** Remote KizamuBeam: port of the host and fingerprint of its certificate from pairing (empty = not paired) */
  remotePort: number;
  remoteFp: string;
  /** Empfangspuffer der Steuerung in Bytes für die Zeichenzählung (GRBL 128 → 127; FluidNC hat mehr) */
  rxBuffer: number;
  /** Job vom Rechner senden oder bei FluidNC erst auf SD-Karte/Flash hochladen und dort starten */
  runFrom: 'stream' | 'sd' | 'localfs';
  /** Digitale Ausgänge (M64/M65 P…), die während eines Jobs eingeschaltet sind, z. B. Absaugung */
  jobOutputs: number[];
  /** S-Wert für 100 % Leistung (FluidNC/GRBL meist 1000, Marlin 255, Smoothieware 1) */
  sMax: number;
  /** Eilgang in mm/min (für Zeitschätzung und Leerwege) */
  rapid: number;
  /** Beschleunigung in mm/s² (Zeitschätzung) */
  accel: number;
  /** Junction Deviation in mm (Zeitschätzung, GRBL-Standard 0,01) */
  junction: number;
  startFrom: StartFrom;
  /** Job-Ursprung 0 … 8: Zeilen von oben nach unten, je links → rechts */
  jobOrigin: number;
  cutSelected: boolean;
  /** Schnittreihenfolge je Schritt (Issue #222): innere Formen zuerst (Containment-Gatter) … */
  optInnerFirst: boolean;
  /** … kurze Leerwege (Nearest-Neighbor + Startknoten-Wahl, Alternative für manuelle Reihenfolge #153) … */
  optTravel: boolean;
  /** … Formen einer Gruppe zusammenhängend schneiden (Tie-Break unter gleichrangigen Formen) */
  optGroup: boolean;
  /** Geschlossene Konturen an der schärfsten Ecke beginnen: der Einstich liegt unauffällig in der Ecke (Issue #153, Ecke-Start) */
  optCornerStart: boolean;
  /** Unabhängige Richtungs-Rangfolge der Schnittreihenfolge (Bed-Space, Y-up); 'none' = aus */
  optDirOrder: DirOrder;
  /** Geschlossene Konturen am nächsten Knoten beginnen (nur Startwahl, keine Umsortierung) */
  optBestStart: boolean;
  /** Offene Konturen am näheren Ende beginnen (nur Richtungswahl, keine Umsortierung) */
  optBestDirection: boolean;
  /** Richtungswechsel reduzieren: Anfahrt im Kurskegel bevorzugen (nur mit kurzen Leerwegen) */
  optLessTurns: boolean;
  /** Nach dem Job zum Startpunkt zurückfahren */
  returnHome: boolean;
  homeOnConnect: boolean;
  /** Hat die Maschine Endschalter? Angabe aus dem Assistenten „Laser einrichten“; ohne gibt es dort keine Referenzfahrt */
  limitSwitches: 'yes' | 'no' | 'unknown';
  /** Rahmen mit eingeschaltetem Laser (niedrige Leistung) */
  frameLaser: boolean;
  framePower: number;
  frameSpeed: number;
  /** Testfeuer im Bewegen-Fenster: erst aktivieren, dann nie über die eingestellte Leistung/dauer */
  fireEnabled: boolean;
  /** Maximale Laserleistung für das Testfeuer in % (0 … 100) */
  fireMaxPower: number;
  /** Maximale Software-Laufzeit für das Testfeuer in Sekunden (größer 0 … 600); 0 ist ungültig */
  fireMaxSeconds: number;
  /** Befehl für Air Assist an (aus immer mit M9): M8 = Flood, M7 = Mist */
  airCmd: 'M8' | 'M7';
  /** Eigene G-Code-Zeilen vor dem Job (nach Einheiten und Laser-Modus) und nach dem Job (nach Laser aus) */
  startScript: string;
  endScript: string;
  /** Grenzen für Jobs, die ein KI-Agent anfordert: höchste Leistung in %, kleinste Geschwindigkeit in mm/min (0 = keine) */
  agentMaxPower: number;
  agentMinSpeed: number;
  rotary: Rotary;
  /** Motorische Z-Achse (Fokus) vorhanden: Layer dürfen den Fokus versetzen (Z-Versatz, tiefer je Durchgang) */
  zAxis: boolean;
  /** Z+ fährt Richtung Material (z. B. Tisch hebt sich); Standard: Z+ fährt den Kopf nach oben */
  zFlip: boolean;
  /** Z-Jog im Bewegen-Fenster nur nach Referenzfahrt (pro Verbindung einmal); false = lax, nur bekannte Position nötig */
  zJogStrict: boolean;
  /**
   * Rotpunkt-Zeiger (Issue #213): Lage des Strahls gegenüber dem Zeigerpunkt in mm, aus der Kalibrierung
   * (Position Strahl auf Kreuz minus Position Zeiger auf Kreuz, also A−B wie in LightBurn). Nur wenn
   * enabled: Positionieren und die Startreferenz (Aktuell/Benutzer) verschieben sich um diesen Versatz,
   * Geometrie, Schnitt und G-Code-Export bleiben Werkzeuglaser.
   */
  pointerOffset: { x: number; y: number; enabled: boolean };
  /**
   * Framing-Vorschau im Laser-Panel: 'pointer' (Default) fährt den Kopf so, dass der Rotpunkt den
   * Jobbereich abfährt (kompensiert, zeigt den echten Laserbereich); 'tool' fährt den Werkzeuglaser
   * (LightBurn-Verhalten, zugleich Kollisionsprüfung Kopf gegen Material/Spannpratzen).
   */
  frameView: 'pointer' | 'tool';
  /** Laser module (from the preset or entered by hand); informational, not used for G-code */
  laser?: LaserModule;
  /** Ruida UDP-Datenport auf dem Laser (Standard 50200, manche Steuerungen 40200) */
  ruidaPort?: number;
  /** Ruida UDP-Tastenport auf dem Laser (Standard 50207) */
  ruidaJogPort?: number;
  /** Ruida-Verschlüsselungsbyte (auto, 0x88, 0x11, 0x38) */
  ruidaMagic?: RuidaMagic;
  /** Ruida-Maschinennullpunkt-Ecke (Standard hinten rechts) */
  ruidaOrigin?: RuidaOrigin;
  /** Aktive Laserröhre bei Ruida (1, 2 oder beide) */
  ruidaLaser?: RuidaLaser;
}

export const DEFAULT_DEVICE: Device = {
  id: 'standard',
  name: 'Swiitol E6 Pro',
  fw: 'fluidnc',
  bedW: 400,
  bedH: 400,
  conn: 'serial',
  port: '',
  baud: 115200,
  host: 'fluidnc.local',
  tcpPort: 23,
  wsPort: 81,
  httpPort: 80,
  remotePort: 47900,
  remoteFp: '',
  rxBuffer: 127,
  runFrom: 'stream',
  jobOutputs: [],
  sMax: 1000,
  rapid: 6000,
  accel: 1500,
  junction: 0.01,
  startFrom: 'absolute',
  jobOrigin: 6,
  cutSelected: false,
  optInnerFirst: true,
  optTravel: true,
  optGroup: false,
  optCornerStart: false,
  optDirOrder: 'none',
  optBestStart: false,
  optBestDirection: false,
  optLessTurns: false,
  returnHome: true,
  homeOnConnect: false,
  limitSwitches: 'unknown',
  frameLaser: false,
  framePower: 1,
  frameSpeed: 3000,
  fireEnabled: false,
  fireMaxPower: 1,
  fireMaxSeconds: 5,
  airCmd: 'M8',
  startScript: '',
  endScript: '',
  agentMaxPower: 100,
  agentMinSpeed: 0,
  rotary: DEFAULT_ROTARY,
  zAxis: false,
  zJogStrict: true,
  zFlip: false,
  pointerOffset: { x: 0, y: 0, enabled: false },
  frameView: 'pointer',
  ruidaPort: 50200,
  ruidaJogPort: 50207,
  ruidaMagic: 'auto',
  ruidaOrigin: 'top-right',
  ruidaLaser: '1',
};

/** Built-in presets for new devices live in presets/devices (one JSON file per device), see packs.ts presetList */
export function newDevice(preset: Partial<Device> & { fw: Firmware }): Device {
  const fw = FIRMWARES[preset.fw];
  return {
    ...DEFAULT_DEVICE,
    host: preset.fw === 'fluidnc' ? 'fluidnc.local' : '',
    sMax: fw.sMax,
    ...preset,
    rotary: { ...DEFAULT_ROTARY, ...preset.rotary },
    pointerOffset: { ...DEFAULT_DEVICE.pointerOffset, ...preset.pointerOffset },
    ...(preset.laser ? { laser: { ...preset.laser } } : {}),
    id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  };
}

export interface DeviceStore {
  devices: Device[];
  current: string;
}

const STORE_KEY = 'kizamubeam.devices';
const OLD_KEY = 'kizamubeam.device';

export function loadDevices(): DeviceStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const st = JSON.parse(raw) as DeviceStore;
      st.devices = st.devices.map((d) => {
        // Einmalige Migration vom alten Einzelschalter (Issue #222): aus = beide Schritte aus
        const legacy = (d as { optimize?: boolean }).optimize;
        const migrated = { ...DEFAULT_DEVICE, ...d, rotary: { ...DEFAULT_ROTARY, ...d.rotary }, pointerOffset: { ...DEFAULT_DEVICE.pointerOffset, ...d.pointerOffset } };
        if (legacy === false) {
          migrated.optInnerFirst = false;
          migrated.optTravel = false;
        }
        delete (migrated as { optimize?: boolean }).optimize;
        return migrated;
      });
      if (st.devices.length) {
        if (!st.devices.some((d) => d.id === st.current)) st.current = st.devices[0].id;
        return st;
      }
    }
    // Früher gab es nur ein Gerät
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const single = JSON.parse(old) as Partial<Device> & { optimize?: boolean };
      const legacyOff = single.optimize === false;
      delete single.optimize;
      return { devices: [{ ...DEFAULT_DEVICE, ...single, id: 'standard', rotary: { ...DEFAULT_ROTARY }, pointerOffset: { ...DEFAULT_DEVICE.pointerOffset }, optInnerFirst: legacyOff ? false : (single.optInnerFirst ?? true), optTravel: legacyOff ? false : (single.optTravel ?? true) }], current: 'standard' };
    }
  } catch {
    /* Standardwerte */
  }
  return { devices: [{ ...DEFAULT_DEVICE, rotary: { ...DEFAULT_ROTARY } }], current: DEFAULT_DEVICE.id };
}

export function saveDevices(st: DeviceStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(st));
  } catch {
    /* nicht speicherbar, z. B. privates Fenster */
  }
}

// ---------- Drehachse ----------

/** Weg auf der Objektoberfläche für eine volle Umdrehung der Walze bzw. des Futters (mm) */
export const rotaryCirc = (r: Rotary) => Math.PI * (r.kind === 'chuck' ? r.objectDiam : r.rollerDiam);

/** Ist die Drehachse eingeschaltet und vollständig eingestellt? */
export const rotaryOn = (d: Device) => !!d.rotary?.enabled && d.rotary.perRev > 0 && rotaryCirc(d.rotary) > 0;

/**
 * Zeigerversatz für die Positionierung (Issue #213): wohin sich die Startreferenz verschiebt, wenn der
 * Rotpunkt das Ziel markiert. Konvention wie LightBurn (Offset = A−B): Der Zeigerpunkt liegt um den Offset
 * versetzt zum Kopf, also steht der Kopf beim Zielen um −Offset und fährt beim Start um +Offset zurück,
 * sodass der Strahl trifft. Mit Drehachse wirkt nur X (Y ist dann Umfangsrichtung, physikalisch ohne Zeiger).
 */
export function pointerShift(d: Device): Pt {
  const o = d.pointerOffset;
  if (!o?.enabled) return { x: 0, y: 0 };
  const x = Number.isFinite(o.x) ? o.x : 0;
  const y = rotaryOn(d) || !Number.isFinite(o.y) ? 0 : (o.y as number);
  return { x, y };
}

/**
 * Wirksamer Versatz fürs Positionieren (#213, Follow-up): In Stellung 'tool' fährt der Kopf
 * direkt ans Ziel. Sonst markiert der Rotpunkt das Ziel und der Kopf steht um −Offset.
 */
export function posShift(d: Device): Pt {
  return d.frameView === 'tool' ? { x: 0, y: 0 } : pointerShift(d);
}

/** Achsweg je mm auf der Objektoberfläche, negativ bei umgekehrter Drehrichtung */
export const rotaryScale = (r: Rotary) => (r.perRev / rotaryCirc(r)) * (r.mirror ? -1 : 1);

/** Buchstabe, unter dem die Y-Richtung des Entwurfs ausgegeben wird */
export const outAxis = (d: Device): RotaryAxis => (rotaryOn(d) ? d.rotary.axis : 'Y');

/** Drehachse als eigene Achse (nicht am Y-Anschluss): sie wird zu Beginn mit G92 auf 0 gesetzt */
export const separateAxis = (d: Device) => rotaryOn(d) && d.rotary.axis !== 'Y';

/** Konischer Ausgleich eingeschaltet und beide Durchmesser gültig? */
export const taperOn = (r: Rotary) => !!r.taper && r.taperLeft > 0 && r.taperRight > 0;

/** Kleinster Objektdurchmesser im Job: bei konischen Objekten der dünnere Rand */
export const minObjectDiam = (r: Rotary) => (taperOn(r) ? Math.min(r.taperLeft, r.taperRight) : r.objectDiam);

/** Größte Abweichung der Ausgabe von der Sollkurve beim Unterteilen gerader Strecken (mm auf der Oberfläche) */
const TAPER_TOL = 0.01;

/**
 * Bewegungen für die Ausgabe mit Drehachse. Y (Weg auf der Oberfläche) wird in Achsweg umgerechnet;
 * am Y-Anschluss bleibt der Startpunkt, wo er ist, eine eigene Achse beginnt bei 0.
 * Der Vorschub wird je Bewegung so angepasst, dass die Geschwindigkeit auf der Oberfläche stimmt
 * (die Steuerung rechnet F über X und den Achsweg). Ohne Drehachse kommen die Bewegungen unverändert zurück.
 *
 * Konisch (taper): Der Durchmesser D(x) wächst linear über die Breite des Jobs (box). Damit die Gravur überall
 * maßhaltig ist, dreht ein mm auf der Oberfläche um 1 / (π·D(x)) Umdrehungen, gerechnet ab der Mitte des Jobs
 * in Y (diese Linie bleibt gerade). Walzen treiben das Objekt am dickeren Ende an. Weil die Umrechnung von X
 * abhängt, werden Strecken entlang X so unterteilt, dass die Ausgabe höchstens TAPER_TOL abweicht; t (Endzeit
 * jeder Bewegung) wird dabei mit aufgeteilt.
 */
export function rotaryMoves(mv: Moves, d: Device, box: Box | null = null, t?: Float64Array): { mv: Moves; t?: Float64Array } {
  if (!rotaryOn(d)) return { mv, t };
  const r = d.rotary;
  const k0 = rotaryScale(r);
  const ref = mv.y0,
    base = r.axis === 'Y' ? ref : 0;
  let kAt = (_x: number) => k0,
    yc = ref;
  if (taperOn(r)) {
    let x0 = box?.x0 ?? Infinity,
      x1 = box?.x1 ?? -Infinity;
    if (!box) for (let i = 0; i < mv.n; i++) (x0 = Math.min(x0, mv.x[i])), (x1 = Math.max(x1, mv.x[i]));
    if (!(x1 >= x0)) x0 = x1 = mv.x0;
    const big = Math.max(r.taperLeft, r.taperRight);
    // Walzen: am dicken Ende dreht das Objekt so weit wie die Walze, am dünnen Ende entsprechend weniger
    const c = (r.kind === 'roller' ? r.rollerDiam / big : 1) * Math.PI;
    const sign = r.mirror ? -1 : 1;
    kAt = (x: number) => {
      const u = x1 > x0 ? Math.min(1, Math.max(0, (x - x0) / (x1 - x0))) : 0.5;
      return (sign * r.perRev) / (c * (r.taperLeft + (r.taperRight - r.taperLeft) * u));
    };
    yc = box ? (box.y0 + box.y1) / 2 : ref;
  }
  const zero = (ref - yc) * kAt(mv.x0);
  const map = (x: number, y: number) => base + (y - yc) * kAt(x) - zero;
  const tapered = taperOn(r);
  const out = new Moves(mv.x0, map(mv.x0, mv.y0));
  const tt: number[] = [];
  let px = mv.x0,
    py = mv.y0,
    pa = out.y0,
    pt = 0;
  const emit = (x: number, y: number, a: number, f: number, s: number, layer: number, cls: number, sub = -1, dw = 0, dws = 0, outgoing = 0) => {
    const dx = x - px,
      l = Math.hypot(dx, y - py);
    if (f > 0 && l > 1e-9) f = Math.max(1, Math.round((f * Math.hypot(dx, a - pa)) / l));
    out.push(x, a, f, s, layer, cls, sub);
    // Pausen sitzen nur auf Eilgang-Bewegungen (nie aufgespalten); beim Aufspalten trägt das erste Stück.
    out.dwell[out.n - 1] = dw;
    out.dwellS[out.n - 1] = dws;
    out.dwellOutgoing[out.n - 1] = outgoing;
    px = x;
    py = y;
    pa = a;
  };
  for (let i = 0; i < mv.n; i++) {
    const x = mv.x[i],
      y = mv.y[i],
      ti = t ? t[i] : 0;
    const sx = px,
      sy = py;
    let n = 1;
    if (tapered && mv.f[i] > 0) {
      // Abweichung in der Mitte jedes Stücks, umgerechnet auf mm der Oberfläche; sie fällt etwa mit n²
      const at = (u: number) => sx + (x - sx) * u;
      const worst = (n: number) => {
        let e = 0;
        for (let j = 0; j < n; j++) {
          const u0 = j / n,
            u1 = (j + 1) / n,
            um = (u0 + u1) / 2;
          const ym = sy + (y - sy) * um;
          e = Math.max(e, Math.abs(map(at(um), ym) - (map(at(u0), sy + (y - sy) * u0) + map(at(u1), sy + (y - sy) * u1)) / 2) / Math.abs(kAt(at(um))));
        }
        return e;
      };
      const e1 = worst(1);
      if (e1 > TAPER_TOL) {
        n = Math.min(1000, Math.ceil(Math.sqrt(e1 / TAPER_TOL)));
        while (n < 1000 && worst(n) > TAPER_TOL) n = Math.min(1000, Math.ceil(n * 1.25));
      }
    }
    out.zCur = mv.z[i];
    // Beim Aufspalten (nur f > 0) trägt das erste Teilstück die Pause; Eilgang wird nie aufgespalten.
    let carried = false;
    for (let j = 1; j <= n; j++) {
      const u = j / n,
        qx = sx + (x - sx) * u,
        qy = sy + (y - sy) * u;
      emit(qx, qy, map(qx, qy), mv.f[i], mv.s[i], mv.layer[i], mv.cls ? mv.cls[i] : MOVE_TRAVEL, mv.sub ? mv.sub[i] : -1, carried ? 0 : mv.dwell[i], carried ? 0 : mv.dwellS[i], carried ? 0 : mv.dwellOutgoing[i]);
      carried = true;
      tt.push(pt + (ti - pt) * u);
    }
    pt = ti;
  }
  // Die End-Pause gehört ans Jobende, nicht an eine Koordinate: Transformation erhält sie
  out.dwellTrailing = mv.dwellTrailing;
  return { mv: out, t: t ? Float64Array.from(tt) : undefined };
}

/** Relatives Verfahren um dx, dy mm (Oberfläche); mit Drehachse geht dy auf die Drehachse, f gilt für die Oberfläche */
export function jogLines(d: Device, dx: number, dy: number, f: number): string[] {
  const fw = FIRMWARES[d.fw];
  if (!rotaryOn(d)) return fw.jog(dx, dy, f);
  const k = rotaryScale(d.rotary);
  const l = Math.hypot(dx, dy);
  return fw.jog(dx, dy * k, l > 0 ? (f * Math.hypot(dx, dy * k)) / l : f, d.rotary.axis);
}

/** Z relativ verfahren (Bewegen-Fenster); nutzt denselben Jog-Befehl wie XY, nur mit Z-Buchstabe */
export function zJogLines(d: Device, dz: number, f: number): string[] {
  return FIRMWARES[d.fw].jog(0, dz, f, 'Z');
}

/** Absolut an eine Werkstückposition fahren (Laser zur Klickposition). y = null lässt Y stehen (z. B. mit Drehachse).
 *  GRBL-Familie über $J (Soft-Limits, Abbruch mit Jog-Cancel), xTool über G1 S0 mit M2 (führt Bewegungen erst nach dem Programmende aus), sonst G0 in G90. */
export function jogToLines(d: Device, x: number, y: number | null, f: number): string[] {
  const fw = FIRMWARES[d.fw];
  const axes = `X${num(x)}${y === null ? '' : ` Y${num(y)}`}`;
  if (fw.jog === grblJog) return [`$J=G90 G21 ${axes} F${Math.round(f)}`];
  if (fw.runsOnM2) return ['G90', `G1 ${axes} F${Math.round(f)} S0`, 'M2'];
  return ['G90', `G0 ${axes} F${Math.round(f)}`];
}

/** Rapid move to absolute coordinates (e.g. `X0 Y0`); xTool also needs M2 before it moves */
export function moveLines(d: Device, axes: string): string[] {
  return FIRMWARES[d.fw].runsOnM2 ? [`G0 ${axes}`, 'M2'] : [`G0 ${axes}`];
}

/** Testdrehung: das Objekt einmal ganz herumdrehen (bei Walzen hängt das vom Objektdurchmesser ab) */
export function rotaryTestLines(d: Device, speed = 1500): string[] {
  return jogLines(d, 0, Math.PI * d.rotary.objectDiam, speed);
}

// ---------- Bewegungsliste ----------

/** Prozessart je Bewegung für die Vorschau: 0 = Verfahren, 1 = Gravieren, 2 = Schneiden */
export const MOVE_TRAVEL = 0;
export const MOVE_ENGRAVE = 1;
export const MOVE_CUT = 2;

/** Bewegungen als typisierte Felder (Rasterjobs haben schnell Hunderttausende davon). f = 0 bedeutet Eilgang. */
export class Moves {
  n = 0;
  x = new Float64Array(1024);
  y = new Float64Array(1024);
  /** Leistung 0 … 1 */
  s = new Float32Array(1024);
  /** Vorschub mm/min, 0 = Eilgang */
  f = new Float32Array(1024);
  /** Layer-Index; Int16, weil der Materialtest bis zu 400 eigene Testlayer anlegt */
  layer = new Int16Array(1024);
  /** Prozessart (MOVE_*), nur für die Vorschau; 0 bei Verfahrwegen */
  cls = new Uint8Array(1024);
  /** Sublayer-Index im Layer (L.sub), -1 = Hauptbearbeitung; reine Metadaten, keine Maschinenwirkung */
  sub = new Int16Array(1024).fill(-1);
  /** Z-Versatz in mm gegenüber der Höhe beim Start (positiv = Fokus tiefer), gilt ab dieser Bewegung */
  z = new Float32Array(1024);
  /** Z-Versatz für die folgenden push-Aufrufe */
  zCur = 0;
  /** Pause in s vor dieser Bewegung (Start-/End-Pause je Schnitt, nur Linie); 0 = keine */
  dwell = new Float32Array(1024);
  /** Strahlleistung 0 … 1 während der Pause (Cut-Through-Anstechen); 0 = Strahl aus */
  dwellS = new Float32Array(1024);
  /** End-Pause der vorherigen Kontur: vor dem Z-Wechsel, anders als eine Start-/Anstechpause. */
  dwellOutgoing = new Uint8Array(1024);
  /** End-Pause der zuletzt fertiggestellten Kontur (s, Leistung): hängt an der nächsten Bewegung bzw. ans Jobende */
  dwellTrailing: { sec: number; s: number } | null = null;
  constructor(public x0 = 0, public y0 = 0) {}
  push(x: number, y: number, f: number, s: number, layer: number, cls = MOVE_TRAVEL, sub = -1) {
    if (this.n === this.x.length) {
      const grow = <T extends Float64Array | Float32Array | Int16Array | Uint8Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.x = grow(this.x);
      this.y = grow(this.y);
      this.s = grow(this.s);
      this.f = grow(this.f);
      this.layer = grow(this.layer);
      this.cls = grow(this.cls);
      this.sub = grow(this.sub);
      this.z = grow(this.z);
      this.dwell = grow(this.dwell);
      this.dwellS = grow(this.dwellS);
      this.dwellOutgoing = grow(this.dwellOutgoing);
    }
    const i = this.n++;
    this.z[i] = this.zCur;
    this.dwell[i] = 0;
    this.dwellS[i] = 0;
    this.dwellOutgoing[i] = 0;
    // Ausstehende End-Pause der vorherigen Kontur hängt sich an die nächste Bewegung (egal welche:
    // der Kopf steht noch am Konturende). Nur das Jobende liest dwellTrailing noch aus.
    if (this.dwellTrailing) {
      if (this.dwellTrailing.sec > 0) {
        this.dwell[i] = this.dwellTrailing.sec;
        this.dwellS[i] = this.dwellTrailing.s;
        this.dwellOutgoing[i] = 1;
      }
      this.dwellTrailing = null;
    }
    this.x[i] = x;
    this.y[i] = y;
    this.f[i] = f;
    this.s[i] = s;
    this.layer[i] = layer;
    this.cls[i] = cls;
    this.sub[i] = sub;
  }
  lastX() {
    return this.n ? this.x[this.n - 1] : this.x0;
  }
  lastY() {
    return this.n ? this.y[this.n - 1] : this.y0;
  }
}

/**
 * „Start Here“: Job ab einer Stelle fortsetzen. Eilgang zum Punkt bei Anteil frac der Bewegung i,
 * dann der Rest dieser Bewegung und alle folgenden. Liegt die Stelle in einem Eilgang, geht es an dessen Ziel weiter.
 */
export function startHere(mv: Moves, i: number, frac: number): Moves {
  const out = new Moves(mv.x0, mv.y0);
  if (i < 0 || i >= mv.n) return out;
  const ax = i ? mv.x[i - 1] : mv.x0,
    ay = i ? mv.y[i - 1] : mv.y0;
  const f = mv.f[i] > 0 ? Math.min(1, Math.max(0, frac)) : 1;
  const cls = mv.cls ? mv.cls[i] : MOVE_TRAVEL;
  const sub = mv.sub ? mv.sub[i] : -1;
  out.zCur = mv.z[i];
  out.push(ax + (mv.x[i] - ax) * f, ay + (mv.y[i] - ay) * f, 0, 0, mv.layer[i], MOVE_TRAVEL, sub);
  if (f < 1) out.push(mv.x[i], mv.y[i], mv.f[i], mv.s[i], mv.layer[i], cls, sub);
  for (let k = i + 1; k < mv.n; k++) {
    out.zCur = mv.z[k];
    out.push(mv.x[k], mv.y[k], mv.f[k], mv.s[k], mv.layer[k], mv.cls ? mv.cls[k] : MOVE_TRAVEL, mv.sub ? mv.sub[k] : -1);
    // Pausen hängen an der Bewegung, vor der sie stehen; alles bis i entfällt (Anstechen inklusive).
    // Die restliche Bahn endet weiter am Jobende, daher bleibt eine End-Pause erhalten.
    out.dwell[out.n - 1] = mv.dwell[k];
    out.dwellS[out.n - 1] = mv.dwellS[k];
    out.dwellOutgoing[out.n - 1] = mv.dwellOutgoing[k];
  }
  out.dwellTrailing = mv.dwellTrailing;
  return out;
}

/** Wird bei diesen Bewegungen überhaupt gelasert? */
export function burns(mv: Moves): boolean {
  for (let i = 0; i < mv.n; i++) if (mv.f[i] > 0 && mv.s[i] > 0) return true;
  return false;
}

/** Gleiche Bahnen, nur um offset verschoben (Vorschau gegen den Job zum Lasern) */
export function sameMoves(a: Moves, b: Moves, offset: Pt): boolean {
  if (a.n !== b.n) return false;
  const e = 1e-6;
  for (let i = 0; i < a.n; i++)
    if (a.f[i] !== b.f[i] || a.s[i] !== b.s[i] || a.layer[i] !== b.layer[i] || a.z[i] !== b.z[i] || a.dwell[i] !== b.dwell[i] || a.dwellS[i] !== b.dwellS[i] || a.dwellOutgoing[i] !== b.dwellOutgoing[i] || Math.abs(a.x[i] + offset.x - b.x[i]) > e || Math.abs(a.y[i] + offset.y - b.y[i]) > e) return false;
  const at = (t: { sec: number; s: number } | null) => (t && t.sec > 0 ? [t.sec, t.s] : null);
  const ta = at(a.dwellTrailing),
    tb = at(b.dwellTrailing);
  return (ta === null) === (tb === null) && (!ta || !tb || (ta[0] === tb[0] && ta[1] === tb[1]));
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Ergebnis der Prüfung „liegen alle Fahrwege auf dem Bett?“. box = Fahrbereich in Maschinenkoordinaten
 * (Bett von 0,0 bis Breite × Höhe), measured = mit dem von der Steuerung gemeldeten Werkstück-Nullpunkt gerechnet.
 */
export type BedCheck =
  | { kind: 'ok'; measured: boolean }
  | { kind: 'out'; box: Box; measured: boolean }
  /** Benutzer-Ursprung, dessen Lage die Steuerung (noch) nicht gemeldet hat */
  | { kind: 'unknown' };

/**
 * Fahrwege eines Jobs gegen den Arbeitsbereich prüfen. Der G-Code ist in Werkstückkoordinaten, auf der Maschine
 * landet er um den Werkstück-Nullpunkt wco versetzt. Ist wco unbekannt (null), gilt bei „Absolut“ und
 * „Aktuelle Position“ wie bisher Werkstück = Maschine; beim Benutzer-Ursprung lässt sich dann nichts sagen.
 */
export function checkBed(travel: Box | null, bed: { w: number; h: number }, d: Device, wco: Pt | null): BedCheck {
  if (!travel) return { kind: 'ok', measured: !!wco };
  if (!wco && d.startFrom === 'user') return { kind: 'unknown' };
  const o = wco ?? { x: 0, y: 0 };
  const box = { x0: travel.x0 + o.x, y0: travel.y0 + o.y, x1: travel.x1 + o.x, y1: travel.y1 + o.y };
  const e = 0.01;
  // Mit Drehachse ist Y der Umfang des Objekts, nur X muss aufs Bett passen
  const yOk = rotaryOn(d) || (box.y0 >= -e && box.y1 <= bed.h + e);
  if (box.x0 >= -e && box.x1 <= bed.w + e && yOk) return { kind: 'ok', measured: !!wco };
  return { kind: 'out', box, measured: !!wco };
}

export interface Job {
  moves: Moves;
  /** Ausdehnung der Laserbahnen (ohne Überfahrwege) in Ausgabekoordinaten */
  bounds: Box | null;
  /** Ausdehnung inkl. Überfahrwegen */
  travel: Box | null;
  /** Kontur aller Laserbahnen (konvexe Hülle) für den Gummiband-Rahmen */
  hull: Pt[];
  warnings: string[];
  /** Verschiebung von Bettkoordinaten auf Ausgabekoordinaten */
  offset: Pt;
  /** Layer, bei denen Air Assist läuft */
  air: number[];
  /** Zusammengefasste Doppel-Linien je Layer (Bettkoordinaten, für die Vorschau-Markierung) */
  dedup?: { layer: number; len: number; lines: Pt[][] }[];
}

export interface JobInput {
  doc: Doc;
  layer: (i: number) => Layer;
  imgLayer: (i: number) => ImageLayer;
  device: Device;
  /** Nur diese Objekte (für „Nur Auswahl lasern“) */
  only?: Obj[] | null;
  /** Schnittreihenfolge für diesen Job (V3, #153): Default ist das Geräte-Preset; ein Override
   * gilt nur für diesen Job und wird nicht gespeichert */
  order?: OrderOpts;
  /** Aktuelle Werkstückposition des Lasers (für „Aktuelle Position“) */
  position?: Pt | null;
  /** Für die Vorschau: Lage auf dem Bett zeigen, unabhängig von „Starten ab“ */
  forPreview?: boolean;
}

// ---------- Geometrie ----------

export interface Poly {
  pts: Pt[];
  closed: boolean;
  /** Haltestege: off[i] = 1 heißt Strecke ohne Laser (Perfo-Lücke), 2 = Haltesteg (ggf. reduzierte Leistung) */
  off?: Uint8Array;
  /** Startpunkt und Richtung vom Nutzer gesetzt: die Optimierung beginnt hier und kehrt nicht um */
  fixed?: boolean;
  /** Loch (liegt in einer ungeraden Zahl anderer Formen): Anschnitt und Auslauf liegen innen */
  hole?: boolean;
  /** Top-Level-Objekt (Gruppen-ID für „Gruppen zusammenhalten“, Issue #222) */
  grp?: string | number;
}

const FLATTEN_TOL = 0.01;

function flatten(sp: SubPath, m: Mat): Poly {
  const pts: Pt[] = [];
  const push = (p: Pt) => {
    const q = apply(m, p.x, p.y);
    const l = pts[pts.length - 1];
    if (!l || Math.abs(l.x - q.x) > 1e-6 || Math.abs(l.y - q.y) > 1e-6) pts.push(q);
  };
  if (sp.nodes.length) push(sp.nodes[0]);
  for (const s of segments(sp)) {
    if (!s.curve) {
      push(s.b);
      continue;
    }
    const w = [s.a, s.c1, s.c2, s.b].map((p) => apply(m, p.x, p.y));
    const len = Math.hypot(w[1].x - w[0].x, w[1].y - w[0].y) + Math.hypot(w[2].x - w[1].x, w[2].y - w[1].y) + Math.hypot(w[3].x - w[2].x, w[3].y - w[2].y);
    const n = Math.max(2, Math.min(4096, Math.ceil(Math.sqrt(len / FLATTEN_TOL) * 0.6)));
    for (let i = 1; i <= n; i++) push(bezierPt(s.a, s.c1, s.c2, s.b, i / n));
  }
  if (sp.closed && pts.length > 2) {
    const a = pts[0],
      b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
  }
  return { pts, closed: sp.closed && pts.length > 2, ...(sp.start ? { fixed: true } : {}) };
}

const finite = (b: Box) => (isFinite(b.x0) ? b : null);

/** Konvexe Hülle (monotone Kette) */
export function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [],
    upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Ankerpunkt des Job-Ursprungs (0 … 8, oben links bis unten rechts) in einem Rahmen mit y nach oben */
export function anchorOf(b: Box, k: number): Pt {
  const col = k % 3,
    row = Math.floor(k / 3);
  return { x: b.x0 + ((b.x1 - b.x0) * col) / 2, y: b.y1 - ((b.y1 - b.y0) * row) / 2 };
}

// ---------- Reihenfolge der Linien ----------

/**
 * Optimierte Reihenfolge: Innere Formen vor den umgebenden, sonst immer die nächstgelegene Form.
 * Geschlossene Formen beginnen am nächsten Knoten, offene am näheren Ende.
 */
/** Unabhängige Richtungs-Rangfolge der Schnittreihenfolge (Bed-Space, Y-up): ltr = links nach rechts,
 * rtl = rechts nach links, ttb = oben nach unten (größtes cy zuerst), btt = unten nach oben; none = aus */
export type DirOrder = 'none' | 'ltr' | 'rtl' | 'ttb' | 'btt';

/** Schritte der Schnittreihenfolge (Issue #222); der Leerweg-Schritt ist der Haken für manuelle Reihenfolge (#153) */
export interface OrderOpts {
  /** innere Formen zuerst (Containment-Gatter); aus = Dokumentreihenfolge ohne Vorfahrtsregel */
  innerFirst: boolean;
  /** kurze Leerwege (Nearest-Neighbor + Startknoten-Wahl/Umkehr); aus = keine Umsortierung, kein Umdrehen */
  travel: boolean;
  /** Formen desselben Top-Level-Objekts bevorzugt nacheinander (Tie-Break, Containment schlägt Kohäsion) */
  group: boolean;
  /** Geschlossene Konturen an der schärfsten Ecke beginnen (keine Umsortierung: zählt nicht als Optimierung für die manuelle Reihenfolge) */
  cornerStart: boolean;
  /** unabhängige Richtungs-Rangfolge; 'none' = aus */
  dirOrder: DirOrder;
  /** Startknoten ohne Umsortierung: geschlossene Kontur beginnt am nächsten Knoten */
  bestStart: boolean;
  /** offene Konturen: näherer Endpunkt zuerst (keine Umsortierung) */
  bestDirection: boolean;
  /** Richtungswechsel reduzieren (Heading-Bonus); nur mit travel, sortiert um */
  lessTurns: boolean;
}

/** Job-Override der Schnittreihenfolge (V3, #153): null/undefined folgt dem Geräte-Preset, sitzungsweit, nicht gespeichert */
export interface OrderOverride { innerFirst?: boolean | null; travel?: boolean | null; group?: boolean | null; cornerStart?: boolean | null; dirOrder?: DirOrder | null; bestStart?: boolean | null; bestDirection?: boolean | null; lessTurns?: boolean | null }
/** Effektive Schalter: Override oder Preset — eine Stelle für Job, Prüfung (manualOrder) und Anzeige */
export const effOrderOf = (device: Device, o: OrderOverride): OrderOpts => ({
  innerFirst: o.innerFirst ?? device.optInnerFirst,
  travel: o.travel ?? device.optTravel,
  group: o.group ?? device.optGroup,
  cornerStart: o.cornerStart ?? device.optCornerStart,
  dirOrder: o.dirOrder ?? device.optDirOrder,
  bestStart: o.bestStart ?? device.optBestStart,
  bestDirection: o.bestDirection ?? device.optBestDirection,
  lessTurns: o.lessTurns ?? device.optLessTurns,
});
/** Manuell ist die Reihenfolge nur, wenn kein Optimierer umsortiert (Ecke-Start rotiert nur den Anfangspunkt, dann warnt die Prüfung weiter) */
export const isManualOrder = (o: OrderOpts): boolean => !o.innerFirst && !o.travel && !o.group && o.dirOrder === 'none' && !o.lessTurns;

/** Kosinus-Grenze für Ecke-Start (#153): nur Richtungswechsel ab 30° gelten als Ecke —
 * feine Tessellierung glatter Kurven behält ihren gespeicherten Anfang */
const CORNER_MIN_COS = Math.cos(Math.PI / 6);
/** Schärfste Ecke einer geschlossenen Kontur (Ecke-Start, #153): Index mit maximalem Richtungswechsel
 * (Gleichstand: erste Ecke in Punktreihenfolge); -1 bei offener Kontur, zu wenigen Punkten oder ohne
 * echte Ecke (z. B. Kreis: dort ist jeder Tessellierungspunkt gleich „scharf“) */
export function sharpestCorner(p: Poly): number {
  const n = p.pts.length;
  if (!p.closed || n < 3) return -1;
  let best = -1,
    bestCos = CORNER_MIN_COS;
  for (let j = 0; j < n; j++) {
    const a = p.pts[(j + n - 1) % n],
      b = p.pts[j],
      c = p.pts[(j + 1) % n];
    const ix = b.x - a.x,
      iy = b.y - a.y,
      ox = c.x - b.x,
      oy = c.y - b.y;
    const li = Math.hypot(ix, iy),
      lo = Math.hypot(ox, oy);
    if (li < 1e-9 || lo < 1e-9) continue;
    const cos = (ix * ox + iy * oy) / (li * lo);
    if (cos < bestCos) [bestCos, best] = [cos, j];
  }
  return best;
}

/** Kosinus-Grenze und quadrierter Distanzfaktor für lessTurns: Anfahrt im 30°-Kegel um den bisherigen
 * Kurs kostet nur 85 % Distanz (0,85² auf den quadrierten Vergleichswert, mit dem orderTravel rechnet).
 * Begründung: Wer die Richtung hält, spart Abbremsen/Beschleunigen an Richtungswechseln; der Bonus ist
 * klein genug, dass Containment-Gatter und Gruppen-Vorfahrt ungebrochen bleiben. */
const LESS_TURNS_COS = Math.cos(Math.PI / 6);
const LESS_TURNS_D2 = 0.85 * 0.85;

/** Leerweg-Schritt der Reihenfolge (Nearest-Neighbor); separater Haken für manuelle Reihenfolge (#153) */
function orderTravel(polys: Poly[], from: Pt, avail: (i: number) => boolean, lastGrp: string | number | undefined, corner: boolean, heading?: Pt): { idx: number; at: number; rev: boolean } {
  const n = polys.length;
  const boxes = orderBoxes.get(polys) ?? [];
  let best = -1,
    bestD = Infinity,
    bestIdx = 0,
    bestRev = false,
    bestSame = false;
  // Richtungsbonus (lessTurns): Eintrittspunkt im Kurskegel vergünstigt werten
  const disc = (ex: number, ey: number, d: number): number => {
    if (!heading) return d;
    const hx = heading.x,
      hy = heading.y,
      ax = ex - from.x,
      ay = ey - from.y;
    const lh = Math.hypot(hx, hy),
      la = Math.hypot(ax, ay);
    if (lh < 1e-9 || la < 1e-9) return d;
    return (hx * ax + hy * ay) / (lh * la) >= LESS_TURNS_COS ? d * LESS_TURNS_D2 : d;
  };
  for (let i = 0; i < n; i++) {
    if (!avail(i)) continue;
    const p = polys[i];
    const same = lastGrp !== undefined && p.grp !== undefined && p.grp === lastGrp;
    if (best >= 0 && bestSame && !same) continue;
    const b = boxes[i];
    // Untergrenze über den Rahmen: weiter entfernte Formen gar nicht erst durchsuchen
    // (mit Heading um den Maximalbonus gelockert, sonst würde der Kegel falsch beschnitten)
    const dx = Math.max(b.x0 - from.x, 0, from.x - b.x1),
      dy = Math.max(b.y0 - from.y, 0, from.y - b.y1);
    if (same === bestSame && dx * dx + dy * dy >= (heading ? bestD / LESS_TURNS_D2 : bestD)) continue;
    if (p.fixed) {
      // gesetzter Startpunkt: nur dort beginnen, Richtung bleibt
      const d = disc(p.pts[0].x, p.pts[0].y, (p.pts[0].x - from.x) ** 2 + (p.pts[0].y - from.y) ** 2);
      if (same !== bestSame || d < bestD) [bestD, best, bestIdx, bestRev, bestSame] = [d, i, 0, false, same];
    } else if (p.closed) {
      // Ecke-Start (#153): nur die schärfste Ecke ist Kandidat (fixierte sind hier nie: obiger Zweig)
      const only = corner ? sharpestCorner(p) : -1;
      if (only >= 0) {
        const d = disc(p.pts[only].x, p.pts[only].y, (p.pts[only].x - from.x) ** 2 + (p.pts[only].y - from.y) ** 2);
        if (same !== bestSame || d < bestD) [bestD, best, bestIdx, bestRev, bestSame] = [d, i, only, false, same];
      } else {
        for (let j = 0; j < p.pts.length; j++) {
          const d = disc(p.pts[j].x, p.pts[j].y, (p.pts[j].x - from.x) ** 2 + (p.pts[j].y - from.y) ** 2);
          if (same !== bestSame || d < bestD) [bestD, best, bestIdx, bestRev, bestSame] = [d, i, j, false, same];
        }
      }
    } else {
      const a = p.pts[0],
        e = p.pts[p.pts.length - 1];
      const da = disc(a.x, a.y, (a.x - from.x) ** 2 + (a.y - from.y) ** 2),
        de = disc(e.x, e.y, (e.x - from.x) ** 2 + (e.y - from.y) ** 2);
      if (same !== bestSame || da < bestD) [bestD, best, bestIdx, bestRev, bestSame] = [da, i, 0, false, same];
      if (same !== bestSame || de < bestD) [bestD, best, bestIdx, bestRev, bestSame] = [de, i, 0, true, same];
    }
  }
  return { idx: best, at: bestIdx, rev: bestRev };
}

// Rahmen je Poly-Array für den Leerweg-Schritt (pro Aufruf einmal berechnet)
const orderBoxes = new WeakMap<readonly Poly[], Box[]>();

/** Richtungs-Rangfolge (dirOrder): Kontur mit extremem Rahmenmittelpunkt zuerst
 * (ltr: kleinstes cx, rtl: größtes cx, ttb: größtes cy [Y-up, Bed-Space], btt: kleinstes cy);
 * Gleichstand → niedrigster Index. Gruppen-Tie-Break wie im Leerweg-Schritt: gibt es eine
 * verfügbare Kontur derselben Gruppe, zählen nur diese. Das Containment-Gatter läuft über avail(). */
function orderDirection(polys: Poly[], boxes: Box[], avail: (i: number) => boolean, dir: DirOrder, lastGrp: string | number | undefined): number {
  let sameAny = false;
  if (lastGrp !== undefined) {
    for (let i = 0; i < polys.length; i++)
      if (avail(i) && polys[i].grp !== undefined && polys[i].grp === lastGrp) {
        sameAny = true;
        break;
      }
  }
  let pick = -1,
    best = Infinity;
  for (let i = 0; i < polys.length; i++) {
    if (!avail(i)) continue;
    if (sameAny && polys[i].grp !== lastGrp) continue;
    const b = boxes[i];
    const cx = (b.x0 + b.x1) / 2,
      cy = (b.y0 + b.y1) / 2;
    const v = dir === 'ltr' ? cx : dir === 'rtl' ? -cx : dir === 'ttb' ? -cy : cy;
    if (v < best) {
      best = v;
      pick = i;
    }
  }
  return pick;
}

function orderPolys(polys: Poly[], from: Pt, o: OrderOpts): Poly[] {
  const n = polys.length;

  if (!o.innerFirst && !o.travel && !o.group && !o.cornerStart && o.dirOrder === 'none' && !o.bestStart && !o.bestDirection && !o.lessTurns) return polys;

  const boxes = boxesOf(polys);
  orderBoxes.set(polys, boxes);

  // Für jede Form: wie viele noch ungeschnittene Formen liegen in ihr?
  const pending = new Int32Array(n);
  const containers: number[][] = polys.map(() => []);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!containsStrict(polys, boxes, i, j)) continue;
      containers[i].push(j);
      pending[j]++;
    }
  }
  
  const done = new Uint8Array(n);
  const out: Poly[] = [];
  let cur = from;
  let prev: Pt | undefined;
  let lastGrp: string | number | undefined;
  // Start/Orientierung nach der Auswahl: fixiert → Anfang, geschlossen → Ecke (vorrangig) oder
  // bestStart-Nächstknoten, offen → näherer Endpunkt (nur wenn bestDirection oder travel umsortiert)
  const orientFor = (p: Poly, at: Pt, corner: boolean): { at: number; rev: boolean } => {
    if (p.fixed) return { at: 0, rev: false };
    if (p.closed) {
      const only = corner ? sharpestCorner(p) : -1;
      if (only >= 0) return { at: only, rev: false };
      if (o.bestStart) {
        let bi = 0,
          bd = Infinity;
        for (let j = 0; j < p.pts.length; j++) {
          const d = (p.pts[j].x - at.x) ** 2 + (p.pts[j].y - at.y) ** 2;
          if (d < bd) {
            bd = d;
            bi = j;
          }
        }
        return { at: bi, rev: false };
      }
      return { at: 0, rev: false };
    }
    if (o.bestDirection || o.travel) {
      const a = p.pts[0],
        e = p.pts[p.pts.length - 1];
      return { at: 0, rev: (e.x - at.x) ** 2 + (e.y - at.y) ** 2 < (a.x - at.x) ** 2 + (a.y - at.y) ** 2 };
    }
    return { at: 0, rev: false };
  };
  for (let k = 0; k < n; k++) {
    const avail = (i: number) => !done[i] && (!o.innerFirst || pending[i] <= 0);
    let pick: number, at: number, rev: boolean;
    if (o.dirOrder !== 'none') {
      pick = orderDirection(polys, boxes, avail, o.dirOrder, o.group ? lastGrp : undefined);
      if (pick >= 0 && o.travel) ({ at, rev } = orientFor(polys[pick], cur, o.cornerStart));
      else [at, rev] = [0, false];
    } else if (o.travel) {
      const heading = o.lessTurns && prev ? { x: cur.x - prev.x, y: cur.y - prev.y } : undefined;
      ({ idx: pick, at, rev } = orderTravel(polys, cur, avail, o.group ? lastGrp : undefined, o.cornerStart, heading));
    } else if (o.group && lastGrp !== undefined) {
      // ohne Leerweg-Optik: Dokumentreihenfolge, bevorzugt aus derselben Gruppe
      pick = -1;
      at = 0;
      rev = false;
      for (let i = 0; i < n; i++) if (avail(i)) { pick = i; break; }
      for (let i = 0; i < n; i++)
        if (avail(i) && polys[i].grp !== undefined && polys[i].grp === lastGrp) { pick = i; break; }
    } else {
      pick = -1;
      at = 0;
      rev = false;
      for (let i = 0; i < n; i++) if (avail(i)) { pick = i; break; }
    }
    if (pick! < 0) {
      // Zyklus (sollte nicht vorkommen): Rest in Dokumentreihenfolge
      for (let i = 0; i < n; i++) if (!done[i]) ((done[i] = 1), out.push(polys[i]));
      break;
    }
    done[pick!] = 1;
    for (const c of containers[pick!]) pending[c]--;
    const p = polys[pick!];
    let q = o.travel && p.closed && at ? startAt(p, at) : p;
    // Ecke-Start ohne Leerweg-Optik (#153): geschlossene Kontur an der schärfsten Ecke beginnen
    if (!o.travel && o.cornerStart && p.closed && !p.fixed) {
      const c = sharpestCorner(p);
      if (c > 0) q = startAt(p, c);
    } else if (!o.travel && (o.bestStart || o.bestDirection)) {
      // Startknoten/Richtung ohne Umsortierung: Ecke-Start bleibt vorrangig (obiger Zweig)
      const bo = orientFor(p, cur, false);
      if (p.closed && bo.at) q = startAt(p, bo.at);
      else if (!p.closed && bo.rev) q = { pts: [...q.pts].reverse(), closed: false, grp: q.grp, ...(q.off ? { off: q.off.slice().reverse() } : {}) };
    }
    if (o.travel && rev) q = { pts: [...q.pts].reverse(), closed: false, grp: q.grp, ...(q.off ? { off: q.off.slice().reverse() } : {}) };
    out.push(q);
    lastGrp = q.grp;
    const pts = q.pts;
    const last = p.closed ? pts[0] : pts[pts.length - 1];
    prev = cur;
    cur = last;
  }
  return out;
}
/** Geschlossene Form ab Punkt k beginnen lassen (Haltestege wandern mit) */
function startAt(p: Poly, k: number): Poly {
  const pts = p.pts.slice(k).concat(p.pts.slice(0, k));
  if (!p.off) return { pts, closed: p.closed, fixed: p.fixed, hole: p.hole, grp: p.grp };
  const off = new Uint8Array(p.off.length);
  off.set(p.off.subarray(k));
  off.set(p.off.subarray(0, k), p.off.length - k);
  return { pts, closed: p.closed, off, fixed: p.fixed, hole: p.hole, grp: p.grp };
}

// ---------- Kerf und Haltestege ----------

/** Clipper rechnet mit Ganzzahlen: 1 Einheit = 0,1 µm */
const KSCALE = 10000;

/**
 * Kerf-Versatz der geschlossenen Konturen eines Objekts: Fläche nach Gerade-Ungerade-Regel bilden,
 * dann um d versetzen. Positiv vergrößert Außenkonturen und verkleinert Löcher, sodass ausgeschnittene
 * Teile die gezeichneten Maße behalten. Runde Ecken entsprechen dem runden Laserfleck.
 *
 * Vertrag (Issue #220): nur geschlossene Konturen mit >= 3 Punkten werden versetzt. Offene Konturen
 * laufen ohne Kerf durch (werden gezählt, siehe buildJob), degenerierte (< 3 Punkte) entfallen,
 * berührende Flächen werden per Union zusammengefasst (merged-Zähler), vollständig aufgelöste
 * Flächen (z. B. Loch kleiner als der Versatz) entfallen (vanished). Reihenfolge im Job ist immer
 * Kerf → Tabs → Perforation → Reihenfolge → Anschnitt (Tabs werden auf der kompensierten Kontur neu
 * verteilt); bei Füllen wirkt Kerf auf die Hüll-Geometrie vor der Schraffur, Bilder ignorieren Kerf.
 */
export interface KerfReport {
  polys: Poly[];
  /** geschlossene Eingänge mit >= 3 Punkten */
  valid: number;
  /** degenerierte geschlossene Eingänge (< 3 Punkte), entfallen */
  degenerate: number;
  /** per Union zusammengefasste Konturen (valid - Ausgabe, soweit Ausgabe nicht leer) */
  merged: number;
  /** true, wenn trotz gültiger Eingänge nichts übrig blieb (z. B. Loch vom Versatz verschluckt) */
  vanished: boolean;
}

export function kerfOffsetReport(polys: Poly[], d: number): KerfReport {
  const closed = polys.filter((p) => p.closed);
  const degenerate = closed.length - closed.filter((p) => p.pts.length > 2).length;
  const validSrc = closed.filter((p) => p.pts.length > 2);
  if (!validSrc.length || !d) return { polys, valid: validSrc.length, degenerate, merged: 0, vanished: false };
  const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;
  const paths = validSrc.map((p) => p.pts.map((q) => ({ X: Math.round(q.x * KSCALE), Y: Math.round(q.y * KSCALE) })));
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const area: ClipperLib.Paths = [];
  c.Execute(ClipType.ctUnion, area, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
  const co = new ClipperOffset(2, 0.002 * KSCALE);
  co.AddPaths(area, JoinType.jtRound, EndType.etClosedPolygon);
  const out: ClipperLib.Paths = [];
  co.Execute(out, d * KSCALE);
  const res: Poly[] = out.filter((p) => p.length > 2).map((p) => ({ pts: p.map((q) => ({ x: q.X / KSCALE, y: q.Y / KSCALE })), closed: true }));
  const kept = keepStarts(validSrc, res);
  const vanished = kept.length === 0;
  const merged = vanished ? 0 : Math.max(0, validSrc.length - kept.length);
  return { polys: kept, valid: validSrc.length, degenerate, merged, vanished };
}

export function kerfOffset(polys: Poly[], d: number): Poly[] {
  return kerfOffsetReport(polys, d).polys;
}

/**
 * Carry user-set start points over to offset contours (Clipper starts them anywhere): the contour nearest to the
 * original start begins at its nearest point and runs in the original direction.
 */
function keepStarts(src: Poly[], res: Poly[]): Poly[] {
  for (const p of src) {
    if (!p.fixed || !p.closed || !p.pts.length) continue;
    const s = p.pts[0];
    let bi = -1,
      bj = 0,
      bd = Infinity;
    res.forEach((r, i) => {
      if (r.fixed) return;
      r.pts.forEach((q, j) => {
        const dd = (q.x - s.x) ** 2 + (q.y - s.y) ** 2;
        if (dd < bd) [bd, bi, bj] = [dd, i, j];
      });
    });
    if (bi < 0) continue;
    let q = startAt(res[bi], bj);
    if (Math.sign(signedArea(q.pts)) !== Math.sign(signedArea(p.pts))) q = { ...q, pts: [q.pts[0], ...q.pts.slice(1).reverse()] };
    res[bi] = { ...q, fixed: true };
  }
  return res;
}

/** Höchstzahl der Ringe je Insel, falls Abstand und Fläche nicht zusammenpassen */
const MAX_RINGS = 20000;

/**
 * Konturfolgende Füllung (Offset Fill): die Fläche (Gerade-Ungerade) wird in Ringen abgetragen, die der Kontur
 * nach innen folgen. Der erste Ring liegt einen halben Abstand innerhalb, damit die Gravur die gezeichneten Maße
 * behält. Jede zusammenhängende Fläche (Insel samt Löchern) wird vollständig von außen nach innen gefüllt,
 * bevor es zur nächstgelegenen weitergeht; jeder Ring beginnt am Punkt, der dem vorigen Ende am nächsten liegt.
 */
function offsetFillRings(polys: Poly[], step: number, from: Pt): Poly[] {
  const closed = polys.filter((p) => p.closed);
  if (!closed.length || !(step > 0)) return [];
  const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType, PolyTree } = ClipperLib;
  const c = new Clipper();
  c.AddPaths(closed.map((p) => p.pts.map((q) => ({ X: Math.round(q.x * KSCALE), Y: Math.round(q.y * KSCALE) }))), PolyType.ptSubject, true);
  const tree = new PolyTree();
  c.Execute(ClipType.ctUnion, tree, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
  // Inseln: Außenkontur mit ihren Löchern; Inseln in Löchern sind eigene Inseln
  const islands: ClipperLib.Paths[] = [];
  const walk = (outers: ClipperLib.PolyNode[]) => {
    for (const o of outers) {
      islands.push([o.Contour(), ...o.Childs().map((h) => h.Contour())]);
      for (const h of o.Childs()) walk(h.Childs());
    }
  };
  walk(tree.Childs());
  const ringsOf = (island: ClipperLib.Paths): Poly[] => {
    // Ring für Ring vom vorigen aus versetzen; Aufräumen hält die Punktzahl an runden Ecken klein
    const out: Poly[] = [];
    let area = island;
    for (let k = 0; k < MAX_RINGS && area.length; k++) {
      const co = new ClipperOffset(2, FLATTEN_TOL * KSCALE);
      co.AddPaths(area, JoinType.jtRound, EndType.etClosedPolygon);
      const next: ClipperLib.Paths = [];
      co.Execute(next, -(k ? step : step / 2) * KSCALE);
      area = Clipper.CleanPolygons(next, FLATTEN_TOL * KSCALE).filter((p) => p.length > 2);
      for (const p of area) out.push({ pts: p.map((q) => ({ x: q.X / KSCALE, y: q.Y / KSCALE })), closed: true });
    }
    return out;
  };
  const groups = islands.map(ringsOf).filter((g) => g.length);
  const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const nearest = (p: Poly, cur: Pt) => {
    let best = 0;
    for (let j = 1; j < p.pts.length; j++) if (dist2(p.pts[j], cur) < dist2(p.pts[best], cur)) best = j;
    return best;
  };
  const out: Poly[] = [];
  let cur = from;
  const done = new Uint8Array(groups.length);
  for (let k = 0; k < groups.length; k++) {
    // nächste Insel nach ihrem äußersten Ring
    let gi = -1,
      gd = Infinity;
    for (let i = 0; i < groups.length; i++) {
      if (done[i]) continue;
      const d = dist2(groups[i][0].pts[nearest(groups[i][0], cur)], cur);
      if (d < gd) [gd, gi] = [d, i];
    }
    done[gi] = 1;
    for (const r of groups[gi]) {
      const q = startAt(r, nearest(r, cur));
      out.push(q);
      cur = q.pts[0];
    }
  }
  return out;
}

/** Haltestege gleichmäßig über den Umfang einer geschlossenen Form verteilen */
export function addTabs(p: Poly, T: TabSettings): Poly {
  const P = p.pts,
    n = P.length;
  if (!p.closed || n < 3 || !(T.size > 0)) return p;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = P[i],
      b = P[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n];
  let k = T.useCount ? Math.round(T.count) : Math.max(1, Math.round(total / Math.max(0.1, T.spacing)));
  // Optionale Begrenzung: Deckel zuerst, Boden danach; die Passform-Regel unten gewinnt immer.
  // Zählwerte deckeln, damit die Passform-Schleife immer terminiert (Import-/API-Daten sind nicht UI-begrenzt).
  if (T.maxTabs > 0) k = Math.min(k, Math.round(T.maxTabs));
  if (T.minTabs > 1) k = Math.max(k, Math.round(T.minTabs));
  if (!Number.isFinite(k)) return p;
  if (k > 100000) k = 100000;
  // Stege dürfen höchstens die Hälfte des Umfangs ausmachen
  while (k > 0 && T.size >= (total / k) * 0.5) k--;
  if (k < 1) return p;
  const step = total / k,
    half = T.size / 2;
  const cuts: number[] = [];
  for (let j = 0; j < k; j++) cuts.push(step * (j + 0.5) - half, step * (j + 0.5) + half);
  const inTab = (d: number) => Math.abs(d - step * (Math.floor(d / step) + 0.5)) < half;
  const pts: Pt[] = [],
    off: number[] = [];
  let b = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i],
      e = P[(i + 1) % n];
    const d0 = cum[i],
      d1 = cum[i + 1],
      l = d1 - d0;
    pts.push(a);
    let last = d0;
    while (b < cuts.length && cuts[b] <= d0) b++;
    while (l > 1e-9 && b < cuts.length && cuts[b] < d1) {
      const t = (cuts[b] - d0) / l;
      // Steg = 2 (ggf. reduzierte Leistung), sonst 0; 1 bleibt der Perforation vorbehalten
      off.push(inTab((last + cuts[b]) / 2) ? 2 : 0);
      pts.push({ x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t });
      last = cuts[b++];
    }
    off.push(inTab((last + d1) / 2) ? 2 : 0);
  }
  return { pts, closed: true, off: Uint8Array.from(off), fixed: p.fixed, hole: p.hole, grp: p.grp };
}

/** Haltestege für alle geschlossenen Formen eines Layers; innere Formen auf Wunsch auslassen */
function withTabs(polys: Poly[], T: TabSettings): Poly[] {
  const boxes = boxesOf(polys);
  // Haltesteg-Ausschluss für Innenformen nach derselben Regel wie die Schnittreihenfolge (Issue #219):
  // erster Punkt oder Rahmenmitte im Container, identische Rahmen einseitig gezählt.
  const inner = (i: number) => polys.some((_, j) => containsStrict(polys, boxes, i, j));
  return polys.map((p, i) => (p.closed && !(T.skipInner && inner(i)) ? addTabs(p, T) : p));
}

// ---------- Rasterzeilen ----------

/** Ein Lauf auf einer Zeile: von x0 nach x1 (x0 < x1) mit Leistung s (0 … 1) */
type Run = [x0: number, x1: number, s: number];

interface ScanOptions {
  speed: number;
  bidirectional: boolean;
  /** Überfahrweg in mm */
  overscan: number;
  layer: number;
  /** Sublayer-Index im Layer, -1 = Hauptbearbeitung; reine Metadaten */
  sub?: number;
  /** Zeilen liegen in einem um diesen Winkel (rad) gedrehten System */
  angle?: number;
}

/** Lücken bis zu dieser Länge fährt der Laser ausgeschaltet mit Arbeitsgeschwindigkeit durch */
const GAP_RAPID = 10;

function emitScanlines(out: Moves, lines: { y: number; runs: Run[] }[], o: ScanOptions, flip: { v: boolean }) {
  const { speed: F, overscan: ov, layer } = o;
  const sub = o.sub ?? -1;
  const rc = Math.cos(o.angle ?? 0),
    rs = Math.sin(o.angle ?? 0);
  const mv = o.angle
    ? { push: (x: number, y: number, f: number, s: number, l: number, c = MOVE_TRAVEL, q = -1) => out.push(x * rc - y * rs, x * rs + y * rc, f, s, l, c, q) }
    : out;
  for (const ln of lines) {
    if (!ln.runs.length) continue;
    const rev = o.bidirectional && flip.v;
    flip.v = !flip.v;
    const runs = rev ? ln.runs.map(([a, b, s]) => [-b, -a, s] as Run).reverse() : ln.runs;
    const sx = rev ? -1 : 1;
    const y = ln.y;
    let first = true;
    let px = 0;
    for (const [a, b, s] of runs) {
      if (first) {
        mv.push(sx * (a - ov), y, 0, 0, layer, MOVE_TRAVEL, sub);
        mv.push(sx * a, y, F, 0, layer, MOVE_TRAVEL, sub);
        first = false;
      } else if (a - px > GAP_RAPID + 2 * ov) {
        mv.push(sx * (px + ov), y, F, 0, layer, MOVE_TRAVEL, sub);
        mv.push(sx * (a - ov), y, 0, 0, layer, MOVE_TRAVEL, sub);
        mv.push(sx * a, y, F, 0, layer, MOVE_TRAVEL, sub);
      } else if (a > px) mv.push(sx * a, y, F, 0, layer, MOVE_TRAVEL, sub);
      mv.push(sx * b, y, F, s, layer, s > 0 ? MOVE_ENGRAVE : MOVE_TRAVEL, sub);
      px = b;
    }
    mv.push(sx * (px + ov), y, F, 0, layer, MOVE_TRAVEL, sub);
  }
}

/** Füllen: Zeilen im Abstand interval über alle geschlossenen Formen (gerade-ungerade-Regel) */
function fillLines(polys: Poly[], interval: number, s: number): { y: number; runs: Run[] }[] {
  const edges: [number, number, number, number][] = []; // ymin, ymax, x bei ymin, dx/dy
  const b = emptyBox();
  for (const p of polys) {
    if (!p.closed) continue;
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      const a = p.pts[i],
        c = p.pts[(i + 1) % n];
      addPt(b, a.x, a.y);
      if (a.y === c.y) continue;
      const [lo, hi] = a.y < c.y ? [a, c] : [c, a];
      edges.push([lo.y, hi.y, lo.x, (hi.x - lo.x) / (hi.y - lo.y)]);
    }
  }
  if (!edges.length) return [];
  edges.sort((e, f) => e[0] - f[0]);
  const out: { y: number; runs: Run[] }[] = [];
  let next = 0;
  let active: [number, number, number, number][] = [];
  // Zeilen ab der unteren Kante, um ein halbes Intervall versetzt
  for (let y = b.y0 + interval / 2; y < b.y1; y += interval) {
    while (next < edges.length && edges[next][0] <= y) active.push(edges[next++]);
    active = active.filter((e) => e[1] > y);
    const xs = active.map((e) => e[2] + (y - e[0]) * e[3]).sort((p, q) => p - q);
    const runs: Run[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 1e-4) continue;
      const last = runs[runs.length - 1];
      if (last && xs[i] - last[1] < 1e-4) last[1] = xs[i + 1];
      else runs.push([xs[i], xs[i + 1], s]);
    }
    out.push({ y, runs });
  }
  return out;
}

/**
 * Bildzeilen: Ausgabepunkte des geditherten Bildes je Zeile zu Läufen gleicher Leistung zusammenfassen.
 * In der Desktop-App rechnet das der Rust-Kern (src-tauri/core/src/raster.rs, scan_lines) nach denselben Regeln.
 */
async function imageLines(shape: ImageShape, world: Mat, toOut: Mat, L: ImageOutput): Promise<{ y: number; runs: Run[] }[] | null> {
  const { cols, rows } = outputGrid(shape, world, L.interval);
  const M = mul(toOut, world); // lokal (mm) → Ausgabe
  const IM = inv(M);
  const packed = await nativeScanLines(shape, L, cols, rows, M, IM);
  if (packed) return unpackLines(packed);
  // Browser (ohne Rust-Kern)
  const v = processImage(shape, L, cols, rows, M);
  const edited = shape.edit !== undefined ? imageRasterGeometry(shape) : undefined;
  const clipQuad = edited?.order === 'perspectiveFirst'
    ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map(p => {
      const q = edited.geometry.sourceToLocal(p);
      if (!q) throw new ImageProcessingError('geometry', 'Invalid full perspective vertex');
      return q;
    }) : undefined;
  const rounded = shape.edit?.cornerRadii?.some(r => r > 0) ? resolveImageContour(shape, M) : null;
  if (rounded && !rounded.ok) throw new ImageProcessingError('geometry', 'Invalid rounded image contour');
  return v && scanLines(v, shape.w, shape.h, L, cols, rows, M, IM,
    edited && { ...edited, clipQuad, rounded: rounded?.ok ? rounded.contour : undefined });
}

/** Rasterzeilen aus dem Rust-Kern: je Zeile y, Anzahl der Läufe, dann x0, x1, s je Lauf */
function unpackLines(p: Float64Array): { y: number; runs: Run[] }[] {
  const out: { y: number; runs: Run[] }[] = [];
  for (let i = 0; i < p.length; ) {
    const y = p[i],
      n = p[i + 1];
    i += 2;
    const runs: Run[] = new Array(n);
    for (let k = 0; k < n; k++, i += 3) runs[k] = [p[i], p[i + 1], p[i + 2]];
    out.push({ y, runs });
  }
  return out;
}

/** Rasterzeilen aus dem verarbeiteten Bild v (cols × rows) der Größe w × h mm; M: lokal → Ausgabe, IM: Umkehrung */
export function scanLines(v: Uint8Array | Uint8ClampedArray, w: number, h: number, L: ImageOutput, cols: number, rows: number, M: Mat, IM: Mat,
  edited?: Pick<ReturnType<typeof imageRasterGeometry>, 'bounds' | 'quad'> & {
    clipQuad?: readonly Pt[]; rounded?: Pick<ImageContour, 'rowSpan'>;
  }): { y: number; runs: Run[] }[] {
  const b = emptyBox();
  const quad = (edited?.quad ?? [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }])
    .map(p => apply(M, p.x, p.y));
  const clipQuad = edited?.clipQuad?.map(p => apply(M, p.x, p.y));
  if (edited && [...quad, ...(clipQuad ?? [])].some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new ImageProcessingError('geometry', 'Invalid transformed image vertex');
  }
  for (const q of quad) {
    addPt(b, q.x, q.y);
  }
  // Achsparallel: genau ein Abtastpunkt pro Ausgabepunkt; gedreht: Raster im Zeilenabstand
  const aligned = Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9;
  const stepX = aligned ? (b.x1 - b.x0) / cols : L.interval;
  const stepY = aligned ? (b.y1 - b.y0) / rows : L.interval;
  const nx = Math.max(1, Math.round((b.x1 - b.x0) / stepX)),
    ny = Math.max(1, Math.round((b.y1 - b.y0) / stepY));
  const gray = isGrayMode(L.dither);
  const pmax = L.power / 100,
    pmin = Math.min(L.minPower, L.power) / 100;
  const out: { y: number; runs: Run[] }[] = [];
  for (let j = 0; j < ny; j++) {
    const y = b.y0 + (j + 0.5) * stepY;
    // Convex visible polygon: clip whole powered segments, not only their
    // sample centers. Pixel filtering alone could burn past a slanted edge.
    let span = edited ? imageRowSpan(quad, y) : null;
    if (clipQuad && span) {
      // Intersect row spans, not bounding boxes: the convex intersection can
      // have up to eight vertices, while the raster grid/phase stays unchanged.
      const clip = imageRowSpan(clipQuad, y);
      span = clip ? [Math.max(span[0], clip[0]), Math.min(span[1], clip[1])] : null;
      if (span && span[0] >= span[1]) span = null;
    }
    if (edited?.rounded && span) {
      const round = edited.rounded.rowSpan(y);
      span = round ? [Math.max(span[0], round[0]), Math.min(span[1], round[1])] : null;
      if (span && span[0] >= span[1]) span = null;
    }
    const runs: Run[] = [];
    let cur: Run | null = null;
    // Retain the original grid phase and edge samples, but avoid transforming
    // empty bounding-box columns (especially thin, rotated images).
    const sampleSpan = edited ? span : imageRowSpan(quad, y);
    const first = sampleSpan ? Math.max(0, Math.floor((sampleSpan[0] - b.x0) / stepX) - 1) : 0;
    const end = sampleSpan ? Math.min(nx, Math.ceil((sampleSpan[1] - b.x0) / stepX) + 1) : edited ? 0 : nx;
    for (let k = first; k < end; k++) {
      const x = b.x0 + (k + 0.5) * stepX;
      const q = apply(IM, x, y);
      const c = Math.floor(((q.x - (edited?.bounds.x ?? 0)) / (edited?.bounds.width ?? w)) * cols),
        r = Math.floor(((q.y - (edited?.bounds.y ?? 0)) / (edited?.bounds.height ?? h)) * rows);
      let s = 0;
      if (c >= 0 && c < cols && r >= 0 && r < rows && (!edited || (span && x >= span[0] && x <= span[1]))) {
        const val = v[r * cols + c];
        if (gray) s = val >= 255 ? 0 : Math.round((pmin + (pmax - pmin) * (1 - val / 255)) * 1000) / 1000;
        else s = val < 128 ? pmax : 0;
      }
      const xa = b.x0 + k * stepX,
        xb = xa + stepX;
      if (cur && cur[2] === s && Math.abs(cur[1] - xa) < 1e-9) cur[1] = xb;
      else {
        if (cur && cur[2] > 0) runs.push(cur);
        cur = [xa, xb, s];
      }
    }
    if (cur && cur[2] > 0) runs.push(cur);
    out.push({ y, runs: edited ? runs.flatMap(([a, z, s]): Run[] => {
      if (!span) return [];
      const x0 = Math.max(a, span[0]), x1 = Math.min(z, span[1]);
      return x1 > x0 ? [[x0, x1, s]] : [];
    }) : runs });
  }
  return out;
}

function imageRowSpan(quad: Pt[], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
      xs.push(a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y)));
    }
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

/** Formen um den Ursprung drehen (Winkel in rad) */
function rotatePolys(polys: Poly[], a: number): Poly[] {
  if (!a) return polys;
  const c = Math.cos(a),
    s = Math.sin(a);
  return polys.map((p) => ({ ...p, pts: p.pts.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c })) }));
}

// ---------- Job berechnen ----------

const FLIP = (h: number): Mat => [1, 0, 0, -1, 0, h];

/** Eine Bearbeitung eines Layers: der Layer selbst oder ein Sub-Layer, mit ursprünglichem Sublayer-Index */
type CutEntry = Omit<CutSettings, 'air' | 'look' | 'sub'>;
type EntryWithSub = { e: CutEntry; sub: number };

/** Bearbeitungen eines Layers in Ausgabereihenfolge: der Layer selbst, dann eingeschaltete Sub-Layer. Durchgänge laufen pro Bearbeitung (#218): Jede Entry beendet ihre eigenen passes, bevor die nächste startet; es gibt keinen globalen Repeat. */
const entriesOf = (L: Layer): EntryWithSub[] => [
  { e: L, sub: -1 },
  ...(L.sub ?? []).map((s: SubLayer, i: number) => ({ e: s as CutEntry, sub: i })).filter((x) => (x.e as SubLayer).output),
];

/** Manuelle Reihenfolge (Issue #153): zählt innere Formen, deren äußere Form früher geschnitten wird.
 * Manuell = Stapel-/Dokumentreihenfolge (alle drei Optimierungen aus); `containsStrict` aus dem Topologie-Modul (#219). */
function countManualViolations(polys: Poly[]): number {
  if (polys.length < 2) return 0;
  const boxes = boxesOf(polys);
  let n = 0;
  for (let j = 0; j < polys.length; j++) {
    if (!polys[j].closed) continue;
    for (let i = 0; i < j; i++) {
      // deckungsgleiche Konturen (gleicher Rahmen) sind Doppellinien, kein innen/außen (#221)
      const a = boxes[i],
        b = boxes[j];
      if (a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1) continue;
      if (containsStrict(polys, boxes, j, i)) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Bewegungen einer Bearbeitung; pass(p) setzt vor jedem Durchgang den Z-Versatz */
function emitEntry(mv: Moves, e: CutEntry, polys: Poly[], li: number, si: number, flip: { v: boolean }, pass: (p: number) => void, ord: OrderOpts) {
  const s = e.power / 100;
  const passes = Math.max(1, e.passes);
  if (e.mode === 'fill' && e.fillStyle === 'offset') {
    const rings = offsetFillRings(polys, Math.max(0.01, e.interval), { x: mv.lastX(), y: mv.lastY() });
    for (let p = 0; p < passes; p++) {
      pass(p);
      for (const r of rings) {
        mv.push(r.pts[0].x, r.pts[0].y, 0, 0, li, MOVE_TRAVEL, si);
        for (let i = 1; i < r.pts.length; i++) mv.push(r.pts[i].x, r.pts[i].y, e.speed, s, li, s > 0 ? MOVE_ENGRAVE : MOVE_TRAVEL, si);
        mv.push(r.pts[0].x, r.pts[0].y, e.speed, s, li, s > 0 ? MOVE_ENGRAVE : MOVE_TRAVEL, si);
      }
    }
    return;
  }
  if (e.mode === 'fill') {
    // Zeilen im gedrehten System berechnen und beim Ausgeben zurückdrehen; Kreuzschraffur = zweite Richtung um 90° versetzt
    const angles = [e.angle, ...(e.crossHatch ? [e.angle + 90] : [])].map((a) => (a * Math.PI) / 180);
    const sets = angles.map((a) => ({ a, lines: fillLines(rotatePolys(polys, -a), Math.max(0.01, e.interval), s) }));
    const ov = (Math.max(0, e.overscan) / 100) * (e.speed / 60);
    for (let p = 0; p < passes; p++) {
      pass(p);
      for (const st of sets) emitScanlines(mv, st.lines, { speed: e.speed, bidirectional: e.bidirectional, overscan: ov, layer: li, sub: si, angle: st.a }, flip);
    }
    return;
  }
  const { cuts, lead } = lineCuts(polys, e);
  const ramp = e.ramp.enabled && e.ramp.length > 0 && e.minPower < e.power ? e.ramp : null;
  const sMin = Math.max(0, e.minPower) / 100;
  // Start-/End-Pause je Schnitt (#153-Phasenplan): Start hängt an der ersten Schnittbewegung (nach der
  // Anfahrbewegung), Ende an der folgenden Verfahrbewegung — bzw. ans Jobende, wenn keine mehr kommt.
  const dw = e.dwell ?? { start: 0, end: 0, cutThrough: false, power: 0 };
  const startSec = Number.isFinite(dw.start) ? Math.min(60000, Math.max(0, dw.start)) / 1000 : 0;
  const endSec = Number.isFinite(dw.end) ? Math.min(60000, Math.max(0, dw.end)) / 1000 : 0;
  const pwRaw = dw.power ?? 0;
  const pierce = dw.cutThrough && Number.isFinite(pwRaw) ? Math.min(1, Math.max(0, pwRaw) / 100) : 0;
  // Stegleistung: 0 = Laser aus wie bisher, darüber reduzierter Schnitt auf den Stegen (Markierung 2)
  const tpRaw = e.tabs.tabPower ?? 0;
  const tabP = Number.isFinite(tpRaw) ? Math.min(1, Math.max(0, tpRaw / 100)) : 0;
  for (let p = 0; p < passes; p++) {
    pass(p);
    const order = ord.innerFirst || ord.travel || ord.group || ord.cornerStart || ord.dirOrder !== 'none' || ord.bestStart || ord.bestDirection || ord.lessTurns ? orderPolys(cuts, { x: mv.lastX(), y: mv.lastY() }, ord) : cuts;
    for (const poly of order) {
      const path = contourPath(poly, lead, tabP > 0);
      if (path.pts.length < 2) continue;
      // Die Anfahrbewegung übernimmt per push() automatisch eine ausstehende End-Pause der Vorkontur.
      mv.push(path.pts[0].x, path.pts[0].y, 0, 0, li, MOVE_TRAVEL, si);
      const cutAt = mv.n;
      if (ramp) {
        const r = rampPath(path, s, sMin, ramp);
        for (let i = 1; i < r.pts.length; i++) { const rs = r.s[i - 1]; const pw = rs < 0 ? s * tabP : rs; mv.push(r.pts[i].x, r.pts[i].y, e.speed, pw, li, pw > 0 ? MOVE_CUT : MOVE_TRAVEL, si); }
      } else for (let i = 1; i < path.pts.length; i++) { const o = path.off[i - 1]; const pw = o === 2 ? s * tabP : o ? 0 : s; mv.push(path.pts[i].x, path.pts[i].y, e.speed, pw, li, pw > 0 ? MOVE_CUT : MOVE_TRAVEL, si); }
      if (startSec > 0) {
        mv.dwell[cutAt] = startSec;
        mv.dwellS[cutAt] = pierce;
      }
      if (endSec > 0) mv.dwellTrailing = { sec: endSec, s: 0 };
    }
  }
}

/** Settings a line entry needs to build its cut contours (kerf is applied per object before this) */
export type LineEntry = Pick<CutSettings, 'mode' | 'kerf' | 'tabs' | 'perf' | 'lead'>;

/**
 * Cut contours of a line entry in output form: holes marked for the lead side, then tabs and perforation.
 * Shared by the job (emitEntry) and the canvas lead overlay (leadMarks), so both show the same geometry.
 */
function lineCuts(polys: Poly[], e: Pick<LineEntry, 'tabs' | 'perf' | 'lead'>): { cuts: Poly[]; lead: LeadSettings | null } {
  const lead = e.lead.leadIn || e.lead.leadOut || e.lead.overcut > 0 ? e.lead : null;
  if (lead) markHoles(polys);
  let cuts = e.tabs.enabled ? withTabs(polys, e.tabs) : polys;
  if (e.perf.enabled) cuts = cuts.map((p) => perforate(p, e.perf));
  return { cuts, lead };
}

/** Cut path of one contour as it is emitted: never start inside a tab (the laser would first run it unpowered) */
function contourPath(poly: Poly, lead: LeadSettings | null, keepPoweredTabs = false): CutPath {
  if (poly.off?.[0]) poly = startAt(poly, Math.max(0, poly.off.indexOf(0)));
  return cutPath(poly, lead, keepPoweredTabs);
}

/** Lead-in or lead-out of one contour for the canvas: pts runs in cutting direction and touches the contour */
export interface LeadMark {
  pts: Pt[];
  out: boolean;
  /** Start point set by the user; otherwise path optimization may still move it */
  fixed: boolean;
}

/**
 * Lead-ins and lead-outs of a line entry, computed exactly like the job (kerf per object, holes, tabs,
 * perforation, cutPath). objs = flattened contours per object in document coordinates (y down), bedH = bed
 * height: the work runs in bed coordinates like the job, because Clipper picks the start of kerf contours there.
 * The start used is the contour's own start; with path optimization and no fixed start point the job may begin
 * elsewhere. Also meant for the CAM overlay (#151).
 */
export function leadMarks(objs: Poly[][], e: LineEntry, bedH: number): LeadMark[] {
  if (e.mode !== 'line' || !(e.lead.leadIn || e.lead.leadOut) || e.lead.length <= 0) return [];
  const flip = (pts: Pt[]) => pts.map((q) => ({ x: q.x, y: bedH - q.y }));
  const list: Poly[] = [];
  for (const own0 of objs) {
    const own = own0.map((p) => ({ ...p, pts: flip(p.pts) }));
    if (!e.kerf) {
      list.push(...own);
      continue;
    }
    list.push(...own.filter((p) => !p.closed), ...kerfOffset(own.filter((p) => p.closed), e.kerf));
  }
  const { cuts, lead } = lineCuts(list, e);
  const out: LeadMark[] = [];
  for (const poly of cuts) {
    if (!poly.closed) continue;
    const path = contourPath(poly, lead, (e.tabs.tabPower ?? 0) > 0);
    const fixed = !!poly.fixed;
    if (path.nIn) out.push({ pts: flip(path.pts.slice(0, path.nIn + 1)), out: false, fixed });
    if (path.nOut) out.push({ pts: flip(path.pts.slice(path.pts.length - path.nOut - 1)), out: true, fixed });
  }
  return out;
}

/** Flatten a sub-path into a polyline with matrix m (same tolerance as the job) */
export const flattenSub = (sp: SubPath, m: Mat): Poly => flatten(sp, m);

/** Schnittweg einer Form als Punktfolge: off[k] = 1 heißt Strecke k ohne Laser, 2 = Haltesteg (ggf. reduzierte Leistung) */
interface CutPath {
  pts: Pt[];
  off: number[];
  /** Points added in front as lead-in / at the end as lead-out */
  nIn?: number;
  nOut?: number;
}

/** Doppelter Flächeninhalt mit Vorzeichen (positiv = gegen den Uhrzeigersinn bei y nach oben) */
function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a;
}

/** Formen, die in einer ungeraden Zahl anderer geschlossener Formen liegen, als Loch markieren */
function markHoles(polys: Poly[]) {
  const { depth } = buildContainment(polys);
  for (let i = 0; i < polys.length; i++) {
    if (!polys[i].closed) continue;
    polys[i].hole = depth[i] % 2 === 1;
  }
}

/**
 * Perforation: entlang der Form abwechselnd on mm schneiden und off mm ohne Laser fahren.
 * Vorhandene Haltestege bleiben erhalten (ggf. mit reduzierter Leistung).
 */
export function perforate(p: Poly, P: PerfSettings): Poly {
  const on = Math.max(0.01, P.on),
    gap = Math.max(0, P.off);
  if (!gap) return p;
  const src = p.pts,
    n = src.length,
    segs = p.closed ? n : n - 1;
  const pts: Pt[] = [],
    off: number[] = [];
  let state = 0,
    rem = on;
  for (let i = 0; i < segs; i++) {
    const a = src[i],
      b = src[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const base = p.off?.[i] ?? 0;
    pts.push(a);
    let u = 0;
    for (;;) {
      if (rem >= l - u - 1e-9) {
        // Perforationslücke (state 1) bleibt immer laserlos — auch über einem Steg
        off.push(state === 1 ? 1 : base || state);
        rem -= l - u;
        break;
      }
      u += rem;
      off.push(state === 1 ? 1 : base || state);
      pts.push({ x: a.x + ((b.x - a.x) * u) / l, y: a.y + ((b.y - a.y) * u) / l });
      state ^= 1;
      rem = state ? gap : on;
    }
  }
  if (!p.closed) pts.push(src[n - 1]);
  return { pts, closed: p.closed, off: Uint8Array.from(off), fixed: p.fixed, hole: p.hole, grp: p.grp };
}

/**
 * Schnittweg einer Form mit Überschnitt, Anschnitt (Lead-In) und Auslauf (Lead-Out). Beides nur bei geschlossenen
 * Formen und immer auf der Abfallseite: bei Außenkonturen außen, bei Löchern innen. Strecken ohne Laser am Ende
 * (Haltesteg, Perforation) fallen weg.
 */
export function cutPath(p: Poly, lead: LeadSettings | null, keepPoweredTabs = false): CutPath {
  const n = p.pts.length;
  const pts = p.pts.slice();
  const off: number[] = [];
  for (let i = 0; i < n - 1; i++) off.push(p.off?.[i] ?? 0);
  if (p.closed) {
    pts.push(p.pts[0]);
    off.push(p.off?.[n - 1] ?? 0);
  }
  const trim = () => {
    // Nur echte laserlose Enden (Perfo-Lücke) fallen weg; ein bestromter Steg (2) bleibt
    // stehen, ein stromloser (Legacy) wird wie bisher gekappt
    while (off.length && (off[off.length - 1] === 1 || (off[off.length - 1] === 2 && !keepPoweredTabs))) (off.pop(), pts.pop());
  };
  if (!p.closed || !lead || n < 3) {
    trim();
    return { pts, off };
  }
  // Überschnitt: der Kontur über den Anfang hinaus folgen (höchstens eine Runde)
  let rest = lead.overcut;
  for (let i = 0; i < n && rest > 1e-9; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= rest) {
      pts.push({ x: a.x + ((b.x - a.x) * rest) / l, y: a.y + ((b.y - a.y) * rest) / l });
      off.push(off[i]);
      rest = 0;
    } else {
      pts.push(b);
      off.push(off[i]);
      rest -= l;
    }
  }
  trim();
  if (pts.length < 2) return { pts, off };
  const ccw = signedArea(p.pts) > 0;
  // Abfallseite: rechts der Fahrtrichtung bei gegen den Uhrzeigersinn umlaufenden Außenkonturen
  const side = (t: Pt): Pt => {
    const k = (ccw ? 1 : -1) * (p.hole ? -1 : 1);
    return { x: t.y * k, y: -t.x * k };
  };
  const dir = (a: Pt, b: Pt): Pt | null => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return l > 1e-9 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : null;
  };
  const L = Math.max(0, lead.length);
  let nIn = 0,
    nOut = 0;
  if (lead.leadIn && L > 0 && !off[0]) {
    let t: Pt | null = null;
    for (let i = 1; i < pts.length && !t; i++) t = dir(pts[0], pts[i]);
    if (t) {
      const q = leadPts(pts[0], t, side(t), L, lead, true);
      pts.unshift(...q);
      off.unshift(...q.map(() => 0));
      nIn = q.length;
    }
  }
  if (lead.leadOut && L > 0 && !off[off.length - 1]) {
    const e = pts[pts.length - 1];
    let t: Pt | null = null;
    for (let i = pts.length - 2; i >= 0 && !t; i--) t = dir(pts[i], e);
    if (t) {
      const q = leadPts(e, t, side(t), L, lead, false);
      pts.push(...q);
      off.push(...q.map(() => 0));
      nOut = q.length;
    }
  }
  return { pts, off, nIn, nOut };
}

/**
 * Punkte von Anschnitt (bis vor p) oder Auslauf (nach p). t = Fahrtrichtung der Kontur an p, w = Richtung zur
 * Abfallseite. Gerade: Länge L im Winkel zur Kontur. Bogen: tangential an die Kontur, Bogenwinkel = angle.
 */
function leadPts(p: Pt, t: Pt, w: Pt, L: number, lead: LeadSettings, isIn: boolean): Pt[] {
  const sg = isIn ? -1 : 1;
  // Vorzeichen des Winkels wählt die Seite: + Abfallseite (Standard), − Gegenseite (Material)
  const ww = lead.angle < 0 ? { x: -w.x, y: -w.y } : w;
  if (!lead.arc) {
    const a = (Math.min(90, Math.max(0, Math.abs(lead.angle))) * Math.PI) / 180;
    return [{ x: p.x + ww.x * L * Math.sin(a) + sg * t.x * L * Math.cos(a), y: p.y + ww.y * L * Math.sin(a) + sg * t.y * L * Math.cos(a) }];
  }
  const th = (Math.min(180, Math.max(1, lead.angle)) * Math.PI) / 180;
  const r = L / th;
  const c = { x: p.x + ww.x * r, y: p.y + ww.y * r };
  const m = Math.max(4, Math.ceil(th / (Math.PI / 24)));
  const at = (phi: number): Pt => ({
    x: c.x + r * (-ww.x * Math.cos(phi) + sg * t.x * Math.sin(phi)),
    y: c.y + r * (-ww.y * Math.cos(phi) + sg * t.y * Math.sin(phi)),
  });
  const out: Pt[] = [];
  if (isIn) for (let k = m; k >= 1; k--) out.push(at((th * k) / m));
  else for (let k = 1; k <= m; k++) out.push(at((th * k) / m));
  return out;
}

/**
 * Leistungsrampe: an Ecken (Richtungswechsel ab R.angle) und auf Wunsch an Anfang und Ende sinkt die Leistung auf
 * sMin und steigt über R.length mm linear wieder auf s. Strecken in Reichweite einer Ecke werden dafür unterteilt.
 * Ergebnis: Punkte und Leistung je Strecke.
 */
export function rampPath(path: CutPath, s: number, sMin: number, R: RampSettings): { pts: Pt[]; s: number[] } {
  const { pts, off } = path;
  const m = pts.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const total = cum[m - 1];
  const limit = Math.cos((Math.min(179, Math.max(1, R.angle)) * Math.PI) / 180);
  // Richtung der Strecke k (null bei Länge 0)
  const dir = (k: number): Pt | null => {
    const l = cum[k + 1] - cum[k];
    return l > 1e-9 ? { x: (pts[k + 1].x - pts[k].x) / l, y: (pts[k + 1].y - pts[k].y) / l } : null;
  };
  const corner = (a: Pt | null, b: Pt | null) => !!a && !!b && a.x * b.x + a.y * b.y <= limit;
  const ramps: number[] = [];
  if (R.ends) ramps.push(0);
  let prev: Pt | null = null;
  let first: Pt | null = null;
  for (let k = 0; k < m - 1; k++) {
    const d = dir(k);
    if (!d) continue;
    if (!first) first = d;
    if (corner(prev, d)) ramps.push(cum[k]);
    prev = d;
  }
  const loop = m > 2 && Math.hypot(pts[0].x - pts[m - 1].x, pts[0].y - pts[m - 1].y) < 1e-6;
  if (!R.ends && loop && corner(prev, first)) ramps.unshift(0), ramps.push(total);
  if (R.ends) ramps.push(total);
  const Lr = R.length;
  const near = (d: number) => {
    // Abstand zur nächsten Rampenstelle (ramps ist aufsteigend)
    let lo = 0,
      hi = ramps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ramps[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    let best = Infinity;
    if (lo < ramps.length) best = ramps[lo] - d;
    if (lo > 0) best = Math.min(best, d - ramps[lo - 1]);
    return best;
  };
  const power = (d: number) => sMin + (s - sMin) * Math.min(1, near(d) / Lr);
  const outPts: Pt[] = [pts[0]],
    outS: number[] = [];
  const step = Math.max(0.05, Lr / 8);
  for (let k = 0; k < m - 1; k++) {
    const a = pts[k],
      b = pts[k + 1],
      c0 = cum[k],
      c1 = cum[k + 1],
      l = c1 - c0;
    if (off[k] || !ramps.length || l < 1e-9 || Math.min(near(c0), near(c1), near((c0 + c1) / 2)) >= Lr) {
      outPts.push(b);
      // Stegmarkierung (−1) übersteht die Rampe; die Leistung löst die Emission auf
      outS.push(off[k] === 2 ? -1 : off[k] ? 0 : s);
      continue;
    }
    const n = Math.min(400, Math.max(1, Math.ceil(l / step)));
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      outPts.push(j === n ? b : { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      outS.push(power(c0 + l * (u - 0.5 / n)));
    }
  }
  return { pts: outPts, s: outS };
}

/** Aus dem Dokument einen Job berechnen. Texte werden mit ihren Schriftkonturen gelasert. */
/** Validate edited images before parking can omit a whole group. Geometry is shared with the editor. */
function jobParkedObjs(roots: Obj[], bed: { w: number; h: number }, layerOf: (i: number) => Layer): Set<Obj> {
  for (const [o] of outputLeaves(roots)) {
    const s = o.shape;
    if (s.kind !== 'image' || s.edit === undefined || o.reg || !layerOf(o.layer).output) continue;
    imageRasterGeometry(s);
  }
  return parkedObjs(roots, bed, layerOf);
}

/** Fehlermeldung für eine gescheiterte Bildschnitt-Kontur (Job und Konstruktionsprüfung teilen sie). */
export function imageCutIssueText(reason: 'missing-contour' | 'invalid-contour' | 'invalid-geometry', name: string): string {
  const detail = reason === 'missing-contour'
    ? t('Die zugewiesene Vektorkontur fehlt.')
    : reason === 'invalid-contour'
      ? t('Die zugewiesene Vektorkontur ist ungültig (nicht geschlossen oder sich selbst schneidend).')
      : t('Die Bildkontur konnte nicht berechnet werden.');
  return t('Bild „{name}“: Schnitt nicht möglich — {detail}', { name, detail });
}

export async function buildJob(inp: JobInput): Promise<Job> {
  const { doc, device } = inp;
  /** Effektive Schnittreihenfolge: Job-Override oder Geräte-Preset (eine Stelle für Warnung und Ausgabe) */
  const orderOpts: OrderOpts = inp.order ?? effOrderOf(device, {});
  const layerOf = (i: number) => normalizeLayer(inp.layer(i));
  const warnings: string[] = [];
  let roots = inp.only ?? doc.objs;
  // Parts parked completely outside the work area are not lasered. Only with absolute coordinates: relative jobs
  // ignore the bed position, and with a rotary y is the circumference
  const parked = device.startFrom !== 'absolute' || rotaryOn(device) ? new Set<Obj>() : jobParkedObjs(roots, doc.bed, layerOf);
  if (parked.size) {
    roots = roots.filter((o) => !parked.has(o));
    warnings.push(tn('{n} Objekt liegt ganz außerhalb des Arbeitsbereichs (geparkt) und wird nicht gelasert.', '{n} Objekte liegen ganz außerhalb des Arbeitsbereichs (geparkt) und werden nicht gelasert.', parked.size));
  }
  const toBed = FLIP(doc.bed.h);

  // Objekte nach ID für zugewiesene Bildschnitt-Konturen: auch ausgeblendete/noLaser-Objekte
  // müssen auffindbar bleiben, weil die Zuordnung sie gerade auf noLaser setzt.
  const byId = objectsById(doc.objs);

  // Top-Level-ID je Blatt für „Gruppen zusammenhalten“ (Issue #222): Blätter desselben
  // obersten Objekts (inkl. Gruppenkinder) teilen sich die Gruppen-ID.
  const topOf = new Map<Obj, string | number>();
  {
    const walk = (top: Obj, o: Obj) => {
      if (o.shape.kind === 'group') {
        for (const c of o.shape.children) walk(top, c);
        return;
      }
      topOf.set(o, top.id);
    };
    for (const o of roots) walk(o, o);
  }

  // 1. Geometrie je Layer sammeln (Bettkoordinaten, y nach oben)
  interface Bucket {
    /** Konturen je Objekt (Kerf wird je Objekt gerechnet) */
    objs: Poly[][];
    /** Konturen je Bearbeitung (Layer, dann Sub-Layer) nach Kerf */
    sets: Poly[][];
    images: { o: Obj; shape: ImageShape; world: Mat }[];
    /** Schnittkonturen je Bild (Bettkoordinaten, vor dem „Starten ab“-Versatz) */
    cuts: Poly[][];
  }
  const buckets = new Map<number, Bucket>();
  const bucket = (i: number) => {
    let b = buckets.get(i);
    if (!b) buckets.set(i, (b = { objs: [], sets: [], images: [], cuts: [] }));
    return b;
  };
  const bounds = emptyBox();
  let skippedOpen = 0;
  const dedupInfo = new Map<
    number,
    { len: number; lines: Pt[][] }
  >();

  let kerfOpen = 0;
  let kerfDegenerate = 0;
  let kerfVanished = 0;
  let kerfMerged = 0;
  let kerfFillOps = 0;

  // Effektive Ausgabe-Auswahl (Issue #217)
  const effLeaves = [...outputLeaves(roots)];
  const laserSet = new Set<Obj>();

  for (const [l] of laserLeaves(roots)) {
    laserSet.add(l);
  }

  const hiddenOutputs = effLeaves.filter(
    ([l]) => !laserSet.has(l) && layerOf(l.layer).output
  ).length;

  if (hiddenOutputs) {
    warnings.push(
      tn(
        '{n} ausgeblendetes Objekt nimmt am Job teil (Ausgabe eingeschaltet).',
        '{n} ausgeblendete Objekte nehmen am Job teil (Ausgabe eingeschaltet).',
        hiddenOutputs,
      ),
    );
  }

  for (const [o, world] of effLeaves) {
    if (o.reg) continue; // Passermarken nur drucken, nicht lasern
    const L = layerOf(o.layer);
    if (!L.output) continue;
    const s = o.shape;
    if (s.kind === 'image') {
      const bk = bucket(o.layer);
      bk.images.push({ o, shape: s, world });
      const M = mul(toBed, world);
      const quad = s.edit !== undefined ? imageRasterGeometry(s).quad
        : [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }];
      for (const p of quad) {
        const q = apply(M, p.x, p.y);
        addPt(bounds, q.x, q.y);
      }
      // Optionaler Schnittschritt pro Bild-Layer: Kontur auflösen, keine Rechteck-Ersatzform.
      const cut = imageCutSettings(inp.imgLayer(o.layer));
      if (cut.output) {
        const path = resolveImageCutPath(o, world, (id) => byId.get(id));
        if (!path.ok) throw new Error(imageCutIssueText(path.reason, s.name ?? t('Bild')));
        let polys: Poly[] = [{ pts: path.polygon.map((p) => apply(toBed, p.x, p.y)), closed: path.closed, grp: topOf.get(o) }];
        if (cut.kerf) polys = kerfOffsetReport(polys, cut.kerf).polys;
        if (cut.dedup) polys = dedupPolys(polys, cut.dedupTol, cut.kerf).polys;
        if (polys.length) {
          bk.cuts.push(polys);
          for (const p of polys) for (const q of p.pts) addPt(bounds, q.x, q.y);
        }
      }
      continue;
    }
    let subs: SubPath[];
    if (s.kind === 'text') {
      const f = await loadFont(s.font, s.bold, s.italic);
      subs = textToSubs(s, f.font);
    } else subs = shapeSubs(s);
    const M = mul(toBed, world);
    const own: Poly[] = [];
    const grp = topOf.get(o);
    for (const sp of subs) {
      if (sp.nodes.length < 2) continue;
      const p = flatten(sp, M);
      if (p.pts.length < 2) continue;
      if (grp !== undefined) p.grp = grp;
      own.push(p);
    }
    if (own.length) bucket(o.layer).objs.push(own);
  }
  for (const [li, b] of buckets) {
    const ents = entriesOf(layerOf(li));
    const anyLine = ents.some((x) => x.e.mode === 'line');
    const firstFill = ents.findIndex((x) => x.e.mode === 'fill');
    b.sets = ents.map(({ e }, k) => {
      const list: Poly[] = [];

      // Geometrie pro Objekt vorbereiten
      for (const own of b.objs) {
        let polys = own;

        if (e.mode === 'fill') {
          polys = own.filter((p) => p.closed);
          if (!anyLine && k === firstFill) {
            skippedOpen += own.length - polys.length;
          }
        }

        // Kerf je Objekt anwenden (#220)
        if (e.kerf) {
          const open = polys.filter((p) => !p.closed);

          if (open.length && e.mode === 'line') {
            kerfOpen += open.length;
          }

          if (e.mode === 'fill') {
            kerfFillOps++;
          }

          const rep = kerfOffsetReport(
            polys.filter((p) => p.closed),
            e.kerf,
          );

          kerfDegenerate += rep.degenerate;
          kerfMerged += rep.merged;

          if (rep.vanished && rep.valid > 0) {
            kerfVanished += rep.valid;
          }

          // Gruppen-ID nach Kerf erhalten (#222)
          const g =
            polys.length && polys.every((p) => p.grp === polys[0].grp)
              ? polys[0].grp
              : undefined;

          polys = [
            ...open,
            ...rep.polys.map((p) =>
              g !== undefined ? { ...p, grp: g } : p
            ),
          ];
        }

        list.push(...polys);
      }

      // Doppelte Linien entfernen (#221)
      // Nach Kerf, vor Tabs, Perforation und Anschnitt
      let result = list;

      if (
        e.mode === 'line' &&
        (e as CutSettings).dedup &&
        list.length > 1
      ) {
        const r = dedupPolys(
          list,
          (e as CutSettings).dedupTol,
          e.kerf,
        );

        if (r.len > 0.001) {
          const cur = dedupInfo.get(li) ?? {
            len: 0,
            lines: [] as Pt[][],
          };

          cur.len += r.len;
          cur.lines.push(...r.lines);
          dedupInfo.set(li, cur);
        }

        result = r.polys;
      }

      // Bounds der tatsächlich ausgegebenen Geometrie
      for (const p of result) {
        for (const q of p.pts) {
          addPt(bounds, q.x, q.y);
        }
      }

      return result;
    });
  }
  
  if (skippedOpen) warnings.push(tn('{n} offene Linie auf Füll-Layern übersprungen (Füllen braucht geschlossene Formen).', '{n} offene Linien auf Füll-Layern übersprungen (Füllen braucht geschlossene Formen).', skippedOpen));
  if (kerfOpen) warnings.push(tn('Kerf-Vertrag: {n} offene Kontur läuft ohne Kerf-Ausgleich (nur geschlossene Formen werden versetzt).', 'Kerf-Vertrag: {n} offene Konturen laufen ohne Kerf-Ausgleich (nur geschlossene Formen werden versetzt).', kerfOpen));
  if (kerfDegenerate) warnings.push(tn('Kerf-Vertrag: {n} degenerierte Kontur (< 3 Punkte) entfallen.', 'Kerf-Vertrag: {n} degenerierte Konturen (< 3 Punkte) entfallen.', kerfDegenerate));
  if (kerfVanished) warnings.push(tn('Kerf-Vertrag: {n} Kontur vom Versatz aufgelöst (z. B. Loch kleiner als der Kerf).', 'Kerf-Vertrag: {n} Konturen vom Versatz aufgelöst (z. B. Loch kleiner als der Kerf).', kerfVanished));
  if (kerfMerged) warnings.push(tn('Kerf-Vertrag: {n} berührende Kontur per Union zusammengefasst.', 'Kerf-Vertrag: {n} berührende Konturen per Union zusammengefasst.', kerfMerged));
  if (kerfFillOps) warnings.push(t('Kerf-Vertrag: Kerf wirkt bei Füllen auf die Hüll-Geometrie vor der Schraffur.'));
  // Manuelle Reihenfolge (#153, alle Optimierer-Schalter aus): dort meldet die genauere Prüfung beim Ausgeben
  if (!orderOpts.innerFirst && (orderOpts.travel || orderOpts.group || orderOpts.dirOrder !== 'none')) {
    // Ohne Innere-Formen-Priorisierung auf mögliche Schnittreihenfolge-Probleme hinweisen (#222).
    let nested = false;
    outer: for (const b of buckets.values()) {
      for (const set of b.sets) {
        const closed = set.filter((p) => p.closed);
        const boxes = boxesOf(closed);
        for (let i = 0; i < closed.length; i++) {
          for (let j = 0; j < closed.length; j++) {
            if (i !== j && containsStrict(closed, boxes, i, j)) {
              nested = true;
              break outer;
            }
          }
        }
      }
    }
    if (nested) warnings.push(t('„Innere Formen zuerst“ ist aus: Löcher werden ggf. nach ihrer Außenkontur geschnitten und fallen mit dem Reststück.'));
  }

  // 2. Verschiebung nach „Starten ab“
  const jb = finite(bounds);
  if (jb && rotaryOn(device)) {
    const c = Math.PI * minObjectDiam(device.rotary);
    if (c > 0 && jb.y1 - jb.y0 > c + 0.01)
      warnings.push(t('Der Job ist {h} mm hoch, der Umfang des Objekts aber nur {c} mm: Er überlappt sich beim Drehen.', { h: (jb.y1 - jb.y0).toFixed(1), c: c.toFixed(1) }));
  }
  let offset: Pt = { x: 0, y: 0 };
  // Auch für die Vorschau: so ergibt sich dieselbe Reihenfolge wie beim Lasern (sie hängt vom Startpunkt ab)
  if (jb && device.startFrom !== 'absolute') {
    const a = anchorOf(jb, device.jobOrigin);
    const base = device.startFrom === 'current' && inp.position ? inp.position : { x: 0, y: 0 };
    // Zeigerversatz (#213): gezielt wurde mit dem Rotpunkt, der Kopf steht um −Offset; beim Start fährt er
    // um +Offset zurück, sodass der Strahl trifft. Nur die Startreferenz verschiebt sich — Geometrie,
    // Schnitt und Export bleiben Werkzeuglaser (reine Verschiebung, keine Verzerrung).
    const po = pointerShift(device);
    const target = { x: base.x + po.x, y: base.y + po.y };
    offset = { x: target.x - a.x, y: target.y - a.y };
  }
  const toOut = mul([1, 0, 0, 1, offset.x, offset.y], toBed);
  if (offset.x || offset.y) {
    // Ohne Kerf teilen sich Layer und Sub-Layer dieselben Punkte: jeden nur einmal verschieben
    const moved = new Set<Pt>();
    for (const b of buckets.values())
      for (const set of [...b.sets, ...b.cuts])
        for (const p of set)
          for (const q of p.pts) {
            if (moved.has(q)) continue;
            moved.add(q);
            q.x += offset.x;
            q.y += offset.y;
          }
  }

  // 3. Bewegungen je Layer in Ausgabereihenfolge
  const start: Pt = device.startFrom === 'current' && inp.position ? inp.position : { x: 0, y: 0 };
  const mv = new Moves(start.x, start.y);
  const order = [...buckets.keys()].sort((a, b) => (layerOf(a).priority ?? a) - (layerOf(b).priority ?? b) || a - b);
  // Z-Versatz nur mit Z-Achse; ist Z die Drehachse, bleibt der Fokus, wo er ist
  const useZ = device.zAxis && !(rotaryOn(device) && device.rotary.axis === 'Z');
  let zSkipped = false;
  let manualViolations = 0;
  for (const li of order) {
    const L = layerOf(li);
    const bk = buckets.get(li)!;
    const flip = { v: false };
    mv.zCur = 0;
    // Bilder zuerst (gravieren), dann Vektoren
    if (bk.images.length) {
      const IL = imageOutput(L, inp.imgLayer(li));
      const ov = (IL.overscan / 100) * (IL.speed / 60);
      for (const im of bk.images) {
        const lines = await imageLines(im.shape, im.world, toOut, IL);
        if (!lines) {
          warnings.push(t('Bild „{name}“ ist noch nicht geladen und wurde übersprungen.', { name: im.shape.name ?? t('Bild') }));
          continue;
        }
        // Z per pass from the layer, like for vectors
        if (!useZ && (L.zOffset || L.zStep)) zSkipped = true;
        for (let p = 0; p < Math.max(1, IL.passes); p++) {
          mv.zCur = useZ ? L.zOffset + p * L.zStep : 0;
          emitScanlines(mv, lines, { speed: IL.speed, bidirectional: IL.bidirectional, overscan: ov, layer: li }, flip);
        }
        mv.zCur = 0;
      }
    }
    // Nach allen Gravuren die Schnittkonturen der Bilder, noch vor den Vektor-Bearbeitungen.
    if (bk.cuts.length) {
      const cut = imageCutSettings(inp.imgLayer(li));
      const entry = { ...cut, mode: 'line' as const } as CutEntry;
      const pass = (p: number) => (mv.zCur = useZ ? cut.zOffset + p * cut.zStep : 0);
      if (!useZ && (cut.zOffset || cut.zStep)) zSkipped = true;
      const ord: OrderOpts = { innerFirst: device.optInnerFirst, travel: device.optTravel, group: device.optGroup, cornerStart: device.optCornerStart, dirOrder: device.optDirOrder, bestStart: device.optBestStart, bestDirection: device.optBestDirection, lessTurns: device.optLessTurns };
      for (const polys of bk.cuts) {
        emitEntry(mv, entry, polys, li, -2, flip, pass, ord);
        mv.zCur = 0;
      }
    }
    entriesOf(L).forEach(({ e, sub }, k) => {
      const polys = bk.sets[k];
      if (!polys?.length) return;
      if (!useZ && (e.zOffset || e.zStep)) zSkipped = true;
      // Z je Durchgang: erster Durchgang beim Z-Versatz, jeder weitere um zStep tiefer
      const pass = (p: number) => (mv.zCur = useZ ? e.zOffset + p * e.zStep : 0);

      if (!orderOpts.innerFirst && !orderOpts.travel && !orderOpts.group && orderOpts.dirOrder === 'none' && !orderOpts.lessTurns && e.mode === 'line') {
        manualViolations += countManualViolations(polys);
      }

      emitEntry(mv, e, polys, li, sub, flip, pass, orderOpts);
      mv.zCur = 0;
    });
  }
  if (manualViolations)
    warnings.push(
      tn(
        'Manuelle Reihenfolge: {n} innere Form wird nach ihrer äußeren Form geschnitten (innen-vor-außen verletzt) — „Innere Formen zuerst“ aktivieren oder Stapelreihenfolge im Objekte-Fenster ändern.',
        'Manuelle Reihenfolge: {n} innere Formen werden nach ihrer äußeren Form geschnitten (innen-vor-außen verletzt) — „Innere Formen zuerst“ aktivieren oder Stapelreihenfolge im Objekte-Fenster ändern.',
        manualViolations,
      ),
    );
  if (zSkipped)
    warnings.push(
      device.zAxis
        ? t('Z-Versatz übersprungen: Die Z-Achse ist als Drehachse eingestellt.')
        : t('Z-Versatz übersprungen: Für dieses Gerät ist keine Z-Achse eingestellt (Geräteeinstellungen).'),
    );
  mv.zCur = 0;
  if (mv.n && device.returnHome) mv.push(start.x, start.y, 0, 0, -1);
  // Vorschau: dieselben Bahnen an ihrer Lage auf dem Bett zeigen
  if (inp.forPreview && (offset.x || offset.y)) {
    for (let i = 0; i < mv.n; i++) {
      mv.x[i] -= offset.x;
      mv.y[i] -= offset.y;
    }
    mv.x0 -= offset.x;
    mv.y0 -= offset.y;
    offset = { x: 0, y: 0 };
  }

  // 4. Ausdehnung und Kontur
  const ob = jb ? { x0: jb.x0 + offset.x, y0: jb.y0 + offset.y, x1: jb.x1 + offset.x, y1: jb.y1 + offset.y } : null;
  const travel = emptyBox();
  const hullPts: Pt[] = [];
  let px = mv.x0,
    py = mv.y0;
  for (let i = 0; i < mv.n; i++) {
    if (mv.f[i] > 0) {
      addPt(travel, px, py);
      addPt(travel, mv.x[i], mv.y[i]);
      if (mv.s[i] > 0) hullPts.push({ x: px, y: py }, { x: mv.x[i], y: mv.y[i] });
    }
    px = mv.x[i];
    py = mv.y[i];
  }
  const air = order.filter((li) => layerOf(li).air || (!!buckets.get(li)?.cuts.length && imageCutSettings(inp.imgLayer(li)).air));
  const dedup = [...dedupInfo.entries()].map(([layer, d]) => ({ layer, len: d.len, lines: d.lines }));
  for (const d of dedup) {
    const L = layerOf(d.layer);
    const name = (L as { name?: string }).name ?? String(d.layer);
    warnings.push(t('{len} mm doppelte Linien zusammengefasst (Layer {name}).', { len: d.len < 10 ? d.len.toFixed(2) : d.len.toFixed(1), name }));
  }
  return { moves: mv, bounds: ob, travel: finite(travel), hull: convexHull(dedupe(hullPts)), warnings, offset, air, dedup };
}

function dedupe(pts: Pt[]): Pt[] {
  const seen = new Set<string>();
  const out: Pt[] = [];
  for (const p of pts) {
    const k = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    if (!seen.has(k)) (seen.add(k), out.push(p));
  }
  return out;
}

// ---------- Laufzeit ----------

export interface Estimate {
  /** Endzeit jeder Bewegung in Sekunden */
  t: Float64Array;
  total: number;
  cutLength: number;
  rapidLength: number;
}

/**
 * Laufzeitschätzung wie im Bahnplaner von GRBL/FluidNC: Übergangsgeschwindigkeit an Ecken
 * aus der Junction Deviation, Rückwärts- und Vorwärtsdurchlauf, Trapezprofil je Strecke.
 */
export function estimate(mv: Moves, d: Device): Estimate {
  const n = mv.n;
  const a = Math.max(1, d.accel);
  const rapid = Math.max(1, d.rapid) / 60;
  const len = new Float64Array(n),
    vmax = new Float64Array(n),
    vj = new Float64Array(n + 1);
  let px = mv.x0,
    py = mv.y0,
    ux = 0,
    uy = 0,
    cutLength = 0,
    rapidLength = 0;
  for (let i = 0; i < n; i++) {
    const dx = mv.x[i] - px,
      dy = mv.y[i] - py;
    const l = Math.hypot(dx, dy);
    len[i] = l;
    vmax[i] = mv.f[i] > 0 ? Math.min(mv.f[i] / 60, rapid) : rapid;
    if (mv.f[i] > 0 && mv.s[i] > 0) cutLength += l;
    else rapidLength += l;
    if (l > 1e-9) {
      const nx = dx / l,
        ny = dy / l;
      // Wechsel zwischen Eilgang und Vorschub: FluidNC plant beides, behandeln wie eine Ecke
      if (i === 0 || (ux === 0 && uy === 0)) vj[i] = 0;
      else {
        const cos = -(ux * nx + uy * ny);
        if (cos > 0.999999) vj[i] = 0;
        else if (cos < -0.999999) vj[i] = Infinity;
        else {
          const sh = Math.sqrt(0.5 * (1 - cos));
          vj[i] = Math.sqrt((a * d.junction * sh) / (1 - sh));
        }
      }
      ux = nx;
      uy = ny;
    } else vj[i] = Infinity;
    px = mv.x[i];
    py = mv.y[i];
  }
  // v[i] = Geschwindigkeit am Anfang von Strecke i
  const v = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) v[i] = Math.min(vj[i], vmax[i], i > 0 ? vmax[i - 1] : 0);
  v[n] = 0;
  for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * a * len[i]));
  for (let i = 0; i < n; i++) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] ** 2 + 2 * a * len[i]));
  const t = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const l = len[i];
    if (l > 1e-9) {
      const v0 = v[i],
        v1 = v[i + 1],
        vc = vmax[i];
      const d1 = (vc * vc - v0 * v0) / (2 * a),
        d2 = (vc * vc - v1 * v1) / (2 * a);
      if (d1 + d2 > l) {
        const vp = Math.sqrt(Math.max(0, (2 * a * l + v0 * v0 + v1 * v1) / 2));
        total += Math.max(0, (vp - v0) / a) + Math.max(0, (vp - v1) / a);
      } else total += (vc - v0) / a + (vc - v1) / a + (l - d1 - d2) / vc;
    }
    t[i] = total;
  }
  return { t, total, cutLength, rapidLength };
}

export function formatDuration(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} h` : `${m}:${String(s).padStart(2, '0')} min`;
}

// ---------- G-Code ----------

/** S-Wert für Leistung 0 … 1; bei kleiner Skala (Smoothieware 0 … 1) mit mehr Nachkommastellen */
const sValue = (p: number, d: Device, round = Math.round) => {
  const k = d.sMax > 100 ? 10 : 1000;
  return round(p * d.sMax * k) / k;
};

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export type GCodeOrigin = 'header' | 'start' | 'move' | 'air' | 'z' | 'dwell' | 'end' | 'footer' | 'meta';

export interface GCode {
  lines: string[];
  /** Geschätzte Zeit (s), zu der die Zeile fertig ist */
  times: Float64Array;
  total: number;
  /** Herkunft je Zeile; nur interne Metadaten, keine Maschinenwirkung */
  origins: GCodeOrigin[];
}

/**
 * G-Code für FluidNC/GRBL im Lasermodus: M4 (Leistung folgt der Geschwindigkeit), S je Bewegung,
 * unveränderte Werte (G1, X, Y, F, S) werden weggelassen. Air Assist wird je Layer mit M8/M7 ein-
 * und mit M9 ausgeschaltet.
 */
export function writeGCode(job: Job, d: Device, est: Estimate, name = 'KizamuBeam', annotate = false): GCode {
  const header = gcodeHeader(job, d, est, name);
  const r = rotaryMoves(job.moves, d, job.bounds, est.t);
  return gcodeLines(r.mv, d, { ...est, t: r.t! }, job.air, header, annotate);
}

/** Kopf des G-Codes: Kommentare, Einheiten, absolute Koordinaten, Laser im Lasermodus an */
function gcodeHeader(job: Job, d: Device, est: Estimate, name: string): string[] {
  const out: string[] = [];
  out.push(`; ${name}`);
  out.push(t('; Erzeugt von KizamuBeam am {date}', { date: new Date().toLocaleString(locale) }));
  out.push(t('; Geschätzte Dauer: {total}', { total: formatDuration(est.total) }));
  if (job.bounds) out.push(t('; Bereich: X {x0} … {x1}, Y {y0} … {y1} mm', { x0: num(job.bounds.x0), x1: num(job.bounds.x1), y0: num(job.bounds.y0), y1: num(job.bounds.y1) }));
  const fw = FIRMWARES[d.fw];
  out.push(t('; Gerät: {name} ({label})', { name: d.name, label: fw.label }));
  out.push(...rotaryComment(d));
  out.push('G21', 'G90', ...rotaryZero(d), ...fw.laserOn, ...jobOutputsOn(d), ...scriptLines(d.startScript));
  return out;
}

/** Beschreibung der Drehachse im Kopf des G-Codes */
function rotaryComment(d: Device): string[] {
  if (!rotaryOn(d)) return [];
  const r = d.rotary;
  return [
    r.kind === 'chuck'
      ? t('; Drehachse: Futter, Achse {axis}, {perRev} je Umdrehung, Objekt Ø {od} mm', { axis: r.axis, perRev: num(r.perRev), od: num(r.objectDiam) })
      : t('; Drehachse: Walzen Ø {rd} mm, Achse {axis}, {perRev} je Umdrehung', { axis: r.axis, perRev: num(r.perRev), rd: num(r.rollerDiam) }),
    ...(taperOn(r) ? [t('; Konisch: Ø {l} mm links, Ø {r} mm rechts', { l: num(r.taperLeft), r: num(r.taperRight) })] : []),
  ];
}

/** Eigene Drehachse: die aktuelle Stellung wird zur 0, von dort aus rechnet der Job */
const rotaryZero = (d: Device) => (separateAxis(d) ? [`G92 ${d.rotary.axis}0`] : []);

/** Zeilen eines Skripts aus den Geräteeinstellungen, ohne Leerzeilen */
export function scriptLines(s: string | undefined): string[] {
  return (s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Ende des Jobs als Teile mit Herkunft: Ausgänge/Firmwareschluss = footer, eigenes End-Skript = end */
function footerParts(d: Device): { line: string; origin: GCodeOrigin }[] {
  const f = FIRMWARES[d.fw].footer;
  const end = [...jobOutputsOff(d).map((line) => ({ line, origin: 'footer' as GCodeOrigin })), ...scriptLines(d.endScript).map((line) => ({ line, origin: 'end' as GCodeOrigin }))];
  const k = f.indexOf('M5');
  const pre = (k < 0 ? f : f.slice(0, k + 1)).map((line) => ({ line, origin: 'footer' as GCodeOrigin }));
  const post = (k < 0 ? [] : f.slice(k + 1)).map((line) => ({ line, origin: 'footer' as GCodeOrigin }));
  return [...pre, ...end, ...post];
}

/** Ende des Jobs: Laser aus, Ausgänge aus, dann das eigene End-Skript, dann Programmende der Steuerung (M2, M400) */
export function gcodeFooter(d: Device): string[] {
  return footerParts(d).map((p) => p.line);
}

/**
 * Bewegungen zu G-Code-Zeilen. Der Rust-Kern (src-tauri/core/src/gcode.rs) schreibt in der Desktop-App
 * dieselben Zeilen; Änderungen hier müssen dort nachgezogen werden (Vergleichstest: npm run test:core).
 */
/**
 * Pausenzeilen vor einer Bewegung: Strahl aus (G4) oder anstechen (M3 … G4 … M4).
 * Marlin zählt G4 P in Millisekunden, alle anderen in Sekunden. Smoothieware feuert nur bei G1,
 * dort gibt es daher keine Strahl-Pause (nur G4). Ruida läuft über writeRuida und sieht keine Pausen.
 * Die Sekunden zählen in der Zeitschätzung mit (estimate addiert Pausen je Schnitt und End-Pause).
 */
export function dwellLines(sec: number, frac: number, d: Device): string[] {
  if (!Number.isFinite(sec) || !(sec > 0)) return [];
  sec = Math.min(60, sec);
  const pause = d.fw === 'marlin' ? `G4 P${Math.max(1, Math.round(sec * 1000))}` : `G4 P${num(sec)}`;
  if (!(frac > 0) || d.fw === 'smoothie') return [pause];
  const s = sValue(Math.min(1, frac), d);
  // Marlin startet sonst im Inline-Modus (M3 I): Anstechen mit konstanter Leistung,
  // danach zurück in den Inline-Modus mit Strahl aus — wie der Kopf (M3 I S0).
  if (d.fw === 'marlin') return [`M3 S${s}`, pause, 'M3 I S0'];
  return [`M3 S${s}`, pause, 'M4'];
}

/** Pausen aus den Bewegungsmarkierungen (Start-/End-Pause je Schnitt): at = [Index, Zeilen davor], end = ans Jobende. */
export function dwellInserts(mv: Moves, d: Device): { at: [number, string[]][]; end: string[] } {
  const at: [number, string[]][] = [];
  for (let i = 0; i < mv.n; i++) {
    if (mv.dwell[i] > 0) at.push([i, dwellLines(mv.dwell[i], mv.dwellS[i], d)]);
  }
  const t = mv.dwellTrailing;
  return { at, end: t && t.sec > 0 ? dwellLines(t.sec, t.s, d) : [] };
}

/**
 * Z-Bewegungen zwischen den Bewegungen: relativ (G91 … G90), damit die Fokushöhe beim Start als Bezug gilt.
 * at = [Index der Bewegung, Zeilen davor], end = Zeilen zurück auf die Starthöhe vor dem Ende des Jobs.
 */
export function zInserts(mv: Moves, d: Device): { at: [number, string[]][]; end: string[] } {
  const at: [number, string[]][] = [];
  // Z-Versatz positiv = Fokus tiefer: ohne zFlip fährt der Kopf dafür nach unten (Z−)
  const k = d.zFlip ? 1 : -1;
  const move = (dz: number) => ['G91', `G0 Z${num(dz * k)}`, 'G90'];
  let z = 0;
  for (let i = 0; i < mv.n; i++) {
    const zi = mv.z[i];
    if (num(zi) === num(z)) continue;
    at.push([i, move(zi - z)]);
    z = zi;
  }
  return { at, end: num(z) === '0' ? [] : move(-z) };
}

/** Shared TS/native ordering: outgoing end pause, Z change, incoming start/pierce pause. */
export function gcodeInserts(mv: Moves, d: Device, zs = zInserts(mv, d), dw = dwellInserts(mv, d)): [number, string[], GCodeOrigin][] {
  const inserts: [number, string[], GCodeOrigin][] = [
    ...zs.at.map(([at, ls]): [number, string[], GCodeOrigin] => [at, ls, 'z']),
    ...dw.at.map(([at, ls]): [number, string[], GCodeOrigin] => [at, ls, 'dwell']),
  ];
  const phase = ([at, , origin]: [number, string[], GCodeOrigin]) => origin === 'z' ? 1 : mv.dwellOutgoing[at] ? 0 : 2;
  return inserts.sort((a, b) => a[0] - b[0] || phase(a) - phase(b));
}

/**
 * Präfix eigener Metadaten-Kommentarzeilen (ASCII, versioniert). Sie stehen auf eigenen `;`-Zeilen,
 * ändern keine ausführbaren Befehle und lassen sich für den Maschinenvergleich exakt entfernen.
 */
export const META_PREFIX = '; KZB1';

export function gcodeLines(mv: Moves, d: Device, est: Estimate, airList: number[], header: string[], annotate = false): GCode {
  const lines: string[] = [...header];
  const times: number[] = header.map(() => 0);
  // Die Kopfzeilen enden mit dem Start-Skript; dessen Zeilen gehören zum Startabschnitt.
  const startCount = scriptLines(d.startScript).length;
  const origins: GCodeOrigin[] = header.map((_, k) => (k >= header.length - startCount && startCount > 0 ? 'start' : 'header'));
  if (annotate && startCount > 0) {
    const at = lines.length - startCount;
    lines.splice(at, 0, `${META_PREFIX} start`);
    times.splice(at, 0, 0);
    origins.splice(at, 0, 'meta');
  }
  const zs = zInserts(mv, d);
  const dw = dwellInserts(mv, d);
  const inserts = gcodeInserts(mv, d, zs, dw);
  let zk = 0;
  let g = -1,
    cx = mv.x0,
    cy = mv.y0,
    cf = -1,
    cs = -1,
    known = false;
  const airLayers = new Set(airList);
  const axis = outAxis(d);
  let air = false;
  const subAt = (i: number) => (mv.sub && i < mv.sub.length ? mv.sub[i] : -1);
  let bodyStarted = false;
  let lastGroup = '';
  for (let i = 0; i < mv.n; i++) {
    const x = mv.x[i],
      y = mv.y[i];
    // Z-Zeilen vor der Bewegung; danach G0/G1 wieder ausschreiben
    for (; zk < inserts.length && inserts[zk][0] === i; zk++) {
      for (const l of inserts[zk][1]) {
        lines.push(l);
        times.push(i ? est.t[i - 1] : 0);
        origins.push(inserts[zk][2]);
      }
      // Pausen mit Anstechen ändern die Spindelleistung (M3 S…): der Cache muss
      // verfallen, sonst fehlt das S der folgenden Schnittbewegung (P1-Befund).
      if (inserts[zk][2] === 'dwell' && inserts[zk][1].length > 1) cs = NaN;
      g = -1;
    }
    const wantAir = airLayers.has(mv.layer[i]);
    if (wantAir !== air) {
      air = wantAir;
      lines.push(air ? d.airCmd || 'M8' : 'M9');
      times.push(i ? est.t[i - 1] : 0);
      origins.push('air');
    }
    const rapid = mv.f[i] === 0;
    const xs = num(x),
      ys = num(y);
    // Bewegungen ohne Ortswechsel (nach Rundung) fallen weg, ohne den modalen Zustand zu verändern
    if (known && xs === num(cx) && ys === num(cy)) continue;
    let l = '';
    if (rapid) {
      if (g !== 0) l += 'G0';
      g = 0;
    } else if (g !== 1) {
      l += 'G1';
      g = 1;
    }
    if (!known || xs !== num(cx)) l += `${l ? ' ' : ''}X${xs}`;
    if (!known || ys !== num(cy)) l += `${l ? ' ' : ''}${axis}${ys}`;
    known = true;
    if (!rapid) {
      const s = sValue(mv.s[i], d);
      if (s !== cs) l += ` S${s}`;
      cs = s;
      if (mv.f[i] !== cf) l += ` F${Math.round(mv.f[i])}`;
      cf = mv.f[i];
    }
    cx = x;
    cy = y;
    if (annotate && mv.layer[i] >= 0) {
      const key = `${mv.layer[i]}:${subAt(i)}`;
      if (!bodyStarted) {
        bodyStarted = true;
        const t0 = i ? est.t[i - 1] : 0;
        lines.push(`${META_PREFIX} job`);
        times.push(t0);
        origins.push('meta');
      }
      if (key !== lastGroup) {
        lastGroup = key;
        lines.push(`${META_PREFIX} layer ${mv.layer[i]} sub ${subAt(i)}`);
        times.push(i ? est.t[i - 1] : 0);
        origins.push('meta');
      }
    }
    lines.push(l.trim());
    times.push(est.t[i]);
    origins.push('move');
  }
  if (air) {
    lines.push('M9');
    times.push(est.total);
    origins.push('air');
  }
  // End-Pause zuerst am beendeten Schnitt, dann erst Z-Rückstellung und Geräteschluss
  for (const [z, origin] of [...dw.end.map((l): [string, GCodeOrigin] => [l, 'dwell']), ...zs.end.map((l): [string, GCodeOrigin] => [l, 'z'])]) {
    lines.push(z);
    times.push(est.total);
    origins.push(origin);
  }
  const foot = footerParts(d);
  let endMarked = false;
  let footerMarked = false;
  for (const p of foot) {
    if (annotate && p.origin === 'end' && !endMarked) {
      endMarked = true;
      lines.push(`${META_PREFIX} end`);
      times.push(est.total);
      origins.push('meta');
    }
    if (annotate && p.origin === 'footer' && endMarked && !footerMarked) {
      footerMarked = true;
      lines.push(`${META_PREFIX} footer`);
      times.push(est.total);
      origins.push('meta');
    }
    lines.push(p.line);
    times.push(est.total);
    origins.push(p.origin);
  }
  return { lines, times: Float64Array.from(times), total: est.total, origins };
}

/**
 * G-Code für Start und Speichern. In der Desktop-App schreibt ihn der Rust-Kern und behält die Zeilen
 * (id), damit Millionen Rasterzeilen nicht als Text durch die Oberfläche müssen; im Browser stehen sie in lines.
 */
export interface PreparedGCode {
  id: number | null;
  lines: string[] | null;
  /** Verwürfelte .rd-Bytes bei Ruida im Browser-/JS-Modus */
  ruida?: Uint8Array | null;
  count: number;
  /** Geschätzte Zeit (s), zu der die Zeile fertig ist */
  times: Float64Array;
  total: number;
}

export async function prepareGCode(
  job: Job,
  d: Device,
  est: Estimate,
  name = 'KizamuBeam',
  layerOf?: (i: number) => Layer,
  ruidaOpts?: { filename?: string; upload?: boolean },
): Promise<PreparedGCode> {
  if (d.fw === 'ruida') {
    const { mv, t } = rotaryMoves(job.moves, d, job.bounds, est.t);
    const rParams = ruidaParamsForJob({ ...job, moves: mv }, d, layerOf, ruidaOpts);
    if (hasNative()) {
      try {
        const buf = await native<ArrayBuffer>('ruida_prepare', packMoves(mv, t!, JSON.stringify(rParams)));
        const head = new Uint32Array(buf, 0, 2);
        const count = Math.max(1, head[1]);
        const times = new Float64Array(count);
        for (let i = 0; i < count; i++) times[i] = ((i + 1) / count) * est.total;
        return { id: head[0], lines: null, ruida: null, count, times, total: est.total };
      } catch {
        /* ältere Desktop-App ohne Rust-Kern: weiter in TypeScript */
      }
    }
    const bytes = writeRuida(mv, rParams);
    return { id: null, lines: null, ruida: bytes, count: 1, times: new Float64Array([est.total]), total: est.total };
  }
  const header = gcodeHeader(job, d, est, name);
  if (hasNative()) {
    try {
      const { mv, t } = rotaryMoves(job.moves, d, job.bounds, est.t);
      const zs = zInserts(mv, d);
      const dw = dwellInserts(mv, d);
      const inserts = gcodeInserts(mv, d, zs, dw).map(([at, ls]) => [at, ls]);
      const params = JSON.stringify({ x0: mv.x0, y0: mv.y0, sMax: d.sMax, air: job.air, airCmd: d.airCmd || 'M8', header, footer: [...dw.end, ...zs.end, ...gcodeFooter(d)], total: est.total, yAxis: outAxis(d), inserts });
      const buf = await native<ArrayBuffer>('gcode_prepare', packMoves(mv, t!, params));
      const head = new Uint32Array(buf, 0, 2);
      return { id: head[0], lines: null, count: head[1], times: new Float64Array(buf, 8), total: est.total };
    } catch {
      /* ältere Desktop-App ohne Rust-Kern: weiter in TypeScript */
    }
  }
  const r = rotaryMoves(job.moves, d, job.bounds, est.t);
  const g = gcodeLines(r.mv, d, { ...est, t: r.t! }, job.air, header);
  return { id: null, lines: g.lines, count: g.lines.length, times: g.times, total: g.total };
}

/** Bewegungen für den Rust-Kern: u32 n, u32 JSON-Länge, JSON, Auffüllung auf 8 Byte, x, y, t (f64), f, s (f32), layer (i16) */
export function packMoves(mv: Moves, t: Float64Array, params: string): Uint8Array {
  const json = new TextEncoder().encode(params);
  const n = mv.n;
  const start = Math.ceil((8 + json.length) / 8) * 8;
  const buf = new ArrayBuffer(start + n * (8 * 3 + 4 * 2 + 2));
  const head = new DataView(buf);
  head.setUint32(0, n, true);
  head.setUint32(4, json.length, true);
  new Uint8Array(buf, 8, json.length).set(json);
  let off = start;
  const put = <T extends Float64Array | Float32Array | Int16Array>(Ctor: new (b: ArrayBuffer, o: number, l: number) => T, src: T) => {
    new Ctor(buf, off, n).set(src.subarray(0, n) as never);
    off += n * (src.BYTES_PER_ELEMENT as number);
  };
  put(Float64Array, mv.x);
  put(Float64Array, mv.y);
  put(Float64Array, t);
  put(Float32Array, mv.f);
  put(Float32Array, mv.s);
  put(Int16Array, mv.layer);
  return new Uint8Array(buf);
}

// ---------- Rahmen ----------

/** Rahmenfahrt um den Job: Rechteck oder Kontur (konvexe Hülle), wahlweise mit schwachem Laser */
export function frameGCode(job: Job, d: Device, contour: boolean): string[] | null {
  const b = job.bounds;
  if (!b) return null;
  let pts: Pt[] =
    contour && job.hull.length >= 3
      ? job.hull
      : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  // Zeigerversatz (#213): In der Rotpunkt-Vorschau (Default) fährt der Kopf um −Offset, sodass der
  // Rotpunkt den Jobbereich abfährt (zeigt den echten Laserbereich). 'tool' fährt den Werkzeuglaser
  // (LightBurn-Verhalten, zugleich Kollisionsprüfung Kopf gegen Material/Spannpratzen).
  if (d.frameView !== 'tool') {
    const po = pointerShift(d);
    if (po.x || po.y) pts = pts.map((p) => ({ x: p.x - po.x, y: p.y - po.y }));
  }
  pts = [...pts, pts[0]];
  const fw = FIRMWARES[d.fw];
  const s = d.frameLaser ? sValue(d.framePower / 100, d) : 0;
  const rot = rotaryOn(d);
  const raw = new Moves(job.moves.x0, job.moves.y0);
  raw.push(pts[0].x, pts[0].y, 0, 0, 0);
  for (let i = 1; i < pts.length; i++) raw.push(pts[i].x, pts[i].y, d.frameSpeed, 0, 0);
  // Mit Drehachse zurück zum Start, sonst beginnt der Job (oder der nächste Rahmen) an einer verdrehten Stelle
  if (rot) raw.push(raw.x0, raw.y0, 0, 0, 0);
  const mv = rotaryMoves(raw, d, b).mv;
  const axis = outAxis(d);
  const out = ['G21', 'G90', ...rotaryZero(d), ...(d.frameLaser ? fw.frameOn : [])];
  let cf = -1,
    first = true;
  for (let i = 0; i < mv.n; i++) {
    const xy = `X${num(mv.x[i])} ${axis}${num(mv.y[i])}`;
    if (mv.f[i] === 0) {
      out.push(`G0 ${xy}`);
      continue;
    }
    out.push(`G1 ${xy}${first ? ` S${s}` : ''}${mv.f[i] !== cf ? ` F${Math.round(mv.f[i])}` : ''}`);
    first = false;
    cf = mv.f[i];
  }
  out.push(...fw.footer.filter((l) => l !== 'M2' || fw.runsOnM2));
  return out;
}

/**
 * Laserpunkt zum Zielen (z. B. auf Passermarken): Laser mit sehr kleiner Leistung im Stand einschalten bzw. aus.
 * GRBL/grblHAL/FluidNC feuern im Laser-Modus nur im Modus G1 und mit M3 (konstante Leistung) auch ohne Bewegung,
 * Marlin feuert mit M3 sofort, Smoothieware hat dafür den Befehl „fire“.
 */
export function pointerGCode(d: Device, on: boolean, percent: number): string[] {
  const p = Math.max(0, Math.min(10, percent));
  if (d.fw === 'smoothie') return on ? [`fire ${num(p)}`] : ['fire off'];
  if (!on) return ['M5'];
  const s = sValue(p / 100, d);
  if (d.fw === 'marlin') return [`M3 S${s}`];
  return ['G1 F1000', `M3 S${s}`];
}

/** Testfeuer im Bewegen-Fenster: Leistung in % (0 … 100, Aufrufer muss auf fireMaxPower begrenzen). */
export function fireLines(d: Device, percent: number): string[] {
  // Smoothieware's manual fire command takes percent, unlike its G-code S scale (0 … 1).
  if (d.fw === 'smoothie') return [`fire ${num(Math.floor(Math.max(0, Math.min(100, percent)) * 1000) / 1000)}`];
  // Rounding up could exceed the device's Fire power cap (e.g. 1% of Marlin S255).
  const s = sValue(percent / 100, d, Math.floor);
  if (d.fw === 'marlin') return [`M3 S${s}`];
  return ['G1 F1000', `M3 S${s}`];
}
