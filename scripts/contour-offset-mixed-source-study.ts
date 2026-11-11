// Read-only reproductions of the user's two mixed-owner exclusions.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDoc,defaultLayer} from '../src/model';
import {offsetSource,offsetContours,offsetResults,contourOffsetShape} from '../src/contourOffset';
import {offsetContourSections} from '../src/contourOffsetSections';
import {assessOffsetOutput} from '../src/contourOffsetValidation';
const file=process.argv[3],bytes=readFileSync(file),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const doc=loadDoc(JSON.parse(bytes.toString('utf8'))),objects=doc.objs.filter(o=>[154,155,156,157,158].includes(o.id));
const sources=objects.map(o=>offsetSource(o.id,o.shape,o.m)),before=JSON.stringify(sources),plan=offsetContours(sources,.2);
assert.equal(plan.contours.length,47);
const layers=objects.map(o=>doc.layers[o.layer]??defaultLayer(o.layer)),reports=[];
for(const number of [13,14]) {
 const c=plan.contours[number-1],section=offsetContourSections(sources,plan,c.key,.2).find(s=>s.id===157&&s.sub===(number===13?6:5));
 assert.ok(section,'screenshot source section must be recognized');
 const ids=[...new Set(c.members.map(m=>sources[m.owner].id))];
 for(const amount of [-.2,-.5])for(const host of ids){
  const amounts=new Map([[c.key,amount]]),exclusions=new Map([[section.id,section.spans]]),assemblyOwners=new Map([[c.key,host]]);
  const parameters={number,amount,host,participants:ids,section:section.spans};
  try{
   const raw=offsetResults(sources,plan,amounts,.2,new Set(),exclusions,assemblyOwners);
   const pre=assessOffsetOutput(sources,raw.recipes,raw.preview,layers);
   const removals=new Set(raw.remainders.filter(r=>!r.protected).map(r=>r.key));
   const result=offsetResults(sources,plan,amounts,.2,removals,exclusions,assemblyOwners);
   const assessment=assessOffsetOutput(sources,result.recipes,result.preview,layers);
   const reopened=sources.map((s,i)=>result.recipes[i]?offsetSource(s.id,contourOffsetShape(result.recipes[i]!),s.m):s);
   const again=offsetResults(reopened,offsetContours(reopened,.2),amounts,.2,removals);
   assert.deepEqual(again.recipes.map(r=>r?.result),result.recipes.map(r=>r?.result));
   assert.equal(result.preview.length,1);assert.equal(result.preview[0].closed,true);
   const hostIndex=sources.findIndex(s=>s.id===host);
   assert.ok(result.recipes[hostIndex]!.result.some(s=>s.closed));
   reports.push({...parameters,outcome:'computed',preTrim:pre,afterExplicitDiagnosticRemoval:assessment,
    diagnosticRemoved:removals.size,protectedRemainders:raw.remainders.filter(r=>r.protected).length,reopenIdentical:true});
  }catch(error){
   if(error instanceof assert.AssertionError)throw error;
   reports.push({...parameters,outcome:'refused',error:String(error),cause:(error as Error).cause});
  }
  assert.equal(JSON.stringify(sources),before);
 }
}
for(const host13 of [156,157])for(const host14 of [156,157]){
 const a=plan.contours[12],b=plan.contours[13],amounts=new Map([[a.key,-.5],[b.key,-.5]]);
 const spans=[13,14].flatMap(number=>offsetContourSections(sources,plan,plan.contours[number-1].key,.2)
   .find(s=>s.id===157&&s.sub===(number===13?6:5))!.spans);
 const exclusions=new Map([[157,spans]]),owners=new Map([[a.key,host13],[b.key,host14]]);
 try{
  const raw=offsetResults(sources,plan,amounts,.2,new Set(),exclusions,owners);
  const removals=new Set(raw.remainders.filter(r=>!r.protected).map(r=>r.key));
  const result=offsetResults(sources,plan,amounts,.2,removals,exclusions,owners);
  const assessment=assessOffsetOutput(sources,result.recipes,result.preview,layers);
  assert.equal(result.preview.length,2);assert.ok(result.preview.every(p=>p.closed));
  const reopened=sources.map((s,i)=>result.recipes[i]?offsetSource(s.id,contourOffsetShape(result.recipes[i]!),s.m):s);
  assert.deepEqual(offsetResults(reopened,offsetContours(reopened,.2),amounts,.2,removals).recipes,result.recipes);
  reports.push({combined:[13,14],amount:-.5,hosts:[host13,host14],outcome:'computed',assessment,diagnosticRemoved:removals.size,reopenIdentical:true});
 }catch(error){if(error instanceof assert.AssertionError)throw error;reports.push({combined:[13,14],amount:-.5,hosts:[host13,host14],outcome:'refused',error:String(error),cause:(error as Error).cause});}
 assert.equal(JSON.stringify(sources),before);
}
assert.equal(sha(readFileSync(file)),sha(bytes));
console.log(JSON.stringify({sha256:sha(bytes),noProjectWrites:true,noAutomaticRemoval:true,reports},null,2));
