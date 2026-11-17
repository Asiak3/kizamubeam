// Stand-in for src/i18n inside a core generator built as a plugin: a plugin has no language. t() returns a marker
// with the German source text and the values; the wrapper (wrap.ts) turns it into a text code plus values, and the
// app shows the text from the manifest in the interface language. Markers are closed by END, so a text can hold
// several of them (`${label} (${t('Rad 1')})`) and values can be markers themselves.
export const MARK = '\u0001';
export const VALS = '\u0002';
export const END = '\u0003';
export function t(de: string, vars?: Record<string, string | number>): string {
  return MARK + de + (vars ? VALS + JSON.stringify(vars) : '') + END;
}
export const tn = (one: string, other: string, n: number, vars?: Record<string, string | number>) => t(n === 1 ? one : other, { n, ...vars });
export const lang = 'en';
export const locale = 'en-US';
export const dec = (s: string) => s;
export const localText = (v: unknown) => (typeof v === 'string' ? v : '');

/** A text with markers, split up: plain strings and markers (source text and values, which may hold markers again) */
export type Piece = string | { de: string; values?: Record<string, number | Piece[]> };

/** Split a text with markers into pieces; a text without markers is one plain piece */
export function pieces(s: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf(MARK, i);
    if (a < 0) {
      out.push(s.slice(i));
      break;
    }
    if (a > i) out.push(s.slice(i, a));
    const e = s.indexOf(END, a);
    const body = s.slice(a + 1, e < 0 ? s.length : e);
    const v = body.indexOf(VALS);
    if (v < 0) out.push({ de: body });
    else {
      const raw = JSON.parse(body.slice(v + 1)) as Record<string, string | number>;
      const values: Record<string, number | Piece[]> = {};
      for (const [k, x] of Object.entries(raw)) values[k] = typeof x === 'number' ? x : pieces(String(x));
      out.push({ de: body.slice(0, v), values });
    }
    i = e < 0 ? s.length : e + 1;
  }
  return out;
}
