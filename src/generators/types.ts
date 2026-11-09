// Gemeinsame Schnittstelle aller Generatoren (Zahnrad, später Box, Zahnstange …).
// Ein Generator ist eine reine Funktion von Parametern auf Geometrie: kein Zugriff auf Editor, DOM oder Maschine.
// Damit lässt er sich testen, über MCP aufrufen und später auch als Community-Generator laden.
import type { Pt, SubPath } from '../model';

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

interface SpecBase {
  key: string;
  label: string;
  /** Erklärung als Tooltip im Dialog und als Beschreibung für KI-Agenten */
  title?: string;
  /** Abschnitt im Dialog: Hauptfelder oder eingeklappt unter „Erweitert“ */
  advanced?: boolean;
  /** Feld nur zeigen (und beachten), wenn diese Bedingung gilt */
  showIf?: (p: Params) => boolean;
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
  | (SpecBase & { type: 'text'; def: string; autoText?: (p: Params) => string })
  /** Text, der nicht im Dialog erscheint (z. B. Kennung eines eingelesenen 3D-Modells) */
  | (SpecBase & { type: 'data'; def: string });

export interface Issue {
  /** Betroffenes Feld (fehlt bei Problemen, die mehrere Felder betreffen) */
  key?: string;
  /** error sperrt Erzeugen, warn nicht */
  level: 'error' | 'warn';
  msg: string;
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
}
