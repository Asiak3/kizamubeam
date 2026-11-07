import type { Editor } from './editor';
export const canEnterIsolation = (ed: Editor): boolean => !ed.isolation && !ed.drag && !ed.draft && !ed.sketchEdit &&
  !ed.pickHandler && ed.sel.length > 0 && ed.sel.every((o) => ed.selectable(o));
