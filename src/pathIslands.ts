import { flattenSub } from './clip';
import { apply, IDENT, Mat, SubPath } from './model';
import { t } from './i18n';
import { prepareContourTopology, validateContourTopologies, contourContains, type ContourTopology, type TopologyBudget } from './contourTopology';

type P = { X: number; Y: number };

/** Classify only: returned subpaths are exact original Béziers, never refitted.
 * Even-odd islands; ambiguous/touching/open geometry rejects transactionally. */
export interface IslandOptions { distance?:number; closeGaps?:boolean; gapTolerance?:number; matrix?:Mat; preserveInvalid?:boolean }
const budgetError=()=>Object.assign(Error(t('Pfadinseln: Geometriebudget überschritten.')),{cause:'path-islands-budget'});
function islandSettings(options:IslandOptions){
  const {distance=0,closeGaps=false,gapTolerance=0.01,matrix=IDENT}=options;
  if(!Number.isFinite(distance)||distance<0||distance>1000||!Number.isFinite(gapTolerance)||gapTolerance<0||gapTolerance>10 ||
     matrix.some(v=>!Number.isFinite(v)) || Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-12)
    throw Error(t('Pfadinseln: ungültige Abstandseinstellungen oder Transformation.'));
  return {distance,closeGaps,gapTolerance,matrix};
}
export function pathIslands(source: SubPath[], options:IslandOptions={}): SubPath[][] {
  return classifyIslands(source,options,new Map(),{work:0});
}
function topologyError(error:unknown):never {
  if(error instanceof Error&&error.message==='contour-topology'){
    if(error.cause==='contour-topology-budget')throw budgetError();
    if(error.cause==='contour-degenerate')throw Error(t('Pfadinseln: Geometriebudget überschritten oder entartete Kontur.'));
    throw Object.assign(Error(t('Pfadinseln: berührende, überschneidende oder selbstschneidende Konturen zuerst bereinigen.')),{cause:error.cause});
  }
  throw error;
}
function classifyIslands(source:SubPath[],options:IslandOptions,cache:Map<SubPath,ContourTopology>,budget:TopologyBudget):SubPath[][] {
  const {distance,closeGaps,gapTolerance,matrix}=islandSettings(options);
  const subs=source.map(s=>{
    if(s.closed || !closeGaps || s.nodes.length<3)return s;
    const a=apply(matrix,s.nodes[0].x,s.nodes[0].y),b=apply(matrix,s.nodes.at(-1)!.x,s.nodes.at(-1)!.y);
    if(Math.hypot(a.x-b.x,a.y-b.y)>gapTolerance)return s;
    // Explicit closing segment only; never move endpoints or join different subpaths.
    return {...s,closed:true};
  });
  if (!subs.length || subs.length>256 || subs.some(s=>!s.closed || s.nodes.length<2))
    throw Error(t('Pfadinseln: nur geschlossene, nicht entartete Teilpfade (höchstens 256).'));
  if (subs.some(s=>s.nodes.some(n=>[n,n.cin,n.cout].some(p=>p && (!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6)))))
    throw Error(t('Pfadinseln: ungültige oder zu große Koordinaten.'));
  if (subs.reduce((n,s)=>n+s.nodes.length,0)>16384) throw budgetError();
  if(subs.some(s=>s.nodes.some(n=>[n,n.cin,n.cout].some(p=>{
    if(!p)return false;const world=apply(matrix,p.x,p.y);return !Number.isFinite(world.x)||!Number.isFinite(world.y)||Math.abs(world.x)>1e6||Math.abs(world.y)>1e6;
  }))))throw Error(t('Pfadinseln: ungültige oder zu große Koordinaten.'));
  const rings = subs.map(s=>flattenSub(s,matrix));
  if (rings.reduce((n,r)=>n+r.length,0)>16384)throw budgetError();
  // Raster samples remain a distance approximation only. Topology/area and
  // containment use unchanged source curves, including sub-grid slivers.
  let contours:ContourTopology[];
  try{
    contours=subs.map(s=>{let c=cache.get(s);if(!c){c=prepareContourTopology(s,matrix,budget);validateContourTopologies([c],budget);cache.set(s,c);}return c;});
    validateContourTopologies(contours,budget,true);
  }catch(error){topologyError(error);}
  let work=0;
  const areas=contours!.map(c=>Math.abs(c.area));
  const parents=contours!.map((_,i)=>contours!.map((c,j)=>j!==i&&areas[j]>areas[i]&&contourContains(c,apply(matrix,subs[i].nodes[0].x,subs[i].nodes[0].y))?j:-1)
    .filter(j=>j>=0).sort((a,b)=>areas[a]-areas[b])[0]??-1);
  const depth=(i:number):number=>parents[i]<0?0:1+depth(parents[i]);
  const indices=subs.map((_,i)=>i).filter(i=>depth(i)%2===0);
  const components=indices.map(i=>[i,...subs.map((_,j)=>j).filter(j=>parents[j]===i)]);
  const group=components.map((_,i)=>i);
  const find=(i:number):number=>group[i]===i?i:(group[i]=find(group[i]));
  const pointDistance=(p:P,a:P,b:P)=>{
    const dx=b.X-a.X,dy=b.Y-a.Y,den=dx*dx+dy*dy;
    const u=den?Math.max(0,Math.min(1,((p.X-a.X)*dx+(p.Y-a.Y)*dy)/den)):0;
    return Math.hypot(p.X-a.X-u*dx,p.Y-a.Y-u*dy);
  };
  const bounds=distance>0?rings.map(r=>({x0:Math.min(...r.map(p=>p.X)),x1:Math.max(...r.map(p=>p.X)),y0:Math.min(...r.map(p=>p.Y)),y1:Math.max(...r.map(p=>p.Y))})):[];
  const limit=distance*1000;
  const apart=(a:typeof bounds[number],b:typeof a)=>Math.hypot(Math.max(0,a.x0-b.x1,b.x0-a.x1),Math.max(0,a.y0-b.y1,b.y0-a.y1))>limit;
  const segmentBounds=distance>0?rings.map(r=>r.map((p,i)=>{const q=r[(i+1)%r.length];return {x0:Math.min(p.X,q.X),x1:Math.max(p.X,q.X),y0:Math.min(p.Y,q.Y),y1:Math.max(p.Y,q.Y)};})):[];
  if(distance>0)for(let a=0;a<components.length;a++)for(let b=a+1;b<components.length;b++) {
    // Distance only joins components transitively. Already connected groups
    // and disjoint bounds cannot contribute another union. Geometry is untouched.
    if(find(a)===find(b))continue;
    let near=false;
    for(const r of components[a])for(const s of components[b]) {
      if(near||apart(bounds[r],bounds[s]))continue;
      for(let i=0;i<rings[r].length && !near;i++)for(let j=0;j<rings[s].length && !near;j++) {
         if(++work>4_000_000)throw budgetError();
         if(apart(segmentBounds[r][i],segmentBounds[s][j]))continue;
        const p=rings[r][i],q=rings[r][(i+1)%rings[r].length],u=rings[s][j],v=rings[s][(j+1)%rings[s].length];
         near=Math.min(pointDistance(p,u,v),pointDistance(q,u,v),pointDistance(u,p,q),pointDistance(v,p,q))<=limit;
      }
    }
    if(near)group[find(b)]=find(a);
  }
  const result=new Map<number,SubPath[]>();
  components.forEach((component,i)=>{const key=find(i),list=result.get(key)??[];list.push(...component.map(j=>subs[j]));result.set(key,list)});
  return [...result.values()];
}

/** Opt-in recovery keeps unclassifiable spans intact rather than deleting or
 * repairing them. Contact between individually valid paths keeps the entire
 * source intact: there is no arbitrary ownership/containment guess. */
export function pathIslandPlan(source:SubPath[],options:IslandOptions={}):{groups:SubPath[][];preserved:SubPath[];warning?:string}{
  const {matrix}=islandSettings(options);
  // Per-operation cache only: preview edits/Apply must never reuse stale geometry.
  const cache=new Map<SubPath,ContourTopology>(),budget={work:0};
  const classify=(subs:SubPath[])=>classifyIslands(subs,options,cache,budget);
  if(options.preserveInvalid){
    if(source.length>256||source.reduce((n,s)=>n+s.nodes.length,0)>16384)throw budgetError();
    for(const s of source)for(const n of s.nodes)for(const p of [n,n.cin,n.cout])if(p){
      const q=apply(matrix,p.x,p.y);
      if(![p.x,p.y,q.x,q.y].every(Number.isFinite)||Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(q.x),Math.abs(q.y))>1e6)
        throw Error(t('Pfadinseln: ungültige oder zu große Koordinaten.'));
    }
    if(source.reduce((n,s)=>n+flattenSub(s,matrix).length,0)>16384)throw budgetError();
  }
  try{return {groups:classify(source),preserved:[]};}
  catch(error){
    if(!options.preserveInvalid)throw error;
    if(error instanceof Error&&error.cause==='path-islands-budget')throw error;
    const warning=error instanceof Error?error.message:String(error);
    if(!source.length||source.length>256||source.reduce((n,s)=>n+s.nodes.length,0)>16384)
      return {groups:[source],preserved:source,warning};
    const valid:SubPath[]=[],preserved:SubPath[]=[];
    for(const sub of source){
      try{classify([sub]);valid.push(sub);}catch(error){if(error instanceof Error&&error.cause==='path-islands-budget')throw error;preserved.push(sub);}
    }
    if(!preserved.length)return {groups:[source],preserved:source,warning};
    try{
      const groups=valid.length?classify(valid):[];
      return {groups:[preserved,...groups],preserved,warning};
    }catch(error){if(error instanceof Error&&error.cause==='path-islands-budget')throw error;return {groups:[source],preserved:source,warning};}
  }
}
