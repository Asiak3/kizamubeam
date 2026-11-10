import { Node, Pt, SubPath } from './model';
import { fitPoints } from './vectorFit';
import { t } from './i18n';

export type FreehandMode='continue'|'redraw';
/** Existing-node anchors make the replaced interval explicit. Exact untouched
 * nodes/handles, subpath order and fixed starts remain intact. */
export function editFreehandSubpath(source:SubPath, samples:Pt[], start:number, end:number|null, mode:FreehandMode,tolerance:number):SubPath {
  const n=source.nodes.length;
  if(n<2 || !Number.isInteger(start) || start<0 || start>=n || samples.length<2)
    throw Error(t('Freihand: an einem vorhandenen Knoten beginnen und ziehen.'));
  if(mode==='continue' && (source.closed || (start!==0 && start!==n-1)))throw Error(t('Fortsetzen: einen Endknoten eines offenen Pfads wählen.'));
  if(mode==='continue' && start===0 && source.start)throw Error(t('Fortsetzen am Anfang würde den festen Schnittstart verschieben. Startpunkt zuerst ausdrücklich freigeben.'));
  if(mode==='redraw' && (end===null || !Number.isInteger(end) || end<0 || end>=n || end===start))
    throw Error(t('Neuzeichnen: an einem anderen Knoten desselben Teilpfads loslassen.'));
  const points=samples.map(p=>({...p}));points[0]={x:source.nodes[start].x,y:source.nodes[start].y};
  if(mode==='redraw')points[points.length-1]={x:source.nodes[end!].x,y:source.nodes[end!].y};
  if(points.every(p=>Math.hypot(p.x-points[0].x,p.y-points[0].y)<0.001))throw Error(t('Freihand: der Strich ist zu kurz.'));
  // Fit callers pass world geometry so tolerance always means world millimetres.
  let fitted=fitPoints(points,false,{tolerance,curves:true,preserveCorners:true});
  if(fitted.nodes.length<2)throw Error(t('Freihand: der Strich ist zu kurz.'));
  const reverse=(nodes:Node[])=>nodes.reverse().map(n=>({...n,cin:n.cout,cout:n.cin}));
  const merge=(a:Node[],b:Node[])=>{
    if(!a.length)return b;
    if(!b.length)return a;
    const seam={...a.at(-1)!,cout:b[0].cout,smooth:false};
    if(!seam.cout)delete seam.cout;
    return [...a.slice(0,-1),seam,...b.slice(1)];
  };
  const original=structuredClone(source.nodes);
  let nodes:Node[];
  if(mode==='continue') {
    nodes=start===0?merge(reverse(fitted.nodes),original):merge(original,fitted.nodes);
  }else{
    if(start>end!)fitted={...fitted,nodes:reverse(fitted.nodes)};
    const lo=Math.min(start,end!),hi=Math.max(start,end!);
    nodes=merge(merge(original.slice(0,lo+1),fitted.nodes),original.slice(hi));
  }
  return {...source,nodes};
}
