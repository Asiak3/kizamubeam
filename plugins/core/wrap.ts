// Turns a built-in generator (src/generators) into a plugin: validate and generate with JSON in and out, issue
// texts and info labels as text codes. Bundled together with the generator by scripts/build-core-plugins.ts.
import type { Generator, Params } from '../../src/generators/types';
import { unmark } from './i18n-shim';
import { codeOf } from './codes';

const code = (s: string) => {
  const m = unmark(s);
  return m ? { code: codeOf(m.de), values: m.values } : { code: s };
};

export function wrap(g: Generator) {
  (globalThis as unknown as { plugin: unknown }).plugin = {
    validate(p: Params) {
      return g.validate(p).map((i) => {
        const c = i.code ? { code: i.code } : code(i.msg);
        return { ...(i.key ? { key: i.key } : {}), level: i.level, ...c };
      });
    },
    generate(p: Params) {
      const r = g.generate(p);
      const poses = g.poses?.(p, Number(p.thickness) || 3) ?? null;
      return {
        parts: r.parts,
        info: r.info.map(([k, v]) => [code(k).code, v]),
        ...(poses ? { poses } : {}),
      };
    },
  };
}
