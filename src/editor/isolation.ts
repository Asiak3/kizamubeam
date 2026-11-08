import type { Editor } from '../editor';
import type { Obj } from '../model';
export interface IsolationState { ids: Set<number>; known: Set<number>; selection: number[] }

export class EditorIsolation {
  /** Isolation is session-only; hidden, locked, noLaser and document serialization are untouched. */
  isolateSelection(this: Editor): boolean {
    if (this.isolation || this.pickHandler) return false;
    const selected = this.sel.filter((o) => this.selectable(o));
    if (!selected.length || this.drag || this.draft || this.sketchEdit) return false;
    this.isolation = { ids: new Set(selected.map((o) => o.id)), known: new Set(this.doc.objs.map((o) => o.id)),
      selection: this.sel.map((o) => o.id) };
    this.setSel(selected); this.clearSnap(); this.emit('view'); this.emit('tool');
    return true;
  }
  leaveIsolation(this: Editor) {
    if (!this.isolation) return;
    if (this.drag) this.cancelDrag();
    const selected = new Set(this.isolation.selection);
    this.isolation = null;
    this.setSel(this.doc.objs.filter((o) => selected.has(o.id) && this.selectable(o)));
    this.clearSnap(); this.emit('view'); this.emit('tool');
  }
  viewObjects(this: Editor): Obj[] {
    return this.isolation ? this.doc.objs.filter((o) => this.isolation!.ids.has(o.id)) : this.doc.objs;
  }
  updateIsolation(this: Editor, what: string) {
    if (what === 'doc' && this.isolation) {
      // Adopt objects created inside isolation, never existing outside objects.
      for (const o of this.doc.objs) if (!this.isolation.known.has(o.id)) this.isolation.ids.add(o.id);
      this.isolation.known = new Set(this.doc.objs.map((o) => o.id));
    }
  }

}
