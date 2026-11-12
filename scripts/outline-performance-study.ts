// Read-only timings; informational, not a machine-independent speed assertion.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDoc} from '../src/model';
import {outlineNetwork} from '../src/outlineNetwork';
import {outlinePlan,preciseOutlinePlan,outlineResult} from '../src/outline';
const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8'))),reports=[];
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(const ids of [[154,155,156,157,158],[146,147,148,149,150,151,152,153]]){
 const objects=doc.objs.filter(o=>ids.includes(o.id)),before=sha(objects);
 if(objects.length!==ids.length)continue;
 const tolerance=.2;
 const started=performance.now(),network=outlineNetwork(objects,tolerance,true),afterNetwork=performance.now();
 const detected=outlinePlan(objects,tolerance,true,network,true),afterFaces=performance.now();
 const opening=performance.now(),plan=preciseOutlinePlan(objects,tolerance,true),opened=performance.now();
 const selected=new Set(plan.holes.flatMap((_,i)=>plan.islandErrors?.[i]?[]:[i]));
 const clicks=[],outputs=[];
 for(let i=0;i<5;i++){
  const start=performance.now();
  try{const output=outlineResult(plan,selected,'islands');outputs.push(sha(output));}
  catch(error){outputs.push(String(error));}
  clicks.push(performance.now()-start);
 }
 assert.equal(sha(objects),before);
 reports.push({ids,tolerance,edges:network.edges.length,islands:detected.holes.length,
  exact:plan.islandErrors?.filter(v=>!v).length,networkMs:afterNetwork-started,facesMs:afterFaces-afterNetwork,
  openingMs:opened-opening,repeatSelectionMs:clicks,geometryHash:sha({outer:plan.outer,holes:plan.holes,errors:plan.islandErrors,eligible:plan.approximationEligible}),outputHashes:outputs});
}
assert.deepEqual(readFileSync(file),bytes);
let baselineGeometryVerified=false;
if(process.argv[4]){
 const baseline=JSON.parse(readFileSync(process.argv[4],'utf8'));
 assert.equal(reports.length,baseline.reports.length);
 reports.forEach((r,i)=>{assert.deepEqual(r.ids,baseline.reports[i].ids);assert.equal(r.geometryHash,baseline.reports[i].geometryHash);assert.deepEqual(r.outputHashes,baseline.reports[i].outputHashes);});
 baselineGeometryVerified=true;
}
console.log(JSON.stringify({noProjectWrites:true,baselineGeometryVerified,node:process.version,reports},null,2));
