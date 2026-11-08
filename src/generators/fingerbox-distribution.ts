// Berechnung der freien Fachbreiten. Reiner Rechenkern.
// Syntax: durch ':' getrennte Ausdrücke, entweder ein Verhältnis oder eine Länge in mm.
export interface Distribution {
  gaps: number[];
  centres: number[];
}

type Quantity = { value: number; dimension: 0 | 1 };
const fail = (msg: string): never => { throw new Error(msg); };

/** Ein begrenzter Parser statt eval: + - * /, Klammern und mm. */
function expression(source: string): Quantity {
  let i = 0;
  const text = source.replace(/\s+/g, '').toLowerCase();
  const skip = (s: string) => text[i] === s ? (i++, true) : false;
  function primary(): Quantity {
    if (skip('+')) return primary();
    if (skip('-')) { const q = primary(); return { ...q, value: -q.value }; }
    if (skip('(')) {
      const q = sum();
      if (!skip(')')) fail('Klammer nicht geschlossen.');
      return q;
    }
    const m = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)/.exec(text.slice(i));
    if (!m) return fail('Ungültiger Ausdruck.');
    i += m[0].length;
    const value = Number(m[0].replace(',', '.'));
    let dimension: 0 | 1 = 0;
    if (text.slice(i, i + 2) === 'mm') { i += 2; dimension = 1; }
    return { value, dimension };
  }
  function product(): Quantity {
    let q = primary();
    while (text[i] === '*' || text[i] === '/') {
      const op = text[i++], right = primary();
      if (op === '/' && right.value === 0) fail('Division durch null.');
      const dim = op === '*' ? q.dimension + right.dimension : q.dimension - right.dimension;
      if (dim !== 0 && dim !== 1) fail('Ungültige Einheitenkombination.');
      q = { value: op === '*' ? q.value * right.value : q.value / right.value, dimension: dim as 0 | 1 };
    }
    return q;
  }
  function sum(): Quantity {
    let q = product();
    while (text[i] === '+' || text[i] === '-') {
      const op = text[i++], right = product();
      const dimension: 0 | 1 = q.dimension === 1 || right.dimension === 1 ? 1 : 0;
      q = { value: op === '+' ? q.value + right.value : q.value - right.value, dimension };
    }
    return q;
  }
  const result = sum();
  if (i !== text.length) fail('Ungültiger Ausdruck.');
  if (!Number.isFinite(result.value) || result.value <= 0) fail('Jeder Wert muss größer als null sein.');
  return result;
}

export function defaultDistribution(compartments: number): string {
  if (!Number.isInteger(compartments) || compartments < 1 || compartments > 100) fail('Fachzahl muss zwischen 1 und 100 liegen.');
  return Array(compartments).fill('1').join(':');
}

/** Berechnet freie Lücken von Wand/Trennwand zu Wand/Trennwand, niemals umskalieren. */
export function distributeGaps(outerLength: number, thickness: number, compartments: number, spec: string): Distribution {
  const fallback = defaultDistribution(compartments);
  if (!Number.isFinite(outerLength) || !Number.isFinite(thickness) || outerLength <= 0 || thickness <= 0) fail('Ungültige Maße.');
  if (spec.length > 2000) fail('Eingabe ist zu lang.');
  const available = outerLength - 2 * thickness - (compartments - 1) * thickness;
  if (available <= 0) fail('Kein freier Platz für die Fächer.');
  const fields = (spec.trim() ? spec : fallback).split(':');
  if (fields.length !== compartments) fail('Die Anzahl der Werte muss der Fachzahl entsprechen.');
  const parsed = fields.map(expression);
  const fixed = parsed.reduce((sum, q) => sum + (q.dimension === 1 ? q.value : 0), 0);
  const weight = parsed.reduce((sum, q) => sum + (q.dimension === 0 ? q.value : 0), 0);
  if (!Number.isFinite(fixed) || !Number.isFinite(weight)) fail('Werte sind zu groß.');
  const rest = available - fixed;
  const eps = 1e-9 * Math.max(1, available);
  if (weight > 0 && rest <= 0) fail('Die festen Millimetermaße lassen keinen Platz für die übrigen Fächer.');
  if (weight === 0 && Math.abs(rest) > eps) fail('Die festen Millimetermaße müssen zusammen genau dem freien Platz entsprechen.');
  const gaps = parsed.map((q) => q.dimension === 1 ? q.value : rest * (q.value / weight));
  if (gaps.some((g) => !Number.isFinite(g) || g <= 0)) fail('Alle Fächer müssen einen positiven freien Abstand haben.');
  const centres: number[] = [];
  let pos = thickness;
  for (let i = 0; i < gaps.length - 1; i++) {
    pos += gaps[i];
    centres.push(pos + thickness / 2);
    pos += thickness;
  }
  return { gaps, centres };
}