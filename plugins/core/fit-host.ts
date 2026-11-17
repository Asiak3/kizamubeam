// Stand-in for src/fit inside the 3D-model generators built as plugins: curve fitting through the host function
// `fit` (the same fitPolyline in the app), which is many times faster than in QuickJS.
import type { Pt, SubPath } from '../../src/model';

export function fitPolyline(pts: Pt[], closed: boolean, tol: number, opt: { lineMin?: number; cornerDeg?: number } = {}): SubPath {
  if (opt.lineMin !== undefined || opt.cornerDeg !== undefined) throw new Error('fitPolyline options are not available in plugins');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).host.fit({ pts: pts.map((q) => [q.x, q.y]), closed, tolerance: tol });
}
