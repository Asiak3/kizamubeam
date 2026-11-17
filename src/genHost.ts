// The app side of GenHost (src/generators/host.ts): what generator panels and inputs may read from the editor.
import type { Editor } from './editor';
import { cameraViews } from './cameraui';
import { flattenSub, SCALE } from './clip';
import { shapeSubs } from './geom';
import { Obj, Pt, visibleLeaves } from './model';
import type { GenHost, GenSelected } from './generators/host';
import { t } from './i18n';

const polysOfObj = (o: Obj): Pt[][] => {
  const out: Pt[][] = [];
  for (const [leaf, world] of visibleLeaves([o]))
    for (const sp of shapeSubs(leaf.shape)) if (sp.closed) out.push(flattenSub(sp, world).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
  return out;
};

const nameOf = (o: Obj) => o.name || (o.shape.kind === 'text' ? o.shape.text.slice(0, 20) : '');

/**
 * Selected top-level objects in document order; unnamed ones get a numbered name in the interface language, since
 * a plugin has no language of its own
 */
export const selectedForGen = (ed: Editor): GenSelected[] =>
  ed.doc.objs.filter((o) => ed.sel.includes(o)).map((o, i) => ({ name: nameOf(o) || t('Werkstück {n}', { n: i + 1 }), polys: polysOfObj(o) }));

export function genHost(ed: Editor): GenHost {
  return {
    selection: () => selectedForGen(ed),
    bed: () => ({ w: ed.doc.bed.w, h: ed.doc.bed.h }),
    cameraImages: () => cameraViews(ed).map((v) => ({ image: v.image, empty: v.empty })),
  };
}
