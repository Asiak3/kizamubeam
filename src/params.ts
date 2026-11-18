// Projekt-Parameter: benannte Zahlen, Texte und Ja/Nein-Werte, die überall im Projekt benutzt werden können.
// In Texten und QR-Codes setzt {Name} den Wert ein (auch Formeln wie {Breite / 2}), Felder parametrischer
// Bauteile können eine Formel bekommen (GenShape.bind). Ändert sich ein Wert, rechnet der Editor alles neu.
// Grundlage für Vorlagen: ein Projekt, bei dem man nur noch die Parameter ausfüllt.
import { dec, t } from './i18n';

export type ParamType = 'number' | 'text' | 'bool';
export type Value = number | string | boolean;

export interface ProjectParam {
  /** Name, wie er in Formeln und Platzhaltern steht (Buchstaben, Ziffern, _; Groß-/Kleinschreibung egal) */
  name: string;
  type: ParamType;
  value: Value;
  /** Nur Zahl: Bereich für den Schieberegler (beide gesetzt = Schieberegler) und Schrittweite */
  min?: number;
  max?: number;
  step?: number;
  /** Nur Zahl: Einheit zur Anzeige (mm, °, leer = ohne) */
  unit?: string;
  /** Erklärung als Tooltip */
  note?: string;
}

export const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const RESERVED = new Set(['pi', 'true', 'false', 'ja', 'nein', 'wahr', 'falsch']);

/** Fehlermeldung für einen ungültigen oder schon vergebenen Namen, sonst null */
export function nameError(name: string, params: ProjectParam[], except?: ProjectParam): string | null {
  if (!name) return t('Der Name fehlt.');
  if (!NAME_RE.test(name)) return t('Namen bestehen aus Buchstaben, Ziffern und _ und beginnen mit einem Buchstaben.');
  const k = name.toLowerCase();
  if (RESERVED.has(k) || k in FUNCS) return t('„{name}“ ist schon vergeben (Funktion oder Konstante).', { name });
  if (params.some((p) => p !== except && p.name.toLowerCase() === k)) return t('Es gibt schon einen Parameter „{name}“.', { name });
  return null;
}

export const defaultValue = (type: ParamType): Value => (type === 'number' ? 10 : type === 'bool' ? true : t('Text'));

/** Wert auf den Typ des Parameters bringen (Zahlen in den Bereich) */
export function coerce(p: ProjectParam, v: unknown): Value {
  if (p.type === 'bool') return v === true || v === 'true' || v === 1;
  if (p.type === 'text') return v == null ? '' : String(v);
  let n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '.'));
  if (!isFinite(n)) n = typeof p.value === 'number' ? p.value : 0;
  if (p.min !== undefined) n = Math.max(p.min, n);
  if (p.max !== undefined) n = Math.min(p.max, n);
  return n;
}

let source: () => ProjectParam[] | undefined = () => undefined;
/** Woher die Parameter des Projekts kommen (vom Editor gesetzt) */
export function setParamSource(fn: () => ProjectParam[] | undefined) {
  source = fn;
}
export const projectParams = (): ProjectParam[] => source() ?? [];

export type Scope = Map<string, Value>;
/** Werte nach Namen (klein geschrieben) für die Auswertung */
export function scopeOf(params: ProjectParam[] = projectParams()): Scope {
  return new Map(params.map((p) => [p.name.toLowerCase(), p.value]));
}

export class ExprError extends Error {}

const deg = Math.PI / 180;
const num = (v: Value) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number(v.replace(/,/g, '.')));
const FUNCS: Record<string, (...a: Value[]) => Value> = {
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  abs: (a) => Math.abs(num(a)),
  sqrt: (a) => Math.sqrt(num(a)),
  floor: (a) => Math.floor(num(a)),
  ceil: (a) => Math.ceil(num(a)),
  /** round(x) oder round(x; Stellen) */
  round: (a, n = 0) => {
    const k = 10 ** Math.round(num(n));
    return Math.round(num(a) * k) / k;
  },
  sin: (a) => Math.sin(num(a) * deg),
  cos: (a) => Math.cos(num(a) * deg),
  tan: (a) => Math.tan(num(a) * deg),
  /** Länge eines Texts, z. B. um eine Platte an einen Namen anzupassen */
  len: (a) => String(a).length,
  upper: (a) => String(a).toUpperCase(),
  lower: (a) => String(a).toLowerCase(),
  /** if(Bedingung; dann; sonst) */
  if: (c, a, b = '') => (truthy(c) ? a : b),
};
const truthy = (v: Value) => (typeof v === 'string' ? v !== '' : !!v);
const UNITS: Record<string, number> = { mm: 1, cm: 10, in: 25.4 };

type Tok =
  | { k: 'num'; v: number; at: number }
  | { k: 'str'; v: string; at: number }
  | { k: 'id'; v: string; at: number }
  | { k: 'op'; v: string; at: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Zahl; ein Komma zwischen Ziffern ist ein Dezimalkomma (Argumente trennt ; oder „, “)
    const m = /^(\d+([.,]\d+)?|[.,]\d+)(e[-+]?\d+)?/i.exec(src.slice(i));
    if (m && !(src[i] === ',' && out.length && out[out.length - 1].k !== 'op')) {
      let v = parseFloat(m[0].replace(/,/g, '.'));
      const at = i;
      i += m[0].length;
      const u = /^(mm|cm|in)(?![\p{L}\p{N}_])/u.exec(src.slice(i));
      if (u) {
        v *= UNITS[u[1]];
        i += u[0].length;
      }
      out.push({ k: 'num', v, at });
      continue;
    }
    const q = { '"': '"', "'": "'", '„': '“', '“': '”' }[c];
    if (q) {
      const end = src.indexOf(q, i + 1);
      const end2 = c === '„' && end < 0 ? src.indexOf('"', i + 1) : end;
      if (end2 < 0) throw new ExprError(t('Anführungszeichen nicht geschlossen'));
      out.push({ k: 'str', v: src.slice(i + 1, end2), at: i });
      i = end2 + 1;
      continue;
    }
    const id = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    const op = /^(==|!=|<=|>=|&&|\|\||[-+*/%^()<>!?:;,])/.exec(src.slice(i));
    if (!op) throw new ExprError(t('Unerwartetes Zeichen „{c}“', { c }));
    out.push({ k: 'op', v: op[0], at: i });
    i += op[0].length;
  }
  return out;
}

/** Namen, die eine Formel benutzt (klein geschrieben, ohne Funktionen) */
export function namesIn(src: string): string[] {
  let toks: Tok[];
  try {
    toks = tokenize(src);
  } catch {
    return [];
  }
  return toks.filter((x, i) => x.k === 'id' && toks[i + 1]?.v !== '(').map((x) => String(x.v).toLowerCase());
}

/**
 * Formel auswerten. Zahlen (auch mit Dezimalkomma und mm/cm/in), Texte in Anführungszeichen, Parameter nach
 * Namen, + − * / % ^, Vergleiche, && || !, Bedingung ? a : b und Funktionen (min, max, round, if …).
 * Wirft ExprError mit verständlicher Meldung.
 */
export function evaluate(src: string, scope: Scope = scopeOf()): Value {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const take = (v: string) => {
    if (!isOp(v)) throw new ExprError(peek() ? t('„{v}“ erwartet', { v }) : t('Formel unvollständig'));
    i++;
  };
  const expr = (): Value => {
    const c = or();
    if (!isOp('?')) return c;
    i++;
    const a = expr();
    take(':');
    const b = expr();
    return truthy(c) ? a : b;
  };
  const or = (): Value => {
    let v = and();
    while (isOp('||')) {
      i++;
      const r = and();
      v = truthy(v) || truthy(r);
    }
    return v;
  };
  const and = (): Value => {
    let v = cmp();
    while (isOp('&&')) {
      i++;
      const r = cmp();
      v = truthy(v) && truthy(r);
    }
    return v;
  };
  const cmp = (): Value => {
    let v = add();
    for (;;) {
      const o = peek();
      if (o?.k !== 'op' || !['==', '!=', '<', '<=', '>', '>='].includes(o.v)) return v;
      i++;
      const r = add();
      const s = typeof v === 'string' || typeof r === 'string';
      const a = s ? String(v) : num(v),
        b = s ? String(r) : num(r);
      v = o.v === '==' ? a === b : o.v === '!=' ? a !== b : o.v === '<' ? a < b : o.v === '<=' ? a <= b : o.v === '>' ? a > b : a >= b;
    }
  };
  const add = (): Value => {
    let v = mulDiv();
    for (;;) {
      if (isOp('+')) {
        i++;
        const r = mulDiv();
        v = typeof v === 'string' || typeof r === 'string' ? show(v) + show(r) : num(v) + num(r);
      } else if (isOp('-')) {
        i++;
        v = num(v) - num(mulDiv());
      } else return v;
    }
  };
  const mulDiv = (): Value => {
    let v = unary();
    for (;;) {
      if (isOp('*')) (i++, (v = num(v) * num(unary())));
      else if (isOp('/')) {
        i++;
        const d = num(unary());
        if (d === 0) throw new ExprError(t('Teilung durch null'));
        v = num(v) / d;
      } else if (isOp('%')) (i++, (v = num(v) % num(unary())));
      else return v;
    }
  };
  const unary = (): Value => {
    if (isOp('-')) return i++, -num(unary());
    if (isOp('+')) return i++, num(unary());
    if (isOp('!')) return i++, !truthy(unary());
    return pow();
  };
  const pow = (): Value => {
    const b = atom();
    if (!isOp('^')) return b;
    i++;
    return num(b) ** num(unary());
  };
  const atom = (): Value => {
    const tk = peek();
    if (!tk) throw new ExprError(t('Formel unvollständig'));
    i++;
    if (tk.k === 'num' || tk.k === 'str') return tk.v;
    if (tk.k === 'op') {
      if (tk.v !== '(') throw new ExprError(t('Unerwartetes „{v}“', { v: tk.v }));
      const v = expr();
      take(')');
      return v;
    }
    const k = tk.v.toLowerCase();
    if (isOp('(')) {
      const f = FUNCS[k];
      if (!f) throw new ExprError(t('Unbekannte Funktion „{name}“', { name: tk.v }));
      i++;
      const args: Value[] = [];
      if (!isOp(')'))
        for (;;) {
          args.push(expr());
          if (isOp(';') || isOp(',')) i++;
          else break;
        }
      take(')');
      return f(...args);
    }
    if (scope.has(k)) return scope.get(k)!;
    if (k === 'pi') return Math.PI;
    if (k === 'true' || k === 'wahr' || k === 'ja') return true;
    if (k === 'false' || k === 'falsch' || k === 'nein') return false;
    throw new ExprError(t('Unbekannter Parameter „{name}“', { name: tk.v }));
  };
  if (!toks.length) throw new ExprError(t('Die Formel ist leer.'));
  const v = expr();
  if (i < toks.length) throw new ExprError(t('Unerwartetes „{v}“', { v: String(toks[i].v) }));
  if (typeof v === 'number' && !isFinite(v)) throw new ExprError(t('Ergebnis ist keine Zahl'));
  return v;
}

/** Gilt die Bedingung? Nicht auswertbare Formeln gelten als wahr, damit nichts unbemerkt verschwindet. */
export function conditionHolds(src: string, scope: Scope = scopeOf()): boolean {
  try {
    return truthy(evaluate(src, scope));
  } catch {
    return true;
  }
}

/** Formel als Zahl; null, wenn sie nicht auswertbar ist */
export function evalNumber(src: string, scope?: Scope): number | null {
  try {
    const v = evaluate(src, scope);
    const n = num(v);
    return isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Zahl für Texte: höchstens 3 Nachkommastellen, Dezimalzeichen der Sprache (point = immer Punkt, z. B. für QR-Codes) */
export function formatNumber(n: number, point = false): string {
  const s = String(Math.round(n * 1000) / 1000);
  return point ? s : dec(s);
}

function show(v: Value, point = false): string {
  if (typeof v === 'number') return formatNumber(v, point);
  if (typeof v === 'boolean') return v ? t('ja') : t('nein');
  return v;
}

/** Platzhalter {…} (nicht %{…}, das ist eine CSV-Spalte des variablen Texts); {{ und }} stehen für { und } */
const PLACEHOLDER = /\{\{|\}\}|(?<!%)\{([^{}\n]*)\}/g;

/**
 * Platzhalter mit Parametern ersetzen. Klammern, deren Inhalt keine gültige Formel ist oder einen unbekannten
 * Namen enthält, bleiben unverändert stehen, damit gewöhnliche Texte mit geschweiften Klammern gleich bleiben.
 */
export function fillTemplate(text: string, scope: Scope = scopeOf(), point = false): string {
  if (!text.includes('{') && !text.includes('}')) return text;
  if (!scope.size && !text.includes('{{') && !text.includes('}}')) return text;
  return text.replace(PLACEHOLDER, (all, body: string | undefined) => {
    if (all === '{{') return '{';
    if (all === '}}') return '}';
    try {
      return show(evaluate(body!, scope), point);
    } catch {
      return all;
    }
  });
}

/** Benutzt der Text Platzhalter? (für die Neuberechnung nach einer Änderung) */
export const hasPlaceholders = (text: string) => /(?<!%)\{[^{}\n]*\}/.test(text);

/** Benutzt der Text oder die Formel einen dieser Namen? */
export function usesName(text: string, name: string, template: boolean): boolean {
  const k = name.toLowerCase();
  if (!template) return namesIn(text).includes(k);
  for (const m of text.matchAll(PLACEHOLDER)) if (m[1] !== undefined && namesIn(m[1]).includes(k)) return true;
  return false;
}

/** Parameter in einer Formel umbenennen (Texte in Anführungszeichen und Funktionen bleiben) */
export function renameInExpr(src: string, from: string, to: string): string {
  let toks: Tok[];
  try {
    toks = tokenize(src);
  } catch {
    return src;
  }
  const k = from.toLowerCase();
  let out = src;
  // Von hinten ersetzen, damit die Positionen stimmen
  for (let j = toks.length - 1; j >= 0; j--) {
    const x = toks[j];
    if (x.k === 'id' && x.v.toLowerCase() === k && toks[j + 1]?.v !== '(') out = out.slice(0, x.at) + to + out.slice(x.at + x.v.length);
  }
  return out;
}

/** Parameter in den Platzhaltern eines Texts umbenennen */
export const renameInTemplate = (text: string, from: string, to: string) =>
  text.replace(PLACEHOLDER, (all, body: string | undefined) => (body === undefined ? all : `{${renameInExpr(body, from, to)}}`));

/** Platzhalter für die Übersicht in Dialogen */
export const PARAM_HELP = () => t('{Name} setzt einen Parameter ein, {Breite / 2} oder {Name + " GmbH"} rechnen. Funktionen: min, max, round, if, len …');
