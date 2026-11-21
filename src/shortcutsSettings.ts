// Settings → Mouse and keyboard → Keyboard shortcuts (#453): change, remove and reset the shortcut of each command.
// Changes apply at once (like the toolbar layout) and are stored with the other settings (commandKeys.ts).
import { h } from './dom';
import { t } from './i18n';
import {
  bindingConflicts, bindingLabel, defaultBindings, bindingNote, bindingRefusal, bindings, eventBinding, fixedKey, isCustomized, resetAllBindings, resetBindings, setBindings,
} from './commandKeys';

export interface ShortcutCommand {
  id: string;
  /** Group heading (menu name) */
  cat: string;
  label: string;
}

/** Name without the explanation after ': ' (toolbar labels carry one) */
const shortName = (label: string) => label.split(': ')[0];

export function shortcutEditor(all: readonly ShortcutCommand[], fixedRows: readonly [string, string][]): HTMLElement {
  const commands = groupByCategory(all);
  const filter = h('input', { type: 'search', class: 'shortcut-filter', placeholder: t('Befehle suchen …'), 'aria-label': t('Befehle suchen …') }) as HTMLInputElement;
  const status = h('div', { class: 'shortcut-status', role: 'status' });
  const body = h('tbody');
  const name = (id: string) => shortName(commands.find((c) => c.id === id)?.label ?? id);
  let capturing: (() => void) | null = null;

  const keysText = (id: string) => {
    const list = bindings(id);
    if (list.length) return list.map(bindingLabel).join(' / ');
    const fixed = fixedKey(id);
    return fixed ? bindingLabel(fixed) : '';
  };

  /** Wait for a key combination on the row's button; Esc cancels */
  function capture(cmd: ShortcutCommand, button: HTMLButtonElement, keys: HTMLElement) {
    capturing?.();
    const before = keys.textContent;
    keys.textContent = t('Tasten drücken … (Esc bricht ab)');
    keys.classList.add('capturing');
    status.textContent = '';
    const stop = () => {
      button.removeEventListener('keydown', onKey, true);
      button.removeEventListener('blur', stop);
      keys.classList.remove('capturing');
      keys.textContent = before;
      capturing = null;
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop();
      const b = eventBinding(e);
      if (!b) return; // modifier alone: keep waiting
      const refusal = bindingRefusal(b);
      if (refusal) {
        status.textContent = `${bindingLabel(b)}: ${refusal}`;
        return;
      }
      stop();
      void assign(cmd, [b], button.closest('tr'), () => {
        const note = bindingNote(b);
        status.textContent = note ? `${bindingLabel(b)}: ${note}` : '';
      });
    };
    button.addEventListener('keydown', onKey, true);
    button.addEventListener('blur', stop);
    capturing = stop;
    button.focus();
  }

  /**
   * Give a command these keys. If another command holds one, ask below the row whether it stays there or moves here
   * (in place: window.confirm does not reliably appear over the app's dialogs).
   */
  async function assign(cmd: ShortcutCommand, list: readonly string[], rowEl: Element | null, done: () => void, reset = false) {
    for (const { binding, id } of bindingConflicts(cmd.id, list)) {
      const askRow = h('tr', { class: 'shortcut-ask-row' });
      const cell = h('td', { colSpan: 3 });
      askRow.append(cell);
      if (rowEl) rowEl.after(askRow);
      else body.prepend(askRow);
      const move = await ask(cell, t('„{key}“ ist schon „{command}“ zugewiesen.', { key: bindingLabel(binding), command: name(id) }), t('Dort behalten'), t('Hierher übernehmen'));
      askRow.remove();
      if (!move) return;
    }
    if (reset) resetBindings(cmd.id);
    else setBindings(cmd.id, list);
    done();
    fill();
  }

  function row(cmd: ShortcutCommand): HTMLElement {
    const keys = h('kbd', { class: keysText(cmd.id) ? '' : 'muted' }, keysText(cmd.id) || '–');
    const change = h('button', { type: 'button', class: 'btn small', title: t('Neue Tastenkombination drücken') }, t('Ändern')) as HTMLButtonElement;
    change.onclick = () => capture(cmd, change, keys);
    const remove = h('button', { type: 'button', class: 'btn small', title: t('Kürzel entfernen'), hidden: !bindings(cmd.id).length }, '×');
    remove.onclick = () => {
      setBindings(cmd.id, []);
      status.textContent = '';
      fill();
    };
    const reset = h('button', { type: 'button', class: 'btn small', hidden: !isCustomized(cmd.id) }, t('Zurücksetzen'));
    const tr = h('tr', { class: isCustomized(cmd.id) ? 'customized' : '' },
      h('td', { title: cmd.label }, shortName(cmd.label)), h('td', {}, keys), h('td', { class: 'shortcut-buttons' }, change, remove, reset));
    reset.onclick = () => void assign(cmd, defaultBindings(cmd.id), tr, () => (status.textContent = ''), true);
    return tr;
  }

  function fill() {
    const q = filter.value.trim().toLowerCase();
    const rows: HTMLElement[] = [];
    let cat = '';
    for (const cmd of commands) {
      if (q && !`${cmd.label} ${cmd.cat} ${keysText(cmd.id)}`.toLowerCase().includes(q)) continue;
      if (cmd.cat !== cat) {
        cat = cmd.cat;
        rows.push(h('tr', { class: 'shortcut-cat' }, h('th', { colSpan: 3 }, cat)));
      }
      rows.push(row(cmd));
    }
    body.replaceChildren(...rows);
  }

  filter.addEventListener('input', fill);
  const resetAll = h('button', { type: 'button', class: 'btn small' }, t('Alle zurücksetzen'));
  resetAll.onclick = async () => {
    status.textContent = '';
    if (!(await ask(status, t('Alle Tastenkürzel auf die Standardbelegung zurücksetzen?'), t('Abbrechen'), t('Alle zurücksetzen')))) return;
    resetAllBindings();
    fill();
  };
  fill();
  return h('div', { class: 'shortcut-editor' },
    h('div', { class: 'shortcut-toolbar' }, filter, resetAll),
    status,
    h('table', { class: 'settings-keys shortcut-table' }, body),
    h('h4', {}, t('Feste Tasten und Maus')),
    h('table', { class: 'settings-keys' }, ...fixedRows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))));
}

/** Commands are grouped by category, keeping the order in which the categories first appear */
function groupByCategory<T extends { cat: string }>(list: readonly T[]): T[] {
  const order = [...new Set(list.map((c) => c.cat))];
  return order.flatMap((cat) => list.filter((c) => c.cat === cat));
}

/** Question with two answers inside the given element; Esc or the first answer = false. The first answer has the focus. */
function ask(host: HTMLElement, text: string, no: string, yes: string): Promise<boolean> {
  return new Promise((done) => {
    const noB = h('button', { type: 'button', class: 'btn small' }, no) as HTMLButtonElement;
    const yesB = h('button', { type: 'button', class: 'btn small primary' }, yes) as HTMLButtonElement;
    const box = h('div', { class: 'shortcut-ask', role: 'alertdialog' }, h('span', {}, text), noB, yesB);
    const end = (answer: boolean) => {
      box.remove();
      done(answer);
    };
    noB.onclick = () => end(false);
    yesB.onclick = () => end(true);
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    });
    host.append(box);
    noB.focus();
  });
}
