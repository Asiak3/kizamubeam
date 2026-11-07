import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
import { pathIslands } from './pathIslands';
import { boundsOf, subsToD } from './geom';

export function openPathIslandsDialog(ed:Editor) {
  if(ed.drag||ed.draft||ed.pickHandler)return;
  const distance=h('input',{type:'number',min:0,max:1000,step:0.01,value:'0'});
  const mode=h('select',{},h('option',{value:'keep'},t('Geometrie unverändert lassen')),h('option',{value:'close'},t('Kleine Lücken ausdrücklich schließen')));
  const gap=h('input',{type:'number',min:0,max:10,step:0.001,value:'0.01',disabled:true});
  const status=h('p',{role:'status','aria-live':'polite'}),preview=h('div'),apply=h('button',{},t('Übernehmen'));
  let fingerprint='',closed=0;
  const signature=()=>JSON.stringify({objs:ed.sel.map(o=>[o.id,o.shape,o.m]),doc:ed.doc.objs.map(o=>o.id)});
  const options=()=>({distance:distance.valueAsNumber,closeGaps:mode.value==='close',gapTolerance:gap.valueAsNumber});
  const refresh=()=>{
    preview.replaceChildren();gap.disabled=mode.value!=='close';closed=0;
    try {
      if(!ed.sel.length)throw Error(t('Zuerst Pfade auswählen.'));
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','420');svg.setAttribute('height','240');svg.style.maxWidth='100%';
      const box=boundsOf(ed.sel);if(!box)throw Error(t('Keine Pfadgeometrie gefunden.'));
      svg.setAttribute('viewBox',`${box.x-2} ${box.y-2} ${Math.max(1,box.w)+4} ${Math.max(1,box.h)+4}`);
      let count=0;
      for(const obj of ed.sel) {
        if(obj.shape.kind!=='path'||obj.shape.mark)throw Error(t('Pfadinseln: bearbeitbare Pfade auswählen; Gruppen auflösen und parametrische Formen ausdrücklich umwandeln.'));
        const groups=pathIslands(obj.shape.subs,{...options(),matrix:obj.m});
        closed+=obj.shape.subs.filter(s=>!s.closed).length;
        for(const subs of groups) {
          const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',subsToD(subs,obj.m));
          path.setAttribute('stroke',`hsl(${count++*137.5%360} 80% 50%)`);path.setAttribute('fill','none');path.setAttribute('vector-effect','non-scaling-stroke');path.setAttribute('stroke-width','2');svg.append(path);
        }
      }
      preview.append(svg);status.textContent=t('{n} Ergebnisobjekte; {closed} offene Teilpfade werden geschlossen.',{n:count,closed});
      fingerprint=signature();apply.disabled=false;
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);apply.disabled=true}
  };
  const dialog=h('dialog',{class:'offset-dialog array-dialog'},h('h3',{},t('Pfadinseln trennen')),
    h('label',{},t('Inseln bis zu diesem Randabstand zusammenhalten (mm)'),distance),
    h('label',{},t('Offene Konturen'),mode),h('label',{},t('Maximale Lücke (mm)'),gap),
    h('p',{},t('0 mm trennt eindeutig getrennte Inseln. Abstand wird zwischen Konturrändern gemessen; nahe Inseln bleiben transitiv zusammen. Löcher bleiben zugeordnet.')),
    h('p',{},t('Lückenschließen ergänzt nur die Schlusskante eines einzelnen Teilpfads. Es verbindet keine verschiedenen Teilpfade. Berührungen und Überschneidungen werden abgewiesen.')),
    preview,status,h('div',{class:'dialog-buttons'},h('button',{onclick:()=>dialog.close()},t('Abbrechen')),apply));
  for(const input of [distance,mode,gap])input.addEventListener('input',refresh);
  apply.addEventListener('click',()=>{
    if(fingerprint!==signature()){apply.disabled=true;status.textContent=t('Quelle geändert. Vorschau aktualisieren.');return}
    if(closed && !window.confirm(t('Offene Teilpfade durch zusätzliche Schlusskanten verändern? Rückgängig ist möglich.')))return;
    ed.separatePathIslands(options());dialog.close();
  });
  const changed=(what:string)=>{if(what==='doc'||what==='sel'){apply.disabled=true;status.textContent=t('Quelle geändert. Vorschau aktualisieren.')}};
  ed.on(changed);dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('close',()=>{ed.off(changed);dialog.remove()});
  document.body.append(dialog);dialog.showModal();refresh();
}
