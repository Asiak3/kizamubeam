// Turns a built-in generator (src/generators) into a plugin: validate and generate with JSON in and out, issue
// texts, info rows and labels as text codes. Bundled together with the generator by scripts/build-core-plugins.mjs.
import type { GenDrawRequest, GenEvent, GenEventResult, Generator, GenItem, GenPointer, GenSurfaceState, Params, ParamValue } from '../../src/generators/types';
import { fromBase64, type PluginImage, type PluginText } from '../../src/plugins/contract';
import { pieces, type Piece } from './i18n-shim';
import { codeOf } from './codes';
import { registerMesh } from '../../src/model3d/store';

const image = (im: PluginImage) => ({ width: im.width, height: im.height, data: fromBase64(im.data) });

/** Action inputs as the generator gets them in the app: images as bytes again */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function appInputs(inp: Record<string, any>): GenEvent['inputs'] {
  const out: GenEvent['inputs'] = {};
  if (inp.selection) out.selection = inp.selection;
  if (inp.image) out.image = { ...image(inp.image), name: String(inp.image.name ?? '') };
  if (inp.camera) out.camera = { ...image(inp.camera), bed: inp.camera.bed, ...(inp.camera.empty ? { empty: image(inp.camera.empty) } : {}) };
  return out;
}

const piece = (p: Piece): PluginText => {
  if (typeof p === 'string') return p;
  const out: { code: string; values?: Record<string, PluginText | number> } = { code: codeOf(p.de) };
  if (p.values) out.values = Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, typeof v === 'number' ? v : text(v)]));
  return out;
};
const text = (list: Piece[]): PluginText => (list.length === 1 ? piece(list[0]) : list.map(piece));
/** A string from the generator as a plugin text (plain, one code or a list) */
const toText = (s: string) => text(pieces(s));

// QuickJS has no structuredClone; the generators only clone plain data
const gt = globalThis as unknown as { structuredClone?: <T>(v: T) => T };
gt.structuredClone ??= <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** An answer of onEvent or onSurface as JSON: texts as codes */
function answer(r: GenEventResult | void | Promise<unknown>) {
  if (!r || r instanceof Promise) return null;
  return {
    ...(r.patch ? { patch: r.patch } : {}),
    ...(r.message !== undefined ? { message: toText(r.message) } : {}),
    ...(r.state !== undefined ? { state: r.state } : {}),
    ...(r.view !== undefined ? { view: r.view } : {}),
    ...(r.select ? { select: r.select } : {}),
  };
}
const item = (it: GenItem) => (it.type === 'text' ? { ...it, text: toText(it.text) } : it);

export function wrap(g: Generator) {
  (globalThis as unknown as { plugin: unknown }).plugin = {
    // Data a parameter names (a 3D model): kept in the generator's own model store, as in the app
    ...(g.schema.some((s) => s.type === 'data' && s.resource)
      ? {
          resource(r: { kind: string; id: string; data: string }) {
            if (r.kind === 'model3d' && !registerMesh(r.id, r.data)) throw new Error('bad-model');
            return null;
          },
        }
      : {}),
    validate(p: Params) {
      return g.validate(p).map((i) => {
        const tx = i.code ? { code: i.code } : toText(i.msg);
        const c = typeof tx === 'object' && !Array.isArray(tx) ? tx : { code: 'plugin-text', values: { text: tx } };
        return { ...(i.key ? { key: i.key } : {}), level: i.level, ...c };
      });
    },
    generate(p: Params) {
      const r = g.generate(p);
      const poses = g.poses?.(p, Number(p.thickness) || 3) ?? null;
      const labels: Record<string, PluginText> = {};
      if (g.kind === 'assembly') for (const part of r.parts) labels[part.key] = toText(g.label(p, part.key));
      return {
        parts: r.parts,
        info: r.info.map(([k, v]) => [toText(k), toText(v)]),
        label: toText(g.label(p)),
        ...(g.kind === 'assembly' ? { labels } : {}),
        ...(poses ? { poses } : {}),
      };
    },
    // Only generators that have them: the app then knows the plugin has no such function
    ...(g.migrate
      ? {
          // Parameters saved by an older version of the generator
          migrate(input: { params: Params; from: number }) {
            return g.migrate!(input.params, input.from);
          },
        }
      : {}),
    ...(g.view
      ? {
          view(p: Params) {
            const v = g.view!(p);
            return {
              ...(v.autoText ? { autoText: Object.fromEntries(Object.entries(v.autoText).map(([k, x]) => [k, toText(x)])) } : {}),
              ...(v.rows ? { rows: Object.fromEntries(Object.entries(v.rows).map(([k, x]) => [k, x.map(toText)])) } : {}),
              ...(v.rowAuto ? { rowAuto: Object.fromEntries(Object.entries(v.rowAuto).map(([k, x]) => [k, x.map(toText)])) } : {}),
            };
          },
        }
      : {}),
    ...(g.onEvent
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onEvent(input: { action: string; params: Params; inputs: Record<string, any>; row?: number; surface?: GenSurfaceState }) {
            const ev: GenEvent = { action: input.action, inputs: appInputs(input.inputs ?? {}) };
            if (input.row !== undefined) ev.row = input.row;
            if (input.surface) ev.surface = input.surface;
            return answer(g.onEvent!(ev, input.params));
          },
        }
      : {}),
    ...(g.draw
      ? {
          draw(input: GenDrawRequest & { params: Params }) {
            const { params, ...req } = input;
            const d = g.draw!(req, params);
            if (d instanceof Promise) return null;
            return { ...d, items: d.items.map(item), ...(d.layers ? { layers: d.layers.map((l) => (l.items ? { ...l, items: l.items.map(item) } : l)) } : {}) };
          },
        }
      : {}),
    ...(g.onSurface
      ? {
          onSurface(input: { event: GenPointer; surface: GenSurfaceState; params: Params }) {
            return answer(g.onSurface!(input.event, input.surface, input.params));
          },
        }
      : {}),
    ...(g.onChange
      ? {
          onChange(input: { key: string; old: ParamValue; params: Params }) {
            const r = g.onChange!(input.key, input.old, input.params);
            if (!r || r instanceof Promise) return null;
            return {
              ...(r.patch ? { patch: r.patch } : {}),
              ...(r.ask ? { ask: { question: toText(r.ask.question), options: r.ask.options.map((o) => ({ label: toText(o.label), patch: o.patch })) } } : {}),
            };
          },
        }
      : {}),
  };
}
