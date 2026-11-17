// Verzeichnis der Generatoren und gemeinsame Abläufe: Parameter prüfen, normalisieren und Geometrie erzeugen.
import type { GenShape, Pt, SubPath } from '../model';
import { t } from '../i18n';
import { BOX } from './box';
import { FINGERBOX } from './fingerbox';
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
import { JIG } from './jig';
import { SKETCH } from '../sketch/generator';
import { SLOT_PLACEMENT, SLOT_GENERATOR, isSlotGenerator } from '../slotPlacement';
import { CONTOUR_OFFSET, CONTOUR_OFFSET_ID, LEGACY_CONTOUR_OFFSET_ID } from '../contourOffset';
import { PATTERN_GEN, PATTERN_GEN_ID } from '../pattern';
import type { Generator, Issue, Params, ParamSpec, ParamValue, PlanSheet, Rule } from './types';
import { evaluate, ExprError, scopeOf, type Scope } from '../params';

export type { GenAsk, GenChange, Rule, GenInput, GenPart, GenTile, Generator, Issue, Params, ParamSpec } from './types';

/** Registered generators in toolbox order. Use register() to add one; the built-in generators register below. */
export const GENERATORS: Generator[] = [];

/** Add a generator (or replace one with the same id). Its id must stay stable: saved projects refer to it. */
export function register(g: Generator) {
  const i = GENERATORS.findIndex((x) => x.id === g.id);
  if (i >= 0) GENERATORS[i] = g;
  else GENERATORS.push(g);
}

/** Remove a generator added with register() (an extension was removed); saved parts keep their geometry */
export function unregister(id: string) {
  const i = GENERATORS.findIndex((x) => x.id === id);
  if (i >= 0) GENERATORS.splice(i, 1);
}

for (const g of [GEAR, RACK, PULLEY, CAM, GEARPAIR, BOX, FINGERBOX, DRAWER, INSERT, SHELF, STACK, RIBS, DISCSPHERE, JIG]) register(g);

export const getGenerator = (id: string): Generator | undefined => (id === PATTERN_GEN_ID ? PATTERN_GEN : id === CONTOUR_OFFSET_ID ? CONTOUR_OFFSET : id === LEGACY_CONTOUR_OFFSET_ID ? { ...CONTOUR_OFFSET, id, version: 1 } : id === SLOT_GENERATOR ? SLOT_PLACEMENT : isSlotGenerator(id) ? { ...SLOT_PLACEMENT, id } : id === 'sketch' ? SKETCH : GENERATORS.find((g) => g.id === id));

/** Does the rule hold for these parameters? Unknown operators count as false. */
export function ruleHolds(r: Rule, p: Params): boolean {
  const num = (k: string) => Number(p[k]);
  if ('eq' in r) return p[r.eq[0]] === r.eq[1];
  if ('ne' in r) return p[r.ne[0]] !== r.ne[1];
  if ('lt' in r) return num(r.lt[0]) < r.lt[1];
  if ('le' in r) return num(r.le[0]) <= r.le[1];
  if ('gt' in r) return num(r.gt[0]) > r.gt[1];
  if ('ge' in r) return num(r.ge[0]) >= r.ge[1];
  if ('in' in r) return r.in[1].includes(p[r.in[0]]);
  if ('and' in r) return r.and.every((x) => ruleHolds(x, p));
  if ('or' in r) return r.or.some((x) => ruleHolds(x, p));
  if ('not' in r) return !ruleHolds(r.not, p);
  return false;
}

/** Gilt das Feld bei diesen Parametern (showIf)? */
export const fieldActive = (s: ParamSpec, p: Params) => !s.showIf || ruleHolds(s.showIf, p);

/** Suggested text for an empty text field (Generator.view().autoText) */
export const autoText = (g: Generator, key: string, p: Params): string => {
  try {
    return g.view?.(p).autoText?.[key] ?? '';
  } catch {
    return '';
  }
};

/** Standardwerte aller Felder */
export function defaultParams(g: Pick<Generator, 'schema'>): Params {
  const p: Params = {};
  for (const s of g.schema) p[s.key] = s.def;
  return p;
}

/**
 * Beliebige Eingaben (Datei, Dialog, KI-Agent) auf das Schema bringen: fehlende Werte mit Standardwerten
 * füllen, Zahlen in den erlaubten Bereich holen, ganze Zahlen runden, unbekannte Schlüssel weglassen.
 */
export function normalizeParams(g: Pick<Generator, 'schema'>, raw: Record<string, unknown>, base: Params = defaultParams(g)): Params {
  const p: Params = {};
  for (const s of g.schema) {
    const v = raw[s.key] ?? base[s.key] ?? s.def;
    let out: ParamValue = s.def;
    if (s.type === 'bool') out = typeof v === 'boolean' ? v : v === 'true' || v === 1;
    else if (s.type === 'enum') out = s.options.some(([k]) => k === v) ? (v as string) : s.def;
    else if ((s.type === 'data' || s.type === 'text')) out = typeof v === 'string' ? v : s.def;
    else {
      const n = Number(v);
      out = isFinite(n) ? Math.min(s.max, Math.max(s.min, s.type === 'int' ? Math.round(n) : n)) : s.def;
    }
    p[s.key] = out;
  }
  return p;
}

/** Eingaben streng prüfen (für KI-Agenten): unbekannte Schlüssel und Werte außerhalb des Bereichs sind Fehler */
export function checkInput(g: Pick<Generator, 'schema'>, raw: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  for (const k of Object.keys(raw)) if (!g.schema.some((s) => s.key === k)) out.push({ key: k, level: 'error', msg: t('Unbekannter Parameter „{key}“', { key: k }) });
  for (const s of g.schema) {
    const v = raw[s.key];
    if (v === undefined) continue;
    if (s.type === 'bool' && typeof v !== 'boolean') out.push({ key: s.key, level: 'error', msg: t('„{key}“ muss true oder false sein', { key: s.key }) });
    else if (s.type === 'enum' && !s.options.some(([k]) => k === v))
      out.push({ key: s.key, level: 'error', msg: t('„{key}“ muss einer von {values} sein', { key: s.key, values: s.options.map(([k]) => k).join(', ') }) });
    else if ((s.type === 'data' || s.type === 'text')) {
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
  plan?: PlanSheet;
}

/**
 * Like buildGen, but first waits for generators that compute elsewhere (plugins, Generator.prepare). Use it where
 * the caller can wait (MCP tools); interactive code calls buildGen and listens to onPluginResult.
 */
/** Code of the issue a generator reports while its result is computed elsewhere (a plugin in its Worker; PENDING in plugins/words.ts) */
export const GEN_PENDING = 'plugin-pending';
/** Whether a result is still being computed: callers that cannot wait ask again when it is there (onPluginResult) */
export const isPending = (r: BuildResult) => r.issues.some((i) => i.code === GEN_PENDING);

export async function buildGenAsync(g: Generator, params: Params): Promise<BuildResult> {
  await g.prepare?.(params);
  return buildGen(g, params);
}

/** Parameter prüfen und, wenn kein Fehler vorliegt, die Teile erzeugen (Baugruppen: part = Schlüssel des Teils) */
export function buildGen(g: Generator, params: Params): BuildResult {
  const issues = g.validate(params);
  if (issues.some((i) => i.level === 'error')) return { parts: [], issues, info: [] };
  try {
    const r = g.generate(params);
    const parts = r.parts.map((p) => {
      const shape: GenShape = { kind: 'gen', gen: g.id, v: g.version, params: { ...params }, subs: p.subs };
      if (g.ext) shape.ext = g.ext;
      if (g.kind === 'assembly') shape.part = p.key;
      return p.marks?.length ? { shape, at: p.at, marks: p.marks } : { shape, at: p.at };
    });
    return r.plan ? { parts, issues, info: r.info, plan: r.plan } : { parts, issues, info: r.info };
  } catch (e) {
    const code = String(e instanceof Error ? e.message : e);
    const text = g.texts?.[code];
    return { parts: [], issues: [...issues, text ? { level: 'error', msg: text(), code } : { level: 'error', msg: code }], info: [] };
  }
}

/** Name eines Generator-Objekts für Objekte-Fenster und Verlauf */
export function genLabel(s: GenShape): string {
  const g = getGenerator(s.gen);
  if (!g) return s.ext ? t('„{id}“ (Erweiterung „{name}“ fehlt)', { id: s.gen, name: s.ext }) : t('Generator „{id}“ (unbekannt)', { id: s.gen });
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
    if (!s || s.type === 'data' || s.type === 'text') continue;
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
