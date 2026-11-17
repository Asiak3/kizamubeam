import type { Editor } from '../editor';
import { apply, defaultLayer, IDENT, inv, isOff, newId, Node, Obj, Pt, Shape, SubPath } from '../model';
import { shapeSubs } from '../geom';
import { transformSubs } from '../importers';
import { fitPoints, FitOptions, MAX_VECTOR_SAMPLES, refitSubpath } from '../vectorFit';
import { t } from '../i18n';
import { vectorError } from '../vectorMessages';

// Property ordering must not turn an unchanged preview into an Undo step.
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);

export interface VectorPlan { obj: Obj; before: string; matrix: string; subs: SubPath[] }

/** Freihand-Pfad aus der Geste: eine Fit-Regel für Bleistift und Shaper-Fallback. */
export function freehandShape(points: Pt[], closed: boolean, tolerance: number): Shape | null {
  const sub = fitPoints(points, closed, { tolerance, curves: true, preserveCorners: true });
  if (sub.nodes.length < (closed ? 3 : 2)) return null;
  return { kind: 'path', subs: [sub] };
}

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

  finishPencil(this: Editor, points: Pt[], closed: boolean): Obj | null {
    try {
      if (points.length < 2 || points.every((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) < 0.01)) {
        this.hint = t('Kein Freihandpfad erstellt: zum Zeichnen ziehen, nicht nur klicken.'); this.emit('tool'); return null;
      }
      if (this.layer(this.currentLayer).locked || !this.layer(this.currentLayer).show) throw new Error(t('Eine sichtbare, entsperrte Ebene wählen.'));
      const shape = freehandShape(points, closed, this.pencilTolerance);
      if (!shape) {
        this.hint = t('Kein Freihandpfad erstellt: für einen geschlossenen Pfad eine Fläche zeichnen oder „Geschlossener Pfad“ ausschalten.'); this.emit('tool'); return null;
      }
      const nodes = shape.kind === 'path' ? shape.subs[0].nodes.length : 0;
      this.snapshot(t('Freihandpfad zeichnen'));
      const obj: Obj = { id: newId(), m: [...IDENT], layer: this.currentLayer, shape };
      this.doc.objs.push(obj);
      this.setSel([obj]);
      this.hint = t('Freihandpfad erstellt: {n} Knoten. Rückgängig mit Ctrl+Z.', { n: nodes });
      this.emit('doc');
      this.emit('tool');
      return obj;
    } catch (error) {
      this.hint = vectorError(error);
      this.emit('tool');
      return null;
    }
  }

  finishCurvature(this: Editor) {
    const d = this.draft;
    const cont = this.continuedFrom;
    this.draft = null;
    this.continuedFrom = null;
    if (!d || d.nodes.length < 2) {
      this.redraw();
      return;
    }
    const nodes = smoothAnchors(d.nodes, d.closed);
    this.snapshot(t('Kurvenpfad zeichnen'));
    if (cont) {
      const i = this.doc.objs.indexOf(cont);
      if (i >= 0) this.doc.objs.splice(i, 1);
    }
    const o: Obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [{ nodes, closed: d.closed }] } };
    this.doc.objs.push(o);
    this.emit('doc');
    this.setTool('select');
    this.setSel([o]);
  }

  /** Fortsetzbar: einfacher offener Pfad auf der aktiven Ebene (Top-Level, kein Generator-/Gruppenpfad). */
  continuableSub(this: Editor, o: Obj): SubPath | null {
    if (!this.doc.objs.includes(o) || !this.selectable(o)) return null;
    if (o.shape.kind !== 'path' || o.shape.mark || o.shape.subs.length !== 1) return null;
    const sub = o.shape.subs[0];
    if (sub.closed || sub.nodes.length < 2 || o.layer !== this.currentLayer) return null;
    if (!o.m.every(Number.isFinite)) return null;
    return sub;
  }

  /** Nächster fortsetzbarer Endpunkt in Bildschirmkoordinaten (8-px-Nähe wie Draft-Schließen). */
  continueHit(this: Editor, sx: number, sy: number): { o: Obj; end: 0 | -1 } | null {
    let best: { o: Obj; end: 0 | -1; d: number } | null = null;
    for (const o of this.doc.objs) {
      const sub = this.continuableSub(o);
      if (!sub) continue;
      const ends: [Pt, 0 | -1][] = [[sub.nodes[0], 0], [sub.nodes[sub.nodes.length - 1], -1]];
      for (const [n, end] of ends) {
        const f = this.toScreen(apply(o.m, n.x, n.y));
        const d = Math.hypot(f.x - sx, f.y - sy);
        if (d < 8 && (!best || d < best.d)) best = { o, end, d };
      }
    }
    return best;
  }

  /**
   * Pfad im Linien-/Kurvenwerkzeug fortsetzen: Knoten (welttransformiert) als
   * Draft übernehmen. Das Original bleibt bis zum Commit im Dokument, sodass
   * Esc nichts vernichtet; der Commit ersetzt es in einem Snapshot (ein Undo).
   */
  continuePath(this: Editor, o: Obj, end: 0 | -1): boolean {
    const sub = this.continuableSub(o);
    if (!sub || this.draft) return false;
    const nodes: Node[] = structuredClone(sub.nodes);
    for (const n of nodes) {
      const w = apply(o.m, n.x, n.y);
      n.x = w.x; n.y = w.y;
      if (n.cin) n.cin = apply(o.m, n.cin.x, n.cin.y);
      if (n.cout) n.cout = apply(o.m, n.cout.x, n.cout.y);
    }
    if (end === 0) {
      nodes.reverse();
      for (const n of nodes) { const c = n.cin; n.cin = n.cout; n.cout = c; }
    }
    const draft: SubPath = { nodes, closed: false };
    if (end !== 0 && sub.start) draft.start = true;
    this.continuedFrom = o;
    this.draft = draft;
    this.setSel([]);
    this.redraw();
    return true;
  }

  /**
   * Schließen per Loslassen: Wurde der Drag auf dem Startpunkt begonnen
   * (armed, force=true), entscheidet die Press-Stelle — Loslassen schließt
   * immer, der Drag formt nur die Schlusstangente (Pen-Tool-Verhalten).
   * Bei fremd gestarteten Drags (force=false) schließt nur Loslassen in
   * 8-px-Nähe wie Klick-Schließen. Gilt für Linien- und Kurvenwerkzeug;
   * der gezogene Knoten bleibt als letzte Ecke erhalten.
   */
  draftDropClose(this: Editor, sx: number, sy: number, force = false): boolean {
    if (this.tool !== 'line' && this.tool !== 'curvature') return false;
    const d = this.draft;
    if (!d || d.nodes.length < 2) return false;
    if (!force) {
      const f = this.toScreen(d.nodes[0]);
      if (Math.hypot(f.x - sx, f.y - sy) >= 8) return false;
    }
    d.closed = true;
    this.finishDraft();
    return true;
  }
}

/** Glättung für Klick-Anker analog setNodeType: tiefe Kopie, freie manuelle Anfasser, ohne Geister-Arme an offenen Enden. */
export function smoothAnchors(nodes: Node[], closed: boolean): Node[] {
  const pts: Node[] = nodes.map((n) => ({
    ...n,
    ...(n.cin ? { cin: { x: n.cin.x, y: n.cin.y } } : {}),
    ...(n.cout ? { cout: { x: n.cout.x, y: n.cout.y } } : {}),
  }));
  if (pts.length < 3) return pts;
  const N = pts.length;
  pts.forEach((p, i) => {
    const prev = i > 0 ? pts[i - 1] : closed ? pts[N - 1] : null;
    const next = i < N - 1 ? pts[i + 1] : closed ? pts[0] : null;
    // Bewusste Ecke (Klick ohne Ziehen): keine Auto-Arme. Altdaten ohne Flag
    // (smooth undefined) glätten weiter wie bisher.
    if (p.smooth === false && !p.cin && !p.cout) return;
    if (p.cin && p.cout) return;
    if (p.cout || p.cin) {
      const arm = (p.cout ?? p.cin)!;
      const vx = p.cout ? arm.x - p.x : p.x - arm.x;
      const vy = p.cout ? arm.y - p.y : p.y - arm.y;
      const l = Math.hypot(vx, vy);
      if (l > 0) {
        const ux = vx / l, uy = vy / l;
        if (!p.cin && prev) {
          const lp = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
          if (lp > 0) p.cin = { x: p.x - ux * lp, y: p.y - uy * lp };
        }
        if (!p.cout && next) {
          const ln = Math.hypot(next.x - p.x, next.y - p.y) / 3;
          if (ln > 0) p.cout = { x: p.x + ux * ln, y: p.y + uy * ln };
        }
        if (p.cin && p.cout) p.smooth = true;
      }
      return;
    }
    const a = prev ?? p, b = next ?? p;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    if (!(l > 0)) return;
    const ux = dx / l, uy = dy / l;
    if (prev) {
      const lp = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
      if (lp > 0) p.cin = { x: p.x - ux * lp, y: p.y - uy * lp };
    }
    if (next) {
      const ln = Math.hypot(next.x - p.x, next.y - p.y) / 3;
      if (ln > 0) p.cout = { x: p.x + ux * ln, y: p.y + uy * ln };
    }
    if (p.cin || p.cout) p.smooth = true;
  });
  return pts;
}

/** Live-Vorschau für das Kurvenwerkzeug: über Startpunkt geschlossen (auch beim Ziehen), sonst mit Cursor-Punkt, beim Ziehen offen. */
export function curvaturePreview(draft: SubPath, cursor: Pt | null, closeHit: boolean): SubPath {
  if (closeHit) return { nodes: smoothAnchors(draft.nodes, true), closed: true };
  if (!cursor) return { nodes: smoothAnchors(draft.nodes, false), closed: false };
  return { nodes: smoothAnchors([...draft.nodes, { x: cursor.x, y: cursor.y }], false), closed: false };
}
