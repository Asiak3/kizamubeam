// Lage der Teile einer Baugruppe im Raum, für die 3D-Ansicht und die Prüfung auf Überschneidungen.
//
// Jedes Teil ist eine Platte: die ebene Kontur (lokal, mm, y nach unten wie auf der Arbeitsfläche) um die
// Materialdicke in Richtung n hochgezogen. Ein Punkt (x, y) der Kontur in Höhe s (0 … Dicke) liegt im Raum bei
// o + x·u + y·v + s·n. Raum: X nach rechts (Breite), Y nach hinten (Tiefe), Z nach oben.
// Die Lagen stehen hier und nicht in den Generatoren, weil sie nur für die Ansicht gebraucht werden.
import type { Params } from '../generators';
import { BoxParams, boxOuter } from '../generators/box';
import { DrawerParams, drawerDims } from '../generators/drawer';
import { dividerCenters, InsertParams } from '../generators/insert';
import { ShelfParams, shelfHeights, sideCenters } from '../generators/shelf';
import { centerDistance, GearPairParams, pairGear } from '../generators/gearpair';
import { gearGeometry, GearParams } from '../generators/gear';
import { sphereLayout } from '../generators/discsphere';
import { stackPoses } from '../generators/stack';
import { ribsPoses } from '../generators/ribs';

export type V3 = [number, number, number];

export interface Pose {
  o: V3;
  u: V3;
  v: V3;
  n: V3;
}

export interface AsmPoses {
  poses: Record<string, Pose>;
  /**
   * Drehbare Teile (Zahnräder): Drehzahl relativ zum ersten Rad, Vorzeichen = Drehrichtung um n.
   * Gedreht wird um den lokalen Ursprung (Radmitte).
   */
  spin?: Record<string, number>;
}

const X: V3 = [1, 0, 0],
  Y: V3 = [0, 1, 0],
  Z: V3 = [0, 0, 1];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const pose = (o: V3, u: V3, v: V3, n: V3): Pose => ({ o, u, v, n });

/** Teil liegt flach, von oben gesehen wie auf der Arbeitsfläche (y nach unten = −Y) */
export const flatPose = (x = 0, y = 0, z = 0): Pose => pose([x, -y, z], X, neg(Y), Z);

/** Drehung der Platte in ihrer Ebene um den lokalen Ursprung (Winkel im Bogenmaß, positiv = links herum um n) */
export function rotatePose(p: Pose, a: number): Pose {
  const c = Math.cos(a),
    s = Math.sin(a);
  // Rodrigues für Vektoren senkrecht zu n: r = c·w + s·(n × w)
  const rot = (w: V3): V3 => {
    const x = cross(p.n, w);
    return [c * w[0] + s * x[0], c * w[1] + s * x[1], c * w[2] + s * x[2]];
  };
  return { o: p.o, u: rot(p.u), v: rot(p.v), n: p.n };
}

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Starre Bewegung: zuerst R (Spalten = Bilder von X, Y, Z), dann Verschiebung t */
function moved(p: Pose, R: [V3, V3, V3], t: V3): Pose {
  const r = (w: V3): V3 => [0, 1, 2].map((i) => R[0][i] * w[0] + R[1][i] * w[1] + R[2][i] * w[2]) as V3;
  const o = r(p.o);
  return { o: [o[0] + t[0], o[1] + t[1], o[2] + t[2]], u: r(p.u), v: r(p.v), n: r(p.n) };
}

/** Box: Boden auf Z = 0, Vorderwand bei Y = 0, linke Wand bei X = 0 */
export function boxPoses(p: BoxParams): Record<string, Pose> {
  const { W, D, H } = boxOuter(p);
  const th = p.thickness;
  const down = neg(Z);
  return {
    bottom: pose([W / 2, D / 2, 0], X, Y, Z),
    top: pose([W / 2, D / 2, H - th], X, Y, Z),
    front: pose([W / 2, 0, H / 2], X, down, Y),
    back: pose([W / 2, D - th, H / 2], X, down, Y),
    left: pose([0, D / 2, H / 2], Y, down, X),
    right: pose([W - th, D / 2, H / 2], Y, down, X),
  };
}

function drawerPoses(p: DrawerParams): AsmPoses {
  const th = p.thickness;
  const { box, front } = drawerDims(p);
  const out: Record<string, Pose> = {};
  const boxOf = (W: number, D: number, H: number): BoxParams => ({
    sizeMode: 'outer', width: W, depth: D, height: H, thickness: th, top: 'open', finger: p.finger, clearance: p.clearance, kerf: 0,
  });
  if (p.carcass) {
    // Korpus = Box mit Breite × Höhe × Tiefe, gekippt: ihr Boden wird die Rückwand, ihre offene Oberseite zeigt nach vorne
    const names: Record<string, string> = { bottom: 'back', front: 'bottom', back: 'top' };
    const R: [V3, V3, V3] = [X, Z, neg(Y)];
    for (const [k, ps] of Object.entries(boxPoses(boxOf(p.width, p.height, p.depth)))) out['c_' + (names[k] ?? k)] = moved(ps, R, [0, p.depth, 0]);
  }
  const c = p.carcass ? th : 0;
  const inset = p.front === 'inset' ? th : 0;
  // Schubkasten mit der Luft seitlich in der Öffnung, hinter einer eingelegten Blende
  for (const [k, ps] of Object.entries(boxPoses(boxOf(box.W, box.D, box.H)))) out['d_' + k] = moved(ps, [X, Y, Z], [c + p.sidePlay, inset, c]);
  if (front) out.front = pose([p.width / 2, p.front === 'overlay' ? -th : 0, p.height / 2], X, neg(Z), Y);
  return { poses: out };
}

function insertPoses(p: InsertParams): AsmPoses {
  const th = p.thickness;
  const out: Record<string, Pose> = {};
  dividerCenters(p.width, p.cellsX, th).forEach((x, i) => (out[`x${i + 1}`] = pose([x - th / 2, p.depth / 2, p.height / 2], Y, neg(Z), X)));
  dividerCenters(p.depth, p.cellsY, th).forEach((y, i) => (out[`y${i + 1}`] = pose([p.width / 2, y - th / 2, p.height / 2], X, neg(Z), Y)));
  return { poses: out };
}

function shelfPoses(p: ShelfParams): AsmPoses {
  const th = p.thickness;
  const out: Record<string, Pose> = {};
  sideCenters(p).forEach((x, i) => (out[`side${i + 1}`] = pose([x - th / 2, p.depth / 2, p.height / 2], Y, neg(Z), X)));
  shelfHeights(p).forEach((z, i) => (out[`board${i + 1}`] = pose([p.width / 2, p.depth / 2, z], X, Y, Z)));
  return { poses: out };
}

function gearPairPoses(raw: Params, th: number): AsmPoses {
  const p = raw as unknown as GearPairParams;
  const g1 = gearGeometry(pairGear(raw, 1) as unknown as GearParams);
  const g2 = gearGeometry(pairGear(raw, 2) as unknown as GearParams);
  const a = centerDistance(p);
  // Achsen wie in der Grundplatte; ohne Platte liegen die Räder auf Z = 0
  const c0 = (g2.ra - g1.ra) / 2;
  const z = p.plate ? th : 0;
  // Der erste Zahn zeigt nach oben (+Y). Rad 1: Zahn zu Rad 2 (+X); Rad 2: Lücke zu Rad 1 (−X)
  const out: Record<string, Pose> = {
    gear1: rotatePose(flatPose(-a / 2 - c0, 0, z), -Math.PI / 2),
    gear2: rotatePose(flatPose(a / 2 - c0, 0, z), Math.PI / 2 + Math.PI / p.teeth2),
  };
  if (p.plate) out.plate = flatPose();
  return { poses: out, spin: { gear1: 1, gear2: -p.teeth1 / p.teeth2 } };
}

/** Scheibenkugel: Mittelebene jeder Scheibe im Abstand d vom Mittelpunkt (Z = 0), Dicke zu beiden Seiten */
function discSpherePoses(params: Params, th: number): AsmPoses | null {
  const L = sphereLayout({ ...params, thickness: th });
  if (!L) return null;
  const out: Record<string, Pose> = {};
  for (const d of L.discs) out[d.key] = pose([d.c[0] - (d.n[0] * th) / 2, d.c[1] - (d.n[1] * th) / 2, d.c[2] - (d.n[2] * th) / 2], d.U, d.V, d.n);
  return { poses: out };
}

/** Lagen aller Teile einer Baugruppe (ohne Schnittfuge); null für Generatoren ohne räumlichen Aufbau */
export function assemblyPoses(gen: string, params: Params, th: number): AsmPoses | null {
  switch (gen) {
    case 'box':
      return { poses: boxPoses({ ...(params as unknown as BoxParams), kerf: 0 }) };
    case 'drawer':
      return drawerPoses(params as unknown as DrawerParams);
    case 'insert':
      return insertPoses(params as unknown as InsertParams);
    case 'shelf':
      return shelfPoses(params as unknown as ShelfParams);
    case 'gearpair':
      return gearPairPoses(params, th);
    case 'discsphere':
      return discSpherePoses(params, th);
    case 'stack': {
      const poses = stackPoses(params);
      return poses ? { poses } : null;
    }
    case 'ribs': {
      const poses = ribsPoses(params);
      return poses ? { poses } : null;
    }
    default:
      return null;
  }
}

/** Materialdicke eines Generator-Teils: aus den Parametern, sonst die Vorgabe der Ansicht */
export const genThickness = (params: Params, fallback: number) => (typeof params.thickness === 'number' && params.thickness > 0 ? params.thickness : fallback);
