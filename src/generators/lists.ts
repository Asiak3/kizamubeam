// Lists and actions in generator dialogs (#335 stage 3): rows are a JSON array in a data parameter. The app draws
// them and checks every edit like a field (range, options, text length); the generator only reads the parameter.
// No DOM here: the dialog, the headless runner and the tests share these checks.
import type { GenColumn, GenList, Params } from './types';

export type Row = Record<string, unknown>;

/** Rows of a list; anything that is not an array of objects counts as no rows */
export function readRows(p: Params, list: GenList): Row[] {
  try {
    const a = JSON.parse(String(p[list.param] ?? '[]') || '[]');
    return Array.isArray(a) ? a.filter((x): x is Row => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
  } catch {
    return [];
  }
}

export const writeRows = (rows: Row[]) => JSON.stringify(rows);

/** A value for a column as the user may enter it: numbers clamped and rounded, options checked, text cut */
export function columnValue(c: GenColumn, v: unknown): string | number {
  if (c.type === 'text') return String(v ?? '').slice(0, c.max ?? 200);
  if (c.type === 'color') return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : '#000000';
  if (c.type === 'enum') {
    const hit = c.options.find(([k]) => String(k) === String(v));
    return (hit ?? c.options[0])[0];
  }
  const n = Number(v);
  const x = Number.isFinite(n) ? Math.min(c.max, Math.max(c.min, n)) : c.min;
  return c.type === 'int' ? Math.round(x) : x;
}

/** Set one cell and return the new parameter value */
export function setCell(p: Params, list: GenList, i: number, key: string, v: unknown): string {
  const rows = readRows(p, list);
  const c = list.columns.find((x) => x.key === key);
  if (!c || !rows[i]) return writeRows(rows);
  rows[i] = { ...rows[i], [key]: columnValue(c, v) };
  return writeRows(rows);
}

export function removeRow(p: Params, list: GenList, i: number): string {
  const rows = readRows(p, list);
  rows.splice(i, 1);
  return writeRows(rows);
}

/**
 * Move row i to row j (#211 stage 7); rows in the fixed tail (fixedLast) neither move nor let others pass them.
 * Returns the new parameter value, or null when the move is not possible.
 */
export function moveRow(p: Params, list: GenList, i: number, j: number): string | null {
  const rows = readRows(p, list);
  const end = rows.length - Math.min(rows.length, list.fixedLast ?? 0);
  if (i === j || i < 0 || j < 0 || i >= end || j >= end) return null;
  const [row] = rows.splice(i, 1);
  rows.splice(j, 0, row);
  return writeRows(rows);
}
