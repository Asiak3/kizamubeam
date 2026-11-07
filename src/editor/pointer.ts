import { canvasWheelFactor, pinchGestureActive } from '../canvasZoom';
// Editor: Maus- und Stifteingaben auf der Arbeitsfläche (Ziehen, Zeichnen, Werkzeuge).
import { about, apply, clone, IDENT, inv, Mat, mul, newId, Node, Obj, Pt, rotate, scale, Shape, SubPath, TextShape, translate, visibleLeaves } from '../model';
import { Box, boundsOf, leafIntersectsBox, segments, shapeSubs, textLayout } from '../geom';
import { wrapWidth } from '../fonts';
import { buildSnapSet, findSnap } from '../snap';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { genLeaves, isMarkGroup } from './generators';
import { HINGE_HINT_FIRST, HINGE_HINT_SECOND, RULER, SNAP_PX, TOOL_HINTS } from './shared';

const ROTATE_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12a7 7 0 1 1-2-5" stroke="white" stroke-width="4"/><path d="M19 4v4h-4" stroke="white" stroke-width="4"/><path d="M19 12a7 7 0 1 1-2-5" stroke="black" stroke-width="1.8"/><path d="M19 4v4h-4" stroke="black" stroke-width="1.8"/></g></svg>',
  )}") 12 12, alias`;

function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Gerader, ungedrehter Textrahmen (Umbruch an, nicht auf Pfad): Seitengriffe ändern seine Breite */
function frameText(o: Obj, m: Mat): { s: TextShape } | null {
  const s = o.shape;
  if (s.kind !== 'text' || !wrapWidth(s) || s.path) return null;
  if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9 || m[0] <= 0 || m[3] <= 0) return null;
  return { s };
}

const JOINT_HINT_SECOND =
  t('Zweite Kante anklicken (Gegenstück bzw. Linie für die Schlitze) oder Enter für nur eine Kante. Erneuter Klick hebt die Wahl auf.');

export class EditorPointer {
  evPt(this: Editor, e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  onDown(this: Editor, e: PointerEvent) {
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.drag = { type: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) {
      this.suppressContextMenu = !!this.draft || this.tool === 'sketch' || !!this.pickHandler || !!this.drag;
      if (this.draft) this.finishLine();
      if (this.sketchEdit && this.sketchEdit.draft.length) {
        this.sketchEdit.draft = [];
        this.sketchEdit.draftIds = [];
        this.redraw();
      }
      return;
    }
    if (e.button !== 0) return;
    // Punktabfrage (z. B. Laser zur Klickposition): Klick geht nur an sie, nicht ans Werkzeug
    if (this.pickHandler && (sx >= RULER || sy >= RULER)) {
      this.pickHandler(wp);
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    // Aus dem Lineal ziehen: Hilfslinie (oben waagrecht, links senkrecht)
    if ((sy < RULER) !== (sx < RULER) && !this.drag) {
      if (this.draft) this.finishLine();
      this.drag = { type: 'guide', axis: sy < RULER ? 'y' : 'x', idx: null, orig: null, moved: false, snapSet: this.hoverSnapSet() };
      return;
    }
    if (this.tool === 'sketch') {
      this.sketchDown(sx, sy, e);
      return;
    }
    switch (this.tool) {
      case 'select': {
        if (this.hitPivot(sx, sy)) {
          this.drag = { type: 'pivot' };
          return;
        }
        const h = this.hitHandle(sx, sy);
        if (h >= 0) {
          if (this.rotateMode) return this.startRotate(wp);
          if (genLeaves(this.sel).length) {
            // Skalieren würde Modul und Maße eines parametrischen Bauteils verfälschen: erst fragen
            void this.guardGen(this.sel, t('Skalieren')).then((ok) => {
              if (!ok) return;
              this.hint = t('In Pfade umgewandelt. Jetzt lässt sich die Auswahl skalieren.');
              this.emit('tool');
            });
            return;
          }
          this.snapshot(t('Größe ändern'));
          this.drag = { type: 'scale', handle: h, box: this.selBounds()!, orig: this.sel.map((o) => o.m) };
          return;
        }
        if (this.hitRotateZone(sx, sy)) return this.startRotate(wp);
        const o = this.hitTest(wp);
        if (o) {
          const was = this.sel.includes(o);
          if (e.shiftKey && ctrl) this.setSel(this.sel.filter((x) => x !== o));
          else if (ctrl) this.setSel(was ? this.sel.filter((x) => x !== o) : [...this.sel, o]);
          else if (e.shiftKey) {
            if (!was) this.setSel([...this.sel, o]);
          } else if (!was) {
            this.rotateMode = false;
            this.setSel([o]);
          }
          if (!this.sel.includes(o)) return;
          // Wird an einem Fangpunkt der Auswahl gegriffen, fängt genau dieser Punkt
          const own = findSnap(buildSnapSet(this.sel, (l) => this.layer(l.layer).show), wp, SNAP_PX / this.view.zoom);
          this.drag = {
            type: 'move', start: wp, orig: this.sel.map((x) => x.m), moved: false,
            toggleRotate: was && !e.shiftKey && !ctrl, sx, sy,
            anchor: own && own.kind !== 'line' ? own.p : null, box: this.selBounds()!, snapSet: this.buildSnap(this.sel),
          };
        } else {
          // Vorhandene Hilfslinie greifen (nicht bei gesperrter oder ausgeblendeter Ebene „Hilfslinien“)
          const gi = this.guideAt(sx, sy);
          if (gi >= 0) {
            const g = this.guideList()[gi];
            this.drag = { type: 'guide', axis: g.axis, idx: gi, orig: g.v, moved: false, snapSet: this.hoverSnapSet() };
            return;
          }
          const mode = e.shiftKey && ctrl ? 'remove' : ctrl ? 'toggle' : e.shiftKey ? 'add' : 'set';
          if (mode === 'set' && this.sel.length) this.setSel([]);
          this.drag = { type: 'marquee', start: wp, end: wp, base: [...this.sel], mode };
        }
        return;
      }
      case 'rect':
      case 'ellipse':
      case 'polygon':
        this.drag = { type: 'create', start: this.snapPt(wp, e, { toggle: false }), obj: null, snapSet: this.hoverSnapSet() };
        return;
      case 'line': {
        const p = this.snapPt(wp, e, { extra: this.draft?.nodes });
        if (!this.draft) this.draft = { nodes: [], closed: false };
        const ns = this.draft.nodes;
        if (ns.length >= 2) {
          const f = this.toScreen(ns[0]);
          if (Math.hypot(f.x - sx, f.y - sy) < 8) {
            this.draft.closed = true;
            this.finishLine();
            return;
          }
        }
        const n: Node = { x: p.x, y: p.y };
        ns.push(n);
        this.drag = { type: 'linenode', node: n };
        this.redraw();
        return;
      }
      case 'text': {
        e.preventDefault(); // Fokus bleibt im Texteingabefeld
        const o = this.hitTest(wp);
        if (o && o.shape.kind === 'text') {
          this.setSel([o]);
          this.textEditor?.(o, false);
          return;
        }
        // Klicken setzt einen Text, Ziehen einen Textrahmen mit Zeilenumbruch (erst beim Loslassen)
        const p = this.snapPt(wp, e);
        this.clearSnap();
        this.drag = { type: 'textframe', start: p, end: p };
        return;
      }
      case 'trim': {
        const h = this.trimHover;
        if (h) this.applyTrim(h, { keepCopy: e.shiftKey, noJoin: e.ctrlKey || e.metaKey });
        return;
      }
      case 'start': {
        const h = this.startHover;
        if (h) {
          this.setStartPoint(h.obj, h.sub, h.idx, e.ctrlKey || e.metaKey ? 'reset' : e.shiftKey ? 'reverse' : 'set');
          return;
        }
        const o = this.hitTest(wp);
        this.setSel(o ? [o] : []);
        return;
      }
      case 'relate':
        this.relClick();
        return;
      case 'measure':
        this.measureClick(this.snapPt(wp, e, { toggle: true }));
        return;
      case 'joint': {
        const h = this.jointHover;
        if (!h) return;
        const i = this.jointPicks.findIndex((p) => p.obj === h.obj && p.sub === h.sub && p.seg === h.seg);
        if (i >= 0) this.jointPicks.splice(i, 1);
        else this.jointPicks = [...this.jointPicks.slice(-1), h];
        this.hint = this.jointHingeMode
          ? this.jointPicks.length === 1 ? HINGE_HINT_SECOND : HINGE_HINT_FIRST
          : this.jointPicks.length === 1 ? JOINT_HINT_SECOND : TOOL_HINTS.joint;
        this.emit('tool');
        this.redraw();
        if (this.jointPicks.length === 2) this.onJointDialog?.();
        return;
      }
      case 'node': {
        this.updateNodeHover(sx, sy);
        const target = this.nodeTarget();
        const add = e.shiftKey || e.ctrlKey || e.metaKey;
        if (target && this.nodeHover) {
          const h = this.nodeHover;
          const sel = this.nodeSelection(target);
          const key = `${h.sub}:${h.idx}`;
          if (h.which === 'p') {
            if (add) {
              if (sel.has(key)) {
                sel.delete(key);
                this.emit('sel');
                return;
              }
              sel.add(key);
            } else if (!sel.has(key)) {
              this.clearNodeSel();
              this.nodeSets.set(target, sel); sel.clear();
              sel.add(key);
            }
            this.emit('sel');
          }
          this.startComponentDrag(target, h.sub, h.idx, h.which, wp);
          return;
        }
        if (target && this.segHover) {
          // Segments have independent selection/deletion semantics.
          const sg = segments(shapeSubs(target.shape)[this.segHover.sub])[this.segHover.seg];
          const h = this.segHover, key = `${h.sub}:${h.seg}`;
          const sel = this.segmentSelection(target);
          if (add && sel.has(key)) { sel.delete(key); this.emit('sel'); return; }
          if (!add && !sel.has(key)) { this.clearNodeSel(); this.segmentSets.set(target, sel); sel.clear(); }
          sel.add(key);
          this.emit('sel');
          this.startComponentDrag(target, h.sub, sg.ia, 'p', wp);
          return;
        }
        const hit = this.hitTest(wp);
        if (target && (!hit || this.nodeTargets().includes(hit))) {
          // Rahmen zum Auswählen von Knoten
          this.drag = {
            type: 'nodebox', start: wp, end: wp, obj: target, base: new Map(this.nodeTargets().map((o) => [o, new Set(this.nodeSelection(o))])),
            mode: e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'toggle' : 'set', onTarget: hit === target,
          };
          return;
        }
        const o = this.hitTest(wp);
        this.setSel(o ? add ? [...this.sel.filter((x) => x !== o), o] : [o] : []);
        if (o && genLeaves([o]).length) {
          void this.guardGen([o], t('Knoten bearbeiten')).then((ok) => {
            if (!ok) return;
            this.hint = TOOL_HINTS.node;
            this.emit('tool');
          });
          return;
        }
        if (o && (o.shape.kind === 'text' || o.shape.kind === 'barcode')) this.hint = t('Text und QR-Codes haben keine Knoten. Erst in einen Pfad umwandeln (Ctrl+Shift+C).');
        else if (o && o.shape.kind === 'group') this.hint = t('Gruppen erst auflösen (Ctrl+U), dann Knoten bearbeiten.');
        else this.hint = TOOL_HINTS.node;
        this.emit('tool');
        return;
      }
    }
  }

  onMove(this: Editor, e: PointerEvent) {
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    this.cursor = wp;
    const d = this.drag;
    this.emit('view');
    if (!d && this.pickHandler) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    if (!d && this.tool === 'sketch') {
      this.sketchMove(sx, sy, e);
      return;
    }
    if (!d) {
      const hadSnap = !!this.snapHit || this.alignGuides.length > 0;
      this.clearSnap();
      // Mittelpunkte des Objekts unter dem Mauszeiger zeigen
      this.centerHover = this.centerMarks === 'auto' && sy >= RULER && sx >= RULER ? this.hitTest(wp) : null;
      if ((sy < RULER) !== (sx < RULER)) {
        this.canvas.style.cursor = sy < RULER ? 'row-resize' : 'col-resize';
        return;
      }
      if (this.drawTool) {
        // Fangpunkt schon vor dem Klicken zeigen; die Linie im Entstehen folgt ihm
        this.cursor = this.snapPt(wp, e, { extra: this.draft?.nodes, toggle: this.tool === 'line' || this.tool === 'text' || this.tool === 'measure' });
        if (this.tool === 'measure') this.updateMeasureHover(sx, sy);
        this.canvas.style.cursor = this.space ? 'grab' : this.tool === 'text' ? 'text' : 'crosshair';
        return;
      }
      if (hadSnap) this.redraw();
      if (this.tool === 'select') {
        const h = this.hitHandle(sx, sy);
        this.canvas.style.cursor = this.hitPivot(sx, sy)
          ? 'move'
          : h >= 0
            ? this.rotateMode
              ? ROTATE_CURSOR
              : ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'][h % 4]
            : this.hitRotateZone(sx, sy)
              ? ROTATE_CURSOR
              : this.space
                ? 'grab'
                : this.guideAt(sx, sy) >= 0
                  ? this.guideList()[this.guideAt(sx, sy)].axis === 'y'
                    ? 'row-resize'
                    : 'col-resize'
                  : 'default';
      } else if (this.tool === 'node') this.updateNodeHover(sx, sy);
      else if (this.tool === 'joint') this.updateJointHover(sx, sy);
      else if (this.tool === 'relate') this.updateRelHover(sx, sy);
      else if (this.tool === 'trim') this.updateTrimHover(sx, sy);
      else if (this.tool === 'start') this.updateStartHover(sx, sy);
      return;
    }
    switch (d.type) {
      case 'pan':
        this.view.ox = d.ox + sx - d.sx;
        this.view.oy = d.oy + sy - d.sy;
        return;
      case 'move': {
        if (!d.moved) {
          if (Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
          d.moved = true;
          this.snapshot(t('Verschieben'));
        }
        let dx = wp.x - d.start.x,
          dy = wp.y - d.start.y;
        const lock = e.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 'y' : 'x') : null;
        if (lock === 'y') dy = 0;
        if (lock === 'x') dx = 0;
        [dx, dy] = this.snapMove(d, dx, dy, e);
        // Shift hält die Richtung auch beim Fangen
        if (lock === 'y') dy = 0;
        if (lock === 'x') dx = 0;
        const T = translate(dx, dy);
        this.sel.forEach((o, i) => (o.m = mul(T, d.orig[i])));
        this.emit('doc');
        return;
      }
      case 'scale': {
        const b = d.box;
        const hx = [0, 0.5, 1, 1, 1, 0.5, 0, 0][d.handle],
          hy = [0, 0, 0, 0.5, 1, 1, 1, 0.5][d.handle];
        const fromCenter = e.ctrlKey || e.metaKey;
        const ax = fromCenter ? 0.5 : 1 - hx,
          ay = fromCenter ? 0.5 : 1 - hy;
        const A = { x: b.x + ax * b.w, y: b.y + ay * b.h };
        const H = { x: b.x + hx * b.w, y: b.y + hy * b.h };
        let fx = hx === 0.5 || !b.w ? 1 : (wp.x - A.x) / (H.x - A.x);
        let fy = hy === 0.5 || !b.h ? 1 : (wp.y - A.y) / (H.y - A.y);
        const corner = d.handle % 2 === 0;
        if (corner && !e.shiftKey) {
          const s = Math.abs(fx) > Math.abs(fy) ? fx : fy;
          fx = fy = s;
        }
        // Textrahmen am Seitengriff: Rahmenbreite ändern und neu umbrechen statt die Schrift zu strecken
        const frame = hy === 0.5 && !fromCenter && this.sel.length === 1 ? frameText(this.sel[0], d.orig[0]) : null;
        if (frame) {
          frame.s.maxW = Math.max(1, (Math.abs(fx) * b.w) / d.orig[0][0]);
          this.touch(frame.s);
          const lb = textLayout(frame.s).box;
          const m = [...d.orig[0]] as Mat;
          m[4] = hx === 1 ? b.x - m[0] * lb.x : b.x + b.w - m[0] * (lb.x + lb.w);
          this.sel[0].m = m;
          this.emit('doc');
          return;
        }
        const clampS = (v: number) => (Math.abs(v) < 1e-3 ? (v < 0 ? -1e-3 : 1e-3) : v);
        const D = about(scale(clampS(fx), clampS(fy)), A.x, A.y);
        this.sel.forEach((o, i) => (o.m = mul(D, d.orig[i])));
        this.emit('doc');
        return;
      }
      case 'rotate': {
        let a = Math.atan2(wp.y - d.center.y, wp.x - d.center.x) - d.a0;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        else if (e.ctrlKey || e.metaKey) a = Math.round(a / (Math.PI / 36)) * (Math.PI / 36);
        const D = about(rotate(a), d.center.x, d.center.y);
        this.sel.forEach((o, i) => (o.m = mul(D, d.orig[i])));
        d.angle = (-a * 180) / Math.PI;
        this.hint = t('Drehung {angle}° · Shift: 15°-Schritte, Ctrl: 5°-Schritte, Esc: abbrechen', { angle: d.angle.toFixed(1) });
        this.emit('doc');
        return;
      }
      case 'textframe':
        d.end = this.snapPt(wp, e, { toggle: false });
        this.redraw();
        return;
      case 'marquee':
      case 'nodebox':
        d.end = wp;
        if (d.type === 'nodebox') this.redraw();
        return;
      case 'pivot':
        this.pivot = this.snapPt(wp, e);
        return;
      case 'guide': {
        const v = this.snapGuide(d, wp, e);
        const onRuler = d.axis === 'y' ? sy < RULER : sx < RULER;
        if (d.idx === null) {
          if (onRuler) return;
          this.snapshot(t('Hilfslinie'));
          d.idx = this.pushGuide({ axis: d.axis, v });
        } else if (!d.moved && d.orig !== null) {
          this.snapshot(t('Hilfslinie verschieben'));
        }
        d.moved = true;
        this.guideList()[d.idx].v = v;
        const mv = this.toMachine({ x: v, y: v });
        this.hint = t('Hilfslinie {axis} = {pos} mm · zurück ins Lineal ziehen verwirft sie', { axis: d.axis === 'y' ? 'y' : 'x', pos: (d.axis === 'y' ? mv.y : mv.x).toFixed(2) });
        this.emit('doc');
        return;
      }
      case 'create': {
        const p = this.snapPt(wp, e, { set: d.snapSet, toggle: false });
        let dx = p.x - d.start.x,
          dy = p.y - d.start.y;
        if (!d.obj) {
          if (Math.hypot(dx, dy) * this.view.zoom < 3) return;
          this.snapshot(this.tool === 'rect' ? t('Rechteck zeichnen') : this.tool === 'ellipse' ? t('Ellipse zeichnen') : t('Polygon zeichnen'));
          d.obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: this.newShape() };
          this.doc.objs.push(d.obj);
          this.setSel([d.obj]);
        }
        const o = d.obj;
        const fromCenter = e.ctrlKey || e.metaKey;
        if (this.tool === 'polygon') {
          const s = o.shape as Extract<Shape, { kind: 'polygon' }>;
          s.r = Math.hypot(dx, dy);
          o.m = mul(translate(d.start.x, d.start.y), e.shiftKey ? IDENT : rotate(Math.atan2(dy, dx) + Math.PI / 2));
        } else {
          if (e.shiftKey) {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx || 1) * m;
            dy = Math.sign(dy || 1) * m;
          }
          const x0 = fromCenter ? d.start.x - Math.abs(dx) : Math.min(d.start.x, d.start.x + dx);
          const y0 = fromCenter ? d.start.y - Math.abs(dy) : Math.min(d.start.y, d.start.y + dy);
          const w = fromCenter ? Math.abs(dx) * 2 : Math.abs(dx);
          const h = fromCenter ? Math.abs(dy) * 2 : Math.abs(dy);
          if (o.shape.kind === 'rect') {
            o.shape.w = w;
            o.shape.h = h;
            o.m = translate(x0, y0);
          } else if (o.shape.kind === 'ellipse') {
            o.shape.rx = w / 2;
            o.shape.ry = h / 2;
            o.m = translate(x0 + w / 2, y0 + h / 2);
          }
        }
        this.touch(o.shape);
        this.hint = this.sizeHint(o);
        this.emit('doc');
        return;
      }
      case 'linenode': {
        const n = d.node;
        const p = this.snapPt(wp, e, { extra: this.draft?.nodes.filter((m) => m !== n) });
        if (Math.hypot(p.x - n.x, p.y - n.y) * this.view.zoom < 3) {
          delete n.cin;
          delete n.cout;
          delete n.smooth;
        } else {
          n.cout = { x: p.x, y: p.y };
          n.cin = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
          n.smooth = true;
        }
        this.redraw();
        return;
      }
      case 'node': {
        const o = d.obj;
        if (!d.moved) {
          if (Math.hypot(wp.x - d.start.x, wp.y - d.start.y) * this.view.zoom < 1) return;
          this.snapshot(t('Pfadkomponenten verschieben'));
          for (const s of d.shapes) this.convertObjToPath(s.obj);
        }
        const im = inv(o.m);
        const tgt = this.snapPt({ x: d.origWorld.x + wp.x - d.start.x, y: d.origWorld.y + wp.y - d.start.y }, e, { set: d.snapSet });
        const a = apply(im, d.origWorld.x, d.origWorld.y),
          b = apply(im, tgt.x, tgt.y);
        const dx = b.x - a.x,
          dy = b.y - a.y;
        d.moved = true;
        const subs = (o.shape as { subs: SubPath[] }).subs;
        const n = subs[d.sub].nodes[d.idx];
        const sh = (p?: Pt) => (p ? { x: p.x + dx, y: p.y + dy } : undefined);
        if (d.which === 'p' && d.group.length) {
          for (const g of d.group) {
            const matrix = inv(g.obj.m), p0 = apply(matrix, 0, 0), p1 = apply(matrix, tgt.x - d.origWorld.x, tgt.y - d.origWorld.y);
            const gx = p1.x - p0.x, gy = p1.y - p0.y;
            const shift = (p?: Pt) => p && ({ x: p.x + gx, y: p.y + gy });
            const m = (g.obj.shape as { subs: SubPath[] }).subs[g.sub].nodes[g.idx];
            m.x = g.orig.x + gx;
            m.y = g.orig.y + gy;
            m.cin = shift(g.orig.cin);
            m.cout = shift(g.orig.cout);
            if (!m.cin) delete m.cin;
            if (!m.cout) delete m.cout;
            this.touch(g.obj.shape);
          }
        } else if (d.which === 'p') {
          n.x = d.orig.x + dx;
          n.y = d.orig.y + dy;
          n.cin = sh(d.orig.cin);
          n.cout = sh(d.orig.cout);
          if (!n.cin) delete n.cin;
          if (!n.cout) delete n.cout;
        } else {
          const h = sh(d.orig[d.which])!;
          n[d.which] = h;
          const other = d.which === 'cin' ? 'cout' : 'cin';
          if (n.smooth && !e.altKey && n[other]) {
            const len = Math.hypot(n[other]!.x - n.x, n[other]!.y - n.y);
            const vx = n.x - h.x,
              vy = n.y - h.y,
              vl = Math.hypot(vx, vy) || 1;
            n[other] = { x: n.x + (vx / vl) * len, y: n.y + (vy / vl) * len };
          } else if (e.altKey) n.smooth = false;
        }
        this.touch(o.shape);
        this.emit('doc');
        return;
      }
    }
  }

  onUp(this: Editor, e: PointerEvent) {
    if (this.tool === 'sketch') this.sketchUp();
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!this.drawTool) this.clearSnap();
    this.alignGuides = [];
    this.redraw();
    switch (d.type) {
      case 'guide': {
        if (d.idx === null || !d.moved) return;
        const { sx, sy } = this.evPt(e);
        this.hint = '';
        if (d.axis === 'y' ? sy < RULER : sx < RULER) {
          // zurück ins Lineal gezogen: eine neue verwerfen, eine vorhandene löschen
          this.removeGuide(d.idx);
          if (d.orig === null) this.dropSnapshot();
        }
        this.emit('doc');
        return;
      }
      case 'pan':
        this.canvas.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
        return;
      case 'move':
        if (!d.moved && d.toggleRotate) {
          this.rotateMode = !this.rotateMode;
          this.emit('sel');
        }
        return;
      case 'scale':
      case 'rotate':
        if (this.sel.every((o, i) => o.m === d.orig[i])) this.dropSnapshot();
        this.hint = '';
        this.emit('sel');
        return;
      case 'marquee': {
        const r = normBox(d.start, d.end);
        if (r.w * this.view.zoom < 3 && r.h * this.view.zoom < 3) {
          this.redraw();
          return;
        }
        const enclose = d.end.x >= d.start.x;
        const hits = this.doc.objs.filter((o) => {
          if (!this.selectable(o)) return false;
          if (enclose) {
            const b = boundsOf([o]);
            return !!b && b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
          }
          return [...visibleLeaves([o])].some(([l, m]) => leafIntersectsBox(l, m, r));
        });
        let next: Obj[];
        if (d.mode === 'set') next = hits;
        else if (d.mode === 'add') next = [...d.base, ...hits.filter((h) => !d.base.includes(h))];
        else if (d.mode === 'remove') next = d.base.filter((o) => !hits.includes(o));
        else next = [...d.base.filter((o) => !hits.includes(o)), ...hits.filter((h) => !d.base.includes(h))];
        this.rotateMode = false;
        this.setSel(next);
        return;
      }
      case 'create':
        this.hint = '';
        if (d.obj) {
          this.emit('doc');
          this.setTool('select');
          this.setSel([d.obj]);
        }
        return;
      case 'textframe': {
        const r = normBox(d.start, d.end);
        this.createText(r.w * this.view.zoom < 6 ? d.start : r, r.w * this.view.zoom < 6 ? 0 : r.w);
        return;
      }
      case 'linenode':
      case 'pivot':
        return;
      case 'node':
        if (d.moved && d.shapes.every((s) => JSON.stringify(s.obj.shape) === JSON.stringify(s.shape))) {
          this.dropSnapshot(); this.history.restoreRedo(d.redo);
        }
        this.emit('doc');
        return;
      case 'nodebox': {
        const r = normBox(d.start, d.end);
        if (r.w * this.view.zoom < 3 && r.h * this.view.zoom < 3) {
          // einfacher Klick: Knotenauswahl aufheben, im Leeren auch das Objekt abwählen
          if (d.mode === 'set') {
            this.clearNodeSel();
          }
          this.emit('sel');
          return;
        }
        if (d.mode === 'set') this.clearNodeSel();
        for (const obj of this.nodeTargets()) {
          const sel = this.nodeSelection(obj);
          shapeSubs(obj.shape).forEach((sp, si) => sp.nodes.forEach((n, ni) => {
            const p = apply(obj.m, n.x, n.y), key = `${si}:${ni}`;
            if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return;
            if (d.mode === 'toggle' && d.base.get(obj)?.has(key)) sel.delete(key);
            else sel.add(key);
          }));
        }
        this.emit('sel');
        return;
      }
    }
    void e;
  }

  onDouble(this: Editor, e: MouseEvent) {
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    if (this.tool === 'sketch') {
      this.sketchDouble(sx, sy);
      return;
    }
    if (this.tool === 'line' && this.draft) {
      // Doppelklick erzeugt zwei Knoten an derselben Stelle; den zweiten verwerfen
      const ns = this.draft.nodes;
      if (ns.length >= 2) {
        const a = ns[ns.length - 1],
          b = ns[ns.length - 2];
        if (Math.hypot(a.x - b.x, a.y - b.y) * this.view.zoom < 4) ns.pop();
      }
      this.finishLine();
      return;
    }
    if (this.tool === 'select') {
      const o = this.hitTest(wp);
      if (o && o.shape.kind === 'text') {
        this.setSel([o]);
        this.rotateMode = false;
        this.textEditor?.(o, false);
      } else if (o && o.shape.kind === 'barcode') {
        this.setSel([o]);
        this.onBarcodeEdit?.(o);
      } else if (o && o.shape.kind === 'gen') {
        this.setSel([o]);
        this.onGenEdit?.(o);
      } else if (o && o.shape.kind === 'group' && isMarkGroup(o)) {
        // Teil mit gravierter Nummer (z. B. Schichtmodell): Parameter des Teils öffnen
        this.setSel([o]);
        this.onGenEdit?.(o.shape.children.find((c) => c.shape.kind === 'gen')!);
      } else if (o && o.shape.kind !== 'group') {
        this.setSel([o]);
        this.setTool('node');
      }
    } else if (this.tool === 'node' && this.segHover) this.insertNode();
  }

  onWheel(this: Editor, e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey && pinchGestureActive(this.canvas)) return;
    const { sx, sy } = this.evPt(e);
    if (e.deltaY) this.zoomAt(canvasWheelFactor(e, Math.log(1.0015)), sx, sy);
  }

  newShape(this: Editor): Shape {
    if (this.tool === 'rect') return { kind: 'rect', w: 0, h: 0, r: this.rectRadius };
    if (this.tool === 'ellipse') return { kind: 'ellipse', rx: 0, ry: 0 };
    return { kind: 'polygon', sides: this.polySides, r: 0, star: this.polyStar, inner: 0.5 };
  }

  sizeHint(this: Editor, o: Obj) {
    const b = boundsOf([o]);
    return b ? `${b.w.toFixed(2)} × ${b.h.toFixed(2)} mm` : '';
  }

  finishLine(this: Editor) {
    const d = this.draft;
    this.draft = null;
    if (!d || d.nodes.length < 2) {
      this.redraw();
      return;
    }
    this.snapshot(t('Linie zeichnen'));
    const o: Obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [d] } };
    this.doc.objs.push(o);
    this.emit('doc');
    this.setTool('select');
    this.setSel([o]);
  }

  /** Laufendes Ziehen abbrechen und den Ausgangszustand wiederherstellen */
  cancelDrag(this: Editor) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.type === 'move' || d.type === 'scale' || d.type === 'rotate') {
      this.sel.forEach((o, i) => (o.m = d.orig[i]));
      if (d.type !== 'move' || d.moved) this.dropSnapshot();
    } else if (d.type === 'guide') {
      if (d.idx !== null && d.moved) {
        if (d.orig === null) this.removeGuide(d.idx);
        else this.guideList()[d.idx].v = d.orig;
        this.dropSnapshot();
      }
    } else if (d.type === 'create' && d.obj) {
      this.doc.objs = this.doc.objs.filter((o) => o !== d.obj);
      this.dropSnapshot();
      this.setSel([]);
    } else if (d.type === 'node') {
      if (d.moved) {
        for (const s of d.shapes) { s.obj.shape = s.shape; this.touch(s.shape); }
        this.dropSnapshot(); this.history.restoreRedo(d.redo);
      }
    }
    this.hint = '';
    this.clearSnap();
    this.emit('doc');
    this.emit('sel');
  }

  startComponentDrag(this: Editor, target: Obj, sub: number, idx: number, which: 'p' | 'cin' | 'cout', start: Pt) {
    const targets = which === 'p' ? this.nodeTargets().filter((o) => this.movingNodes(o).length) : [target];
    const shapes = targets.map((obj) => ({ obj, shape: clone(obj.shape) }));
    const subs = shapeSubs(target.shape), orig = clone(subs[sub].nodes[idx]);
    const group = which === 'p' ? targets.flatMap((obj) => this.movingNodes(obj).map((n) => ({ ...n, orig: clone(shapeSubs(obj.shape)[n.sub].nodes[n.idx]) }))) : [];
    const op = which === 'p' ? orig : orig[which]!;
    const snapSet = this.buildSnap(targets);
    for (const obj of targets) {
      const moving = new Set(group.filter((g) => g.obj === obj).map((g) => `${g.sub}:${g.idx}`));
      shapeSubs(obj.shape).forEach((sp, si) => sp.nodes.forEach((n, ni) => {
        if (moving.has(`${si}:${ni}`) || (obj === target && si === sub && ni === idx)) return;
        const p = apply(obj.m, n.x, n.y); snapSet.addPoint(p.x, p.y, 'node');
      }));
    }
    this.drag = { type: 'node', obj: target, sub, idx, which, start, orig, group, shapes,
      origWorld: apply(target.m, op.x, op.y), snapSet, moved: false, redo: this.history.saveRedo() };
  }
}
