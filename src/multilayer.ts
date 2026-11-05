// Frei gestaltete Mehrlagenarbeiten: die Formen bleiben normale Projektobjekte;
// nur ihre Montage-Reihenfolge und 3D-Eigenschaften werden im Dokument gespeichert.
import type { Doc, MultiLayerAssembly, MultiLayerPlate, Obj } from './model';
import { leaves, translate } from './model';
import { boundsOf } from './geom';
import type { MaterialLook } from './view3d/looks';

export const assemblyForObject = (doc: Doc, id: number) => doc.multiLayerAssemblies?.find((a) => a.plates.some((p) => p.object === id));

export const allRoots = (doc: Doc) => doc.pages.flatMap((p) => p.objs);

export function pruneMultiLayers(doc: Doc) {
  if (!doc.multiLayerAssemblies) return;
  const ids = new Set(allRoots(doc).map((o) => o.id));
  const asms = doc.multiLayerAssemblies
    .map((a) => ({ ...a, plates: a.plates.filter((p) => ids.has(p.object)) }))
    .filter((a) => a.plates.length);
  if (asms.length) doc.multiLayerAssemblies = asms;
  else delete doc.multiLayerAssemblies;
}

/** Ein direkt gewähltes Objekt ist nur dann eine brauchbare Platte, wenn es eine schneidbare Kontur enthält. */
export function hasClosedContour(o: Obj, isCut: (layer: number) => boolean): boolean {
  return [...leaves([o])].some(([x]) => isCut(x.layer) && x.shape.kind !== 'text' && x.shape.kind !== 'image' && x.shape.kind !== 'group' &&
    ('subs' in x.shape ? x.shape.subs.some((s) => s.closed && s.nodes.length > 2) : x.shape.kind === 'rect' || x.shape.kind === 'ellipse' || x.shape.kind === 'polygon' || x.shape.kind === 'barcode'));
}

export function makeAssembly(plates: MultiLayerPlate[]): MultiLayerAssembly {
  return { id: Math.random().toString(36).slice(2, 10), plates };
}

/** Kopierte vollständige Baugruppen erhalten neue Objekt- und Baugruppenkennungen. */
export function copyMultiLayers(doc: Doc, pairs: readonly [Obj, Obj][]) {
  if (!doc.multiLayerAssemblies?.length) return;
  const ids = new Map<number, number>();
  for (const [from, to] of pairs) ids.set(from.id, to.id);
  const copies: MultiLayerAssembly[] = [];
  for (const a of doc.multiLayerAssemblies) {
    if (!a.plates.every((p) => ids.has(p.object))) continue;
    copies.push(makeAssembly(a.plates.map((p) => ({ ...p, object: ids.get(p.object)! }))));
  }
  if (copies.length) doc.multiLayerAssemblies.push(...copies);
}

/** Bringt die Mitte jeder ausgewählten Platte in den gemeinsamen Montageursprung. */
export function plateAnchor(o: Obj): Obj['m'] {
  const b = boundsOf([o]);
  return b ? translate(-b.x - b.w / 2, -b.y - b.h / 2) : [...o.m];
}

export const defaultPlate = (object: number, name: string, look: MaterialLook, anchor: Obj['m']): MultiLayerPlate => ({ object, name, thickness: 3, look, anchor: [...anchor] });
