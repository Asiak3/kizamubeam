import type { ImageEdit, ImageEditOrder, ImageShape } from './model';
import { createImageGeometry, type ImageCrop, type ImageGeometry, type ImageQuad } from './imageGeometry';

export type ImageEditsResult =
  | { ok: true; crop: ImageCrop; quad: ImageQuad; geometry: ImageGeometry; order: ImageEditOrder }
  | { ok: false; reason: 'invalid-size' | 'invalid-edit' | 'invalid-crop' | 'invalid-quad' | 'invalid-rounding' };

const FULL_CROP: ImageCrop = { left: 0, top: 0, right: 1, bottom: 1 };

/** Stored order, sanitized: only 'perspectiveFirst' opts out, anything else (incl. legacy files)
 *  resolves as cropFirst. Pure: never mutates or rewrites the stored edit. */
export function imageEditOrder(edit: ImageEdit | undefined): ImageEditOrder {
  return edit?.order === 'perspectiveFirst' ? 'perspectiveFirst' : 'cropFirst';
}

/**
 * Resolve the visible crop through the full-original homography. Source mapping
 * always uses normalized ORIGINAL coordinates, without clipping; object/world
 * Mat remains external. Missing edits preserve the original physical rectangle.
 * Invalid stored values return an error, never a silently repaired model.
 */
export function resolveImageEdits(image: Readonly<ImageShape>): ImageEditsResult {
  if (![image.w, image.h].every(v => Number.isFinite(v) && v > 0)) {
    return { ok: false, reason: 'invalid-size' };
  }
  const edit = image.edit;
  if (edit !== undefined && (edit === null || typeof edit !== 'object' || Array.isArray(edit))) {
    return { ok: false, reason: 'invalid-edit' };
  }
  if (edit?.cornerRadii !== undefined && (!Array.isArray(edit.cornerRadii) || edit.cornerRadii.length > 8
    || !edit.cornerRadii.every(r => Number.isFinite(r) && r >= 0))) {
    return { ok: false, reason: 'invalid-rounding' };
  }
  const crop = edit?.crop === undefined ? FULL_CROP : edit.crop;
  const validCrop = createImageGeometry(crop);
  if (!validCrop.ok) return validCrop;
  const original: ImageQuad = [{ x: 0, y: 0 }, { x: image.w, y: 0 },
    { x: image.w, y: image.h }, { x: 0, y: image.h }];
  const full = createImageGeometry(FULL_CROP, edit?.perspective === undefined ? original : edit.perspective);
  if (!full.ok) return full;
  const { left, top, right, bottom } = crop;
  if (imageEditOrder(edit) === 'perspectiveFirst') {
    // Crop first would select in original source axes; here the full original is warped first
    // and the crop is an axis-parallel rectangle of the warped result (in image-local mm).
    const quad: ImageQuad = [{ x: left * image.w, y: top * image.h }, { x: right * image.w, y: top * image.h },
      { x: right * image.w, y: bottom * image.h }, { x: left * image.w, y: bottom * image.h }];
    return { ok: true, crop: { left, top, right, bottom }, quad, geometry: full.geometry, order: 'perspectiveFirst' };
  }
  const corners = [{ x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom }];
  const [a, b, c, d] = corners.map(p => full.geometry.sourceToLocal(p));
  if (!a || !b || !c || !d) return { ok: false, reason: 'invalid-quad' };
  return { ok: true, crop: { left, top, right, bottom }, quad: [a, b, c, d], geometry: full.geometry, order: 'cropFirst' };
}

function resetEdit(image: Readonly<ImageShape>, field: 'crop' | 'perspective'): ImageShape {
  const result = { ...image };
  if (image.edit === undefined) return result;
  const edit = { ...image.edit };
  delete edit[field];
  if (Object.keys(edit).length) result.edit = edit;
  else delete result.edit;
  return result;
}

/** Remove crop only; perspective continues to map the full original rectangle. */
export function resetImageCrop(image: Readonly<ImageShape>): ImageShape {
  return resetEdit(image, 'crop');
}

/** Remove perspective only; crop keeps its original physical size and position. */
export function resetImagePerspective(image: Readonly<ImageShape>): ImageShape {
  return resetEdit(image, 'perspective');
}
