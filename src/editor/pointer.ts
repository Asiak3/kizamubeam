import { canvasWheelFactor, pinchGestureActive } from '../canvasZoom';
// Editor: Maus- und Stifteingaben auf der Arbeitsfläche (Ziehen, Zeichnen, Werkzeuge).
import { about, apply, clone, IDENT, inv, Mat, mul, newId, Node, Obj, Pt, rotate, scale, Shape, SubPath, TextShape, translate, visibleLeaves } from '../model';
import { Box, boundsOf, leafIntersectsBox, segments, shapeSubs, textLayout } from '../geom';
import { wrapWidth } from '../fonts';
import { buildSnapSet, findSnap } from '../snap';
import { t, dec } from '../i18n';
import type { Editor } from '../editor';
import { lassoTouchMode } from '../lasso';
import { MAX_VECTOR_SAMPLES } from '../vectorFit';
import { closureOf } from '../shaper';
import { genLeaves, isMarkGroup } from './generators';
import { HINGE_HINT_FIRST, HINGE_HINT_SECOND, LASSO_TOUCH_HINT, RULER, TOOL_HINTS } from './shared';
import { DEFAULT_HANDLE_SIZE } from './render';
import { deformGesture, gestureSpline, hitSpline } from '../shaperSpline';
import { ARC_MIN_RADIUS, arcPoint, arcSpec, arcSubPath, newArcDraft, snapAngle, type ArcDraft, type ArcMode } from './arc';
import { OVERLAP_MOVE_PX } from '../overlapPicker';
import { hitImageCropHandle, pointerCropTo } from '../imageCropUi';

const RIGHT_PAN_KEY = 'kizamubeam.rightPan';
/** Right-drag panning is opt-in: off unless switched on in the settings */
export function loadRightPan(): boolean {
  try {
    return JSON.parse(localStorage.getItem(RIGHT_PAN_KEY) ?? 'false') === true;
  } catch {
    return false;
  }
}

const ZOOM_INVERTED_KEY = 'kizamubeam.zoomInverted';
/** Inverted wheel-zoom direction is opt-in: off unless switched on in the settings */
export function loadZoomInverted(): boolean {
  try {
    return JSON.parse(localStorage.getItem(ZOOM_INVERTED_KEY) ?? 'false') === true;
  } catch {
    return false;
  }
}

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

/** Zahl im Hinweisfeld: höchstens zwei Nachkommastellen, Dezimaltrennzeichen der Sprache. */
const hintNum = (v: number) => dec(String(Math.round(v * 100) / 100));
/** Winkel im Hinweisfeld in Maschinensicht (0° = rechts, gegen den Uhrzeigersinn), auf 0–360° normalisiert. */
const hintDeg = (a: number) => hintNum(((((-a * 180) / Math.PI) % 360) + 360) % 360);
/** Überstrichener Winkel im Hinweisfeld in Grad (Betrag, damit z. B. 90° und 270° unterscheidbar bleiben). */
const hintSweep = (sweep: number) => hintNum((Math.abs(sweep) * 180) / Math.PI);

export class EditorPointer {
  evPt(this: Editor, e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  onDown(this: Editor, e: PointerEvent) {
    // A second pointer must not replace an in-progress freehand stroke.
    if (this.drag?.type === 'pencil' || this.drag?.type === 'shaper' || this.drag?.type === 'shaper-point' || this.drag?.type === 'freehand-edit') return;
    if(this.drag?.type==='lasso')return;
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.drag = { type: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) {
      // Opt-in right-drag panning: decide on release whether it was a click or a drag
      if (this.rightPan && !this.drag) {
        this.suppressContextMenu = false;
        this.drag = { type: 'right', pointerId: e.pointerId, sx, sy, ox: this.view.ox, oy: this.view.oy, panning: false, context: false };
        return;
      }
      this.rightPress();
      return;
    }
    if (e.button !== 0) return;
    if (this.outlinePreview) {
      if (sx >= RULER && sy >= RULER) this.outlinePreview.pick(wp);
      return;
    }

    // Punktabfrage (z. B. Laser zur Klickposition): Klick geht nur an sie, nicht ans Werkzeug
    if (this.pickHandler && (sx >= RULER || sy >= RULER)) {
      this.pickHandler(wp);
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    // Aus dem Lineal ziehen: Hilfslinie (oben waagrecht, links senkrecht)
    if ((sy < RULER) !== (sx < RULER) && !this.drag) {
      if (this.draft) this.finishDraft();
      this.drag = { type: 'guide', axis: sy < RULER ? 'y' : 'x', idx: null, orig: null, moved: false, snapSet: this.hoverSnapSet() };
      return;
    }
    if (this.tool === 'sketch') {
      this.sketchDown(sx, sy, e);
      return;
    }
    switch (this.tool) {
      case 'freehand-edit':this.beginFreehandEdit(wp,e.pointerId);return;
      case 'lasso':this.beginLasso(wp,e,false);return;
      case 'builder':
        if (!this.builderSession) return;
        this.builderSession.picked.clear(); this.builderSession.erase = e.altKey;
        this.builderStroke(wp, wp);
        this.drag = { type: 'builder', last: wp, pointerId: e.pointerId };
        return;
      case 'select': {
        // Bild-Entwurf (Zuschnitt/Perspektive) fängt seine Griffe vor Auswahl/Skalierung ab.
        const ih = this.imageDraft?.() ? hitImageCropHandle(this, sx, sy) : null;
        if (ih) {
          this.drag = ih.mode === 'crop'
            ? { type: 'image-crop', mode: 'crop', handle: ih.handle }
            : { type: 'image-crop', mode: 'perspective', handle: ih.index };
          return;
        }
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
          const own = findSnap(buildSnapSet(this.sel, (l) => this.layer(l.layer).show), wp, this.snapTol().normal / this.view.zoom);
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
      case 'line':
      case 'curvature': {
        const p = this.snapPt(wp, e, { extra: this.draft?.nodes });
        if (!this.draft) {
          const hit = this.continueHit(sx, sy);
          if (hit && this.continuePath(hit.o, hit.end)) return;
          this.draft = { nodes: [], closed: false };
        }
        const ns = this.draft.nodes;
        if (ns.length >= 2) {
          const f = this.toScreen(ns[0]);
          if (Math.hypot(f.x - sx, f.y - sy) < 8) {
            // Drücken auf den Startpunkt heißt Schließen: Klick (ohne Ziehen)
            // schließt beim Loslassen, Ziehen formt vorher die
            // Schlusstangente, Loslassen schließt immer (Press-Stelle zählt).
            const n0 = ns[0];
            this.drag = { type: 'linenode', node: n0, close: {
              cin: n0.cin ? { ...n0.cin } : undefined, cout: n0.cout ? { ...n0.cout } : undefined, smooth: n0.smooth } };
            this.redraw();
            return;
          }
        }
        const n: Node = this.tool === 'curvature' ? { x: p.x, y: p.y, smooth: false } : { x: p.x, y: p.y };
        ns.push(n);
        this.drag = { type: 'linenode', node: n };
        this.redraw();
        return;
      }
      case 'arc': {
        const p = this.snapPt(wp, e, { toggle: false });
        if (!this.arcDraft || this.arcDraft.mode !== this.arcMode) this.arcDraft = newArcDraft(this.arcMode, p);
        const d = this.arcDraft;
        if (d.phase === 1) {
          // Erster Klick setzt Mitte bzw. Startpunkt; Ziehen soll diesen Punkt nicht verschieben.
          if (d.mode === 'center') {
            d.center = p; d.radius = 0; d.a0 = d.a1 = 0; d.start = p;
          } else {
            d.start = p;
          }
          d.mid = d.end = d.start;
        } else {
          this.arcTrack(d, p, e);
        }
        this.drag = { type: 'arc', pointerId: e.pointerId, start: p, moved: false, draft: d };
        this.arcHint(d);
        this.redraw();
        return;
      }
      case 'shaper':
        e.preventDefault();
        // Sparse Bézier anchors and tangents, never the raw mouse samples.
        if (this.shaperEditValid()) {
          const se = this.shaperEdit!;
          {
            const stol = Math.max(10, (this.handleSize ?? DEFAULT_HANDLE_SIZE) / 2 + 3) / this.view.zoom;
            const spline = gestureSpline(se, this.shaperSmoothing);
            const handle = hitSpline(spline.path, wp, stol);
            if (handle) {
              this.clearSnap();
              const result = this.doc.objs.find((o) => o.id === se.resultId)!;
              // Boolean operations replace their operands in the document. Keep
              // those original contours available without snapping to the live cut.
              const snapSet = this.buildSnap([result]);
              const originals = buildSnapSet(se.inputs, (o) => this.layer(o.layer).show);
              snapSet.pts.push(...originals.pts);
              snapSet.pieces.push(...originals.pieces);
              snapSet.boxes.push(...originals.boxes);
              this.drag = { type: 'shaper-point', ...handle, pointerId: e.pointerId, moved: false,
                original: structuredClone(se), shape: structuredClone(result.shape), mat: [...result.m], snapSet };
              this.redraw();
              return;
            }
          }
        }
        // An existing session is edit-only until the user leaves the tool.
        if (this.shaperEdit) return;
        this.clearSnap();
        this.shaperCloseHint = null;
        this.drag = { type: 'shaper', points: [wp], pointerId: e.pointerId, overflow: false };
        this.redraw();
        return;
      case 'pencil':
        e.preventDefault();
        this.clearSnap();
        this.drag = { type: 'pencil', points: [wp], pointerId: e.pointerId, overflow: false };
        this.redraw();
        return;
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
          this.setStartPoint(h.obj, h.sub, h.idx, e.ctrlKey || e.metaKey ? 'reset' : e.shiftKey ? 'reverse' : 'set', h.u);
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
        if(this.nodeLasso && e.altKey){this.beginLasso(wp,e,true);return;}
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
          if(h.which!=='p') {
            const key=`${h.sub}:${h.idx}:${h.which}`,picked=this.handleSelection(target);
            if(add){if(picked.has(key))picked.delete(key);else picked.add(key);this.emit('sel');return;}
            if(!picked.has(key)){this.clearNodeSel();this.handleSelection(target).add(key);}
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
        if(this.nodeLasso && target && (!hit||this.nodeTargets().includes(hit))){this.beginLasso(wp,e,true);return;}
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

  /** Right click: finish the line or sketch draft, or let the context menu open (see suppressContextMenu) */
  rightPress(this: Editor) {
    if (this.outlinePreview) { this.suppressContextMenu = true; return; }
    this.suppressContextMenu = !!this.draft || !!this.arcDraft || this.tool === 'sketch' || this.tool === 'builder' || !!this.pickHandler || !!this.drag;
    if (this.tool === 'builder') this.setTool('select');
    if (this.arcDraft) this.cancelArc();
    if (this.draft) this.finishDraft();
    if (this.sketchEdit && this.sketchEdit.draft.length) {
      this.sketchEdit.draft = [];
      this.sketchEdit.draftIds = [];
      this.redraw();
    }
  }

  /** Pan the view by dragging with the right mouse button (Edit → Settings → Mouse and keyboard) */
  setRightPan(this: Editor, on: boolean) {
    this.rightPan = on;
    try {
      localStorage.setItem(RIGHT_PAN_KEY, JSON.stringify(on));
    } catch {
      /* storage unavailable */
    }
  }

  /** Invert the mouse-wheel zoom direction (Edit → Settings → Mouse and keyboard) */
  setZoomInverted(this: Editor, on: boolean) {
    this.zoomInverted = on;
    try {
      localStorage.setItem(ZOOM_INVERTED_KEY, JSON.stringify(on));
    } catch {
      /* storage unavailable */
    }
  }

  onMove(this: Editor, e: PointerEvent) {
    if(this.drag?.type==='freehand-edit' && this.drag.pointerId!==e.pointerId)return;
    if(this.drag?.type==='lasso'&&this.drag.pointerId!==e.pointerId)return;
    if((this.drag?.type==='freehand-edit'||this.drag?.type==='lasso') && this.drag.pointerId!==e.pointerId)return;
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    this.cursor = wp;
    this.cursorOnCanvas = true;
    const d = this.drag;
    this.emit('view');
    if (!d && this.outlinePreview) {
      this.canvas.style.cursor = 'crosshair';
      this.outlinePreview.move(wp);
      return;
    }
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
        this.cursor = this.snapPt(wp, e, { extra: this.draft?.nodes, toggle: this.tool === 'line' || this.tool === 'curvature' || this.tool === 'text' || this.tool === 'measure' });
        if (this.tool === 'arc') this.arcHover(this.cursor, e);
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
      } else if (this.tool === 'builder') this.builderHover(wp.x, wp.y);
      else if (this.tool === 'node') this.updateNodeHover(sx, sy);
      else if (this.tool === 'joint') this.updateJointHover(sx, sy);
      else if (this.tool === 'relate') this.updateRelHover(sx, sy);
      else if (this.tool === 'trim') this.updateTrimHover(sx, sy);
      else if (this.tool === 'start') this.updateStartHover(sx, sy);
      return;
    }
    switch (d.type) {
      case 'freehand-edit': this.sampleFreehandEdit(wp,e.pointerId); return;
      case 'lasso': {
        if(Math.hypot(wp.x-d.points.at(-1)!.x,wp.y-d.points.at(-1)!.y)*this.view.zoom>=2){if(d.points.length<4096)d.points.push(wp);else d.overflow=true;}
        // Drehrichtung schaltet live zwischen Umschließen (CW) und Berühren (CCW) um.
        // Schwelle ≥3 Punkte wie finishLasso: darunter ist keine Fläche definiert; die eps-Regel
        // in lassoTouchMode dämpft zusätzlich das Flackern zu Gestenbeginn.
        if(!d.components && d.points.length>=3){
          const touchNow=lassoTouchMode(d.points);
          if(touchNow!==d.touch){d.touch=touchNow;this.hint=touchNow?LASSO_TOUCH_HINT:TOOL_HINTS.lasso;this.emit('tool');}
        }
        this.redraw();return;
      }
      case 'builder':
        if (d.pointerId !== e.pointerId) return;
        this.builderStroke(d.last, wp); d.last = wp; return;
      case 'shaper': {
        if (e.pointerId !== d.pointerId || d.overflow) return;
        const samples = e.getCoalescedEvents?.() ?? [];
        for (const sample of [...samples, e]) {
          const p = this.evPt(sample), world = this.toWorld(p.sx, p.sy), last = d.points[d.points.length - 1];
          if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) continue;
          if (Math.hypot(world.x - last.x, world.y - last.y) * this.view.zoom < 1) continue;
          if (d.points.length >= MAX_VECTOR_SAMPLES) { d.overflow = true; this.hint = t('Strich zu lang. Loslassen und einen kürzeren Strich zeichnen.'); this.emit('tool'); break; }
          d.points.push(world);
        }
        // Schließzustand live ansagen: derselbe Endpunktabstand wie bei der Auswertung
        const closed = closureOf(d.points, this.shaperCloseGap).closed;
        if (d.points.length > 1 && closed !== this.shaperCloseHint) {
          this.shaperCloseHint = closed;
          this.hint = closed
            ? t('Loslassen schließt die Kontur.')
            : t('Kontur offen: Ende zurück in den Ring am Startpunkt ziehen.');
          this.emit('tool');
        }
        this.redraw(); return;
      }
      case 'shaper-point': {
        if (e.pointerId !== d.pointerId) return;
        const se = this.shaperEdit;
        if (!this.shaperEditValid() || !se) { this.drag = null; this.redraw(); return; }
        if (!Number.isFinite(wp.x) || !Number.isFinite(wp.y)) return;
        // Keep targets stable during rebuilds; the edited result must not snap to itself.
        const target = this.snapPt(wp, e, { set: d.snapSet });
        const spline = gestureSpline(se, this.shaperSmoothing);
        const node = spline.path.nodes[d.index];
        const handle = d.which === 'p' ? node : node?.[d.which];
        if (!handle || (handle.x === target.x && handle.y === target.y)) { this.redraw(); return; }
        const previous = structuredClone(se);
        deformGesture(se, d, target, this.shaperSmoothing);
        se.pick = 'freehand';
        try {
          if (this.shaperRebuild()) d.moved = true;
          else this.shaperEdit = previous;
        } catch {
          this.shaperEdit = previous;
        }
        this.redraw(); return;
      }
      case 'pencil': {
        if (e.pointerId !== d.pointerId || d.overflow) return;
        const samples = e.getCoalescedEvents?.() ?? [];
        for (const sample of [...samples, e]) {
          const p = this.evPt(sample), world = this.toWorld(p.sx, p.sy), last = d.points[d.points.length - 1];
          if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) continue;
          if (Math.hypot(world.x - last.x, world.y - last.y) * this.view.zoom < 1) continue;
          if (d.points.length >= MAX_VECTOR_SAMPLES) { d.overflow = true; this.hint = t('Strich zu lang. Loslassen und einen kürzeren Strich zeichnen.'); this.emit('tool'); break; }
          d.points.push(world);
        }
        this.redraw(); return;
      }
      case 'pan':
        this.view.ox = d.ox + sx - d.sx;
        this.view.oy = d.oy + sy - d.sy;
        return;
      case 'right':
        if (e.pointerId !== d.pointerId) return;
        if (!d.panning) {
          if (Math.hypot(sx - d.sx, sy - d.sy) < OVERLAP_MOVE_PX) return;
          d.panning = true;
          this.canvas.style.cursor = 'grabbing';
        }
        // From the press point, so the view does not jump by the threshold
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
        // Fang nur für Bilder (andere Typen unverändert): Ecken ohne Shift bleiben
        // seitenverhältnistreu, der Fang wirkt über die dominante Achse.
        let pw = wp;
        if (this.sel.length === 1 && (this.sel[0].shape as any)?.kind === 'image') {
          try {
            pw = this.snapPt(wp, e as never, { set: this.buildSnap([this.sel[0]]), toggle: true });
          } catch { /* Fang ist best-effort; ungefangen weiter */ }
        }
        let fx = hx === 0.5 || !b.w ? 1 : (pw.x - A.x) / (H.x - A.x);
        let fy = hy === 0.5 || !b.h ? 1 : (pw.y - A.y) / (H.y - A.y);
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
      case 'image-crop': {
        // Einheitlicher, reihenfolge-bewusster Zeigerweg ohne eigene Umrechnung:
        // cropFirst entzerrt, perspectiveFirst und Perspektiv-Ecken nicht (Griff = Speicher-Frame).
        const draft = this.imageDraft?.();
        const target = draft ? this.doc.objs.find((x) => x.id === draft.objId) ?? null : null;
        if (!draft || !target || target.shape.kind !== 'image') { this.drag = null; return; }
        const err = pointerCropTo(this, sx, sy, { aspectLock: e.shiftKey, event: e });
        if (err) { this.hint = err; this.emit('tool'); }
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
        if (d.close && Math.hypot(p.x - n.x, p.y - n.y) * this.view.zoom < 3) {
          // Vorgeschärftes Schließen: Kleinstbewegungen formen nichts, damit ein
          // reiner Klick die Anfasser des Startpunkts unverändert lässt.
          this.redraw();
          return;
        }
        if (Math.hypot(p.x - n.x, p.y - n.y) * this.view.zoom < 3) {
          delete n.cin;
          delete n.cout;
          n.smooth = false;
        } else {
          n.cout = { x: p.x, y: p.y };
          n.cin = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
          n.smooth = true;
        }
        this.redraw();
        return;
      }
      case 'arc': {
        if (d.pointerId !== e.pointerId) return;
        const p = this.snapPt(wp, e, { toggle: false });
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.view.zoom > 3) d.moved = true;
        // Der erste Klickpunkt bleibt stehen; die folgenden Schritte folgen dem Zeiger.
        if (d.draft.phase > 1) this.arcTrack(d.draft, p, e);
        this.arcHint(d.draft);
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
        } else if(d.handles.length) {
          const delta={x:tgt.x-d.origWorld.x,y:tgt.y-d.origWorld.y};
          for(const h of d.handles) {
            const matrix=inv(h.obj.m),zero=apply(matrix,0,0),move=apply(matrix,delta.x,delta.y);
            const node=(h.obj.shape as {subs:SubPath[]}).subs[h.sub].nodes[h.idx],p=h.orig[h.which]!;
            node[h.which]={x:p.x+move.x-zero.x,y:p.y+move.y-zero.y};
            // Multi-handle movement is explicit independent movement, like Alt-drag.
            node.smooth=false;this.touch(h.obj.shape);
          }
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
    if((this.drag?.type==='freehand-edit'||this.drag?.type==='lasso') && this.drag.pointerId!==e.pointerId)return;
    // Ignore unrelated releases before clearing the active drag. In particular,
    // a second touch/pen can otherwise make a Pencil stroke silently disappear.
    if (this.drag && 'pointerId' in this.drag && this.drag.pointerId !== e.pointerId) return;
    if (this.drag?.type === 'shaper-point') this.onMove(e);
    if (this.tool === 'sketch') this.sketchUp();
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!this.drawTool) this.clearSnap();
    this.alignGuides = [];
    this.redraw();
    switch (d.type) {
      case 'builder': {
        if (d.pointerId !== e.pointerId) return;
        const p = this.evPt(e), end = this.toWorld(p.sx, p.sy);
        this.builderStroke(d.last, end); this.commitShapeBuilder(); return;
      }
      case 'shaper': {
        if (e.pointerId !== d.pointerId || d.overflow) return;
        const p = this.evPt(e), end = this.toWorld(p.sx, p.sy);
        if (Number.isFinite(end.x) && Number.isFinite(end.y) && d.points.length < MAX_VECTOR_SAMPLES) d.points.push(end);
        if (this.shaperEdit) return;
        void this.finishShaper(d.points);
        return;
      }
      case 'pencil': {
        if (e.pointerId !== d.pointerId || d.overflow) return;
        const p = this.evPt(e), end = this.toWorld(p.sx, p.sy);
        if (Number.isFinite(end.x) && Number.isFinite(end.y) && d.points.length < MAX_VECTOR_SAMPLES) d.points.push(end);
        this.finishPencil(d.points, this.pencilClosed);
        return;
      }
      case 'freehand-edit': { const {sx,sy}=this.evPt(e);this.finishFreehandEdit(d,this.toWorld(sx,sy));return; }
      case 'lasso': {const {sx,sy}=this.evPt(e);if(d.points.length<4096)d.points.push(this.toWorld(sx,sy));this.finishLasso(d);return;}
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
      case 'right':
        if (d.panning) {
          this.canvas.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
          // Windows sends contextmenu after the release: swallow it. WebKit already sent it on press.
          this.suppressContextMenu = !d.context;
          return;
        }
        // A click without moving: the same as with the setting off, only on release
        this.rightPress();
        if (d.context) {
          if (!this.suppressContextMenu) this.onCanvasContext?.(new MouseEvent('contextmenu', { clientX: e.clientX, clientY: e.clientY, button: 2 }));
          this.suppressContextMenu = false;
        }
        return;
      case 'move':
        if (!d.moved && d.toggleRotate) {
          this.rotateMode = !this.rotateMode;
          this.emit('sel');
        }
        // Wie Skalieren und Drehen: das Loslassen melden, damit z. B. die 3D-Ansicht, die beim Ziehen pausiert, folgt
        if (d.moved) this.emit('sel');
        return;
      case 'scale':
      case 'rotate':
        if (this.sel.every((o, i) => o.m === d.orig[i])) this.dropSnapshot();
        this.hint = '';
        this.emit('sel');
        return;
      case 'image-crop':
        // Entwurf bleibt aktiv (kein Snapshot, kein Anwenden bei Pointer-Down/Up).
        this.drag = null;
        this.redraw();
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
          if (this.selectAfterDraw ?? true) this.setTool('select');
          this.setSel([d.obj]);
        }
        return;
      case 'textframe': {
        const r = normBox(d.start, d.end);
        this.createText(r.w * this.view.zoom < 6 ? d.start : r, r.w * this.view.zoom < 6 ? 0 : r.w);
        return;
      }
      case 'linenode': {
        if (this.tool === 'line' || this.tool === 'curvature') {
          const p = this.evPt(e);
          // Start-Ursprung (armed) schließt immer — die Press-Stelle
          // entscheidet; fremde Drags nur bei Loslassen auf dem Startpunkt.
          if (this.draftDropClose(p.sx, p.sy, d.type === 'linenode' && !!d.close)) return;
        }
        return;
      }
      case 'arc': {
        const draft = d.draft;
        if (draft.phase === 3) this.finishArc();
        else if (draft.mode === 'center' && draft.phase === 2 && !(draft.radius >= ARC_MIN_RADIUS)) {
          this.hint = t('Bogen: Radius muss größer als null sein.');
          this.redraw();
          this.emit('tool');
        } else if (draft.mode === '3point' && draft.phase === 2
          && Math.hypot(draft.mid.x - draft.start.x, draft.mid.y - draft.start.y) < 1e-9) {
          this.hint = t('3-Punkt-Bogen: Durchgangspunkt muss sich vom Startpunkt unterscheiden.');
          this.redraw();
          this.emit('tool');
        } else {
          draft.phase = (draft.phase + 1) as 2 | 3;
          this.arcHint(draft);
          this.redraw();
          this.emit('tool');
        }
        return;
      }
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
    if (this.outlinePreview) return;
    if (this.tool === 'builder') return;
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    if (this.tool === 'sketch') {
      this.sketchDouble(sx, sy);
      return;
    }
    if ((this.tool === 'line' || this.tool === 'curvature') && this.draft) {
      // Doppelklick erzeugt zwei Knoten an derselben Stelle; den zweiten verwerfen
      const ns = this.draft.nodes;
      if (ns.length >= 2) {
        const a = ns[ns.length - 1],
          b = ns[ns.length - 2];
        if (Math.hypot(a.x - b.x, a.y - b.y) * this.view.zoom < 4) ns.pop();
      }
      this.finishDraft();
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
    if (e.deltaY) {
      const factor = canvasWheelFactor(e, Math.log(1.0015));
      this.zoomAt(this.zoomInverted && factor > 0 ? 1 / factor : factor, sx, sy);
    }
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

  // ---------- Bogenwerkzeug ----------

  /** Vorschau ohne gedrückte Taste: nächster Schritt folgt dem Zeiger. */
  arcHover(this: Editor, p: Pt, e: { shiftKey: boolean }) {
    const d = this.arcDraft;
    if (!d) return;
    if (d.phase > 1) this.arcTrack(d, p, e);
    this.arcHint(d);
    this.redraw();
  }

  /** Schritt des laufenden Bogens mit dem Zeiger nachführen (Phase 2 und 3). */
  arcTrack(this: Editor, d: ArcDraft, p: Pt, e: { shiftKey: boolean }) {
    if (d.mode === 'center') {
      if (d.phase === 1) return;
      const angle = Math.atan2(p.y - d.center.y, p.x - d.center.x);
      if (d.phase === 2) {
        d.radius = Math.hypot(p.x - d.center.x, p.y - d.center.y);
        d.a0 = e.shiftKey ? snapAngle(angle) : angle;
        d.a1 = d.a0;
      } else {
        d.a1 = e.shiftKey ? snapAngle(angle) : angle;
      }
      d.start = arcPoint(d.center.x, d.center.y, d.radius, d.a0);
      d.end = arcPoint(d.center.x, d.center.y, d.radius, d.a1);
      return;
    }
    if (d.phase === 1) return;
    if (d.phase === 2) {
      d.mid = p;
      // Noch kein dritter Punkt: Ende am Durchgangspunkt lassen, bis der Zeiger weiterläuft.
      d.end = { x: p.x, y: p.y };
    } else d.end = p;
  }

  /** Live-Anzeige von Radius und Winkeln im Hinweisfeld; kein eigenes Panel. */
  arcHint(this: Editor, d: ArcDraft) {
    const phase = d.mode === 'center'
      ? d.phase === 1
        ? t('Bogen: Mitte anklicken. Esc bricht ab.')
        : d.phase === 2
          ? t('Bogen: Radius und Startwinkel anklicken oder ziehen. Shift: 15°-Schritte, Esc verwirft den Bogen.')
          : t('Bogen: Endwinkel anklicken. Shift: 15°-Schritte, Enter übernimmt, Esc verwirft den Bogen.')
      : d.phase === 1
        ? t('3-Punkt-Bogen: Startpunkt anklicken. Esc bricht ab.')
        : d.phase === 2
          ? t('3-Punkt-Bogen: Durchgangspunkt anklicken. Esc verwirft den Bogen.')
          : t('3-Punkt-Bogen: Endpunkt anklicken. Enter übernimmt, Esc verwirft den Bogen.');
    const spec = arcSpec(d, this.arcCw);
    let read = '';
    if (d.mode === 'center' && d.phase > 1 && d.radius > 0) {
      read = d.phase === 3 && spec
        ? t('R {r} mm · {a0}°–{a1}° · {sweep}°', { r: hintNum(d.radius), a0: hintDeg(d.a0), a1: hintDeg(d.a0 + spec.sweep), sweep: hintSweep(spec.sweep) })
        : t('R {r} mm · {a0}°', { r: hintNum(d.radius), a0: hintDeg(d.a0) });
    } else if (spec) {
      read = t('R {r} mm · {a0}°–{a1}° · {sweep}°', { r: hintNum(spec.r), a0: hintDeg(spec.a0), a1: hintDeg(spec.a0 + spec.sweep), sweep: hintSweep(spec.sweep) });
    }
    this.hint = read ? `${read} · ${phase}` : phase;
  }

  /** Bogen verwerfen (Esc, Werkzeugwechsel, Moduswechsel); kein Undo-Schritt. */
  cancelArc(this: Editor) {
    this.arcDraft = null;
    this.hint = TOOL_HINTS.arc;
    this.redraw();
    this.emit('tool');
  }

  /** Optionen der Optionsleiste; ein Moduswechsel beginnt einen neuen Bogen. */
  setArcOptions(this: Editor, patch: { mode?: ArcMode; cw?: boolean }) {
    if (patch.cw !== undefined) this.arcCw = patch.cw;
    if (patch.mode && patch.mode !== this.arcMode) {
      this.arcMode = patch.mode;
      this.arcDraft = null;
      this.hint = TOOL_HINTS.arc;
    }
    this.saveToolOptions();
    if (this.arcDraft) this.arcHint(this.arcDraft);
    this.redraw();
    this.emit('tool');
  }

  /** Bogen übernehmen: ein Objekt, ein Undo-Schritt, Knotenreihenfolge nach der Richtungswahl. */
  finishArc(this: Editor): boolean {
    const d = this.arcDraft;
    if (!d || d.phase !== 3) {
      if (d) this.arcHint(d);
      return false;
    }
    const sub = arcSubPath(d, this.arcCw);
    if (!sub) {
      this.hint = d.mode === 'center'
        ? t('Kein Bogen: Endwinkel und Radius müssen sich von null unterscheiden.')
        : t('Kein Bogen: Die drei Punkte dürfen nicht zusammenfallen oder auf einer Geraden liegen.');
      this.emit('tool');
      return false;
    }
    const layer = this.layer(this.currentLayer);
    if (layer.locked || !layer.show) {
      this.hint = t('Eine sichtbare, entsperrte Ebene wählen.');
      this.emit('tool');
      return false;
    }
    this.arcDraft = null;
    this.snapshot(t('Bogen zeichnen'));
    const o: Obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [{ nodes: sub.nodes, closed: false }] } };
    this.doc.objs.push(o);
    this.emit('doc');
    if (this.selectAfterDraw ?? true) this.setTool('select');
    this.setSel([o]);
    return true;
  }

  finishLine(this: Editor) {
    const d = this.draft;
    const cont = this.continuedFrom;
    this.draft = null;
    this.continuedFrom = null;
    if (!d || d.nodes.length < 2) {
      this.redraw();
      return;
    }
    this.snapshot(t('Linie zeichnen'));
    if (cont) {
      const i = this.doc.objs.indexOf(cont);
      if (i >= 0) this.doc.objs.splice(i, 1);
    }
    const o: Obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [d] } };
    this.doc.objs.push(o);
    this.emit('doc');
    if (this.selectAfterDraw ?? true) this.setTool('select');
    this.setSel([o]);
  }

  /** Laufendes Ziehen abbrechen und den Ausgangszustand wiederherstellen */
  cancelPointerDrag(this: Editor, e: PointerEvent) {
    if (!this.drag || ('pointerId' in this.drag && this.drag.pointerId !== e.pointerId)) return;
    this.cancelDrag();
  }

  cancelDrag(this: Editor) {
    if (this.builderSession) this.builderSession.picked.clear();
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.type === 'shaper-point') {
      if (this.shaperEditValid() && this.shaperEdit) {
        const result = this.doc.objs.find((o) => o.id === this.shaperEdit!.resultId)!;
        this.shaperEdit = d.original;
        result.shape = d.shape;
        result.m = d.mat;
        this.touch(result.shape);
        this.emit('doc');
        this.emit('tool');
      }
    } else if (d.type === 'move' || d.type === 'scale' || d.type === 'rotate') {
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
    } else if (d.type === 'linenode') {
      if (d.close) {
        // Vorgeschärftes Schließen abgebrochen: Startpunkt bleibt im Draft,
        // seine Anfasser werden auf den Stand vor dem Drücken zurückgesetzt.
        if (d.close.cin) d.node.cin = d.close.cin; else delete d.node.cin;
        if (d.close.cout) d.node.cout = d.close.cout; else delete d.node.cout;
        if (d.close.smooth === undefined) delete d.node.smooth; else d.node.smooth = d.close.smooth;
      } else if (this.draft) {
        const i = this.draft.nodes.lastIndexOf(d.node);
        if (i >= 0) this.draft.nodes.splice(i, 1);
        if (!this.draft.nodes.length) { this.draft = null; this.continuedFrom = null; }
      }
    } else if (d.type === 'arc') {
      this.arcDraft = null;
    } else if (d.type === 'right') {
      // Cancelled (e.g. Esc): no context menu when the button comes up
      this.suppressContextMenu = !d.context;
      if (d.panning) this.canvas.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
    }
    this.hint = d.type === 'arc' ? TOOL_HINTS.arc : '';
    this.clearSnap();
    this.emit('doc');
    this.emit('sel');
  }

  startComponentDrag(this: Editor, target: Obj, sub: number, idx: number, which: 'p' | 'cin' | 'cout', start: Pt) {
    const handles=which==='p'?[]:this.selectedHandles().map(h=>({...h,orig:clone(shapeSubs(h.obj.shape)[h.sub].nodes[h.idx])}));
    const targets = which === 'p' ? this.nodeTargets().filter((o) => this.movingNodes(o).length) : handles.length?[...new Set(handles.map(h=>h.obj))]:[target];
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
    this.drag = { type: 'node', obj: target, sub, idx, which, start, orig, group, shapes, handles:handles.length>1?handles:[],
      origWorld: apply(target.m, op.x, op.y), snapSet, moved: false, redo: this.history.saveRedo() };
  }
}
