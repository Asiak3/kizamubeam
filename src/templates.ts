// Vorlagen: Projekte mit Parametern, bei denen festgelegt ist, welche Werte beim Ausfüllen gefragt werden.
// Eine Vorlage ist eine Projektdatei (.kzt) mit dem Eintrag „template“. Der Vorlagen-Ordner liegt in der
// Desktop-App im Einstellungsordner (Rust: templates.rs), im Browser im lokalen Speicher.
import type { Doc } from './model';
import type { ProjectParam } from './params';
import { t } from './i18n';

export const TEMPLATE_EXT = 'kzt';

export interface TemplateField {
  /** Name des Parameters */
  name: string;
  /** Beschriftung im Ausfüll-Dialog (leer = Name) */
  label?: string;
  /** Zahl mit Min und Max: als Schieberegler zeigen */
  slider?: boolean;
}

export interface TemplateInfo {
  title: string;
  description?: string;
  /** Beim Ausfüllen gezeigte Parameter in dieser Reihenfolge; die übrigen bleiben, wie sie sind */
  fields: TemplateField[];
  /** Nur in Vorlagen-Dateien: kleine SVG-Vorschau */
  preview?: string;
}

export const canSlide = (p: ProjectParam) => p.type === 'number' && p.min !== undefined && p.max !== undefined && p.max > p.min;

/** Angaben aus einer Datei bereinigen: unbekannte und doppelte Parameter fallen weg */
export function normalizeTemplate(raw: unknown, params: ProjectParam[]): TemplateInfo {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const byName = new Map(params.map((p) => [p.name.toLowerCase(), p]));
  const seen = new Set<string>();
  const fields: TemplateField[] = [];
  for (const f of Array.isArray(r.fields) ? r.fields : []) {
    const name = typeof f === 'string' ? f : String((f as TemplateField)?.name ?? '');
    const p = byName.get(name.toLowerCase());
    if (!p || seen.has(p.name)) continue;
    seen.add(p.name);
    const label = typeof f === 'object' && typeof f.label === 'string' ? f.label.trim() : '';
    fields.push({ name: p.name, ...(label && label !== p.name ? { label } : {}), ...(typeof f === 'object' && f.slider && canSlide(p) ? { slider: true } : {}) });
  }
  const info: TemplateInfo = { title: String(r.title ?? '').trim() || t('Vorlage'), fields };
  const desc = typeof r.description === 'string' ? r.description.trim() : '';
  if (desc) info.description = desc;
  if (typeof r.preview === 'string' && r.preview.startsWith('<svg')) info.preview = r.preview;
  return info;
}

/** Vorschlag für ein Projekt ohne Vorlagen-Angaben: alle Parameter, Schieberegler wo möglich */
export function defaultTemplate(doc: Doc, title = ''): TemplateInfo {
  const params = doc.params ?? [];
  return {
    title: title || doc.pages[0]?.name || t('Vorlage'),
    fields: params.map((p) => ({ name: p.name, ...(canSlide(p) ? { slider: true } : {}) })),
  };
}

/** Die beim Ausfüllen gezeigten Parameter mit ihren Angaben, in der Reihenfolge der Vorlage */
export function templateFields(doc: Doc): [ProjectParam, TemplateField][] {
  const params = doc.params ?? [];
  const info = doc.template ? normalizeTemplate(doc.template, params) : defaultTemplate(doc);
  return info.fields.map((f) => [params.find((p) => p.name === f.name)!, f]);
}

/** Dateiname im Vorlagen-Ordner aus dem Titel */
export function templateFileName(title: string): string {
  const base = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80);
  return `${base || t('Vorlage')}.${TEMPLATE_EXT}`;
}

/** Projektdatei (JSON) zur Vorlagen-Datei machen: Angaben bereinigt, Vorschau dazu */
export function templateJson(projectJson: string, info: TemplateInfo, preview?: string): string {
  const d = JSON.parse(projectJson) as Record<string, unknown>;
  const clean = normalizeTemplate(info, (d.params as ProjectParam[]) ?? []);
  delete clean.preview;
  d.template = preview ? { ...clean, preview } : clean;
  return JSON.stringify(d, null, 1);
}

// ---------- Vorlagen-Ordner ----------

export interface LibraryEntry {
  file: string;
  info: TemplateInfo;
  /** Datei ließ sich nicht lesen */
  broken?: boolean;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const hasTemplateFolder = isTauri;
const STORE_KEY = 'kizamubeam.templates';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(cmd, args);
}
function store(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function setStore(s: Record<string, string>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    throw new Error(t('Der Speicher des Browsers ist voll. Vorlage lieber als Datei speichern.'));
  }
}

const entry = (file: string, raw: unknown, params: unknown): LibraryEntry =>
  raw === null || raw === undefined
    ? { file, info: { title: file.replace(/\.kzt$/i, ''), fields: [] }, broken: true }
    : { file, info: normalizeTemplate({ title: file.replace(/\.kzt$/i, ''), ...(raw as object) }, Array.isArray(params) ? params : []) };

export async function listTemplates(): Promise<LibraryEntry[]> {
  if (isTauri()) {
    const rows = await invoke<[string, string][]>('template_list');
    // Die Parameter fehlen in der Liste; die Felder bleiben hier unbereinigt (nur Titel, Text, Vorschau zählen)
    return rows.map(([file, json]) => {
      const raw = JSON.parse(json);
      return raw === null ? entry(file, null, []) : { file, info: { fields: [], ...raw, title: String(raw.title ?? '') || file.replace(/\.kzt$/i, '') } };
    });
  }
  return Object.entries(store())
    .map(([file, json]) => {
      try {
        const d = JSON.parse(json);
        return entry(file, d.template ?? {}, d.params);
      } catch {
        return entry(file, null, []);
      }
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

export async function readTemplate(file: string): Promise<string> {
  if (isTauri()) return invoke<string>('template_read', { file });
  const s = store()[file];
  if (s === undefined) throw new Error(t('Vorlage „{name}“ nicht gefunden', { name: file }));
  return s;
}

export async function writeTemplate(file: string, contents: string, overwrite: boolean) {
  if (isTauri()) return invoke<void>('template_write', { file, contents, overwrite });
  const s = store();
  if (file in s && !overwrite) throw new Error(t('Vorlage „{name}“ gibt es schon', { name: file }));
  s[file] = contents;
  setStore(s);
}

export async function deleteTemplate(file: string) {
  if (isTauri()) return invoke<void>('template_delete', { file });
  const s = store();
  delete s[file];
  setStore(s);
}

export async function openTemplateFolder() {
  if (isTauri()) await invoke<string>('template_open_folder');
}

// ---------- Serien aus Tabellen ----------

/** Spalte je Parameter vorschlagen: Kopfzeile gleich Name oder Beschriftung (Groß-/Kleinschreibung egal) */
export function guessColumns(header: string[], params: ProjectParam[], fields: TemplateField[] = []): Record<string, number> {
  const norm = (s: string) => s.trim().toLowerCase();
  const out: Record<string, number> = {};
  for (const p of params) {
    const label = fields.find((f) => f.name === p.name)?.label;
    const i = header.findIndex((h) => norm(h) === norm(p.name) || (!!label && norm(h) === norm(label)));
    if (i >= 0) out[p.name] = i;
  }
  return out;
}

const TRUE_RE = /^(1|ja|j|yes|y|true|wahr|x|✓)$/i;

/**
 * Tabellenzeilen (ohne Kopfzeile) zu Werten nach Parametername. Zahlen dürfen ein Dezimalkomma haben; leere
 * oder ungültige Zahlen fallen weg (der Parameter behält dann seinen Wert). Ja/Nein: 1, ja, yes, true, x.
 */
export function tableRows(rows: string[][], map: Record<string, number>, params: ProjectParam[]): Record<string, string | number | boolean>[] {
  return rows.map((r) => {
    const out: Record<string, string | number | boolean> = {};
    for (const [name, col] of Object.entries(map)) {
      const p = params.find((x) => x.name === name);
      if (!p || col < 0) continue;
      const cell = r[col] ?? '';
      if (p.type === 'text') out[name] = cell;
      else if (p.type === 'bool') out[name] = TRUE_RE.test(cell.trim());
      else {
        const n = Number(cell.trim().replace(/\s/g, '').replace(/,/g, '.'));
        if (cell.trim() && isFinite(n)) out[name] = n;
      }
    }
    return out;
  });
}

/** Tabelle für Serien, im Projekt gespeichert (Kopfzeile = Spaltennamen) */
export interface SeriesTable {
  header: string[];
  rows: string[][];
}

/** Ausgangstabelle: gespeicherte Tabelle, sonst CSV des variablen Texts, sonst Spalten der gefragten Parameter mit den aktuellen Werten */
export function initialSeriesTable(doc: Doc): SeriesTable {
  if (doc.seriesTable?.header.length) return { header: [...doc.seriesTable.header], rows: doc.seriesTable.rows.map((r) => [...r]) };
  const csv = doc.vt?.csv;
  if (csv?.header?.length) return { header: [...csv.header], rows: csv.rows.map((r) => [...r]) };
  const fields = templateFields(doc).filter(([p]) => p);
  const cell = (p: ProjectParam) => (p.type === 'bool' ? (p.value ? t('ja') : t('nein')) : String(p.value));
  return { header: fields.map(([p]) => p.name), rows: [fields.map(([p]) => cell(p))] };
}

/** Alle Zeilen auf die Spaltenzahl bringen */
export function squareTable(tb: SeriesTable): SeriesTable {
  const n = Math.max(tb.header.length, ...tb.rows.map((r) => r.length));
  const fit = (r: string[]) => Array.from({ length: n }, (_, i) => r[i] ?? '');
  return { header: fit(tb.header), rows: tb.rows.map(fit) };
}

/** CSV mit Semikolon (wie es Tabellenprogramme im deutschen Raum erwarten), Felder bei Bedarf in Anführungszeichen */
export function tableToCsv(tb: SeriesTable): string {
  const q = (s: string) => (/[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [tb.header, ...tb.rows].map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
}

/**
 * Eingefügten Text (z. B. aus einem Tabellenprogramm kopiert, Tabulator oder Semikolon getrennt) ab Zelle
 * (row, col) verteilen; row -1 = Kopfzeile. Die Tabelle wächst bei Bedarf. Gibt false zurück, wenn der
 * Text nur eine Zelle ist (dann normal einfügen).
 */
export function pasteIntoTable(tb: SeriesTable, row: number, col: number, text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(';')) ? ';' : null;
  if (lines.length < 2 && !sep) return false;
  lines.forEach((l, i) => {
    const cells = sep ? l.split(sep) : [l];
    const r = row + i;
    let target: string[];
    if (r < 0) target = tb.header;
    else {
      while (tb.rows.length <= r) tb.rows.push([]);
      target = tb.rows[r];
    }
    cells.forEach((c, j) => (target[col + j] = c));
  });
  Object.assign(tb, squareTable(tb));
  return true;
}
