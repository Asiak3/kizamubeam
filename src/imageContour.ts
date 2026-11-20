import type { ImageShape, Pt } from './model';
import { apply, IDENT, type Mat } from './mat';
import { resolveImageEdits } from './imageEdits';

export interface ImageCorner {
  vertex: Pt;
  start: Pt;
  end: Pt;
  center: Pt;
  radius: number;
  requested: number;
}

export interface ImageContour {
  polygon: Pt[];
  corners: ImageCorner[];
  clockwise: boolean;
  limited: boolean;
  contains(p: Pt): boolean;
  /** Parameter interval inside the boundary: point = origin + t * direction. */
  lineSpan(origin: Pt, direction: Pt): [number, number] | null;
  rowSpan(y: number): [number, number] | null;
}

const cross = (a: Pt, b: Pt, p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const area = (poly: readonly Pt[]) => poly.reduce((v, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return v + (p.x - poly[0].x) * (q.y - poly[0].y) - (q.x - poly[0].x) * (p.y - poly[0].y);
}, 0);

/** Convex intersection, retaining traversal order for stable per-corner numbering. */
function intersect(subject: Pt[], clip: readonly Pt[]): Pt[] {
  const sign = Math.sign(area(clip));
  for (let i = 0; i < clip.length && subject.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], result: Pt[] = [];
    for (let j = 0; j < subject.length; j++) {
      const p = subject[j], q = subject[(j + 1) % subject.length];
      const cp = sign * cross(a, b, p), cq = sign * cross(a, b, q);
      if (cp >= 0) result.push(p);
      if ((cp < 0) !== (cq < 0)) {
        const t = cp / (cp - cq);
        result.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
    subject = result;
  }
  // Remove duplicate intersections FIRST: otherwise both copies of a real corner
  // would disappear in the subsequent straight-corner filter.
  const extent = Math.max(
    Math.max(...subject.map(p => p.x)) - Math.min(...subject.map(p => p.x)),
    Math.max(...subject.map(p => p.y)) - Math.min(...subject.map(p => p.y)));
  const mergeDistance = extent * Number.EPSILON * 64;
  subject = subject.filter((p, i) => {
    const prev = subject[(i + subject.length - 1) % subject.length];
    return Math.hypot(p.x - prev.x, p.y - prev.y) > mergeDistance;
  });
  // Clipping can also create straight corners.
  return subject.filter((p, i) => {
    const a = subject[(i + subject.length - 1) % subject.length], b = subject[(i + 1) % subject.length];
    const lengths = Math.hypot(p.x - a.x, p.y - a.y) * Math.hypot(b.x - p.x, b.y - p.y);
    return lengths > 0 && Math.abs(cross(a, p, b)) > lengths * Number.EPSILON * 64;
  });
}

/** Exact visible boundary after crop/perspective, rounded LAST in final world mm. */
export function resolveImageContour(image: Readonly<ImageShape>, world: Mat = IDENT):
  { ok: true; contour: ImageContour } | { ok: false; reason: 'geometry' } {
  const invalid = { ok: false, reason: 'geometry' } as const;
  const resolved = resolveImageEdits(image), radii = image.edit?.cornerRadii;
  if (!resolved.ok) return invalid;
  if (world.length !== 6 || !world.every(Number.isFinite) || world[0] * world[3] - world[1] * world[2] === 0) return invalid;
  let local = resolved.quad.map(p => ({ ...p }));
  if (resolved.order === 'perspectiveFirst') {
    const full = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
      .map(p => resolved.geometry.sourceToLocal(p));
    if (full.some(p => !p)) return invalid;
    local = intersect(local, full as Pt[]);
  }
  const polygon = local.map(p => apply(world, p.x, p.y));
  if (polygon.length < 3 || polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return invalid;
  const signedArea = area(polygon), sign = Math.sign(signedArea);
  if (!sign || !Number.isFinite(signedArea)) return invalid;
  const lengths = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const eps = Math.max(...lengths) * Number.EPSILON * 128;
  const maxRadius = Math.max(0, ...(radii ?? []));
  const data = polygon.map((vertex, i) => {
    const prev = polygon[(i + polygon.length - 1) % polygon.length], next = polygon[(i + 1) % polygon.length];
    const u = { x: (prev.x - vertex.x) / lengths[(i + polygon.length - 1) % polygon.length],
      y: (prev.y - vertex.y) / lengths[(i + polygon.length - 1) % polygon.length] };
    const v = { x: (next.x - vertex.x) / lengths[i], y: (next.y - vertex.y) / lengths[i] };
    const half = Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y) / 2;
    const requested = radii?.[i] ?? 0;
    const relative = maxRadius ? requested / maxRadius : 0;
    return { vertex, u, v, half, requested, relative, tangent: relative / Math.tan(half) };
  });
  // Normalize requested values before calculating tangent lengths: even the
  // largest finite input can be limited without overflowing edge constraints.
  let scale = maxRadius;
  for (let i = 0; i < data.length; i++) {
    const total = data[i].tangent + data[(i + 1) % data.length].tangent;
    if (total > 0) scale = Math.min(scale, lengths[i] / total);
  }
  const corners = data.map(({ vertex, u, v, half, requested, relative, tangent }) => {
    const radius = relative * scale, t = tangent * scale;
    const bisector = Math.hypot(u.x + v.x, u.y + v.y), distance = radius / Math.sin(half);
    return { vertex, requested, radius, start: { x: vertex.x + u.x * t, y: vertex.y + u.y * t },
      end: { x: vertex.x + v.x * t, y: vertex.y + v.y * t },
      center: radius ? { x: vertex.x + (u.x + v.x) / bisector * distance,
        y: vertex.y + (u.y + v.y) / bisector * distance } : { ...vertex } };
  });
  if (corners.some(c => ![c.radius, c.center.x, c.center.y, c.start.x, c.start.y, c.end.x, c.end.y].every(Number.isFinite))) return invalid;
  const inArc = (p: Pt, i: number) => {
    const c = corners[i], { u, v } = data[i];
    return (p.x - c.start.x) * u.x + (p.y - c.start.y) * u.y <= eps
      && (p.x - c.end.x) * v.x + (p.y - c.end.y) * v.y <= eps;
  };
  const contains = (p: Pt): boolean => {
    for (let i = 0; i < polygon.length; i++) {
      if (sign * cross(polygon[i], polygon[(i + 1) % polygon.length], p) < -eps * lengths[i]) return false;
      const c = corners[i];
      if (c.radius && inArc(p, i) && Math.hypot(p.x - c.center.x, p.y - c.center.y) > c.radius + eps) return false;
    }
    return true;
  };
  const lineSpan = (origin: Pt, direction: Pt): [number, number] | null => {
    const norm = direction.x * direction.x + direction.y * direction.y;
    if (!Number.isFinite(norm) || norm <= 0) return null;
    const length = Math.sqrt(norm);
    const xs: number[] = [];
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i], next = corners[(i + 1) % corners.length];
      const a = c.end, b = next.start;
      const ex = b.x - a.x, ey = b.y - a.y;
      const ax = a.x - origin.x, ay = a.y - origin.y;
      const det = direction.x * ey - direction.y * ex;
      if (Math.abs(det) <= eps * length) {
        if (Math.abs(ax * direction.y - ay * direction.x) <= eps * length) {
          xs.push((ax * direction.x + ay * direction.y) / norm,
            ((b.x - origin.x) * direction.x + (b.y - origin.y) * direction.y) / norm);
        }
      } else {
        const u = (ax * direction.y - ay * direction.x) / det;
        if (u >= 0 && u <= 1) xs.push((ax * ey - ay * ex) / det);
      }
      if (c.radius) {
        const dx = origin.x - c.center.x, dy = origin.y - c.center.y;
        const distance = Math.abs(dx * direction.y - dy * direction.x) / length;
        if (distance <= c.radius) {
          const center = -(dx * direction.x + dy * direction.y) / norm;
          const half = Math.sqrt(Math.max(0, (c.radius - distance) * (c.radius + distance))) / length;
          for (const t of [center - half, center + half]) {
            if (inArc({ x: origin.x + direction.x * t, y: origin.y + direction.y * t }, i)) xs.push(t);
          }
        }
      }
    }
    return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
  };
  const rowSpan = (y: number) => lineSpan({ x: 0, y }, { x: 1, y: 0 });
  return { ok: true, contour: { polygon, corners, clockwise: sign > 0,
    limited: maxRadius > 0 && scale / maxRadius < 1 - Number.EPSILON * 64, contains, lineSpan, rowSpan } };
}
