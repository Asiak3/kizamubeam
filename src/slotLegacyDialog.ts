import type { Editor } from './editor';
import { h } from './dom';
import { apply as applyMat, inv, Obj, Pt } from './model';
import { shapeSubs, subsToPath2D } from './geom';
import { PlacedSlot, SlotRecipe, SLOT_GENERATOR, isSlotGenerator, cutSlots, readSlotRecipe, resolvedSlots, slotOutline } from './slotPlacement';
import { t } from './i18n';
import { guidedSlot, nearestSlotAnchor, slotAnchorFromReference, slotContourPosition } from './contourSlots';
import { transformSubs } from './importers';

export function applySlotRecipe(ed: Editor, obj: Obj, recipe: SlotRecipe, stamp: string, destructive: boolean) {
  if (ed.state() !== stamp || !ed.doc.objs.includes(obj) || !ed.selectable(obj) || ed.drag || ed.draft || ed.sketchEdit || ed.pickHandler)
    throw new Error(t('Quelle geändert. Schlitzwerkzeug erneut öffnen.'));
  if ((recipe.groups ?? []).some(group => group.burn > 0) && (ed.doc.layers[obj.layer]?.kerf ?? 0) !== 0)
    throw new Error(t('Lokale Schnittkorrektur und Layer-Kerf dürfen nicht gleichzeitig aktiv sein. Layer-Kerf ausdrücklich auf 0 setzen.'));
  const subs = cutSlots(recipe);
  ed.snapshot(t('Schlitze / Ausklinkungen platzieren'));
  obj.shape = destructive ? {kind:'path',subs} : {kind:'gen',gen:SLOT_GENERATOR,v:1,params:{recipe:JSON.stringify(recipe)},subs};
  ed.touch(obj.shape); ed.emit('doc');
}

export function openLegacySlotPlacementDialog(ed: Editor, target?: Obj) {
  if (document.querySelector('dialog[open]')) return;
  const obj = target ?? (ed.sel.length===1 ? ed.sel[0] : undefined);
  if (!obj || !ed.doc.objs.includes(obj) || !ed.selectable(obj) || ed.drag || ed.draft || ed.sketchEdit || ed.pickHandler ||
    ['group','image','text'].includes(obj.shape.kind) || ed.tool==='builder') {
    ed.hint=t('Eine einzelne geschlossene, sichtbare und entsperrte Vektorform auswählen.'); ed.emit('tool'); return;
  }
  if (obj.shape.kind === 'gen' && obj.shape.asm) {
    ed.hint=t('Baugruppenteile werden von der Schlitzplatzierung noch nicht unterstützt.'); ed.emit('tool'); return;
  }
  try {
    const recipe: SlotRecipe = obj.shape.kind==='gen' && isSlotGenerator(obj.shape.gen)
      ? structuredClone(readSlotRecipe(obj.shape.params))
      : {source:structuredClone(obj.shape),base:structuredClone(shapeSubs(obj.shape)),slots:[]};
    cutSlots(recipe);
    const nextId=()=>{let n=1;while(recipe.slots.some(s=>s.id===`slot-${n}`))n++;return `slot-${n}`;};
    recipe.slots.forEach(s=>{s.id??=nextId();});
    const doc=ed.doc, stamp=ed.state(), tool=ed.tool, isolation=ed.isolation;
    let stale=false, active=-1, hover:PlacedSlot|null=null;
    const canvas=h('canvas',{width:820,height:420,'aria-label':t('Schlitzvorschau: klicken zum Platzieren.')} );
    const info=h('p',{class:'note',role:'status'}), list=h('select',{'aria-label':t('Ausschnitt auswählen')});
    const destructive=h('input',{type:'checkbox',id:'slot-bake'});
    const inputs=new Map<keyof PlacedSlot,HTMLInputElement>();
    const mode=h('select',{id:'slot-placement-mode'},h('option',{value:'contour'},t('Konturgeführt')),h('option',{value:'free'},t('Frei platzieren (bisheriger Modus)')));
    const depthReference=h('select',{id:'slot-depth-reference'},h('option',{value:'curve'},t('Tiefe ab Kontur auf Mittelachse')),h('option',{value:'chord'},t('Tiefe ab Verbindung der Öffnungsecken')));
    const referenceX=h('input',{type:'number',step:'0.1',value:'0',id:'slot-reference-x'});
    const referenceY=h('input',{type:'number',step:'0.1',value:'0',id:'slot-reference-y'});
    const referenceDistance=h('input',{type:'number',min:'0',step:'0.1',value:'0',id:'slot-reference-distance'});
    const referenceDirection=h('select',{id:'slot-reference-direction'},h('option',{value:'1'},t('Entlang der Konturrichtung')),h('option',{value:'-1'},t('Entgegen der Konturrichtung')));
    const useReference=h('input',{type:'checkbox',id:'slot-use-reference'});
    const referenceSlot=h('select',{id:'slot-reference-source'});
    const referenceEdge=h('select',{id:'slot-reference-edge'},h('option',{value:'center'},t('Mitte des Bezugsschnitts')),h('option',{value:'start'},t('Erste Öffnungskante')),h('option',{value:'end'},t('Zweite Öffnungskante')));
    const form=h('div',{class:'form'});
    const fields: [keyof PlacedSlot,string,number][]=[['width',t('Nennbreite / Materialdicke (mm)'),3.7],['depth',t('Tiefe / Länge (mm)'),10],
      ['clearance',t('Spiel gesamt (mm)'),0],['factor',t('Breitenfaktor'),1],['angle',t('Winkel (°)'),0],['x',t('Mitte X lokal (mm)'),0],['y',t('Mitte Y lokal (mm)'),0]];
    const values=():PlacedSlot=>{
      const s=Object.fromEntries([...inputs].map(([k,i])=>[k,i.valueAsNumber])) as unknown as PlacedSlot;
      if(active>=0)s.id=recipe.slots[active].id;
      if(mode.value==='contour') {
        if(useReference.checked && referenceSlot.value!=='point') {
          s.anchor={contour:0,fraction:0,reference:depthReference.value as 'curve'|'chord',relative:{slotId:referenceSlot.value,edge:referenceEdge.value as 'start'|'center'|'end',distance:referenceDistance.valueAsNumber,direction:Number(referenceDirection.value) as 1|-1}};
        }
        else if(useReference.checked) s.anchor=slotAnchorFromReference(recipe.base,{x:referenceX.valueAsNumber,y:referenceY.valueAsNumber},referenceDistance.valueAsNumber,Number(referenceDirection.value) as 1|-1,depthReference.value as 'curve'|'chord');
        else if(active>=0 && recipe.slots[active].anchor) s.anchor={...recipe.slots[active].anchor!,reference:depthReference.value as 'curve'|'chord'};
      }
      return s;
    };
    const pts=recipe.base.flatMap(s=>s.nodes), xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    const scale=Math.min(770/Math.max(1,x1-x0),370/Math.max(1,y1-y0)),ox=(820-(x1-x0)*scale)/2-x0*scale,oy=(420-(y1-y0)*scale)/2-y0*scale;
    const apply=h('button',{class:'btn primary'},t('Übernehmen'));
    const draw=()=>{
      for(const key of ['angle','x','y'] as const)inputs.get(key)!.disabled=mode.value==='contour';
      const ctx=canvas.getContext('2d')!;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#20252c';ctx.fillRect(0,0,820,420);
      ctx.setTransform(scale,0,0,scale,ox,oy);ctx.lineWidth=1.5/scale;
      ctx.strokeStyle='#777';ctx.stroke(subsToPath2D(recipe.base));
      try {
        const preview={...recipe,slots:hover?(active<0?[...recipe.slots,hover]:recipe.slots.map((s,i)=>i===active?hover!:s)):recipe.slots};
        const result=cutSlots(preview);ctx.fillStyle='#405c7c';ctx.strokeStyle='#8dc3ff';const p=subsToPath2D(result);ctx.fill(p,'evenodd');ctx.stroke(p);
        resolvedSlots(recipe).forEach((s,i)=>{ctx.strokeStyle=i===active?'#ff9b30':'#59ceb3';ctx.stroke(subsToPath2D([s.anchor?guidedSlot(recipe.base,s).outline:slotOutline(s)]));});
        if(hover){const candidates=active<0?[...recipe.slots,hover]:recipe.slots.map((s,i)=>i===active?hover!:s);const s=resolvedSlots({...recipe,slots:candidates})[active<0?candidates.length-1:active];ctx.strokeStyle='#ff9b30';ctx.stroke(subsToPath2D([s.anchor?guidedSlot(recipe.base,s).outline:slotOutline(s)]));}
        if(!stale)info.textContent=t('Breite = Nennbreite × Faktor + Spiel. Layer-Kerf wird zusätzlich bei der Ausgabe angewendet.');
        apply.disabled=stale || (!recipe.slots.length && !(obj.shape.kind==='gen' && isSlotGenerator(obj.shape.gen)));
      } catch(e) {info.textContent=e instanceof Error?e.message:String(e);apply.disabled=true;}
    };
    const refreshList=()=>{list.replaceChildren(h('option',{value:'-1'},t('Neuen Ausschnitt platzieren')),...recipe.slots.map((_s,i)=>h('option',{value:String(i)},t('Ausschnitt {n}',{n:i+1}))));list.value=String(active);
      const chosen=referenceSlot.value;referenceSlot.replaceChildren(h('option',{value:'point'},t('Punkt auf Grundkontur')),...recipe.slots.filter((s,i)=>i!==active&&!!s.anchor).map(s=>h('option',{value:s.id},t('Ausschnitt {n}',{n:recipe.slots.indexOf(s)+1}))));referenceSlot.value=[...referenceSlot.options].some(o=>o.value===chosen)?chosen:'point';};
    for(const [key,label,def] of fields){const input=h('input',{type:'number',step:'0.1',value:String(def),id:'place-'+key});inputs.set(key,input);
      input.addEventListener('input',()=>{hover=null;try{if(active>=0)recipe.slots[active]=values();draw();}catch(e){apply.disabled=true;info.textContent=e instanceof Error?e.message:String(e);}});form.append(h('label',{for:input.id},label),input);}
    list.addEventListener('change',()=>{active=Number(list.value);hover=null;if(active>=0){const s=recipe.slots[active];for(const [k,input]of inputs)input.value=String(s[k]);
      mode.value=s.anchor?'contour':'free';refreshList();if(s.anchor){depthReference.value=s.anchor.reference;useReference.checked=!!(s.anchor.position||s.anchor.relative);if(s.anchor.relative){referenceSlot.value=s.anchor.relative.slotId;referenceEdge.value=s.anchor.relative.edge;referenceDistance.value=String(s.anchor.relative.distance);referenceDirection.value=String(s.anchor.relative.direction);}else if(s.anchor.position){referenceSlot.value='point';referenceX.value=String(s.anchor.position.x);referenceY.value=String(s.anchor.position.y);referenceDistance.value=String(s.anchor.position.distance);referenceDirection.value=String(s.anchor.position.direction);}}}draw();});
    const atLocal=(p:Pt,tolerance:number):PlacedSlot=>{
      const s={...values(),x:p.x,y:p.y};
      if(mode.value==='contour') {
        if(!useReference.checked) s.anchor=nearestSlotAnchor(recipe.base,p,tolerance,depthReference.value as 'curve'|'chord')??undefined;
        if(!s.anchor)throw new Error(t('Maus näher an eine eindeutige Kontur bewegen.'));
        const candidates=active<0?[...recipe.slots,s]:recipe.slots.map((old,i)=>i===active?s:old);
        const resolved=resolvedSlots({...recipe,slots:candidates})[active<0?candidates.length-1:active];
        const frame=guidedSlot(recipe.base,resolved);s.x=frame.center.x;s.y=frame.center.y;s.angle=Math.atan2(frame.b.y-frame.a.y,frame.b.x-frame.a.x)*180/Math.PI;
      } else delete s.anchor;
      return s;
    };
    const at=(e:PointerEvent)=>{const r=canvas.getBoundingClientRect();return atLocal({x:((e.clientX-r.left)*820/r.width-ox)/scale,y:((e.clientY-r.top)*420/r.height-oy)/scale},12/scale);};
    const accept=(s:PlacedSlot)=>{s.id??=nextId();const slots=active<0?[...recipe.slots,s]:recipe.slots.map((old,i)=>i===active?s:old);cutSlots({...recipe,slots});recipe.slots=slots;if(active<0)active=slots.length-1;for(const[k,input]of inputs)input.value=String(s[k]);hover=null;refreshList();draw();};
    canvas.addEventListener('pointermove',e=>{if(!stale&&active<0){try{hover=at(e);draw();}catch(error){hover=null;draw();info.textContent=error instanceof Error?error.message:String(error);}}});
    canvas.addEventListener('pointerleave',()=>{hover=null;draw();});
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0||stale)return;try{accept(at(e));
    }catch(error){info.textContent=error instanceof Error?error.message:String(error);}});
    let placing=false, workspaceClose=false;
    const startWorkspace=(referenceOnly=false)=>{
      if(stale)return;
      const m=obj.m,det=m[0]*m[3]-m[1]*m[2];
      if(Math.abs(Math.hypot(m[0],m[1])-1)>0.001||Math.abs(Math.hypot(m[2],m[3])-1)>0.001||Math.abs(Math.abs(det)-1)>0.001){info.textContent=t('Konturplatzierung unterstützt derzeit nur unskalierte Objekte mit Drehung oder Spiegelung.');return;}
      const inverse=inv(m),previous=ed.offsetPreview;
      placing=true;workspaceClose=true;dlg.close();
      const badge=h('div',{class:'slot-placement-badge'},h('span',{},referenceOnly?t('Referenzpunkt auf der Kontur anklicken.'):t('Kontur folgen, klicken zum Absetzen. Esc beendet die Platzierung.')),h('button',{class:'btn',onclick:()=>ed.endPick()},t('Fertig')));
      document.body.append(badge);
      const local=(p:Pt)=>applyMat(inverse,p.x,p.y);
      const move=(e:PointerEvent)=>{
        try{const {sx,sy}=ed.evPt(e);const p=local(ed.toWorld(sx,sy));
          if(referenceOnly){const a=nearestSlotAnchor(recipe.base,p,12/ed.view.zoom,'curve');if(!a)throw new Error(t('Maus näher an eine eindeutige Kontur bewegen.'));const q=slotContourPosition(recipe.base,a);ed.setPreview(transformSubs([{closed:false,nodes:[{x:q.x-0.5,y:q.y},{x:q.x+0.5,y:q.y}]}],m));return;}
          hover=atLocal(p,12/ed.view.zoom);const previewSlots=active<0?[...recipe.slots,hover]:recipe.slots.map((s,i)=>i===active?hover!:s);
          const resolved=resolvedSlots({...recipe,slots:previewSlots})[active<0?previewSlots.length-1:active];
          const frame=resolved.anchor?guidedSlot(recipe.base,resolved):null;
          const marks=frame?[frame.a,frame.b].map(p=>({closed:false,nodes:[{x:p.x-.4,y:p.y},{x:p.x+.4,y:p.y}]})):[];
          ed.setPreview(transformSubs([...cutSlots({...recipe,slots:previewSlots}),frame?frame.outline:slotOutline(resolved),...marks],m));
        }catch(error){hover=null;ed.setPreview(null);ed.hint=error instanceof Error?error.message:String(error);}
      };
      ed.canvas.addEventListener('pointermove',move);ed.canvas.addEventListener('pointerleave',leave);
      function leave(){hover=null;ed.setPreview(null);}
      ed.startPick(p=>{
        try{
          if(stale)return;
          if(referenceOnly){const point=local(p),tolerance=12/ed.view.zoom;
            const candidates=resolvedSlots(recipe).flatMap((s,i)=>{if(!s.anchor||i===active)return [];const f=guidedSlot(recipe.base,s);return [{s,edge:'start',p:f.a},{s,edge:'end',p:f.b},{s,edge:'center',p:slotContourPosition(recipe.base,s.anchor)}];}).sort((a,b)=>Math.hypot(a.p.x-point.x,a.p.y-point.y)-Math.hypot(b.p.x-point.x,b.p.y-point.y));
            const nearest=candidates[0];
            if(nearest&&Math.hypot(nearest.p.x-point.x,nearest.p.y-point.y)<=tolerance){referenceSlot.value=nearest.s.id!;referenceEdge.value=nearest.edge;}
            else{const a=nearestSlotAnchor(recipe.base,point,tolerance,'curve');if(!a)throw new Error(t('Maus näher an eine eindeutige Kontur bewegen.'));const q=slotContourPosition(recipe.base,a);referenceSlot.value='point';referenceX.value=String(q.x);referenceY.value=String(q.y);}
            useReference.checked=true;updateGuided();ed.endPick();return;}
          accept(atLocal(local(p),12/ed.view.zoom));ed.setPreview(transformSubs(cutSlots(recipe),m));active=-1;refreshList();
        }catch(error){ed.hint=error instanceof Error?error.message:String(error);}
      },()=>{
        ed.canvas.removeEventListener('pointermove',move);ed.canvas.removeEventListener('pointerleave',leave);badge.remove();ed.setPreview(previous);hover=null;placing=false;
        if(dlg.isConnected){dlg.showModal();draw();}
      },t('Kontur folgen, klicken zum Absetzen. Esc beendet die Platzierung.'));
    };
    const updateGuided=()=>{try{hover=null;if(active>=0)recipe.slots[active]=values();draw();}catch(e){apply.disabled=true;info.textContent=e instanceof Error?e.message:String(e);}};
    for(const el of [mode,depthReference,referenceX,referenceY,referenceDistance,referenceDirection,useReference,referenceSlot,referenceEdge])el.addEventListener('change',updateGuided);
    const dlg=h('dialog',{class:'outline-dialog'},h('h3',{},t('Parametrische Schlitze / Ausklinkungen')),h('p',{class:'note'},t('Parameter einstellen, dann auf der Arbeitsfläche an der Kontur platzieren. Bestehende Ausschnitte über die Liste wählen und neu positionieren.')),
      h('p',{class:'note'},t('Konturgeführt: zwei Öffnungsecken folgen der Kontur. Tiefe wahlweise ab Mittelachsenkontakt oder Öffnungssehne. Bisherige freie Platzierungen bleiben lesbar.')),
      mode,depthReference,h('button',{class:'btn',onclick:()=>startWorkspace()},t('Auf der Arbeitsfläche platzieren')),
      h('div',{class:'form'},h('label',{for:useReference.id},t('Position über Referenz und Konturabstand festlegen')),useReference,
        h('label',{for:referenceSlot.id},t('Positionsbezug')),referenceSlot,h('label',{for:referenceEdge.id},t('Bezugskante des Schnitts')),referenceEdge,
        h('label',{for:referenceX.id},t('Referenz X lokal (mm)')),referenceX,h('label',{for:referenceY.id},t('Referenz Y lokal (mm)')),referenceY,
        h('label',{for:referenceDistance.id},t('Abstand entlang der Kontur (mm)')),referenceDistance,h('label',{for:referenceDirection.id},t('Laufrichtung')),referenceDirection),
      h('button',{class:'btn',onclick:()=>startWorkspace(true)},t('Referenz auf Arbeitsfläche wählen')),
      canvas,list,form,h('button',{class:'btn',onclick:()=>{if(active>=0&&!stale){const id=recipe.slots[active].id;if(recipe.slots.some(s=>s.anchor?.relative?.slotId===id)){info.textContent=t('Referenzierter Schnitt fehlt. Bezug vor dem Löschen ändern.');return;}recipe.slots.splice(active,1);active=-1;refreshList();draw();}}},t('Gewählten Ausschnitt entfernen')),
      obj.shape.kind==='gen' && isSlotGenerator(obj.shape.gen) ? h('button',{class:'btn',onclick:()=>{
        changed();if(stale||!confirm(t('Gespeicherte Originalform wiederherstellen und alle Ausschnitte entfernen?')))return;
        ed.snapshot(t('Originalform wiederherstellen'));obj.shape=structuredClone(recipe.source);ed.touch(obj.shape);ed.emit('doc');dlg.close();
      }},t('Originalform wiederherstellen')) : null,
      h('label',{class:'check'},destructive,t('Destruktiv festschreiben (Parameter entfernen)')),info,
      h('p',{class:'note'},t('Nicht destruktiv: Original und Konturbezüge bleiben gespeichert. Doppelklick öffnet die Bearbeitung. Abhängige Ausschnitte folgen ihrem Bezugsschnitt. X/Y-Referenzen liegen im lokalen Objektkoordinatensystem.')),
      h('div',{class:'dialog-buttons'},h('button',{class:'btn',onclick:()=>dlg.close()},t('Abbrechen')),apply));
    const changed=()=>{if(ed.doc!==doc||ed.state()!==stamp||ed.tool!==tool||ed.isolation!==isolation){stale=true;apply.disabled=true;info.textContent=t('Quelle geändert. Schlitzwerkzeug erneut öffnen.');if(placing&&ed.pickHandler)ed.endPick();}};
    ed.on(changed);
    apply.addEventListener('click',()=>{try{changed();if(stale)return;if(destructive.checked&&!confirm(t('Ausschnitte als Pfad festschreiben? Die gespeicherte Originalform und Schlitzparameter werden entfernt.')))return;
      applySlotRecipe(ed,obj,recipe,stamp,destructive.checked);dlg.close();}catch(e){info.textContent=e instanceof Error?e.message:String(e);}});
    dlg.addEventListener('close',()=>{if(workspaceClose){workspaceClose=false;return;}if(!placing){ed.off(changed);dlg.remove();}});dlg.addEventListener('keydown',e=>e.stopPropagation());
    document.body.append(dlg);refreshList();dlg.showModal();draw();
  }catch(error){ed.hint=error instanceof Error?error.message:String(error);ed.emit('tool');}
}
