// Generator „Stirnrad“: Evolventenverzahnung, erzeugt wie beim Abwälzfräsen mit einem Bezugsprofil (Zahnstange).
// Zahnflanke = Evolvente des Grundkreises, Zahnfuß = Bahn der gerundeten Werkzeugkopfecke (Trochoide), sodass
// Fußrundung und Unterschnitt bei kleinen Zähnezahlen stimmen. Alles wird als Bézierkurven ausgegeben.
//
// Schnittfuge (Kerf) und Flankenspiel sind getrennt:
// - Flankenspiel macht die Zähne auf dem Teilkreis dünner (je Rad die Hälfte des Spiels der Paarung).
// - Die Schnittfuge versetzt die ganze Kontur um die halbe Fugenbreite nach außen (Bohrung nach innen), damit
//   das ausgeschnittene Rad die Sollmaße hat. Der Kerf des Layers wirkt beim Lasern zusätzlich.
// Beides wird schon beim Erzeugen berücksichtigt: Das Werkzeugprofil wird um die halbe Fuge verkleinert,
// die Hüllkurve des verkleinerten Werkzeugs ist genau die versetzte Kontur.
import type { Pt, SubPath } from '../model';
import { t, locale } from '../i18n';
import { flipY, PathBuilder } from './build';
import { boreIssues, boreOutline, boreSchema } from './bore';
import type { Generator, Issue, Params } from './types';

/** Zulässige Abweichung der Bézierkurven von der exakten Geometrie (mm) */
export const GEAR_TOL = 0.004;

const inv = (a: number) => Math.tan(a) - a;
const rad = (deg: number) => (deg * Math.PI) / 180;

export interface GearParams {
  teeth: number;
  module: number;
  /** Eingriffswinkel in Grad */
  pressureAngle: number;
  /** Flankenspiel der Paarung in mm (auf dem Teilkreis); dieses Rad bekommt die Hälfte */
  backlash: number;
  /** Schnittfuge (volle Breite) in mm */
  kerf: number;
  /** Profilverschiebungsfaktor x */
  profileShift: number;
  /** Radius der Werkzeugkopfrundung als Vielfaches des Moduls */
  rootFillet: number;
  /** Kopfspiel als Vielfaches des Moduls (Fußhöhe = 1 + Kopfspiel) */
  clearance: number;
  boreType: 'none' | 'round' | 'dflat' | 'key';
  boreDia: number;
  /** D-Profil: Maß von der Abflachung zur gegenüberliegenden Seite */
  boreFlat: number;
  keyWidth: number;
  /** Nuttiefe über den Bohrungsrand hinaus */
  keyDepth: number;
}

/** Kenngrößen und Teilkurven eines Zahnrads (lokal: Radmitte im Ursprung, y nach oben, Zahn 0 zeigt nach oben) */
export interface GearGeometry {
  z: number;
  m: number;
  alpha: number;
  /** Teilkreis-, Grund-, Kopf- und Fußkreisradius (Kopf- und Fußkreis samt halber Fuge) */
  r: number;
  rb: number;
  ra: number;
  rf: number;
  /** Halber Zahnwinkel der Flanke beim Radius R (Evolvente), Bogenmaß */
  flankAngle(R: number): number;
  /** Radius, ab dem die Evolvente die Flanke bildet (darunter Fußrundung) */
  rFlank: number;
  /** Halber Zahnwinkel am Kopfkreis */
  tipAngle: number;
  /** Fuß wird freigeschnitten (Unterschnitt) */
  undercut: boolean;
  /** Fußrundung als Kurve über den Wälzwinkel phi (rechte Flanke, Polarwinkel θ von der Zahnmitte im Uhrzeigersinn) */
  fillet(phi: number): Pt;
  phiRoot: number;
  phiFlank: number;
  /** Winkel (von der Zahnmitte) des Übergangs Fußkreis → Fußrundung */
  rootAngle: number;
}

export function gearGeometry(p: GearParams): GearGeometry {
  const z = p.teeth,
    m = p.module;
  const alpha = rad(p.pressureAngle);
  const r = (m * z) / 2;
  const rb = r * Math.cos(alpha);
  const k2 = p.kerf / 2;
  const pitch = Math.PI * m;
  const ta = Math.tan(alpha),
    ca = Math.cos(alpha);
  // Werkzeug (Zahnstange) in eigenen Koordinaten: u entlang der Wälzgeraden, v radial (außen positiv).
  // Profilbezugslinie bei v = x·m, Werkzeugzahn mittig bei u = p/2, Kopf (= Radfuß) bei v = x·m − (1 + c)·m.
  const vDatum = p.profileShift * m;
  // Halbe Werkzeugzahnbreite in Höhe v: Flankenspiel macht den Werkzeugzahn breiter (Radzahn dünner),
  // die halbe Fuge verkleinert das Werkzeug ringsum.
  const halfW = (v: number) => pitch / 4 + (v - vDatum) * ta + p.backlash / 4 - k2 / ca;
  const vTip = vDatum - (1 + p.clearance) * m + k2;
  const rho = Math.max(0, p.rootFillet * m - k2);
  const vc = vTip + rho;
  const uc = pitch / 2 - halfW(vc) + rho / ca;

  // Zahndicke auf dem Teilkreis und Evolvente
  const s = pitch - 2 * halfW(0);
  const psi = s / (2 * r);
  const flankAngle = (R: number) => psi + inv(alpha) - inv(Math.acos(Math.min(1, rb / R)));

  // Fußrundung: Mittelpunkt der Kopfrundung des Werkzeugs, abgewälzt; der Berührpunkt liegt auf der Geraden
  // vom Wälzpunkt durch den Mittelpunkt (auf der vom Wälzpunkt abgewandten Seite).
  const fillet = (phi: number): Pt => {
    const cx = uc + r * phi,
      cy = vc;
    const l = Math.hypot(cx, cy) || 1;
    const ex = cx + (rho * cx) / l,
      ey = r + cy + (rho * cy) / l;
    // In das Radkoordinatensystem drehen (Drehung um +phi), dann als Polarwinkel von der Zahnmitte
    const gx = ex * Math.cos(phi) - ey * Math.sin(phi),
      gy = ex * Math.sin(phi) + ey * Math.cos(phi);
    return { x: gx, y: gy };
  };
  const phiRoot = -uc / r;
  // Ende der Rundung: Berührrichtung steht senkrecht auf der Werkzeugflanke
  const phiEnd = (vc / ta - uc) / r;
  const polar = (q: Pt) => ({ R: Math.hypot(q.x, q.y), th: Math.PI / 2 - Math.atan2(q.y, q.x) });

  // Übergang Rundung → Evolvente. Der gerade Teil der Werkzeugflanke reicht bis zur Tiefe hT (dort beginnt die
  // Kopfrundung). Liegt hT oberhalb der Grenze r·sin²α, schließt die Evolvente am Ende der Rundung tangential an.
  // Sonst greift das Werkzeug unter den Grundkreis (Unterschnitt): Die Rundung schneidet dann in die Evolvente,
  // und der Übergang ist der erste Schnittpunkt beider Kurven vom Fuß aus.
  const hT = -(vc - rho * Math.sin(alpha));
  const undercut = hT > r * Math.sin(alpha) ** 2 + 1e-12;
  let phiFlank = phiEnd;
  if (undercut) {
    const gap = (phi: number) => {
      const q = polar(fillet(phi));
      return q.R < rb ? -1 : q.th - flankAngle(q.R);
    };
    const N = 400;
    let prev = phiRoot;
    for (let i = 1; i <= N; i++) {
      const phi = phiRoot + ((phiEnd - phiRoot) * i) / N;
      if (gap(phi) >= 0) {
        let lo = prev,
          hi = phi;
        for (let j = 0; j < 60; j++) {
          const mid = (lo + hi) / 2;
          if (gap(mid) >= 0) hi = mid;
          else lo = mid;
        }
        phiFlank = (lo + hi) / 2;
        break;
      }
      prev = phi;
    }
  }
  const rFlank = Math.max(rb, polar(fillet(phiFlank)).R);
  const ra = r + (1 + p.profileShift) * m + k2;
  const rf = r + vTip;
  return {
    z, m, alpha, r, rb, ra, rf, flankAngle, rFlank,
    tipAngle: flankAngle(ra), undercut, fillet, phiRoot, phiFlank, rootAngle: uc / r,
  };
}

/** Außenkontur des Zahnrads (y nach oben) */
function gearOutline(g: GearGeometry): SubPath {
  const b = new PathBuilder();
  const tooth = Math.PI * 2 / g.z;
  const tStart = Math.sqrt(Math.max(0, (g.rFlank / g.rb) ** 2 - 1));
  const tTip = Math.sqrt(Math.max(0, (g.ra / g.rb) ** 2 - 1));
  // Evolvente über den Wälzwinkel: R = rb·√(1+t²), Polarwinkel aus flankAngle
  const invo = (tt: number) => {
    const R = g.rb * Math.sqrt(1 + tt * tt);
    return { R, th: g.flankAngle(R) };
  };
  const filPolar = (phi: number) => {
    const q = g.fillet(phi);
    return { R: Math.hypot(q.x, q.y), th: Math.PI / 2 - Math.atan2(q.y, q.x) };
  };
  // Punkt aus Polarwinkel θ (von der Zahnmitte im Uhrzeigersinn) für Zahn i, rechte (+1) oder linke (−1) Flanke
  const pt = (i: number, side: number, q: { R: number; th: number }): Pt => {
    const a = Math.PI / 2 - i * tooth - side * q.th;
    return { x: q.R * Math.cos(a), y: q.R * Math.sin(a) };
  };
  const centerAngle = (i: number) => Math.PI / 2 - i * tooth;
  const half = tooth / 2;
  for (let i = 0; i < g.z; i++) {
    const c = centerAngle(i);
    // Fußkreis von der Lückenmitte links bis zum Beginn der linken Fußrundung
    if (g.rootAngle < half) b.arc(0, 0, g.rf, c + half, c + g.rootAngle);
    b.curve((phi) => pt(i, -1, filPolar(phi)), g.phiRoot, g.phiFlank, GEAR_TOL);
    b.curve((tt) => pt(i, -1, invo(tt)), tStart, tTip, GEAR_TOL);
    b.arc(0, 0, g.ra, c + g.tipAngle, c - g.tipAngle);
    b.curve((tt) => pt(i, 1, invo(tt)), tTip, tStart, GEAR_TOL);
    b.curve((phi) => pt(i, 1, filPolar(phi)), g.phiFlank, g.phiRoot, GEAR_TOL);
    if (g.rootAngle < half) b.arc(0, 0, g.rf, c - g.rootAngle, c - half);
  }
  return b.close();
}

const P = (p: Params) => p as unknown as GearParams;
const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(locale, { maximumFractionDigits: d });

export const GEAR: Generator = {
  id: 'gear',
  version: 1,
  kind: 'part',
  name: t('Zahnrad'),
  icon: 'gear',
  tile: {
    group: 'mech',
    text: (t) => ({
      name: t('Zahnrad'),
      desc: t('Evolventen-Zahnrad mit Modul, Zähnezahl, Bohrung und Speichen; Parameter bleiben änderbar.'),
      keys: t('Zahnrad Zähne Getriebe Evolvente Modul|Suchwörter'),
      action: t('Zahnrad erstellen (Evolventenverzahnung, Parameter bleiben erhalten)'),
    }),
  },
  schema: [
    { key: 'teeth', type: 'int', label: t('Zähnezahl'), min: 5, max: 400, def: 24 },
    { key: 'module', type: 'length', label: t('Modul'), min: 0.3, max: 20, def: 2, title: t('Teilkreisdurchmesser geteilt durch Zähnezahl; Zahnräder, die ineinandergreifen, brauchen dasselbe Modul') },
    { key: 'pressureAngle', type: 'angle', label: t('Eingriffswinkel'), min: 10, max: 35, def: 20, title: t('Üblich sind 20°; ineinandergreifende Räder brauchen denselben Winkel') },
    { key: 'backlash', type: 'length', label: t('Flankenspiel'), min: 0, max: 3, def: 0.1, title: t('Spiel der Zahnradpaarung auf dem Teilkreis; jedes Rad wird um die Hälfte dünner') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit das Rad die Sollmaße hat. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
    ...boreSchema(),
    { key: 'profileShift', type: 'number', label: t('Profilverschiebung x'), min: -0.8, max: 1, def: 0, advanced: true, title: t('Positiv macht die Zähne am Fuß kräftiger und vermeidet Unterschnitt; der Achsabstand ändert sich dann um x·Modul') },
    { key: 'rootFillet', type: 'number', label: t('Fußrundung (× Modul)'), min: 0, max: 0.45, def: 0.38, advanced: true, title: t('Radius der Werkzeugkopfrundung, Norm: 0,38') },
    { key: 'clearance', type: 'number', label: t('Kopfspiel (× Modul)'), min: 0.1, max: 0.5, def: 0.25, advanced: true, title: t('Abstand zwischen Zahnkopf und Fußkreis des Gegenrads, Norm: 0,25') },
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    const m = p.module;
    if (p.profileShift * m - (1 + p.clearance) * m + p.rootFillet * m >= -1e-6)
      out.push({ key: 'profileShift', level: 'error', msg: t('Profilverschiebung zu groß für Kopfspiel und Fußrundung.') });
    if (p.backlash / 2 >= (Math.PI * m) / 4) out.push({ key: 'backlash', level: 'error', msg: t('Flankenspiel zu groß für dieses Modul.') });
    if (out.length) return out;
    const g = gearGeometry(p);
    const tipThick = 2 * g.tipAngle * g.ra;
    if (tipThick <= 0.01 * m) out.push({ key: 'profileShift', level: 'error', msg: t('Die Zähne laufen spitz zu: Profilverschiebung verringern oder Eingriffswinkel ändern.') });
    else if (tipThick < 0.25 * m) out.push({ key: 'profileShift', level: 'warn', msg: t('Sehr schmale Zahnköpfe ({w} mm).', { w: fmt(tipThick) }) });
    if (g.rFlank >= g.ra) out.push({ key: 'teeth', level: 'error', msg: t('Zu wenige Zähne: Der Unterschnitt nimmt die ganze Flanke weg. Mehr Zähne oder positive Profilverschiebung wählen.') });
    else if (g.undercut) {
      const xMin = 1 - (p.teeth * Math.sin(g.alpha) ** 2) / 2;
      out.push({ key: 'teeth', level: 'warn', msg: t('Unterschnitt: Der Zahnfuß wird freigeschnitten und schwächer. Ab Profilverschiebung {x} entfällt er.', { x: fmt(xMin) }) });
    }
    out.push(...boreIssues(raw, p.kerf, g.rf, Math.max(1, m)));
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const g = gearGeometry(p);
    const subs = [gearOutline(g)];
    const hole = boreOutline(raw, p.kerf);
    if (hole) subs.push(hole);
    const m = p.module;
    const info: [string, string][] = [
      [t('Teilkreis'), `⌀ ${fmt(2 * g.r)} mm`],
      [t('Kopfkreis'), `⌀ ${fmt(2 * g.ra)} mm`],
      [t('Fußkreis'), `⌀ ${fmt(2 * g.rf)} mm`],
      [t('Grundkreis'), `⌀ ${fmt(2 * g.rb)} mm`],
      [t('Zahndicke am Kopf'), `${fmt(2 * g.tipAngle * g.ra)} mm`],
      [t('Achsabstand'), `${fmt(m, 3)} × (z₁ + z₂) / 2${p.profileShift ? ` + (x₁ + x₂) × ${fmt(m, 3)}` : ''}`],
    ];
    return { parts: [{ key: 'main', subs: subs.map(flipY), at: { x: 0, y: 0 } }], info };
  },
  label(raw) {
    const p = P(raw);
    return t('Zahnrad z={z} m={m}', { z: p.teeth, m: fmt(p.module, 3) });
  },
};
