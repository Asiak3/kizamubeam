import type { Pt } from './model';
import type { Mat } from './mat';

/** Rectangle in the untouched original image's normalized source coordinates. */
export interface ImageCrop {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Local coordinates, ordered top-left, top-right, bottom-right, bottom-left. */
export type ImageQuad = readonly [Readonly<Pt>, Readonly<Pt>, Readonly<Pt>, Readonly<Pt>];

export interface ImageGeometry {
  /** Original normalized source → local; does not crop/clip or apply world Mat. */
  sourceToLocal(source: Readonly<Pt>): Pt | null;
  /** Local → original normalized source, for raster sampling/export/snapping. */
  localToSource(local: Readonly<Pt>): Pt | null;
  /**
   * Exact affine local → normalized source map (Mat layout) when the quad is
   * affine (g and h are exactly 0), otherwise null. Lets hot sampling loops
   * skip the closure call, the division and both point allocations.
   */
  affine: Mat | null;
}

export type ImageGeometryResult =
  | { ok: true; geometry: ImageGeometry }
  | { ok: false; reason: 'invalid-crop' | 'invalid-quad' };

const FULL_CROP: ImageCrop = { left: 0, top: 0, right: 1, bottom: 1 };
const UNIT_QUAD: ImageQuad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
// Relative, after conditioning to a unit-sized local frame; not a physical area limit.
const CONDITION_EPSILON = 64 * Number.EPSILON;

function finitePoint(p: Readonly<Pt>): boolean {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function finiteResult(x: number, y: number): Pt | null {
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Crop → projective local placement. Defaults apply only to absent arguments;
 * invalid stored values are rejected, never normalized/clamped or repaired.
 * invalid-quad includes nonfinite, nonconvex, collapsed and numerically singular
 * geometry. Both windings are supported, but corners must follow the perimeter.
 * Inputs are snapshotted; no image bytes, affine placement or model schema enter
 * this module. Mapping extrapolates outside the crop/quad; callers decide clipping.
 * Nonfinite mappings (including projective poles) return null.
 *
 * Existing camera/warp homographies import native/application runtime modules;
 * this conditioned square-to-quad calculation keeps the geometry module pure.
 */
export function createImageGeometry(crop: ImageCrop = FULL_CROP, quad: ImageQuad = UNIT_QUAD): ImageGeometryResult {
  if (crop == null || ![crop.left, crop.top, crop.right, crop.bottom].every(Number.isFinite)
    || crop.left < 0 || crop.top < 0 || crop.right > 1 || crop.bottom > 1
    || crop.left >= crop.right || crop.top >= crop.bottom) {
    return { ok: false, reason: 'invalid-crop' };
  }
  if (!Array.isArray(quad) || quad.length !== 4 || ![0, 1, 2, 3].every(i => finitePoint(quad[i]))) {
    return { ok: false, reason: 'invalid-quad' };
  }
  const { left, top } = crop;
  const width = crop.right - left, height = crop.bottom - top;
  // Anchor before scaling: avoid cancellation from large translations and avoid
  // products of physical coordinates overflowing/underflowing at extreme scales.
  const originX = quad[0].x, originY = quad[0].y;
  const shifted = quad.map(p => ({ x: p.x - originX, y: p.y - originY }));
  const scale = Math.max(...shifted.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
  if (!(scale > 0) || !Number.isFinite(scale)) return { ok: false, reason: 'invalid-quad' };
  const q = shifted.map(p => ({ x: p.x / scale, y: p.y / scale }));
  let winding = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= CONDITION_EPSILON || (winding && Math.sign(cross) !== winding)) {
      return { ok: false, reason: 'invalid-quad' };
    }
    winding = Math.sign(cross);
  }

  const [, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = -p1.x + p2.x - p3.x, sy = -p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / determinant;
  const h = (dx1 * sy - sx * dy1) / determinant;
  // q[0] is zero, so the projective matrix's translation column is [0,0,1].
  const a = p1.x * (1 + g), b = p3.x * (1 + h);
  const d = p1.y * (1 + g), e = p3.y * (1 + h);
  const det = a * e - b * d;
  const denominators = [1, 1 + g, 1 + g + h, 1 + h];
  if (![a, b, d, e, g, h, det].every(Number.isFinite)
    || Math.abs(det) <= CONDITION_EPSILON * Math.max(Math.abs(a * e), Math.abs(b * d))
    || denominators.some(w => w <= CONDITION_EPSILON)) {
    return { ok: false, reason: 'invalid-quad' };
  }

  // Exact affine shortcut: g and h are exactly 0 for affine quads, making w
  // identically 1 and the map a plain Mat (same values as localToSource).
  const k = scale * det;
  const affine: Mat | null = g === 0 && h === 0 ? [
    (width * e) / k, (-height * d) / k,
    (-width * b) / k, (height * a) / k,
    left + (width * (b * originY - e * originX)) / k,
    top + (height * (d * originX - a * originY)) / k,
  ] : null;

  return {
    ok: true,
    geometry: {
      affine,
      sourceToLocal(source) {        if (!finitePoint(source)) return null;
        const u = (source.x - left) / width, v = (source.y - top) / height;
        const w = g * u + h * v + 1;
        if (w === 0) return null;
        return finiteResult(originX + scale * ((a * u + b * v) / w),
          originY + scale * ((d * u + e * v) / w));
      },
      localToSource(local) {
        if (!finitePoint(local)) return null;
        const x = (local.x - originX) / scale, y = (local.y - originY) / scale;
        const u = (e * x - b * y) / det, v = (a * y - d * x) / det;
        const w = 1 - g * u - h * v;
        if (w === 0) return null;
        return finiteResult(left + width * (u / w), top + height * (v / w));
      },
    },
  };
}
