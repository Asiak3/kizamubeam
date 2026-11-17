// Plugin entry of an extension pack (`plugins` in .kzp format version 2, issue #205): what the plugin is, its
// parameters and texts, and its code. Everything is checked here before a plugin is registered; a mistake refuses
// the whole pack. No DOM, no editor: the same checks run in the app and in the tests.
import type { GenAction, GenActionInput, GenColumn, GenList, ParamSpec, ParamValue, Rule } from '../generators/types';
import { LIMITS, PLUGIN_API } from './contract';
import { base64ToBytes, type Runtime } from './engine';
import { sha256 } from '../pdfcrypt';
import { t } from '../i18n';

/** Texts of a plugin: language code → text key → text. English is required. */
export type PluginTexts = Record<string, Record<string, string>>;

export interface PluginManifest {
  /** Generator id, stored in projects; stays the same across versions */
  id: string;
  /** Version of the parameters (Generator.version) */
  version: number;
  /** Call protocol the plugin was built for (PLUGIN_API) */
  api: number;
  /** Plugin kind; stage 1 knows generators only */
  type: 'generator';
  /** part = one part, assembly = several parts */
  kind: 'part' | 'assembly';
  runtime: Runtime;
  /** JavaScript source or WebAssembly bytes */
  code: string | Uint8Array;
  /** SHA-256 of the code (hex), checked on every load */
  sha256: string;
  /** Icon of the app (icons.ts); unknown names fall back to the extension icon */
  icon?: string;
  /** Parameters with text keys as labels (label = key, title = key + ".title", option label = text key) */
  schema: ParamSpec[];
  texts: PluginTexts;
  preview?: { center?: boolean };
  /** Lists and actions of the dialog (schema version 2); labels are text keys */
  lists?: GenList[];
  actions?: GenAction[];
}

export class ManifestError extends Error {}

/**
 * Version of the dialog schema (#335). Version 1: fields with labels, tooltips, options, the main area, named
 * sections and „Advanced“, showIf rules, preview, info table and issue list. Version 2: lists of rows in a data
 * parameter (text, number and choice columns, an outline picture, remove) and action buttons with inputs
 * (selection, an image file, the camera image) and a number field next to a button. A plugin that needs a newer schema is refused with an update hint instead of being shown half-broken.
 */
export const DIALOG_VERSION = 2;
const MAX_LISTS = 4;
const MAX_COLUMNS = 8;
const MAX_ACTIONS = 8;
const INPUTS = ['selection', 'image', 'camera'] as const;

const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const TEXT_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_PARAMS = 100;
const MAX_OPTIONS = 60;
const MAX_TEXTS = 2000;
const MAX_TEXT = 400;
const MAX_RULE_DEPTH = 8;
const NUMERIC = ['length', 'angle', 'int', 'number'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isScalar = (v: unknown): v is ParamValue => typeof v === 'string' || typeof v === 'boolean' || isNum(v);

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Bytes the SHA-256 is taken over: the UTF-8 source or the WebAssembly module */
export const codeBytes = (code: string | Uint8Array) => (typeof code === 'string' ? new TextEncoder().encode(code) : code);

function rule(v: unknown, keys: Set<string>, where: string, depth = 0): Rule {
  const bad = (): never => {
    throw new ManifestError(t('{where}: ungültige Bedingung', { where }));
  };
  if (depth > MAX_RULE_DEPTH || !isObj(v)) return bad();
  const ops = Object.keys(v);
  if (ops.length !== 1) return bad();
  const op = ops[0];
  const arg = v[op];
  if (op === 'and' || op === 'or') {
    if (!Array.isArray(arg) || !arg.length || arg.length > 20) return bad();
    return { [op]: arg.map((x) => rule(x, keys, where, depth + 1)) } as Rule;
  }
  if (op === 'not') return { not: rule(arg, keys, where, depth + 1) };
  if (!Array.isArray(arg) || arg.length !== 2 || typeof arg[0] !== 'string' || !keys.has(arg[0])) return bad();
  if (op === 'eq' || op === 'ne') return isScalar(arg[1]) ? ({ [op]: [arg[0], arg[1]] } as Rule) : bad();
  if (op === 'lt' || op === 'le' || op === 'gt' || op === 'ge') return isNum(arg[1]) ? ({ [op]: [arg[0], arg[1]] } as Rule) : bad();
  if (op === 'in') return Array.isArray(arg[1]) && arg[1].length <= MAX_OPTIONS && arg[1].every(isScalar) ? { in: [arg[0], arg[1] as ParamValue[]] } : bad();
  return bad();
}

function param(v: unknown, i: number): ParamSpec {
  const where = t('Parameter {n}', { n: i + 1 });
  if (!isObj(v) || typeof v.key !== 'string' || !KEY_RE.test(v.key)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where }));
  const key = v.key;
  const at = `${where} (${key})`;
  if (v.section !== undefined && (typeof v.section !== 'string' || !TEXT_KEY_RE.test(v.section))) throw new ManifestError(t('{where}: ungültiger Abschnitt', { where: `${where} (${key})` }));
  const base = {
    key, label: key,
    ...(v.advanced === true ? { advanced: true } : {}),
    ...(v.resetOnNew === true ? { resetOnNew: true } : {}),
    // Text key of the section heading; the generator replaces it with the text
    ...(typeof v.section === 'string' ? { section: v.section } : {}),
  };
  const type = v.type;
  if ((NUMERIC as readonly unknown[]).includes(type)) {
    const { min, max, def } = v;
    if (!isNum(min) || !isNum(max) || !isNum(def) || min > max || def < min || def > max || Math.abs(min) > LIMITS.range || Math.abs(max) > LIMITS.range)
      throw new ManifestError(t('{where}: min, max und def müssen Zahlen mit min ≤ def ≤ max sein', { where: at }));
    if (type === 'int' && (!Number.isInteger(def) || !Number.isInteger(min) || !Number.isInteger(max))) throw new ManifestError(t('{where}: ganze Zahlen erwartet', { where: at }));
    return { ...base, type: type as (typeof NUMERIC)[number], min, max, def };
  }
  if (type === 'enum') {
    const opts = v.options;
    if (!Array.isArray(opts) || !opts.length || opts.length > MAX_OPTIONS) throw new ManifestError(t('{where}: „options“ muss 1 bis {n} Einträge haben', { where: at, n: MAX_OPTIONS }));
    const options = opts.map((o): [string, string] => {
      // Either "value" (label = text "<key>.<value>") or ["value", "text key"]
      const pair = typeof o === 'string' ? [o, `${key}.${o}`] : o;
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !TEXT_KEY_RE.test(pair[0]) || typeof pair[1] !== 'string' || !TEXT_KEY_RE.test(pair[1]))
        throw new ManifestError(t('{where}: ungültige Auswahl', { where: at }));
      return [pair[0], pair[1]];
    });
    if (new Set(options.map(([k]) => k)).size !== options.length) throw new ManifestError(t('{where}: doppelte Auswahl', { where: at }));
    if (typeof v.def !== 'string' || !options.some(([k]) => k === v.def)) throw new ManifestError(t('{where}: def ist keine der Auswahlen', { where: at }));
    return { ...base, type: 'enum', options, def: v.def };
  }
  if (type === 'bool') {
    if (typeof v.def !== 'boolean') throw new ManifestError(t('{where}: def muss true oder false sein', { where: at }));
    return { ...base, type: 'bool', def: v.def };
  }
  if (type === 'text' || type === 'data') {
    if (typeof v.def !== 'string' || v.def.length > 10_000) throw new ManifestError(t('{where}: def muss ein Text sein', { where: at }));
    return { ...base, type, def: v.def };
  }
  throw new ManifestError(t('{where}: unbekannter Typ „{type}“', { where: at, type: String(type) }));
}

function texts(v: unknown): PluginTexts {
  if (!isObj(v) || !isObj(v.en)) throw new ManifestError(t('Texte fehlen (mindestens „en“)'));
  const out: PluginTexts = {};
  for (const [l, entries] of Object.entries(v)) {
    if (!LANG_RE.test(l) || !isObj(entries)) throw new ManifestError(t('Ungültige Sprache „{lang}“ in den Texten', { lang: l }));
    const list = Object.entries(entries);
    if (list.length > MAX_TEXTS) throw new ManifestError(t('Zu viele Texte'));
    const m: Record<string, string> = {};
    for (const [k, s] of list) {
      if (!TEXT_KEY_RE.test(k) || typeof s !== 'string') throw new ManifestError(t('Ungültiger Text „{key}“', { key: k }));
      m[k] = s.slice(0, MAX_TEXT);
    }
    out[l] = m;
  }
  if (!out.en.name?.trim()) throw new ManifestError(t('Text „name“ fehlt'));
  return out;
}

const textKey = (v: unknown, at: string): string => {
  if (typeof v !== 'string' || !TEXT_KEY_RE.test(v)) throw new ManifestError(t('{where}: ungültiger Textschlüssel', { where: at }));
  return v;
};

function column(v: unknown, at: string): GenColumn {
  if (!isObj(v) || typeof v.key !== 'string' || !KEY_RE.test(v.key)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where: at }));
  const base = { key: v.key, label: textKey(v.label ?? v.key, at), ...(v.title !== undefined ? { title: textKey(v.title, at) } : {}) };
  if (v.type === 'text') {
    const max = v.max ?? 200;
    if (!isNum(max) || !Number.isInteger(max) || max < 1 || max > 2000) throw new ManifestError(t('{where}: ungültige Länge', { where: at }));
    const out: GenColumn = { ...base, type: 'text', max };
    if (v.placeholder !== undefined) out.placeholder = textKey(v.placeholder, at);
    return out;
  }
  if (v.type === 'int' || v.type === 'number' || v.type === 'length') {
    const { min, max } = v;
    if (!isNum(min) || !isNum(max) || min > max || Math.abs(min) > LIMITS.range || Math.abs(max) > LIMITS.range) throw new ManifestError(t('{where}: min, max und def müssen Zahlen mit min ≤ def ≤ max sein', { where: at }));
    return { ...base, type: v.type, min, max };
  }
  if (v.type === 'enum') {
    if (!Array.isArray(v.options) || !v.options.length || v.options.length > MAX_OPTIONS) throw new ManifestError(t('{where}: „options“ muss 1 bis {n} Einträge haben', { where: at, n: MAX_OPTIONS }));
    const options = v.options.map((o): [string | number, string] => {
      if (!Array.isArray(o) || o.length !== 2 || !(typeof o[0] === 'string' || isNum(o[0]))) throw new ManifestError(t('{where}: ungültige Auswahl', { where: at }));
      return [o[0], textKey(o[1], at)];
    });
    return { ...base, type: 'enum', options };
  }
  throw new ManifestError(t('{where}: unbekannter Typ „{type}“', { where: at, type: String(v.type) }));
}

/** Lists and actions of a dialog with schema version 2 */
function dialogParts(d: Record<string, unknown>, schema: ParamSpec[]): { lists?: GenList[]; actions?: GenAction[] } {
  const out: { lists?: GenList[]; actions?: GenAction[] } = {};
  if (d.lists !== undefined) {
    if (!Array.isArray(d.lists) || d.lists.length > MAX_LISTS) throw new ManifestError(t('ungültige Angabe „dialog“'));
    out.lists = d.lists.map((l, i) => {
      const at = `lists[${i}]`;
      if (!isObj(l) || !schema.some((s) => s.key === l.param && s.type === 'data')) throw new ManifestError(t('{where}: „param“ muss ein data-Parameter sein', { where: at }));
      if (!Array.isArray(l.columns) || l.columns.length > MAX_COLUMNS) throw new ManifestError(t('{where}: ungültige Spalten', { where: at }));
      const list: GenList = { param: l.param as string, label: textKey(l.label ?? l.param, at), columns: l.columns.map((c, k) => column(c, `${at}.columns[${k}]`)) };
      if (l.empty !== undefined) list.empty = textKey(l.empty, at);
      if (isObj(l.shape) && typeof l.shape.key === 'string' && KEY_RE.test(l.shape.key)) {
        list.shape = { key: l.shape.key };
        if (typeof l.shape.rotate === 'string' && KEY_RE.test(l.shape.rotate)) list.shape.rotate = l.shape.rotate;
      }
      if (l.remove === true) list.remove = true;
      if (l.removeTitle !== undefined) list.removeTitle = textKey(l.removeTitle, at);
      return list;
    });
  }
  if (d.actions !== undefined) {
    if (!Array.isArray(d.actions) || d.actions.length > MAX_ACTIONS) throw new ManifestError(t('ungültige Angabe „dialog“'));
    out.actions = d.actions.map((a, i) => {
      const at = `actions[${i}]`;
      if (!isObj(a) || typeof a.id !== 'string' || !KEY_RE.test(a.id)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where: at }));
      const act: GenAction = { id: a.id, label: textKey(a.label ?? a.id, at) };
      if (a.title !== undefined) act.title = textKey(a.title, at);
      if (a.inputs !== undefined) {
        if (!Array.isArray(a.inputs) || !a.inputs.every((x) => (INPUTS as readonly unknown[]).includes(x))) throw new ManifestError(t('{where}: unbekannte Eingabe', { where: at }));
        act.inputs = [...new Set(a.inputs as GenActionInput[])];
      }
      if (a.field !== undefined) {
        const f = schema.find((s) => s.key === a.field);
        if (!f || !(f.type === 'number' || f.type === 'length' || f.type === 'int' || f.type === 'angle')) throw new ManifestError(t('{where}: „field“ muss ein Zahlen-Parameter sein', { where: at }));
        act.field = f.key;
      }
      return act;
    });
  }
  return out;
}

/** Check one entry of `plugins`; `where` names it in error messages */
export function parsePlugin(raw: unknown, where: string): PluginManifest {
  const fail = (msg: string): never => {
    throw new ManifestError(`${where}: ${msg}`);
  };
  try {
    if (!isObj(raw)) return fail(t('kein Plugin'));
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!ID_RE.test(id)) fail(t('ungültige Kennung „{id}“', { id }));
    if (raw.type !== 'generator') fail(t('unbekannte Art „{type}“', { type: String(raw.type) }));
    const api = raw.api;
    if (!isNum(api) || !Number.isInteger(api) || api < 1) fail(t('Angabe „api“ fehlt'));
    if ((api as number) > PLUGIN_API) fail(t('braucht eine neuere Version von KizamuBeam'));
    if (raw.dialog !== undefined) {
      const dv = isObj(raw.dialog) ? raw.dialog.version : undefined;
      if (!isNum(dv) || !Number.isInteger(dv) || dv < 1) fail(t('ungültige Angabe „dialog“'));
      if ((dv as number) > DIALOG_VERSION) fail(t('braucht eine neuere Version von KizamuBeam'));
    }
    const version = raw.version ?? 1;
    if (!isNum(version) || !Number.isInteger(version) || version < 1) fail(t('ungültige Version'));
    const kind = raw.kind ?? 'part';
    if (kind !== 'part' && kind !== 'assembly') fail(t('„kind“ muss part oder assembly sein'));
    const runtime = raw.runtime;
    if (runtime !== 'js' && runtime !== 'wasm') fail(t('„runtime“ muss js oder wasm sein'));
    if (typeof raw.code !== 'string' || !raw.code) fail(t('Programmcode fehlt'));
    let code: string | Uint8Array = raw.code as string;
    if (runtime === 'wasm') {
      try {
        code = base64ToBytes(code as string);
      } catch {
        fail(t('WebAssembly-Code ist kein gültiges Base64'));
      }
    }
    const bytes = codeBytes(code);
    if (bytes.length > LIMITS.codeBytes) fail(t('Programmcode größer als {mb} MB', { mb: LIMITS.codeBytes / 1024 / 1024 }));
    if (runtime === 'wasm' && typeof WebAssembly !== 'undefined' && !WebAssembly.validate(bytes as BufferSource)) fail(t('kein gültiges WebAssembly-Modul'));
    const sum = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : '';
    if (!HEX64.test(sum)) fail(t('Prüfsumme „sha256“ fehlt'));
    if (hex(sha256(bytes)) !== sum) fail(t('Prüfsumme des Programmcodes stimmt nicht'));
    if (!Array.isArray(raw.params) || raw.params.length > MAX_PARAMS) fail(t('„params“ muss eine Liste mit höchstens {n} Einträgen sein', { n: MAX_PARAMS }));
    const list = raw.params as unknown[];
    const keys = new Set(list.map((p) => (isObj(p) ? p.key : undefined)).filter((k): k is string => typeof k === 'string'));
    const schema = list.map((p, i) => param(p, i));
    if (new Set(schema.map((s) => s.key)).size !== schema.length) fail(t('doppelte Parameter'));
    // Conditions may refer to any parameter, so they are read after all keys are known
    list.forEach((p, i) => {
      if (isObj(p) && p.showIf !== undefined) schema[i].showIf = rule(p.showIf, keys, `${t('Parameter {n}', { n: i + 1 })} (${schema[i].key})`);
    });
    const tx = texts(raw.texts);
    const m: PluginManifest = { id, version: version as number, api: api as number, type: 'generator', kind: kind as 'part' | 'assembly', runtime: runtime as Runtime, code, sha256: sum, schema, texts: tx };
    if (typeof raw.icon === 'string' && /^[a-zA-Z][a-zA-Z0-9-]{0,40}$/.test(raw.icon)) m.icon = raw.icon;
    if (isObj(raw.preview) && raw.preview.center === true) m.preview = { center: true };
    if (isObj(raw.dialog) && (raw.dialog.lists !== undefined || raw.dialog.actions !== undefined)) {
      if ((raw.dialog.version as number) < 2) fail(t('Listen und Aktionen brauchen „dialog“ Version 2'));
      Object.assign(m, dialogParts(raw.dialog, schema));
    }
    return m;
  } catch (e) {
    if (e instanceof ManifestError && e.message.startsWith(where)) throw e;
    throw new ManifestError(`${where}: ${(e as Error).message}`);
  }
}

/** Text of a plugin in the given language, then English; placeholders {name} filled with plain values */
export function pluginText(tx: PluginTexts, lang: string, key: string, values?: Record<string, string | number>): string | undefined {
  const s = tx[lang]?.[key] ?? tx[lang.split('-')[0]]?.[key] ?? tx.en?.[key];
  if (s === undefined) return undefined;
  return values ? s.replace(/\{([a-zA-Z0-9_]+)\}/g, (all, k) => (k in values ? String(values[k]) : all)) : s;
}
