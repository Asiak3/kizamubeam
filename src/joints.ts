// Holzverbindungen für gelaserte Bauteile: Fingerzinken, Schlitz und Zapfen, Überblattung, Schnapp- und Hakenverbindung,
// Keilzapfen, T-Slot mit Mutter und Deckelscharnier mit Stift.
// Eine Verbindung wird auf gerade Kanten vorhandener Formen angewendet. Die Kante wird durch das Zinken- bzw.
// Zapfenprofil ersetzt, Schlitze kommen als geschlossene Unterpfade hinzu. Alles bleibt ein normaler Pfad mit
// geraden Segmenten (exakte Ecken, keine Näherung) und lässt sich danach im Knoteneditor weiter bearbeiten.
// Gerechnet wird in Weltkoordinaten (mm), damit Materialdicke und Breiten auch bei gedrehten oder skalierten
// Objekten stimmen; das Ergebnis wird in die lokalen Koordinaten des Objekts zurückgerechnet.
// The geometry lives in jointsGeom.ts (also used by the plugin host function joints, #398), the texts in jointText.ts.
import { Mat, Obj, SubPath } from './model';
import { segments, shapeSubs } from './geom';
import { transformSubs } from './importers';
import { computeJointGeom, jointMate as mateGeom, type JointGeometryVersion, type JointOptions, type MateWorld } from './jointsGeom';
import { jointInfoText, jointText } from './jointText';

export {
  DEFAULT_JOINT, fingerCount, fingerProfile, JOINT_GEOMETRY_VERSION, jointAdjust, lapCenters, lidHingeDims, lidHingeProfiles, tenonCenters,
  type JointGeometryVersion, type JointKind, type JointMsg, type JointOptions, type MateWorld,
} from './jointsGeom';

/** Gewählte gerade Kante: Blatt-Objekt, seine Weltmatrix und das Segment in shapeSubs(obj.shape) */
export interface EdgePick {
  obj: Obj;
  m: Mat;
  sub: number;
  seg: number;
}

export interface JointResult {
  /** Neue Unterpfade je geändertem Objekt, in Weltkoordinaten */
  changes: Map<Obj, { m: Mat; subs: SubPath[] }>;
  /** Neue Teile (z. B. Keile), in Weltkoordinaten */
  added: SubPath[];
  info: string;
  error?: string;
}

/** Unterpfade eines Objekts in Weltkoordinaten (Kopie) */
export const worldSubs = (o: Obj, m: Mat): SubPath[] => transformSubs(shapeSubs(o.shape), m);

/** Ist das Segment eine gerade Kante (keine Kurve, nicht entartet)? */
export function isStraight(o: Obj, sub: number, seg: number): boolean {
  const sp = shapeSubs(o.shape)[sub];
  const s = sp && segments(sp)[seg];
  return !!s && !s.curve && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6;
}

const edges = (picks: EdgePick[]) => {
  const subs = new Map<Obj, SubPath[]>();
  return picks.map((p) => {
    let s = subs.get(p.obj);
    if (!s) subs.set(p.obj, (s = worldSubs(p.obj, p.m)));
    return { obj: p.obj, subs: s, sub: p.sub, seg: p.seg };
  });
};

/**
 * Welche Linie an welche gehört, vor dem Anwenden der Verbindung berechnet: Kante 1 mit einem Punkt im Material,
 * am Gegenstück die Kante bzw. (Zapfen-Familie) die Mittellinie der Schlitze. null bei nur einer Kante.
 */
export function jointMate(picks: EdgePick[], o: JointOptions): MateWorld | null {
  if (picks.length < 2 || picks[0].obj === picks[1].obj) return null;
  return mateGeom(edges(picks), o);
}

/**
 * Verbindung berechnen. Fingerzinken: eine oder zwei Kanten (die zweite bekommt das Gegenstück).
 * Schlitz und Zapfen: erste Kante bekommt die Zapfen, die zweite Linie (Kante oder einzelne Hilfslinie) die Schlitze.
 * v: version of the joint geometry; the Joint tool still uses 1 (clearance per side along fingers and tenons, #402).
 */
export function computeJoint(picks: EdgePick[], o: JointOptions, v: JointGeometryVersion = 1): JointResult {
  const r = computeJointGeom(edges(picks), o, v);
  if (r.error) return { changes: new Map(), added: [], info: '', error: jointText(r.error) ?? r.error.code };
  const m = new Map(picks.map((p) => [p.obj, p.m]));
  return { changes: new Map([...r.changes].map(([obj, subs]) => [obj, { m: m.get(obj)!, subs }])), added: r.added, info: jointInfoText(r.info) };
}
