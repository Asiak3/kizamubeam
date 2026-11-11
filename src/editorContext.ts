import type { Editor } from './editor';
import { t } from './i18n';
import { ContextAction, showEditorMenu, closeEditorMenu } from './contextMenu';
import { RULER } from './editor/shared';

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
  return [common, organize, images.length ? imageActions : vectorActions, [arrange,
    action('library', t('Zur Bibliothek hinzufügen …'), callbacks.library, count > 0),
    { ...action('no-laser', t('Nicht lasern'), () => ed.toggleNoLaser(), editable), checked: !!count && ed.sel.every((o) => o.noLaser) }],
  [action('preview', t('Vorschau …'), callbacks.preview), windows]];
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
    const doc = ed.doc, stamp = ed.state(), groups = editorContextGroups(ed, callbacks, !hit);
    const guard = (items: ContextAction[]): ContextAction[] => items.map((item) => ({ ...item,
      items: item.items ? guard(item.items) : undefined,
      run: async () => {
        if (ed.doc !== doc || ed.state() !== stamp || document.querySelector('dialog[open]')) return;
        try { await item.run(); }
        catch (error) { ed.hint = error instanceof Error ? error.message : String(error); ed.emit('tool'); }
      } }));
    let close: () => void;
    const changed = () => close?.();
    close = showEditorMenu(event.clientX, event.clientY, groups.map(guard), () => ed.off(changed));
    ed.on(changed);
  };
}
