// Supplemental read-only study on the user's original resource selection.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDoc, defaultLayer } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape } from '../src/contourOffset';
import { offsetContourSections } from '../src/contourOffsetSections';
import { checkDesign, DEFAULT_CHECK } from '../src/check';
import { flattenSub, SCALE } from '../src/clip';
const file=process.argv[3],bytes=readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex');
const doc=loadDoc(JSON.parse(bytes.toString('utf8'))),objects=doc.objs.filter(o=>[155,156,157,158].includes(o.id));
assert.equal(objects.length,4);
const sources=objects.map(o=>offsetSource(o.id,o.shape,o.m)),before=JSON.stringify(sources),plan=offsetContours(sources,.2);
assert.equal(plan.contours.length,46);assert.equal(plan.unused,6);
const check=(objs:typeof objects)=>checkDesign({objs,layer:id=>doc.layers[id]??defaultLayer(id),bed:doc.bed,settings:DEFAULT_CHECK});
const baseline=check(objects),reports=[];
const baseDistances=[-.1,-.2,-.5,-.8,.2];
const area=(points:{x:number;y:number}[])=>Math.abs(points.reduce((a,v,j)=>{const q=points[(j+1)%points.length];return a+v.x*q.y-q.x*v.y},0))/2;
for(const number of [1,6,16,37,42,44]) {
  const c=plan.contours[number-1],sections=offsetContourSections(sources,plan,c.key,.2);
  for(const mode of ['offset-only','section-toggle']) for(const [setting,amount] of [...new Set([...baseDistances,
    ...(mode==='offset-only'&&[6,42].includes(number)?Array.from({length:25},(_,i)=>-Number((.3+.025*i).toFixed(3))):[]),
    ...(mode==='offset-only'&&number===1?Array.from({length:15},(_,i)=>Number((.05+.025*i).toFixed(3))):[])])].entries()) {
    if(mode==='section-toggle'&&setting===0)continue;
    const section=mode==='offset-only'?undefined:sections[(setting-1)%sections.length];
    const amounts=new Map([[c.key,amount]]),exclusions=new Map(section?[[section.id,section.spans]]:[]);
    if(section?.wholeContour)amounts.clear();
    const parameters={number,amount,mode,followup:!baseDistances.includes(amount),section:section?.key??null,wholeContourRestore:!!section?.wholeContour,originalTargetAreaMm2:area(c.points),
      owners:[...new Set(c.members.map(m=>sources[m.owner].id))],toleranceOnly:!!section?.toleranceOnly};
    try {
      const result=offsetResults(sources,plan,amounts,.2,new Set(),exclusions);
      const generated=objects.map((o,i)=>({...o,shape:result.recipes[i]?contourOffsetShape(result.recipes[i]!):o.shape}));
      const issues=check(generated);
      const areas=result.recipes.flatMap((r,i)=>(r?.result??[]).filter(p=>p.closed).map(p=>{
        const pts=flattenSub(p,sources[i].m);
        return Math.abs(pts.reduce((a,v,j)=>{const q=pts[(j+1)%pts.length];return a+v.X*q.Y-q.X*v.Y},0))/(2*SCALE*SCALE);
      }));
      const reopened=generated.map(o=>offsetSource(o.id,o.shape,o.m)),replan=offsetContours(reopened,.2);
      const repeated=offsetResults(reopened,replan,amounts,.2,new Set(),exclusions);
      assert.deepEqual(repeated.recipes.map(r=>r?.result),result.recipes.map(r=>r?.result));
      const targetAreas=result.preview.map(p=>area(flattenSub(p,[1,0,0,1,0,0]).map(q=>({x:q.X/SCALE,y:q.Y/SCALE}))));
      reports.push({...parameters,outcome:'accepted',reopenIdentical:true,allClosedOutputAreasMm2:areas,targetAreasMm2:targetAreas,
        smallTargetRegions:targetAreas.filter(a=>a<=3).length,baselineOpenWarnings:baseline.filter(i=>i.kind==='open'||i.kind==='unjoined').length,
        resultOpenWarnings:issues.filter(i=>i.kind==='open'||i.kind==='unjoined').length,
        retainedRemainders:result.remainders.length,protectedRemainders:result.remainders.filter(r=>r.protected).length});
    } catch(error) {
      if(error instanceof assert.AssertionError)throw error;
      reports.push({...parameters,outcome:'refused',error:String(error),cause:(error as Error).cause});
    }
    assert.equal(JSON.stringify(sources),before);
  }
}
assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
console.log(JSON.stringify({selection:[155,156,157,158],tolerance:.2,detected:46,sha256:hash,
  scenarios:reports.length,baseScenarios:54,followupScenarios:reports.filter(r=>r.followup).length,
  note:'54 supplementary base resource scenarios plus adaptive sweeps on contours1,6,42; whole-contour restores are separate, not offset successes. Area<=3 is a study flag, not an automatic deletion or machining limit. Remainders are retained, never auto-trimmed.',
  accepted:reports.filter(r=>r.outcome==='accepted').length,refused:reports.filter(r=>r.outcome==='refused').length,reports},null,2));
