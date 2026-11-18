// Texts of a plugin in the interface language: its name, parameter labels, issue and info texts, and the
// messages for codes the app itself reports about a plugin. Shared by generators and tools.
import type { Issue, ParamSpec } from '../generators/types';
import type { PluginIssue, PluginText } from './contract';
import { pluginText, type PluginManifest } from './manifest';
import { lang, locale, t } from '../i18n';
import { checkCodeText } from '../checkText';
import { jointText } from '../jointText';

/** Issue code while a plugin is still computing these parameters */
export const PENDING = 'plugin-pending';

/** Messages for the codes the app itself reports about a plugin */
export function appCodeText(code: string, name: string): string | undefined {
  switch (code) {
    case PENDING:
      return t('Wird berechnet …');
    case 'plugin-cancelled':
      return t('Die Berechnung wurde abgebrochen.');
    case 'host-bad-input':
    case 'host-failed':
    case 'host-not-allowed':
      return t('Die Erweiterung „{name}“ hat eine Funktion von KizamuBeam falsch aufgerufen ({code}).', { name, code });
    case 'plugin-timeout':
      return t('Die Erweiterung „{name}“ hat zu lange gerechnet.', { name });
    case 'plugin-memory':
      return t('Die Erweiterung „{name}“ hat zu viel Speicher gebraucht.', { name });
    case 'plugin-crash':
    case 'plugin-bad-code':
    case 'plugin-imports':
    case 'plugin-too-large':
    case 'plugin-newer-api':
      return t('Die Erweiterung „{name}“ lässt sich nicht ausführen ({code}).', { name, code });
    case 'plugin-bad-output':
      return t('Die Erweiterung „{name}“ hat ungültige Geometrie geliefert.', { name });
    case 'plugin-no-function':
      return t('Der Erweiterung „{name}“ fehlt eine Funktion.', { name });
    // Data from the network (#280)
    case 'net-pending':
      return t('Daten werden geladen …');
    case 'net-offline':
      return t('Netzwerkzugriffe von Erweiterungen sind ausgeschaltet (Fenster „Erweiterungen“).');
    case 'net-denied':
      return t('Die Erweiterung „{name}“ darf keine Daten aus dem Internet laden (Fenster „Erweiterungen“).', { name });
    case 'net-failed':
      return t('Der Server für „{name}“ war nicht erreichbar (keine Verbindung, Namensauflösung, TLS oder Zeitüberschreitung).', { name });
    case 'net-status':
    case 'net-too-large':
    case 'net-type':
    case 'net-local':
      return t('Die Daten für „{name}“ ließen sich nicht laden ({code}).', { name, code });
    case 'net-unknown-host':
    case 'net-method':
      return t('Die Erweiterung „{name}“ hat einen nicht angemeldeten Server angefragt ({code}).', { name, code });
  }
  return undefined;
}

/**
 * Numbers in texts from a plugin in the number format of the interface: plugins have no locale (QuickJS writes
 * 1234.5), the built-in generators use toLocaleString. Decimal numbers inside a text („⌀ 12.5 mm“) are converted.
 */
export function localNumbers(s: string): string {
  // Decimal numbers, and whole numbers from 1000 (digit grouping); not inside words or codes like „M3000“
  return s.replace(/(?<![\w.,])-?(?:\d+\.\d+|\d{4,})(?![\w.,]?\w)/g, (n) => Number(n).toLocaleString(locale, { maximumFractionDigits: 6 }));
}
/** Number values: whole numbers as they are (like t() in the app: „z=1000“), decimals in the user's format */
const localNumber = (x: number) => (Number.isInteger(x) ? String(x) : x.toLocaleString(locale, { maximumFractionDigits: 6 }));

/** Text of a message of host.joints (code joint-…, #398) with its raw values; undefined for other codes */
function jointCode(code: string, v?: Record<string, unknown>): string | undefined {
  if (!code.startsWith('joint-')) return undefined;
  const values: Record<string, number | string> = {};
  for (const [k, x] of Object.entries(v ?? {})) if ((typeof x === 'number' && Number.isFinite(x)) || typeof x === 'string') values[k] = x;
  return jointText({ code: code.slice(6), values });
}

/** Texts of one plugin in the interface language */
export function pluginWords(m: PluginManifest) {
  const text = (key: string, values?: Record<string, string | number>) => pluginText(m.texts, lang, key, values);
  const name = text('name') ?? m.id;
  const codeText = (code: string, values?: Record<string, string | number>) =>
    appCodeText(code, name) ?? text(code, values) ?? t('Fehler in der Erweiterung „{name}“: {code}', { name, code });
  const values = (v?: Record<string, PluginText | number>) => v && Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' ? localNumber(x) : render(x)]));
  /** A plugin text in the interface language */
  const render = (x: PluginText): string => (typeof x === 'string' ? localNumbers(x) : Array.isArray(x) ? x.map(render).join('') : coded(x.code, x.values));
  /** A code with its values: findings of host.check (#388) have their text in the app and take the raw numbers */
  const coded = (code: string, v?: Record<string, PluginText | number>) => checkCodeText(code, v) ?? jointCode(code, v) ?? codeText(code, values(v));
  /** A plain text that names a code (info labels of older plugins) is shown as that text */
  const label = (x: PluginText) => (typeof x === 'string' ? (text(x) ?? x) : render(x));
  const issue = (i: PluginIssue): Issue => ({
    ...(i.key ? { key: i.key } : {}),
    level: i.level,
    code: i.code,
    msg: i.code === 'plugin-text' && i.values?.text !== undefined && typeof i.values.text !== 'number' ? render(i.values.text) : coded(i.code, i.values),
  });
  /** Parameters with labels, tooltips, sections and option labels in the interface language */
  const schema: ParamSpec[] = m.schema.map((s) => {
    const label = text(s.key) ?? s.key;
    const title = text(`${s.key}.title`);
    const out = { ...s, label, ...(title ? { title } : {}) } as ParamSpec;
    if (out.section) out.section = text(out.section) ?? out.section;
    if (out.type === 'enum') out.options = out.options.map(([v, k]) => [v, text(k) ?? v]);
    return out;
  });
  return { text, name, codeText, render, label, issue, schema };
}
