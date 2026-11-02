// Fenster „Werkzeugkasten“: alle Generatoren und Spezialwerkzeuge als Kacheln, nach Gruppen geordnet, mit
// Suche und Filter. Ein Klick ruft dieselbe Aktion auf wie Menü oder Funktionsleiste. Welche Kacheln es gibt,
// steht in apps.ts; Symbol, Aufruf und Verfügbarkeit kommen von der Aktion (toolbars.ts). Dazu kommen
// Vorlagen aus installierten Erweiterungen. Oben stehen Favoriten (Rechtsklick auf eine Kachel) und die
// zuletzt benutzten Werkzeuge; neue Werkzeuge tragen „NEU“, bis sie einmal benutzt wurden.
// Gemerkt wird alles im localStorage („kizamubeam.apps“).
import type { Editor } from './editor';
import { h } from './dom';
import { t, tn } from './i18n';
import { ICONS } from './icons';
import { dockWindow, isNewWindow, showWindow } from './dock';
import { getAction } from './toolbars';
import { AppGroup, appGroups, appList, fold, isNewIn, pushRecent, searchApps } from './apps';
import { ensurePacks, onPacksChanged, packTemplates } from './packs';
import { startFromTemplate } from './templateDialogs';
import { version as APP_VERSION } from '../package.json';

const KEY = 'kizamubeam.apps';
const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

/** Gruppe „Aus Erweiterungen“ und die beiden Abschnitte oben */
type Group = AppGroup | 'pack';
type Section = Group | 'fav' | 'recent';

interface Tile {
  /** Kennung der Aktion bzw. „pack:<Paket>/<Nummer>“ */
  key: string;
  group: Group;
  name: string;
  desc: string;
  icon?: string;
  /** Vorschaubild (SVG) einer Vorlage */
  img?: string;
  isNew: boolean;
  /** Suchtext für Vorlagen (gefaltet); Werkzeuge sucht apps.ts */
  text: string;
  /** false: ging gerade nicht (z. B. Auswahl fehlt), zählt nicht als benutzt */
  run: () => boolean | void;
}

interface State {
  /** Gewählter Filter; leer = alle Gruppen */
  filter: Group | '';
  collapsed: Section[];
  favs: string[];
  recent: string[];
  /** Schon benutzte Werkzeuge (NEU verschwindet) */
  used: string[];
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function load(): State {
  const st: State = { filter: '', collapsed: [], favs: [], recent: [], used: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    const groups: string[] = [...appGroups().map((g) => g.id), 'pack'];
    if (raw && typeof raw === 'object') {
      if (groups.includes(raw.filter)) st.filter = raw.filter;
      st.collapsed = strings(raw.collapsed).filter((x) => [...groups, 'fav', 'recent'].includes(x)) as Section[];
      st.favs = strings(raw.favs);
      st.recent = strings(raw.recent).slice(0, 6);
      st.used = strings(raw.used);
    }
  } catch {
    /* Speicher nicht verfügbar */
  }
  return st;
}

function save(st: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

function hint(ed: Editor, msg: string) {
  ed.hint = msg;
  ed.emit('tool');
}

/** Suchfeld des Fensters (für openAppsPanel) */
let searchBox: HTMLInputElement | null = null;

/** Werkzeugkasten einblenden und die Suche fokussieren (Menü Werkzeuge → Werkzeugkasten …) */
export function openAppsPanel() {
  showWindow('apps');
  requestAnimationFrame(() => {
    searchBox?.focus();
    searchBox?.select();
  });
}

export function buildAppsPanel(ed: Editor) {
  const body = dockWindow('apps', t('Werkzeugkasten'), { left: true });
  const st = load();
  const groups: { id: Group; label: string; chip: string; icon: string }[] = [
    ...appGroups(),
    { id: 'pack', label: t('Aus Erweiterungen'), chip: t('Erweiterungen'), icon: 'packs' },
  ];

  // Werkzeuge aus apps.ts; ihre Aktion entscheidet, ob sie gerade gehen
  const tools: Tile[] = appList()
    .filter((a) => getAction(a.id))
    .map((a): Tile => {
      const act = getAction(a.id)!;
      return {
        key: a.id, group: a.group, name: a.name, desc: a.desc, icon: act.icon, isNew: isNewIn(a.since, APP_VERSION), text: '',
        run: () => {
          if (act.enabled && !act.enabled()) {
            hint(ed, a.group === 'image' ? t('„{name}“: erst ein Bild auswählen.', { name: a.name }) : t('„{name}“: erst passende Objekte auswählen.', { name: a.name }));
            return false;
          }
          act.run();
        },
      };
    });
  const manage = getAction('packs');
  const packTiles = (): Tile[] => [
    ...packTemplates().map((p): Tile => ({
      key: `pack:${p.key}`, group: 'pack', name: p.info.title, desc: p.info.description ? `${p.info.description} (${p.pack})` : p.pack,
      img: p.info.preview, icon: 'template', isNew: false, text: fold(`${p.info.title} ${p.info.description ?? ''} ${p.pack}`),
      run: () => startFromTemplate(ed, p.json),
    })),
    ...(manage
      ? [{
          key: 'packs', group: 'pack' as const, name: t('Erweiterungen verwalten'),
          desc: t('Pakete mit Vorlagen, Materialien, Gerätevorlagen und Motiven installieren oder entfernen.'),
          icon: 'packs', isNew: false, text: fold(`${t('Erweiterungen verwalten')} Erweiterungen Pakete extensions packs Katalog catalog`), run: () => manage.run(),
        }]
      : []),
  ];
  let all: Tile[] = [...tools, ...packTiles()];

  const search = h('input', { type: 'search', class: 'apps-search', placeholder: t('Werkzeuge suchen …'), 'aria-label': t('Werkzeuge suchen') }) as HTMLInputElement;
  searchBox = search;
  const chips = h('div', { class: 'apps-chips' });
  const list = h('div', { class: 'apps-list' });
  body.append(h('div', { class: 'apps-top' }, h('label', { class: 'apps-searchbox' }, h('span', { class: 'apps-sicon', html: ICONS.search }), search), chips), list);

  const use = (tile: Tile) => {
    if (tile.run() === false) return;
    st.recent = pushRecent(st.recent, tile.key);
    if (!st.used.includes(tile.key)) st.used.push(tile.key);
    save(st);
    render();
  };

  const toggleFav = (tile: Tile) => {
    st.favs = st.favs.includes(tile.key) ? st.favs.filter((x) => x !== tile.key) : [...st.favs, tile.key];
    save(st);
    render();
  };

  const tileEl = (tile: Tile) => {
    const fav = st.favs.includes(tile.key);
    const isNew = tile.isNew && !st.used.includes(tile.key);
    return h('button', {
      class: 'app-tile', 'data-g': tile.group, 'data-key': tile.key,
      title: `${tile.name}\n${tile.desc}\n${fav ? t('Rechtsklick: aus den Favoriten entfernen') : t('Rechtsklick: zu den Favoriten')}`,
      onclick: () => use(tile),
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        toggleFav(tile);
      },
    },
      h('span', { class: `app-art${tile.img ? ' img' : ''}` },
        tile.img ? h('img', { src: svgUrl(tile.img), alt: '' }) : h('span', { class: 'app-icon', html: ICONS[tile.icon ?? ''] ?? '' }),
        isNew ? h('span', { class: 'app-new' }, t('NEU')) : null,
        fav ? h('span', { class: 'app-fav', html: ICONS.star }) : null,
      ),
      h('span', { class: 'app-name' }, tile.name),
    );
  };

  const renderChips = () => {
    const chip = (id: Group | '', label: string) =>
      h('button', {
        class: `apps-chip${st.filter === id ? ' on' : ''}`,
        onclick: () => {
          st.filter = id;
          save(st);
          render();
        },
      }, label);
    chips.replaceChildren(chip('', t('Alle|Werkzeugkasten')), ...groups.map((g) => chip(g.id, g.chip)));
  };

  const section = (id: Section, label: string, icon: string, items: Tile[], collapsible = true) => {
    const closed = collapsible && st.collapsed.includes(id);
    const head = h('button', {
      class: 'apps-head',
      'aria-expanded': String(!closed),
      onclick: () => {
        if (!collapsible) return;
        st.collapsed = closed ? st.collapsed.filter((x) => x !== id) : [...st.collapsed, id];
        save(st);
        render();
      },
    },
      h('span', { class: 'apps-gicon', 'data-g': id, html: ICONS[icon] }),
      h('span', { class: 'apps-gname' }, label),
      h('span', { class: 'apps-count' }, String(items.length)),
      collapsible ? h('span', { class: 'apps-chev', html: closed ? ICONS.chevdown : ICONS.chevup }) : null,
    );
    return h('section', { class: 'apps-sec' }, head, closed ? null : h('div', { class: 'apps-grid' }, ...items.map(tileEl)));
  };

  const filtered = () => all.filter((x) => !st.filter || x.group === st.filter);
  const byKey = (keys: string[]) => keys.map((k) => all.find((x) => x.key === k)).filter((x): x is Tile => !!x);

  /** Suche: Werkzeuge über apps.ts (beide Sprachen, Schlagwörter), Vorlagen und „Verwalten“ über ihren Text */
  const hits = (q: string) => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const inFilter = filtered();
    const toolHits = searchApps(appList().filter((a) => inFilter.some((x) => x.key === a.id)), q).map((a) => inFilter.find((x) => x.key === a.id)!);
    const packHits = inFilter.filter((x) => x.group === 'pack' && words.every((w) => x.text.includes(w)));
    return [...toolHits, ...packHits];
  };

  const render = () => {
    renderChips();
    const q = search.value.trim();
    if (q) {
      const found = hits(q);
      list.replaceChildren(
        h('div', { class: 'apps-hits' }, found.length ? tn('{n} Treffer|eins', '{n} Treffer', found.length) : t('Nichts gefunden. Andere Wörter versuchen oder den Filter auf „Alle“ stellen.')),
        h('div', { class: 'apps-grid' }, ...found.map(tileEl)),
      );
      return;
    }
    const top: HTMLElement[] = [];
    if (!st.filter) {
      const favs = byKey(st.favs);
      const recent = byKey(st.recent).filter((x) => !st.favs.includes(x.key)).slice(0, 3);
      if (favs.length) top.push(section('fav', t('Favoriten'), 'star', favs));
      if (recent.length) top.push(section('recent', t('Zuletzt benutzt'), 'undo', recent));
    }
    list.replaceChildren(
      ...top,
      ...groups
        .filter((g) => !st.filter || g.id === st.filter)
        .map((g) => ({ g, items: filtered().filter((x) => x.group === g.id) }))
        .filter(({ items }) => items.length)
        .map(({ g, items }) => section(g.id, g.label, g.icon, items, !st.filter)),
    );
  };

  // Tastatur: Pfeil runter aus der Suche zur ersten Kachel, Pfeile wandern durch die Kacheln
  const tilesShown = () => [...list.querySelectorAll<HTMLElement>('.app-tile')];
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      render();
    } else if (e.key === 'Enter') {
      if (search.value.trim()) tilesShown()[0]?.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      tilesShown()[0]?.focus();
    }
  });
  list.addEventListener('keydown', (e) => {
    const els = tilesShown();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowLeft') next = els[i - 1];
    else if (e.key === 'ArrowRight') next = els[i + 1];
    else {
      // Kachel in der Zeile darüber bzw. darunter, möglichst in derselben Spalte
      const cur = els[i].getBoundingClientRect();
      const down = e.key === 'ArrowDown';
      const boxes = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
      const cand = boxes.filter(({ r }) => (down ? r.top > cur.bottom - 2 : r.bottom < cur.top + 2));
      if (cand.length) {
        const rowTop = down ? Math.min(...cand.map(({ r }) => r.top)) : Math.max(...cand.map(({ r }) => r.top));
        next = cand
          .filter(({ r }) => Math.abs(r.top - rowTop) < 2)
          .sort((a, b) => Math.abs(a.r.left - cur.left) - Math.abs(b.r.left - cur.left))[0]?.el;
      } else if (!down) search.focus();
    }
    next?.focus();
  });

  render();
  // Vorlagen aus Erweiterungen kommen nach, sobald die Pakete gelesen sind
  const refreshPacks = () => {
    all = [...tools, ...packTiles()];
    render();
  };
  onPacksChanged(refreshPacks);
  void ensurePacks().then(refreshPacks);

  // Bestehende Nutzer: einmal auf das neue Fenster hinweisen (es startet bei ihnen ausgeblendet)
  setTimeout(() => {
    if (isNewWindow('apps')) hint(ed, t('Neu: der Werkzeugkasten mit allen Generatoren und Werkzeugen. Einblenden über Fenster → Werkzeugkasten oder den Knopf in der Werkzeugleiste.'));
  }, 1500);
}
