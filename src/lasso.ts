import { apply, Obj, Pt } from './model';
import { bezierPt, boundsOf, imageContourHitsSegment, imageContourSegmentCuts, segments, shapeSubs } from './geom';
import { resolveImageContour } from './imageContour';
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

function orient(a:Pt,b:Pt,c:Pt):number {
  const v=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  return v>0?1:v<0?-1:0;
}
function onSeg(a:Pt,b:Pt,c:Pt):boolean {
  return Math.min(a.x,c.x)<=b.x && b.x<=Math.max(a.x,c.x) && Math.min(a.y,c.y)<=b.y && b.y<=Math.max(a.y,c.y);
}
/** Standard-Orientierungstest: schneiden sich die geschlossenen Segmente ab und cd (inkl. Berührung)? */
function segsCross(a:Pt,b:Pt,c:Pt,d:Pt):boolean {
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if(o1!==o2 && o3!==o4)return true;
  return (o1===0 && onSeg(a,c,b)) || (o2===0 && onSeg(a,d,b)) || (o3===0 && onSeg(c,a,d)) || (o4===0 && onSeg(c,b,d));
}

/** Touch-Hit fürs Objekt-Lasso (CCW/Berührung): schneidet die Lasso-Linie eine Objektkontur?
 * Die Outline kommt aus shapeSubs und wird mit o.m in Weltkoordinaten gebracht;
 * Bézier-Segmente werden wie in geom.ts mit 1/16-Schritten gesampelt.
 * Leere Subs (z. B. Gruppen, Text ohne Kontur) ergeben false. Eingaben werden nicht verändert. */
export function touchHit(points:Pt[],o:Obj):boolean {
  if(points.length<2)return false;
  const b=boundsOf([o]);
  if(!b)return false;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of points) {
    if(p.x<x0)x0=p.x; if(p.y<y0)y0=p.y; if(p.x>x1)x1=p.x; if(p.y>y1)y1=p.y;
  }
  if(x1<b.x || x0>b.x+b.w || y1<b.y || y0>b.y+b.h)return false;
  if(o.shape.kind==='image' && o.shape.edit!==undefined) {
    const result=resolveImageContour(o.shape,o.m);
    if(!result.ok)return false;
    for(let i=0;i<points.length-1;i++)
      if(imageContourHitsSegment(result.contour,points[i],points[i+1]))return true;
    return points.length>=3 && imageContourHitsSegment(result.contour,points[points.length-1],points[0]);
  }
  const subs=shapeSubs(o.shape);
  if(!subs.length)return false;
  const outline:[Pt,Pt][]=[];
  for(const sp of subs) for(const s of segments(sp)) {
    if(!s.curve) { outline.push([apply(o.m,s.a.x,s.a.y),apply(o.m,s.b.x,s.b.y)]); continue; }
    const q0=bezierPt(s.a,s.c1,s.c2,s.b,0);
    let prev=apply(o.m,q0.x,q0.y);
    for(let i=1;i<=16;i++) {
      const q=bezierPt(s.a,s.c1,s.c2,s.b,i/16),w=apply(o.m,q.x,q.y);
      outline.push([prev,w]); prev=w;
    }
  }
  if(!outline.length)return false;
  const n=points.length;
  for(let i=0;i<n-1;i++) {
    const a=points[i],e=points[i+1];
    for(const [c,d] of outline) if(segsCross(a,e,c,d))return true;
  }
  // Das Lasso wird geschlossen gezeichnet (render.ts): auch die Schlusskante zählt.
  if(n>=3) {
    const a=points[n-1],e=points[0];
    for(const [c,d] of outline) if(segsCross(a,e,c,d))return true;
  }
  return false;
}

/** Enclose the visible image, allowing boundary contact but rejecting concave cuts through arcs. */
export function imageEnclosedByLasso(points:Pt[],o:Obj):boolean {
  if(points.length<3 || o.shape.kind!=='image')return false;
  const result=resolveImageContour(o.shape,o.m);
  if(!result.ok)return false;
  const contour=result.contour;
  if(!contour.corners.every(c=>insideLasso(c.start,points) && insideLasso(c.end,points)))return false;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    const cuts=[0,...imageContourSegmentCuts(contour,a,b),1].sort((a,b)=>a-b);
    // Exact intersections partition each lasso edge into wholly inside/outside intervals.
    // An edge in the image interior excludes visible content; tangency/overlap does not.
    for(let j=1;j<cuts.length;j++) {
      if(cuts[j]===cuts[j-1])continue;
      const u=(cuts[j]+cuts[j-1])/2,p={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
      if(contour.contains(p) && !imageContourHitsSegment(contour,p,p))return false;
    }
  }
  return true;
}

/** Vorzeichenbehaftete Shoelace-Fläche des Lassos in Weltkoordinaten (y wächst nach
 * unten wie auf dem Bildschirm): positiv = im Uhrzeigersinn (CW), negativ = gegen den
 * Uhrzeigersinn (CCW). Selbstkreuzungen löschen sich per Vorzeichen aus (Figur-8 ≈ 0). */
export function lassoWinding(points:Pt[]):number {
  let s=0;
  for(let i=0,n=points.length;i<n;i++) {
    const a=points[i],b=points[(i+1)%n];
    s+=a.x*b.y-b.x*a.y;
  }
  return s/2;
}

/** Anteil der Lasso-BBox-Fläche, unter dem ein Lasso als richtungslos gilt. */
const LASSO_WINDING_EPS=1e-6;

/** Modusschalter per Drehrichtung: CCW (negativ) = Berührung, sonst Einschluss.
 * |Fläche| < eps (LASSO_WINDING_EPS * BBox-Fläche) → Einschluss-Default; das deckt
 * Figur-8/selbstkreuzende Lassos mit Flächenauslöschung, entartete BBoxen
 * (Hin-und-her-Linie) und Mini-Lassos ab. */
export function lassoTouchMode(points:Pt[]):boolean {
  if(points.length<3)return false;
  const w=lassoWinding(points);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of points) {
    if(p.x<x0)x0=p.x; if(p.y<y0)y0=p.y; if(p.x>x1)x1=p.x; if(p.y>y1)y1=p.y;
  }
  const bbox=(x1-x0)*(y1-y0);
  if(!(bbox>0))return false;
  if(Math.abs(w)<LASSO_WINDING_EPS*bbox)return false;
  return w<0;
}
