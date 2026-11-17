// Lists and action buttons of a generator dialog (#335 stage 3). Drawn by the app from the generator's
// declaration; rows live in a data parameter, actions call Generator.onEvent with the inputs they declare.
import { h } from '../dom';
import { subsToPath2D } from '../geom';
import { t } from '../i18n';
import type { SubPath } from '../model';
import type { GenHost } from './host';
import { readRows, removeRow, setCell } from './lists';
import { ruleHolds } from './index';
import type { SurfaceArea } from './dialogSurface';
import type { GenAction, GenEvent, GenEventResult, GenImage, Generator, GenList, Params } from './types';

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

/** An image as RGBA pixels, scaled down to at most maxPx on its longer side */
function readImage(src: CanvasImageSource, w: number, h: number, maxPx: number): GenImage {
  const f = Math.min(1, maxPx / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * f));
  c.height = Math.max(1, Math.round(h * f));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

/**
 * Lists and actions of a generator. set() changes parameters like user input; onEvent answers may arrive later,
 * and are dropped when the dialog was closed or another action was started meanwhile.
 */
export function listsArea(g: Generator, p: Params, set: (patch: Params) => void, host: GenHost, isOpen: () => boolean, fieldEls: (key: string) => HTMLElement[] = () => [], surface?: SurfaceArea | null): ListsArea | null {
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
    const view = g.view?.(current);
    const info = view?.rows?.[list.param] ?? [];
    const auto = view?.rowAuto?.[list.param] ?? [];
    // Only when rows or their texts changed: an open field keeps its focus while other fields update the preview
    const key = String(current[list.param] ?? '') + '\u0000' + info.join('\u0000') + '\u0000' + auto.join('\u0000');
    if (key === shown[i0]) return;
    shown[i0] = key;
    el.replaceChildren();
    if (!rows.length && list.empty) el.append(h('div', { class: 'muted' }, list.empty));
    const firstText = list.columns.find((c) => c.type === 'text');
    rows.forEach((row, i) => {
      const cells: HTMLElement[] = [];
      const rowActions = (list.rowActions ?? []).map((a) => h('button', { class: 'btn small', title: a.title ?? '', onclick: () => void run({ id: a.id, label: a.label }, {}, i) }, a.label));
      if (list.shape) cells.push(thumb(Array.isArray(row[list.shape.key]) ? (row[list.shape.key] as SubPath[]) : [], list.shape.rotate ? Number(row[list.shape.rotate]) || 0 : 0));
      const main: HTMLElement[] = [];
      for (const c of list.columns) {
        const change = (v: unknown) => set({ [list.param]: setCell(current, list, i, c.key, v) });
        let input: HTMLElement;
        if (c.type === 'enum') {
          input = h('select', { title: c.title ?? c.label, onchange: (e: Event) => change((e.target as HTMLSelectElement).value) },
            ...c.options.map(([v, label]) => h('option', { value: String(v), selected: String(v) === String(row[c.key]) }, label)));
        } else if (c.type === 'text') {
          input = h('input', { type: 'text', class: 'jig-name', value: String(row[c.key] ?? ''), maxlength: c.max ?? 200, placeholder: (c === firstText ? auto[i] : undefined) ?? c.placeholder?.replace('{n}', String(i + 1)) ?? '', title: c.title ?? c.label, onchange: (e: Event) => change((e.target as HTMLInputElement).value.trim()) });
        } else {
          // With a placeholder, 0 shows as an empty field (e.g. „auto“)
          const v = row[c.key];
          const shownValue = c.placeholder && (v === 0 || v === undefined) ? '' : String(v ?? '');
          input = h('input', { type: 'number', class: 'jig-count', min: String(c.min), max: String(c.max), step: c.type === 'int' ? '1' : 'any', value: shownValue, placeholder: c.placeholder ?? '', title: c.title ?? c.label, onchange: (e: Event) => change((e.target as HTMLInputElement).value) });
        }
        if (c.type === 'text' && !main.length) main.push(input, h('span', { class: 'muted' }, info[i] ?? ''));
        else cells.push(c.type === 'enum' ? input : h('label', {}, c.label, ' ', input));
      }
      if (main.length) cells.splice(list.shape ? 1 : 0, 0, h('div', { class: 'jig-col' }, ...main));
      else if (info[i]) cells.push(h('span', { class: 'muted' }, info[i]));
      cells.push(...rowActions);
      if (list.remove) cells.push(h('button', { class: 'btn small', title: list.removeTitle ?? t('Entfernen'), onclick: () => set({ [list.param]: removeRow(current, list, i) }) }, '×'));
      const rowEl = h('div', { class: 'jig-row' }, ...cells);
      // A click on the row (not on its fields and buttons) selects it
      if (list.select)
        rowEl.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('input, select, button')) return;
          surface?.selectRow(list.param, i);
          mark();
        });
      el.append(rowEl);
    });
  };

  /** Mark the selected rows of selectable lists */
  const mark = () => {
    const sel = surface?.state().selected ?? {};
    lists.forEach((list, i) => {
      if (!list.select) return;
      listEls[i].querySelectorAll<HTMLElement>(':scope > .jig-row').forEach((r, k) => r.classList.toggle('on', sel[list.param] === k));
    });
  };
  surface?.onSelect(mark);

  const run = async (a: GenAction, extra: GenEvent['inputs'] = {}, row?: number) => {
    if (!g.onEvent) return;
    const token = ++seq;
    note.textContent = '';
    const inputs: GenEvent['inputs'] = { ...extra };
    if (a.inputs?.includes('selection')) inputs.selection = host.selection();
    if (a.inputs?.includes('camera')) {
      const v = host.cameraImages().find((x) => x.image);
      if (v?.image) {
        const img = readImage(v.image, v.image.width, v.image.height, 1200);
        inputs.camera = { ...img, bed: host.bed(), ...(v.empty ? { empty: readImage(v.empty, v.empty.width, v.empty.height, 1200) } : {}) };
      }
    }
    let r: GenEventResult | void;
    try {
      r = await g.onEvent({ action: a.id, inputs, ...(row !== undefined ? { row } : {}), ...(surface ? { surface: surface.state() } : {}) }, { ...current });
    } catch {
      return;
    }
    if (!isOpen() || token !== seq || !r) return;
    // With a surface, its line shows the message (e.g. how to draw); otherwise the line under the buttons
    if (r.patch && Object.keys(r.patch).length) set(r.patch);
    if (surface && (r.state !== undefined || r.view !== undefined || r.select)) surface.change(r, r.message);
    else if (r.message !== undefined) note.textContent = r.message;
  };

  // An image action asks for a file first; a camera action is offered only while there is a camera image
  const hasCamera = host.cameraImages().some((v) => v.image);
  /** Buttons with a condition, hidden while it does not hold */
  const conditional: { a: GenAction; els: HTMLElement[] }[] = [];
  const button = (a: GenAction): HTMLElement[] => {
    const els = plainButton(a);
    if (a.showIf) conditional.push({ a, els });
    return els;
  };
  const plainButton = (a: GenAction): HTMLElement[] => {
    if (a.inputs?.includes('camera') && !hasCamera) return [];
    const extra = a.field ? fieldEls(a.field) : [];
    if (!a.inputs?.includes('image')) return [h('button', { class: 'btn small', title: a.title ?? '', onclick: () => void run(a) }, a.label), ...extra];
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      let image: GenEvent['inputs']['image'];
      try {
        const bmp = await createImageBitmap(f);
        image = { ...readImage(bmp, bmp.width, bmp.height, 1000), name: f.name.replace(/\.[^.]+$/, '') };
      } catch {
        // The generator reports an image it did not get
      }
      void run(a, image ? { image } : {});
    });
    return [h('button', { class: 'btn small', title: a.title ?? '', onclick: () => file.click() }, a.label), ...extra, file];
  };
  const el = h('div', { class: 'jig-panel gen-lists' },
    ...lists.flatMap((list, i) => [h('h4', {}, list.label), listEls[i]]),
    actions.length ? h('div', { class: 'conn-row' }, ...actions.flatMap(button)) : null,
    note,
  );
  const refresh = (np: Params) => {
    current = np;
    lists.forEach((list, i) => renderList(list, listEls[i], i));
    for (const c of conditional) {
      const on = ruleHolds(c.a.showIf!, np);
      c.els.forEach((e) => (e.hidden = !on));
    }
    mark();
  };
  refresh(p);
  return { el, refresh };
}
