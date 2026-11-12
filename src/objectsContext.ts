// Context menu for rows in the Objects window (issue #216). Objects reuse the canvas menu from
// editorContext.ts and get a short block of entries on top that only make sense in the tree.
// This module builds the entries only; objectsPanel.ts decides the selection and opens the menu.
import type { Editor } from './editor';
import { t } from './i18n';
import { homeLayer, Obj } from './model';
import { ContextAction } from './contextMenu';
import { ContextCallbacks, editorContextGroups, MOVE_IDS, moveActions } from './editorContext';

/** Panel features the menu needs but which live in dialogs or in the panel's own state */
export interface ObjectsMenuHooks {
  showIf: (objs: Obj[]) => void;
  layerSettings: (layer: number) => void;
}

export type ObjectsRowTarget =
  | { kind: 'obj'; obj: Obj; top: Obj; rename: () => void; group?: { open: boolean; toggle: () => void } }
  | { kind: 'layer'; layer: number }
  | { kind: 'page'; page: number; rename: () => void };

const action = (id: string, label: string, run: ContextAction['run'], enabled = true): ContextAction => ({ id, label, run, enabled });

/** Entries for an object that cannot be selected: only what makes it reachable again */
function blockedObjectGroups(ed: Editor, obj: Obj, top: Obj, rename: () => void): ContextAction[][] {
  const reach: ContextAction[] = [];
  const hiddenOwner = obj.hidden ? obj : top.hidden ? top : null;
  if (hiddenOwner) reach.push(action('obj-show', t('Einblenden'), () => ed.setObjProps([hiddenOwner], { hidden: false })));
  if (top.locked) reach.push(action('obj-unlock', t('Entsperren'), () => ed.setObjProps([top], { locked: false })));
  const L = homeLayer(top), layer = ed.layer(L);
  if (!layer.show) reach.push(action('layer-show', t('Layer einblenden'), () => (ed.updateLayer(L, { show: true }), ed.dropUnselectable())));
  if (layer.locked) reach.push(action('layer-unlock', t('Layer entsperren'), () => (ed.updateLayer(L, { locked: false }), ed.dropUnselectable())));
  if (ed.isolation && !ed.isolation.ids.has(top.id)) reach.push(action('isolate-leave', t('Isolation verlassen'), () => ed.leaveIsolation()));
  return [reach, [action('rename', t('Umbenennen …'), rename)]];
}

function objectGroups(ed: Editor, callbacks: ContextCallbacks, hooks: ObjectsMenuHooks,
  target: Extract<ObjectsRowTarget, { kind: 'obj' }>): ContextAction[][] {
  const { obj, top } = target;
  if (!ed.selectable(top)) return blockedObjectGroups(ed, obj, top, target.rename);
  const sel = ed.sel, child = obj !== top;
  const head: ContextAction[] = [];
  if (child || sel.length === 1) head.push(action('rename', t('Umbenennen …'), target.rename));
  head.push(action('zoomsel', t('Auf Auswahl zoomen'), () => ed.zoomSelection()));
  head.push(child
    ? { ...action('obj-hide', t('Ausblenden'), () => ed.setObjProps([obj], { hidden: !obj.hidden })), checked: !!obj.hidden }
    : action('obj-hide', t('Ausblenden'), () => ed.setObjProps(sel, { hidden: true })));
  head.push(...moveActions(ed, true));
  head.push(action('showif', t('Sichtbar, wenn …'), () => hooks.showIf(sel)));
  const group: ContextAction[] = [];
  if (target.group) {
    const g = target.group;
    group.push(action('group-toggle', g.open ? t('Gruppe zuklappen') : t('Gruppe aufklappen'), g.toggle));
  }
  // "Isolate selection" comes with the canvas menu below; it also offers "Leave isolation" while isolated
  const canvas = editorContextGroups(ed, callbacks)
    .map((items) => items.filter((item) => item.id !== 'objects' && !MOVE_IDS.has(item.id)))
    .filter((items) => items.length);
  return [head, group, ...canvas];
}

function layerGroups(ed: Editor, hooks: ObjectsMenuHooks, i: number): ContextAction[][] {
  const L = ed.layer(i);
  return [
    [action('layer-select', t('Objekte dieses Layers auswählen'), () => ed.selectLayer(i)),
      action('layer-settings', t('Einstellungen …'), () => hooks.layerSettings(i))],
    [action('layer-output', L.output ? t('Layer nicht lasern (Ausgabe aus)') : t('Layer wieder lasern (Ausgabe an)'),
      () => ed.updateLayer(i, { output: !L.output })),
    action('layer-show', L.show ? t('Layer ausblenden') : t('Layer einblenden'), () => (ed.updateLayer(i, { show: !L.show }), ed.dropUnselectable())),
    action('layer-lock', L.locked ? t('Layer entsperren') : t('Layer sperren (Objekte nicht auswählbar)'),
      () => (ed.updateLayer(i, { locked: !L.locked }), ed.dropUnselectable()))],
  ];
}

function pageGroups(ed: Editor, page: number, rename: () => void): ContextAction[][] {
  const multi = ed.doc.pages.length > 1;
  return [
    [action('page-open', t('Zu dieser Seite wechseln'), () => ed.setPage(page), page !== ed.doc.page),
      action('rename', t('Umbenennen …'), rename)],
    [action('page-duplicate', t('Seite duplizieren'), () => ed.duplicatePage(page)),
      action('page-delete', t('Seite löschen'), () => ed.deletePage(page), multi)],
  ];
}

export function objectsContextGroups(ed: Editor, callbacks: ContextCallbacks, hooks: ObjectsMenuHooks, target: ObjectsRowTarget): ContextAction[][] {
  if (target.kind === 'layer') return layerGroups(ed, hooks, target.layer);
  if (target.kind === 'page') return pageGroups(ed, target.page, target.rename);
  return objectGroups(ed, callbacks, hooks, target);
}
