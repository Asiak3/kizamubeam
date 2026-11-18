// UI-Schriftgrößen: vier unabhängige semantische Gruppen mit festen Presets.
// 100 % entspricht jeweils den bisherigen Größen am betroffenen Element;
// das Modul kennt keine Pixelwerte, es liefert nur Gruppenfaktoren.
export type TypographyGroup = 'interface' | 'supporting' | 'technical' | 'workspace';
export type TypographyPreset = 80 | 100 | 125 | 150;
export type TypographyPreferences = Readonly<Record<TypographyGroup, TypographyPreset>>;

export interface ResolvedTypography {
  groups: TypographyPreferences;
  factors: Readonly<Record<TypographyGroup, number>>;
}

export const TYPOGRAPHY_GROUPS: readonly TypographyGroup[] = ['interface', 'supporting', 'technical', 'workspace'];

export const TYPOGRAPHY_KEY = 'kizamubeam.uiTypography';

const DEFAULTS: TypographyPreferences = { interface: 100, supporting: 100, technical: 100, workspace: 100 };

function isPreset(v: unknown): v is TypographyPreset {
  return typeof v === 'number' && (v === 80 || v === 100 || v === 125 || v === 150);
}

function isGroup(v: unknown): v is TypographyGroup {
  return v === 'interface' || v === 'supporting' || v === 'technical' || v === 'workspace';
}

/** Normalisiert unbekannte Eingaben: ungültiges einzelnes Feld fällt auf 100 zurück, gültige bleiben. */
export function normalizeTypography(raw: unknown): TypographyPreferences {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    interface: isPreset(src.interface) ? src.interface : 100,
    supporting: isPreset(src.supporting) ? src.supporting : 100,
    technical: isPreset(src.technical) ? src.technical : 100,
    workspace: isPreset(src.workspace) ? src.workspace : 100,
  };
}

/**
 * Reine Kandidatenauflösung für spätere lokale Vorschau: kein Speicher-,
 * DOM- oder Eventzugriff, mutiert den Kandidaten nicht.
 */
export function resolveTypography(candidate: unknown): ResolvedTypography {
  const groups = normalizeTypography(candidate);
  const factors = {
    interface: groups.interface / 100,
    supporting: groups.supporting / 100,
    technical: groups.technical / 100,
    workspace: groups.workspace / 100,
  };
  return { groups, factors };
}

/** Bestehende lokale Ausgangsgröße mit dem Gruppenfaktor multiplizieren. */
export function typographySize(resolved: ResolvedTypography, group: TypographyGroup, baselinePx: number): number {
  return baselinePx * groupFactor(resolved, group);
}

/** Reiner Faktorzugriff für Stellen mit eigener Box-/Abstandsrechnung. */
export function groupFactor(resolved: ResolvedTypography, group: TypographyGroup): number {
  return resolved.factors[group];
}

/** Aufgelöste Baseline (alle Gruppen 100 %): für Exporte/Vorschauen ohne Benutzerskalierung. */
export function baselineTypography(): ResolvedTypography {
  return resolveTypography(null);
}

/**
 * Führt fn mit Baseline-Typografie aus und stellt danach wieder her
 * (auch bei Fehler). Für PNG-Vorschauen, die immer gleich aussehen sollen.
 */
export function withBaselineTypography<T>(host: { typo: ResolvedTypography }, fn: () => T): T {
  const prev = host.typo;
  host.typo = baselineTypography();
  try {
    return fn();
  } finally {
    host.typo = prev;
  }
}

function readStored(): unknown {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = localStorage.getItem(TYPOGRAPHY_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Unbekannte Felder bleiben beim Speichern erhalten, werden aber nie angewendet. */
let extras: Record<string, unknown> = {};

function writeStored(groups: TypographyPreferences): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify({ ...extras, ...groups }));
  } catch {
    /* Speicher nicht verfügbar: Laufzeit weiter nutzen */
  }
}

let current: TypographyPreferences = { ...DEFAULTS };
let initialized = false;

function same(a: TypographyPreferences, b: TypographyPreferences): boolean {
  return TYPOGRAPHY_GROUPS.every((g) => a[g] === b[g]);
}

/** Gespeicherten Stand laden und im Speicher normalisieren (schreibt nichts zurück). */
export function initTypography(): void {
  const raw = readStored();
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) if (!isGroup(k)) keep[k] = v;
  extras = keep;
  current = normalizeTypography(src);
  initialized = true;
}

function ensureInit(): void {
  if (!initialized) initTypography();
}

export function getTypography(): TypographyPreferences {
  ensureInit();
  return { ...current };
}

const listeners = new Set<() => void>();

export function onTypographyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  listeners.forEach((f) => {
    try {
      f();
    } catch {
      /* Listener-Fehler dürfen den Zustand nicht beschädigen */
    }
  });
}

export function setTypographyGroup(group: TypographyGroup, value: TypographyPreset): void {
  ensureInit();
  if (!isGroup(group) || !isPreset(value)) return;
  if (current[group] === value) return;
  current = { ...current, [group]: value };
  writeStored(current);
  emit();
}

/** Eine Gruppe oder alle Gruppen auf 100 % zurücksetzen. */
export function resetTypography(group?: TypographyGroup): void {
  ensureInit();
  const next = group ? { ...current, [group]: 100 as TypographyPreset } : { ...DEFAULTS };
  if (same(current, next)) return;
  current = next;
  writeStored(current);
  emit();
}
