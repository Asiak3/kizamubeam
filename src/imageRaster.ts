import type { ImageShape, Pt } from './model';
import { resolveImageEdits } from './imageEdits';
import { apply, IDENT, type Mat } from './mat';
import { resolveImageContour } from './imageContour';

export const DEFAULT_IMAGE_MAX_PIXELS = 16_000_000;

export interface ImageRasterSource {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface ImageRasterRequest {
  readonly width: number;
  readonly height: number;
  readonly maxPixels?: number;
  /** Final affine is needed only for rounding: radii are circular world mm. */
  readonly world?: Mat;
  /**
   * Sampling quality: 'accurate' (default) integrates the exact source
   * footprint per pixel; 'fast' always uses bilinear reconstruction.
   * Fast is a transient live-drag aid only — committed and job rasters
   * always sample accurately.
   */
  readonly sampling?: 'accurate' | 'fast';
}

export type ImageRasterResult =
  | { ok: true; rgba: Uint8ClampedArray; coverage: Uint8Array; width: number; height: number;
    bounds: { x: number; y: number; width: number; height: number } }
  | { ok: false; reason: 'invalid' | 'source-dimensions' | 'geometry' }
  | { ok: false; reason: 'output-too-large'; width: number; height: number; maxPixels: number };

const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Shared pre-allocation geometry for grid density, processing and scan placement. */
export function resolveImageRasterGeometry(image: Readonly<ImageShape>) {
  const resolved = resolveImageEdits(image);
  if (!resolved.ok) return resolved;
  const { quad } = resolved;
  const x = Math.min(...quad.map(p => p.x)), y = Math.min(...quad.map(p => p.y));
  const bounds = { x, y, width: Math.max(...quad.map(p => p.x)) - x,
    height: Math.max(...quad.map(p => p.y)) - y };
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return { ok: false, reason: 'geometry' } as const;
  return { ...resolved, bounds };
}

function retainedCenters(start: number, end: number, size: number): [number, number] {
  const low = Math.max(0, Math.ceil(start * size - 0.5));
  const high = Math.min(size - 1, Math.floor(end * size - 0.5));
  // A subpixel sliver may contain no center: use the pixel intersecting its midpoint.
  if (low > high) {
    const center = clamp(Math.floor((start + (end - start) / 2) * size), 0, size - 1);
    return [center, center];
  }
  return [low, high];
}

function writeSample(target: Uint8ClampedArray, offset: number, weight: number, alpha: number,
  red: number, green: number, blue: number) {
  target[offset + 3] = alpha / weight;
  if (target[offset + 3] !== 0) {
    target[offset] = red / alpha; target[offset + 1] = green / alpha; target[offset + 2] = blue / alpha;
  }
}

/** Sutherland-Hodgman against an axis-aligned rectangle; fixed scratch storage, no tap allocations. */
function clipRectangle(input: Float64Array, count: number, output: Float64Array, scratch: Float64Array,
  left: number, top: number, right: number, bottom: number): number {
  let from = input;
  for (let edge = 0; edge < 4; edge++) {
    const to = edge % 2 ? output : scratch, axis = edge % 2;
    const bound = edge === 0 ? left : edge === 1 ? top : edge === 2 ? right : bottom;
    const sign = edge < 2 ? 1 : -1;
    let next = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, a = sign * (from[i * 2 + axis] - bound), b = sign * (from[j * 2 + axis] - bound);
      if (a >= 0) { to[next * 2] = from[i * 2]; to[next * 2 + 1] = from[i * 2 + 1]; next++; }
      if ((a < 0) !== (b < 0)) {
        const t = a / (a - b);
        to[next * 2] = from[i * 2] + t * (from[j * 2] - from[i * 2]);
        to[next * 2 + 1] = from[i * 2 + 1] + t * (from[j * 2 + 1] - from[i * 2 + 1]); next++;
      }
    }
    from = to; count = next;
  }
  return count;
}

/** Exact box integration for ordinary crops; projective cells integrate projected source-pixel areas. */
function areaSampler(source: ImageRasterSource, image: Readonly<ImageShape>,
  resolved: Extract<ReturnType<typeof resolveImageRasterGeometry>, { ok: true }>) {
  const { width: sw, height: sh, rgba: original } = source, { geometry, crop, order } = resolved;
  const first = order !== 'perspectiveFirst';
  const left = first ? crop.left * sw : 0, right = first ? crop.right * sw : sw;
  const top = first ? crop.top * sh : 0, bottom = first ? crop.bottom * sh : sh;
  const quad = image.edit?.perspective;
  const rectangular = !quad || quad[0].y === quad[1].y && quad[1].x === quad[2].x
    && quad[2].y === quad[3].y && quad[3].x === quad[0].x;
  const scaleX = sw / (quad ? Math.abs(quad[1].x - quad[0].x) : image.w),
    scaleY = sh / (quad ? Math.abs(quad[3].y - quad[0].y) : image.h);
  // A rectangle intersected with a quadrilateral has at most eight vertices;
  // further row/pixel clips need at most twelve. All buffers are reused.
  const local = new Float64Array(32), footprint = new Float64Array(32), row = new Float64Array(32),
    cell = new Float64Array(32), scratch = new Float64Array(32), basis = new Float64Array(8);
  const corners = first ? resolved.quad : [
    geometry.sourceToLocal({ x: 0, y: 0 })!, geometry.sourceToLocal({ x: 1, y: 0 })!,
    geometry.sourceToLocal({ x: 1, y: 1 })!, geometry.sourceToLocal({ x: 0, y: 1 })!,
  ];
  corners.forEach((p, i) => { local[i * 2] = p.x; local[i * 2 + 1] = p.y; });
  const [minX, maxX] = retainedCenters(first ? crop.left : 0, first ? crop.right : 1, sw);
  const [minY, maxY] = retainedCenters(first ? crop.top : 0, first ? crop.bottom : 1, sh);
  const tolerance = Number.EPSILON * 128;
  return (lx: number, ly: number, dx: number, dy: number, p: { x: number; y: number },
    target: Uint8ClampedArray, offset: number): boolean => {
    const fx = dx * scaleX, fy = dy * scaleY;
    if (rectangular) {
      if (Math.max(fx, fy) <= 1 + tolerance) return false;
    } else {
      let minifying = false;
      for (let k = 0; k < 4; k++) {
        const sign = k % 2 ? 1 : -1;
        const q = geometry.localToSource({ x: lx + (k < 2 ? sign * dx / 2 : 0), y: ly + (k >= 2 ? sign * dy / 2 : 0) });
        // An inverse-horizon probe must not fall back to an aliased point.
        if (!q) { minifying = true; break; }
        basis[k * 2] = (q.x - p.x) * sw * sign * 2; basis[k * 2 + 1] = (q.y - p.y) * sh * sign * 2;
      }
      // Check both sides: projective scale can grow toward either edge of a cell.
      for (let a = 0; a < 4 && !minifying; a += 2) for (let b = 4; b < 8; b += 2) {
        const aa = basis[a] ** 2 + basis[a + 1] ** 2, bb = basis[b] ** 2 + basis[b + 1] ** 2,
          ab = basis[a] * basis[b] + basis[a + 1] * basis[b + 1];
        // Largest inverse-footprint basis singular value; 1:1/magnification stays bilinear.
        if ((aa + bb + Math.hypot(aa - bb, 2 * ab)) / 2 > 1 + tolerance) { minifying = true; break; }
      }
      if (!minifying) return false;
    }
    let alpha = 0, red = 0, green = 0, blue = 0, weight = 0;
    if (rectangular) {
      // A unit-width box is bilinear reconstruction in a non-minifying axis.
      const cx = fx < 1 ? clamp(p.x * sw - 0.5, minX, maxX) + 0.5 : p.x * sw;
      const cy = fy < 1 ? clamp(p.y * sh - 0.5, minY, maxY) + 0.5 : p.y * sh;
      const x0 = Math.max(fx < 1 ? 0 : left, cx - Math.max(1, fx) / 2),
        x1 = Math.min(fx < 1 ? sw : right, cx + Math.max(1, fx) / 2),
        y0 = Math.max(fy < 1 ? 0 : top, cy - Math.max(1, fy) / 2),
        y1 = Math.min(fy < 1 ? sh : bottom, cy + Math.max(1, fy) / 2);
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx)), k = (sy * sw + sx) * 4;
          const a = original[k + 3] * w;
          weight += w; alpha += a; red += original[k] * a; green += original[k + 1] * a; blue += original[k + 2] * a;
        }
      }
    } else {
      // Clip in local space BEFORE inversion, so a bbox cell cannot cross the inverse horizon.
      const count = clipRectangle(local, 4, footprint, scratch, lx - dx / 2, ly - dy / 2, lx + dx / 2, ly + dy / 2);
      let y0 = sh, y1 = 0;
      for (let k = 0; k < count; k++) {
        const q = geometry.localToSource({ x: footprint[k * 2], y: footprint[k * 2 + 1] })!;
        footprint[k * 2] = clamp(q.x * sw, left, right); footprint[k * 2 + 1] = clamp(q.y * sh, top, bottom);
        y0 = Math.min(y0, footprint[k * 2 + 1]); y1 = Math.max(y1, footprint[k * 2 + 1]);
      }
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const rows = clipRectangle(footprint, count, row, scratch, left, sy, right, sy + 1);
        let x0 = sw, x1 = 0;
        for (let k = 0; k < rows; k++) { x0 = Math.min(x0, row[k * 2]); x1 = Math.max(x1, row[k * 2]); }
        // Row spans avoid scanning a diagonal footprint's potentially enormous bounding rectangle.
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const n = clipRectangle(row, rows, cell, scratch, sx, sy, sx + 1, sy + 1);
          if (n < 3) continue;
          const origin = geometry.sourceToLocal({ x: cell[0] / sw, y: cell[1] / sh })!;
          let area = 0, prevX = 0, prevY = 0;
          for (let k = 1; k < n; k++) {
            const q = geometry.sourceToLocal({ x: cell[k * 2] / sw, y: cell[k * 2 + 1] / sh })!;
            const x = q.x - origin.x, y = q.y - origin.y;
            area += prevX * y - prevY * x; prevX = x; prevY = y;
          }
          const w = Math.abs(area), k = (sy * sw + sx) * 4, a = original[k + 3] * w;
          weight += w; alpha += a; red += original[k] * a; green += original[k + 1] * a; blue += original[k + 2] * a;
        }
      }
    }
    if (weight <= 0) return false;
    writeSample(target, offset, weight, alpha, red, green, blue);
    return true;
  };
}

/**
 * Footprint-aware minification, pixel-center bilinear magnification of ORIGINAL straight RGBA.
 * No asset loading, model mutation or automatic output-size reduction.
 * Bounds are local mm; caller places this rectangle with Obj.m externally. Output
 * center (i,j) is bounds.origin + ((i+.5)/width,(j+.5)/height) * bounds.size.
 *
 * Clip centers against the original normalized crop before sampling. Clamp the
 * bilinear footprint to source pixel centers inside that crop (subpixel exception above),
 * never stretch the retained content. Interpolate premultiplied alpha, then return
 * straight RGBA; rounded-zero alpha always has black RGB, including identity.
 * Minification integrates exact fractional crop/source-pixel areas in destination
 * space, with premultiplied alpha. Polygon/rounded coverage remains center-based.
 */
export function rasterizeImage(source: ImageRasterSource, image: Readonly<ImageShape>,
  request: ImageRasterRequest): ImageRasterResult {
  const { width: sw, height: sh, rgba: original } = source;
  const sourcePixels = sw * sh;
  if (!positiveInteger(sw) || !positiveInteger(sh) || !Number.isSafeInteger(sourcePixels * 4)
    || sw !== image.pxW || sh !== image.pxH || !(original instanceof Uint8ClampedArray)
    || original.length !== sourcePixels * 4) {
    return { ok: false, reason: 'source-dimensions' };
  }
  const { width, height, maxPixels = DEFAULT_IMAGE_MAX_PIXELS } = request;
  if (!positiveInteger(width) || !positiveInteger(height) || !positiveInteger(maxPixels)) {
    return { ok: false, reason: 'invalid' };
  }
  const pixels = width * height;
  const tooLarge = (): ImageRasterResult => ({ ok: false, reason: 'output-too-large', width, height, maxPixels });
  if (!Number.isSafeInteger(pixels * 4) || pixels > maxPixels) return tooLarge();
  const resolved = resolveImageRasterGeometry(image);
  if (!resolved.ok) return { ok: false, reason: 'geometry' };
  const { crop, geometry, bounds, order } = resolved;
  const rounding = image.edit?.cornerRadii?.some(r => r > 0)
    ? resolveImageContour(image, request.world) : null;
  if (rounding && !rounding.ok) return { ok: false, reason: 'geometry' };
  const rounded = rounding?.ok ? rounding.contour : null;
  const world = request.world ?? IDENT;
  const { x, y } = bounds;
  const first = order !== 'perspectiveFirst';
  const [minX, maxX] = first ? retainedCenters(crop.left, crop.right, sw) : retainedCenters(0, 1, sw);
  const [minY, maxY] = first ? retainedCenters(crop.top, crop.bottom, sh) : retainedCenters(0, 1, sh);
  let rgba: Uint8ClampedArray, coverage: Uint8Array;
  try { rgba = new Uint8ClampedArray(pixels * 4); coverage = new Uint8Array(pixels); }
  catch (error) { if (error instanceof RangeError) return tooLarge(); throw error; }
  const sampleArea = areaSampler(source, image, resolved), dx = bounds.width / width, dy = bounds.height / height;
  // Drag-only shortcut: exact affine quads skip the closure call, the division
  // and both point allocations per pixel. Job paths never set 'fast'.
  const fastAff = request.sampling === 'fast' ? geometry.affine : null;
  const fastPt = { x: 0, y: 0 };
  for (let j = 0; j < height; j++) {
    const ly = y + ((j + 0.5) / height) * bounds.height;
    // Compute the exact circular mask once per raster row, not once per pixel.
    // t is local x from bounds.x; this remains correct under shear/reflection.
    const span = rounded?.lineSpan(apply(world, x, ly), { x: world[0], y: world[1] });
    for (let i = 0; i < width; i++) {
      const lx = x + ((i + 0.5) / width) * bounds.width;
      if (rounded && (!span || lx - x < span[0] || lx - x > span[1])) continue;
      let p: Pt | null;
      if (fastAff) {
        fastPt.x = fastAff[0] * lx + fastAff[2] * ly + fastAff[4];
        fastPt.y = fastAff[1] * lx + fastAff[3] * ly + fastAff[5];
        p = fastPt;
      } else {
        p = geometry.localToSource({ x: lx, y: ly });
      }
      // Convex full homography maps the retained source rectangle to the visible
      // polygon: this inverse crop test also excludes the bbox's empty corners.
      // perspectiveFirst instead clips the warped output rectangle in local mm
      // and keeps only what the full homography maps inside the original.
      if (!p || (first
        ? p.x < crop.left || p.x > crop.right || p.y < crop.top || p.y > crop.bottom
        : p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1
           || lx < crop.left * image.w || lx > crop.right * image.w || ly < crop.top * image.h || ly > crop.bottom * image.h)) continue;
      // Independent of source alpha: post-processing must keep polygon exterior off,
      // while transparent interior retains the legacy white/negative semantics.
      coverage[j * width + i] = 1;
      const offset = (j * width + i) * 4;
      if (request.sampling !== 'fast' && sampleArea(lx, ly, dx, dy, p, rgba, offset)) continue;
      const sx = clamp(p.x * sw - 0.5, minX, maxX), sy = clamp(p.y * sh - 0.5, minY, maxY);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, maxX), y1 = Math.min(y0 + 1, maxY);
      const fx = sx - x0, fy = sy - y0;
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const offset = ((dy ? y1 : y0) * sw + (dx ? x1 : x0)) * 4;
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        const a = original[offset + 3] * weight;
        alpha += a; red += original[offset] * a; green += original[offset + 1] * a; blue += original[offset + 2] * a;
      }
      writeSample(rgba, offset, 1, alpha, red, green, blue);
    }
  }
  return { ok: true, rgba, coverage, width, height, bounds };
}
