// Gemeinsame Schnittstelle aller Generatoren (Zahnrad, später Box, Zahnstange …).
// Ein Generator ist eine reine Funktion von Parametern auf Geometrie: kein Zugriff auf Editor, DOM oder Maschine.
// Damit lässt er sich testen, über MCP aufrufen und später auch als Community-Generator laden.
import type { Pt, SubPath } from '../model';
import type { AsmPoses } from './pose';
import type { GenInputs, GenSelected } from './host';

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

/**
 * Condition on parameter values, evaluated by the app (same small language as the plugin dialogs in #335):
 * comparisons take [key, value]; and/or/not combine rules. No generator code runs for visibility.
 */
export type Rule =
  | { eq: [string, ParamValue] }
  | { ne: [string, ParamValue] }
  | { lt: [string, number] }
  | { le: [string, number] }
  | { gt: [string, number] }
  | { ge: [string, number] }
  | { in: [string, ParamValue[]] }
  | { and: Rule[] }
  | { or: Rule[] }
  | { not: Rule };

interface SpecBase {
  key: string;
  label: string;
  /** Erklärung als Tooltip im Dialog und als Beschreibung für KI-Agenten */
  title?: string;
  /** Abschnitt im Dialog: Hauptfelder oder eingeklappt unter „Erweitert“ */
  advanced?: boolean;
  /**
   * Named section of the dialog (its heading, already translated); fields with the same section are shown
   * together below the main fields, in the order of their first field. advanced wins over section.
   */
  section?: string;
  /** New objects always start with def instead of the last-used value (layout choices of saved objects) */
  resetOnNew?: boolean;
  /** Feld nur zeigen (und beachten), wenn diese Bedingung gilt */
  showIf?: Rule;
}

export type ParamSpec =
  | (SpecBase & {
      /** length = mm, angle = Grad, int = ganze Zahl, number = Faktor ohne Einheit */
      type: 'length' | 'angle' | 'int' | 'number';
      min: number;
      max: number;
      def: number;
    })
  | (SpecBase & { type: 'enum'; options: [string, string][]; def: string })
  | (SpecBase & { type: 'bool'; def: boolean })
  /** Text für frei editierbare Generatorparameter. */
  /** Empty text fields show the suggestion from Generator.view().autoText */
  | (SpecBase & { type: 'text'; def: string })
  /** Text, der nicht im Dialog erscheint (z. B. Kennung eines eingelesenen 3D-Modells) */
  /**
   * resource: the value is the id of data the app keeps (a 3D model, or an image kept with the project); plugins get
   * that data before they compute
   */
  | (SpecBase & { type: 'data'; def: string; resource?: 'model3d' | 'image' });

export interface Issue {
  /** Betroffenes Feld (fehlt bei Problemen, die mehrere Felder betreffen) */
  key?: string;
  /** error sperrt Erzeugen, warn nicht */
  level: 'error' | 'warn';
  msg: string;
  /** Stable code of the problem (key into Generator.texts), so tools and plugins can tell issues apart */
  code?: string;
}

/** Ein erzeugtes Teil. Bauteil-Generatoren liefern genau eines, Baugruppen mehrere. */
export interface GenPart {
  /** Stabiler Schlüssel innerhalb der Baugruppe (z. B. 'front'); bleibt gleich, wenn sich Parameter ändern */
  key: string;
  /**
   * Konturen in lokalen Koordinaten (mm, y nach unten, Mitte des Teils im Ursprung), als Bézierkurven.
   * Innere Löcher und Schlitze gehören als weitere Unterpfade in diese Liste, nicht in eigene Teile oder in
   * `marks`, damit sie mit dem Teil geschnitten, verschoben und neu berechnet werden (Muster: box-divided).
   */
  subs: SubPath[];
  /** Vorschlag für die Lage der Teilmitte beim ersten Anlegen (Koordinaten der Baugruppe, mm) */
  at: Pt;
  /**
   * Gravur auf dem Teil (lokale Koordinaten wie subs), z. B. die Teilnummer als Strichschrift. Der Editor legt sie
   * als eigenes Objekt auf einen Beschriftungs-Layer und gruppiert sie mit dem Teil.
   */
  marks?: SubPath[];
  /**
   * Page group (#387): parts with the same number go on the same page; 0 (or none) is the page the user inserts on,
   * every further number gets new pages behind it. at is then relative to the other parts of the group.
   */
  page?: number;
}

/** Spread the parts over as many pages as the work area needs (#387), with the app's nesting */
export interface GenDistribute {
  /** Parts may be turned by 90°, 180° and 270° (off: keep the grain direction) */
  rotate: boolean;
}

/** Bauplan für eine eigene Seite (mm, y nach unten): Zeichnung, Beschriftungen und Arbeitsschritte */
export interface PlanSheet {
  title: string;
  lines: Pt[][];
  labels: { x: number; y: number; text: string; size: number }[];
  steps: string[];
}

export interface GenResult {
  parts: GenPart[];
  /** Kennwerte für den Dialog (z. B. Teilkreis- und Kopfkreisdurchmesser) */
  info: [string, string][];
  /** Bauplan (nur Baugruppen, die einen anbieten); der Editor legt ihn beim Erstellen auf eine eigene Seite */
  plan?: PlanSheet;
  /** Spread the parts over pages instead of placing the arrangement as one block (#387); page groups stay apart */
  distribute?: GenDistribute;
}

/** Toolbox tile and toolbar action of a generator (texts as German source strings, translated by the given t) */
export interface GenTile {
  /** Toolbox group (AppGroup in apps.ts) */
  group: string;
  /** Place the tile before this tile of the same group; without it the tile goes to the end of the group */
  before?: string;
  /** Version that added the generator (marks the tile as new) */
  since?: string;
  text(t: (s: string) => string): {
    /** Name under the tile */
    name: string;
    /** One sentence for the tooltip */
    desc: string;
    /** More search words, separated by spaces */
    keys: string;
    /** Tooltip of the toolbar/menu action */
    action: string;
  };
}

/** An editable column of a dialog list; values are checked like fields (range, options, length) */
export type GenColumn = { key: string; label: string; title?: string } & (
  /** placeholder: shown in an empty field, {n} = row number */
  | { type: 'text'; max?: number; placeholder?: string }
  /** placeholder: shown instead of 0 (e.g. „auto“ where 0 means automatic) */
  | { type: 'int' | 'number' | 'length'; min: number; max: number; placeholder?: string }
  | { type: 'enum'; options: [string | number, string][] }
  /** A colour "#rrggbb", shown as a swatch; editable with a colour picker unless readonly (#211 stage 7) */
  | { type: 'color'; readonly?: boolean }
);

/**
 * A list in the dialog (#335 stage 3): its rows are a JSON array in a data parameter. The app draws the rows,
 * their fields, a thumbnail of the row's outline and the row actions; the generator only reads the parameter.
 */
export interface GenList {
  /** Data parameter that holds the rows */
  param: string;
  label: string;
  /** Shown when there are no rows */
  empty?: string;
  columns: GenColumn[];
  /** Row key holding sub-paths (mm): drawn as a small picture; `rotate` names a column with a turn in degrees */
  shape?: { key: string; rotate?: string };
  /** Rows can be removed */
  remove?: boolean;
  /** Tooltip of the remove button */
  removeTitle?: string;
  /** Rows can be selected by clicking them (the generator sees the selected row in its surface and actions) */
  select?: boolean;
  /** Buttons on every row; a click calls onEvent with the action id and the row number */
  rowActions?: { id: string; label: string; title?: string }[];
  /** Rows can be reordered by dragging their handle or with Alt+↑/↓ (#211 stage 7) */
  sort?: boolean;
  /** With sort: this many rows at the end stay where they are (e.g. the back plate) */
  fixedLast?: number;
}

/**
 * A step of the dialog (#211 stage 7): the dialog shows numbered tabs, one step at a time. `items` names the
 * fields (parameter keys), lists (their parameter), action buttons (their id) and "surface" it shows; anything
 * no step names is shown below the steps. The preview, info and issues are always visible.
 */
export interface GenStep {
  id: string;
  label: string;
  items: string[];
}

/**
 * What an action asks the app for: the selected objects, an image file the user picks (the dialog opens a file
 * picker first) or the calibrated camera image (the button is hidden while there is none)
 */
export type GenActionInput = 'selection' | 'image' | 'selectedImage' | 'camera';

/** A button in the dialog that sends an event to the generator (onEvent) with the inputs it declares */
export interface GenAction {
  id: string;
  label: string;
  title?: string;
  inputs?: GenActionInput[];
  /** A number parameter shown next to the button instead of among the fields (e.g. the real width of an image) */
  field?: string;
  /** Show the button only while this condition holds */
  showIf?: Rule;
  /**
   * A data parameter with resource "image": the picked or selected image is kept with the project and its id goes
   * into this parameter (before onEvent), so the generator can compute from it again later
   */
  store?: string;
}

/** An RGBA image, at most 1200 pixels on its longer side */
export interface GenImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Data an action hands to Generator.onEvent */
export interface GenEvent {
  action: string;
  /** Row of the list whose row action was clicked */
  row?: number;
  /** The surface as it is now (dialogs with a surface) */
  surface?: GenSurfaceState;
  inputs: {
    selection?: GenSelected[];
    /** The picked image file (or the selected image of the drawing) and its name without extension */
    image?: GenImage & { name: string };
    /** The camera image in bed size (it covers 0 … bed.w × 0 … bed.h mm) and the photo of the empty bed, if taken */
    camera?: GenImage & { bed: { w: number; h: number }; empty?: GenImage };
  };
}

/** Answer of onEvent: parameters to change, and a short message for the dialog; surface changes as in onSurface */
export interface GenEventResult extends GenSurfaceChange {
  patch?: Params;
  message?: string;
}

/**
 * A drawing surface in the dialog (#335 stage 4). The generator describes what to draw as a list of shapes
 * (draw) and answers pointer events (onSurface); the app does the drawing, hit testing and scaling. Coordinates
 * are mm in the view (y down).
 */
export interface GenSurface {
  /** Tabs above the surface (e.g. front, side, top); the chosen id goes to draw and onSurface */
  views: { id: string; label: string }[];
  /** Height in CSS pixels; the width follows the dialog */
  height?: number;
  /** Help line under the surface */
  help?: string;
}

export type GenStyle = 'normal' | 'muted' | 'accent' | 'warn';

/** A shape on the surface. Handles and lines with an id can be hit by the pointer (topmost first, handles before lines) */
export type GenItem =
  | { type: 'line'; pts: [number, number][]; closed?: boolean; style?: GenStyle; width?: number; dash?: boolean; alpha?: number; id?: string }
  | { type: 'handle'; x: number; y: number; id: string; style?: GenStyle; size?: number }
  | { type: 'text'; x: number; y: number; text: string; style?: GenStyle };

/**
 * A layer that rarely changes (the silhouette of a model, the outlines of the parts): the app keeps it as a
 * picture by key, and asks without it next time (GenDrawRequest.have), so the generator leaves out its content
 */
export interface GenLayer {
  key: string;
  /** Filled triangles as a flat list x0, y0, x1, y1, x2, y2, … */
  tris?: number[];
  /**
   * A region map (#211 stage 7): `width` × `height` cells over the rectangle `frame` (mm in the view), one byte
   * per cell, row by row from the top left: 0 = no region, n = region n − 1. Each region is filled with its colour
   * from `colors`; a click on a region reports `hit: "<layer key>:<region>"` (after handles and lines).
   */
  regions?: { frame: { x0: number; y0: number; x1: number; y1: number }; width: number; height: number; data: Uint8Array | Uint8ClampedArray; colors: string[] };
  items?: GenItem[];
  /** Opacity of the triangles */
  alpha?: number;
}

export interface GenDrawing {
  /** Area of the view (mm) that is fitted into the surface */
  frame: { x0: number; y0: number; x1: number; y1: number };
  layers?: GenLayer[];
  items: GenItem[];
  /** Pointer moves are sent even without a pressed button (e.g. while a line is being drawn) */
  track?: boolean;
}

/** What the surface shows now: the view, free data of the generator (kept by the app) and the selected rows */
export interface GenSurfaceState {
  view: string;
  /** JSON the generator keeps between events (e.g. a line being drawn); null at first */
  state: unknown;
  /** Selected row by list parameter (-1 = none) */
  selected: Record<string, number>;
}

export interface GenDrawRequest extends GenSurfaceState {
  /** Keys of the layers the app already has */
  have: string[];
  /** Size of the surface in screen pixels (it grows with the dialog; draw is asked again when it changes) */
  size?: { width: number; height: number };
}

/** A pointer or key event on the surface, in mm of the view */
export interface GenPointer {
  type: 'down' | 'move' | 'up' | 'dblclick' | 'context' | 'key' | 'select';
  x: number;
  y: number;
  /** Id of the handle or line under the pointer (down, dblclick, context) */
  hit?: string;
  /** Where the button was pressed (move with the button held, up) */
  from?: { x: number; y: number };
  /** A move with the button held */
  drag?: boolean;
  /** key: Enter, Escape, Delete, Backspace */
  key?: string;
  /** select: the list and row that was clicked */
  list?: string;
  row?: number;
  /** Modifier keys held during the event (only present when held): Shift, Alt (Option), Ctrl (Cmd on macOS) */
  shift?: true;
  alt?: true;
  ctrl?: true;
}

/** Changes of the surface an answer may ask for */
export interface GenSurfaceChange {
  /** New free data (null clears it) */
  state?: unknown;
  view?: string;
  select?: Record<string, number>;
}

export interface GenSurfaceResult extends GenSurfaceChange {
  patch?: Params;
  message?: string;
}

/** What a generator needs before its dialog opens */
export type GenInput =
  /** A 3D model (STL, OBJ) picked by the user; offered when a model is imported, see GenInputs.model */
  | { kind: 'model3d' }
  /** The current selection (top-level objects as outlines); Generator.fromInputs turns it into parameters */
  | { kind: 'selection' };

/**
 * Question the app asks the user after a change (the only way a generator can ask anything, #335).
 * Each option applies its patch; cancelling restores the value before the change.
 */
/** A question the dialog shows inside itself (#335): up to three options, each with a patch; Cancel keeps the previous value */
export interface GenAsk {
  question: string;
  options: { label: string; patch: Params }[];
}

/** Values the dialog shows that depend on the parameters */
export interface GenView {
  /** Suggestions for empty text fields, by key */
  autoText?: Record<string, string>;
  /** A short text per row of a list (e.g. its size), by list parameter */
  rows?: Record<string, string[]>;
  /** Suggestion per row for its empty first text cell (shown as its placeholder), by list parameter */
  rowAuto?: Record<string, string[]>;
}

/** Answer of Generator.onChange: parameters to change as well, or a question first */
export interface GenChange {
  patch?: Params;
  ask?: GenAsk;
}

export interface Generator {
  id: string;
  /** Wird erhöht, wenn sich Parameter ändern; migrate() bringt ältere Parameter auf den Stand */
  version: number;
  /** part = ein Bauteil, assembly = Baugruppe aus mehreren Teilen */
  kind: 'part' | 'assembly';
  name: string;
  icon: string;
  schema: ParamSpec[];
  /** Prüft die (bereits normalisierten) Parameter */
  validate(p: Params): Issue[];
  /** Erzeugt die Geometrie; wird nur aufgerufen, wenn validate() keinen Fehler meldet */
  generate(p: Params): GenResult;
  /** Kurzer Name für das Objekte-Fenster, z. B. „Zahnrad z=24 m=2“; bei Baugruppen mit dem Schlüssel des Teils */
  label(p: Params, part?: string): string;
  migrate?(p: Params, from: number): Params;
  /**
   * Like migrate, for generators that compute elsewhere (plugins in a Worker): loadGen starts it when a file is
   * read, and genReady() waits for it before the parameters are edited
   */
  upgrade?(p: Params, from: number): Promise<Params>;
  /** Values the dialog shows that depend on the parameters: suggestions for empty text fields (by key) */
  view?(p: Params): GenView;
  /**
   * Called when the user commits a field (number fields on leaving them, choices at once) with its previous value.
   * The returned patch is checked against the schema like user input. Plugins answer asynchronously (a Promise);
   * the dialog applies the answer only if the field still has the committed value.
   */
  onChange?(key: string, old: ParamValue, p: Params): GenChange | void | Promise<GenChange | void>;
  /** Preview in the dialog: center = centre the parts' bounding box instead of the assembly origin */
  preview?: { center?: boolean };
  /** Texts for issue codes that generate() may throw (Error.message = code); buildGen translates them */
  texts?: Record<string, () => string>;
  /** Plug-in joints: kind of fit and the parameter that holds the play (design check, material calibration) */
  fit?: { kind: 'pair' | 'slot'; play: string };
  /** Position of every part in space (3D view, assembly check); th = material thickness of the view as fallback */
  poses?(p: Params, th: number): AsmPoses | null;
  /** The parts form one connected assembly that the assembly check examines */
  assemblyCheck?: boolean;
  /** Toolbox tile and action; generators without one are only reachable through files, MCP and code */
  tile?: GenTile;
  inputs?: GenInput[];
  /** Parameters for a new object from the declared inputs (e.g. workpiece outlines from the selection); plugins answer later */
  fromInputs?(inputs: GenInputs): Params | undefined | Promise<Params | undefined>;
  /**
   * Generators that compute elsewhere (plugins in a Worker) compute these parameters here; until it resolves,
   * validate() reports „being computed“. Built-in generators compute synchronously and leave it out.
   */
  prepare?(p: Params): Promise<void>;
  /** Name of the extension that provides the generator; saved with its parts (GenShape.ext) for when it is missing */
  ext?: string;
  /** Lists in the dialog, each bound to a data parameter (#335 stage 3) */
  lists?: GenList[];
  /** The dialog in numbered steps (#211 stage 7) */
  steps?: GenStep[];
  /** Buttons in the dialog; a click calls onEvent with the declared inputs */
  actions?: GenAction[];
  /** An action was clicked; plugins answer asynchronously */
  onEvent?(ev: GenEvent, p: Params): GenEventResult | void | Promise<GenEventResult | void>;
  /** Stop computing (plugins in a Worker); the parameters then report „cancelled“ until recompute() */
  cancel?(): void;
  /** Compute these parameters again (after a cancelled or failed run) */
  recompute?(p: Params): void;
  /** The dialog opened or closed (#211 sessions): plugins may keep expensive work for the dialog's lifetime */
  openSession?(p: Params): void;
  closeSession?(): void;
  /** A drawing surface in the dialog (#335 stage 4) */
  surface?: GenSurface;
  /** What the surface shows for these parameters */
  draw?(req: GenDrawRequest, p: Params): GenDrawing | Promise<GenDrawing>;
  /** A pointer or key event on the surface, or a row selected in a list */
  onSurface?(ev: GenPointer, s: GenSurfaceState, p: Params): GenSurfaceResult | void | Promise<GenSurfaceResult | void>;
}
