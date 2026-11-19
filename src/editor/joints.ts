// Editor: Verbindungen (Fingerzinken, Schlitz und Zapfen).
import { apply, IDENT, inv, leaves, Mat, newId, Obj, Pt, SubPath, visibleLeaves } from '../model';
import { transformSubs } from '../importers';
import { computeJoint, EdgePick, isStraight, jointMate, JointOptions } from '../joints';
import { JOINT_GEOMETRY_VERSION } from '../jointsGeom';
import { region } from '../ops';
import { SCALE } from '../clip';
import ClipperLib from 'clipper-lib';
import { invalidate, segments, shapeSubs } from '../geom';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { HINGE_HINT_FIRST, TOOL_HINTS } from './shared';

/** Schlitze auf einer einzelnen Hilfslinie (vor dem Anwenden prüfen: danach ist die Linie durch die Schlitze ersetzt) */
function isGuide(o: Obj, opt: JointOptions): boolean {
  const subs = shapeSubs(o.shape);
  return opt.kind !== 'finger' && opt.kind !== 'lap' && opt.kind !== 'lidhinge' && subs.length === 1 && !subs[0].closed && subs[0].nodes.length === 2;
}

export class EditorJoints {
  /** Nächste gerade Kante eines sichtbaren Objekts unter dem Mauszeiger */
  updateJointHover(this: Editor, sx: number, sy: number) {
    const prev = this.jointHover;
    let best = 7;
    this.jointHover = null;
    for (const [leaf, m] of visibleLeaves(this.doc.objs)) {
      const k = leaf.shape.kind;
      if (k === 'text' || k === 'image' || k === 'barcode' || k === 'gen' || !this.layer(leaf.layer).show) continue;
      shapeSubs(leaf.shape).forEach((sp, si) =>
        segments(sp).forEach((sg, gi) => {
          if (sg.curve) return;
          const a = this.toScreen(apply(m, sg.a.x, sg.a.y)),
            b = this.toScreen(apply(m, sg.b.x, sg.b.y));
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          if (l2 < 1) return;
          const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / l2));
          const d = Math.hypot(a.x + dx * t - sx, a.y + dy * t - sy);
          if (d < best) {
            best = d;
            this.jointHover = { obj: leaf, m, sub: si, seg: gi };
          }
        }),
      );
    }
    // im forEach gesetzt: TypeScript sieht das nicht
    const h = this.jointHover as EdgePick | null;
    this.canvas.style.cursor = h ? 'pointer' : 'crosshair';
    if (!h !== !prev || (h && prev && (h.obj !== prev.obj || h.sub !== prev.sub || h.seg !== prev.seg))) this.redraw();
  }

  /** Gewählte Kanten, die es im Dokument noch gibt */
  validJointPicks(this: Editor): EdgePick[] {
    const alive = new Set([...leaves(this.doc.objs)].map(([o]) => o));
    return this.jointPicks.filter((p) => alive.has(p.obj) && isStraight(p.obj, p.sub, p.seg));
  }
  /** Scharnier-Generator: Werkzeug „Verbindung“ mit der Art „Scharnier für Deckel“ */
  startHingeTool(this: Editor) {
    this.setTool('joint');
    this.jointHingeMode = true;
    this.hint = HINGE_HINT_FIRST;
    this.emit('tool');
  }
  clearJointPicks(this: Editor) {
    this.jointPicks = [];
    this.hint = this.tool === 'joint' ? (this.jointHingeMode ? HINGE_HINT_FIRST : TOOL_HINTS.joint) : this.hint;
    this.emit('tool');
    this.redraw();
  }
  setJointPreview(this: Editor, subs: SubPath[] | null) {
    this.jointPreview = subs;
    this.redraw();
  }
  /** Verbindung auf die gewählten Kanten anwenden; die Objekte werden zu Pfaden. */
  applyJoint(this: Editor, opt: JointOptions): boolean {
    const picks = this.validJointPicks();
    // Lage der Verbindung vor dem Ändern der Konturen bestimmen (für die 3D-Ansicht)
    const mate = jointMate(picks, opt);
    const guide = !!mate && isGuide(picks[1].obj, opt);
    const r = computeJoint(picks, opt, JOINT_GEOMETRY_VERSION);
    if (r.error) {
      this.hint = t('Verbindung: {error}', { error: r.error });
      this.emit('tool');
      return false;
    }
    const hinge = opt.kind === 'lidhinge';
    this.snapshot(hinge ? t('Scharnier für Deckel') : t('Holzverbindung'));
    for (const [obj, { m, subs }] of r.changes) {
      obj.shape = { kind: 'path', subs: transformSubs(subs, inv(m)) };
      invalidate(obj.shape);
    }
    if (r.added.length) {
      // Neue Teile (Keile, Scharnier-Knöchel) auf dem Layer der ersten Kante
      const first = this.jointPicks[0]?.obj;
      this.doc.objs.push({ id: newId(), m: IDENT, layer: first?.layer ?? this.currentLayer, shape: { kind: 'path', subs: r.added } });
    }
    if (mate) this.recordMate(picks, opt, mate, guide);
    this.jointPicks = [];
    this.hint = hinge ? t('Scharnier angelegt: {info}.', { info: r.info }) : t('Verbindung angelegt: {info}.', { info: r.info });
    this.emit('doc');
    this.emit('sel');
    return true;
  }

  /**
   * Verbindung beim ersten Teil merken. Wurden die Schlitze auf einer einzelnen Hilfslinie angelegt, gehören sie zu
   * der Platte, auf der die Linie liegt (kleinste geschlossene Form um die Linienmitte).
   */
  recordMate(this: Editor, picks: EdgePick[], opt: JointOptions, mate: NonNullable<ReturnType<typeof jointMate>>, guide: boolean) {
    const A = picks[0];
    let B: { obj: Obj; m: Mat } | null = picks[1];
    if (guide) {
      const c = { x: (mate.b[0].x + mate.b[1].x) / 2, y: (mate.b[0].y + mate.b[1].y) / 2 };
      const pt = { X: Math.round(c.x * SCALE), Y: Math.round(c.y * SCALE) };
      let best = Infinity;
      B = null;
      for (const [o, m] of leaves(this.doc.objs)) {
        if (o === A.obj || o === picks[1].obj || o.shape.kind === 'text' || o.shape.kind === 'image') continue;
        const paths = region({ ...o, m });
        // Gerade-Ungerade über alle Konturen: Punkt in der Fläche (nicht in einem Loch)
        if (paths.filter((p) => ClipperLib.Clipper.PointInPolygon(pt, p) !== 0).length % 2 === 0) continue;
        const area = paths.reduce((sum, p) => sum + Math.abs(ClipperLib.Clipper.Area(p)), 0);
        if (area < best) {
          best = area;
          B = { obj: o, m };
        }
      }
      if (!B) return;
    }
    const local = (m: Mat, pts: Pt[]) => {
      const im = inv(m);
      return pts.map((p) => apply(im, p.x, p.y)) as [Pt, Pt, Pt];
    };
    const obj = A.obj;
    obj.mates = [
      ...(obj.mates ?? []),
      { to: B.obj.id, kind: opt.kind, th: opt.thickness, a: local(A.m, mate.a), b: local(B.m, mate.b), ...(mate.out ? { out: true } : {}), ...(mate.lap ? { lap: mate.lap } : {}), fit: { k: opt.kerf, c: opt.clearance, v: JOINT_GEOMETRY_VERSION } },
    ];
  }
}
