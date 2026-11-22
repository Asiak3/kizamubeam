// Interactive image crop/perspective handles with live draft + single undo.
// Crop is a normalized source rectangle in image-local axes (rotation-safe:
// local mm, never world). Perspective maps the FULL original rectangle;
// crop selects through it. Rounding is stored as fixed world-mm corner radii.
// Only edit.crop/edit.perspective/edit.cornerRadii and edit order change;
// o.m/w/h and assets are never touched, so survivors are never rescaled.
// Drafts mutate no model and take no history snapshot; Apply takes exactly
// one snapshot, Cancel takes none.
import { t } from '../i18n';
import { createImageGeometry, type ImageCrop } from '../imageGeometry';
import { imageEditOrder, resolveImageEdits } from '../imageEdits';
import { resolveImageContour } from '../imageContour';
import type { ImageEditOrder, ImageEdit, ImageShape, Obj, Pt } from '../model';
import { apply, inv } from '../mat';
import type { Editor } from '../editor';

export type ImageCropHandle = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'br' | 'bl';
export type ImageEditTab = 'crop' | 'perspective' | 'rounding';
export interface ImageDraft {
  objId: number;
  tab: ImageEditTab;
  crop: ImageCrop;
  quad: [Pt, Pt, Pt, Pt];
  order: ImageEditOrder;
  cornerRadii: number[];
}
const drafts = new WeakMap<object, ImageDraft>();
const MIN_MM = 0.1;

function imgOf(ed: Editor, id: number): { o: Obj; s: ImageShape } | null {
  const o = ed.doc.objs.find((x) => x.id === id) ?? null;
  if (!o || o.shape.kind !== 'image') return null;
  return { o, s: o.shape as ImageShape };
}
function fullCrop(): ImageCrop { return { left: 0, top: 0, right: 1, bottom: 1 }; }
function fullQuadOf(s: ImageShape): [Pt, Pt, Pt, Pt] {
  return [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }];
}
function cloneQuad(q: readonly Pt[]): [Pt, Pt, Pt, Pt] {
  return [{ ...q[0] }, { ...q[1] }, { ...q[2] }, { ...q[3] }];
}
function draftOf(ed: Editor): ImageDraft | null {
  return drafts.get(ed as object) ?? null;
}
function errCrop(msg: string): string { return msg; }
/** Machine reason codes as plain-language causes (source keys for translation). */
function reasonDe(reason: string): string {
  return reason === 'invalid-quad' ? t('ungültiges Viereck') : t('ungültiger Bereich');
}

/** All snap targets are world-space; cropFirst handles start in source axes. */
function snapImagePoint(ed: Editor, o: Obj, s: ImageShape, d: ImageDraft, p: Pt, event: unknown, sourceAxes: boolean): Pt {
  const mapping = sourceAxes ? createImageGeometry(fullCrop(), d.quad) : null;
  if (mapping && !mapping.ok) return p;
  const projected = mapping?.ok ? mapping.geometry.sourceToLocal({ x: p.x / s.w, y: p.y / s.h }) : p;
  if (!projected) return p;
  const world = apply(o.m, projected.x, projected.y);
  const e = (event as never) ?? null;
  const set = ed.snapModes(e, true).obj ? ed.buildSnap([o]) : undefined;
  const extra = d.tab === 'crop' ? d.quad.map(q => apply(o.m, q.x, q.y)) : undefined;
  const snapped = ed.snapPt(world, e, { set, extra, toggle: true });
  const local = apply(inv(o.m), snapped.x, snapped.y);
  if (!mapping?.ok) return local;
  const source = mapping.geometry.localToSource(local);
  return source ? { x: source.x * s.w, y: source.y * s.h } : p;
}

export class EditorImageHandles {
  imageDraft(this: Editor): ImageDraft | null { return draftOf(this); }

  startImageEdit(this: Editor, id: number, tab: ImageEditTab = 'crop'): string | null {
    const f = imgOf(this, id);
    if (!f) return t('Kein Bild gewählt. Ursache: Die Auswahl enthält kein Bild. Behebung: Ein einzelnes Bild wählen.');
    const r = resolveImageEdits(f.s);
    if (!r.ok) return t('Ungültiger Bildzuschnitt oder ungültige Perspektive. Zuschnitt und Perspektive zurücksetzen oder das Bild ersetzen.');
    drafts.set(this as object, { objId: id, tab, crop: { ...r.crop }, quad: cloneQuad(perspectiveOf(f.s)), order: imageEditOrder(f.s.edit), cornerRadii: [...(f.s.edit?.cornerRadii ?? [])] });
    this.emit('tool');
    return null;
  }

  /** Order switch inside the running draft: keeps crop and quad, takes no snapshot, keeps the dialog open. */
  setImageEditOrder(this: Editor, order: ImageEditOrder): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Umschalten. Behebung: Entwurf starten.'));
    if (order !== 'cropFirst' && order !== 'perspectiveFirst')
      return errCrop(t('Unbekannte Reihenfolge. Ursache: Die gespeicherte Reihenfolge ist ungültig. Behebung: Zuschnitt zuerst oder Perspektive zuerst wählen.'));
    d.order = order;
    this.emit('tool');
    return null;
  }

  /** Reiterwechsel innerhalb desselben Entwurfs: Zuschnitt und Perspektive bleiben gemeinsam erhalten. */
  setImageEditTab(this: Editor, tab: ImageEditTab): void {
    const d = draftOf(this);
    if (!d || d.tab === tab) return;
    d.tab = tab;
    this.emit('tool');
  }

  /** Screen-agnostic local-point drag shared by pointer and tests. Snaps in world via existing snapPt. */
  dragImageCropHandle(this: Editor, handle: ImageCropHandle, local: Pt, opt: { aspectLock?: boolean; snap?: boolean; event?: unknown } = {}): string | null {
    const d = draftOf(this);
    if (!d || d.tab !== 'crop') return errCrop(t('Kein Zuschnitt-Entwurf aktiv. Ursache: Kein Entwurf gestartet. Behebung: Zuschnitt-Werkzeug starten.'));
    const f = imgOf(this, d.objId);
    if (!f) return errCrop(t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.'));
    let p = { ...local };
    if (opt.snap !== false && !opt.aspectLock) {
      try {
        p = snapImagePoint(this, f.o, f.s, d, p, opt.event, d.order === 'cropFirst');
      } catch { /* snap is best-effort; unsnapped point still applies */ }
    }
    const w = f.s.w, h = f.s.h;
    if (![p.x, p.y].every(Number.isFinite))
      return errCrop(t('Ungültige Zahl im Zuschnitt. Ursache: Eine Eingabe ist keine Zahl. Behebung: Zahlen in {unit} eingeben.', { unit: 'mm' }));
    // Aspect lock wins over snap: never silently stretch.
    let cx = Math.min(Math.max(p.x, 0), w), cy = Math.min(Math.max(p.y, 0), h);
    const cur = { l: d.crop.left * w, t: d.crop.top * h, r: d.crop.right * w, b: d.crop.bottom * h };
    if (opt.aspectLock && (handle === 'tl' || handle === 'tr' || handle === 'br' || handle === 'bl')) {
      const ratio = (cur.r - cur.l) / (cur.b - cur.t);
      const dw = handle.includes('l') ? cur.r - cx : cx - cur.l;
      const dh = handle.startsWith('t') ? cur.b - cy : cy - cur.t;
      const maxWidth = Math.min(handle.includes('l') ? cur.r : w - cur.l,
        (handle.startsWith('t') ? cur.b : h - cur.t) * ratio);
      const m = Math.min(Math.max(dw, dh * ratio, MIN_MM, MIN_MM * ratio), maxWidth);
      const nw = m, nh = m / ratio;
      if (handle.includes('l')) cur.l = cur.r - nw; else cur.r = cur.l + nw;
      if (handle.startsWith('t')) cur.t = cur.b - nh; else cur.b = cur.t + nh;
    } else {
      if (handle.includes('l') || handle === 'left') cur.l = cx;
      if (handle.includes('r') || handle === 'right') cur.r = cx;
      if (handle.startsWith('t') || handle === 'top') cur.t = cy;
      if (handle.startsWith('b') || handle === 'bottom') cur.b = cy;
    }
    if (cur.r - cur.l < MIN_MM || cur.b - cur.t < MIN_MM)
      return errCrop(t('Zuschnitt zu klein. Ursache: Kanten liegen aufeinander. Behebung: Größeren Bereich aufziehen.'));
    if (cur.l < 0 || cur.t < 0 || cur.r > w || cur.b > h)
      return errCrop(t('Zuschnitt außerhalb des Bildes. Ursache: Griff über den Bildrand gezogen. Behebung: Griff innerhalb des Bildes ablegen.'));
    d.crop = { left: cur.l / w, top: cur.t / h, right: cur.r / w, bottom: cur.b / h };
    this.emit('tool');
    return null;
  }

  setImageCropNumeric(this: Editor, v: { left: number; top: number; right: number; bottom: number; unit: 'mm' | 'percent' }): string | null {
    const d = draftOf(this);
    if (!d || d.tab !== 'crop') return errCrop(t('Kein Zuschnitt-Entwurf aktiv. Ursache: Kein Entwurf gestartet. Behebung: Zuschnitt-Werkzeug starten.'));
    const f = imgOf(this, d.objId);
    if (!f) return errCrop(t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.'));
    const k = v.unit === 'percent' ? 100 : 1;
    const w = f.s.w, h = f.s.h;
    const box = v.unit === 'percent'
      ? { l: (v.left / k) * w, t: (v.top / k) * h, r: (v.right / k) * w, b: (v.bottom / k) * h }
      : { l: v.left / k, t: v.top / k, r: v.right / k, b: v.bottom / k };
    if (![box.l, box.t, box.r, box.b].every(Number.isFinite))
      return errCrop(t('Ungültige Zahl im Zuschnitt. Ursache: Eine Eingabe ist keine Zahl. Behebung: Zahlen in {unit} eingeben.', { unit: v.unit }));
    if (box.l < 0 || box.t < 0 || box.r > w || box.b > h || box.l >= box.r || box.t >= box.b)
      return errCrop(t('Zuschnitt außerhalb des Bildes. Ursache: Werte liegen außerhalb von 0 bis Bildgröße. Behebung: Werte innerhalb des Bildes wählen.'));
    d.crop = { left: box.l / w, top: box.t / h, right: box.r / w, bottom: box.b / h };
    this.emit('tool');
    return null;
  }

  nudgeImageCropHandle(this: Editor, handle: ImageCropHandle, key: string, step = 1): string | null {
    const d = draftOf(this);
    if (!d || d.tab !== 'crop') return errCrop(t('Kein Zuschnitt-Entwurf aktiv. Ursache: Kein Entwurf gestartet. Behebung: Zuschnitt-Werkzeug starten.'));
    const f = imgOf(this, d.objId);
    if (!f) return errCrop(t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.'));
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return errCrop(t('Taste ohne Wirkung. Ursache: {key} bewegt keinen Griff. Behebung: Pfeiltasten verwenden.', { key }));
    const w = f.s.w, h = f.s.h;
    const cur = { l: d.crop.left * w, t: d.crop.top * h, r: d.crop.right * w, b: d.crop.bottom * h };
    const c = (p: Pt): Pt => {
      if (handle === 'left') return { x: p.x + dx, y: (cur.t + cur.b) / 2 };
      if (handle === 'right') return { x: p.x + dx, y: (cur.t + cur.b) / 2 };
      if (handle === 'top') return { x: (cur.l + cur.r) / 2, y: p.y + dy };
      if (handle === 'bottom') return { x: (cur.l + cur.r) / 2, y: p.y + dy };
      const cx = handle.includes('l') ? cur.l : cur.r;
      const cy = handle.startsWith('t') ? cur.t : cur.b;
      return { x: cx + dx, y: cy + dy };
    };
    const anchor: Pt = handle === 'left' ? { x: cur.l, y: 0 } : handle === 'right' ? { x: cur.r, y: 0 }
      : handle === 'top' ? { x: 0, y: cur.t } : handle === 'bottom' ? { x: 0, y: cur.b }
      : { x: handle.includes('l') ? cur.l : cur.r, y: handle.startsWith('t') ? cur.t : cur.b };
    return this.dragImageCropHandle(handle, c(anchor), { snap: false });
  }

  setImagePerspectiveCorner(this: Editor, i: number, local: Pt, opt: { snap?: boolean; event?: unknown } = {}): string | null {
    const d = draftOf(this);
    if (!d || d.tab !== 'perspective') return errCrop(t('Kein Perspektiv-Entwurf aktiv. Ursache: Kein Entwurf gestartet. Behebung: Perspektive-Werkzeug starten.'));
    const f = imgOf(this, d.objId);
    if (!f) return errCrop(t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.'));
    if (!Number.isInteger(i) || i < 0 || i > 3)
      return errCrop(t('Unbekannte Ecke. Ursache: Eckenindex {i} ist ungültig. Behebung: Ecke 0 bis 3 wählen.', { i: String(i) }));
    let p = { ...local };
    if (opt.snap !== false) {
      try {
        p = snapImagePoint(this, f.o, f.s, d, p, opt.event, false);
      } catch { /* best-effort */ }
    }
    const next = cloneQuad(d.quad); next[i] = p;
    const chk = createImageGeometry(fullCrop(), next);
    if (!chk.ok)
      return errCrop(t('Perspektive ungültig: Ecken überkreuzt, konkav oder flach. Ursache: {reason}. Behebung: Ecken als konvexes Viereck anordnen.', { reason: reasonDe(chk.reason) }));
    d.quad = next;
    this.emit('tool');
    return null;
  }

  moveImagePerspectiveCornerBy(this: Editor, i: number, dx: number, dy: number): string | null {
    const d = draftOf(this);
    if (!d || d.tab !== 'perspective') return errCrop(t('Kein Perspektiv-Entwurf aktiv. Ursache: Kein Entwurf gestartet. Behebung: Perspektive-Werkzeug starten.'));
    const q = d.quad[i];
    if (!q) return errCrop(t('Unbekannte Ecke. Ursache: Eckenindex {i} ist ungültig. Behebung: Ecke 0 bis 3 wählen.', { i: String(i) }));
    return this.setImagePerspectiveCorner(i, { x: q.x + dx, y: q.y + dy }, { snap: false });
  }

  /** null applies a starting radius to all visible corners, retaining hidden requests. */
  setImageCornerRadius(this: Editor, index: number | null, radius: number): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Anwenden. Behebung: Entwurf starten.'));
    if (!Number.isFinite(radius) || radius < 0)
      return t('Ungültiger Eckenradius. Eine Zahl ab 0 mm eingeben.');
    const result = imageDraftContour(this, d.objId);
    if (!result?.ok) return t('Bildkontur ungültig. Zuschnitt oder Perspektive anpassen.');
    const count = result.contour.corners.length;
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= count))
      return t('Ecke nicht mehr sichtbar. Eine sichtbare Ecke wählen.');
    const next = Array.from({ length: Math.max(d.cornerRadii.length, count) }, (_, i) => d.cornerRadii[i] ?? 0);
    if (index === null) for (let i = 0; i < count; i++) next[i] = radius;
    else next[index] = radius;
    d.cornerRadii = next;
    this.emit('tool');
    return null;
  }

  /** Eckenradius stufen (Ziehen/Tastatur): Delta in mm auf eine oder alle Ecken, kein Snapshot. */
  bumpImageCornerRadius(this: Editor, index: number | null, delta: number): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Anwenden. Behebung: Entwurf starten.'));
    if (!Number.isFinite(delta) || delta === 0) return null;
    const result = imageDraftContour(this, d.objId);
    if (!result?.ok) return t('Bildkontur ungültig. Zuschnitt oder Perspektive anpassen.');
    const count = result.contour.corners.length;
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= count))
      return t('Ecke nicht mehr sichtbar. Eine sichtbare Ecke wählen.');
    const cur = Array.from({ length: Math.max(d.cornerRadii.length, count) }, (_, i) =>
      d.cornerRadii[i] ?? result.contour.corners[i]?.requested ?? 0);
    const next = cur.map((r, i) => (i < count && (index === null || i === index) ? Math.max(0, r + delta) : r));
    d.cornerRadii = next;
    this.emit('tool');
    return null;
  }

  resetImageRoundingDraft(this: Editor): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Zurücksetzen. Behebung: Entwurf starten.'));
    d.cornerRadii = [];
    this.emit('tool');
    return null;
  }

  applyImageDraft(this: Editor): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Anwenden. Behebung: Entwurf starten.'));
    const f = imgOf(this, d.objId);
    if (!f) { drafts.delete(this as object); return errCrop(t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.')); }
    const chkCrop = createImageGeometry(d.crop);
    if (!chkCrop.ok) return errCrop(t('Zuschnitt ungültig. Ursache: {reason}. Behebung: Bereich innerhalb des Bildes wählen.', { reason: reasonDe(chkCrop.reason) }));
    const chkQuad = createImageGeometry(fullCrop(), d.quad);
    if (!chkQuad.ok) return errCrop(t('Perspektive ungültig: Ecken überkreuzt, konkav oder flach. Ursache: {reason}. Behebung: Ecken als konvexes Viereck anordnen.', { reason: reasonDe(chkQuad.reason) }));
    this.snapshot(t('Bildbearbeitung anwenden'));
    const edit = { ...(f.s.edit ?? {}) };
    edit.crop = { ...d.crop };
    edit.perspective = cloneQuad(d.quad);
    if (d.cornerRadii.some(radius => radius !== 0)) edit.cornerRadii = [...d.cornerRadii];
    else delete edit.cornerRadii;
    if (d.order === 'perspectiveFirst') edit.order = 'perspectiveFirst';
    else delete edit.order;
    if (edit.crop && isFullCrop(edit.crop)) delete edit.crop;
    if (edit.perspective && isFullQuad(edit.perspective, f.s)) delete edit.perspective;
    f.s.edit = Object.keys(edit).length ? edit : undefined;
    drafts.delete(this as object);
    this.emit('doc');
    return null;
  }

  cancelImageDraft(this: Editor): void {
    drafts.delete(this as object);
    this.emit('tool');
  }

  /** Zuschnitt im laufenden Entwurf zurücksetzen: nur Draft, kein Modell, kein Undo, Dialog bleibt offen. */
  resetImageCropDraft(this: Editor): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Zurücksetzen. Behebung: Entwurf starten.'));
    d.crop = fullCrop();
    this.emit('tool');
    return null;
  }

  /** Perspektive im laufenden Entwurf zurücksetzen: nur Draft, kein Modell, kein Undo, Dialog bleibt offen. */
  resetImagePerspectiveDraft(this: Editor): string | null {
    const d = draftOf(this);
    if (!d) return errCrop(t('Kein Entwurf aktiv. Ursache: Nichts zum Zurücksetzen. Behebung: Entwurf starten.'));
    const f = imgOf(this, d.objId);
    if (!f) return errCrop(t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.'));
    d.quad = fullQuadOf(f.s);
    this.emit('tool');
    return null;
  }

  /** Live-Vorschau: Entwurf vor Modell; sonst aufgelöste Geometrie. Nie mutierend. */
  imageCropPreview(this: Editor, id: number): ImageCrop | null {
    const d = draftOf(this);
    if (d && d.objId === id) return { ...d.crop };
    const f = imgOf(this, id);
    if (!f) return null;
    const r = resolveImageEdits(f.s);
    return r.ok ? { ...r.crop } : null;
  }
  imagePerspectivePreview(this: Editor, id: number): [Pt, Pt, Pt, Pt] | null {
    const d = draftOf(this);
    if (d && d.objId === id) return cloneQuad(d.quad);
    const f = imgOf(this, id);
    if (!f) return null;
    const r = resolveImageEdits(f.s);
    return r.ok ? cloneQuad(r.quad) : null;
  }
}

/** Entwurf als ImageEdit für die Live-Vorschau der Pixel: Entwurf vor Modell, nie mutierend, null ohne Entwurf. */
export function imageDraftEdit(ed: Editor, id: number): ImageEdit | null {
  const d = draftOf(ed);
  if (!d || d.objId !== id) return null;
  const edit: ImageEdit = { crop: { ...d.crop }, perspective: cloneQuad(d.quad), cornerRadii: [...d.cornerRadii] };
  if (d.order === 'perspectiveFirst') edit.order = 'perspectiveFirst';
  return edit;
}

/** Shared final world-mm contour for draft fields and canvas corner numbers. */
export function imageDraftContour(ed: Editor, id: number): ReturnType<typeof resolveImageContour> | null {
  const f = imgOf(ed, id);
  if (!f) return null;
  return resolveImageContour({ ...f.s, edit: imageDraftEdit(ed, id) ?? f.s.edit }, f.o.m);
}

function perspectiveOf(s: ImageShape): [Pt, Pt, Pt, Pt] {
  return s.edit?.perspective ? cloneQuad([...s.edit.perspective]) : fullQuadOf(s);
}
function isFullCrop(c: ImageCrop): boolean {
  return c.left === 0 && c.top === 0 && c.right === 1 && c.bottom === 1;
}
function isFullQuad(q: readonly Pt[], s: ImageShape): boolean {
  const f = fullQuadOf(s);
  return q.length === 4 && q.every((p, i) => p.x === f[i].x && p.y === f[i].y);
}
