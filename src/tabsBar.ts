// Leiste mit den offenen Projekten über der Arbeitsfläche, Tastenkürzel für Tabs und Dateien.
import type { Editor } from './editor';
import { $, h } from './dom';
import { openProject, saveProject } from './files';
import { applyNewDocDefaults } from './laser';
import { t } from './i18n';

/** Tab i schließen, bei ungespeicherten Änderungen erst nachfragen */
export function closeTabAsk(ed: Editor, i = ed.tabIndex) {
  const tab = ed.tabs[i];
  if (!tab) return;
  if (i === ed.tabIndex) ed.updateChanged();
  if (tab.changed && !confirm(t('„{name}“ hat ungespeicherte Änderungen. Trotzdem schließen?', { name: ed.tabTitle(tab) }))) return;
  ed.closeTab(i);
}

export function buildTabBar(ed: Editor) {
  const bar = $('#tabbar');
  let dragFrom = -1;
  const render = () => {
    const tabs = ed.tabs.map((tab, i) => {
      const title = ed.tabTitle(tab);
      const el = h('div', {
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
      return el;
    });
    bar.replaceChildren(
      ...tabs,
      h('button', { class: 'ptab-new', title: t('Neues Projekt in neuem Tab (Ctrl+N)'), onclick: () => (ed.newTab(), applyNewDocDefaults()) }, '+'),
    );
  };
  ed.onTabsChange = render;
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
    if (e.shiftKey) return;
    if (k === 'n') return run(() => (ed.newTab(), applyNewDocDefaults()));
    if (k === 'o') return run(() => void openProject(ed));
    if (k === 's') return run(() => void saveProject(ed));
  });
}
