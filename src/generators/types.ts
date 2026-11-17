// Gemeinsame Schnittstelle aller Generatoren (Zahnrad, später Box, Zahnstange …).
// Ein Generator ist eine reine Funktion von Parametern auf Geometrie: kein Zugriff auf Editor, DOM oder Maschine.
// Damit lässt er sich testen, über MCP aufrufen und später auch als Community-Generator laden.
import type { Pt, SubPath } from '../model';
import type { AsmPoses } from './pose';
import type { GenHost, GenInputs, GenPanel } from './host';

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
  | (SpecBase & { type: 'data'; def: string });

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
  /** Values the dialog shows that depend on the parameters: suggestions for empty text fields (by key) */
  view?(p: Params): { autoText?: Record<string, string> };
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
  /** Parameters for a new object from the declared inputs (e.g. workpiece outlines from the selection) */
  fromInputs?(inputs: GenInputs): Params | undefined;
  /**
   * Generators that compute elsewhere (plugins in a Worker) compute these parameters here; until it resolves,
   * validate() reports „being computed“. Built-in generators compute synchronously and leave it out.
   */
  prepare?(p: Params): Promise<void>;
  /** Name of the extension that provides the generator; saved with its parts (GenShape.ext) for when it is missing */
  ext?: string;
  /** Extra area in the dialog; it reads the app only through the host and writes only parameters */
  panel?(p: Params, set: (patch: Params) => void, host?: GenHost): GenPanel;
}
