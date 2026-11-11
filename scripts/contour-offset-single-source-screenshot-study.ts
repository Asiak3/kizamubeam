// Read-only reproduction candidates for the two source187 screenshots.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDoc, defaultLayer } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape } from '../src/contourOffset';
import { offsetContourSections } from '../src/contourOffsetSections';
import { assessOffsetOutput } from '../src/contourOffsetValidation';
import { extract } from '../src/pathtools';
import { segments } from '../src/curves';
const file=process.argv[3],bytes=readFileSync(file),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const doc=loadDoc(JSON.parse(bytes.toString('utf8'))),obj=doc.objs.find(o=>o.id===187);
assert.ok(obj,'source187 required');
const source=offsetSource(obj.id,obj.shape,obj.m),before=JSON.stringify(source),reports=[];
for(const tolerance of [.01,.1,.2]){
 const plan=offsetContours([source],tolerance);
 for(const number of [3,4,29]){
  const contour=plan.contours[number-1];if(!contour)continue;
  const sections=offsetContourSections([source],plan,contour.key,tolerance).filter(s=>s.sub===(number===29?39:33));
  for(const section of sections)for(const amount of [-.1,-.2,-.5]){
   const amounts=new Map([[contour.key,amount]]),exclusions=new Map([[187,section.spans]]);
   const parameters={tolerance,detected:plan.contours.length,number,amount,section};
   try{
    const raw=offsetResults([source],plan,amounts,tolerance,new Set(),exclusions);
    const removals=new Set(raw.remainders.filter(r=>!r.protected).map(r=>r.key));
    const result=offsetResults([source],plan,amounts,tolerance,removals,exclusions);
    const recipe=result.recipes[0]!;
    const close=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)<1e-8;
    const outputSegments=recipe.result.flatMap(segments);
    for(const span of section.spans)for(const expected of segments(extract(source.base[span.sub],span.u0,span.u1))){
     assert.ok(outputSegments.some(q=>close(q.a,expected.a)&&close(q.b,expected.b)&&close(q.c1,expected.c1)&&close(q.c2,expected.c2)||
       close(q.b,expected.a)&&close(q.a,expected.b)&&close(q.c2,expected.c1)&&close(q.c1,expected.c2)),'excluded exact curve must remain in output');
    }
    const reopened=offsetSource(187,contourOffsetShape(recipe),source.m);
    assert.deepEqual(offsetResults([reopened],offsetContours([reopened],tolerance),amounts,tolerance,removals).recipes,result.recipes);
    reports.push({...parameters,outcome:'computed',exactExcludedCurve:true,reopenIdentical:true,assessment:assessOffsetOutput([source],result.recipes,result.preview,[doc.layers[obj.layer]??defaultLayer(obj.layer)]),remainders:raw.remainders.map(r=>({key:r.key,protected:r.protected}))});
   }catch(error){if(error instanceof assert.AssertionError)throw error;reports.push({...parameters,outcome:'refused',error:String(error),cause:(error as Error).cause});}
   assert.equal(JSON.stringify(source),before);
  }
 }
}
assert.equal(hash(readFileSync(file)),hash(bytes));
console.log(JSON.stringify({sha256:hash(bytes),noProjectWrites:true,note:'Diagnostic removal only; not automatic UI removal. Screenshot1 selected contour set is not fully visible.',reports},null,2));
