import type { Editor } from './editor';
import { Obj, Pt, visibleLeaves } from './model';
import { hitLeaf } from './geom';
import { t } from './i18n';
import { h } from './dom';

export const OVERLAP_HOLD_MS = 550;
// Pointer coordinates are CSS pixels, independent of devicePixelRatio.
export const OVERLAP_MOVE_PX = 6;
export interface OverlapSettings { trigger:'right'|'left'|'off'; delay:number }
const SETTINGS_KEY='kizamubeam.overlap-picker';
export function loadOverlapSettings():OverlapSettings {
  try {
    const value=JSON.parse(localStorage.getItem(SETTINGS_KEY)??'null');
    if(value && ['right','left','off'].includes(value.trigger) && Number.isInteger(value.delay) && value.delay>=250 && value.delay<=2000)return {trigger:value.trigger,delay:value.delay};
  }catch{/* unavailable or invalid preferences retain safe defaults */}
  return {trigger:'right',delay:OVERLAP_HOLD_MS};
}
export function openOverlapSettings() {
  const current=loadOverlapSettings();
  const trigger=h('select',{},h('option',{value:'right'},t('Langer Rechtsklick')),h('option',{value:'left'},t('Langer Linksklick')),h('option',{value:'off'},t('Deaktiviert')));
  trigger.value=current.trigger;
  const delay=h('input',{type:'number',min:250,max:2000,step:50,value:String(current.delay)});
  const info=h('p',{role:'status'});
  const save=h('button',{},t('Übernehmen'));
  const dialog=h('dialog',{class:'offset-dialog'},h('h3',{},t('Überlappungsauswahl einstellen')),
    h('label',{},t('Auslösung'),trigger),h('label',{},t('Haltedauer (ms)'),delay),
    h('p',{},t('Kurzer Klick und Ziehen bleiben unverändert. Die Liste ändert die Auswahl erst beim Bestätigen.')),info,
    h('div',{class:'dialog-buttons'},h('button',{onclick:()=>dialog.close()},t('Abbrechen')),save));
  save.addEventListener('click',()=>{
    if(!Number.isInteger(delay.valueAsNumber)||delay.valueAsNumber<250||delay.valueAsNumber>2000){info.textContent=t('Haltedauer zwischen 250 und 2000 ms wählen.');return}
    try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({trigger:trigger.value,delay:delay.valueAsNumber}));dialog.close()}
    catch{info.textContent=t('Einstellung konnte nicht gespeichert werden.')}
  });
  dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
/** Same top-level/group and isolation semantics as ordinary selection. */
export function overlapCandidates(ed: Editor, point: Pt): Obj[] {
  return [...ed.doc.objs].reverse().filter(top=>ed.selectable(top) && [...visibleLeaves([top])].some(([leaf,m])=>{
    const layer=ed.layer(leaf.layer);
    return layer.show && !layer.locked && !leaf.locked && hitLeaf(leaf,m,point,4/ed.view.zoom,ed.filled && layer.mode==='fill');
  }));
}

/** Capture-stage arbitration: no selection/history mutation before short-click,
 * drag intent, or an explicit chooser action. Returns full listener cleanup. */
export function installOverlapPicker(ed: Editor): () => void {
  const canvas=ed.canvas;
  let pending: {event:PointerEvent;timer:number;doc:typeof ed.doc;view:string;sel:Obj[]} | null=null;
  let menu:HTMLElement|null=null, oldFocus:HTMLElement|null=null;
  let opening=false;
  let consumeContext=false;
  const clearPending=()=>{
    const p=pending;pending=null;
    if(p){window.clearTimeout(p.timer);if(canvas.hasPointerCapture(p.event.pointerId)) canvas.releasePointerCapture(p.event.pointerId)}
  };
  const close=()=>{
    clearPending();menu?.remove();menu=null;ed.overlapHover=null;ed.redraw();
    if(oldFocus?.isConnected)oldFocus.focus({preventScroll:true});oldFocus=null;
  };
  const valid=(p:NonNullable<typeof pending>)=>ed.doc===p.doc && ed.tool==='select' && !ed.drag && !ed.pickHandler && !ed.draft && !ed.outlinePreview &&
    JSON.stringify(ed.view)===p.view && ed.sel.length===p.sel.length && ed.sel.every((o,i)=>o===p.sel[i]);
  const open=(p:NonNullable<typeof pending>)=>{
    if(!valid(p)){clearPending();return}
    const {sx,sy}=ed.evPt(p.event),point=ed.toWorld(sx,sy),items=overlapCandidates(ed,point);
    if(items.length<2){clearPending();return}
    opening=true;clearPending();opening=false;
    oldFocus=document.activeElement as HTMLElement;
    menu=document.createElement('div');menu.className='overlap-picker';menu.setAttribute('role','menu');
    menu.setAttribute('aria-label',t('Objekt unter dem Mauszeiger auswählen'));
    const title=document.createElement('div');title.textContent=t('Objekt unter dem Mauszeiger auswählen');menu.append(title);
    items.forEach((obj,i)=>{
      const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');
      button.textContent=`${i+1}. ${obj.name || t('Objekt')} · ${t('Ebene')} ${obj.layer} · #${obj.id}`;
      const highlight=()=>{if(ed.doc===p.doc && overlapCandidates(ed,point).includes(obj)){ed.overlapHover=obj;ed.redraw()}else close()};
      button.addEventListener('pointerenter',highlight);button.addEventListener('focus',highlight);
      button.addEventListener('click',()=>{
        const canSelect=ed.doc===p.doc && ed.tool==='select' && overlapCandidates(ed,point).includes(obj);
        close();if(canSelect)ed.setSel([obj]);
      });menu!.append(button);
    });
    document.body.append(menu);
    menu.style.left=`${Math.max(4,Math.min(p.event.clientX,innerWidth-menu.offsetWidth-4))}px`;
    menu.style.top=`${Math.max(4,Math.min(p.event.clientY,innerHeight-menu.offsetHeight-4))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const down=(event:PointerEvent)=>{
    consumeContext=false;
    if(menu){if(!menu.contains(event.target as Node))close();return}
    if(pending){if(event.pointerId!==pending.event.pointerId){close();return}clearPending()}
    const settings=loadOverlapSettings();
    const ctrlSecondary=settings.trigger==='right' && /Mac/i.test(navigator.platform || navigator.userAgent) && event.button===0 && event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey;
    if(settings.trigger==='off' || (!ctrlSecondary && event.button!==(settings.trigger==='right'?2:0)) || event.isPrimary===false || ed.tool!=='select' || ed.space || ed.drag || ed.draft || ed.pickHandler || ed.outlinePreview ||
       event.shiftKey || (event.ctrlKey && !ctrlSecondary) || event.metaKey || event.altKey)return;
    const {sx,sy}=ed.evPt(event);
    if(sx<22 || sy<22 || ed.hitPivot(sx,sy) || ed.hitHandle(sx,sy)>=0 || ed.hitRotateZone(sx,sy))return;
    if(overlapCandidates(ed,ed.toWorld(sx,sy)).length<2)return;
    event.preventDefault();event.stopImmediatePropagation();
    // Replay macOS Ctrl-primary as secondary, never as a selection toggle/drag.
    const press=ctrlSecondary?new PointerEvent('pointerdown',{button:2,buttons:2,pointerId:event.pointerId,pointerType:event.pointerType,isPrimary:event.isPrimary,
      clientX:event.clientX,clientY:event.clientY}):event;
    const p={event:press,timer:0,doc:ed.doc,view:JSON.stringify(ed.view),sel:[...ed.sel]};
    pending=p;p.timer=window.setTimeout(()=>{consumeContext=true;open(p)},settings.delay);canvas.setPointerCapture(event.pointerId);
  };
  const move=(event:PointerEvent)=>{
    if(!pending)return;
    const p=pending;if(event.pointerId!==p.event.pointerId){event.stopImmediatePropagation();return}
    if(!valid(p)){clearPending();event.stopImmediatePropagation();return}
    if(Math.hypot(event.clientX-p.event.clientX,event.clientY-p.event.clientY)>=OVERLAP_MOVE_PX){
      window.clearTimeout(p.timer);
      // Keep secondary presses until release: WebKit may already have sent
      // the contextmenu that we suppressed while waiting. Left drags instead
      // resume the ordinary editor pointer path immediately.
      if(p.event.button===2){event.preventDefault();event.stopImmediatePropagation();return}
      pending=null;consumeContext=false;ed.onDown(p.event);return;
    }
    event.preventDefault();event.stopImmediatePropagation();
  };
  const up=(event:PointerEvent)=>{
    if(!pending)return;
    const p=pending;if(event.pointerId!==p.event.pointerId){event.stopImmediatePropagation();return}
    window.clearTimeout(p.timer);pending=null;
    if(valid(p)) {
      if(p.event.button===2){
        consumeContext=true;ed.onDown(p.event);ed.onCanvasContext?.(new MouseEvent('contextmenu',{clientX:event.clientX,clientY:event.clientY,button:2}));
      }else ed.onDown(p.event);
    }
  };
  const context=(event:MouseEvent)=>{if(pending||consumeContext||menu){event.preventDefault();event.stopImmediatePropagation()}};
  const lost=()=>{if(!opening)clearPending()};
  const outside=(event:PointerEvent)=>{if(menu && !menu.contains(event.target as Node)){close();event.stopImmediatePropagation();event.preventDefault()}};
  const key=(event:KeyboardEvent)=>{
    if(!menu){
      if(pending){
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();consumeContext=true}
        close();
      }
      return;
    }
    event.stopImmediatePropagation();
    const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape' || event.key==='Tab'){event.preventDefault();close()}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();
    }else if(event.key==='Enter'||event.key===' '){event.preventDefault();buttons[index]?.click()}
  };
  let lastView=JSON.stringify(ed.view);
  const changed=(what:string)=>{
    const view=JSON.stringify(ed.view),viewChanged=view!==lastView;lastView=view;
    if(what==='doc'||what==='tool'||what==='sel'||viewChanged)close();
  };
  canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);canvas.addEventListener('pointerup',up,true);
  canvas.addEventListener('pointercancel',close,true);canvas.addEventListener('lostpointercapture',lost,true);
  canvas.addEventListener('contextmenu',context,true);
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);
  window.addEventListener('blur',close);window.addEventListener('resize',close);ed.on(changed);
  return ()=>{
    close();canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('pointerup',up,true);
    canvas.removeEventListener('pointercancel',close,true);canvas.removeEventListener('lostpointercapture',lost,true);
    canvas.removeEventListener('contextmenu',context,true);
    document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);
    window.removeEventListener('blur',close);window.removeEventListener('resize',close);ed.off(changed);
  };
}
