// Editor: Befehle: Löschen, Kopieren, Einfügen, Transformieren, Formparameter.
import { about, clone, cloneObjs, homeLayer, Mat, mul, Pt, rotate, scale, translate, visibleLeaves } from '../model';
import type { Editor } from '../editor';
import { t } from '../i18n';
import { genLeaves } from './generators';
import { copyMultiLayers, pruneMultiLayers } from '../multilayer';

export class EditorCommands {
  deleteSel(this: Editor) {
    if (!this.sel.length) return;
    this.snapshot(t('Löschen'));
    this.doc.objs = this.doc.objs.filter((o) => !this.sel.includes(o));
    pruneMultiLayers(this.doc);
    this.setSel([]);
    this.emit('doc');
  }
  selectAll(this: Editor) {
    this.setSel(this.doc.objs.filter((o) => this.selectable(o)));
  }
  selectLayer(this: Editor, i: number) {
    this.setSel(this.doc.objs.filter((o) => this.selectable(o) && [...visibleLeaves([o])].some(([l]) => l.layer === i)));
  }
  /** Objekte auf den Layern der Auswahl auswählen; Layer eines Objekts wie bei „Auf Layer verschieben“ (homeLayer) */
  selectLayerObjects(this: Editor) {
    const layers = new Set(this.sel.map(homeLayer));
    if (!layers.size) return;
    this.setSel(this.doc.objs.filter((o) => this.selectable(o) && [...visibleLeaves([o])].some(([l]) => layers.has(l.layer))));
  }
  copy(this: Editor) {
    this.clipboard = this.sel.map((o) => clone(o));
    // System-Zwischenablage überschreiben, damit danach nicht ein älteres Bild aus einem anderen Programm eingefügt wird
    navigator.clipboard?.writeText('').catch(() => undefined);
  }
  async onPaste(this: Editor, e: ClipboardEvent) {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    clearTimeout(this.pasteTimer);
    e.preventDefault();
    const data = e.clipboardData;
    if (data && this.externalPaste && (await this.externalPaste(data))) return;
    this.paste();
  }
  cut(this: Editor) {
    if (!this.sel.length) return;
    this.copy();
    this.deleteSel();
    this.history.relabel(t('Ausschneiden'));
  }
  paste(this: Editor, offset = 5) {
    if (!this.clipboard.length) return;
    this.snapshot(t('Einfügen'));
    const objs = cloneObjs(this.clipboard).map((c) => {
      c.m = mul(translate(offset, offset), c.m);
      return c;
    });
    this.clipboard = objs.map((o) => clone(o));
    this.doc.objs.push(...objs);
    this.setSel(objs);
    this.emit('doc');
  }
  duplicate(this: Editor) {
    if (!this.sel.length) return;
    this.snapshot(t('Duplizieren'));
    const objs = cloneObjs(this.sel);
    this.doc.objs.push(...objs);
    copyMultiLayers(this.doc, this.sel.map((o, i) => [o, objs[i]] as const));
    this.setSel(objs);
    this.emit('doc');
  }
  /** Weltmatrix auf alle ausgewählten Objekte anwenden. */
  /** snap: Undo-Schritt anlegen (true oder dessen Name) */
  transformSel(this: Editor, D: Mat, snap: boolean | string = true) {
    if (!this.sel.length) return;
    if (snap) this.snapshot(typeof snap === 'string' ? snap : t('Transformieren'));
    this.sel.forEach((o) => (o.m = mul(D, o.m)));
    this.emit('doc');
    this.emit('sel');
  }
  nudge(this: Editor, dx: number, dy: number) {
    this.transformSel(translate(dx, dy), t('Verschieben'));
  }
  mirror(this: Editor, horizontal: boolean) {
    const b = this.selBounds();
    if (!b) return;
    this.transformSel(about(horizontal ? scale(-1, 1) : scale(1, -1), b.x + b.w / 2, b.y + b.h / 2), t('Spiegeln'));
  }
  rotateBy(this: Editor, deg: number, anchor?: Pt) {
    const b = this.selBounds();
    if (!b) return;
    const c = anchor ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Positive Werte drehen gegen den Uhrzeigersinn (Maschinensicht, y nach oben)
    this.transformSel(about(rotate((-deg * Math.PI) / 180), c.x, c.y), t('Drehen'));
  }
  /** Formparameter (Eckenradius, Seiten …) der Auswahl ändern */
  updateShapes(this: Editor, kind: 'rect' | 'polygon', patch: Record<string, number | boolean>) {
    if (kind === 'rect' && typeof patch.r === 'number') this.rectRadius = patch.r;
    if (kind === 'polygon') {
      if (typeof patch.sides === 'number') this.polySides = patch.sides;
      if (typeof patch.star === 'boolean') this.polyStar = patch.star;
    }
    const objs = this.sel.filter((o) => o.shape.kind === kind);
    if (!objs.length) return;
    this.snapshot(t('Form-Eigenschaften'));
    objs.forEach((o) => {
      Object.assign(o.shape, patch);
      this.touch(o.shape);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Numerische Felder: Auswahl auf neue Position/Größe bringen (Weltkoordinaten, Anker 0..1). */
  setSelBox(this: Editor, next: { x?: number; y?: number; w?: number; h?: number }, ax: number, ay: number, lock: boolean) {
    const b = this.selBounds();
    if (!b) return;
    let sx = 1,
      sy = 1;
    if (next.w !== undefined && b.w > 1e-9) sx = next.w / b.w;
    if (next.h !== undefined && b.h > 1e-9) sy = next.h / b.h;
    if (lock) {
      if (next.w !== undefined) sy = sx;
      else if (next.h !== undefined) sx = sy;
    }
    if (!isFinite(sx) || !isFinite(sy) || sx <= 0 || sy <= 0) return;
    if ((Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9) && genLeaves(this.sel).length) {
      // Größe parametrischer Bauteile kommt aus ihren Parametern: erst fragen, dann umgewandelt skalieren
      if (this.agentCall) throw new Error(this.genChangeError(this.sel));
      void this.guardGen(this.sel, t('Größe ändern')).then((ok) => ok && this.setSelBox(next, ax, ay, lock));
      return;
    }
    const A = { x: b.x + ax * b.w, y: b.y + ay * b.h };
    let D = about(scale(sx, sy), A.x, A.y);
    const tx = next.x !== undefined ? next.x - A.x : 0;
    const ty = next.y !== undefined ? next.y - A.y : 0;
    D = mul(translate(tx, ty), D);
    this.transformSel(D, t('Position/Größe'));
  }
}
