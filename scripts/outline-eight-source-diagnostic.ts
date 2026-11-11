// Read-only selection matching: compare the screenshot's count and dimensions.
import './core-fixtures-env';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {loadDoc} from '../src/model';
import {boundsOf} from '../src/geom';
import {preciseOutlinePlan} from '../src/outline';
const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8'))),reports=[];
for(const ids of [Array.from({length:8},(_,i)=>117+i),Array.from({length:8},(_,i)=>146+i),Array.from({length:8},(_,i)=>175+i),[150,151,152,153,155,156,157,158],[146,147,148,149,155,156,157,158]]){
 const objects=doc.objs.filter(o=>ids.includes(o.id));if(objects.length!==8)continue;
 const bounds=boundsOf(objects);
 try{
  const plan=preciseOutlinePlan(objects,.3,true);
  reports.push({ids,bounds,outer:plan.outer.length,islands:plan.holes.length,exact:plan.islandErrors?.filter(v=>!v).length,
   eligible:plan.approximationEligible?.filter(Boolean).length,connections:plan.connections?.length});
 }catch(error){reports.push({ids,bounds,error:String(error)});}
}
assert.deepEqual(readFileSync(file),bytes);
console.log(JSON.stringify({noProjectWrites:true,reports},null,2));
