// Read-only floating-point diagnosis: distinguish grid contacts from real output crossings.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadDoc,IDENT,type SubPath} from '../src/model';
import {piecesOf,subPiece,type Piece} from '../src/pathtools';
import {bezierPt} from '../src/curves';
import {outlinePolyline} from '../src/outlinePrecision';
import {preciseOutlinePlan,outlineResult} from '../src/outline';
import {pathIslands} from '../src/pathIslands';
import ClipperLib from 'clipper-lib';
import {flattenSub} from '../src/clip';
import {validateContourTopology,prepareContourTopology} from '../src/contourTopology';
const file=process.argv[3],bytes=readFileSync(file),doc=loadDoc(JSON.parse(bytes.toString('utf8')));
type P={x:number;y:number;u:number};
function diagnose(s:SubPath){
 let topologyFailure:unknown;
 try{validateContourTopology([s]);}catch(error){topologyFailure={cause:(error as Error).cause,details:(error as Error&{details?:unknown}).details,spanSizes:prepareContourTopology(s).spans.map(s=>Math.hypot(s.box.x1-s.box.x0,s.box.y1-s.box.y0))};}
 let coarseFailure:unknown;
 try{pathIslands([s]);}catch(error){
  const cause=(error as Error).cause as {segments?:number[]}|undefined,parameters:number[]=[],ring=flattenSub(s,IDENT,parameters);
  coarseFailure={error:String(error),cause,edges:cause?.segments?.map(i=>({index:i,from:ring[i],to:ring[(i+1)%ring.length],u0:parameters[i],u1:parameters[(i+1)%ring.length]}))};
 }
 const points:P[]=[],push=(p:{x:number;y:number},u:number)=>{const last=points.at(-1);if(!last||Math.hypot(last.x-p.x,last.y-p.y)>1e-12)points.push({...p,u});};
 push(s.nodes[0],0);
 const pieces=piecesOf(s);
 pieces.forEach((piece,k)=>{
  const visit=(p:Piece,lo:number,hi:number,depth:number)=>{
   const dx=p.b.x-p.a.x,dy=p.b.y-p.a.y,l2=dx*dx+dy*dy;
   const dist=(q:{x:number;y:number})=>{const t=l2?Math.max(0,Math.min(1,((q.x-p.a.x)*dx+(q.y-p.a.y)*dy)/l2)):0;return Math.hypot(q.x-p.a.x-t*dx,q.y-p.a.y-t*dy);};
   if(!p.curve||depth===28||Math.max(dist(p.c1),dist(p.c2))<=1e-7){push(p.b,k+hi);return;}
   const mid=(lo+hi)/2;visit(subPiece(p,0,.5),lo,mid,depth+1);visit(subPiece(p,.5,1),mid,hi,depth+1);
  };visit(piece,0,1,0);
 });
 if(Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y)<1e-12)points.pop();
 const edges=points.map((a,i)=>{const b=points[(i+1)%points.length];return {a,b,i,x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)};}).sort((a,b)=>a.x0-b.x0);
 const crossings:unknown[]=[];
 const evaluate=(u:number)=>{const k=Math.min(pieces.length-1,Math.floor(u)),p=pieces[k],t=u-k;
  return {p:p.curve?bezierPt(p.a,p.c1,p.c2,p.b,t):{x:p.a.x+t*(p.b.x-p.a.x),y:p.a.y+t*(p.b.y-p.a.y)},d:p.curve?{x:3*((1-t)**2*(p.c1.x-p.a.x)+2*(1-t)*t*(p.c2.x-p.c1.x)+t*t*(p.b.x-p.c2.x)),y:3*((1-t)**2*(p.c1.y-p.a.y)+2*(1-t)*t*(p.c2.y-p.c1.y)+t*t*(p.b.y-p.c2.y))}:{x:p.b.x-p.a.x,y:p.b.y-p.a.y}};};
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].x0<=edges[i].x1;j++){
  const a=edges[i],b=edges[j];if(a.y0>b.y1||a.y1<b.y0||Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===points.length-1)continue;
  const dx=a.b.x-a.a.x,dy=a.b.y-a.a.y,ex=b.b.x-b.a.x,ey=b.b.y-b.a.y,den=dx*ey-dy*ex;
  if(Math.abs(den)<1e-24)continue;
  const qx=b.a.x-a.a.x,qy=b.a.y-a.a.y,t=(qx*ey-qy*ex)/den,u=(qx*dy-qy*dx)/den;
  if(t>1e-9&&t<1-1e-9&&u>1e-9&&u<1-1e-9&&crossings.length<6){
   let ua=a.a.u+t*((a.b.u>a.a.u?a.b.u:pieces.length)-a.a.u),ub=b.a.u+u*((b.b.u>b.a.u?b.b.u:pieces.length)-b.a.u);
   for(let k=0;k<20;k++){
    const A=evaluate(ua),B=evaluate(ub),qx=B.p.x-A.p.x,qy=B.p.y-A.p.y,den=A.d.x*B.d.y-A.d.y*B.d.x;
    if(Math.hypot(qx,qy)<1e-12||Math.abs(den)<1e-20)break;
    const da=(qx*B.d.y-qy*B.d.x)/den,db=(qx*A.d.y-qy*A.d.x)/den;
    if(Math.floor(ua+da)!==Math.floor(ua)||Math.floor(ub+db)!==Math.floor(ub))break;
    ua+=da;ub+=db;
   }
   const A=evaluate(ua),B=evaluate(ub);
   crossings.push({segments:[a.a.u,b.a.u],refinedParameters:[ua,ub],refinedResidualMm:Math.hypot(A.p.x-B.p.x,A.p.y-B.p.y),point:A.p});
  }
 }
 const origin=points[0];let area=0;
 points.forEach((p,i)=>{const q=points[(i+1)%points.length];area+=(p.x-origin.x)*(q.y-origin.y)-(q.x-origin.x)*(p.y-origin.y);});
 return {nodes:s.nodes.length,samples:points.length,areaMm2:area/2,coarseFailure,topologyFailure,zeroSourceEdges:pieces.flatMap((p,i)=>!p.curve&&Math.hypot(p.b.x-p.a.x,p.b.y-p.a.y)<1e-12?[i]:[]),crossings,rasterAreaMm2:ClipperLib.Clipper.Area(outlinePolyline(s,IDENT).points)/1e6};
}
const reports=[];
for(const o of doc.objs)if(o.shape.kind==='path'&&o.id===233){
 reports.push({id:o.id,name:o.name,subs:[4,5,10,11,19,30,36,38,42,43,51].map(i=>{const s=o.shape.kind==='path'?o.shape.subs[i-1]:null!;let worldCoarseError;try{pathIslands([s],{matrix:o.m});}catch(error){worldCoarseError=String(error);}return {sub:i,worldCoarseError,...diagnose(s)};})});
}
if(!reports.length){
 const objects=doc.objs.filter(o=>o.id>=117&&o.id<=124);
 for(const tolerance of [.05,.2,.3]){
  const start=performance.now(),plan=preciseOutlinePlan(objects,tolerance,true),selected=new Set(plan.holes.flatMap((_,i)=>plan.islandErrors?.[i]?[]:[i])),output=outlineResult(plan,selected,'islands');
  const bad=output.flatMap((s,i)=>{try{pathIslands([s]);return [];}catch(error){return [{sub:i+1,error:String(error),...diagnose(s)}];}});
  reports.push({ids:objects.map(o=>o.id),tolerance,islands:plan.holes.length,selected:selected.size,output:output.length,elapsedMs:performance.now()-start,bad});
 }
}
assert.deepEqual(readFileSync(file),bytes);
console.log(JSON.stringify({noProjectWrites:true,curveErrorMm:1e-7,unquantized:true,limitations:'Adaptive sampled proper crossings, not a certified exact topology proof; collinear contacts not classified.',reports},null,2));
