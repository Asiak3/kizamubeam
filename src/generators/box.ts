// Generator „Box“ (erste Baugruppe): Kasten aus fünf oder sechs Platten mit Fingerzinken an allen Kanten.
//
// Aufbau: Vorder- und Rückwand besitzen die acht Eckwürfel, Seitenwände, Boden und Deckel sind dort ausgespart.
// Jede Kante ist zwischen den Ecken in eine ungerade Zahl gleich breiter Felder geteilt; die beiden Platten
// einer Kante haben genau entgegengesetzte Felder (Muster A: äußere Felder Material, Muster B: ausgespart).
// - Steckspiel macht jedes Materialfeld um das Spiel schmaler (negativ = Presspassung).
// - Die Schnittfuge versetzt danach die ganze Kontur um die halbe Fuge nach außen, wie beim Zahnrad.
// Alle Kanten sind gerade Linien; Lage und Drehung der Teile bleiben beim Neuberechnen erhalten.
import type { Pt, SubPath } from '../model';
import { t } from '../i18n';
import type { Generator, GenPart, Issue, Params } from './types';

export interface BoxParams {
  sizeMode: 'outer' | 'inner';
  width: number;
  depth: number;
  height: number;
  thickness: number;
  top: 'open' | 'closed';
  finger: number;
  clearance: number;
  kerf: number;
}

type Pattern = 'A' | 'B' | 'flat';
interface EdgeSpec {
  pattern: Pattern;
}
interface PanelSpec {
  key: string;
  /** Breite (x) und Höhe (y) der Platte, Außenmaß */
  a: number;
  b: number;
  /** Kanten oben, rechts, unten, links */
  edges: [EdgeSpec, EdgeSpec, EdgeSpec, EdgeSpec];
  /** Besitzt die Platte ihre vier Eckwürfel? */
  corners: boolean;
}

/** Außenmaße der Box */
export function boxOuter(p: BoxParams) {
  const t2 = 2 * p.thickness;
  if (p.sizeMode === 'outer') return { W: p.width, D: p.depth, H: p.height };
  return { W: p.width + t2, D: p.depth + t2, H: p.height + (p.top === 'closed' ? t2 : p.thickness) };
}

/** Zahl der Felder zwischen den Ecken: größte ungerade Zahl, bei der ein Feld mindestens die Zinkenbreite hat */
export function fieldCount(len: number, finger: number): number {
  const n = Math.floor(len / finger);
  return Math.max(1, n % 2 ? n : n - 1);
}

interface Run {
  s0: number;
  s1: number;
  /** Material bis zum Rand (false = um die Materialdicke zurückgesetzt) */
  full: boolean;
  corner: boolean;
}

/** Felder einer Kante der Länge L als Abschnitte (Ecke, Felder, Ecke), gleiche Nachbarn zusammengefasst, mit Spiel */
function edgeRuns(L: number, th: number, e: EdgeSpec, cornerFull: boolean, finger: number, clearance: number): Run[] {
  const n = fieldCount(L - 2 * th, finger);
  // An geraden Kanten liegt nur die Ecke der Nachbarplatte an: kein Steckspiel
  if (e.pattern === 'flat') clearance = 0;
  const w = (L - 2 * th) / n;
  const raw: Run[] = [{ s0: 0, s1: th, full: cornerFull, corner: true }];
  for (let i = 0; i < n; i++) {
    const full = e.pattern === 'flat' ? true : e.pattern === 'A' ? i % 2 === 0 : i % 2 === 1;
    raw.push({ s0: th + i * w, s1: th + (i + 1) * w, full, corner: false });
  }
  raw.push({ s0: L - th, s1: L, full: cornerFull, corner: true });
  const runs: Run[] = [];
  for (const r of raw) {
    const last = runs[runs.length - 1];
    if (last && last.full === r.full) {
      last.s1 = r.s1;
      last.corner ||= r.corner;
    } else runs.push({ ...r });
  }
  // Übergänge um das halbe Spiel in das Materialfeld verschieben
  for (let i = 0; i + 1 < runs.length; i++) {
    const d = runs[i].full ? -clearance / 2 : clearance / 2;
    runs[i].s1 += d;
    runs[i + 1].s0 += d;
  }
  return runs;
}

/**
 * Umriss einer Platte (lokal 0..a × 0..b, y nach unten) ohne Schnittfuge: Rechteck minus die Bereiche, in denen die
 * Nachbarplatten liegen (jeder ausgesparte Abschnitt einer Kante = Rechteck mit der Materialdicke als Tiefe).
 * Gerechnet wird auf dem Raster aller Abschnittsgrenzen, der Rand der Materialzellen ergibt den Umriss.
 */
function panelOutline(P: PanelSpec, th: number, finger: number, clearance: number): Pt[] {
  const { a, b } = P;
  const C: Pt[] = [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: b }, { x: 0, y: b }];
  const U: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  // Richtung nach innen = Laufrichtung der nächsten Kante
  const N = [U[1], U[2], U[3], U[0]];
  const lens = [a, b, a, b];
  const at = (i: number, s: number, d: number): Pt => ({ x: C[i].x + U[i].x * s + N[i].x * d, y: C[i].y + U[i].y * s + N[i].y * d });
  const cuts: { x0: number; x1: number; y0: number; y1: number }[] = [];
  P.edges.forEach((e, i) => {
    const runs = edgeRuns(lens[i], th, e, P.corners, finger, clearance);
    // Negatives Steckspiel (Presspassung): Die Eckabschnitte beider Kanten werden kürzer und ließen ein
    // |Spiel|/2-Quadrat stehen, das unter der Nachbarwand liegt (Stufe/Überlappung). Die ausgesparte Ecke wird deshalb
    // als volles Quadrat weggeschnitten. Nur Muster A: Es beginnt mit einer Zinke, die Ecke ist ein eigener Abschnitt;
    // bei B ist sie mit dem ersten Feld verschmolzen. Bei positivem Spiel bleibt die Stufe bewusst erhalten: Sie ist
    // Bodenmaterial im Innenwinkel, das keine Wand abdeckt.
    if (clearance < 0 && !P.corners && e.pattern === 'A') {
      for (const s0 of [0, lens[i] - th]) {
        const p = at(i, s0, 0), q = at(i, s0 + th, th);
        cuts.push({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
      }
    }
    for (const r of runs) {
      if (r.full) continue;
      const p = at(i, r.s0, 0),
        q = at(i, r.s1, th);
      cuts.push({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
    }
  });
  const coords = (vals: number[]) => {
    const out: number[] = [];
    for (const v of vals.sort((u, w) => u - w)) if (!out.length || v - out[out.length - 1] > 1e-9) out.push(v);
    return out;
  };
  const xs = coords([0, a, ...cuts.flatMap((c) => [c.x0, c.x1])].map((v) => Math.min(a, Math.max(0, v))));
  const ys = coords([0, b, ...cuts.flatMap((c) => [c.y0, c.y1])].map((v) => Math.min(b, Math.max(0, v))));
  const nx = xs.length - 1,
    ny = ys.length - 1;
  const solid = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i] + xs[i + 1]) / 2,
      cy = (ys[j] + ys[j + 1]) / 2;
    return !cuts.some((c) => cx > c.x0 && cx < c.x1 && cy > c.y0 && cy < c.y1);
  };
  // Randkanten der Materialzellen im Uhrzeigersinn (y nach unten), Material jeweils rechts der Laufrichtung
  const next = new Map<string, [number, number][]>();
  const key = (i: number, j: number) => `${i},${j}`;
  const add = (i0: number, j0: number, i1: number, j1: number) => {
    const k = key(i0, j0);
    if (!next.has(k)) next.set(k, []);
    next.get(k)!.push([i1, j1]);
  };
  let count = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!solid(i, j)) continue;
      if (!solid(i, j - 1)) (add(i, j, i + 1, j), count++);
      if (!solid(i + 1, j)) (add(i + 1, j, i + 1, j + 1), count++);
      if (!solid(i, j + 1)) (add(i + 1, j + 1, i, j + 1), count++);
      if (!solid(i - 1, j)) (add(i, j + 1, i, j), count++);
    }
  // Ab der Ecke (0,0)-nächsten Randkante einmal herumlaufen; an Kreuzungen rechts abbiegen
  const startKey = [...next.keys()].sort((u, w) => {
    const [ui, uj] = u.split(',').map(Number),
      [wi, wj] = w.split(',').map(Number);
    return uj - wj || ui - wi;
  })[0];
  const pts: Pt[] = [];
  let [ci, cj] = startKey.split(',').map(Number);
  let dir: [number, number] = [0, -1];
  for (let guard = 0; guard <= count; guard++) {
    const outs = next.get(key(ci, cj));
    if (!outs?.length) break;
    // Kandidaten nach Abbiegung ordnen: rechts, geradeaus, links (y nach unten: rechts von (dx,dy) ist (-dy,dx))
    const turn = (o: [number, number]) => {
      const dx = o[0] - ci,
        dy = o[1] - cj;
      if (dx === -dir[1] && dy === dir[0]) return 0;
      if (dx === dir[0] && dy === dir[1]) return 1;
      return 2;
    };
    outs.sort((u, w) => turn(u) - turn(w));
    const o = outs.shift()!;
    pts.push({ x: xs[ci], y: ys[cj] });
    dir = [o[0] - ci, o[1] - cj];
    [ci, cj] = o;
    if (key(ci, cj) === startKey && !next.get(startKey)!.length) break;
  }
  return cleanup(pts);
}

/** Doppelte und auf einer Geraden liegende Punkte entfernen */
export function cleanup(input: Pt[]): Pt[] {
  let pts = input.filter((p, i) => {
    const q = input[(i + input.length - 1) % input.length];
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length],
        b = pts[i],
        c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9 || Math.hypot(b.x - c.x, b.y - c.y) < 1e-9) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Rechtwinkligen Umriss um d nach außen versetzen (exakt, Ecken bleiben scharf) */
export function offsetOrtho(pts: Pt[], d: number): Pt[] {
  if (!d) return pts;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  const sgn = area > 0 ? 1 : -1;
  // Außennormale einer Kante p→q
  const out = (p: Pt, q: Pt): Pt => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (sgn * (q.y - p.y)) / l, y: (-sgn * (q.x - p.x)) / l };
  };
  return pts.map((v, i) => {
    const a = pts[(i + pts.length - 1) % pts.length],
      c = pts[(i + 1) % pts.length];
    const n1 = out(a, v),
      n2 = out(v, c);
    return { x: v.x + (n1.x + n2.x) * d, y: v.y + (n1.y + n2.y) * d };
  });
}

const P = (p: Params) => p as unknown as BoxParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Platten der Box mit Kantenmustern */
export function boxPanels(p: BoxParams): PanelSpec[] {
  const { W, D, H } = boxOuter(p);
  const top: Pattern = p.top === 'closed' ? 'B' : 'flat';
  const E = (x: Pattern): EdgeSpec => ({ pattern: x });
  const wall = (key: string, a: number, side: Pattern, corners: boolean): PanelSpec => ({
    key, a, b: H, corners, edges: [E(top), E(side), E('B'), E(side)],
  });
  const plate = (key: string): PanelSpec => ({ key, a: W, b: D, corners: false, edges: [E('A'), E('A'), E('A'), E('A')] });
  const out = [plate('bottom'), wall('front', W, 'A', true), wall('back', W, 'A', true), wall('left', D, 'B', false), wall('right', D, 'B', false)];
  if (p.top === 'closed') out.splice(1, 0, plate('top'));
  return out;
}

/** Umrisse aller Platten (Mitte im Ursprung, y nach unten, mit Schnittfuge) */
export function panelPolys(p: BoxParams): { key: string; a: number; b: number; pts: Pt[] }[] {
  return boxPanels(p).map((panel) => ({
    key: panel.key,
    a: panel.a,
    b: panel.b,
    pts: offsetOrtho(panelOutline(panel, p.thickness, p.finger, p.clearance), p.kerf / 2).map((q) => ({ x: q.x - panel.a / 2, y: q.y - panel.b / 2 })),
  }));
}

const PART_NAMES: Record<string, () => string> = {
  bottom: () => t('Boden'),
  top: () => t('Deckel'),
  front: () => t('Vorderwand'),
  back: () => t('Rückwand'),
  left: () => t('Seitenwand links'),
  right: () => t('Seitenwand rechts'),
};

export const BOX: Generator = {
  id: 'box',
  version: 1,
  kind: 'assembly',
  name: t('Box'),
  icon: 'box',
  schema: [
    { key: 'sizeMode', type: 'enum', label: t('Maße'), def: 'outer', options: [['outer', t('Außenmaß')], ['inner', t('Innenmaß')]] },
    { key: 'width', type: 'length', label: t('Breite'), min: 5, max: 3000, def: 100 },
    { key: 'depth', type: 'length', label: t('Tiefe'), min: 5, max: 3000, def: 80 },
    { key: 'height', type: 'length', label: t('Höhe'), min: 5, max: 3000, def: 50 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 50, def: 3 },
    { key: 'top', type: 'enum', label: t('Oben'), def: 'open', options: [['open', t('Offen')], ['closed', t('Geschlossen (Deckel mit Zinken)')]] },
    { key: 'finger', type: 'length', label: t('Zinkenbreite'), min: 0.5, max: 500, def: 10, title: t('Mindestbreite der Zinken; jede Kante bekommt eine ungerade Zahl gleich breiter Zinken') },
    { key: 'clearance', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0, title: t('Jede Zinke wird um so viel schmaler; negativ = Presspassung') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.15, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, damit die Teile die Sollmaße haben. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    const { W, D, H } = boxOuter(p);
    const th = p.thickness;
    const minSide = Math.min(W, D, H);
    if (minSide <= 4 * th) out.push({ key: 'thickness', level: 'error', msg: t('Die Platten sind zu dick für diese Maße (jede Seite braucht mehr als die vierfache Materialdicke).') });
    if (p.finger < th) out.push({ key: 'finger', level: 'warn', msg: t('Zinken schmaler als die Materialdicke brechen leicht.') });
    if (Math.abs(p.clearance) >= p.finger / 4) out.push({ key: 'clearance', level: 'error', msg: t('Das Steckspiel ist zu groß für diese Zinkenbreite.') });
    if (minSide - 2 * th < p.finger) out.push({ key: 'finger', level: 'warn', msg: t('Die Zinken sind breiter als die kürzeste Kante: Dort gibt es nur eine Zinke.') });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const th = p.thickness;
    const panels = boxPanels(p);
    // Anordnung: obere Reihe Boden, Vorder- und Rückwand; untere Reihe Deckel, Seitenwände
    const gap = 5 + p.kerf;
    const rows = [panels.filter((x) => ['bottom', 'front', 'back'].includes(x.key)), panels.filter((x) => ['top', 'left', 'right'].includes(x.key))];
    const rowW = rows.map((r) => r.reduce((s, x) => s + x.a, 0) + gap * (r.length - 1));
    const rowH = rows.map((r) => Math.max(0, ...r.map((x) => x.b)));
    const totalH = rowH[0] + gap + rowH[1];
    const parts: GenPart[] = [];
    rows.forEach((r, ri) => {
      let x = -rowW[ri] / 2;
      const y0 = -totalH / 2 + (ri ? rowH[0] + gap : 0);
      for (const panel of r) {
        const local = offsetOrtho(panelOutline(panel, th, p.finger, p.clearance), p.kerf / 2);
        const sub: SubPath = { closed: true, nodes: local.map((q) => ({ x: q.x - panel.a / 2, y: q.y - panel.b / 2 })) };
        parts.push({ key: panel.key, subs: [sub], at: { x: x + panel.a / 2, y: y0 + panel.b / 2 } });
        x += panel.a + gap;
      }
    });
    const { W, D, H } = boxOuter(p);
    const inner = { W: W - 2 * th, D: D - 2 * th, H: H - (p.top === 'closed' ? 2 : 1) * th };
    return {
      parts,
      info: [
        [t('Außenmaß'), `${fmt(W)} × ${fmt(D)} × ${fmt(H)} mm`],
        [t('Innenmaß'), `${fmt(inner.W)} × ${fmt(inner.D)} × ${fmt(inner.H)} mm`],
        [t('Felder je Kante (B / T / H)'), `${fieldCount(W - 2 * th, p.finger)} / ${fieldCount(D - 2 * th, p.finger)} / ${fieldCount(H - 2 * th, p.finger)}`],
        [t('Teile'), String(parts.length)],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const { W, D, H } = boxOuter(p);
    const box = t('Box {w}×{d}×{h}', { w: fmt(W), d: fmt(D), h: fmt(H) });
    const name = part && PART_NAMES[part];
    return name ? `${box}: ${name()}` : box;
  },
};
