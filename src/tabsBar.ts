// Leiste mit den offenen Projekten über der Arbeitsfläche, Tastenkürzel für Tabs und Dateien.
import type { Editor } from './editor';
import { $, h } from './dom';
import { saveProject } from './files';
import { applyNewDocDefaults } from './laser';
import { t } from './i18n';
import { withShortcut } from './commandKeys';
import { loadGroupedTabs, loadTabPages, tabColor } from './editor/tabs';
import { openEditorContextMenu } from './editorContext';
import type { ContextAction } from './contextMenu';
import { openTabColorDialog } from './tabColorDialog';

/** Tab i schließen, bei ungespeicherten Änderungen erst nachfragen */
export function closeTabAsk(ed: Editor, i = ed.tabIndex) {
  const tab = ed.tabs[i];
  if (!tab) return;
  if (i === ed.tabIndex) ed.updateChanged();
  if (tab.changed && !confirm(t('„{name}“ hat ungespeicherte Änderungen. Trotzdem schließen?', { name: ed.tabTitle(tab) }))) return;
  ed.closeTab(i);
}

/** S6: Seite p in Projekt i anwählen (wechselt bei Bedarf erst das Projekt) */
export function gotoProjectPage(ed: Editor, i: number, p: number) {
  if (i < 0 || i >= ed.tabs.length) return;
  if (i !== ed.tabIndex) ed.switchTab(i);
  ed.setPage(p);
}

export function buildTabBar(ed: Editor) {
  const bar = $('#tabbar');
  let dragFrom = -1;
  // S6-Follow-up: Seiten-Untertabs ein-/ausblenden (Einstellung, Standard an)
  let showPages = loadTabPages();
  const flatTab = (i: number) => {
    const tab = ed.tabs[i];
    const title = ed.tabTitle(tab);
    return h('div', {
      class: 'ptab' + (i === ed.tabIndex ? ' active' : '') + (tab.changed ? ' changed' : ''),
      title: tab.changed ? t('{name} (ungespeicherte Änderungen)', { name: title }) : title,
      draggable: 'true',
      role: 'tab',
      'aria-selected': String(i === ed.tabIndex),
      onmousedown: (e: MouseEvent) => {
        // Mittlere Maustaste schließt den Tab
        if (e.button === 1) {
          e.preventDefault();
          closeTabAsk(ed, i);
        }
      },
      onclick: () => ed.switchTab(i),
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openEditorContextMenu(ed, e.clientX, e.clientY, projectMenu(i));
      },
      ondragstart: (e: DragEvent) => {
        dragFrom = i;
        e.dataTransfer?.setData('text/plain', title);
      },
      ondragover: (e: DragEvent) => dragFrom >= 0 && e.preventDefault(),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragFrom >= 0) ed.moveTab(dragFrom, i);
        dragFrom = -1;
      },
      ondragend: () => (dragFrom = -1),
    },
      h('span', { class: 'ptab-name' }, title),
      h('button', {
        class: 'ptab-close',
        title: t('Tab schließen'),
        'aria-label': t('Tab schließen'),
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          closeTabAsk(ed, i);
        },
      }, '×'),
    );
  };
  const groupedProject = (i: number) => {
    const tab = ed.tabs[i];
    const title = ed.tabTitle(tab);
    const active = i === ed.tabIndex;
    // Seiten des Projekts: aktives Projekt aus ed.doc, andere aus dem geparkten Tab-Doc
    const doc = active ? ed.doc : tab.doc;
    const pages = doc.pages;
    const cur = active ? ed.doc.page : (doc.page ?? 0);
    const expanded = !!tab.expanded;
    const head = h('div', {
      class: 'pgroup-head' + (active ? ' active' : '') + (tab.changed ? ' changed' : ''),
      title: tab.changed ? t('{name} (ungespeicherte Änderungen)', { name: title }) : title,
      draggable: 'true',
      role: 'tab',
      'aria-selected': String(active),
      'aria-expanded': pages.length > 1 ? String(expanded) : undefined,
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openEditorContextMenu(ed, e.clientX, e.clientY, projectMenu(i));
      },
      onmousedown: (e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTabAsk(ed, i);
        }
      },
      onclick: () => ed.switchTab(i),
      ondragstart: (e: DragEvent) => {
        dragFrom = i;
        e.dataTransfer?.setData('text/plain', title);
      },
      ondragover: (e: DragEvent) => dragFrom >= 0 && e.preventDefault(),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragFrom >= 0) ed.moveTab(dragFrom, i);
        dragFrom = -1;
      },
      ondragend: () => (dragFrom = -1),
    },
      pages.length > 1 ? h('button', {
        class: 'pgroup-caret',
        'data-caret': String(i),
        title: expanded ? t('Projekt zuklappen') : t('Projekt aufklappen'),
        'aria-label': expanded ? t('Projekt zuklappen') : t('Projekt aufklappen'),
        'aria-expanded': String(expanded),
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          ed.toggleTabExpanded(i);
        },
      }, expanded ? '▾' : '▸') : null,
      h('span', { class: 'ptab-name' }, title),
      h('button', {
        class: 'ptab-close',
        title: t('Tab schließen'),
        'aria-label': t('Tab schließen'),
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          closeTabAsk(ed, i);
        },
      }, '×'),
    );
    if (!showPages || !expanded || pages.length < 2) return h('div', { class: 'pgroup' + (active ? ' active' : ''), style: `--pgroup-color: ${tabColor(tab)}` }, head);
    const subs = pages.map((p, pi) => {
      const label = p.name?.trim() || String(pi + 1);
      const isCur = active && pi === cur;
      return h('button', {
        class: 'ppage' + (isCur ? ' active' : ''),
        title: label,
        'aria-label': label,
        'aria-current': isCur ? 'page' : undefined,
        'data-subtab': `${i}:${pi}`,
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          gotoProjectPage(ed, i, pi);
        },
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          openEditorContextMenu(ed, e.clientX, e.clientY, pageMenu(i, pi));
        },
      }, label);
    });
    return h('div', { class: 'pgroup open' + (active ? ' active' : ''), style: `--pgroup-color: ${tabColor(tab)}` }, head, ...subs);
  };
  const render = () => {
    const grouped = loadGroupedTabs();
    // S6-Follow-up: Seiten-Untertabs lassen sich in den Einstellungen ausblenden
    showPages = loadTabPages();
    // Fokus über den Neuaufbau retten (Tastaturbedienung, laufende Umbenennung)
    const ae = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const renameEl = ae && ae.classList.contains('ppage-rename') ? ae as HTMLInputElement : null;
    const renameKey = renameEl?.closest('[data-subtab]')?.getAttribute('data-subtab') ?? null;
    const renameValue = renameEl?.value ?? '';
    const renameSel: [number, number] = [renameEl?.selectionStart ?? renameValue.length, renameEl?.selectionEnd ?? renameValue.length];
    const fk = renameKey ?? (ae?.dataset.subtab !== undefined ? `s${ae.dataset.subtab}` : ae?.dataset.caret !== undefined ? `c${ae.dataset.caret}` : null);
    const items = ed.tabs.map((_, i) => (grouped ? groupedProject(i) : flatTab(i)));
    bar.replaceChildren(
      ...items,
      h('button', { class: 'ptab-new', title: withShortcut(t('Neues Projekt in neuem Tab'), 'new'), onclick: () => (ed.newTab(), applyNewDocDefaults()) }, '+'),
    );
    bar.classList.toggle('grouped', grouped);
    if (renameKey) {
      const [ri, rpi] = renameKey.split(':').map(Number);
      startSubRename(ri, rpi);
      const inp = bar.querySelector('.ppage-rename') as HTMLInputElement | null;
      if (inp) {
        inp.value = renameValue;
        inp.setSelectionRange(renameSel[0], renameSel[1]);
        inp.focus();
      }
    } else if (fk) {
      const sel = fk[0] === 's' ? `[data-subtab="${fk.slice(1)}"]` : `[data-caret="${fk.slice(1)}"]`;
      (bar.querySelector(sel) as HTMLElement | null)?.focus({ preventScroll: true });
    }
  };
  /** Namen einer Seite direkt in der Leiste ändern (aktives Projekt: mit Undo; sonst Stand + Sicherung) */
  const startSubRename = (i: number, pi: number) => {
    const btn = bar.querySelector<HTMLElement>(`[data-subtab="${i}:${pi}"]`);
    const doc = i === ed.tabIndex ? ed.doc : ed.tabs[i]?.doc;
    const name = doc?.pages[pi]?.name;
    if (!btn || name === undefined) return;
    btn.replaceChildren();
    const inp = h('input', { type: 'text', value: name, class: 'ppage-rename', 'aria-label': t('Umbenennen …') }) as HTMLInputElement;
    btn.append(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      // Fokus aus dem Eingabefeld nehmen, bevor Umbenennen/Sichern neu rendern:
      // sonst deutet die Fokus-Rettung das eben abgeschlossene Feld als laufend.
      inp.blur();
      const v = inp.value.trim();
      if (ok && v && v !== name) {
        // Fremdes Projekt erst aktivieren: renamePage liefert Undo, Dirty-Status und Autosave.
        if (i !== ed.tabIndex) {
          if (!ed.tabs[i]?.doc.pages[pi]) { render(); return; }
          ed.switchTab(i);
        }
        ed.renamePage(pi, v);
      } else render();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('contextmenu', (e) => e.stopPropagation());
  };
  /** Rechtsklickmenü eines Projektkopfs: schließen, Farbe, sichern, neu */
  const projectMenu = (i: number): ContextAction[][] => [[
    { id: 'tab-close', label: t('Tab schließen'), run: () => closeTabAsk(ed, i) },
    { id: 'tab-close-others', label: t('Alle anderen schließen'), enabled: ed.tabs.length > 1, run: () => {
      const keep = ed.tabs[i];
      for (const tb of [...ed.tabs]) if (tb !== keep) closeTabAsk(ed, ed.tabs.indexOf(tb));
    } },
    { id: 'tab-color', label: t('Farbe …'), run: () => openTabColorDialog(ed, i) },
  ], [
    { id: 'project-save', label: t('Speichern'), run: () => { if (i !== ed.tabIndex) ed.switchTab(i); void saveProject(ed); } },
    { id: 'project-new', label: t('Neues Projekt'), run: () => (ed.newTab(), applyNewDocDefaults()) },
  ]];
  /** Rechtsklickmenü eines Seiten-Untertabs (fremdes Projekt: nur wechseln + umbenennen) */
  const pageMenu = (i: number, pi: number): ContextAction[][] => {
    const doc = i === ed.tabIndex ? ed.doc : ed.tabs[i]?.doc;
    if (!doc?.pages[pi]) return [];
    const head: ContextAction[] = [];
    if (i !== ed.tabIndex || pi !== ed.doc.page)
      head.push({ id: 'page-open', label: t('Zu dieser Seite wechseln'), run: () => gotoProjectPage(ed, i, pi) });
    head.push({ id: 'rename', label: t('Umbenennen …'), run: () => startSubRename(i, pi) });
    if (i !== ed.tabIndex) return [head];
    return [head, [
      { id: 'page-duplicate', label: t('Seite duplizieren'), run: () => ed.duplicatePage(pi) },
      { id: 'page-delete', label: t('Seite löschen'), enabled: ed.doc.pages.length > 1, run: () => ed.deletePage(pi) },
      { id: 'page-new', label: t('Neue Seite'), run: () => ed.addPage() },
    ]];
  };
  ed.onTabsChange = render;
  // Seitenwechsel melden nur 'doc', nicht 'tabs': Untertabs trotzdem aktuell halten.
  ed.on((w) => {
    if (w === 'doc' || w === 'sel') render();
  });
  render();

  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl || e.altKey) return;
    const k = e.key.toLowerCase();
    const run = (f: () => void) => {
      e.preventDefault();
      f();
    };
    if (k === 'tab' && e.ctrlKey && ed.tabs.length > 1) {
      const n = ed.tabs.length;
      return run(() => ed.switchTab((ed.tabIndex + (e.shiftKey ? n - 1 : 1)) % n));
    }
  });
}
