import { t } from './i18n';
import type { ProjectParam } from './params';
import type { SeriesTable, TemplateInfo } from './templates';
import { conditionHolds } from './params';
import { cleanLook, type MaterialLook } from './view3d/looks';
// Datenmodell: Dokument, Objekte, Layer, Matrizen.
// Interne Koordinaten sind Millimeter mit y nach unten (wie SVG), Ursprung oben links am Bett.
// Angezeigt wird in Maschinenkoordinaten (Ursprung unten links, y nach oben).

export type Mat = [number, number, number, number, number, number]; // a b c d e f

export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function inv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
/** Transformation m um den Punkt (cx, cy) herum. */
export const about = (m: Mat, cx: number, cy: number): Mat => mul(translate(cx, cy), mul(m, translate(-cx, -cy)));

export interface Pt {
  x: number;
  y: number;
}

export interface Node {
  x: number;
  y: number;
  /** Eingehender Bézier-Anfasser (absolut, lokal) */
  cin?: Pt;
  /** Ausgehender Bézier-Anfasser */
  cout?: Pt;
  /** Anfasser bleiben beim Ziehen gespiegelt */
  smooth?: boolean;
}

export interface SubPath {
  nodes: Node[];
  closed: boolean;
  /** Vom Nutzer gesetzter Startpunkt (Set Start Point): Knoten 0 und die Knotenreihenfolge bestimmen Anfang und Richtung des Schnitts, die Optimierung ändert sie nicht */
  start?: boolean;
}

export type Shape =
  | { kind: 'rect'; w: number; h: number; r: number }
  | { kind: 'ellipse'; rx: number; ry: number }
  | { kind: 'polygon'; sides: number; r: number; star: boolean; inner: number }
  /** mark: Gravur eines Generator-Teils („Baugruppe/Teil“), wird mit dem Teil neu berechnet */
  | { kind: 'path'; subs: SubPath[]; mark?: string }
  | TextShape
  | ImageShape
  | BarcodeShape
  | GenShape
  | { kind: 'group'; children: Obj[] };

/**
 * Parametrisches Bauteil aus einem Generator (z. B. Zahnrad). Die Parameter bleiben erhalten, ein Doppelklick
 * öffnet den Generator wieder. subs ist die zuletzt berechnete Kontur: Sie wird gezeichnet, gelasert und
 * exportiert und bleibt auch dann nutzbar, wenn der Generator fehlt (z. B. in einer älteren Programmversion).
 */
export interface GenShape {
  kind: 'gen';
  /** ID des Generators (src/generators) */
  gen: string;
  /** Version des Generators, mit der die Parameter gespeichert wurden */
  v: number;
  params: Record<string, number | string | boolean>;
  /** Lokale Koordinaten in mm */
  subs: SubPath[];
  /** Baugruppen: Schlüssel des Teils (z. B. 'front') und Kennung der Baugruppe, zu der es gehört */
  part?: string;
  asm?: string;
  /** Felder, die aus Projekt-Parametern berechnet werden: Schlüssel → Formel (z. B. thickness: 'Dicke') */
  bind?: Record<string, string>;
}

/** Bildanpassungen je Bild (wie „Adjust Image“ in LightBurn) */
export interface ImageAdjust {
  /** -100 … 100 */
  brightness: number;
  /** -100 … 100 */
  contrast: number;
  /** 0,1 … 5, 1 = unverändert */
  gamma: number;
  /** Schärfen (Unscharfmaskierung): Stärke 0 … 300 % */
  sharpen: number;
  /** Radius der Unscharfmaskierung in Bildpunkten der Ausgabe */
  sharpenRadius: number;
  /** Unterschiede unter diesem Wert (0 … 50) werden nicht geschärft */
  denoise: number;
}

export const DEFAULT_ADJUST: ImageAdjust = { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, sharpenRadius: 1, denoise: 0 };

/** Rasterbild. Lokale Fläche 0..w × 0..h in mm; die Bilddaten liegen im Asset-Speicher (images.ts). */
export interface ImageShape {
  kind: 'image';
  asset: string;
  w: number;
  h: number;
  /** Pixelmaße des Originals */
  pxW: number;
  pxH: number;
  name?: string;
  adjust: ImageAdjust;
}

export type DitherMode = 'threshold' | 'ordered' | 'atkinson' | 'floyd' | 'stucki' | 'jarvis' | 'newsprint' | 'halftone' | 'sketch' | 'grayscale';

export const DITHER_MODES: [DitherMode, string][] = [
  ['threshold', t('Schwellwert')],
  ['ordered', t('Geordnet')],
  ['atkinson', t('Atkinson')],
  ['floyd', t('Dither (Floyd-Steinberg)')],
  ['stucki', t('Stucki')],
  ['jarvis', t('Jarvis')],
  ['newsprint', t('Zeitungsdruck (Newsprint)')],
  ['halftone', t('Halbton')],
  ['sketch', t('Skizze (Sketch)')],
  ['grayscale', t('Graustufen')],
];

/**
 * Image settings of a layer (own "Image" row in the layer table). Speed, power, min power and passes
 * come from the layer itself (see imageOutput); the optional fields below only exist in older files
 * and material entries and are moved into the layer when a document is loaded.
 */
export interface ImageLayer {
  /** @deprecated legacy, use the layer's speed */
  speed?: number;
  /** @deprecated legacy, use the layer's power */
  power?: number;
  /** @deprecated legacy, use the layer's minPower */
  minPower?: number;
  /** @deprecated legacy, use the layer's passes */
  passes?: number;
  /** Zeilenabstand in mm (DPI = 25,4 / interval) */
  interval: number;
  dither: DitherMode;
  negative: boolean;
  bidirectional: boolean;
  /** Überfahrweg in % der Geschwindigkeit */
  overscan: number;
  /** Halbton und Zeitungsdruck: Zellen pro Zoll und Rasterwinkel */
  cells: number;
  angle: number;
  /** Schwellwert-Verfahren: Grenze 0 … 255 */
  threshold: number;
}

/** Verfahren mit veränderlicher Leistung (Min. bis Max.); alle anderen brennen mit Max. oder gar nicht */
export const isGrayMode = (d: DitherMode) => d === 'grayscale' || d === 'sketch';
/** Verfahren mit Rasterzellen (Zellen pro Zoll, Rasterwinkel) */
export const isCellMode = (d: DitherMode) => d === 'halftone' || d === 'newsprint';

export function defaultImageLayer(): ImageLayer {
  return {
    interval: 0.1, dither: 'jarvis', negative: false,
    bidirectional: true, overscan: 2.5, cells: 50, angle: 45, threshold: 128,
  };
}

/** Image settings plus the layer's speed, power and passes: what the laser and the preview use */
export type ImageOutput = ImageLayer & { speed: number; power: number; minPower: number; passes: number };

/** Speed and power a layer gets when an image is placed on it while it is still empty */
export const IMAGE_LAYER_DEFAULTS = { speed: 3000, power: 30, minPower: 0, passes: 1 } as const;

const IMG_OUTPUT_KEYS = ['speed', 'power', 'minPower', 'passes'] as const;

/** Output settings for the images of a layer: image settings with speed, power and passes of the layer */
export function imageOutput(L: Pick<CutSettings, 'speed' | 'power' | 'minPower' | 'passes'> & { img?: ImageLayer }, img = L.img): ImageOutput {
  const out = { ...defaultImageLayer(), ...img, speed: L.speed, power: L.power, minPower: L.minPower, passes: L.passes };
  return out;
}

/** Image settings without the legacy speed/power fields (they belong to the layer) */
export function stripImageOutput(img: ImageLayer): ImageLayer {
  const out = { ...img };
  for (const k of IMG_OUTPUT_KEYS) delete out[k];
  return out;
}

/**
 * Older files kept speed, power, min power and passes of images separately from the layer. Move them into
 * the layer when it holds only images; on layers that also hold vectors the layer's values win.
 */
function migrateImageOutput(layers: Record<number, Layer>, pages: Page[]) {
  const vec = new Set<number>();
  for (const p of pages) for (const [o] of leaves(p.objs)) if (o.shape.kind !== 'image') vec.add(o.layer);
  for (const [k, L] of Object.entries(layers)) {
    const img = L?.img;
    if (!img || typeof img !== 'object') continue;
    if (!vec.has(Number(k))) for (const key of IMG_OUTPUT_KEYS) if (typeof img[key] === 'number' && isFinite(img[key]!)) L[key] = img[key]!;
    L.img = stripImageOutput(img);
  }
}

export interface TextShape {
  kind: 'text';
  text: string;
  font: string;
  /** Schriftgröße in mm (Em-Höhe) */
  size: number;
  bold: boolean;
  italic: boolean;
  upper: boolean;
  align: 'left' | 'center' | 'right';
  /** zusätzlicher Zeichenabstand in mm */
  hSpace: number;
  /** zusätzlicher Zeilenabstand in mm */
  vSpace: number;
  /** Buchstaben schweißen: überlappende Glyphen zu einer Kontur verschmelzen */
  weld?: boolean;
  /** Text auf Pfad: die Grundlinie folgt dieser Kurve */
  path?: TextPath;
  /** Variabler Text: Platzhalter wie %# (Seriennummer), %Y (Jahr) oder %0 (CSV-Spalte) werden ersetzt */
  vt?: VarTextRef;
  /** Höchstbreite in mm: breitere Zeilen werden waagerecht gestaucht (0/fehlt = aus) */
  maxW?: number;
  /** Höchsthöhe in mm: ein höherer Textblock wird gleichmäßig verkleinert (0/fehlt = aus) */
  maxH?: number;
  /**
   * shrink: zu breiter Text wird gleichmäßig verkleinert statt gestaucht (Text in Rahmen einpassen).
   * wrap: Textrahmen mit fester Breite maxW; Zeilen brechen an Wortgrenzen um, die Höhe wächst mit.
   */
  fit?: 'shrink' | 'wrap';
}

/** Variabler Text an einem Objekt (Text oder Barcode) */
export interface VarTextRef {
  /** Wird zur aktuellen Nummer addiert (z. B. für mehrere Schilder in einem Job) */
  offset: number;
}

/** Projektweite Einstellungen für variablen Text (wie das Fenster „Variable Text“ in LightBurn) */
export interface VarText {
  start: number;
  end: number;
  /** Aktuelle Nummer: Seriennummer und Zeile der CSV-Datei */
  current: number;
  /** Schrittweite beim Weiterzählen */
  advance: number;
  /** Nach jedem gestarteten Job und jeder gespeicherten G-Code-Datei weiterzählen */
  autoAdvance: boolean;
  /** Geladene CSV-Datei */
  csv?: { name: string; header: string[] | null; rows: string[][] };
}

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** Strichcode-Arten (1D) */
export type LinearType = 'code128' | 'ean13' | 'ean8' | 'upca' | 'code39' | 'itf';

/**
 * QR-Code oder Strichcode (1D). QR: lokale Fläche 0..size × 0..size in mm (nur die Module; die Ruhezone liegt außen herum).
 * Strichcode: Striche in 0..size × 0..height, der Klartext darunter.
 */
export interface BarcodeShape {
  kind: 'barcode';
  type: 'qr' | LinearType;
  /** Inhalt (bei variablem Text mit Platzhaltern) */
  data: string;
  /** Fehlerkorrektur */
  ec: QrLevel;
  /** QR: Kantenlänge in mm. Strichcode: Breite der Striche (ohne Ruhezone) in mm */
  size: number;
  /** Negativ: Hintergrund samt Ruhezone wird gelasert, die Module bleiben stehen (z. B. für dunkle Materialien) */
  invert: boolean;
  /** Breite der Ruhezone in Modulen (nur bei Negativ gelasert) */
  quiet: number;
  /** Strichcode: Höhe der Striche in mm */
  height?: number;
  /** Strichcode: Klartext unter den Strichen */
  text?: boolean;
  /** Strichcode: Prüfziffer anhängen (Code 39, ITF; EAN/UPC immer) */
  check?: boolean;
  /** Strichcode: Strichbreitenkorrektur in mm; gelaserte Elemente werden um diesen Betrag schmaler (Strahlbreite) */
  bwr?: number;
  vt?: VarTextRef;
  /** Eingabefelder des Dialogs (Art des Inhalts, WLAN-Daten …), damit Bearbeiten sie wieder zeigt */
  form?: Record<string, string>;
}

/** Kurve für Text auf Pfad, in lokalen Koordinaten des Texts (Kopie der gewählten Form) */
export interface TextPath {
  sub: SubPath;
  /** Verschiebung entlang der Kurve in mm (vom Anfang, der Mitte oder dem Ende je nach Ausrichtung; bei geschlossenen Formen vom obersten Punkt) */
  offset: number;
  /** Abstand der Grundlinie von der Kurve in mm; positiv = nach oben vom Text aus gesehen */
  dist: number;
  /** Laufrichtung umkehren: Text auf der anderen Seite der Kurve */
  flip: boolean;
  /** ID der verknüpften Form: Ändert sie sich, folgt der Text (wie in LightBurn). Fehlt sie, bleibt die letzte Kurve. */
  link?: number;
  /** Zuletzt abgeglichene Weltmatrizen von Text und Form, um zu erkennen, was sich bewegt hat */
  textM?: Mat;
  linkM?: Mat;
}

export interface Obj {
  id: number;
  m: Mat;
  /** Layer-/Paletten-Index 0..31 */
  layer: number;
  shape: Shape;
  /** Eigener Name aus dem Objekte-Fenster (sonst wird er aus der Form abgeleitet) */
  name?: string;
  /** Ausgeblendet: nicht gezeichnet, nicht gelasert, nicht exportiert */
  hidden?: boolean;
  /** Gesperrt: auf der Arbeitsfläche nicht auswählbar (nur oberste Ebene) */
  locked?: boolean;
  /** Not lasered (still drawn, faded): e.g. a part that is already cut or parked for later */
  noLaser?: boolean;
  /** Mit dem Verbindungs-Werkzeug angelegte Verbindungen zu anderen Teilen (für die 3D-Ansicht) */
  mates?: Mate[];
  /** Formeln mit Projekt-Parametern für Lage, Größe, Drehung und Formmaße (nur oberste Ebene) */
  bind?: ObjBinds;
  /** Nur zeigen (und lasern), wenn diese Formel mit Projekt-Parametern wahr ist, z. B. „Deckel“ */
  showIf?: string;
  /** Hinweis aus dem Import (übersprungene Elemente der Quelldatei), für „Konstruktion prüfen“ */
  importNote?: string;
  /** Passermarke Nummer 1, 2, … für Print and Cut (printcut.ts): wird gezeichnet, gedruckt und exportiert, aber nie gelasert */
  reg?: number;
}

/**
 * Formeln eines Objekts, in den Einheiten der Eingabefelder: x/y in Maschinenkoordinaten am Bezugspunkt anchor
 * (Anteile 0..1 des Rahmens), w/h Rahmenmaße (lock: Seitenverhältnis halten, wenn nur eines gebunden ist),
 * rot Drehung in Grad, r Eckenradius, sides Ecken, size Schriftgröße, maxW/maxH Höchstmaße des Texts.
 */
export interface ObjBinds {
  x?: string;
  y?: string;
  w?: string;
  h?: string;
  rot?: string;
  r?: string;
  sides?: string;
  size?: string;
  maxW?: string;
  maxH?: string;
  anchor?: [number, number];
  lock?: boolean;
}
export const OBJ_BIND_KEYS = ['x', 'y', 'w', 'h', 'rot', 'r', 'sides', 'size', 'maxW', 'maxH'] as const;
export type ObjBindKey = (typeof OBJ_BIND_KEYS)[number];

/** Ausgeblendet: von Hand oder weil seine Bedingung (showIf) gerade nicht gilt */
export const isOff = (o: Obj) => !!o.hidden || (!!o.showIf && !conditionHolds(o.showIf));

/**
 * Verbindung zwischen zwei Teilen, gespeichert beim Teil mit der ersten Kante. Alle Punkte in lokalen Koordinaten
 * des jeweiligen Objekts; der dritte Punkt liegt jeweils auf der Materialseite der Linie.
 */
export interface Mate {
  /** ID des Gegenstücks */
  to: number;
  /** Art der Verbindung (JointKind aus joints.ts) */
  kind: string;
  /** Materialdicke */
  th: number;
  /** Kante am eigenen Teil: Anfang, Ende, Punkt im Material */
  a: [Pt, Pt, Pt];
  /** Am Gegenstück: Kante (Zinken, Überblattung, Scharnier) bzw. Mittellinie der Schlitze (Zapfen-Familie) */
  b: [Pt, Pt, Pt];
  /** Fingerzinken stehen heraus (Teile im Innenmaß gezeichnet) */
  out?: boolean;
  /** Überblattung: Kreuzungspunkt auf beiden Kanten (Anteil vom Anfang) und Schlitztiefen */
  lap?: { ua: number; ub: number; da: number; db: number };
  /** Kerf und Spiel, mit denen die Verbindung gezeichnet wurde (für „Konstruktion prüfen“; fehlt bei älteren) */
  fit?: { k: number; c: number };
}

export type LayerMode = 'line' | 'fill';

/** Haltestege (Tabs/Brücken): kurze Stellen, an denen der Laser aus ist, damit Teile nicht herausfallen */
export interface TabSettings {
  enabled: boolean;
  /** Länge eines Stegs in mm */
  size: number;
  /** true: feste Anzahl je Form, false: Abstand in mm */
  useCount: boolean;
  count: number;
  spacing: number;
  /** Formen, die in anderen Formen liegen (Löcher), bekommen keine Stege */
  skipInner: boolean;
}

/**
 * Bearbeitungseinstellungen eines Layers (wie im Cut Settings Editor von LightBurn).
 * Alles, was eine Material-Bibliothek speichern und wieder auf einen Layer anwenden kann.
 */
export interface CutSettings {
  mode: LayerMode;
  /** mm/min */
  speed: number;
  /** % */
  power: number;
  minPower: number;
  passes: number;
  /** Air Assist während dieses Layers einschalten (M8/M7, aus mit M9) */
  air: boolean;
  /** Kerf-Versatz in mm: positiv = Außenkonturen nach außen, Löcher nach innen */
  kerf: number;
  /** Nur Linie: Haltestege */
  tabs: TabSettings;
  /** Füllen: 'scan' = Zeile für Zeile, 'offset' = Ringe, die der Kontur nach innen folgen */
  fillStyle: FillStyle;
  /** Füllen: Zeilenabstand in mm (bei 'offset' Abstand der Ringe) */
  interval: number;
  /** Füllen: Scanwinkel in Grad (0 = waagerecht) */
  angle: number;
  /** Füllen: zweiter Durchgang um 90° gedreht */
  crossHatch: boolean;
  /** Füllen: in beide Richtungen lasern */
  bidirectional: boolean;
  /** Füllen: Überfahrweg in % der Geschwindigkeit */
  overscan: number;
  /** Nur Linie: Perforation (gestrichelt schneiden) */
  perf: PerfSettings;
  /** Nur Linie, geschlossene Formen: Anschnitt (Lead-In), Auslauf (Lead-Out) und Überschnitt */
  lead: LeadSettings;
  /** Nur Linie: Leistung in Ecken auf Min. Leistung absenken */
  ramp: RampSettings;
  /** Z-Versatz in mm beim ersten Durchgang, positiv = Fokus tiefer ins Material (braucht eine Z-Achse am Gerät) */
  zOffset: number;
  /** Je weiterem Durchgang um so viele mm tiefer fokussieren */
  zStep: number;
  /** Sub-Layer: weitere Bearbeitungen derselben Formen nach diesem Layer (z. B. erst füllen, dann ausschneiden) */
  sub?: SubLayer[];
  /** Aussehen des Materials in der 3D-Ansicht (Farbe, Textur, Gravurdarstellung); fehlt = automatisch */
  look?: MaterialLook;
}

export type FillStyle = 'scan' | 'offset';

export interface PerfSettings {
  enabled: boolean;
  /** Geschnittene Strecke in mm */
  on: number;
  /** Lücke in mm */
  off: number;
}

export interface LeadSettings {
  leadIn: boolean;
  leadOut: boolean;
  /** Länge von Anschnitt und Auslauf in mm */
  length: number;
  /** Gerade: Winkel zur Kontur in Grad (90 = senkrecht); Bogen: Bogenwinkel */
  angle: number;
  /** Bogen statt Gerade */
  arc: boolean;
  /** Überschnitt: nach dem Schließen so viele mm weiter der Kontur folgen */
  overcut: number;
}

export interface RampSettings {
  enabled: boolean;
  /** Länge der Rampe vor und nach der Ecke in mm */
  length: number;
  /** Ecken ab diesem Richtungswechsel in Grad */
  angle: number;
  /** Auch am Anfang und Ende jedes Schnitts */
  ends: boolean;
}

/** Sub-Layer: eigene Bearbeitung derselben Formen; Air Assist und Aussehen gelten vom Layer */
export type SubLayer = Omit<CutSettings, 'air' | 'look' | 'sub'> & { output: boolean };

export const CUT_KEYS: (keyof CutSettings)[] = [
  'mode', 'speed', 'power', 'minPower', 'passes', 'air', 'kerf', 'tabs', 'fillStyle', 'interval', 'angle', 'crossHatch', 'bidirectional', 'overscan',
  'perf', 'lead', 'ramp', 'zOffset', 'zStep', 'sub', 'look',
];

/** Felder eines Sub-Layers (alles außer Air Assist, Aussehen und weiteren Sub-Layern) */
const SUB_KEYS = CUT_KEYS.filter((k) => k !== 'air' && k !== 'look' && k !== 'sub') as (keyof SubLayer)[];

export const defaultPerf = (): PerfSettings => ({ enabled: false, on: 1, off: 1 });
export const defaultLead = (): LeadSettings => ({ leadIn: false, leadOut: false, length: 2, angle: 90, arc: false, overcut: 0 });
export const defaultRamp = (): RampSettings => ({ enabled: false, length: 1, angle: 45, ends: false });

export function defaultSubLayer(mode: LayerMode = 'line'): SubLayer {
  const d = defaultCutSettings(mode) as Partial<CutSettings>;
  delete d.air;
  return { ...(d as SubLayer), output: true };
}

/** Fehlende Felder eines Sub-Layers auffüllen (ältere Dateien, Import) */
function normalizeSub(s: SubLayer): SubLayer {
  const d = defaultSubLayer(s.mode === 'fill' ? 'fill' : 'line');
  for (const k of SUB_KEYS) if (s[k] === undefined) (s as unknown as Record<string, unknown>)[k] = d[k];
  fillNested(s);
  if (s.output === undefined) s.output = true;
  return s;
}

function fillNested(s: Pick<CutSettings, 'tabs' | 'perf' | 'lead' | 'ramp'>) {
  s.tabs = { ...defaultTabs(), ...s.tabs };
  s.perf = { ...defaultPerf(), ...s.perf };
  s.lead = { ...defaultLead(), ...s.lead };
  s.ramp = { ...defaultRamp(), ...s.ramp };
}

export function defaultTabs(): TabSettings {
  return { enabled: false, size: 0.5, useCount: true, count: 4, spacing: 50, skipInner: true };
}

export function defaultCutSettings(mode: LayerMode = 'line'): CutSettings {
  return {
    mode,
    speed: mode === 'fill' ? 3000 : 600,
    power: mode === 'fill' ? 30 : 80,
    minPower: 0,
    passes: 1,
    air: false,
    kerf: 0,
    tabs: defaultTabs(),
    fillStyle: 'scan',
    interval: 0.1,
    angle: 0,
    crossHatch: false,
    bidirectional: true,
    overscan: 2.5,
    perf: defaultPerf(),
    lead: defaultLead(),
    ramp: defaultRamp(),
    zOffset: 0,
    zStep: 0,
  };
}

/** Bearbeitungseinstellungen eines Layers als eigenständige Kopie (z. B. für die Material-Bibliothek) */
export function cutSettings(L: CutSettings): CutSettings {
  const out = {} as Record<string, unknown>;
  for (const k of CUT_KEYS) out[k] = structuredClone(L[k]);
  return out as unknown as CutSettings;
}

export interface Layer extends CutSettings {
  index: number;
  name: string;
  output: boolean;
  show: boolean;
  /** Ausgabereihenfolge (kleiner = früher) */
  priority?: number;
  /** Einstellungen für die Bilder dieses Layers */
  img?: ImageLayer;
  /** ID des Eintrags der Material-Bibliothek, aus dem die Einstellungen stammen */
  material?: string;
  /** Objekte dieses Layers sind auf der Arbeitsfläche nicht auswählbar */
  locked?: boolean;
}

/** Schneidet der Layer Linien (selbst im Modus Linie oder über einen eingeschalteten Sub-Layer)? */
export const isCutLayer = (L: Layer) => L.mode === 'line' || !!L.sub?.some((s) => s.output && s.mode === 'line');

/** Ältere Dateien kennen nicht alle Einstellungen: fehlende mit Standardwerten auffüllen */
export function normalizeLayer(L: Layer): Layer {
  if (L.tabs && L.fillStyle !== undefined && L.ramp && L.zStep !== undefined && (!L.sub || L.sub.every((s) => s.ramp && s.output !== undefined))) return L;
  return normalizeCut(L);
}

/** Fehlende Bearbeitungseinstellungen mit Standardwerten auffüllen (ältere Dateien, Material-Bibliotheken, Import) */
export function normalizeCut<T extends CutSettings>(L: T): T {
  const d = defaultCutSettings(L.mode);
  for (const k of CUT_KEYS) if (L[k] === undefined && k !== 'sub' && k !== 'look') (L as unknown as Record<string, unknown>)[k] = d[k];
  fillNested(L);
  if (L.sub !== undefined) L.sub = Array.isArray(L.sub) && L.sub.length ? L.sub.map(normalizeSub) : undefined;
  return L;
}

/** Eine Seite des Projekts: eigene Objekte, Layer-Einstellungen gelten für das ganze Projekt */
export interface Page {
  name: string;
  objs: Obj[];
}

export interface Doc {
  version: 2;
  bed: { w: number; h: number };
  pages: Page[];
  /** Index der aktuellen Seite; gezeichnet, bearbeitet, gelasert und exportiert wird nur sie */
  page: number;
  /**
   * Objekte der aktuellen Seite. Zugriff auf pages[page].objs (nicht aufzählbar, landet also nicht in JSON);
   * Dokumente immer über newDoc() bzw. loadDoc() erzeugen.
   */
  objs: Obj[];
  layers: Record<number, Layer>;
  /** Variabler Text: Zähler und CSV-Daten des Projekts */
  vt?: VarText;
  /** Projekt-Parameter (Zahlen, Texte, Ja/Nein) für Platzhalter und Formeln; Grundlage für Vorlagen */
  params?: ProjectParam[];
  /** Vorlagen-Angaben: Titel, Beschreibung und die beim Ausfüllen gefragten Parameter */
  template?: TemplateInfo;
  /** Tabelle für Serien (Datei → Serie aus Tabelle): Kopfzeile und Zeilen */
  seriesTable?: SeriesTable;
  /** Projekt-Notizen (Fenster „Notizen“): Material, Aufbau und Bearbeitung als freier Text */
  notes?: ProjectNotes;
  /** Hilfslinien aus dem Lineal: eigene Ebene, keine Objekte, werden nie gelasert oder exportiert (alle Seiten) */
  guides?: Guide[];
  /** Ebene „Hilfslinien“ ausgeblendet bzw. gesperrt (nicht verschiebbar) */
  guidesHidden?: boolean;
  guidesLocked?: boolean;
  /** Nur in Projektdateien: Bilddaten (Asset-ID → data:-URL) */
  assets?: Record<string, string>;
  /** Nur in Projektdateien: 3D-Modelle der Generatoren (Kennung → Daten, siehe model3d/store.ts) */
  meshes?: Record<string, string>;
  /** Frei gestaltete, gestapelte Platten für die 3D-Ansicht. */
  multiLayerAssemblies?: MultiLayerAssembly[];
}

/** Eine Platte referenziert ein oberstes Objekt; dessen Inhalt bleibt vollständig editierbar. */
export interface MultiLayerPlate {
  object: number;
  name: string;
  thickness: number;
  look: MaterialLook;
  /** Abbildung der Zeichenfläche in die Montage; spätere Nesting-Verschiebungen ändern die Montage nicht. */
  anchor: Mat;
}

export interface MultiLayerAssembly {
  id: string;
  plates: MultiLayerPlate[];
}

/** Hilfslinie über das ganze Bett: 'y' = waagrecht auf Höhe v, 'x' = senkrecht bei v (Weltkoordinaten in mm) */
export interface Guide {
  axis: 'x' | 'y';
  v: number;
}

/** Hilfslinien aus einer Datei prüfen; fehlerhafte Einträge fallen weg */
export function cleanGuides(raw: unknown): Guide[] {
  if (!Array.isArray(raw)) return [];
  const out: Guide[] = [];
  for (const g of raw) {
    const r = g as Record<string, unknown>;
    if (!r || (r.axis !== 'x' && r.axis !== 'y') || typeof r.v !== 'number' || !Number.isFinite(r.v)) continue;
    out.push({ axis: r.axis, v: r.v });
  }
  return out;
}

/**
 * Bis Version 2.0.0-rc.1 waren Hilfslinien gewöhnliche Linien auf dem Werkzeug-Layer T1 (über das ganze Bett,
 * nur verschoben, ohne Namen). Solche Linien werden zu echten Hilfslinien.
 */
export function legacyGuide(o: Obj, bed: { w: number; h: number }): Guide | null {
  const s = o.shape;
  if (o.layer !== 30 || o.name || o.hidden || o.locked || s.kind !== 'path' || s.subs.length !== 1) return null;
  const sp = s.subs[0];
  if (sp.closed || sp.nodes.length !== 2) return null;
  const [a, b] = sp.nodes;
  if (a.cin || a.cout || b.cin || b.cout || a.x !== 0 || a.y !== 0) return null;
  const m = o.m;
  if (m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 1) return null;
  if (b.y === 0 && b.x === bed.w && m[4] === 0) return { axis: 'y', v: m[5] };
  if (b.x === 0 && b.y === bed.h && m[5] === 0) return { axis: 'x', v: m[4] };
  return null;
}

/** Abschnitte der Projekt-Notizen; leere Abschnitte werden nicht gespeichert */
export const NOTE_KEYS = ['material', 'setup', 'process'] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];
export type ProjectNotes = Partial<Record<NoteKey, string>>;

/** Nur nicht leere Text-Abschnitte behalten; nichts übrig = undefined */
export function cleanNotes(raw: unknown): ProjectNotes | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: ProjectNotes = {};
  for (const k of NOTE_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export const pageName = (i: number) => t('Seite {n}', { n: i + 1 });

/**
 * Rohdaten (Datei, Autosave, Undo-Zwischenstand) zu einem Dokument machen.
 * Ältere einseitige Dateien (version 1, nur objs) werden zu einem Projekt mit einer Seite.
 */
export function loadDoc(raw: unknown): Doc {
  const d = raw as Record<string, unknown>;
  if (!d || typeof d !== 'object') throw new Error(t('Keine gültige Projektdatei'));
  let pages = d.pages as Page[] | undefined;
  if (!Array.isArray(pages)) {
    if (!Array.isArray(d.objs)) throw new Error(t('Keine gültige Projektdatei'));
    pages = [{ name: pageName(0), objs: d.objs as Obj[] }];
  }
  pages = pages.filter((p) => p && Array.isArray(p.objs));
  if (!pages.length) pages = [{ name: pageName(0), objs: [] }];
  pages.forEach((p, i) => (p.name = typeof p.name === 'string' && p.name ? p.name : pageName(i)));
  delete d.objs;
  d.version = 2;
  d.pages = pages;
  d.page = Math.min(Math.max(0, Math.floor(Number(d.page) || 0)), pages.length - 1);
  d.bed ??= { w: 400, h: 400 };
  d.layers ??= {};
  migrateImageOutput(d.layers as Record<number, Layer>, pages);
  const mla = Array.isArray(d.multiLayerAssemblies) ? d.multiLayerAssemblies : [];
  const seen = new Set<number>();
  const cleanAssemblies: MultiLayerAssembly[] = [];
  for (const rawAsm of mla) {
    const a = rawAsm as Partial<MultiLayerAssembly>;
    if (typeof a.id !== 'string' || !a.id || !Array.isArray(a.plates)) continue;
    const plates: MultiLayerPlate[] = [];
    for (const rawPlate of a.plates) {
      const p = rawPlate as Partial<MultiLayerPlate>;
      if (!Number.isInteger(p.object) || p.object === undefined || seen.has(p.object) || typeof p.name !== 'string' || typeof p.thickness !== 'number' || !isFinite(p.thickness) || p.thickness <= 0 || p.thickness > 50) continue;
      const look = cleanLook(p.look);
      if (!look) continue;
      seen.add(p.object);
      const anchor = Array.isArray(p.anchor) && p.anchor.length === 6 && p.anchor.every((v) => typeof v === 'number' && isFinite(v)) ? p.anchor as Mat : IDENT;
      plates.push({ object: p.object, name: p.name, thickness: p.thickness, look, anchor });
    }
    if (plates.length) cleanAssemblies.push({ id: a.id, plates });
  }
  if (cleanAssemblies.length) d.multiLayerAssemblies = cleanAssemblies;
  else delete d.multiLayerAssemblies;
  const notes = cleanNotes(d.notes);
  if (notes) d.notes = notes;
  else delete d.notes;
  const guides = cleanGuides(d.guides);
  const bed = d.bed as { w: number; h: number };
  for (const p of pages) {
    const keep = p.objs.filter((o) => {
      const g = legacyGuide(o, bed);
      if (g && !guides.some((x) => x.axis === g.axis && x.v === g.v)) guides.push(g);
      return !g;
    });
    if (keep.length !== p.objs.length) p.objs = keep;
  }
  if (guides.length) d.guides = guides;
  else delete d.guides;
  if (d.guidesHidden !== true) delete d.guidesHidden;
  if (d.guidesLocked !== true) delete d.guidesLocked;
  Object.defineProperty(d, 'objs', {
    enumerable: false,
    configurable: true,
    get(this: Doc) {
      return this.pages[this.page].objs;
    },
    set(this: Doc, v: Obj[]) {
      this.pages[this.page].objs = v;
    },
  });
  return d as unknown as Doc;
}

/** Objekte aller Seiten (oberste Ebene) */
export const allObjs = (doc: Doc): Obj[] => doc.pages.flatMap((p) => p.objs);

// Farbpalette 00–29 plus T1/T2 (Werkzeug-Layer), angelehnt an die gewohnte Reihenfolge.
export const PALETTE: string[] = [
  '#000000', '#0000ff', '#ff0000', '#00c000', '#c0c000', '#ff8000', '#00c0c0', '#ff00ff',
  '#a0a0a0', '#0000a0', '#a00000', '#00a000', '#a0a000', '#c08000', '#00a0ff', '#a000a0',
  '#808080', '#7d87b9', '#bb7784', '#4a6fe3', '#d33f6a', '#8cd78c', '#f0b98d', '#f6c4e1',
  '#fa9ed4', '#500a78', '#b45a00', '#004754', '#86fa88', '#e0c040', '#f36926', '#0c96d9',
];

export const layerLabel = (i: number) => (i >= 30 ? `T${i - 29}` : String(i).padStart(2, '0'));

export function defaultLayer(index: number): Layer {
  return {
    ...defaultCutSettings(index === 0 ? 'fill' : 'line'),
    index,
    name: `C${layerLabel(index)}`,
    output: index < 30,
    show: true,
  };
}

let nextId = 1;
export const newId = () => nextId++;
export function bumpIds(objs: Obj[]) {
  const walk = (o: Obj) => {
    nextId = Math.max(nextId, o.id + 1);
    if (o.shape.kind === 'group') o.shape.children.forEach(walk);
  };
  objs.forEach(walk);
}

export function newDoc(): Doc {
  return loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: pageName(0), objs: [] }], page: 0, layers: {} });
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Kennung einer neuen Baugruppe (Teile eines Generators, die gemeinsam neu berechnet werden) */
export const newAsmId = () => Math.random().toString(36).slice(2, 10);

/** Tiefe Kopie mit neuen IDs. */
export function cloneObj(o: Obj): Obj {
  return cloneObjs([o])[0];
}

/**
 * Objekte gemeinsam kopieren (neue IDs). Text auf Pfad, dessen Form mitkopiert wird, folgt der Kopie der Form;
 * fehlt die Form, verliert die Kopie die Verknüpfung und behält nur die Kurve.
 */
export function cloneObjs(objs: Obj[]): Obj[] {
  const ids = new Map<number, number>();
  const asms = new Map<string, string>();
  const texts: TextShape[] = [];
  const mated: Obj[] = [];
  const re = (x: Obj) => {
    const id = newId();
    ids.set(x.id, id);
    x.id = id;
    if (x.shape.kind === 'group') x.shape.children.forEach(re);
    // Kopierte Teile einer Baugruppe bilden eine eigene Baugruppe
    if (x.shape.kind === 'gen' && x.shape.asm) {
      if (!asms.has(x.shape.asm)) asms.set(x.shape.asm, newAsmId());
      x.shape.asm = asms.get(x.shape.asm);
    }
    if (x.shape.kind === 'path' && x.shape.mark) {
      const [a, part] = x.shape.mark.split('/');
      if (!asms.has(a)) asms.set(a, newAsmId());
      x.shape.mark = `${asms.get(a)}/${part}`;
    }
    if (x.shape.kind === 'text' && x.shape.path?.link !== undefined) texts.push(x.shape);
    if (x.mates) mated.push(x);
  };
  const out = objs.map((o) => {
    const c = clone(o);
    re(c);
    return c;
  });
  for (const s of texts) {
    const link = ids.get(s.path!.link!);
    if (link !== undefined) s.path!.link = link;
    else delete s.path!.link;
  }
  // Verbindungen bleiben nur zwischen mitkopierten Teilen erhalten
  for (const x of mated) {
    x.mates = x.mates!.filter((m) => ids.has(m.to)).map((m) => ({ ...m, to: ids.get(m.to)! }));
    if (!x.mates.length) delete x.mates;
  }
  return out;
}

/** Alle Blatt-Objekte samt Welt-Matrix. */
export function* leaves(objs: Obj[], parent: Mat = IDENT): Generator<[Obj, Mat]> {
  for (const o of objs) {
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') yield* leaves(o.shape.children, m);
    else yield [o, m];
  }
}

/** Wie leaves(), aber ohne ausgeblendete Objekte (samt dem Inhalt ausgeblendeter Gruppen). */
export function* visibleLeaves(objs: Obj[], parent: Mat = IDENT): Generator<[Obj, Mat]> {
  for (const o of objs) {
    if (isOff(o)) continue;
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') yield* visibleLeaves(o.shape.children, m);
    else yield [o, m];
  }
}

/** Like visibleLeaves(), but also without objects excluded from output (noLaser, including group contents). */
export function* laserLeaves(objs: Obj[], parent: Mat = IDENT): Generator<[Obj, Mat]> {
  for (const o of objs) {
    if (isOff(o) || o.noLaser) continue;
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') yield* laserLeaves(o.shape.children, m);
    else yield [o, m];
  }
}

/** Leaves that are not lasered because they or a group above them are marked noLaser */
export function noLaserLeaves(objs: Obj[], out = new Set<Obj>(), off = false): Set<Obj> {
  for (const o of objs) {
    const here = off || !!o.noLaser;
    if (o.shape.kind === 'group') noLaserLeaves(o.shape.children, out, here);
    else if (here) out.add(o);
  }
  return out;
}

/** Layer, unter dem ein Objekt im Objekte-Fenster steht: bei Gruppen der Layer des ersten Teils */
export function homeLayer(o: Obj): number {
  if (o.shape.kind !== 'group') return o.layer;
  for (const [l] of leaves([o])) return l.layer;
  return o.layer;
}

export function setLayerDeep(o: Obj, layer: number) {
  o.layer = layer;
  if (o.shape.kind === 'group') o.shape.children.forEach((c) => setLayerDeep(c, layer));
}
