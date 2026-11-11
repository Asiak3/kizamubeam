// In-memory result/checker comparison. Never writes the supplied project.
import './core-fixtures-env';
import {readFileSync} from 'node:fs';
import {loadDoc,defaultLayer,apply} from '../src/model';
import {offsetSource,offsetContours,offsetResults,contourOffsetShape} from '../src/contourOffset';
import {checkDesign,DEFAULT_CHECK} from '../src/check';
import {nearestParam} from '../src/pathtools';
const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8'))),obj=doc.objs.find(o=>o.id===187)!;
const layer=(id:number)=>doc.layers[id]??defaultLayer(id);
const check=()=>checkDesign({objs:[obj],layer,bed:doc.bed,settings:DEFAULT_CHECK}).map(i=>({kind:i.kind,message:i.msg,points:i.pts}));
const before=check(),source=offsetSource(obj.id,obj.shape,obj.m),plan=offsetContours([source],.2),amounts=new Map<string,number>();
const amount=Number(process.argv[4]??-.1);
for(const c of plan.contours){const next=new Map(amounts);next.set(c.key,amount);try{offsetResults([source],plan,next,.2);amounts.set(c.key,amount)}catch{/* report accepted only */}}
const retained=offsetResults([source],plan,amounts,.2);
// Diagnostic opt-in only: no project write and no production auto-removal rule.
const removals=new Set(process.argv[5]==='remove-previewable'?retained.remainders.filter(r=>!r.protected).map(r=>r.key):[]);
const result=offsetResults([source],plan,amounts,.2,removals),recipe=result.recipes[0]!;
obj.shape=contourOffsetShape(recipe);
const paths=recipe.result.map((sp,index)=>{
  const a=apply(obj.m,sp.nodes[0].x,sp.nodes[0].y),b=apply(obj.m,sp.nodes.at(-1)!.x,sp.nodes.at(-1)!.y);
  const gap=Math.hypot(a.x-b.x,a.y-b.y);
  const match=!sp.closed&&gap<.2?source.base.map((base,sub)=>{
    const from=nearestParam(base,a),to=nearestParam(base,b);return {sub,from,to,error:from.d+to.d};
  }).sort((a,b)=>a.error-b.error)[0]:undefined;
  return {index,nodes:sp.nodes.length,closed:sp.closed,gap,match};
});
console.log(JSON.stringify({amount,accepted:amounts.size,remainders:retained.remainders.length,protectedRemainders:retained.remainders.filter(r=>r.protected).length,removed:removals.size,before,after:check(),paths},null,2));
