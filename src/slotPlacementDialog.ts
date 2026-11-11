import type { Editor } from './editor';
import { h } from './dom';
import { Obj, Pt } from './model';
import { shapeSubs, subsToPath2D } from './geom';
import { PlacedSlot, SlotRecipe, SlotGroup, adoptSlotFeatureRecipe, projectionFrame, readSlotRecipe, isSlotGenerator } from './slotPlacement';
import { SlotOrigin, SlotReference, curveCorner, dot, sub } from './straightSlots';
import type { ResolvedConstructionLine } from './slotConstruction';
import { createSlotPreviewClient, SlotPreviewResult } from './slotPreviewClient';
import { SlotViewport } from './slotViewport';
import { createSlotFeatureTree, SlotTreeSelection } from './slotFeatureTree';
import { applySlotRecipe } from './slotLegacyDialog';
import { openProjectionLegacyDialog } from './slotProjectionLegacyDialog';
import { movableToolWindow } from './toolWindow';
import { t } from './i18n';
import { SLOT_TOOL_ICONS } from './slotToolIcons';
import { canvasWheelFactor, installPinchGestures, pinchGestureActive } from './canvasZoom';
export { applySlotRecipe } from './slotLegacyDialog';

const originKey = (r: SlotOrigin): string => r.kind === 'vertex' ? `v:${r.sub}:${r.node}` : r.kind === 'curveCorner' ? `c:${r.sub}:${r.node}` : r.kind === 'slot' ? `s:${r.slotId}:${r.point}` : `i:${r.helperId}:${r.sub}:${r.segment}:${r.root}:${r.count}`;
type Pick = 'origin' | 'edge' | 'first' | 'second' | 'helperEdge' | 'mirrorAxis' | 'pan' | null;
interface PointChoice { ref: SlotOrigin; point: Pt; label: string; transition?: boolean }
interface HelperDraft { id: string; name: string; first: SlotOrigin | null; second: SlotOrigin | null; edge: string }

function defaultGroup(id: string): SlotGroup {
  return { id, name: t('Gruppe {n}', { n: 1 }), width: 3.7, depth: 10, clearance: 0, factor: 1, burn: 0, cornerStyle: 'corner' };
}

/** Construction features and view navigation never touch the source document before Apply. */
export function openSlotPlacementDialog(ed: Editor, target?: Obj): void {
  if (document.querySelector('dialog[open]')) return;
  const obj = target ?? (ed.sel.length === 1 ? ed.sel[0] : undefined);
  if (!obj || !ed.doc.objs.includes(obj) || !ed.selectable(obj) || ed.drag || ed.draft || ed.sketchEdit || ed.pickHandler || ed.tool === 'builder' || ['group', 'image', 'text'].includes(obj.shape.kind) || (obj.shape.kind === 'gen' && obj.shape.asm)) {
    ed.hint = t('Eine einzelne geschlossene, sichtbare und entsperrte Vektorform auswählen.'); ed.emit('tool'); return;
  }
  try {
    const editingRecipe = obj.shape.kind === 'gen' && isSlotGenerator(obj.shape.gen);
    const original: SlotRecipe = obj.shape.kind === 'gen' && isSlotGenerator(obj.shape.gen)
      ? structuredClone(readSlotRecipe(obj.shape.params)) : { source: structuredClone(obj.shape), base: structuredClone(shapeSubs(obj.shape)), slots: [] };
    const angles = [...new Set(original.slots.flatMap(s => s.projection ? [s.projection.cornerAngle] : []))];
    if (!original.settings && angles.length > 1 && !confirm(t('Das alte Rezept verwendet unterschiedliche Eckenwinkel. Für das neue Werkzeug ausdrücklich auf 20° vereinheitlichen? Abbrechen lässt das Projekt unverändert.'))) return;
    let recipe = adoptSlotFeatureRecipe(original, original.settings?.cornerAngle ?? (angles.length === 1 ? angles[0] : 20));
    const drafts = new Map<string, PlacedSlot>(), helperDrafts = new Map<string, HelperDraft>();
    const hidden = new Set<string>();
    const nextId = (prefix: string) => { let n = 1; const used = [...recipe.slots, ...(recipe.groups ?? []), ...(recipe.helpers ?? []), ...drafts.values(), ...helperDrafts.values()]; while (used.some(f => f.id === `${prefix}-${n}`)) n++; return `${prefix}-${n}`; };
    if (!recipe.groups?.length) recipe.groups = [defaultGroup(nextId('group'))];
    recipe.helpers ??= []; recipe.order ??= [];
    let lastValid = structuredClone(recipe), lastDrafts = structuredClone(drafts), lastHelperDrafts = structuredClone(helperDrafts), lastResetToSource = false, selected: SlotTreeSelection = { kind: 'group', id: recipe.groups[0].id };
    let pick: Pick = null, mirrorParentId: string | null = null, resetToSource = false;
    let closed = false, stale = false, valid = false, pending = true, drawing = 0;
    let result: SlotPreviewResult | null = null, width = 0, height = 0;
    const viewport = new SlotViewport(), client = createSlotPreviewClient();
    const doc = ed.doc, stamp = ed.state(), tool = ed.tool, isolation = ed.isolation;
    const canvas = h('canvas', { class: 'slot-tool-canvas', 'aria-label': t('Feature-Vorschau mit Referenzen, Hilfslinien und Projektionskanten.'), tabindex: 0 });
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const properties = h('div', { class: 'slot-feature-properties' });
    const angleHelp = t('Kreise: scharfe Ecken ab dem Mindest-Richtungswechsel. Quadrate: gerundete Ecken, deren Richtungswechsel den Mindestwert erreicht.');
    const globalAngle = h('input', { id: 'slot-corner', type: 'number', min: 1, max: 179, step: 1, value: String(recipe.settings!.cornerAngle), title: angleHelp, 'aria-describedby': 'slot-corner-help' });
    const destructive = h('input', { id: 'slot-bake', type: 'checkbox' });
    const apply = h('button', { class: 'btn primary' }, t('Übernehmen'));
    const toolbar = h('div', { class: 'slot-feature-toolbar', role: 'toolbar', 'aria-label': t('Ausklinkungswerkzeuge') });
    const buttons = new Map<string, HTMLButtonElement>();
    const iconButton = (id: string, label: string, icon: string, run: () => void) => h('button', { class: 'btn slot-icon-button', id, type: 'button', title: label, 'aria-label': label, html: SLOT_TOOL_ICONS[icon] ?? SLOT_TOOL_ICONS.node, onclick: run });
    const button = (id: string, label: string, icon: string, run: () => void) => {
      const b = iconButton(id, label, icon, run); buttons.set(id, b); toolbar.append(b); return b;
    };
    const sourcePoints = () => recipe.base.flatMap(s => s.nodes.flatMap(n => [n, ...(n.cin ? [n.cin] : []), ...(n.cout ? [n.cout] : [])]));
    const dimensions = () => { const r = canvas.getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; };
    const fit = () => { const { w, h: hh } = dimensions(); viewport.fit(sourcePoints(), w, hh); scheduleDraw(); };
    const currentSlot = (): PlacedSlot | null => selected?.kind === 'slot' ? drafts.get(selected.id) ?? recipe.slots.find(s => s.id === selected!.id) ?? null : null;
    const currentHelper = () => selected?.kind === 'helper' ? helperDrafts.get(selected.id) ?? recipe.helpers!.find(l => l.id === selected!.id) ?? null : null;
    const allSlots = () => [...recipe.slots, ...drafts.values()];
    const visible = (kind: 'slot' | 'helper' | 'group' | 'source', id: string, seen = new Set<string>()): boolean => {
      const key = `${kind}:${id}`; if (hidden.has(key) || seen.has(key)) return false;
      seen.add(key);
      if (kind !== 'slot') return true;
      const slot = allSlots().find(s => s.id === id);
      return slot?.mirror ? visible('slot', slot.mirror.slotId, seen) : !slot?.groupId || !hidden.has(`group:${slot.groupId}`);
    };
    const previewFrame = (slot: PlacedSlot) => result?.frames.find(f => f.id === slot.id)?.frame ?? projectionFrame(recipe.base, slot);
    const currentGroup = () => {
      let slot = currentSlot(); const seen = new Set<string>();
      while (slot?.mirror && !seen.has(slot.id!)) { seen.add(slot.id!); slot = allSlots().find(s => s.id === slot!.mirror!.slotId) ?? null; }
      return recipe.groups!.find(g => g.id === (slot?.groupId ?? (selected?.kind === 'group' ? selected.id : recipe.groups![0].id))) ?? recipe.groups![0];
    };
    const points = (): PointChoice[] => {
      const offered: SlotReference[] = visible('source', 'source') ? result?.references ?? [] : [];
      const choices: PointChoice[] = offered.map((v, i) => ({ ref: v.origin, point: v.point, transition: v.transition, label: v.transition ? t('Gerundete Ecke {n}', { n: i + 1 }) : t('Ecke {n}', { n: i + 1 }) }));
      // Never silently drop or replace a stored reference just because the
      // current threshold no longer offers it.
      const active = activeRef();
      if (active && (active.kind === 'vertex' || active.kind === 'curveCorner') && !choices.some(c => originKey(c.ref) === originKey(active))) {
        const legacy = active.kind === 'vertex' ? (result?.vertices ?? []).find(v => v.sub === active.sub && v.node === active.node) : null;
        const point = active.kind === 'curveCorner' ? curveCorner(recipe.base, active.sub, active.node) : legacy?.point;
        if (point) choices.push({ ref: active, point, transition: active.kind === 'curveCorner' || !!legacy?.transition, label: t('Bestehende Referenz {n}', { n: choices.length + 1 }) });
      }
      for (const s of result?.slots ?? []) {
        if (!s.projection || s.id === currentSlot()?.id || !visible('slot', s.id!)) continue;
        const f = previewFrame(s);
        for (const [key, point, label] of [['start', f.a, t('Erste Öffnungsecke')], ['end', f.b, t('Zweite Öffnungsecke')], ['bottomStart', f.bottomStart, t('Erste Bodenecke')], ['bottomEnd', f.bottomEnd, t('Zweite Bodenecke')]] as const)
          choices.push({ ref: { kind: 'slot', slotId: s.id!, point: key }, point, label: `${s.id}: ${label}` });
      }
      for (const helper of result?.helpers ?? []) {
        if (selected?.kind === 'helper' && selected.id === helper.id || !visible('helper', helper.id)) continue;
        for (const intersection of helper.intersections) choices.push({ ref: intersection.origin, point: intersection.point, label: `${helper.id}: ${t('Virtueller Schnittpunkt')}` });
      }
      return choices;
    };
    const activeRef = (): SlotOrigin | null => {
      if (selected?.kind === 'helper') { const l = currentHelper(); return pick === 'second' ? l?.second ?? null : l?.first ?? null; }
      return currentSlot()?.projection?.origin ?? null;
    };
    const activeEdge = () => (selected?.kind === 'helper' ? currentHelper()?.edge : currentSlot()?.projection?.edge) || '';
    const refreshTree = () => {
      const shown = { ...recipe, slots: allSlots(), helpers: [...recipe.helpers!, ...helperDrafts.values()] } as SlotRecipe;
      tree.render(shown, selected, valid || pending ? undefined : new Set(selected ? [selected.id] : []), { hidden, draftIds: new Set([...drafts.keys()].map(id => `slot:${id}`).concat([...helperDrafts.keys()].map(id => `helper:${id}`))) });
    };
    const tree = createSlotFeatureTree(selection => {
      selected = selection; pick = null; showProperties(); refreshTree(); updateToolbar(); scheduleDraw();
    }, (source, targetSelection, position) => {
      if (stale || source.kind === 'source') return;
      if (position === 'into') {
        if (source.kind !== 'slot' || targetSelection?.kind !== 'group') { info.textContent = t('Nur Ausklinkungen können einer Gruppe zugeordnet werden.'); return; }
        const slot = allSlots().find(s => s.id === source.id), group = recipe.groups!.find(g => g.id === targetSelection.id);
        if (!slot || !group || slot.groupId === group.id) return;
        if (slot.mirror) { info.textContent = t('Spiegelungen erben die Gruppe ihrer ursprünglichen Ausklinkung.'); return; }
        if (!confirm(t('In die andere Gruppe verschieben und deren Form- und Korrekturparameter übernehmen?'))) return;
        slot.groupId = group.id;
      } else {
        const order = (recipe.order ?? []).filter(item => !(item.kind === source.kind && item.id === source.id));
        const present = [...recipe.groups!.map(g => ({ kind: 'group' as const, id: g.id })), ...recipe.slots.map(s => ({ kind: 'slot' as const, id: s.id! })), ...recipe.helpers!.map(l => ({ kind: 'helper' as const, id: l.id }))];
        for (const item of present) if (!(item.kind === source.kind && item.id === source.id) && !order.some(o => o.kind === item.kind && o.id === item.id)) order.push(item);
        const index = targetSelection ? order.findIndex(o => o.kind === targetSelection.kind && o.id === targetSelection.id) : -1;
        order.splice(index < 0 ? order.length : index, 0, source); recipe.order = order;
      }
      selected = source; refreshTree(); showProperties(); request();
    }, { onToggleVisibility: selection => { const key = `${selection.kind}:${selection.id}`; if (hidden.has(key)) hidden.delete(key); else hidden.add(key); refreshTree(); request(); } });
    const numberField = (parent: HTMLElement, id: string, label: string, value: number, set: (v: number) => void, step = '0.1') => {
      const input = h('input', { id, type: 'number', step, value: String(value) });
      input.addEventListener('input', () => { set(input.valueAsNumber); request(); }); parent.append(h('label', { for: id }, label), input);
    };
    const describe = (ref: SlotOrigin | null) => ref ? points().find(p => originKey(p.ref) === originKey(ref))?.label ?? originKey(ref) : t('Noch nicht gewählt');
    const choose = (parent: HTMLElement, label: string, mode: Pick, value: string) => parent.append(iconButton(`slot-choose-${mode}`, label, mode === 'edge' || mode === 'helperEdge' ? 'line' : mode === 'mirrorAxis' ? 'mirrorh' : 'origin', () => { pick = mode; mirrorParentId = null; info.textContent = label; updateToolbar(); }), h('output', {}, value));
    function showProperties(): void {
      properties.replaceChildren();
      const heading = selected?.kind === 'group' ? t('Gruppenparameter') : selected?.kind === 'source' ? t('Originalform') : selected?.kind === 'helper' ? t('Parametrische Hilfslinie') : t('Position der Ausklinkung');
      properties.append(h('h4', {}, heading));
      const form = h('div', { class: 'form' }); properties.append(form);
      if (selected?.kind === 'source') { properties.append(h('p', { class: 'note' }, t('Sichtbarkeit gilt nur für die Vorschau, nicht für die Ausgabe.'))); return; }
      if (selected?.kind === 'helper') {
        const line = currentHelper();
        if (!line) return;
        choose(form, t('Ersten Punkt wählen'), 'first', describe(line.first));
        choose(form, t('Zweiten Punkt wählen'), 'second', describe(line.second));
        choose(form, t('Senkrechte zu Kante wählen'), 'helperEdge', line.edge || t('Noch nicht gewählt'));
        properties.append(h('p', { class: 'note' }, t('Unendliche Hilfslinie durch den Mittelpunkt, senkrecht zur Referenzkante. Nur Konstruktion, keine Ausgabe.')));
      } else if (selected?.kind === 'group') {
        const group = currentGroup();
        const name = h('input', { value: group.name, id: 'slot-group-name' }); name.addEventListener('input', () => { group.name = name.value; refreshTree(); });
        form.append(h('label', { for: name.id }, t('Gruppenname')), name);
        for (const [key, label] of [['width', t('Nennbreite / Materialdicke (mm)')], ['depth', t('Eindringtiefe (mm)')], ['clearance', t('Spiel gesamt (mm)')], ['factor', t('Breitenfaktor')], ['burn', t('Lokale Burn-Korrektur (mm)')]] as const)
          numberField(form, `slot-group-${key}`, label, group[key], v => { group[key] = v; }, key === 'burn' ? '0.005' : '0.1');
        const style = h('select', { id: 'slot-group-corners' }, ...(['corner', 'loop', 'backarc'] as const).map(value => h('option', { value, selected: group.cornerStyle === value }, value)));
        style.addEventListener('change', () => { group.cornerStyle = style.value as SlotGroup['cornerStyle']; request(); });
        form.append(h('label', { for: style.id }, t('Inneneckenstil')), style);
        properties.append(h('p', { class: 'note' }, t('Gruppenmaße gelten für alle Mitglieder. Lokale Burn-Korrektur erfordert Layer-Kerf 0.')));
      } else {
        const slot = currentSlot(); if (!slot) return;
        properties.append(h('p', { class: 'note' }, `${t('Gruppe')}: ${currentGroup().name}`));
        if (drafts.has(slot.id!)) properties.append(h('p', { class: 'slot-draft-note' }, t('Entwurf – bleibt beim Wechsel im Featuretree erhalten.')));
        if (slot.mirror) {
          properties.append(h('p', { class: 'note' }, t('Parametrische Spiegelung von {id}. Maße und Gruppe werden geerbt.', { id: slot.mirror.slotId })));
          choose(form, t('Spiegelachse wählen: Hilfslinie oder Körperkante'), 'mirrorAxis', slot.mirror.axis.kind === 'helper' ? slot.mirror.axis.helperId : slot.mirror.axis.edge);
          return;
        }
        if (!slot.projection) { properties.append(h('p', {}, t('Bisheriger Ausschnitt bleibt unverändert. Für das neue Positionsmodell Referenz und Gerade wählen.'))); return; }
        const p = slot.projection;
        choose(form, t('Referenzpunkt wählen'), 'origin', describe(p.origin));
        choose(form, t('Projektionskante wählen'), 'edge', p.edge || t('Noch nicht gewählt'));
        numberField(form, 'slot-distance', t('Abstand parallel zur Projektionskante (mm)'), p.distance, v => { p.distance = v; });
        const targetButtons = h('div', { class: 'slot-inline-buttons' });
        for (const [value, label] of [['start', t('Erste Außenkante')], ['center', t('Mitte')], ['end', t('Zweite Außenkante')]] as const)
          { const b = iconButton(`slot-target-${value}`, label, value === 'start' ? 'alignl' : value === 'end' ? 'alignr' : 'alignhc', () => { p.target = value; showProperties(); request(); }); b.setAttribute('aria-pressed', String(p.target === value)); targetButtons.append(b); }
        form.append(h('label', {}, t('Maß bis zur eigenen …')), targetButtons);
        const directionButton = iconButton('slot-direction', p.direction === 1 ? t('In Kantenrichtung') : t('Gegen Kantenrichtung'), p.direction === 1 ? 'right' : 'left', () => { p.direction = p.direction === 1 ? -1 : 1; showProperties(); request(); });
        form.append(h('label', {}, t('Richtung entlang der Geraden')), directionButton);
        properties.append(iconButton('slot-edit-group', t('Gruppenparameter bearbeiten'), 'group', () => { selected = { kind: 'group', id: currentGroup().id }; pick = null; showProperties(); refreshTree(); updateToolbar(); scheduleDraw(); }));
      }
    }
    const updateToolbar = () => {
      canvas.style.cursor = pick === 'pan' ? 'grab' : pick ? 'crosshair' : '';
      for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === 'slot-pan' && pick === 'pan' || id === 'slot-mirror' && pick === 'mirrorAxis'));
      const mirror = buttons.get('slot-mirror'); if (mirror) mirror.disabled = !completeSlot(currentSlot()) || pending || !valid;
      const stage = buttons.get('slot-stage'); if (stage) stage.disabled = !selected || !drafts.has(selected.id) || !valid || pending || !completeSlot(currentSlot());
      const remove = buttons.get('slot-delete'); if (remove) remove.disabled = !selected || selected.kind === 'source';
    };
    const completeSlot = (s: PlacedSlot | null): boolean => !!s && (!!s.mirror || !!s.projection?.edge && !!s.projection.origin);
    const prepareTrial = (): SlotRecipe => {
      const slots = [...recipe.slots, ...[...drafts.values()].filter(completeSlot)];
      return { ...recipe, slots, order: recipe.order?.filter(item => (item.kind === 'slot' ? slots : item.kind === 'helper' ? recipe.helpers : recipe.groups)?.some(f => f.id === item.id)) };
    };
    function request(): void {
      if (closed || stale) return;
      pending = true; valid = false; apply.disabled = true; canvas.setAttribute('aria-busy', 'true'); info.textContent = t('Vorschau wird berechnet …');
      updateToolbar();
      const proposed = prepareTrial(), snapshot = structuredClone(recipe), draftSnapshot = structuredClone(drafts), helperSnapshot = structuredClone(helperDrafts), resetSnapshot = resetToSource;
      client.request(proposed, recipe.settings!.cornerAngle, reply => {
        if (closed || stale) return;
        pending = false; canvas.setAttribute('aria-busy', 'false');
        if (reply.error || !reply.result) {
          valid = false; apply.disabled = true;
          info.textContent = `${reply.error ?? t('Vorschau fehlgeschlagen.')} ${t('Letzte gültige Vorschau bleibt erhalten. Richtung und Abstand prüfen oder Änderung verwerfen.')}`;
          // Keep the last valid geometry, point inventory and staged recipe visible.
          refreshTree(); updateToolbar(); scheduleDraw(); return;
        }
        valid = true; result = reply.result; lastValid = snapshot; lastDrafts = draftSnapshot; lastHelperDrafts = helperSnapshot; lastResetToSource = resetSnapshot;
        const incomplete = helperDrafts.size > 0 || [...drafts.values()].some(s => !completeSlot(s));
        apply.disabled = incomplete || (!proposed.slots.length && !proposed.helpers?.length && !editingRecipe);
        info.textContent = incomplete ? t('Entwurf unvollständig: Referenzpunkte und Kante im Feature wählen. Entwürfe bleiben beim Wechsel erhalten.') : t('Rot: Referenzpunkt. Orange: Projektionskante mit Richtung. Gelb: Positionsmaß.');
        refreshTree(); updateToolbar(); scheduleDraw();
      }, proposed.slots.filter(s => visible('slot', s.id!)).map(s => s.id!));
    }
    const attachPoint = (ref: SlotOrigin) => {
      const line = currentHelper();
      if ((pick === 'first' || pick === 'second') && line) {
        line[pick] = structuredClone(ref);
        if (line.id && helperDrafts.has(line.id)) pick = !line.second ? 'second' : !line.edge ? 'helperEdge' : null;
        else pick = null;
      } else {
        const slot = currentSlot(); if (!slot?.projection || slot.mirror) return; slot.projection.origin = structuredClone(ref); pick = !slot.projection.edge ? 'edge' : null;
      }
      finishHelper(); showProperties(); updateToolbar(); request();
    };
    const finishHelper = () => {
      const line = currentHelper();
      if (!line?.first || !line.second || !line.edge || !helperDrafts.has(line.id)) return;
      recipe.helpers!.push({ ...line, first: line.first, second: line.second });
      helperDrafts.delete(line.id); pick = null; refreshTree();
    };
    const addSlot = () => {
      resetToSource = false;
      const group = currentGroup();
      const draftSlot: PlacedSlot = { id: nextId('slot'), groupId: group.id, x: 0, y: 0, angle: 0, width: group.width, depth: group.depth, clearance: group.clearance, factor: group.factor,
        projection: { edge: '', origin: null as unknown as SlotOrigin, target: 'center', distance: 10, direction: 1, cornerAngle: recipe.settings!.cornerAngle } };
      drafts.set(draftSlot.id!, draftSlot);
      selected = { kind: 'slot', id: draftSlot.id! }; pick = 'origin'; showProperties(); refreshTree(); updateToolbar(); request();
    };
    button('slot-new', t('Neue Ausklinkung'), 'slots', addSlot);
    button('slot-new-group', t('Neue Gruppe'), 'group', () => { resetToSource = false; const group = defaultGroup(nextId('group')); group.name = t('Gruppe {n}', { n: recipe.groups!.length + 1 }); recipe.groups!.push(group); selected = { kind: 'group', id: group.id }; pick = null; showProperties(); refreshTree(); request(); });
    button('slot-new-helper', t('Hilfslinie: Mittelpunkt-Senkrechte'), 'helper', () => { resetToSource = false; const line: HelperDraft = { id: nextId('helper'), name: t('Hilfslinie'), first: null, second: null, edge: '' }; helperDrafts.set(line.id, line); selected = { kind: 'helper', id: line.id }; pick = 'first'; showProperties(); refreshTree(); request(); });
    button('slot-pan', t('Verschieben'), 'pan', () => { pick = pick === 'pan' ? null : 'pan'; updateToolbar(); });
    button('slot-zoom-in', t('Vergrößern'), 'zoomin', () => { const r = dimensions(); viewport.zoom(1.25, { x: r.w / 2, y: r.h / 2 }); scheduleDraw(); });
    button('slot-zoom-out', t('Verkleinern'), 'zoomout', () => { const r = dimensions(); viewport.zoom(0.8, { x: r.w / 2, y: r.h / 2 }); scheduleDraw(); });
    button('slot-fit', t('Ansicht einpassen'), 'zoompage', fit);
    button('slot-mirror', t('Ausklinkung spiegeln'), 'mirrorh', () => { if (!completeSlot(currentSlot()) || pending || !valid) return; mirrorParentId = currentSlot()!.id!; pick = 'mirrorAxis'; info.textContent = t('Spiegelachse wählen: Hilfslinie oder Körperkante'); updateToolbar(); });
    button('slot-revert', t('Ungültige Änderung verwerfen'), 'undo', () => {
      recipe = structuredClone(lastValid);
      resetToSource = lastResetToSource;
      drafts.clear(); for (const [id, slot] of structuredClone(lastDrafts)) drafts.set(id, slot);
      helperDrafts.clear(); for (const [id, line] of structuredClone(lastHelperDrafts)) helperDrafts.set(id, line);
      pick = null;
      if (selected?.kind === 'helper' && !recipe.helpers!.some(h => h.id === selected!.id) && !helperDrafts.has(selected.id) || selected?.kind === 'slot' && !allSlots().some(s => s.id === selected!.id) || selected?.kind === 'group' && !recipe.groups!.some(g => g.id === selected!.id)) selected = { kind: 'group', id: recipe.groups![0].id };
      globalAngle.value = String(recipe.settings!.cornerAngle); refreshTree(); showProperties(); request();
    });
    button('slot-delete', t('Feature entfernen'), 'delete', () => {
      if (!selected || stale) return;
      const id = selected.id, kind = selected.kind;
      if (kind === 'source') return;
      const references = (r: SlotOrigin | null) => r && ((r.kind === 'slot' && kind === 'slot' && r.slotId === id) || (r.kind === 'intersection' && kind === 'helper' && r.helperId === id));
      if (allSlots().some(s => references(s.projection?.origin ?? null) || kind === 'slot' && (s.anchor?.relative?.slotId === id || s.mirror?.slotId === id) || kind === 'helper' && s.mirror?.axis.kind === 'helper' && s.mirror.axis.helperId === id) || [...recipe.helpers!, ...helperDrafts.values()].some(l => references(l.first) || references(l.second)) || (kind === 'group' && allSlots().some(s => s.groupId === id))) { info.textContent = t('Feature wird noch referenziert oder enthält Mitglieder. Bezüge zuerst ändern.'); return; }
      if (kind === 'slot') drafts.delete(id);
      if (kind === 'helper') helperDrafts.delete(id);
      if (kind === 'slot') recipe.slots = recipe.slots.filter(s => s.id !== id);
      if (kind === 'helper') recipe.helpers = recipe.helpers!.filter(l => l.id !== id);
      if (kind === 'group') { if (recipe.groups!.length === 1) return; recipe.groups = recipe.groups!.filter(g => g.id !== id); }
      recipe.order = recipe.order!.filter(o => !(o.kind === kind && o.id === id)); selected = { kind: 'group', id: recipe.groups![0].id }; showProperties(); refreshTree(); request();
    });
    button('slot-restore-source', t('Originalform wiederherstellen'), 'rotccw', () => {
      if (stale || !confirm(t('Alle Ausklinkungen, Spiegelungen, Gruppen und Konstruktionshilfen im Werkzeug löschen und zur Originalform zurückkehren? Das Fenster bleibt offen. Erst Übernehmen ändert das Projekt.'))) return;
      recipe = { source: structuredClone(original.source), base: structuredClone(original.base), slots: [], settings: { cornerAngle: recipe.settings!.cornerAngle }, groups: [defaultGroup('group-1')], helpers: [], order: [] };
      resetToSource = true;
      drafts.clear(); helperDrafts.clear(); hidden.clear(); pick = null; selected = { kind: 'group', id: recipe.groups![0].id }; showProperties(); refreshTree(); request();
    });
    button('slot-stage', t('Ausklinkung vormerken'), 'stage', () => {
      const slot = currentSlot(); if (!slot || !drafts.has(slot.id!) || !valid || pending || !completeSlot(slot)) return;
      recipe.slots.push(slot); drafts.delete(slot.id!); pick = null; showProperties(); refreshTree(); request();
    });
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 1 || (e.button === 0 && pick === 'pan')) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; e.preventDefault(); return; }
      if (e.button !== 0 || stale || !result || !pick) return;
      const r = canvas.getBoundingClientRect(), p = viewport.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }), tolerance = 12 / viewport.scale;
      if (pick === 'mirrorAxis') {
        const axes: { axis: NonNullable<PlacedSlot['mirror']>['axis']; distance: number }[] = [];
        for (const helper of result.helpers) if (visible('helper', helper.id)) axes.push({ axis: { kind: 'helper', helperId: helper.id }, distance: Math.abs((p.x - helper.point.x) * helper.direction.y - (p.y - helper.point.y) * helper.direction.x) });
        for (const edge of visible('source', 'source') ? result.edges : []) { const at = Math.max(0, Math.min(edge.length, dot(sub(p, edge.a), edge.tangent))); axes.push({ axis: { kind: 'edge', edge: edge.key }, distance: Math.hypot(p.x - edge.a.x - at * edge.tangent.x, p.y - edge.a.y - at * edge.tangent.y) }); }
        axes.sort((a, b) => a.distance - b.distance);
        if (!axes.length || axes[0].distance > tolerance) return;
        if (axes.length > 1 && Math.abs(axes[0].distance - axes[1].distance) < 0.1 / viewport.scale) { info.textContent = t('Spiegelachse nicht eindeutig. Abseits eines Schnittpunkts wählen.'); return; }
        const slot = currentSlot(); if (!slot) return;
        if (mirrorParentId) {
          const id = nextId('slot'), mirrored: PlacedSlot = { ...structuredClone(slot), id, groupId: undefined, projection: undefined, anchor: undefined, mirror: { slotId: mirrorParentId, axis: axes[0].axis } };
          drafts.set(id, mirrored); selected = { kind: 'slot', id }; resetToSource = false;
        } else if (slot.mirror) slot.mirror.axis = axes[0].axis;
        mirrorParentId = null; pick = null; showProperties(); refreshTree(); request(); return;
      }
      if (['origin', 'first', 'second'].includes(pick)) {
        const choices = points().map(choice => ({ choice, distance: Math.hypot(choice.point.x - p.x, choice.point.y - p.y) })).sort((a, b) => a.distance - b.distance);
        if (!choices.length || choices[0].distance > tolerance) return; attachPoint(choices[0].choice.ref);
      } else if (pick === 'edge' || pick === 'helperEdge') {
        const choices = (visible('source', 'source') ? result.edges : []).map(edge => { const at = Math.max(0, Math.min(edge.length, dot(sub(p, edge.a), edge.tangent))); return { edge, distance: Math.hypot(p.x - edge.a.x - edge.tangent.x * at, p.y - edge.a.y - edge.tangent.y * at) }; }).sort((a, b) => a.distance - b.distance);
        if (!choices.length || choices[0].distance > tolerance) return;
        if (pick === 'helperEdge') { const line = currentHelper(); if (line) line.edge = choices[0].edge.key; finishHelper(); }
        else {
          const slot = currentSlot(); if (slot?.projection && !slot.mirror) {
            const edge = choices[0].edge, projection = slot.projection;
            // A fresh feature has no previous edge direction to preserve. Choose a
            // feasible initial direction once, never repair existing invalid edits.
            if (!projection.edge && projection.origin && drafts.has(slot.id!)) {
              const origin = points().find(c => originKey(c.ref) === originKey(projection.origin))?.point;
              if (origin) { const zero = dot(sub(origin, edge.a), edge.tangent), w = currentGroup().width * currentGroup().factor + currentGroup().clearance;
                const offset = projection.target === 'start' ? w / 2 : projection.target === 'end' ? -w / 2 : 0;
                const fits = (direction: number) => { const center = zero + projection.distance * direction + offset; return center - w / 2 >= -0.001 && center + w / 2 <= edge.length + 0.001; };
                if (!fits(projection.direction) && fits(-projection.direction)) projection.direction = projection.direction === 1 ? -1 : 1;
              }
            }
            projection.edge = edge.key;
          }
        }
        pick = null; showProperties(); updateToolbar(); request();
      }
    });
    canvas.addEventListener('pointermove', e => { if (drag?.id === e.pointerId) { viewport.pan(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; scheduleDraw(); } });
    const endDrag = (e: PointerEvent) => { if (drag?.id !== e.pointerId) return; drag = null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); updateToolbar(); };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey && pinchGestureActive(canvas)) return; const r = canvas.getBoundingClientRect(); if (e.shiftKey && !e.ctrlKey) viewport.pan(-e.deltaX, -e.deltaY); else viewport.zoom(canvasWheelFactor(e, 0.005), { x: e.clientX - r.left, y: e.clientY - r.top }); scheduleDraw(); }, { passive: false });
    const disposePinch = installPinchGestures(canvas, (factor, x, y) => { viewport.zoom(factor, { x, y }); scheduleDraw(); });
    const infiniteLine = (ctx: CanvasRenderingContext2D, line: ResolvedConstructionLine) => {
      const a = viewport.toWorld({ x: 0, y: 0 }), b = viewport.toWorld({ x: width, y: height }); let low = -Infinity, high = Infinity;
      for (const axis of ['x', 'y'] as const) {
        const d = line.direction[axis], v = line.point[axis], min = Math.min(a[axis], b[axis]), max = Math.max(a[axis], b[axis]);
        if (Math.abs(d) < 1e-12) { if (v < min || v > max) return; }
        else { const t1 = (min - v) / d, t2 = (max - v) / d; low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2)); }
      }
      if (low > high || !Number.isFinite(low + high)) return;
      ctx.beginPath(); ctx.moveTo(line.point.x + low * line.direction.x, line.point.y + low * line.direction.y); ctx.lineTo(line.point.x + high * line.direction.x, line.point.y + high * line.direction.y); ctx.stroke();
    };
    function draw(): void {
      const r = dimensions(), previousW = width, previousH = height; width = r.w; height = r.h;
      if (!viewport.initialized) viewport.fit(sourcePoints(), width, height);
      else if (previousW && (width !== previousW || height !== previousH)) viewport.resize(previousW, previousH, width, height);
      const dpr = devicePixelRatio || 1; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#20252c'; ctx.fillRect(0, 0, width, height);
      ctx.setTransform(dpr * viewport.scale, 0, 0, dpr * viewport.scale, dpr * viewport.ox, dpr * viewport.oy);
      const scale = viewport.scale; ctx.lineWidth = 1.5 / scale; ctx.fillStyle = '#405c7c'; ctx.strokeStyle = valid ? '#9ecbff' : '#e88959';
      const showSelection = !selected || visible(selected.kind, selected.id);
      if (visible('source', 'source')) {
        const p = subsToPath2D(result?.subs ?? recipe.base); ctx.fill(p, 'evenodd'); ctx.stroke(p);
        ctx.strokeStyle = '#626b79'; ctx.setLineDash([3 / scale, 3 / scale]); ctx.stroke(subsToPath2D(recipe.base)); ctx.setLineDash([]);
      } else for (const slot of result?.slots ?? []) if (slot.projection && visible('slot', slot.id!)) ctx.stroke(subsToPath2D([previewFrame(slot).outline]));
      for (const helper of result?.helpers ?? []) { if (!visible('helper', helper.id)) continue; ctx.strokeStyle = selected?.kind === 'helper' && helper.id === selected.id ? '#ff9c38' : '#65d6df'; ctx.setLineDash([6 / scale, 4 / scale]); infiniteLine(ctx, helper); ctx.setLineDash([]); }
      const selectedEdge = result?.edges.find(edge => edge.key === activeEdge());
      if (selectedEdge && visible('source', 'source') && showSelection) {
        const e = selectedEdge; ctx.strokeStyle = '#ff982d'; ctx.lineWidth = 4 / scale; ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
        const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, size = 8 / scale;
        ctx.beginPath(); ctx.moveTo(mid.x - e.tangent.x * size, mid.y - e.tangent.y * size); ctx.lineTo(mid.x + e.tangent.x * size, mid.y + e.tangent.y * size); ctx.lineTo(mid.x + e.normal.x * size / 2, mid.y + e.normal.y * size / 2); ctx.stroke();
      }
      ctx.lineWidth = 1.5 / scale;
      for (const choice of points()) { ctx.strokeStyle = choice.ref.kind === 'intersection' ? '#d69cff' : '#84909d'; ctx.beginPath(); if (choice.transition) ctx.rect(choice.point.x - 3 / scale, choice.point.y - 3 / scale, 6 / scale, 6 / scale); else ctx.arc(choice.point.x, choice.point.y, 3 / scale, 0, Math.PI * 2); ctx.stroke(); }
      let refPoint = showSelection && activeRef() ? points().find(p => originKey(p.ref) === originKey(activeRef()!))?.point : null;
      const selectedSlot = (result?.slots ?? []).find(s => s.id === currentSlot()?.id);
      if (selectedSlot?.projection && visible('slot', selectedSlot.id!)) {
        const f = previewFrame(selectedSlot); refPoint = f.origin;
        ctx.strokeStyle = '#ffe277'; ctx.setLineDash([4 / scale, 3 / scale]); ctx.beginPath(); ctx.moveTo(f.origin.x, f.origin.y); ctx.lineTo(f.zero.x, f.zero.y); ctx.lineTo(f.target.x, f.target.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffe277'; ctx.font = `${12 / scale}px sans-serif`; ctx.fillText(`${selectedSlot.projection.distance.toFixed(2)} mm`, (f.zero.x + f.target.x) / 2, (f.zero.y + f.target.y) / 2 - 8 / scale);
      }
      if (refPoint) { ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2.5 / scale; ctx.beginPath(); ctx.arc(refPoint.x, refPoint.y, 7 / scale, 0, Math.PI * 2); ctx.stroke(); }
    }
    function scheduleDraw(): void { if (!closed && !drawing) drawing = requestAnimationFrame(() => { drawing = 0; draw(); }); }
    globalAngle.addEventListener('input', () => { recipe.settings!.cornerAngle = globalAngle.valueAsNumber; request(); });
    const title = h('header', { class: 'slot-tool-title' }, h('h3', {}, t('Parametrische Schlitze / Ausklinkungen')),
      iconButton('slot-reset-window', t('Fenster zurücksetzen'), 'zoompage', () => { dlg.style.width = ''; dlg.style.height = ''; dlg.style.left = '8px'; dlg.style.top = '8px'; fit(); }));
    const dlg = h('dialog', { class: 'slot-projection-dialog slot-features-dialog', id: 'slot-projection-dialog' }, title, toolbar,
      h('div', { class: 'slot-features-body' }, tree.element, h('section', { class: 'slot-tool-preview' }, canvas), h('section', { class: 'slot-tool-settings' },
        h('div', { class: 'slot-tool-global' }, h('label', { for: globalAngle.id }, t('Mindest-Richtungswechsel (°)')), globalAngle), h('p', { id: 'slot-corner-help', class: 'note' }, angleHelp), properties,
        h('label', { class: 'check' }, destructive, t('Destruktiv festschreiben (Parameter entfernen)')))),
      info, h('footer', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), apply));
    if (!original.groups?.length && original.slots.length) title.append(iconButton('slot-open-legacy', t('Bisheriges Rezept bearbeiten'), 'open', () => { dlg.addEventListener('close', () => openProjectionLegacyDialog(ed, obj), { once: true }); dlg.close(); }));
    const changed = () => { if (ed.doc !== doc || ed.state() !== stamp || ed.tool !== tool || ed.isolation !== isolation) { stale = true; apply.disabled = true; client.dispose(); info.textContent = t('Quelle geändert. Schlitzwerkzeug erneut öffnen.'); } };
    ed.on(changed);
    apply.addEventListener('click', () => {
      if (!valid || pending || stale || helperDrafts.size || [...drafts.values()].some(s => !completeSlot(s))) return;
      const complete = prepareTrial();
      if (destructive.checked && !confirm(t('Ausschnitte als Pfad festschreiben? Die gespeicherte Originalform und Schlitzparameter werden entfernt.'))) return;
      try {
        if (ed.doc !== doc || ed.state() !== stamp || !ed.doc.objs.includes(obj) || !ed.selectable(obj) || ed.drag || ed.draft || ed.sketchEdit || ed.pickHandler) throw new Error(t('Quelle geändert. Schlitzwerkzeug erneut öffnen.'));
        if (resetToSource && !complete.slots.length && !complete.helpers?.length) { ed.snapshot(t('Originalform wiederherstellen')); obj.shape = structuredClone(original.source); ed.touch(obj.shape); ed.emit('doc'); }
        else applySlotRecipe(ed, obj, complete, stamp, destructive.checked);
        dlg.close();
      } catch (e) { info.textContent = e instanceof Error ? e.message : String(e); }
    });
    let disposeWindow = () => {};
    dlg.addEventListener('close', () => { closed = true; client.dispose(); tree.dispose(); disposeWindow(); disposePinch(); ed.off(changed); if (drawing) cancelAnimationFrame(drawing); dlg.remove(); });
    dlg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' && pick) { e.preventDefault(); pick = null; updateToolbar(); } });
    document.body.append(dlg); dlg.showModal(); disposeWindow = movableToolWindow(dlg, title, scheduleDraw); showProperties(); refreshTree(); request();
  } catch (error) { ed.hint = error instanceof Error ? error.message : String(error); ed.emit('tool'); }
}
