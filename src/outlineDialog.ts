import type { Editor } from './editor';
import type { OutlinePreview } from './editor/outline';
import { h } from './dom';
import { t } from './i18n';
import { homeLayer, layerLabel, PALETTE } from './model';
import { outlineHoleAt, outlineResult, type OutlineMode } from './outline';
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
    const keep = h('input', { type: 'checkbox', checked: true, id: 'outline-keep',title:t('Erhaltene Originale können doppelt geschnitten werden.') });
    const keepHint=h('p',{class:'note'},t('Erhaltene Originale können doppelt geschnitten werden.'));
    keep.addEventListener('change',()=>{keepHint.hidden=!keep.checked;});
    const layer = h('select', { id: 'outline-layer' }, ...PALETTE.map((_color, i) =>
      h('option', { value: String(i), selected: i === homeLayer(session.sources[0]) },
        `${layerLabel(i)} — ${ed.doc.layers[i]?.name ?? layerLabel(i)}`)));
    const tolerance = h('input', { id: 'outline-tolerance', type: 'number', min: 0, max: 0.5, step: 0.01, value: String(OUTLINE_JOIN_TOL),title:t('Verbindet nahe Enden. Eine Änderung setzt die Inselauswahl zurück.') });
    const mode = h('select', { id: 'outline-mode' },
      h('option', { value: 'outer' }, t('Nur Außenkontur')),
      h('option', { value: 'combined' }, t('Außenkontur + Inseln')),
      h('option', { value: 'islands' }, t('Nur Inseln')));
    const approximations=()=>new Set(mode.value==='outer'?[]:[...selected].filter(i=>session.plan.islandErrors?.[i]));
    const selectable=(i:number)=>!session.plan.islandErrors?.[i]||!!session.plan.approximationEligible?.[i];
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const apply = h('button', { class: 'btn primary' }, t('Anwenden'));
    const choices = h('div', { class: 'outline-choices' });
    const boxes: HTMLInputElement[] = [];
    const rows: HTMLLabelElement[] = [];
    let activeIsland=-1;
    const highlightIsland=(index:number,scroll=false)=>{
      activeIsland=index;
      rows.forEach((row,i)=>{
        row.classList.toggle('outline-choice-active',i===activeIsland);
        if(i===activeIsland)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
      });
      if(scroll)rows[index]?.scrollIntoView({block:'nearest',inline:'nearest'});
    };
    const toggleIsland=(i:number)=>{
      highlightIsland(i,true);
      if(!planValid||mode.value==='outer')return;
      if(!selectable(i)){
        info.textContent=t('Diese Insel hat keine sichere geschlossene Näherung und bleibt gesperrt.');return;
      }
      if(selected.has(i))selected.delete(i);else selected.add(i);
      refresh();
    };
    let valid = true, planValid = true, applying = false, disposed = false;
    const title = h('h3', {}, t('Außenkontur und Inseln'));
    const dlg = h('dialog', { class: 'outline-dialog outline-tool-window', 'aria-labelledby': 'outline-title' });
    title.id = 'outline-title';
    const preview: OutlinePreview = {
      subs: [], holes: [], hover: -1,
      pick: p => {
        if (!planValid || mode.value === 'outer') return;
        const i = outlineHoleAt(session.plan, p.x, p.y);
        if (i < 0) return;
        toggleIsland(i);
      },
      move: p => {
        const hover = valid && mode.value !== 'outer' ? outlineHoleAt(session.plan, p.x, p.y) : -1;
        if (preview.hover !== hover) { preview.hover = hover; ed.redraw(); }
      },
      cancel: () => dlg.close(),
    };
    const refresh = () => {
      valid = planValid;
      boxes.forEach((box, i) => { box.checked = selected.has(i); box.disabled = !planValid || mode.value === 'outer' || !selectable(i); });
      try { preview.subs = valid ? outlineResult(session.plan, selected, mode.value as OutlineMode,approximations()) : []; }
      catch { valid = false; preview.subs = []; info.textContent = t('Grenze nicht ableitbar. Auswahl oder Toleranz prüfen.'); }
      preview.removed = valid ? session.plan.connections : [];
      preview.excluded=[...approximations()].flatMap(i=>session.plan.holes[i].subs);
      preview.holes = valid && mode.value !== 'outer' ? session.plan.holes.map(hole => hole.subs) : [];
      apply.disabled = !valid || !preview.subs.length;
      if (valid) info.textContent = [
        t('{outer} Außenkonturen · {chosen}/{total} Inseln', { outer:session.plan.outer.length,chosen: mode.value === 'outer' ? 0 : selected.size, total: session.plan.holes.length }),
        mode.value === 'islands' && !selected.size ? t('Inseln auswählen.') :
          !preview.subs.length ? t('Keine geschlossene Fläche erkannt. Verbindungstoleranz prüfen.') : '',
        session.plan.connections?.length ? t('{n} Toleranzverbindungen (orange).', { n: session.plan.connections.length }) : '',
        session.plan.islandErrors?.some((bad,i)=>bad&&!session.plan.approximationEligible?.[i]) ? t('{n} gesperrt.', { n: session.plan.islandErrors.filter((bad,i)=>bad&&!session.plan.approximationEligible?.[i]).length }) : '',
        approximations().size ? t('{n} angenähert (rot).',{n:approximations().size}) : '',
        session.plan.network?.ambiguousJoins?.length ? t('{n} Verbindungsstellen unklar.', { n: session.plan.network.ambiguousJoins.length }) : '',
        session.plan.looseEnds ? t('{n} freie Enden.', { n: session.plan.looseEnds }) : '',
      ].filter(Boolean).join(' ');
      ed.redraw();
    };
    const rebuildChoices = () => {
      choices.replaceChildren(); boxes.length = 0;rows.length=0;
      session.plan.holes.forEach((_hole, i) => {
        const box = h('input', { type: 'checkbox', onchange: () => {
          toggleIsland(i);
        } });
        boxes.push(box);
        const row=h('label', { class: 'check', 'data-island-index':String(i),onclick:()=>highlightIsland(i) }, box, t('Insel {n}', { n: i + 1 }),
          session.plan.islandErrors?.[i] ? ` · ${session.plan.approximationEligible?.[i]?t('Näherung'):t('Gesperrt')}` : '');
        rows.push(row);choices.append(row);
      });
    };
    let toleranceTimer:ReturnType<typeof setTimeout>|undefined;
    tolerance.addEventListener('input', () => {
      clearTimeout(toleranceTimer);
      selected.clear();highlightIsland(-1); preview.hover = -1;
      const value = tolerance.valueAsNumber;
      planValid = valid = false;
      const numericValid=Number.isFinite(value)&&value>=0&&value<=.5;
      info.textContent=numericValid?t('Inseln werden neu berechnet …'):t('Verbindungstoleranz muss zwischen 0 und 0,5 mm liegen.');
      refresh();
      if(!numericValid)return;
      toleranceTimer=setTimeout(()=>{
        if(disposed)return;
        try{ed.updateOutline(session,value);planValid=true;rebuildChoices();}
        catch(error){planValid=false;info.textContent=error instanceof Error?error.message:String(error);}
        refresh();
      },120);
    });
    mode.addEventListener('change', () => { preview.hover = -1; refresh(); });
    dlg.append(title,
      h('p', { class: 'note' }, t('Inseln auf der Arbeitsfläche oder in der Liste wählen.')),
      h('div', { class: 'form' },
        h('label', { for: mode.id }, t('Ausgabemodus')), mode,
        h('label', { for: tolerance.id }, t('Verbindungstoleranz (mm)')), tolerance,
        h('label', { for: layer.id }, t('Zielebene')), layer,
        h('label', { for: keep.id }, t('Originale behalten')), keep),
      info,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn',title:t('Alle exakt ableitbaren Inseln wählen.'), onclick: () => { if (planValid && mode.value !== 'outer') { session.plan.holes.forEach((_h, i) => { if (!session.plan.islandErrors?.[i]) selected.add(i); }); refresh(); } } }, t('Alle exakten')),
        h('button', { class: 'btn', onclick: () => { selected.clear(); refresh(); } }, t('Keine'))),
      choices,
      keepHint,
      ...(session.noLaser ? [h('p', { class: 'note' }, t('Ergebnis: Nicht lasern (Quelle deaktiviert).'))] : []),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), apply));
    apply.addEventListener('click', () => {
      try {
        if (apply.disabled) return;
        const approximateIslands=approximations();
        if (!keep.checked && !confirm(t('Ausgewählte Originale durch den neuen Pfad ersetzen? Parametrische Bearbeitbarkeit der ersetzten Objekte geht verloren. Rückgängig stellt die Originale wieder her.'))) return;
        applying = true;
        ed.applyOutline(session, selected, Number(layer.value), keep.checked, !keep.checked, mode.value as OutlineMode,{islands:approximateIslands});
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
      clearTimeout(toleranceTimer);
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
