// Editor: Fangen an Raster, Objekten und Hilfslinien.
import { newId, Obj, Pt, translate } from '../model';
import { alignBox, alignPoint, buildSnapSet, findSnap, SnapHit, SnapSet } from '../snap';
import type { Editor } from '../editor';
import { Drag, SNAP_PX } from './shared';

const SNAP_KEY = 'kizamubeam.snap';

const SNAP_PX_ALT = 20;

/** Werkzeug-Layer T1: Hilfslinien liegen dort und werden nie gelasert */
const GUIDE_LAYER = 30;

type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean };

export class EditorSnapping {
  /** Fang-Einstellungen ändern und merken */
  setSnap(this: Editor, patch: { grid?: boolean; objects?: boolean; step?: number; centers?: Editor['centerMarks'] }) {
    if (patch.centers !== undefined) this.centerMarks = patch.centers;
    if (patch.grid !== undefined) this.snapGrid = patch.grid;
    if (patch.objects !== undefined) this.snapObjects = patch.objects;
    if (patch.step !== undefined && patch.step > 0) this.gridStep = patch.step;
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({ grid: this.snapGrid, objects: this.snapObjects, step: this.gridStep, centers: this.centerMarks }));
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.emit('view');
  }
  loadSnapSettings(this: Editor) {
    try {
      const st = JSON.parse(localStorage.getItem(SNAP_KEY) ?? '{}');
      if (typeof st.grid === 'boolean') this.snapGrid = st.grid;
      if (typeof st.objects === 'boolean') this.snapObjects = st.objects;
      if (typeof st.step === 'number' && st.step > 0) this.gridStep = st.step;
      if (st.centers === 'off' || st.centers === 'auto' || st.centers === 'all') this.centerMarks = st.centers;
    } catch {
      /* Standardwerte */
    }
  }
  clearSnap(this: Editor) {
    this.snapHit = null;
    this.alignGuides = [];
  }
  /** Fangpunkte aller sichtbaren Objekte außer skip */
  buildSnap(this: Editor, skip: Obj[] = []): SnapSet {
    return buildSnapSet(this.doc.objs, (o) => this.layer(o.layer).show, new Set(skip));
  }
  /** Fangpunkte aller Objekte, zwischengespeichert bis zur nächsten Änderung */
  hoverSnapSet(this: Editor): SnapSet {
    if (!this.snapCache || this.snapCache.ver !== this.snapVer) this.snapCache = { ver: this.snapVer, set: this.buildSnap() };
    return this.snapCache.set;
  }
  /** Ctrl hält gedrückt: Fangen umkehren (Standard: aus), wie in LightBurn */
  snapModes(this: Editor, e: Mods | null, toggle: boolean) {
    const flip = !!e && toggle && (e.ctrlKey || e.metaKey);
    return { obj: this.snapObjects !== flip, grid: this.snapGrid !== flip, alt: !!e?.altKey };
  }
  gridRound(this: Editor, p: Pt): Pt {
    const g = this.gridStep;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }
  /**
   * Weltpunkt fangen: zuerst Objektfang, mit Alt Ausrichtung an Fangpunkten, sonst Raster.
   * toggle: Ctrl kehrt das Fangen um (nicht beim Aufziehen von Formen, dort heißt Ctrl „von der Mitte“).
   */
  snapPt(this: Editor, p: Pt, e: Mods | null, opt: { set?: SnapSet; extra?: Pt[]; toggle?: boolean } = {}): Pt {
    this.clearSnap();
    const md = this.snapModes(e, opt.toggle ?? true);
    if (md.obj) {
      const set = opt.set ?? this.hoverSnapSet();
      const tol = (md.alt ? SNAP_PX_ALT : SNAP_PX) / this.view.zoom;
      const hit = findSnap(set, p, tol, opt.extra);
      if (hit) {
        this.snapHit = hit;
        return hit.p;
      }
      if (md.alt) {
        const a = alignPoint(set, p, tol, opt.extra);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          return a.p;
        }
      }
    }
    return md.grid ? this.gridRound(p) : p;
  }
  /** Verschiebung der Auswahl fangen: Griffpunkt oder Ecken/Mitte der Auswahl an anderen Objekten, Alt richtet Kanten aus */
  snapMove(this: Editor, d: Extract<Drag, { type: 'move' }>, dx: number, dy: number, e: Mods): [number, number] {
    this.clearSnap();
    const md = this.snapModes(e, true);
    const tol = (md.alt ? SNAP_PX_ALT : SNAP_PX) / this.view.zoom;
    if (md.obj) {
      const b = d.box;
      const own = d.anchor
        ? [d.anchor]
        : [0, 0.5, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: b.x + fx * b.w, y: b.y + fy * b.h })));
      let best: { hit: SnapHit; from: Pt; dist: number } | null = null;
      for (const pass of ['point', 'line'] as const) {
        for (const q of own) {
          const moved = { x: q.x + dx, y: q.y + dy };
          const hit = findSnap(d.snapSet, moved, tol);
          if (!hit || (pass === 'point') === (hit.kind === 'line')) continue;
          const dist = Math.hypot(hit.p.x - moved.x, hit.p.y - moved.y);
          if (!best || dist < best.dist) best = { hit, from: q, dist };
        }
        if (best) break;
      }
      if (best) {
        this.snapHit = best.hit;
        return [best.hit.p.x - best.from.x, best.hit.p.y - best.from.y];
      }
      if (md.alt) {
        const a = alignBox(d.snapSet, { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, tol);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          dx += a.dx;
          dy += a.dy;
          // nicht ausgerichtete Achse darf noch am Raster fangen
          if (md.grid && !a.guides.some((g) => g.axis === 'x')) dx = this.gridDelta(d, dx, 'x');
          if (md.grid && !a.guides.some((g) => g.axis === 'y')) dy = this.gridDelta(d, dy, 'y');
          return [dx, dy];
        }
      }
    }
    if (md.grid) return [this.gridDelta(d, dx, 'x'), this.gridDelta(d, dy, 'y')];
    return [dx, dy];
  }
  /** Rasterfang beim Verschieben: der Griffpunkt landet auf dem Raster, ohne Griffpunkt wird der Weg gerundet */
  gridDelta(this: Editor, d: Extract<Drag, { type: 'move' }>, v: number, axis: 'x' | 'y'): number {
    const g = this.gridStep;
    if (!d.anchor) return Math.round(v / g) * g;
    return Math.round((d.anchor[axis] + v) / g) * g - d.anchor[axis];
  }
  /** Hilfslinie fangen: an der Höhe (bzw. x-Lage) des nächsten Fangpunkts irgendwo auf der Fläche, sonst am Raster */
  snapGuide(this: Editor, d: Extract<Drag, { type: 'guide' }>, wp: Pt, e: Mods): number {
    this.clearSnap();
    const md = this.snapModes(e, true);
    const ax = d.axis;
    if (md.obj) {
      const tol = (md.alt ? SNAP_PX_ALT : SNAP_PX) / this.view.zoom;
      let best: (typeof d.snapSet.pts)[number] | null = null;
      for (const q of d.snapSet.pts) if (Math.abs(q[ax] - wp[ax]) <= tol && (!best || Math.abs(q[ax] - wp[ax]) < Math.abs(best[ax] - wp[ax]))) best = q;
      if (best) {
        this.snapHit = { p: { x: best.x, y: best.y }, kind: best.kind };
        return best[ax];
      }
    }
    return md.grid ? this.gridRound(wp)[ax] : wp[ax];
  }
  /** Neue Hilfslinie (Werkzeug-Layer T1) über das ganze Bett */
  makeGuide(this: Editor, axis: 'x' | 'y', v: number): Obj {
    const { w, h } = this.doc.bed;
    const nodes = axis === 'y' ? [{ x: 0, y: 0 }, { x: w, y: 0 }] : [{ x: 0, y: 0 }, { x: 0, y: h }];
    return {
      id: newId(), m: axis === 'y' ? translate(0, v) : translate(v, 0), layer: GUIDE_LAYER,
      shape: { kind: 'path', subs: [{ nodes, closed: false }] },
    };
  }
}
