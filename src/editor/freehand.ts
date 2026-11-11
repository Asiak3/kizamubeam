import type { Editor } from '../editor';
import { inv, Obj, Pt } from '../model';
import { transformSubs } from '../importers';
import { editFreehandSubpath, FreehandMode } from '../freehandEdit';
import { MAX_VECTOR_SAMPLES } from '../vectorFit';
import { t } from '../i18n';

export interface FreehandStroke { type:'freehand-edit';obj:Obj;doc:Editor['doc'];before:string;matrix:string;sub:number;start:number;pointerId:number;points:Pt[];overflow:boolean;mode:FreehandMode;tolerance:number }
export class EditorFreehand {
  beginFreehandEdit(this:Editor,point:Pt,pointerId:number) {
    if(this.sel.length!==1)return;
    const obj=this.sel[0];
    if(obj.shape.kind!=='path'||obj.shape.mark||!this.nodeTargets().includes(obj))return;
    const world=transformSubs(obj.shape.subs,obj.m);
    let best=8/this.view.zoom,hit:{sub:number;start:number}|null=null;
    world.forEach((sp,sub)=>sp.nodes.forEach((node,start)=>{
      if(this.freehandMode==='continue' && (sp.closed || (start!==0 && start!==sp.nodes.length-1) || (start===0 && sp.start)))return;
      const distance=Math.hypot(point.x-node.x,point.y-node.y);
      if(distance<best){best=distance;hit={sub,start}}
    }));
    if(!hit){this.hint=t('Freihand: nahe an einem geeigneten Knoten beginnen.');this.emit('tool');return}
    const {sub,start}=hit as {sub:number;start:number};
    this.clearSnap();this.drag={type:'freehand-edit',obj,doc:this.doc,before:JSON.stringify(obj.shape),matrix:JSON.stringify(obj.m),sub,start,pointerId,
      points:[{x:world[sub].nodes[start].x,y:world[sub].nodes[start].y}],overflow:false,mode:this.freehandMode,tolerance:this.freehandTolerance};
    this.redraw();
  }
  sampleFreehandEdit(this:Editor,point:Pt,pointerId:number) {
    const d=this.drag;if(d?.type!=='freehand-edit'||d.pointerId!==pointerId)return;
    const last=d.points.at(-1)!;
    if(Math.hypot(point.x-last.x,point.y-last.y)*this.view.zoom<1)return;
    if(d.points.length>=MAX_VECTOR_SAMPLES){d.overflow=true;return}
    d.points.push(point);this.redraw();
  }
  finishFreehandEdit(this:Editor,d:FreehandStroke,point:Pt) {
    try{
      if(d.overflow)throw Error(t('Freihand: zu viele Abtastpunkte. Kürzeren Abschnitt zeichnen.'));
      if(this.doc!==d.doc || !this.doc.objs.includes(d.obj)||this.sel.length!==1||this.sel[0]!==d.obj||!this.nodeTargets().includes(d.obj)||
        JSON.stringify(d.obj.shape)!==d.before||JSON.stringify(d.obj.m)!==d.matrix||d.obj.shape.kind!=='path')
        throw Error(t('Freihand: Quelle oder Auswahl geändert; Strich verworfen.'));
      const world=transformSubs(d.obj.shape.subs,d.obj.m),sp=world[d.sub];
      let end:number|null=null,best=8/this.view.zoom;
      sp.nodes.forEach((n,i)=>{const distance=Math.hypot(n.x-point.x,n.y-point.y);if(i!==d.start&&distance<best){best=distance;end=i}});
      const points=[...d.points,point];
      const edited=editFreehandSubpath(sp,points,d.start,end,d.mode,d.tolerance);
      const fitted=transformSubs([edited],inv(d.obj.m))[0];
      // Preserve all untouched original nodes byte-for-byte, including affine handles.
      const original=d.obj.shape.subs[d.sub],result=structuredClone(original);
      if(d.mode==='continue') {
        if(d.start===0){const added=fitted.nodes.length-original.nodes.length;result.nodes=[...fitted.nodes.slice(0,added),...structuredClone(original.nodes)];result.nodes[added].cin=fitted.nodes[added].cin;result.nodes[added].smooth=false}
        else {result.nodes=[...structuredClone(original.nodes),...fitted.nodes.slice(original.nodes.length)];result.nodes[original.nodes.length-1].cout=fitted.nodes[original.nodes.length-1].cout;result.nodes[original.nodes.length-1].smooth=false}
      }else{
        const lo=Math.min(d.start,end!),hi=Math.max(d.start,end!);
        const replacementEnd=fitted.nodes.length-(original.nodes.length-hi);
        result.nodes=[...structuredClone(original.nodes.slice(0,lo)),...fitted.nodes.slice(lo,replacementEnd+1),...structuredClone(original.nodes.slice(hi+1))];
        const first=result.nodes[lo],last=result.nodes[replacementEnd];
        if(original.nodes[lo].cin)first.cin=structuredClone(original.nodes[lo].cin);else delete first.cin;
        if(original.nodes[hi].cout)last.cout=structuredClone(original.nodes[hi].cout);else delete last.cout;
        first.x=original.nodes[lo].x;first.y=original.nodes[lo].y;last.x=original.nodes[hi].x;last.y=original.nodes[hi].y;
      }
      if(JSON.stringify(result)===JSON.stringify(original))return;
      this.snapshot(t('Freihandpfad bearbeiten'));d.obj.shape.subs[d.sub]=result;this.touch(d.obj.shape);this.clearNodeSel();this.emit('doc');
    }catch(error){this.hint=error instanceof Error?error.message:String(error);this.emit('tool')}
  }
}
