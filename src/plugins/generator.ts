// A generator whose computation runs in a plugin (issue #205). Generators are synchronous for the editor
// (buildGen, recomputation of formulas, the old layout of an assembly), plugins answer asynchronously from their
// Worker. The bridge is a small cache per plugin: prepare(params) computes validate and generate once, the
// synchronous functions read from the cache and report „being computed“ until the answer is there. Whoever shows
// a result (the dialog, formula recomputation) listens to onPluginResult and asks again.
import type { GenAction, GenChange, GenEventResult, GenList, GenResult, Generator, GenView, Issue, Params, ParamSpec } from '../generators/types';
import type { AsmPoses } from '../generators/pose';
import { checkChange, checkEvent, checkGenResult, checkIssues, checkView, ContractError, type PluginFn, type PluginGenResult, type PluginIssue, type PluginText, type PluginView } from './contract';
import { EngineError } from './engine';
import { inProcess, type PluginProcess } from './client';
import { pluginText, type PluginManifest } from './manifest';
import { lang, t } from '../i18n';
import { ICONS } from '../icons';

/** Issue code while a plugin is still computing these parameters */
export const PENDING = 'plugin-pending';

/** Starts the process of a plugin: a Worker in the app, the current thread in Node */
export type Spawn = (m: PluginManifest) => PluginProcess;
let spawn: Spawn = (m) => inProcess(m.runtime, m.code);
export const setPluginSpawn = (s: Spawn) => void (spawn = s);

const listeners = new Set<(id: string) => void>();
/** Called with the generator id whenever a plugin answer arrives; returns the function that stops listening */
export function onPluginResult(f: (id: string) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Answers kept per plugin (parameter sets); the dialog and the editor rarely need more than the last few */
const CACHE = 24;
/** Names computed by the plugin (small, so kept for many more parameter sets) */
const LABELS = 2000;

type Outcome<T> = { ok: T } | { error: string };
interface Entry {
  validate: Outcome<PluginIssue[]>;
  generate?: Outcome<PluginGenResult>;
  /** Answer of view(), when the plugin has it */
  view?: PluginView;
}

export interface PluginGenerator extends Generator {
  /** Pack that installed the plugin (its name for messages) */
  pack: { id: string; name: string };
  manifest: PluginManifest;
  /** Tooltip and search words of its toolbox tile (group „From extensions“; no Generator.tile, the toolbox adds it) */
  desc: string;
  keys: string;
  /** Compute validate and, without errors, generate for these parameters (normalised) */
  prepare(p: Params): Promise<void>;
  dispose(): void;
}

/** Messages for the codes the app itself reports about a plugin */
export function appCodeText(code: string, name: string): string | undefined {
  switch (code) {
    case PENDING:
      return t('Wird berechnet …');
    case 'plugin-timeout':
      return t('Die Erweiterung „{name}“ hat zu lange gerechnet.', { name });
    case 'plugin-memory':
      return t('Die Erweiterung „{name}“ hat zu viel Speicher gebraucht.', { name });
    case 'plugin-crash':
    case 'plugin-bad-code':
    case 'plugin-imports':
    case 'plugin-too-large':
    case 'plugin-newer-api':
      return t('Die Erweiterung „{name}“ lässt sich nicht ausführen ({code}).', { name, code });
    case 'plugin-bad-output':
      return t('Die Erweiterung „{name}“ hat ungültige Geometrie geliefert.', { name });
    case 'plugin-no-function':
      return t('Der Erweiterung „{name}“ fehlt eine Funktion.', { name });
  }
  return undefined;
}

/**
 * Numbers in texts from a plugin in the number format of the interface: plugins have no locale (QuickJS writes
 * 1234.5), the built-in generators use toLocaleString. Decimal numbers inside a text („⌀ 12.5 mm“) are converted.
 */
export function localNumbers(s: string): string {
  // Decimal numbers, and whole numbers from 1000 (digit grouping); not inside words or codes like „M3000“
  return s.replace(/(?<![\w.,])-?(?:\d+\.\d+|\d{4,})(?![\w.,]?\w)/g, (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }));
}
/** Number values: whole numbers as they are (like t() in the app: „z=1000“), decimals in the user's format */
const localNumber = (x: number) => (Number.isInteger(x) ? String(x) : x.toLocaleString(undefined, { maximumFractionDigits: 6 }));

export function pluginGenerator(m: PluginManifest, pack: { id: string; name: string }): PluginGenerator {
  let proc: PluginProcess | null = null;
  const cache = new Map<string, Entry>();
  const running = new Map<string, Promise<void>>();
  /** Names computed by the plugin, kept longer than the results (the Objects window lists every part) */
  const labels = new Map<string, { label?: PluginText; parts?: Record<string, PluginText> }>();
  const text = (key: string, values?: Record<string, string | number>) => pluginText(m.texts, lang, key, values);
  const name = text('name') ?? m.id;
  const keyOf = (p: Params) => JSON.stringify(m.schema.map((s) => p[s.key] ?? null));
  const codeText = (code: string, values?: Record<string, string | number>) =>
    appCodeText(code, name) ?? text(code, values) ?? t('Fehler in der Erweiterung „{name}“: {code}', { name, code });
  const values = (v?: Record<string, PluginText | number>) => v && Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' ? localNumber(x) : render(x)]));
  /** A plugin text in the interface language */
  const render = (x: PluginText): string => (typeof x === 'string' ? localNumbers(x) : Array.isArray(x) ? x.map(render).join('') : codeText(x.code, values(x.values)));
  /** A plain text that names a code (info labels of older plugins) is shown as that text */
  const label = (x: PluginText) => (typeof x === 'string' ? (text(x) ?? x) : render(x));
  const issue = (i: PluginIssue): Issue => ({
    ...(i.key ? { key: i.key } : {}),
    level: i.level,
    code: i.code,
    msg: i.code === 'plugin-text' && i.values?.text !== undefined && typeof i.values.text !== 'number' ? render(i.values.text) : codeText(i.code, values(i.values)),
  });
  const errorOf = (e: unknown) => (e instanceof EngineError ? e.code : e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'plugin-crash');

  /** Optional functions (view, onChange) the plugin turned out not to have: not called again */
  const missing = new Set<PluginFn>();
  const call = async <T>(fn: PluginFn, input: unknown, check: (v: unknown) => T): Promise<Outcome<T>> => {
    proc ??= spawn(m);
    try {
      return { ok: check(await proc.call(fn, input)) };
    } catch (e) {
      const code = errorOf(e);
      if (code === 'plugin-no-function') missing.add(fn);
      return { error: code };
    }
  };

  const remember = (k: string, e: Entry) => {
    cache.delete(k);
    cache.set(k, e);
    while (cache.size > CACHE) cache.delete(cache.keys().next().value!);
  };

  const prepare = (p: Params): Promise<void> => {
    const k = keyOf(p);
    if (cache.has(k)) return Promise.resolve();
    let r = running.get(k);
    if (r) return r;
    const input = { ...p };
    r = (async () => {
      const entry: Entry = { validate: await call('validate', input, checkIssues) };
      if (!missing.has('view')) {
        const v = await call('view', input, checkView);
        if ('ok' in v) entry.view = v.ok;
      }
      const v = entry.validate;
      // A part generator makes exactly one part (assemblies any number)
      const check = (x: unknown) => {
        const r = checkGenResult(x);
        if (m.kind === 'part' && r.parts.length !== 1) throw new ContractError('plugin-bad-output', 'a part generator must return exactly one part');
        return r;
      };
      if ('ok' in v && !v.ok.some((i) => i.level === 'error')) entry.generate = await call('generate', input, check);
      const gen = entry.generate;
      if (gen && 'ok' in gen && (gen.ok.label !== undefined || gen.ok.labels)) {
        labels.delete(k);
        labels.set(k, { label: gen.ok.label, parts: gen.ok.labels });
        while (labels.size > LABELS) labels.delete(labels.keys().next().value!);
      }
      remember(k, entry);
    })().finally(() => {
      running.delete(k);
      listeners.forEach((f) => f(m.id));
    });
    running.set(k, r);
    return r;
  };

  /** Cached entry, or start computing it */
  const entry = (p: Params): Entry | undefined => {
    const e = cache.get(keyOf(p));
    if (!e) void prepare(p);
    return e;
  };

  const schema: ParamSpec[] = m.schema.map((s) => {
    const label = text(s.key) ?? s.key;
    const title = text(`${s.key}.title`);
    const out = { ...s, label, ...(title ? { title } : {}) } as ParamSpec;
    if (out.section) out.section = text(out.section) ?? out.section;
    if (out.type === 'enum') out.options = out.options.map(([v, k]) => [v, text(k) ?? v]);
    return out;
  });

  // Lists and actions (dialog schema 2): text keys become texts in the interface language
  const lists: GenList[] | undefined = m.lists?.map((l) => ({
    ...l,
    label: text(l.label) ?? l.label,
    ...(l.empty ? { empty: text(l.empty) ?? l.empty } : {}),
    ...(l.removeTitle ? { removeTitle: text(l.removeTitle) ?? l.removeTitle } : {}),
    columns: l.columns.map((c) => {
      const out = { ...c, label: text(c.label) ?? c.label, ...(c.title ? { title: text(c.title) ?? c.title } : {}) };
      if (out.type === 'enum') out.options = out.options.map(([v, k]) => [v, text(k) ?? String(v)]);
      return out;
    }),
  }));
  const actions: GenAction[] | undefined = m.actions?.map((a) => ({ ...a, label: text(a.label) ?? a.label, ...(a.title ? { title: text(a.title) ?? a.title } : {}) }));

  const texts: Record<string, () => string> = { [PENDING]: () => codeText(PENDING) };
  for (const c of ['plugin-timeout', 'plugin-memory', 'plugin-crash', 'plugin-bad-output', 'plugin-no-function']) texts[c] = () => codeText(c);

  const desc = text('desc') ?? '';
  const g: PluginGenerator = {
    id: m.id,
    version: m.version,
    kind: m.kind,
    name,
    icon: m.icon && ICONS[m.icon] ? m.icon : 'packs',
    schema,
    pack,
    ext: pack.name,
    manifest: m,
    texts: new Proxy(texts, { get: (o, code: string) => o[code] ?? (() => codeText(code)) }),
    ...(m.preview ? { preview: m.preview } : {}),
    validate(p) {
      const e = entry(p);
      if (!e) return [{ level: 'error', code: PENDING, msg: codeText(PENDING) }];
      return 'ok' in e.validate ? e.validate.ok.map(issue) : [{ level: 'error', code: e.validate.error, msg: codeText(e.validate.error) }];
    },
    generate(p): GenResult {
      const r = entry(p)?.generate;
      if (!r) throw new Error(PENDING);
      if ('error' in r) throw new Error(r.error);
      const out: GenResult = { parts: r.ok.parts.map((x) => ({ ...x })), info: r.ok.info.map(([k, v]) => [label(k), render(v)]) };
      if (r.ok.plan) out.plan = r.ok.plan;
      return out;
    },
    view(p): GenView {
      const v = entry(p)?.view;
      const out: GenView = {};
      if (v?.autoText) out.autoText = Object.fromEntries(Object.entries(v.autoText).map(([k, x]) => [k, render(x)]));
      if (v?.rows) out.rows = Object.fromEntries(Object.entries(v.rows).map(([k, x]) => [k, x.map(render)]));
      return out;
    },
    ...(lists ? { lists } : {}),
    ...(actions ? { actions } : {}),
    async onEvent(ev, p): Promise<GenEventResult | void> {
      const r = await call('onEvent', { action: ev.action, params: { ...p }, inputs: ev.inputs }, checkEvent);
      if (!('ok' in r)) return { message: codeText(r.error) };
      const out: GenEventResult = {};
      if (r.ok.patch) out.patch = r.ok.patch as Params;
      if (r.ok.message !== undefined) out.message = render(r.ok.message);
      return out;
    },
    async onChange(key, old, p): Promise<GenChange | void> {
      if (missing.has('onChange')) return;
      const r = await call('onChange', { key, old, params: { ...p } }, checkChange);
      if (!('ok' in r)) return;
      const { patch, ask } = r.ok;
      if (!patch && !ask) return;
      return {
        ...(patch ? { patch: patch as Params } : {}),
        ...(ask ? { ask: { question: render(ask.question), options: ask.options.map((o) => ({ label: render(o.label), patch: o.patch as Params })) } } : {}),
      };
    },
    poses(p): AsmPoses | null {
      const r = cache.get(keyOf(p))?.generate;
      return r && 'ok' in r ? (r.ok.poses ?? null) : null;
    },
    label(p, part) {
      // A name the plugin computed for these parameters, otherwise the manifest text with parameter values
      const known = labels.get(keyOf(p));
      const own = known && (part ? known.parts?.[part] : known.label);
      if (own !== undefined) return render(own);
      const values = Object.fromEntries(
        m.schema.map((s) => [s.key, typeof p[s.key] === 'number' ? (p[s.key] as number).toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(p[s.key])]),
      );
      const base = text('label', values) ?? name;
      return part ? `${base} · ${text(`part.${part}`) ?? part}` : base;
    },
    desc,
    keys: text('keys') ?? '',
    prepare,
    dispose() {
      proc?.dispose();
      proc = null;
      cache.clear();
      labels.clear();
    },
  };
  return g;
}

export const isPluginGenerator = (g: Generator | undefined): g is PluginGenerator => !!g && typeof (g as PluginGenerator).prepare === 'function' && !!(g as PluginGenerator).manifest;
