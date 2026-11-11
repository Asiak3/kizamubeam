// Editor: gemeinsame Typen, Konstanten und Hilfsfunktionen der Editor-Teile.
import { Mat, Node, Obj, Pt, Shape } from '../model';
import { Box, worldPath } from '../geom';
import { SnapSet } from '../snap';
import { t } from '../i18n';

export type Tool = 'freehand-edit' | 'lasso' | 'select' | 'node' | 'line' | 'pencil' | 'rect' | 'ellipse' | 'polygon' | 'text' | 'joint' | 'trim' | 'start' | 'relate' | 'measure' | 'sketch';

export const RULER = 22; // px

/** Farben der Arbeitsfläche je Design */
export const CANVAS_THEMES = {
  light: {
    outside: '#c9ccd2', bed: '#ffffff', grid1: '#f2f2f2', grid10: '#e0e0e0', grid100: '#c4c4c4', border: '#30343a',
    sel: '#3070ff', handleFill: '#ffffff', nodeLine: '#8090a0',
    ruler: '#eceef1', rulerLine: '#a8adb5', rulerText: '#4a5058', rulerCorner: '#d6d9de',
    label: 'rgba(30,40,60,0.85)', labelText: '#ffffff', guide: '#00a3d9',
  },
  dark: {
    outside: '#15171b', bed: '#24272d', grid1: '#2a2e34', grid10: '#343940', grid100: '#4a5059', border: '#8a929c',
    sel: '#5b93f5', handleFill: '#24272d', nodeLine: '#7d8894',
    ruler: '#24282e', rulerLine: '#3a4049', rulerText: '#a3abb5', rulerCorner: '#2e333a',
    label: 'rgba(230,235,245,0.92)', labelText: '#1b1e23', guide: '#3cc0ee',
  },
};
export const HANDLE_OFF = 9; // Abstand der Griffe vom Auswahlrahmen in px

export type Drag =
  | import('./freehand').FreehandStroke
  | {type:'lasso';points:Pt[];pointerId:number;components:boolean;overflow:boolean;doc:import('../model').Doc;base:Obj[];nodeBase:Map<Obj,Set<string>>;handleBase:Map<Obj,Set<string>>;mode:'set'|'add'|'remove'|'toggle'}
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
  /** Right button held with right-drag panning on: a click until it moves OVERLAP_MOVE_PX, then a pan.
   * context: the browser already sent contextmenu while held (WebKit does on press) */
  | { type: 'right'; pointerId: number; sx: number; sy: number; ox: number; oy: number; panning: boolean; context: boolean }
  | {
      type: 'move'; start: Pt; orig: Mat[]; moved: boolean; toggleRotate: boolean; sx: number; sy: number;
      /** Fangpunkt der Auswahl, an dem gegriffen wurde (sonst null: Ecken und Mitte der Auswahl fangen) */
      anchor: Pt | null; box: Box; snapSet: SnapSet;
    }
  | { type: 'scale'; handle: number; box: Box; orig: Mat[] }
  | { type: 'rotate'; center: Pt; a0: number; orig: Mat[]; angle: number }
  | { type: 'pivot' }
  | { type: 'marquee'; start: Pt; end: Pt; base: Obj[]; mode: 'set' | 'add' | 'toggle' | 'remove' }
  | { type: 'create'; start: Pt; obj: Obj | null; snapSet: SnapSet }
  | { type: 'linenode'; node: Node }
  | { type: 'pencil'; points: Pt[]; pointerId: number; overflow: boolean }
  /** Textwerkzeug: Klicken setzt einen Text, Ziehen einen Textrahmen */
  | { type: 'textframe'; start: Pt; end: Pt }
  /**
   * Hilfslinie aus dem Lineal ziehen oder verschieben: 'y' = waagrecht (oberes Lineal), 'x' = senkrecht (linkes Lineal).
   * idx: Index in doc.guides (null, solange eine neue noch im Lineal ist); orig: alte Lage einer verschobenen Linie
   */
  | { type: 'guide'; axis: 'x' | 'y'; idx: number | null; orig: number | null; moved: boolean; snapSet: SnapSet }
  | {
      type: 'node'; obj: Obj; sub: number; idx: number; which: 'p' | 'cin' | 'cout'; start: Pt; orig: Node; moved: boolean;
      /** Gezogener Punkt in Weltkoordinaten zu Beginn und Fangpunkte ohne die bewegten Knoten */
      origWorld: Pt; snapSet: SnapSet;
      /** Beim Ziehen eines Knotens: alle ausgewählten Knoten mit Ausgangslage */
      group: { obj: Obj; sub: number; idx: number; orig: Node }[];
      shapes: { obj: Obj; shape: Shape }[];
      redo: import('../history').HistoryEntry[];
      handles: {obj:Obj;sub:number;idx:number;which:'cin'|'cout';orig:Node}[];
    }
  | { type: 'nodebox'; start: Pt; end: Pt; obj: Obj; base: Map<Obj, Set<string>>; mode: 'set' | 'add' | 'toggle'; onTarget: boolean };

export interface NodeHover {
  obj?: Obj;
  sub: number;
  idx: number;
  which: 'p' | 'cin' | 'cout';
}
export interface SegHover {
  obj?: Obj;
  sub: number;
  seg: number;
  t: number;
}

/** Fangabstand in Pixeln; mit Alt größer (wie LightBurn) */
export const SNAP_PX = 8;

export const worldCache = new WeakMap<Obj, { m: Mat; shape: Shape; path: Path2D; ver: number }>();
export const shapeVersions = new WeakMap<Shape, number>();
/** Nach direkten Formänderungen erhöhen, damit Weltpfade neu gebaut werden. */
export function bumpShapeVersion(s: Shape) {
  shapeVersions.set(s, (shapeVersions.get(s) ?? 0) + 1);
}
export function cachedWorldPath(o: Obj, m: Mat): Path2D {
  const c = worldCache.get(o);
  if (c && c.shape === o.shape && c.ver === (shapeVersions.get(o.shape) ?? 0) && c.m.every((v, i) => v === m[i])) return c.path;
  const path = worldPath(o.shape, m);
  worldCache.set(o, { m, shape: o.shape, path, ver: shapeVersions.get(o.shape) ?? 0 });
  return path;
}

/** Farbe für Fangpunkte und Ausrichtungshilfen (auf hellem und dunklem Grund gut sichtbar) */
export const SNAP_COLOR = '#e0218a';

/** Hinweise des Scharnier-Generators (Werkzeug „Verbindung“ mit der Art „Scharnier für Deckel“) */
export const HINGE_HINT_FIRST = t('Scharnier: Oberkante der Rückwand anklicken (bekommt die Kasten-Knöchel). Esc hebt die Wahl auf.');
export const HINGE_HINT_SECOND = t('Scharnier: jetzt die Hinterkante des Deckels anklicken. Erneuter Klick hebt die Wahl auf.');

export const TOOL_HINTS: Record<Tool, string> = {
  'freehand-edit': t('Freihand: am Endknoten fortsetzen oder zwischen vorhandenen Knoten neu zeichnen. Esc bricht ab.'),
  lasso:t('Lasso: Objekte vollständig umschließen. Shift ergänzt, Ctrl schaltet um, Shift+Ctrl entfernt. Esc bricht ab.'),
  select: t('Drehen: knapp außerhalb einer Ecke ziehen oder Auswahl nochmals anklicken. Rahmen nach rechts: umschließend, nach links: kreuzend.'),
  node: t('Klick/Rahmen wählt Knoten, Shift ergänzt. Entf löschen, L Gerade, C Kurve, E Ecke, S glatt, I einfügen (oder Doppelklick auf Kante), B aufbrechen, T trimmen.'),
  line: t('Klicken für Ecken, Ziehen für Kurven. Startpunkt anklicken schließt, Doppelklick/Enter/Rechtsklick beendet.'),
  rect: t('Ziehen zum Zeichnen. Shift: Quadrat, Ctrl: von der Mitte.'),
  ellipse: t('Ziehen zum Zeichnen. Shift: Kreis, Ctrl: von der Mitte.'),
  polygon: t('Von der Mitte aus ziehen. Shift: nicht drehen.'),
  text: t('Klicken, um Text zu setzen, Ziehen für einen Textrahmen mit Zeilenumbruch, oder vorhandenen Text anklicken.'),
  joint: t('Verbindung: erste gerade Kante anklicken (Zinken, Zapfen oder Schlitze). Esc hebt die Wahl auf.'),
  trim: t('Trimmen: Abschnitt bis zu den nächsten Schnittpunkten anklicken (rot) zum Entfernen. Shift: Stück auf aktuellem Layer behalten, Ctrl: nicht verbinden.'),
  start: t('Startpunkt: Knoten oder Kante anklicken, dort beginnt der Schnitt (auf einer Kante geschlossener Konturen entsteht ein neuer Knoten). Shift+Klick: Richtung umkehren, Ctrl+Klick: zurücksetzen (Optimierung wählt).'),
  relate: t('Beziehung: zuerst das Element anklicken, das stehen bleibt, dann das Element des Objekts, das sich anpasst.'),
  pencil: t('Ziehen zeichnet einen angepassten Bézierpfad. Loslassen: übernehmen; Esc: abbrechen. Toleranz und Schließen in den Werkzeugoptionen einstellen.'),
  sketch: '',
  measure: t('Messen: Anfang und Ende anklicken (mit Fang). Über einem Kreis erscheinen Radius und Durchmesser. Esc löscht die Messung.'),
};

