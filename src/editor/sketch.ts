// Editor: Skizzenmodus. Eine Skizze (Generator-Objekt gen 'sketch') wird mit Doppelklick geöffnet; Linien, Rechtecke,
// Kreise und Bögen zeichnen, Beziehungen und Bemaßungen setzen, Punkte ziehen. Der Löser (PlaneGCS) hält alle
// Beziehungen ein. Jede Änderung ist ein Undo-Schritt; der Umriss des Objekts wird sofort neu gebaut.
import { apply, inv, Mat, newId, Obj, Pt, translate, visibleLeaves } from '../model';
import type { GenShape } from '../model';
import {
  addArc, addCircle, addCon, addLine, addPt, cloneSketch, ConType, deleteIds, emptySketch, entOf, isDim, measureCon, parseSketch,
  pointPair, ptOf, Sketch, SkCon, SkEnt, sketchJson, sketchSubs,
} from '../sketch/model';
import { loadSolver, solveSketch, SolveResult, solverReady } from '../sketch/solver';
import { evaluate, renameInExpr, Scope, scopeOf, usesName } from '../params';
import type { Issue } from '../generators';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { SNAP_PX } from './shared';

export type SkTool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'dim';

/** Was unter dem Mauszeiger liegt: Punkt, Element oder Bemaßung/Beziehung (Symbol) */
export type SkHit = { kind: 'pt' | 'ent' | 'con'; id: number } | null;

export interface SketchSession {
  obj: Obj;
  /** Welt-Matrix des Objekts (Skizze → Welt) */
  m: Mat;
  sk: Sketch;
  /** zuletzt geschriebener Stand (erkennt Undo/Redo von außen) */
  json: string;
  /** Stand beim Öffnen (Abbrechen) */
  orig: string;
  tool: SkTool;
  sel: Set<number>;
  hover: SkHit;
  /** Punkte der Linie/Form im Entstehen (ids) bzw. Klickpunkte */
  draft: Pt[];
  draftIds: (number | null)[];
  /** gewählte Elemente des Bemaßungs-Werkzeugs */
  dimPick: SkHit[];
  status: SolveResult | null;
  drag: { pt: number; moved: boolean } | { con: number; start: Pt; at: Pt } | null;
  /** Lage der Symbol- und Bemaßungsbeschriftungen auf dem Bildschirm (für Treffertest) */
  labels: { id: number; x: number; y: number; w: number; h: number }[];
}

/** Benutzt eine Skizze den Parameter name in einer Maß-Formel? */
export function sketchUsesParam(o: Obj, name: string): boolean {
  return isSketchObj(o) && parseSketch(o.shape.params.sketch).cons.some((c) => !!c.expr && usesName(c.expr, name, false));
}

/** Parameter in den Maß-Formeln einer Skizze umbenennen */
export function renameSketchParam(o: Obj, from: string, to: string) {
  if (!isSketchObj(o)) return;
  const sk = parseSketch(o.shape.params.sketch);
  if (!sk.cons.some((c) => c.expr)) return;
  for (const c of sk.cons) if (c.expr) c.expr = renameInExpr(c.expr, from, to);
  o.shape.params = { ...o.shape.params, sketch: sketchJson(sk) };
}

/** Toleranz für automatische Beziehungen beim Zeichnen (Grad) */
const AUTO_DEG = 3;

const isSketchObj = (o: Obj | null | undefined): o is Obj & { shape: GenShape } => !!o && o.shape.kind === 'gen' && o.shape.gen === 'sketch';
export { isSketchObj };

export class EditorSketch {
  /** Neue, leere Skizze in der Mitte der Ansicht anlegen und öffnen */
  async newSketch(this: Editor) {
    const c = this.toWorld(this.w / 2, this.h / 2);
    const shape: GenShape = { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: sketchJson(emptySketch()) }, subs: [] };
    const o: Obj = { id: newId(), m: translate(Math.round(c.x), Math.round(c.y)), layer: this.currentLayer, shape };
    this.snapshot(t('Neue Skizze'));
    this.doc.objs.push(o);
    this.setSel([o]);
    this.emit('doc');
    await this.editSketch(o, 'line');
  }

  /** Skizze öffnen (Doppelklick) */
  async editSketch(this: Editor, o: Obj, tool: SkTool = 'select') {
    if (!isSketchObj(o)) return;
    this.hint = t('Löser wird geladen …');
    this.emit('tool');
    try {
      await loadSolver();
    } catch (e) {
      this.hint = t('Der Löser für Skizzen ließ sich nicht laden: {msg}', { msg: String(e) });
      this.emit('tool');
      return;
    }
    let m: Mat = o.m;
    for (const [leaf, lm] of visibleLeaves(this.doc.objs)) if (leaf === o) m = lm;
    const sk = parseSketch(o.shape.params.sketch);
    const json = sketchJson(sk);
    this.setTool('sketch');
    this.sketchEdit = {
      obj: o, m, sk, json, orig: json, tool, sel: new Set(), hover: null, draft: [], draftIds: [], dimPick: [], status: null, drag: null, labels: [],
    };
    this.sketchSolve(false);
    this.sketchHint();
    this.emit('tool');
    this.redraw();
  }

  /** Skizzenmodus beenden; cancel stellt den Stand beim Öffnen wieder her */
  closeSketch(this: Editor, cancel = false) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    if (cancel && s.json !== s.orig) {
      this.snapshot(t('Skizze: Abbrechen'));
      s.sk = parseSketch(s.orig);
      this.writeSketch();
    }
    const o = s.obj;
    this.sketchEdit = null;
    // leere Skizzen nicht stehen lassen
    if (!s.sk.ents.length && this.doc.objs.includes(o)) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel([]);
      this.emit('doc');
    } else if (this.doc.objs.includes(o)) this.setSel([o]);
    this.setTool('select');
  }

  /** Nach Undo/Redo: Sitzung auf das (neu geladene) Objekt und seine Skizze setzen */
  syncSketch(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    let o: Obj | undefined = s.obj;
    let m = s.m;
    let found = false;
    for (const [leaf, lm] of visibleLeaves(this.doc.objs))
      if (leaf === s.obj || leaf.id === s.obj.id) {
        o = leaf;
        m = lm;
        found = true;
        break;
      }
    if (!found || !isSketchObj(o)) {
      this.sketchEdit = null;
      this.setTool('select');
      return;
    }
    s.obj = o;
    s.m = m;
    const json = String(o.shape.params.sketch);
    if (json !== s.json) {
      s.sk = parseSketch(json);
      s.json = sketchJson(s.sk);
      s.sel.clear();
      this.sketchSolve(false);
    }
  }

  /** Skizze in das Objekt schreiben (Parameter und Umriss) */
  writeSketch(this: Editor) {
    const s = this.sketchEdit!;
    const shape = s.obj.shape as GenShape;
    s.json = sketchJson(s.sk);
    shape.params = { ...shape.params, sketch: s.json };
    shape.subs = sketchSubs(s.sk);
    this.touch(shape);
    this.emit('doc');
  }

  /** Formeln der Bemaßungen auswerten (Projekt-Parameter); liefert Fehlermeldungen ungültiger Formeln */
  sketchResolveExprs(this: Editor, sk: Sketch, scope?: Scope): string[] {
    const errs: string[] = [];
    for (const c of sk.cons) {
      if (!c.expr) continue;
      try {
        const v = evaluate(c.expr, scope);
        if (typeof v === 'number' && isFinite(v)) c.v = v;
        else errs.push(t('„{expr}“ ergibt keine Zahl.', { expr: c.expr }));
      } catch (e) {
        errs.push(`${c.expr}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return errs;
  }

  /**
   * Nach Änderung der Projekt-Parameter: Maße mit Formel neu auswerten und die Skizze neu lösen.
   * Ist der Löser noch nicht geladen, wird er geladen und die Parameter danach noch einmal angewendet.
   */
  refreshSketchParams(this: Editor, o: Obj, scope: Scope): Issue[] {
    if (!isSketchObj(o)) return [];
    if (this.sketchEdit?.obj === o) {
      this.sketchSolve();
      return [];
    }
    const sk = parseSketch(o.shape.params.sketch);
    if (!sk.cons.some((c) => c.expr)) return [];
    if (!solverReady()) {
      loadSolver().then(() => this.applyParams(), () => {});
      return [];
    }
    const before = sk.cons.map((c) => c.v);
    const issues: Issue[] = this.sketchResolveExprs(sk, scope).map((msg) => ({ level: 'error', msg }));
    if (sk.cons.every((c, i) => c.v === before[i])) return issues;
    const r = solveSketch(sk);
    if (!r.ok) {
      issues.push({ level: 'error', msg: t('Die Skizze lässt sich mit den neuen Maßen nicht lösen.') });
      return issues;
    }
    const shape = o.shape as GenShape;
    shape.params = { ...shape.params, sketch: sketchJson(sk) };
    shape.subs = sketchSubs(sk);
    this.touch(shape);
    return issues;
  }

  /** Lösen; bei Erfolg (oder write=false) Status merken. Liefert das Ergebnis. */
  sketchSolve(this: Editor, write = true, drag?: { pt: number; x: number; y: number }): SolveResult {
    const s = this.sketchEdit!;
    this.sketchResolveExprs(s.sk, scopeOf(this.paramList()));
    const r = solveSketch(s.sk, drag ? { drag } : {});
    if (r.ok || !drag) s.status = r;
    if (r.ok && write) this.writeSketch();
    return r;
  }

  /**
   * Änderung an der Skizze als Undo-Schritt: fn ändert s.sk; schlägt das Lösen danach fehl, wird die Änderung
   * zurückgenommen (bei Beziehungen) bzw. trotzdem behalten, wenn keep gesetzt ist.
   */
  sketchChange(this: Editor, label: string, fn: (sk: Sketch) => void | false, opts: { keepOnFail?: boolean } = {}): boolean {
    const s = this.sketchEdit;
    if (!s) return false;
    this.syncSketch();
    const before = cloneSketch(s.sk);
    if (fn(s.sk) === false) return false;
    const r = this.sketchSolve(false);
    if (!r.ok && !opts.keepOnFail) {
      s.sk = before;
      s.status = this.sketchSolve(false);
      this.hint = t('Widerspruch: Diese Beziehung passt nicht zu den vorhandenen und wurde nicht gesetzt.');
      this.emit('tool');
      this.redraw();
      return false;
    }
    this.snapshot(label);
    this.writeSketch();
    this.sketchHint();
    return true;
  }

  sketchHint(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    const tips: Record<SkTool, string> = {
      select: t('Skizze: Elemente anklicken (Shift ergänzt), Punkte ziehen, Beziehungen oben wählen. Doppelklick auf ein Maß ändert es. Entf löscht. Enter oder „Fertig“ beendet.'),
      line: t('Linie: Punkte anklicken, ein bestehender Punkt wird verbunden. Doppelklick, Enter oder Esc beendet den Linienzug.'),
      rect: t('Rechteck: zwei gegenüberliegende Ecken anklicken.'),
      circle: t('Kreis: Mittelpunkt anklicken, dann einen Punkt auf dem Kreis.'),
      arc: t('Bogen: Mittelpunkt, Anfang und Ende anklicken (im Uhrzeigersinn).'),
      dim: t('Bemaßen: Linie (Länge), Kreis (Durchmesser), Bogen (Radius), zwei Punkte (Abstand), Punkt und Linie (Abstand) oder zwei Linien (Winkel) anklicken.'),
    };
    this.hint = tips[s.tool];
    this.emit('tool');
  }

  setSketchTool(this: Editor, tool: SkTool) {
    const s = this.sketchEdit;
    if (!s) return;
    s.tool = tool;
    s.draft = [];
    s.draftIds = [];
    s.dimPick = [];
    this.sketchHint();
    this.redraw();
  }

  // ---------- Koordinaten und Treffer ----------

  skToScreen(this: Editor, p: Pt): Pt {
    return this.toScreen(apply(this.sketchEdit!.m, p.x, p.y));
  }
  skFromWorld(this: Editor, p: Pt): Pt {
    return apply(inv(this.sketchEdit!.m), p.x, p.y);
  }
  /** Maßstab Skizze → Bildschirm */
  skScale(this: Editor): number {
    const m = this.sketchEdit!.m;
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * this.view.zoom;
  }

  sketchHitTest(this: Editor, sx: number, sy: number): SkHit {
    const s = this.sketchEdit!;
    const sk = s.sk;
    for (const l of s.labels) if (sx >= l.x && sx <= l.x + l.w && sy >= l.y && sy <= l.y + l.h) return { kind: 'con', id: l.id };
    let best: SkHit = null,
      bd = SNAP_PX + 2;
    for (const p of sk.pts) {
      const q = this.skToScreen(p);
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd) {
        bd = d;
        best = { kind: 'pt', id: p.id };
      }
    }
    if (best) return best;
    bd = SNAP_PX;
    const k = this.skScale();
    for (const e of sk.ents) {
      let d = Infinity;
      if (e.t === 'line') {
        const a = this.skToScreen(ptOf(sk, e.a)!),
          b = this.skToScreen(ptOf(sk, e.b)!);
        d = segDist(sx, sy, a, b);
      } else {
        const c = this.skToScreen(ptOf(sk, e.c)!);
        const dc = Math.hypot(sx - c.x, sy - c.y);
        d = Math.abs(dc - e.r * k);
        if (e.t === 'arc' && d < bd) {
          // nur auf dem Bogen selbst
          const w = this.skFromWorld(this.toWorld(sx, sy));
          const C = ptOf(sk, e.c)!;
          let a = Math.atan2(w.y - C.y, w.x - C.x);
          while (a < e.a0) a += 2 * Math.PI;
          if (a > e.a1) d = Infinity;
        }
      }
      if (d < bd) {
        bd = d;
        best = { kind: 'ent', id: e.id };
      }
    }
    return best;
  }

  /** Punkt für Zeichenwerkzeuge: bestehender Skizzenpunkt (id) oder gefangener Punkt (Objekte/Raster) */
  sketchPointAt(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): { p: Pt; id: number | null } {
    const s = this.sketchEdit!;
    const h = this.sketchHitTest(sx, sy);
    if (h?.kind === 'pt') {
      const p = ptOf(s.sk, h.id)!;
      return { p: { x: p.x, y: p.y }, id: p.id };
    }
    const w = this.snapPt(this.toWorld(sx, sy), e, { toggle: true });
    return { p: this.skFromWorld(w), id: null };
  }

  // ---------- Maus ----------

  sketchMove(this: Editor, sx: number, sy: number, e: PointerEvent) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    if (!this.sketchEdit) return;
    const d = s.drag;
    if (d && 'pt' in d) {
      const w = this.skFromWorld(this.snapPt(this.toWorld(sx, sy), e, { toggle: true }));
      if (!d.moved) {
        this.snapshot(t('Skizze: Punkt ziehen'));
        d.moved = true;
      }
      const r = this.sketchSolve(false, { pt: d.pt, x: w.x, y: w.y });
      if (r.ok) {
        // ohne neuen Undo-Schritt schreiben
        const shape = s.obj.shape as GenShape;
        s.json = sketchJson(s.sk);
        shape.params = { ...shape.params, sketch: s.json };
        shape.subs = sketchSubs(s.sk);
        this.touch(shape);
        this.emit('doc');
      }
      this.redraw();
      return;
    }
    if (d && 'con' in d) {
      const w = this.skFromWorld(this.toWorld(sx, sy));
      const c = s.sk.cons.find((x) => x.id === d.con);
      if (c) c.at = { x: d.at.x + w.x - d.start.x, y: d.at.y + w.y - d.start.y };
      this.redraw();
      return;
    }
    s.hover = this.sketchHitTest(sx, sy);
    if (s.tool !== 'select' && s.tool !== 'dim') this.cursor = this.toWorld(sx, sy);
    if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'circle' || s.tool === 'arc') {
      const { p } = this.sketchPointAt(sx, sy, e);
      this.cursor = apply(s.m, p.x, p.y);
    }
    this.canvas.style.cursor = s.tool === 'select' ? (s.hover ? 'pointer' : 'default') : 'crosshair';
    this.redraw();
  }

  sketchDown(this: Editor, sx: number, sy: number, e: PointerEvent) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    if (!this.sketchEdit) return;
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    switch (s.tool) {
      case 'select': {
        const h = this.sketchHitTest(sx, sy);
        if (!h) {
          if (!add) s.sel.clear();
          break;
        }
        if (add) {
          if (s.sel.has(h.id)) s.sel.delete(h.id);
          else s.sel.add(h.id);
        } else if (!s.sel.has(h.id)) {
          s.sel.clear();
          s.sel.add(h.id);
        }
        if (h.kind === 'pt') s.drag = { pt: h.id, moved: false };
        else if (h.kind === 'con') {
          const c = s.sk.cons.find((x) => x.id === h.id);
          if (c && isDim(c.t)) s.drag = { con: c.id, start: this.skFromWorld(this.toWorld(sx, sy)), at: c.at ?? { x: 0, y: 0 } };
        }
        break;
      }
      case 'line': {
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (s.draft.length && s.draftIds.length) {
          const prevId = s.draftIds[s.draftIds.length - 1];
          const prev = s.draft[s.draft.length - 1];
          if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-6) return;
          const closing = id !== null && id === s.draftIds[0];
          this.sketchChange(t('Skizze: Linie'), (sk) => {
            const a = prevId !== null ? prevId : addPt(sk, prev.x, prev.y).id;
            if (prevId === null) s.draftIds[s.draftIds.length - 1] = a;
            const b = id !== null ? id : addPt(sk, p.x, p.y).id;
            const l = addLine(sk, a, b);
            autoConstrain(sk, l);
            s.draftIds.push(b);
          }, { keepOnFail: true });
          s.draft.push(p);
          if (closing) {
            s.draft = [];
            s.draftIds = [];
          }
        } else {
          s.draft = [p];
          s.draftIds = [id];
        }
        break;
      }
      case 'rect': {
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
          break;
        }
        const a = s.draft[0];
        if (Math.abs(p.x - a.x) < 1e-6 || Math.abs(p.y - a.y) < 1e-6) return;
        const firstId = s.draftIds[0];
        this.sketchChange(t('Skizze: Rechteck'), (sk) => {
          const p0 = firstId ?? addPt(sk, a.x, a.y).id;
          const p1 = addPt(sk, p.x, a.y).id;
          const p2 = id ?? addPt(sk, p.x, p.y).id;
          const p3 = addPt(sk, a.x, p.y).id;
          const ls = [addLine(sk, p0, p1), addLine(sk, p1, p2), addLine(sk, p2, p3), addLine(sk, p3, p0)];
          addCon(sk, 'horizontal', [ls[0].id]);
          addCon(sk, 'horizontal', [ls[2].id]);
          addCon(sk, 'vertical', [ls[1].id]);
          addCon(sk, 'vertical', [ls[3].id]);
        }, { keepOnFail: true });
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'circle': {
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
          break;
        }
        const c = s.draft[0];
        const r = Math.hypot(p.x - c.x, p.y - c.y);
        if (r < 1e-6) return;
        const cid = s.draftIds[0];
        this.sketchChange(t('Skizze: Kreis'), (sk) => {
          addCircle(sk, cid ?? addPt(sk, c.x, c.y).id, r);
        }, { keepOnFail: true });
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'arc': {
        const { p, id } = this.sketchPointAt(sx, sy, e);
        s.draft.push(p);
        s.draftIds.push(id);
        if (s.draft.length < 3) break;
        const [c, a, b] = s.draft;
        const [cid, aid, bid] = s.draftIds;
        const r = Math.hypot(a.x - c.x, a.y - c.y);
        if (r < 1e-6) {
          s.draft = [];
          s.draftIds = [];
          return;
        }
        this.sketchChange(t('Skizze: Bogen'), (sk) => {
          const C = cid ?? addPt(sk, c.x, c.y).id;
          const A = aid ?? addPt(sk, a.x, a.y).id;
          // Ende auf den Kreis legen
          const ang = Math.atan2(b.y - c.y, b.x - c.x);
          const B = bid ?? addPt(sk, c.x + r * Math.cos(ang), c.y + r * Math.sin(ang)).id;
          addArc(sk, C, A, B);
        }, { keepOnFail: true });
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'dim':
        this.sketchDimPick(this.sketchHitTest(sx, sy));
        break;
    }
    this.redraw();
  }

  sketchUp(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    const d = s.drag;
    s.drag = null;
    if (d && 'con' in d) {
      const c = s.sk.cons.find((x) => x.id === d.con);
      if (c && (c.at?.x !== d.at.x || c.at?.y !== d.at.y)) {
        const at = c.at;
        c.at = d.at;
        this.sketchChange(t('Skizze: Maß verschieben'), (sk) => {
          const cc = sk.cons.find((x) => x.id === d.con);
          if (cc) cc.at = at;
        });
      }
    } else if (d && 'pt' in d && d.moved) {
      this.writeSketch();
      this.sketchSolve(false);
    }
    this.redraw();
  }

  sketchDouble(this: Editor, sx: number, sy: number) {
    const s = this.sketchEdit;
    if (!s) return;
    if (s.tool === 'line') {
      s.draft = [];
      s.draftIds = [];
      this.redraw();
      return;
    }
    const h = this.sketchHitTest(sx, sy);
    if (h?.kind === 'con') void this.editSketchDim(h.id);
  }

  // ---------- Bemaßungen ----------

  /** Element für das Bemaßungs-Werkzeug wählen; legt die Bemaßung an, sobald die Wahl eindeutig ist */
  sketchDimPick(this: Editor, h: SkHit) {
    const s = this.sketchEdit!;
    const sk = s.sk;
    const ent = (x: SkHit) => (x?.kind === 'ent' ? entOf(sk, x.id) : undefined);
    // Linie gewählt und dann ins Leere geklickt: Länge der Linie
    if (!h || h.kind === 'con') {
      const first = s.dimPick.length === 1 ? ent(s.dimPick[0]) : undefined;
      s.dimPick = [];
      if (first?.t === 'line') void this.addSketchDim('distance', [first.id]);
      this.sketchHint();
      return;
    }
    s.dimPick.push(h);
    const picks = s.dimPick;
    let make: { t: ConType; r: number[] } | null = null;
    if (picks.length === 1) {
      const e = ent(picks[0]);
      if (e?.t === 'circle') make = { t: 'diameter', r: [e.id] };
      else if (e?.t === 'arc') make = { t: 'radius', r: [e.id] };
      else if (e?.t === 'line') {
        // Linie: auf das zweite Element warten (Linie = Winkel, Punkt = Abstand), Klick ins Leere = Länge
        this.hint = t('Bemaßen: ins Leere klicken für die Länge, zweite Linie für den Winkel, Punkt für den Abstand.');
        this.emit('tool');
        return;
      }
    } else if (picks.length === 2) {
      const [a, b] = picks;
      if (a?.kind === 'pt' && b?.kind === 'pt') make = { t: 'distance', r: [a.id, b.id] };
      else if (a?.kind === 'pt' && ent(b)?.t === 'line') make = { t: 'distance', r: [a.id, b!.id] };
      else if (b?.kind === 'pt' && ent(a)?.t === 'line') make = { t: 'distance', r: [b.id, a!.id] };
      else if (ent(a)?.t === 'line' && ent(b)?.t === 'line' && a!.id !== b!.id) make = { t: 'angle', r: [a!.id, b!.id] };
      else if (ent(a)?.t === 'line' && a!.id === b!.id) make = { t: 'distance', r: [a!.id] };
    }
    if (!make) {
      if (picks.length >= 2) s.dimPick = [];
      return;
    }
    const m = make;
    s.dimPick = [];
    this.sketchHint();
    void this.addSketchDim(m.t, m.r);
  }

  /** Neue Bemaßung: Wert erfragen (Vorschlag: aktueller Wert) und setzen */
  async addSketchDim(this: Editor, type: ConType, r: number[]) {
    const s = this.sketchEdit!;
    const probe: SkCon = { id: 0, t: type, r };
    const cur = measureCon(s.sk, probe);
    if (cur === null) return;
    const ans = this.onSketchValue ? await this.onSketchValue(dimTitle(type, r), cur, type === 'angle' ? '°' : 'mm') : { v: cur };
    if (!ans) return;
    // Maßlinie anfangs 5 mm neben der Strecke (wie in der Anzeige ohne eigene Lage)
    let at: Pt | undefined;
    const pp = type === 'distance' && r.length === 2 && entOf(s.sk, r[1])?.t === 'line' ? null : pointPair(s.sk, r);
    if (pp && (type === 'distance' || type === 'hdistance' || type === 'vdistance')) {
      const [a, b] = pp;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      at = { x: (-(b.y - a.y) / L) * 5, y: ((b.x - a.x) / L) * 5 };
    }
    this.sketchChange(t('Skizze: Bemaßung'), (sk) => {
      addCon(sk, type, r, { v: ans.v, ...(ans.expr ? { expr: ans.expr } : {}), ...(at ? { at } : {}) });
    });
  }

  /** Wert einer Bemaßung ändern */
  async editSketchDim(this: Editor, id: number) {
    const s = this.sketchEdit!;
    const c = s.sk.cons.find((x) => x.id === id);
    if (!c || !isDim(c.t)) return;
    const ans = this.onSketchValue ? await this.onSketchValue(dimTitle(c.t, c.r), c.v ?? measureCon(s.sk, c) ?? 0, c.t === 'angle' ? '°' : 'mm', c.expr) : null;
    if (!ans) return;
    this.sketchChange(t('Skizze: Maß ändern'), (sk) => {
      const cc = sk.cons.find((x) => x.id === id);
      if (!cc) return false;
      cc.v = ans.v;
      if (ans.expr) cc.expr = ans.expr;
      else delete cc.expr;
    });
  }

  // ---------- Beziehungen aus der Auswahl ----------

  /** Welche Beziehungen passen zur Auswahl? (für die Knöpfe) */
  sketchConOptions(this: Editor): ConType[] {
    const s = this.sketchEdit;
    if (!s) return [];
    return CON_BUTTONS.filter((t) => conFromSel(s.sk, [...s.sel], t) !== null);
  }

  /** Beziehung aus der Auswahl setzen */
  sketchConstrain(this: Editor, type: ConType) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    const list = conFromSel(s.sk, [...s.sel], type);
    if (!list) {
      this.hint = t('Diese Beziehung passt nicht zur Auswahl.');
      this.emit('tool');
      return;
    }
    const ok = this.sketchChange(t('Skizze: {name}', { name: CON_LABELS[type] }), (sk) => {
      for (const c of list) addCon(sk, c.t, c.r, c.t === 'fixed' ? { x: ptOf(sk, c.r[0])!.x, y: ptOf(sk, c.r[0])!.y } : {});
    });
    if (ok) s.sel.clear();
    this.redraw();
  }

  /** Gewählte Elemente zu Hilfsgeometrie machen (bzw. zurück) */
  sketchToggleAux(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    const ents = s.sk.ents.filter((e) => s.sel.has(e.id));
    if (!ents.length) return;
    const on = !ents.every((e) => e.aux);
    this.sketchChange(t('Skizze: Hilfsgeometrie'), (sk) => {
      for (const e of sk.ents) if (s.sel.has(e.id)) {
        if (on) e.aux = true;
        else delete e.aux;
      }
    }, { keepOnFail: true });
  }

  sketchDeleteSel(this: Editor) {
    const s = this.sketchEdit;
    if (!s || !s.sel.size) return;
    const ids = [...s.sel];
    s.sel.clear();
    this.sketchChange(t('Skizze: Löschen'), (sk) => deleteIds(sk, ids), { keepOnFail: true });
    this.redraw();
  }

  /** Taste im Skizzenmodus; true = verarbeitet */
  sketchKey(this: Editor, e: KeyboardEvent): boolean {
    const s = this.sketchEdit;
    if (!s) return false;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (s.draft.length || s.dimPick.length) {
        s.draft = [];
        s.draftIds = [];
        s.dimPick = [];
      } else if (s.tool !== 'select') this.setSketchTool('select');
      else if (s.sel.size) s.sel.clear();
      else this.closeSketch();
      this.redraw();
      return true;
    }
    if (k === 'enter') {
      if (s.draft.length) {
        s.draft = [];
        s.draftIds = [];
        this.redraw();
      } else this.closeSketch();
      return true;
    }
    if (k === 'delete' || k === 'backspace') {
      this.sketchDeleteSel();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const tools: Record<string, SkTool> = { l: 'line', r: 'rect', c: 'circle', a: 'arc', d: 'dim', s: 'select' };
    if (tools[k]) {
      this.setSketchTool(tools[k]);
      return true;
    }
    const cons: Record<string, ConType> = { h: 'horizontal', v: 'vertical', o: 'coincident', p: 'parallel', n: 'perpendicular', e: 'equal', t: 'tangent', f: 'fixed', x: 'concentric', m: 'midpoint', y: 'symmetric' };
    if (cons[k]) {
      this.sketchConstrain(cons[k]);
      return true;
    }
    if (k === 'g') {
      this.sketchToggleAux();
      return true;
    }
    return false;
  }

  /**
   * Pfade in eine Skizze umwandeln: gerade Segmente werden Linien, erkannte Kreise und Bögen werden Kreise und
   * Bögen, gemeinsame Knoten gemeinsame Punkte; freie Bézierkurven werden durch Linien angenähert.
   */
  async convertSelToSketch(this: Editor) {
    const { subsToSketch } = await import('../sketch/convert');
    const { shapeSubs } = await import('../geom');
    const { transformSubs } = await import('../importers');
    // Alle gewählten Formen kommen in eine gemeinsame Skizze, damit Beziehungen zwischen ihnen möglich sind
    const src = this.sel.filter((o) => this.doc.objs.includes(o) && !['group', 'image', 'text'].includes(o.shape.kind) && !isSketchObj(o));
    const subs = src.flatMap((o) => transformSubs(shapeSubs(o.shape), o.m));
    if (!subs.length) {
      this.hint = t('Keine Pfade oder Formen in der Auswahl.');
      this.emit('tool');
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sp of subs)
      for (const q of sp.nodes) {
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
      }
    const m = translate(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
    const sk = subsToSketch(transformSubs(subs, inv(m)));
    this.snapshot(t('In Skizze umwandeln'));
    const first = src[0];
    const o: Obj = { ...first, m, shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: sketchJson(sk) }, subs: sketchSubs(sk) } };
    delete o.bind;
    this.doc.objs = this.doc.objs.filter((x) => !src.includes(x) || x === first).map((x) => (x === first ? o : x));
    this.setSel([o]);
    this.emit('doc');
    await this.editSketch(o);
  }

}

// ---------- Hilfen ----------

function segDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const tt = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * tt - x, a.y + dy * tt - y);
}

/** Automatische Beziehung für eine neu gezeichnete Linie: fast waagrecht/senkrecht */
function autoConstrain(sk: Sketch, l: SkEnt) {
  if (l.t !== 'line') return;
  const a = ptOf(sk, l.a)!,
    b = ptOf(sk, l.b)!;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const off = (v: number) => Math.min(Math.abs(v), Math.abs(180 - Math.abs(v)));
  if (off(ang) < AUTO_DEG) addCon(sk, 'horizontal', [l.id]);
  else if (Math.abs(Math.abs(ang) - 90) < AUTO_DEG) addCon(sk, 'vertical', [l.id]);
}

export const CON_BUTTONS: ConType[] = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'tangent', 'concentric', 'midpoint', 'symmetric', 'fixed'];

export const CON_LABELS: Record<ConType, string> = {
  coincident: t('Deckungsgleich'),
  horizontal: t('Horizontal|Beziehung'),
  vertical: t('Vertikal|Beziehung'),
  parallel: t('Parallel'),
  perpendicular: t('Senkrecht|Beziehung'),
  equal: t('Gleich|Beziehung'),
  fixed: t('Fest|Beziehung'),
  pointOnLine: t('Punkt auf Linie'),
  pointOnCircle: t('Punkt auf Kreis'),
  midpoint: t('Mittelpunkt|Beziehung'),
  symmetric: t('Symmetrisch'),
  tangent: t('Tangential'),
  concentric: t('Konzentrisch'),
  distance: t('Abstand'),
  hdistance: t('Waagrechter Abstand'),
  vdistance: t('Senkrechter Abstand'),
  angle: t('Winkel'),
  radius: t('Radius'),
  diameter: t('Durchmesser'),
};

/** Kurzzeichen der Beziehungen an der Geometrie */
export const CON_GLYPHS: Partial<Record<ConType, string>> = {
  horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', equal: '=', fixed: '⚓', pointOnLine: '⋯', pointOnCircle: '◌',
  midpoint: 'M', symmetric: '⇹', tangent: 'T', concentric: '◎', coincident: '•',
};

const dimTitle = (type: ConType, r: number[]) => (type === 'distance' && r.length === 1 ? t('Länge') : CON_LABELS[type]);

/**
 * Beziehungen, die sich aus der Auswahl für eine Art ergeben (null = passt nicht).
 * Mehrere gleichartige Elemente bekommen die Beziehung paarweise zum ersten (z. B. drei Linien gleich lang).
 */
export function conFromSel(sk: Sketch, sel: number[], type: ConType): { t: ConType; r: number[] }[] | null {
  const pts = sel.filter((id) => ptOf(sk, id));
  const ents = sel.map((id) => entOf(sk, id)).filter((e): e is SkEnt => !!e);
  const lines = ents.filter((e) => e.t === 'line');
  const rounds = ents.filter((e) => e.t !== 'line');
  if (pts.length + ents.length !== sel.length || !sel.length) return null;
  const pairs = (list: SkEnt[], tt: ConType) => list.slice(1).map((e) => ({ t: tt, r: [list[0].id, e.id] }));
  switch (type) {
    case 'coincident':
      if (pts.length === 2 && !ents.length) return [{ t: 'coincident', r: pts }];
      if (pts.length === 1 && lines.length === 1 && !rounds.length) return [{ t: 'pointOnLine', r: [pts[0], lines[0].id] }];
      if (pts.length === 1 && rounds.length === 1 && !lines.length) return [{ t: 'pointOnCircle', r: [pts[0], rounds[0].id] }];
      return null;
    case 'horizontal':
    case 'vertical':
      if (lines.length && !pts.length && !rounds.length) return lines.map((l) => ({ t: type, r: [l.id] }));
      if (pts.length === 2 && !ents.length) return [{ t: type, r: pts }];
      return null;
    case 'parallel':
    case 'perpendicular':
      if (lines.length >= 2 && lines.length === sel.length && (type === 'parallel' || lines.length === 2)) return pairs(lines, type);
      return null;
    case 'equal':
      if (lines.length >= 2 && lines.length === sel.length) return pairs(lines, 'equal');
      if (rounds.length >= 2 && rounds.length === sel.length) return pairs(rounds, 'equal');
      return null;
    case 'tangent':
      if (ents.length === 2 && !pts.length && rounds.length >= 1) return [{ t: 'tangent', r: [ents[0].id, ents[1].id] }];
      return null;
    case 'concentric':
      if (rounds.length >= 2 && rounds.length === sel.length) return pairs(rounds, 'concentric');
      return null;
    case 'midpoint':
      if (pts.length === 1 && lines.length === 1 && sel.length === 2) return [{ t: 'midpoint', r: [pts[0], lines[0].id] }];
      return null;
    case 'symmetric':
      if (pts.length === 2 && lines.length === 1 && sel.length === 3) return [{ t: 'symmetric', r: [pts[0], pts[1], lines[0].id] }];
      return null;
    case 'fixed':
      if (pts.length && !ents.length) return pts.map((p) => ({ t: 'fixed', r: [p] }));
      return null;
    default:
      return null;
  }
}

