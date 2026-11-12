import './core-fixtures-env';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {loadDoc} from '../src/model';
import {pathIslands,pathIslandPlan} from '../src/pathIslands';
import {flattenSub} from '../src/clip';
import ClipperLib from 'clipper-lib';
import {outlinePolyline} from '../src/outlinePrecision';
import {IDENT} from '../src/model';
const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8'))),reports=[];
for(const o of doc.objs)if(o.shape.kind==='path'){
 const subs=o.shape.subs,started=performance.now();let result;
 try{result={groups:pathIslands(subs,{matrix:o.m}).length};}catch(error){result={error:String(error)};}
 const recovered=pathIslandPlan(subs,{matrix:o.m,preserveInvalid:true});
 const invalid=subs.flatMap((s,i)=>{
  try{pathIslands([s],{matrix:o.m});return [];}catch(error){
   const flat=outlinePolyline(s,o.m),poly={closed:true,nodes:flat.points.map(p=>({x:p.X/1000,y:p.Y/1000}))};let preciseError;
   try{pathIslands([poly],{matrix:IDENT});}catch(error){preciseError=String(error);}
   return [{sub:i+1,hasCurves:s.nodes.some(n=>n.cin||n.cout),coarseError:String(error),preciseError,preciseAreaMm2:Math.abs(ClipperLib.Clipper.Area(flat.points))/1e6}];
  }
 });
 reports.push({id:o.id,subs:subs.length,open:subs.filter(s=>!s.closed).length,nodes:subs.reduce((n,s)=>n+s.nodes.length,0),points:subs.reduce((n,s)=>n+flattenSub(s,o.m).length,0),
  recoverGroups:recovered.groups.length,preserved:recovered.preserved.length,recoveredSubs:recovered.groups.reduce((n,s)=>n+s.length,0),
  invalid,
  degenerate:subs.flatMap((s,i)=>{const r=flattenSub(s,o.m),area=Math.abs(ClipperLib.Clipper.Area(r));return r.length<3||area<1?[{sub:i+1,points:r.length,areaMm2:area/1e6}]:[]}),
  elapsedMs:performance.now()-started,...result});
}
assert.deepEqual(readFileSync(file),bytes);
console.log(JSON.stringify({noProjectWrites:true,reports},null,2));
