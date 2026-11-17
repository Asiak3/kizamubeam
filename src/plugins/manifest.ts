// Plugin entry of an extension pack (`plugins` in .kzp format version 2, issue #205): what the plugin is, its
// parameters and texts, and its code. Everything is checked here before a plugin is registered; a mistake refuses
// the whole pack. No DOM, no editor: the same checks run in the app and in the tests.
import type { GenAction, GenActionInput, GenColumn, GenList, GenStep, GenSurface, ParamSpec, ParamValue, Rule } from '../generators/types';
import { LIMITS, PLUGIN_API } from './contract';
import { base64ToBytes, type Runtime } from './engine';
import { HOST_FNS } from './hostfns';
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
  /**
   * Plugin kind: a generator (parameters → parts), a path tool (parameters and the selected shapes → shapes that
   * replace them) or an image filter (parameters and a grayscale image → a grayscale image), #205 stage 3
   */
  type: PluginType;
  /** part = one part, assembly = several parts (generators only) */
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
  /** Drawing surface (schema version 3); view labels and help are text keys */
  surface?: GenSurface;
  /** Steps of the dialog (schema version 5); labels are text keys */
  steps?: GenStep[];
  /**
   * What the plugin can be opened with: a 3D model the user imports goes into `param` (a data parameter with
   * resource model3d), its file name into `name`
   */
  inputs?: PluginInput[];
  /** Context the generator reads with host.context (#386); declaring it allows the host function context */
  context?: PluginContext[];
  /** Host functions the plugin calls (hostfns.ts: boolean, offset, fit, trace); progress needs no entry */
  host?: string[];
  /** Servers the app may fetch data from for the plugin (#280); needs the host function fetch */
  network?: PluginNetHost[];
  /** Plug-in joints (generators): kind of fit and the number parameter that holds the play (design check) */
  fit?: { kind: 'pair' | 'slot'; play: string };
  /** The parts form one connected assembly that the assembly check examines */
  assemblyCheck?: boolean;
  /**
   * Place of the toolbox tile and toolbar action; texts under tile.name and tile.action. Only the generators that
   * come with the app use it; extensions are listed under „From extensions“.
   */
  tile?: { group: string; before?: string; since?: string };
}

/**
 * A server a plugin may get data from (#280). The app builds every URL itself from `base` and a path the plugin
 * names; the plugin never passes a full URL and never sees the response headers, cookies or API keys.
 */
export interface PluginNetHost {
  /** Name the plugin uses in host.fetch */
  id: string;
  /** https://host[:port][/prefix], no query, no user info */
  base: string;
  /** Host name of base (lower case), shown to the user */
  hostname: string;
  methods: ('GET' | 'POST')[];
  /** Text key: what the plugin gets from this server, shown before the first request */
  purpose: string;
  /** Plain text the app shows with results that use the data, e.g. "© OpenStreetMap contributors" */
  attribution?: string;
  /** Requests per second at most (the app caps it further) */
  rate: number;
  /** Content types the plugin accepts: json, xml, text, png, mvt */
  types: NetType[];
}

export const NET_TYPES = ['json', 'xml', 'text', 'png', 'mvt'] as const;
export type NetType = (typeof NET_TYPES)[number];
/** Servers per plugin, and the highest request rate the app allows */
export const MAX_NET_HOSTS = 4;
export const MAX_NET_RATE = 2;

function netHost(v: unknown, at: string): PluginNetHost {
  if (!isObj(v) || typeof v.id !== 'string' || !KEY_RE.test(v.id)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where: at }));
  let u: URL;
  try {
    u = new URL(String(v.base));
  } catch {
    throw new ManifestError(t('{where}: „base“ muss eine https-Adresse ohne Abfrage sein', { where: at }));
  }
  // HTTPS to a named host only: no user info, query, fragment or IP address (the app also refuses local networks)
  const ipLike = /^[0-9.]+$|^\[|:/.test(u.hostname);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || ipLike || !u.hostname.includes('.') || String(v.base).includes('*'))
    throw new ManifestError(t('{where}: „base“ muss eine https-Adresse ohne Abfrage sein', { where: at }));
  const methods = v.methods === undefined ? ['GET'] : v.methods;
  if (!Array.isArray(methods) || !methods.length || !methods.every((x) => x === 'GET' || x === 'POST')) throw new ManifestError(t('{where}: „methods“ darf nur GET und POST enthalten', { where: at }));
  const types = v.types === undefined ? ['json'] : v.types;
  if (!Array.isArray(types) || !types.length || !types.every((x) => (NET_TYPES as readonly unknown[]).includes(x))) throw new ManifestError(t('{where}: unbekannter Inhaltstyp in „types“ (erlaubt: {list})', { where: at, list: NET_TYPES.join(', ') }));
  const rate = v.rate === undefined ? 1 : v.rate;
  if (!isNum(rate) || rate <= 0) throw new ManifestError(t('ungültige Angabe „network“'));
  const out: PluginNetHost = {
    id: v.id,
    base: u.origin + u.pathname.replace(/\/+$/, ''),
    hostname: u.hostname.toLowerCase(),
    methods: [...new Set(methods as ('GET' | 'POST')[])],
    purpose: textKey(v.purpose ?? `net.${v.id}`, at),
    rate: Math.min(MAX_NET_RATE, rate as number),
    types: [...new Set(types as NetType[])],
  };
  if (v.attribution !== undefined) {
    if (typeof v.attribution !== 'string' || v.attribution.length > 200) throw new ManifestError(t('ungültige Angabe „network“'));
    out.attribution = v.attribution;
  }
  return out;
}

export const PLUGIN_TYPES = ['generator', 'pathtool', 'imagefilter'] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

/**
 * What the plugin can be opened with: a 3D model the user imports (its id into `param`, its file name into `name`),
 * or the current selection, handed to the action `action` (an action with the input selection) when the dialog opens
 */
export type PluginInput = { kind: 'model3d'; param: string; name?: string } | { kind: 'selection'; action: string };

/**
 * Context a generator may ask the app for with host.context (#386): the material of the layer the part goes on
 * (name, thickness, kerf) and the work area of the machine (width and height in mm)
 */
export const PLUGIN_CONTEXTS = ['material', 'workArea'] as const;
export type PluginContext = (typeof PLUGIN_CONTEXTS)[number];

export class ManifestError extends Error {}

/**
 * Version of the dialog schema (#335). Version 1: fields with labels, tooltips, options, the main area, named
 * sections and „Advanced“, showIf rules, preview, info table and issue list. Version 2: lists of rows in a data
 * parameter (text, number and choice columns, an outline picture, remove) and action buttons with inputs
 * (selection, an image file, the camera image) and a number field next to a button. Version 3: a drawing surface
 * (draw, onSurface) with views, selectable rows and row buttons in lists, placeholders for number columns, and
 * conditions on action buttons. A plugin that needs a newer schema is refused with an update hint instead of being
 * shown half-broken.
 */
export const DIALOG_VERSION = 5;
const MAX_STEPS = 8;
const MAX_VIEWS = 6;
const MAX_ROW_ACTIONS = 4;
const MAX_LISTS = 4;
const MAX_COLUMNS = 8;
const MAX_ACTIONS = 8;
const INPUTS = ['selection', 'image', 'selectedImage', 'camera'] as const;

const ID_RE = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const TEXT_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** Toolbox group, tile id or version of a tile */
const TILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}$/;
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
    if (type === 'data' && v.resource !== undefined) {
      if (v.resource !== 'model3d' && v.resource !== 'image') throw new ManifestError(t('{where}: unbekannte Ressource „{kind}“', { where: at, kind: String(v.resource) }));
      return { ...base, type, def: v.def, resource: v.resource };
    }
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
    const out: GenColumn = { ...base, type: v.type, min, max };
    if (v.placeholder !== undefined) out.placeholder = textKey(v.placeholder, at);
    return out;
  }
  if (v.type === 'enum') {
    if (!Array.isArray(v.options) || !v.options.length || v.options.length > MAX_OPTIONS) throw new ManifestError(t('{where}: „options“ muss 1 bis {n} Einträge haben', { where: at, n: MAX_OPTIONS }));
    const options = v.options.map((o): [string | number, string] => {
      if (!Array.isArray(o) || o.length !== 2 || !(typeof o[0] === 'string' || isNum(o[0]))) throw new ManifestError(t('{where}: ungültige Auswahl', { where: at }));
      return [o[0], textKey(o[1], at)];
    });
    return { ...base, type: 'enum', options };
  }
  if (v.type === 'color') return { ...base, type: 'color', ...(v.readonly === true ? { readonly: true } : {}) };
  throw new ManifestError(t('{where}: unbekannter Typ „{type}“', { where: at, type: String(v.type) }));
}

/**
 * Lists, actions (schema version 2), the surface (version 3), images kept with the project (version 4), steps,
 * sortable lists and colour columns (version 5) of a dialog
 */
function dialogParts(d: Record<string, unknown>, schema: ParamSpec[], keys: Set<string>): { lists?: GenList[]; actions?: GenAction[]; surface?: GenSurface; steps?: GenStep[] } {
  const out: { lists?: GenList[]; actions?: GenAction[]; surface?: GenSurface; steps?: GenStep[] } = {};
  const v3 = (d.version as number) >= 3;
  const needs3 = (at: string) => {
    if (!v3) throw new ManifestError(t('{where}: braucht „dialog“ Version 3', { where: at }));
  };
  const needs = (n: number, at: string) => {
    if ((d.version as number) < n) throw new ManifestError(t('{where}: braucht „dialog“ Version {n}', { where: at, n }));
  };
  const needs4 = (at: string) => needs(4, at);
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
      if (l.select === true) (needs3(at), (list.select = true));
      if (l.rowActions !== undefined) {
        needs3(at);
        if (!Array.isArray(l.rowActions) || l.rowActions.length > MAX_ROW_ACTIONS) throw new ManifestError(t('ungültige Angabe „dialog“'));
        list.rowActions = l.rowActions.map((a, k) => {
          const ra = `${at}.rowActions[${k}]`;
          if (!isObj(a) || typeof a.id !== 'string' || !KEY_RE.test(a.id)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where: ra }));
          return { id: a.id, label: textKey(a.label ?? a.id, ra), ...(a.title !== undefined ? { title: textKey(a.title, ra) } : {}) };
        });
      }
      if (list.columns.some((c) => c.type !== 'text' && c.type !== 'enum' && c.type !== 'color' && c.placeholder)) needs3(at);
      if (list.columns.some((c) => c.type === 'color')) needs(5, at);
      if (l.sort === true) (needs(5, at), (list.sort = true));
      if (l.fixedLast !== undefined) {
        if (!list.sort || !isNum(l.fixedLast) || !Number.isInteger(l.fixedLast) || l.fixedLast < 0 || l.fixedLast > 100) throw new ManifestError(t('{where}: „fixedLast“ braucht „sort“ und eine Zahl von 0 bis 100', { where: at }));
        list.fixedLast = l.fixedLast as number;
      }
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
        if (act.inputs.includes('selectedImage')) needs4(at);
      }
      if (a.store !== undefined) {
        needs4(at);
        const f = schema.find((s) => s.key === a.store);
        if (!f || f.type !== 'data' || f.resource !== 'image' || !act.inputs?.some((x) => x === 'image' || x === 'selectedImage'))
          throw new ManifestError(t('{where}: „store“ muss ein data-Parameter mit „resource“: „image“ sein, und die Aktion braucht ein Bild', { where: at }));
        act.store = f.key;
      }
      if (a.field !== undefined) {
        const f = schema.find((s) => s.key === a.field);
        if (!f || !(f.type === 'number' || f.type === 'length' || f.type === 'int' || f.type === 'angle')) throw new ManifestError(t('{where}: „field“ muss ein Zahlen-Parameter sein', { where: at }));
        act.field = f.key;
      }
      if (a.showIf !== undefined) (needs3(at), (act.showIf = rule(a.showIf, keys, at)));
      return act;
    });
  }
  if (d.surface !== undefined) {
    needs3('surface');
    const sf = d.surface;
    if (!isObj(sf) || !Array.isArray(sf.views) || !sf.views.length || sf.views.length > MAX_VIEWS) throw new ManifestError(t('ungültige Angabe „dialog“'));
    const surface: GenSurface = {
      views: sf.views.map((v, i) => {
        const at = `surface.views[${i}]`;
        if (!isObj(v) || typeof v.id !== 'string' || !KEY_RE.test(v.id)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where: at }));
        return { id: v.id, label: textKey(v.label ?? v.id, at) };
      }),
    };
    if (sf.height !== undefined) {
      if (!isNum(sf.height) || sf.height < 100 || sf.height > 800) throw new ManifestError(t('ungültige Angabe „dialog“'));
      surface.height = Math.round(sf.height);
    }
    if (sf.help !== undefined) surface.help = textKey(sf.help, 'surface');
    out.surface = surface;
  }
  if (d.steps !== undefined) {
    needs(5, 'steps');
    if (!Array.isArray(d.steps) || d.steps.length < 2 || d.steps.length > MAX_STEPS) throw new ManifestError(t('{where}: 2 bis {n} Schritte', { where: 'steps', n: MAX_STEPS }));
    // Every field, list, action and the surface may appear in one step at most
    const known = new Set([...schema.filter((s) => s.type !== 'data').map((s) => s.key), ...(out.lists ?? []).map((l) => l.param), ...(out.actions ?? []).map((a) => a.id), ...(out.surface ? ['surface'] : [])]);
    const used = new Set<string>();
    out.steps = d.steps.map((st, i) => {
      const at = `steps[${i}]`;
      if (!isObj(st) || typeof st.id !== 'string' || !KEY_RE.test(st.id)) throw new ManifestError(t('{where}: Kennung fehlt oder ist ungültig', { where: at }));
      if (!Array.isArray(st.items)) throw new ManifestError(t('ungültige Angabe „dialog“'));
      const items = st.items.map((x) => {
        if (typeof x !== 'string' || !known.has(x) || used.has(x)) throw new ManifestError(t('{where}: „{item}“ ist kein Feld, keine Liste, keine Aktion oder schon in einem Schritt', { where: at, item: String(x) }));
        used.add(x);
        return x;
      });
      return { id: st.id, label: textKey(st.label ?? st.id, at), items };
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
    const type = raw.type as PluginType;
    if (!(PLUGIN_TYPES as readonly unknown[]).includes(type)) fail(t('unbekannte Art „{type}“', { type: String(raw.type) }));
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
    const m: PluginManifest = { id, version: version as number, api: api as number, type, kind: kind as 'part' | 'assembly', runtime: runtime as Runtime, code, sha256: sum, schema, texts: tx };
    if (typeof raw.icon === 'string' && /^[a-zA-Z][a-zA-Z0-9-]{0,40}$/.test(raw.icon)) m.icon = raw.icon;
    if (isObj(raw.preview) && raw.preview.center === true) m.preview = { center: true };
    // Lists, actions, the surface and inputs belong to the generator dialog; a tool has fields only
    if (type !== 'generator' && (raw.inputs !== undefined || (isObj(raw.dialog) && (raw.dialog.lists !== undefined || raw.dialog.actions !== undefined || raw.dialog.surface !== undefined))))
      fail(t('Listen, Aktionen, Zeichenfläche und Eingaben gibt es nur bei Generatoren'));
    if (raw.host !== undefined) {
      if (!Array.isArray(raw.host) || !raw.host.every((x) => typeof x === 'string' && (HOST_FNS as readonly string[]).includes(x)))
        fail(t('unbekannte Host-Funktion in „host“ (erlaubt: {list})', { list: HOST_FNS.join(', ') }));
      if ((raw.host as string[]).length) m.host = [...new Set(raw.host as string[])];
    }
    if (raw.network !== undefined) {
      if (!Array.isArray(raw.network) || !raw.network.length || raw.network.length > MAX_NET_HOSTS) fail(t('ungültige Angabe „network“'));
      m.network = (raw.network as unknown[]).map((x, i) => netHost(x, `network[${i}]`));
      if (new Set(m.network.map((x) => x.id)).size !== m.network.length) fail(t('ungültige Angabe „network“'));
      if (!m.host?.includes('fetch')) fail(t('„network“ braucht die Host-Funktion „fetch“'));
    } else if (m.host?.includes('fetch')) fail(t('„network“ braucht die Host-Funktion „fetch“'));
    if (type !== 'generator' && (raw.fit !== undefined || raw.assemblyCheck !== undefined || raw.tile !== undefined)) fail(t('ungültige Angabe „{key}“', { key: 'fit/assemblyCheck/tile' }));
    if (raw.fit !== undefined) {
      const f = raw.fit;
      const play = isObj(f) ? schema.find((s) => s.key === f.play) : undefined;
      if (!isObj(f) || (f.kind !== 'pair' && f.kind !== 'slot') || !play || !(NUMERIC as readonly string[]).includes(play.type)) fail(t('ungültige Angabe „{key}“', { key: 'fit' }));
      m.fit = { kind: (f as { kind: 'pair' | 'slot' }).kind, play: play!.key };
    }
    if (raw.assemblyCheck !== undefined) {
      if (typeof raw.assemblyCheck !== 'boolean') fail(t('ungültige Angabe „{key}“', { key: 'assemblyCheck' }));
      if (raw.assemblyCheck) m.assemblyCheck = true;
    }
    if (raw.tile !== undefined) {
      const tl = raw.tile;
      const ok = (x: unknown) => x === undefined || (typeof x === 'string' && TILE_RE.test(x));
      if (!isObj(tl) || typeof tl.group !== 'string' || !TILE_RE.test(tl.group) || !ok(tl.before) || !ok(tl.since)) fail(t('ungültige Angabe „{key}“', { key: 'tile' }));
      const x = tl as { group: string; before?: string; since?: string };
      m.tile = { group: x.group, ...(x.before ? { before: x.before } : {}), ...(x.since ? { since: x.since } : {}) };
    }
    if (isObj(raw.dialog) && (raw.dialog.lists !== undefined || raw.dialog.actions !== undefined || raw.dialog.surface !== undefined)) {
      if ((raw.dialog.version as number) < 2) fail(t('Listen und Aktionen brauchen „dialog“ Version 2'));
      Object.assign(m, dialogParts(raw.dialog, schema, keys));
    }
    if (raw.inputs !== undefined) {
      if (!Array.isArray(raw.inputs) || raw.inputs.length > 4) fail(t('ungültige Angabe „inputs“'));
      m.inputs = (raw.inputs as unknown[]).map((x, i): PluginInput => {
        const at = `inputs[${i}]`;
        // The selection goes to an action that takes it (the same answer as pressing its button)
        if (isObj(x) && x.kind === 'selection') {
          const a = m.actions?.find((y) => y.id === x.action);
          if (!a?.inputs?.includes('selection')) return fail(t('{where}: „action“ muss eine Aktion mit der Eingabe „selection“ sein', { where: at }));
          return { kind: 'selection', action: a.id };
        }
        if (!isObj(x) || x.kind !== 'model3d') return fail(t('{where}: unbekannte Eingabe', { where: at }));
        const param = schema.find((s) => s.key === x.param);
        if (!param || param.type !== 'data' || param.resource !== 'model3d') return fail(t('{where}: „param“ muss ein data-Parameter mit „resource“: „model3d“ sein', { where: at }));
        const out: PluginInput = { kind: 'model3d', param: param.key };
        if (x.name !== undefined) {
          const n = schema.find((s) => s.key === x.name);
          if (!n || (n.type !== 'data' && n.type !== 'text')) return fail(t('{where}: „name“ muss ein Text-Parameter sein', { where: at }));
          out.name = n.key;
        }
        return out;
      });
    }
    if (raw.context !== undefined) {
      if (type !== 'generator' || !Array.isArray(raw.context) || !raw.context.every((x) => (PLUGIN_CONTEXTS as readonly unknown[]).includes(x)))
        fail(t('unbekannter Kontext in „context“ (erlaubt: {list})', { list: PLUGIN_CONTEXTS.join(', ') }));
      const ctx = [...new Set(raw.context as PluginContext[])];
      if (ctx.length) {
        m.context = ctx;
        m.host = [...new Set([...(m.host ?? []), 'context'])];
      }
    }
    if (m.host?.includes('context') && !m.context) fail(t('„context“ fehlt für die Host-Funktion „context“'));
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
