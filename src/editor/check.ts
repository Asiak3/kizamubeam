// Editor: Konstruktion prüfen (Befunde berechnen, auswählen, Korrekturen anwenden). Die Prüfungen selbst stehen in src/check.ts.
import { clone, Obj, translate } from '../model';
import { shapeSubs } from '../geom';
import { CheckIssue, checkDesign, loadCheckSettings, removeSpans } from '../check';
import type { Editor } from '../editor';
import { t } from '../i18n';
import { genLeaves } from './generators';
import { buildGen, getGenerator, normalizeParams } from '../generators/index';
import type { Params } from '../generators/types';

export class EditorCheck {
  /** Aktuelle Seite prüfen; ausgeblendete Befunde fallen weg. Ergebnis steht danach in checkIssues. */
  runCheck(this: Editor): CheckIssue[] {
    const issues = checkDesign({
      objs: this.doc.objs, allObjs: this.doc.pages.flatMap((pg) => pg.objs), layer: (i) => this.layer(i), bed: this.doc.bed, settings: loadCheckSettings(), skipBed: !this.checkBedApplies(),
    });
    this.checkIssues = issues.filter((x) => !this.checkIgnored.has(x.key));
    if (this.checkActive) this.checkActive = this.checkIssues.find((x) => x.key === this.checkActive!.key) ?? null;
    this.redraw();
    return this.checkIssues;
  }

  /** Befund anklicken: betroffene Objekte auswählen und die Stelle in den sichtbaren Bereich holen */
  focusIssue(this: Editor, x: CheckIssue) {
    this.checkActive = x;
    const objs = x.objs.filter((o) => this.doc.objs.includes(o) && this.selectable(o));
    this.setSel(objs);
    const pts = [...x.lines.flat(), ...x.pts];
    if (!pts.length) return this.redraw();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const a = this.toWorld(0, 0),
      b = this.toWorld(this.w, this.h);
    const visible = x0 >= a.x && y0 >= a.y && x1 <= b.x && y1 <= b.y;
    // Winzige Stellen (Stege, Lücken) so weit vergrößern, dass man sie sieht
    const tiny = (x1 - x0) * this.view.zoom < 12 && (y1 - y0) * this.view.zoom < 12;
    if (!visible || tiny) {
      const pad = Math.max(2, (x1 - x0 + y1 - y0) * 0.25);
      this.zoomBox({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }, 60);
    } else this.redraw();
  }

  /** Befund für diese Sitzung ausblenden */
  ignoreIssue(this: Editor, x: CheckIssue) {
    this.checkIgnored.add(x.key);
    if (this.checkActive?.key === x.key) this.checkActive = null;
    this.runCheck();
  }

  /** Korrektur eines Befunds anwenden; false = nichts geändert (abgebrochen oder nicht mehr möglich) */
  async applyCheckFix(this: Editor, x: CheckIssue): Promise<boolean> {
    const f = x.fix;
    if (!f) return false;
    const alive = (o: Obj) => this.doc.objs.includes(o);
    switch (f.kind) {
      case 'delete': {
        const objs = f.objs.filter(alive);
        if (!objs.length) return false;
        this.snapshot(t('Doppeltes Objekt löschen'));
        this.doc.objs = this.doc.objs.filter((o) => !objs.includes(o));
        this.setSel(this.sel.filter(alive));
        break;
      }
      case 'spans': {
        // Formen, deren Abschnitte entfernt werden, werden zu Pfaden; Bauteile aus Generatoren erst nach Rückfrage
        const leaves = new Set(f.items.map((it) => it.leaf));
        const tops = this.doc.objs.filter((o) => [...leaves].some((l) => contains(o, l)));
        if (!tops.length) return false;
        const gens = genLeaves(tops).filter((g) => leaves.has(g));
        if (gens.length && !(await this.guardGen(gens, t('Doppelte Linien entfernen')))) return false;
        this.snapshot(t('Doppelte Linien entfernen'));
        const empty = new Set<Obj>();
        for (const leaf of leaves) {
          const subs = shapeSubs(leaf.shape);
          const next = subs.flatMap((sp, i) => {
            const spans = f.items.filter((it) => it.leaf === leaf && it.sub === i).flatMap((it) => it.spans);
            return spans.length ? removeSpans(sp, spans) : [clone(sp)];
          });
          leaf.shape = { kind: 'path', subs: next };
          this.touch(leaf.shape);
          if (!next.length) empty.add(leaf);
        }
        if (empty.size) this.doc.objs = dropLeaves(this.doc.objs, empty);
        this.setSel(this.sel.filter(alive));
        break;
      }
      case 'close':
        this.setSel(f.objs.filter(alive));
        if (!this.closeSel(f.tol, 'line').closed) return false;
        return this.afterFix();
      case 'join':
        this.setSel(f.objs.filter(alive));
        if (!this.joinSel(f.tol)) return false;
        return this.afterFix();
      case 'bed': {
        const objs = f.objs.filter(alive);
        if (!objs.length) return false;
        this.setSel(objs);
        this.transformSel(translate(f.dx, f.dy), t('Aufs Bett schieben'));
        return this.afterFix();
      }
      case 'gen': {
        const o = f.obj;
        if (o.shape.kind !== 'gen' || !this.doc.objs.some((x) => contains(x, o))) return false;
        const g = getGenerator(o.shape.gen);
        if (!g) return false;
        const r = buildGen(g, { ...normalizeParams(g, o.shape.params), ...f.patch } as Params);
        const err = r.issues.find((i) => i.level === 'error');
        if (err || !r.parts.length) {
          this.hint = err?.msg ?? t('Bauteil ließ sich mit diesen Werten nicht erzeugen.');
          this.emit('tool');
          return false;
        }
        this.updateGen(o, r);
        break;
      }
      case 'note':
        this.snapshot(t('Import-Hinweis ausblenden'));
        for (const o of f.objs) delete o.importNote;
        break;
    }
    this.emit('doc');
    return this.afterFix();
  }

  afterFix(this: Editor): boolean {
    this.checkActive = null;
    this.runCheck();
    return true;
  }
}

function contains(o: Obj, leaf: Obj): boolean {
  if (o === leaf) return true;
  return o.shape.kind === 'group' && o.shape.children.some((c) => contains(c, leaf));
}

/** Leere Formen entfernen, ebenso Gruppen, die dadurch leer werden */
function dropLeaves(objs: Obj[], drop: Set<Obj>): Obj[] {
  return objs.flatMap((o) => {
    if (drop.has(o)) return [];
    if (o.shape.kind !== 'group') return [o];
    o.shape.children = dropLeaves(o.shape.children, drop);
    return o.shape.children.length ? [o] : [];
  });
}

