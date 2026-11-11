// Serializable local-coordinate subtraction recipe, with cached geometry for older readers.
import ClipperLib from 'clipper-lib';
import { execute, flattenSub, SCALE } from './clip';
import { IDENT, Shape, SubPath, Pt } from './model';
import type { Generator, Params } from './generators/types';
import { t } from './i18n';
import { guidedSlot, SlotAnchor, slotAnchorFromReference, slotContourPosition } from './contourSlots';
import { curveCorner, projectedSlot, SlotProjection, SlotOrigin, straightGeometry, ProjectionFrame } from './straightSlots';
import { SlotConstructionLine, ResolvedConstructionLine, resolveConstructionLine, resolveConstructionIntersection } from './slotConstruction';
import { manufacturedSlotPaths } from './slotManufacturing';

export interface SlotGroup { id: string; name: string; width: number; depth: number; clearance: number; factor: number; burn: number; cornerStyle: 'corner' | 'loop' | 'backarc' }
export interface SlotMirror { slotId: string; axis: { kind: 'helper'; helperId: string } | { kind: 'edge'; edge: string } }
export interface PlacedSlot { x: number; y: number; angle: number; width: number; depth: number; clearance: number; factor: number; anchor?: SlotAnchor; projection?: SlotProjection; mirror?: SlotMirror; id?: string; groupId?: string; burn?: number; cornerStyle?: SlotGroup['cornerStyle'] }
export interface SlotRecipe { source: Shape; base: SubPath[]; slots: PlacedSlot[]; settings?: { cornerAngle: number }; groups?: SlotGroup[]; helpers?: SlotConstructionLine[]; order?: { kind: 'group' | 'slot' | 'helper'; id: string }[] }
export const LEGACY_SLOT_GENERATOR = 'slot-placement';
// A new identity prevents the earlier local build from regenerating guided recipes as free rectangles.
export const CONTOUR_SLOT_GENERATOR = 'slot-placement-contour';
export const PROJECTION_SLOT_GENERATOR = 'slot-placement-projection';
export const FEATURE_SLOT_GENERATOR = 'slot-placement-features';
export const SLOT_GENERATOR = 'slot-placement-mirrors';
export const isSlotGenerator = (id: string) => [SLOT_GENERATOR, FEATURE_SLOT_GENERATOR, PROJECTION_SLOT_GENERATOR, CONTOUR_SLOT_GENERATOR, LEGACY_SLOT_GENERATOR].includes(id);
export const recipeCornerAngle = (recipe: SlotRecipe, fallback = 20): number => recipe.settings?.cornerAngle ?? fallback;
function mirrorParent(recipe: SlotRecipe, slot: PlacedSlot): PlacedSlot {
  const mirror = slot.mirror;
  const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 100;
  if (!mirror || !validId(mirror.slotId) || !mirror.axis ||
    !(mirror.axis.kind === 'helper' ? validId(mirror.axis.helperId) : mirror.axis.kind === 'edge' && validId(mirror.axis.edge)) ||
    slot.groupId !== undefined || slot.anchor !== undefined || slot.projection !== undefined)
    throw new Error(t('Ungültige Spiegelreferenz. Gespiegelte Schnitte erben die Schlitzgruppe.'));
  const parents = recipe.slots.filter(s => s.id === mirror.slotId);
  if (parents.length !== 1) throw new Error(t('Referenzierter Schnitt fehlt oder ist nicht eindeutig.'));
  return parents[0];
}
function dimensionSource(recipe: SlotRecipe, slot: PlacedSlot): PlacedSlot {
  const seen = new Set<PlacedSlot>();
  while (slot.mirror) {
    if (seen.has(slot)) throw new Error(t('Kreisförmige Schnittreferenzen sind nicht erlaubt.'));
    seen.add(slot); slot = mirrorParent(recipe, slot);
  }
  return slot;
}
export function effectiveSlotGroup(recipe: SlotRecipe, slot: PlacedSlot): SlotGroup | undefined {
  slot = dimensionSource(recipe, slot);
  if (slot.groupId === undefined) return undefined;
  const group = recipe.groups?.find(g => g.id === slot.groupId);
  if (!group) throw new Error(t('Referenzierte Schlitzgruppe fehlt.'));
  return group;
}
export function effectiveSlot(recipe: SlotRecipe, slot: PlacedSlot): PlacedSlot {
  if (slot.mirror) {
    const parent = effectiveSlot(recipe, dimensionSource(recipe, slot));
    return { ...slot, x: parent.x, y: parent.y, angle: parent.angle, width: parent.width, depth: parent.depth,
      clearance: parent.clearance, factor: parent.factor, burn: parent.burn, cornerStyle: parent.cornerStyle };
  }
  const group = effectiveSlotGroup(recipe, slot);
  const result = group ? { ...slot, width: group.width, depth: group.depth, clearance: group.clearance, factor: group.factor, burn: group.burn, cornerStyle: group.cornerStyle } : { ...slot };
  if (slot.projection && recipe.settings) result.projection = { ...slot.projection, cornerAngle: recipe.settings.cornerAngle };
  return result;
}
/** Explicit, immutable migration; mixed legacy angle thresholds require a UI decision. */
export function adoptSlotFeatureRecipe(recipe: SlotRecipe, angle?: number): SlotRecipe {
  const result = structuredClone(recipe);
  const angles = new Set(result.slots.flatMap(s => s.projection ? [s.projection.cornerAngle] : []));
  if (angle === undefined && !result.settings && angles.size > 1) throw new Error(t('Unterschiedliche Eckenwinkel: globalen Eckenwinkel ausdrücklich wählen.'));
  result.settings = { cornerAngle: angle ?? result.settings?.cornerAngle ?? [...angles][0] ?? 20 };
  result.groups ??= []; result.helpers ??= [];
  for (const slot of result.slots) {
    if (slot.id === undefined) {
      let n = 1; while (result.slots.some(s => s.id === `slot-${n}`)) n++;
      slot.id = `slot-${n}`;
    }
    if (slot.groupId !== undefined || slot.mirror) continue;
    const same = result.groups.find(g => g.width === slot.width && g.depth === slot.depth && g.clearance === slot.clearance && g.factor === slot.factor && g.burn === 0 && g.cornerStyle === 'corner');
    let group = same;
    if (!group) {
      let n = 1; while (result.groups.some(g => g.id === `group-${n}`)) n++;
      group = { id: `group-${n}`, name: t('Schlitzgruppe {n}', { n }), width: slot.width, depth: slot.depth, clearance: slot.clearance, factor: slot.factor, burn: 0, cornerStyle: 'corner' };
      result.groups.push(group);
    }
    slot.groupId = group.id;
  }
  readSlotRecipe({ recipe: JSON.stringify(result) });
  return result;
}
const { ClipType: C, PolyFillType: F, Clipper } = ClipperLib;
export function slotOutline(s: PlacedSlot): SubPath {
  if (![s.x,s.y,s.angle,s.width,s.depth,s.clearance,s.factor].every(Number.isFinite) ||
    s.width <= 0 || s.depth <= 0 || s.factor <= 0 || s.width * s.factor + s.clearance < 0.05 ||
    Math.max(Math.abs(s.x),Math.abs(s.y),s.width,s.depth,s.width*s.factor+s.clearance) > 100000)
    throw new Error(t('Ungültige Schlitzmaße oder Korrekturwerte.'));
  const w = (s.width * s.factor + s.clearance) / 2, d = s.depth / 2;
  const a = s.angle * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  return { closed: true, nodes: [[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,y]) => ({ x:s.x+c*x-sn*y, y:s.y+sn*x+c*y })) };
}
export function readSlotRecipe(p: Params): SlotRecipe {
  if (typeof p.recipe !== 'string' || p.recipe.length > 4000000) throw new Error(t('Ungültige Schlitzdefinition.'));
  const r = JSON.parse(p.recipe) as SlotRecipe;
  if (!r.source || !Array.isArray(r.base) || !r.base.length || r.base.length > 512 || !Array.isArray(r.slots) || r.slots.length > 128)
    throw new Error(t('Ungültige Schlitzdefinition.'));
  let nodes = 0;
  for (const sp of r.base) {
    if (!sp.closed || !Array.isArray(sp.nodes) || sp.nodes.length < 2) throw new Error(t('Nur geschlossene Vektorformen werden unterstützt.'));
    for (const n of sp.nodes) {
      if (++nodes > 16384 || ![n,n.cin,n.cout].filter(Boolean).every(p => Number.isFinite(p!.x) && Number.isFinite(p!.y) && Math.max(Math.abs(p!.x),Math.abs(p!.y)) < 100000))
        throw new Error(t('Arbeitsgrenze der Schlitzplatzierung erreicht.'));
    }
  }
  if ((r.groups !== undefined && (!Array.isArray(r.groups) || r.groups.length > 64)) ||
    (r.helpers !== undefined && (!Array.isArray(r.helpers) || r.helpers.length > 64))) throw new Error(t('Arbeitsgrenze der Schlitzplatzierung erreicht.'));
  const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 100;
  for (const collection of [r.groups ?? [], r.helpers ?? []]) {
    const ids = collection.map(item => item?.id);
    if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw new Error(t('Ungültige Schnittreferenz.'));
  }
  if (r.settings) straightGeometry(r.base, r.settings.cornerAngle);
  for (const group of r.groups ?? []) {
    if (typeof group.name !== 'string' || group.name.length > 200 || !Number.isFinite(group.burn) || group.burn < 0 || group.burn > 100 || !['corner','loop','backarc'].includes(group.cornerStyle)) throw new Error(t('Ungültige Schlitzmaße oder Korrekturwerte.'));
    slotOutline({ ...group, x: 0, y: 0, angle: 0 });
  }
  r.slots.forEach(s => {
    if (s.mirror !== undefined) mirrorParent(r, s);
    slotOutline(effectiveSlot(r, s));
  });
  const ids=r.slots.map(s=>s.id).filter(id=>id!==undefined);
  if(ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw new Error(t('Ungültige Schnittreferenz.'));
  if (r.order !== undefined) {
    if (!Array.isArray(r.order) || r.order.length > 256) throw new Error(t('Ungültige Schnittreferenz.'));
    const seen = new Set<string>();
    for (const item of r.order) {
      const items = item?.kind === 'group' ? r.groups : item?.kind === 'slot' ? r.slots : item?.kind === 'helper' ? r.helpers : undefined;
      const key = `${item?.kind}:${item?.id}`;
      if (!items?.some(value => value.id === item.id) || seen.has(key)) throw new Error(t('Ungültige Schnittreferenz.'));
      seen.add(key);
    }
  }
  if (r.slots.some(s => s.mirror !== undefined)) resolvedFeatureGeometry(r);
  return r;
}
// Runtime-only orientation: serialized projections always address the actual base edge.
// Reflection may reverse its tangent; preserve semantic parent start/end for dependencies.
const reversedMirrorFrames = new WeakSet<PlacedSlot>();
/** Resolve a DAG of stable slot references before geometry or output is generated. */
export function resolvedFeatureGeometry(r: SlotRecipe): { slots: PlacedSlot[]; helpers: ResolvedConstructionLine[] } {
  const done=new Map<PlacedSlot,PlacedSlot>(),visiting=new Set<PlacedSlot>();
  const helperDone = new Map<SlotConstructionLine, ResolvedConstructionLine>(), helperVisiting = new Set<SlotConstructionLine>();
  const resolveHelper = (id: string): ResolvedConstructionLine => {
    const helper = r.helpers?.find(h => h.id === id);
    if (!helper) throw new Error(t('Referenzierte Hilfslinie fehlt.'));
    const known = helperDone.get(helper); if (known) return known;
    if (helperVisiting.has(helper)) throw new Error(t('Kreisförmige Schnittreferenzen sind nicht erlaubt.'));
    helperVisiting.add(helper);
    const result = resolveConstructionLine(r.base, helper, recipeCornerAngle(r), source => resolvePoint(source, recipeCornerAngle(r)));
    helperVisiting.delete(helper); helperDone.set(helper, result); return result;
  };
  const resolvePoint = (source: SlotOrigin, angle: number): Pt => {
    if (source.kind === 'vertex') {
      const vertex = straightGeometry(r.base, angle).vertices.find(v => v.sub === source.sub && v.node === source.node);
      if (!vertex) throw new Error(t('Referenzecke nicht mehr gültig. Referenz erneut wählen.'));
      return vertex.point;
    }
    if (source.kind === 'curveCorner') {
      const point = curveCorner(r.base, source.sub, source.node);
      if (!point) throw new Error(t('Referenzecke nicht mehr gültig. Referenz erneut wählen.'));
      return point;
    }
    if (source.kind === 'intersection') return resolveConstructionIntersection(resolveHelper(source.helperId), source);
    if (source.kind !== 'slot') throw new Error(t('Ungültige Schnittreferenz.'));
    const parent = r.slots.find(s => s.id === source.slotId);
    if (!parent) throw new Error(t('Referenzierter Schnitt fehlt. Bezug vor dem Löschen ändern.'));
    const resolved = resolve(parent);
    if (!resolved.projection) throw new Error(t('Für diesen Bezug zuerst einen Schnitt mit Projektionskante wählen.'));
    if (!['start','center','end','bottomStart','bottomEnd'].includes(source.point)) throw new Error(t('Ungültige Schnittreferenz.'));
    const frame = projectionFrame(r.base, resolved);
    return frame[source.point === 'start' ? 'a' : source.point === 'end' ? 'b' : source.point];
  };
  const resolve=(slot:PlacedSlot):PlacedSlot=>{
    const known=done.get(slot);if(known)return known;
    if(visiting.has(slot))throw new Error(t('Kreisförmige Schnittreferenzen sind nicht erlaubt.'));
    visiting.add(slot);
    let result: PlacedSlot;
    if (slot.mirror !== undefined) {
      const parent = resolve(mirrorParent(r, slot));
      if (!parent.projection) throw new Error(t('Für diesen Bezug zuerst einen Schnitt mit Projektionskante wählen.'));
      const frame = projectionFrame(r.base, parent), angle = recipeCornerAngle(r);
      const geometry = straightGeometry(r.base, angle), axis = slot.mirror.axis;
      const line = axis.kind === 'helper' ? resolveHelper(axis.helperId) : (() => {
        const edge = geometry.edges.find(e => e.key === axis.edge);
        if (!edge) throw new Error(t('Eine echte gerade Projektionskante wählen. Rundungen sind nicht zulässig.'));
        return { point: edge.a, direction: edge.tangent };
      })();
      const reflectVector = (v: Pt): Pt => {
        const d = v.x * line.direction.x + v.y * line.direction.y;
        return { x: 2 * d * line.direction.x - v.x, y: 2 * d * line.direction.y - v.y };
      };
      const reflect = (p: Pt): Pt => {
        const v = reflectVector({ x: p.x - line.point.x, y: p.y - line.point.y });
        return { x: line.point.x + v.x, y: line.point.y + v.y };
      };
      const a = reflect(frame.a), b = reflect(frame.b), normal = reflectVector(frame.edge.normal);
      const epsilon = 1e-7;
      const edges = geometry.edges.filter(edge => {
        if (Math.hypot(edge.normal.x - normal.x, edge.normal.y - normal.y) > epsilon) return false;
        return [a, b].every(p => {
          const dx = p.x - edge.a.x, dy = p.y - edge.a.y;
          const at = dx * edge.tangent.x + dy * edge.tangent.y;
          return Math.abs(dx * edge.normal.x + dy * edge.normal.y) <= epsilon && at >= -epsilon && at <= edge.length + epsilon;
        });
      });
      if (edges.length !== 1) throw new Error(t('Die gespiegelte Ausklinkung liegt nicht eindeutig und vollständig auf einer passenden geraden Körperkante.'));
      const edge = edges[0], center = reflect(frame.center);
      result = { ...slot, width: parent.width, depth: parent.depth, clearance: parent.clearance, factor: parent.factor,
        burn: parent.burn, cornerStyle: parent.cornerStyle, groupId: parent.groupId,
        x: center.x, y: center.y, angle: Math.atan2(edge.tangent.y, edge.tangent.x) * 180 / Math.PI,
        projection: { edge: edge.key, cornerAngle: angle, origin: { kind: 'slot', slotId: slot.mirror.slotId, point: 'center' }, target: 'center', distance: 0, direction: 1 } };
      if ((b.x - a.x) * edge.tangent.x + (b.y - a.y) * edge.tangent.y < 0) reversedMirrorFrames.add(result);
      visiting.delete(slot); done.set(slot, result); return result;
    }
    result=effectiveSlot(r,slot);
    if(result.projection){
      const p=result.projection;
      const source=p.origin;
      const origin=resolvePoint(source,p.cornerAngle);
      const frame=projectedSlot(r.base,p,result.width*result.factor+result.clearance,result.depth,origin);
      result={...result,x:origin.x,y:origin.y,angle:Math.atan2(frame.edge.tangent.y,frame.edge.tangent.x)*180/Math.PI};
    }
    const ref=slot.anchor?.relative;
    if(ref){
      if(!['start','center','end'].includes(ref.edge))throw new Error(t('Ungültige Schnittreferenz.'));
      const parent=r.slots.find(s=>s.id===ref.slotId);
      if(!parent)throw new Error(t('Referenzierter Schnitt fehlt. Bezug vor dem Löschen ändern.'));
      const resolved=resolve(parent);
      if(!resolved.anchor)throw new Error(t('Nur konturgeführte Schnitte können als Referenz dienen.'));
      const frame=guidedSlot(r.base,resolved);
      const point=ref.edge==='start'?frame.a:ref.edge==='end'?frame.b:slotContourPosition(r.base,resolved.anchor);
      const anchor=slotAnchorFromReference(r.base,point,ref.distance,ref.direction,slot.anchor!.reference);
      if(anchor.contour!==resolved.anchor.contour)throw new Error(t('Ungültige Schnittreferenz.'));
      result={...result,anchor:{...anchor,position:undefined,relative:undefined}};
    }
    visiting.delete(slot);done.set(slot,result);return result;
  };
  const slots = r.slots.map(resolve);
  const helpers = (r.helpers ?? []).map(h => resolveHelper(h.id));
  return { slots, helpers };
}
export function resolvedSlots(r: SlotRecipe): PlacedSlot[] { return resolvedFeatureGeometry(r).slots; }
export function cutSlots(r: SlotRecipe, visibleSlotIds?: ReadonlySet<string>): SubPath[] {
  readSlotRecipe({ recipe: JSON.stringify(r) });
  let material = execute(C.ctUnion, r.base.map(sp => flattenSub(sp, IDENT)), [], F.pftEvenOdd);
  if (material.reduce((n,p)=>n+p.length,0)>50000) throw new Error(t('Arbeitsgrenze der Schlitzplatzierung erreicht.'));
  const resolved = resolvedSlots(r);
  for (let i = 0; i < resolved.length; i++) {
    const slot = resolved[i];
    if (slot.projection && resolved.some((other, j) => j < i && other.projection && (slot.mirror || other.mirror) &&
      ['width','depth','clearance','factor','burn','cornerStyle'].every(key => slot[key as keyof PlacedSlot] === other[key as keyof PlacedSlot]) && (() => {
        const a = projectionFrame(r.base, slot), b = projectionFrame(r.base, other);
        return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < 1e-7 &&
          Math.hypot(a.edge.normal.x - b.edge.normal.x, a.edge.normal.y - b.edge.normal.y) < 1e-7;
      })())) throw new Error(t('Gespiegelter Schnitt erzeugt einen doppelten Ausschnitt.'));
    if (visibleSlotIds && (slot.id === undefined || !visibleSlotIds.has(slot.id))) continue;
    const paths = slot.projection && slot.groupId !== undefined
      ? manufacturedSlotPaths(projectionFrame(r.base, slot), { burn: slot.burn ?? 0, cornerStyle: slot.cornerStyle ?? 'corner' })
      : [slot.projection ? projectionFrame(r.base,slot).outline : slot.anchor ? guidedSlot(r.base, slot).outline : slotOutline(slot)];
    const flattened = paths.map(path => flattenSub(path, IDENT));
    const cutter=slot.projection && slot.groupId !== undefined ? execute(C.ctUnion, flattened, [], F.pftNonZero) : flattened;
    if (!execute(C.ctIntersection, material, cutter, F.pftNonZero).length)
      throw new Error(t('Der Ausschnitt trifft kein verbleibendes Material.'));
    material = execute(C.ctDifference, material, cutter, F.pftNonZero);
  }
  if (!material.length || material.reduce((n,p)=>n+Math.abs(Clipper.Area(p)),0)<1)
    throw new Error(t('Die Ausschnitte entfernen das gesamte Material.'));
  return material.map(p=>({ closed:true, nodes:p.map(q=>({x:q.X/SCALE,y:q.Y/SCALE})) }));
}
/** Resolved projection slots store the reference point in x/y, never in document data. */
export function projectionFrame(base: SubPath[], slot: PlacedSlot): ProjectionFrame {
  if(!slot.projection)throw new Error(t('Ungültige Schnittreferenz.'));
  const frame = projectedSlot(base,slot.projection,slot.width*slot.factor+slot.clearance,slot.depth,{x:slot.x,y:slot.y});
  if (!reversedMirrorFrames.has(slot)) return frame;
  return { ...frame, a: frame.b, b: frame.a, bottomStart: frame.bottomEnd, bottomEnd: frame.bottomStart,
    edge: { ...frame.edge, tangent: { x: -frame.edge.tangent.x, y: -frame.edge.tangent.y } } };
}
export const SLOT_PLACEMENT: Generator = {
  id:SLOT_GENERATOR, version:1, kind:'part', name:t('Parametrische Schlitze / Ausklinkungen'), icon:'slots',
  schema:[{key:'recipe',label:t('Schlitzdefinition'),type:'data',def:''}],
  validate(p) { try { cutSlots(readSlotRecipe(p)); return []; } catch(e) { return [{level:'error',msg:e instanceof Error?e.message:String(e)}]; } },
  generate(p) { return {parts:[{key:'part',subs:cutSlots(readSlotRecipe(p)),at:{x:0,y:0}}],info:[]}; },
  label:()=>t('Parametrische Schlitze / Ausklinkungen'),
};
