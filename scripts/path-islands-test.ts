import './core-fixtures-env';
import assert from 'node:assert/strict';
import { pathIslands } from '../src/pathIslands';
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
console.log(`${count} path-island groups passed`);
