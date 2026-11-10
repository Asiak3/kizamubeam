import './core-fixtures-env';
import assert from 'node:assert/strict';
import { editFreehandSubpath } from '../src/freehandEdit';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { defaultLayer,newDoc,Obj,SubPath } from '../src/model';
const sub:SubPath={closed:false,start:true,nodes:[{x:40,y:40,cout:{x:50,y:30}},{x:80,y:40,cin:{x:70,y:30},cout:{x:90,y:50}},{x:120,y:40,cin:{x:110,y:50}}]};
let count=0;const test=(name:string,f:()=>void)=>{f();count++;console.log('PASS '+name)};
test('continue both ends retains old interval and fixed start',()=>{
  for(const start of [0,2]){
    const source={...sub,start:start===0?false:true},p=sub.nodes[start],r=editFreehandSubpath(source,[p,{x:p.x+10,y:60},{x:p.x+20,y:70}],start,null,'continue',0.1);
    assert.ok(r.nodes.length>sub.nodes.length);assert.equal(r.start,source.start);assert.equal(r.closed,false);
    assert.deepEqual(start===0?r.nodes.at(-1):r.nodes[0],start===0?sub.nodes.at(-1):sub.nodes[0]);
  }
});
test('redraw in either direction retains outside interval and closure',()=>{
  for(const [start,end] of [[0,1],[1,0]]){
    const r=editFreehandSubpath({...sub,closed:true},[sub.nodes[start],{x:60,y:70},sub.nodes[end]],start,end,'redraw',0.1);
    assert.deepEqual(r.nodes.at(-1),sub.nodes.at(-1));assert.equal(r.closed,true);assert.equal(r.start,true);
  }
});
test('bad endpoints, closed continuation and no-motion reject',()=>{
  const p=[{x:40,y:40},{x:40,y:40}];
  assert.throws(()=>editFreehandSubpath(sub,p,1,null,'continue',0.1));
  assert.throws(()=>editFreehandSubpath({...sub,closed:true},p,0,null,'continue',0.1));
  assert.throws(()=>editFreehandSubpath(sub,p,0,0,'redraw',0.1));
  assert.throws(()=>editFreehandSubpath(sub,p,0,null,'continue',0.1));
  assert.throws(()=>editFreehandSubpath(sub,[p[0],{x:10,y:20}],0,null,'continue',0.1));
});
function editor(){
  const ed=Object.create(Editor.prototype) as Editor,obj:Obj={id:1,layer:0,m:[2,0,0,1,0,0],name:'retained',shape:{kind:'path',subs:[structuredClone(sub)]}};
  Object.assign(ed,{doc:newDoc(),sel:[obj],nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),history:new History(),batching:false,
    view:{zoom:1,ox:0,oy:0},freehandMode:'continue',freehandTolerance:0.1,drag:null,canvas:{style:{}},snapHit:null,alignGuides:[]});
  ed.doc.objs=[obj];ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
test('actual editor world-mm continuation one Undo/Redo, metadata retained',()=>{
  const ed=editor(),before=ed.state();ed.beginFreehandEdit({x:240,y:40},1);assert.equal(ed.drag?.type,'freehand-edit');
  ed.sampleFreehandEdit({x:250,y:60},1);const d=ed.drag!;ed.drag=null;if(d.type!=='freehand-edit')throw Error('missing stroke');
  ed.finishFreehandEdit(d,{x:260,y:70});assert.equal(ed.history.position,1);assert.deepEqual(ed.doc.objs[0].m,[2,0,0,1,0,0]);
  assert.equal(ed.doc.objs[0].name,'retained');const after=ed.state();ed.doUndo();assert.equal(ed.state(),before);ed.doRedo();assert.equal(ed.state(),after);
});
test('source mutation and cancellation never overwrite source',()=>{
  const ed=editor();ed.beginFreehandEdit({x:240,y:40},1);const d=ed.drag!;if(d.type!=='freehand-edit')throw Error('missing stroke');
  ed.doc.objs[0].m[4]=10;const before=ed.state();ed.drag=null;ed.finishFreehandEdit(d,{x:260,y:70});assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
});
console.log(`${count} freehand groups passed`);
