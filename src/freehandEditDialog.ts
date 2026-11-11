import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
export function openFreehandEditDialog(ed:Editor) {
  const mode=h('select',{},h('option',{value:'continue'},t('Offenen Pfad fortsetzen')),h('option',{value:'redraw'},t('Abschnitt neu zeichnen')));
  mode.value=ed.freehandMode;
  const tolerance=h('input',{type:'number',min:0.002,max:10,step:0.01,value:String(ed.freehandTolerance)}),info=h('p',{role:'status'});
  const start=h('button',{},t('Werkzeug starten'));
  const dialog=h('dialog',{class:'offset-dialog'},h('h3',{},t('Freihandpfad bearbeiten')),
    h('label',{},t('Modus'),mode),h('label',{},t('Maximale Abweichung (mm)'),tolerance),
    h('p',{},t('Einen einzelnen Pfad auswählen. Am Endknoten fortsetzen oder zwischen zwei vorhandenen Knoten desselben Teilpfads neu zeichnen. Kein Schließen über den Pfadanfang. Esc verwirft den Strich.')),info,
    h('div',{class:'dialog-buttons'},h('button',{onclick:()=>dialog.close()},t('Abbrechen')),start));
  start.addEventListener('click',()=>{
    if(ed.sel.length!==1||ed.sel[0].shape.kind!=='path'||!ed.nodeTargets().includes(ed.sel[0])){info.textContent=t('Zuerst einen bearbeitbaren Pfad auswählen.');return}
    if(!Number.isFinite(tolerance.valueAsNumber)||tolerance.valueAsNumber<0.002||tolerance.valueAsNumber>10){info.textContent=t('Toleranz zwischen 0,002 und 10 mm wählen.');return}
    ed.freehandMode=mode.value==='redraw'?'redraw':'continue';ed.freehandTolerance=tolerance.valueAsNumber;ed.setTool('freehand-edit');dialog.close();
  });
  dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
