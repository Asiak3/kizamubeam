// Editor: Beziehungen einmal anwenden (Werkzeug „Beziehung“) und Messen (Werkzeug „Messen“).
import { apply, Mat, mul, Obj, Pt, visibleLeaves } from '../model';
import { segments, shapeSubs } from '../geom';
import { shapeCenters } from '../arcs';
import { currentDistance, REL_HINTS, REL_LABELS, relAccepts, relationTransform, relCount, RelElem, RelMode } from '../relations';
import { t } from '../i18n';
import type { Editor } from '../editor';

/** Gewähltes Element mit Objekt (oberste Ebene) */
export interface RelPick {
  top: Obj;
  elem: RelElem;
}

/** Abstand in Bildschirmpixeln, in dem Kreise, Kanten und Punkte getroffen werden */
const PICK_PX = 7;

export class EditorRelations {
  /** Werkzeug „Beziehung“ mit einer Art starten */
  startRelation(this: Editor, mode: RelMode) {
    this.setTool('relate');
    this.relMode = mode;
    this.hint = REL_HINTS[mode];
    this.emit('tool');
  }

  /** Alle Kreise, Kanten und (bei Abstand) Knoten unter dem Mauszeiger, die nächsten zuerst */
  relCandidates(this: Editor, sx: number, sy: number): RelPick[] {
    const z = this.view.zoom;
    const out: { d: number; pick: RelPick; pri: number }[] = [];
    const cur = this.toWorld(sx, sy);
    for (const top of this.doc.objs) {
      for (const [leaf, m] of visibleLeaves([top])) {
        const k = leaf.shape.kind;
        if (k === 'text' || k === 'image' || k === 'barcode' || !this.layer(leaf.layer).show) continue;
        const scl = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        for (const c of shapeCenters(leaf.shape, () => shapeSubs(leaf.shape))) {
          const q = apply(m, c.x, c.y);
          const dc = Math.hypot(q.x - cur.x, q.y - cur.y) * z;
          const r = (c.kind === 'ellipse' ? Math.min(c.r ?? 0, c.ry ?? 0) : c.kind === 'polygon' ? 0 : c.r ?? 0) * scl;
          const dr = c.kind === 'circle' || c.kind === 'arc' ? Math.abs(Math.hypot(q.x - cur.x, q.y - cur.y) - r) * z : Infinity;
          const d = Math.min(dc, dr);
          if (d <= PICK_PX) out.push({ d, pri: 0, pick: { top, elem: { kind: 'circle', c: q, r } } });
        }
        shapeSubs(leaf.shape).forEach((sp) => {
          for (const sg of segments(sp)) {
            const a = apply(m, sg.a.x, sg.a.y),
              b = apply(m, sg.b.x, sg.b.y);
            if (this.relMode === 'distance') {
              for (const p of [a, b]) {
                const d = Math.hypot(p.x - cur.x, p.y - cur.y) * z;
                if (d <= PICK_PX) out.push({ d, pri: -1, pick: { top, elem: { kind: 'point', p } } });
              }
            }
            if (sg.curve) continue;
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const l2 = dx * dx + dy * dy;
            if (l2 * z * z < 1) continue;
            const tt = Math.max(0, Math.min(1, ((cur.x - a.x) * dx + (cur.y - a.y) * dy) / l2));
            const d = Math.hypot(a.x + dx * tt - cur.x, a.y + dy * tt - cur.y) * z;
            if (d <= PICK_PX) out.push({ d, pri: 1, pick: { top, elem: { kind: 'edge', a, b } } });
          }
        });
      }
    }
    out.sort((p, q) => p.d - q.d || p.pri - q.pri);
    return out.map((o) => o.pick);
  }

  /** Element unter dem Mauszeiger, das an die nächste Stelle der Beziehung passt */
  updateRelHover(this: Editor, sx: number, sy: number) {
    const i = this.relPicks.length;
    const first = this.relPicks[0]?.elem;
    const prev = this.relHover;
    this.relHover = this.relCandidates(sx, sy).find((p) => relAccepts(this.relMode, i, p.elem, first)) ?? null;
    this.canvas.style.cursor = this.relHover ? 'pointer' : 'crosshair';
    if (prev !== this.relHover) this.redraw();
  }

  /** Klick im Werkzeug „Beziehung“ */
  relClick(this: Editor) {
    const h = this.relHover;
    if (!h) {
      this.hint = REL_HINTS[this.relMode];
      this.emit('tool');
      return;
    }
    this.relPicks.push(h);
    this.relHover = null;
    if (this.relPicks.length < relCount(this.relMode)) {
      this.hint = t('Jetzt das zweite Element anklicken (sein Objekt wird verändert). Esc hebt die Wahl auf.');
      this.emit('tool');
      this.redraw();
      return;
    }
    void this.applyRelation();
  }

  clearRelPicks(this: Editor) {
    this.relPicks = [];
    this.relHover = null;
    this.hint = REL_HINTS[this.relMode];
    this.emit('tool');
    this.redraw();
  }

  /** Beziehung mit den gewählten Elementen anwenden; true bei Erfolg */
  async applyRelation(this: Editor, dist?: number): Promise<boolean> {
    const picks = this.relPicks;
    this.relPicks = [];
    const mode = this.relMode;
    const ref = picks[0],
      tgt = relCount(mode) === 1 ? picks[0] : picks[1];
    const done = (msg: string, ok: boolean) => {
      this.hint = msg;
      this.emit('tool');
      this.redraw();
      return ok;
    };
    if (!ref || !tgt) return done(REL_HINTS[mode], false);
    if (relCount(mode) === 2 && ref.top === tgt.top) return done(t('Beide Elemente gehören zum selben Objekt. Das zweite Element muss zu einem anderen Objekt gehören.'), false);
    if (tgt.top.locked) return done(t('Das Objekt ist gesperrt.'), false);
    if (mode === 'distance' && dist === undefined) {
      const v = this.onRelDistance ? await this.onRelDistance(currentDistance(ref.elem, tgt.elem)) : null;
      if (v === null || v === undefined) return done(REL_HINTS[mode], false);
      dist = v;
    }
    const r = relationTransform(mode, ref.elem, relCount(mode) === 1 ? null : tgt.elem, dist ?? 0);
    if (!r.ok) return done(r.msg, false);
    const label = t('Beziehung: {name}', { name: REL_LABELS[mode] });
    if (r.scaled && !(await this.guardGen([tgt.top], label))) return done(REL_HINTS[mode], false);
    // guardGen kann das Objekt ersetzt haben (in Pfad umgewandelt): an derselben Stelle der Liste nachsehen
    const obj = this.doc.objs.includes(tgt.top) ? tgt.top : null;
    if (!obj) return done(REL_HINTS[mode], false);
    this.snapshot(label);
    obj.m = mul(r.T, obj.m) as Mat;
    this.setSel([obj]);
    this.emit('doc');
    return done(t('{name} angewendet.', { name: REL_LABELS[mode] }) + ' ' + REL_HINTS[mode], true);
  }

  // ---------- Messen ----------

  /** Klick im Werkzeug „Messen“: erster Klick setzt den Anfang, zweiter das Ende; danach beginnt eine neue Messung */
  measureClick(this: Editor, p: Pt) {
    if (!this.measure || this.measure.b) this.measure = { a: p, b: null };
    else this.measure.b = p;
    this.redraw();
  }

  /** Kreis unter dem Mauszeiger (Radius/Durchmesser anzeigen), wenn keine Messung läuft */
  updateMeasureHover(this: Editor, sx: number, sy: number) {
    const prev = this.measureCircle;
    this.measureCircle = null;
    if (!this.measure || this.measure.b) {
      const c = this.relCandidates(sx, sy).find((p) => p.elem.kind === 'circle' && p.elem.r > 0);
      if (c && c.elem.kind === 'circle') this.measureCircle = { c: c.elem.c, r: c.elem.r };
    }
    if (prev !== this.measureCircle) this.redraw();
  }
}
