// Objekte-Fenster: Baum aus Layern und den Objekten darin (mit Gruppen), angelehnt an LightBurns „Objects“.
// Auswahl synchron mit der Arbeitsfläche, Umbenennen per Doppelklick, Ein-/Ausblenden, Sperren,
// Reihenfolge und Layer per Ziehen.
//
// Aufbau: Ganz oben stehen die Seiten des Projekts. Unter der aktuellen Seite liefert sections() je Layer einen
// Abschnitt mit dessen Objekten; die anderen Seiten zeigen nur ihre Objektzahl (Klick wechselt dorthin).
import { LINEAR_NAMES } from './barcode1d';
import type { Editor } from './editor';
import { genLabel, getGenerator } from './generators';
import { ICONS } from './icons';
import { homeLayer, isOff, layerLabel, Obj, PALETTE } from './model';
import { openShowIfDialog } from './paramsPanel';
import { $, h } from './dom';
import { t, tn } from './i18n';
import { isShown, onWindowShow, setBadge } from './dock';

/** Mehr Zeilen je Layer werden erst auf Wunsch gezeigt (große Arrays, Nachzeichnungen) */
const ROW_LIMIT = 300;

/** Anzeigename eines Objekts: eigener Name oder aus der Form abgeleitet */
export function objLabel(o: Obj): string {
  if (o.name) return o.name;
  const s = o.shape;
  switch (s.kind) {
    case 'rect':
      return t('Rechteck');
    case 'ellipse':
      return t('Ellipse');
    case 'polygon':
      return s.star ? t('Stern') : t('Polygon');
    case 'path':
      return s.subs.every((sp) => sp.closed) ? t('Pfad') : t('Linie');
    case 'text': {
      const line = s.text.split('\n')[0].trim();
      return line ? `„${line.length > 28 ? line.slice(0, 27) + '…' : line}“` : t('Text');
    }
    case 'image':
      return s.name || t('Bild');
    case 'barcode': {
      const line = s.data.split('\n')[0].trim();
      const name = s.type === 'qr' ? 'QR' : LINEAR_NAMES[s.type];
      return line ? `${name} „${line.length > 24 ? line.slice(0, 23) + '…' : line}“` : s.type === 'qr' ? t('QR-Code') : name;
    }
    case 'gen':
      return genLabel(s);
    case 'group':
      return tn('Gruppe ({n} Objekt)', 'Gruppe ({n} Objekte)', s.children.length);
  }
}

const KIND_ICON: Record<Obj['shape']['kind'], string> = {
  rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', path: 'path', text: 'text', image: 'image', barcode: 'qr', gen: 'gear', group: 'group',
};

interface Section {
  layer: number;
  /** Oberste Objekte dieses Layers, vorderstes zuerst */
  objs: Obj[];
}

type Drop =
  | { kind: 'obj'; ref: Obj; front: boolean }
  | { kind: 'layer'; layer: number; before: boolean; into: boolean }
  | { kind: 'page'; page: number; before: boolean; into: boolean };

/** Einrückung unter der Seitenzeile */
const INDENT = 14;

export function buildObjectsPanel(ed: Editor) {
  const body = $('#objects');
  /** Nur neu aufbauen, wenn das Fenster zu sehen ist; beim Einblenden wird nachgeholt */
  const open = () => isShown('objects');
  const setCount = () => setBadge('objects', ed.doc.objs.length ? String(ed.doc.objs.length) : '');
  // Layers start folded, including layers first encountered after an import.
  // Explicit user toggles remain unchanged across ordinary tree refreshes.
  const collapsedLayers = new Set<number>(Array.from({ length: PALETTE.length }, (_, i) => i));
  const openGroups = new Set<number>();
  const showAll = new Set<number>();
  /** Zeile → Objekt und oberstes Objekt */
  let rows = new Map<number, { el: HTMLElement; obj: Obj; top: Obj }>();
  let layerRows = new Map<number, HTMLElement>();
  let pageCollapsed = false;
  let fromPanel = false;
  let renaming = false;

  /** Layer-Abschnitte der aktuellen Seite */
  const sections = (): Section[] => {
    const by = new Map<number, Obj[]>();
    for (let k = ed.doc.objs.length - 1; k >= 0; k--) {
      const o = ed.doc.objs[k];
      const L = homeLayer(o);
      let list = by.get(L);
      if (!list) by.set(L, (list = []));
      list.push(o);
    }
    const order = ed.layerOrder();
    for (const L of by.keys()) if (!order.includes(L)) order.push(L);
    return order.filter((L) => by.has(L)).map((layer) => ({ layer, objs: by.get(layer)! }));
  };

  const toggleBtn = (cls: string, on: boolean, icon: string, title: string, onclick: () => void) =>
    h('button', {
      class: `ot-btn ${cls}${on ? ' on' : ''}`,
      title,
      html: ICONS[icon],
      onclick: (e: Event) => (e.stopPropagation(), onclick()),
    });

  const startRename = (label: HTMLElement, value: string, commit: (v: string) => void) => {
    renaming = true;
    const inp = h('input', { type: 'text', class: 'ot-rename', value }) as HTMLInputElement;
    label.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      renaming = false;
      if (ok && inp.value !== value) commit(inp.value);
      else render();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('dblclick', (e) => e.stopPropagation());
  };

  const renderObj = (o: Obj, top: Obj, depth: number, dimmed: boolean, out: HTMLElement[]) => {
    const isGroup = o.shape.kind === 'group';
    const expanded = isGroup && openGroups.has(o.id);
    const isTop = o === top;
    const off = dimmed || isOff(o);
    const label = h('span', { class: 'ot-label' }, objLabel(o));
    const chevron = isGroup
      ? h('span', {
          class: 'ot-chev',
          onclick: (e: Event) => {
            e.stopPropagation();
            if (expanded) openGroups.delete(o.id);
            else openGroups.add(o.id);
            render();
          },
        }, expanded ? '▾' : '▸')
      : h('span', { class: 'ot-chev' });
    // Layer-Farbe nur zeigen, wo sie vom Abschnitt abweicht (Gruppen über mehrere Layer)
    const swatch = o.shape.kind !== 'group' && depth > 0 ? h('span', { class: 'ot-dot', style: `background:${PALETTE[o.layer]}`, title: layerLabel(o.layer) }) : null;
    const row = h(
      'div',
      {
        class: `ot-row ot-obj${off ? ' off' : ''}${top.locked ? ' locked' : ''}${top.noLaser ? ' nolaser' : ''}`,
        style: `padding-left:${8 + INDENT + depth * 14}px`,
        draggable: isTop ? 'true' : 'false',
        title: t('Klick: auswählen (Shift/Ctrl: hinzufügen) · Doppelklick auf den Namen: umbenennen · Ziehen: Reihenfolge oder Layer ändern'),
      },
      chevron,
      h('span', { class: 'ot-icon', html: ICONS[o.shape.kind === 'gen' ? (getGenerator(o.shape.gen)?.icon ?? 'gear') : o.shape.kind === 'barcode' && o.shape.type !== 'qr' ? 'barcode' : KIND_ICON[o.shape.kind]] ?? ICONS.gear }),
      swatch,
      label,
      o.showIf
        ? h('span', {
            class: 'ot-cond',
            title: t('Sichtbar, wenn: {src} (Klick: ändern)', { src: o.showIf }),
            onclick: (e: Event) => (e.stopPropagation(), openShowIfDialog(ed, [o])),
          }, 'ƒ')
        : null,
      isTop
        ? toggleBtn('ot-laser', !o.noLaser, o.noLaser ? 'laseroff' : 'laser', o.noLaser ? t('Wieder lasern') : t('Nicht lasern (bleibt sichtbar)'), () =>
            ed.setObjProps([o], { noLaser: !o.noLaser }),
          )
        : h('span', { class: 'ot-btn ot-spacer' }),
      toggleBtn('ot-eye', !o.hidden, o.hidden ? 'eyeoff' : 'eye', o.hidden ? t('Einblenden') : t('Ausblenden (wird dann auch nicht gelasert)'), () =>
        ed.setObjProps([o], { hidden: !o.hidden }),
      ),
      isTop
        ? toggleBtn('ot-lock', !!o.locked, o.locked ? 'lock' : 'unlock', o.locked ? t('Entsperren') : t('Sperren (auf der Arbeitsfläche nicht auswählbar)'), () =>
            ed.setObjProps([o], { locked: !o.locked }),
          )
        : h('span', { class: 'ot-btn ot-spacer' }),
    );
    row.dataset.id = String(o.id);
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(label, o.name ?? '', (v) => ed.setObjProps([o], { name: v }));
    });
    rows.set(o.id, { el: row, obj: o, top });
    out.push(row);
    if (expanded && o.shape.kind === 'group')
      for (let k = o.shape.children.length - 1; k >= 0; k--) renderObj(o.shape.children[k], top, depth + 1, off, out);
  };

  const renderSection = (sec: Section, out: HTMLElement[]) => {
    const i = sec.layer;
    const L = ed.layer(i);
    const collapsed = collapsedLayers.has(i);
    const label = h('span', { class: 'ot-label' }, L.name);
    const row = h(
      'div',
      {
        class: `ot-row ot-layer${L.show ? '' : ' off'}${ed.currentLayer === i ? ' cur' : ''}`,
        style: `padding-left:${8 + INDENT}px`,
        draggable: 'true',
        title: t('Klick: aktueller Layer · Doppelklick auf den Namen: umbenennen · Ziehen: Ausgabereihenfolge ändern'),
      },
      h('span', {
        class: 'ot-chev',
        onclick: (e: Event) => {
          e.stopPropagation();
          if (collapsed) collapsedLayers.delete(i);
          else collapsedLayers.add(i);
          render();
        },
      }, collapsed ? '▸' : '▾'),
      h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)),
      label,
      h('span', { class: 'muted ot-n' }, String(sec.objs.length)),
      toggleBtn('ot-laser', L.output, L.output ? 'laser' : 'laseroff', L.output ? t('Layer nicht lasern (Ausgabe aus)') : t('Layer wieder lasern (Ausgabe an)'), () =>
        ed.updateLayer(i, { output: !L.output }),
      ),
      toggleBtn('ot-eye', L.show, L.show ? 'eye' : 'eyeoff', L.show ? t('Layer ausblenden') : t('Layer einblenden'), () => {
        ed.updateLayer(i, { show: !L.show });
        ed.dropUnselectable();
      }),
      toggleBtn('ot-lock', !!L.locked, L.locked ? 'lock' : 'unlock', L.locked ? t('Layer entsperren') : t('Layer sperren (Objekte nicht auswählbar)'), () => {
        ed.updateLayer(i, { locked: !L.locked });
        ed.dropUnselectable();
      }),
    );
    row.dataset.layer = String(i);
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(label, L.name, (v) => v.trim() && ed.updateLayer(i, { name: v.trim() }));
    });
    layerRows.set(i, row);
    out.push(row);
    if (collapsed) return;
    const list = showAll.has(i) ? sec.objs : sec.objs.slice(0, ROW_LIMIT);
    for (const o of list) renderObj(o, o, 0, !L.show, out);
    if (list.length < sec.objs.length) {
      out.push(
        h('button', { class: 'ot-more', onclick: () => (showAll.add(i), render()) },
          tn('{n} weiteres Objekt anzeigen', '{n} weitere Objekte anzeigen', sec.objs.length - list.length)),
      );
    }
  };

  const renderPage = (i: number, out: HTMLElement[]) => {
    const p = ed.doc.pages[i];
    const cur = i === ed.doc.page;
    const multi = ed.doc.pages.length > 1;
    const label = h('span', { class: 'ot-label' }, p.name);
    const row = h(
      'div',
      {
        class: `ot-row ot-page${cur ? ' cur' : ''}`,
        draggable: multi ? 'true' : 'false',
        title: cur
          ? t('Aktuelle Seite: nur sie wird gezeichnet, gelasert und exportiert · Doppelklick auf den Namen: umbenennen')
          : t('Klick: zu dieser Seite wechseln (Bild ↑/↓) · Objekte hierher ziehen: auf diese Seite verschieben'),
      },
      h('span', {
        class: 'ot-chev',
        onclick: (e: Event) => {
          if (!cur) return;
          e.stopPropagation();
          pageCollapsed = !pageCollapsed;
          render();
        },
      }, cur && !pageCollapsed ? '▾' : '▸'),
      h('span', { class: 'ot-icon', html: ICONS.new }),
      label,
      h('span', { class: 'muted ot-n' }, String(p.objs.length)),
      toggleBtn('ot-act', false, 'copy', t('Seite duplizieren'), () => ed.duplicatePage(i)),
      multi ? toggleBtn('ot-act', false, 'delete', t('Seite löschen (rückgängig machbar)'), () => ed.deletePage(i)) : h('span', { class: 'ot-btn ot-spacer' }),
    );
    row.dataset.page = String(i);
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(label, p.name, (v) => ed.renamePage(i, v));
    });
    out.push(row);
  };

  /** Eigene Ebene „Hilfslinien“: gilt für alle Seiten, wird nie gelasert; Auge und Schloss wie bei Layern */
  const renderGuides = (out: HTMLElement[]) => {
    const n = ed.guideList().length;
    const shown = ed.guidesShown();
    const locked = !!ed.doc.guidesLocked;
    out.push(
      h(
        'div',
        {
          class: `ot-row ot-layer ot-guides${shown ? '' : ' off'}`,
          title: t('Hilfslinien aus dem Lineal ziehen. Sie gelten für alle Seiten und werden nie gelasert oder exportiert. Zurück ins Lineal ziehen löscht eine Hilfslinie.'),
        },
        h('span', { class: 'ot-chev' }),
        h('span', { class: 'swatch ot-guide-swatch' }),
        h('span', { class: 'ot-label' }, t('Hilfslinien')),
        h('span', { class: 'muted ot-n' }, String(n)),
        n ? toggleBtn('ot-act', false, 'delete', t('Alle Hilfslinien löschen (rückgängig machbar)'), () => ed.clearGuides()) : h('span', { class: 'ot-btn ot-spacer' }),
        toggleBtn('ot-eye', shown, shown ? 'eye' : 'eyeoff', shown ? t('Hilfslinien ausblenden') : t('Hilfslinien einblenden'), () =>
          ed.setGuideLayer({ hidden: shown }),
        ),
        toggleBtn('ot-lock', locked, locked ? 'lock' : 'unlock', locked ? t('Hilfslinien entsperren') : t('Hilfslinien sperren (nicht verschiebbar)'), () =>
          ed.setGuideLayer({ locked: !locked }),
        ),
      ),
    );
  };

  const render = () => {
    setCount();
    if (!open() || renaming) return;
    const scroll = body.scrollTop;
    rows = new Map();
    layerRows = new Map();
    const out: HTMLElement[] = [];
    ed.doc.pages.forEach((_, i) => {
      renderPage(i, out);
      if (i !== ed.doc.page || pageCollapsed) return;
      const secs = sections();
      if (!secs.length) out.push(h('div', { class: 'empty', style: `padding-left:${8 + INDENT}px` }, t('Noch keine Objekte.')));
      for (const sec of secs) renderSection(sec, out);
    });
    renderGuides(out);
    out.push(h('button', { class: 'ot-more', onclick: () => ed.addPage() }, t('+ Neue Seite')));
    const tree = h('div', { class: 'obj-tree' });
    tree.append(...out);
    body.replaceChildren(tree);
    body.scrollTop = scroll;
    markSelection(false);
  };

  /** Auswahl und aktuellen Layer markieren, ohne den Baum neu zu bauen */
  const markSelection = (reveal: boolean) => {
    const sel = new Set(ed.sel);
    let first: HTMLElement | null = null;
    for (const { el, obj, top } of rows.values()) {
      const s = sel.has(obj);
      el.classList.toggle('sel', s);
      el.classList.toggle('sel-in', !s && obj !== top && sel.has(top));
      if (s && !first) first = el;
    }
    for (const [i, el] of layerRows) el.classList.toggle('cur', ed.currentLayer === i);
    if (reveal && first) first.scrollIntoView({ block: 'nearest' });
  };

  let frame = 0;
  const scheduleRender = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  };
  ed.on((what) => {
    if (what === 'doc') scheduleRender();
    else if (what === 'sel' || what === 'tool') {
      setCount();
      if (!open()) return;
      // Neue Objekte (Zeichnen, Einfügen) kommen ohne 'doc' an: dann neu aufbauen
      if (ed.sel.some((o) => !rows.has(o.id)) && ed.doc.objs.length) {
        scheduleRender();
        return;
      }
      markSelection(what === 'sel' && !fromPanel);
    }
  });

  // ---------- Klicks ----------

  body.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.ot-rename')) return;
    const row = target.closest('.ot-row') as HTMLElement | null;
    if (!row) return;
    if (row.dataset.page) {
      ed.setPage(Number(row.dataset.page));
      return;
    }
    if (row.dataset.layer) {
      const i = Number(row.dataset.layer);
      ed.currentLayer = i;
      ed.activeLayer = i;
      ed.emit('tool');
      return;
    }
    const r = rows.get(Number(row.dataset.id));
    if (!r) return;
    const top = r.top;
    if (!ed.selectable(top)) {
      ed.hint = t('Ausgeblendete oder gesperrte Objekte lassen sich nicht auswählen.');
      ed.emit('tool');
      return;
    }
    fromPanel = true;
    if (e.shiftKey || e.ctrlKey || e.metaKey) ed.setSel(ed.sel.includes(top) ? ed.sel.filter((o) => o !== top) : [...ed.sel, top]);
    else ed.setSel([top]);
    fromPanel = false;
  });

  // ---------- Ziehen ----------

  let dragObjs: Obj[] | null = null;
  let dragLayer: number | null = null;
  let dragPage: number | null = null;
  let drop: Drop | null = null;
  let marked: HTMLElement | null = null;
  const unmark = () => {
    marked?.classList.remove('drop-before', 'drop-after', 'drop-into');
    marked = null;
  };

  body.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest('.ot-row') as HTMLElement | null;
    if (!row || renaming) return e.preventDefault();
    dragObjs = dragLayer = dragPage = null;
    if (row.dataset.page) {
      dragPage = Number(row.dataset.page);
    } else if (row.dataset.layer) {
      dragLayer = Number(row.dataset.layer);
    } else {
      const r = rows.get(Number(row.dataset.id));
      if (!r || r.obj !== r.top) return e.preventDefault();
      dragObjs = ed.sel.includes(r.top) && ed.sel.length > 1 ? [...ed.sel] : [r.top];
    }
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', 'kizamubeam-objects');
    row.classList.add('dragging');
  });

  body.addEventListener('dragover', (e) => {
    if (dragObjs === null && dragLayer === null && dragPage === null) return;
    const row = (e.target as HTMLElement).closest('.ot-row') as HTMLElement | null;
    unmark();
    drop = null;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const upper = e.clientY < rect.top + rect.height / 2;
    if (dragPage !== null || row.dataset.page) {
      // Seiten nur zwischen Seiten einordnen; Objekte auf eine andere Seite verschieben
      if (!row.dataset.page || dragLayer !== null) return;
      const pg = Number(row.dataset.page);
      if (dragPage !== null) {
        if (pg === dragPage) return;
        drop = { kind: 'page', page: pg, before: upper, into: false };
      } else {
        if (pg === ed.doc.page) return;
        drop = { kind: 'page', page: pg, before: false, into: true };
      }
    } else if (dragLayer !== null) {
      // Layer nur zwischen Layern einordnen
      if (!row.dataset.layer || Number(row.dataset.layer) === dragLayer) return;
      drop = { kind: 'layer', layer: Number(row.dataset.layer), before: upper, into: false };
    } else if (row.dataset.layer) {
      drop = { kind: 'layer', layer: Number(row.dataset.layer), before: false, into: true };
    } else {
      const r = rows.get(Number(row.dataset.id));
      if (!r || dragObjs!.includes(r.top)) return;
      // Kinder einer Gruppe: vor bzw. hinter die ganze Gruppe
      const tr = r.obj === r.top ? row : rows.get(r.top.id)?.el ?? row;
      drop = { kind: 'obj', ref: r.top, front: upper };
      marked = tr;
      tr.classList.add(upper ? 'drop-before' : 'drop-after');
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      return;
    }
    marked = row;
    row.classList.add(drop.into ? 'drop-into' : drop.before ? 'drop-before' : 'drop-after');
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  });

  body.addEventListener('dragleave', (e) => {
    if (!body.contains(e.relatedTarget as Node)) unmark();
  });

  body.addEventListener('drop', (e) => {
    e.preventDefault();
    const d = drop;
    const objs = dragObjs,
      layer = dragLayer,
      page = dragPage;
    unmark();
    if (!d) return;
    if (d.kind === 'page') {
      if (page !== null) {
        const to = d.before ? d.page : d.page + 1;
        ed.movePage(page, page < to ? to - 1 : to);
      } else if (objs) ed.moveToPage(objs, d.page);
      return;
    }
    if (layer !== null && d.kind === 'layer') ed.placeLayer(layer, d.layer, d.before);
    else if (objs && d.kind === 'obj') ed.moveObjects(objs, d.ref, d.front, homeLayer(d.ref));
    else if (objs && d.kind === 'layer') {
      // Auf einen Layer: dorthin verschieben, vor alle Objekte dieses Layers
      const sec = sections().find((s) => s.layer === d.layer);
      const ref = sec?.objs.find((o) => !objs.includes(o)) ?? null;
      ed.moveObjects(objs, ref, true, d.layer);
    }
  });

  body.addEventListener('dragend', () => {
    unmark();
    body.querySelector('.dragging')?.classList.remove('dragging');
    dragObjs = null;
    dragLayer = null;
    dragPage = null;
    drop = null;
  });

  render();
  onWindowShow('objects', render);
}
