import type { Editor } from '../editor';
import { Obj, newId } from '../model';
import { closedCount, openSubs } from '../ops';
import { ShapeRegion, shapeRegions, regionContains, regionsAlong, mergeRegions, regionObject } from '../shapeRegions';
import { t } from '../i18n';

export interface BuilderSession {
  sources: Obj[]; faces: ShapeRegion[]; stamp: string; keepOriginals: boolean;
  hover: number; picked: Set<number>; erase: boolean;
}
export interface IsolationState { ids: Set<number>; known: Set<number>; selection: number[] }

export class EditorInteraction {
  /** Isolation is session-only; hidden, locked, noLaser and document serialization are untouched. */
  isolateSelection(this: Editor): boolean {
    if (this.isolation || this.pickHandler) return false;
    const selected = this.sel.filter((o) => this.selectable(o));
    if (!selected.length || this.drag || this.draft || this.sketchEdit) return false;
    if (this.tool === 'builder') this.setTool('select');
    this.builderSession = null;
    this.isolation = { ids: new Set(selected.map((o) => o.id)), known: new Set(this.doc.objs.map((o) => o.id)),
      selection: this.sel.map((o) => o.id) };
    this.setSel(selected); this.clearSnap(); this.emit('view'); this.emit('tool');
    return true;
  }
  leaveIsolation(this: Editor) {
    if (!this.isolation) return;
    if (this.drag) this.cancelDrag();
    if (this.tool === 'builder') this.setTool('select');
    const selected = new Set(this.isolation.selection);
    this.isolation = null; this.builderSession = null;
    this.setSel(this.doc.objs.filter((o) => selected.has(o.id) && this.selectable(o)));
    this.clearSnap(); this.emit('view'); this.emit('tool');
  }
  viewObjects(this: Editor): Obj[] {
    return this.isolation ? this.doc.objs.filter((o) => this.isolation!.ids.has(o.id)) : this.doc.objs;
  }
  updateInteraction(this: Editor, what: string) {
    if (what === 'doc' && this.isolation) {
      // Adopt objects created inside isolation, never existing outside objects.
      for (const o of this.doc.objs) if (!this.isolation.known.has(o.id)) this.isolation.ids.add(o.id);
      this.isolation.known = new Set(this.doc.objs.map((o) => o.id));
    }
    if ((what === 'doc' || what === 'sel') && this.builderSession && this.builderSession.stamp !== this.state()) this.builderSession = null;
  }

  async startShapeBuilder(this: Editor): Promise<boolean> {
    const inputs = this.doc.objs.filter((o) => this.sel.includes(o));
    const say = (message: string) => { this.hint = message; this.emit('tool'); return false; };
    if (!inputs.length || this.drag || this.draft || this.sketchEdit || this.pickHandler || inputs.some((o) => !this.selectable(o)))
      return say(t('Für Formerstellung sichtbare, entsperrte Formen auswählen und laufende Bearbeitung beenden.'));
    if (inputs.some((o) => o.shape.kind === 'group'))
      return say(t('Gruppen werden im Formerstellungs-Teststand nicht aufgelöst. Einzelne Formen oder parametrische Bauteile auswählen.'));
    if (inputs.some((o) => !!o.noLaser !== !!inputs[0].noLaser))
      return say(t('Für Formerstellung müssen die Originale denselben „Nicht lasern“-Status haben.'));
    const doc = this.doc, before = this.state(), tool = this.tool, isolation = this.isolation;
    const copied = await this.withTextOutlines(inputs);
    if (this.doc !== doc || this.state() !== before || this.tool !== tool || this.isolation !== isolation ||
      this.drag || this.draft || this.sketchEdit || this.pickHandler)
      return say(t('Auswahl oder Dokument geändert. Formerstellung erneut starten.'));
    if (copied.some((o) => !closedCount(o) || openSubs(o).length))
      return say(t('Dieser Teststand der Formerstellung unterstützt geschlossene Flächen ohne offene Linien oder Bilder.'));
    let faces: ShapeRegion[];
    try { faces = shapeRegions(copied); }
    catch { return say(t('Arbeitsgrenze der Formerstellung erreicht. Weniger oder einfachere Formen auswählen.')); }
    if (!faces.length) return false;
    this.setTool('builder');
    this.builderSession = { sources: inputs, faces, stamp: this.state(), keepOriginals: true,
      hover: -1, picked: new Set(), erase: false };
    this.hint = t('Formerstellung: Flächen anklicken oder überstreichen; Alt entfernt Flächen. Erste Übernahme behält Originale und setzt sie auf „Nicht lasern“. Esc beendet.');
    this.emit('tool');
    return true;
  }
  builderHover(this: Editor, x: number, y: number) {
    const session = this.builderSession;
    if (!session) return;
    session.hover = session.faces.findIndex((f) => regionContains(f, x, y));
    this.redraw();
  }
  builderStroke(this: Editor, a: { x: number; y: number }, b: { x: number; y: number }) {
    const session = this.builderSession;
    if (!session) return;
    for (const id of regionsAlong(session.faces, a, b)) session.picked.add(id);
    this.redraw();
  }
  commitShapeBuilder(this: Editor): boolean {
    const s = this.builderSession;
    if (!s || !s.picked.size || s.stamp !== this.state() || s.sources.some((o) => !this.selectable(o))) return false;
    const picked = s.faces.filter((_, i) => s.picked.has(i));
    const faces = s.faces.filter((_, i) => !s.picked.has(i));
    if (!s.erase) for (const subs of mergeRegions(picked)) faces.push({ subs, layer: picked[0].layer });
    const output = faces.map((f) => regionObject(f, newId()));
    if (s.sources[0]?.noLaser) for (const o of output) o.noLaser = true;
    this.snapshot(s.erase ? t('Formerstellung: Flächen entfernen') : t('Formerstellung: Flächen verbinden'));
    if (s.keepOriginals) for (const o of s.sources) o.noLaser = true;
    else this.doc.objs = this.doc.objs.filter((o) => !s.sources.includes(o));
    this.doc.objs.push(...output);
    this.setSel(output);
    this.builderSession = { sources: output, faces, stamp: this.state(), keepOriginals: false,
      hover: -1, picked: new Set(), erase: false };
    this.emit('doc');
    return true;
  }
}
