// Editor: mehrere Projekte als Tabs. Das aktive Projekt liegt wie bisher in doc, history und view;
// die übrigen Tabs halten ihren Stand (Dokument, Auswahl, Rückgängig-Verlauf, Ansicht) in ProjectTab.
import { allObjs, bumpIds, Doc, loadDoc, newDoc, Obj } from '../model';
import { restoreMeshes } from '../model3d/store';
import { History } from '../history';
import { restoreAssets } from '../images';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { applyLayerDefaults } from '../layerCategories';

const TABS_KEY = 'kizamubeam.tabs';

/** S6: gruppierte Tabs mit Seiten-Untertabs (S6): Opt-out, Standard an */
const GROUPED_TABS_KEY = 'kizamubeam.groupedTabs';

/** Stabile Akzentfarbe je Projekt anhand der Tab-ID, damit Seiten optisch zum Projekt gehören */
export const projectHue = (id: number) => ((id * 47) % 360 + 360) % 360;

/** S6-Follow-up: Seiten-Untertabs in der gruppierten Leiste zeigen (Opt-out, Standard an) */
const TAB_PAGES_KEY = 'kizamubeam.tabPages';

export const loadTabPages = (): boolean => {
  try {
    return localStorage.getItem(TAB_PAGES_KEY) !== '0';
  } catch {
    return true;
  }
};

export const saveTabPages = (v: boolean) => {
  try {
    if (v) localStorage.removeItem(TAB_PAGES_KEY);
    else localStorage.setItem(TAB_PAGES_KEY, '0');
  } catch {
    /* Speicher nicht verfügbar */
  }
};

/** Hex-Farbe (#rrggbb) in Farbton 0–359 umrechnen, sonst null */
export const hexHue = (hex: string): number | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((Math.round(h * 60) % 360) + 360) % 360;
};

export const loadGroupedTabs = (): boolean => {
  try {
    return localStorage.getItem(GROUPED_TABS_KEY) !== '0';
  } catch {
    return true;
  }
};

export const saveGroupedTabs = (v: boolean) => {
  try {
    if (v) localStorage.removeItem(GROUPED_TABS_KEY);
    else localStorage.setItem(GROUPED_TABS_KEY, '0');
  } catch {
    /* Speicher nicht verfügbar */
  }
};

export interface ProjectTab {
  id: number;
  /** Dateiname ohne Endung; null = noch nie gespeichert oder geöffnet */
  name: string | null;
  /** Stand beim letzten Öffnen/Speichern (ohne Seitenindex), um ungespeicherte Änderungen zu erkennen */
  saved: string;
  /** Ungespeicherte Änderungen (wird verzögert mit der automatischen Sicherung bestimmt) */
  changed: boolean;
  // Nur für inaktive Tabs aktuell; der aktive Tab lebt in Editor.doc, .sel, .history und .view
  doc: Doc;
  sel: number[];
  history: History;
  view: { zoom: number; ox: number; oy: number } | null;
  /** JSON des Dokuments eines inaktiven Tabs für die automatische Sicherung */
  json?: string;
  /** S6: Projekt in der gruppierten Tableiste aufgeklappt (Seiten-Untertabs sichtbar) */
  expanded?: boolean;
  /** S6-Follow-up: manuell gewählte Projektfarbe als Hex (#rrggbb); ohne Angabe gilt projectHue(id) */
  color?: string | null;
}

/** Wirksamer Farbton eines Projekts: manuelle Farbe schlägt die stabile Vorgabe */
export const tabHue = (tab: ProjectTab): number =>
  (tab.color ? hexHue(tab.color) : null) ?? projectHue(tab.id);

/** Wirksame Projektfarbe als CSS-Farbe: manuelle Wahl unverfälscht, sonst stabile Vorgabe aus der Tab-ID */
export const tabColor = (tab: ProjectTab): string =>
  tab.color ?? `hsl(${projectHue(tab.id)} 70% 55%)`;

let nextTabId = 1;

/** Vergleichsschlüssel eines Dokuments: Seitenwechsel allein zählt nicht als Änderung */
export const docKey = (d: Doc) => JSON.stringify({ ...d, page: 0 });

export const makeTab = (doc: Doc, name: string | null = null, changed = false, expanded = false): ProjectTab => ({
  id: nextTabId++,
  name,
  saved: changed ? '' : docKey(doc),
  changed,
  doc,
  sel: [],
  history: new History(),
  view: null,
  expanded,
});

/** Dateiname ohne Ordner und Endung */
export const tabNameFromPath = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.(kzb|kzt|lwk|json|lbrn2?)$/i, '');

export class EditorTabs {
  /** Angezeigter Name eines Tabs */
  tabTitle(this: Editor, tab: ProjectTab): string {
    return tab.name ?? tab.doc.template?.title ?? t('Unbenannt');
  }
  /** Leerer, unveränderter Tab ohne Verlauf: Öffnen und Vorlagen benutzen ihn statt eines neuen */
  tabIsBlank(this: Editor, tab: ProjectTab = this.tab): boolean {
    const doc = tab === this.tab ? this.doc : tab.doc;
    const hist = tab === this.tab ? this.history : tab.history;
    return !tab.name && !hist.canUndo && !hist.canRedo && allObjs(doc).length === 0;
  }
  /** Stand des aktiven Tabs in sein ProjectTab-Objekt übernehmen */
  stashTab(this: Editor) {
    const tab = this.tab;
    tab.doc = this.doc;
    tab.sel = this.sel.map((o) => o.id);
    tab.history = this.history;
    tab.view = { ...this.view };
    tab.json = JSON.stringify(this.doc);
  }
  /** Tab i anzeigen (ohne vorher den aktiven Tab zu sichern) */
  showTab(this: Editor, i: number) {
    this.clearPageState();
    this.tabIndex = i;
    const tab = this.tab;
    this.doc = tab.doc;
    this.history = tab.history;
    delete tab.json;
    // S6-Follow-up: Hervorhebung einer Hilfslinie gilt nur für das angezeigte Dokument
    this.guideHover = this.guidePin = null;
    const ids = new Set(tab.sel);
    this.sel = this.doc.objs.filter((o) => ids.has(o.id));
    this.checkIssues = [];
    this.checkActive = null;
    this.touchVarText();
    if (tab.view) {
      Object.assign(this.view, tab.view);
      this.emit('view');
    } else this.zoomPage();
    this.emit('doc');
    this.emit('sel');
    this.onTabsChange?.();
  }
  switchTab(this: Editor, i: number) {
    if (i < 0 || i >= this.tabs.length || i === this.tabIndex) return;
    this.updateChanged();
    this.stashTab();
    this.showTab(i);
    this.saveNow();
  }
  /** Neuer Tab hinter dem aktiven; ohne doc ein leeres Projekt mit dem Bett des aktuellen Geräts */
  newTab(this: Editor, doc?: Doc, name: string | null = null): ProjectTab {
    if (!doc) {
      doc = newDoc();
      doc.bed = { ...this.doc.bed };
      applyLayerDefaults(doc);
    }
    const tab = makeTab(doc, name, false, false);
    this.updateChanged();
    this.stashTab();
    this.tabs.splice(this.tabIndex + 1, 0, tab);
    this.showTab(this.tabIndex + 1);
    this.saveNow();
    return tab;
  }
  /** S6: Auf-/Zuklappzustand eines Projekts umschalten (session-persistent via Autosave) */
  toggleTabExpanded(this: Editor, i: number) {
    const tab = this.tabs[i];
    if (!tab) return;
    tab.expanded = !tab.expanded;
    this.onTabsChange?.();
    this.saveNow();
  }
  /** S6: Auf-/Zuklappzustand setzen */
  setTabExpanded(this: Editor, i: number, expanded: boolean) {
    const tab = this.tabs[i];
    if (!tab || tab.expanded === expanded) return;
    tab.expanded = expanded;
    this.onTabsChange?.();
    this.saveNow();
  }
  /** S6-Follow-up: manuelle Projektfarbe setzen (null = automatisch); session-persistent via Autosave */
  setTabColor(this: Editor, i: number, color: string | null) {
    const tab = this.tabs[i];
    if (!tab) return;
    const v = color && hexHue(color) !== null ? color.toLowerCase() : null;
    if ((tab.color ?? null) === v) return;
    tab.color = v;
    this.onTabsChange?.();
    this.saveNow();
  }
  /** Tab i schließen (Rückfrage bei ungespeicherten Änderungen macht die Oberfläche). Der letzte Tab wird geleert. */
  closeTab(this: Editor, i = this.tabIndex) {
    if (i < 0 || i >= this.tabs.length) return;
    if (this.tabs.length === 1) {
      const doc = newDoc();
      doc.bed = { ...this.doc.bed };
      applyLayerDefaults(doc);
      this.tabs[0] = makeTab(doc);
      this.showTab(0);
    } else if (i === this.tabIndex) {
      this.tabs.splice(i, 1);
      this.showTab(Math.min(i, this.tabs.length - 1));
    } else {
      this.tabs.splice(i, 1);
      if (i < this.tabIndex) this.tabIndex--;
      this.onTabsChange?.();
    }
    this.saveNow();
  }
  /** Tab from an die Stelle to schieben (Index nach dem Herausnehmen) */
  moveTab(this: Editor, from: number, to: number) {
    const n = this.tabs.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    const cur = this.tab;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.tabIndex = this.tabs.indexOf(cur);
    this.onTabsChange?.();
    this.saveNow();
  }
  /** Projektdatei in einem Tab öffnen: im aktiven, wenn er leer ist, sonst in einem neuen */
  openInTab(this: Editor, json: string, name: string | null) {
    const doc = this.parseProject(json);
    if (this.tabIsBlank()) {
      this.clearPageState();
      this.tab.name = name;
      this.doc = this.tab.doc = doc;
      this.sel = [];
      this.zoomPage();
      this.markSaved(name);
      this.emit('doc');
      this.emit('sel');
    } else {
      this.newTab(doc, name);
      this.markSaved(name);
    }
  }
  /** Aktiver Tab entspricht der Datei name (nach Öffnen oder Speichern) */
  markSaved(this: Editor, name: string | null) {
    const tab = this.tab;
    if (name) tab.name = name;
    tab.saved = docKey(this.doc);
    tab.changed = false;
    this.onTabsChange?.();
    this.scheduleSave();
  }
  /** Vergleichsschlüssel des aktiven Dokuments (für markSaved nach einem Dialog) */
  tabKey(this: Editor): string {
    return docKey(this.doc);
  }
  /** Ungespeicherte Änderungen des aktiven Tabs neu bestimmen */
  updateChanged(this: Editor) {
    const tab = this.tab;
    const changed = docKey(this.doc) !== tab.saved;
    if (changed === tab.changed) return;
    tab.changed = changed;
    this.onTabsChange?.();
  }
  /** Alle Tabs für die automatische Sicherung */
  tabsJson(this: Editor, activeJson: string): string {
    return JSON.stringify({
      active: this.tabIndex,
      tabs: this.tabs.map((tab, i) => ({
        name: tab.name,
        changed: tab.changed,
        expanded: !!tab.expanded,
        color: tab.color ?? null,
        doc: i === this.tabIndex ? '@' : (tab.json ??= JSON.stringify(tab.doc)),
      })),
    }).replace('"doc":"@"', () => `"doc":${JSON.stringify(activeJson)}`);
  }
  /** Tabs aus der automatischen Sicherung; false, wenn keine da ist */
  restoreTabs(this: Editor, migrate: (objs: Obj[]) => void): boolean {
    let st: { active?: number; tabs?: { name?: string | null; changed?: boolean; expanded?: boolean; color?: string | null; doc: string }[] };
    try {
      st = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null');
    } catch {
      return false;
    }
    if (!st || !Array.isArray(st.tabs) || !st.tabs.length) return false;
    const tabs: ProjectTab[] = [];
    for (const raw of st.tabs) {
      try {
        const doc = loadDoc(JSON.parse(raw.doc));
        bumpIds(allObjs(doc));
        migrate(allObjs(doc));
        restoreAssets(this.assetIds(allObjs(doc)));
        restoreMeshes(this.meshIds(allObjs(doc)));
        tabs.push(makeTab(doc, typeof raw.name === 'string' ? raw.name : null, !!raw.changed, !!raw.expanded));
        if (typeof raw.color === 'string' && hexHue(raw.color) !== null)
          tabs[tabs.length - 1].color = raw.color.toLowerCase();
      } catch {
        /* beschädigter Tab: weglassen */
      }
    }
    if (!tabs.length) return false;
    this.tabs = tabs;
    this.tabIndex = Math.max(0, Math.min(tabs.length - 1, st.active ?? 0));
    this.doc = this.tab.doc;
    this.history = this.tab.history;
    return true;
  }
  saveTabs(this: Editor, activeJson: string) {
    try {
      localStorage.setItem(TABS_KEY, this.tabsJson(activeJson));
    } catch {
      // Zu groß für den Speicher: wenigstens das aktive Projekt bleibt unter dem alten Schlüssel erhalten
      try {
        localStorage.removeItem(TABS_KEY);
      } catch {
        /* nicht verfügbar */
      }
    }
  }
}
