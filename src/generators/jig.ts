// Baugruppe „Jig“: Halteplatte mit passgenauen Aussparungen für Werkstücke, Griffmulden, Fachnummern und
// gravierten Passermarken. Die Werkstückformen (Außenumrisse, mm) stecken im Parameter „shapes“; woher sie kommen
// (Vektorgrafik, nachgezeichnetes Bild, Kamera), regelt der Dialog (jigPanel.ts). Hier nur Geometrie, ohne DOM.
//
// Passung: Die Aussparung soll am Ende je Seite „clearance“ größer sein als das Werkstück. Beim Schneiden nimmt
// der Laser die halbe Fuge auf jeder Seite der Linie weg, also liegt die Schnittlinie um clearance − kerf/2 außerhalb
// des Werkstücks und die Außenkontur der Platte um kerf/2 außerhalb.
import ClipperLib from 'clipper-lib';
import type { Pt, SubPath } from '../model';
import { t, tn } from '../i18n';
import { flattenSub, SCALE } from '../clip';
import { fitPolyline } from '../fit';
import { IDENT } from '../model';
import { markSubs } from '../printcut';
import { numberStrokes } from './stack';
import type { Generator, GenPart, Issue, Params } from './types';

/** Eine Werkstückart: Name, Anzahl, Drehung im Jig (0/90°) und Außenumriss (Mitte im Ursprung) */
export interface JigShape {
  n: string;
  c: number;
  r: number;
  s: SubPath[];
}

export interface JigParams {
  shapes: string;
  plate: string;
  width: number;
  height: number;
  margin: number;
  gap: number;
  clearance: number;
  kerf: number;
  thickness: number;
  notch: string;
  notchSize: number;
  numbers: boolean;
  numberSize: number;
  marks: boolean;
  markSize: number;
  radius: number;
}

const P = (p: Params) => p as unknown as JigParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

// ---------- Formen ----------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Formen lesen; Ungültiges wird übersprungen */
export function decodeShapes(s: string): JigShape[] {
  try {
    const a = JSON.parse(s || '[]');
    if (!Array.isArray(a)) return [];
    return a
      .filter((x) => x && Array.isArray(x.s) && x.s.length)
      .map((x) => ({ n: String(x.n ?? ''), c: Math.max(0, Math.min(500, Math.round(Number(x.c) || 0))), r: Number(x.r) === 90 ? 90 : 0, s: x.s as SubPath[] }));
  } catch {
    return [];
  }
}

/** Formen speichern (Koordinaten auf µm gerundet, damit die Datei klein bleibt) */
export function encodeShapes(list: JigShape[]): string {
  const sub = (sp: SubPath) => ({
    closed: true,
    nodes: sp.nodes.map((q) => {
      const o: Record<string, unknown> = { x: r3(q.x), y: r3(q.y) };
      if (q.cin) o.cin = { x: r3(q.cin.x), y: r3(q.cin.y) };
      if (q.cout) o.cout = { x: r3(q.cout.x), y: r3(q.cout.y) };
      return o;
    }),
  });
  return JSON.stringify(list.map((x) => ({ n: x.n, c: x.c, r: x.r, s: x.s.map(sub) })));
}

const toPath = (pts: Pt[]): ClipperLib.Path => pts.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }));
const fromPath = (p: ClipperLib.Path): Pt[] => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }));

/** Vereinigung (nonzero) und davon nur die Außenkonturen: Löcher im Werkstück spielen für die Aussparung keine Rolle */
function outerOnly(paths: ClipperLib.Paths): ClipperLib.Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return tree.Childs().map((n) => n.Contour()).filter((p) => p.length >= 3);
}

/**
 * Außenumriss aus Linienzügen (z. B. Konturen eines Objekts oder einer Kamera-Erkennung), als Bézierpfade mit der
 * Mitte des Rahmens im Ursprung. tol = Toleranz der Kurveneinpassung (Vektor 0,02 mm, Bild/Kamera gröber).
 */
export function outlineFromPolys(polys: Pt[][], tol = 0.02): SubPath[] {
  const outer = outerOnly(polys.filter((p) => p.length >= 3).map(toPath));
  if (!outer.length) return [];
  const pts = outer.map(fromPath);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) for (const q of p) ((x0 = Math.min(x0, q.x)), (y0 = Math.min(y0, q.y)), (x1 = Math.max(x1, q.x)), (y1 = Math.max(y1, q.y)));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return pts.map((p) => fitPolyline(p.map((q) => ({ x: q.x - cx, y: q.y - cy })), true, tol));
}

/** Umriss aus Bézierpfaden (lokale Koordinaten) */
export const outlineFromSubs = (subs: SubPath[], tol = 0.02) => outlineFromPolys(subs.filter((s) => s.closed).map((s) => fromPath(flattenSub(s, IDENT))), tol);

// ---------- Anordnung ----------

export interface JigSlot {
  /** Fachnummer ab 1 */
  nr: number;
  /** Index der Werkstückart */
  shape: number;
  /** Mitte des Werkstücks in Plattenkoordinaten (mm, Mitte der Platte im Ursprung) */
  c: Pt;
  /** Drehung in Grad */
  rot: number;
}

export interface JigLayout {
  w: number;
  h: number;
  slots: JigSlot[];
  /** Fächer, die nicht mehr auf die feste Platte passen */
  overflow: number;
  holes: SubPath[];
  numbers: SubPath[];
  markCenters: Pt[];
}

/** Aussparung einer Werkstückart (Mitte im Ursprung, schon gedreht) mit Spiel, Fuge und Griffmulden */
function holePolys(sh: JigShape, p: JigParams): ClipperLib.Paths {
  let paths = sh.s.map((sp) => flattenSub(sp, IDENT)).filter((x) => x.length >= 3);
  if (sh.r === 90) paths = paths.map((pa) => pa.map((q) => ({ X: -q.Y, Y: q.X })));
  const d = (p.clearance - p.kerf / 2) * SCALE;
  if (d) {
    const co = new ClipperLib.ClipperOffset(2, 0.005 * SCALE);
    co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const out: ClipperLib.Paths = [];
    co.Execute(out, d);
    paths = out;
  }
  paths = outerOnly(paths);
  if (p.notch !== 'none' && paths.length) {
    // Griffmulde: Kreis am rechtesten (und linkesten) Punkt der Aussparung, halb über den Rand hinaus
    // Mulde dort, wo eine waagerechte Linie durch die halbe Höhe den Rand ganz rechts (bzw. links) schneidet
    const bb = boundsOfPaths(paths);
    const cy = ((bb.y0 + bb.y1) / 2) * SCALE;
    let xr = -Infinity, xl = Infinity;
    for (const pa of paths)
      for (let i = 0, j = pa.length - 1; i < pa.length; j = i++) {
        const a = pa[j], b = pa[i];
        if ((a.Y <= cy) === (b.Y <= cy)) continue;
        const x = a.X + ((cy - a.Y) / (b.Y - a.Y)) * (b.X - a.X);
        xr = Math.max(xr, x);
        xl = Math.min(xl, x);
      }
    const right = { X: xr, Y: cy }, left = { X: xl, Y: cy };
    const r = (p.notchSize / 2) * SCALE;
    const circle = (cx: number, cy: number) => Array.from({ length: 48 }, (_, i) => ({ X: Math.round(cx + r * Math.cos((i / 48) * 2 * Math.PI)), Y: Math.round(cy + r * Math.sin((i / 48) * 2 * Math.PI)) }));
    const extra = [circle(right.X, right.Y)];
    if (p.notch === 'two') extra.push(circle(left.X, left.Y));
    paths = outerOnly([...paths, ...extra]);
  }
  return paths;
}

function boundsOfPaths(ps: ClipperLib.Paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) for (const q of p) ((x0 = Math.min(x0, q.X)), (y0 = Math.min(y0, q.Y)), (x1 = Math.max(x1, q.X)), (y1 = Math.max(y1, q.Y)));
  return { x0: x0 / SCALE, y0: y0 / SCALE, x1: x1 / SCALE, y1: y1 / SCALE };
}

/** Randbreite: bei Marken mindestens so viel, dass sie in die Ecken passen */
export const effectiveMargin = (p: JigParams) => (p.marks ? Math.max(p.margin, p.markSize * 1.4 + 3) : p.margin);

/**
 * Fächer zeilenweise anordnen (Arten nacheinander, Fachnummern in Leserichtung). Feste Platte: Zeilen so breit wie
 * die Platte; sonst etwa quadratisch. Nummern liegen unter jeder Aussparung.
 */
export function jigLayout(p: JigParams, shapes: JigShape[] = decodeShapes(p.shapes)): JigLayout {
  const m = effectiveMargin(p);
  const numH = p.numbers ? p.numberSize + 1.5 : 0;
  const kinds = shapes.map((sh) => {
    const polys = holePolys(sh, p);
    const b = boundsOfPaths(polys);
    return { polys, b, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  });
  const items: { k: number }[] = [];
  shapes.forEach((sh, k) => {
    if (kinds[k].polys.length) for (let i = 0; i < sh.c; i++) items.push({ k });
  });
  const fixed = p.plate === 'size';
  const cellW = (k: number) => kinds[k].w + p.gap;
  const cellH = (k: number) => kinds[k].h + numH + p.gap;
  const area = items.reduce((s, it) => s + cellW(it.k) * cellH(it.k), 0);
  const maxW = Math.max(0, ...items.map((it) => cellW(it.k)));
  const limit = fixed ? p.width - 2 * m + p.gap : Math.max(Math.sqrt(area) * 1.15, maxW);
  const limitH = fixed ? p.height - 2 * m + p.gap : Infinity;
  // Zeilen füllen
  type Placed = { k: number; x: number; y: number };
  const placed: Placed[] = [];
  let x = 0, y = 0, rowH = 0, usedW = 0, overflow = 0;
  for (const it of items) {
    if (x > 0 && x + cellW(it.k) > limit + 1e-6) ((y += rowH), (x = 0), (rowH = 0));
    if (y + cellH(it.k) > limitH + 1e-6 || cellW(it.k) > limit + 1e-6) {
      overflow++;
      continue;
    }
    placed.push({ k: it.k, x, y });
    x += cellW(it.k);
    rowH = Math.max(rowH, cellH(it.k));
    usedW = Math.max(usedW, x);
  }
  const contentW = Math.max(0, usedW - p.gap), contentH = Math.max(0, y + rowH - p.gap);
  const w = fixed ? p.width : contentW + 2 * m;
  const h = fixed ? p.height : contentH + 2 * m;
  // Inhalt in der Platte mittig
  const ox = -w / 2 + m + (fixed ? Math.max(0, (w - 2 * m - contentW) / 2) : 0);
  const oy = -h / 2 + m + (fixed ? Math.max(0, (h - 2 * m - contentH) / 2) : 0);
  const holes: SubPath[] = [];
  const numbers: SubPath[] = [];
  const slots: JigSlot[] = [];
  placed.forEach((pl, i) => {
    const kd = kinds[pl.k];
    // Linke obere Ecke der Aussparung → Verschiebung des Ursprungs (Werkstückmitte)
    const dx = ox + pl.x - kd.b.x0, dy = oy + pl.y - kd.b.y0;
    for (const poly of kd.polys) holes.push(fitPolyline(poly.map((q) => ({ x: q.X / SCALE + dx, y: q.Y / SCALE + dy })), true, 0.02));
    slots.push({ nr: i + 1, shape: pl.k, c: { x: dx, y: dy }, rot: shapes[pl.k].r });
    if (p.numbers) numbers.push(...numberStrokes(String(i + 1), { x: ox + pl.x + kd.w / 2, y: oy + pl.y + kd.h + 1 + p.numberSize / 2 }, p.numberSize));
  });
  // Marken in L-Form: oben links, oben rechts, unten links (wie bei Print and Cut)
  const mc = m / 2;
  const markCenters = p.marks ? [{ x: -w / 2 + mc, y: -h / 2 + mc }, { x: w / 2 - mc, y: -h / 2 + mc }, { x: -w / 2 + mc, y: h / 2 - mc }] : [];
  return { w, h, slots, overflow, holes, numbers, markCenters };
}

/** Rechteck mit runden Ecken (Mitte im Ursprung), um d nach außen versetzt */
function plateOutline(w: number, h: number, r: number, d: number): SubPath {
  const W = w / 2 + d, H = h / 2 + d;
  const R = Math.max(0, Math.min(r + d, W, H));
  if (R < 1e-6)
    return { closed: true, nodes: [{ x: -W, y: -H }, { x: W, y: -H }, { x: W, y: H }, { x: -W, y: H }] };
  const k = R * 0.5522847498;
  return {
    closed: true,
    nodes: [
      { x: -W + R, y: -H, cin: { x: -W + R - k, y: -H } },
      { x: W - R, y: -H, cout: { x: W - R + k, y: -H } },
      { x: W, y: -H + R, cin: { x: W, y: -H + R - k } },
      { x: W, y: H - R, cout: { x: W, y: H - R + k } },
      { x: W - R, y: H, cin: { x: W - R + k, y: H } },
      { x: -W + R, y: H, cout: { x: -W + R - k, y: H } },
      { x: -W, y: H - R, cin: { x: -W, y: H - R + k } },
      { x: -W, y: -H + R, cout: { x: -W, y: -H + R - k } },
    ],
  };
}

const mv = (q: Pt | undefined, c: Pt) => q && { x: q.x + c.x, y: q.y + c.y };
const moveSub = (sp: SubPath, c: Pt): SubPath => ({
  ...sp,
  nodes: sp.nodes.map((q) => {
    const n = { ...q, x: q.x + c.x, y: q.y + c.y };
    if (q.cin) n.cin = mv(q.cin, c);
    if (q.cout) n.cout = mv(q.cout, c);
    return n;
  }),
});

// ---------- Generator ----------

export const JIG: Generator = {
  id: 'jig',
  version: 1,
  kind: 'assembly',
  name: t('Jig'),
  icon: 'jig',
  schema: [
    { key: 'shapes', type: 'data', label: t('Werkstücke'), def: '[]' },
    {
      key: 'plate', type: 'enum', label: t('Platte'), def: 'fit',
      options: [['fit', t('Passend zu den Fächern')], ['size', t('Feste Größe')]],
      title: t('Passend: die Platte wächst mit der Zahl der Fächer. Feste Größe: so viele Fächer wie angegeben, soweit sie passen.'),
    },
    { key: 'width', type: 'length', label: t('Breite'), min: 20, max: 2000, def: 200, showIf: (p) => p.plate === 'size' },
    { key: 'height', type: 'length', label: t('Höhe'), min: 20, max: 2000, def: 150, showIf: (p) => p.plate === 'size' },
    { key: 'gap', type: 'length', label: t('Abstand der Fächer'), min: 1, max: 100, def: 5, title: t('Steg zwischen zwei Aussparungen (ohne Griffmulden)') },
    { key: 'clearance', type: 'length', label: t('Spiel je Seite'), min: 0, max: 3, def: 0.15, title: t('So viel größer als das Werkstück wird die Aussparung auf jeder Seite.') },
    { key: 'notch', type: 'enum', label: t('Griffmulden'), def: 'one', options: [['none', t('Keine')], ['one', t('Eine Seite')], ['two', t('Beide Seiten')]], title: t('Halbrunde Ausschnitte am Rand der Aussparung, um das Werkstück herauszunehmen') },
    { key: 'notchSize', type: 'length', label: t('Muldengröße'), min: 4, max: 40, def: 12, showIf: (p) => p.notch !== 'none' },
    { key: 'numbers', type: 'bool', label: t('Fächer nummerieren'), def: true, title: t('Fachnummer als feine Gravur unter jeder Aussparung; sie passt zur Zeile der Serien-Tabelle.') },
    { key: 'marks', type: 'bool', label: t('Passermarken gravieren'), def: true, title: t('Drei Marken in den Ecken, um den wieder eingelegten Jig mit Print and Cut einzumessen') },
    { key: 'margin', type: 'length', label: t('Rand'), min: 2, max: 100, def: 10, advanced: true },
    { key: 'radius', type: 'length', label: t('Eckenradius'), min: 0, max: 50, def: 3, advanced: true },
    { key: 'kerf', type: 'length', label: t('Schnittfuge'), min: 0, max: 1, def: 0.1, advanced: true, title: t('Breite des Schnitts; wird beim Spiel berücksichtigt') },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.5, max: 50, def: 3, advanced: true, title: t('Dicke der Jig-Platte (für die 3D-Ansicht)') },
    { key: 'numberSize', type: 'length', label: t('Schrifthöhe'), min: 1.5, max: 20, def: 3, advanced: true, showIf: (p) => !!p.numbers },
    { key: 'markSize', type: 'length', label: t('Markengröße'), min: 3, max: 20, def: 6, advanced: true, showIf: (p) => !!p.marks },
  ],
  validate(raw: Params): Issue[] {
    const p = P(raw);
    const shapes = decodeShapes(p.shapes);
    const out: Issue[] = [];
    if (!shapes.length) out.push({ level: 'error', msg: t('Noch kein Werkstück. Unten eine Form aus der Auswahl, einer Datei oder der Kamera hinzufügen.') });
    else if (!shapes.some((s) => s.c > 0)) out.push({ level: 'error', msg: t('Alle Werkstücke haben die Anzahl 0.') });
    if (shapes.length && p.plate === 'size') {
      const n = jigLayout(p, shapes).overflow;
      if (n) out.push({ key: 'width', level: 'warn', msg: tn('{n} Fach passt nicht auf die Platte.', '{n} Fächer passen nicht auf die Platte.', n) });
    }
    return out;
  },
  generate(raw: Params) {
    const p = P(raw);
    const lay = jigLayout(p);
    const subs = [plateOutline(lay.w, lay.h, p.radius, p.kerf / 2), ...lay.holes];
    const marks = [...lay.numbers, ...lay.markCenters.flatMap((c) => markSubs(p.markSize).map((sp) => moveSub(sp, c)))];
    const part: GenPart = { key: 'plate', subs, at: { x: 0, y: 0 }, ...(marks.length ? { marks } : {}) };
    const info: [string, string][] = [
      [t('Platte'), `${fmt(lay.w)} × ${fmt(lay.h)} mm`],
      [t('Fächer'), String(lay.slots.length)],
    ];
    if (lay.overflow) info.push([t('Passen nicht'), String(lay.overflow)]);
    return { parts: [part], info };
  },
  label(raw: Params) {
    const lay = jigLayout(P(raw));
    return tn('Jig {n} Fach', 'Jig {n} Fächer', lay.slots.length);
  },
};
