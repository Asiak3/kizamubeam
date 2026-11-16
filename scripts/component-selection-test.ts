import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { apply,defaultLayer,mul,newDoc,Obj,rotate,translate } from '../src/model';
import { insideLasso,lassoTouchMode,lassoWinding,touchHit } from '../src/lasso';
let count=0;const test=(name:string,f:()=>void)=>{f();count++;console.log('PASS '+name)};
const polygon=[{x:20,y:20},{x:100,y:20},{x:100,y:100},{x:20,y:100}];
function editor(){
  const ed=Object.create(Editor.prototype) as Editor,obj:Obj={id:1,layer:0,m:[1,0,0,1,0,0],shape:{kind:'path',subs:[{closed:false,nodes:[{x:40,y:40,cout:{x:60,y:40}},{x:80,y:80,cin:{x:60,y:80}}]}]}};
  Object.assign(ed,{doc:newDoc(),sel:[obj],nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),history:new History(),batching:false,
    view:{zoom:1,ox:0,oy:0},drag:null,canvas:{style:{}},snapHit:null,alignGuides:[],nodeEditObj:null});
  ed.doc.objs=[obj];ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
const event=(extra={})=>({pointerId:1,shiftKey:false,ctrlKey:false,metaKey:false,...extra} as PointerEvent);
function objEditor(objs:Obj[]){
  const ed=Object.create(Editor.prototype) as Editor;
  Object.assign(ed,{doc:newDoc(),sel:[] as Obj[],nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),history:new History(),batching:false,
    view:{zoom:1,ox:0,oy:0},drag:null,canvas:{style:{}},snapHit:null,alignGuides:[],nodeEditObj:null,hint:''});
  ed.doc.objs=objs;ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
// Rechteck (100..140)² in Weltkoordinaten.
// CW-Streifen (Einschluss): kreuzt das Rechteck, umschließt aber keine Ecke → keine Auswahl.
// CCW-Streifen (Berührung): gleiche Geometrie, umgekehrte Punktreihenfolge → Auswahl.
const rectObj:Obj={id:2,layer:0,m:translate(100,100),shape:{kind:'rect',w:40,h:40,r:0}};
const cwStrip=[{x:0,y:115},{x:200,y:115},{x:200,y:125},{x:0,y:125}];
const ccwStrip=[...cwStrip].reverse();
// CW-Quadrat, das das Rechteck vollständig umschließt → Auswahl im Einschluss-Modus.
const cwSquare=[{x:90,y:90},{x:150,y:90},{x:150,y:150},{x:90,y:150}];
const finishObjLasso=(ed:ReturnType<typeof objEditor>,points:{x:number;y:number}[],extra={})=>{
  ed.beginLasso(points[0],event(extra),false);
  const d=ed.drag!;if(d.type!=='lasso')throw Error();
  d.points=points;ed.drag=null;ed.finishLasso(d);return d;
};
test('Winding-Vorzeichen legt die Richtung fest: CW→Einschluss, CCW→Berührung',()=>{
  const cw=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const ccw=[...cw].reverse();
  assert.ok(lassoWinding(cw)>0);
  assert.ok(lassoWinding(ccw)<0);
  assert.equal(lassoWinding(ccw),-lassoWinding(cw));
  assert.equal(lassoTouchMode(cw),false);
  assert.equal(lassoTouchMode(ccw),true);
});
test('beginLasso startet ohne Richtungsannahme im Einschluss-Modus',()=>{
  const ed=objEditor([rectObj]);
  ed.beginLasso(ccwStrip[0],event(),false);
  if(ed.drag?.type!=='lasso')throw Error();
  assert.equal(ed.drag.touch,false);ed.drag=null;
  ed.beginLasso(ccwStrip[0],event(),true);
  if(ed.drag?.type!=='lasso')throw Error();
  assert.equal(ed.drag.touch,false);ed.drag=null;
});
test('CW-Quadrat umschließt, CW-Streifen trifft nichts, CCW-Streifen berührt',()=>{
  const ed=objEditor([rectObj]);
  const dEnclose=finishObjLasso(ed,cwSquare);
  assert.equal(dEnclose.touch,false);
  assert.deepEqual(ed.sel,[rectObj]);
  assert.equal(ed.history.position,0);
  const dMiss=finishObjLasso(ed,cwStrip);
  assert.equal(dMiss.touch,false);
  assert.deepEqual(ed.sel,[]);
  const dTouch=finishObjLasso(ed,ccwStrip);
  assert.equal(dTouch.touch,true);
  assert.deepEqual(ed.sel,[rectObj]);
  assert.equal(ed.history.position,0);
});
test('Hin-und-her-Linie fällt auf Einschluss zurück und wählt nichts',()=>{
  const line=[{x:0,y:120},{x:200,y:120},{x:0,y:120}];
  assert.equal(lassoTouchMode(line),false);
  const ed=objEditor([rectObj]);
  const d=finishObjLasso(ed,line);
  assert.equal(d.touch,false);
  assert.deepEqual(ed.sel,[]);
});
test('Figur-8 (Flächenauslöschung) fällt auf Einschluss zurück',()=>{
  const eight=[{x:90,y:90},{x:150,y:150},{x:90,y:150},{x:150,y:90}];
  assert.equal(lassoWinding(eight),0);
  assert.equal(lassoTouchMode(eight),false);
  const ed=objEditor([rectObj]);
  const d=finishObjLasso(ed,eight);
  assert.equal(d.touch,false);
});
test('zu wenige Punkte und entartete BBox fallen auf Einschluss zurück',()=>{
  assert.equal(lassoTouchMode([]),false);
  assert.equal(lassoTouchMode([{x:0,y:0}]),false);
  assert.equal(lassoTouchMode([{x:0,y:0},{x:200,y:120}]),false);
  assert.equal(lassoTouchMode([{x:0,y:120},{x:200,y:120},{x:0,y:120}]),false);
});
test('Touch trifft Kante, nicht BBox: Lasso ganz im Objekt wählt nichts',()=>{
  const ed=objEditor([rectObj]);
  const inner=[{x:110,y:110},{x:120,y:110},{x:120,y:120},{x:110,y:120}];
  const innerCCW=[...inner].reverse();
  assert.equal(touchHit(innerCCW,rectObj),false);
  finishObjLasso(ed,innerCCW);
  assert.deepEqual(ed.sel,[]);
});
test('rotierte Form per Kanten-Kreuzung (Ecken außerhalb)',()=>{
  const m=mul(translate(300,300),rotate(Math.PI/4));
  const o:Obj={id:3,layer:0,m,shape:{kind:'rect',w:40,h:20,r:0}};
  const mid=apply(m,20,0);
  const corners=[apply(m,20,10),apply(m,20,-10),apply(m,-20,10),apply(m,-20,-10)];
  const diamond=[{x:mid.x-6,y:mid.y},{x:mid.x,y:mid.y-6},{x:mid.x+6,y:mid.y},{x:mid.x,y:mid.y+6}];
  const ccwDiamond=[...diamond].reverse();
  assert.ok(lassoWinding(diamond)>0);
  assert.equal(lassoTouchMode(ccwDiamond),true);
  for(const c of corners)assert.equal(insideLasso(c,ccwDiamond),false);
  assert.equal(touchHit(ccwDiamond,o),true);
  const ed=objEditor([o]);
  finishObjLasso(ed,diamond);
  assert.deepEqual(ed.sel,[]);
  finishObjLasso(ed,ccwDiamond);
  assert.deepEqual(ed.sel,[o]);
});
test('gekrümmte Kante wird per Sampling getroffen',()=>{
  const o:Obj={id:4,layer:0,m:[1,0,0,1,0,0],shape:{kind:'path',subs:[{closed:true,nodes:[
    {x:100,y:100},{x:140,y:100,cout:{x:170,y:120}},{x:140,y:140,cin:{x:170,y:120}},{x:100,y:140}]}]}};
  const box=[{x:145,y:115},{x:165,y:115},{x:165,y:125},{x:145,y:125}];
  const ccwBox=[...box].reverse();
  assert.equal(touchHit(ccwBox,o),true);
  const ed=objEditor([o]);
  finishObjLasso(ed,box);
  assert.deepEqual(ed.sel,[]);
  finishObjLasso(ed,ccwBox);
  assert.deepEqual(ed.sel,[o]);
});
test('remove/toggle-Kombi mit Berührung, kein Undo-Eintrag',()=>{
  const ed=objEditor([rectObj]);
  ed.sel=[rectObj];
  finishObjLasso(ed,ccwStrip,{shiftKey:true,ctrlKey:true});
  assert.deepEqual(ed.sel,[]);
  finishObjLasso(ed,ccwStrip,{ctrlKey:true});
  assert.deepEqual(ed.sel,[rectObj]);
  finishObjLasso(ed,ccwStrip,{ctrlKey:true});
  assert.deepEqual(ed.sel,[]);
  assert.equal(ed.history.position,0);
});
test('Touch-Pipeline unter Zoom/Offset (reale toWorld-Transformation)',()=>{
  const ed=objEditor([rectObj]);
  ed.view={zoom:2,ox:10,oy:-5};
  const toS=(p:{x:number;y:number})=>({x:p.x*2+10,y:p.y*2-5});
  const back=toS(ccwStrip[0]);
  assert.deepEqual(ed.toScreen(ed.toWorld(back.x,back.y)),back);
  const world=ccwStrip.map(p=>{const s=toS(p);return ed.toWorld(s.x,s.y);});
  const d=finishObjLasso(ed,world);
  assert.equal(d.touch,true);
  assert.deepEqual(ed.sel,[rectObj]);
  const ed2=objEditor([rectObj]);
  ed2.view={zoom:2,ox:10,oy:-5};
  const w2=cwStrip.map(p=>{const s=toS(p);return ed2.toWorld(s.x,s.y);});
  const d2=finishObjLasso(ed2,w2);
  assert.equal(d2.touch,false);
  assert.deepEqual(ed2.sel,[]);
});
test('add-Modus (Shift) mit Berührung; hidden/locked ausgenommen',()=>{
  const ed=objEditor([rectObj]);
  finishObjLasso(ed,ccwStrip,{shiftKey:true});
  assert.deepEqual(ed.sel,[rectObj]);
  assert.equal(ed.history.position,0);
  const hidden:Obj={...rectObj,id:6,hidden:true};
  const locked:Obj={...rectObj,id:7,locked:true};
  const ed2=objEditor([hidden,locked]);
  finishObjLasso(ed2,ccwStrip);
  assert.deepEqual(ed2.sel,[]);
});
test('touchHit: Gruppe ohne Subs ist false, Eingaben unverändert',()=>{
  const g:Obj={id:5,layer:0,m:[1,0,0,1,0,0],shape:{kind:'group',children:[]}};
  assert.equal(touchHit(ccwStrip,g),false);
  assert.equal(touchHit([{x:0,y:0}],rectObj),false);
  const pts=JSON.stringify(ccwStrip),obj=JSON.stringify(rectObj);
  touchHit(ccwStrip,rectObj);
  assert.equal(JSON.stringify(ccwStrip),pts);
  assert.equal(JSON.stringify(rectObj),obj);
});
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
