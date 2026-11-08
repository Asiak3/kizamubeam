// Variabler Text (wie „Variable Text“ in LightBurn): Platzhalter in Texten und QR-Codes werden beim Zeichnen
// und Lasern ersetzt. Seriennummer und CSV-Zeile hängen an der projektweiten Nummer (Doc.vt), die nach jedem
// Job weiterzählen kann.
import { locale, t } from './i18n';
import { TextShape, VarText, VarTextRef } from './model';
import { fillTemplate } from './params';

export function defaultVarText(): VarText {
  return { start: 1, end: 9999, current: 1, advance: 1, autoAdvance: false };
}

let source: () => VarText | undefined = () => undefined;
/** Woher die projektweiten Einstellungen kommen (vom Editor gesetzt) */
export function setVarTextSource(fn: () => VarText | undefined) {
  source = fn;
}
export const varText = (): VarText => source() ?? defaultVarText();

/** Fester Zeitpunkt für Tests und für einen ganzen Job (sonst „jetzt“) */
let fixedNow: Date | null = null;
export function withNow<T>(d: Date, fn: () => T): T {
  const before = fixedNow;
  fixedNow = d;
  try {
    return fn();
  } finally {
    fixedNow = before;
  }
}

const pad = (v: number, n = 2) => String(v).padStart(n, '0');

function dateCode(c: string, d: Date): string | null {
  const loc = locale;
  switch (c) {
    case 'y': return pad(d.getFullYear() % 100);
    case 'Y': return String(d.getFullYear());
    case 'm': return pad(d.getMonth() + 1);
    case 'b': return d.toLocaleString(loc, { month: 'short' });
    case 'B': return d.toLocaleString(loc, { month: 'long' });
    case 'd': return pad(d.getDate());
    case 'j': {
      const start = new Date(d.getFullYear(), 0, 1);
      return pad(Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 864e5) + 1, 3);
    }
    case 'a': return d.toLocaleString(loc, { weekday: 'short' });
    case 'A': return d.toLocaleString(loc, { weekday: 'long' });
    case 'H': return pad(d.getHours());
    case 'h':
    case 'I': return pad(((d.getHours() + 11) % 12) + 1);
    case 'M': return pad(d.getMinutes());
    case 'S': return pad(d.getSeconds());
    case 'p': return d.getHours() < 12 ? 'AM' : 'PM';
    default: return null;
  }
}

/** Zeile der CSV-Datei zur Nummer n (Zeilen ab 1, Kopfzeile nicht mitgezählt) */
export function csvRow(vt: VarText, n: number): string[] | null {
  return vt.csv?.rows[n - 1] ?? null;
}

/**
 * Platzhalter ersetzen. n ist die Nummer (aktuelle Nummer + Versatz des Objekts).
 * %# Seriennummer, %5# mit führenden Nullen auf 5 Stellen, %0 %1 … CSV-Spalten, %{Name} CSV-Spalte nach Kopfzeile,
 * Datum/Uhrzeit wie in LightBurn (%Y %y %m %d %H %M %S …), %% ein Prozentzeichen.
 */
export function expand(template: string, n: number, vt: VarText = varText(), now: Date = fixedNow ?? new Date()): string {
  const row = csvRow(vt, n);
  return template.replace(/%(%|\{([^}]*)\}|(\d*)#|(\d+)|([A-Za-z]))/g, (all, _x, name, digits, col, letter) => {
    if (all === '%%') return '%';
    if (name !== undefined) {
      const i = vt.csv?.header?.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase()) ?? -1;
      return i >= 0 ? row?.[i] ?? '' : all;
    }
    if (digits !== undefined) return String(n).padStart(Number(digits) || 0, '0');
    if (col !== undefined) return row?.[Number(col)] ?? '';
    return dateCode(letter, now) ?? all;
  });
}

/** Nummer eines Objekts mit variablem Text */
export const numberOf = (ref: VarTextRef, vt: VarText = varText()) => vt.current + (ref.offset || 0);

/** Angezeigter und gelaserter Text: erst Projekt-Parameter ({Name}), dann variabler Text */
export function shownText(t: TextShape): string {
  const s = fillTemplate(t.text);
  return t.vt ? expand(s, numberOf(t.vt)) : s;
}

/** Nummer weiterzählen (nach dem Ende wieder von vorn) */
export function advanceVarText(vt: VarText, steps = 1) {
  let n = vt.current + (vt.advance || 1) * steps;
  if (vt.end >= vt.start) {
    if (n > vt.end) n = vt.start;
    if (n < vt.start) n = vt.end;
  }
  vt.current = n;
}

/** CSV-Text einlesen: Trennzeichen (Komma, Semikolon, Tab) wird erkannt, Anführungszeichen wie in Excel */
export function parseCsv(src: string): string[][] {
  const text = src.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const sep = [';', '\t', ','].reduce((a, b) => (count(b) > count(a) ? b : a), ',');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      (row = []), (cell = '');
    } else cell += c;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Platzhalter für die Übersicht im Dialog: Code und Beschreibung */
export const CODES: [string, string][] = [
  ['%#', t('Seriennummer')],
  ['%4#', t('Seriennummer mit 4 Stellen (0042)')],
  ['%0', t('CSV-Spalte 0 (%1, %2 … weitere Spalten)')],
  ['%{Name}', t('CSV-Spalte nach Überschrift')],
  ['%d', t('Tag (01–31)')],
  ['%m', t('Monat (01–12)')],
  ['%b', t('Monatsname kurz')],
  ['%B', t('Monatsname')],
  ['%y', t('Jahr zweistellig')],
  ['%Y', t('Jahr')],
  ['%j', t('Tag im Jahr (001–366)')],
  ['%a', t('Wochentag kurz')],
  ['%A', t('Wochentag')],
  ['%H', t('Stunde (00–23)')],
  ['%h', t('Stunde (01–12)')],
  ['%p', t('AM/PM')],
  ['%M', t('Minute')],
  ['%S', t('Sekunde')],
  ['%%', t('Prozentzeichen')],
];
