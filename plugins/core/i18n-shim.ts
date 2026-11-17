// Stand-in for src/i18n inside a core generator built as a plugin: a plugin has no language. t() returns a marker
// with the German source text and the values; the wrapper (wrap.ts) turns it into a text code plus values, and the
// app shows the text from the manifest in the interface language.
export const MARK = '\u0001';
const VALS = '\u0002';
export function t(de: string, vars?: Record<string, string | number>): string {
  return MARK + de + (vars ? VALS + JSON.stringify(vars) : '');
}
export const tn = (one: string, other: string, n: number, vars?: Record<string, string | number>) => t(n === 1 ? one : other, { n, ...vars });
export const lang = 'en';
export const locale = 'en-US';
export const dec = (s: string) => s;
export const localText = (v: unknown) => (typeof v === 'string' ? v : '');
/** Split a marker into source text and values */
export function unmark(s: string): { de: string; values?: Record<string, string | number> } | null {
  if (!s.startsWith(MARK)) return null;
  const [de, json] = s.slice(1).split(VALS);
  return json ? { de, values: JSON.parse(json) } : { de };
}
