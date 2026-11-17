// The app side of GenHost (src/generators/host.ts): what generator panels and inputs may read from the editor.
import type { Editor } from './editor';
import { cameraViews } from './cameraui';
import { flattenSub, SCALE } from './clip';
import { shapeSubs } from './geom';
import { Obj, Pt, visibleLeaves } from './model';
import type { GenHost, GenSelected } from './generators/host';
import { addAsset, assetImage } from './images';

const polysOfObj = (o: Obj): Pt[][] => {
  const out: Pt[][] = [];
  for (const [leaf, world] of visibleLeaves([o]))
    for (const sp of shapeSubs(leaf.shape)) if (sp.closed) out.push(flattenSub(sp, world).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
  return out;
};

const nameOf = (o: Obj) => o.name || (o.shape.kind === 'text' ? o.shape.text.slice(0, 20) : '');

/** Selected top-level objects in document order; unnamed ones have an empty name */
export const selectedForGen = (ed: Editor): GenSelected[] => ed.doc.objs.filter((o) => ed.sel.includes(o)).map((o) => ({ name: nameOf(o), polys: polysOfObj(o) }));

export function genHost(ed: Editor): GenHost {
  return {
    selection: () => selectedForGen(ed),
    bed: () => ({ w: ed.doc.bed.w, h: ed.doc.bed.h }),
    cameraImages: () => cameraViews(ed).map((v) => ({ image: v.image, empty: v.empty })),
    selectedImage: () => {
      for (const o of ed.sel) {
        if (o.shape.kind !== 'image') continue;
        const img = assetImage(o.shape.asset);
        if (img) return { image: img, width: img.naturalWidth, height: img.naturalHeight, asset: o.shape.asset, name: o.name ?? '' };
      }
      return null;
    },
    keepImage: async (file) => {
      try {
        const url = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => rej(r.error);
          r.readAsDataURL(file);
        });
        return (await addAsset(url)).id;
      } catch {
        return null;
      }
    },
  };
}
