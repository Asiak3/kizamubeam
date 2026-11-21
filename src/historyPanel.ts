// Verlaufsfenster: Liste der letzten Änderungen mit Namen. Klick auf eine Zeile springt zu diesem Stand
// (mehrere Schritte auf einmal zurück oder vor). Rückgängig gemachte Schritte stehen ausgegraut unter dem
// aktuellen Stand und lassen sich ebenso per Klick wiederholen, bis eine neue Änderung sie verwirft.
import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
import { withShortcut } from './commandKeys';
import { dockWindow, isShown, onWindowShow, setBadge } from './dock';

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export function buildHistoryPanel(ed: Editor) {
  const body = dockWindow('history', t('Verlauf'), { bodyId: 'history' });
  const btnUndo = h('button', { class: 'small', title: withShortcut(t('Rückgängig'), 'undo'), onclick: () => ed.doUndo() }, t('Rückgängig'));
  const btnRedo = h('button', { class: 'small', title: withShortcut(t('Wiederholen'), 'redo'), onclick: () => ed.doRedo() }, t('Wiederholen'));
  const list = h('div', { class: 'hist-list' });
  body.append(h('div', { class: 'hist-bar' }, btnUndo, btnRedo), list);

  let queued = false;
  let lastKey = '';
  const render = () => {
    queued = false;
    const hist = ed.history;
    const rows = hist.rows();
    const pos = hist.position;
    setBadge('history', rows.length ? String(pos) : '');
    btnUndo.disabled = !hist.canUndo;
    btnRedo.disabled = !hist.canRedo;
    if (!isShown('history')) return;
    // Beim Ziehen kommen viele Änderungsmeldungen, die Liste bleibt dabei gleich
    const key = `${pos}|${hist.truncated}|${rows.map((r) => r.label + r.time).join('\n')}`;
    if (key === lastKey) return;
    lastKey = key;
    const row = (i: number, label: string, time: number | null, cls: string) =>
      h('div', {
        class: `hist-row ${cls}`,
        title: i === pos ? t('Aktueller Stand') : t('Hierher springen'),
        onclick: () => ed.jumpHistory(i),
      },
        h('span', { class: 'hist-label' }, label),
        time != null ? h('span', { class: 'hist-time' }, clock(time)) : '');
    const els = [row(0, hist.truncated ? t('Älterer Stand') : t('Ausgangsstand'), null, `hist-start${pos === 0 ? ' cur' : ''}`)];
    rows.forEach((r, k) => els.push(row(k + 1, r.label, r.time, `${r.undone ? 'undone' : ''}${k + 1 === pos ? ' cur' : ''}`)));
    list.replaceChildren(...els);
    if (rows.length === 0) list.append(h('div', { class: 'empty' }, t('Noch keine Änderungen.')));
    list.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  };
  ed.on((what) => what === 'doc' && schedule());
  onWindowShow('history', () => {
    lastKey = '';
    render();
  });
  schedule();
}
