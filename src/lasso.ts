import { Pt } from './model';
/** Boundary-inclusive even-odd hit, also valid for a self-crossing lasso. */
export function insideLasso(point:Pt,polygon:Pt[]):boolean {
  if(polygon.length<3)return false;
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j],b=polygon[i],dx=b.x-a.x,dy=b.y-a.y;
    const den=dx*dx+dy*dy,u=den?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/den)):0;
    if(Math.hypot(point.x-a.x-u*dx,point.y-a.y-u*dy)<1e-8)return true;
    if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
