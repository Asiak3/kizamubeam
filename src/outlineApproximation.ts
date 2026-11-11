// Validate a detected island polygon without smoothing, joining or deleting spans.
import ClipperLib from 'clipper-lib';
import { SCALE, type Paths } from './clip';
import type { ShapeRegion } from './shapeRegions';

export function outlineApproximation(region: ShapeRegion): Paths | null {
  const rings: Paths = [];
  for (const sub of region.subs) {
    if (!sub.closed || sub.nodes.length < 3 || sub.nodes.some(n => n.cin || n.cout ||
      !Number.isFinite(n.x) || !Number.isFinite(n.y) || Math.abs(n.x)>10000 || Math.abs(n.y)>10000)) return null;
    const ring=sub.nodes.map(n=>({X:Math.round(n.x*SCALE),Y:Math.round(n.y*SCALE)}));
    if(!ClipperLib.Clipper.Area(ring))return null;
    rings.push(ring);
  }
  if(!rings.length||rings.reduce((n,r)=>n+r.length,0)>20000)return null;
  const cross=(a:typeof rings[0][0],b:typeof a,c:typeof a)=>(b.X-a.X)*(c.Y-a.Y)-(b.Y-a.Y)*(c.X-a.X);
  const contact=(a:typeof rings[0][0],b:typeof a,c:typeof a,d:typeof a)=>{
    if(Math.max(a.X,b.X)<Math.min(c.X,d.X)||Math.max(c.X,d.X)<Math.min(a.X,b.X)||Math.max(a.Y,b.Y)<Math.min(c.Y,d.Y)||Math.max(c.Y,d.Y)<Math.min(a.Y,b.Y))return false;
    const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);
    return ((x<=0&&y>=0)||(x>=0&&y<=0))&&((u<=0&&v>=0)||(u>=0&&v<=0));
  };
  let work=0;
  for(let r=0;r<rings.length;r++)for(let i=0;i<rings[r].length;i++){
    const a=rings[r],p=a[i],q=a[(i+1)%a.length],before=a[(i+a.length-1)%a.length];
    if(p.X===q.X&&p.Y===q.Y)return null;
    if(cross(before,p,q)===0&&(p.X-before.X)*(q.X-p.X)+(p.Y-before.Y)*(q.Y-p.Y)<=0)return null;
    for(let s=r;s<rings.length;s++)for(let j=s===r?i+1:0;j<rings[s].length;j++){
      if(++work>2000000)return null;
      if(r===s&&(j===i+1||(i===0&&j===a.length-1)))continue;
      const b=rings[s];if(contact(p,q,b[j],b[(j+1)%b.length]))return null;
    }
  }
  for(let i=1;i<rings.length;i++){
    if(rings[i].some(p=>ClipperLib.Clipper.PointInPolygon(p,rings[0])!==1))return null;
    for(let j=1;j<i;j++)if(ClipperLib.Clipper.PointInPolygon(rings[i][0],rings[j])!==0||ClipperLib.Clipper.PointInPolygon(rings[j][0],rings[i])!==0)return null;
  }
  return rings;
}
