// Editor: Hilfslinien aus dem Lineal. Sie sind keine Objekte, sondern eine eigene Ebene „Hilfslinien“:
// nie gelasert oder exportiert, ausblendbar und sperrbar, Objekte fangen an ihnen.
import { Guide } from '../model';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { RULER } from './shared';

/** Abstand in Bildschirmpixeln, ab dem eine Hilfslinie gegriffen wird */
const GRAB_PX = 4;

export class EditorGuides {
  /** Hilfslinien des Projekts (gelten für alle Seiten) */
  guideList(this: Editor): Guide[] {
    return this.doc.guides ?? [];
  }
  guidesShown(this: Editor): boolean {
    return !this.doc.guidesHidden;
  }
  /** Bildschirmlage einer Hilfslinie (x bei senkrechten, y bei waagrechten) */
  guideScreen(this: Editor, g: Guide): number {
    return g.axis === 'x' ? this.toScreen({ x: g.v, y: 0 }).x : this.toScreen({ x: 0, y: g.v }).y;
  }
  /** Hilfslinie unter dem Mauszeiger, die sich verschieben lässt (sichtbar, nicht gesperrt), sonst -1 */
  guideAt(this: Editor, sx: number, sy: number): number {
    if (this.doc.guidesHidden || this.doc.guidesLocked || sx < RULER || sy < RULER) return -1;
    const list = this.guideList();
    let best = -1,
      bd = GRAB_PX;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = Math.abs(this.guideScreen(list[i]) - (list[i].axis === 'x' ? sx : sy));
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  /** Neue Hilfslinie anhängen (vorher snapshot) und ihren Index liefern; eine ausgeblendete Ebene wird wieder sichtbar */
  pushGuide(this: Editor, g: Guide): number {
    (this.doc.guides ??= []).push(g);
    delete this.doc.guidesHidden;
    return this.doc.guides.length - 1;
  }
  removeGuide(this: Editor, i: number) {
    const list = this.doc.guides;
    if (!list) return;
    list.splice(i, 1);
    if (!list.length) delete this.doc.guides;
  }
  /** Ebene „Hilfslinien“ ein-/ausblenden oder sperren */
  setGuideLayer(this: Editor, patch: { hidden?: boolean; locked?: boolean }) {
    this.snapshot(t('Hilfslinien'));
    if (patch.hidden !== undefined) {
      if (patch.hidden) this.doc.guidesHidden = true;
      else delete this.doc.guidesHidden;
    }
    if (patch.locked !== undefined) {
      if (patch.locked) this.doc.guidesLocked = true;
      else delete this.doc.guidesLocked;
    }
    this.emit('doc');
  }
  /** Alle Hilfslinien löschen */
  clearGuides(this: Editor) {
    if (!this.doc.guides?.length) return;
    this.snapshot(t('Hilfslinien löschen'));
    delete this.doc.guides;
    this.emit('doc');
  }
  /** Hilfslinien über die ganze Arbeitsfläche zeichnen (Bildschirmkoordinaten) */
  renderGuides(this: Editor, ctx: CanvasRenderingContext2D) {
    const list = this.guideList();
    if (!list.length || this.doc.guidesHidden) return;
    const d = this.drag;
    const active = d?.type === 'guide' ? d.idx : null;
    ctx.save();
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1;
    ctx.globalAlpha = this.doc.guidesLocked ? 0.6 : 0.9;
    ctx.setLineDash([6, 4]);
    const line = (g: Guide) => {
      const s = Math.round(this.guideScreen(g)) + 0.5;
      if (g.axis === 'x') {
        ctx.moveTo(s, RULER);
        ctx.lineTo(s, this.h);
      } else {
        ctx.moveTo(RULER, s);
        ctx.lineTo(this.w, s);
      }
    };
    ctx.beginPath();
    list.forEach((g, i) => i !== active && line(g));
    ctx.stroke();
    if (active !== null && list[active]) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      line(list[active]);
      ctx.stroke();
    }
    ctx.restore();
  }
}
