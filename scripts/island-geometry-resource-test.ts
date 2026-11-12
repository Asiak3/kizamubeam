// Read-only regression of the actual reconstruction boundary, not just detection.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadDoc} from '../src/model';
import {preciseOutlinePlan,outlineResult} from '../src/outline';
import {outlineBoundary} from '../src/outlineBoundary';
import {validateContourTopology} from '../src/contourTopology';
import {SCALE} from '../src/clip';
const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8')));
const objects=doc.objs.filter(o=>o.id>=117&&o.id<=124),before=JSON.stringify(objects),reports=[];
assert.equal(objects.length,8);
for(const tolerance of [.05,.2,.3]){
 const start=performance.now(),plan=preciseOutlinePlan(objects,tolerance,true);
 let blockedRestorations=0,explicitApproximations=0;
 for(let i=0;i<plan.holes.length;i++){
  let unsafe=false;
  for(const s of plan.holes[i].subs){
   const polygon=s.nodes.map(n=>({X:Math.round(n.x*SCALE),Y:Math.round(n.y*SCALE)}));
   let boundary;try{boundary=outlineBoundary(polygon,plan.network!);}catch{continue;}
   try{validateContourTopology([boundary]);}catch{unsafe=true;}
  }
  if(!unsafe)continue;
  blockedRestorations++;assert.equal(plan.islandErrors![i],true,'unsafe restored output must not be offered as exact');
  assert.throws(()=>outlineResult(plan,new Set([i]),'islands'));
  if(plan.approximationEligible![i]){
   const approved=outlineResult(plan,new Set([i]),'islands',new Set([i]));validateContourTopology(approved);
   assert.ok(approved.every(s=>s.nodes.every(n=>!n.cin&&!n.cout)));explicitApproximations++;
  }
 }
 assert.ok(blockedRestorations>0,'private resource must exercise the original reconstruction defect');
 const selected=new Set(plan.holes.flatMap((_,i)=>plan.islandErrors![i]?[]:[i]));
 const output=outlineResult(plan,selected,'islands');validateContourTopology(output);
 assert.ok(output.length>0);assert.ok(output.some(s=>s.nodes.some(n=>n.cin||n.cout)));
 assert.equal(JSON.stringify(objects),before);
 reports.push({tolerance,candidates:plan.holes.length,exact:selected.size,output:output.length,blockedRestorations,explicitApproximations,allOutputValidated:true,elapsedMs:performance.now()-start});
}
assert.deepEqual(readFileSync(file),bytes);
console.log(JSON.stringify({noProjectWrites:true,reports},null,2));
