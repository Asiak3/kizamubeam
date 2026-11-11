// Read-only follow-up: explain new warnings, never infer that tiny spans are waste.
import './core-fixtures-env';
import {readFileSync} from 'node:fs';
import {loadDoc,defaultLayer,apply} from '../src/model';
import {offsetSource,offsetContours,offsetResults,contourOffsetShape} from '../src/contourOffset';
import {checkDesign,DEFAULT_CHECK} from '../src/check';
const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8'))),objects=doc.objs.filter(o=>[155,156,157,158].includes(o.id));
const sources=objects.map(o=>offsetSource(o.id,o.shape,o.m)),plan=offsetContours(sources,.2),contour=plan.contours[0];
const check=(objs:typeof objects)=>checkDesign({objs,layer:id=>doc.layers[id]??defaultLayer(id),bed:doc.bed,settings:DEFAULT_CHECK})
  .filter(i=>i.kind==='open'||i.kind==='unjoined').map(i=>({key:i.key,kind:i.kind,message:i.msg}));
const reports=[];
for(const amount of [.05,.2,.4]) {
 const amounts=new Map([[contour.key,amount]]),r=offsetResults(sources,plan,amounts,.2);
 const generated=objects.map((o,i)=>({...o,shape:r.recipes[i]?contourOffsetShape(r.recipes[i]!):o.shape}));
 const paths=r.recipes.flatMap((recipe,owner)=>(recipe?.result??[]).map((p,sub)=>{
   const a=p.nodes[0],b=p.nodes.at(-1)!,wa=apply(sources[owner].m,a.x,a.y),wb=apply(sources[owner].m,b.x,b.y);
   return {id:sources[owner].id,sub,closed:p.closed,nodes:p.nodes.length,gap:Math.hypot(wa.x-wb.x,wa.y-wb.y)};
 }));
 const removable=r.remainders.filter(p=>!p.protected),trimmed=offsetResults(sources,plan,amounts,.2,new Set(removable.map(p=>p.key)));
 const afterTrim=objects.map((o,i)=>({...o,shape:trimmed.recipes[i]?contourOffsetShape(trimmed.recipes[i]!):o.shape}));
 reports.push({amount,owners:contour.members.map(m=>sources[m.owner].id),before:check(objects),after:check(generated),
   changedOpenPaths:paths.filter(p=>!p.closed),remainders:r.remainders.map(p=>({id:sources[p.owner].id,sub:p.sub,protected:p.protected,range:[p.u0,p.u1]})),
   diagnosticRemovals:removable.length,afterExplicitDiagnosticRemoval:check(afterTrim)});
}
console.log(JSON.stringify({reports,noProjectWrites:true,noAutomaticProductionRemoval:true},null,2));
