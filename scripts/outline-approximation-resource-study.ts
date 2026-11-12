import './core-fixtures-env';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDoc} from '../src/model';
import {preciseOutlinePlan,outlineResult} from '../src/outline';
const file=process.argv[3],bytes=readFileSync(file),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const doc=loadDoc(JSON.parse(bytes.toString('utf8'))),sources=doc.objs.filter(o=>[154,155,156,157,158,187].includes(o.id)),before=JSON.stringify(sources),reports=[];
for(const tolerance of [.05,.1,.2,.3]){
 const plan=preciseOutlinePlan(sources,tolerance,true),candidates=[];
 for(let i=0;i<plan.holes.length;i++)if(plan.islandErrors?.[i]){
  const selected=new Set([i]);assert.throws(()=>outlineResult(plan,selected,'islands'));
  if(!plan.approximationEligible?.[i]){candidates.push({island:i+1,eligible:false,outcome:'refused-unsafe-polygon'});continue;}
  const result=outlineResult(plan,selected,'islands',selected);
  assert.ok(result.length&&result.every(s=>s.closed));
  assert.ok(result.some(s=>s.nodes.every(n=>!n.cin&&!n.cout)));
  candidates.push({island:i+1,eligible:true,outcome:'explicit-polyline-accepted',paths:result.length,nodes:result.reduce((n,s)=>n+s.nodes.length,0)});
 }
 reports.push({tolerance,islands:plan.holes.length,exactlyExtractable:plan.islandErrors?.filter(b=>!b).length,candidates});
 assert.equal(JSON.stringify(sources),before);
}
assert.equal(hash(bytes),hash(readFileSync(file)));
console.log(JSON.stringify({sha256:hash(bytes),noProjectWrites:true,note:'Each candidate tested separately; no blanket approval of merged boundaries or exact screenshot-selection claim.',reports},null,2));
