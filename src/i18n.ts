// Internationalisation. Texts are written in German in the code and go through t(); the German
// text is also the key. Other languages live in src/locales/<code>.json (German text → translation)
// and are picked up automatically: adding a language only takes dropping its file there. The name
// in the menu and the number and date formats come from Intl.
// A missing translation shows the English text, otherwise the German one.
// Same German text with different meanings: append a context after "|",
// e.g. t('Verbindung|Gerät'); only the part before it is shown.
// Check with: npm run i18n:check
import en from './locales/en.json';

/** Language code as in the file name in src/locales, e.g. 'it' or 'pt-BR'; 'de' is the base language. */
export type Lang = string;
export type LangPref = Lang | 'system';

type Dict = Record<string, string>;

/** All language files in src/locales. Vite inlines them at build time; the esbuild test runners
 *  have no import.meta.glob, so they only know German and English. */
function localeFiles(): Record<string, Dict> {
  try {
    return import.meta.glob<Dict>('./locales/*.json', { eager: true, import: 'default' });
  } catch {
    return {};
  }
}

const DICTS: Record<Lang, Dict | null> = { de: null, en };
for (const [file, dict] of Object.entries(localeFiles())) {
  const code = /([^/]+)\.json$/.exec(file)?.[1];
  if (code && code !== 'de') DICTS[code] = dict;
}

/** Name of a language in itself, e.g. "Italiano" */
function nativeName(code: Lang): string {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (n && n !== code) return n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
  } catch {
    /* unknown language code */
  }
  return code;
}

/** Languages with their native names: German, English, then the others by code */
export const LANGUAGES: [Lang, string][] = Object.keys(DICTS)
  .sort((a, b) => (a === 'de' ? -1 : b === 'de' ? 1 : a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)))
  .map((code) => [code, nativeName(code)]);

/** Known language for a tag such as 'de-AT' or 'pt-br' (exact match first, then the primary language) */
function knownLang(tag: string): Lang | undefined {
  const lower = tag.toLowerCase();
  return Object.keys(DICTS).find((c) => c.toLowerCase() === lower) ?? Object.keys(DICTS).find((c) => c.toLowerCase() === lower.split('-')[0]);
}
const LANG_KEY = 'kizamubeam.lang';

function systemLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l && knownLang(l);
    if (code) return code;
  }
  return 'en';
}

function readPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'system' || (v && v in DICTS)) return v;
  } catch {
    /* Speicher nicht verfügbar */
  }
  return 'system';
}

let pref: LangPref = readPref();
/** Aktive Sprache; wird beim Start festgelegt, ein Wechsel lädt die Oberfläche neu. */
export const lang: Lang = pref === 'system' ? systemLang() : pref;
document.documentElement.lang = lang;

export const langPref = () => pref;

/** Speichert die Sprachwahl. Gibt true zurück, wenn sich die angezeigte Sprache ändert. */
export function setLangPref(p: LangPref): boolean {
  pref = p;
  try {
    localStorage.setItem(LANG_KEY, p);
  } catch {
    /* Speicher nicht verfügbar */
  }
  return (p === 'system' ? systemLang() : p) !== lang;
}

/**
 * Übersetzt einen deutschen Text. Platzhalter in geschweiften Klammern werden ersetzt:
 * t('{n} Bilder', { n: 3 }).
 */
export function t(de: string, vars?: Record<string, string | number>): string {
  // Fehlt eine Übersetzung, erst Englisch, dann Deutsch
  const s = DICTS[lang]?.[de] || (lang !== 'de' && (en as Dict)[de]) || de.replace(/\|[^|]*$/, '');
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Meldungen aus dem Rust-Teil (dort deutsch). Platzhalter wie in den Sprachdateien. */
// i18n-keys-start (npm run i18n:check liest die Texte zwischen diesen Markierungen)
const BACKEND_PATTERNS: [RegExp, string][] = [
  [/^Schrift „(.*)“ nicht gefunden$/, 'Schrift „{family}“ nicht gefunden'],
  [/^Schrift „(.*)“ liegt nur als Sammlung \(TTC\) vor$/, 'Schrift „{family}“ liegt nur als Sammlung (TTC) vor'],
  [/^(.*): Adresse nicht gefunden$/, '{host}: Adresse nicht gefunden'],
  [/^Unbekannte Verbindungsart „(.*)“$/, 'Unbekannte Verbindungsart „{kind}“'],
  [/^Senden fehlgeschlagen: (.*)$/s, 'Senden fehlgeschlagen: {error}'],
  [/^Lesen fehlgeschlagen: (.*)$/s, 'Lesen fehlgeschlagen: {error}'],
  [/^Fertig nach (\d+:\d+) min, (\d+) Fehler$/, 'Fertig nach {time} min, {errors} Fehler'],
  [/^Fertig nach (\d+:\d+) min$/, 'Fertig nach {time} min'],
  [/^Port (\d+) nicht verfügbar: (.*)$/s, 'Port {port} nicht verfügbar: {error}'],
  [/^Hochladen fehlgeschlagen \(HTTP (\d+)\)(.*)$/s, 'Hochladen fehlgeschlagen (HTTP {status}){details}'],
  [/^Unbekannter Speicher „(.*)“$/, 'Unbekannter Speicher „{fs}“'],
];
const BACKEND_MESSAGES = [
  'Ungültige Daten',
  'Nicht verbunden',
  'Verbindung getrennt',
  'Keine Schnittstelle gewählt',
  'Während ein Job läuft, sind keine Befehle möglich.',
  'Es läuft bereits ein Job.',
  'Die Gegenstelle hat die Verbindung beendet.',
  'Die Steuerung wurde neu gestartet',
  'Alarm, Job abgebrochen',
  'Kein Ordner für Einstellungen',
  'G-Code nicht mehr vorhanden, bitte den Job erneut starten.',
  'Kein G-Code',
  'Zeitüberschreitung beim Warten auf die Antwort',
  'Ungültige Antwort der Steuerung',
];
// i18n-keys-end

/** Übersetzt eine Meldung aus dem Rust-Teil; unbekannte bleiben, wie sie sind. */
export function tBackend(msg: string): string {
  if (lang === 'de') return msg;
  if (BACKEND_MESSAGES.includes(msg)) return t(msg);
  for (const [re, key] of BACKEND_PATTERNS) {
    const m = re.exec(msg);
    if (!m) continue;
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return msg;
}

/** Einzahl/Mehrzahl: tn('{n} Bild', '{n} Bilder', n). {n} wird immer ersetzt. */
export function tn(one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : other, { n: n.toLocaleString(locale), ...vars });
}

/** Zahlenformat der Oberfläche */
export const locale = lang === 'de' ? 'de-DE' : lang === 'en' ? 'en-US' : lang;

/** Decimal separator of the UI language, e.g. comma in German, point in English */
const DECIMAL = (() => {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  } catch {
    return '.';
  }
})();

/** Decimal separator for display: replaces the point with the UI language's separator. */
export const dec = (s: string) => (DECIMAL === '.' ? s : s.replace('.', DECIMAL));

/** Text in der Sprache der Oberfläche, sonst Englisch, sonst Deutsch, sonst der erste (z. B. aus Erweiterungen: „Text“ oder {"de": "…", "en": "…"}) */
export function localText(v: unknown, l: string = lang): string {
  if (typeof v === 'string') return v.trim();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const o = v as Record<string, unknown>;
  for (const k of [l, 'en', 'de', ...Object.keys(o)]) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
  return '';
}
