import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { defaultLayer,newDoc,Obj } from '../src/model';
import { insideLasso } from '../src/lasso';
let count=0;const test=(name:string,f:()=>void)=>{f();count++;console.log('PASS '+name)};
const polygon=[{x:20,y:20},{x:100,y:20},{x:100,y:100},{x:20,y:100}];
function editor(){
  const ed=Object.create(Editor.prototype) as Editor,obj:Obj={id:1,layer:0,m:[1,0,0,1,0,0],shape:{kind:'path',subs:[{closed:false,nodes:[{x:40,y:40,cout:{x:60,y:40}},{x:80,y:80,cin:{x:60,y:80}}]}]}};
  Object.assign(ed,{doc:newDoc(),sel:[obj],nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),history:new History(),batching:false,
    view:{zoom:1,ox:0,oy:0},drag:null,canvas:{style:{}},snapHit:null,alignGuides:[],nodeEditObj:null});
  ed.doc.objs=[obj];ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
const event=(extra={})=>({pointerId:1,shiftKey:false,ctrlKey:false,metaKey:false,...extra} as PointerEvent);
test('polygon boundary, inside and outside',()=>{assert.ok(insideLasso({x:20,y:40},polygon));assert.ok(insideLasso({x:50,y:50},polygon));assert.ok(!insideLasso({x:110,y:50},polygon))});
test('lasso selects nodes and handles without Undo, Ctrl toggles',()=>{
  const ed=editor();ed.beginLasso(polygon[0],event(),true);const d=ed.drag!;if(d.type!=='lasso')throw Error();d.points=polygon;ed.drag=null;ed.finishLasso(d);
  assert.equal(ed.selectedNodes().length,2);assert.equal(ed.selectedHandles().length,2);assert.equal(ed.history.position,0);
  ed.beginLasso(polygon[0],event({ctrlKey:true}),true);const t=ed.drag!;if(t.type!=='lasso')throw Error();t.points=polygon;ed.drag=null;ed.finishLasso(t);
  assert.equal(ed.selectedNodes().length,0);assert.equal(ed.selectedHandles().length,0);
});
test('multiple handle nudge leaves nodes fixed, one Undo restores',()=>{
  const ed=editor(),obj=ed.sel[0];ed.handleSelection(obj).add('0:0:cout');ed.handleSelection(obj).add('0:1:cin');const before=ed.state();
  assert.ok(ed.nudgeNodes(5,7));assert.equal(ed.history.position,1);
  if(obj.shape.kind!=='path')throw Error();assert.equal(obj.shape.subs[0].nodes[0].x,40);assert.deepEqual(obj.shape.subs[0].nodes[0].cout,{x:65,y:47});
  ed.doUndo();assert.equal(ed.state(),before);
});
test('selected handle deletion does not delete anchor nodes',()=>{
  const ed=editor(),obj=ed.sel[0];ed.handleSelection(obj).add('0:0:cout');ed.handleSelection(obj).add('0:1:cin');ed.deleteNodes();
  if(obj.shape.kind!=='path')throw Error();assert.equal(obj.shape.subs[0].nodes.length,2);assert.equal(obj.shape.subs[0].nodes[0].cout,undefined);assert.equal(obj.shape.subs[0].nodes[1].cin,undefined);
});
test('cancelled lasso has no geometry/history mutation; hidden target excluded',()=>{
  const ed=editor(),before=ed.state();ed.beginLasso(polygon[0],event(),true);ed.cancelDrag();assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  ed.sel[0].hidden=true;assert.equal(ed.selectedHandles().length,0);
});
console.log(`${count} selection groups passed`);
