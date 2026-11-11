// Explicit read-only, in-memory regression; private project is never embedded or written.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDoc, defaultLayer } from '../src/model';
import { offsetSource, offsetContours, offsetResults, contourOffsetShape, readContourOffset } from '../src/contourOffset';
import { checkDesign, DEFAULT_CHECK } from '../src/check';
const bytes=readFileSync(process.argv[3]),hash=createHash('sha256').update(bytes).digest('hex');
const reports=[];
for(const amount of [-.1,-.8]) {
  const doc=loadDoc(JSON.parse(bytes.toString('utf8'))),obj=doc.objs.find(o=>o.id===187)!;
  assert.ok(obj);const original=JSON.stringify(obj.shape),source=offsetSource(obj.id,obj.shape,obj.m),plan=offsetContours([source],.2);
  assert.equal(plan.contours.length,45);assert.equal(plan.unused,6);
  const amounts=new Map<string,number>();
  for(const c of plan.contours) {
    const next=new Map(amounts);next.set(c.key,amount);
    try {offsetResults([source],plan,next,.2);amounts.set(c.key,amount);} catch {/* safe refusals retained */}
  }
  let chosen: {sub:number;u0:number;u1:number} | undefined;
  for(const c of plan.contours.filter(c=>amounts.has(c.key))) {
    for(const m of c.members) for(const r of m.ranges??[]) {
      const lo=Math.min(r.u0,r.u1),length=Math.abs(r.u1-r.u0);if(length<.01)continue;
      const span={sub:m.sub,u0:lo+length*.35,u1:lo+length*.65};
      try {offsetResults([source],plan,amounts,.2,new Set(),new Map([[source.id,[span]]]));chosen=span;break;}catch{/* try another unambiguous interval */}
    }
    if(chosen)break;
  }
  assert.ok(chosen,'at least one representative source interval must be supported');
  const exclusions=new Map([[source.id,[chosen]]]);
  const preview=offsetResults([source],plan,amounts,.2,new Set(),exclusions);
  const removals=new Set(preview.remainders.filter(r=>!r.protected).map(r=>r.key));
  const result=offsetResults([source],plan,amounts,.2,removals,exclusions),recipe=result.recipes[0]!;
  assert.equal(JSON.stringify(obj.shape),original);assert.deepEqual(recipe.base,source.base);
  assert.deepEqual(recipe.excluded,[chosen]);obj.shape=contourOffsetShape(recipe);
  assert.deepEqual(readContourOffset(obj.shape)!.excluded,[chosen]);
  const reopened=offsetSource(obj.id,obj.shape,obj.m),replan=offsetContours([reopened],.2);
  const repeat=offsetResults([reopened],replan,amounts,.2,removals);
  assert.deepEqual(repeat.recipes[0]!.result,recipe.result);
  const issues=checkDesign({objs:[obj],layer:id=>doc.layers[id]??defaultLayer(id),bed:doc.bed,settings:DEFAULT_CHECK});
  assert.equal(issues.filter(i=>i.kind==='open'||i.kind==='unjoined').length,0);
  reports.push({amount,detected:plan.contours.length,accepted:amounts.size,excluded:chosen,removed:removals.size,
    protected:preview.remainders.filter(r=>r.protected).length,paths:recipe.result.length,openWarnings:0});
}
assert.equal(createHash('sha256').update(readFileSync(process.argv[3])).digest('hex'),hash);
console.log(JSON.stringify({sha256:hash,reports,noProjectWrites:true},null,2));
