// Keyboard shortcuts (#453): default bindings, the user's changes, and matching key events against them.
// The commands themselves (label, category, what they run) are the toolbar actions in ui.ts; this module only knows
// their ids, so the editor, the menus and the settings read one list. No DOM.
import { t } from './i18n';

const STORE = 'kizamubeam.shortcuts';

/**
 * Default bindings in canonical form (see `normalizeBinding`). A command may have several (redo, zoom in).
 * Changing one changes what existing users have; the shortcuts test pins them against the code before #453.
 */
const DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  new: ['Ctrl+N'], open: ['Ctrl+O'], save: ['Ctrl+S'], import: ['Ctrl+I'],
  undo: ['Ctrl+Z'], redo: ['Ctrl+Y', 'Ctrl+Shift+Z'],
  cut: ['Ctrl+X'], copy: ['Ctrl+C'], paste: ['Ctrl+V'], duplicate: ['Ctrl+D'], selectall: ['Ctrl+A'], tolines: ['Ctrl+Shift+C'],
  join: ['Alt+J'], breakapart: ['Alt+B'],
  zoomin: ['+', '='], zoomout: ['-'], zoompage: ['Ctrl+0'], wire: ['Alt+W'],
  group: ['Ctrl+G'], ungroup: ['Ctrl+U'], mirrorh: ['Ctrl+Shift+H'], mirrorv: ['Ctrl+Shift+V'], rotccw: [','], rotcw: ['.'],
  alignl: ['L'], alignhc: ['C'], alignr: ['R'], alignt: ['T'], alignvc: ['E'], alignb: ['B'],
  'tool:node': ['Ctrl+`'], 'tool:line': ['Ctrl+L'], 'tool:rect': ['Ctrl+R'], 'tool:ellipse': ['Ctrl+E'], 'tool:text': ['Ctrl+T'], 'tool:trim': ['Ctrl+K'],
  union: ['Alt++'], subtract: ['Alt+-'], intersect: ['Alt+*'], offset: ['Alt+O'], gridarray: ['Ctrl+Shift+A'],
  trace: ['Alt+T'], prevpage: ['PageUp'], nextpage: ['PageDown'], preview: ['Alt+P'], help: ['F1'],
};

/** Keys with a fixed meaning in the editor (cancel, confirm, pan, nudge, delete, switch tabs); they cannot be assigned */
const RESERVED = new Set(['Escape', 'Enter', 'Space', 'Tab', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** Shown next to commands that keep a fixed key */
const FIXED: Readonly<Record<string, string>> = { delete: 'Delete', 'tool:select': 'Escape' };
/** Letters that already act without modifiers while editing nodes or a sketch; a command on them does not fire there */
const NODE_LETTERS = 'DILCESBT', SKETCH_LETTERS = 'LRCADSHVOPNETFXMY';

// ---------- Canonical form ----------

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Fn']);
/** Numeric keypad operators count as the main keys (Alt + numpad plus = Alt++) */
const NUMPAD: Readonly<Record<string, string>> = { NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/' };
/** macOS: Option turns these into other characters */
const MAC_OPTION: Readonly<Record<string, string>> = { '±': '+', '–': '-' };
/** Dead keys (e.g. ` and ^ on German layouts) by physical key */
const DEAD: Readonly<Record<string, string>> = { Backquote: '`' };

/** Shift is part of the binding only for letters and named keys; on symbols it depends on the layout (+ needs Shift on US) */
const shiftMatters = (key: string) => key.length > 1 || /^[A-Z]$/.test(key);

function combo(ctrl: boolean, alt: boolean, shift: boolean, key: string): string {
  return `${ctrl ? 'Ctrl+' : ''}${alt ? 'Alt+' : ''}${shift && shiftMatters(key) ? 'Shift+' : ''}${key}`;
}

/**
 * Key name from a key event: the character it types (layout-aware: Ctrl+Z is Z on QWERTZ too). The physical key only
 * for dead keys and for the special characters that Alt produces (macOS Option+J = ∆, AltGr+E = €).
 */
function eventKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey'>): string {
  let key = e.key;
  if (NUMPAD[e.code]) key = NUMPAD[e.code];
  else if (e.altKey && MAC_OPTION[key]) key = MAC_OPTION[key];
  else if (key === 'Dead' || key === 'Unidentified' || (e.altKey && key.length === 1 && !/^[\x21-\x7e]$/.test(key))) {
    const m = /^(?:Key|Digit)(.)$/.exec(e.code);
    key = m ? m[1] : DEAD[e.code] ?? key;
  }
  if (key === ' ') key = 'Space';
  if (key === 'Esc') key = 'Escape';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Canonical binding of a key event (`Ctrl+Alt+Shift+K`; Meta counts as Ctrl); null for a lone modifier */
export function eventBinding(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = eventKey(e);
  if (!key || key === 'Dead' || key === 'Unidentified') return null;
  return combo(e.ctrlKey || e.metaKey, e.altKey, e.shiftKey, key);
}

/** Canonical form of a written binding (`ctrl+shift+c` → `Ctrl+Shift+C`, `Alt++`); null if it is not one */
export function normalizeBinding(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  const plus = s.endsWith('++') || s === '+';
  const parts = (plus ? s.slice(0, -1) : s).split('+');
  let key = plus ? '+' : parts.pop() ?? '';
  if (plus) parts.pop();
  let ctrl = false, alt = false, shift = false;
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'ctrl' || m === 'cmd' || m === 'meta') ctrl = true;
    else if (m === 'alt' || m === 'option') alt = true;
    else if (m === 'shift') shift = true;
    else return null;
  }
  if (!key) return null;
  if (key.length === 1) key = key.toUpperCase();
  else if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return null;
  return combo(ctrl, alt, shift, key);
}

/** Key name of a binding (without modifiers) */
const bindingKey = (b: string) => (b.endsWith('++') || b === '+' ? '+' : b.slice(b.lastIndexOf('+') + 1));

// ---------- Overrides ----------

/** User's bindings by command id; only commands that differ from the defaults. [] = no shortcut. */
type Overrides = Record<string, string[]>;
let overrides: Overrides = load();
let index: Map<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Overrides {
  const out: Overrides = {};
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORE) ?? 'null');
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [id, list] of Object.entries(raw)) {
        if (!Array.isArray(list) || id === '__proto__') continue;
        const keys = list.map((b) => (typeof b === 'string' ? normalizeBinding(b) : null)).filter((b): b is string => !!b && !RESERVED.has(bindingKey(b)));
        out[id] = [...new Set(keys)];
      }
  } catch {
    /* defaults */
  }
  return out;
}

function save() {
  index = null;
  try {
    if (Object.keys(overrides).length) globalThis.localStorage?.setItem(STORE, JSON.stringify(overrides));
    else globalThis.localStorage?.removeItem(STORE);
  } catch {
    /* stays for this session */
  }
  for (const f of listeners) f();
}

/** Called after every change of a binding (menus and toolbars show the new keys) */
export function onShortcutsChanged(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Re-read the stored bindings (settings import) */
export function reloadShortcuts() {
  overrides = load();
  index = null;
  for (const f of listeners) f();
}

export const defaultBindings = (id: string): readonly string[] => DEFAULTS[id] ?? [];
/** Current bindings of a command (canonical) */
export const bindings = (id: string): readonly string[] => (Object.hasOwn(overrides, id) ? overrides[id] : defaultBindings(id));
export const isCustomized = (id: string) => Object.hasOwn(overrides, id);
export const fixedKey = (id: string): string | undefined => FIXED[id];

/** Command currently bound to a canonical binding (the first one if imported settings bind it twice) */
export function commandForBinding(binding: string): string | undefined {
  if (!index) {
    index = new Map();
    const ids = [...new Set([...Object.keys(overrides), ...Object.keys(DEFAULTS)])];
    for (const id of ids) for (const b of bindings(id)) if (!index.has(b)) index.set(b, id);
  }
  return index.get(binding);
}

/** Command bound to a key event */
export function commandFor(e: KeyboardEvent): string | undefined {
  const b = eventBinding(e);
  return b ? commandForBinding(b) : undefined;
}

export function commandMatches(id: string, e: KeyboardEvent): boolean {
  const b = eventBinding(e);
  return !!b && bindings(id).includes(b);
}

/** Why a binding cannot be used, or null */
export function bindingRefusal(binding: string): string | null {
  return RESERVED.has(bindingKey(binding)) ? t('Diese Taste ist fest belegt (Abbrechen, Bestätigen, Verschieben, Löschen).') : null;
}

/** Note for a binding that works, but not everywhere */
export function bindingNote(binding: string): string | null {
  const key = bindingKey(binding);
  if (binding !== key && binding !== `Shift+${key}`) return null;
  const node = NODE_LETTERS.includes(key), sketch = SKETCH_LETTERS.includes(key);
  if (node && sketch) return t('Beim Knotenbearbeiten und in Skizzen hat diese Taste eine eigene Bedeutung; dort wirkt das Kürzel nicht.');
  if (node) return t('Beim Knotenbearbeiten hat diese Taste eine eigene Bedeutung; dort wirkt das Kürzel nicht.');
  if (sketch) return t('In Skizzen hat diese Taste eine eigene Bedeutung; dort wirkt das Kürzel nicht.');
  return null;
}

/** Other commands that hold one of these bindings now */
export function bindingConflicts(id: string, list: readonly string[]): { binding: string; id: string }[] {
  const out: { binding: string; id: string }[] = [];
  for (const b of list) {
    const other = commandForBinding(b);
    if (other && other !== id) out.push({ binding: b, id: other });
  }
  return out;
}

/** Give a command these bindings; other commands lose them. Equal to the defaults = not customized. */
export function setBindings(id: string, list: readonly string[]) {
  const next = [...new Set(list)];
  for (const { binding, id: other } of bindingConflicts(id, next)) {
    const rest = bindings(other).filter((b) => b !== binding);
    assignRaw(other, rest);
  }
  assignRaw(id, next);
  save();
}

function assignRaw(id: string, list: string[]) {
  const def = defaultBindings(id);
  if (list.length === def.length && list.every((b, i) => b === def[i])) delete overrides[id];
  else overrides[id] = list;
  index = null;
}

/** Back to the default bindings; commands that took one of them over lose it again */
export const resetBindings = (id: string) => setBindings(id, defaultBindings(id));

export function resetAllBindings() {
  overrides = {};
  save();
}

// ---------- Display ----------

/** Readable key names; modifiers stay Ctrl/Alt/Shift as in the menus */
export function bindingLabel(binding: string): string {
  const key = bindingKey(binding);
  const names: Record<string, string> = { Delete: t('Entf'), PageUp: t('Bild ↑'), PageDown: t('Bild ↓'), Escape: 'Esc' };
  return binding.slice(0, binding.length - key.length) + (names[key] ?? key);
}

/** Tooltip text with the current shortcut, `Label (Ctrl+X)` */
export function withShortcut(label: string, id: string): string {
  const key = commandKey(id);
  return key ? `${label} (${key})` : label;
}

/** First binding of a command for menus and tooltips; '' if it has none */
export function commandKey(id: string): string {
  const b = bindings(id)[0] ?? FIXED[id];
  return b ? bindingLabel(b) : '';
}
