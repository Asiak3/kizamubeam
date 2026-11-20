// Pure model layer for optional image cut contours. No DOM, documents or hardware.
// Stored contour nodes are original-image-local millimetres (0..w x 0..h); crop must
// never enter the mapping, while perspective does, because the full-original
// homography from resolveImageEdits is used in both directions.
import type { CutSettings, ImageLayer, Node, Obj, Pt } from './model';
import { defaultCutSettings } from './model';
import { apply, inv, type Mat } from './mat';
import { resolveImageContour, type ImageContour } from './imageContour';
import { resolveImageEdits } from './imageEdits';
import { validateContourTopology } from './contourTopology';

export type ImageCut = Omit<CutSettings, 'mode' | 'sub' | 'look'> & { output: boolean };
export type ImageCutMode = 'boundary' | 'contour';
export interface ImageCutLink { mode: ImageCutMode; contourId?: number }
export type ImageCutPathResult = { ok: true; polygon: Pt[]; closed: true }
  | { ok: false; reason: 'missing-contour' | 'invalid-contour' | 'invalid-geometry' };

const badGeometry = (): ImageCutPathResult => ({ ok: false, reason: 'invalid-geometry' });
const validWorld = (m: Mat) => m.length === 6 && m.every(Number.isFinite) && m[0] * m[3] - m[1] * m[2] !== 0;

/** Alle Objekte inkl. Gruppenkindern nach ID. Zugewiesene Konturen können hidden/noLaser sein und müssen trotzdem auffindbar bleiben. */
export function objectsById(roots: readonly Obj[]): Map<number, Obj> {
  const byId = new Map<number, Obj>();
  const walk = (o: Obj) => {
    byId.set(o.id, o);
    if (o.shape.kind === 'group') for (const c of o.shape.children) walk(c);
  };
  for (const o of roots) walk(o);
  return byId;
}

/** 0,05 mm Bogenfehler als Polyline-Grenze; radii <= tolerance werden mit zwei Segmenten gezeichnet. */
const ARC_TOLERANCE = 0.05;
/** Tangentiale Kreisbögen in eine Polyline überführen; ohne Radien unverändert. */
function cutPolygon(contour: ImageContour): Pt[] {
  if (!contour.corners.some((c) => c.radius > 0)) return contour.polygon;
  const out: Pt[] = [];
  for (let i = 0; i < contour.corners.length; i++) {
    const c = contour.corners[i];
    if (!(c.radius > 0)) { out.push({ ...contour.polygon[i] }); continue; }
    const ax = c.start.x - c.center.x, ay = c.start.y - c.center.y;
    const bx = c.end.x - c.center.x, by = c.end.y - c.center.y;
    const sweep = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    const step = 2 * Math.acos(Math.max(0, 1 - Math.min(ARC_TOLERANCE, c.radius) / c.radius));
    const n = Math.max(2, Math.min(64, Math.ceil(Math.abs(sweep) / step)));
    out.push({ ...c.start });
    for (let j = 1; j < n; j++) {
      const a = (sweep * j) / n, cos = Math.cos(a), sin = Math.sin(a);
      out.push({ x: c.center.x + ax * cos - ay * sin, y: c.center.y + ax * sin + ay * cos });
    }
    out.push({ ...c.end });
  }
  return out;
}

/** Full line controls with output off by default; stored image-layer cut settings override. */
export function imageCutSettings(L: ImageLayer | undefined): ImageCut {
  const d = defaultCutSettings('line') as Partial<CutSettings>;
  delete d.mode;
  delete d.sub;
  delete d.look;
  return { ...d, output: false, ...L?.cut } as ImageCut;
}

/** World-mm cut polygon. Boundary uses the rounded visible contour; a linked contour
 *  is re-mapped from original-image-local mm through the current full-original edit. */
export function resolveImageCutPath(image: Obj, world: Mat,
  lookup: (id: number) => Obj | undefined): ImageCutPathResult {
  if (image.shape.kind !== 'image' || !validWorld(world)) return badGeometry();
  const shape = image.shape;
  const mode = shape.cut?.mode ?? 'boundary';
  if (mode === 'boundary') {
    const result = resolveImageContour(shape, world);
    return result.ok ? { ok: true, polygon: cutPolygon(result.contour), closed: true } : badGeometry();
  }
  const id = shape.cut?.contourId;
  if (id === undefined) return { ok: false, reason: 'missing-contour' };
  const contour = lookup(id);
  if (!contour || contour.shape.kind !== 'path') return { ok: false, reason: 'missing-contour' };
  const subs = contour.shape.subs;
  if (subs.length !== 1 || !subs[0].closed || subs[0].nodes.length < 3) {
    return { ok: false, reason: 'invalid-contour' };
  }
  // validateContourTopology prepares every sub via prepareContourTopology and then
  // rejects contact/self-intersection between its Bézier spans.
  try { validateContourTopology(subs); } catch { return { ok: false, reason: 'invalid-contour' }; }
  const resolved = resolveImageEdits(shape);
  if (!resolved.ok) return badGeometry();
  const polygon: Pt[] = [];
  for (const n of subs[0].nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return badGeometry();
    const local = resolved.geometry.sourceToLocal({ x: n.x / shape.w, y: n.y / shape.h });
    if (!local) return badGeometry();
    const p = apply(world, local.x, local.y);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return badGeometry();
    polygon.push(p);
  }
  return { ok: true, polygon, closed: true };
}

/** Store a world-space contour in the image's original-local frame and link both objects.
 *  The image asset and its edit are never changed; only the contour's path nodes and flags. */
export function assignImageContour(image: Obj, contour: Obj, world: Mat): boolean {
  if (image.shape.kind !== 'image' || contour.shape.kind !== 'path' || !validWorld(world)) return false;
  const shape = image.shape;
  const path = contour.shape;
  const subs = path.subs;
  if (subs.length !== 1 || !subs[0].closed || subs[0].nodes.length < 3) return false;
  try { validateContourTopology(subs); } catch { return false; }
  const resolved = resolveImageEdits(shape);
  if (!resolved.ok) return false;
  const inverse = inv(world);
  const toSource = (p: Pt): Pt | null => {
    const local = apply(inverse, p.x, p.y);
    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
    const src = resolved.geometry.localToSource(local);
    if (!src) return null;
    return { x: src.x * shape.w, y: src.y * shape.h };
  };
  const nodes: Node[] = [];
  for (const n of subs[0].nodes) {
    const p = toSource(n);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const mapped: Node = { ...p };
    if (n.cin) { const h = toSource(n.cin); if (!h) return false; mapped.cin = h; }
    if (n.cout) { const h = toSource(n.cout); if (!h) return false; mapped.cout = h; }
    if (n.smooth) mapped.smooth = true;
    if (n.split) mapped.split = true;
    nodes.push(mapped);
  }
  path.subs = [{ ...subs[0], nodes }];
  shape.cut = { mode: 'contour', contourId: contour.id };
  contour.cutLink = { imageId: image.id, prevNoLaser: contour.noLaser ?? false };
  contour.noLaser = true;
  return true;
}

/** Reverse the stored path through the image's current edit and world matrix, restore
 *  the contour's original noLaser state and drop both links. The contour survives. */
export function unassignImageContour(image: Obj, contour: Obj, world: Mat): boolean {
  if (image.shape.kind !== 'image' || contour.shape.kind !== 'path' || !validWorld(world)) return false;
  const shape = image.shape;
  const cut = shape.cut;
  const link = contour.cutLink;
  if (cut?.mode !== 'contour' || cut.contourId !== contour.id || !link || link.imageId !== image.id) return false;
  const path = contour.shape;
  if (path.subs.length !== 1) return false;
  const sub = path.subs[0];
  const resolved = resolveImageEdits(shape);
  if (!resolved.ok) return false;
  const toWorld = (p: Pt): Pt | null => {
    const local = resolved.geometry.sourceToLocal({ x: p.x / shape.w, y: p.y / shape.h });
    if (!local) return null;
    const q = apply(world, local.x, local.y);
    return Number.isFinite(q.x) && Number.isFinite(q.y) ? q : null;
  };
  const nodes: Node[] = [];
  for (const n of sub.nodes) {
    const p = toWorld(n);
    if (!p) return false;
    const mapped: Node = { ...p };
    if (n.cin) { const h = toWorld(n.cin); if (!h) return false; mapped.cin = h; }
    if (n.cout) { const h = toWorld(n.cout); if (!h) return false; mapped.cout = h; }
    if (n.smooth) mapped.smooth = true;
    if (n.split) mapped.split = true;
    nodes.push(mapped);
  }
  path.subs = [{ ...sub, nodes }];
  if (link.prevNoLaser) contour.noLaser = true;
  else delete contour.noLaser;
  delete contour.cutLink;
  delete shape.cut;
  return true;
}

/** Selection closure for duplicate/paste: linked contours and their images, once, in stable order. */
export function expandImageCutSelection(objs: Obj[], pool: Obj[]): Obj[] {
  const byId = new Map<number, Obj>();
  for (const o of pool) byId.set(o.id, o);
  const out: Obj[] = [];
  const seen = new Set<number>();
  const queue: Obj[] = [];
  const add = (o: Obj | undefined) => {
    if (!o || seen.has(o.id)) return;
    seen.add(o.id);
    out.push(o);
    queue.push(o);
  };
  for (const o of objs) add(o);
  for (let i = 0; i < queue.length; i++) {
    const o = queue[i];
    if (o.shape.kind === 'image') {
      const id = o.shape.cut?.contourId;
      if (id !== undefined) add(byId.get(id));
    }
    if (o.cutLink) add(byId.get(o.cutLink.imageId));
  }
  return out;
}
