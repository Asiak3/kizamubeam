import { h } from './dom';
import { commandKey } from './commandKeys';

export interface ContextAction {
  id: string; label: string; run: () => unknown; enabled?: boolean; checked?: boolean;
  items?: ContextAction[];
}
let activeClose: (() => void) | null = null;
export const closeEditorMenu = () => activeClose?.();

/** Owns listeners, focus and keyboard capture; does not touch documents or machine state. */
export function showEditorMenu(x: number, y: number, groups: ContextAction[][], onClose?: () => void) {
  closeEditorMenu();
  // Existing toolbar/toolbox menus share this CSS class. Dismiss them normally,
  // allowing their own outside-click cleanup rather than removing their DOM.
  document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const previous = document.activeElement as HTMLElement | null;
  const root = h('div', { class: 'ctx-menu menu-items editor-context-menu', role: 'menu' });
  let disposed = false;
  const close = () => {
    if (disposed) return;
    disposed = true; root.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', scroll, true);
    activeClose = null; onClose?.();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const fill = (parent: HTMLElement, actions: ContextAction[]) => {
    for (const action of actions) {
      if (action.items) {
        const nested = h('div', { class: 'editor-context-submenu', hidden: true, role: 'menu' });
        fill(nested, action.items);
        const button = h('button', { role: 'menuitem', 'aria-expanded': 'false', onclick: () => {
          nested.hidden = !nested.hidden; button.setAttribute('aria-expanded', String(!nested.hidden));
          if (!nested.hidden) nested.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        } }, action.label, ' ▸');
        parent.append(button, nested); continue;
      }
      const button = h('button', { type: 'button', role: action.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': action.checked === undefined ? undefined : String(action.checked), disabled: action.enabled === false,
        onclick: () => { if (disposed || button.disabled) return; close(); void action.run(); } },
      h('span', {}, action.checked ? '✓ ' + action.label : action.label), commandKey(action.id) ? h('kbd', {}, commandKey(action.id)) : null);
      parent.append(button);
    }
  };
  groups.filter((group) => group.length).forEach((group, i) => { if (i) root.append(h('hr', { role: 'separator' })); fill(root, group); });
  const outside = (event: MouseEvent) => { if (!root.contains(event.target as Node)) close(); };
  const scroll = (event: Event) => { if (!root.contains(event.target as Node)) close(); };
  const keydown = (event: KeyboardEvent) => {
    // Never let Delete, Ctrl+A, Space or node shortcuts reach the editor while a menu owns focus.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter((b) => b.getClientRects().length);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); buttons[current]?.click(); }
  };
  document.body.append(root);
  root.style.left = `${Math.max(4, Math.min(x, innerWidth - root.offsetWidth - 4))}px`;
  root.style.top = `${Math.max(4, Math.min(y, innerHeight - root.offsetHeight - 4))}px`;
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('scroll', scroll, true);
  window.addEventListener('blur', close); window.addEventListener('resize', close);
  activeClose = close;
  root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  return close;
}
