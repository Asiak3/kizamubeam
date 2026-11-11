import './core-fixtures-env';
import assert from 'node:assert/strict';
import {IDENT,type SubPath,type Mat} from '../src/model';
import {prepareContourTopology,validateContourTopologies,validateContourTopology,contourContains} from '../src/contourTopology';
import {pathIslands} from '../src/pathIslands';
const ring=(x:number,y:number,w:number,h=w):SubPath=>({closed:true,nodes:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
const lens=(x=0,y=0,h=5):SubPath=>({closed:true,nodes:[{x,y,cout:{x,y:y+h},cin:{x,y:y-h}},{x:x+10,y,cin:{x:x+10,y:y+h},cout:{x:x+10,y:y-h}}]});
let count=0;
const test=(name:string,fn:()=>void)=>{fn();console.log('PASS '+name);count++;};
test('unrounded topology preserves valid sub-grid polygons at different raster phases',()=>{
  for(const shift of [0,.00037,20.220163894435984,375]){
    const s=ring(0,0,.0002),before=JSON.stringify(s);validateContourTopology([s],[1,0,0,1,shift,shift]);assert.equal(JSON.stringify(s),before);
    assert.equal(pathIslands([s],{matrix:[1,0,0,1,shift,shift]}).length,1);
  }
});
test('thin real Bezier islands and closed two-node curves are not area-filtered',()=>{
  for(const matrix of [IDENT,[0,1,-1,0,81.00037,375],[-1,0,0,1,20.22016,10]] as Mat[]){
    const s=lens(0,0,.000001),before=JSON.stringify(s);validateContourTopology([s],matrix);assert.equal(JSON.stringify(s),before);
  }
});
test('coincident consecutive nodes stay unchanged and do not create contacts',()=>{
  const s=lens();s.nodes.splice(1,0,{x:10,y:0,cin:{x:10,y:5}});delete s.nodes[2].cin;
  const before=JSON.stringify(s);validateContourTopology([s]);assert.equal(JSON.stringify(s),before);
});
test('Bezier interior ray test retains holes and handles horizontal tangencies',()=>{
  const g=prepareContourTopology(lens());
  assert.equal(contourContains(g,{x:5,y:0}),true);assert.equal(contourContains(g,{x:5,y:4}),false);
  assert.equal(contourContains(g,{x:-1,y:0}),false);
  assert.equal(pathIslands([lens(),ring(4,-.5,1)]).length,1);
});
test('proper crossings, collinear reversal, exact zero area and open paths reject',()=>{
  for(const s of [
    {closed:true,nodes:[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]} as SubPath,
    {closed:true,nodes:[{x:0,y:0},{x:10,y:0},{x:5,y:0},{x:10,y:10},{x:0,y:10}]} as SubPath,
    {closed:true,nodes:[{x:0,y:0},{x:1,y:0},{x:2,y:0}]} as SubPath,
    {...ring(0,0,10),closed:false},
  ])assert.throws(()=>validateContourTopology([s]));
});
test('a loop inside one cubic is detected after derivative-root subdivision',()=>{
  const loop:SubPath={closed:true,nodes:[{x:0,y:0,cout:{x:4,y:4}},{x:1,y:0,cin:{x:-4,y:4}}]};
  assert.throws(()=>validateContourTopology([loop]));
});
test('interior curve tangency rejects while a real small clearance remains valid',()=>{
  assert.throws(()=>validateContourTopology([lens(),ring(4,3.75,2,1)]));
  validateContourTopology([lens(),ring(4,3.750001,2,1)]);
});
test('nested curves are valid but touching, coincident and overlapping contours reject',()=>{
  validateContourTopology([lens(),ring(4,-.5,1)]);
  for(const s of [ring(0,0,10),ring(5,5,10),ring(10,0,10)])assert.throws(()=>validateContourTopology([ring(0,0,10),s]));
});
test('malformed coordinates and bounded-work exhaustion fail closed',()=>{
  const bad=lens();bad.nodes[0].cout!.x=NaN;assert.throws(()=>validateContourTopology([bad]));
  assert.throws(()=>prepareContourTopology(lens(),IDENT,{work:4_000_000}));
  const c=prepareContourTopology(lens());assert.throws(()=>validateContourTopologies([c],{work:4_000_000}));
});
console.log(`${count} contour-topology groups passed`);
