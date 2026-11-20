// Editor: Werkzeug-Optionen, Text-Defaults und Auswahlverhalten merken.
// Die Felder liegen in der Editor-Klasse; dieses Teil-Modul bündelt Laden und
// Speichern, damit die Einstellungen nur über die Setter der Funktion schreiben.
import type { Editor } from '../editor';
import type { ArcMode } from './arc';
import type { TextShape } from '../model';

const TOOL_OPTIONS_KEY = 'kizamubeam.toolOptions';
const REMEMBER_KEY = 'kizamubeam.rememberToolOptions';
const TEXT_DEFAULTS_KEY = 'kizamubeam.textDefaults';
const SELECT_AFTER_DRAW_KEY = 'kizamubeam.selectAfterDraw';

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Werkzeugschalter nur merken, wenn ausdrücklich eingeschaltet (Default: flüchtig wie bisher) */
export function loadRememberToolOptions(): boolean {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? 'false') === true;
  } catch {
    return false;
  }
}

/** Nach dem Zeichnen zur Auswahl wechseln (Default: an, wie bisher) */
export function loadSelectAfterDraw(): boolean {
  try {
    const raw = localStorage.getItem(SELECT_AFTER_DRAW_KEY);
    return raw === null ? true : JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

export class EditorToolOptions {
  /** Gespeicherte Werkzeug-Optionen übernehmen (nur wenn Merken eingeschaltet) */
  loadToolOptions(this: Editor) {
    if (!this.rememberToolOptions) return;
    try {
      const st = JSON.parse(localStorage.getItem(TOOL_OPTIONS_KEY) ?? '{}');
      if (typeof st !== 'object' || st === null) return;
      this.polySides = Math.round(num(st.polySides, 3, 64, this.polySides));
      this.polyStar = bool(st.polyStar, this.polyStar);
      this.rectRadius = num(st.rectRadius, 0, 10000, this.rectRadius);
      this.pencilTolerance = num(st.pencilTolerance, 0.001, 100, this.pencilTolerance);
      this.pencilClosed = bool(st.pencilClosed, this.pencilClosed);
      if (st.arcMode === 'center' || st.arcMode === '3point') this.arcMode = st.arcMode as ArcMode;
      this.arcCw = bool(st.arcCw, this.arcCw);
      this.shaperRecognize = bool(st.shaperRecognize, this.shaperRecognize);
      this.shaperTolerance = num(st.shaperTolerance, 0.2, 20, this.shaperTolerance);
      this.shaperCloseGap = num(st.shaperCloseGap, 0.2, 20, this.shaperCloseGap);
      this.shaperSmoothing = num(st.shaperSmoothing, 0, 20, this.shaperSmoothing);
    } catch {
      /* Standardwerte */
    }
  }
  /** Aktuelle Werkzeug-Optionen speichern (nichts tun, wenn Merken aus ist) */
  saveToolOptions(this: Editor) {
    if (!this.rememberToolOptions) return;
    try {
      localStorage.setItem(
        TOOL_OPTIONS_KEY,
        JSON.stringify({
          polySides: this.polySides,
          polyStar: this.polyStar,
          rectRadius: this.rectRadius,
          pencilTolerance: this.pencilTolerance,
          pencilClosed: this.pencilClosed,
          arcMode: this.arcMode,
          arcCw: this.arcCw,
          shaperRecognize: this.shaperRecognize,
          shaperTolerance: this.shaperTolerance,
          shaperCloseGap: this.shaperCloseGap,
          shaperSmoothing: this.shaperSmoothing,
        }),
      );
    } catch {
      /* Speicher nicht verfügbar */
    }
  }
  /** Merken der Werkzeugschalter ein-/ausschalten (Edit → Settings → Maus und Tastatur) */
  setRememberToolOptions(this: Editor, on: boolean) {
    this.rememberToolOptions = on;
    try {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify(on));
    } catch {
      /* Speicher nicht verfügbar */
    }
    if (on) this.saveToolOptions();
  }
  /** Auswahlverhalten nach dem Zeichnen umschalten und merken */
  setSelectAfterDraw(this: Editor, on: boolean) {
    this.selectAfterDraw = on;
    try {
      localStorage.setItem(SELECT_AFTER_DRAW_KEY, JSON.stringify(on));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }
  /** Gespeicherte Text-Defaults übernehmen (immer, Default Arial/10 wie bisher) */
  loadTextDefaults(this: Editor) {
    try {
      const st = JSON.parse(localStorage.getItem(TEXT_DEFAULTS_KEY) ?? '{}');
      if (typeof st !== 'object' || st === null) return;
      const d = this.textDefaults;
      this.textDefaults = {
        ...d,
        font: typeof st.font === 'string' && st.font ? st.font : d.font,
        size: num(st.size, 1, 500, d.size),
        bold: bool(st.bold, d.bold),
        italic: bool(st.italic, d.italic),
        upper: bool(st.upper, d.upper),
        align: st.align === 'center' || st.align === 'right' ? st.align : 'left',
        hSpace: num(st.hSpace, -100, 100, d.hSpace),
        vSpace: num(st.vSpace, -100, 100, d.vSpace),
        rtl: bool(st.rtl, d.rtl ?? false),
      } satisfies Omit<TextShape, 'kind' | 'text'>;
    } catch {
      /* Standardwerte */
    }
  }
  /** Aktuelle Text-Defaults speichern (immer) */
  saveTextDefaults(this: Editor) {
    try {
      localStorage.setItem(TEXT_DEFAULTS_KEY, JSON.stringify(this.textDefaults));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }
}
