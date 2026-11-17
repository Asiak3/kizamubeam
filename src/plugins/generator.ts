// A generator whose computation runs in a plugin (issue #205). Generators are synchronous for the editor
// (buildGen, recomputation of formulas, the old layout of an assembly), plugins answer asynchronously from their
// Worker. The bridge is a small cache per plugin: prepare(params) computes validate and generate once, the
// synchronous functions read from the cache and report „being computed“ until the answer is there. Whoever shows
// a result (the dialog, formula recomputation) listens to onPluginResult and asks again.
import type { GenResult, Generator, Issue, Params, ParamSpec } from '../generators/types';
import type { AsmPoses } from '../generators/pose';
import { checkGenResult, checkIssues, ContractError, type PluginGenResult, type PluginIssue } from './contract';
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

type Outcome<T> = { ok: T } | { error: string };
interface Entry {
  validate: Outcome<PluginIssue[]>;
  generate?: Outcome<PluginGenResult>;
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

export function pluginGenerator(m: PluginManifest, pack: { id: string; name: string }): PluginGenerator {
  let proc: PluginProcess | null = null;
  const cache = new Map<string, Entry>();
  const running = new Map<string, Promise<void>>();
  const text = (key: string, values?: Record<string, string | number>) => pluginText(m.texts, lang, key, values);
  const name = text('name') ?? m.id;
  const keyOf = (p: Params) => JSON.stringify(m.schema.map((s) => p[s.key] ?? null));
  const codeText = (code: string, values?: Record<string, string | number>) =>
    appCodeText(code, name) ?? text(code, values) ?? t('Fehler in der Erweiterung „{name}“: {code}', { name, code });
  const issue = (i: PluginIssue): Issue => ({ ...(i.key ? { key: i.key } : {}), level: i.level, code: i.code, msg: codeText(i.code, i.values) });
  const errorOf = (e: unknown) => (e instanceof EngineError ? e.code : e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'plugin-crash');

  const call = async <T>(fn: 'validate' | 'generate', p: Params, check: (v: unknown) => T): Promise<Outcome<T>> => {
    proc ??= spawn(m);
    try {
      return { ok: check(await proc.call(fn, p)) };
    } catch (e) {
      return { error: errorOf(e) };
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
      const v = entry.validate;
      // A part generator makes exactly one part (assemblies any number)
      const check = (x: unknown) => {
        const r = checkGenResult(x);
        if (m.kind === 'part' && r.parts.length !== 1) throw new ContractError('plugin-bad-output', 'a part generator must return exactly one part');
        return r;
      };
      if ('ok' in v && !v.ok.some((i) => i.level === 'error')) entry.generate = await call('generate', input, check);
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
      const out: GenResult = { parts: r.ok.parts.map((x) => ({ ...x })), info: r.ok.info.map(([k, v]) => [text(k) ?? k, v]) };
      if (r.ok.plan) out.plan = r.ok.plan;
      return out;
    },
    poses(p): AsmPoses | null {
      const r = cache.get(keyOf(p))?.generate;
      return r && 'ok' in r ? (r.ok.poses ?? null) : null;
    },
    label(p, part) {
      const values = Object.fromEntries(m.schema.map((s) => [s.key, typeof p[s.key] === 'number' ? Math.round((p[s.key] as number) * 100) / 100 : String(p[s.key])]));
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
    },
  };
  return g;
}

export const isPluginGenerator = (g: Generator | undefined): g is PluginGenerator => !!g && typeof (g as PluginGenerator).prepare === 'function' && !!(g as PluginGenerator).manifest;
