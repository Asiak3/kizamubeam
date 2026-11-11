// Topology checks on source Béziers, not on rounded detection polygons.
// Convex-hull subdivision proves separation; unresolved numerical contacts fail
// closed. The numerical resolution is 1e-10 mm, not a manufacturing tolerance.
import { apply, IDENT, type Mat, type Pt, type SubPath } from './model';
import { piecesOf, subPiece, type Piece } from './pathtools';
import { bezierPt } from './curves';

const EPS = 1e-10;
const dist = (a:Pt,b:Pt) => Math.hypot(a.x-b.x,a.y-b.y);
const fail = (reason:string):never => { throw Object.assign(new Error('contour-topology'),{cause:reason}); };
export interface TopologyBudget { work:number }
const tick = (budget:TopologyBudget) => { if (++budget.work>4_000_000) fail('contour-topology-budget'); };
type Bounds = {x0:number;x1:number;y0:number;y1:number};
type Span = {piece:Piece; points:Pt[]; box:Bounds};
export interface ContourTopology { spans:Span[]; area:number; box:Bounds }
const bounds = (points:Pt[]):Bounds => ({x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))});
const span = (piece:Piece):Span => {const points=piece.curve?[piece.a,piece.c1,piece.c2,piece.b]:[piece.a,piece.b];return {piece,points,box:bounds(points)};};
const disjoint = (a:Bounds,b:Bounds) => a.x0>b.x1+EPS||b.x0>a.x1+EPS||a.y0>b.y1+EPS||b.y0>a.y1+EPS;
const diameter = (s:Span) => Math.hypot(s.box.x1-s.box.x0,s.box.y1-s.box.y0);

// Derivative roots split a cubic into x/y-monotone spans. Thus an individual
// span cannot hide a loop; overlapping/backtracking spans are checked below.
function roots(a:number,b:number,c:number,d:number):number[] {
  const e=b-a,f=c-b,g=d-c,A=e-2*f+g,B=2*(f-e),C=e;
  if(A===0)return B===0?[]:[-C/B].filter(t=>t>0&&t<1);
  const D=B*B-4*A*C;if(D<0)return [];
  const q=-.5*(B+(B<0?-1:1)*Math.sqrt(D));
  return (q===0?[-B/(2*A)]:[q/A,C/q]).filter(t=>t>0&&t<1);
}

export function prepareContourTopology(source:SubPath,matrix:Mat=IDENT,budget:TopologyBudget={work:0}):ContourTopology {
  if(!source.closed||source.nodes.length<2)fail('contour-not-closed');
  const world:SubPath={...source,nodes:source.nodes.map(n=>({...n,...apply(matrix,n.x,n.y),...(n.cin?{cin:apply(matrix,n.cin.x,n.cin.y)}:{}),...(n.cout?{cout:apply(matrix,n.cout.x,n.cout.y)}:{})}))};
  if(world.nodes.some(n=>[n,n.cin,n.cout].some(p=>p&&(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6))))fail('contour-invalid');
  const spans:Span[]=[];
  let integral=0,magnitude=0;
  const origin=world.nodes[0];
  for(const p of piecesOf(world)){
    tick(budget);
    // Exact zero spans are ignored for classification only. Output/source
    // definitions, including coincident nodes and their handles, stay intact.
    if((p.curve?[p.c1,p.c2,p.b]:[p.b]).every(q=>q.x===p.a.x&&q.y===p.a.y))continue;
    const ts=p.curve?[...new Set([0,...roots(p.a.x,p.c1.x,p.c2.x,p.b.x),...roots(p.a.y,p.c1.y,p.c2.y,p.b.y),1])].sort((a,b)=>a-b):[0,1];
    for(let i=1;i<ts.length;i++)if(ts[i]>ts[i-1]){
      const s=span(subPiece(p,ts[i-1],ts[i]));
      // Independent x/y derivative roots can delimit an interval which rounds
      // to one identical point. It has no edge for adjacency classification.
      if(!s.points.every(q=>q.x===s.points[0].x&&q.y===s.points[0].y))spans.push(s);
    }
    // Three-point Gauss quadrature exactly integrates the degree-five area
    // polynomial (up to floating-point arithmetic). Translate before products.
    for(const [t,w] of [[.5-Math.sqrt(15)/10,5/18],[.5,4/9],[.5+Math.sqrt(15)/10,5/18]]){
      const q=p.curve?bezierPt(p.a,p.c1,p.c2,p.b,t):{x:p.a.x+t*(p.b.x-p.a.x),y:p.a.y+t*(p.b.y-p.a.y)};
      const dx=p.curve?3*((1-t)**2*(p.c1.x-p.a.x)+2*(1-t)*t*(p.c2.x-p.c1.x)+t*t*(p.b.x-p.c2.x)):p.b.x-p.a.x;
      const dy=p.curve?3*((1-t)**2*(p.c1.y-p.a.y)+2*(1-t)*t*(p.c2.y-p.c1.y)+t*t*(p.b.y-p.c2.y)):p.b.y-p.a.y;
      const a=(q.x-origin.x)*dy*w,b=(q.y-origin.y)*dx*w;integral+=a-b;magnitude+=Math.abs(a)+Math.abs(b);
    }
  }
  if(!spans.length||Math.abs(integral)<=64*Number.EPSILON*magnitude)fail('contour-degenerate');
  return {spans,area:integral/2,box:bounds(spans.flatMap(s=>s.points))};
}

function hullsSeparate(a:Span,b:Span,allowed:Pt[]):boolean {
  if(disjoint(a.box,b.box))return true;
  const axes:Pt[]=[{x:1,y:0},{x:0,y:1}];
  for(const s of [a,b])for(let i=0;i<s.points.length;i++)for(let j=i+1;j<s.points.length;j++){
    const dx=s.points[j].x-s.points[i].x,dy=s.points[j].y-s.points[i].y,len=Math.hypot(dx,dy);if(len)axes.push({x:-dy/len,y:dx/len});
  }
  // Subtract one common origin so projected coordinates do not lose tiny gaps
  // just because a contour was moved to another location on the workspace.
  const origin=a.points[0];
  for(const axis of axes){
    const dot=(p:Pt)=>(p.x-origin.x)*axis.x+(p.y-origin.y)*axis.y;
    const av=a.points.map(dot),bv=b.points.map(dot),amin=Math.min(...av),amax=Math.max(...av),bmin=Math.min(...bv),bmax=Math.max(...bv);
    if(amax<bmin-EPS||bmax<amin-EPS)return true;
    // Adjacent spans may share their declared endpoint, never an overlapping
    // edge. A separating support line whose contact set is just that endpoint
    // proves that no other intersection is possible.
    for(const p of allowed){
      const at=dot(p);
      const only=(s:Span,vs:number[],edge:number)=>s.points.every((q,i)=>Math.abs(vs[i]-edge)>EPS||dist(q,p)<=EPS);
      if(Math.abs(amax-bmin)<=EPS&&Math.abs(at-amax)<=EPS&&(only(a,av,amax)||only(b,bv,bmin)))return true;
      if(Math.abs(bmax-amin)<=EPS&&Math.abs(at-amin)<=EPS&&(only(a,av,amin)||only(b,bv,bmax)))return true;
    }
  }
  return false;
}

function contact(a:Span,b:Span,allowed:Pt[],budget:TopologyBudget,depth=0):boolean {
  tick(budget);
  if(hullsSeparate(a,b,allowed))return false;
  if(!a.piece.curve&&!b.piece.curve){
    const A=a.piece,B=b.piece,dx=A.b.x-A.a.x,dy=A.b.y-A.a.y,ex=B.b.x-B.a.x,ey=B.b.y-B.a.y;
    const den=dx*ey-dy*ex,qx=B.a.x-A.a.x,qy=B.a.y-A.a.y;
    if(den!==0){
      const t=(qx*ey-qy*ex)/den,u=(qx*dy-qy*dx)/den;
      if(t<0||t>1||u<0||u>1)return false;
      const p={x:A.a.x+t*dx,y:A.a.y+t*dy};return !allowed.some(q=>dist(p,q)<=EPS);
    }
    // Collinear hull overlap was not separated above: a shared interval or an
    // undeclared contact is unsafe, including immediate direction reversal.
    return true;
  }
  if(depth>=56||Math.max(diameter(a),diameter(b))<=EPS){
    return !allowed.some(p=>a.points.every(q=>dist(q,p)<=EPS)&&b.points.every(q=>dist(q,p)<=EPS));
  }
  if(diameter(a)>=diameter(b))return contact(span(subPiece(a.piece,0,.5)),b,allowed,budget,depth+1)||contact(span(subPiece(a.piece,.5,1)),b,allowed,budget,depth+1);
  return contact(a,span(subPiece(b.piece,0,.5)),allowed,budget,depth+1)||contact(a,span(subPiece(b.piece,.5,1)),allowed,budget,depth+1);
}

/** Validate all contours together: holes/islands may not intersect or touch. */
export function validateContourTopologies(contours:ContourTopology[],budget:TopologyBudget={work:0},crossContoursOnly=false):void {
  const spans=contours.flatMap((c,r)=>c.spans.map((s,i)=>({...s,r,i,n:c.spans.length}))).sort((a,b)=>a.box.x0-b.box.x0);
  for(let i=0;i<spans.length;i++)for(let j=i+1;j<spans.length&&spans[j].box.x0<=spans[i].box.x1+EPS;j++){
    tick(budget);const a=spans[i],b=spans[j];if((crossContoursOnly&&a.r===b.r)||disjoint(a.box,b.box))continue;
    const allowed:Pt[]=[];
    if(a.r===b.r&&((a.i+1)%a.n===b.i||(b.i+1)%b.n===a.i)){
      if((a.i+1)%a.n===b.i&&dist(a.piece.b,b.piece.a)<=EPS)allowed.push(a.piece.b);
      if((b.i+1)%b.n===a.i&&dist(b.piece.b,a.piece.a)<=EPS)allowed.push(b.piece.b);
    }
    if(contact(a,b,allowed,budget))throw Object.assign(new Error('contour-topology'),{cause:'contour-contact',details:{contours:[a.r,b.r],spans:[a.i,b.i],pieces:[a.piece,b.piece],allowed}});
  }
}

export function validateContourTopology(subs:SubPath[],matrix:Mat=IDENT):void {
  const budget={work:0};validateContourTopologies(subs.map(s=>prepareContourTopology(s,matrix,budget)),budget);
}

/** Even-odd ray test on y-monotone Bézier spans, without integer rounding. */
export function contourContains(contour:ContourTopology,p:Pt):boolean {
  if(p.x<contour.box.x0||p.x>contour.box.x1||p.y<contour.box.y0||p.y>contour.box.y1)return false;
  let inside=false;
  for(const {piece:q} of contour.spans){
    if((q.a.y>p.y)===(q.b.y>p.y))continue;
    let x:number;
    if(!q.curve)x=q.a.x+(q.b.x-q.a.x)*(p.y-q.a.y)/(q.b.y-q.a.y);
    else {let lo=0,hi=1;for(let i=0;i<48;i++){const mid=(lo+hi)/2,v=bezierPt(q.a,q.c1,q.c2,q.b,mid);if((v.y<p.y)===(q.a.y<q.b.y))lo=mid;else hi=mid;}x=bezierPt(q.a,q.c1,q.c2,q.b,(lo+hi)/2).x;}
    if(x>p.x)inside=!inside;
  }
  return inside;
}
