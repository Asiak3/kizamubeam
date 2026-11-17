// Street map (#280 stage 10): an engravable map of a place from OpenStreetMap data. The place is found with
// Nominatim (the "Find place" button), the map data comes from Overpass; both requests are made by the app for the
// plugin (host.fetch) after the user agreed. Roads, railways and rivers become bands, water, parks and buildings
// areas; everything is joined into one area clipped to the frame (a rectangle or a circle) and engraved on the cut
// plate, or the other way round (invert: the background is engraved, the streets stay). Roads can also be single
// lines for a score layer. Coordinates are mm, y down; the map is a local equirectangular projection around the
// centre, exact enough for a few kilometres.
import { circle, definePlugin, host, rect, type Issue, type NetResponse, type Params, type SubPath } from '../../sdk/ts';

interface P extends Params {
  query: string;
  center: string;
  placeName: string;
  span: number;
  shape: string;
  width: number;
  height: number;
  roads: string;
  roadStyle: string;
  roadWidth: number;
  water: boolean;
  rail: boolean;
  parks: boolean;
  buildings: boolean;
  invert: boolean;
  minArea: number;
}

/** Buildings make the answer large: only for maps up to this width (m) */
const BUILDINGS_MAX = 1500;
/** The data is fetched for a square of one of these sizes (m) around the centre, so small changes reuse it */
const BUCKETS = [300, 600, 1000, 1500, 2000, 3000, 4000];

interface OsmEl {
  type: 'way' | 'relation' | 'node';
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

function centerOf(p: P): [number, number] | null {
  const m = /^\s*(-?[0-9]+(?:\.[0-9]+)?)\s*,\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/.exec(p.center);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

/** Size of the plate in mm */
const size = (p: P): [number, number] => (p.shape === 'circle' ? [p.width, p.width] : [p.width, p.height]);

/** Bounding box of the data to fetch: south, west, north, east */
function bbox(p: P, c: [number, number]): [number, number, number, number] {
  const [w, h] = size(p);
  const need = p.span * Math.max(1, h / w) * 1.05;
  const side = BUCKETS.find((b) => b >= need) ?? BUCKETS[BUCKETS.length - 1];
  const dLat = side / 2 / 110574;
  const dLon = side / 2 / (111320 * Math.cos((c[0] * Math.PI) / 180));
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [r(c[0] - dLat), r(c[1] - dLon), r(c[0] + dLat), r(c[1] + dLon)];
}

const overpass = (b: number[], body: string) => `[out:json][timeout:25][bbox:${b.join(',')}];(${body});out geom qt;`;
const BASE_QUERY =
  'way["highway"];way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"];way["natural"="water"];relation["natural"="water"];' +
  'way["waterway"~"^(river|canal|stream|riverbank)$"];way["landuse"~"^(reservoir|basin|forest|grass|meadow)$"];way["leisure"~"^(park|garden)$"];';
const BUILDING_QUERY = 'way["building"];';

/**
 * Overpass servers in the order they are tried (ids from the manifest): the main instance, then public instances
 * listed on the OSM wiki (private.coffee: worldwide; dresel.systems: Europe). A server that cannot be reached or is
 * busy is skipped; the one that answered is asked first next time.
 */
const OVERPASS = ['overpass', 'overpassCoffee', 'overpassDresel'];
let preferred = 0;
/** Server busy (Overpass answers 429 when its slots are taken, 503/504 when overloaded) */
const busy = (r: NetResponse) => r.status === 429 || (r.status !== undefined && r.status >= 500);

/** Ask the app for Overpass data; throws net-pending until it is there */
function fetchOsm(b: number[], body: string): OsmEl[] {
  const req = { path: '/interpreter', method: 'POST' as const, body: `data=${encodeURIComponent(overpass(b, body))}` };
  let last: NetResponse | null = null;
  for (let k = 0; k < OVERPASS.length; k++) {
    const i = (preferred + k) % OVERPASS.length;
    const r: NetResponse = host.fetch({ host: OVERPASS[i], ...req });
    // Not reachable (connection, name lookup, TLS, time-out) or busy: the next server
    if (r.error === 'net-failed' || (r.error === 'net-status' && busy(r))) {
      last = r;
      continue;
    }
    if (r.error) throw new Error(r.error);
    preferred = i;
    const j = JSON.parse(r.text ?? '{}') as { elements?: OsmEl[] };
    return j.elements ?? [];
  }
  throw new Error(last && last.error === 'net-status' ? 'serverBusy' : 'serverDown');
}

/** Douglas–Peucker on flat [x0, y0, …] */
function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / len;
      if (d > worst) (worst = d), (at = i);
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Signed area of a flat polygon (positive = counter-clockwise in y-down coordinates means clockwise on screen) */
function area(pts: number[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    s += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return s / 2;
}
/** Same orientation for every outer ring, so a nonzero union joins overlapping areas */
const oriented = (pts: number[]) => (area(pts) < 0 ? reverse(pts) : pts);
function reverse(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/** Join open member ways of a multipolygon into closed rings (end to start, either direction) */
function rings(parts: number[][]): number[][] {
  const out: number[][] = [];
  const open = parts.filter((p) => p.length >= 4).map((p) => p.slice());
  const same = (a: number[], i: number, b: number[], j: number) => Math.abs(a[i] - b[j]) < 1e-6 && Math.abs(a[i + 1] - b[j + 1]) < 1e-6;
  while (open.length) {
    let ring = open.shift()!;
    for (let grew = true; grew && !same(ring, 0, ring, ring.length - 2); ) {
      grew = false;
      for (let k = 0; k < open.length; k++) {
        const o = open[k];
        const e = ring.length - 2;
        if (same(ring, e, o, 0)) ring = ring.concat(o.slice(2));
        else if (same(ring, e, o, o.length - 2)) ring = ring.concat(reverse(o).slice(2));
        else continue;
        open.splice(k, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 8 && same(ring, 0, ring, ring.length - 2)) out.push(ring.slice(0, -2));
  }
  return out;
}

/** Clip a polyline to a convex polygon (Cyrus–Beck per segment), joined into runs */
function clipLine(pts: number[], poly: number[]): number[][] {
  const runs: number[][] = [];
  let cur: number[] | null = null;
  const n = poly.length / 2;
  const cx = poly.reduce((s, v, i) => (i % 2 ? s : s + v), 0) / n;
  const cy = poly.reduce((s, v, i) => (i % 2 ? s + v : s), 0) / n;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
    let t0 = 0, t1 = 1;
    for (let k = 0; k < n && t0 <= t1; k++) {
      const ax = poly[k * 2], ay = poly[k * 2 + 1], bx = poly[((k + 1) % n) * 2], by = poly[((k + 1) % n) * 2 + 1];
      // Inward normal of this edge (towards the centre of the polygon)
      let nx = -(by - ay), ny = bx - ax;
      if (nx * (cx - ax) + ny * (cy - ay) < 0) (nx = -nx), (ny = -ny);
      const den = nx * (x1 - x0) + ny * (y1 - y0);
      const num = nx * (x0 - ax) + ny * (y0 - ay);
      if (Math.abs(den) < 1e-15) {
        if (num < 0) t0 = 2;
        continue;
      }
      const t = -num / den;
      if (den > 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (t0 > t1) {
      cur = null;
      continue;
    }
    const sx = x0 + (x1 - x0) * t0, sy = y0 + (y1 - y0) * t0, ex = x0 + (x1 - x0) * t1, ey = y0 + (y1 - y0) * t1;
    if (cur && t0 === 0) cur.push(ex, ey);
    else {
      cur = [sx, sy, ex, ey];
      runs.push(cur);
    }
    if (t1 < 1) cur = null;
  }
  return runs.filter((r) => r.length >= 4 && Math.hypot(r[r.length - 2] - r[0], r[r.length - 1] - r[1]) > 1e-6);
}

/** Road class → share of the road width (0 = not drawn at this setting) */
function roadShare(tags: Record<string, string>, roads: string): number {
  const hw = (tags.highway ?? '').replace(/_link$/, '');
  if (tags.tunnel && tags.tunnel !== 'no') return 0;
  if (tags.area === 'yes') return 0;
  const major = ['motorway', 'trunk', 'primary', 'secondary'].includes(hw);
  const street = ['tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'road'].includes(hw);
  const service = hw === 'service';
  const path = ['footway', 'path', 'cycleway', 'track', 'steps', 'bridleway'].includes(hw);
  if (major) return roads === 'none' ? 0 : 1;
  if (street) return roads === 'streets' || roads === 'all' ? 0.65 : 0;
  if (service) return roads === 'all' ? 0.45 : 0;
  if (path) return roads === 'all' ? 0.3 : 0;
  return 0;
}

const isArea = (t: Record<string, string>, p: P): 'water' | 'parks' | null => {
  if (p.water && (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin')) return 'water';
  if (p.parks && (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'forest' || t.landuse === 'grass' || t.landuse === 'meadow')) return 'parks';
  return null;
};

function framePoly(p: P): number[] {
  const [w, h] = size(p);
  if (p.shape === 'circle') {
    const out: number[] = [];
    for (let i = 0; i < 180; i++) out.push((Math.cos((i / 180) * 2 * Math.PI) * w) / 2, (Math.sin((i / 180) * 2 * Math.PI) * w) / 2);
    return out;
  }
  return [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2];
}

const toSub = (pts: number[], closed: boolean): SubPath => {
  const nodes = [];
  for (let i = 0; i < pts.length; i += 2) nodes.push({ x: Math.round(pts[i] * 1000) / 1000, y: Math.round(pts[i + 1] * 1000) / 1000 });
  return { nodes, closed };
};

function issues(p: P): Issue[] {
  const out: Issue[] = [];
  if (!centerOf(p)) out.push({ key: 'query', level: 'error', code: 'noPlace' });
  if (p.buildings && p.span > BUILDINGS_MAX) out.push({ key: 'buildings', level: 'warn', code: 'buildingsLarge', values: { max: BUILDINGS_MAX } });
  if (p.roadStyle === 'lines' && p.invert) out.push({ key: 'invert', level: 'warn', code: 'invertLines' });
  return out;
}

definePlugin<P>({
  validate: issues,

  onEvent: ({ action, params }) => {
    if (action !== 'find') return null;
    const q = params.query.trim();
    if (!q) return { message: { code: 'enterPlace' } };
    // Coordinates need no search
    if (/^-?[0-9.]+\s*,\s*-?[0-9.]+$/.test(q)) return { patch: { center: q.replace(/\s+/g, ''), placeName: q }, message: { code: 'found', values: { name: q } } };
    const r = host.fetch({ host: 'nominatim', path: '/search', query: { q, format: 'jsonv2', limit: 1 } });
    if (r.error) throw new Error(r.error);
    const hit = (JSON.parse(r.text ?? '[]') as { lat: string; lon: string; display_name: string }[])[0];
    if (!hit) return { message: { code: 'notFound', values: { q } } };
    const name = hit.display_name.split(',').slice(0, 3).join(',').trim();
    return { patch: { center: `${Number(hit.lat).toFixed(6)},${Number(hit.lon).toFixed(6)}`, placeName: name }, message: { code: 'found', values: { name } } };
  },

  generate: (p) => {
    const c = centerOf(p);
    if (!c) throw new Error('noPlace');
    const b = bbox(p, c);
    // Both requests in one round: ask for the buildings too before letting net-pending end the call
    let els: OsmEl[] = [];
    let pending: unknown = null;
    try {
      els = fetchOsm(b, BASE_QUERY);
    } catch (e) {
      if ((e as Error).message !== 'net-pending') throw e;
      pending = e;
    }
    const withBuildings = p.buildings && p.span <= BUILDINGS_MAX;
    if (withBuildings) {
      try {
        els = els.concat(fetchOsm(b, BUILDING_QUERY));
      } catch (e) {
        if ((e as Error).message !== 'net-pending') throw e;
        pending = e;
      }
    }
    if (pending) throw pending;

    const [w, h] = size(p);
    const k = w / p.span;
    const kx = 111320 * Math.cos((c[0] * Math.PI) / 180) * k;
    const ky = 110574 * k;
    const proj = (g: { lat: number; lon: number }[]) => {
      const out: number[] = [];
      for (const q of g) out.push((q.lon - c[1]) * kx, -(q.lat - c[0]) * ky);
      return out;
    };
    const frame = framePoly(p);
    const tol = 0.03;
    const half = p.roadWidth / 2;
    const bands: number[][] = [];
    const areas: number[][] = [];
    const lines: number[][] = [];
    const counts = { roads: 0, buildings: 0, water: 0 };
    const extent = Math.max(w, h) * 0.75;
    // Whether the bounding box of a line or ring overlaps the plate (with a margin): long straight roads have their
    // ends far outside
    const near = (pts: number[]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) (x0 = Math.min(x0, pts[i])), (x1 = Math.max(x1, pts[i])), (y0 = Math.min(y0, pts[i + 1])), (y1 = Math.max(y1, pts[i + 1]));
      return x0 < extent && x1 > -extent && y0 < extent && y1 > -extent;
    };
    const band = (pts: number[], r: number) => {
      if (r <= 0 || pts.length < 4 || !near(pts)) return;
      for (const poly of host.region({ op: 'band', line: simplify(pts, tol), radius: r })) bands.push(poly);
    };
    for (const e of els) {
      const t = e.tags ?? {};
      if (e.type === 'way' && e.geometry && e.geometry.length >= 2) {
        const pts = proj(e.geometry);
        const closed = pts.length >= 8 && Math.abs(pts[0] - pts[pts.length - 2]) < 1e-9 && Math.abs(pts[1] - pts[pts.length - 1]) < 1e-9;
        if (t.highway) {
          const s = roadShare(t, p.roads);
          if (!s) continue;
          counts.roads++;
          if (p.roadStyle === 'lines') {
            if (near(pts)) lines.push(...clipLine(simplify(pts, tol), frame));
          } else band(pts, half * s);
        } else if (t.railway) {
          if (p.rail && !(t.tunnel && t.tunnel !== 'no')) {
            if (p.roadStyle === 'lines') {
              if (near(pts)) lines.push(...clipLine(simplify(pts, tol), frame));
            } else band(pts, half * 0.35);
          }
        } else if (t.building) {
          if (withBuildings && closed && near(pts)) {
            areas.push(oriented(simplify(pts.slice(0, -2), tol)));
            counts.buildings++;
          }
        } else if (t.waterway && t.waterway !== 'riverbank') {
          if (p.water) band(pts, half * (t.waterway === 'river' ? 0.9 : t.waterway === 'canal' ? 0.7 : 0.3));
        } else if (closed && isArea(t, p) && near(pts)) {
          areas.push(oriented(simplify(pts.slice(0, -2), tol)));
          if (isArea(t, p) === 'water') counts.water++;
        }
      } else if (e.type === 'relation' && e.members && isArea(t, p)) {
        const outer = rings(e.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => proj(m.geometry!)));
        const inner = rings(e.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => proj(m.geometry!)));
        if (!outer.some(near)) continue;
        // Holes by the even-odd rule, then oriented like every other area for the union
        for (const poly of host.region({ op: 'loops', loops: [...outer, ...inner].map((r) => simplify(r, tol)) })) areas.push(poly);
        counts.water++;
      }
    }

    const ink = host.region({ op: 'union', a: [...areas, ...bands] });
    const clipped = host.region({ op: 'intersection', a: ink, b: [frame] });
    const result = p.invert && p.roadStyle !== 'lines' ? host.region({ op: 'difference', a: [frame], b: clipped }) : clipped;
    const clean = host.region({ op: 'clean', a: result, minArea: p.minArea });
    const marks: SubPath[] = [...clean.polys.map((q) => toSub(q, true)), ...lines.map((l) => toSub(l, false))];
    const outline = p.shape === 'circle' ? circle(0, 0, w / 2) : rect(w, h);
    // Map scale, rounded to a readable number (1 : 5300)
    const exact = (p.span * 1000) / w;
    const step = exact >= 1000 ? 100 : 10;
    const scale = Math.round(exact / step) * step;
    return {
      parts: [{ key: 'map', subs: [outline], at: { x: 0, y: 0 }, ...(marks.length ? { marks } : {}) }],
      info: [
        ['info.place', p.placeName || p.center],
        ['info.scale', { code: 'scale', values: { n: scale } }],
        ['info.roads', String(counts.roads)],
        ...(withBuildings ? [['info.buildings', String(counts.buildings)] as [string, string]] : []),
      ],
      label: { code: 'label', values: { name: p.placeName.split(',')[0] || p.center } },
    };
  },
});
