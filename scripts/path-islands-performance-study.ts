// Informational timings and immutable-output oracle, not machine-independent limits.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDoc} from '../src/model';
import {pathIslandPlan} from '../src/pathIslands';
const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8')));
const o=doc.objs.find(o=>o.id===233)!;if(o.shape.kind!=='path')throw Error('expected path233');
const source=o.shape.subs,hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash(source),reports=[];
for(const distance of [0,.01,.1,1]){
 const times:number[]=[],outputs:string[]=[];let groups=0,preserved=0,error;
 for(let i=0;i<7;i++){
  const start=performance.now();try{const p=pathIslandPlan(source,{matrix:o.m,distance,preserveInvalid:true});groups=p.groups.length;preserved=p.preserved.length;outputs.push(hash(p));}catch(e){error=String(e);outputs.push(error);}
  times.push(performance.now()-start);
 }
 assert.equal(new Set(outputs).size,1);reports.push({distance,groups,preserved,error,timesMs:times,outputHash:outputs[0]});
}
assert.equal(hash(source),before);assert.deepEqual(readFileSync(file),bytes);
if(process.argv[4]){const b=readFileSync(process.argv[4]),baseline=JSON.parse((b[0]===255?b.toString('utf16le'):b.toString('utf8')).replace(/^\uFEFF/,''));reports.forEach((r,i)=>{if(!baseline.reports[i].error)assert.equal(r.outputHash,baseline.reports[i].outputHash);});}
console.log(JSON.stringify({noProjectWrites:true,sourceHash:before,reports},null,2));
