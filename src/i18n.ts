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
  const s = DICTS[lang]?.[de] || (lang !== 'de' && (en as Dict)[de]) || stripContext(de);
  return fill(s, vars);
}

const stripContext = (de: string) => de.replace(/\|[^|]*$/, '');
const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Meldungen aus dem Rust-Teil (dort deutsch). Platzhalter wie in den Sprachdateien. */
// i18n-keys-start (npm run i18n:check liest die Texte zwischen diesen Markierungen)
/** [pattern, text, singular text if the text counts {n}] */
const BACKEND_PATTERNS: [RegExp, string, string?][] = [
  [/^Schrift „(.*)“ nicht gefunden$/, 'Schrift „{family}“ nicht gefunden'],
  [/^Schrift „(.*)“ liegt nur als Sammlung \(TTC\) vor$/, 'Schrift „{family}“ liegt nur als Sammlung (TTC) vor'],
  [/^(.*): Adresse nicht gefunden$/, '{host}: Adresse nicht gefunden'],
  [/^Unbekannte Verbindungsart „(.*)“$/, 'Unbekannte Verbindungsart „{kind}“'],
  [/^Senden fehlgeschlagen: (.*)$/s, 'Senden fehlgeschlagen: {error}'],
  [/^Lesen fehlgeschlagen: (.*)$/s, 'Lesen fehlgeschlagen: {error}'],
  [/^Fertig nach (\d+:\d+) min, (\d+) Fehler$/, 'Fertig nach {time} min, {n} Fehler', 'Fertig nach {time} min, {n} Fehler|one'],
  [/^Fertig nach (\d+:\d+) min$/, 'Fertig nach {time} min'],
  [/^Port (\d+) nicht verfügbar: (.*)$/s, 'Port {port} nicht verfügbar: {error}'],
  [/^Hochladen fehlgeschlagen \(HTTP (\d+)\)(.*)$/s, 'Hochladen fehlgeschlagen (HTTP {status}){details}'],
  [/^Unbekannter Speicher „(.*)“$/, 'Unbekannter Speicher „{fs}“'],
  [/^Zertifikat: (.*)$/s, 'Zertifikat: {error}'],
  [/^TLS: (.*)$/s, 'TLS: {error}'],
  [/^Falscher Code, noch (\d+) Versuche?\.$/, 'Falscher Code, noch {n} Versuche.', 'Falscher Code, noch {n} Versuch.'],
  [/^Host und dieser Rechner verwenden verschiedene Protokollversionen \((\d+) statt (\d+)\)\. Bitte beide KizamuBeam auf dieselbe Version bringen\.$/,
    'Host und dieser Rechner verwenden verschiedene Protokollversionen ({theirs} statt {ours}). Bitte beide KizamuBeam auf dieselbe Version bringen.'],
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
  'Dieser Rechner ist beim Host nicht (mehr) gekoppelt. Bitte neu koppeln.',
  'Nur Bediener dürfen den Laser steuern. Die Rolle stellt der Host ein.',
  'Der Host hat nicht rechtzeitig geantwortet.',
  'Am Host läuft gerade eine andere Kopplung.',
  'Kopplung am Host abgebrochen oder abgelaufen.',
  'Dreimal ein falscher Code. Die Kopplung wurde abgebrochen.',
  'Unbekannter Rechner',
  'Der Host hat die Kopplung mit diesem Rechner aufgehoben.',
  'Keine Adresse angegeben',
  'Der Host meldet sich mit einem anderen Zertifikat. Wurde KizamuBeam dort neu eingerichtet, bitte neu koppeln.',
  'Dieser Rechner ist mit dem Host noch nicht gekoppelt. Erst in den Geräteeinstellungen koppeln.',
  'Der Host antwortet nicht.',
  'Der Host antwortet nicht. Ist dort der Host-Modus eingeschaltet?',
  'Unerwartete Antwort vom Host',
  'Verbindung zum Host verloren',
  'Verbindung zum Host getrennt',
  'Keine Kopplung begonnen',
];
// i18n-keys-end

/** Übersetzt eine Meldung aus dem Rust-Teil; unbekannte bleiben, wie sie sind. */
export function tBackend(msg: string): string {
  if (lang === 'de') return msg;
  if (BACKEND_MESSAGES.includes(msg)) return t(msg);
  for (const [re, key, one] of BACKEND_PATTERNS) {
    const m = re.exec(msg);
    if (!m) continue;
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    const vars = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    if (!one) return t(key, vars);
    const { n, ...rest } = vars;
    return tn(one, key, Number(n), rest);
  }
  return msg;
}

/** Plural rules per language code, created on first use */
const RULES = new Map<Lang, Intl.PluralRules | null>();
function pluralRules(l: Lang): Intl.PluralRules | null {
  if (!RULES.has(l)) {
    let r: Intl.PluralRules | null = null;
    try {
      r = new Intl.PluralRules(l);
    } catch {
      /* unknown language code: fall back to n === 1 */
    }
    RULES.set(l, r);
  }
  return RULES.get(l)!;
}

/** Plural category of n in language l: 'one', 'other' and, depending on the language, 'zero', 'two', 'few' or 'many' */
export function pluralCategory(n: number, l: Lang = lang): Intl.LDMLPluralRule {
  return pluralRules(l)?.select(n) ?? (n === 1 ? 'one' : 'other');
}

/** Plural categories besides 'one' and 'other' that a language file may add as "<plural key>|<category>" */
export const EXTRA_PLURAL_CATEGORIES = ['zero', 'two', 'few', 'many'] as const;

/**
 * Singular/plural: tn('{n} Bild', '{n} Bilder', n). {n} is always replaced, formatted for the UI language.
 * The form follows the plural rules of the language the text is shown in (Intl.PluralRules): the
 * translation of `one` is that language's "one" form (in French also for 0, in Russian also for 21),
 * every other count takes the translation of `other`. Languages with more forms add them to their
 * language file as "<other>|few", "<other>|many", "<other>|two" or "<other>|zero"; missing ones fall
 * back to `other`. If the German singular and plural read the same, give the singular a context so
 * the two keys differ: tn('{n} Fehler|one', '{n} Fehler', n).
 */
export function tn(one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  const all = { n: n.toLocaleString(locale), ...vars };
  // Language whose text is shown: the UI language if it has the plural form, else English, else German
  const dict = DICTS[lang]?.[other] ? DICTS[lang]! : lang !== 'de' && (en as Dict)[other] ? (en as Dict) : null;
  const l = dict === DICTS[lang] ? lang : dict ? 'en' : 'de';
  const cat = pluralCategory(n, l);
  if (cat === 'one') return fill((dict && (dict[one] || (en as Dict)[one])) || stripContext(one), all);
  return fill(dict?.[`${other}|${cat}`] || dict?.[other] || stripContext(other), all);
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
