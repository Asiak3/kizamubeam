// Hintergrundgitter der Arbeitsfläche: frei einstellbarer Linienabstand, Unterteilung, kräftige Linien,
// Farbe und Deckkraft; ein- und ausblendbar (Ansicht → Gitter). Gespeichert je Nutzer im localStorage
// („kizamubeam.grid“), nicht im Projekt. Rein rechnerisch, damit es ohne DOM testbar bleibt.

export interface GridSettings {
  /** Gitter zeigen */
  show: boolean;
  /** Abstand der Hauptlinien in mm */
  spacing: number;
  /** Feine Linien je Hauptabstand (1 = keine feinen Linien) */
  divisions: number;
  /** Jede n-te Hauptlinie kräftig (0 oder 1 = keine kräftigen Linien) */
  every: number;
  /** Linienfarbe als #rrggbb; leer = Farben des Designs (hell/dunkel) */
  color: string;
  /** Deckkraft in Prozent (5–100) */
  opacity: number;
}

/** Bisheriges Gitter: 1 mm fein, 10 mm Haupt-, 100 mm kräftige Linien */
export const DEFAULT_GRID: GridSettings = { show: true, spacing: 10, divisions: 10, every: 10, color: '', opacity: 100 };

export const GRID_KEY = 'kizamubeam.grid';

/** Kleinster Linienabstand auf dem Bildschirm in Pixeln; dichtere Stufen werden ausgelassen */
export const GRID_MIN_PX = 6;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Beliebige (auch alte oder kaputte) Werte in gültige Einstellungen umwandeln */
export function cleanGrid(raw: unknown): GridSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const spacing = num(r.spacing, DEFAULT_GRID.spacing);
  return {
    show: typeof r.show === 'boolean' ? r.show : DEFAULT_GRID.show,
    spacing: spacing > 0 ? clamp(spacing, 0.1, 1000) : DEFAULT_GRID.spacing,
    divisions: Math.round(clamp(num(r.divisions, DEFAULT_GRID.divisions), 1, 50)),
    every: Math.round(clamp(num(r.every, DEFAULT_GRID.every), 0, 50)),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : '',
    opacity: Math.round(clamp(num(r.opacity, DEFAULT_GRID.opacity), 5, 100)),
  };
}

export type GridLevel = 'fine' | 'major' | 'bold';

/** Linienstufen von fein nach kräftig mit ihrem Abstand in mm */
export function gridLevels(g: GridSettings): { level: GridLevel; step: number }[] {
  const out: { level: GridLevel; step: number }[] = [];
  if (g.divisions > 1) out.push({ level: 'fine', step: g.spacing / g.divisions });
  out.push({ level: 'major', step: g.spacing });
  if (g.every > 1) out.push({ level: 'bold', step: g.spacing * g.every });
  return out;
}

/** Feinster Linienabstand (mm), etwa als Fangraster */
export const finestStep = (g: GridSettings) => gridLevels(g)[0].step;

/**
 * Positionen der Gitterlinien einer Stufe zwischen a und b (mm), gezählt ab 0. Ganzzahlige Vielfache statt
 * aufaddierter Schritte, damit sich bei krummen Abständen keine Rundungsfehler sammeln. Höchstens `max` Linien.
 */
export function gridLines(step: number, a: number, b: number, max = 20000): number[] {
  if (!(step > 0) || b < a) return [];
  const i0 = Math.ceil(a / step - 1e-9),
    i1 = Math.floor(b / step + 1e-9);
  if (i1 - i0 + 1 > max) return [];
  const out: number[] = [];
  for (let i = i0; i <= i1; i++) out.push(i * step);
  return out;
}

/** Deckkraft einer Stufe bei eigener Farbe (die Designfarben haben die Abstufung schon eingebaut) */
export const LEVEL_ALPHA: Record<GridLevel, number> = { fine: 0.22, major: 0.5, bold: 0.85 };
