// Workpieces placed on the bed and their burn maps. A burn map stores the laser energy per area (J/mm²) on a grid
// in the workpiece's own coordinates, so a burn moves along when the piece is moved afterwards. From the energy
// follow how dark the surface is, how deep the laser went and whether it cut through. No DOM, so it runs in Node.
//
// The numbers are a model, not a measurement: a 10 W diode laser at 100 % and 300 mm/min just cuts 3 mm poplar
// plywood, an engraving at 30 % / 3000 mm/min / 0.1 mm line interval comes out medium dark.

/** A workpiece on the bed. x/y = front left corner before rotation (bed mm), rotation (degrees) about its centre */
export interface Piece {
  id: string;
  /** look id from src/view3d/looks.ts */
  look: string;
  /** own base colour (#rrggbb) instead of the look's colour */
  color?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** thickness in mm */
  t: number;
  rot: number;
}

/** How a material reacts: e0 = energy (J/mm²) for 63 % of the full mark, cut = energy per mm depth (J/mm³); null = the laser does not cut it */
export interface BurnParams {
  e0: number;
  cut: number | null;
}

const WOOD: BurnParams = { e0: 0.5, cut: 3 };
const HARDWOOD: BurnParams = { e0: 0.6, cut: 4 };

export const BURN: Record<string, BurnParams> = {
  poplar: WOOD,
  birch: WOOD,
  beech: { e0: 0.6, cut: 3.5 },
  oak: HARDWOOD,
  walnut: HARDWOOD,
  cherry: { e0: 0.6, cut: 3.5 },
  bamboo: HARDWOOD,
  mdf: { e0: 0.4, cut: 3.5 },
  cardboard: { e0: 0.3, cut: 1.5 },
  paper: { e0: 0.25, cut: 1 },
  cork: { e0: 0.4, cut: 2 },
  leather: { e0: 0.5, cut: 3 },
  slate: { e0: 1.2, cut: null },
  granite: { e0: 2, cut: null },
  acrylic: { e0: 1.5, cut: 7.5 },
  'acrylic-color': { e0: 0.8, cut: 5 },
  'acrylic-opaque': { e0: 0.8, cut: 5 },
  glass: { e0: 3, cut: null },
  anodized: { e0: 0.8, cut: null },
  steel: { e0: 6, cut: null },
  plain: WOOD,
};

export const burnParams = (look: string) => BURN[look] ?? WOOD;

/** Width of the laser spot in mm */
export const SPOT = 0.1;
/** Finest grid: 10 pixels per mm; larger pieces get a coarser grid so a map has at most MAX_PX per side */
const MAX_RES = 10;
const MAX_PX = 2048;
/** 2σ² of the Gaussian in pixels² (σ = 0.6 px) */
const SPREAD = 0.72;

/** Bed point → piece coordinates (mm from the piece's front left corner, along its edges) */
export function toLocal(p: Piece, x: number, y: number): [number, number] {
  const cx = p.x + p.w / 2,
    cy = p.y + p.h / 2;
  const a = (-p.rot * Math.PI) / 180;
  const dx = x - cx,
    dy = y - cy;
  return [dx * Math.cos(a) - dy * Math.sin(a) + p.w / 2, dx * Math.sin(a) + dy * Math.cos(a) + p.h / 2];
}

/** Piece coordinates → bed point */
export function toBed(p: Piece, u: number, v: number): [number, number] {
  const a = (p.rot * Math.PI) / 180;
  const dx = u - p.w / 2,
    dy = v - p.h / 2;
  return [p.x + p.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), p.y + p.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Corners of a piece on the bed (front left, front right, back right, back left) */
export const corners = (p: Piece): [number, number][] => [toBed(p, 0, 0), toBed(p, p.w, 0), toBed(p, p.w, p.h), toBed(p, 0, p.h)];

export function contains(p: Piece, x: number, y: number) {
  const [u, v] = toLocal(p, x, y);
  return u >= 0 && v >= 0 && u <= p.w && v <= p.h;
}

export class BurnMap {
  /** pixels per mm */
  readonly res: number;
  readonly nx: number;
  readonly ny: number;
  /** energy per area in J/mm², row 0 = front edge */
  readonly energy: Float32Array;
  /** for the texture, 2 bytes per pixel: mark strength 0…255, depth as share of the thickness 0…255 (255 = through) */
  readonly tex: Uint8Array;
  /** set when tex changed; the view clears it after uploading */
  dirty = true;
  /** counts changes (for the cut-out analysis) */
  version = 0;
  private params: BurnParams;
  private thick: number;
  /** a coarse grid spreads a line over a wider pixel than the spot; this undoes the thinning for marks and cuts */
  private lineK: number;
  /** pixels at or above this depth byte count as cut through */
  through = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    look: string,
    thick: number,
  ) {
    this.res = Math.min(MAX_RES, MAX_PX / Math.max(w, h));
    this.nx = Math.max(1, Math.ceil(w * this.res));
    this.ny = Math.max(1, Math.ceil(h * this.res));
    this.energy = new Float32Array(this.nx * this.ny);
    this.tex = new Uint8Array(this.nx * this.ny * 2);
    this.params = burnParams(look);
    this.thick = thick;
    this.lineK = Math.max(1, 1 / this.res / SPOT);
  }

  /** Change material or thickness: the stored energy stays, marks and depth are recomputed */
  setMaterial(look: string, thick: number) {
    this.params = burnParams(look);
    this.thick = thick;
    for (let i = 0; i < this.energy.length; i++) this.shade(i);
    this.dirty = true;
    this.version++;
  }

  clear() {
    this.energy.fill(0);
    this.tex.fill(0);
    this.through = 0;
    this.dirty = true;
    this.version++;
  }

  /** Mark strength 0…1 for an energy density */
  mark(e: number) {
    return 1 - Math.exp((-e * this.lineK) / this.params.e0);
  }

  /** Depth in mm for an energy density (capped at the thickness) */
  depth(e: number) {
    const c = this.params.cut;
    return c === null ? 0 : Math.min(this.thick, (e * this.lineK) / c);
  }

  isThrough(i: number) {
    return this.tex[i * 2 + 1] === 255;
  }

  private shade(i: number) {
    const e = this.energy[i];
    const was = this.tex[i * 2 + 1] === 255;
    this.tex[i * 2] = Math.round(this.mark(e) * 255);
    const d = this.thick > 0 ? this.depth(e) / this.thick : 0;
    this.tex[i * 2 + 1] = d >= 1 ? 255 : Math.min(254, Math.round(d * 255));
    const now = this.tex[i * 2 + 1] === 255;
    if (now !== was) this.through += now ? 1 : -1;
  }

  /** Spread energy over the 3 × 3 pixels around a point with a small Gaussian (about the spot width at the finest
   *  grid). Energy is kept exactly, and a line burns about equally deep wherever it lies relative to the grid. */
  private add(px: number, py: number, joules: number) {
    const fx = px * this.res - 0.5,
      fy = py * this.res - 0.5;
    const ix = Math.round(fx),
      iy = Math.round(fy);
    const wx = [0, 0, 0],
      wy = [0, 0, 0];
    let sx = 0,
      sy = 0;
    for (let k = 0; k < 3; k++) {
      sx += wx[k] = Math.exp(-((ix + k - 1 - fx) ** 2) / SPREAD);
      sy += wy[k] = Math.exp(-((iy + k - 1 - fy) ** 2) / SPREAD);
    }
    const dens = (joules * this.res * this.res) / (sx * sy);
    for (let j = 0; j < 3; j++) {
      const y = iy + j - 1;
      if (y < 0 || y >= this.ny) continue;
      for (let k = 0; k < 3; k++) {
        const x = ix + k - 1;
        if (x < 0 || x >= this.nx) continue;
        const i = y * this.nx + x;
        this.energy[i] += dens * wx[k] * wy[j];
        this.shade(i);
      }
    }
  }

  /** Burn a line in piece coordinates (mm) with the given energy (J), spread evenly along it */
  deposit(ax: number, ay: number, bx: number, by: number, joules: number) {
    if (!(joules > 0)) return;
    const m = 1 / this.res;
    if (Math.max(ax, bx) < -m || Math.max(ay, by) < -m || Math.min(ax, bx) > this.w + m || Math.min(ay, by) > this.h + m) return;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len * this.res * 2));
    const e = joules / n;
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      this.add(ax + (bx - ax) * f, ay + (by - ay) * f, e);
    }
    this.dirty = true;
    this.version++;
  }

  /** Total stored energy in J (for tests) */
  total() {
    let s = 0;
    for (const e of this.energy) s += e;
    return s / (this.res * this.res);
  }
}

/** Segments from the controller (7 numbers each: x0, y0, x1, y1, power 0…1, duration s, rapid) into the burn maps */
export function burnSegments(s: ArrayLike<number>, watts: number, pieces: { piece: Piece; map: BurnMap }[]) {
  if (!pieces.length) return;
  for (let i = 0; i + 6 < s.length; i += 7) {
    const p = s[i + 4];
    if (!(p > 0) || s[i + 6]) continue;
    const joules = p * watts * s[i + 5];
    for (const { piece, map } of pieces) {
      const [ax, ay] = toLocal(piece, s[i], s[i + 1]);
      const [bx, by] = toLocal(piece, s[i + 2], s[i + 3]);
      map.deposit(ax, ay, bx, by, joules);
    }
  }
}
