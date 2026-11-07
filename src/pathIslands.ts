import ClipperLib from 'clipper-lib';
import { flattenSub } from './clip';
import { apply, IDENT, Mat, SubPath } from './model';
import { t } from './i18n';

type P = { X: number; Y: number };
const cross = (a: P, b: P, c: P) => (b.X-a.X)*(c.Y-a.Y)-(b.Y-a.Y)*(c.X-a.X);
function contact(a: P, b: P, c: P, d: P) {
  if (Math.max(a.X,b.X)<Math.min(c.X,d.X) || Math.max(c.X,d.X)<Math.min(a.X,b.X) ||
      Math.max(a.Y,b.Y)<Math.min(c.Y,d.Y) || Math.max(c.Y,d.Y)<Math.min(a.Y,b.Y)) return false;
  const x=cross(a,b,c), y=cross(a,b,d), u=cross(c,d,a), v=cross(c,d,b);
  return ((x<=0 && y>=0)||(x>=0 && y<=0)) && ((u<=0 && v>=0)||(u>=0 && v<=0));
}

/** Classify only: returned subpaths are exact original Béziers, never refitted.
 * Even-odd islands; ambiguous/touching/open geometry rejects transactionally. */
export interface IslandOptions { distance?:number; closeGaps?:boolean; gapTolerance?:number; matrix?:Mat }
export function pathIslands(source: SubPath[], options:IslandOptions={}): SubPath[][] {
  const {distance=0,closeGaps=false,gapTolerance=0.01,matrix=IDENT}=options;
  if(!Number.isFinite(distance)||distance<0||distance>1000||!Number.isFinite(gapTolerance)||gapTolerance<0||gapTolerance>10 ||
     matrix.some(v=>!Number.isFinite(v)) || Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-12)
    throw Error(t('Pfadinseln: ungültige Abstandseinstellungen oder Transformation.'));
  const subs=source.map(s=>{
    if(s.closed || !closeGaps || s.nodes.length<3)return s;
    const a=apply(matrix,s.nodes[0].x,s.nodes[0].y),b=apply(matrix,s.nodes.at(-1)!.x,s.nodes.at(-1)!.y);
    if(Math.hypot(a.x-b.x,a.y-b.y)>gapTolerance)return s;
    // Explicit closing segment only; never move endpoints or join different subpaths.
    return {...s,closed:true};
  });
  if (!subs.length || subs.length>256 || subs.some(s=>!s.closed || s.nodes.length<3))
    throw Error(t('Pfadinseln: nur geschlossene, nicht entartete Teilpfade (höchstens 256).'));
  if (subs.some(s=>s.nodes.some(n=>[n,n.cin,n.cout].some(p=>p && (!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6)))))
    throw Error(t('Pfadinseln: ungültige oder zu große Koordinaten.'));
  if (subs.reduce((n,s)=>n+s.nodes.length,0)>4096) throw Error(t('Pfadinseln: Geometriebudget überschritten.'));
  if(subs.some(s=>s.nodes.some(n=>[n,n.cin,n.cout].some(p=>{
    if(!p)return false;const world=apply(matrix,p.x,p.y);return !Number.isFinite(world.x)||!Number.isFinite(world.y)||Math.abs(world.x)>1e6||Math.abs(world.y)>1e6;
  }))))throw Error(t('Pfadinseln: ungültige oder zu große Koordinaten.'));
  const rings = subs.map(s=>flattenSub(s,matrix));
  if (rings.reduce((n,r)=>n+r.length,0)>4096 || rings.some(r=>r.length<3 || Math.abs(ClipperLib.Clipper.Area(r))<1))
    throw Error(t('Pfadinseln: Geometriebudget überschritten oder entartete Kontur.'));
  let work=0;
  for (let r=0;r<rings.length;r++) for(let s=r;s<rings.length;s++) {
    const a=rings[r],b=rings[s];
    for(let i=0;i<a.length;i++) for(let j=r===s?i+1:0;j<b.length;j++) {
      if (++work>4_000_000) throw Error(t('Pfadinseln: Geometriebudget überschritten.'));
      if(r===s && (j===i+1 || (i===0 && j===a.length-1))) continue;
      if(contact(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))
        throw Error(t('Pfadinseln: berührende, überschneidende oder selbstschneidende Konturen zuerst bereinigen.'));
    }
  }
  const parents=rings.map((ring,i)=>rings.map((p,j)=>j!==i && ClipperLib.Clipper.PointInPolygon(ring[0],p)===1?j:-1)
    .filter(j=>j>=0).sort((a,b)=>Math.abs(ClipperLib.Clipper.Area(rings[a]))-Math.abs(ClipperLib.Clipper.Area(rings[b])))[0]??-1);
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
  if(distance>0)for(let a=0;a<components.length;a++)for(let b=a+1;b<components.length;b++) {
    let near=false;
    for(const r of components[a])for(const s of components[b]) {
      for(let i=0;i<rings[r].length && !near;i++)for(let j=0;j<rings[s].length && !near;j++) {
        if(++work>4_000_000)throw Error(t('Pfadinseln: Geometriebudget überschritten.'));
        const p=rings[r][i],q=rings[r][(i+1)%rings[r].length],u=rings[s][j],v=rings[s][(j+1)%rings[s].length];
        near=Math.min(pointDistance(p,u,v),pointDistance(q,u,v),pointDistance(u,p,q),pointDistance(v,p,q))<=distance*1000;
      }
    }
    if(near)group[find(b)]=find(a);
  }
  const result=new Map<number,SubPath[]>();
  components.forEach((component,i)=>{const key=find(i),list=result.get(key)??[];list.push(...component.map(j=>subs[j]));result.set(key,list)});
  return [...result.values()];
}
