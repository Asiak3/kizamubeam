// Turns a built-in generator (src/generators) into a plugin: validate and generate with JSON in and out, issue
// texts, info rows and labels as text codes. Bundled together with the generator by scripts/build-core-plugins.mjs.
import type { GenEvent, Generator, Params, ParamValue } from '../../src/generators/types';
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
    ...(g.view
      ? {
          view(p: Params) {
            const v = g.view!(p);
            return {
              ...(v.autoText ? { autoText: Object.fromEntries(Object.entries(v.autoText).map(([k, x]) => [k, toText(x)])) } : {}),
              ...(v.rows ? { rows: Object.fromEntries(Object.entries(v.rows).map(([k, x]) => [k, x.map(toText)])) } : {}),
            };
          },
        }
      : {}),
    ...(g.onEvent
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onEvent(input: { action: string; params: Params; inputs: Record<string, any> }) {
            const r = g.onEvent!({ action: input.action, inputs: appInputs(input.inputs ?? {}) }, input.params);
            if (!r || r instanceof Promise) return null;
            return { ...(r.patch ? { patch: r.patch } : {}), ...(r.message !== undefined ? { message: toText(r.message) } : {}) };
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
