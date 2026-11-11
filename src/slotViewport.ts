import type { Pt } from './model';

export const SLOT_VIEWPORT_MIN_SCALE = 1e-3;
export const SLOT_VIEWPORT_MAX_SCALE = 1e4;

const validPoint = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);
const validSize = (w: number, h: number) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
const clampScale = (s: number) => Math.max(SLOT_VIEWPORT_MIN_SCALE, Math.min(SLOT_VIEWPORT_MAX_SCALE, s));
// Invalid conversion inputs use zero; arithmetic overflow saturates rather than returning infinity.
const coordinate = (v: number) => Number.isNaN(v) ? 0 : Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, v));
const input = (v: number) => Number.isFinite(v) ? v : 0;

/** DOM-free preview transform: screen = world * scale + offset, with y pointing down.
 * Call fit only initially or on an explicit Fit action, using source geometry (not helper lines).
 * Geometry changes otherwise leave this view untouched. Sizes, offsets and padding are screen pixels.
 */
export class SlotViewport {
  scale = 1;
  ox = 0;
  oy = 0;
  initialized = false;

  /** Fit finite source points; empty geometry/invalid sizes leave the view unchanged.
   * Scale bounds take precedence if extremely large geometry cannot fit at minimum scale.
   */
  fit(points: Pt[], width: number, height: number, pad = 30): void {
    if (!validSize(width, height)) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (!validPoint(p)) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (minX === Infinity) return;
    const padding = Math.min(Number.isFinite(pad) ? Math.max(0, pad) : 30, Math.max(0, (Math.min(width, height) - 1) / 2));
    const dx = maxX - minX, dy = maxY - minY;
    const scale = clampScale(dx === 0 && dy === 0 ? 1 : Math.min(
      dx === 0 ? Infinity : (width - 2 * padding) / dx,
      dy === 0 ? Infinity : (height - 2 * padding) / dy,
    ));
    const ox = coordinate(width / 2 - (minX / 2 + maxX / 2) * scale);
    const oy = coordinate(height / 2 - (minY / 2 + maxY / 2) * scale);
    this.scale = scale;
    this.ox = ox;
    this.oy = oy;
    this.initialized = true;
  }

  /** Keep the same world point at the viewport center, without refitting or changing scale. */
  resize(oldW: number, oldH: number, newW: number, newH: number): void {
    if (!validSize(oldW, oldH) || !validSize(newW, newH)) return;
    this.pan(newW / 2 - oldW / 2, newH / 2 - oldH / 2);
  }

  /** Pan by a screen-space delta; invalid or overflowing changes are ignored. */
  pan(dx: number, dy: number): void {
    const ox = this.ox + dx, oy = this.oy + dy;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(ox) || !Number.isFinite(oy)) return;
    this.ox = ox;
    this.oy = oy;
  }

  /** Multiply scale while keeping the world point under screen fixed, including at scale bounds. */
  zoom(factor: number, screen: Pt): void {
    if (!Number.isFinite(factor) || factor <= 0 || !validPoint(screen)) return;
    const scale = clampScale(this.scale * factor);
    const ratio = scale / this.scale;
    const ox = screen.x - (screen.x - this.ox) * ratio;
    const oy = screen.y - (screen.y - this.oy) * ratio;
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return;
    this.scale = scale;
    this.ox = ox;
    this.oy = oy;
  }

  toWorld(screen: Pt): Pt {
    return { x: coordinate((input(screen.x) - this.ox) / this.scale), y: coordinate((input(screen.y) - this.oy) / this.scale) };
  }

  toScreen(world: Pt): Pt {
    return { x: coordinate(input(world.x) * this.scale + this.ox), y: coordinate(input(world.y) * this.scale + this.oy) };
  }
}
