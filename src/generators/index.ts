// Verzeichnis der Generatoren und gemeinsame Abläufe: Parameter prüfen, normalisieren und Geometrie erzeugen.
import type { GenShape, Pt, SubPath } from '../model';
import { t } from '../i18n';
import { BOX } from './box';
import { CAM } from './cam';
import { DRAWER } from './drawer';
import { INSERT } from './insert';
import { SHELF } from './shelf';
import { GEAR } from './gear';
import { GEARPAIR } from './gearpair';
import { PULLEY } from './pulley';
import { RACK } from './rack';
import { DISCSPHERE } from './discsphere';
import { STACK } from './stack';
import { RIBS } from './ribs';
import type { Generator, Issue, Params, ParamSpec, ParamValue } from './types';
import { evaluate, ExprError, scopeOf, type Scope } from '../params';

export type { GenPart, Generator, Issue, Params, ParamSpec } from './types';

export const GENERATORS: Generator[] = [GEAR, RACK, PULLEY, CAM, GEARPAIR, BOX, DRAWER, INSERT, SHELF, DISCSPHERE, STACK, RIBS];

export const getGenerator = (id: string): Generator | undefined => GENERATORS.find((g) => g.id === id);

/** Gilt das Feld bei diesen Parametern (showIf)? */
export const fieldActive = (s: ParamSpec, p: Params) => !s.showIf || s.showIf(p);

/** Standardwerte aller Felder */
export function defaultParams(g: Generator): Params {
  const p: Params = {};
  for (const s of g.schema) p[s.key] = s.def;
  return p;
}

/**
 * Beliebige Eingaben (Datei, Dialog, KI-Agent) auf das Schema bringen: fehlende Werte mit Standardwerten
 * füllen, Zahlen in den erlaubten Bereich holen, ganze Zahlen runden, unbekannte Schlüssel weglassen.
 */
export function normalizeParams(g: Generator, raw: Record<string, unknown>, base: Params = defaultParams(g)): Params {
  const p: Params = {};
  for (const s of g.schema) {
    const v = raw[s.key] ?? base[s.key] ?? s.def;
    let out: ParamValue = s.def;
    if (s.type === 'bool') out = typeof v === 'boolean' ? v : v === 'true' || v === 1;
    else if (s.type === 'enum') out = s.options.some(([k]) => k === v) ? (v as string) : s.def;
    else if (s.type === 'data') out = typeof v === 'string' ? v : s.def;
    else {
      const n = Number(v);
      out = isFinite(n) ? Math.min(s.max, Math.max(s.min, s.type === 'int' ? Math.round(n) : n)) : s.def;
    }
    p[s.key] = out;
  }
  return p;
}

/** Eingaben streng prüfen (für KI-Agenten): unbekannte Schlüssel und Werte außerhalb des Bereichs sind Fehler */
export function checkInput(g: Generator, raw: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  for (const k of Object.keys(raw)) if (!g.schema.some((s) => s.key === k)) out.push({ key: k, level: 'error', msg: t('Unbekannter Parameter „{key}“', { key: k }) });
  for (const s of g.schema) {
    const v = raw[s.key];
    if (v === undefined) continue;
    if (s.type === 'bool' && typeof v !== 'boolean') out.push({ key: s.key, level: 'error', msg: t('„{key}“ muss true oder false sein', { key: s.key }) });
    else if (s.type === 'enum' && !s.options.some(([k]) => k === v))
      out.push({ key: s.key, level: 'error', msg: t('„{key}“ muss einer von {values} sein', { key: s.key, values: s.options.map(([k]) => k).join(', ') }) });
    else if (s.type === 'data') {
      if (typeof v !== 'string') out.push({ key: s.key, level: 'error', msg: t('„{key}“ muss ein Text sein', { key: s.key }) });
    } else if (s.type !== 'bool' && s.type !== 'enum') {
      const n = Number(v);
      if (typeof v !== 'number' || !isFinite(n)) out.push({ key: s.key, level: 'error', msg: t('„{key}“ ist keine Zahl', { key: s.key }) });
      else if (n < s.min || n > s.max) out.push({ key: s.key, level: 'error', msg: t('„{key}“ muss zwischen {min} und {max} liegen', { key: s.key, min: s.min, max: s.max }) });
    }
  }
  return out;
}

export interface BuiltPart {
  shape: GenShape;
  /** Vorgeschlagene Lage der Teilmitte in der Baugruppe */
  at: Pt;
  /** Gravur auf dem Teil (siehe GenPart.marks) */
  marks?: SubPath[];
}

export interface BuildResult {
  /** Leer, wenn die Parameter einen Fehler enthalten */
  parts: BuiltPart[];
  issues: Issue[];
  info: [string, string][];
}

/** Parameter prüfen und, wenn kein Fehler vorliegt, die Teile erzeugen (Baugruppen: part = Schlüssel des Teils) */
export function buildGen(g: Generator, params: Params): BuildResult {
  const issues = g.validate(params);
  if (issues.some((i) => i.level === 'error')) return { parts: [], issues, info: [] };
  try {
    const r = g.generate(params);
    const parts = r.parts.map((p) => {
      const shape: GenShape = { kind: 'gen', gen: g.id, v: g.version, params: { ...params }, subs: p.subs };
      if (g.kind === 'assembly') shape.part = p.key;
      return p.marks?.length ? { shape, at: p.at, marks: p.marks } : { shape, at: p.at };
    });
    return { parts, issues, info: r.info };
  } catch (e) {
    return { parts: [], issues: [...issues, { level: 'error', msg: String(e instanceof Error ? e.message : e) }], info: [] };
  }
}

/** Name eines Generator-Objekts für Objekte-Fenster und Verlauf */
export function genLabel(s: GenShape): string {
  const g = getGenerator(s.gen);
  if (!g) return t('Generator „{id}“ (unbekannt)', { id: s.gen });
  try {
    return g.label(normalizeParams(g, s.params), s.part);
  } catch {
    return g.name;
  }
}

/**
 * Beim Laden: Parameter älterer Generator-Versionen anpassen. Die gespeicherte Geometrie bleibt, wie sie ist,
 * damit sich ein Projekt nicht durch ein Programm-Update verändert; neu berechnet wird erst beim Bearbeiten.
 * Unbekannte Generatoren (z. B. aus einer neueren Version) behalten Parameter und Geometrie.
 */
export function loadGen(s: GenShape) {
  const g = getGenerator(s.gen);
  if (!g) return;
  if (g.migrate && s.v < g.version) s.params = g.migrate(s.params, s.v);
  s.v = Math.max(s.v, g.version);
}

/**
 * Formeln der Felder (GenShape.bind) mit den Projekt-Parametern auswerten. Felder, deren Formel nicht
 * auswertbar ist, behalten ihren bisherigen Wert; die Meldung steht in issues.
 */
export function resolveBinds(g: Generator, params: Params, bind: Record<string, string> | undefined, scope: Scope = scopeOf()): { params: Params; issues: Issue[] } {
  const raw: Record<string, unknown> = { ...params };
  const issues: Issue[] = [];
  for (const [key, src] of Object.entries(bind ?? {})) {
    const s = g.schema.find((x) => x.key === key);
    if (!s || s.type === 'data') continue;
    try {
      const v = evaluate(src, scope);
      if (s.type === 'bool') raw[key] = typeof v === 'string' ? v !== '' : !!v;
      else if (s.type === 'enum') {
        if (!s.options.some(([k]) => k === v)) throw new ExprError(t('„{v}“ ist keine Auswahl für „{label}“ ({values})', { v: String(v), label: s.label, values: s.options.map(([k]) => k).join(', ') }));
        raw[key] = v;
      } else {
        const n = typeof v === 'number' ? v : Number(v);
        if (!isFinite(n)) throw new ExprError(t('„{label}“: Die Formel ergibt keine Zahl.', { label: s.label }));
        if (n < s.min || n > s.max) issues.push({ key, level: 'warn', msg: t('„{label}“ = {v} liegt außerhalb von {min} … {max} und wird begrenzt.', { label: s.label, v: n, min: s.min, max: s.max }) });
        raw[key] = n;
      }
    } catch (e) {
      issues.push({ key, level: 'error', msg: `${s.label}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return { params: normalizeParams(g, raw, params), issues };
}
