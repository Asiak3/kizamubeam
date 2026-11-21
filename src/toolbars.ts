// Anpassbare Funktionsleisten: Hauptleiste oben und Werkzeugleiste links bestehen aus Aktionen, deren
// Auswahl und Reihenfolge der Nutzer festlegt (Fenster → Funktionsleisten anpassen … oder Rechtsklick auf
// eine Leiste). Außerdem lassen sich alle Leisten (auch Eigenschaften, Palette, Statusleiste) ausblenden.
// Gespeichert wird je Nutzer im localStorage („kizamubeam.toolbars“).
import { h } from './dom';
import { t } from './i18n';
import { SEP, upgradeLegacyConfig } from './toolbars/legacy';
import { initToolbarFramework } from './toolbars/system';
import type { ToolbarSystem } from './toolbars/system';
import { DEFAULT_ICON_SIZE, DEFAULT_VIEW, clone, ownEntry, setEntry } from './toolbars/model';
import type { BarDefinition, Definitions, GroupDefinition, IconSize, Item, Leaf, ToolbarState, ViewLayout } from './toolbars/model';
import { decode, encode } from './toolbars/migration';
import { TOOLBAR_STORAGE_KEY } from './toolbars/runtime';
import { validView } from './toolbars/state';
import type { ControlDefinition } from './toolbars/registry';
export { initToolbarFramework } from './toolbars/system';
export { SEP, upgradeBar } from './toolbars/legacy';

interface ActionBase {
  id: string;
  /** Rubrik im Anpassen-Dialog */
  cat: string;
  /** Name in Listen und Tooltip (mit Tastenkürzel) */
  label: string;
  run: () => void;
  enabled?: () => boolean;
  /** Knopf als eingeschaltet zeigen (aktives Werkzeug) */
  on?: () => boolean;
  /** Symbol und Tooltip, die sich zur Laufzeit ändern */
  dyn?: () => { icon?: string; label?: string };
  /** Kleiner Knopf (Optionen zu einem Nachbarn) */
  small?: boolean;
  /** Knopfgruppe: zeigt die zuletzt benutzte Aktion, der Pfeil daneben klappt die übrigen auf.
   *  Kleine Aktionen (Optionen) erscheinen nur in der Liste und werden nicht zur gezeigten. */
  items?: string[];
}

/** Knopfaktion: braucht ein Button-Gesicht (Symbol aus icons.ts oder Kurztext;
 *  ohne Symbol zeigt die Leiste den Kurztext). Der Typ erzwingt Vollständigkeit. */
export type ButtonAction = ActionBase & ({ icon: string; short?: string } | { icon?: string; short: string });
/** Knopfgruppe: zeigt die zuletzt benutzte Aktion, braucht kein eigenes Gesicht. */
export type GroupAction = ActionBase & { items: string[] };
export type Action = ButtonAction | GroupAction;
/** Gruppen erkennt man an items (alle Gruppen tragen eine nicht-leere items-Liste). */
export const isButtonAction = (a: Action | null | undefined): a is ButtonAction => !!a && !a.items;

export type BarId = 'main' | 'tools';
/** Leisten, die sich ausblenden lassen */
export type BarKey = BarId | 'numbar' | 'textbar' | 'palette' | 'status';

const BAR_EL: Record<BarKey, string> = { main: '#toolbar', tools: '#tools', numbar: '#numbar', textbar: '#textbar', palette: '#palette', status: '#status' };

const actions = new Map<string, Action>();
/** Aktion zu einer Kennung (z. B. für die Kacheln im Werkzeugkasten) */
export const getAction = (id: string) => actions.get(id);
let editableBars: BarDefinition[] = [];
let system: ToolbarSystem | undefined;
export interface ToolbarControlsBundle { definitions: Definitions; controls: ControlDefinition[]; dispose(): void }
let controlsBundle: ToolbarControlsBundle | undefined;
let initialized: { list: Action[]; def: Record<BarId, string[]>; migrate: [string[], string][] } | undefined;
let cleanups: (() => void)[] = [];
let closeMenu: (() => void) | undefined;
let closeDialog: (() => void) | undefined;
/** Eigene Host-Elemente: pro Init neu erzeugt, beim Abbauen wieder entfernt. */
let customHostElements: HTMLElement[] = [];
/** Eigene Leisten dieser Sitzung, die (noch) nicht im Storage stehen (z. B. bei blockiertem Storage). */
let sessionCustom: BarDefinition[] = [];
/** Eigene Gruppen dieser Sitzung (Rückweg wie bei den Leisten); Inhalt kommt aus dem Storage. */
let sessionCustomGroups: GroupDefinition[] = [];
/** Eigene Leisten heißen `custom-N`; eingebaute Treffer sind darüber geschützt. */
/** Eigene Gruppen heißen `custom-group-N`; eingebaute Treffer sind darüber geschützt. */
const CUSTOM_BAR = /^custom-\d+$/;
const CUSTOM_GROUP = /^custom-group-\d+$/;

export function setToolbarControls(bundle: ToolbarControlsBundle) {
  if (bundle === controlsBundle) return;
  teardownViews();
  controlsBundle?.dispose();
  controlsBundle = bundle;
  if (initialized) initToolbars(initialized.list, initialized.def, initialized.migrate);
}

function teardownViews() {
  closeMenu?.();
  closeDialog?.();
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  for (const element of customHostElements) element.remove();
  customHostElements = [];
  system?.dispose();
  system = undefined;
}

export function disposeToolbars() {
  teardownViews();
  controlsBundle?.dispose();
  controlsBundle = undefined;
  sessionCustom = [];
  sessionCustomGroups = [];
  initialized = undefined;
}

export const barNames = (): Record<BarKey, string> => ({
  main: t('Hauptleiste'),
  tools: t('Werkzeugleiste'),
  numbar: t('Eigenschaftenleiste'),
  textbar: t('Textleiste'),
  palette: t('Farbpalette'),
  status: t('Statusleiste'),
});

/** Aktionen und Standardbelegung festlegen, gespeicherte Anpassung laden und die Leisten aufbauen */
export function initToolbars(list: Action[], def: Record<BarId, string[]>, migrate: [string[], string][] = []) {
  teardownViews();
  initialized = { list, def, migrate };
  actions.clear();
  list.forEach((action) => actions.set(action.id, action));
  const item = (id: string): Item => id === SEP ? { kind: 'separator' }
    : { kind: actions.get(id)?.items ? 'group' : 'legacy', id };
  const names = barNames();
  const definitions: Definitions = {
    bars: (Object.keys(BAR_EL) as BarKey[]).map((id) => ({ id, label: names[id],
      items: id === 'main' || id === 'tools' ? def[id].map(item) : [],
      layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: id === 'tools' ? 'left' : 'top', lane: id === 'numbar' ? 1 : id === 'textbar' ? 2 : 0, order: 0 },
        orientation: id === 'tools' ? 'vertical' : 'horizontal' },
    })),
    groups: list.filter((action) => action.items).map((action) => ({ id: action.id, label: action.label,
      kind: 'flyout', items: action.items!.map((id) => id === SEP ? { kind: 'separator' as const } : { kind: 'action' as const, id }),
    })),
  };
  for (const bar of controlsBundle?.definitions.bars ?? []) {
    const index = definitions.bars.findIndex((candidate) => candidate.id === bar.id);
    if (index < 0) definitions.bars.push(bar);
    else definitions.bars[index] = bar;
  }
  definitions.groups.push(...controlsBundle?.definitions.groups ?? []);
  const baseIds = new Set(definitions.bars.map((bar) => bar.id));
  const baseGroupIds = new Set(definitions.groups.map((group) => group.id));
  const upgradeLegacy = (raw: unknown) => {
    const result = upgradeLegacyConfig(raw, def, migrate);
    if (!result.ok) throw Error(result.error.message);
    return result.config;
  };
  // Eigene Leisten stehen nicht in den Basis-Definitionen: aus dem Storage rekonstruieren.
  // Inhalt und Layout kommen über normalize aus dem Storage, nur Kennung und Name ergänzen.
  // Ist der Storage maßgeblich, fallen Sitzungsreste weg, die er nicht bestätigt (z. B. gelöscht).
  // Eigene Gruppen genauso: nicht in Code-Definitionen und mit Labels-Eintrag.
  let storedIds: Set<string> | undefined;
  let storedGroupIds: Set<string> | undefined;
  try {
    const raw = localStorage.getItem(TOOLBAR_STORAGE_KEY);
    if (raw != null) {
      const decoded = decode(raw, { bars: definitions.bars, groups: definitions.groups }, { upgradeLegacy });
      if (decoded.ok) {
        storedIds = new Set(Object.keys(decoded.value.state.content.bars));
        storedGroupIds = new Set(Object.keys(decoded.value.state.content.groups));
        const labels = storedLabels(decoded.value.state.content.labels);
        for (const id of Object.keys(decoded.value.state.content.bars)) {
          if (baseIds.has(id)) continue;
          baseIds.add(id);
          const layout = ownEntry(decoded.value.state.layout.bars, id);
          definitions.bars.push({ id, label: labels[id] ?? id, items: [],
            layout: layout && validView(layout) ? clone(layout) : clone(DEFAULT_VIEW) });
        }
        for (const id of Object.keys(decoded.value.state.content.groups)) {
          if (baseGroupIds.has(id)) continue;
          baseGroupIds.add(id);
          definitions.groups.push({ id, label: labels[id] ?? id, kind: 'flyout', items: [] });
        }
      }
    }
    if (raw == null) {
      storedIds = new Set();
      storedGroupIds = new Set();
    }
  } catch {
    // Fremde oder defekte Daten bleiben unangetastet; die Leisten starten mit den Basis-Definitionen.
  }
  if (storedIds) sessionCustom = sessionCustom.filter((bar) => storedIds.has(bar.id));
  for (const bar of sessionCustom) {
    if (baseIds.has(bar.id)) continue;
    baseIds.add(bar.id);
    definitions.bars.push({ ...bar, items: [], layout: clone(bar.layout) });
  }
  if (storedGroupIds) sessionCustomGroups = sessionCustomGroups.filter((group) => storedGroupIds.has(group.id));
  for (const group of sessionCustomGroups) {
    if (baseGroupIds.has(group.id)) continue;
    baseGroupIds.add(group.id);
    definitions.groups.push({ ...group, items: [] });
  }
  const hosts = new Map<string, { element: HTMLElement; ownerId: string }>();
  const visibilityHosts = new Map<string, HTMLElement>();
  for (const bar of definitions.bars) {
    const selector = Object.hasOwn(BAR_EL, bar.id) ? BAR_EL[bar.id as BarKey] : undefined;
    let element: HTMLElement | null = null;
    if (selector) element = document.querySelector<HTMLElement>(selector);
    else {
      element = document.createElement('div');
      document.body.append(element);
      customHostElements.push(element);
    }
    if (!element) continue;
    if (bar.id === 'palette' || bar.id === 'status') visibilityHosts.set(bar.id, element);
    else hosts.set(bar.id, { element, ownerId: bar.id });
  }
  editableBars = definitions.bars.filter((bar) => hosts.has(bar.id));
  system = initToolbarFramework({ definitions, actions: list.filter((action): action is ButtonAction => isButtonAction(action)),
    controls: controlsBundle?.controls, hosts, visibilityHosts,
    storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    upgradeLegacy,
  });
  for (const action of list) if (action.items) system.registry.registerGroup(action);
  for (const group of definitions.groups)
    if (!actions.has(group.id)) system.registry.registerGroup({ id: group.id, label: group.label });
  system.refresh();
  for (const [id, descriptor] of hosts) {
    const host = descriptor.element;
    const contextmenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
      const root = host.querySelector<HTMLElement>('[data-view]');
      let entry = event.target instanceof Element ? event.target : null;
      while (entry && entry.parentElement !== root) entry = entry.parentElement;
      const index = entry && root ? [...root.children].indexOf(entry) : -1;
      const selected = barItems(id)[index];
      barMenu(id, event.clientX, event.clientY, selected && 'id' in selected ? selected.id : null, index);
    };
    host.addEventListener('contextmenu', contextmenu);
    cleanups.push(() => host.removeEventListener('contextmenu', contextmenu));
  }
}

/** Aktivierung und Zustand aller Knöpfe nachziehen (nach Auswahl- oder Werkzeugwechsel) */
export function refreshBars() {
  system?.refresh();
}

/** Die Aktion, die eine Knopfgruppe gerade zeigt */
function groupCurrent(g: GroupAction): Action {
  // Aktives Werkzeug bevorzugen: es kann auch über Menü/Shortcut gewählt sein.
  for (const id of g.items!) {
    const a = actions.get(id);
    if (!a?.small && a?.on?.()) return a;
  }
  const id = system && ownEntry(system.runtime.read().content.choices, g.id);
  return actions.get(id && g.items!.includes(id) ? id : g.items!.find((x) => !actions.get(x)?.small)!) ?? g;
}

export const isBarHidden = (k: string) => system?.runtime.read().layout.hidden.includes(k) ?? false;

export function toggleBar(k: string) {
  system?.runtime.layout({ kind: 'visibility', barId: k, visible: isBarHidden(k) });
}

/** Ein- und Ausblenden der Leisten im Menü Fenster zurücksetzen */
export function showAllBars() {
  for (const id of Object.keys(system?.runtime.read().content.bars ?? {}))
    system?.runtime.layout({ kind: 'visibility', barId: id, visible: true });
}

/** Gespeicherte Leistennamen lesen (fremde oder defekte Werte fallen auf {} zurück). */
function storedLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) if (typeof label === 'string' && label) setEntry(out, key, label);
  return out;
}

/** Laufzeitmethoden für eigene Leisten; die parallele Runtime bringt sie mit, sonst greift der Rückweg. */
interface CustomBarMethods {
  addBar?: (bar: { id: string; label: string; items?: Item[]; layout?: ViewLayout; iconSize?: IconSize }) => { ok: boolean; error?: string };
  removeBar?: (barId: string) => { ok: boolean; error?: string };
  setBarLabel?: (barId: string, label: string) => { ok: boolean; error?: string };
}

/** Laufzeitmethoden für eigene Gruppen; defensiv nutzen (parallele Runtime), sonst greift der Rückweg. */
interface CustomGroupMethods {
  addGroup?: (group: { id: string; label: string; items?: Leaf[] }) => { ok: boolean; error?: string };
  removeGroup?: (groupId: string) => { ok: boolean; error?: string };
  setGroupLabel?: (groupId: string, label: string) => { ok: boolean; error?: string };
}

/** Gemeinsame Symbolgröße aller Leisten; 'm' bei gemischten Größen oder ohne Leisten. */
export function toolbarIconSize(): IconSize {
  const sizes = system ? Object.values(system.runtime.read().content.iconSizes) : [];
  return sizes.length > 0 && sizes.every((size) => size === sizes[0]) ? sizes[0] : 'm';
}

/** Eine Größe für alle Leisten (Einstellungen → Darstellung). Ohne Leisten wirkungslos. */
export function setAllToolbarIconSizes(size: IconSize) {
  const current = system;
  if (!current || (size !== 's' && size !== 'm' && size !== 'l')) return;
  for (const id of Object.keys(current.runtime.read().content.bars)) current.runtime.setIconSize(id, size);
}

/** Sitzungsliste eigener Leisten nachführen (Rückweg bei blockiertem Storage, Geister-Bereinigung bei Init). */
function trackSessionCustom(id: string, label: string) {
  const known = sessionCustom.find((bar) => bar.id === id);
  if (known) known.label = label;
  else sessionCustom.push({ id, label, items: [], layout: clone(DEFAULT_VIEW) });
}

/** Sitzungsliste eigener Gruppen nachführen (Rückweg wie bei den Leisten). */
function trackSessionCustomGroup(id: string, label: string) {
  const known = sessionCustomGroups.find((group) => group.id === id);
  if (known) known.label = label;
  else sessionCustomGroups.push({ id, label, kind: 'flyout', items: [] });
}

/** Gruppen- und Leisteneinträge in einer Storage-Transaktion schreiben (Rückweg ohne Runtime-Gruppenmethoden). */
function commitGroupEdit(edit: (state: ToolbarState) => void): boolean {
  const current = system;
  if (!current || !current.runtime.persistence().writable) return false;
  try {
    const state = current.runtime.read();
    edit(state);
    const encoded = encode(state);
    if (!encoded.ok) return false;
    localStorage.setItem(TOOLBAR_STORAGE_KEY, encoded.value);
    return true;
  } catch { return false; }
}

/** Eigene Gruppe entfernen (räumt Bar-Refs/detached/choices auf, Built-in-Schutz); true bei Erfolg. */
function dropCustomGroup(id: string): boolean {
  const current = system;
  if (!current || !CUSTOM_GROUP.test(id)) return false;
  sessionCustomGroups = sessionCustomGroups.filter((group) => group.id !== id);
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomGroupMethods;
  if (typeof custom.removeGroup === 'function') {
    const removed = custom.removeGroup(id);
    if (removed && removed.ok) return true;
    if (!removed || (removed.error !== 'Built-in group' && removed.error !== 'Unknown group')) return false;
    if (removed.error === 'Unknown group') return true;
  }
  return commitGroupEdit((state) => {
    for (const key of Object.keys(state.content.bars)) {
      const items = ownEntry(state.content.bars, key);
      if (items?.some((item) => item.kind === 'group' && item.id === id))
        setEntry(state.content.bars, key, items.filter((item) => !(item.kind === 'group' && item.id === id)));
    }
    delete state.content.groups[id];
    if (Object.hasOwn(state.content.choices, id)) delete state.content.choices[id];
    for (const key of Object.keys(state.layout.detached))
      if (ownEntry(state.layout.detached, key)?.groupId === id) delete state.layout.detached[key];
    const labels = storedLabels(state.content.labels);
    delete labels[id];
    (state.content as { labels?: Record<string, string> }).labels = labels;
  });
}

/** Sitzungs- und Storage-Stand eigener Leisten sichern, solange der Storage beschreibbar ist. */
function persistCustomState(): boolean {
  const current = system;
  if (!current || !current.runtime.persistence().writable) return false;
  try {
    const state = current.runtime.read();
    const labels = storedLabels(state.content.labels);
    for (const bar of sessionCustom) {
      if (!ownEntry(state.content.bars, bar.id)) setEntry(state.content.bars, bar.id, []);
      if (!ownEntry(state.content.iconSizes, bar.id)) setEntry(state.content.iconSizes, bar.id, bar.iconSize ?? DEFAULT_ICON_SIZE);
      if (!ownEntry(state.layout.bars, bar.id)) setEntry(state.layout.bars, bar.id, clone(bar.layout));
      labels[bar.id] = bar.label;
    }
    (state.content as { labels?: Record<string, string> }).labels = labels;
    const encoded = encode(state);
    if (!encoded.ok) return false;
    localStorage.setItem(TOOLBAR_STORAGE_KEY, encoded.value);
    return true;
  } catch { return false; }
}

/** Eigene Leiste samt Inhalt, Layout, Größe und Name aus dem Storage entfernen. */
function removeCustomState(id: string): boolean {
  const current = system;
  if (!current || !current.runtime.persistence().writable) return false;
  try {
    const state = current.runtime.read();
    if (!ownEntry(state.content.bars, id)) return true;
    delete state.content.bars[id];
    delete state.content.iconSizes[id];
    delete state.layout.bars[id];
    state.layout.hidden = state.layout.hidden.filter((entry) => entry !== id);
    for (const key of Object.keys(state.layout.detached))
      if (ownEntry(state.layout.detached, key)?.ownerId === id) delete state.layout.detached[key];
    const labels = storedLabels(state.content.labels);
    delete labels[id];
    (state.content as { labels?: Record<string, string> }).labels = labels;
    const encoded = encode(state);
    if (!encoded.ok) return false;
    localStorage.setItem(TOOLBAR_STORAGE_KEY, encoded.value);
    return true;
  } catch { return false; }
}

/** Ansichten neu aufbauen und den Anpassen-Dialog wieder öffnen (vorhandenes setToolbarControls-Muster). */
function reinitAfterCustomChange(select?: string) {
  if (!initialized) return;
  const snapshot = initialized;
  teardownViews();
  initToolbars(snapshot.list, snapshot.def, snapshot.migrate);
  openToolbarDialog(select);
}

/** Eigene Leiste anlegen (ID `custom-N` mit kleinstem freien N); gibt die ID zurück. */
export function createToolbar(name: string): string | undefined {
  const current = system;
  if (!current || !initialized || typeof name !== 'string') return undefined;
  const label = name.trim();
  if (!label) return undefined;
  const taken = new Set(Object.keys(current.runtime.read().content.bars));
  let n = 1;
  while (taken.has(`custom-${n}`)) n++;
  const id = `custom-${n}`;
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomBarMethods;
  trackSessionCustom(id, label);
  if (typeof custom.addBar === 'function') {
    const added = custom.addBar({ id, label, items: [], layout: clone(DEFAULT_VIEW) });
    if (!added || !added.ok) {
      sessionCustom = sessionCustom.filter((bar) => bar.id !== id);
      return undefined;
    }
  } else persistCustomState();
  reinitAfterCustomChange(id);
  return id;
}

/** Eigene Leiste löschen (eingebaute sind geschützt); true bei Erfolg. */
export function deleteToolbar(id: string): boolean {
  const current = system;
  if (!current || !initialized || !CUSTOM_BAR.test(id)) return false;
  if (!ownEntry(current.runtime.read().content.bars, id)) return false;
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomBarMethods;
  if (typeof custom.removeBar === 'function') {
    const removed = custom.removeBar(id);
    if (removed && removed.ok) {
      sessionCustom = sessionCustom.filter((bar) => bar.id !== id);
      reinitAfterCustomChange();
      return true;
    }
    // Eigene Leisten stehen für Hosts und Dialog in den Definitions und gelten der
    // Runtime dort als eingebaut: dann den Storage-Eingriff als Rückweg nehmen.
    if (!removed || removed.error !== 'Built-in bar') return false;
  }
  sessionCustom = sessionCustom.filter((bar) => bar.id !== id);
  removeCustomState(id);
  reinitAfterCustomChange();
  return true;
}

/** Eigene Leiste umbenennen (eingebaute sind geschützt); true bei Erfolg. */
export function renameToolbar(id: string, name: string): boolean {
  const current = system;
  if (!current || !initialized || !CUSTOM_BAR.test(id) || typeof name !== 'string') return false;
  const label = name.trim();
  if (!label || !ownEntry(current.runtime.read().content.bars, id)) return false;
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomBarMethods;
  if (typeof custom.setBarLabel === 'function') {
    const renamed = custom.setBarLabel(id, label);
    if (renamed && renamed.ok) {
      trackSessionCustom(id, label);
      reinitAfterCustomChange(id);
      return true;
    }
    if (!renamed || renamed.error !== 'Built-in bar') return false;
  }
  trackSessionCustom(id, label);
  persistCustomState();
  reinitAfterCustomChange(id);
  return true;
}

const barItems = (id: string): Item[] => system ? ownEntry(system.runtime.read().content.bars, id) ?? [] : [];
const setBar = (id: string, items: Item[]) => system?.runtime.setBarItems(id, items);
const newItem = (id: string): Item => id === SEP ? { kind: 'separator' }
  : { kind: actions.get(id)?.items ? 'group' : 'action', id };

/** Nur flache Aktionsgruppen bearbeiten; Abschnitte mit Feature-Controls bleiben geschützt. */
const isEditableFlyout = (id: string): boolean => {
  const group = system && ownEntry(system.runtime.read().content.groups, id);
  return group?.kind === 'flyout' && group.items.every((leaf) => {
    if (leaf.kind === 'separator') return true;
    const resolved = system?.registry.resolveLegacy(leaf.id);
    return leaf.kind !== 'control' && !actions.get(leaf.id)?.items && resolved !== 'control' && resolved !== 'group';
  });
};

// ---------- Kontextmenü einer Leiste ----------

function barMenu(id: string, x: number, y: number, action: string | null, index: number) {
  closeMenu?.();
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    if (closeMenu === close) closeMenu = undefined;
  };
  const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && close();
  const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const item = (label: string, f: () => void) => h('button', { onclick: () => (close(), f()) }, label);
  const a = action ? actions.get(action) ?? { label: action } : null;
  const menu = h(
    'div',
    { class: 'ctx-menu menu-items' },
    item(t('Funktionsleisten anpassen …'), () => openToolbarDialog(id)),
    index >= 0 ? item(t('„{name}“ aus der Leiste entfernen', { name: a?.label.replace(/ \(.*\)$/, '') ?? SEP }), () => setBar(id, barItems(id).filter((_, i) => i !== index))) : null,
    h('hr'),
    item(t('{bar} ausblenden', { bar: editableBars.find((bar) => bar.id === id)?.label ?? id }), () => toggleBar(id)),
  );
  menu.style.left = `${Math.min(x, window.innerWidth - 260)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  document.body.append(menu);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', keydown, true);
  closeMenu = close;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

// ---------- Anpassen-Dialog ----------

export function openToolbarDialog(start: string = 'main') {
  if (!system) return;
  closeDialog?.();
  let bar = editableBars.some((candidate) => candidate.id === start) ? start : editableBars[0]?.id ?? 'main';
  let selAvail: string | null = null;
  let selIdx = -1;
  /** Kindzeile einer Aktionsgruppe gewählt: Kind-Index innerhalb der Gruppe (sonst undefined). */
  let selChild: number | undefined;
  let filter = '';
  const barSel = h('select', { onchange: () => ((bar = barSel.value), (selIdx = -1), (selChild = undefined), sync(), renderLists()) },
    ...editableBars.map((definition) => h('option', { value: definition.id }, definition.label)),
  ) as HTMLSelectElement;
  barSel.value = bar;
  const sizeSel = h('select', { onchange: () => system?.runtime.setIconSize(bar, sizeSel.value as IconSize) },
    h('option', { value: 's' }, t('Klein|Symbole')),
    h('option', { value: 'm' }, t('Normal|Symbole')),
    h('option', { value: 'l' }, t('Groß|Symbole')),
  ) as HTMLSelectElement;
  const shownChk = h('input', { type: 'checkbox', onchange: () => toggleBar(bar) }) as HTMLInputElement;
  const changeLayout = (change: Partial<ViewLayout>) => {
    const current = system && ownEntry(system.runtime.read().layout.bars, bar);
    if (current) system?.runtime.layout({ kind: 'place', target: { barId: bar }, view: { ...current, ...change } });
    sync();
  };
  const countInput = (key: 'rows' | 'columns', label: string) => h('input', {
    type: 'number', min: 1, step: 1, 'aria-label': label, style: 'width: 6ch',
    onchange(event: Event) {
      const value = (event.target as HTMLInputElement).valueAsNumber;
      if (Number.isSafeInteger(value) && value >= 1) changeLayout({ [key]: value });
      else sync();
    },
  });
  const rows = countInput('rows', t('Zeilen der Leiste'));
  const columns = countInput('columns', t('Spalten der Leiste'));
  const locked = h('input', { type: 'checkbox', onchange: () => { system?.runtime.lock(locked.checked); sync(); } });
  let layoutResetButton: HTMLButtonElement | undefined;
  let indentBtn: HTMLButtonElement | undefined;
  let outdentBtn: HTMLButtonElement | undefined;
  const sync = () => {
    sizeSel.value = system && ownEntry(system.runtime.read().content.iconSizes, bar) || 'm';
    shownChk.checked = !isBarHidden(bar);
    const state = system?.runtime.read();
    const layout = state && ownEntry(state.layout.bars, bar);
    locked.checked = state?.layout.locked ?? false;
    if (layoutResetButton) layoutResetButton.disabled = locked.checked;
    shownChk.disabled = locked.checked;
    rows.value = String(layout?.rows ?? 1);
    columns.value = String(layout?.columns ?? 1);
    rows.disabled = columns.disabled = locked.checked;
    rebuildCustomRow();
  };
  const search = h('input', { type: 'search', placeholder: t('Suchen …'), oninput: () => ((filter = search.value.toLowerCase()), renderLists()) }) as HTMLInputElement;
  const avail = h('div', { class: 'tb-list' });
  const current = h('div', { class: 'tb-list' });

  const row = (a: Action | null, extra: Record<string, unknown>) => {
    // Knopfgruppen zeigen das Symbol der Aktion, die sie gerade tragen
    const ic = !a || isButtonAction(a) ? a : groupCurrent(a);
    const face = isButtonAction(ic) ? ic : null;
    return h('div', { class: 'tb-row', tabIndex: 0, role: 'button',
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          (event.currentTarget as HTMLElement).click();
        } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          // Nur in der rechten Liste: Ein-/Ausrücken per Tastatur; links bleibt Tab-Navigation.
          if ((event.currentTarget as HTMLElement).closest?.('.tb-list') !== current) return;
          event.preventDefault();
          if (event.shiftKey) outdent();
          else indent();
        }
      }, ...extra },
      face ? h('span', { class: `tb-icon${face.icon ? '' : ' text'}`, icon: face.icon ?? '' }, face.icon ? null : face.short ?? '') : h('span', { class: 'tb-icon' }),
      h('span', {}, a ? a.label : t('— Trennlinie —')),
    );
  };

  const add = (id: string) => {
    const item = newItem(id);
    const leaf = leafForGroup(item);
    if (selChild !== undefined && leaf) {
      // In die gewählte Gruppe hinter dem Kind einfügen; Knopfgruppen nie verschachteln.
      const list = barItems(bar);
      const ref = list[selIdx];
      if (ref?.kind === 'group' && isEditableFlyout(ref.id) && system) {
        const gid = ref.id;
        const group = ownEntry(system.runtime.read().content.groups, gid);
        if (group) {
          const items = [...group.items];
          const at = Math.min(selChild + 1, items.length);
          items.splice(at, 0, leaf);
          const added = system.runtime.setGroupItems(gid, { kind: group.kind, items });
          if (added && added.ok) {
            selChild = at;
            renderLists();
            return;
          }
          selChild = undefined;
        }
      }
    }
    const list = barItems(bar);
    const at = selIdx >= 0 ? selIdx + 1 : list.length;
    list.splice(at, 0, item);
    selIdx = at;
    selChild = undefined;
    setBar(bar, list);
    renderLists();
  };
  const removeSel = () => {
    if (selIdx < 0) return;
    const list = barItems(bar);
    const ref = list[selIdx];
    if (selChild !== undefined && ref?.kind === 'group' && isEditableFlyout(ref.id)) {
      removeGroupChild(ref.id, selChild);
      return;
    }
    if (ref?.kind === 'group' && isEditableFlyout(ref.id)) {
      // Gruppe auflösen: Kinder steigen als normale Aktionszeilen auf.
      const group = system && ownEntry(system.runtime.read().content.groups, ref.id);
      if (group) {
        const risen: Item[] = group.items.map((leaf) => leaf.kind === 'separator' ? { kind: 'separator' } as Item
          : actions.get(leaf.id)?.items ? { kind: 'group', id: leaf.id } : { kind: 'action', id: leaf.id });
        const next = [...list];
        next.splice(selIdx, 1, ...risen);
        selIdx = Math.min(selIdx, next.length - 1);
        selChild = undefined;
        const replaced = setBar(bar, next);
        if (replaced && replaced.ok) dropCustomGroup(ref.id);
        reinitAfterCustomChange(bar);
        return;
      }
    }
    const next = list.filter((_, i) => i !== selIdx);
    selIdx = Math.min(selIdx, next.length - 1);
    selChild = undefined;
    setBar(bar, next);
    renderLists();
  };
  /** Kind aus einer Aktionsgruppe löschen; leere Gruppe löst sich samt Kopfzeile auf. */
  const removeGroupChild = (gid: string, child: number) => {
    const current = system;
    if (!current) return;
    const group = ownEntry(current.runtime.read().content.groups, gid);
    if (!group || child < 0 || child >= group.items.length || !isEditableFlyout(gid)) return;
    const list = barItems(bar);
    const rest = group.items.filter((_, i) => i !== child);
    if (!rest.length) {
      const updated = current.runtime.setGroupItems(gid, { kind: group.kind, items: rest });
      if (!updated || !updated.ok) return;
      const next = list.filter((_, i) => i !== selIdx);
      selIdx = Math.min(selIdx, next.length - 1);
      selChild = undefined;
      const removed = setBar(bar, next);
      if (removed && removed.ok) dropCustomGroup(gid);
      else current.runtime.setGroupItems(gid, { kind: group.kind, items: group.items });
      reinitAfterCustomChange(bar);
      return;
    }
    const updated = current.runtime.setGroupItems(gid, { kind: group.kind, items: rest });
    if (!updated || !updated.ok) return;
    selChild = Math.min(child, rest.length - 1);
    renderLists();
  };
  const move = (d: number) => {
    if (selChild !== undefined) {
      const current = system;
      const ref = current && barItems(bar)[selIdx];
      if (!current || !ref || ref.kind !== 'group' || !isEditableFlyout(ref.id)) {
        selChild = undefined;
        return;
      }
      const group = ownEntry(current.runtime.read().content.groups, ref.id);
      if (!group) return;
      const k = selChild + d;
      if (k < 0 || k >= group.items.length) return;
      const items = [...group.items];
      [items[selChild], items[k]] = [items[k], items[selChild]];
      const moved = current.runtime.setGroupItems(ref.id, { kind: group.kind, items });
      if (!moved || !moved.ok) return;
      selChild = k;
      renderLists();
      return;
    }
    const list = barItems(bar);
    const k = selIdx + d;
    if (selIdx < 0 || k < 0 || k >= list.length) return;
    [list[selIdx], list[k]] = [list[k], list[selIdx]];
    selIdx = k;
    selChild = undefined;
    setBar(bar, list);
    renderLists();
  };

  /** Gruppenblatt fürs Einrücken: nur Aktionen (keine Separatoren, Controls, Knopfgruppen — keine Verschachtelung). */
  const leafForGroup = (item: Item): Leaf | undefined => {
    if (item.kind === 'separator' || item.kind === 'group' || item.kind === 'control') return undefined;
    if (actions.get(item.id)?.items) return undefined;
    const resolved = system?.registry.resolveLegacy(item.id);
    if (resolved === 'control' || resolved === 'group') return undefined;
    return { kind: 'action', id: item.id };
  };
  /** Einrückziel: Zeilenaktion mit einrückbarer Vorzeile (Aktion oder Aktionsgruppe). */
  const indentTarget = (): { prev: Item; target: Item } | undefined => {
    if (!system || selIdx <= 0 || selChild !== undefined) return undefined;
    const list = barItems(bar);
    const target = list[selIdx];
    const prev = list[selIdx - 1];
    if (!target || !prev || prev.kind === 'separator' || !leafForGroup(target)) return undefined;
    if (prev.kind === 'group') {
      if (!isEditableFlyout(prev.id)) return undefined;
    } else if (!leafForGroup(prev)) return undefined;
    return { prev, target };
  };
  const canIndent = () => indentTarget() !== undefined;
  const canOutdent = () => {
    if (selIdx < 0 || selChild === undefined) return false;
    const ref = barItems(bar)[selIdx];
    return !!ref && ref.kind === 'group' && isEditableFlyout(ref.id);
  };
  const indent = () => {
    const current = system;
    const found = indentTarget();
    if (!current || !found) return;
    const list = barItems(bar);
    const childLeaf = leafForGroup(found.target);
    if (!childLeaf) return;
    if (found.prev.kind === 'group') {
      // Unter Aktionsgruppe einrücken: Kind hinten anhängen (kein Re-Init nötig).
      const gid = found.prev.id;
      const group = ownEntry(current.runtime.read().content.groups, gid);
      if (!group) return;
      const items = [...group.items, childLeaf];
      const next = [...list];
      next.splice(selIdx, 1);
      const unlisted = setBar(bar, next);
      if (!unlisted || !unlisted.ok) return;
      const appended = current.runtime.setGroupItems(gid, { kind: group.kind, items });
      if (!appended || !appended.ok) {
        setBar(bar, list);
        return;
      }
      selChild = items.length - 1;
      selIdx--;
      renderLists();
      return;
    }
    // Unter Aktions-Zeile einrücken: neue eigene Gruppe aus Kopf-Aktion und Kind (kleinstfreies N).
    const headLeaf = leafForGroup(found.prev);
    if (!headLeaf) return;
    const taken = new Set(Object.keys(current.runtime.read().content.groups));
    let n = 1;
    while (taken.has(`custom-group-${n}`)) n++;
    const gid = `custom-group-${n}`;
    const label = t('Gruppe {n}', { n });
    const items = [headLeaf, childLeaf];
    const custom = current.runtime as ToolbarSystem['runtime'] & CustomGroupMethods;
    if (typeof custom.addGroup === 'function') {
      const added = custom.addGroup({ id: gid, label, items: clone(items) });
      if (added && added.ok) {
        trackSessionCustomGroup(gid, label);
        const next = [...list];
        next.splice(selIdx - 1, 2, { kind: 'group', id: gid });
        const listed = setBar(bar, next);
        if (!listed || !listed.ok) {
          if (typeof custom.removeGroup === 'function') custom.removeGroup(gid);
          else dropCustomGroup(gid);
          sessionCustomGroups = sessionCustomGroups.filter((group) => group.id !== gid);
          return;
        }
        reinitAfterCustomChange(bar);
        return;
      }
      if (!added || added.error !== 'Built-in group') return;
    }
    // Rückweg: Gruppe und Leistenbelegung in einer Storage-Transaktion schreiben, dann Re-Init.
    trackSessionCustomGroup(gid, label);
    const next = [...list];
    next.splice(selIdx - 1, 2, { kind: 'group', id: gid });
    const stored = commitGroupEdit((state) => {
      setEntry(state.content.groups, gid, { kind: 'flyout', items: clone(items) });
      const labels = storedLabels(state.content.labels);
      labels[gid] = label;
      (state.content as { labels?: Record<string, string> }).labels = labels;
      setEntry(state.content.bars, bar, clone(next));
    });
    if (!stored && current.runtime.persistence().writable) {
      sessionCustomGroups = sessionCustomGroups.filter((group) => group.id !== gid);
      return;
    }
    reinitAfterCustomChange(bar);
  };
  const outdent = () => {
    const current = system;
    if (!current || selIdx < 0 || selChild === undefined) return;
    const list = barItems(bar);
    const ref = list[selIdx];
    if (!ref || ref.kind !== 'group' || !isEditableFlyout(ref.id)) return;
    const gid = ref.id;
    const group = ownEntry(current.runtime.read().content.groups, gid);
    if (!group || selChild >= group.items.length) return;
    const leaf = group.items[selChild];
    const risen: Item = leaf.kind === 'separator' ? { kind: 'separator' }
      : actions.get(leaf.id)?.items ? { kind: 'group', id: leaf.id } : { kind: 'action', id: leaf.id };
    const rest = group.items.filter((_, i) => i !== selChild);
    if (!rest.length) {
      // Letztes Kind ausgerückt: Gruppe auflösen, Kopf wird normale Aktionszeile.
      const updated = current.runtime.setGroupItems(gid, { kind: group.kind, items: rest });
      if (!updated || !updated.ok) return;
      const next = [...list];
      next.splice(selIdx, 1, risen);
      const replaced = setBar(bar, next);
      if (!replaced || !replaced.ok) {
        current.runtime.setGroupItems(gid, { kind: group.kind, items: group.items });
        return;
      }
      dropCustomGroup(gid);
      selChild = undefined;
      reinitAfterCustomChange(bar);
      return;
    }
    const updated = current.runtime.setGroupItems(gid, { kind: group.kind, items: rest });
    if (!updated || !updated.ok) return;
    const next = [...list];
    next.splice(selIdx + 1, 0, risen);
    const listed = setBar(bar, next);
    if (!listed || !listed.ok) {
      current.runtime.setGroupItems(gid, { kind: group.kind, items: group.items });
      return;
    }
    selIdx = selIdx + 1;
    selChild = undefined;
    renderLists();
  };

  let dragFrom: { kind: 'avail'; id: string } | { kind: 'cur'; index: number; child?: number } | null = null;
  const renderLists = () => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.tb-row') : null;
    const focusList = focused && (avail.contains(focused) ? avail : current.contains(focused) ? current : null);
    const focusIndex = focusList && focused ? [...focusList.querySelectorAll('.tb-row')].indexOf(focused) : -1;
    const focusId = focused?.dataset.action;
    const used = new Set(barItems(bar).flatMap((item) => {
      if (item.kind === 'group') {
        const group = system && ownEntry(system.runtime.read().content.groups, item.id);
        return [item.id, ...(group?.items ?? []).flatMap((leaf) => leaf.kind === 'separator' ? [] : [leaf.id])];
      }
      return 'id' in item ? [item.id] : [];
    }));
    avail.replaceChildren();
    let cat = '';
    for (const a of actions.values()) {
      if (filter && !a.label.toLowerCase().includes(filter) && !a.cat.toLowerCase().includes(filter)) continue;
      if (a.cat !== cat) avail.append(h('div', { class: 'tb-cat' }, (cat = a.cat)));
      const r = row(a, {
        draggable: true,
        onclick: () => ((selAvail = a.id), renderLists()),
        ondblclick: () => add(a.id),
        ondragstart: () => (dragFrom = { kind: 'avail', id: a.id }),
      });
      r.dataset.action = a.id;
      r.classList.toggle('sel', selAvail === a.id);
      r.classList.toggle('used', used.has(a.id));
      avail.append(r);
    }
    current.replaceChildren();
    barItems(bar).forEach((item, i) => {
      if (item.kind === 'group' && isEditableFlyout(item.id)) {
        const state = system?.runtime.read();
        const group = state && ownEntry(state.content.groups, item.id);
        if (group) {
          // Aktionsgruppe: Kopf zeigt den Gruppennamen (statt das Knopfgesicht zu
          // wiederholen), Kinder eingerückt darunter — kein Mitglied doppelt.
          const labels = state ? storedLabels(state.content.labels) : {};
          const head: Action = { id: item.id, cat: '', label: labels[item.id] ?? actions.get(item.id)?.label ?? item.id, short: '▾', run() {} };
          const header = row(head, {
            draggable: true,
            onclick: () => ((selIdx = i), (selChild = undefined), renderLists()),
            ondblclick: () => ((selIdx = i), (selChild = undefined), removeSel()),
            ondragstart: () => (dragFrom = { kind: 'cur', index: i }),
          });
          header.dataset.index = String(i);
          header.dataset.group = item.id;
          header.classList.toggle('sel', i === selIdx && selChild === undefined);
          current.append(header);
          group.items.forEach((leaf, c) => {
            const lid = leaf.kind === 'separator' ? SEP : leaf.id;
            const unknown: Action = { id: lid, cat: '', label: lid, short: lid, run() {} };
             const child = row(leaf.kind === 'separator' ? null : actions.get(lid) ?? unknown, {
              draggable: true,
              onclick: () => ((selIdx = i), (selChild = c), renderLists()),
              ondblclick: () => ((selIdx = i), (selChild = c), removeSel()),
              ondragstart: () => (dragFrom = { kind: 'cur', index: i, child: c }),
            });
            child.dataset.index = String(i);
            child.dataset.child = String(c);
            child.style.setProperty('padding-left', '1.5em');
            child.classList.toggle('sel', i === selIdx && c === selChild);
            current.append(child);
          });
          return;
        }
      }
      const id = 'id' in item ? item.id : SEP;
      const unknown: Action = { id, cat: '', label: id, short: id, run() {} };
      const r = row(item.kind === 'separator' ? null : actions.get(id) ?? unknown, {
        draggable: true,
        onclick: () => ((selIdx = i), (selChild = undefined), renderLists()),
        ondblclick: () => ((selIdx = i), (selChild = undefined), removeSel()),
        ondragstart: () => (dragFrom = { kind: 'cur', index: i }),
      });
      r.dataset.index = String(i);
      r.classList.toggle('sel', i === selIdx && selChild === undefined);
      current.append(r);
    });
    if (!barItems(bar).length) current.append(h('div', { class: 'muted tb-hint' }, t('Aktionen hierher ziehen')));
    if (indentBtn) indentBtn.disabled = !canIndent();
    if (outdentBtn) outdentBtn.disabled = !canOutdent();
    if (focusList) {
      const rows = [...focusList.querySelectorAll<HTMLElement>('.tb-row')];
      const replacement = focusList === avail ? rows.find((candidate) => candidate.dataset.action === focusId) : rows[Math.min(focusIndex, rows.length - 1)];
      (replacement ?? search).focus();
    }
  };
  // Ziehen: aus „Verfügbar“ einfügen oder in der Leiste umsortieren
  const dropIndex = (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.tb-row');
    if (!r?.dataset.index) return barItems(bar).length;
    const box = r.getBoundingClientRect();
    return Number(r.dataset.index) + (e.clientY > box.top + box.height / 2 ? 1 : 0);
  };
  current.addEventListener('dragover', (e) => {
    if (!dragFrom) return;
    e.preventDefault();
    current.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const k = dropIndex(e);
    const rows = current.querySelectorAll('.tb-row');
    if (k < rows.length) rows[k].classList.add('drop-before');
    else rows[rows.length - 1]?.classList.add('drop-after');
  });
  current.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragFrom) return;
    const list = barItems(bar);
    let k = dropIndex(e);
    const targetRow = (e.target as HTMLElement).closest<HTMLElement>('.tb-row');
    const targetIndex = targetRow?.dataset.index === undefined ? -1 : Number(targetRow.dataset.index);
    const targetRef = list[targetIndex];
    const targetGroupId = targetRow?.dataset.child !== undefined && targetRef?.kind === 'group' && isEditableFlyout(targetRef.id) ? targetRef.id : undefined;
    const sourceRef = dragFrom.kind === 'cur' ? list[dragFrom.index] : undefined;
    const sourceGroupId = dragFrom.kind === 'cur' && dragFrom.child !== undefined && sourceRef?.kind === 'group' && isEditableFlyout(sourceRef.id) ? sourceRef.id : undefined;
    if (targetGroupId || sourceGroupId) {
      const runtime = system?.runtime;
      if (!runtime) return;
      const state = runtime.read();
      const sourceGroup = sourceGroupId ? ownEntry(state.content.groups, sourceGroupId) : undefined;
      const sourceChild = dragFrom.kind === 'cur' ? dragFrom.child : undefined;
      const dragged: Item | undefined = sourceGroup && sourceChild !== undefined ? sourceGroup.items[sourceChild]
        : dragFrom.kind === 'avail' ? newItem(dragFrom.id) : list[dragFrom.index];
      if (!dragged) return;
      const leaf = leafForGroup(dragged);
      if (targetGroupId && !leaf) return;
      const changes = new Map<string, { kind: 'flyout' | 'section'; items: Leaf[] }>();
      if (sourceGroup && sourceGroupId && sourceChild !== undefined)
        changes.set(sourceGroupId, { kind: sourceGroup.kind, items: sourceGroup.items.filter((_, i) => i !== sourceChild) });
      if (targetGroupId && leaf) {
        const group = changes.get(targetGroupId) ?? ownEntry(state.content.groups, targetGroupId);
        if (!group) return;
        const items = [...group.items];
        const box = targetRow!.getBoundingClientRect();
        let at = Number(targetRow!.dataset.child) + (e.clientY > box.top + box.height / 2 ? 1 : 0);
        if (sourceGroupId === targetGroupId && sourceChild !== undefined && at > sourceChild) at--;
        items.splice(at, 0, leaf);
        changes.set(targetGroupId, { kind: group.kind, items });
      }
      const next = [...list];
      if (dragFrom.kind === 'cur' && !sourceGroupId) {
        next.splice(dragFrom.index, 1);
        if (k > dragFrom.index) k--;
      }
      if (!targetGroupId) next.splice(k, 0, dragged);
      const emptied = sourceGroupId && changes.get(sourceGroupId)?.items.length === 0 ? sourceGroupId : undefined;
      const final = emptied ? next.filter((item) => item.kind !== 'group' || item.id !== emptied) : next;
      const restore = () => {
        for (const id of changes.keys()) {
          const group = ownEntry(state.content.groups, id);
          if (group) runtime.setGroupItems(id, group);
        }
      };
      for (const [id, group] of changes) {
        if (!runtime.setGroupItems(id, group).ok) { restore(); return; }
      }
      if (!setBar(bar, final)?.ok) { restore(); return; }
      if (emptied) dropCustomGroup(emptied);
      selIdx = -1;
      selChild = undefined;
      dragFrom = null;
      if (emptied && CUSTOM_GROUP.test(emptied)) reinitAfterCustomChange(bar);
      else renderLists();
      return;
    }
    if (dragFrom.kind === 'avail') list.splice(k, 0, newItem(dragFrom.id));
    else {
      const [x] = list.splice(dragFrom.index, 1);
      if (k > dragFrom.index) k--;
      list.splice(k, 0, x);
    }
    selIdx = k;
    selChild = undefined;
    dragFrom = null;
    setBar(bar, list);
    renderLists();
  });
  avail.addEventListener('dragover', (e) => dragFrom?.kind === 'cur' && e.preventDefault());
  avail.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragFrom?.kind !== 'cur') return;
    selIdx = dragFrom.index;
    selChild = dragFrom.child;
    dragFrom = null;
    removeSel();
  });
  const btn = (label: string, title: string, f: () => void) => h('button', { class: 'btn', title, onclick: f }, label);
  // Erstellen-Zeile; für eigene Leisten zusätzlich Umbenennen (Textfeld) und Löschen (mit Bestätigung).
  const customRow = h('div', { class: 'tb-top' });
  const newName = h('input', { type: 'text', placeholder: t('Name der neuen Leiste'), 'aria-label': t('Neue Leiste') }) as HTMLInputElement;
  const rebuildCustomRow = () => {
    customRow.replaceChildren(
      h('label', {}, t('Neue Leiste'), newName),
      btn(t('Erstellen'), t('Neue Leiste'), () => void createToolbar(newName.value)),
    );
    if (!CUSTOM_BAR.test(bar)) return;
    const target = editableBars.find((candidate) => candidate.id === bar);
    if (!target) return;
    const rename: HTMLInputElement = h('input', { type: 'text', value: target.label, 'aria-label': t('Name'),
      onchange: () => void renameToolbar(bar, rename.value) });
    customRow.append(
      h('label', {}, t('Name'), rename),
      btn(t('Löschen'), t('Leiste löschen'), () => {
        if (confirm(t('Leiste „{name}“ löschen?', { name: target.label }))) deleteToolbar(bar);
      }),
    );
  };
  const dlg = h(
    'dialog',
    { class: 'toolbar-dialog' },
    h('h3', {}, t('Funktionsleisten anpassen')),
    h('div', { class: 'tb-top' },
      h('label', {}, t('Leiste'), barSel),
      h('label', {}, t('Symbolgröße'), sizeSel),
      h('label', { class: 'check' }, shownChk, t('Anzeigen')),
    ),
    h('div', { class: 'tb-top' },
      h('label', {}, t('Zeilen der Leiste'), rows),
      h('label', {}, t('Spalten der Leiste'), columns),
      h('label', { class: 'check' }, locked, t('Leistenlayout sperren')),
    ),
    customRow,
    h('div', { class: 'tb-cols' },
      h('div', { class: 'tb-col' }, h('div', { class: 'tb-head' }, t('Verfügbare Aktionen')), search, avail),
      h('div', { class: 'tb-mid' },
        btn('→', t('Gewählte Aktion hinter der markierten Stelle einfügen'), () => selAvail && add(selAvail)),
        btn('←', t('Markierten Eintrag aus der Leiste entfernen'), removeSel),
      ),
      h('div', { class: 'tb-col' }, h('div', { class: 'tb-head' }, t('In der Leiste')), current,
        h('div', { class: 'tb-btns' },
          btn('↑', t('Nach oben bzw. links'), () => move(-1)),
          btn('↓', t('Nach unten bzw. rechts'), () => move(1)),
          (indentBtn = btn('⇥', t('Eintrag einrücken'), indent)),
          (outdentBtn = btn('⇤', t('Eintrag ausrücken'), outdent)),
          btn(t('Trennlinie'), t('Trennlinie hinter der markierten Stelle einfügen'), () => add(SEP)),
        ),
      ),
    ),
    h('p', { class: 'note' }, t('Doppelklick fügt hinzu bzw. entfernt. Einträge lassen sich auch ziehen. Änderungen gelten sofort.')),
    h('div', { class: 'dialog-buttons' },
      btn(t('Standard wiederherstellen'), t('Diese Leiste auf die Standardbelegung zurücksetzen'), () => {
        selIdx = -1;
        selChild = undefined;
        system?.runtime.resetBarContent(bar);
        sync();
        renderLists();
      }),
      (layoutResetButton = btn(t('Leistenlayout zurücksetzen'), t('Positionen und Sichtbarkeit zurücksetzen; Belegung und Symbolgrößen behalten'), () => {
        system?.runtime.layout({ kind: 'reset' });
        sync();
      })),
      btn(t('Alle Belegungen zurücksetzen'), t('Belegungen zurücksetzen; Positionen und Symbolgrößen behalten'), () => {
        system?.runtime.resetContent();
        selIdx = -1;
        selChild = undefined;
        sync();
        renderLists();
      }),
      h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen')),
    ),
  );
  const unsubscribe = system.runtime.subscribe(sync);
  const close = () => {
    unsubscribe();
    if (dlg.open) dlg.close();
    dlg.remove();
    if (closeDialog === close) closeDialog = undefined;
  };
  closeDialog = close;
  dlg.addEventListener('close', close);
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  sync();
  renderLists();
  dlg.showModal();
}
