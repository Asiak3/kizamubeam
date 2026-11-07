// Editor: Zeichnen der Arbeitsfläche.
import { apply, IDENT, ImageShape, inv, leaves, Mat, mul, noLaserLeaves, Obj, PALETTE, Pt, SubPath, TextShape, visibleLeaves } from '../model';
import { displayCanvas } from '../images';
import { EdgePick } from '../joints';
import { bezierPt, Box, boundsOf, drawText, localPath, segments, shapeSubs, subsToPath2D, textOutline, worldPath } from '../geom';
import { SNAP_LABELS } from '../snap';
import { shapeCenters, shownMark } from '../arcs';
import { measureOf, RelElem } from '../relations';
import { entOf, isDim, measureCon, pointPair, ptOf, SkCon } from '../sketch/model';
import { CON_GLYPHS } from './sketch';
import { dec, t } from '../i18n';
import type { Editor } from '../editor';
import { RULER, HANDLE_OFF, cachedWorldPath, SNAP_COLOR } from './shared';
import { GRID_MIN_PX, gridLevels, gridLines, LEVEL_ALPHA } from '../grid';

function rectPath(w: number, h: number): Path2D {
  const p = new Path2D();
  p.rect(0, 0, w, h);
  return p;
}

function closedPath(subs: SubPath[], m: Mat): Path2D {
  const p = new Path2D();
  p.addPath(subsToPath2D(subs.filter((sp) => sp.closed)), new DOMMatrix(m));
  return p;
}

/** Sehr dunkle Layerfarben auf dunklem Grund aufhellen (Farbton bleibt), Schwarz wird Hellgrau. */
const darkColorCache = new Map<string, string>();

function brightenForDark(hex: string): string {
  let out = darkColorCache.get(hex);
  if (out) return out;
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
  if (lum < 0.02) out = '#e8e8e8';
  else if (lum < 0.15) {
    const mix = 0.45;
    out = '#' + v.map((c) => Math.round(c + (255 - c) * mix).toString(16).padStart(2, '0')).join('');
  } else out = hex;
  darkColorCache.set(hex, out);
  return out;
}

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 100) / 100));

export class EditorRender {
  setDark(this: Editor, dark: boolean) {
    this.dark = dark;
    this.redraw();
  }
  /** Layerfarbe zum Zeichnen: Schwarz wird auf dunklem Grund hell dargestellt */
  layerDrawColor(this: Editor, i: number): string {
    const c = PALETTE[i] ?? '#000000';
    return this.dark ? brightenForDark(c) : c;
  }

  /**
   * Arbeitsfläche als PNG (data:-URL) für KI-Agenten: Ausschnitt `box` in Weltkoordinaten, längere Seite
   * etwa `size` Pixel, mit Linealen, ohne Auswahl und Hilfslinien. Die Ansicht der Person bleibt unverändert.
   */
  renderImage(this: Editor, box: Box, size: number): string {
    const pad = 12;
    const z = (size - RULER - pad * 2) / Math.max(box.w, box.h, 1);
    const off = document.createElement('canvas');
    off.width = Math.round(RULER + pad * 2 + box.w * z);
    off.height = Math.round(RULER + pad * 2 + box.h * z);
    const saved = {
      canvas: this.canvas, ctx: this.ctx, dpr: this.dpr, view: this.view, sel: this.sel,
      nodeHover: this.nodeHover, segHover: this.segHover, snapHit: this.snapHit, alignGuides: this.alignGuides, draft: this.draft,
      centerMarks: this.centerMarks,
      isolation: this.isolation,
      overlapHover: this.overlapHover,
    };
    try {
      this.canvas = off;
      this.ctx = off.getContext('2d')!;
      this.dpr = 1;
      this.view = { zoom: z, ox: RULER + pad - box.x * z, oy: RULER + pad - box.y * z };
      this.sel = [];
      this.nodeHover = this.segHover = this.snapHit = null;
      this.alignGuides = [];
      this.draft = null;
      this.centerMarks = 'off';
      this.isolation = null;
      this.overlapHover = null;
      this.render();
      return off.toDataURL('image/png');
    } finally {
      Object.assign(this, saved);
      this.dirty = true;
    }
  }

  render(this: Editor) {
    const ctx = this.ctx,
      dpr = this.dpr,
      { zoom: z, ox, oy } = this.view;
    const W = this.w,
      H = this.h;
    const bed = this.doc.bed;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = this.colors;
    ctx.fillStyle = T.outside;
    ctx.fillRect(0, 0, W, H);

    // Bett und Raster (in Bildschirmkoordinaten für scharfe Linien)
    const p0 = this.toScreen({ x: 0, y: 0 }),
      p1 = this.toScreen({ x: bed.w, y: bed.h });
    ctx.fillStyle = T.bed;
    ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    if (this.background) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.clip();
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
      this.background(ctx);
      ctx.restore();
    }
    const G = this.grid;
    if (G.show) {
      const levelColor = { fine: T.grid1, major: T.grid10, bold: T.grid100 };
      ctx.save();
      const xa = Math.max(0, this.toWorld(0, 0).x),
        xb = Math.min(bed.w, this.toWorld(W, 0).x);
      // y-Raster von unten (Maschinennull) gezählt: sichtbarer Bereich in Maschinen-y
      const ya = Math.max(0, bed.h - this.toWorld(0, H).y),
        yb = Math.min(bed.h, bed.h - this.toWorld(0, 0).y);
      for (const { level, step } of gridLevels(G)) {
        if (step * z < GRID_MIN_PX) continue;
        ctx.beginPath();
        for (const x of gridLines(step, xa, xb)) {
          const s = Math.round(x * z + ox) + 0.5;
          ctx.moveTo(s, p0.y);
          ctx.lineTo(s, p1.y);
        }
        for (const y of gridLines(step, ya, yb)) {
          const s = Math.round((bed.h - y) * z + oy) + 0.5;
          ctx.moveTo(p0.x, s);
          ctx.lineTo(p1.x, s);
        }
        ctx.strokeStyle = G.color || levelColor[level];
        ctx.globalAlpha = (G.opacity / 100) * (G.color ? LEVEL_ALPHA[level] : 1);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    // Ursprungsmarker
    ctx.fillStyle = '#e02020';
    ctx.fillRect(p0.x - 4, p1.y - 4, 8, 8);
    ctx.fillStyle = '#20a020';
    ctx.fillRect(p1.x - 4, p0.y - 4, 8, 8);

    // Objekte
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    const px = 1 / z;
    const selSet = new Set<Obj>();
    for (const o of this.sel) for (const [l] of leaves([o])) selSet.add(l);
    // Pfade je Layer sammeln und gebündelt zeichnen (deutlich schneller als einzeln)
    const batches = new Map<string, { color: string; fill: boolean; sel: boolean; faded: boolean; stroke: Path2D; fillPath: Path2D }>();
    const texts: [Obj, Mat, boolean, boolean][] = [];
    const images: [Obj, Mat, boolean][] = [];
    // Objects that are not lasered are drawn faded
    const faded = noLaserLeaves(this.doc.objs);
    const FADE = 0.35;
    for (const [o, m] of visibleLeaves(this.viewObjects())) {
      const ly = this.layer(o.layer);
      if (!ly.show) continue;
      const selected = selSet.has(o);
      const fill = this.filled && ly.mode === 'fill';
      if (o.shape.kind === 'image') {
        images.push([o, m, selected]);
        continue;
      }
      if (o.shape.kind === 'text') {
        texts.push([o, m, selected, fill]);
        continue;
      }
      const off = faded.has(o);
      const key = `${o.layer}|${selected ? 1 : 0}|${off ? 1 : 0}`;
      let bt = batches.get(key);
      if (!bt) batches.set(key, (bt = { color: this.layerDrawColor(o.layer), fill, sel: selected, faded: off, stroke: new Path2D(), fillPath: new Path2D() }));
      const p = cachedWorldPath(o, m);
      bt.stroke.addPath(p);
      if (fill) {
        // Offene Pfade werden auf Füll-Layern nicht gefüllt
        const s = o.shape;
        bt.fillPath.addPath(s.kind !== 'path' || s.subs.every((sp) => sp.closed) ? p : closedPath(s.subs, m));
      }
    }
    // Bilder liegen unter den Vektoren und zeigen das Ergebnis der Bildverarbeitung
    for (const [o, m, selected] of images) {
      const s = o.shape as ImageShape;
      const cv = displayCanvas(s, m, this.imgLayer(o.layer));
      ctx.save();
      if (faded.has(o)) ctx.globalAlpha = FADE;
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (cv) {
        // Vergrößert scharfe Punkte zeigen, verkleinert glätten
        const scr = (z * Math.hypot(m[0], m[1]) * s.w) / cv.width;
        ctx.imageSmoothingEnabled = scr < 1.5;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cv, 0, 0, s.w, s.h);
      } else {
        ctx.fillStyle = 'rgba(128,128,128,0.25)';
        ctx.fillRect(0, 0, s.w, s.h);
      }
      const k = 1 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
      ctx.strokeStyle = this.layerDrawColor(o.layer);
      ctx.lineWidth = (selected ? 1.5 : 1) * px * k;
      ctx.setLineDash(selected ? [5 * px * k, 3 * px * k] : []);
      ctx.strokeRect(0, 0, s.w, s.h);
      ctx.restore();
    }
    for (const bt of batches.values()) {
      const a = bt.faded ? FADE : 1;
      ctx.strokeStyle = ctx.fillStyle = bt.color;
      if (bt.fill) {
        ctx.globalAlpha = 0.55 * a;
        ctx.fill(bt.fillPath, 'evenodd');
      }
      ctx.globalAlpha = a;
      ctx.setLineDash(bt.sel ? [5 * px, 3 * px] : []);
      ctx.lineWidth = bt.sel ? 1.5 * px : 1.2 * px;
      ctx.stroke(bt.stroke);
      ctx.globalAlpha = 1;
    }
    for (const [o, m, selected, fill] of texts) {
      const t = o.shape as TextShape;
      ctx.strokeStyle = ctx.fillStyle = this.layerDrawColor(o.layer);
      ctx.setLineDash(selected ? [5 * px, 3 * px] : []);
      ctx.globalAlpha = faded.has(o) ? FADE : 1;
      drawText(ctx, t, m, fill ? 'fill' : 'stroke', fill ? px : px * 1.2);
      ctx.globalAlpha = 1;
      if (selected && t.path && t.path.link === undefined) {
        // Kurve des Texts als Hilfslinie, wenn die Form nicht mehr da ist
        const g = new Path2D();
        g.addPath(subsToPath2D([t.path.sub]), new DOMMatrix(m));
        ctx.save();
        ctx.setLineDash([2 * px, 3 * px]);
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = px;
        ctx.strokeStyle = this.colors.sel;
        ctx.stroke(g);
        ctx.restore();
      }
      if (selected) {
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.globalAlpha = 0.5;
        const b = boundsOf([o], mul(m, inv(o.m)))!;
        ctx.lineWidth = px;
        ctx.strokeStyle = this.colors.sel;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);

    // Linie im Entstehen
    if (this.draft && this.draft.nodes.length) {
      const sp: SubPath = { nodes: [...this.draft.nodes], closed: false };
      if (!this.drag) sp.nodes.push({ x: this.cursor.x, y: this.cursor.y });
      const tmp: Obj = { id: 0, m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [sp] } };
      ctx.strokeStyle = this.layerDrawColor(this.currentLayer);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(worldPath(tmp.shape, IDENT));
    }

    if (this.drag?.type === 'pencil') {
      ctx.strokeStyle = this.layerDrawColor(this.currentLayer);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(subsToPath2D([{ nodes: this.drag.points, closed: false }]));
    }
    if (this.vectorPreview) {
      ctx.strokeStyle = '#ff6020'; ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([4 * px, 2 * px]);
      for (const p of this.vectorPreview) ctx.stroke(subsToPath2D(p.subs));
      ctx.setLineDash([]);
    }
    // Vorschau der Biegeschnitte
    if (this.hingePreview) {
      ctx.strokeStyle = '#ff6020';
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(subsToPath2D(this.hingePreview));
    }

    // Offset-Vorschau
    if (this.outlinePreview) {
      const preview = this.outlinePreview;
      ctx.save();
      if (preview.original) {
        ctx.strokeStyle = '#a4a9b0'; ctx.lineWidth = 1.2 * px;
        ctx.setLineDash([2 * px, 3 * px]); ctx.stroke(subsToPath2D(preview.original));
      }
      if (preview.hover >= 0 && preview.holes[preview.hover]) {
        ctx.fillStyle = 'rgba(255,150,35,0.3)';
        ctx.fill(subsToPath2D(preview.holes[preview.hover]), 'evenodd');
      }
      ctx.strokeStyle = '#56d7bd'; ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.stroke(subsToPath2D(preview.subs));
      ctx.restore();
    }
    if (this.offsetPreview) {
      ctx.strokeStyle = '#ff6020';
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.stroke(subsToPath2D(this.offsetPreview));
      ctx.setLineDash([]);
    }

    // Konstruktion prüfen: Befunde markieren
    if (this.checkMarks && this.checkIssues.length) this.drawCheckMarks(ctx, px);

    // Verbindungen: gewählte Kanten (nummeriert), Kante unter dem Mauszeiger und Vorschau
    if (this.tool === 'joint') {
      ctx.save();
      const edge = (p: EdgePick) => {
        const s = segments(shapeSubs(p.obj.shape)[p.sub])[p.seg];
        return [apply(p.m, s.a.x, s.a.y), apply(p.m, s.b.x, s.b.y)];
      };
      ctx.lineCap = 'round';
      if (this.jointHover) {
        const [a, b] = edge(this.jointHover);
        ctx.strokeStyle = SNAP_COLOR;
        ctx.lineWidth = 4 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      this.validJointPicks().forEach((p, i) => {
        const [a, b] = edge(p);
        ctx.strokeStyle = '#ff6020';
        ctx.lineWidth = 4 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        ctx.fillStyle = '#ff6020';
        ctx.beginPath();
        ctx.arc(mx, my, 8 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${11 * px}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), mx, my + 0.5 * px);
      });
      if (this.jointPreview) {
        ctx.strokeStyle = '#ff6020';
        ctx.setLineDash([4 * px, 2 * px]);
        ctx.lineWidth = 1.5 * px;
        ctx.stroke(subsToPath2D(this.jointPreview));
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Trimmen: Abschnitt unter dem Mauszeiger rot
    if (this.tool === 'trim' && this.trimHover) {
      ctx.save();
      ctx.strokeStyle = '#e02020';
      ctx.lineWidth = 3 * px;
      ctx.lineCap = 'round';
      ctx.stroke(subsToPath2D([this.trimHover.piece]));
      ctx.restore();
    }

    // Startpunkt: Knoten und Startpfeile der gewählten Formen und der Form unter dem Mauszeiger
    if (this.tool === 'start') this.drawStartPoints(ctx, px);

    // Array-Vorschau: Umrisse der Kopien
    if (this.arrayPreview && this.sel.length) {
      const p = new Path2D();
      for (const M of this.arrayPreview.slice(1)) {
        for (const [leaf, m] of visibleLeaves(this.sel, M)) {
          const s = leaf.shape;
          const local = s.kind === 'text' ? textOutline(s)?.path : s.kind === 'image' ? rectPath(s.w, s.h) : localPath(s);
          if (local) p.addPath(local, new DOMMatrix(m));
        }
      }
      ctx.strokeStyle = '#ff6020';
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(p);
      ctx.setLineDash([]);
      if (this.arrayCenter) {
        const { x, y } = this.arrayCenter;
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(x - 7 * px, y);
        ctx.lineTo(x + 7 * px, y);
        ctx.moveTo(x, y - 7 * px);
        ctx.lineTo(x, y + 7 * px);
        ctx.stroke();
      }
    }

    // Laserkopf (Werkstückkoordinaten der Maschine, y nach oben)
    if (this.laserPos) {
      const lx = this.laserPos.x,
        ly = bed.h - this.laserPos.y;
      ctx.strokeStyle = '#e02020';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(lx, ly, 5 * px, 0, Math.PI * 2);
      ctx.moveTo(lx - 9 * px, ly);
      ctx.lineTo(lx + 9 * px, ly);
      ctx.moveTo(lx, ly - 9 * px);
      ctx.lineTo(lx, ly + 9 * px);
      ctx.stroke();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderGuides(ctx);
    this.renderOverlay(ctx);
    this.renderRulers(ctx);
  }

  renderOverlay(this: Editor, ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    if(this.overlapHover && this.doc.objs.includes(this.overlapHover) && this.selectable(this.overlapHover)) {
      ctx.save();ctx.translate(this.view.ox,this.view.oy);ctx.scale(this.view.zoom,this.view.zoom);
      ctx.strokeStyle='#e0218a';ctx.lineWidth=3/this.view.zoom;ctx.setLineDash([]);
      for(const [leaf,m] of visibleLeaves([this.overlapHover])) if(this.layer(leaf.layer).show)ctx.stroke(cachedWorldPath(leaf,m));
      ctx.restore();
    }
    // Auswahlrahmen
    const b = this.selBounds();
    if (b && this.tool !== 'node') {
      const hs = this.handlePoints(b);
      ctx.strokeStyle = T.sel;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(hs[0].x + HANDLE_OFF, hs[0].y + HANDLE_OFF, hs[4].x - hs[0].x - 2 * HANDLE_OFF, hs[4].y - hs[0].y - 2 * HANDLE_OFF);
      ctx.setLineDash([]);
      hs.forEach((h, i) => {
        if (this.rotateMode) {
          if (i % 2) return;
          const cx = hs[0].x + (hs[4].x - hs[0].x) / 2,
            cy = hs[0].y + (hs[4].y - hs[0].y) / 2;
          const a = Math.atan2(h.y - cy, h.x - cx);
          ctx.beginPath();
          ctx.arc(h.x, h.y, 6, a + Math.PI / 2 - 0.9, a + Math.PI / 2 + 0.9 + Math.PI);
          ctx.strokeStyle = T.sel;
          ctx.lineWidth = 2;
          ctx.stroke();
          return;
        }
        ctx.fillStyle = T.handleFill;
        ctx.strokeStyle = T.sel;
        ctx.lineWidth = 1;
        ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
        ctx.strokeRect(h.x - 4 + 0.5, h.y - 4 + 0.5, 7, 7);
      });
      if (this.rotateMode) {
        const c = this.toScreen(this.rotationCenter()!);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = T.sel;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - 6, c.y);
        ctx.lineTo(c.x + 6, c.y);
        ctx.moveTo(c.x, c.y - 6);
        ctx.lineTo(c.x, c.y + 6);
        ctx.strokeStyle = T.sel;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // Winkelanzeige beim Drehen
    const d = this.drag;
    if (d && d.type === 'rotate') {
      const q = this.toScreen(this.cursor);
      const label = `${d.angle.toFixed(1)}°`;
      ctx.font = '12px system-ui, sans-serif';
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = T.label;
      ctx.fillRect(q.x + 14, q.y + 10, w, 18);
      ctx.fillStyle = T.labelText;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, q.x + 19, q.y + 19);
      const c = this.toScreen(d.center);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = T.sel;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Auswahlrechteck
    if (d && d.type === 'marquee') {
      const a = this.toScreen(d.start),
        c = this.toScreen(d.end);
      const enclose = c.x >= a.x;
      ctx.strokeStyle = enclose ? '#d02020' : '#10a030';
      ctx.fillStyle = enclose ? 'rgba(208,32,32,0.06)' : 'rgba(16,160,48,0.06)';
      ctx.setLineDash(enclose ? [] : [5, 3]);
      ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, c.x - a.x, c.y - a.y);
      ctx.setLineDash([]);
    }
    // Textrahmen im Entstehen
    if (d && d.type === 'textframe' && d.end !== d.start) {
      const a = this.toScreen(d.start),
        c = this.toScreen(d.end);
      ctx.strokeStyle = T.sel;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, c.x - a.x, c.y - a.y);
      ctx.setLineDash([]);
    }
    if (d && d.type === 'nodebox') {
      const a = this.toScreen(d.start),
        c = this.toScreen(d.end);
      ctx.strokeStyle = T.sel;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, c.x - a.x, c.y - a.y);
      ctx.setLineDash([]);
    }
    if(d?.type==='lasso') {
      ctx.save();ctx.strokeStyle=T.sel;ctx.fillStyle=this.dark?'#5b93f520':'#3070ff20';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();
      d.points.forEach((p,i)=>{const q=this.toScreen(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y)});
      ctx.closePath();ctx.fill('evenodd');ctx.stroke();ctx.restore();
    }
    // Knoten
    for (const o of this.tool === 'node' ? this.nodeTargets() : []) {
      const scr = (p: Pt) => this.toScreen(apply(o.m, p.x, p.y));
      const sel = this.nodeSelection(o);
      const subsO = shapeSubs(o.shape);
      // Segmente zwischen ausgewählten Knoten hervorheben (Ziel für Gerade/Kurve)
      const selectedSegments = this.segmentSelection(o);
      if (sel.size >= 2 || selectedSegments.size) {
        ctx.strokeStyle = '#ff6020';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        subsO.forEach((sp, si) =>
          segments(sp).forEach((sg, gi) => {
            if (!selectedSegments.has(`${si}:${gi}`) && (!sel.has(`${si}:${sg.ia}`) || !sel.has(`${si}:${sg.ib}`))) return;
            const a = scr(sg.a), c1 = scr(sg.c1), c2 = scr(sg.c2), b = scr(sg.b);
            ctx.moveTo(a.x, a.y);
            if (sg.curve) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
            else ctx.lineTo(b.x, b.y);
          }),
        );
        ctx.stroke();
      }
      subsO.forEach((sp, si) => {
        sp.nodes.forEach((n, ni) => {
          const q = scr(n);
          for (const which of ['cin', 'cout'] as const) {
            const hp = n[which];
            if (!hp) continue;
            const hq = scr(hp);
            ctx.strokeStyle = T.nodeLine;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(q.x, q.y);
            ctx.lineTo(hq.x, hq.y);
            ctx.stroke();
            const hot = this.nodeHover?.obj === o && this.nodeHover.sub === si && this.nodeHover.idx === ni && this.nodeHover.which === which;
            const pickedHandle=this.handleSelection(o).has(`${si}:${ni}:${which}`);
            ctx.fillStyle = hot ? '#ff6020' : pickedHandle?T.sel:T.handleFill;
            ctx.beginPath();
            ctx.arc(hq.x, hq.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          const hot = this.nodeHover?.obj === o && this.nodeHover.sub === si && this.nodeHover.idx === ni && this.nodeHover.which === 'p';
          const picked = sel.has(`${si}:${ni}`);
          const col = ni === 0 ? '#20a040' : T.sel;
          // ausgewählt: gefüllt, sonst hohl
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = hot ? '#ff6020' : col;
          ctx.fillStyle = hot ? '#ff6020' : picked ? col : T.handleFill;
          const r = picked ? 4.5 : 3.5;
          ctx.fillRect(q.x - r, q.y - r, 2 * r, 2 * r);
          ctx.strokeRect(q.x - r, q.y - r, 2 * r, 2 * r);
        });
      });
      if (this.segHover && this.segHover.obj === o) {
        const sg = segments(shapeSubs(o.shape)[this.segHover.sub])[this.segHover.seg];
        const t = this.segHover.t;
        const p = sg.curve ? bezierPt(sg.a, sg.c1, sg.c2, sg.b, t) : { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
        const q = scr(p);
        ctx.strokeStyle = '#ff6020';
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    this.renderCenters(ctx);
    if (this.tool === 'relate') this.renderRelations(ctx);
    if (this.tool === 'measure') this.renderMeasure(ctx);
    if (this.sketchEdit) this.renderSketch(ctx);
    this.renderSnap(ctx);
    // Startknoten der Linie hervorheben (Schließen)
    if (this.draft && this.draft.nodes.length >= 2) {
      const q = this.toScreen(this.draft.nodes[0]);
      ctx.strokeStyle = '#20a040';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(q.x - 5, q.y - 5, 10, 10);
    }
  }

  /** Befunde aus „Konstruktion prüfen“: Stellen farbig nach Schwere, der angeklickte Befund kräftiger */
  drawCheckMarks(this: Editor, ctx: CanvasRenderingContext2D, px: number) {
    const COLORS = { error: '#e02020', warn: '#ff8a00', info: '#2f8fe8' };
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    const active = this.checkActive;
    for (const x of [...this.checkIssues.filter((i) => i.key !== active?.key), ...(active ? [active] : [])]) {
      const on = x.key === active?.key;
      ctx.strokeStyle = COLORS[x.level];
      ctx.globalAlpha = on ? 0.95 : 0.55;
      ctx.lineWidth = (on ? 5 : 3.5) * px;
      ctx.setLineDash(x.kind === 'bed' || x.kind === 'import' ? [6 * px, 4 * px] : []);
      if (x.kind === 'bed' || x.kind === 'import') ctx.lineWidth = (on ? 2.5 : 1.5) * px;
      ctx.beginPath();
      for (const l of x.lines) {
        if (!l.length) continue;
        ctx.moveTo(l[0].x, l[0].y);
        for (let i = 1; i < l.length; i++) ctx.lineTo(l[i].x, l[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = (on ? 2.5 : 1.5) * px;
      for (const p of x.pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (on ? 10 : 7) * px, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Mittelpunktkreuze von Kreisen, Ellipsen, Vielecken und großen Bögen (auch Löchern in Pfaden).
   * „auto“: gewählte Objekte, Objekt unter dem Mauszeiger und Mittelpunkte in der Nähe des Mauszeigers.
   */
  renderCenters(this: Editor, ctx: CanvasRenderingContext2D) {
    const mode = this.centerMarks;
    if (mode === 'off') return;
    const focus = new Set<Obj>(this.sel);
    if (this.centerHover) focus.add(this.centerHover);
    const cur = this.toScreen(this.cursor);
    const NEAR = 40;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = SNAP_COLOR;
    ctx.beginPath();
    const seen: Pt[] = [];
    for (const top of this.viewObjects()) {
      const inFocus = mode === 'all' || focus.has(top);
      for (const [leaf, m] of visibleLeaves([top])) {
        if (!this.layer(leaf.layer).show || leaf.shape.kind === 'text') continue;
        for (const c of shapeCenters(leaf.shape, () => shapeSubs(leaf.shape))) {
          if (!shownMark(c)) continue;
          const q = this.toScreen(apply(m, c.x, c.y));
          if (q.x < RULER || q.y < RULER || q.x > this.w || q.y > this.h) continue;
          if (!inFocus && Math.hypot(q.x - cur.x, q.y - cur.y) > NEAR) continue;
          // konzentrische Kreise nur einmal markieren
          if (seen.some((p) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5)) continue;
          seen.push(q);
          const x = Math.round(q.x) + 0.5,
            y = Math.round(q.y) + 0.5;
          ctx.moveTo(x - 7, y);
          ctx.lineTo(x - 2, y);
          ctx.moveTo(x + 2, y);
          ctx.lineTo(x + 7, y);
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x, y - 2);
          ctx.moveTo(x, y + 2);
          ctx.lineTo(x, y + 7);
          ctx.rect(x - 0.5, y - 0.5, 1, 1);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Skizzenmodus: übrige Arbeitsfläche abdunkeln, Elemente in Zustandsfarbe (blau = unterbestimmt, schwarz bzw. weiß =
   * voll bestimmt, rot = Widerspruch), Hilfsgeometrie gestrichelt, Punkte, Beziehungssymbole und Bemaßungen.
   */
  renderSketch(this: Editor, ctx: CanvasRenderingContext2D) {
    this.syncSketch();
    const s = this.sketchEdit;
    if (!s) return;
    const sk = s.sk;
    const T = this.colors;
    const dpr = this.dpr;
    ctx.save();
    ctx.fillStyle = this.dark ? 'rgba(18,20,24,0.6)' : 'rgba(255,255,255,0.62)';
    ctx.fillRect(RULER, RULER, this.w - RULER, this.h - RULER);
    const full = s.status && s.status.ok && s.status.dof === 0;
    const base = full ? (this.dark ? '#f2f2f2' : '#15181d') : '#1f6fe0';
    const bad = new Set([...(s.status?.conflicting ?? []), ...(s.status?.redundant ?? [])]);
    const SEL = '#ff6020',
      DIM = '#d0451b';
    const colorOf = (id: number) => (s.sel.has(id) ? SEL : s.hover?.id === id ? SNAP_COLOR : base);
    // Elemente in Skizzenkoordinaten zeichnen
    const { zoom: z, ox, oy } = this.view;
    const m = s.m;
    const k = this.skScale() || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(z, 0, 0, z, ox, oy);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    for (const e of sk.ents) {
      ctx.beginPath();
      if (e.t === 'line') {
        const a = ptOf(sk, e.a),
          b = ptOf(sk, e.b);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else {
        const c = ptOf(sk, e.c);
        if (!c) continue;
        if (e.t === 'circle') ctx.arc(c.x, c.y, e.r, 0, Math.PI * 2);
        else ctx.arc(c.x, c.y, e.r, e.a0, e.a1);
      }
      ctx.strokeStyle = colorOf(e.id);
      ctx.lineWidth = (s.sel.has(e.id) || s.hover?.id === e.id ? 2.5 : 1.6) / k;
      ctx.setLineDash(e.aux ? [6 / k, 4 / k] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scr = (p: { x: number; y: number }) => this.skToScreen(p);
    // Zeichnen im Entstehen
    if (s.draft.length && s.tool !== 'dim') {
      const cur = this.toScreen(this.cursor);
      const d0 = scr(s.draft[0]);
      ctx.strokeStyle = '#1f6fe0';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      if (s.tool === 'line') {
        const last = scr(s.draft[s.draft.length - 1]);
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(cur.x, cur.y);
      } else if (s.tool === 'rect') ctx.rect(d0.x, d0.y, cur.x - d0.x, cur.y - d0.y);
      else if (s.tool === 'circle') ctx.arc(d0.x, d0.y, Math.hypot(cur.x - d0.x, cur.y - d0.y), 0, Math.PI * 2);
      else if (s.tool === 'arc') {
        const st = s.draft.length > 1 ? scr(s.draft[1]) : cur;
        const r = Math.hypot(st.x - d0.x, st.y - d0.y);
        ctx.moveTo(d0.x, d0.y);
        ctx.lineTo(st.x, st.y);
        if (s.draft.length > 1) {
          const a0 = Math.atan2(st.y - d0.y, st.x - d0.x),
            a1 = Math.atan2(cur.y - d0.y, cur.x - d0.x);
          ctx.moveTo(st.x, st.y);
          ctx.arc(d0.x, d0.y, r, a0, a1 <= a0 ? a1 + Math.PI * 2 : a1);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Punkte
    for (const p of sk.pts) {
      const q = scr(p);
      ctx.fillStyle = colorOf(p.id);
      const r = s.sel.has(p.id) || s.hover?.id === p.id ? 4 : 2.5;
      ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2);
    }
    // Beschriftungen: Symbole der Beziehungen und Bemaßungen
    s.labels = [];
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const box = (id: number, text: string, x: number, y: number, fg: string, bg: string) => {
      const w = ctx.measureText(text).width + 8,
        h = 16;
      const bx = Math.round(x - w / 2),
        by = Math.round(y - h / 2);
      const sel = s.sel.has(id),
        hov = s.hover?.id === id;
      ctx.fillStyle = bad.has(id) ? '#d02020' : sel ? SEL : hov ? SNAP_COLOR : bg;
      ctx.fillRect(bx, by, w, h);
      ctx.fillStyle = bad.has(id) || sel || hov ? '#ffffff' : fg;
      ctx.fillText(text, bx + 4, by + h / 2 + 0.5);
      s.labels.push({ id, x: bx, y: by, w, h });
    };
    const glyphBg = this.dark ? 'rgba(40,44,52,0.9)' : 'rgba(235,240,250,0.95)';
    const glyphFg = this.dark ? '#d8e2f0' : '#1f3a66';
    const stack = new Map<string, number>();
    const place = (key: string, x: number, y: number, dx: number, dy: number) => {
      const n = stack.get(key) ?? 0;
      stack.set(key, n + 1);
      return { x: x + dx * (1 + n * 1.6), y: y + dy * (1 + n * 1.6) };
    };
    for (const c of sk.cons) {
      if (isDim(c.t)) continue;
      const g = CON_GLYPHS[c.t] ?? '?';
      const first = c.r[0];
      const e0 = entOf(sk, first);
      if (c.t === 'coincident') {
        const p = ptOf(sk, first);
        if (!p) continue;
        const q = scr(p);
        ctx.fillStyle = bad.has(c.id) ? '#d02020' : base;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        s.labels.push({ id: c.id, x: q.x - 5, y: q.y - 5, w: 10, h: 10 });
        continue;
      }
      // Anker: Linienmitte (seitlich versetzt), Kreis oben rechts, Punkt daneben
      const anchorOf = (id: number) => {
        const e = entOf(sk, id);
        if (e?.t === 'line') {
          const a = scr(ptOf(sk, e.a)!),
            b = scr(ptOf(sk, e.b)!);
          const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return { key: `e${id}`, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dx: (-(b.y - a.y) / L) * 13, dy: ((b.x - a.x) / L) * 13 };
        }
        if (e) {
          const c0 = scr(ptOf(sk, e.c)!);
          const r = e.r * k;
          return { key: `e${id}`, x: c0.x + r * 0.71, y: c0.y - r * 0.71, dx: 11, dy: -11 };
        }
        const p = ptOf(sk, id);
        const q = p ? scr(p) : { x: 0, y: 0 };
        return { key: `p${id}`, x: q.x, y: q.y, dx: 12, dy: -12 };
      };
      const refs = c.t === 'fixed' || c.t === 'horizontal' || c.t === 'vertical' ? [first] : c.t === 'midpoint' || c.t === 'pointOnLine' || c.t === 'pointOnCircle' ? [c.r[0]] : c.t === 'symmetric' ? [c.r[2]] : c.r;
      if ((c.t === 'horizontal' || c.t === 'vertical') && !e0) refs.splice(0, 1, ...c.r);
      for (const id of refs) {
        const an = anchorOf(id);
        const p = place(an.key, an.x, an.y, an.dx, an.dy);
        box(c.id, g, p.x, p.y, glyphFg, glyphBg);
      }
    }
    // Bemaßungen
    const fmt = (c: SkCon) => {
      const v = c.v ?? measureCon(sk, c) ?? 0;
      const num = dec((Math.round(v * 100) / 100).toString());
      const pre = c.t === 'radius' ? 'R' : c.t === 'diameter' ? 'Ø' : '';
      const unit = c.t === 'angle' ? '°' : '';
      return (c.expr ? `${c.expr} = ` : '') + pre + num + unit;
    };
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    for (const c of sk.cons) {
      if (!isDim(c.t)) continue;
      const at = c.at ?? { x: 0, y: 0 };
      let label: { x: number; y: number } | null = null;
      if (c.t === 'radius' || c.t === 'diameter') {
        const e = entOf(sk, c.r[0]);
        if (!e || e.t === 'line') continue;
        const C = ptOf(sk, e.c)!;
        const dir = Math.hypot(at.x, at.y) > 1e-9 ? Math.atan2(at.y, at.x) : e.t === 'arc' ? (e.a0 + e.a1) / 2 : -Math.PI / 4;
        const rim = { x: C.x + e.r * Math.cos(dir), y: C.y + e.r * Math.sin(dir) };
        const from = c.t === 'diameter' ? { x: C.x - e.r * Math.cos(dir), y: C.y - e.r * Math.sin(dir) } : C;
        const a = scr(from),
          b = scr(rim);
        const out = { x: b.x + Math.cos(dir) * 18, y: b.y + Math.sin(dir) * 18 };
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(out.x, out.y);
        ctx.stroke();
        label = { x: out.x + Math.cos(dir) * 14, y: out.y + Math.sin(dir) * 8 };
      } else if (c.t === 'angle') {
        const l1 = entOf(sk, c.r[0]),
          l2 = entOf(sk, c.r[1]);
        if (l1?.t !== 'line' || l2?.t !== 'line') continue;
        const m1 = ptOf(sk, l1.a)!,
          n1 = ptOf(sk, l1.b)!,
          m2 = ptOf(sk, l2.a)!,
          n2 = ptOf(sk, l2.b)!;
        const mid = { x: (m1.x + n1.x + m2.x + n2.x) / 4 + at.x, y: (m1.y + n1.y + m2.y + n2.y) / 4 + at.y };
        label = scr(mid);
      } else {
        // Abstände: Punkt–Punkt (auch Linienlänge) oder Punkt–Linie
        let a: { x: number; y: number } | null = null,
          b: { x: number; y: number } | null = null;
        const l = c.r.length === 2 ? entOf(sk, c.r[1]) : undefined;
        if (l?.t === 'line' && c.t === 'distance') {
          const p = ptOf(sk, c.r[0])!,
            la = ptOf(sk, l.a)!,
            lb = ptOf(sk, l.b)!;
          const dx = lb.x - la.x,
            dy = lb.y - la.y,
            l2 = dx * dx + dy * dy || 1;
          const tt = ((p.x - la.x) * dx + (p.y - la.y) * dy) / l2;
          a = p;
          b = { x: la.x + dx * tt, y: la.y + dy * tt };
        } else {
          const pp = pointPair(sk, c.r);
          if (!pp) continue;
          [a, b] = pp;
          if (c.t === 'hdistance') b = { x: b.x, y: a.y };
          if (c.t === 'vdistance') b = { x: a.x, y: b.y };
        }
        // Maßlinie seitlich versetzt (um den Anteil von at senkrecht zur Strecke, sonst 5 mm)
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / L,
          ny = (b.x - a.x) / L;
        const off = c.at ? at.x * nx + at.y * ny : 5;
        const along = c.at ? at.x * ((b.x - a.x) / L) + at.y * ((b.y - a.y) / L) : 0;
        const A = scr({ x: a.x + nx * off, y: a.y + ny * off }),
          B = scr({ x: b.x + nx * off, y: b.y + ny * off });
        const sa = scr(a),
          sb = scr(b);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(A.x, A.y);
        ctx.moveTo(sb.x, sb.y);
        ctx.lineTo(B.x, B.y);
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
        const arrow = (P: { x: number; y: number }, Q: { x: number; y: number }) => {
          const ang = Math.atan2(Q.y - P.y, Q.x - P.x);
          ctx.beginPath();
          ctx.moveTo(P.x, P.y);
          ctx.lineTo(P.x + Math.cos(ang + 0.4) * 7, P.y + Math.sin(ang + 0.4) * 7);
          ctx.moveTo(P.x, P.y);
          ctx.lineTo(P.x + Math.cos(ang - 0.4) * 7, P.y + Math.sin(ang - 0.4) * 7);
          ctx.stroke();
        };
        arrow(A, B);
        arrow(B, A);
        const mid = scr({ x: (a.x + b.x) / 2 + nx * off + ((b.x - a.x) / L) * along, y: (a.y + b.y) / 2 + ny * off + ((b.y - a.y) / L) * along });
        label = mid;
      }
      if (label) box(c.id, fmt(c), label.x, label.y, '#ffffff', DIM);
    }
    // Bemaßungs-Werkzeug: gewählte Elemente
    for (const h of s.dimPick) {
      if (!h) continue;
      const p = h.kind === 'pt' ? ptOf(sk, h.id) : undefined;
      if (p) {
        const q = scr(p);
        ctx.strokeStyle = SEL;
        ctx.strokeRect(q.x - 6, q.y - 6, 12, 12);
      }
    }
    void T;
    ctx.restore();
  }

  /** Gewählte Elemente (orange) und Element unter dem Mauszeiger im Werkzeug „Beziehung“ */
  renderRelations(this: Editor, ctx: CanvasRenderingContext2D) {
    const draw = (e: RelElem, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (e.kind === 'circle') {
        const c = this.toScreen(e.c);
        if (e.r > 0) ctx.arc(c.x, c.y, e.r * this.view.zoom, 0, Math.PI * 2);
        ctx.moveTo(c.x - 6, c.y);
        ctx.lineTo(c.x + 6, c.y);
        ctx.moveTo(c.x, c.y - 6);
        ctx.lineTo(c.x, c.y + 6);
      } else if (e.kind === 'edge') {
        const a = this.toScreen(e.a),
          b = this.toScreen(e.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else {
        const p = this.toScreen(e.p);
        ctx.rect(p.x - 5, p.y - 5, 10, 10);
      }
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this.relPicks) draw(p.elem, '#ff6020');
    if (this.relHover) draw(this.relHover.elem, SNAP_COLOR);
    ctx.restore();
  }

  /** Messlinie mit Länge, Δx, Δy und Winkel; über einem Kreis Radius und Durchmesser */
  renderMeasure(this: Editor, ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    const label = (text: string, x: number, y: number) => {
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = T.label;
      ctx.fillRect(x, y - 10, w, 20);
      ctx.fillStyle = T.labelText;
      ctx.fillText(text, x + 5, y);
    };
    const mm = (v: number) => dec(v.toFixed(2));
    ctx.save();
    const m = this.measure;
    if (m) {
      const b = m.b ?? this.cursor;
      const p = this.toScreen(m.a),
        q = this.toScreen(b);
      ctx.strokeStyle = '#ff6020';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of [p, q]) {
        ctx.beginPath();
        ctx.moveTo(s.x - 5, s.y - 5);
        ctx.lineTo(s.x + 5, s.y + 5);
        ctx.moveTo(s.x + 5, s.y - 5);
        ctx.lineTo(s.x - 5, s.y + 5);
        ctx.stroke();
      }
      const r = measureOf(m.a, b);
      label(
        t('{len} mm · Δx {dx} · Δy {dy} · {angle}°', { len: mm(r.len), dx: mm(r.dx), dy: mm(r.dy), angle: dec(r.angle.toFixed(1)) }),
        (p.x + q.x) / 2 + 10, (p.y + q.y) / 2 - 22,
      );
    }
    const c = this.measureCircle;
    if (c) {
      const s = this.toScreen(c.c);
      ctx.strokeStyle = SNAP_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, c.r * this.view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      const cur = this.toScreen(this.cursor);
      label(t('Ø {d} mm · r {r} mm', { d: mm(c.r * 2), r: mm(c.r) }), cur.x + 14, cur.y - 22);
    }
    ctx.restore();
  }

  /** Ausrichtungshilfen und Fangpunkt mit Art (wie das Fang-Symbol am Mauszeiger in LightBurn) */
  renderSnap(this: Editor, ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    if (this.alignGuides.length) {
      ctx.strokeStyle = SNAP_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (const g of this.alignGuides) {
        const a = this.toScreen(g.axis === 'x' ? { x: g.v, y: g.a } : { x: g.a, y: g.v }),
          b = this.toScreen(g.axis === 'x' ? { x: g.v, y: g.b } : { x: g.b, y: g.v });
        const pad = 12;
        if (g.axis === 'x') {
          const x = Math.round(a.x) + 0.5;
          ctx.moveTo(x, Math.min(a.y, b.y) - pad);
          ctx.lineTo(x, Math.max(a.y, b.y) + pad);
        } else {
          const y = Math.round(a.y) + 0.5;
          ctx.moveTo(Math.min(a.x, b.x) - pad, y);
          ctx.lineTo(Math.max(a.x, b.x) + pad, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const hit = this.snapHit;
    if (!hit) return;
    const q = this.toScreen(hit.p);
    const x = Math.round(q.x) + 0.5,
      y = Math.round(q.y) + 0.5;
    ctx.strokeStyle = SNAP_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    switch (hit.kind) {
      case 'node':
        ctx.rect(x - 5, y - 5, 10, 10);
        break;
      case 'mid':
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y + 4.5);
        ctx.lineTo(x - 6, y + 4.5);
        ctx.closePath();
        break;
      case 'center':
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
        break;
      case 'quad':
        // Viertelkreis mit Radien
        ctx.moveTo(x - 5, y + 5);
        ctx.lineTo(x - 5, y - 5);
        ctx.arc(x - 5, y + 5, 10, -Math.PI / 2, 0);
        ctx.closePath();
        break;
      case 'cross':
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        break;
      case 'line':
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        break;
    }
    ctx.stroke();
    const label = SNAP_LABELS[hit.kind];
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = T.label;
    ctx.fillRect(x + 10, y + 8, w, 16);
    ctx.fillStyle = T.labelText;
    ctx.fillText(label, x + 14, y + 16);
  }

  renderRulers(this: Editor, ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    const W = this.w,
      H = this.h,
      z = this.view.zoom;
    ctx.fillStyle = T.ruler;
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillRect(0, 0, RULER, H);
    ctx.strokeStyle = T.rulerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER + 0.5);
    ctx.lineTo(W, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0);
    ctx.lineTo(RULER + 0.5, H);
    ctx.stroke();
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const major = steps.find((s) => s * z >= 60) ?? 1000;
    const minor = major / (String(major).startsWith('2') ? 4 : 5);
    ctx.fillStyle = T.rulerText;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    const x0 = this.toWorld(RULER, 0).x,
      x1 = this.toWorld(W, 0).x;
    for (let x = Math.floor(x0 / minor) * minor; x <= x1; x += minor) {
      const s = Math.round(x * z + this.view.ox) + 0.5;
      if (s < RULER) continue;
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      ctx.moveTo(s, RULER);
      ctx.lineTo(s, RULER - (isMajor ? 10 : 4));
      if (isMajor) ctx.fillText(fmt(x), s + 2, 2);
    }
    const bedH = this.doc.bed.h;
    const y0 = bedH - this.toWorld(0, H).y,
      y1 = bedH - this.toWorld(0, RULER).y;
    ctx.save();
    for (let y = Math.floor(y0 / minor) * minor; y <= y1; y += minor) {
      const s = Math.round((bedH - y) * z + this.view.oy) + 0.5;
      if (s < RULER) continue;
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      ctx.moveTo(RULER, s);
      ctx.lineTo(RULER - (isMajor ? 10 : 4), s);
      if (isMajor) {
        ctx.save();
        ctx.translate(2, s - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(fmt(y), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.stroke();
    // Cursor-Markierung
    const c = this.toScreen(this.cursor);
    ctx.strokeStyle = '#e02020';
    ctx.beginPath();
    ctx.moveTo(c.x + 0.5, 0);
    ctx.lineTo(c.x + 0.5, RULER);
    ctx.moveTo(0, c.y + 0.5);
    ctx.lineTo(RULER, c.y + 0.5);
    ctx.stroke();
    ctx.fillStyle = T.rulerCorner;
    ctx.fillRect(0, 0, RULER, RULER);
  }
}
