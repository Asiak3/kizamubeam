// Andockbare Fenster wie in LightBurn: Jedes Werkzeugfenster (Schnitte/Layer, Objekte, Laser, Verschieben,
// Konsole, Material, Kamera) sitzt in einer Gruppe. Gruppen stapeln sich links oder rechts der Arbeitsfläche
// oder schweben frei. Mehrere Fenster in einer Gruppe werden zu Reitern.
//
// Bedienung: Reiter ziehen = umsortieren (auf einen Reiterkopf: als Reiter, an den oberen/unteren Rand einer
// Gruppe: darüber/darunter, auf die Arbeitsfläche: freies Fenster). Trennlinien zwischen den Gruppen und der
// Rand der Andockleiste ändern die Größe. × blendet ein Fenster aus, das Menü Fenster blendet es wieder ein.
// Die Anordnung wird je Nutzer im localStorage gespeichert („kizamubeam.layout“).
import { h } from './dom';
import { t } from './i18n';

type Side = 'left' | 'right';

interface Group {
  tabs: string[];
  active: string;
  /** Höhenanteil in der Andockleiste (Pixel beim letzten Verstellen) */
  size: number;
  collapsed?: boolean;
}

interface Float extends Group {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  v: 1;
  left: Group[];
  right: Group[];
  leftW: number;
  rightW: number;
  floats: Float[];
  hidden: string[];
}

interface Win {
  id: string;
  title: string;
  body: HTMLElement;
  badge: string;
  onShow?: () => void;
  /** Neu hinzugekommen: als freies, ausgeblendetes Fenster dieser Größe anlegen (statt als Reiter rechts) */
  float?: { w: number; h: number };
  /** Neu hinzugekommen: als Reiter in die Gruppe dieses Fensters (statt in die letzte Gruppe rechts) */
  near?: string;
  /** Standardplatz links; bei schon gespeicherter Anordnung erst ausgeblendet (siehe isNewWindow) */
  left?: boolean;
}

const KEY = 'kizamubeam.layout';
const MIN_DOCK = 180;
const MIN_GROUP = 60;

const wins = new Map<string, Win>();
let layout: Layout;
let shownBefore = new Set<string>();
const addedLater = new Set<string>();
/** Erst nach dem ersten Aufbau melden, dass ein Fenster sichtbar wurde */
let started = false;

function defaultLayout(): Layout {
  const g = (tabs: string[], size: number): Group => ({ tabs, active: tabs[0], size });
  return {
    v: 1,
    left: [...wins.values()].filter((w) => w.left).map((w) => g([w.id], 300)),
    right: [g(['cuts'], 220), g(['objects', 'history', 'params', 'notes'], 260), g(['laser', 'move', 'console', 'material', 'camera'], 400)],
    leftW: 280,
    rightW: 310,
    floats: [],
    hidden: [],
  };
}

/**
 * Meldet ein Werkzeugfenster an und liefert seinen Inhaltsbereich. Muss vor initDock() aufgerufen werden.
 * onShow läuft, sobald das Fenster sichtbar wird (z. B. um verschobenes Neuzeichnen nachzuholen).
 */
export function dockWindow(id: string, title: string, opts: { bodyId?: string; onShow?: () => void; float?: { w: number; h: number }; near?: string; left?: boolean } = {}): HTMLElement {
  const body = h('div', { class: `panel-body win-body win-${id}`, id: opts.bodyId });
  // Bis initDock() in einem unsichtbaren Halter, damit $('#…') den Inhalt schon findet
  let holder = document.getElementById('dock-holder');
  if (!holder) document.body.append((holder = h('div', { id: 'dock-holder', hidden: true })));
  holder.append(body);
  wins.set(id, { id, title, body, badge: '', onShow: opts.onShow, float: opts.float, near: opts.near, left: opts.left });
  return body;
}

/** Aufruf, sobald das Fenster sichtbar wird (nicht beim ersten Aufbau) */
/** Fenster kam mit diesem Start zu einer schon gespeicherten Anordnung dazu (für einen einmaligen Hinweis) */
export const isNewWindow = (id: string) => addedLater.has(id);

export function onWindowShow(id: string, f: () => void) {
  wins.get(id)!.onShow = f;
}

/** Inhaltsbereich eines angemeldeten Fensters */
export const windowBody = (id: string) => wins.get(id)!.body;

/** Kleiner Zusatz hinter dem Reitertitel, z. B. die Objektzahl */
export function setBadge(id: string, text: string) {
  const w = wins.get(id);
  if (!w || w.badge === text) return;
  w.badge = text;
  document.querySelectorAll<HTMLElement>(`.dg-tab[data-win="${id}"] .dg-badge`).forEach((el) => (el.textContent = text));
}

/** Alle Fenster in Anmeldereihenfolge (für das Menü Fenster) */
export const windowList = () => [...wins.values()].map((w) => ({ id: w.id, title: w.title }));

/** Ist das Fenster gerade zu sehen (nicht ausgeblendet, vorderster Reiter, Gruppe nicht eingeklappt)? */
export const isShown = (id: string) => shownNow().has(id);

export const isHidden = (id: string) => !!layout && layout.hidden.includes(id);

export function toggleWindow(id: string) {
  if (isHidden(id)) showWindow(id);
  else hideWindow(id);
}

export function hideWindow(id: string) {
  if (!isHidden(id)) layout.hidden.push(id);
  commit();
}

/** Einblenden, nach vorne holen und die Gruppe aufklappen */
export function showWindow(id: string) {
  layout.hidden = layout.hidden.filter((x) => x !== id);
  const g = findGroup(id);
  if (g) {
    g.active = id;
    g.collapsed = false;
  }
  commit();
}

export function resetLayout() {
  layout = defaultLayout();
  commit();
}

// ---------- Laden, Speichern, Prüfen ----------

function load(): Layout {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    raw = null;
  }
  const l = raw && typeof raw === 'object' && (raw as Layout).v === 1 ? (raw as Layout) : null;
  if (!l) {
    const d = defaultLayout();
    // Früher ließ sich nur das Objekte-Fenster einklappen: diese Wahl übernehmen
    try {
      if (localStorage.getItem('kizamubeam.objectsPanel') === '0') d.right[1].collapsed = true;
    } catch {
      /* Speicher nicht verfügbar */
    }
    return d;
  }
  return l;
}

/** Unbekannte Fenster entfernen, neue (aus späteren Versionen) ergänzen, leere Gruppen streichen */
function normalize(l: Layout): Layout {
  const seen = new Set<string>();
  const fix = (g: Group) => {
    g.tabs = (Array.isArray(g.tabs) ? g.tabs : []).filter((id) => wins.has(id) && !seen.has(id) && seen.add(id));
    if (!g.tabs.includes(g.active)) g.active = g.tabs[0];
    if (!(g.size > 0)) g.size = 300;
    return g.tabs.length > 0;
  };
  const out: Layout = {
    v: 1,
    left: (Array.isArray(l.left) ? l.left : []).filter(fix),
    right: (Array.isArray(l.right) ? l.right : []).filter(fix),
    leftW: Number(l.leftW) || 280,
    rightW: Number(l.rightW) || 310,
    floats: (Array.isArray(l.floats) ? l.floats : []).filter(fix),
    hidden: (Array.isArray(l.hidden) ? l.hidden : []).filter((id) => wins.has(id)),
  };
  for (const [id, w] of wins)
    if (!seen.has(id) && w.float) {
      // Große Fenster (z. B. 3D-Ansicht) erst auf Wunsch zeigen, frei über der Arbeitsfläche
      const f: Float = { tabs: [id], active: id, size: 1, w: w.float.w, h: w.float.h, x: Math.max(0, (window.innerWidth - w.float.w) / 2), y: 90 };
      clampFloat(f);
      out.floats.push(f);
      if (!out.hidden.includes(id)) out.hidden.push(id);
    } else if (!seen.has(id) && w.left) {
      // Neu in einer gespeicherten Anordnung: links bereitstellen, aber nicht ungefragt einblenden
      out.left.push({ tabs: [id], active: id, size: 300 });
      if (!out.hidden.includes(id)) out.hidden.push(id);
      if (!started) addedLater.add(id);
    } else if (!seen.has(id)) {
      const near = w.near && [...out.left, ...out.right, ...out.floats].find((g) => g.tabs.includes(w.near!));
      const last = near || out.right[out.right.length - 1];
      if (last) last.tabs.push(id);
      else out.right.push({ tabs: [id], active: id, size: 300 });
    }
  return out;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

function commit() {
  layout = normalize(layout);
  save();
  render();
}

const allGroups = (): Group[] => [...layout.left, ...layout.right, ...layout.floats];
const findGroup = (id: string) => allGroups().find((g) => g.tabs.includes(id));
const visibleTabs = (g: Group) => g.tabs.filter((id) => !layout.hidden.includes(id));
const activeOf = (g: Group) => {
  const v = visibleTabs(g);
  return v.includes(g.active) ? g.active : v[0];
};

function shownNow() {
  const s = new Set<string>();
  // Vor dem ersten Aufbau gilt alles als sichtbar, damit die Fenster ihren Inhalt einmal füllen
  if (!layout) return new Set(wins.keys());
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  for (const g of allGroups()) {
    const a = activeOf(g);
    if (!a || g.collapsed) continue;
    if (narrow && !layout.floats.includes(g as Float)) continue;
    s.add(a);
  }
  return s;
}

/** Gruppe aus ihrer Liste entfernen (Andockleiste oder frei) */
function removeGroup(g: Group) {
  for (const list of [layout.left, layout.right, layout.floats] as Group[][]) {
    const i = list.indexOf(g);
    if (i >= 0) list.splice(i, 1);
  }
}

const sideOf = (g: Group): Side | null => (layout.left.includes(g) ? 'left' : layout.right.includes(g) ? 'right' : null);

// ---------- Darstellung ----------

let dockEls: Record<Side, HTMLElement>;
let floatLayer: HTMLElement;

export function initDock() {
  dockEls = { left: document.getElementById('dock-left')!, right: document.getElementById('dock-right')! };
  floatLayer = h('div', { id: 'dock-floats' });
  document.getElementById('app')!.append(floatLayer);
  layout = normalize(load());
  // scroll steigt nicht auf, daher in der Einfangphase; ein verdecktes Element (Position 0) nicht überschreiben
  document.addEventListener('scroll', (e) => {
    const el = e.target;
    if (el instanceof HTMLElement && el.offsetParent !== null && el.closest('.win-body')) scrolled.set(el, [el.scrollTop, el.scrollLeft]);
  }, true);
  render();
  started = true;
  window.addEventListener('resize', () => {
    clampFloats();
    render();
  });
}

/**
 * Letzte Bildlaufposition der gescrollten Elemente in den Fenstern (Issue #264). render() nimmt die Fenster aus dem
 * Dokument und hängt sie wieder ein, dabei setzt der Browser jede Liste an den Anfang zurück; ein verdeckter Reiter
 * verliert seine Position ebenfalls. Gemerkt wird beim Scrollen, damit auch verdeckte Reiter ihre Position behalten.
 */
const scrolled = new Map<HTMLElement, [number, number]>();

function restoreScroll() {
  for (const [el, [top, left]] of scrolled) {
    // Elemente, die ein Fenster nicht mehr enthält (neu aufgebaute Inhalte), vergessen
    if (![...wins.values()].some((w) => w.body.contains(el))) scrolled.delete(el);
    else if (el.offsetParent !== null) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  }
}

function render() {
  for (const side of ['left', 'right'] as Side[]) {
    const el = dockEls[side];
    const groups = layout[side].filter((g) => visibleTabs(g).length);
    el.replaceChildren();
    el.classList.toggle('empty', !groups.length);
    el.style.width = groups.length ? `${side === 'left' ? layout.leftW : layout.rightW}px` : '';
    groups.forEach((g, i) => {
      if (i) el.append(splitter(groups[i - 1], g));
      el.append(groupEl(g, false));
    });
    if (groups.length) el.append(edge(side));
  }
  floatLayer.replaceChildren();
  for (const f of layout.floats) {
    if (!visibleTabs(f).length) continue;
    const el = groupEl(f, true);
    Object.assign(el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: f.collapsed ? '' : `${f.h}px` });
    el.append(h('div', { class: 'float-resize', onpointerdown: (e: PointerEvent) => resizeFloat(e, f, el) }));
    floatLayer.append(el);
  }
  restoreScroll();
  // Ein aus dem Dokument genommenes Video hält an: Kamera-Vorschau weiterlaufen lassen
  document.querySelectorAll<HTMLVideoElement>('.win-body video').forEach((v) => v.paused && v.srcObject && v.play().catch(() => {}));
  const now = shownNow();
  if (started) for (const id of now) if (!shownBefore.has(id)) wins.get(id)?.onShow?.();
  shownBefore = now;
}

function groupEl(g: Group, floating: boolean): HTMLElement {
  const active = activeOf(g);
  const tabs = visibleTabs(g);
  const head = h('div', { class: 'dg-head' });
  for (const id of tabs) {
    const w = wins.get(id)!;
    const tab = h(
      'div',
      { class: `dg-tab${id === active ? ' cur' : ''}`, title: t('Ziehen zum Umsortieren, Andocken oder Lösen') },
      h('span', { class: 'dg-title' }, w.title),
      h('span', { class: 'dg-badge muted' }, w.badge),
      h('button', {
        class: 'dg-close',
        title: t('Fenster ausblenden (Menü Fenster blendet es wieder ein)'),
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => (e.stopPropagation(), hideWindow(id)),
      }, '×'),
    );
    tab.dataset.win = id;
    tab.addEventListener('pointerdown', (e) => tabDown(e, g, id));
    head.append(tab);
  }
  head.append(h('div', { class: 'dg-fill' }));
  if (floating) {
    head.append(h('button', { class: 'dg-btn', title: t('Rechts andocken'), onclick: () => dockFloat(g as Float) }, '⇥'));
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.dg-tab, button')) return;
      moveFloat(e, g as Float);
    });
    head.addEventListener('dblclick', (e) => !(e.target as HTMLElement).closest('.dg-tab, button') && dockFloat(g as Float));
  } else {
    head.addEventListener('dblclick', (e) => !(e.target as HTMLElement).closest('.dg-tab, button') && toggleCollapse(g));
  }
  head.append(
    h('button', { class: 'dg-btn', title: g.collapsed ? t('Aufklappen') : t('Einklappen'), onclick: () => toggleCollapse(g) }, g.collapsed ? '▸' : '▾'),
  );
  const content = h('div', { class: 'dg-content' });
  for (const id of tabs) {
    const b = wins.get(id)!.body;
    b.hidden = id !== active;
    content.append(b);
  }
  const el = h('div', { class: `dock-group${floating ? ' floating' : ''}${g.collapsed ? ' collapsed' : ''}` }, head, content);
  if (!floating) el.style.flex = g.collapsed ? '0 0 auto' : `${g.size} 1 0px`;
  (el as HTMLElement & { _group?: Group })._group = g;
  return el;
}

function toggleCollapse(g: Group) {
  g.collapsed = !g.collapsed;
  commit();
}

function dockFloat(f: Float) {
  removeGroup(f);
  layout.right.push({ tabs: f.tabs, active: f.active, size: f.h });
  commit();
}

// ---------- Größe ändern ----------

/** Trennlinie zwischen zwei Gruppen einer Andockleiste */
function splitter(a: Group, b: Group): HTMLElement {
  const el = h('div', { class: 'dock-split', title: t('Ziehen ändert die Höhe') });
  el.addEventListener('pointerdown', (e) => {
    if (a.collapsed || b.collapsed) return;
    e.preventDefault();
    const elA = el.previousElementSibling as HTMLElement;
    const elB = el.nextElementSibling as HTMLElement;
    const hA = elA.getBoundingClientRect().height;
    const hB = elB.getBoundingClientRect().height;
    // Alle Anteile auf die aktuellen Pixelhöhen setzen, damit sich nur die beiden Nachbarn ändern
    const dock = el.parentElement!;
    for (const ge of dock.querySelectorAll<HTMLElement>(':scope > .dock-group')) {
      const g = (ge as HTMLElement & { _group?: Group })._group;
      if (g && !g.collapsed) g.size = ge.getBoundingClientRect().height;
    }
    drag(e, (_dx, dy) => {
      const nA = Math.max(MIN_GROUP, Math.min(hA + hB - MIN_GROUP, hA + dy));
      a.size = nA;
      b.size = hA + hB - nA;
      elA.style.flex = `${a.size} 1 0px`;
      elB.style.flex = `${b.size} 1 0px`;
    }, save);
  });
  return el;
}

/** Innerer Rand einer Andockleiste: Breite ändern */
function edge(side: Side): HTMLElement {
  const el = h('div', { class: `dock-edge ${side}`, title: t('Ziehen ändert die Breite') });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const start = side === 'left' ? layout.leftW : layout.rightW;
    const max = Math.max(MIN_DOCK, window.innerWidth * 0.6);
    drag(e, (dx) => {
      const w = Math.round(Math.max(MIN_DOCK, Math.min(max, start + (side === 'left' ? dx : -dx))));
      if (side === 'left') layout.leftW = w;
      else layout.rightW = w;
      dockEls[side].style.width = `${w}px`;
    }, save);
  });
  return el;
}

function moveFloat(e: PointerEvent, f: Float) {
  if (e.button !== 0) return;
  const el = (e.currentTarget as HTMLElement).parentElement!;
  const x0 = f.x,
    y0 = f.y;
  drag(e, (dx, dy) => {
    f.x = x0 + dx;
    f.y = y0 + dy;
    clampFloat(f);
    el.style.left = `${f.x}px`;
    el.style.top = `${f.y}px`;
  }, save);
}

function resizeFloat(e: PointerEvent, f: Float, el: HTMLElement) {
  e.preventDefault();
  e.stopPropagation();
  const w0 = f.w,
    h0 = f.h;
  drag(e, (dx, dy) => {
    f.w = Math.max(MIN_DOCK, Math.min(window.innerWidth - f.x, w0 + dx));
    f.h = Math.max(MIN_GROUP * 2, Math.min(window.innerHeight - f.y, h0 + dy));
    el.style.width = `${f.w}px`;
    el.style.height = `${f.h}px`;
  }, save);
}

function clampFloat(f: Float) {
  f.w = Math.min(f.w, window.innerWidth);
  f.h = Math.min(f.h, window.innerHeight - 24);
  f.x = Math.max(0, Math.min(window.innerWidth - Math.min(f.w, 80), f.x));
  f.y = Math.max(24, Math.min(window.innerHeight - 30, f.y));
}

function clampFloats() {
  layout.floats.forEach(clampFloat);
}

/** Zeigerbewegung verfolgen, bis die Taste losgelassen wird */
function drag(e: PointerEvent, move: (dx: number, dy: number) => void, done: () => void) {
  const x0 = e.clientX,
    y0 = e.clientY;
  document.body.classList.add('dock-resizing');
  const mv = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0);
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('dock-resizing');
    done();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// ---------- Reiter ziehen ----------

type Target =
  | { kind: 'tab'; group: Group; index: number }
  | { kind: 'split'; side: Side; ref: Group | null; after: boolean }
  | { kind: 'float'; x: number; y: number };

function tabDown(e: PointerEvent, g: Group, id: string) {
  if (e.button !== 0) return;
  const x0 = e.clientX,
    y0 = e.clientY;
  let started = false;
  let ghost: HTMLElement | null = null;
  let mark: HTMLElement | null = null;
  let target: Target | null = null;
  const srcRect = (e.currentTarget as HTMLElement).closest('.dock-group')!.getBoundingClientRect();
  const mv = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      started = true;
      document.body.classList.add('dock-dragging');
      ghost = h('div', { class: 'dock-ghost' }, wins.get(id)!.title);
      mark = h('div', { class: 'dock-mark' });
      document.body.append(ghost, mark);
    }
    ghost!.style.left = `${ev.clientX + 12}px`;
    ghost!.style.top = `${ev.clientY + 8}px`;
    target = findTarget(ev.clientX, ev.clientY);
    const r = target && markRect(target, srcRect);
    mark!.hidden = !r;
    if (r) Object.assign(mark!.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!started) {
      // Einfacher Klick: Reiter nach vorne holen
      if (g.active !== id || g.collapsed) {
        g.active = id;
        g.collapsed = false;
        commit();
      }
      return;
    }
    ghost?.remove();
    mark?.remove();
    document.body.classList.remove('dock-dragging');
    if (target) applyDrop(id, g, target, srcRect);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function findTarget(x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  const ge = el.closest('.dock-group') as (HTMLElement & { _group?: Group }) | null;
  const g = ge?._group;
  if (ge && g) {
    const head = ge.querySelector('.dg-head')!;
    const side = sideOf(g);
    const r = ge.getBoundingClientRect();
    const rel = (y - r.top) / r.height;
    if (!head.contains(el) && side && !g.collapsed && (rel < 0.25 || rel > 0.75)) return { kind: 'split', side, ref: g, after: rel > 0.75 };
    // Einfügestelle zwischen den Reitern
    const tabs = [...head.querySelectorAll<HTMLElement>('.dg-tab')];
    let index = g.tabs.length;
    for (const tb of tabs) {
      const tr = tb.getBoundingClientRect();
      if (head.contains(el) && x < tr.left + tr.width / 2) {
        index = g.tabs.indexOf(tb.dataset.win!);
        break;
      }
    }
    return { kind: 'tab', group: g, index };
  }
  const dock = el.closest('.dock') as HTMLElement | null;
  if (dock) {
    const side: Side = dock.id === 'dock-left' ? 'left' : 'right';
    const list = layout[side];
    return { kind: 'split', side, ref: list[list.length - 1] ?? null, after: true };
  }
  if (el.closest('#stage')) return { kind: 'float', x, y };
  return null;
}

/** Rechteck, das die Zielposition während des Ziehens anzeigt */
function markRect(tg: Target, src: DOMRect): { x: number; y: number; w: number; h: number } | null {
  const rectOf = (g: Group) => {
    const el = [...document.querySelectorAll<HTMLElement & { _group?: Group }>('.dock-group')].find((x) => x._group === g);
    return el?.getBoundingClientRect();
  };
  if (tg.kind === 'float') return { x: tg.x - 20, y: tg.y - 10, w: Math.min(src.width, 320), h: Math.min(src.height, 360) };
  if (tg.kind === 'tab') {
    const r = rectOf(tg.group);
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }
  const dr = dockEls[tg.side].getBoundingClientRect();
  const r = tg.ref && rectOf(tg.ref);
  if (!r) return { x: dr.x, y: dr.y, w: Math.max(dr.width, 60), h: dr.height };
  const hh = Math.min(r.height / 2, 160);
  return { x: r.x, y: tg.after ? r.bottom - hh : r.y, w: r.width, h: hh };
}

function applyDrop(id: string, from: Group, tg: Target, src: DOMRect) {
  const detach = () => {
    from.tabs = from.tabs.filter((x) => x !== id);
    if (from.active === id) from.active = from.tabs[0];
    if (!from.tabs.length) removeGroup(from);
  };
  if (tg.kind === 'tab') {
    if (tg.group === from) {
      // Reihenfolge innerhalb der Gruppe
      const i = from.tabs.indexOf(id);
      let k = tg.index;
      if (k === i || k === i + 1) return;
      from.tabs.splice(i, 1);
      if (k > i) k--;
      from.tabs.splice(k, 0, id);
      from.active = id;
      return commit();
    }
    detach();
    tg.group.tabs.splice(Math.min(tg.index, tg.group.tabs.length), 0, id);
    tg.group.active = id;
    tg.group.collapsed = false;
    return commit();
  }
  if (tg.kind === 'float') {
    if (from.tabs.length === 1 && layout.floats.includes(from as Float)) {
      // Freies Fenster mit nur diesem Reiter: einfach verschieben
      const f = from as Float;
      f.x = tg.x - 20;
      f.y = tg.y - 10;
      clampFloat(f);
      return commit();
    }
    detach();
    const f: Float = { tabs: [id], active: id, size: 1, x: tg.x - 20, y: tg.y - 10, w: Math.max(MIN_DOCK, Math.min(src.width, 320)), h: Math.max(160, Math.min(src.height, 420)) };
    clampFloat(f);
    layout.floats.push(f);
    return commit();
  }
  // Neue Gruppe über oder unter einer anderen (oder am Ende einer Andockleiste)
  if (tg.ref === from && from.tabs.length === 1) return;
  detach();
  const list = layout[tg.side];
  const ref = tg.ref && list.includes(tg.ref) ? tg.ref : null;
  let size = 300;
  if (ref && !ref.collapsed) {
    size = ref.size / 2;
    ref.size -= size;
  }
  const g: Group = { tabs: [id], active: id, size };
  if (ref) list.splice(list.indexOf(ref) + (tg.after ? 1 : 0), 0, g);
  else list.push(g);
  commit();
}
