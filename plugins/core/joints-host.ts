// Stand-in for src/generators/panelJoints inside the generators built as plugins (box, drawer, finger box …): the
// finger-jointed panel outlines come from the app through the host function `joints` (#398), so the core plugins
// use the same code as any other plugin instead of carrying their own copy. Everything else is the real module.
import type { Pt } from '../../src/model';
import type { PanelSpec } from '../../src/generators/panelJoints.ts';

export * from '../../src/generators/panelJoints.ts';

export function panelCut(P: PanelSpec, th: number, finger: number, play: number, kerf: number): Pt[] {
  // play is the total play of the joints, as in version 2 (#402)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (globalThis as any).host.joints({ op: 'panel', v: 2, width: P.a, height: P.b, thickness: th, finger, clearance: play, kerf, edges: P.edges.map((e) => e.pattern), corners: P.corners });
  return r.outline.nodes;
}
