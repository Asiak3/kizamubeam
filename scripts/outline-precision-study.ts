import './core-fixtures-env';
import assert from 'node:assert/strict';
import { IDENT, type Obj, type SubPath, type Mat } from '../src/model';
import { preciseOutlinePlan, outlineResult } from '../src/outline';
const reports=[];
for(const tolerance of [0,.01,.05,.1,.2])for(const gap of [0,.005,.04,.25])for(const variant of ['straight','curved','rotated']){
 const outer:SubPath={closed:true,nodes:[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}]};
 const inner:SubPath={closed:false,nodes:[{x:10,y:10,...(variant==='curved'?{cout:{x:13,y:8}}:{})},
  {x:20,y:10,...(variant==='curved'?{cin:{x:17,y:8}}:{})},{x:20,y:20},{x:10,y:20},{x:10,y:10+gap}]};
 const matrix:Mat=variant==='rotated'?[0,1,-1,0,60,5]:[...IDENT];
 const sources:Obj[]=[{id:1,layer:0,m:matrix,shape:{kind:'path',subs:[outer,inner]}}],before=JSON.stringify(sources);
 const plan=preciseOutlinePlan(sources,tolerance),expected=gap===0||gap<tolerance?1:0;
 assert.equal(plan.holes.length,expected,JSON.stringify({tolerance,gap,variant}));
 assert.equal(plan.outerError,false);assert.ok(!plan.islandErrors?.some(Boolean));
 const selected=new Set(plan.holes.map((_,i)=>i));
 const outside=outlineResult(plan,selected,'outer'),combined=outlineResult(plan,selected,'combined'),islands=outlineResult(plan,selected,'islands');
 assert.equal(outside.length,1);assert.equal(combined.length,1+expected);assert.equal(islands.length,expected);
 assert.ok([...outside,...combined,...islands].every(s=>s.closed&&s.nodes.every(n=>[n,n.cin,n.cout].every(p=>!p||Number.isFinite(p.x)&&Number.isFinite(p.y)))));
 if(variant==='curved'&&expected)assert.ok(islands[0].nodes.some(n=>n.cin||n.cout),'exact source curve retained');
 for(const connection of plan.connections??[]){const [a,b]=connection.nodes;assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<=tolerance+.002);}
 assert.equal(JSON.stringify(sources),before);
 reports.push({tolerance,gap,variant,expectedIslands:expected,connections:plan.connections?.length,threeModesVerified:true,sourceUnchanged:true});
}
assert.equal(reports.length,60);
console.log(JSON.stringify({scenarios:reports.length,failures:0,noHardware:true,reports},null,2));
