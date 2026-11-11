import './core-fixtures-env';
import assert from 'node:assert/strict';
import { pathIslands,pathIslandPlan } from '../src/pathIslands';
import { bumpIds, defaultLayer, newDoc, Obj, SubPath } from '../src/model';
import { Editor } from '../src/editor';
import { History } from '../src/history';
const ring=(x:number,y:number,w:number,h=w):SubPath=>({closed:true,start:true,nodes:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
let count=0;
const test=(name:string,fn:()=>void)=>{fn();count++;console.log('PASS '+name)};
test('disconnected islands, direct holes and nested island holes',()=>{
  const a=ring(0,0,100),h=ring(10,10,80),i=ring(20,20,60),ih=ring(30,30,40),b=ring(200,0,20);
  assert.deepEqual(pathIslands([h,b,ih,i,a]),[[b],[i,ih],[a,h]]);
});
test('exact Béziers/start flags retained; winding independent',()=>{
  const a=ring(0,0,100),b=ring(200,0,100); a.nodes[0].cout={x:30,y:-20}; b.nodes.reverse();
  const before=JSON.stringify([a,b]); const result=pathIslands([a,b]);
  assert.equal(result[0][0],a); assert.equal(JSON.stringify([a,b]),before); assert.ok(result[0][0].start);
});
test('touch, overlap, coincidence, self-intersection and open paths reject',()=>{
  for(const subs of [[ring(0,0,10),ring(10,0,10)],[ring(0,0,10),ring(5,5,10)],[ring(0,0,10),ring(0,0,10)],
    [{closed:false,nodes:[{x:0,y:0},{x:1,y:1}]} as SubPath],
    [{closed:true,nodes:[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]} as SubPath]]) assert.throws(()=>pathIslands(subs));
});
test('finite/work budgets',()=>{
  assert.throws(()=>pathIslands(Array.from({length:257},()=>ring(0,0,10))));
  const bad=ring(0,0,10);bad.nodes[0].x=NaN;assert.throws(()=>pathIslands([bad]));
});
test('distance grouping uses world-mm and transitive edge distance, never moves points',()=>{
  const subs=[ring(0,0,10),ring(11,0,10),ring(22,0,10)],before=JSON.stringify(subs);
  assert.equal(pathIslands(subs,{distance:0.9}).length,3);
  assert.equal(pathIslands(subs,{distance:1}).length,1);
  assert.equal(pathIslands(subs,{distance:1,matrix:[2,0,0,1,0,0]}).length,3);
  assert.equal(JSON.stringify(subs),before);
});
test('closing is explicit and limited to each subpath own endpoints',()=>{
  const open:SubPath={closed:false,nodes:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:0.01}]};
  assert.throws(()=>pathIslands([open]));assert.throws(()=>pathIslands([open],{closeGaps:true,gapTolerance:0.005}));
  const result=pathIslands([open],{closeGaps:true,gapTolerance:0.02});assert.ok(result[0][0].closed);assert.equal(open.closed,false);
  assert.deepEqual(result[0][0].nodes,open.nodes);
});
function editor(objs:Obj[]) {
  bumpIds(objs);
  const ed=Object.create(Editor.prototype) as Editor;
  Object.assign(ed,{doc:newDoc(),sel:objs,history:new History(),nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),batching:false,drag:null,draft:null});
  ed.doc.objs=[...objs];ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
const object=(id:number,subs:SubPath[]):Obj=>({id,name:'exact metadata',m:[0,2,-3,0,80,20],layer:0,noLaser:true,shape:{kind:'path',subs}});
test('transaction retains matrix/metadata/order, exact undo redo',()=>{
  const a=object(1,[ring(0,0,20),ring(40,0,20)]),b=object(2,[ring(0,0,10)]),ed=editor([a]);ed.doc.objs.push(b);bumpIds(ed.doc.objs);
  const before=ed.state();assert.equal(ed.separatePathIslands(),2);assert.equal(ed.history.position,1);
  assert.equal(ed.doc.objs[0].id,1);assert.equal(ed.doc.objs[2],b);assert.notEqual(ed.doc.objs[1].id,1);
  for(const o of ed.sel){assert.deepEqual(o.m,a.m);assert.equal(o.name,a.name);assert.equal(o.noLaser,true)}
  const after=ed.state();ed.doUndo();assert.equal(ed.state(),before);ed.doRedo();assert.equal(ed.state(),after);
});
test('invalid member cancels entire selection, no-op has no Undo',()=>{
  const ed=editor([object(1,[ring(0,0,20),ring(40,0,20)]),object(2,[{...ring(0,0,10),closed:false}])]);
  const before=ed.state();assert.equal(ed.separatePathIslands(),0);assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  const one=editor([object(3,[ring(0,0,20),ring(5,5,5)])]);assert.equal(one.separatePathIslands(),0);assert.equal(one.history.position,0);
});
test('problematic remnants are retained exactly while valid islands can be split',()=>{
  const a=ring(0,0,10),b=ring(30,0,10),bad:SubPath={closed:true,nodes:[{x:15,y:0},{x:16,y:0},{x:17,y:0}]};
  const source=[a,b,bad],before=JSON.stringify(source),plan=pathIslandPlan(source,{preserveInvalid:true});
  assert.deepEqual(plan.groups,[[bad],[a],[b]]);assert.deepEqual(plan.preserved,[bad]);assert.equal(JSON.stringify(source),before);
  assert.throws(()=>pathIslands(source));
});
test('preserving remnants never bypasses invalid settings, coordinates or geometry budgets',()=>{
  assert.throws(()=>pathIslandPlan([ring(0,0,10)],{preserveInvalid:true,distance:NaN}));
  const bad=ring(0,0,10);bad.nodes[0].x=Infinity;assert.throws(()=>pathIslandPlan([bad],{preserveInvalid:true}));
  const huge:SubPath={closed:true,nodes:Array.from({length:16385},(_,i)=>({x:i,y:i%2}))};
  assert.throws(()=>pathIslandPlan([huge],{preserveInvalid:true}));
  const contact=[ring(0,0,10),ring(5,5,10)];
  const plan=pathIslandPlan(contact,{preserveInvalid:true});assert.deepEqual(plan.groups,[contact]);assert.deepEqual(plan.preserved,contact);
});
test('sweep contact testing supports more than4096 real points without changing geometry',()=>{
  const source:SubPath[]=Array.from({length:80},(_,i)=>({closed:true,nodes:Array.from({length:60},(_,j)=>({x:i*15+5*Math.cos(j*Math.PI/30),y:5*Math.sin(j*Math.PI/30)}))}));
  const before=JSON.stringify(source);assert.equal(pathIslands(source).length,80);assert.equal(JSON.stringify(source),before);
});
test('closed two-node Bezier islands retain exact handles',()=>{
  const source:SubPath={closed:true,nodes:[{x:0,y:0,cout:{x:5,y:-5},cin:{x:5,y:5}},{x:10,y:0,cin:{x:5,y:-5},cout:{x:5,y:5}}]};
  assert.equal(pathIslands([source])[0][0],source);
});
test('distance broad phase matches an exhaustive rectangle-distance oracle',()=>{
  const source=Array.from({length:32},(_,i)=>ring((i%8)*12,Math.floor(i/8)*15,3+i%4,4+i%3));
  for(const distance of [0,1,5,6,7,10,20]){
    const parent=source.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:find(parent[i]);
    for(let i=0;i<source.length;i++)for(let j=i+1;j<source.length;j++){
      const a=source[i].nodes,b=source[j].nodes;
      const d=Math.hypot(Math.max(0,a[0].x-b[1].x,b[0].x-a[1].x),Math.max(0,a[0].y-b[2].y,b[0].y-a[2].y));
      if(distance>0&&d<=distance)parent[find(j)]=find(i);
    }
    const canonical=(groups:SubPath[][])=>groups.map(g=>g.map(s=>source.indexOf(s)).sort((a,b)=>a-b).join(',')).sort();
    const expected=new Map<number,SubPath[]>();source.forEach((s,i)=>{const key=find(i),g=expected.get(key)??[];g.push(s);expected.set(key,g);});
    assert.deepEqual(canonical(pathIslands(source,{distance})),canonical([...expected.values()]));
  }
});
test('preserved source retains its original ID and all spans through Apply and Undo',()=>{
  const bad:SubPath={closed:true,nodes:[{x:25,y:0},{x:26,y:0},{x:27,y:0}]},a=object(1,[ring(0,0,10),ring(40,0,10),bad]),ed=editor([a]),before=ed.state();
  assert.equal(ed.separatePathIslands({preserveInvalid:true}),3);
  assert.equal(ed.doc.objs[0].id,a.id);assert.deepEqual((ed.doc.objs[0].shape as {subs:SubPath[]}).subs,[bad]);
  assert.equal(ed.doc.objs.flatMap(o=>(o.shape as {subs:SubPath[]}).subs).length,3);ed.doUndo();assert.equal(ed.state(),before);
});
if(process.argv[3]){
  const {readFileSync}=await import('node:fs'),{loadDoc}=await import('../src/model');
  const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8'))),source=doc.objs.find(o=>o.id===233)!;
  assert.equal(source.shape.kind,'path');const paths=(source.shape as {subs:SubPath[]}).subs;
  const plan=pathIslandPlan(paths,{matrix:source.m,preserveInvalid:true});assert.equal(plan.groups.length,51);assert.deepEqual(plan.preserved,[paths[41]]);
  for(const index of [3,4,9,10,18,29,35,37,42,50]){
    for(const matrix of [source.m,[1,0,0,1,0,0],[0,1,-1,0,.00037,20.22016],[-1,0,0,1,20.22016,.00037]] as import('../src/model').Mat[])
      assert.equal(pathIslands([paths[index]],{matrix})[0][0],paths[index]);
  }
  assert.throws(()=>pathIslands([paths[41]],{matrix:source.m}));
  assert.deepEqual(plan.groups.flat().map(s=>JSON.stringify(s)).sort(),paths.map(s=>JSON.stringify(s)).sort());
  const ed=editor(doc.objs);ed.doc=doc;ed.sel=[source];
  const {createHash}=await import('node:crypto'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  const before=hash(ed.state());assert.equal(ed.separatePathIslands({preserveInvalid:true}),51);assert.equal(ed.doc.objs.length,53);ed.doUndo();assert.equal(hash(ed.state()),before);
  assert.deepEqual(readFileSync(file),bytes);console.log('PASS original inseln.kzb:50 valid islands,1 preserved self-crossing subpath,translation/reflection/rotation,exact source/Undo/file preservation');
}
console.log(`${count} total path-island groups passed`);
