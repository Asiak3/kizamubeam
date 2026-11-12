// Bundled patterns for the pattern fill (issue #245): tiles built from exact lines and Bézier arcs.
// They appear in the pattern fill dialog and in the Library window (group “Patterns”) like the other bundled
// entries; saved and extension patterns are ordinary library entries with category 'pattern' (assetFormat.ts).
import type { Node, Obj, SubPath } from './model';
import type { AssetData } from './assetFormat';
import { DEFAULT_PATTERN_SETTINGS, PatternSettings, PatternSpec, PatternTile } from './patternFormat';
import { lang } from './i18n';

export interface BuiltinPattern {
  id: string;
  /** Name German, English */
  name: [string, string];
  tags: string[];
  spec: PatternSpec;
}

const K = 0.5522847498;
const line = (...pts: [number, number][]): SubPath => ({ closed: false, nodes: pts.map(([x, y]) => ({ x, y })) });
const poly = (...pts: [number, number][]): SubPath => ({ closed: true, nodes: pts.map(([x, y]) => ({ x, y })) });
function circle(cx: number, cy: number, r: number): SubPath {
  const k = r * K;
  const n = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Node => ({ x, y, cin: { x: x + ix, y: y + iy }, cout: { x: x + ox, y: y + oy }, smooth: true });
  return { closed: true, nodes: [n(cx + r, cy, 0, -k, 0, k), n(cx, cy + r, k, 0, -k, 0), n(cx - r, cy, 0, k, 0, -k), n(cx, cy - r, -k, 0, k, 0)] };
}
/** Arc around (cx, cy) from angle a0 to a1 (radians, y down), split into quarter-circle Béziers */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): SubPath {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const da = (a1 - a0) / steps;
  const k = (4 / 3) * Math.tan(da / 4) * r;
  const nodes: Node[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + i * da;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const tx = -Math.sin(a), ty = Math.cos(a);
    const node: Node = { x, y };
    if (i > 0) node.cin = { x: x - tx * k, y: y - ty * k };
    if (i < steps) node.cout = { x: x + tx * k, y: y + ty * k };
    nodes.push(node);
  }
  return { closed: false, nodes };
}
function star(cx: number, cy: number, r: number, inner: number, points: number): SubPath {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return poly(...pts);
}
/** One wave period from x0 to x0 + L with amplitude A, as two Béziers */
function wave(x0: number, y: number, L: number, A: number): SubPath {
  const h = L / 4;
  return {
    closed: false,
    nodes: [
      { x: x0, y, cout: { x: x0 + h * 0.55, y: y - A * 1.05 } },
      { x: x0 + L / 2, y, cin: { x: x0 + L / 2 - h * 0.55, y: y - A * 1.05 }, cout: { x: x0 + L / 2 + h * 0.55, y: y + A * 1.05 }, smooth: true },
      { x: x0 + L, y, cin: { x: x0 + L - h * 0.55, y: y + A * 1.05 } },
    ],
  };
}
const settings = (s: Partial<PatternSettings>): PatternSettings => ({ ...DEFAULT_PATTERN_SETTINGS, ...s });
const tile = (w: number, h: number, subs: SubPath[]): PatternTile => ({ w, h, subs });

function build(): BuiltinPattern[] {
  const out: BuiltinPattern[] = [];
  const add = (id: string, de: string, en: string, tags: string[], t: PatternTile, s: Partial<PatternSettings>) =>
    out.push({ id, name: [de, en], tags, spec: { tile: t, settings: settings(s) } });

  // Honeycomb: one hexagon (pointy top, circumradius 5) on the hexagonal repeat; shared edges merge
  const r = 5, hw = (Math.sqrt(3) * r) / 2;
  add('honeycomb', 'Waben', 'Honeycomb', ['Sechseck', 'hexagon', 'Bienen', 'bee'],
    tile(2 * hw, 2 * r, [poly([0, -r], [hw, -r / 2], [hw, r / 2], [0, r], [-hw, r / 2], [-hw, -r / 2])]), { repeat: 'hex' });

  // Fish scales: lower half circle, rows offset by half a tile
  add('scales', 'Fischschuppen', 'Fish scales', ['Schuppen', 'scales', 'Drache', 'dragon', 'Bögen', 'arcs'],
    tile(10, 5, [arc(0, -2.5, 5, Math.PI, 0)]), { repeat: 'brick' });

  // Waves: one period per tile, rows below each other
  add('waves', 'Wellen', 'Waves', ['Welle', 'wave', 'Wasser', 'water', 'Sinus'], tile(20, 6, [wave(-10, 0, 20, 2)]), { repeat: 'grid' });

  // Truchet arcs: two quarter arcs per tile; in rows they form flowing diagonal waves
  add('truchet', 'Truchet-Bögen', 'Truchet arcs', ['Truchet', 'Bögen', 'arcs', 'Labyrinth', 'maze'],
    tile(10, 10, [arc(-5, -5, 5, 0, Math.PI / 2), arc(5, 5, 5, Math.PI, 1.5 * Math.PI)]), { repeat: 'grid' });

  // Rings: the same arcs turned like a pinwheel close into circles
  add('rings', 'Ringe', 'Rings', ['Kreis', 'circle', 'Ring', 'Truchet', 'Windrad', 'pinwheel'],
    tile(10, 10, [arc(-5, -5, 5, 0, Math.PI / 2), arc(5, 5, 5, Math.PI, 1.5 * Math.PI)]), { repeat: 'rotate' });

  // Diamonds: both diagonals of the tile; the lines join into long diagonals
  add('diamonds', 'Rauten', 'Diamonds', ['Raute', 'diamond', 'Gitter', 'lattice', 'Argyle'], tile(10, 10, [line([-5, -5], [5, 5]), line([5, -5], [-5, 5])]), { repeat: 'grid' });

  // Herringbone: bricks 2 × 1 (unit 2.5 mm) on the lattice (1, 1), (2, −2); four pairs fill one square period
  {
    const u = 2.5;
    const subs: SubPath[] = [];
    for (let k = 0; k < 4; k++) {
      const x = k * u - 5, y = k * u - 5;
      subs.push(poly([x, y], [x + 2 * u, y], [x + 2 * u, y + u], [x, y + u]));
      subs.push(poly([x + 2 * u, y - u], [x + 3 * u, y - u], [x + 3 * u, y + u], [x + 2 * u, y + u]));
    }
    add('herringbone', 'Fischgrät', 'Herringbone', ['Parkett', 'parquet', 'Ziegel', 'brick', 'Fischgrat'], tile(4 * u, 4 * u, subs), { repeat: 'grid', angle: 45 });
  }

  // Basket weave: quadrants with three horizontal or three vertical bands
  {
    const subs: SubPath[] = [];
    const q = 6;
    for (const [ox, oy, horiz] of [[-q, -q, true], [0, -q, false], [-q, 0, false], [0, 0, true]] as [number, number, boolean][]) {
      subs.push(poly([ox, oy], [ox + q, oy], [ox + q, oy + q], [ox, oy + q]));
      for (const s of [q / 3, (2 * q) / 3]) subs.push(horiz ? line([ox, oy + s], [ox + q, oy + s]) : line([ox + s, oy], [ox + s, oy + q]));
    }
    add('basket', 'Korbgeflecht', 'Basket weave', ['Flechten', 'weave', 'Korb', 'basket', 'Parkett'], tile(2 * q, 2 * q, subs), { repeat: 'grid' });
  }

  // Stars on a brick layout
  add('stars', 'Sterne', 'Stars', ['Stern', 'star', 'Himmel', 'sky', 'Weihnachten', 'christmas'], tile(12, 12, [star(0, 0.6, 5, 0.42, 5)]), { repeat: 'brick' });

  // Dots on a hexagonal layout
  add('dots', 'Punkte', 'Dots', ['Punkt', 'dot', 'Kreis', 'circle', 'Polka'], tile(6, 6 * (2 / Math.sqrt(3)), [circle(0, 0, 1.2)]), { repeat: 'hex' });

  // Overlapping circles (circle radius = spacing): the classic flower-like circle grid
  {
    const s = 5;
    add('circles', 'Kreisgitter', 'Circle grid', ['Kreis', 'circle', 'Blume', 'flower', 'Ringe', 'rings'], tile(s, s * (2 / Math.sqrt(3)), [circle(0, 0, s)]), { repeat: 'hex' });
  }

  // Chevrons: zigzag line per tile, rows below each other
  add('chevron', 'Zickzack', 'Chevron', ['Zickzack', 'zigzag', 'Pfeil', 'chevron', 'Welle'], tile(10, 5, [line([-5, 1.5], [0, -1.5], [5, 1.5])]), { repeat: 'grid' });

  // Ogee: a wave mirrored in every second row; the waves touch and form onion-shaped cells
  add('ogee', 'Ogee-Bögen', 'Ogee', ['Ogee', 'Bogen', 'arch', 'Marokko', 'moroccan', 'Ornament', 'Zwiebel'],
    tile(20, 4.725, [wave(-10, 0, 20, 3)]), { repeat: 'mirror', mirror: 'y' });

  return out;
}

let cache: BuiltinPattern[] | null = null;
export const builtinPatterns = (): BuiltinPattern[] => (cache ??= build());

export const BUILTIN_PATTERN_PREFIX = 'builtin:pattern.';
export const builtinPatternKey = (id: string) => `${BUILTIN_PATTERN_PREFIX}${id}`;

/** Library entry for a pattern: the tile as one path object (frame at 0, 0) plus the pattern itself */
export function patternAsset(name: string, spec: PatternSpec, tags: string[] = []): AssetData {
  const { tile } = spec;
  const obj: Obj = { id: 1, m: [1, 0, 0, 1, tile.w / 2, tile.h / 2], layer: 0, shape: { kind: 'path', subs: tile.subs } };
  return { name, category: 'pattern', tags, w: tile.w, h: tile.h, preview: patternPreviewSvg(spec), objs: [obj], images: {}, pattern: spec };
}

export function builtinPatternAssets(): { key: string; asset: AssetData }[] {
  const de = lang === 'de';
  return builtinPatterns().map((p) => ({ key: builtinPatternKey(p.id), asset: patternAsset(de ? p.name[0] : p.name[1], p.spec, [...p.tags, de ? p.name[1] : p.name[0]]) }));
}

// ---------- Preview ----------

const f = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(+v.toFixed(3)));
function subsD(subs: SubPath[], dx: number, dy: number, sx = 1, sy = 1): string {
  let d = '';
  for (const sp of subs) {
    if (sp.nodes.length < 2) continue;
    const P = (x: number, y: number) => `${f(dx + x * sx)} ${f(dy + y * sy)}`;
    const n = sp.nodes;
    d += `M${P(n[0].x, n[0].y)}`;
    const last = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < last; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      if (a.cout || b.cin) {
        const c1 = a.cout ?? a, c2 = b.cin ?? b;
        d += `C${P(c1.x, c1.y)} ${P(c2.x, c2.y)} ${P(b.x, b.y)}`;
      } else d += `L${P(b.x, b.y)}`;
    }
    if (sp.closed) d += 'Z';
  }
  return d;
}

/**
 * Small square SVG preview: a 3 × 3 block of tiles (approximate for mirrored, rotated and hexagonal repeats;
 * the dialog shows the real result on the workspace).
 */
export function patternPreviewSvg(spec: PatternSpec): string {
  const { tile, settings: s } = spec;
  const W = tile.w + Math.max(0, s.gapX), H = tile.h + Math.max(0, s.gapY);
  const size = 3 * Math.max(W, H);
  let d = '';
  for (let j = -1; j <= 3; j++)
    for (let i = -1; i <= 3; i++) {
      let x = i * W + W / 2, y = j * H + H / 2, sx = 1, sy = 1;
      if (s.repeat === 'brick' && j % 2) x += W * s.shift;
      if (s.repeat === 'halfdrop' && i % 2) y += H * s.shift;
      if (s.repeat === 'hex') {
        y = j * 0.75 * H + H / 2;
        if (j % 2) x += W / 2;
      }
      if (s.repeat === 'mirror') {
        if (i % 2 && s.mirror !== 'y') sx = -1;
        if (j % 2 && s.mirror !== 'x') sy = -1;
      }
      d += subsD(tile.subs, x, y, sx, sy);
    }
  const sw = f(size / 80);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(size)} ${f(size)}"><path d="${d}" fill="none" stroke="#3a3a3a" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
