// Anpassbare Funktionsleisten: Hauptleiste oben und Werkzeugleiste links bestehen aus Aktionen, deren
// Auswahl und Reihenfolge der Nutzer festlegt (Fenster → Funktionsleisten anpassen … oder Rechtsklick auf
// eine Leiste). Außerdem lassen sich alle Leisten (auch Eigenschaften, Palette, Statusleiste) ausblenden.
// Gespeichert wird je Nutzer im localStorage („kizamubeam.toolbars“).
import { ICONS } from './icons';
import { $, h } from './dom';
import { t } from './i18n';

export interface Action {
  id: string;
  /** Rubrik im Anpassen-Dialog */
  cat: string;
  /** Name in Listen und Tooltip (mit Tastenkürzel) */
  label: string;
  /** Symbol aus icons.ts; ohne Symbol zeigt die Leiste den Kurztext */
  icon?: string;
  short?: string;
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

export type BarId = 'main' | 'tools';
/** Leisten, die sich ausblenden lassen */
export type BarKey = BarId | 'numbar' | 'textbar' | 'palette' | 'status';
type IconSize = 's' | 'm' | 'l';

interface Config {
  /** Version der gespeicherten Belegung (2: Knopfgruppen, 3: Werkzeugkasten, 4: Generatoren/Verbindungen im Werkzeugkasten, 5: Beziehungen/Messen, 6: Vektorwerkzeuge, 7: Kamera-Overlay) */
  v: number;
  bars: Record<BarId, string[]>;
  size: Record<BarId, IconSize>;
  hidden: BarKey[];
  /** Zuletzt benutzte Aktion je Knopfgruppe */
  groups: Record<string, string>;
}

const KEY = 'kizamubeam.toolbars';
export const SEP = '|';
const BAR_EL: Record<BarKey, string> = { main: '#toolbar', tools: '#tools', numbar: '#numbar', textbar: '#textbar', palette: '#palette', status: '#status' };

const actions = new Map<string, Action>();
/** Aktion zu einer Kennung (z. B. für die Kacheln im Werkzeugkasten) */
export const getAction = (id: string) => actions.get(id);
let defaults: Record<BarId, string[]> = { main: [], tools: [] };
let cfg: Config;
/** Ersatz alter Einzelknopf-Folgen durch Knopfgruppen in gespeicherten Leisten (Version 1 → 2) */
let migrations: [string[], string][] = [];

const CONFIG_V = 10;
/** Neue Standardknöpfe: ab Version v der Belegung, hinter after (sonst ans Ende) */
const ADDED: { v: number; bar: BarId; id: string; after: string }[] = [
  { v: 3, bar: 'tools', id: 'apps', after: 'grp:gen' },
  { v: 5, bar: 'tools', id: 'grp:relate', after: 'nest' },
  { v: 5, bar: 'tools', id: 'tool:measure', after: 'grp:relate' },
  { v: 8, bar: 'tools', id: 'vectorfit', after: 'tool:node' },
  { v: 7, bar: 'main', id: 'camera-overlays', after: 'view3d' },
  { v: 8, bar: 'tools', id: 'isolate', after: 'vectorfit' },
  { v: 6, bar: 'tools', id: 'tool:pencil', after: 'tool:line' },
  { v: 6, bar: 'tools', id: 'vectorfit', after: 'tool:node' },
  { v: 6, bar: 'tools', id: 'shape-builder', after: 'vectorfit' },
  { v: 6, bar: 'tools', id: 'isolate', after: 'shape-builder' },
  { v: 7, bar: 'main', id: 'camera-overlays', after: 'view3d' },
  { v: 9, bar: 'tools', id: 'laserpos', after: 'tool:measure' },
];
/** Aus der Standardbelegung entfernte Knöpfe (seit v4 im Werkzeugkasten bzw. Laser-Fenster): eine gespeicherte
 *  Leiste verliert sie nur, wenn die Folge seq noch genau so dasteht; sie wird durch keep ersetzt.
 *  Selbst umgestellte Leisten bleiben, wie sie sind. */
const REMOVED: { v: number; bar: BarId; seq: string[]; keep: string[] }[] = [
  { v: 4, bar: 'tools', seq: ['grp:gen', 'apps'], keep: ['apps'] },
  { v: 4, bar: 'tools', seq: ['tool:joint', 'lidhinge', 'hinge'], keep: [] },
  { v: 4, bar: 'main', seq: ['check', 'preview', 'devsettings'], keep: ['check', 'preview'] },
];

/** Gespeicherte Leiste auf die aktuelle Standardbelegung heben (raw: Version der gespeicherten Belegung) */
export function upgradeBar(bar: BarId, list: string[], raw: number): string[] {
  const out = [...list];
  // Knöpfe, die mit einer späteren Version dazukamen, einmal aufnehmen
  for (const a of ADDED) if (a.bar === bar && !(raw >= a.v) && !out.includes(a.id)) insertAfter(out, a.id, a.after);
  // v10: Geräteeinstellungen an den Anfang der Prüf/Vorschau-Gruppe (vor „check")
  if (bar === 'main' && !(raw >= 10) && !out.includes('devsettings')) {
    const i = out.indexOf('check');
    if (i >= 0) out.splice(i, 0, 'devsettings');
    else out.push('devsettings');
  }
  for (const r of REMOVED) {
    if (r.bar !== bar || raw >= r.v) continue;
    for (let i = 0; i + r.seq.length <= out.length; i++)
      if (r.seq.every((x, k) => out[i + k] === x)) {
        out.splice(i, r.seq.length, ...r.keep);
        break;
      }
  }
  return out;
}

function insertAfter(list: string[], id: string, after: string) {
  const i = list.indexOf(after);
  if (i < 0) list.push(id);
  else list.splice(i + 1, 0, id);
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
  list.forEach((a) => actions.set(a.id, a));
  defaults = def;
  migrations = migrate;
  cfg = load();
  for (const k of Object.keys(BAR_EL) as BarKey[]) applyHidden(k);
  renderBar('main');
  renderBar('tools');
  for (const id of ['main', 'tools'] as BarId[])
    $(BAR_EL[id]).addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      barMenu(id, e.clientX, e.clientY, btn?.dataset.action ?? null, btn ? [...$(BAR_EL[id]).children].indexOf(btn) : -1 /* jeder Eintrag ist genau ein Element */);
    });
}

/** Aktivierung und Zustand aller Knöpfe nachziehen (nach Auswahl- oder Werkzeugwechsel) */
export function refreshBars() {
  for (const id of ['main', 'tools'] as BarId[])
    for (const el of $(BAR_EL[id]).querySelectorAll<HTMLElement>('[data-action]')) {
      const g = actions.get(el.dataset.action!)!;
      // Knopfgruppe: der Hauptknopf zeigt die zuletzt benutzte Aktion
      const a = g.items ? groupCurrent(g) : g;
      const b = (g.items ? el.firstElementChild : el) as HTMLButtonElement;
      if (g.items && b.dataset.cur !== a.id) {
        b.dataset.cur = a.id;
        paint(b, a);
      }
      if (a.enabled) b.disabled = !a.enabled();
      else b.disabled = false;
      if (a.on) {
        const pressed = a.on();
        b.classList.toggle('on', pressed);
        b.setAttribute('aria-pressed', String(pressed));
      } else {
        b.classList.remove('on');
        b.removeAttribute('aria-pressed');
      }

      if (a.dyn) {
        const d = a.dyn();
        if (d.icon && b.dataset.icon !== d.icon) ((b.innerHTML = ICONS[d.icon]), (b.dataset.icon = d.icon));
        if (d.label) b.title = d.label;
      }
      if (g.items) (el.lastElementChild as HTMLElement).title = t('Weitere: {name}', { name: g.label });
    }
}

/** Die Aktion, die eine Knopfgruppe gerade zeigt */
function groupCurrent(g: Action): Action {
  const id = cfg.groups[g.id];
  return actions.get(id && g.items!.includes(id) ? id : g.items!.find((x) => !actions.get(x)?.small)!)!;
}

/** Symbol bzw. Kurztext und Tooltip einer Aktion auf einen Knopf setzen */
function paint(b: HTMLElement, a: Action) {
  b.className = `ib${a.icon ? '' : ' text'}${a.small ? ' small' : ''}`;
  b.title = a.label;
  if (a.icon) {
    b.innerHTML = ICONS[a.icon];
    b.dataset.icon = a.icon;
  } else {
    b.textContent = a.short ?? a.label;
    delete b.dataset.icon;
  }
}

export const isBarHidden = (k: BarKey) => cfg.hidden.includes(k);

export function toggleBar(k: BarKey) {
  cfg.hidden = isBarHidden(k) ? cfg.hidden.filter((x) => x !== k) : [...cfg.hidden, k];
  applyHidden(k);
  save();
}

/** Ein- und Ausblenden der Leisten im Menü Fenster zurücksetzen */
export function showAllBars() {
  cfg.hidden = [];
  for (const k of Object.keys(BAR_EL) as BarKey[]) applyHidden(k);
  save();
}

function applyHidden(k: BarKey) {
  $(BAR_EL[k]).hidden = isBarHidden(k);
}

function load(): Config {
  const c: Config = { v: CONFIG_V, bars: { main: [...defaults.main], tools: [...defaults.tools] }, size: { main: 'm', tools: 'm' }, hidden: [], groups: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const id of ['main', 'tools'] as BarId[]) {
        if (Array.isArray(raw.bars?.[id])) {
          let list: string[] = raw.bars[id];
          if (!(raw.v >= 2)) list = migrate(list);
          list = upgradeBar(id, list, Number(raw.v) || 1);
          c.bars[id] = list.filter((x) => x === SEP || actions.has(x));
        }
        if (['s', 'm', 'l'].includes(raw.size?.[id])) c.size[id] = raw.size[id];
      }
      if (Array.isArray(raw.hidden)) c.hidden = raw.hidden.filter((x: unknown) => (x as string) in BAR_EL);
      if (raw.groups && typeof raw.groups === 'object')
        for (const [g, a] of Object.entries(raw.groups)) if (actions.get(g)?.items?.includes(a as string)) c.groups[g] = a as string;
    }
  } catch {
    /* Speicher nicht verfügbar oder kaputt: Standard */
  }
  return c;
}

/** Ältere Belegung: zusammenhängende Folgen von Einzelknöpfen, die jetzt eine Knopfgruppe sind, ersetzen.
 *  Selbst zusammengestellte Folgen bleiben, wie sie sind. */
function migrate(list: string[]): string[] {
  const out = [...list];
  for (const [seq, group] of migrations)
    for (let i = 0; i + seq.length <= out.length; i++)
      if (seq.every((x, k) => out[i + k] === x)) out.splice(i, seq.length, group);
  return out;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

function renderBar(id: BarId) {
  const bar = $(BAR_EL[id]);
  bar.replaceChildren();
  bar.dataset.size = cfg.size[id];
  for (const x of cfg.bars[id]) {
    if (x === SEP) {
      bar.append(h('div', { class: 'sep' }));
      continue;
    }
    const a = actions.get(x)!;
    if (a.items) {
      const main = h('button', { onclick: () => groupCurrent(a).run() });
      paint(main, groupCurrent(a));
      main.dataset.cur = groupCurrent(a).id;
      const more = h('button', { class: 'ib-more', onclick: () => groupMenu(id, a, wrap) }, '▾');
      const wrap = h('div', { class: 'ib-group' }, main, more);
      wrap.dataset.action = a.id;
      bar.append(wrap);
      continue;
    }
    const b = h('button', { onclick: () => a.run() });
    paint(b, a);
    b.dataset.action = a.id;
    bar.append(b);
  }
  if (!cfg.bars[id].length) bar.append(h('span', { class: 'muted bar-empty' }, t('Leer – Rechtsklick zum Anpassen')));
  refreshBars();
}

function setBar(id: BarId, list: string[]) {
  // Doppelte Trennlinien und solche am Rand weglassen
  const out: string[] = [];
  for (const x of list) if (x !== SEP || (out.length && out[out.length - 1] !== SEP)) out.push(x);
  while (out[out.length - 1] === SEP) out.pop();
  cfg.bars[id] = out;
  save();
  renderBar(id);
}

// ---------- Aufgeklappte Knopfgruppe ----------

/** Tooltip als Menüeintrag: Erklärung nach dem Doppelpunkt weglassen, Tastenkürzel rechts */
function menuLabel(label: string) {
  const name = label.split(': ')[0];
  const m = /^(.*?) \(([^()]{1,14})\)$/.exec(name);
  return [h('span', { title: label }, m ? m[1] : name), m ? h('kbd', {}, m[2]) : null];
}

function groupMenu(bar: BarId, g: Action, anchor: HTMLElement) {
  if (document.querySelector(`.ctx-menu[data-group="${g.id}"]`)) return document.querySelector('.ctx-menu')?.remove();
  document.querySelector('.ctx-menu')?.remove();
  const close = () => (menu.remove(), document.removeEventListener('mousedown', outside, true));
  const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && !anchor.contains(e.target as Node) && close();
  const cur = groupCurrent(g).id;
  const menu = h('div', { class: 'ctx-menu menu-items group-menu with-checks' });
  menu.dataset.group = g.id;
  for (const id of g.items!) {
    const a = actions.get(id);
    if (!a) continue;
    if (a.small) menu.append(h('hr'));
    const b = h('button', {
      disabled: a.enabled ? !a.enabled() : false,
      onclick: () => {
        close();
        if (!a.small) {
          cfg.groups[g.id] = a.id;
          save();
          refreshBars();
        }
        a.run();
      },
    },
      h('span', { class: 'check-mark' }, id === cur ? '✓' : ''),
      h('span', { class: 'tb-icon', html: a.icon ? ICONS[a.icon] : '' }),
      ...menuLabel(a.dyn?.().label ?? a.label),
    );
    menu.append(b);
  }
  const r = anchor.getBoundingClientRect();
  document.body.append(menu);
  // Hauptleiste: unter der Gruppe; Werkzeugleiste: rechts daneben
  const x = bar === 'main' ? r.left : r.right + 2;
  const y = bar === 'main' ? r.bottom + 2 : r.top;
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
  document.addEventListener('mousedown', outside, true);
}

// ---------- Kontextmenü einer Leiste ----------

function barMenu(id: BarId, x: number, y: number, action: string | null, index: number) {
  document.querySelector('.ctx-menu')?.remove();
  const close = () => (menu.remove(), document.removeEventListener('mousedown', outside, true));
  const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && close();
  const item = (label: string, f: () => void) => h('button', { onclick: () => (close(), f()) }, label);
  const a = action ? actions.get(action) : null;
  const menu = h(
    'div',
    { class: 'ctx-menu menu-items' },
    item(t('Funktionsleisten anpassen …'), () => openToolbarDialog(id)),
    a ? item(t('„{name}“ aus der Leiste entfernen', { name: a.label.replace(/ \(.*\)$/, '') }), () => setBar(id, cfg.bars[id].filter((_, i) => i !== index))) : null,
    h('hr'),
    item(t('{bar} ausblenden', { bar: barNames()[id] }), () => toggleBar(id)),
  );
  menu.style.left = `${Math.min(x, window.innerWidth - 260)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  document.body.append(menu);
  document.addEventListener('mousedown', outside, true);
}

// ---------- Anpassen-Dialog ----------

export function openToolbarDialog(start: BarId = 'main') {
  let bar: BarId = start;
  let selAvail: string | null = null;
  let selIdx = -1;
  let filter = '';
  const names = barNames();
  const barSel = h('select', { onchange: () => ((bar = barSel.value as BarId), (selIdx = -1), sync(), renderLists()) },
    h('option', { value: 'main' }, names.main),
    h('option', { value: 'tools' }, names.tools),
  ) as HTMLSelectElement;
  barSel.value = bar;
  const sizeSel = h('select', { onchange: () => ((cfg.size[bar] = sizeSel.value as IconSize), save(), renderBar(bar)) },
    h('option', { value: 's' }, t('Klein|Symbole')),
    h('option', { value: 'm' }, t('Normal|Symbole')),
    h('option', { value: 'l' }, t('Groß|Symbole')),
  ) as HTMLSelectElement;
  const shownChk = h('input', { type: 'checkbox', onchange: () => toggleBar(bar) }) as HTMLInputElement;
  const sync = () => {
    sizeSel.value = cfg.size[bar];
    shownChk.checked = !isBarHidden(bar);
  };
  const search = h('input', { type: 'search', placeholder: t('Suchen …'), oninput: () => ((filter = search.value.toLowerCase()), renderLists()) }) as HTMLInputElement;
  const avail = h('div', { class: 'tb-list' });
  const current = h('div', { class: 'tb-list' });

  const row = (a: Action | null, extra: Record<string, unknown>) => {
    // Knopfgruppen zeigen das Symbol der Aktion, die sie gerade tragen
    const ic = a?.items ? groupCurrent(a) : a;
    return h('div', { class: 'tb-row', ...extra },
      ic ? h('span', { class: `tb-icon${ic.icon ? '' : ' text'}`, html: ic.icon ? ICONS[ic.icon] : '' }, ic.icon ? null : ic.short ?? '') : h('span', { class: 'tb-icon' }),
      h('span', {}, a ? a.label : t('— Trennlinie —')),
    );
  };

  const add = (id: string) => {
    const list = [...cfg.bars[bar]];
    const at = selIdx >= 0 ? selIdx + 1 : list.length;
    list.splice(at, 0, id);
    selIdx = at;
    setBar(bar, list);
    renderLists();
  };
  const removeSel = () => {
    if (selIdx < 0) return;
    const list = cfg.bars[bar].filter((_, i) => i !== selIdx);
    selIdx = Math.min(selIdx, list.length - 1);
    setBar(bar, list);
    renderLists();
  };
  const move = (d: number) => {
    const list = [...cfg.bars[bar]];
    const k = selIdx + d;
    if (selIdx < 0 || k < 0 || k >= list.length) return;
    [list[selIdx], list[k]] = [list[k], list[selIdx]];
    selIdx = k;
    setBar(bar, list);
    renderLists();
  };

  let dragFrom: { kind: 'avail'; id: string } | { kind: 'cur'; index: number } | null = null;
  const renderLists = () => {
    const used = new Set(cfg.bars[bar]);
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
      r.classList.toggle('sel', selAvail === a.id);
      r.classList.toggle('used', used.has(a.id));
      avail.append(r);
    }
    current.replaceChildren();
    cfg.bars[bar].forEach((id, i) => {
      const r = row(id === SEP ? null : actions.get(id)!, {
        draggable: true,
        onclick: () => ((selIdx = i), renderLists()),
        ondblclick: () => ((selIdx = i), removeSel()),
        ondragstart: () => (dragFrom = { kind: 'cur', index: i }),
      });
      r.dataset.index = String(i);
      r.classList.toggle('sel', i === selIdx);
      current.append(r);
    });
    if (!cfg.bars[bar].length) current.append(h('div', { class: 'muted tb-hint' }, t('Aktionen hierher ziehen')));
  };
  // Ziehen: aus „Verfügbar“ einfügen oder in der Leiste umsortieren
  const dropIndex = (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.tb-row');
    if (!r?.dataset.index) return cfg.bars[bar].length;
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
    const list = [...cfg.bars[bar]];
    let k = dropIndex(e);
    if (dragFrom.kind === 'avail') list.splice(k, 0, dragFrom.id);
    else {
      const [x] = list.splice(dragFrom.index, 1);
      if (k > dragFrom.index) k--;
      list.splice(k, 0, x);
    }
    selIdx = k;
    dragFrom = null;
    setBar(bar, list);
    renderLists();
  });
  avail.addEventListener('dragover', (e) => dragFrom?.kind === 'cur' && e.preventDefault());
  avail.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragFrom?.kind !== 'cur') return;
    selIdx = dragFrom.index;
    dragFrom = null;
    removeSel();
  });
  const btn = (label: string, title: string, f: () => void) => h('button', { class: 'btn', title, onclick: f }, label);
  const dlg = h(
    'dialog',
    { class: 'toolbar-dialog' },
    h('h3', {}, t('Funktionsleisten anpassen')),
    h('div', { class: 'tb-top' },
      h('label', {}, t('Leiste'), barSel),
      h('label', {}, t('Symbolgröße'), sizeSel),
      h('label', { class: 'check' }, shownChk, t('Anzeigen')),
    ),
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
          btn(t('Trennlinie'), t('Trennlinie hinter der markierten Stelle einfügen'), () => add(SEP)),
        ),
      ),
    ),
    h('p', { class: 'note' }, t('Doppelklick fügt hinzu bzw. entfernt. Einträge lassen sich auch ziehen. Änderungen gelten sofort.')),
    h('div', { class: 'dialog-buttons' },
      btn(t('Standard wiederherstellen'), t('Diese Leiste auf die Standardbelegung zurücksetzen'), () => {
        selIdx = -1;
        cfg.size[bar] = 'm';
        setBar(bar, [...defaults[bar]]);
        sync();
        renderLists();
      }),
      h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  sync();
  renderLists();
  dlg.showModal();
}
