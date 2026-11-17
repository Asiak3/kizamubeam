// Lists and action buttons of a generator dialog (#335 stage 3). Drawn by the app from the generator's
// declaration; rows live in a data parameter, actions call Generator.onEvent with the inputs they declare.
import { h } from '../dom';
import { subsToPath2D } from '../geom';
import { t } from '../i18n';
import type { SubPath } from '../model';
import type { GenHost } from './host';
import { readRows, removeRow, setCell } from './lists';
import type { GenAction, GenEventResult, Generator, GenList, Params } from './types';

export interface ListsArea {
  el: HTMLElement;
  /** Show the current parameters (after a patch, undo, or a new plugin answer) */
  refresh(p: Params): void;
}

function thumb(subs: SubPath[], turn: number): HTMLCanvasElement {
  const cv = h('canvas', { class: 'jig-thumb', width: 64, height: 64 }) as HTMLCanvasElement;
  const pts = subs.flatMap((sp) => (Array.isArray(sp?.nodes) ? sp.nodes : []));
  if (!pts.length) return cv;
  const ext = Math.max(1e-6, ...pts.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y))));
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const k = 28 / ext;
  ctx.setTransform(k, 0, 0, k, 32, 32);
  if (turn) ctx.rotate((turn * Math.PI) / 180);
  ctx.lineWidth = 1.5 / k;
  ctx.strokeStyle = getComputedStyle(document.body).color || '#333';
  try {
    ctx.stroke(subsToPath2D(subs));
  } catch {
    // A row without a drawable outline keeps an empty picture
  }
  return cv;
}

/**
 * Lists and actions of a generator. set() changes parameters like user input; onEvent answers may arrive later,
 * and are dropped when the dialog was closed or another action was started meanwhile.
 */
export function listsArea(g: Generator, p: Params, set: (patch: Params) => void, host: GenHost, isOpen: () => boolean): ListsArea | null {
  const lists = g.lists ?? [];
  const actions = g.actions ?? [];
  if (!lists.length && !actions.length) return null;
  const note = h('div', { class: 'note' });
  let current = p;
  let seq = 0;
  const listEls = lists.map(() => h('div', { class: 'jig-list' }));

  const shown = lists.map(() => '');
  const renderList = (list: GenList, el: HTMLElement, i0: number) => {
    const rows = readRows(current, list);
    const info = g.view?.(current).rows?.[list.param] ?? [];
    // Only when rows or their texts changed: an open field keeps its focus while other fields update the preview
    const key = String(current[list.param] ?? '') + '\u0000' + info.join('\u0000');
    if (key === shown[i0]) return;
    shown[i0] = key;
    el.replaceChildren();
    if (!rows.length && list.empty) el.append(h('div', { class: 'muted' }, list.empty));
    rows.forEach((row, i) => {
      const cells: HTMLElement[] = [];
      if (list.shape) cells.push(thumb(Array.isArray(row[list.shape.key]) ? (row[list.shape.key] as SubPath[]) : [], list.shape.rotate ? Number(row[list.shape.rotate]) || 0 : 0));
      const main: HTMLElement[] = [];
      for (const c of list.columns) {
        const change = (v: unknown) => set({ [list.param]: setCell(current, list, i, c.key, v) });
        let input: HTMLElement;
        if (c.type === 'enum') {
          input = h('select', { title: c.title ?? c.label, onchange: (e: Event) => change((e.target as HTMLSelectElement).value) },
            ...c.options.map(([v, label]) => h('option', { value: String(v), selected: String(v) === String(row[c.key]) }, label)));
        } else if (c.type === 'text') {
          input = h('input', { type: 'text', class: 'jig-name', value: String(row[c.key] ?? ''), maxlength: c.max ?? 200, title: c.title ?? c.label, onchange: (e: Event) => change((e.target as HTMLInputElement).value.trim()) });
        } else {
          input = h('input', { type: 'number', class: 'jig-count', min: String(c.min), max: String(c.max), step: c.type === 'int' ? '1' : 'any', value: String(row[c.key] ?? ''), title: c.title ?? c.label, onchange: (e: Event) => change((e.target as HTMLInputElement).value) });
        }
        if (c.type === 'text' && !main.length) main.push(input, h('span', { class: 'muted' }, info[i] ?? ''));
        else cells.push(c.type === 'enum' ? input : h('label', {}, c.label, ' ', input));
      }
      if (main.length) cells.splice(list.shape ? 1 : 0, 0, h('div', { class: 'jig-col' }, ...main));
      else if (info[i]) cells.push(h('span', { class: 'muted' }, info[i]));
      if (list.remove) cells.push(h('button', { class: 'btn small', title: list.removeTitle ?? t('Entfernen'), onclick: () => set({ [list.param]: removeRow(current, list, i) }) }, '×'));
      el.append(h('div', { class: 'jig-row' }, ...cells));
    });
  };

  const run = async (a: GenAction) => {
    if (!g.onEvent) return;
    const token = ++seq;
    note.textContent = '';
    const inputs = a.inputs?.includes('selection') ? { selection: host.selection() } : {};
    let r: GenEventResult | void;
    try {
      r = await g.onEvent({ action: a.id, inputs }, { ...current });
    } catch {
      return;
    }
    if (!isOpen() || token !== seq || !r) return;
    if (r.message !== undefined) note.textContent = r.message;
    if (r.patch && Object.keys(r.patch).length) set(r.patch);
  };

  const el = h('div', { class: 'jig-panel gen-lists' },
    ...lists.flatMap((list, i) => [h('h4', {}, list.label), listEls[i]]),
    actions.length ? h('div', { class: 'conn-row' }, ...actions.map((a) => h('button', { class: 'btn small', title: a.title ?? '', onclick: () => void run(a) }, a.label))) : null,
    note,
  );
  const refresh = (np: Params) => {
    current = np;
    lists.forEach((list, i) => renderList(list, listEls[i], i));
  };
  refresh(p);
  return { el, refresh };
}
