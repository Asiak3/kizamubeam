// Read-only study. Never embeds private resource geometry in source fixtures.
import './core-fixtures-env';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadDoc } from '../src/model';
import { preciseOutlinePlan, outlineResult } from '../src/outline';
import { outlineBoundary } from '../src/outlineBoundary';
const file=process.argv[3],bytes=readFileSync(file),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const doc=loadDoc(JSON.parse(bytes.toString('utf8'))),sources=doc.objs.filter(o=>[154,155,156,157,158,187].includes(o.id)),before=JSON.stringify(sources),reports=[];
for(const tolerance of [0,.01,.05,.1,.2]){
 try{
  const plan=preciseOutlinePlan(sources,tolerance,true),all=new Set(plan.holes.flatMap((_,i)=>plan.islandErrors?.[i]?[]:[i]));
  const results=['outer','combined','islands'].map(mode=>{
   try{const subs=outlineResult(plan,all,mode as 'outer'|'combined'|'islands');return {mode,paths:subs.length,curveNodes:subs.flatMap(s=>s.nodes).filter(n=>n.cin||n.cout).length};}
   catch(error){return {mode,error:String(error),cause:(error as Error).cause};}
  });
  const outerIssues=plan.outer.flatMap(p=>{try{outlineBoundary(p.nodes.map(n=>({X:Math.round(n.x*1000),Y:Math.round(n.y*1000)})),plan.network!);return [];}catch(error){return [(error as Error).cause];}});
  reports.push({tolerance,outer:plan.outer.length,islands:plan.holes.length,unresolvedOuter:plan.outerError,outerIssues,unresolvedIslands:plan.islandErrors?.filter(Boolean).length,connections:plan.connections?.length,results});
 }catch(error){reports.push({tolerance,error:String(error),cause:(error as Error).cause});}
 assert.equal(JSON.stringify(sources),before);
}
assert.equal(hash(readFileSync(file)),hash(bytes));
console.log(JSON.stringify({sha256:hash(bytes),ids:sources.map(o=>o.id),noProjectWrites:true,reports},null,2));
