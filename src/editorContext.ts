import type { Editor } from './editor';
import { t } from './i18n';
import { ContextAction, showEditorMenu, closeEditorMenu } from './contextMenu';
import { RULER } from './editor/shared';
import { defaultLayer, homeLayer, layerLabel } from './model';
import { selectAssembly } from './asmSelect';

export interface ContextCallbacks {
  adjust: () => void; trace: () => void; background: () => void; saveBitmap: () => void | Promise<unknown>;
  library: () => void;
  vectorFit: () => void; builder: () => void | Promise<unknown>;
  preview: () => void | Promise<unknown>; objects: () => void;
}

export const canEnterIsolation = (ed: Editor): boolean => !ed.isolation && !ed.drag && !ed.draft && !ed.sketchEdit &&
  !ed.pickHandler && ed.sel.length > 0 && ed.sel.every((o) => ed.selectable(o));

export function editorContextGroups(ed: Editor, callbacks: ContextCallbacks, blank = false): ContextAction[][] {
  const count = ed.sel.length, images = ed.selImages(), editable = count > 0 && ed.sel.every((o) => ed.selectable(o));
  const action = (id: string, label: string, run: ContextAction['run'], enabled = true): ContextAction => ({ id, label, run, enabled });
  const paste = [action('paste', t('Einfügen'), () => ed.paste(), !!ed.clipboard.length),
    action('paste-in-place', t('An Originalposition einfügen'), () => ed.paste(0), !!ed.clipboard.length)];
  const isolation = action('isolate', ed.isolation ? t('Isolation verlassen') : t('Auswahl isolieren'),
    () => { if (ed.isolation) ed.leaveIsolation(); else ed.isolateSelection(); }, !!ed.isolation || canEnterIsolation(ed));
  const windows = action('objects', t('Objekte-Fenster anzeigen'), callbacks.objects);
  if (blank) return [[isolation, ...paste], [action('selectall', t('Alles auswählen'), () => ed.selectAll())],
    [action('zoompage', t('Ganze Seite'), () => ed.zoomPage()), windows]];
  const components = ed.tool === 'node' && !!ed.nodeTarget();
  if (components) {
    const picked = !!ed.selectedNodes().length || !!ed.nodeHover || !!ed.segHover;
    return [[isolation, action('selectall', t('Alle Knoten auswählen'), () => ed.selectAllNodes()),
      action('delete', t('Knoten / Segmente löschen'), () => ed.deleteNodes(), editable && picked)],
    [action('node-corner', t('Ecke'), () => ed.setNodeType(false), editable && picked),
      action('node-smooth', t('Glatt'), () => ed.setNodeType(true), editable && picked),
      action('segment-line', t('Gerade'), () => ed.setSegmentType(false), editable && picked),
      action('segment-curve', t('Kurve'), () => ed.setSegmentType(true), editable && picked)],
    [action('tool:select', t('Objektbearbeitung'), () => ed.setTool('select')), windows]];
  }
  const common = [isolation, action('cut', t('Ausschneiden'), () => ed.cut(), editable), action('copy', t('Kopieren'), () => ed.copy(), count > 0),
    ...paste, action('duplicate', t('Duplizieren'), () => ed.duplicate(), editable), action('delete', t('Löschen'), () => ed.deleteSel(), editable)];
  const organize = [action('selectall', t('Alles auswählen'), () => ed.selectAll()),
    ...(ed.selAsms().length ? [action('asm-select', t('Baugruppe auswählen'), () => selectAssembly(ed))] : []),
    action('layer-objects', t('Objekte dieses Layers auswählen'), () => ed.selectLayerObjects(), count > 0),
    action('group', t('Gruppieren'), () => ed.group(), editable && count > 1),
    action('ungroup', t('Gruppierung aufheben'), () => ed.ungroup(), editable && ed.sel.some((o) => o.shape.kind === 'group')),
    action('lock', t('Auswahl sperren'), () => ed.setObjProps(ed.sel, { locked: true }), editable)];
  const imageActions = [action('trace', t('Bild nachzeichnen …'), callbacks.trace, editable && images.length === 1),
    action('adjust', t('Bild anpassen …'), callbacks.adjust, editable && images.length > 0),
    action('bgremove', t('Hintergrund entfernen …'), callbacks.background, editable && images.length === 1),
    action('crop', t('Bild zuschneiden (Formen werden entfernt)'), () => ed.cropImageSel(false), editable && images.length === 1 && count > 1),
    action('mask', t('Maske anwenden (Formen werden entfernt)'), () => ed.cropImageSel(true), editable && images.length === 1 && count > 1),
    action('save-bitmap', t('Bearbeitetes Bild speichern …'), callbacks.saveBitmap, images.length === 1)];
  const vectorActions = [action('tool:node', t('Knoten bearbeiten'), () => ed.setTool('node'), editable && !!ed.nodeTarget()),
    action('tolines', t('In Pfad umwandeln'), () => ed.convertSelToPath(), editable && ed.sel.some((o) => !['path', 'image'].includes(o.shape.kind))),
    action('vectorfit', t('Pfade vereinfachen / glätten…'), callbacks.vectorFit, editable && ed.nodeTargets().length > 0),
    action('shape-builder', t('Formerstellung …'), callbacks.builder, editable && !images.length),
    { id: 'path', label: t('Pfad'), run: () => {}, items: [
      action('closepath', t('Pfad schließen'), () => ed.closeSel(), editable), action('join', t('Ausgewählte Formen verbinden'), () => ed.joinSel(), editable && count > 1),
      action('breakapart', t('Zerlegen'), () => ed.breakApartSel(), editable), action('reverse', t('Richtung umkehren'), () => ed.reverseSel(), editable)] },
    { id: 'booleans', label: t('Boolesche Operationen'), run: () => {}, items: [
      action('union', t('Vereinen'), () => ed.booleanSel('union'), editable),
      action('subtract', t('Abziehen'), () => ed.booleanSel('subtract'), editable && count > 1),
      action('intersection', t('Schnittmenge'), () => ed.booleanSel('intersect'), editable && count > 1)] }];
  const arrange: ContextAction = { id: 'arrange', label: t('Anordnen'), run: () => {}, items: [
    action('mirrorh', t('Horizontal spiegeln'), () => ed.mirror(true), editable), action('mirrorv', t('Vertikal spiegeln'), () => ed.mirror(false), editable),
    action('alignl', t('Links ausrichten'), () => ed.align('left'), editable && count > 1),
    action('alignhc', t('Mitten horizontal'), () => ed.align('hcenter'), editable && count > 1)] };
  const stacking: ContextAction = { id: 'stacking', label: t('Reihenfolge'), run: () => {}, items: stackingActions(ed, editable) };
  return [common, organize, moveActions(ed, editable), images.length ? imageActions : vectorActions, [arrange, stacking,
    action('library', t('Zur Bibliothek hinzufügen …'), callbacks.library, count > 0),
    { ...action('no-laser', t('Nicht lasern'), () => ed.toggleNoLaser(), editable), checked: !!count && ed.sel.every((o) => o.noLaser) }],
  [action('preview', t('Vorschau …'), callbacks.preview), windows]];
}

/** Layers offered by the "move to layer" submenus: the used ones in output order, plus the current one */
const layerChoices = (ed: Editor): number[] => [...new Set([...ed.layerOrder(), ed.currentLayer])];

/** Ids of the move block; the Objects window shows it at the top and drops it from the copied canvas menu */
export const MOVE_IDS = new Set(['move-layer', 'asm-layer', 'move-page', 'asm-page']);

/**
 * "Move to layer / page" for the selection, each followed by the same for the whole assembly when the selection
 * holds assembly parts. Shared by the canvas menu and the Objects window.
 */
export function moveActions(ed: Editor, editable: boolean): ContextAction[] {
  const sel = ed.sel, asms = ed.selAsms();
  const item = (id: string, label: string, run: ContextAction['run'], enabled = true, checked = false): ContextAction =>
    ({ id, label, run, enabled: editable && enabled, checked });
  const layerItems = (prefix: string, assign: (i: number) => void, on: (i: number) => boolean): ContextAction[] => {
    const free = ed.freeLayer(ed.currentLayer);
    // Read without ed.layer(): opening the menu must not store settings for the empty layer
    const name = (i: number) => `${layerLabel(i)} · ${(ed.doc.layers[i] ?? defaultLayer(i)).name}`;
    return [...layerChoices(ed).map((i) => item(`${prefix}:${i}`, name(i), () => assign(i), true, on(i))),
      item(`${prefix}:empty`, t('Leerer Layer: {layer}', { layer: free < 0 ? '–' : name(free) }), () => assign(free), free >= 0)];
  };
  const out: ContextAction[] = [{ id: 'move-layer', label: t('Auf Layer verschieben'), run: () => {},
    items: layerItems('layer', (i) => ed.assignLayer(i), (i) => sel.every((o) => homeLayer(o) === i)) }];
  if (asms.length) out.push({ id: 'asm-layer', label: t('Baugruppe auf Layer verschieben'), run: () => {},
    items: layerItems('asm-layer', (i) => ed.assignAsmLayer(asms, i), (i) => ed.asmOnLayer(asms, i)) });
  if (ed.doc.pages.length > 1) out.push({ id: 'move-page', label: t('Auf Seite verschieben'), run: () => {},
    items: ed.doc.pages.map((p, i) => item(`page:${i}`, p.name, () => ed.moveToPage(sel, i), i !== ed.doc.page)) });
  if (asms.length) out.push({ id: 'asm-page', label: t('Baugruppe auf Seite verschieben'), run: () => {},
    items: [...ed.doc.pages.map((p, i) => item(`asm-page:${i}`, p.name, () => ed.moveAsmToPage(asms, i), !ed.asmOnPage(asms, i), ed.asmOnPage(asms, i))),
      item('asm-page:new', t('Neue Seite'), () => ed.moveAsmToPage(asms, 'new'))] });
  return out;
}

/** Stacking order commands; shared by the canvas menu, the Objects window and the main menu. No default shortcuts. */
export function stackingActions(ed: Editor, editable = ed.sel.length > 0 && ed.sel.every((o) => ed.selectable(o))): ContextAction[] {
  const item = (id: string, label: string, dir: 'forward' | 'backward' | 'front' | 'back'): ContextAction =>
    ({ id, label, run: () => ed.restack(dir), enabled: editable && ed.canRestack(dir) });
  return [item('tofront', t('Ganz nach vorne'), 'front'), item('forward', t('Eine Ebene nach vorne'), 'forward'),
    item('backward', t('Eine Ebene nach hinten'), 'backward'), item('toback', t('Ganz nach hinten'), 'back')];
}

/**
 * Open the shared editor menu. Actions only run while the document and selection are unchanged since the
 * menu opened, and errors become a status hint instead of an unhandled rejection.
 */
export function openEditorContextMenu(ed: Editor, x: number, y: number, groups: ContextAction[][]) {
  const doc = ed.doc, stamp = ed.state();
  const guard = (items: ContextAction[]): ContextAction[] => items.map((item) => ({ ...item,
    items: item.items ? guard(item.items) : undefined,
    run: async () => {
      if (ed.doc !== doc || ed.state() !== stamp || document.querySelector('dialog[open]')) return;
      try { await item.run(); }
      catch (error) { ed.hint = error instanceof Error ? error.message : String(error); ed.emit('tool'); }
    } }));
  let close: () => void;
  // Pointer moves, zoom and panning only emit 'view'; they must not close the menu when the pointer leaves it.
  // Real changes still close it, and the guard above refuses actions after any change of document or selection.
  const changed = (what: 'doc' | 'sel' | 'view' | 'tool') => { if (what !== 'view') close?.(); };
  close = showEditorMenu(x, y, groups.map(guard), () => ed.off(changed));
  ed.on(changed);
}

export function installEditorContext(ed: Editor, callbacks: ContextCallbacks) {
  ed.onCanvasContext = (event) => {
    if (document.querySelector('dialog[open]') || ed.drag || ed.draft || ed.pickHandler || ed.tool === 'sketch' || ed.tool === 'builder') return;
    const { sx, sy } = ed.evPt(event);
    if (sx < RULER || sy < RULER) return;
    closeEditorMenu();
    const hit = ed.hitTest(ed.toWorld(sx, sy));
    if (hit && !ed.sel.includes(hit)) ed.setSel([hit]);
    if (ed.tool === 'node') ed.updateNodeHover(sx, sy);
    openEditorContextMenu(ed, event.clientX, event.clientY, editorContextGroups(ed, callbacks, !hit));
  };
}
