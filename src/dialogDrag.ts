// Modale Dialoge an ihrer Titelleiste verschiebbar machen und die Position merken.
// Ein globales Modul statt Änderungen in jeder Dialogdatei: ein MutationObserver bemerkt, wenn ein
// <dialog> geöffnet wird, macht seinen Titel zur Leiste (wie bei den schwebenden Dock-Fenstern) und
// stellt die gespeicherte Position wieder her; das Ziehen läuft über einen Zeiger-Handler am Dokument.
// Ähnliche Dialoge teilen sich eine Position (alle Werkzeuge, alle Einstellungen, große Fenster), die
// übrigen merken sich ihre eigene. Gespeichert wird wie beim Dock-Layout im localStorage; beim Öffnen
// und bei Größenänderungen des Fensters wird neu begrenzt, damit der Titel immer erreichbar bleibt.

export interface DlgPos {
  x: number;
  y: number;
}

const KEY = 'kizamubeam.dialogPos';
const MIN_VISIBLE = 80; // so viel vom Titel bleibt mindestens waagerecht im Fenster
const MAX_ENTRIES = 50;
/** Dialoge ohne Titelleiste bleiben fest */
const EXCLUDED = ['about'];
/**
 * Dialogarten, die sich eine Position teilen (die erste passende Klasse gewinnt). Die Geräteeinstellungen
 * (device-dialog) sind sehr hoch und behalten deshalb ihren eigenen Platz.
 */
const GROUPS: [group: string, classes: string[]][] = [
  ['tools', ['offset-dialog', 'outline-tool-window']],
  ['settings', ['setup-dialog', 'devices-dialog', 'material-dialog', 'layer-dialog', 'sync-dialog', 'packs-dialog', 'toolbar-dialog', 'update-dialog', 'fluid-dialog']],
  ['large', ['preview-dialog', 'camera-dialog', 'mt-dialog', 'tp-dialog', 'tpl-dialog']],
];
/** Ein Klick auf diese Elemente in der Leiste bedient sie, statt den Dialog zu ziehen */
const INTERACTIVE = 'button, input, select, textarea, a, label';
/** Tooltip des Schließen-Kreuzes; kommt übersetzt aus app.ts, damit dieses Modul ohne DOM testbar bleibt */
let closeLabel = () => 'Close';

/** Position so begrenzen, dass der Titel immer erreichbar im Fenster bleibt (wie clampFloat in dock.ts) */
export function clampDialogPos(p: DlgPos, w: number, vw: number, vh: number): DlgPos {
  const maxX = Math.max(0, vw - Math.min(w, MIN_VISIBLE));
  const maxY = Math.max(0, vh - 30);
  const x = Math.max(0, Math.min(maxX, p.x));
  const y = Math.max(0, Math.min(maxY, p.y));
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/**
 * Speicherschlüssel: die Gruppe, sonst die Klassen des Dialogs, sonst sein Titel.
 * Der Titel zählt nur ohne Klassen, damit Sprache oder Gerätename die Position nicht ändern.
 */
export function positionKey(classes: readonly string[], title: string): string {
  for (const [group, list] of GROUPS) if (classes.some((c) => list.includes(c))) return group;
  if (classes.length) return [...classes].sort().join('.');
  return `|${title.trim()}`;
}

export function loadPositions(store: Pick<Storage, 'getItem'> | null): Record<string, DlgPos> {
  const out: Record<string, DlgPos> = {};
  try {
    const raw = JSON.parse(store?.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, DlgPos>)) {
        if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) out[k] = { x: v.x, y: v.y };
      }
    }
  } catch {
    /* kein Speicher oder beschädigter Eintrag: Standardposition */
  }
  return out;
}

export function savePosition(store: Pick<Storage, 'getItem' | 'setItem'> | null, key: string, p: DlgPos) {
  try {
    const all = loadPositions(store);
    delete all[key]; // ans Ende der Reihenfolge, damit die ältesten zuerst wegfallen
    all[key] = { x: Math.round(p.x), y: Math.round(p.y) };
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k];
    store?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Speichern nicht möglich: Position gilt nur für diese Sitzung */
  }
}

/** Forget all remembered positions: dialogs open centred again (Settings → Appearance) */
export function resetDialogPositions(store: Pick<Storage, 'removeItem'> | null = storage()) {
  try {
    store?.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Titelleiste des Dialogs: sein erstes Kind, wenn es ein h3 ist oder mit einem h3 beginnt (z. B. Titel
 * und Schließen-Knopf im Einrichtungsassistenten). Sonst null: der Dialog bleibt fest.
 */
function headerOf(dlg: HTMLDialogElement): HTMLElement | null {
  if (EXCLUDED.some((c) => dlg.classList.contains(c))) return null;
  const c = dlg.firstElementChild;
  if (!(c instanceof HTMLElement)) return null;
  return c.tagName === 'H3' || c.firstElementChild?.tagName === 'H3' ? c : null;
}

/** Schlüssel einmal beim ersten Öffnen festhalten, bevor der Schließen-Knopf den Titeltext ergänzt */
function keyOf(dlg: HTMLDialogElement, bar: HTMLElement): string {
  return (dlg.dataset.dlgPos ??= positionKey(Array.from(dlg.classList), bar.textContent || ''));
}

/**
 * Schließen-Kreuz rechts in der Leiste, falls der Dialog dort noch keinen Knopf hat. Es verhält sich wie
 * die Esc-Taste: erst das abbrechbare „cancel“-Ereignis (Dialoge räumen dort auf oder verhindern das
 * Schließen), dann close().
 */
function addClose(dlg: HTMLDialogElement, bar: HTMLElement) {
  if (bar.querySelector('button')) return;
  bar.append(
    Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'ib dlg-close',
      title: closeLabel(),
      textContent: '✕',
      onclick: () => {
        if (dlg.dispatchEvent(new Event('cancel', { cancelable: true }))) dlg.close();
      },
    }),
  );
}

function place(dlg: HTMLDialogElement, p: DlgPos) {
  dlg.style.margin = '0';
  dlg.style.inset = `${p.y}px auto auto ${p.x}px`;
}

function clampTo(dlg: HTMLDialogElement, p: DlgPos): DlgPos {
  return clampDialogPos(p, dlg.getBoundingClientRect().width, window.innerWidth, window.innerHeight);
}

/** Die Leiste reicht über den Innenabstand des Dialogs bis an seinen Rand, egal wie groß dieser ist */
function fitBar(dlg: HTMLDialogElement, bar: HTMLElement) {
  const cs = getComputedStyle(dlg);
  const top = parseFloat(cs.paddingTop) || 0;
  const left = parseFloat(cs.paddingLeft) || 0;
  const right = parseFloat(cs.paddingRight) || 0;
  bar.classList.add('dlg-bar');
  bar.style.marginTop = `${-top}px`;
  bar.style.marginLeft = `${-left}px`;
  bar.style.marginRight = `${-right}px`;
  bar.style.top = `${-top}px`; // bleibt beim Scrollen langer Dialoge oben stehen
  bar.style.paddingLeft = `${Math.max(left, 12)}px`;
  bar.style.paddingRight = `${Math.max(right, 12)}px`;
}

function onOpen(dlg: HTMLDialogElement) {
  const bar = headerOf(dlg);
  if (!bar) return;
  fitBar(dlg, bar);
  const key = keyOf(dlg, bar);
  addClose(dlg, bar);
  const saved = loadPositions(storage())[key];
  if (saved) place(dlg, clampTo(dlg, saved));
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !(e.target instanceof Element)) return;
  const bar = e.target.closest<HTMLElement>('.dlg-bar');
  const dlg = bar?.parentElement;
  if (!bar || !(dlg instanceof HTMLDialogElement) || !dlg.open) return;
  if (e.target.closest(INTERACTIVE)) return;
  e.preventDefault();
  const r = dlg.getBoundingClientRect();
  const dx = e.clientX - r.left;
  const dy = e.clientY - r.top;
  let pos: DlgPos = { x: r.left, y: r.top };
  bar.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    pos = clampTo(dlg, { x: ev.clientX - dx, y: ev.clientY - dy });
    place(dlg, pos);
  };
  const end = () => {
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', end);
    bar.removeEventListener('pointercancel', end);
    savePosition(storage(), keyOf(dlg, bar), pos);
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

/** Geöffnete, verschobene Dialoge nach einer Größenänderung des Fensters wieder ins Bild holen */
function onResize() {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dlg) => {
    if (!dlg.style.inset || !headerOf(dlg)) return;
    const r = dlg.getBoundingClientRect();
    place(dlg, clampTo(dlg, { x: r.left, y: r.top }));
  });
}

export function initDialogDrag(label?: () => string) {
  if (typeof document === 'undefined') return;
  if (label) closeLabel = label;
  new MutationObserver((list) => {
    for (const m of list) {
      const t = m.target;
      if (t instanceof HTMLDialogElement && t.open && m.oldValue === null) onOpen(t);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
  document.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
}
