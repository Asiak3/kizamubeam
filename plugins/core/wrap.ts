// Turns a built-in generator (src/generators) into a plugin: validate and generate with JSON in and out, issue
// texts, info rows and labels as text codes. Bundled together with the generator by scripts/build-core-plugins.mjs.
import type { Generator, Params } from '../../src/generators/types';
import type { PluginText } from '../../src/plugins/contract';
import { pieces, type Piece } from './i18n-shim';
import { codeOf } from './codes';

const piece = (p: Piece): PluginText => {
  if (typeof p === 'string') return p;
  const out: { code: string; values?: Record<string, PluginText | number> } = { code: codeOf(p.de) };
  if (p.values) out.values = Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, typeof v === 'number' ? v : text(v)]));
  return out;
};
const text = (list: Piece[]): PluginText => (list.length === 1 ? piece(list[0]) : list.map(piece));
/** A string from the generator as a plugin text (plain, one code or a list) */
const toText = (s: string) => text(pieces(s));

export function wrap(g: Generator) {
  (globalThis as unknown as { plugin: unknown }).plugin = {
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
  };
}
