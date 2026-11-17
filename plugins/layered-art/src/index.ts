// Layered art (#159): turns a logo, drawing or photo into a stacked panel of plates (e.g. 3 mm plywood) that are
// cut, glued on top of each other and give the picture depth. The image is split into depth levels (colour
// clusters for logos, brightness bands for photos); plate n is everything at depth n or above, held by a frame,
// so every plate is one piece and every plate above sits on the plate below. Thin features and tiny pieces are
// removed by the cutting rules (mm), the outlines are traced by the app (host function trace) as Bézier curves.
// Each plate gets the outline of the plate above as a score mark and its gluing number; the 3D view stacks them.
// Coordinates are mm, y down; plate 1 is the back plate.
import { definePlugin, host, pixels, regionMap, storedImage, strokeText, type Issue, type Params, type Part, type Pose, type SubPath, type Text } from '../../sdk/ts';

interface P extends Params {
  photo: string;
  mode: string;
  plates: number;
  width: number;
  thickness: number;
  frame: number;
  thin: number;
  minPiece: number;
  marks: boolean;
  detail: number;
  levels: string;
}

/** A depth level: the colour shown in the list and the cluster colours of the image that belong to it */
interface Level {
  c: string;
  m: string[];
}

interface Img {
  w: number;
  h: number;
  /** RGBA */
  px: Uint8Array;
}

// ---------------------------------------------------------------- images kept by id
const images = new Map<string, Img>();

function decode(w: number, h: number, data: string): Img {
  const px = pixels({ width: w, height: h, data });
  // Transparent pixels count as white (the usual background of a logo)
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 1) for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * a + 255 * (1 - a));
  }
  return { w, h, px };
}

// ---------------------------------------------------------------- colours
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const rgb = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function readLevels(p: P): Level[] {
  try {
    const a = JSON.parse(p.levels || '[]');
    if (!Array.isArray(a)) return [];
    return a
      .filter((x) => x && typeof x.c === 'string' && /^#[0-9a-f]{6}$/i.test(x.c))
      .map((x) => ({ c: x.c.toLowerCase(), m: (Array.isArray(x.m) ? x.m : [x.c]).filter((y: unknown) => typeof y === 'string' && /^#[0-9a-f]{6}$/i.test(y)).map((y: string) => y.toLowerCase()) }))
      .filter((x) => x.m.length);
  } catch {
    return [];
  }
}

/**
 * Split an image into k levels. Logo: colour clusters (k-means from spread-out start colours). Photo: brightness
 * bands with the same number of pixels each. Order: front first, back plate last; the back plate is the colour most
 * often found on the border (the background) for a logo, the darkest band for a photo; the others go from light
 * (front) to dark.
 */
function analyse(img: Img, k: number, mode: string): Level[] {
  const n = img.w * img.h;
  const step = Math.max(1, Math.floor(n / 40000));
  const sample: [number, number, number][] = [];
  for (let i = 0; i < n; i += step) sample.push([img.px[i * 4], img.px[i * 4 + 1], img.px[i * 4 + 2]]);
  let centres: [number, number, number][];
  if (mode === 'photo') {
    const ls = sample.map((c) => luma(...c)).sort((a, b) => a - b);
    centres = [];
    for (let i = 0; i < k; i++) {
      const lo = Math.floor((i * ls.length) / k), hi = Math.max(lo + 1, Math.floor(((i + 1) * ls.length) / k));
      let s = 0;
      for (let j = lo; j < hi; j++) s += ls[j];
      const v = s / (hi - lo);
      centres.push([v, v, v]);
    }
  } else centres = kmeans(sample, k);
  // Drop empty or duplicate colours
  const seen = new Set<string>();
  const levels: { c: string; l: number; border: number }[] = [];
  for (const c of centres) {
    const x = hex(...c);
    if (seen.has(x)) continue;
    seen.add(x);
    levels.push({ c: x, l: luma(...c), border: 0 });
  }
  if (mode !== 'photo') {
    // Background: the cluster most border pixels belong to
    const near = nearestOf(levels.map((v) => rgb(v.c)), false);
    const border = (x: number, y: number) => {
      const i = (y * img.w + x) * 4;
      levels[near(img.px[i], img.px[i + 1], img.px[i + 2])].border++;
    };
    for (let x = 0; x < img.w; x++) (border(x, 0), border(x, img.h - 1));
    for (let y = 0; y < img.h; y++) (border(0, y), border(img.w - 1, y));
  }
  levels.sort((a, b) => b.l - a.l);
  if (mode !== 'photo') {
    const back = levels.reduce((best, v, i) => (v.border > levels[best].border ? i : best), 0);
    levels.push(...levels.splice(back, 1));
  }
  return levels.map((v) => ({ c: v.c, m: [v.c] }));
}

function kmeans(pts: [number, number, number][], k: number): [number, number, number][] {
  if (!pts.length) return [];
  // Start: the most common-ish first point, then always the point farthest from the chosen ones
  const centres: [number, number, number][] = [pts[0]];
  const d = pts.map((p) => dist2(p, pts[0]));
  while (centres.length < k) {
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (d[i] > d[best]) best = i;
    if (d[best] === 0) break;
    centres.push(pts[best]);
    for (let i = 0; i < pts.length; i++) d[i] = Math.min(d[i], dist2(pts[i], pts[best]));
  }
  for (let it = 0; it < 12; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < centres.length; j++) {
        const x = dist2(p, centres[j]);
        if (x < bd) (bd = x), (best = j);
      }
      const s = sum[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    let moved = false;
    for (let j = 0; j < centres.length; j++) {
      const s = sum[j];
      if (!s[3]) continue;
      const c: [number, number, number] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      if (dist2(c, centres[j]) > 0.25) moved = true;
      centres[j] = c;
    }
    if (!moved) break;
  }
  return centres;
}

const dist2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Index of the nearest colour, by colour (logo) or by brightness only (photo); answers are remembered */
function nearestOf(cols: [number, number, number][], byLuma: boolean): (r: number, g: number, b: number) => number {
  const memo = new Map<number, number>();
  const ls = cols.map((c) => luma(...c));
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = 0, bd = Infinity;
    if (byLuma) {
      const l = luma(r, g, b);
      for (let j = 0; j < cols.length; j++) {
        const x = Math.abs(ls[j] - l);
        if (x < bd) (bd = x), (best = j);
      }
    } else {
      for (let j = 0; j < cols.length; j++) {
        const c = cols[j];
        const x = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
        if (x < bd) (bd = x), (best = j);
      }
    }
    if (memo.size < 200000) memo.set(key, best);
    return best;
  };
}

// ---------------------------------------------------------------- the grid of levels
interface Grid {
  gw: number;
  gh: number;
  /** mm per cell */
  res: number;
  W: number;
  H: number;
  /** Level index per cell (0 = front … last = back plate) */
  label: Uint8Array;
}

const MAX_CELLS = 700;
let gridMemo: { key: string; grid: Grid } | null = null;

function grid(p: P, img: Img, levels: Level[], maxCells = MAX_CELLS): Grid {
  const key = JSON.stringify([p.photo, p.width, p.detail, p.mode, p.levels, maxCells]);
  if (gridMemo?.key === key) return gridMemo.grid;
  const W = p.width, H = (p.width * img.h) / img.w;
  const res = Math.max(p.detail, W / maxCells, H / maxCells);
  const gw = Math.max(2, Math.round(W / res)), gh = Math.max(2, Math.round(H / res));
  // Each member colour points to its level
  const members: [number, number, number][] = [];
  const owner: number[] = [];
  levels.forEach((lv, i) => lv.m.forEach((c) => (members.push(rgb(c)), owner.push(i))));
  const near = nearestOf(members, p.mode === 'photo');
  const label = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const sy = Math.min(img.h - 1, Math.floor(((y + 0.5) * img.h) / gh));
    for (let x = 0; x < gw; x++) {
      const sx = Math.min(img.w - 1, Math.floor(((x + 0.5) * img.w) / gw));
      const i = (sy * img.w + sx) * 4;
      label[y * gw + x] = owner[near(img.px[i], img.px[i + 1], img.px[i + 2])];
    }
  }
  const g = { gw, gh, res, W: gw * res, H: gh * res, label };
  gridMemo = { key, grid: g };
  return g;
}

// ---------------------------------------------------------------- masks (1 = material)
/** Grow (on = 1) or shrink (on = 0) the cells of value `on` by r cells, alternating 4- and 8-neighbours (≈ a disc) */
function morph(m: Uint8Array, gw: number, gh: number, r: number, on: 0 | 1, keep: Uint8Array) {
  let a: Uint8Array = m, b: Uint8Array = new Uint8Array(m.length);
  for (let it = 0; it < r; it++) {
    const diag = it % 2 === 1;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        let v = a[i];
        if (v !== on && !keep[i]) {
          const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < gw && yy < gh && a[yy * gw + xx] === on;
          if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1) || (diag && (n(x - 1, y - 1) || n(x + 1, y - 1) || n(x - 1, y + 1) || n(x + 1, y + 1)))) v = on;
        }
        b[i] = keep[i] ? 1 : v;
      }
    [a, b] = [b, a];
  }
  if (a !== m) m.set(a);
}

/** Remove connected areas of value v smaller than minCells (they take the other value); returns how many */
function dropSmall(m: Uint8Array, gw: number, gh: number, v: 0 | 1, minCells: number, keep: Uint8Array): number {
  const seen = new Uint8Array(m.length);
  const stack: number[] = [];
  const area: number[] = [];
  let dropped = 0;
  for (let s = 0; s < m.length; s++) {
    if (seen[s] || m[s] !== v) continue;
    area.length = 0;
    stack.push(s);
    seen[s] = 1;
    let fixed = false;
    while (stack.length) {
      const i = stack.pop()!;
      area.push(i);
      if (keep[i]) fixed = true;
      const x = i % gw, y = (i - x) / gw;
      if (x > 0 && !seen[i - 1] && m[i - 1] === v) (seen[i - 1] = 1), stack.push(i - 1);
      if (x < gw - 1 && !seen[i + 1] && m[i + 1] === v) (seen[i + 1] = 1), stack.push(i + 1);
      if (y > 0 && !seen[i - gw] && m[i - gw] === v) (seen[i - gw] = 1), stack.push(i - gw);
      if (y < gh - 1 && !seen[i + gw] && m[i + gw] === v) (seen[i + gw] = 1), stack.push(i + gw);
    }
    if (!fixed && area.length < minCells) {
      for (const i of area) m[i] = v ? 0 : 1;
      dropped++;
    }
  }
  return dropped;
}

interface Plates {
  /** Material of each plate (index 0 = back plate) */
  masks: Uint8Array[];
  /** Pieces and holes removed by the rules */
  dropped: number;
  g: Grid;
}

let platesMemo: { key: string; plates: Plates } | null = null;

function plates(p: P, img: Img, levels: Level[]): Plates {
  const key = JSON.stringify([p.photo, p.width, p.detail, p.mode, p.levels, p.frame, p.thin, p.minPiece]);
  if (platesMemo?.key === key) return platesMemo.plates;
  const g = grid(p, img, levels);
  const { gw, gh, res, label } = g;
  const N = levels.length;
  // The frame: cells within the frame width of the border are material on every plate
  const f = Math.round(p.frame / res);
  const frame = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (x < f || y < f || x >= gw - f || y >= gh - f) frame[y * gw + x] = 1;
  const r = Math.round(p.thin / 2 / res);
  const minCells = p.minPiece / (res * res);
  const masks: Uint8Array[] = [new Uint8Array(gw * gh).fill(1)];
  let dropped = 0;
  const none = new Uint8Array(gw * gh);
  for (let n = 1; n < N; n++) {
    // depth = N - 1 - level; plate n holds every cell at depth ≥ n
    const m = new Uint8Array(gw * gh);
    for (let i = 0; i < m.length; i++) m[i] = frame[i] || N - 1 - label[i] >= n ? 1 : 0;
    if (r > 0) {
      // Open (thin material goes), then close (thin gaps fill)
      morph(m, gw, gh, r, 0, frame);
      morph(m, gw, gh, r, 1, frame);
      morph(m, gw, gh, r, 1, frame);
      morph(m, gw, gh, r, 0, none);
      for (let i = 0; i < m.length; i++) if (frame[i]) m[i] = 1;
    }
    if (minCells > 0) {
      dropped += dropSmall(m, gw, gh, 1, minCells, frame);
      dropped += dropSmall(m, gw, gh, 0, minCells, none);
    }
    // A piece must sit on the plate below
    const below = masks[n - 1];
    for (let i = 0; i < m.length; i++) m[i] &= below[i];
    masks.push(m);
  }
  const out = { masks, dropped, g };
  platesMemo = { key, plates: out };
  return out;
}

/** The holes of a plate (cells without material) as outlines, mm, centred */
function holes(m: Uint8Array, g: Grid): SubPath[] {
  if (m.every((v) => v === 1)) return [];
  const data = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) data[i] = m[i] ? 255 : 0;
  const subs = host.trace({ width: g.gw, height: g.gh, data: b64(data), threshold: 128, smooth: 0.5, ignoreLess: 1, scale: g.res });
  return subs.map((s) => ({ ...s, nodes: s.nodes.map((q) => ({ ...q, x: q.x - g.W / 2, y: q.y - g.H / 2, ...(q.cin ? { cin: { x: q.cin.x - g.W / 2, y: q.cin.y - g.H / 2 } } : {}), ...(q.cout ? { cout: { x: q.cout.x - g.W / 2, y: q.cout.y - g.H / 2 } } : {}) })) }));
}

function b64(b: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (i + 1 < b.length ? abc[(n >> 6) & 63] : '=') + (i + 2 < b.length ? abc[n & 63] : '=');
  }
  return s;
}

const rect = (W: number, H: number): SubPath => ({ closed: true, nodes: [{ x: -W / 2, y: -H / 2 }, { x: W / 2, y: -H / 2 }, { x: W / 2, y: H / 2 }, { x: -W / 2, y: H / 2 }] });

// ---------------------------------------------------------------- plugin
const imageOf = (p: P) => (p.photo ? images.get(p.photo) : undefined);

function check(p: P): Issue[] {
  if (!p.photo) return [{ level: 'error', code: 'noImage' }];
  const img = imageOf(p);
  if (!img) return [{ level: 'error', code: 'loading' }];
  const levels = readLevels(p);
  if (levels.length < 2) return [{ key: 'plates', level: 'error', code: 'fewLevels' }];
  const H = (p.width * img.h) / img.w;
  if (2 * p.frame >= Math.min(p.width, H) - 2) return [{ key: 'frame', level: 'error', code: 'frameTooWide' }];
  return [];
}

/** Levels for the image and the settings, or nothing while the image is not there */
function levelsFor(p: P, img?: Img): Level[] | null {
  return img ? analyse(img, p.plates, p.mode) : null;
}

definePlugin<P>({
  resource({ kind, id, data }) {
    if (kind !== 'image') return null;
    const im = storedImage(data);
    if (im) images.set(id, decode(im.width, im.height, im.data));
    return null;
  },
  validate: check,
  generate(p) {
    const img = imageOf(p)!;
    const levels = readLevels(p);
    const N = levels.length;
    const pl = plates(p, img, levels);
    const { g } = pl;
    const outlines = pl.masks.map((m) => holes(m, g));
    const parts: Part[] = [];
    const labels: Record<string, Text> = {};
    const poses: Record<string, Pose> = {};
    for (let n = 0; n < N; n++) {
      const key = `plate${n + 1}`;
      const marks: SubPath[] = [];
      if (p.marks) {
        // Where the plate above is glued, and the gluing order number on the frame
        if (n + 1 < N) marks.push(...outlines[n + 1]);
        const size = Math.min(p.frame * 0.7, 8);
        if (size >= 2) marks.push(...strokeText(String(n + 1), size, { x: -g.W / 2 + p.frame / 2, y: -g.H / 2 + p.frame / 2, align: 'center', valign: 'middle' }));
      }
      parts.push({ key, subs: [rect(g.W, g.H), ...outlines[n]], at: { x: 0, y: 0 }, ...(marks.length ? { marks } : {}) });
      labels[key] = n === 0 ? { code: 'part.back' } : n === N - 1 ? { code: 'part.front', values: { n: n + 1 } } : { code: 'part.plate', values: { n: n + 1 } };
      poses[key] = { o: [0, 0, n * p.thickness], u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1] };
    }
    // Side by side for cutting
    const at = host.nest({ parts: parts.map((x) => ({ key: x.key, subs: [x.subs[0]] })), gap: 5 });
    parts.forEach((x, i) => (x.at = { x: at[i][0], y: at[i][1] }));
    const info: [Text, Text][] = [
      ['size', { code: 'sizeValue', values: { w: Math.round(g.W * 10) / 10, h: Math.round(g.H * 10) / 10 } }],
      ['platesInfo', String(N)],
      ['depth', { code: 'mmValue', values: { v: Math.round(N * p.thickness * 10) / 10 } }],
    ];
    if (pl.dropped) info.push(['dropped', String(pl.dropped)]);
    return { parts, info, labels, label: { code: 'label', values: { n: N } }, poses: { poses } };
  },
  view(p) {
    const levels = readLevels(p);
    const img = imageOf(p);
    const N = levels.length;
    const share = new Array(N).fill(0);
    if (img && N) {
      const g = grid(p, img, levels, 200);
      for (const v of g.label) share[v]++;
    }
    const total = share.reduce((a, b) => a + b, 0) || 1;
    return {
      rows: {
        levels: levels.map((_, i) => {
          const n = N - i;
          const name: Text = i === N - 1 ? { code: 'row.back' } : i === 0 ? { code: 'row.front', values: { n } } : { code: 'row.plate', values: { n } };
          return img ? [name, ' · ', `${Math.round((share[i] / total) * 100)} %`] : name;
        }),
      },
    };
  },
  onChange({ key, params: p }) {
    if (key !== 'plates' && key !== 'mode') return null;
    const lv = levelsFor(p, imageOf(p));
    return lv ? { patch: { levels: JSON.stringify(lv) } } : null;
  },
  onEvent({ action, params: p, inputs, row }) {
    if (action === 'pick' || action === 'sel') {
      const im = inputs.image;
      if (!im) return { message: { code: 'noImage' } };
      const img = decode(im.width, im.height, im.data);
      // The kept image arrives as a resource as well; until then the picked pixels serve
      if (p.photo && !images.has(p.photo)) images.set(p.photo, img);
      const lv = analyse(img, p.plates, p.mode);
      return { patch: { levels: JSON.stringify(lv) }, message: { code: 'analysed', values: { n: lv.length } } };
    }
    const levels = readLevels(p);
    if (action === 'swap') {
      levels.reverse();
      return { patch: { levels: JSON.stringify(levels) } };
    }
    if (action === 'reset') {
      const lv = levelsFor(p, imageOf(p));
      return lv ? { patch: { levels: JSON.stringify(lv) } } : null;
    }
    if (action === 'join' && row !== undefined && levels.length > 2) {
      // Into the level below (towards the back); the back plate joins the one above it
      const a = row < levels.length - 1 ? row : row - 1;
      const into = levels[a + 1];
      into.m = [...into.m, ...levels[a].m];
      levels.splice(a, 1);
      return { patch: { levels: JSON.stringify(levels) }, select: { levels: -1 } };
    }
    return null;
  },
  draw({ selected, params: p }) {
    const img = imageOf(p);
    const levels = readLevels(p);
    if (!img || levels.length < 2) return { frame: { x0: 0, y0: 0, x1: 100, y1: 60 }, items: [{ type: 'text', x: 2, y: 30, text: { code: 'noImage' }, style: 'muted' }] };
    const g = grid(p, img, levels, 260);
    const sel = selected.levels ?? -1;
    // The selected level stands out, the others are faded
    const colors = levels.map((lv, i) => {
      if (sel < 0 || i === sel) return lv.c;
      const [r, gg, b] = rgb(lv.c);
      return hex(r + (255 - r) * 0.65, gg + (255 - gg) * 0.65, b + (255 - b) * 0.65);
    });
    const label = Array.from(g.label);
    const key = `map:${p.photo}:${g.gw}x${g.gh}:${colors.join('')}:${p.levels.length}:${hash(p.levels)}`;
    return {
      frame: { x0: 0, y0: 0, x1: g.W, y1: g.H },
      layers: [{ key, alpha: 1, regions: regionMap({ x0: 0, y0: 0, x1: g.W, y1: g.H }, g.gw, g.gh, label, colors) }],
      items: [{ type: 'line', pts: [[0, 0], [g.W, 0], [g.W, g.H], [0, g.H]], closed: true, style: 'muted', width: 1 }],
    };
  },
  onSurface({ event, surface }) {
    if (event.type !== 'down' || !event.hit) return null;
    const r = Number(event.hit.slice(event.hit.lastIndexOf(':') + 1));
    if (!Number.isInteger(r)) return null;
    return { select: { levels: surface.selected.levels === r ? -1 : r } };
  },
});

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
