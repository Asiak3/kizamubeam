// Central settings window (Edit → Settings …): registry of sections and fields.
// Fields are declarative and read/write through the existing getters and setters of each feature,
// so there is no second settings store: the localStorage keys stay where they are (see syncData.ts)
// and "Einstellungen übertragen" keeps working unchanged.
// This module has no DOM access so it can be tested in Node (scripts/settings-test.ts).

type Value = boolean | number | string;
type MaybePromise<T> = T | Promise<T>;

interface FieldBase<T extends Value> {
  /** Unique within the whole window, e.g. 'general.lang' */
  id: string;
  /** Translated label (call t() where the field is defined) */
  label: string;
  /** Translated explanation below the control */
  hint?: string;
  /** Extra search words (translated), separated by spaces */
  keywords?: string;
  /** Sub-heading inside the section; consecutive fields with the same group share it */
  group?: string;
  /** Hidden when this returns false (e.g. desktop-only fields in the browser) */
  when?: () => boolean;
  get(): MaybePromise<T>;
  set(v: T): MaybePromise<void>;
  /** Value for the "Defaults" button of the section; fields without one keep their value */
  def?: T;
  /** Applied after all other changes (e.g. the language, which asks to reload the window) */
  late?: boolean;
}

export interface ToggleField extends FieldBase<boolean> {
  kind: 'toggle';
}
export interface SelectField extends FieldBase<string> {
  kind: 'select';
  options: () => [value: string, label: string][];
}
export interface NumberField extends FieldBase<number> {
  kind: 'number';
  min?: number;
  max?: number;
  /** Whole numbers only */
  integer?: boolean;
  unit?: string;
}
export interface TextField extends FieldBase<string> {
  kind: 'text';
  placeholder?: () => string;
  maxLength?: number;
}
/** Colour; '' stands for "follow the design" when auto is set */
export interface ColorField extends FieldBase<string> {
  kind: 'color';
  /** Label of the "automatic" checkbox; without it the field always holds a colour */
  auto?: string;
  /** Colour shown while automatic is on */
  fallback?: () => string;
}
/** Button that runs right away (opens another dialog); not part of OK/Cancel */
export interface ActionField {
  kind: 'action';
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  group?: string;
  when?: () => boolean;
  button: string;
  run(): void;
}
/** Free content such as a read-only table; render() is called each time the section is shown */
export interface CustomField {
  kind: 'custom';
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  group?: string;
  when?: () => boolean;
  render(): HTMLElement;
}

export type ValueField = ToggleField | SelectField | NumberField | TextField | ColorField;
export type SettingsField = ValueField | ActionField | CustomField;

export interface SettingsSection {
  /** general, appearance, workspace, input, machines, extensions … */
  id: string;
  title: string;
  /** Position in the sidebar (smaller first) */
  order: number;
  /** Short line below the title: what this section covers and what lives elsewhere */
  note?: string;
  fields: SettingsField[];
  /** Runs before the values are read, e.g. to fetch the state of a desktop service once */
  prepare?(): MaybePromise<void>;
  /** Runs once after the changed fields of this section were set (e.g. to restart a service) */
  commit?(): MaybePromise<void>;
}

export const isValueField = (f: SettingsField): f is ValueField => f.kind !== 'action' && f.kind !== 'custom';

const sections = new Map<string, SettingsSection>();
/** Fields added for a section that is registered later */
const pending = new Map<string, SettingsField[]>();

/** Register (or replace) a section */
export function registerSettingsSection(s: SettingsSection) {
  const extra = pending.get(s.id) ?? [];
  pending.delete(s.id);
  sections.set(s.id, { ...s, fields: [...s.fields, ...extra] });
}

/**
 * Add fields to a section, e.g. a feature that brings its own preference:
 * addSettingsFields('input', [{ kind: 'toggle', id: 'input.rightPan', … }]).
 * Fields with an id that already exists replace the old field.
 */
export function addSettingsFields(sectionId: string, fields: SettingsField[]) {
  const s = sections.get(sectionId);
  if (!s) {
    pending.set(sectionId, [...(pending.get(sectionId) ?? []), ...fields]);
    return;
  }
  const ids = new Set(fields.map((f) => f.id));
  s.fields = [...s.fields.filter((f) => !ids.has(f.id)), ...fields];
}

/** All sections in sidebar order */
export function settingsSections(): SettingsSection[] {
  return [...sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Only for tests */
export function clearSettingsRegistry() {
  sections.clear();
  pending.clear();
}

export const visible = (f: SettingsField) => !f.when || f.when();

/** Lower case without accents, so "uberlappung" finds "Überlappung" */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Does the field match every word of the search? Section title, group, label, hint and keywords count. */
export function matchesSearch(f: SettingsField, section: SettingsSection, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([section.title, f.group ?? '', f.label, f.hint ?? '', f.keywords ?? ''].join(' '));
  return words.every((w) => hay.includes(w));
}

/** Read the current values of all visible fields (prepare() first; failures leave the field out) */
export async function loadValues(list: SettingsSection[]): Promise<Map<string, Value>> {
  await Promise.all(list.map(async (s) => {
    try {
      await s.prepare?.();
    } catch {
      /* the section's fields fall back to whatever get() can still say */
    }
  }));
  const out = new Map<string, Value>();
  for (const s of list) {
    for (const f of s.fields) {
      if (!isValueField(f) || !visible(f)) continue;
      try {
        out.set(f.id, await f.get());
      } catch {
        /* not available right now: the field is shown disabled */
      }
    }
  }
  return out;
}

export interface ApplyResult {
  changed: string[];
  errors: { id: string; error: unknown }[];
}

/**
 * Write every changed value through its setter, section by section, then call each touched
 * section's commit(). Fields marked late run after everything else.
 */
export async function applyChanges(list: SettingsSection[], before: Map<string, Value>, draft: Map<string, Value>): Promise<ApplyResult> {
  const res: ApplyResult = { changed: [], errors: [] };
  const late: [SettingsSection, ValueField][] = [];
  const touched = new Set<SettingsSection>();
  const write = async (s: SettingsSection, f: ValueField) => {
    try {
      await (f.set as (v: Value) => MaybePromise<void>)(draft.get(f.id)!);
      res.changed.push(f.id);
      touched.add(s);
    } catch (error) {
      res.errors.push({ id: f.id, error });
    }
  };
  for (const s of list) {
    for (const f of s.fields) {
      if (!isValueField(f) || !draft.has(f.id) || !before.has(f.id) || draft.get(f.id) === before.get(f.id)) continue;
      if (f.late) late.push([s, f]);
      else await write(s, f);
    }
  }
  for (const s of list) {
    if (!touched.has(s) || !s.commit) continue;
    try {
      await s.commit();
    } catch (error) {
      res.errors.push({ id: s.id, error });
    }
  }
  for (const [s, f] of late) await write(s, f);
  return res;
}

/** Defaults of a section as changes to the draft (fields without def stay) */
export function sectionDefaults(s: SettingsSection): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const f of s.fields) if (isValueField(f) && f.def !== undefined && visible(f)) out.set(f.id, f.def);
  return out;
}
