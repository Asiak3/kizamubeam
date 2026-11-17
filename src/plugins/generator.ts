// A generator whose computation runs in a plugin (issue #205). Generators are synchronous for the editor
// (buildGen, recomputation of formulas, the old layout of an assembly), plugins answer asynchronously from their
// Worker. The bridge is a small cache per plugin: prepare(params) computes validate and generate once, the
// synchronous functions read from the cache and report „being computed“ until the answer is there. Whoever shows
// a result (the dialog, formula recomputation) listens to onPluginResult and asks again.
import type { GenAction, GenChange, GenDrawing, GenEventResult, GenItem, GenList, GenResult, Generator, GenSurface, GenSurfaceResult, GenView, Params } from '../generators/types';
import type { AsmPoses } from '../generators/pose';
import { checkChange, checkDrawing, checkEvent, eventInputs, checkGenResult, checkIssues, checkView, ContractError, type PluginEventResult, type PluginFn, type PluginGenResult, type PluginIssue, type PluginItem, type PluginText, type PluginView } from './contract';
import { EngineError } from './engine';
import { inProcess, type PluginProcess } from './client';
import type { PluginManifest } from './manifest';
import { appCodeText, localNumbers, PENDING, pluginWords } from './words';
import { ICONS } from '../icons';

export { appCodeText, localNumbers, PENDING };

/** Starts the process of a plugin: a Worker in the app, the current thread in Node */
export type Spawn = (m: PluginManifest) => PluginProcess;
let spawn: Spawn = (m) => inProcess(m.runtime, m.code, m.host ?? []);
export const setPluginSpawn = (s: Spawn) => void (spawn = s);
/** Start a plugin's process the way the app does (generators and tools) */
export const spawnPlugin = (m: PluginManifest) => spawn(m);

/** Data of a resource the app keeps (a 3D model as `kzm1:` text), or null while it is not loaded */
export type ResourceSource = (kind: string, id: string) => string | null;
let resourceSource: ResourceSource = () => null;
export const setResourceSource = (s: ResourceSource) => void (resourceSource = s);

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

export function pluginGenerator(m: PluginManifest, pack: { id: string; name: string }, opts: { resource?: ResourceSource } = {}): PluginGenerator {
  const source: ResourceSource = (kind, id) => opts.resource?.(kind, id) ?? resourceSource(kind, id);
  let proc: PluginProcess | null = null;
  const cache = new Map<string, Entry>();
  const running = new Map<string, Promise<void>>();
  /** Names computed by the plugin, kept longer than the results (the Objects window lists every part) */
  const labels = new Map<string, { label?: PluginText; parts?: Record<string, PluginText> }>();
  const { text, name, codeText, render, label, issue, schema } = pluginWords(m);
  // Parameters that name a resource (a 3D model): the plugin gets its data before it computes
  const resourceParams = m.schema.filter((s) => s.type === 'data' && s.resource);
  /** Resources these parameters need and their data (null while the app has not loaded it) */
  const resourcesOf = (p: Params) =>
    resourceParams.flatMap((s) => {
      const id = String(p[s.key] ?? '');
      const kind = (s as { resource: string }).resource;
      return id ? [{ kind, id, data: source(kind, id) }] : [];
    });
  // A result computed while a model was missing is not the result once it has loaded
  const keyOf = (p: Params) => JSON.stringify([...m.schema.map((s) => p[s.key] ?? null), ...resourcesOf(p).map((r) => r.data !== null)]);
  const errorOf = (e: unknown) => (e instanceof EngineError ? e.code : e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'plugin-crash');

  /** Optional functions (view, onChange) the plugin turned out not to have: not called again */
  const missing = new Set<PluginFn>();
  /** Progress of the running computation (host.progress), shown with „being computed“ */
  let progress: { done: number; text?: string } | null = null;
  const start = (): PluginProcess => {
    const p = spawn(m);
    p.onProgress = (done, text) => {
      progress = { done, ...(text !== undefined ? { text } : {}) };
      listeners.forEach((f) => f(m.id));
    };
    return p;
  };
  const call = async <T>(fn: PluginFn, input: unknown, check: (v: unknown) => T): Promise<Outcome<T>> => {
    proc ??= start();
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
    for (const res of resourcesOf(p)) if (res.data !== null) (proc ??= start()).setResource({ kind: res.kind, id: res.id, data: res.data });
    r = (async () => {
      progress = null;
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
      progress = null;
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

  // Lists and actions (dialog schema 2): text keys become texts in the interface language
  const lists: GenList[] | undefined = m.lists?.map((l) => ({
    ...l,
    label: text(l.label) ?? l.label,
    ...(l.empty ? { empty: text(l.empty) ?? l.empty } : {}),
    ...(l.removeTitle ? { removeTitle: text(l.removeTitle) ?? l.removeTitle } : {}),
    ...(l.rowActions ? { rowActions: l.rowActions.map((a) => ({ id: a.id, label: text(a.label) ?? a.label, ...(a.title ? { title: text(a.title) ?? a.title } : {}) })) } : {}),
    columns: l.columns.map((c) => {
      const out = { ...c, label: text(c.label) ?? c.label, ...(c.title ? { title: text(c.title) ?? c.title } : {}) };
      if ('placeholder' in out && out.placeholder) out.placeholder = text(out.placeholder) ?? '';
      if (out.type === 'enum') out.options = out.options.map(([v, k]) => [v, text(k) ?? String(v)]);
      return out;
    }),
  }));
  const steps = m.steps?.map((st) => ({ ...st, label: text(st.label) ?? st.id }));
  const actions: GenAction[] | undefined = m.actions?.map((a) => ({ ...a, label: text(a.label) ?? a.label, ...(a.title ? { title: text(a.title) ?? a.title } : {}) }));
  const surface: GenSurface | undefined = m.surface && {
    ...m.surface,
    views: m.surface.views.map((v) => ({ id: v.id, label: text(v.label) ?? v.id })),
    ...(m.surface.help ? { help: text(m.surface.help) ?? '' } : {}),
  };
  /** An answer of onEvent or onSurface in the app's terms */
  const answer = (r: PluginEventResult): GenSurfaceResult => {
    const out: GenSurfaceResult = {};
    if (r.patch) out.patch = r.patch as Params;
    if (r.message !== undefined) out.message = render(r.message);
    if (r.state !== undefined) out.state = r.state;
    if (r.view !== undefined) out.view = r.view;
    if (r.select) out.select = r.select;
    return out;
  };
  const item = (it: PluginItem): GenItem => (it.type === 'text' ? { ...it, text: render(it.text) } : it);
  /** Resources the surface needs are sent like before computing */
  const sendResources = (p: Params) => {
    for (const res of resourcesOf(p)) if (res.data !== null) (proc ??= start()).setResource({ kind: res.kind, id: res.id, data: res.data });
  };

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
    ...(m.inputs?.length
      ? {
          inputs: m.inputs.map((x) => ({ kind: x.kind })),
          fromInputs(inp) {
            const x = m.inputs!.find((i) => i.kind === 'model3d');
            if (!x || !inp.model) return undefined;
            return { [x.param]: inp.model.id, ...(x.name ? { [x.name]: inp.model.name } : {}) };
          },
        }
      : {}),
    validate(p) {
      const e = entry(p);
      if (!e) {
        const pct = progress ? ` ${Math.round(progress.done * 100)} %${progress.text ? ` · ${localNumbers(progress.text)}` : ''}` : '';
        return [{ level: 'error', code: PENDING, msg: codeText(PENDING) + pct }];
      }
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
      if (v?.rowAuto) out.rowAuto = Object.fromEntries(Object.entries(v.rowAuto).map(([k, x]) => [k, x.map(render)]));
      return out;
    },
    ...(lists ? { lists } : {}),
    ...(steps ? { steps } : {}),
    ...(actions ? { actions } : {}),
    async onEvent(ev, p): Promise<GenEventResult | void> {
      sendResources(p);
      const input = { action: ev.action, params: { ...p }, inputs: eventInputs(ev.inputs), ...(ev.row !== undefined ? { row: ev.row } : {}), ...(ev.surface ? { surface: ev.surface } : {}) };
      const r = await call('onEvent', input, checkEvent);
      if (!('ok' in r)) return { message: codeText(r.error) };
      return answer(r.ok);
    },
    ...(surface
      ? {
          surface,
          async draw(req, p): Promise<GenDrawing> {
            sendResources(p);
            const r = await call('draw', { ...req, params: { ...p } }, checkDrawing);
            if (!('ok' in r)) throw new Error(r.error);
            const d = r.ok;
            return {
              frame: d.frame,
              items: d.items.map(item),
              ...(d.track ? { track: true } : {}),
              ...(d.layers ? { layers: d.layers.map(({ items, ...l }) => ({ ...l, ...(items ? { items: items.map(item) } : {}) })) } : {}),
            };
          },
          async onSurface(ev, st, p): Promise<GenSurfaceResult | void> {
            sendResources(p);
            const r = await call('onSurface', { event: ev, surface: st, params: { ...p } }, checkEvent);
            if (!('ok' in r)) return { message: codeText(r.error) };
            return answer(r.ok);
          },
        } satisfies Partial<Generator>
      : {}),
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
    cancel() {
      if (running.size) proc?.cancel();
    },
    recompute(p) {
      cache.delete(keyOf(p));
      void prepare(p);
    },
    openSession(p) {
      if (!missing.has('open')) void call('open', { ...p }, (v) => v);
    },
    closeSession() {
      if (proc && !missing.has('close')) void call('close', null, (v) => v);
    },
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
