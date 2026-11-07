import type { Editor } from '../editor';
import { defaultLayer, inv, isOff, Obj, SubPath } from '../model';
import { shapeSubs } from '../geom';
import { transformSubs } from '../importers';
import { FitOptions, MAX_VECTOR_SAMPLES, refitSubpath } from '../vectorFit';
import { t } from '../i18n';

// Property ordering must not turn an unchanged preview into an Undo step.
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);

export interface VectorPlan { obj: Obj; before: string; matrix: string; subs: SubPath[] }

export class EditorVector {
  vectorFitTargets(this: Editor): Obj[] {
    return this.sel.filter((o) => this.doc.objs.includes(o) && !o.locked && !isOff(o) &&
      !(this.doc.layers[o.layer] ?? defaultLayer(o.layer)).locked && (this.doc.layers[o.layer] ?? defaultLayer(o.layer)).show &&
      ['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind) && o.m.every(Number.isFinite) &&
      Math.abs(o.m[0] * o.m[3] - o.m[1] * o.m[2]) > 1e-12);
  }

  previewVectorFit(this: Editor, options: FitOptions): { before: number; after: number } {
    this.vectorPreview = null;
    const targets = this.vectorFitTargets();
    if (!targets.length) throw new Error(t('Zuerst bearbeitbare Pfade oder Grundformen auswählen. Text/Generatoren ausdrücklich umwandeln und Gruppen auflösen.'));
    const plan: VectorPlan[] = [];
    let before = 0, after = 0;
    for (const obj of targets) {
      const world = transformSubs(shapeSubs(obj.shape), obj.m);
      const subs = world.map((sp) => refitSubpath(sp, options));
      before += world.reduce((n, s) => n + s.nodes.length, 0);
      after += subs.reduce((n, s) => n + s.nodes.length, 0);
      if (before > MAX_VECTOR_SAMPLES || after > MAX_VECTOR_SAMPLES) throw new Error(t('Auswahl überschreitet 16.384 Knoten; weniger Pfade auswählen.'));
      plan.push({ obj, before: canonical(obj.shape), matrix: JSON.stringify(obj.m), subs });
    }
    this.vectorPreview = plan;
    this.redraw();
    return { before, after };
  }

  applyVectorFit(this: Editor): boolean {
    const plan = this.vectorPreview;
    if (!plan?.length) return false;
    if (plan.some((p) => !this.vectorFitTargets().includes(p.obj) || canonical(p.obj.shape) !== p.before || JSON.stringify(p.obj.m) !== p.matrix))
      throw new Error(t('Auswahl oder Quelle geändert. Vorschau vor dem Übernehmen aktualisieren.'));
    const results = plan.map((p) => {
      const subs = transformSubs(p.subs, inv(p.obj.m));
      return { p, shape: p.obj.shape.kind === 'path' ? { ...p.obj.shape, subs } : { kind: 'path' as const, subs } };
    });
    if (results.every(({ p, shape }) => p.before === canonical(shape))) {
      this.vectorPreview = null; this.redraw(); return false;
    }
    this.snapshot(t('Pfade vereinfachen / glätten'));
    for (const { p, shape } of results) { p.obj.shape = shape; this.touch(p.obj.shape); }
    this.vectorPreview = null;
    this.clearNodeSel();
    this.nodeHover = this.segHover = null;
    this.emit('doc');
    return true;
  }

}
