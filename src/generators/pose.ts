// Position of each part of an assembly in space, for the 3D view and the assembly check (Generator.poses).
//
// Every part is a plate: the flat outline (local, mm, y down as on the workspace) extruded by the material
// thickness along n. A point (x, y) of the outline at height s (0 … thickness) lies in space at
// o + x·u + y·v + s·n. Space: X to the right (width), Y to the back (depth), Z up.
// Pure geometry without DOM or three.js, so plugins can provide the same data.
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

export const X: V3 = [1, 0, 0],
  Y: V3 = [0, 1, 0],
  Z: V3 = [0, 0, 1];
export const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
export const pose = (o: V3, u: V3, v: V3, n: V3): Pose => ({ o, u, v, n });

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
export function moved(p: Pose, R: [V3, V3, V3], t: V3): Pose {
  const r = (w: V3): V3 => [0, 1, 2].map((i) => R[0][i] * w[0] + R[1][i] * w[1] + R[2][i] * w[2]) as V3;
  const o = r(p.o);
  return { o: [o[0] + t[0], o[1] + t[1], o[2] + t[2]], u: r(p.u), v: r(p.v), n: r(p.n) };
}
