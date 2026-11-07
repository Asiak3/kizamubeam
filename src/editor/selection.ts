import type { Editor } from '../editor';
import { apply, Obj, Pt } from '../model';
import { boundsOf, shapeSubs } from '../geom';
import { insideLasso } from '../lasso';
import { t } from '../i18n';

export interface HandleSelection {obj:Obj;sub:number;idx:number;which:'cin'|'cout'}
export class EditorSelection {
  handleSelection(this:Editor,obj:Obj):Set<string> {
    let set=this.handleSets.get(obj);if(!set)this.handleSets.set(obj,set=new Set());return set;
  }
  selectedHandles(this:Editor,obj?:Obj):HandleSelection[] {
    return (obj?[obj]:this.nodeTargets()).flatMap(o=>[...this.handleSelection(o)].flatMap(key=>{
      const [s,i,which]=key.split(':'),sub=Number(s),idx=Number(i);
      const n=shapeSubs(o.shape)[sub]?.nodes[idx];
      return n && (which==='cin'||which==='cout') && n[which]?[{obj:o,sub,idx,which}]:[];
    }));
  }
  beginLasso(this:Editor,point:Pt,event:PointerEvent,components:boolean) {
    this.drag={type:'lasso',points:[point],pointerId:event.pointerId,components,overflow:false,doc:this.doc,
      base:[...this.sel],nodeBase:new Map(this.nodeTargets().map(o=>[o,new Set(this.nodeSelection(o))])),
      handleBase:new Map(this.nodeTargets().map(o=>[o,new Set(this.handleSelection(o))])),
      mode:event.shiftKey && (event.ctrlKey||event.metaKey)?'remove':event.ctrlKey||event.metaKey?'toggle':event.shiftKey?'add':'set'};
  }
  finishLasso(this:Editor,d:Extract<NonNullable<Editor['drag']>,{type:'lasso'}>) {
    if(d.overflow){this.hint=t('Lasso zu lang; Auswahl unverändert. Kürzere Geste verwenden.');this.emit('tool');return;}
    if(this.doc!==d.doc || d.points.length<3)return;
    const contains=(point:Pt)=>insideLasso(point,d.points);
    const combine=(base:boolean,hit:boolean)=>d.mode==='set'?hit:d.mode==='remove'?base&&!hit:d.mode==='toggle'?base!==hit:base||hit;
    if(d.components) {
      if(this.sel.length!==d.base.length||this.sel.some((o,i)=>o!==d.base[i]))return;
      if(d.mode==='set')this.clearNodeSel();
      for(const o of this.nodeTargets()) {
        const nodes=this.nodeSelection(o),handles=this.handleSelection(o);
        shapeSubs(o.shape).forEach((sp,sub)=>sp.nodes.forEach((node,idx)=>{
          const key=`${sub}:${idx}`,p=apply(o.m,node.x,node.y);
          if(combine(d.nodeBase.get(o)?.has(key)??false,contains(p)))nodes.add(key);else nodes.delete(key);
          for(const which of ['cin','cout'] as const)if(node[which]){
            const key=`${sub}:${idx}:${which}`,h=apply(o.m,node[which]!.x,node[which]!.y);
            if(combine(d.handleBase.get(o)?.has(key)??false,contains(h)))handles.add(key);else handles.delete(key);
          }
        }));
      }
      this.emit('sel');
    }else{
      const selected=this.doc.objs.filter(o=>{
        if(!this.selectable(o))return false;
        // Object lasso is deliberately fully enclosing, never bbox intersection.
        const b=boundsOf([o]);
        const hit=!!b && [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}].every(contains) &&
          // Concave lassos may cut through a box despite enclosing all corners.
          !d.points.some(p=>p.x>b.x && p.x<b.x+b.w && p.y>b.y && p.y<b.y+b.h);
        return combine(d.base.includes(o),hit);
      });
      this.setSel(selected);
    }
  }
}
