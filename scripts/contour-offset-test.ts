import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { IDENT, newId, newDoc, loadDoc, apply, defaultLayer } = await import('../src/model');
const { shapeSubs } = await import('../src/geom');
const { offsetSource, offsetContours, offsetResults, readContourOffset, contourOffsetShape, CONTOUR_OFFSET_ID, legacyOffsetContours } = await import('../src/contourOffset');
const { buildGen, getGenerator } = await import('../src/generators');
type Obj = import('../src/model').Obj;
type Sub = import('../src/model').SubPath;
type E = import('../src/editor').Editor;
const ring = (x: number, y: number, w: number, h: number): Sub => ({ closed: true, nodes: [{ x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }] });
const path = (subs: Sub[]): Obj => ({ id: newId(), layer: 0, m: [...IDENT], shape: { kind: 'path', subs } });
const line = (coords: number[][]) => path([{ closed: false, nodes: coords.map(([x,y]) => ({ x,y })) }]);
function editor(objects: Obj[]): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets:new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: false, snapObjects: false, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [], canvas: { style: {} } });
  ed.doc.objs = [...objects]; ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  // These fixtures model line cutting; fill-layer split ownership is tested
  // separately as an unsafe output, not silently treated as a valid cut.
  ed.doc.layers[0] = { ...defaultLayer(0), mode: 'line' };
  return ed;
}
const near = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-6, `${a} != ${b}`);
const bounds = (sp: Sub) => ({ x0: Math.min(...sp.nodes.map(n=>n.x)), x1: Math.max(...sp.nodes.map(n=>n.x)), y0: Math.min(...sp.nodes.map(n=>n.y)), y1: Math.max(...sp.nodes.map(n=>n.y)) });
let count=0;
function test(name: string, fn:()=>void) { fn(); count++; console.log('PASS '+name); }

test('one hole shrinks, outside and all metadata remain unchanged, Kerf stays independent', () => {
  const outer=ring(0,0,100,60),hole=ring(20,20,20,10),o=path([outer,hole]);
  o.name='Original'; o.noLaser=true; const ed=editor([o]); ed.doc.layers[0]={...defaultLayer(0),kerf:.12};
  const before=ed.state(),s=ed.prepareContourOffset();
  assert.equal(ed.state(),before);assert.equal(s.plan.contours.length,2);
  ed.applyContourOffset(s,new Map([[s.plan.contours[1].key,-.2]]));
  assert.equal(o.shape.kind,'gen'); const r=readContourOffset(o.shape)!;
  assert.deepEqual(r.result[0],outer);assert.equal(o.name,'Original');assert.equal(o.noLaser,true);near(ed.doc.layers[0].kerf,.12);
  const b=bounds(r.result[1]);near(b.x0,20.2);near(b.x1,39.8);near(b.y0,20.2);near(b.y1,29.8);
  assert.deepEqual(r.base,[outer,hole]);assert.equal(ed.history.position,1);
  const after=ed.state();ed.doUndo();assert.equal(ed.state(),before);ed.doRedo();assert.equal(ed.state(),after);
});
test('split contour stays in four original objects under two original nested groups', () => {
  const a=line([[0,0],[100,0]]),b=line([[100,60],[100,0]]),c=line([[100,60],[0,60]]),d=line([[0,60],[0,0]]);
  const left:Obj={id:newId(),m:[...IDENT],layer:0,name:'Left',shape:{kind:'group',children:[a,b]}};
  const right:Obj={id:newId(),m:[...IDENT],layer:0,name:'Right',shape:{kind:'group',children:[c,d]}};
  const ed=editor([left,right]),before=ed.state(),s=ed.prepareContourOffset();
  assert.equal(s.plan.contours.length,1);ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  assert.deepEqual(ed.doc.objs,[left,right]);assert.equal(left.shape.kind,'group');
  assert.equal((left.shape as {children:Obj[]}).children[0],a);assert.equal((right.shape as {children:Obj[]}).children[1],d);
  for(const o of [a,b,c,d]) {assert.equal(o.shape.kind,'gen');assert.equal(shapeSubs(o.shape).length,1);assert.equal(shapeSubs(o.shape)[0].closed,false);}
  const sa=shapeSubs(a.shape)[0],sb=shapeSubs(b.shape)[0],sc=shapeSubs(c.shape)[0],sd=shapeSubs(d.shape)[0];
  assert.deepEqual(sa.nodes.at(-1),sb.nodes.at(-1));assert.deepEqual(sb.nodes[0],sc.nodes[0]);assert.deepEqual(sc.nodes.at(-1),sd.nodes[0]);assert.deepEqual(sd.nodes.at(-1),sa.nodes[0]);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('tolerance is explicit, closure never edits the original subpaths', () => {
  const a=line([[0,0],[10,0],[10,10]]),b=line([[10,10.04],[0,10],[0,0]]),ed=editor([a,b]),before=ed.state();
  const s=ed.prepareContourOffset(.01);assert.equal(s.plan.contours.length,0);
  ed.updateContourOffset(s,.05);assert.equal(s.plan.contours.length,1);assert.equal(ed.state(),before);
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.1]]));
  assert.deepEqual(readContourOffset(a.shape)!.source,JSON.parse(before).doc.pages[0].objs[0].shape);
});
test('destructive split-owner offsets preserve every nested root, layer, matrix and output flag', () => {
  const a=line([[0,0],[20,0],[20,10]]),b=line([[20,10],[0,10],[0,0]]);b.layer=1;b.noLaser=true;
  const root:Obj={id:newId(),layer:0,m:[0,1,-1,0,80,40],shape:{kind:'group',children:[a,b]}};
  const ed=editor([root]),before=ed.state(),s=ed.prepareContourOffset();
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]),true,true);
  assert.equal(ed.doc.objs[0],root);assert.deepEqual((root.shape as {children:Obj[]}).children,[a,b]);
  assert.equal(a.shape.kind,'path');assert.equal(b.shape.kind,'path');assert.equal(b.layer,1);assert.equal(b.noLaser,true);
  assert.deepEqual(root.m,[0,1,-1,0,80,40]);assert.deepEqual(a.m,IDENT);assert.deepEqual(b.m,IDENT);
  assert.equal(ed.history.position,1);ed.doUndo();assert.equal(ed.state(),before);
});
test('curved whole-subpath inset uses bounded geometry without microsegment collapse', () => {
  const o:Obj={id:newId(),layer:0,m:[...IDENT],shape:{kind:'ellipse',rx:20,ry:10}},ed=editor([o]),s=ed.prepareContourOffset();
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  const b=bounds(shapeSubs(o.shape)[0]);assert.ok(Math.abs(b.x1-19.8)<.01);assert.ok(Math.abs(b.y1-9.8)<.01);
  assert.deepEqual(readContourOffset(o.shape)!.source,{kind:'ellipse',rx:20,ry:10});
});
test('reopening changes the original recipe noncumulatively and removing it restores the exact shape', () => {
  const o=path([ring(0,0,20,10)]),original=structuredClone(o.shape),ed=editor([o]);
  let s=ed.prepareContourOffset();ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  s=ed.prepareContourOffset();near(s.plan.contours[0].distance,-.2);ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.4]]));
  near(bounds(shapeSubs(o.shape)[0]).x0,.4);assert.deepEqual(readContourOffset(o.shape)!.source,original);
  s=ed.prepareContourOffset();ed.applyContourOffset(s,new Map());assert.deepEqual(o.shape,original);
});
test('save/load and generator regeneration retain cached output and editable original', () => {
  const o=path([ring(0,0,20,10)]),ed=editor([o]),s=ed.prepareContourOffset();ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,.3]]));
  const doc=loadDoc(JSON.parse(JSON.stringify(ed.doc))),restored=doc.objs[0];
  assert.deepEqual(restored.shape,o.shape);const shape=restored.shape as import('../src/model').GenShape;
  const rebuilt=buildGen(getGenerator(CONTOUR_OFFSET_ID)!,shape.params);assert.equal(rebuilt.issues.length,0);assert.deepEqual(rebuilt.parts[0].shape.subs,shape.subs);
});
test('permanent mode requires confirmation and preserves object/root identity; Undo restores recipes', () => {
  const o=path([ring(0,0,20,10)]),ed=editor([o]);let s=ed.prepareContourOffset();ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  const before=ed.state();s=ed.prepareContourOffset();const values=new Map([[s.plan.contours[0].key,-.2]]);
  assert.throws(()=>ed.applyContourOffset(s,values,true));assert.equal(ed.state(),before);
  ed.applyContourOffset(s,values,true,true);assert.equal(ed.doc.objs[0],o);assert.equal(o.shape.kind,'path');near(bounds(shapeSubs(o.shape)[0]).x0,.2);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('global transforms offset in world millimetres and keep local matrices intact', () => {
  const o=path([ring(0,0,20,10)]);o.m=[0,2,-1,0,80,40];const ed=editor([o]),s=ed.prepareContourOffset();
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));assert.deepEqual(o.m,[0,2,-1,0,80,40]);
  const points=shapeSubs(o.shape)[0].nodes.map(p=>apply(o.m,p.x,p.y));near(Math.min(...points.map(p=>p.x)),70.2);near(Math.min(...points.map(p=>p.y)),40.2);
});
test('collapses, self intersections, collisions and changed nesting fail before mutation', () => {
  for(const amount of [-6,20]) {
    const o=path([ring(0,0,10,10),ring(2,2,2,2)]),ed=editor([o]),s=ed.prepareContourOffset(),before=ed.state();
    assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[1].key,amount]])));assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  }
  const o=path([ring(0,0,50,50),ring(2,2,4,4),ring(7,2,4,4)]),ed=editor([o]),s=ed.prepareContourOffset(),before=ed.state();
  assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[1].key,1]])));assert.equal(ed.state(),before);
});
test('partially selected or separately moved recipe participants cannot silently rebind', () => {
  const a=line([[0,0],[20,0],[20,10]]),b=line([[20,10],[0,10],[0,0]]),ed=editor([a,b]);
  const s=ed.prepareContourOffset();ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  ed.sel=[a];assert.throws(()=>ed.prepareContourOffset());ed.sel=[a,b];a.m[4]=.005;
  assert.throws(()=>ed.prepareContourOffset(.01));
});
test('a branch no longer hides the closed face; the extra source remains untouched', () => {
  const os=[line([[0,0],[10,0]]),line([[10,0],[10,10],[0,10],[0,0]]),line([[10,0],[20,0]])],ed=editor(os),before=ed.state();
  const s=ed.prepareContourOffset();assert.equal(s.plan.contours.length,1);assert.equal(s.plan.unused,1);assert.equal(ed.state(),before);
  const extra=structuredClone(os[2]);ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));assert.deepEqual(os[2],extra);
});
test('T junction and endpoint-to-edge tolerance match exterior recognition, with exact retained tails', () => {
  const os=[line([[-1,0],[11,0]]),line([[10,.04],[10,10]]),line([[10,10],[0,10],[0,0]])],ed=editor(os),before=ed.state();
  const s=ed.prepareContourOffset(.01);assert.equal(s.plan.contours.length,0);
  ed.updateContourOffset(s,.05);assert.equal(s.plan.contours.length,1);assert.equal(s.plan.contours[0].blocked,undefined);
  const amounts=new Map([[s.plan.contours[0].key,-.2]]),computed=offsetResults(s.sources,s.plan,amounts,s.tolerance);
  assert.throws(()=>ed.applyContourOffset(s,amounts),/Ergebnis gesperrt/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  assert.equal(ed.doc.objs[0],os[0]);const subs=computed.recipes[0]!.result;assert.equal(subs.length,3);
  assert.deepEqual(subs[0].nodes.map(({x,y})=>({x,y})),[{x:-1,y:0},{x:0,y:0}]);assert.deepEqual(subs[2].nodes.map(({x,y})=>({x,y})),[{x:10,y:0},{x:11,y:0}]);
  const reopened=s.sources.map((source,i)=>offsetSource(source.id,contourOffsetShape(computed.recipes[i]!),source.m));
  const updated=offsetContours(reopened,.05);near(updated.contours[0].distance,-.2);
  const recomputed=offsetResults(reopened,updated,new Map([[updated.contours[0].key,-.3]]),.05);
  assert.ok(recomputed.recipes[0]!.result.some(p=>p.nodes.some(n=>Math.abs(n.y-.3)<1e-6)));
});
test('crossing lines create the same exterior without merging source objects, even destructively', () => {
  const os=[line([[-2,0],[12,0]]),line([[10,-2],[10,12]]),line([[12,10],[-2,10]]),line([[0,12],[0,-2]])],ed=editor(os),before=ed.state();
  const s=ed.prepareContourOffset();assert.equal(s.plan.contours.length,1);assert.ok(!s.plan.contours[0].blocked);
  const amounts=new Map([[s.plan.contours[0].key,-.1]]),computed=offsetResults(s.sources,s.plan,amounts,s.tolerance);
  assert.equal(ed.doc.objs.length,4);os.forEach((o,i)=>{assert.equal(ed.doc.objs[i],o);assert.equal(o.shape.kind,'path');assert.equal(computed.recipes[i]!.result.length,3);});
  assert.throws(()=>ed.applyContourOffset(s,amounts,true,true),/Ergebnis gesperrt/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
});
test('duplicate owners and shared contour boundaries are recognised but cannot be silently reassigned', () => {
  const os=[line([[0,0],[10,0]]),line([[10,0],[10,10],[0,10],[0,0]]),line([[0,0],[10,0]])],ed=editor(os),before=ed.state(),s=ed.prepareContourOffset();
  assert.equal(s.plan.contours.length,1);assert.ok(s.plan.contours[0].blocked);
  assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.1]])));assert.equal(ed.state(),before);
  const shared=editor([path([ring(0,0,100,100),ring(20,20,60,60)]),line([[50,20],[50,80]])]),p=shared.prepareContourOffset();
  assert.equal(p.plan.contours.length,3);assert.throws(()=>shared.applyContourOffset(p,new Map([[p.plan.contours[1].key,-.2]])));assert.equal(shared.history.position,0);
});
test('V1 recipes remain readable, retain their cache on reopen and adopt V2 only on Apply', () => {
  const o=path([ring(0,0,20,10)]),source=offsetSource(o.id,o.shape,o.m);
  const p=legacyOffsetContours([source],.01),r=offsetResults([source],p,new Map([[p.contours[0].key,-.2]]),.01).recipes[0]!;
  assert.equal(r.version,1);o.shape=contourOffsetShape(r);const ed=editor([o]),before=ed.state(),s=ed.prepareContourOffset();
  assert.equal(ed.state(),before);near(s.plan.contours[0].distance,-.2);
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.3]]));assert.equal(readContourOffset(o.shape)!.version,2);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('two selected faces on one original subpath persist independently without moving the bridge', () => {
  const loops=line([[20,20],[30,20],[30,30],[20,30],[20,20],[50,10],[50,20],[60,20],[60,30],[50,30],[50,20]]);
  const ed=editor([path([ring(0,0,100,100)]),loops]),before=ed.state(),s=ed.prepareContourOffset();
  assert.equal(s.plan.contours.length,3);
  const selected=s.plan.contours.filter(c=>c.members.some(m=>s.sources[m.owner].id===loops.id));assert.equal(selected.length,2);
  ed.applyContourOffset(s,new Map(selected.map(c=>[c.key,-.2])));
  const r=readContourOffset(loops.shape)!;assert.equal(r.version,2);assert.equal(r.edits.length,2);assert.equal(r.base.length,1);assert.equal(r.result.length,3);
  assert.ok(r.result.some(p=>p.nodes.some(n=>n.x===50&&n.y===10)));
  const reopened=ed.prepareContourOffset();assert.equal(reopened.plan.contours.filter(c=>c.distance===-.2).length,2);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('one leaf with several contributing subpaths retains its identity without artificial offset seams', () => {
  const untouched=ring(40,40,5,5);
  const source=path([
    {closed:false,nodes:[{x:0,y:0},{x:20,y:0},{x:20,y:10}]},
    {closed:false,nodes:[{x:20,y:10},{x:0,y:10},{x:0,y:0}]},
    untouched,
  ]);
  source.name='Original leaf';source.noLaser=true;
  const group:Obj={id:newId(),m:[0,1,-1,0,80,40],layer:0,shape:{kind:'group',children:[source]}};
  const ed=editor([group]),before=ed.state(),s=ed.prepareContourOffset();
  const contour=s.plan.contours.find(c=>c.members.some(m=>m.sub===0))!;
  assert.ok(contour.members.length>1);assert.ok(contour.members.every(m=>m.owner===0));
  ed.applyContourOffset(s,new Map([[contour.key,-.2]]));
  const recipe=readContourOffset(source.shape)!;
  assert.equal(ed.doc.objs[0],group);assert.equal(group.shape.kind,'group');
  assert.equal(group.shape.children[0],source);assert.equal(source.name,'Original leaf');assert.equal(source.noLaser,true);
  assert.equal(recipe.edits.length,2);assert.equal(recipe.result.length,2);
   assert.equal(recipe.result[0].closed,true);
   assert.notDeepEqual(recipe.result[0].nodes[0],recipe.result[0].nodes.at(-1));
  assert.deepEqual(recipe.result[1],untouched);
  assert.deepEqual(recipe.base,JSON.parse(before).doc.pages[0].objs[0].shape.children[0].shape.subs);
  const reopened=ed.prepareContourOffset();assert.equal(reopened.plan.contours.filter(c=>c.distance===-.2).length,1);
  assert.equal(ed.history.position,1);ed.doUndo();assert.equal(ed.state(),before);
});
test('newly closed open-span loops require explicit layer-Kerf acknowledgment before mutation', () => {
  const source=path([{closed:false,nodes:[{x:0,y:0},{x:20,y:0},{x:20,y:10}]},
    {closed:false,nodes:[{x:20,y:10},{x:0,y:10},{x:0,y:0}]}]);
  const ed=editor([source]);ed.doc.layers[0]={...defaultLayer(0),kerf:.06};
  const before=ed.state(),s=ed.prepareContourOffset(),amounts=new Map([[s.plan.contours[0].key,-.2]]);
  assert.throws(()=>ed.applyContourOffset(s,amounts),/Layer-Kerf/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  ed.applyContourOffset(s,amounts,false,false,{confirmedClosureKerf:true});
  assert.equal(readContourOffset(source.shape)!.result[0].closed,true);
  near(ed.doc.layers[0].kerf,.06);ed.doUndo();assert.equal(ed.state(),before);
});
test('explicit remainder removal is recoverable and cannot remove unselected contour spans', () => {
  const source=line([[-5,0],[0,0],[20,0],[20,10],[0,10],[0,0]]),ed=editor([source]);
  const before=ed.state(),s=ed.prepareContourOffset(),amounts=new Map([[s.plan.contours[0].key,-.2]]);
  const result=offsetResults(s.sources,s.plan,amounts,s.tolerance);
  const part=result.remainders.find(r=>!r.protected)!;assert.ok(part);
  const removeRemainders=new Set([part.key]);
  assert.throws(()=>ed.applyContourOffset(s,amounts,false,false,{removeRemainders}),/bestätigt/);
  assert.equal(ed.state(),before);
  ed.applyContourOffset(s,amounts,false,false,{removeRemainders,confirmedRemainderRemoval:true});
  assert.equal(readContourOffset(source.shape)!.trimmed!.length,1);
  assert.deepEqual(readContourOffset(source.shape)!.base,s.sources[0].base);
  const again=ed.prepareContourOffset();ed.applyContourOffset(again,amounts);
  assert.equal(readContourOffset(source.shape)!.trimmed!.length,1);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('near-collinear dead-end branches do not create a false complete ownership route', () => {
  const outline=path([ring(0,0,10,10)]),spur=line([[0,0],[.1,.001]]),ed=editor([outline,spur]);
  const before=structuredClone(spur),s=ed.prepareContourOffset(0);
  assert.equal(s.plan.contours.length,1);assert.equal(s.plan.contours[0].blocked,undefined);
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  assert.deepEqual(spur,before);assert.equal(readContourOffset(outline.shape)!.result[0].closed,true);
});
test('same-leaf compaction never bypasses fixed-start protection', () => {
  const source=path([{closed:false,start:true,nodes:[{x:0,y:0},{x:20,y:0},{x:20,y:10}]},
    {closed:false,nodes:[{x:20,y:10},{x:0,y:10},{x:0,y:0}]}]);
  const ed=editor([source]),s=ed.prepareContourOffset(),before=ed.state();
  assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]])),/Startpunkt/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
});
test('a fixed whole-contour start survives even when Clipper removes the collinear source vertex', () => {
  const source=path([{closed:true,start:true,nodes:[{x:5,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:0}]}]),ed=editor([source]),s=ed.prepareContourOffset();
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));const p=shapeSubs(source.shape)[0];
  assert.equal(p.start,true);near(p.nodes[0].x,5);near(p.nodes[0].y,.2);
});
test('unselected curves and start flags stay exact; parameter source definitions survive', () => {
  const curve:Sub={closed:true,start:true,nodes:[{x:50,y:50,cout:{x:60,y:50},cin:{x:40,y:50}},{x:50,y:60,cin:{x:60,y:60},cout:{x:40,y:60}}]};
  const o=path([ring(0,0,10,10),curve]),ed=editor([o]),s=ed.prepareContourOffset();ed.applyContourOffset(s,new Map([[s.plan.contours.find(c=>c.members.some(m=>m.sub===0))!.key,.1]]));
  assert.deepEqual(shapeSubs(o.shape)[1],curve);
  const g:Obj={id:newId(),m:[...IDENT],layer:0,shape:{kind:'gen',gen:'test-source',v:7,params:{width:20},subs:[ring(0,0,20,10)]}};
  const eg=editor([g]),before=structuredClone(g.shape),sg=eg.prepareContourOffset();eg.applyContourOffset(sg,new Map([[sg.plan.contours[0].key,-.1]]));
  assert.deepEqual(readContourOffset(g.shape)!.source,before);
});
test('invalid values, hidden/locked sources, bindings and stale sessions reject without snapshots', () => {
  for(const value of [NaN,Infinity,.0001,21]) {
    const ed=editor([path([ring(0,0,20,10)])]),s=ed.prepareContourOffset();assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,value]])));assert.equal(ed.history.position,0);
  }
  for(const patch of [{hidden:true},{locked:true},{bind:{w:'20'}}]) {const o=path([ring(0,0,20,10)]);Object.assign(o,patch);assert.throws(()=>editor([o]).prepareContourOffset());}
  const ed=editor([path([ring(0,0,20,10)])]),s=ed.prepareContourOffset();ed.sel[0].m[4]++;
  assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]])));assert.equal(ed.history.position,0);
});
test('explicit derived assembly requires acknowledgment, uses selected host and preserves original objects with Undo', () => {
  const a=line([[0,0],[20,0],[20,10]]),b=line([[0,0],[0,10],[20,10]]);b.layer=1;
  const ed=editor([a,b]);ed.doc.layers[0]={...defaultLayer(0),mode:'line',kerf:.06};
  ed.doc.layers[1]={...defaultLayer(1),mode:'line',kerf:.12};
  const s=ed.prepareContourOffset(),amounts=new Map([[s.plan.contours[0].key,-.2]]),assemblyOwners=new Map([[s.plan.contours[0].key,b.id]]),before=ed.state();
  assert.throws(()=>ed.applyContourOffset(s,amounts,false,false,{assemblyOwners}),/ausdrücklich bestätigt/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  ed.applyContourOffset(s,amounts,false,false,{assemblyOwners,confirmedAssembly:true,confirmedClosureKerf:true});
  assert.equal(ed.doc.objs[0],a);assert.equal(ed.doc.objs[1],b);
  assert.equal(readContourOffset(a.shape)!.result.length,0);
  assert.equal(readContourOffset(b.shape)!.result.filter(p=>p.closed).length,1);
  assert.equal(readContourOffset(a.shape)!.edits[0].outputOwner,b.id);
  assert.equal(ed.doc.layers[0].kerf,.06);assert.equal(ed.doc.layers[1].kerf,.12);
  const reopened=ed.prepareContourOffset();ed.applyContourOffset(reopened,amounts,false,false,{confirmedClosureKerf:true});
  assert.equal(readContourOffset(ed.sel[1].shape)!.edits[0].outputOwner,b.id);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('derived assembly cannot silently activate differently disabled source spans', () => {
  const a=line([[0,0],[20,0],[20,10]]),b=line([[0,0],[0,10],[20,10]]);a.noLaser=true;
  const ed=editor([a,b]),s=ed.prepareContourOffset(),before=ed.state();
  const key=s.plan.contours[0].key;
  assert.throws(()=>ed.applyContourOffset(s,new Map([[key,-.2]]),false,false,{assemblyOwners:new Map([[key,b.id]]),confirmedAssembly:true,confirmedClosureKerf:true}),/Laser-\/Ausgabefreigaben/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
});
test('split-owner fill output is blocked before mutation even when the original was already unjoined', () => {
  const a=line([[0,0],[20,0],[20,10]]),b=line([[20,10],[0,10],[0,0]]),ed=editor([a,b]);
  ed.doc.layers[0]={...defaultLayer(0),mode:'fill'};
  const s=ed.prepareContourOffset(),before=ed.state();
  assert.throws(()=>ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]])),/Ergebnis gesperrt/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
});
test('small closed results require explicit manufacturability confirmation without mutation on decline', () => {
  const o=path([ring(0,0,Math.sqrt(3),Math.sqrt(3))]),ed=editor([o]),s=ed.prepareContourOffset(),before=ed.state();
  const amounts=new Map([[s.plan.contours[0].key,-.5]]);
  assert.throws(()=>ed.applyContourOffset(s,amounts),/Kleine oder schmale/);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  ed.applyContourOffset(s,amounts,false,false,{confirmedManufacturability:true});
  assert.equal(readContourOffset(o.shape)!.result[0].closed,true);
  ed.doUndo();assert.equal(ed.state(),before);
});
test('empty selection of offsets is a genuine no-op; malformed recipes fail closed', () => {
  const ed=editor([path([ring(0,0,20,10)])]),s=ed.prepareContourOffset(),before=ed.state();assert.equal(ed.applyContourOffset(s,new Map()),false);assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  const r={version:1 as const,source:s.sources[0].source,base:s.sources[0].base,result:s.sources[0].base,edits:[{sub:99,token:'x',parts:1,distance:.2,tolerance:.01,anchor:{x:0,y:0}}]};
  assert.throws(()=>readContourOffset(contourOffsetShape(r)));
});
{
  const { buildJob, newDevice } = await import('../src/gcode');
  const { defaultImageLayer } = await import('../src/model');
  const o=path([ring(10,10,20,10)]),ed=editor([o]),s=ed.prepareContourOffset();
  ed.applyContourOffset(s,new Map([[s.plan.contours[0].key,-.2]]));
  const input={doc:ed.doc,layer:(i:number)=>({...defaultLayer(i),kerf:.1}),imgLayer:()=>defaultImageLayer(),device:{...newDevice({fw:'grbl'}),startFrom:'absolute' as const,returnHome:false}};
  const generated=await buildJob(input);near(generated.bounds!.x0,10.1);near(generated.bounds!.x1,29.9);
  const before=JSON.stringify(ed.doc.layers);
  const again=ed.prepareContourOffset();ed.applyContourOffset(again,new Map([[again.plan.contours[0].key,-.2]]),true,true);
  const baked=await buildJob(input);assert.deepEqual(baked.bounds,generated.bounds);assert.deepEqual([...baked.moves.x],[...generated.moves.x]);assert.deepEqual([...baked.moves.y],[...generated.moves.y]);
  assert.equal(JSON.stringify(ed.doc.layers),before);count++;console.log('PASS generated and permanently baked contours produce identical offline jobs with independent layer Kerf');
}
{
  const {buildJob,newDevice}=await import('../src/gcode'),{defaultImageLayer}=await import('../src/model');
  const a=line([[10,10],[30,10],[30,20]]),b=line([[10,10],[10,20],[30,20]]);b.layer=1;
  const ed=editor([a,b]);ed.doc.layers[0]={...defaultLayer(0),mode:'line',kerf:.06};ed.doc.layers[1]={...defaultLayer(1),mode:'line',kerf:.12};
  const session=ed.prepareContourOffset(),key=session.plan.contours[0].key;
  ed.applyContourOffset(session,new Map([[key,-.2]]),false,false,{assemblyOwners:new Map([[key,b.id]]),confirmedAssembly:true,confirmedClosureKerf:true});
  const input={doc:ed.doc,layer:(id:number)=>ed.doc.layers[id]??defaultLayer(id),imgLayer:()=>defaultImageLayer(),device:{...newDevice({fw:'grbl'}),startFrom:'absolute' as const,returnHome:false}};
  const actual=await buildJob(input),expectedDoc=loadDoc(JSON.parse(JSON.stringify(ed.doc)));
  expectedDoc.objs=expectedDoc.objs.filter(o=>o.id===b.id);
  const expected=await buildJob({...input,doc:expectedDoc});
  assert.deepEqual(actual.bounds,expected.bounds);assert.deepEqual([...actual.moves.x],[...expected.moves.x]);assert.deepEqual([...actual.moves.y],[...expected.moves.y]);
  near(actual.bounds!.x0,10.08);near(actual.bounds!.x1,29.92);
  const saved=ed.state(),again=ed.prepareContourOffset();
  ed.applyContourOffset(again,new Map([[key,-.2]]),true,true,{confirmedClosureKerf:true});
  const baked=await buildJob(input);assert.deepEqual(baked.bounds,actual.bounds);
  assert.deepEqual([...baked.moves.x],[...actual.moves.x]);assert.deepEqual([...baked.moves.y],[...actual.moves.y]);
  ed.doUndo();assert.equal(ed.state(),saved);
  count++;
  console.log('PASS derived assembly offline job uses selected host kerf and has no duplicate nonhost cuts');
}
console.log(`Contour offset: ${count} checks passed; no app or hardware startup.`);
if(process.argv[3]) {
  const {readFileSync}=await import('node:fs');
  const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8'))),os=doc.objs.filter(o=>o.id>=154&&o.id<=158),ed=editor(os),before=ed.state();
  const tolerance=Number(process.argv[4]??.05),s=ed.prepareContourOffset(tolerance);let accepted=0;const refused: string[]=[];
  for(const c of s.plan.contours)try{offsetResults(s.sources,s.plan,new Map([[c.key,-.2]]),s.tolerance);accepted++;}catch(error){refused.push(String(error));}
  assert.equal(ed.state(),before);
  const {outlinePlan}=await import('../src/outline');const exterior=outlinePlan(os,tolerance);const sameCount=exterior.outer.length+exterior.holes.reduce((n,h)=>n+h.subs.length,0);
  assert.equal(s.plan.contours.length,sameCount);
  console.log(JSON.stringify({file:process.argv[3],tolerance,contours:s.plan.contours.length,exteriorContours:sameCount,blocked:s.plan.contours.filter(c=>c.blocked).length,unused:s.plan.unused,acceptedInset02:accepted,refused}));
}
