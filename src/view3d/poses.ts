// Lage der Teile einer Baugruppe im Raum, für die 3D-Ansicht und die Prüfung auf Überschneidungen.
//
// Jedes Teil ist eine Platte: die ebene Kontur (lokal, mm, y nach unten wie auf der Arbeitsfläche) um die
// Materialdicke in Richtung n hochgezogen. Ein Punkt (x, y) der Kontur in Höhe s (0 … Dicke) liegt im Raum bei
// o + x·u + y·v + s·n. Raum: X nach rechts (Breite), Y nach hinten (Tiefe), Z nach oben.
import { getGenerator, type Params } from '../generators';
import type { AsmPoses } from '../generators/pose';

// Pose types and helpers live with the generators (src/generators/pose.ts), which compute their own poses (#341)
export { cross, dot, flatPose, rotatePose } from '../generators/pose';
export type { AsmPoses, Pose, V3 } from '../generators/pose';

/** Lagen aller Teile einer Baugruppe (ohne Schnittfuge), from Generator.poses; null for generators without a spatial layout */
export function assemblyPoses(gen: string, params: Params, th: number): AsmPoses | null {
  return getGenerator(gen)?.poses?.(params, th) ?? null;
}

/** Materialdicke eines Generator-Teils: aus den Parametern, sonst die Vorgabe der Ansicht */
export const genThickness = (params: Params, fallback: number) => (typeof params.thickness === 'number' && params.thickness > 0 ? params.thickness : fallback);
