import type { Editor } from './editor';
import type { OutlinePreview } from './editor/outline';
import { h } from './dom';
import { t } from './i18n';
import { pathIslandPlan } from './pathIslands';
import { apply, type SubPath } from './model';
import ClipperLib from 'clipper-lib';
import { SCALE, type Paths } from './clip';
import { movableToolWindow } from './toolWindow';

export function openPathIslandsDialog(ed:Editor) {
  if(ed.drag||ed.draft||ed.pickHandler||ed.outlinePreview||document.querySelector('dialog[open]'))return;
  const distance=h('input',{type:'number',min:0,max:1000,step:.01,value:'0','aria-label':t('Randabstand (mm)')});
  const mode=h('select',{},h('option',{value:'keep'},t('Unverändert lassen')),h('option',{value:'close'},t('Kleine Lücken schließen')));
  const gap=h('input',{type:'number',min:0,max:10,step:.001,value:'.01',disabled:true});
  const preserve=h('input',{type:'checkbox',checked:true,id:'path-islands-preserve'});
  const status=h('p',{class:'note',role:'status','aria-live':'polite'}),choices=h('div',{class:'outline-choices'}),applyButton=h('button',{class:'btn primary'},t('Übernehmen'));
  const title=h('h3',{id:'path-islands-title'},t('Pfadinseln trennen'));
  const dialog=h('dialog',{class:'outline-dialog outline-tool-window path-islands-dialog','aria-labelledby':title.id});
  let fingerprint='',closed=0,applying=false,disposed=false,valid=false,disposeWindow=()=>{};
  const options=()=>({distance:distance.valueAsNumber,closeGaps:mode.value==='close',gapTolerance:gap.valueAsNumber,preserveInvalid:preserve.checked});
  const signature=()=>JSON.stringify({objs:ed.sel.map(o=>[o.id,o.shape,o.m]),doc:ed.doc.objs.map(o=>o.id),options:options()});
  const preview:OutlinePreview={subs:[],holes:[],hover:-1,pick:p=>highlight(at(p),true),move:p=>highlight(at(p)),cancel:()=>dialog.close()};
  let groups:{subs:SubPath[];preserved:boolean;button:HTMLButtonElement;hit:Paths;area:number;x0:number;x1:number;y0:number;y1:number}[]=[];
  const highlight=(index:number,scroll=false)=>{
    if(preview.hover===index&&!scroll)return;
    preview.hover=index;
    groups.forEach((g,i)=>{g.button.classList.toggle('outline-choice-active',i===index);if(i===index)g.button.setAttribute('aria-current','true');else g.button.removeAttribute('aria-current');});
    if(scroll)groups[index]?.button.scrollIntoView({block:'nearest'});
    ed.redraw();
  };
  const at=(p:{x:number;y:number})=>{
    if(!valid)return -1;
    const point={X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)};
    let best=-1,area=Infinity;
    groups.forEach((g,i)=>{
      if(g.preserved||g.area>=area||point.X<g.x0||point.X>g.x1||point.Y<g.y0||point.Y>g.y1)return;
      let inside=false;
      for(const ring of g.hit){const hit=ClipperLib.Clipper.PointInPolygon(point,ring);if(hit===-1){inside=true;break;}if(hit===1)inside=!inside;}
      if(inside){best=i;area=g.area;}
    });
    return best;
  };
  const refresh=()=>{
    choices.replaceChildren();groups=[];preview.hover=-1;preview.subs=[];preview.holes=[];preview.excluded=[];closed=0;valid=false;gap.disabled=mode.value!=='close';
    try{
      if(!ed.sel.length)throw Error(t('Zuerst Pfade auswählen.'));
      let retained=0,changes=false;
      for(const obj of ed.sel){
        if(obj.shape.kind!=='path'||obj.shape.mark)throw Error(t('Pfadinseln: bearbeitbare Pfade auswählen; Gruppen auflösen und parametrische Formen ausdrücklich umwandeln.'));
        const plan=pathIslandPlan(obj.shape.subs,{...options(),matrix:obj.m});
        retained+=plan.preserved.length;
        changes ||= plan.groups.length>1||JSON.stringify(plan.groups[0])!==JSON.stringify(obj.shape.subs);
        closed+=obj.shape.subs.filter(s=>!s.closed&&plan.groups.some(group=>group.some(p=>p.closed&&p.nodes===s.nodes))).length;
        for(const subs of plan.groups){
          const world=subs.map(s=>({...s,nodes:s.nodes.map(n=>({...n,...apply(obj.m,n.x,n.y),...(n.cin?{cin:apply(obj.m,n.cin.x,n.cin.y)}:{}),...(n.cout?{cout:apply(obj.m,n.cout.x,n.cout.y)}:{})}))}));
          const isPreserved=subs.some(s=>plan.preserved.includes(s)),index=groups.length;
          const button=h('button',{class:'btn',type:'button','data-island-group':String(index),onpointerenter:()=>highlight(index),onfocus:()=>highlight(index),onclick:()=>highlight(index,true)},
            isPreserved?t('Unverändert · Objekt {id}',{id:obj.id}):t('Insel {n}',{n:index+1}));
          // Reuse exactly the existing node-polygon pick semantics; do not
          // allocate/rasterize every group's nodes on each pointer event.
          const hit=world.map(s=>s.nodes.map(n=>({X:Math.round(n.x*SCALE),Y:Math.round(n.y*SCALE)}))),points=hit.flat();
          const area=Math.abs(world[0].nodes.reduce((a,n,j)=>{const q=world[0].nodes[(j+1)%world[0].nodes.length];return a+n.x*q.y-q.x*n.y},0));
          groups.push({subs:world,preserved:isPreserved,button,hit,area,x0:Math.min(...points.map(p=>p.X)),x1:Math.max(...points.map(p=>p.X)),y0:Math.min(...points.map(p=>p.Y)),y1:Math.max(...points.map(p=>p.Y))});choices.append(button);
          preview.subs.push(...world);if(isPreserved)preview.excluded!.push(...world);
        }
      }
      preview.holes=groups.map(g=>g.subs);valid=true;fingerprint=signature();applyButton.disabled=!changes;
      status.textContent=t('{n} Ergebnisobjekte · {retained} Teilpfade bleiben unverändert.',{n:groups.length,retained});
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);applyButton.disabled=true;preview.subs=[];preview.holes=[];preview.excluded=[];}
    ed.redraw();
  };
  dialog.append(title,h('p',{class:'note'},t('Ergebnis auf der Arbeitsfläche oder in der Liste hervorheben. Rot bleibt unverändert.')),
    h('div',{class:'form'},h('label',{},t('Randabstand (mm)')),distance,h('label',{},t('Offene Konturen')),mode,h('label',{},t('Maximale Lücke (mm)')),gap),
    h('label',{class:'check'},preserve,t('Problematische Teilpfade behalten')),status,choices,
    h('div',{class:'dialog-buttons'},h('button',{class:'btn',onclick:()=>dialog.close()},t('Abbrechen')),applyButton));
  for(const input of [distance,mode,gap,preserve])input.addEventListener('input',refresh);
  applyButton.addEventListener('click',()=>{
    if(applyButton.disabled)return;
    if(fingerprint!==signature()){applyButton.disabled=true;status.textContent=t('Quelle geändert. Vorschau aktualisieren.');return;}
    if(closed&&!confirm(t('Offene Teilpfade durch zusätzliche Schlusskanten verändern? Rückgängig ist möglich.')))return;
    applying=true;ed.separatePathIslands(options());dialog.close();
  });
  const changed=(what:string)=>{if(!applying&&(what==='doc'||what==='sel'||what==='tool'))dialog.close();};
  dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();dialog.close();}});
  dialog.addEventListener('close',()=>{
    if(disposed)return;disposed=true;disposeWindow();ed.off(changed);if(ed.outlinePreview===preview)ed.outlinePreview=null;dialog.remove();ed.redraw();
  });
  document.body.append(dialog);dialog.show();ed.outlinePreview=preview;ed.on(changed);disposeWindow=movableToolWindow(dialog,title,()=>{});refresh();
}
