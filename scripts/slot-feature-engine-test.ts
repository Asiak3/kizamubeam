import './core-fixtures-env';
import assert from 'node:assert/strict';
import type { SlotRecipe, PlacedSlot, SlotGroup } from '../src/slotPlacement';
import type { SlotOrigin } from '../src/straightSlots';
const { adoptSlotFeatureRecipe, readSlotRecipe, resolvedFeatureGeometry, resolvedSlots, effectiveSlot, projectionFrame, cutSlots, SLOT_GENERATOR } = await import('../src/slotPlacement');
const { applySlotRecipe } = await import('../src/slotLegacyDialog');
const { getGenerator } = await import('../src/generators');
const base = [{ closed: true, nodes: [{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}] }];
const slot = (id: string, distance = 25): PlacedSlot => ({ id, x:0,y:0,angle:0,width:10,depth:6,clearance:0,factor:1,
  projection:{edge:'0:0:0',origin:{kind:'vertex',sub:0,node:0},target:'center',distance,direction:1,cornerAngle:45} });
const recipe = (): SlotRecipe => ({source:{kind:'path',subs:structuredClone(base)},base:structuredClone(base),slots:[slot('a'),slot('b',60)]});
const group = (): SlotGroup => ({id:'g',name:'Test',width:12,depth:8,clearance:1,factor:1.1,burn:0,cornerStyle:'corner'});
let passed=0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
test('group values override every instance and propagate into dependent nominal datums', () => {
  const r=recipe(); r.groups=[group()]; r.slots[0].groupId='g';
  r.slots[1].projection!.origin={kind:'slot',slotId:'a',point:'end'};
  r.slots[1].projection!.distance=10;
  const first=resolvedSlots(r); assert.equal(first[0].width,12); assert.equal(first[0].depth,8);
  assert.equal(first[0].clearance,1); assert.equal(first[0].factor,1.1);
  assert.equal(first[1].x,projectionFrame(r.base,first[0]).b.x);
  r.groups[0].width=20;
  assert.ok(resolvedSlots(r)[1].x>first[1].x);
  assert.equal(r.slots[0].width,10);
  r.groups[0].burn=.1; r.groups[0].cornerStyle='loop';
  assert.equal(effectiveSlot(r,r.slots[0]).burn,.1); assert.equal(effectiveSlot(r,r.slots[0]).cornerStyle,'loop');
});
test('roundtrip retains source, groups, helpers and presentation order without changing evaluation', () => {
  const r=adoptSlotFeatureRecipe(recipe());
  r.order=[{kind:'slot',id:'b'},{kind:'group',id:r.groups![0].id},{kind:'slot',id:'a'}];
  const restored=readSlotRecipe({recipe:JSON.stringify(r)});
  assert.deepEqual(restored,r); assert.deepEqual(resolvedSlots(restored).map(s=>s.id),['a','b']);
  const without={...r,order:undefined}; assert.deepEqual(cutSlots(r),cutSlots(without));
});
test('adoption is immutable and preserves legacy cut output for zero correction', () => {
  const r=recipe(), old=structuredClone(r), adopted=adoptSlotFeatureRecipe(r);
  assert.deepEqual(r,old); assert.notEqual(adopted.source,r.source); assert.equal(adopted.settings!.cornerAngle,45);
  assert.deepEqual(cutSlots(adopted),cutSlots(r)); assert.equal(adopted.groups!.length,1);
  r.slots[1].projection!.cornerAngle=20;
  assert.throws(()=>adoptSlotFeatureRecipe(r));
  assert.equal(adoptSlotFeatureRecipe(r,20).settings!.cornerAngle,20);
});
test('global angle overrides all projections but legacy per-projection values remain untouched', () => {
  const r=recipe(); r.slots[0].projection!.cornerAngle=30; r.slots[1].projection!.cornerAngle=70;
  assert.deepEqual(resolvedSlots(r).map(s=>s.projection!.cornerAngle),[30,70]);
  r.settings={cornerAngle:20}; assert.deepEqual(resolvedSlots(r).map(s=>s.projection!.cornerAngle),[20,20]);
  assert.equal(r.slots[0].projection!.cornerAngle,30);
});
test('manufacturing changes cutters, never nominal frames or legacy free/contour correction', () => {
  const r=adoptSlotFeatureRecipe(recipe());
  const frame=projectionFrame(r.base,resolvedSlots(r)[0]), plain=cutSlots(r);
  r.groups![0].burn=.1;
  assert.deepEqual(projectionFrame(r.base,resolvedSlots(r)[0]),frame);
  assert.notDeepEqual(cutSlots(r),plain);
  const free=recipe(); free.slots=[{...slot('free'),projection:undefined,x:50,y:40}];
  const adopted=adoptSlotFeatureRecipe(free); adopted.groups![0].burn=.1; adopted.groups![0].cornerStyle='loop';
  assert.deepEqual(cutSlots(adopted),cutSlots(free));
  const contour=recipe(); contour.slots=[{...slot('contour'),projection:undefined,anchor:{contour:0,fraction:.15,reference:'curve'}}];
  const guided=adoptSlotFeatureRecipe(contour); guided.groups![0].burn=.1; guided.groups![0].cornerStyle='loop';
  assert.deepEqual(cutSlots(guided),cutSlots(contour));
});
test('scoped identifiers, missing groups, duplicates and budgets are validated', () => {
  const parse=(r:SlotRecipe)=>readSlotRecipe({recipe:JSON.stringify(r)});
  let r=recipe(); r.slots[0].groupId='missing'; assert.throws(()=>parse(r));
  r=recipe(); r.groups=[group(),group()]; assert.throws(()=>parse(r));
  r=recipe(); r.slots[1].id='a'; assert.throws(()=>parse(r));
  r=recipe(); r.groups=Array.from({length:65},(_,i)=>({...group(),id:String(i)})); assert.throws(()=>parse(r));
  r=recipe(); r.helpers=Array.from({length:65},(_,i)=>({id:String(i),first:{kind:'vertex',sub:0,node:0},second:{kind:'vertex',sub:0,node:2},edge:'0:0:0'})); assert.throws(()=>parse(r));
  r=recipe(); r.groups=[{...group(),id:'a'}]; r.slots[0].groupId='a'; parse(r);
  r.order=[{kind:'helper',id:'missing'}]; assert.throws(()=>parse(r));
});
test('one DAG resolves helper intersections, follows group datums, and never cuts helpers', () => {
  const r=recipe(); r.slots=[slot('a')];
  r.helpers=[{id:'h',first:{kind:'slot',slotId:'a',point:'bottomStart'},second:{kind:'slot',slotId:'a',point:'bottomEnd'},edge:'0:0:0'}];
  const initial=resolvedFeatureGeometry(r); assert.equal(initial.helpers.length,1);
  const intersection=initial.helpers[0].intersections.find(i=>i.point.y===80)!; assert.ok(intersection);
  assert.deepEqual(cutSlots(r),cutSlots({...r,helpers:[]}));
  const child=slot('b'); child.projection!.origin=intersection.origin; child.projection!.distance=10;
  r.slots.push(child); assert.equal(resolvedSlots(r)[1].x,25);
  r.slots[0].projection!.distance=35; assert.ok(Math.abs(resolvedSlots(r)[1].x-35)<1e-8);
  const wrong={...intersection.origin,count:intersection.origin.count+1}; child.projection!.origin=wrong;
  assert.throws(()=>resolvedSlots(r));
});
test('mixed cycles and missing slot/helper references reject', () => {
  const r=recipe();
  const ref:SlotOrigin={kind:'intersection',helperId:'h',sub:0,segment:2,root:0,count:1};
  r.slots[0].projection!.origin=ref;
  assert.throws(()=>resolvedSlots(r));
  r.helpers=[{id:'h',first:{kind:'slot',slotId:'a',point:'start'},second:{kind:'vertex',sub:0,node:2},edge:'0:0:0'}];
  assert.throws(()=>resolvedSlots(r),/Kreisförmige/);
  r.helpers[0].first={kind:'slot',slotId:'missing',point:'start'};
  assert.throws(()=>resolvedSlots(r));
  r.helpers[0].first=ref; assert.throws(()=>resolvedSlots(r),/Kreisförmige/);
});
test('opposite projection-edge traversal rejects outside placement and recovers without rebinding dependencies', () => {
  const r=adoptSlotFeatureRecipe(recipe()); r.slots=[slot('a')];
  r.slots[0].groupId=r.groups![0].id;
  r.slots[0].projection!.target='start'; r.slots[0].projection!.distance=10;
  const child=slot('b'); child.projection!.origin={kind:'slot',slotId:'a',point:'end'}; child.projection!.distance=15; r.slots.push(child);
  const original=structuredClone(r), prior=cutSlots(r);
  r.slots[0].projection!.edge='0:2:2';
  assert.throws(()=>cutSlots(r),/Kantenbereich/);
  assert.equal(r.slots[0].projection!.direction,1); assert.equal(r.slots[0].projection!.distance,10);
  assert.deepEqual(r.slots[1].projection!.origin,original.slots[1].projection!.origin);
  r.slots[0].projection!.direction=-1;
  assert.ok(cutSlots(r).length); assert.equal(resolvedSlots(r)[1].x,0);
  r.slots[0].projection=structuredClone(original.slots[0].projection);
  assert.deepEqual(cutSlots(r),prior);
});
test('all five generator identities remain readable, mirrors have an isolated identity', () => {
  assert.equal(SLOT_GENERATOR,'slot-placement-mirrors');
  for(const id of ['slot-placement','slot-placement-contour','slot-placement-projection','slot-placement-features',SLOT_GENERATOR]) assert.equal(getGenerator(id)!.id,id);
});
test('layer/local correction conflict rejects before snapshot, mutation or layer edits', () => {
  const r=adoptSlotFeatureRecipe(recipe()); r.groups![0].burn=.1;
  const obj={shape:structuredClone(r.source),layer:1}, original=structuredClone(obj); let snapshots=0;
  const ed={state:()=> 'stamp',doc:{objs:[obj],layers:{1:{kerf:.2}}},selectable:()=>true,snapshot:()=>{snapshots++;},touch:()=>{},emit:()=>{}};
  assert.throws(()=>applySlotRecipe(ed as never,obj as never,r,'stamp',false),/Layer-Kerf/);
  assert.equal(snapshots,0); assert.deepEqual(obj,original); assert.equal(ed.doc.layers[1].kerf,.2);
  ed.doc.layers[1].kerf=0; applySlotRecipe(ed as never,obj as never,r,'stamp',false);
  assert.equal(snapshots,1); assert.equal(obj.shape.kind,'gen');
});
console.log(`Slot feature engine: ${passed} passed.`);
