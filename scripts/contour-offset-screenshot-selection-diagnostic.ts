// Read-only source selection comparison. No geometry is embedded or written.
import './core-fixtures-env';
import { readFileSync } from 'node:fs';
import { loadDoc } from '../src/model';
import { offsetSource, offsetContours, offsetResults } from '../src/contourOffset';
const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8')));
const reports=[];
for(const ids of [[154,155,156,157,158],[155,156,157,158],[156,157,158],[154,156,157,158]]) {
  const sources=doc.objs.filter(o=>ids.includes(o.id)).map(o=>offsetSource(o.id,o.shape,o.m));
  const plan=offsetContours(sources,.2);
  const tail=plan.contours.slice(-5).map((c,i)=>({number:plan.contours.length-4+i,
    owners:[...new Set(c.members.map(m=>sources[m.owner].id))],blocked:!!c.blocked}));
  const picks=[37,44].map(number=>{
    const c=plan.contours[number-1];if(!c)return {number};
    try{offsetResults(sources,plan,new Map([[c.key,-.5]]),.2);return {number,result:'ok'};}
    catch(error){return {number,error:String(error),cause:(error as Error).cause};}
  });
  reports.push({ids,detected:plan.contours.length,unused:plan.unused,tail,picks});
}
console.log(JSON.stringify({reports},null,2));
