import type { Editor } from './editor';
import type { OutlinePreview } from './editor/outline';
import { h } from './dom';
import { t } from './i18n';
import { homeLayer, layerLabel, PALETTE } from './model';
import { outlineHoleAt, outlineResult } from './outline';
import { OUTLINE_JOIN_TOL } from './outlineNetwork';
import { movableToolWindow } from './toolWindow';

const open = new WeakSet<Editor>();

export async function openOutlineDialog(ed: Editor): Promise<void> {
  if (open.has(ed) || ed.outlinePreview || document.querySelector('dialog[open]')) return;
  open.add(ed);
  let attached = false;
  try {
    const session = await ed.prepareOutline(OUTLINE_JOIN_TOL, true);
    if (document.querySelector('dialog[open]')) return;
    const selected = new Set<number>();
    const keep = h('input', { type: 'checkbox', checked: true, id: 'outline-keep' });
    const layer = h('select', { id: 'outline-layer' }, ...PALETTE.map((_color, i) =>
      h('option', { value: String(i), selected: i === homeLayer(session.sources[0]) },
        `${layerLabel(i)} — ${ed.doc.layers[i]?.name ?? layerLabel(i)}`)));
    const tolerance = h('input', { id: 'outline-tolerance', type: 'number', min: 0, max: 0.5, step: 0.01, value: String(OUTLINE_JOIN_TOL) });
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const apply = h('button', { class: 'btn primary' }, t('Anwenden'));
    const choices = h('div', { class: 'outline-choices' });
    const boxes: HTMLInputElement[] = [];
    let valid = true, applying = false, disposed = false;
    const title = h('h3', {}, t('Außenkontur mit gewählten Löchern'));
    const dlg = h('dialog', { class: 'outline-dialog outline-tool-window', 'aria-labelledby': 'outline-title' });
    title.id = 'outline-title';
    const preview: OutlinePreview = {
      subs: [], holes: [], hover: -1,
      pick: p => {
        if (!valid) return;
        const i = outlineHoleAt(session.plan, p.x, p.y);
        if (i < 0) return;
        if (selected.has(i)) selected.delete(i); else selected.add(i);
        refresh();
      },
      move: p => {
        const hover = valid ? outlineHoleAt(session.plan, p.x, p.y) : -1;
        if (preview.hover !== hover) { preview.hover = hover; ed.redraw(); }
      },
      cancel: () => dlg.close(),
    };
    const refresh = () => {
      boxes.forEach((box, i) => { box.checked = selected.has(i); });
      preview.subs = valid ? outlineResult(session.plan, selected) : [];
      preview.holes = valid ? session.plan.holes.map(hole => hole.subs) : [];
      apply.disabled = !valid || !preview.subs.length;
      if (valid) info.textContent = [
        t('{n} Außenkonturen erkannt.', { n: session.plan.outer.length }),
        preview.subs.length ? t('{chosen} von {total} Innenflächen als Löcher gewählt.', { chosen: selected.size, total: session.plan.holes.length })
          : t('Keine geschlossene Fläche erkannt. Verbindungstoleranz prüfen.'),
        session.plan.looseEnds ? t('{n} freie Linienenden verbleiben. Vorschau sorgfältig prüfen.', { n: session.plan.looseEnds }) : '',
      ].filter(Boolean).join(' ');
      ed.redraw();
    };
    const rebuildChoices = () => {
      choices.replaceChildren(); boxes.length = 0;
      session.plan.holes.forEach((_hole, i) => {
        const box = h('input', { type: 'checkbox', onchange: () => {
          if (!valid) return;
          if (box.checked) selected.add(i); else selected.delete(i);
          refresh();
        } });
        boxes.push(box);
        choices.append(h('label', { class: 'check' }, box, t('Innenfläche {n}', { n: i + 1 })));
      });
    };
    tolerance.addEventListener('input', () => {
      selected.clear(); preview.hover = -1;
      const value = tolerance.valueAsNumber;
      valid = Number.isFinite(value) && value >= 0 && value <= 0.5;
      try {
        if (!valid) throw new Error(t('Verbindungstoleranz muss zwischen 0 und 0,5 mm liegen.'));
        ed.updateOutline(session, value); rebuildChoices();
      } catch (error) {
        valid = false; info.textContent = error instanceof Error ? error.message : String(error);
      }
      refresh();
    });
    dlg.append(title,
      h('p', { class: 'note' }, t('Gestricheltes Türkis zeigt die neue Kontur auf der Arbeitsfläche. Innenflächen anklicken: Loch hinzufügen oder wieder entfernen.')),
      h('div', { class: 'form' },
        h('label', { for: tolerance.id }, t('Verbindungstoleranz (mm)')), tolerance,
        h('label', { for: layer.id }, t('Zielebene')), layer,
        h('label', { for: keep.id }, t('Originale behalten')), keep),
      h('p', { class: 'note' }, t('Nur für die Vorschau und den neuen Pfad: offene Enden innerhalb der Toleranz verbinden. Größere Lücken bleiben offen. Eine Änderung der Toleranz setzt die Lochauswahl zurück.')),
      info,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => { if (valid) { session.plan.holes.forEach((_h, i) => selected.add(i)); refresh(); } } }, t('Alle Innenflächen wählen')),
        h('button', { class: 'btn', onclick: () => { selected.clear(); refresh(); } }, t('Keine Innenflächen wählen'))),
      choices,
      h('p', { class: 'note' }, t('Erst Anwenden erstellt einen unabhängigen Pfad. Originale bleiben bis dahin unverändert. Doppelte Ausgabe von Gravurvorlage und Schnittkontur vermeiden.')),
      ...(session.noLaser ? [h('p', { class: 'note' }, t('Mindestens eine Quelle ist von der Ausgabe ausgenommen. Das Ergebnis wird auf „Nicht lasern“ gesetzt.'))] : []),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), apply));
    apply.addEventListener('click', () => {
      try {
        if (apply.disabled) return;
        if (!keep.checked && !confirm(t('Ausgewählte Originale durch den neuen Pfad ersetzen? Parametrische Bearbeitbarkeit der ersetzten Objekte geht verloren. Rückgängig stellt die Originale wieder her.'))) return;
        applying = true;
        ed.applyOutline(session, selected, Number(layer.value), keep.checked, !keep.checked);
        dlg.close();
      } catch (error) { applying = false; info.textContent = error instanceof Error ? error.message : String(error); }
    });
    const changed = (what: string) => {
      if (!applying && (what === 'doc' || what === 'sel' || what === 'tool')) {
        dlg.close();
        ed.hint = t('Auswahl oder Quelle geändert. Außenkontur erneut öffnen.');
      }
    };
    let disposeWindow = () => {};
    const leave = () => { preview.hover = -1; ed.redraw(); };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; ed.off(changed); disposeWindow();
      ed.canvas.removeEventListener('pointerleave', leave);
      if (ed.outlinePreview === preview) ed.outlinePreview = null;
      ed.canvas.style.cursor = ed.tool === 'select' ? 'default' : 'crosshair';
      open.delete(ed); dlg.remove(); ed.redraw();
    };
    dlg.addEventListener('close', cleanup);
    dlg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); dlg.close(); }
    });
    document.body.append(dlg); dlg.show(); attached = true;
    ed.outlinePreview = preview; ed.on(changed);
    ed.canvas.addEventListener('pointerleave', leave);
    disposeWindow = movableToolWindow(dlg, title, () => {});
    rebuildChoices(); refresh();
  } catch (error) {
    ed.hint = error instanceof Error ? error.message : String(error); ed.emit('tool');
  } finally { if (!attached) open.delete(ed); }
}
