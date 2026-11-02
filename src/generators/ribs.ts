// Baugruppe „Rippenmodell“: ein eingelesenes 3D-Modell (STL/OBJ) als Rippen (Spanten) quer zu einer Achse, die
// mit Halbschlitzen auf einem Rückgrat stecken (Plan steckmodelle/plan-rippenmodell.md, Etappe R1: ein Abschnitt
// mit gerader Achse).
//
// Achsen: A = Achse (die Rippen stehen quer dazu), D = Richtung, in der das Rückgrat steht, N = A × D.
// Rippe i liegt bei A = a_i (Mitte, Dicke t), das Rückgrat bei N = s. Beide schneiden sich in einer Strecke
// parallel zu D. Wo beide Material haben, wird die gemeinsame Strecke halbiert: Die Rippe bekommt einen Schlitz
// von ihrem unteren Rand (−D) bis zur Mitte, das Rückgrat von seinem oberen Rand (+D) bis zur Mitte. Die Rippen
// werden also von oben auf das Rückgrat gesetzt. Stücke einer Rippe, die nicht am Rückgrat stecken, fallen weg.
//
// Teile in der Ebene: Rippe (x, y) = (N, −D), Rückgrat (x, y) = (A, −D). y zeigt also nach unten wie auf der
// Arbeitsfläche; „unten“ im Modell ist größeres y.
import type { Pt, SubPath } from '../model';
import { t } from '../i18n';
import { fitPolyline } from '../fit';
import { packParts } from './build';
import type { Generator, GenPart, Issue, Params } from './types';
import { getMesh } from '../model3d/store';
import {
  cleanRegion, inside, intervalsAtX, offsetRegion, prepare, rectRegion, regionArea, regionIslands, sliceAt, sliceRegion, subtractRegions, unionRegions, V3,
} from '../model3d/slice';
import { numberStrokes, numberWidth, placeNumber, worldOf } from './stack';

export interface RibsParams {
  model: string;
  name: string;
  up: string;
  axis: string;
  spineDir: string;
  size: number;
  thickness: number;
  spacing: number;
  spineInset: number;
  spineOffset: number;
  play: number;
  numbers: boolean;
  numberSize: number;
  minArea: number;
  kerf: number;
}

const P = (p: Params) => p as unknown as RibsParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

const UNIT: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lin = (u: V3, x: number, v: V3, y: number, w: V3, z: number): V3 => [
  u[0] * x + v[0] * y + w[0] * z,
  u[1] * x + v[1] * y + w[1] * z,
  u[2] * x + v[2] * y + w[2] * z,
];

/** Richtung des Rückgrats; fällt sie mit der Achse zusammen, nimmt es „oben“ (bei senkrechter Achse „vorne“) */
export const spineDirOf = (axis: string, dir: string) => (dir !== axis ? dir : axis === 'z' ? 'y' : 'z');

export interface RibPart {
  key: string;
  /** Inseln (Außenkontur + Löcher) in Teilkoordinaten, mm, mit Schnittfuge */
  polys: Pt[][];
  /** Lage im Raum: o + x·u + y·v + s·n (s = 0 … Dicke) */
  pose: { o: V3; u: V3; v: V3; n: V3 };
  /** Zusätzliche Gravuren (Schlitzmarken am Rückgrat) in denselben Koordinaten */
  extra?: SubPath[];
}

export interface RibsLayout {
  dims: V3;
  ribs: RibPart[];
  spine: RibPart[];
  /** Rippen ohne Kreuzung mit dem Rückgrat (weggelassen) */
  lostRibs: number;
  /** Stücke von Rippen ohne Halt (weggelassen) */
  lostPieces: number;
  /** Rippen insgesamt (vor dem Weglassen) */
  count: number;
  open: number;
}

const cache = new Map<string, RibsLayout | null>();

/** Zerlegung in Rippen und Rückgrat (zwischengespeichert); null, wenn das Modell fehlt */
export function ribsLayout(raw: Params): RibsLayout | null {
  const p = P(raw);
  const key = [p.model, p.up, p.axis, p.spineDir, p.size, p.thickness, p.spacing, p.spineInset, p.spineOffset, p.play, p.minArea, p.kerf, p.numbers, p.numberSize].join('|');
  if (cache.has(key)) return cache.get(key)!;
  const mesh = p.model ? getMesh(p.model) : null;
  if (!mesh) return null;
  const out = compute(p, mesh);
  if (cache.size > 8) cache.clear();
  cache.set(key, out);
  return out;
}

function compute(p: RibsParams, mesh: NonNullable<ReturnType<typeof getMesh>>): RibsLayout {
  const { world, dims } = worldOf(mesh, p.up, p.size);
  const A = UNIT[p.axis] ?? UNIT.x;
  const D = UNIT[spineDirOf(p.axis, p.spineDir)] ?? UNIT.z;
  const N = cross(A, D);
  const ribFrame = { u: N, v: neg(D), w: A };
  const spineFrame = { u: A, v: neg(D), w: N };
  const prepR = prepare(mesh, world, ribFrame);
  const prepS = prepare(mesh, world, spineFrame);
  const th = p.thickness;
  const w = th + p.play;
  const eps = 0.01;
  let open = 0;

  // Rückgrat: Schnitt in der Mitte (± Versatz), nach innen versetzt
  const s = Math.min(prepS.max[2] - eps, Math.max(prepS.min[2] + eps, (prepS.min[2] + prepS.max[2]) / 2 + p.spineOffset));
  const sl = sliceAt(prepS, s);
  open += sl.open;
  const spineReg = offsetRegion(sliceRegion(sl), -p.spineInset);
  const spinePolys = cleanRegion(spineReg, p.minArea).polys;

  // Lage der Rippen: gleichmäßig, mittig über der Länge
  const a0 = prepR.min[2],
    a1 = prepR.max[2];
  const len = a1 - a0;
  const n = Math.max(1, Math.floor((len - th) / p.spacing) + 1);
  const start = a0 + (len - (n - 1) * p.spacing) / 2;

  const ribs: RibPart[] = [];
  const spineCuts: ReturnType<typeof rectRegion> = [];
  const spineHolds: Pt[] = [];
  const spineMarks: { a: number; y: number; y1: number; nr: number }[] = [];
  let lostRibs = 0,
    lostPieces = 0;
  const hold = Math.min(0.5, th / 2);
  for (let i = 0; i < n; i++) {
    const a = Math.min(a1 - eps, Math.max(a0 + eps, start + i * p.spacing));
    const rs = sliceAt(prepR, a);
    open += rs.open;
    const ribReg = sliceRegion(rs);
    const ribPolys = cleanRegion(ribReg, p.minArea).polys;
    const ri = intervalsAtX(ribPolys, s);
    const si = intervalsAtX(spinePolys, a);
    const cuts: ReturnType<typeof rectRegion> = [];
    const holds: Pt[] = [];
    // Gegenstücke im Rückgrat erst übernehmen, wenn die Rippe bleibt
    const sCuts: ReturnType<typeof rectRegion> = [];
    const sHolds: Pt[] = [];
    const sMarks: { a: number; y: number; y1: number }[] = [];
    for (const [r0, r1] of ri)
      for (const [q0, q1] of si) {
        const c0 = Math.max(r0, q0),
          c1 = Math.min(r1, q1);
        if (c1 - c0 < 2 * th) continue;
        const m = (c0 + c1) / 2;
        // Rippe: von ihrem unteren Rand (größeres y) bis zur Mitte; etwas über den Rand hinaus, aber nicht in die
        // nächste Insel darunter
        const nextR = ri.find((iv) => iv[0] > r1)?.[0] ?? Infinity;
        const rEnd = Math.min(reach(ribPolys, s, w, m, r1, 1) + 0.5, (r1 + nextR) / 2);
        cuts.push(...rectRegion(s - w / 2, m, s + w / 2, rEnd));
        holds.push({ x: s, y: m - hold });
        const prevS = [...si].reverse().find((iv) => iv[1] < q0)?.[1] ?? -Infinity;
        const sEnd = Math.max(reach(spinePolys, a, w, m, q0, -1) - 0.5, (q0 + prevS) / 2);
        sCuts.push(...rectRegion(a - w / 2, sEnd, a + w / 2, m));
        sHolds.push({ x: a, y: m + hold });
        sMarks.push({ a, y: m, y1: q1 });
      }
    if (!holds.length) {
      lostRibs++;
      continue;
    }
    const islands = regionIslands(offsetRegion(subtractRegions(ribReg, cuts), p.kerf / 2), p.minArea);
    const kept = islands.filter((isl) => holds.some((q) => inside(isl, q)));
    lostPieces += islands.length - kept.length;
    if (!kept.length) {
      lostRibs++;
      continue;
    }
    spineCuts.push(...sCuts);
    spineHolds.push(...sHolds);
    spineMarks.push(...sMarks.map((mk) => ({ ...mk, nr: ribs.length + 1 })));
    const polys = kept.flat();
    const c = center(polys);
    ribs.push({
      key: `R${ribs.length + 1}`,
      polys: polys.map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y }))),
      pose: { o: lin(N, c.x, neg(D), c.y, A, a - th / 2), u: N, v: neg(D), n: A },
    });
  }

  // Rückgrat mit Schlitzen; nur Stücke, in denen Rippen stecken
  const spine: RibPart[] = [];
  if (ribs.length) {
    const islands = regionIslands(offsetRegion(subtractRegions(spineReg, unionRegions(spineCuts, [])), p.kerf / 2), p.minArea);
    const kept = islands.filter((isl) => spineHolds.some((q) => inside(isl, q)));
    kept.forEach((isl, k) => {
      const c = center(isl);
      const local = isl.map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y })));
      // Schlitzmarke: Nummer der Rippe unter dem Schlitzende, wenn sie dort ins Material passt
      const extra: SubPath[] = [];
      if (p.numbers) {
        for (const mk of spineMarks) {
          if (!inside(isl, { x: mk.a, y: mk.y + hold })) continue;
          const label = String(mk.nr);
          const h = Math.min(p.numberSize, 4, (p.spacing - 1) / numberWidth(label), (mk.y1 - mk.y - 2) / 1.2);
          if (h < 1.5) continue;
          const cy = mk.y + 1 + h / 2;
          const hw = (numberWidth(label) * h) / 2;
          const corners = [{ x: mk.a - hw, y: cy - h / 2 }, { x: mk.a + hw, y: cy - h / 2 }, { x: mk.a - hw, y: cy + h / 2 }, { x: mk.a + hw, y: cy + h / 2 }];
          if (!corners.every((q) => inside(isl, q))) continue;
          extra.push(...numberStrokes(label, { x: mk.a - c.x, y: cy - c.y }, h));
        }
      }
      spine.push({
        key: kept.length > 1 ? `S${k + 1}` : 'S',
        polys: local,
        pose: { o: lin(A, c.x, neg(D), c.y, N, s - th / 2), u: A, v: neg(D), n: N },
        extra: extra.length ? extra : undefined,
      });
    });
  }
  return { dims, ribs, spine, lostRibs, lostPieces, count: n, open };
}

/**
 * Wie weit reicht das Material, das ein Schlitz der Breite w bei x von m bis zum Rand (end) durchschneidet?
 * Am Rand eines schrägen Umrisses liegt die Kante neben der Mittellinie weiter außen; sonst bliebe dort ein
 * Steg quer über dem Schlitzeingang. dir: +1 = zu größerem y, −1 = zu kleinerem.
 */
function reach(polys: Pt[][], x: number, w: number, m: number, end: number, dir: 1 | -1): number {
  let r = end;
  const lo = Math.min(m, end),
    hi = Math.max(m, end);
  for (const xx of [x - w / 2 + 1e-3, x - w / 4, x, x + w / 4, x + w / 2 - 1e-3])
    for (const [y0, y1] of intervalsAtX(polys, xx)) {
      if (y1 < lo || y0 > hi) continue;
      r = dir > 0 ? Math.max(r, y1) : Math.min(r, y0);
    }
  return r;
}

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

// ---------- Generator ----------

export const RIBS: Generator = {
  id: 'ribs',
  version: 1,
  kind: 'assembly',
  name: t('Rippenmodell'),
  icon: 'ribs',
  schema: [
    { key: 'model', type: 'data', label: t('Modell'), def: '' },
    { key: 'name', type: 'data', label: t('Dateiname'), def: '' },
    {
      key: 'up', type: 'enum', label: t('Oben im Modell'), def: 'z',
      options: [['z', t('Z (meist STL)')], ['y', t('Y (meist OBJ)')]],
      title: t('Welche Achse der Datei nach oben zeigt. Liegt das Modell in der 3D-Ansicht auf der Seite, hier umschalten.'),
    },
    {
      key: 'axis', type: 'enum', label: t('Achse'), def: 'x',
      options: [['x', t('von links nach rechts')], ['y', t('von vorne nach hinten')], ['z', t('von unten nach oben')]],
      title: t('Die Rippen stehen quer zu dieser Richtung. Bei Tieren, Fischen und Autos meist die Länge.'),
    },
    {
      key: 'spineDir', type: 'enum', label: t('Rückgrat steht'), def: 'z',
      options: [['z', t('senkrecht (nach oben)')], ['y', t('nach vorne')], ['x', t('zur Seite')]],
      title: t('Ebene des Rückgrats: Es enthält die Achse und diese Richtung. Die Rippen werden in dieser Richtung aufgesteckt.'),
    },
    { key: 'size', type: 'length', label: t('Größe (längste Seite)'), min: 10, max: 3000, def: 200 },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.3, max: 30, def: 3 },
    { key: 'spacing', type: 'length', label: t('Rippenabstand (Mitte zu Mitte)'), min: 1, max: 500, def: 10 },
    {
      key: 'spineInset', type: 'length', label: t('Rückgrat nach innen versetzt'), min: 0, max: 100, def: 2,
      title: t('Das Rückgrat wird um so viel kleiner als der Umriss, damit es zwischen den Rippen nicht heraussteht. 0 = voller Umriss.'),
    },
    { key: 'spineOffset', type: 'length', label: t('Rückgrat verschieben'), min: -1000, max: 1000, def: 0, advanced: true, title: t('Lage des Rückgrats aus der Mitte heraus, quer zu seiner Ebene.') },
    { key: 'play', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0.1, title: t('Die Schlitze werden um so viel breiter als die Materialdicke; negativ = Presspassung') },
    { key: 'numbers', type: 'bool', label: t('Nummern gravieren'), def: true, title: t('Jede Rippe bekommt ihre Nummer, das Rückgrat neben jedem Schlitz die Nummer der passenden Rippe.') },
    { key: 'numberSize', type: 'length', label: t('Größte Schrifthöhe'), min: 1.5, max: 30, def: 6, advanced: true, showIf: (p) => !!p.numbers },
    { key: 'minArea', type: 'number', label: t('Kleinste Fläche (mm²)'), min: 0, max: 10000, def: 4, advanced: true, title: t('Inseln und Löcher, die kleiner sind, werden weggelassen bzw. gefüllt.') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.1, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, Schlitze werden schmaler. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (!p.model || !getMesh(p.model)) {
      out.push({ level: 'error', msg: t('Das 3D-Modell fehlt. Bitte über Datei → Importieren … neu einlesen.') });
      return out;
    }
    if (p.spacing < p.thickness + 0.5) {
      out.push({ key: 'spacing', level: 'error', msg: t('Der Rippenabstand muss mindestens 0,5 mm größer als die Materialdicke sein.') });
      return out;
    }
    if (p.thickness + p.play <= p.kerf) out.push({ key: 'kerf', level: 'error', msg: t('Die Schnittfuge ist breiter als die Schlitze.') });
    const L = ribsLayout(raw);
    if (!L) return out;
    if (L.count > 400) out.push({ key: 'spacing', level: 'error', msg: t('{n} Rippen sind zu viele: größeren Abstand oder kleineres Modell wählen.', { n: L.count }) });
    else if (L.count > 120) out.push({ key: 'spacing', level: 'warn', msg: t('{n} Rippen: Das wird viel Arbeit beim Lasern und Stecken.', { n: L.count }) });
    if (!L.ribs.length) {
      out.push({ key: 'spineDir', level: 'error', msg: t('Keine Rippe kreuzt das Rückgrat: Richtung des Rückgrats oder Versatz ändern.') });
      return out;
    }
    if (L.lostRibs) out.push({ key: 'spacing', level: 'warn', msg: t('{n} Rippen haben keinen Halt am Rückgrat (zu klein oder neben dem Rückgrat) und fallen weg.', { n: L.lostRibs }) });
    if (L.lostPieces) out.push({ key: 'spineOffset', level: 'warn', msg: t('{n} Stücke von Rippen erreichen das Rückgrat nicht und fallen weg (z. B. Beine neben dem Rumpf). Mehrere Abschnitte kommen in einer späteren Version.', { n: L.lostPieces }) });
    if (L.spine.length > 1) out.push({ key: 'spineInset', level: 'warn', msg: t('Das Rückgrat besteht aus {n} Stücken; jedes hält nur seine Rippen.', { n: L.spine.length }) });
    if (L.open) out.push({ level: 'warn', msg: t('Das Modell hat Löcher im Netz; an {n} Stellen fehlt ein Stück Kontur. Am besten das Modell vorher reparieren (z. B. in Blender oder PrusaSlicer).', { n: L.open }) });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const L = ribsLayout(raw);
    if (!L || !L.ribs.length) return { parts: [], info: [] };
    const items: { key: string; subs: SubPath[]; marks?: SubPath[] }[] = [];
    let area = 0;
    for (const part of [...L.spine, ...L.ribs]) {
      const subs = part.polys.map((poly) => fitPolyline(poly, true, 0.05));
      area += regionArea(part.polys);
      const marks: SubPath[] = [...(part.extra ?? [])];
      if (p.numbers && part.key.startsWith('R')) marks.push(...(placeNumber(part.polys, part.key.slice(1), p.numberSize) ?? []));
      items.push(marks.length ? { key: part.key, subs, marks } : { key: part.key, subs });
    }
    const placed = packParts(items, 3 + p.kerf);
    const parts: GenPart[] = placed.map((pl, i) => (items[i].marks ? { ...pl, marks: items[i].marks } : pl));
    const [dx, dy, dz] = L.dims;
    return {
      parts,
      info: [
        [t('Modell'), p.name || '–'],
        [t('Maße (B × T × H)'), `${fmt(dx)} × ${fmt(dy)} × ${fmt(dz)} mm`],
        [t('Rippen'), String(L.ribs.length)],
        [t('Fläche gesamt'), `${fmt(area / 100, 0)} cm²`],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const base = t('Rippenmodell {name}', { name: p.name || '' }).trim();
    if (!part) return base;
    if (part.startsWith('S')) return `${base}: ${t('Rückgrat')}${part.length > 1 ? ' ' + part.slice(1) : ''}`;
    return `${base}: ${t('Rippe {n}', { n: part.slice(1) })}`;
  },
};

/** Lage jedes Teils im Raum (für die 3D-Ansicht) */
export function ribsPoses(raw: Params): Record<string, { o: V3; u: V3; v: V3; n: V3 }> | null {
  const L = ribsLayout(raw);
  if (!L) return null;
  const out: Record<string, { o: V3; u: V3; v: V3; n: V3 }> = {};
  for (const part of [...L.spine, ...L.ribs]) out[part.key] = part.pose;
  return out;
}
