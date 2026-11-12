// Focused read-only diagnosis of an editing target and a selected source section.
import './core-fixtures-env';
import {readFileSync} from 'node:fs';
import {loadDoc,defaultLayer} from '../src/model';
import {offsetSource,offsetContours,offsetResults} from '../src/contourOffset';
import {offsetContourSections} from '../src/contourOffsetSections';
import {assessOffsetOutput} from '../src/contourOffsetValidation';
const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8')));
const objects=doc.objs.filter(o=>[154,155,156,157,158].includes(o.id)),sources=objects.map(o=>offsetSource(o.id,o.shape,o.m));
const plan=offsetContours(sources,.2),index=Number(process.argv[4]??13)-1,c=plan.contours[index];
const sections=offsetContourSections(sources,plan,c.key,.2),reports=[];
for(const amount of [-.2,-.5])for(const section of [undefined,sections[0]]){
 try {
  const r=offsetResults(sources,plan,new Map([[c.key,amount]]),.2,new Set(),new Map(section?[[section.id,section.spans]]:[]));
  reports.push({amount,section:section??null,outcome:'computed',assessment:assessOffsetOutput(sources,r.recipes,r.preview,objects.map(o=>doc.layers[o.layer]??defaultLayer(o.layer)))});
 }catch(error){reports.push({amount,section:section??null,error:String(error),cause:(error as Error).cause});}
}
console.log(JSON.stringify({contours:plan.contours.length,target:index+1,owners:[...new Set(c.members.map(m=>sources[m.owner].id))],sections:sections.length,reports},null,2));
