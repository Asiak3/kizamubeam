// Read-only diagnosis: no app bootstrap, file writes or hardware dependencies.
import './core-fixtures-env';
import {readFileSync} from 'node:fs';
import {loadDoc} from '../src/model';
import {offsetSource,offsetContours,offsetResults} from '../src/contourOffset';
import {flattenSub,SCALE} from '../src/clip';
const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8')));
const ids=(process.argv[4]??'154,187').split(',').map(Number),tolerance=Number(process.argv[5]??0.2);
const amount=Number(process.argv[7]??-0.2);
const sources=doc.objs.filter(o=>ids.includes(o.id)).map(o=>offsetSource(o.id,o.shape,o.m));
const plan=offsetContours(sources,tolerance),cumulative=new Map<string,number>();
const contours=plan.contours.map((c,i)=>{
  const base={index:i+1,points:c.points.length,owners:[...new Set(c.members.map(m=>sources[m.owner].id))],
    subs:[...new Set(c.members.map(m=>`${sources[m.owner].id}:${m.sub}`))],blocked:c.blocked,blockedReason:c.blockedReason,
    bounds:{x0:Math.min(...c.points.map(p=>p.x)),y0:Math.min(...c.points.map(p=>p.y)),x1:Math.max(...c.points.map(p=>p.x)),y1:Math.max(...c.points.map(p=>p.y))}};
  let single='ok',combined='ok',failureDetails:unknown;
  try{offsetResults(sources,plan,new Map([[c.key,amount]]),tolerance)}catch(error){single=String(error);failureDetails=(error as Error).cause}
  if(single==='ok'){
    const next=new Map(cumulative);next.set(c.key,amount);
    try{offsetResults(sources,plan,next,tolerance);cumulative.set(c.key,amount)}catch(error){combined=String(error)}
  }
  return {...base,single,combined,failureDetails,...(process.argv[6]==='geometry'?{polygon:c.points}:{})};
});
const sourcePaths=process.argv[6]==='geometry'?sources.flatMap(s=>s.base.map(sp=>({closed:sp.closed,points:flattenSub(sp,s.m).map(p=>({x:p.X/SCALE,y:p.Y/SCALE}))}))):undefined;
console.log(JSON.stringify({ids,tolerance,amount,detected:contours.length,unused:plan.unused,cumulativeAccepted:cumulative.size,contours,sourcePaths},null,2));
