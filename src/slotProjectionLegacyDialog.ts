import type { Editor } from './editor';
import { h } from './dom';
import { Obj, Pt, SubPath } from './model';
import { shapeSubs, subsToPath2D } from './geom';
import { PlacedSlot, SlotRecipe, isSlotGenerator, projectionFrame } from './slotPlacement';
import { readSlotRecipe } from './slotPlacement';
import { SlotOrigin, SlotProjection, StraightEdge, SlotVertex, dot, sub } from './straightSlots';
import { createSlotPreviewClient } from './slotPreviewClient';
import { applySlotRecipe, openLegacySlotPlacementDialog } from './slotLegacyDialog';
import { movableToolWindow } from './toolWindow';
import { t } from './i18n';
export { applySlotRecipe } from './slotLegacyDialog';

// UI owns only a staged recipe. Geometry calculation is performed by a disposable worker.
export function openProjectionLegacyDialog(ed: Editor, target?: Obj): void {
  if (document.querySelector('dialog[open]')) return;
  const obj = target ?? (ed.sel.length === 1 ? ed.sel[0] : undefined);
  if (!obj || !ed.doc.objs.includes(obj) || !ed.selectable(obj) || ed.drag || ed.draft || ed.sketchEdit || ed.pickHandler || ed.tool === 'builder' || ['group', 'text', 'image'].includes(obj.shape.kind) || (obj.shape.kind === 'gen' && obj.shape.asm)) {
    ed.hint = t('Eine einzelne geschlossene, sichtbare und entsperrte Vektorform auswählen.'); ed.emit('tool'); return;
  }
  try {
    const recipe: SlotRecipe = obj.shape.kind === 'gen' && isSlotGenerator(obj.shape.gen)
      ? structuredClone(readSlotRecipe(obj.shape.params))
      : { source: structuredClone(obj.shape), base: structuredClone(shapeSubs(obj.shape)), slots: [] };
    const nextId = () => { let n = 1; while (recipe.slots.some(s => s.id === `slot-${n}`)) n++; return `slot-${n}`; };
    recipe.slots.forEach(s => { s.id ??= nextId(); });
    const doc = ed.doc, stamp = ed.state(), tool = ed.tool, isolation = ed.isolation;
    const client = createSlotPreviewClient();
    let closed = false, stale = false, pending = true, valid = false, active = -1;
    let pick: 'origin' | 'edge' | null = null, origin: SlotOrigin | null = null, edgeKey = '';
    let edges: StraightEdge[] = [], vertices: SlotVertex[] = [], resolved: PlacedSlot[] = [], preview: SubPath[] = [];
    let drawing = 0, scale = 1, ox = 0, oy = 0, geometryRecipe: SlotRecipe = recipe;
    const canvas = h('canvas', { class: 'slot-tool-canvas', 'aria-label': t('Teilvorschau: Referenzpunkt und Projektionskante hier wählen.') });
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const list = h('select', { id: 'slot-list', 'aria-label': t('Ausschnitt auswählen') });
    const originList = h('select', { id: 'slot-origin' }), edgeList = h('select', { id: 'slot-projection-edge' });
    const targetList = h('select', { id: 'slot-target' }, ...(['start', 'center', 'end'] as const).map((value, i) => h('option', { value, selected: value === 'center' }, [t('Erste Außenkante'), t('Mitte'), t('Zweite Außenkante')][i])));
    const direction = h('select', { id: 'slot-direction' }, h('option', { value: '1' }, t('In Kantenrichtung')), h('option', { value: '-1' }, t('Gegen Kantenrichtung')));
    const fields = new Map<string, HTMLInputElement>();
    const form = h('div', { class: 'form' });
    const field = (key: string, label: string, value: number, min?: number, max?: number) => {
      const input = h('input', { type: 'number', value: String(value), step: key === 'corner' ? '1' : '0.1', id: `slot-${key}`, min, max });
      fields.set(key, input); form.append(h('label', { for: input.id }, label), input); return input;
    };
    field('width', t('Nennbreite / Materialdicke (mm)'), 3.7, 0.05);
    field('depth', t('Eindringtiefe (mm)'), 10, 0.05);
    field('clearance', t('Spiel gesamt (mm)'), 0);
    field('factor', t('Breitenfaktor'), 1, 0.001);
    field('distance', t('Abstand parallel zur Projektionskante (mm)'), 10, 0);
    field('corner', t('Mindest-Richtungswechsel für Ecken (°)'), 20, 1, 179);
    const number = (key: string) => fields.get(key)!.valueAsNumber;
    const destructive = h('input', { type: 'checkbox', id: 'slot-bake' });
    const stage = h('button', { class: 'btn', id: 'slot-stage' }, t('Ausklinkung vormerken'));
    const apply = h('button', { class: 'btn primary' }, t('Übernehmen'));
    const remove = h('button', { class: 'btn' }, t('Gewählten Ausschnitt entfernen'));
    const title = h('header', { class: 'slot-tool-title' }, h('h3', {}, t('Parametrische Schlitze / Ausklinkungen')),
      h('button', { class: 'btn', onclick: () => { dlg.style.width = ''; dlg.style.height = ''; dlg.style.left = '8px'; dlg.style.top = '8px'; scheduleDraw(); } }, t('Fenster zurücksetzen')));
    const origins: { value: string; label: string; origin: SlotOrigin; point: Pt }[] = [];
    const candidate = (): PlacedSlot | null => {
      if (!origin || !edgeKey) return null;
      const projection: SlotProjection = { edge: edgeKey, origin: structuredClone(origin), target: targetList.value as SlotProjection['target'],
        distance: number('distance'), direction: Number(direction.value) as 1 | -1, cornerAngle: number('corner') };
      return { id: active >= 0 ? recipe.slots[active].id : nextId(), x: 0, y: 0, angle: 0,
        width: number('width'), depth: number('depth'), clearance: number('clearance'), factor: number('factor'), projection };
    };
    const trial = (): SlotRecipe => {
      const c = candidate();
      return { ...recipe, slots: c ? active < 0 ? [...recipe.slots, c] : recipe.slots.map((s, i) => i === active ? c : s) : [...recipe.slots] };
    };
    const refreshList = () => {
      list.replaceChildren(h('option', { value: '-1' }, t('Neue Ausklinkung')), ...recipe.slots.map((s, i) => h('option', { value: String(i) }, t('Ausschnitt {n}', { n: i + 1 }) + (s.projection ? '' : ` — ${t('Bisheriges Rezept')}`))));
      list.value = String(active); remove.disabled = active < 0;
    };
    const refreshReferences = () => {
      origins.length = 0;
      vertices.forEach((v, i) => origins.push({ value: `v:${v.key}`, label: t('Ecke {n}', { n: i + 1 }) + (v.transition ? ` (${t('Gerade/Rundung')})` : ''), origin: { kind: 'vertex', sub: v.sub, node: v.node }, point: v.point }));
      resolved.forEach(s => {
        if (!s.projection || !recipe.slots.some(old => old.id === s.id) || s.id === recipe.slots[active]?.id) return;
        const f = projectionFrame(recipe.base, s);
        const options = [{ key: 'start', point: f.a, label: t('Erste Öffnungsecke') }, { key: 'end', point: f.b, label: t('Zweite Öffnungsecke') },
          { key: 'bottomStart', point: f.bottomStart, label: t('Erste Bodenecke') }, { key: 'bottomEnd', point: f.bottomEnd, label: t('Zweite Bodenecke') }];
        options.forEach(p => origins.push({ value: `s:${s.id}:${p.key}`, label: t('Ausschnitt {n}', { n: recipe.slots.findIndex(old => old.id === s.id) + 1 }) + ` — ${p.label}`,
          origin: { kind: 'slot', slotId: s.id!, point: p.key as 'start' }, point: p.point }));
      });
      originList.replaceChildren(h('option', { value: '' }, t('Referenzpunkt wählen')), ...origins.map(o => h('option', { value: o.value }, o.label)));
      originList.value = origins.find(o => JSON.stringify(o.origin) === JSON.stringify(origin))?.value ?? '';
      edgeList.replaceChildren(h('option', { value: '' }, t('Projektionskante wählen')), ...edges.map((e, i) => h('option', { value: e.key }, t('Gerade {n}', { n: i + 1 }) + ` — ${e.length.toFixed(2)} mm`)));
      edgeList.value = edgeKey;
    };
    const request = () => {
      if (closed || stale) return;
      canvas.setAttribute('aria-busy', 'true');
      pending = true; valid = false; apply.disabled = stage.disabled = true; info.textContent = t('Vorschau wird berechnet …');
      const proposed = trial();
      client.request(proposed, number('corner'), reply => {
        if (closed || stale) return;
        canvas.setAttribute('aria-busy', 'false');
        pending = false;
        if (reply.result) { edges = reply.result.edges; vertices = reply.result.vertices; resolved = reply.result.slots; refreshReferences(); }
        if (reply.error || !reply.result) { valid = false; preview = []; info.textContent = reply.error ?? t('Vorschau fehlgeschlagen.'); stage.disabled = apply.disabled = true; scheduleDraw(); return; }
        valid = true; edges = reply.result.edges; vertices = reply.result.vertices; resolved = reply.result.slots; preview = reply.result.subs; geometryRecipe = proposed;
        refreshReferences(); stage.disabled = !candidate(); apply.disabled = !proposed.slots.length;
        info.textContent = t('Rot: Referenzpunkt. Orange: Projektionskante. Gelb: Positionsmaß. Nur gerade Abschnitte, kein Maß über Ecken.'); scheduleDraw();
      });
    };
    const draw = () => {
      const r = canvas.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
      const dpr = devicePixelRatio || 1; canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      const points = recipe.base.flatMap(s => s.nodes), xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x0), hh = Math.max(1, Math.max(...ys) - y0);
      scale = Math.min(Math.max(1, r.width - 50) / w, Math.max(1, r.height - 50) / hh);
      ox = (r.width - w * scale) / 2 - x0 * scale; oy = (r.height - hh * scale) / 2 - y0 * scale;
      const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#20252c'; ctx.fillRect(0, 0, r.width, r.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      ctx.lineWidth = 1.5 / scale; ctx.fillStyle = '#405c7c'; ctx.strokeStyle = '#9ecbff';
      const result = subsToPath2D(preview.length ? preview : recipe.base); ctx.fill(result, 'evenodd'); ctx.stroke(result);
      ctx.strokeStyle = '#626b79'; ctx.setLineDash([3 / scale, 3 / scale]); ctx.stroke(subsToPath2D(recipe.base)); ctx.setLineDash([]);
      const edge = edges.find(e => e.key === edgeKey);
      if (edge) { ctx.strokeStyle = '#ff982d'; ctx.lineWidth = 4 / scale; ctx.beginPath(); ctx.moveTo(edge.a.x, edge.a.y); ctx.lineTo(edge.b.x, edge.b.y); ctx.stroke(); }
      ctx.lineWidth = 1.5 / scale;
      for (const item of origins) { ctx.strokeStyle = '#84909d'; ctx.beginPath(); ctx.arc(item.point.x, item.point.y, 3 / scale, 0, Math.PI * 2); ctx.stroke(); }
      let selectedOrigin = origins.find(o => JSON.stringify(o.origin) === JSON.stringify(origin))?.point;
      const current = candidate(), selected = current ? resolved.find(s => s.id === current.id) : active >= 0 ? resolved.find(s => s.id === recipe.slots[active].id) : null;
      if (valid && !pending && selected?.projection) {
        const frame = projectionFrame(geometryRecipe.base, selected); selectedOrigin = frame.origin;
        ctx.strokeStyle = '#ffe277'; ctx.setLineDash([4 / scale, 3 / scale]); ctx.beginPath(); ctx.moveTo(frame.origin.x, frame.origin.y); ctx.lineTo(frame.zero.x, frame.zero.y); ctx.lineTo(frame.target.x, frame.target.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffe277'; ctx.font = `${12 / scale}px sans-serif`; ctx.fillText(`${selected.projection.distance.toFixed(2)} mm`, (frame.zero.x + frame.target.x) / 2, (frame.zero.y + frame.target.y) / 2 - 8 / scale);
        ctx.strokeStyle = '#ffe277'; ctx.beginPath(); ctx.arc(frame.target.x, frame.target.y, 5 / scale, 0, Math.PI * 2); ctx.stroke();
      }
      if (selectedOrigin) { ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2.5 / scale; ctx.beginPath(); ctx.arc(selectedOrigin.x, selectedOrigin.y, 7 / scale, 0, Math.PI * 2); ctx.stroke(); }
    };
    function scheduleDraw() { if (!closed && !drawing) drawing = requestAnimationFrame(() => { drawing = 0; draw(); }); }
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || stale || pending) return;
      const r = canvas.getBoundingClientRect(), p = { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }, tolerance = 12 / scale;
      if (pick === 'origin') {
        const candidates = origins.map(o => ({ o, d: Math.hypot(o.point.x - p.x, o.point.y - p.y) })).sort((a, b) => a.d - b.d);
        if (!candidates.length || candidates[0].d > tolerance) return;
        origin = structuredClone(candidates[0].o.origin); pick = null;
      } else if (pick === 'edge') {
        const candidates = edges.map(edge => { const at = Math.max(0, Math.min(edge.length, dot(sub(p, edge.a), edge.tangent))); return { edge, d: Math.hypot(p.x - edge.a.x - edge.tangent.x * at, p.y - edge.a.y - edge.tangent.y * at) }; }).sort((a, b) => a.d - b.d);
        if (!candidates.length || candidates[0].d > tolerance) return;
        edgeKey = candidates[0].edge.key; pick = null;
      } else return;
      request(); scheduleDraw();
    });
    originList.addEventListener('change', () => { origin = structuredClone(origins.find(o => o.value === originList.value)?.origin ?? null); request(); });
    edgeList.addEventListener('change', () => { edgeKey = edgeList.value; request(); });
    for (const input of [...fields.values(), targetList, direction]) input.addEventListener('input', request);
    list.addEventListener('change', () => {
      active = Number(list.value); pick = null;
      const s = recipe.slots[active]; origin = s?.projection ? structuredClone(s.projection.origin) : null; edgeKey = s?.projection?.edge ?? '';
      if (s) for (const key of ['width', 'depth', 'clearance', 'factor'] as const) fields.get(key)!.value = String(s[key]);
      if (s?.projection) { fields.get('distance')!.value = String(s.projection.distance); fields.get('corner')!.value = String(s.projection.cornerAngle); direction.value = String(s.projection.direction); targetList.value = s.projection.target; }
      if (s && !s.projection) info.textContent = t('Bisheriger Ausschnitt bleibt unverändert. Für das neue Positionsmodell Referenz und Gerade wählen.');
      refreshList(); request();
    });
    stage.addEventListener('click', () => {
      if (pending || !valid || stale) return;
      const c = candidate(); if (!c) return;
      if (active < 0) recipe.slots.push(c); else recipe.slots[active] = c;
      active = recipe.slots.findIndex(s => s.id === c.id); refreshList(); request();
    });
    remove.addEventListener('click', () => {
      const id = recipe.slots[active]?.id; if (!id || stale) return;
      if (recipe.slots.some(s => (s.projection?.origin.kind === 'slot' && s.projection.origin.slotId === id) || s.anchor?.relative?.slotId === id)) { info.textContent = t('Referenzierter Schnitt fehlt. Bezug vor dem Löschen ändern.'); return; }
      recipe.slots.splice(active, 1); active = -1; origin = null; edgeKey = ''; refreshList(); request();
    });
    const dlg = h('dialog', { class: 'slot-projection-dialog', id: 'slot-projection-dialog' }, title,
      h('div', { class: 'slot-tool-body' }, h('section', { class: 'slot-tool-preview' }, canvas,
        h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => { pick = 'origin'; info.textContent = t('In der Vorschau eine markierte Referenzecke anklicken.'); } }, t('Referenzpunkt wählen')),
          h('button', { class: 'btn', onclick: () => { pick = 'edge'; info.textContent = t('In der Vorschau eine gerade Projektionskante anklicken.'); } }, t('Projektionskante wählen')))),
        h('section', { class: 'slot-tool-settings' }, list, form,
          h('div', { class: 'form' }, h('label', { for: originList.id }, t('Referenzpunkt (Nullpunkt)')), originList, h('label', { for: edgeList.id }, t('Projektionskante')), edgeList,
            h('label', { for: targetList.id }, t('Maß bis zur eigenen …')), targetList, h('label', { for: direction.id }, t('Richtung entlang der Geraden')), direction), stage, remove,
          h('label', { class: 'check' }, destructive, t('Destruktiv festschreiben (Parameter entfernen)')),
          h('p', { class: 'note' }, t('Gerade/Rundung-Übergänge sind Referenzpunkte. Platzierung nur auf echten Geraden. Auf Geraden sind beide Tiefenreferenzen identisch. Layer-Kerf bleibt zusätzlich wirksam.')))),
      info, h('footer', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), apply));
    if (recipe.slots.length && !recipe.slots.some(s => s.projection)) {
      const legacy = h('button', { class: 'btn', onclick: () => { dlg.addEventListener('close', () => openLegacySlotPlacementDialog(ed, obj), { once: true }); dlg.close(); } }, t('Bisheriges Rezept bearbeiten'));
      title.append(legacy);
    }
    const changed = () => { if (ed.doc !== doc || ed.state() !== stamp || ed.tool !== tool || ed.isolation !== isolation) { stale = true; apply.disabled = stage.disabled = true; info.textContent = t('Quelle geändert. Schlitzwerkzeug erneut öffnen.'); client.dispose(); } };
    ed.on(changed);
    apply.addEventListener('click', () => {
      if (pending || !valid || stale) return;
      if (destructive.checked && !confirm(t('Ausschnitte als Pfad festschreiben? Die gespeicherte Originalform und Schlitzparameter werden entfernt.'))) return;
      try { applySlotRecipe(ed, obj, geometryRecipe, stamp, destructive.checked); dlg.close(); }
      catch (e) { info.textContent = e instanceof Error ? e.message : String(e); }
    });
    let disposeWindow = () => {};
    dlg.addEventListener('close', () => { closed = true; client.dispose(); ed.off(changed); disposeWindow(); if (drawing) cancelAnimationFrame(drawing); dlg.remove(); });
    dlg.addEventListener('keydown', e => e.stopPropagation());
    document.body.append(dlg); dlg.showModal(); disposeWindow = movableToolWindow(dlg, title, scheduleDraw); refreshList(); request();
  } catch (e) { ed.hint = e instanceof Error ? e.message : String(e); ed.emit('tool'); }
}
