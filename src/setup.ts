// Assistent „Laser einrichten“: Antworten der Steuerung auswerten und die Einstellungen prüfen.
// Reine Logik ohne Oberfläche (Tests: npm run test:setup); der Dialog steht in setupWizard.ts.
// Grundsatz: Vorschläge für die Firmware werden nur angezeigt; gesendet wird erst nach einem Klick der Person.
import type { Device, Firmware } from './gcode';
import { FIRMWARES } from './gcode';
import { coolantPins, directionPinPath, invertPin, saveCmd, setCmd } from './fluidnc';
import { t } from './i18n';
import { defaultCutSettings, Doc, Layer, newDoc, translate } from './model';

/** Was der Assistent über die Steuerung herausgefunden hat */
export interface Facts {
  fw: Firmware | null;
  version: string;
  /** GRBL-Einstellungen $n=Wert (GRBL, grblHAL, bei FluidNC die Kompatibilitätswerte aus $$) */
  grbl: Record<number, number>;
  /** FluidNC-Konfiguration aus $CD, Pfade klein geschrieben wie „axes/x/max_travel_mm“ */
  fluid: Record<string, string>;
  /** FluidNC: Datei, aus der die Konfiguration beim Start gelesen wird ($Config/Filename) */
  fluidFile?: string;
  /** Marlin: Weichen Endanschläge (M211) und Schritte je mm (M92) */
  marlin: { maxX?: number; maxY?: number; stepsX?: number; stepsY?: number; soft?: boolean };
}

export const emptyFacts = (): Facts => ({ fw: null, version: '', grbl: {}, fluid: {}, marlin: {} });

/** Firmware an den Antworten auf $I, M115 oder „version“ (oder an der Begrüßung beim Verbinden) erkennen */
export function detectFirmware(lines: string[]): { fw: Firmware; version: string } | null {
  const all = lines.join('\n');
  let m = /FluidNC\s+v?([\w.\-]+)/i.exec(all);
  if (m) return { fw: 'fluidnc', version: `FluidNC ${m[1]}` };
  if (/grblHAL/i.test(all)) {
    m = /\[VER:([^:\]]+)/.exec(all);
    return { fw: 'grblhal', version: `grblHAL ${m ? m[1] : ''}`.trim() };
  }
  m = /FIRMWARE_NAME:\s*Marlin\s*([^\s(]*)/i.exec(all) ?? /^(?:echo:)?Marlin\s+([\w.\-]+)/im.exec(all);
  if (m) return { fw: 'marlin', version: `Marlin ${m[1]}`.trim() };
  m = /Smoothie\w*.*?(?:version|Build version)[:\s]*([\w.\-]+)?/i.exec(all) ?? /Build version:\s*([\w.\-]+)/i.exec(all);
  if (m) return { fw: 'smoothie', version: `Smoothieware ${m[1] ?? ''}`.trim() };
  // xTool D1 family answers $I with "[XTool …]" (seen by OpenBurn); it may also send a GRBL greeting
  m = /\[XTool\b\s*([^\]]*)\]/i.exec(all);
  if (m) return { fw: 'xtool', version: `xTool ${m[1]}`.trim() };
  m = /\[VER:([^:\]]+)/.exec(all) ?? /^Grbl\s+([\w.]+)/im.exec(all);
  if (m) return { fw: 'grbl', version: `GRBL ${m[1]}` };
  return null;
}

/** $n=Wert-Zeilen aus der Antwort auf $$ */
export function parseGrblSettings(lines: string[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const l of lines) {
    const m = /^\$(\d+)\s*=\s*(-?[\d.]+)/.exec(l.trim());
    if (m) out[+m[1]] = +m[2];
  }
  return out;
}

/** YAML-Ausgabe von FluidNC ($CD) in Pfade zerlegen: „axes/x/motor0/limit_neg_pin“ → „gpio.35:low“ */
export function parseFluidConfig(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const stack: { indent: number; key: string }[] = [];
  for (const raw of lines) {
    if (/^\s*(\[|<|ok\b|error|#)/i.test(raw) || !raw.trim()) continue;
    const m = /^(\s*)([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = [...stack.map((s) => s.key), m[2].toLowerCase()].join('/');
    if (m[3] === '') stack.push({ indent, key: m[2].toLowerCase() });
    else out[path] = m[3].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Marlin: M211 („Max: X300.00 Y300.00“) und M503/M92 („M92 X80.00 Y80.00“) */
export function parseMarlin(lines: string[]): Facts['marlin'] {
  const out: Facts['marlin'] = {};
  for (const l of lines) {
    let m = /Soft endstops:\s*(On|Off)/i.exec(l);
    if (m) out.soft = m[1].toLowerCase() === 'on';
    m = /Max:\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)/i.exec(l);
    if (m) ((out.maxX = +m[1]), (out.maxY = +m[2]));
    m = /M92\s+X\s*([\d.]+)\s*Y\s*([\d.]+)/i.exec(l);
    if (m) ((out.stepsX = +m[1]), (out.stepsY = +m[2]));
  }
  return out;
}

/** Zusammengefasste Maschinenwerte, unabhängig von der Firmware (null = unbekannt) */
export interface MachineFacts {
  bed: { w: number; h: number } | null;
  /** S-Wert für 100 % */
  sMax: number | null;
  minS: number | null;
  laserMode: boolean | null;
  homing: boolean | null;
  hardLimits: boolean | null;
  softLimits: boolean | null;
  /** Nur FluidNC weiß, ob Endschalter angeschlossen sind (Pins in der Konfiguration) */
  switches: boolean | null;
  /** FluidNC start/must_home: nach dem Einschalten gesperrt bis zur Referenzfahrt */
  mustHome: boolean | null;
  inches: boolean | null;
  /** GRBL $3 und $23 (Bit 0 = X, Bit 1 = Y) */
  dirMask: number | null;
  homeDirMask: number | null;
  steps: { x: number; y: number } | null;
}

const bool = (v: string | undefined) => (v === undefined ? null : /^(true|1|yes|on)$/i.test(v.trim()));
const num = (v: string | number | undefined) => (v === undefined || v === '' || !isFinite(+v) ? null : +v);
const pin = (v: string | undefined) => !!v && !/^no_pin$/i.test(v.trim());

/** FluidNC-Spindel: der oberste Abschnitt, der eine Spindel beschreibt (Laser, PWM, 10V, Relay …) */
function fluidSpindle(f: Record<string, string>): string | null {
  const tops = new Set(Object.keys(f).map((k) => k.split('/')[0]));
  for (const s of ['laser', 'pwm', '10v', 'relay', 'besc', 'dac', 'huanyang', 'h2a', 'yl620', 'nowforever', 'nospindle']) if (tops.has(s)) return s;
  return null;
}

export function machineFacts(f: Facts): MachineFacts {
  const g = f.grbl;
  const has = (n: number) => g[n] !== undefined;
  const bit0 = (n: number) => (has(n) ? (g[n] & 1) === 1 : null);
  const out: MachineFacts = {
    bed: has(130) && has(131) ? { w: g[130], h: g[131] } : null,
    sMax: has(30) ? g[30] : null,
    minS: has(31) ? g[31] : null,
    laserMode: has(32) ? g[32] === 1 : null,
    homing: bit0(22),
    hardLimits: bit0(21),
    softLimits: bit0(20),
    switches: null,
    mustHome: null,
    inches: has(13) ? g[13] === 1 : null,
    dirMask: has(3) ? g[3] : null,
    homeDirMask: has(23) ? g[23] : null,
    steps: has(100) && has(101) ? { x: g[100], y: g[101] } : null,
  };
  const c = f.fluid;
  if (Object.keys(c).length) {
    const ax = (a: string, k: string) => c[`axes/${a}/${k}`];
    const w = num(ax('x', 'max_travel_mm')),
      hh = num(ax('y', 'max_travel_mm'));
    if (w !== null && hh !== null) out.bed = { w, h: hh };
    const sp = fluidSpindle(c);
    if (sp) {
      out.laserMode = sp === 'laser';
      // speed_map: „0=0.000% 1000=100.000%“ → S-Wert bei 100 %
      const map = c[`${sp}/speed_map`];
      const full = map ? /(\d+(?:\.\d+)?)\s*=\s*100(?:\.0+)?%/.exec(map) : null;
      if (full) out.sMax = +full[1];
    }
    const cyc = (a: string) => num(ax(a, 'homing/cycle'));
    if (c['axes/x/homing/cycle'] !== undefined || c['axes/y/homing/cycle'] !== undefined) out.homing = (cyc('x') ?? 0) > 0 || (cyc('y') ?? 0) > 0;
    const motors = (a: string) => ['motor0', 'motor1'].filter((m) => Object.keys(c).some((k) => k.startsWith(`axes/${a}/${m}/`)));
    const limitPin = (a: string) => motors(a).some((m) => ['limit_neg_pin', 'limit_pos_pin', 'limit_all_pin'].some((p) => pin(ax(a, `${m}/${p}`))));
    if (motors('x').length && motors('y').length) out.switches = limitPin('x') && limitPin('y');
    const hard = ['x', 'y'].flatMap((a) => motors(a).map((m) => bool(ax(a, `${m}/hard_limits`)))).filter((v) => v !== null);
    if (hard.length) out.hardLimits = hard.some((v) => v);
    const soft = ['x', 'y'].map((a) => bool(ax(a, 'soft_limits'))).filter((v) => v !== null);
    if (soft.length) out.softLimits = soft.some((v) => v);
    out.mustHome = bool(c['start/must_home']);
    const sx = num(ax('x', 'steps_per_mm')),
      sy = num(ax('y', 'steps_per_mm'));
    if (sx !== null && sy !== null) out.steps = { x: sx, y: sy };
  }
  const mm = f.marlin;
  if (mm.maxX !== undefined && mm.maxY !== undefined) out.bed = { w: mm.maxX, h: mm.maxY };
  if (mm.soft !== undefined) out.softLimits = mm.soft;
  if (mm.stepsX !== undefined && mm.stepsY !== undefined) out.steps = { x: mm.stepsX, y: mm.stepsY };
  return out;
}

// ---------- Prüfung ----------

export type Level = 'ok' | 'info' | 'warn' | 'error';

/** Vorschlag zu einem Befund. send = Zeilen für die Steuerung (dauerhafte Änderung, nur nach Bestätigung), app = Geräteeinstellung in KizamuBeam */
export interface Fix {
  label: string;
  send?: string[];
  /** Zeilen, mit denen sich die Änderung an der Steuerung zurücknehmen lässt */
  undo?: string[];
  app?: Partial<Device>;
  /** Aktion des Assistenten statt einer Einstellung */
  action?: 'home' | 'unlock';
}

export interface Finding {
  id: string;
  level: Level;
  title: string;
  text: string;
  fix?: Fix;
}

/** Hat die Maschine Endschalter? Antwort der Person, sonst die Erkennung (nur FluidNC) */
export type Switches = Device['limitSwitches'];

export interface CheckInput {
  facts: Facts;
  device: Device;
  /** Antwort der Person; 'unknown' = nicht beantwortet */
  switches: Switches;
  state: string;
  mpos: [number, number, number] | null;
  /** Werkstück-Nullpunkt, wenn die Steuerung ihn gemeldet hat */
  wco: { x: number; y: number } | null;
}

/** Endschalter: Antwort der Person geht vor, sonst die FluidNC-Konfiguration */
export function switchesOf(answer: Switches, mf: MachineFacts): Switches {
  if (answer !== 'unknown') return answer;
  return mf.switches === null ? 'unknown' : mf.switches ? 'yes' : 'no';
}

/** Darf der Assistent eine Referenzfahrt anbieten? Nur mit Endschaltern und eingeschalteter Referenzfahrt. */
export function homingAllowed(answer: Switches, mf: MachineFacts): boolean {
  return switchesOf(answer, mf) === 'yes' && mf.homing !== false;
}

const mm1 = (v: number) => String(Math.round(v * 10) / 10);

/** FluidNC: Werte setzen und in der Konfigurationsdatei speichern; undo stellt die alten Werte wieder her */
function fluidFix(facts: Facts, label: string, values: Record<string, string>): Fix {
  const file = facts.fluidFile || 'config.yaml';
  const send = Object.entries(values).map(([k, v]) => setCmd(k, v));
  const undo = Object.keys(values).map((k) => setCmd(k, facts.fluid[k] ?? ''));
  return { label, send: [...send, saveCmd(file)], undo: [...undo, saveCmd(file)] };
}
const grblLike = (fw: Firmware | null) => fw === 'grbl' || fw === 'grblhal';

/** Alle Befunde zur Konfiguration, in der Reihenfolge, in der sie im Assistenten erscheinen */
export function checkConfig(inp: CheckInput): Finding[] {
  const { facts, device: d } = inp;
  const mf = machineFacts(facts);
  const fw = facts.fw;
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);
  // Befehle zum Ändern gibt es nur für GRBL und grblHAL; FluidNC wird über die config.yaml eingestellt
  const grbl = grblLike(fw);
  const isFluid = fw === 'fluidnc';

  // Firmware-Profil
  if (fw && fw !== d.fw)
    add({
      id: 'fw', level: 'warn', title: t('Falsches Firmware-Profil'),
      text: t('Die Steuerung meldet {found}, eingestellt ist {set}. Mit dem falschen Profil passen Befehle und Leistungsskala nicht.', { found: FIRMWARES[fw].label, set: FIRMWARES[d.fw].label }),
      fix: { label: t('Profil {fw} verwenden', { fw: FIRMWARES[fw].label }), app: { fw } },
    });
  else if (fw) add({ id: 'fw', level: 'ok', title: t('Firmware: {version}', { version: facts.version || FIRMWARES[fw].label }), text: '' });
  else add({ id: 'fw', level: 'info', title: t('Firmware nicht erkannt'), text: t('Die Steuerung hat auf die Abfrage nicht eindeutig geantwortet. Prüfe die Ausgabe in der Konsole oder wähle die Firmware von Hand.') });

  // Einheiten
  if (mf.inches)
    add({
      id: 'inches', level: 'error', title: t('Steuerung meldet Zoll'),
      text: t('$13=1: Positionen werden in Zoll gemeldet. KizamuBeam rechnet in Millimetern, Anzeige und Bereichsprüfung wären falsch.'),
      fix: { label: t('Auf Millimeter umstellen'), send: ['$13=0'], undo: ['$13=1'] },
    });

  // Arbeitsbereich
  if (mf.bed) {
    if (mf.bed.w <= 0 || mf.bed.h <= 0)
      add({
        id: 'bed', level: mf.softLimits ? 'error' : 'warn', title: t('Kein Verfahrweg eingestellt'),
        text: t('Die Steuerung meldet einen Arbeitsbereich von {w} × {h} mm. Trage die tatsächlichen Maße ein (GRBL $130/$131, FluidNC max_travel_mm).', { w: mm1(mf.bed.w), h: mm1(mf.bed.h) }),
      });
    else if (Math.abs(mf.bed.w - d.bedW) > 0.5 || Math.abs(mf.bed.h - d.bedH) > 0.5)
      add({
        id: 'bed', level: 'warn', title: t('Arbeitsbereich weicht ab'),
        text: t('Steuerung: {w} × {h} mm, KizamuBeam: {dw} × {dh} mm. Stimmen die Maße nicht, warnt die Bereichsprüfung falsch oder gar nicht.', { w: mm1(mf.bed.w), h: mm1(mf.bed.h), dw: mm1(d.bedW), dh: mm1(d.bedH) }),
        fix: { label: t('Maße der Steuerung übernehmen'), app: { bedW: mf.bed.w, bedH: mf.bed.h } },
      });
    else add({ id: 'bed', level: 'ok', title: t('Arbeitsbereich {w} × {h} mm', { w: mm1(mf.bed.w), h: mm1(mf.bed.h) }), text: '' });
  } else if (fw && fw !== 'smoothie')
    add({ id: 'bed', level: 'info', title: t('Arbeitsbereich nicht gemeldet'), text: t('Prüfe die Maße in den Geräteeinstellungen ({w} × {h} mm).', { w: mm1(d.bedW), h: mm1(d.bedH) }) });

  // Leistungsskala ($30)
  if (mf.sMax !== null && mf.sMax > 0) {
    if (Math.abs(mf.sMax - d.sMax) > 1e-6)
      add({
        id: 'smax', level: 'warn', title: t('Leistungsskala passt nicht'),
        text: t('Die Steuerung erreicht 100 % bei S{fw}, KizamuBeam sendet für 100 % S{app}. Alle Leistungen wären um den Faktor {f} verschoben.', { fw: mf.sMax, app: d.sMax, f: (d.sMax / mf.sMax).toFixed(2).replace(/\.?0+$/, '') }),
        fix: { label: t('S{s} für 100 % übernehmen', { s: mf.sMax }), app: { sMax: mf.sMax } },
      });
    else add({ id: 'smax', level: 'ok', title: t('Leistungsskala: S{s} = 100 %', { s: mf.sMax }), text: '' });
  }
  if (mf.minS !== null && mf.minS > 0)
    add({
      id: 'mins', level: 'info', title: t('Mindestleistung gesetzt'),
      text: t('$31={v}: Die Steuerung gibt nie weniger als diesen S-Wert aus, auch bei sehr niedrigen Leistungen. Für Laser ist 0 üblich.', { v: mf.minS }),
      fix: grbl ? { label: t('Auf 0 setzen'), send: ['$31=0'], undo: [`$31=${mf.minS}`] } : undefined,
    });

  // Lasermodus ($32)
  if (mf.laserMode === false)
    add({
      id: 'laser', level: 'warn', title: t('Lasermodus ist aus'),
      text: (Object.keys(facts.fluid).length
        ? t('In der FluidNC-Konfiguration ist keine Laser-Spindel eingetragen. ')
        : t('$32=0: Die Steuerung behandelt den Laser wie eine Frässpindel. ')) +
        t('Sie hält dann bei jedem Leistungswechsel an, und an Ecken brennt der Laser stärker ein; die Leistung folgt nicht der Geschwindigkeit.') +
        (isFluid ? ' ' + t('Ändern lässt sich das in der config.yaml (Abschnitt „Laser:“), z. B. über die Weboberfläche von FluidNC.') : ''),
      fix: grbl ? { label: t('Lasermodus einschalten'), send: ['$32=1'], undo: ['$32=0'] } : undefined,
    });
  else if (mf.laserMode) add({ id: 'laser', level: 'ok', title: t('Lasermodus ist an'), text: '' });

  // Endschalter und Referenzfahrt
  const sw = switchesOf(inp.switches, mf);
  const fluidCycles = ['x', 'y'].map((a) => `axes/${a}/homing/cycle`).filter((k) => facts.fluid[k] !== undefined && Number(facts.fluid[k]) > 0);
  if (sw === 'unknown')
    add({ id: 'switches', level: 'info', title: t('Endschalter unbekannt'), text: t('Gib oben an, ob deine Maschine Endschalter hat. Ohne diese Angabe bietet der Assistent keine Referenzfahrt an.') });
  if (sw === 'no') {
    if (mf.homing)
      add({
        id: 'homing', level: 'warn', title: t('Referenzfahrt ohne Endschalter eingeschaltet'),
        text: t('Ohne Endschalter findet die Referenzfahrt nichts: Die Achsen fahren bis an den Anschlag, rattern dort, und am Ende meldet die Steuerung einen Alarm. Bei GRBL bleibt die Steuerung außerdem nach dem Einschalten gesperrt, bis sie referenziert ist.') +
          (isFluid ? ' ' + t('In der config.yaml bei den Achsen unter „homing:“ cycle auf 0 setzen.') : ''),
        fix: grbl
          ? { label: t('Referenzfahrt ausschalten'), send: ['$22=0'], undo: [`$22=${facts.grbl[22]}`] }
          : isFluid && fluidCycles.length
            ? fluidFix(facts, t('Referenzfahrt ausschalten'), Object.fromEntries(fluidCycles.map((k) => [k, '0'])))
            : undefined,
      });
    if (mf.hardLimits)
      add({
        id: 'hard', level: 'warn', title: t('Hardware-Endschalter aktiv, aber keine angeschlossen'),
        text: t('Die Steuerung überwacht Endschalter-Eingänge, an denen nichts hängt. Störungen auf offenen Eingängen können Alarme auslösen.'),
        fix: grbl ? { label: t('Überwachung ausschalten'), send: ['$21=0'], undo: [`$21=${facts.grbl[21]}`] } : undefined,
      });
    if (mf.mustHome)
      add({
        id: 'musthome', level: 'warn', title: t('Steuerung verlangt Referenzfahrt'),
        text: t('In der FluidNC-Konfiguration steht start/must_home: true. Ohne Endschalter bleibt die Maschine nach dem Einschalten im Alarm; dort must_home auf false setzen.'),
        fix: fluidFix(facts, t('must_home ausschalten'), { 'start/must_home': 'false' }),
      });
    if (d.homeOnConnect)
      add({
        id: 'homeconnect', level: 'warn', title: t('Referenzfahrt beim Verbinden ist eingeschaltet'),
        text: t('KizamuBeam würde beim Verbinden referenzieren, obwohl es keine Endschalter gibt.'),
        fix: { label: t('Beim Verbinden nicht referenzieren'), app: { homeOnConnect: false } },
      });
    add({
      id: 'origin', level: 'info', title: t('Ohne Endschalter: Nullpunkt beim Einschalten'),
      text: t('Die Steuerung hält die Stelle, an der der Laserkopf beim Einschalten steht, für X 0 / Y 0. Schiebe den Kopf vor dem Einschalten nach vorne links oder arbeite mit „Aktuelle Position“.'),
    });
  }
  if (sw === 'yes') {
    if (mf.homing === false)
      add({
        id: 'homing', level: 'info', title: t('Referenzfahrt ist aus'),
        text: t('Die Maschine hat Endschalter, die Referenzfahrt ist aber ausgeschaltet. Mit Referenzfahrt kennt die Steuerung nach jedem Einschalten ihre genaue Position.') +
          (isFluid ? ' ' + t('In der config.yaml bei den Achsen unter „homing:“ cycle auf 1 oder höher setzen.') : ''),
        fix: grbl ? { label: t('Referenzfahrt einschalten'), send: ['$22=1'], undo: ['$22=0'] } : undefined,
      });
    else if (mf.homing) add({ id: 'homing', level: 'ok', title: t('Endschalter und Referenzfahrt vorhanden'), text: '' });
  }
  if (mf.softLimits && mf.homing === false)
    add({
      id: 'soft', level: 'error', title: t('Verfahrgrenzen ohne Referenzfahrt'),
      text: t('Weiche Verfahrgrenzen (Soft-Limits) brauchen eine Referenzfahrt, sonst kennt die Steuerung ihre Position nicht und meldet falsche Grenzverletzungen (ALARM:2).'),
      fix: grbl ? { label: t('Verfahrgrenzen ausschalten'), send: ['$20=0'], undo: ['$20=1'] } : undefined,
    });
  else if (mf.softLimits && mf.bed && (mf.bed.w <= 0 || mf.bed.h <= 0)) {
    /* steht schon beim Arbeitsbereich */
  } else if (mf.softLimits) add({ id: 'soft', level: 'ok', title: t('Verfahrgrenzen (Soft-Limits) sind an'), text: '' });

  // Air Assist: FluidNC weiß, ob ein Kühlmittel-Ausgang eingetragen ist
  const cool = isFluid ? coolantPins(facts.fluid) : null;
  if (cool) {
    const want = d.airCmd === 'M7' ? cool.mist : cool.flood;
    const other = d.airCmd === 'M7' ? cool.flood : cool.mist;
    if (want) add({ id: 'air', level: 'ok', title: t('Air Assist: Ausgang für {cmd} eingetragen', { cmd: d.airCmd }), text: '' });
    else if (other)
      add({
        id: 'air', level: 'warn', title: t('Air Assist mit dem falschen Befehl'),
        text: t('In der FluidNC-Konfiguration ist nur der Ausgang für {other} eingetragen, KizamuBeam schaltet Air Assist mit {cmd}. Die Luft bliebe aus.', { other: d.airCmd === 'M7' ? 'M8' : 'M7', cmd: d.airCmd }),
        fix: { label: t('Air Assist mit {cmd} schalten', { cmd: d.airCmd === 'M7' ? 'M8' : 'M7' }), app: { airCmd: d.airCmd === 'M7' ? 'M8' : 'M7' } },
      });
    else
      add({
        id: 'air', level: 'info', title: t('Kein Ausgang für Air Assist'),
        text: t('In der FluidNC-Konfiguration ist kein Kühlmittel-Ausgang eingetragen (coolant/flood_pin bzw. mist_pin). Layer mit Air Assist schalten dann nichts. Hängt die Pumpe an einem freien Pin, lässt er sich unter Laser → FluidNC → Konfiguration eintragen.'),
      });
  }

  // Koordinaten
  const p = inp.mpos;
  if (p && (p[0] < -1 || p[1] < -1))
    add({
      id: 'negative', level: d.startFrom === 'absolute' ? 'warn' : 'info', title: t('Negative Maschinenkoordinaten'),
      text: t('Die Steuerung meldet X {x}, Y {y}: Nach der Referenzfahrt liegt der Arbeitsbereich im Minus. KizamuBeam erwartet den Nullpunkt vorne links mit positiven Koordinaten.', { x: p[0].toFixed(1), y: p[1].toFixed(1) }) +
        (d.startFrom === 'absolute' ? ' ' + t('Mit „Absolute Koordinaten“ würden Jobs außerhalb des Bettes landen.') : ''),
      fix: d.startFrom === 'absolute' ? { label: t('Starten ab „Aktuelle Position“'), app: { startFrom: 'current' } } : undefined,
    });
  if (inp.wco && (Math.abs(inp.wco.x) > 1e-3 || Math.abs(inp.wco.y) > 1e-3))
    add({
      id: 'wco', level: 'info', title: t('Werkstück-Nullpunkt verschoben'),
      text: t('In der Steuerung ist ein Ursprung bei X {x}, Y {y} gespeichert. Bei „Absolute Koordinaten“ landet der Job um diesen Betrag verschoben.', { x: inp.wco.x.toFixed(1), y: inp.wco.y.toFixed(1) }),
      fix: fw && FIRMWARES[fw].clearOrigin ? { label: t('Ursprung löschen'), send: [FIRMWARES[fw].clearOrigin!] } : undefined,
    });

  // Alarm
  if (inp.state.startsWith('Alarm')) {
    const canHome = homingAllowed(inp.switches, mf);
    add({
      id: 'alarm', level: 'warn', title: t('Steuerung ist im Alarm'),
      text: canHome
        ? t('Die Steuerung ist gesperrt, meist weil sie nach dem Einschalten noch nicht referenziert ist.')
        : t('Die Steuerung ist gesperrt. Ohne Endschalter lässt sie sich entsperren; die Position gilt dann ab der jetzigen Stelle.'),
      fix: canHome ? { label: t('Referenzfahrt starten'), action: 'home' } : fw && FIRMWARES[fw].unlock ? { label: t('Entsperren'), action: 'unlock' } : undefined,
    });
  }
  return out;
}

// ---------- Bewegungstest ----------

/** Richtung einer Achse umkehren: neue Werte für $3 (und $23, damit die Referenzfahrt nicht falsch herum fährt) */
export function directionFix(axis: 'x' | 'y', facts: Facts): Fix | null {
  const mf = machineFacts(facts);
  if (facts.fw === 'fluidnc') {
    // FluidNC: direction_pin des Motors umkehren (wirkt erst nach einem Neustart)
    const k = directionPinPath(facts.fluid, axis);
    return k ? fluidFix(facts, t('Richtung von {axis} umkehren (danach neu starten)', { axis: axis.toUpperCase() }), { [k]: invertPin(facts.fluid[k]) }) : null;
  }
  if (!grblLike(facts.fw) || mf.dirMask === null) return null;
  const bit = axis === 'x' ? 1 : 2;
  const send = [`$3=${mf.dirMask ^ bit}`],
    undo = [`$3=${mf.dirMask}`];
  if (mf.homing && mf.homeDirMask !== null) ((send.push(`$23=${mf.homeDirMask ^ bit}`)), undo.push(`$23=${mf.homeDirMask}`));
  return { label: t('Richtung von {axis} umkehren', { axis: axis.toUpperCase() }), send, undo };
}

/** Schritte je mm korrigieren: soll = gefahrener Weg laut Befehl, ist = gemessener Weg */
export function stepsFix(axis: 'x' | 'y', commanded: number, measured: number, facts: Facts): { steps: number; fix: Fix | null } | null {
  const mf = machineFacts(facts);
  if (!mf.steps || !(commanded > 0) || !(measured > 0)) return null;
  const old = axis === 'x' ? mf.steps.x : mf.steps.y;
  const steps = Math.round(((old * commanded) / measured) * 1000) / 1000;
  const reg = axis === 'x' ? 100 : 101;
  const fix: Fix | null = grblLike(facts.fw)
    ? { label: t('Schritte je mm für {axis} auf {steps} setzen', { axis: axis.toUpperCase(), steps }), send: [`$${reg}=${steps}`], undo: [`$${reg}=${old}`] }
    : facts.fw === 'marlin'
      ? { label: t('Schritte je mm für {axis} auf {steps} setzen', { axis: axis.toUpperCase(), steps }), send: [`M92 ${axis.toUpperCase()}${steps}`, 'M500'], undo: [`M92 ${axis.toUpperCase()}${old}`, 'M500'] }
      : null;
  return { steps, fix };
}

// ---------- Testauftrag ----------

export interface TestJobOptions {
  /** Kantenlänge des Quadrats in mm */
  size: number;
  /** % */
  power: number;
  /** mm/min */
  speed: number;
}

export const DEFAULT_TEST_JOB: TestJobOptions = { size: 20, power: 10, speed: 1000 };

/** Einfacher Testauftrag: Quadrat mit Kreis darin, als Linie, mittig auf dem Bett. Erscheint nie auf der Arbeitsfläche. */
export function buildTestJob(o: TestJobOptions, bed: { w: number; h: number }): { doc: Doc; layer: Layer } {
  const doc = newDoc();
  doc.bed = { ...bed };
  const s = Math.max(1, Math.min(o.size, bed.w, bed.h));
  const layer: Layer = {
    ...defaultCutSettings('line'), speed: Math.max(1, o.speed), power: Math.max(0, Math.min(100, o.power)),
    index: 0, name: t('Testauftrag'), output: true, show: true,
  };
  const cx = bed.w / 2,
    cy = bed.h / 2;
  doc.objs = [
    { id: 1, m: translate(cx - s / 2, cy - s / 2), layer: 0, shape: { kind: 'rect', w: s, h: s, r: 0 } },
    { id: 2, m: translate(cx, cy), layer: 0, shape: { kind: 'ellipse', rx: s / 4, ry: s / 4 } },
  ];
  doc.layers[0] = layer;
  return { doc, layer };
}
