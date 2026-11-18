// Drawing surface of a generator dialog (#335 stage 4). The generator says what to draw (Generator.draw: a list
// of lines, handles and texts in mm, plus layers the app keeps as pictures) and answers pointer events
// (Generator.onSurface). The app scales, draws, hit-tests and keeps the surface state; the generator only ever
// changes parameters. Answers of a plugin arrive later: events are sent one after the other, moves are merged.
// The surface fills the room the dialog gives it (it starts at the manifest's height and gives way in a smaller dialog); the generator gets the size
// in pixels with every draw and is asked again when it changes (#411). The cursor is the one the drawing asks for, over
// the whole surface; without one, "move" over shapes with an id and the normal cursor elsewhere. With track on, pressing or releasing Shift, Ctrl or Alt over
// the surface sends a move at the pointer, so the generator can show what the key does without the pointer moving.
// The right column (#411) gets the help as a list and the number fields the drawing asks for (a typed value goes to
// the generator as a "field" event); the dialog hears about every new drawing, for the marks in its preview.
import { pointerMods } from './pointerMods';
import { evalExpr, f2, h } from '../dom';
import type { GenDrawing, GenItem, GenLayer, Generator, GenPointer, GenSideField, GenStyle, GenSurfaceChange, GenSurfaceState, Params } from './types';

export interface SurfaceArea {
  el: HTMLElement;
  /** What belongs in the right column, under the preview and the info: the drawing's fields and the help as a list */
  side: HTMLElement;
  /** The drawing shown now (null before the first one) */
  drawing(): GenDrawing | null;
  /** Called with every new drawing (the preview shows its marks) */
  onDrawing(f: () => void): void;
  /** Show the current parameters */
  refresh(p: Params): void;
  /** The surface as it is now (for actions) */
  state(): GenSurfaceState;
  /** Apply what an answer asks for (onEvent) and show its message */
  change(c: GenSurfaceChange, message?: string): void;
  /** A row of a list was clicked */
  selectRow(list: string, row: number): void;
  /** Called when the selected rows change (the lists mark them) */
  onSelect(f: () => void): void;
}

/** Layers kept as data (and as pictures for the current size); a few views of a few models */
const MAX_LAYERS = 8;
const HIT_HANDLE = 8;
const HIT_LINE = 6;
/** The surface gives way down to this height (px) in a dialog made smaller than the manifest's height */
const MIN_H = 200;

type Fit = { k: number; ox: number; oy: number };

export function surfaceArea(g: Generator, p: Params, set: (patch: Params) => void, isOpen: () => boolean): SurfaceArea | null {
  const spec = g.surface;
  if (!spec || !g.draw || !spec.views.length) return null;
  /** Starting height (px): the manifest's; the surface grows with the dialog, and gives way in a smaller one */
  const H = spec.height ?? 300;
  let current = p;
  const st: GenSurfaceState = { view: spec.views[0].id, state: null, selected: {} };
  const selectListeners: (() => void)[] = [];
  const drawingListeners: (() => void)[] = [];

  const canvas = h('canvas', { class: 'gen-surface', tabindex: '0' }) as HTMLCanvasElement;
  // The canvas fills a box that grows with the dialog; its own size never feeds back into the layout
  const box = h('div', { class: 'gen-surface-box', style: `min-height:${H}px` }, canvas);
  const note = h('div', { class: 'note' });
  const tabs = spec.views.map((v) => h('button', { class: 'small', onclick: () => change({ view: v.id }) }, v.label));
  const syncTabs = () => tabs.forEach((b, i) => b.classList.toggle('on', spec.views[i].id === st.view));

  // ---- Drawing ----
  let drawing: GenDrawing | null = null;
  let fit: Fit = { k: 1, ox: 0, oy: 0 };
  const layers = new Map<string, GenLayer>();
  const pictures = new Map<string, HTMLCanvasElement>();
  const size = () => ({ w: canvas.clientWidth || 560, h: canvas.clientHeight || H });
  const dpr = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const colors = () => {
    const css = getComputedStyle(canvas);
    const text = css.getPropertyValue('--text').trim() || css.color || '#333';
    return {
      normal: text,
      muted: text,
      accent: css.getPropertyValue('--accent').trim() || '#2b7de9',
      warn: css.getPropertyValue('--warn').trim() || '#d9822b',
    } as Record<GenStyle, string>;
  };
  const sx = (x: number) => fit.ox + x * fit.k;
  const sy = (y: number) => fit.oy + y * fit.k;

  const drawItems = (ctx: CanvasRenderingContext2D, items: GenItem[], col: Record<GenStyle, string>) => {
    for (const it of items) {
      const style = it.style ?? 'normal';
      ctx.strokeStyle = ctx.fillStyle = col[style];
      ctx.globalAlpha = style === 'muted' ? 0.5 : 1;
      if (it.type === 'line') {
        if (it.pts.length < 2) continue;
        if (it.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, it.alpha));
        ctx.lineWidth = it.width ?? 1.5;
        ctx.setLineDash(it.dash ? [5, 4] : []);
        ctx.beginPath();
        it.pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        if (it.closed) ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (it.type === 'handle') {
        ctx.beginPath();
        ctx.arc(sx(it.x), sy(it.y), it.size ?? 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(it.text, sx(it.x) + 6, sy(it.y) - 6);
      }
    }
    ctx.globalAlpha = 1;
  };

  /** A region map as a picture, one pixel per cell in the region's colour (kept per map) */
  const bitmaps = new WeakMap<object, HTMLCanvasElement>();
  const regionBitmap = (g: NonNullable<GenLayer['regions']>): HTMLCanvasElement => {
    let c = bitmaps.get(g);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = g.width;
    c.height = g.height;
    const img = new ImageData(g.width, g.height);
    const rgb = g.colors.map((x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]);
    for (let i = 0; i < g.data.length; i++) {
      const v = g.data[i];
      const q = v ? rgb[v - 1] : undefined;
      if (!q) continue;
      img.data[i * 4] = q[0];
      img.data[i * 4 + 1] = q[1];
      img.data[i * 4 + 2] = q[2];
      img.data[i * 4 + 3] = 255;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
    bitmaps.set(g, c);
    return c;
  };

  /** A layer as a picture for the current size and scale */
  const picture = (L: GenLayer, col: Record<GenStyle, string>): HTMLCanvasElement => {
    const { w, h: hh } = size();
    const r = dpr();
    const id = `${L.key}\u0000${w}\u0000${hh}\u0000${r}\u0000${fit.k}\u0000${fit.ox}\u0000${fit.oy}`;
    let c = pictures.get(id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.round(w * r);
    c.height = Math.round(hh * r);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const T = L.tris ?? [];
    if (T.length >= 6) {
      ctx.fillStyle = col.normal;
      ctx.globalAlpha = L.alpha ?? 0.14;
      // Into one bitmap at full opacity first, then faded: overlapping triangles must not add up
      const tmp = document.createElement('canvas');
      tmp.width = c.width;
      tmp.height = c.height;
      const t2 = tmp.getContext('2d')!;
      t2.setTransform(r, 0, 0, r, 0, 0);
      t2.fillStyle = col.normal;
      t2.beginPath();
      for (let i = 0, n = 0; i + 5 < T.length; i += 6) {
        // All triangles the same way round, so front and back do not cancel out when filling
        const area = (T[i + 2] - T[i]) * (T[i + 5] - T[i + 1]) - (T[i + 4] - T[i]) * (T[i + 3] - T[i + 1]);
        if (!area) continue;
        const [a, b] = area > 0 ? [2, 4] : [4, 2];
        t2.moveTo(sx(T[i]), sy(T[i + 1]));
        t2.lineTo(sx(T[i + a]), sy(T[i + a + 1]));
        t2.lineTo(sx(T[i + b]), sy(T[i + b + 1]));
        t2.closePath();
        // In portions: one path with tens of thousands of pieces is very slow to fill
        if (++n % 400 === 0) {
          t2.fill('nonzero');
          t2.beginPath();
        }
      }
      t2.fill('nonzero');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tmp, 0, 0);
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (L.regions) {
      const g = L.regions;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = L.alpha ?? 0.7;
      ctx.drawImage(regionBitmap(g), sx(g.frame.x0), sy(g.frame.y0), (g.frame.x1 - g.frame.x0) * fit.k, (g.frame.y1 - g.frame.y0) * fit.k);
      ctx.restore();
    }
    if (L.items) drawItems(ctx, L.items, col);
    if (pictures.size > MAX_LAYERS * 2) pictures.delete(pictures.keys().next().value!);
    pictures.set(id, c);
    return c;
  };

  const paint = () => {
    watchBody();
    const { w, h: hh } = size();
    const r = dpr();
    if (canvas.width !== Math.round(w * r) || canvas.height !== Math.round(hh * r)) {
      canvas.width = Math.round(w * r);
      canvas.height = Math.round(hh * r);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!drawing) return;
    const f = drawing.frame;
    const fw = Math.max(1e-6, f.x1 - f.x0), fh = Math.max(1e-6, f.y1 - f.y0);
    const k = Math.min((w * 0.92) / fw, (hh * 0.9) / fh);
    fit = { k, ox: w / 2 - ((f.x0 + f.x1) / 2) * k, oy: hh / 2 - ((f.y0 + f.y1) / 2) * k };
    const col = colors();
    for (const L of drawing.layers ?? []) {
      const data = layers.get(L.key);
      if (data) ctx.drawImage(picture(data, col), 0, 0);
    }
    ctx.setTransform(r, 0, 0, r, 0, 0);
    drawItems(ctx, drawing.items, col);
    canvas.style.cursor = cursorAt(pointer);
  };
  const cursorAt = (q: { px: number; py: number } | null) => drawing?.cursor ?? (q && hit(q.px, q.py) ? 'move' : 'default');

  // ---- Calls to the generator, one after the other ----
  let drawSeq = 0;
  let drawBusy = false;
  let drawAgain = false;
  /** The size the last drawing was asked for (px) */
  let drawnSize = { width: 0, height: 0 };
  const redraw = async () => {
    if (drawBusy) {
      drawAgain = true;
      return;
    }
    drawBusy = true;
    try {
      do {
        drawAgain = false;
        const token = ++drawSeq;
        let d: GenDrawing;
        const { w, h: hh } = size();
        drawnSize = { width: Math.round(w), height: Math.round(hh) };
        try {
          d = await g.draw!({ view: st.view, state: st.state, selected: { ...st.selected }, have: [...layers.keys()], size: drawnSize }, { ...current });
        } catch {
          continue;
        }
        if (!isOpen() || token !== drawSeq) continue;
        for (const L of d.layers ?? []) {
          if (L.tris || L.items || L.regions) {
            layers.delete(L.key);
            layers.set(L.key, L);
            for (const id of [...pictures.keys()]) if (id.startsWith(L.key + '\u0000')) pictures.delete(id);
          }
        }
        while (layers.size > MAX_LAYERS) layers.delete(layers.keys().next().value!);
        drawing = d;
        paint();
        showFields(d.fields ?? []);
        drawingListeners.forEach((f) => f());
      } while (drawAgain && isOpen());
    } finally {
      drawBusy = false;
    }
  };

  const queue: GenPointer[] = [];
  let sending = false;
  const send = (ev: GenPointer) => {
    if (!g.onSurface) return;
    // Only the newest of several waiting moves counts
    const last = queue[queue.length - 1];
    if (ev.type === 'move' && last?.type === 'move') queue[queue.length - 1] = ev;
    else queue.push(ev);
    if (!sending) void pump();
  };
  const pump = async () => {
    sending = true;
    try {
      while (queue.length && isOpen()) {
        const ev = queue.shift()!;
        let r;
        try {
          r = await g.onSurface!(ev, { view: st.view, state: st.state, selected: { ...st.selected } }, { ...current });
        } catch {
          continue;
        }
        if (!isOpen()) return;
        if (!r) continue;
        // Parameters first: the drawing after the change shows the new parameters with the new state
        if (r.patch && Object.keys(r.patch).length) set(r.patch);
        apply(r, r.message);
      }
    } finally {
      sending = false;
    }
  };

  /** Apply a change without drawing (the caller draws) */
  const apply = (c: GenSurfaceChange, message?: string) => {
    if (message !== undefined) note.textContent = message;
    let selected = false;
    if (c.state !== undefined) st.state = c.state;
    if (c.view !== undefined && spec.views.some((v) => v.id === c.view)) st.view = c.view;
    if (c.select) {
      for (const [k, v] of Object.entries(c.select)) if (Number.isInteger(v)) st.selected[k] = v;
      selected = true;
    }
    syncTabs();
    if (selected) selectListeners.forEach((f) => f());
    void redraw();
  };
  const change = (c: GenSurfaceChange, message?: string) => apply(c, message);

  // ---- Pointer ----
  const at = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { px, py, x: (px - fit.ox) / fit.k, y: (py - fit.oy) / fit.k };
  };
  const round = (v: number) => Math.round(v * 1000) / 1000;
  /** Handle or line under the pointer: topmost first, handles before lines */
  const hit = (px: number, py: number): string | undefined => {
    const items = drawing?.items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'handle' && Math.hypot(sx(it.x) - px, sy(it.y) - py) < HIT_HANDLE) return it.id;
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type !== 'line' || !it.id) continue;
      const n = it.pts.length;
      for (let k = 0; k + 1 < n + (it.closed ? 1 : 0); k++) {
        const a = it.pts[k], b = it.pts[(k + 1) % n];
        const ax = sx(a[0]), ay = sy(a[1]), dx = sx(b[0]) - ax, dy = sy(b[1]) - ay;
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(ax + u * dx - px, ay + u * dy - py) < HIT_LINE) return it.id;
      }
    }
    // Region maps of the shown layers, the topmost first: "<layer key>:<region>"
    const shown = drawing?.layers ?? [];
    const x = (px - fit.ox) / fit.k, y = (py - fit.oy) / fit.k;
    for (let i = shown.length - 1; i >= 0; i--) {
      const g = layers.get(shown[i].key)?.regions;
      if (!g) continue;
      const cx = Math.floor(((x - g.frame.x0) / (g.frame.x1 - g.frame.x0)) * g.width);
      const cy = Math.floor(((y - g.frame.y0) / (g.frame.y1 - g.frame.y0)) * g.height);
      if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) continue;
      const v = g.data[cy * g.width + cx];
      if (v) return `${shown[i].key}:${v - 1}`;
    }
    return undefined;
  };
  let down: { x: number; y: number } | null = null;
  /** Where the pointer is over the surface (screen and mm), for the cursor and for moves on modifier keys */
  let pointer: { px: number; py: number; x: number; y: number } | null = null;
  const ev = (type: GenPointer['type'], e: MouseEvent, extra: Partial<GenPointer> = {}): GenPointer => {
    const q = at(e);
    return { type, x: round(q.x), y: round(q.y), ...extra, ...pointerMods(e) };
  };
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    canvas.focus();
    const q = at(e);
    down = { x: round(q.x), y: round(q.y) };
    const id = hit(q.px, q.py);
    send(ev('down', e, id ? { hit: id } : {}));
  });
  canvas.addEventListener('mousemove', (e) => {
    const q = at(e);
    pointer = { px: q.px, py: q.py, x: round(q.x), y: round(q.y) };
    if (!down) canvas.style.cursor = cursorAt(q);
    if (!down && !drawing?.track) return;
    send(ev('move', e, down ? { drag: true, from: down } : {}));
  });
  // A modifier key pressed or released over the surface (the dialog stops key events, so on the way down)
  const modKey = (e: KeyboardEvent) => {
    if (!canvas.isConnected) {
      window.removeEventListener('keydown', modKey, true);
      window.removeEventListener('keyup', modKey, true);
      return;
    }
    if (e.repeat || !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || !pointer || down || !drawing?.track || !isOpen()) return;
    send({ type: 'move', x: pointer.x, y: pointer.y, ...pointerMods(e) });
  };
  window.addEventListener('keydown', modKey, true);
  window.addEventListener('keyup', modKey, true);
  const up = (e: MouseEvent) => {
    if (!down) return;
    const from = down;
    down = null;
    send(ev('up', e, { from }));
  };
  canvas.addEventListener('mouseup', up);
  canvas.addEventListener('mouseleave', (e) => {
    pointer = null;
    up(e);
  });
  canvas.addEventListener('dblclick', (e) => {
    const q = at(e);
    const id = hit(q.px, q.py);
    send(ev('dblclick', e, id ? { hit: id } : {}));
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const q = at(e);
    const id = hit(q.px, q.py);
    send(ev('context', e, id ? { hit: id } : {}));
  });
  canvas.addEventListener('keydown', (e) => {
    if (!['Enter', 'Escape', 'Delete', 'Backspace'].includes(e.key)) return;
    // Escape closes the dialog unless the generator wants it (escape), or, without that, while track is on (e.g.
    // while drawing a line)
    if (e.key === 'Escape' && !(drawing?.escape ?? drawing?.track)) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'key', x: 0, y: 0, key: e.key, ...pointerMods(e) });
  });
  // The size follows the dialog: painted again at once, drawn again (the generator may place its texts by the size)
  // once the size has settled
  let resized = 0;
  const ro =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          paint();
          clearTimeout(resized);
          resized = window.setTimeout(() => {
            const { w, h: hh } = size();
            if (isOpen() && drawing && (Math.round(w) !== drawnSize.width || Math.round(hh) !== drawnSize.height)) void redraw();
          }, 150);
        })
      : null;
  ro?.observe(canvas);
  // In a dialog lower than its content (a small window, or made smaller with the grip) the surface gives way down to
  // MIN_H, so it stays whole on screen instead of the dialog scrolling with the surface cut off (#411)
  let body: Element | null = null;
  const fitBox = () => {
    if (!body) return;
    box.style.minHeight = `${H}px`;
    const over = body.scrollHeight - body.clientHeight;
    if (over > 0) box.style.minHeight = `${Math.max(Math.min(H, MIN_H), H - over)}px`;
  };
  const bodyRo = typeof ResizeObserver === 'function' ? new ResizeObserver(fitBox) : null;
  const watchBody = () => {
    if (body || !el.isConnected) return;
    body = el.closest('.gen-body');
    if (body) bodyRo?.observe(body);
    fitBox();
  };

  const el = h('div', { class: 'gen-surface-area' },
    spec.views.length > 1 ? h('div', { class: 'conn-row' }, ...tabs) : null,
    box,
    note,
    typeof spec.help === 'string' && spec.help ? h('div', { class: 'note muted' }, spec.help) : null,
  );
  // The right column (#411): the drawing's fields, then the help as a list
  const fieldsEl = h('div', { class: 'gen-side-fields' });
  // It takes the room left under the preview and scrolls there: a long help must not make the dialog taller
  const side = h('div', { class: 'gen-side-surface' },
    h('div', { class: 'gen-side-scroll' }, fieldsEl, Array.isArray(spec.help) ? h('ul', { class: 'gen-help' }, ...spec.help.map((x) => h('li', {}, x))) : null));
  /** The shown fields by id: what the drawing said and whether the user is typing in it */
  let fieldRows = new Map<string, { input: HTMLInputElement; f: GenSideField; typing: boolean }>();
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : f2(v));
  const fieldRow = (f: GenSideField) => {
    const input = h('input', { type: 'text', id: `gen-side-${f.id}`, value: fmt(f.value), ...(f.title ? { title: f.title } : {}) }) as HTMLInputElement;
    input.readOnly = !!f.readonly;
    const row = { input, f, typing: false };
    // Only what was typed since the last commit counts: after Enter, leaving the field fires "change" once more
    const commit = () => {
      if (!row.typing) return;
      row.typing = false;
      const v = evalExpr(input.value);
      const cur = row.f;
      if (v === null || cur.readonly) return void (input.value = fmt(cur.value));
      const value = Math.max(cur.min ?? -Infinity, Math.min(cur.max ?? Infinity, Math.round(v * 1000) / 1000));
      input.value = fmt(value);
      if (Math.abs(value - cur.value) > 1e-9) send({ type: 'field', x: 0, y: 0, field: cur.id, value });
    };
    input.addEventListener('input', () => (row.typing = true));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      // Enter takes the value here (it would press OK in the dialog), Escape brings back the drawing's value
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commit();
      } else if (e.key === 'Escape' && row.typing) {
        e.preventDefault();
        e.stopPropagation();
        row.typing = false;
        input.value = fmt(row.f.value);
      }
    });
    return row;
  };
  /** Show the drawing's fields: the same fields keep their inputs (and the focus); a field being typed in keeps its text */
  const showFields = (fields: GenSideField[]) => {
    const same = fields.length === fieldRows.size && fields.every((f) => fieldRows.get(f.id)?.f.label === f.label);
    if (!same) {
      fieldRows = new Map(fields.map((f) => [f.id, fieldRow(f)]));
      fieldsEl.replaceChildren(...fields.flatMap((f) => [h('label', { for: `gen-side-${f.id}` }, f.label), fieldRows.get(f.id)!.input]));
      return;
    }
    for (const f of fields) {
      const row = fieldRows.get(f.id)!;
      row.f = f;
      row.input.readOnly = !!f.readonly;
      if (f.title) row.input.title = f.title;
      else row.input.removeAttribute('title');
      if (!row.typing) row.input.value = fmt(f.value);
    }
  };
  syncTabs();
  return {
    el,
    side,
    drawing: () => drawing,
    onDrawing(f) {
      drawingListeners.push(f);
    },
    refresh(np) {
      watchBody();
      current = np;
      void redraw();
    },
    state: () => ({ view: st.view, state: st.state, selected: { ...st.selected } }),
    change,
    selectRow(list, row) {
      st.selected[list] = row;
      selectListeners.forEach((f) => f());
      send({ type: 'select', x: 0, y: 0, list, row });
      void redraw();
    },
    onSelect(f) {
      selectListeners.push(f);
    },
  };
}
