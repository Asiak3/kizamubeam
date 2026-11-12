// Editor: pattern fill (issue #245). Collects motif, tile frame, target shape and kept-free areas from the
// selection, previews the pattern and inserts or updates the parametric pattern object (generator 'pattern-fill').
import { IDENT, leaves, Mat, newId, Obj, Pt, SubPath, translate } from '../model';
import { boundsOf, shapeSubs } from '../geom';
import { buildGen } from '../generators';
import { optionsFromParams, paramsFromOptions, PATTERN_GEN, PATTERN_GEN_ID, PatternOptions, runPattern, subsBox, transformSubs } from '../pattern';
import { parseRecipe, PatternRecipe, PatternSpec, PatternTile } from '../patternFormat';
import { t } from '../i18n';
import type { Editor } from '../editor';

export type PatternRole = 'motif' | 'frame' | 'target' | 'hole' | 'ignore';

export interface PatternPick {
  obj: Obj;
  role: PatternRole;
}

const isPatternObj = (o: Obj) => o.shape.kind === 'gen' && o.shape.gen === PATTERN_GEN_ID;
/** Text, images and codes count with their bounding box (keep-free area around a text) */
const boxOnly = (o: Obj) => [...leaves([o])].every(([l]) => l.shape.kind === 'text' || l.shape.kind === 'image' || l.shape.kind === 'barcode');

/** Paths of an object in world coordinates (text, images and codes: their bounding box) */
export function worldSubs(o: Obj, parent: Mat = IDENT): SubPath[] {
  if (boxOnly(o)) {
    const b = boundsOf([o], parent);
    if (!b) return [];
    return [{ closed: true, nodes: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] }];
  }
  const out: SubPath[] = [];
  for (const [leaf, m] of leaves([o], parent)) {
    if (leaf.shape.kind === 'text' || leaf.shape.kind === 'image') continue;
    out.push(...transformSubs(shapeSubs(leaf.shape).filter((s) => s.nodes.length >= 2), m));
  }
  return out;
}
const hasClosed = (o: Obj) => !boxOnly(o) && worldSubs(o).some((s) => s.closed);
const area = (o: Obj) => {
  const b = boundsOf([o]);
  return b ? b.w * b.h : 0;
};
const within = (inner: Obj, outer: Obj, tol = 1e-6) => {
  const a = boundsOf([inner]), b = boundsOf([outer]);
  return !!a && !!b && a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
};

export interface PatternSetup {
  recipe: PatternRecipe;
  /** World position of the object origin (centre of the target box) */
  center: Pt;
  layer: number;
}

export class EditorPattern {
  /** The selected pattern object, if exactly one is selected */
  patternObj(this: Editor): Obj | null {
    if (this.sel.length !== 1) return null;
    const o = this.sel[0];
    return isPatternObj(o) ? o : null;
  }

  /**
   * Roles for the selected objects: the largest closed shape is the target; text, images and codes on it are
   * kept free; a rectangle around all other motif objects is the tile frame; everything else is the motif.
   * withPattern: a library pattern is used, so the selection only needs a target.
   */
  patternPicks(this: Editor, withPattern = false): PatternPick[] {
    const objs = this.doc.objs.filter((o) => this.sel.includes(o));
    const picks: PatternPick[] = objs.map((obj) => ({ obj, role: 'motif' }));
    const closed = picks.filter((p) => hasClosed(p.obj) && !isPatternObj(p.obj));
    if (closed.length && (picks.length > 1 || withPattern)) {
      const target = closed.reduce((a, b) => (area(b.obj) > area(a.obj) ? b : a));
      target.role = 'target';
      for (const p of picks)
        if (p !== target && (withPattern || (boxOnly(p.obj) && within(p.obj, target.obj)))) p.role = withPattern ? (within(p.obj, target.obj) ? 'hole' : 'ignore') : 'hole';
    }
    const motif = picks.filter((p) => p.role === 'motif');
    if (motif.length >= 2) {
      const frame = motif.find((p) => p.obj.shape.kind === 'rect' && motif.every((q) => q === p || within(q.obj, p.obj)));
      if (frame) frame.role = 'frame';
    }
    return picks;
  }

  /** Tile from the motif objects (and the frame, if any), centred on the frame */
  patternTile(this: Editor, picks: PatternPick[]): PatternTile | string {
    const motif = picks.filter((p) => p.role === 'motif').map((p) => p.obj);
    if (!motif.length) return t('Kein Motiv: Objekte für die Kachel auswählen oder ein Muster aus der Liste wählen.');
    const frame = picks.find((p) => p.role === 'frame')?.obj;
    const subs = motif.flatMap((o) => worldSubs(o));
    if (!subs.length) return t('Das Motiv enthält keine Vektoren.');
    const fb = frame ? boundsOf([frame]) : null;
    const box = subsBox(subs);
    const b = fb ?? { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
    if (b.w < 0.05 || b.h < 0.05) return t('Kachel zu klein (mindestens 0,05 mm breit und hoch).');
    return { w: b.w, h: b.h, subs: transformSubs(subs, translate(-(b.x + b.w / 2), -(b.y + b.h / 2))) };
  }

  /** Target, kept-free areas and tile as a recipe in the coordinates of the new object */
  patternSetup(this: Editor, picks: PatternPick[], tile: PatternTile, name?: string): PatternSetup | string {
    const targets = picks.filter((p) => p.role === 'target').map((p) => p.obj);
    if (!targets.length) return t('Keine Zielform: eine geschlossene Form auswählen, die das Muster füllen soll.');
    const target = targets.flatMap((o) => worldSubs(o)).filter((s) => s.closed);
    if (!target.length) return t('Die Zielform ist nicht geschlossen.');
    const holes = picks.filter((p) => p.role === 'hole').flatMap((p) => worldSubs(p.obj)).filter((s) => s.closed);
    const b = subsBox(target);
    const center = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    const toLocal = translate(-center.x, -center.y);
    const recipe: PatternRecipe = { v: 1, tile, target: transformSubs(target, toLocal), holes: transformSubs(holes, toLocal) };
    if (name) recipe.name = name;
    const motif = picks.find((p) => p.role === 'motif')?.obj;
    return { recipe, center, layer: motif ? motif.layer : this.currentLayer };
  }

  /** World matrix of an object on the current page */
  worldMatrix(this: Editor, o: Obj): Mat {
    return [...leaves(this.doc.objs)].find(([l]) => l === o)?.[1] ?? o.m;
  }

  setPatternPreview(this: Editor, subs: SubPath[] | null) {
    this.patternPreview = subs;
    this.redraw();
  }

  /** Preview of a recipe placed at the centre (world), or of an existing object with its own matrix */
  patternPreviewSubs(this: Editor, recipe: PatternRecipe, o: PatternOptions, place: Pt | Mat): { subs: SubPath[] | null; error?: string; result: ReturnType<typeof runPattern> } {
    const r = runPattern(recipe, o);
    if (r.error) return { subs: null, error: r.error, result: r };
    const m = Array.isArray(place) ? place : translate(place.x, place.y);
    return { subs: transformSubs(r.subs, m), result: r };
  }

  /**
   * Insert a new pattern object (one undo step). keepTarget: leave the target shape in place (e.g. as cut
   * outline); removeMotif: delete the motif and frame objects that made the tile.
   */
  insertPattern(this: Editor, picks: PatternPick[], setup: PatternSetup, o: PatternOptions, keepTarget: boolean, removeMotif: boolean): Obj | null {
    const b = buildGen(PATTERN_GEN, paramsFromOptions(o, setup.recipe));
    if (!b.parts.length) {
      this.hint = t('Muster füllen: {error}', { error: b.issues.find((i) => i.level === 'error')?.msg ?? '' });
      this.emit('tool');
      return null;
    }
    this.snapshot(t('Muster füllen'));
    const obj: Obj = { id: newId(), m: translate(setup.center.x, setup.center.y), layer: setup.layer, shape: b.parts[0].shape };
    const target = picks.find((p) => p.role === 'target')!.obj;
    const drop = new Set<Obj>();
    if (!keepTarget) for (const p of picks) if (p.role === 'target') drop.add(p.obj);
    if (removeMotif) for (const p of picks) if (p.role === 'motif' || p.role === 'frame') drop.add(p.obj);
    const at = this.doc.objs.indexOf(target);
    this.doc.objs.splice(at + 1, 0, obj);
    this.doc.objs = this.doc.objs.filter((x) => !drop.has(x));
    this.layer(setup.layer);
    this.setSel([obj]);
    const info = b.info[0]?.[1] ?? '';
    this.hint = t('Muster eingefügt: {info}. Doppelklick öffnet die Einstellungen wieder.', { info });
    this.emit('doc');
    return obj;
  }

  /** Change an existing pattern object: new options and, optionally, a new tile (one undo step) */
  updatePattern(this: Editor, obj: Obj, o: PatternOptions, tile?: { tile: PatternTile; name?: string }): boolean {
    if (!isPatternObj(obj) || obj.shape.kind !== 'gen') return false;
    let recipe: PatternRecipe;
    try {
      recipe = parseRecipe(String(obj.shape.params.recipe));
    } catch (e) {
      this.hint = (e as Error).message;
      this.emit('tool');
      return false;
    }
    if (tile) {
      recipe.tile = tile.tile;
      if (tile.name) recipe.name = tile.name;
      else delete recipe.name;
    }
    const b = buildGen(PATTERN_GEN, paramsFromOptions(o, recipe));
    if (!b.parts.length) {
      this.hint = t('Muster füllen: {error}', { error: b.issues.find((i) => i.level === 'error')?.msg ?? '' });
      this.emit('tool');
      return false;
    }
    this.updateGen(obj, b);
    this.hint = t('Muster geändert: {info}.', { info: b.info[0]?.[1] ?? '' });
    this.emit('doc');
    return true;
  }

  /** Options and recipe of a pattern object */
  patternOf(this: Editor, obj: Obj): { recipe: PatternRecipe; options: PatternOptions } | null {
    if (!isPatternObj(obj) || obj.shape.kind !== 'gen') return null;
    try {
      return { recipe: parseRecipe(String(obj.shape.params.recipe)), options: optionsFromParams(obj.shape.params) };
    } catch {
      return null;
    }
  }

  /** The pattern of an existing object as a library pattern (tile and its repeat settings) */
  patternSpecOf(this: Editor, recipe: PatternRecipe, o: PatternOptions): PatternSpec {
    const { repeat, shift, mirror, gapX, gapY, scale, angle, wrap, output } = o;
    return { tile: recipe.tile, settings: { repeat, shift, mirror, gapX, gapY, scale, angle, wrap, output } };
  }
}
