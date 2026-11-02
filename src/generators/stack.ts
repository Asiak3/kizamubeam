// Baugruppe „Schichtmodell“: ein eingelesenes 3D-Modell (STL/OBJ) in parallele Scheiben zerlegt, die gestapelt
// und verleimt wieder das Modell ergeben (Etappe 1 des Plans „3D-Modelle in Steckmodelle“: dicht gestapelt).
//
// Das Modell selbst liegt im Modell-Speicher (src/model3d/store.ts); die Teile tragen nur seine Kennung im
// Parameter „model“. Scheibe i (von unten, Schlüssel L1, L2 …) deckt die Höhe [z0 + i·t, z0 + (i+1)·t] ab.
// Welcher Querschnitt sie bildet, wählt „Querschnitt“: Mitte der Schicht, außen (Vereinigung von Unter- und
// Oberkante: nichts fehlt, Stufen stehen über, zum Abschleifen) oder innen (Schnittmenge: nichts steht über).
import type { Pt, SubPath } from '../model';
import { t } from '../i18n';
import { fitPolyline } from '../fit';
import { packParts } from './build';
import type { Generator, GenPart, Issue, Params } from './types';
import { getMesh } from '../model3d/store';
import type { Mesh } from '../model3d/mesh';
import { cleanRegion, deepestPoint, intersectRegions, offsetRegion, prepare, regionArea, sliceAt, sliceRegion, unionRegions, V3 } from '../model3d/slice';

export interface StackParams {
  model: string;
  name: string;
  up: string;
  axis: string;
  size: number;
  thickness: number;
  sample: string;
  numbers: boolean;
  numberSize: number;
  minArea: number;
  kerf: number;
}

const P = (p: Params) => p as unknown as StackParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

/** Achsensysteme je Schichtrichtung: (u, v) = Ebene der Scheibe wie in der Ansicht von dort, w = Stapelrichtung */
export const FRAMES: Record<string, { u: V3; v: V3; w: V3 }> = {
  z: { u: [1, 0, 0], v: [0, -1, 0], w: [0, 0, 1] },
  y: { u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] },
  x: { u: [0, 1, 0], v: [0, 0, -1], w: [1, 0, 0] },
};

export interface StackLayer {
  key: string;
  /** Unterkante der Schicht in Stapelrichtung (mm) */
  z0: number;
  /** Konturen in (u, v), mm, mit Schnittfuge */
  polys: Pt[][];
  islands: number;
}

export interface StackLayout {
  frame: { u: V3; v: V3; w: V3 };
  /** Maße des aufrecht stehenden, skalierten Modells (X, Y, Z) */
  dims: V3;
  layers: StackLayer[];
  /** Anzahl Schichten insgesamt (auch leere) */
  count: number;
  empty: number[];
  /** Offene Stellen im Netz (Querschnitte, die nicht geschlossen werden konnten) */
  open: number;
}

/** Modellkoordinaten aufrecht (Z oben), skaliert auf size (längste Seite), Mitte über dem Ursprung, Boden bei Z = 0 */
export function worldOf(mesh: Mesh, up: string, size: number): { world: (x: number, y: number, z: number) => V3; dims: V3 } {
  const upright = up === 'y' ? (x: number, y: number, z: number): V3 => [x, -z, y] : (x: number, y: number, z: number): V3 => [x, y, z];
  const min: V3 = [Infinity, Infinity, Infinity],
    max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const p = upright(mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = size / ext;
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  return {
    world: (x, y, z) => {
      const p = upright(x, y, z);
      return [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s];
    },
    dims: [(max[0] - min[0]) * s, (max[1] - min[1]) * s, (max[2] - min[2]) * s],
  };
}

const cache = new Map<string, StackLayout | null>();

/** Zerlegung in Schichten (zwischengespeichert); null, wenn das Modell fehlt */
export function stackLayout(raw: Params): StackLayout | null {
  const p = P(raw);
  const key = [p.model, p.up, p.axis, p.size, p.thickness, p.sample, p.minArea, p.kerf].join('|');
  if (cache.has(key)) return cache.get(key)!;
  const mesh = p.model ? getMesh(p.model) : null;
  if (!mesh) return null;
  const { world, dims } = worldOf(mesh, p.up, p.size);
  const frame = FRAMES[p.axis] ?? FRAMES.z;
  const prep = prepare(mesh, world, frame);
  const zmin = prep.min[2],
    zmax = prep.max[2];
  const th = p.thickness;
  const count = Math.max(1, Math.round((zmax - zmin) / th));
  const eps = Math.min(th * 0.02, 0.01);
  let open = 0;
  const at = (h: number) => {
    const s = sliceAt(prep, Math.min(zmax - eps, Math.max(zmin + eps, h)));
    open += s.open;
    return sliceRegion(s);
  };
  const layers: StackLayer[] = [];
  const empty: number[] = [];
  for (let i = 0; i < count; i++) {
    const z0 = zmin + i * th;
    let reg;
    if (p.sample === 'outer') reg = unionRegions(at(z0 + eps), at(z0 + th - eps));
    else if (p.sample === 'inner') reg = intersectRegions(at(z0 + eps), at(z0 + th - eps));
    else reg = at(z0 + th / 2);
    const { polys, islands } = cleanRegion(offsetRegion(reg, p.kerf / 2), p.minArea);
    if (!polys.length) {
      empty.push(i + 1);
      continue;
    }
    layers.push({ key: `L${i + 1}`, z0, polys, islands });
  }
  const out: StackLayout = { frame, dims, layers, count, empty, open };
  if (cache.size > 8) cache.clear();
  cache.set(key, out);
  return out;
}

// ---------- Nummern in Strichschrift ----------

// Ziffern aus Strecken wie bei einer Siebensegmentanzeige, Kästchen 0..1 × 0..1 (y nach unten)
const SEG: Record<string, [number, number, number, number]> = {
  a: [0, 0, 1, 0], b: [1, 0, 1, 0.5], c: [1, 0.5, 1, 1], d: [0, 1, 1, 1], e: [0, 0.5, 0, 1], f: [0, 0, 0, 0.5], g: [0, 0.5, 1, 0.5],
};
const DIGITS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};
/** Breite einer Ziffer und Abstand, bezogen auf die Höhe */
const DW = 0.55,
  GAP = 0.3;

/** Breite einer Zahl bei Höhe 1 */
export const numberWidth = (s: string) => s.length * DW + (s.length - 1) * GAP;

/** Zahl als offene Strecken, Mitte bei c, Höhe h; zusammenhängende Segmente werden zu Linienzügen verbunden */
export function numberStrokes(s: string, c: Pt, h: number): SubPath[] {
  const w = numberWidth(s) * h;
  const out: SubPath[] = [];
  [...s].forEach((ch, i) => {
    const x0 = c.x - w / 2 + i * (DW + GAP) * h,
      y0 = c.y - h / 2;
    const segs = [...(DIGITS[ch] ?? '')].map((k) => SEG[k]);
    // Segmente zu Linienzügen verketten
    const pts = (s: [number, number, number, number]): [Pt, Pt] => [
      { x: x0 + s[0] * DW * h, y: y0 + s[1] * h },
      { x: x0 + s[2] * DW * h, y: y0 + s[3] * h },
    ];
    const left = segs.map(pts);
    const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
    while (left.length) {
      const line = [...left.shift()!];
      for (let grown = true; grown; ) {
        grown = false;
        for (let k = 0; k < left.length; k++) {
          const [a, b] = left[k];
          const end = line[line.length - 1];
          if (same(end, a)) line.push(b);
          else if (same(end, b)) line.push(a);
          else if (same(line[0], b)) line.unshift(a);
          else if (same(line[0], a)) line.unshift(b);
          else continue;
          left.splice(k, 1);
          grown = true;
          break;
        }
      }
      const closed = line.length > 3 && same(line[0], line[line.length - 1]);
      if (closed) line.pop();
      out.push({ closed, nodes: line.map((q) => ({ x: q.x, y: q.y })) });
    }
  });
  return out;
}

/** Nummer möglichst groß (bis maxH) an der Stelle mit dem größten Abstand zum Rand; null, wenn kein Platz ist */
export function placeNumber(polys: Pt[][], label: string, maxH: number): SubPath[] | null {
  const deep = deepestPoint(polys);
  if (!deep) return null;
  const wf = numberWidth(label);
  // Kästchen (wf·h × h) muss mit etwas Abstand in den Kreis mit Radius r passen
  const h = Math.min(maxH, (0.85 * deep.r) / Math.hypot(wf / 2, 0.5));
  if (h < 1.5) return null;
  return numberStrokes(label, deep.p, h);
}

// ---------- Generator ----------

export const STACK: Generator = {
  id: 'stack',
  version: 1,
  kind: 'assembly',
  name: t('Schichtmodell'),
  icon: 'stack',
  schema: [
    { key: 'model', type: 'data', label: t('Modell'), def: '' },
    { key: 'name', type: 'data', label: t('Dateiname'), def: '' },
    {
      key: 'up', type: 'enum', label: t('Oben im Modell'), def: 'z',
      options: [['z', t('Z (meist STL)')], ['y', t('Y (meist OBJ)')]],
      title: t('Welche Achse der Datei nach oben zeigt. Liegt das Modell in der 3D-Ansicht auf der Seite, hier umschalten.'),
    },
    {
      key: 'axis', type: 'enum', label: t('Schichten'), def: 'z',
      options: [['z', t('von unten nach oben')], ['y', t('von vorne nach hinten')], ['x', t('von links nach rechts')]],
      title: t('Richtung, in der die Scheiben gestapelt werden. Vorne nach hinten passt z. B. zu Köpfen und Reliefs.'),
    },
    { key: 'size', type: 'length', label: t('Größe (längste Seite)'), min: 5, max: 3000, def: 150 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 30, def: 3 },
    {
      key: 'sample', type: 'enum', label: t('Querschnitt'), def: 'mid',
      options: [['mid', t('Mitte der Schicht')], ['outer', t('außen (zum Schleifen)')], ['inner', t('innen (nichts steht über)')]],
      title: t('Mitte: Querschnitt in halber Schichthöhe. Außen: nichts vom Modell fehlt, Stufen stehen über und lassen sich abschleifen. Innen: keine Schicht steht über das Modell hinaus.'),
    },
    { key: 'numbers', type: 'bool', label: t('Nummern gravieren'), def: true, title: t('Jede Scheibe bekommt ihre Nummer (von unten gezählt) als feine Gravur auf einem eigenen Layer.') },
    { key: 'numberSize', type: 'length', label: t('Größte Schrifthöhe'), min: 1.5, max: 30, def: 6, advanced: true, showIf: (p) => !!p.numbers },
    { key: 'minArea', type: 'number', label: t('Kleinste Fläche (mm²)'), min: 0, max: 10000, def: 4, advanced: true, title: t('Inseln und Löcher, die kleiner sind, werden weggelassen bzw. gefüllt.') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.1, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (!p.model || !getMesh(p.model)) {
      out.push({ level: 'error', msg: t('Das 3D-Modell fehlt. Bitte über Datei → Importieren … neu einlesen.') });
      return out;
    }
    const L = stackLayout(raw);
    if (!L) return out;
    if (L.count > 600) out.push({ key: 'thickness', level: 'error', msg: t('{n} Schichten sind zu viele: größere Materialdicke oder kleineres Modell wählen.', { n: L.count }) });
    else if (L.count > 150) out.push({ key: 'thickness', level: 'warn', msg: t('{n} Schichten: Das wird viel Arbeit beim Lasern und Verleimen.', { n: L.count }) });
    if (!L.layers.length) out.push({ key: 'size', level: 'error', msg: t('Keine Schicht enthält eine Fläche: Größe oder kleinste Fläche prüfen.') });
    else if (L.empty.length) out.push({ key: 'minArea', level: 'warn', msg: t('Leere Schichten (Lücke im Stapel): {list}', { list: L.empty.slice(0, 12).join(', ') + (L.empty.length > 12 ? ' …' : '') }) });
    if (L.open) out.push({ level: 'warn', msg: t('Das Modell hat Löcher im Netz; an {n} Stellen fehlt ein Stück Kontur. Am besten das Modell vorher reparieren (z. B. in Blender oder PrusaSlicer).', { n: L.open }) });
    const multi = L.layers.filter((l) => l.islands > 1).length;
    if (multi) out.push({ level: 'warn', msg: t('{n} Schichten bestehen aus mehreren Stücken: Die Stücke beim Verleimen nach der Schicht darunter ausrichten.', { n: multi }) });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const L = stackLayout(raw);
    if (!L) return { parts: [], info: [] };
    const items: { key: string; subs: SubPath[]; marks?: SubPath[] }[] = [];
    let area = 0;
    for (const layer of L.layers) {
      const c = center(layer.polys);
      const local = layer.polys.map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y })));
      const subs = local.map((poly) => fitPolyline(poly, true, 0.05));
      area += regionArea(layer.polys);
      const marks = p.numbers ? placeNumber(local, layer.key.slice(1), p.numberSize) : null;
      items.push(marks ? { key: layer.key, subs, marks } : { key: layer.key, subs });
    }
    const placed = packParts(items, 3 + p.kerf);
    const parts: GenPart[] = placed.map((pl, i) => (items[i].marks ? { ...pl, marks: items[i].marks } : pl));
    const [dx, dy, dz] = L.dims;
    return {
      parts,
      info: [
        [t('Modell'), p.name || '–'],
        [t('Maße (B × T × H)'), `${fmt(dx)} × ${fmt(dy)} × ${fmt(dz)} mm`],
        [t('Schichten'), String(L.layers.length)],
        [t('Fläche gesamt'), `${fmt(area / 100, 0)} cm²`],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Schichtmodell {name}', { name: p.name || '' }).trim();
    if (!part) return base;
    return `${base}: ${t('Schicht {n}', { n: part.replace(/\D/g, '') })}`;
  },
};

/** Mitte der Umrandung */
function center(polys: Pt[][]): Pt {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const poly of polys)
    for (const q of poly) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Lage jeder Scheibe im Raum (für die 3D-Ansicht): Mitte der Umrandung wie in generate() */
export function stackPoses(raw: Params): Record<string, { o: V3; u: V3; v: V3; n: V3 }> | null {
  const L = stackLayout(raw);
  if (!L) return null;
  const { u, v, w } = L.frame;
  const out: Record<string, { o: V3; u: V3; v: V3; n: V3 }> = {};
  for (const layer of L.layers) {
    const c = center(layer.polys);
    out[layer.key] = { o: [u[0] * c.x + v[0] * c.y + w[0] * layer.z0, u[1] * c.x + v[1] * c.y + w[1] * layer.z0, u[2] * c.x + v[2] * c.y + w[2] * layer.z0], u, v, n: w };
  }
  return out;
}
