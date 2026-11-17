// What a generator panel or input may read from the app (#341, #211): a narrow, read-only view instead of the
// Editor. Plugins later get the same data through host functions.
import type { Pt } from '../model';

/** A selected top-level object: its name and its closed outlines in workspace mm */
export interface GenSelected {
  name: string;
  polys: Pt[][];
}

/** A calibrated camera image in bed size (world 0 … bed width/height) and, if taken, the photo of the empty bed */
export interface GenCameraImage {
  image: HTMLCanvasElement | null;
  empty: HTMLCanvasElement | null;
}

export interface GenHost {
  selection(): GenSelected[];
  bed(): { w: number; h: number };
  cameraImages(): GenCameraImage[];
}

/** What the app hands to Generator.fromInputs for the inputs a generator declares */
export interface GenInputs {
  selection?: GenSelected[];
  /** A loaded 3D model: id in the model store and the file name without extension */
  model?: { id: string; name: string };
}
