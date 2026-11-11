// Bundle a user-selected local project for read-only, isolated browser diagnostics.
// Never commit the generated artifacts or embed project contents in this script.
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const project=JSON.parse(await readFile(process.argv[2],'utf8'));
const out='artifacts/resource-browser';await mkdir(out,{recursive:true});
const contents=`
import {Editor} from './src/editor';import {loadDoc,apply} from './src/model';
import {overlapCandidates} from './src/overlapPicker';import {openPathIslandsDialog} from './src/pathIslandsDialog';
import {openContourOffsetDialog} from './src/contourOffsetDialog';
import {openOutlineDialog} from './src/outlineDialog';
import {offsetResults,readContourOffset} from './src/contourOffset';import {History} from './src/history';import {outlineHoleAt} from './src/outline';
import {offsetContourSections} from './src/contourOffsetSections';import {pointAt} from './src/pathtools';
import {installEditorContext} from './src/editorContext';import './src/style.css';
import {regionContains} from './src/shapeRegions';
Editor.prototype.restore=function(){};Editor.prototype.scheduleSave=function(){};
const ed=new Editor(document.querySelector('canvas'));window.editorPrototype=ed;
const project=${JSON.stringify(project)},wait=ms=>new Promise(r=>setTimeout(r,ms));
const noop=()=>{};installEditorContext(ed,{adjust:noop,trace:noop,background:noop,saveBitmap:noop,vectorFit:noop,builder:noop,library:noop,preview:noop,objects:noop});
window.runOutlineApproximationResourceChecks=async()=>{
 ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
 ed.setSel(ed.doc.objs.filter(o=>[154,155,156,157,158].includes(o.id)));ed.zoomSelection();
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),before=ed.state();
 const session=await ed.prepareOutline(.3),index=session.plan.islandErrors.findIndex((bad,i)=>bad&&session.plan.approximationEligible[i]);
 check(index>=0,'original resource has a separately approximable refused island at0.3');
 if(index<0)return {errors,passed};
 await openOutlineDialog(ed);const dialog=document.querySelector('.outline-dialog');
 const tol=dialog.querySelector('#outline-tolerance');tol.value='.3';tol.dispatchEvent(new Event('input'));
 check(dialog.querySelector('.primary').disabled,'pending tolerance calculation immediately blocks stale Apply');await wait(160);
 const mode=dialog.querySelector('#outline-mode');mode.value='islands';mode.dispatchEvent(new Event('change'));
 check(!dialog.querySelectorAll('.outline-choices input')[index].disabled,'available approximation is directly clickable without a hidden enable switch');
 check(!dialog.querySelector('#outline-allow-approximation'),'approximation information no longer needs an extra permission control');
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Alle exakten').click();
 check(!dialog.querySelectorAll('.outline-choices input')[index].checked,'select-all never silently selects approximated islands');
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Keine').click();
 const savedConfirm=window.confirm;let prompts=0;window.confirm=()=>{prompts++;return false;};
 dialog.querySelectorAll('.outline-choices input')[index].click();
 check(dialog.querySelectorAll('.outline-choices input')[index].checked&&prompts===0,'approximation selects directly without a permission prompt');
 check(!dialog.querySelector('.primary').disabled,'individually selected approximation is applicable');
 const row=dialog.querySelector('[data-island-index="'+index+'"]');
 check(row.classList.contains('outline-choice-active')&&row.getAttribute('aria-current')==='true','checkbox selection visibly highlights its island row');
 const nodes=session.plan.holes[index].subs[0].nodes,x0=Math.min(...nodes.map(n=>n.x)),x1=Math.max(...nodes.map(n=>n.x)),y0=Math.min(...nodes.map(n=>n.y)),y1=Math.max(...nodes.map(n=>n.y));
 let pick;for(let y=1;y<30&&!pick;y++)for(let x=1;x<30;x++){const p={x:x0+(x1-x0)*x/30,y:y0+(y1-y0)*y/30};if(outlineHoleAt(session.plan,p.x,p.y)===index){pick=p;break;}}
 check(!!pick,'resource candidate has an independently located interior workspace pick');
 if(pick){
  ed.outlinePreview.pick(pick);check(!dialog.querySelectorAll('.outline-choices input')[index].checked,'workspace click toggles the same highlighted island off');
  dialog.querySelector('.outline-choices').scrollTop=0;ed.outlinePreview.pick(pick);
  check(dialog.querySelectorAll('.outline-choices input')[index].checked&&row.classList.contains('outline-choice-active'),'workspace click selects and highlights the corresponding approximation row');
  const box=dialog.querySelector('.outline-choices').getBoundingClientRect(),bounds=row.getBoundingClientRect();
  check(bounds.top>=box.top-1&&bounds.bottom<=box.bottom+1,'workspace-selected island row scrolls into the visible list viewport');
 }
 dialog.querySelectorAll('.outline-choices input')[index].click();
 check(!dialog.querySelectorAll('.outline-choices input')[index].checked,'individual approximation can be deselected');
 check(dialog.querySelector('.primary').disabled,'empty selection cannot Apply a stale approximate preview');
 dialog.querySelectorAll('.outline-choices input')[index].click();
 check(ed.outlinePreview.excluded.length>0&&dialog.querySelector('[role=status]').textContent.includes('angenähert'),'approximation is visibly marked and explained');
 check(ed.state()===before&&ed.history.position===0,'approximation selection preserves original document');
 dialog.querySelector('.primary').click();await wait(20);window.confirm=savedConfirm;
 check(prompts===0,'informational approximation Apply does not open a modal permission prompt');
 check(!dialog.open&&ed.sel[0].shape.subs.every(s=>s.closed),'confirmed approximation Apply creates closed output');
 check(ed.sel[0].shape.subs.some(s=>s.nodes.every(n=>!n.cin&&!n.cout)),'output contains the approved detected polyline');
 ed.doUndo();check(ed.state()===before,'confirmed approximation Undo restores exact original');
 return {errors,passed,island:index+1};
};
window.runPathIslandPerformanceChecks=async()=>{
 ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');ed.setSel(ed.doc.objs.filter(o=>o.id===233));ed.zoomSelection();
 const before=ed.state(),errors=[],opening=[],hover=[],render=[],apply=[],outputs=[];
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 for(let trial=0;trial<7;trial++){
  let start=performance.now();openPathIslandsDialog(ed);opening.push(performance.now()-start);
  const preview=ed.outlinePreview,dialog=document.querySelector('.path-islands-dialog');
  const nodes=preview.subs.flatMap(s=>s.nodes),xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  start=performance.now();for(let i=0;i<300;i++)preview.move({x:x0+(x1-x0)*(i%30)/29,y:y0+(y1-y0)*Math.floor(i/30)/9});hover.push(performance.now()-start);
  start=performance.now();for(let i=0;i<10;i++){preview.hover=i%preview.holes.length;ed.render();}render.push(performance.now()-start);
  start=performance.now();dialog.querySelector('.primary').click();apply.push(performance.now()-start);outputs.push(JSON.stringify(ed.sel.map(o=>({m:o.m,shape:o.shape}))));
  await frame();ed.doUndo();if(ed.state()!==before)errors.push('exact Undo failed');
 }
  if(new Set(outputs).size!==1)errors.push('nondeterministic geometry');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(outputs[0])));
  return {errors,openingMs:opening,hover300Ms:hover,render10Ms:render,applyMs:apply,groups:51,outputGeometryHash:[...digest].map(n=>n.toString(16).padStart(2,'0')).join('')};
};
window.runPathIslandResourceChecks=async()=>{
 ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
 ed.setSel(ed.doc.objs.filter(o=>o.id===233));ed.zoomSelection();
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),before=ed.state(),listeners=ed.listeners.size;
 openPathIslandsDialog(ed);const dialog=document.querySelector('.path-islands-dialog');
 check(!!dialog&&!dialog.matches(':modal'),'path separation opens a nonmodal workspace tool window');
 check(dialog.querySelectorAll('[data-island-group]').length===51,'original inseln resource previews50 islands plus the self-crossing remnant');
 check(ed.outlinePreview.excluded.length===1,'only the genuinely self-crossing subpath is highlighted as unchanged');
 check(!dialog.querySelector('.primary').disabled&&ed.state()===before,'safe recovery preview enables Apply without changing source');
 let pickMatches=true;
 const nodesAll=ed.outlinePreview.subs.flatMap(s=>s.nodes),bx0=Math.min(...nodesAll.map(n=>n.x)),bx1=Math.max(...nodesAll.map(n=>n.x)),by0=Math.min(...nodesAll.map(n=>n.y)),by1=Math.max(...nodesAll.map(n=>n.y));
 for(let k=0;k<1200;k++){
  const p={x:bx0+(bx1-bx0)*(k%40)/39,y:by0+(by1-by0)*Math.floor(k/40)/29};
  const hits=ed.outlinePreview.holes.flatMap((subs,i)=>i===0||!regionContains({layer:0,subs},p.x,p.y)?[]:[{i,area:Math.abs(subs[0].nodes.reduce((a,n,j)=>{const q=subs[0].nodes[(j+1)%subs[0].nodes.length];return a+n.x*q.y-q.x*n.y},0))}]);
  hits.sort((a,b)=>a.area-b.area);ed.outlinePreview.move(p);if(ed.outlinePreview.hover!==(hits[0]?.i??-1))pickMatches=false;
 }
 check(pickMatches,'cached bounded picking matches original exhaustive picker for1200 workspace probes');
 const button=dialog.querySelector('[data-island-group="1"]');button.dispatchEvent(new PointerEvent('pointerenter'));
 check(ed.outlinePreview.hover===1&&button.classList.contains('outline-choice-active'),'list hover highlights the corresponding result group in workspace');
 const group=ed.outlinePreview.holes[1],nodes=group[0].nodes,x0=Math.min(...nodes.map(n=>n.x)),x1=Math.max(...nodes.map(n=>n.x)),y0=Math.min(...nodes.map(n=>n.y)),y1=Math.max(...nodes.map(n=>n.y));
 const plan={outer:[],holes:ed.outlinePreview.holes.map(subs=>({layer:0,subs}))};let pick;
 for(let y=1;y<30&&!pick;y++)for(let x=1;x<30;x++){const p={x:x0+(x1-x0)*x/30,y:y0+(y1-y0)*y/30};if(outlineHoleAt(plan,p.x,p.y)===1){pick=p;break;}}
 check(!!pick,'result group has an interior workspace pick');if(pick)ed.outlinePreview.pick(pick);
 check(button.getAttribute('aria-current')==='true','workspace pick identifies its result-list entry');
 const old=dialog.getBoundingClientRect();dialog.querySelector('h3').dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:old.left+30,clientY:old.top+20,bubbles:true}));
 window.dispatchEvent(new PointerEvent('pointermove',{clientX:old.left-20,clientY:old.top+40}));window.dispatchEvent(new PointerEvent('pointerup'));
 check(Math.abs(dialog.getBoundingClientRect().left-old.left)>10,'path-island window moves by dragging its title');
 dialog.querySelector('#path-islands-preserve').click();check(dialog.querySelector('.primary').disabled,'strict mode still refuses the original invalid contours');
 dialog.querySelector('#path-islands-preserve').click();check(!dialog.querySelector('.primary').disabled&&ed.state()===before,'preservation mode recovers without modifying geometry in preview');
 dialog.querySelector('.primary').click();await wait(20);
 check(!dialog.open&&ed.doc.objs.length===53,'Apply creates50 valid islands while retaining existing objects/remnants');
 const retained=ed.doc.objs.find(o=>o.id===233);check(retained.shape.subs.length===1,'the self-crossing source span keeps original object ID');
 ed.doUndo();check(ed.state()===before,'path-island resource Undo restores exact original document');
 check(!ed.outlinePreview&&ed.listeners.size===listeners,'preview and listeners are cleaned up');
 return {errors,passed};
};
window.runOutlineIslandResourceChecks=async()=>{
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name);
 for(const outputMode of ['outer','combined','islands']){
  ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
  ed.setSel(ed.doc.objs.filter(o=>[154,155,156,157,158].includes(o.id)));ed.zoomSelection();
  const before=ed.state(),originals=JSON.stringify(ed.doc.objs),count=ed.doc.objs.length;
  await openOutlineDialog(ed);const dialog=document.querySelector('.outline-dialog');
  check(!!dialog,'precise resource dialog opens '+outputMode);if(!dialog)continue;
  const tol=dialog.querySelector('#outline-tolerance');tol.value='.05';tol.dispatchEvent(new Event('input'));
  await wait(160);
  const mode=dialog.querySelector('#outline-mode');mode.value=outputMode;mode.dispatchEvent(new Event('change'));
  if(outputMode!=='outer'){
    const all=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Alle exakten');all.click();
  }
  check(!dialog.querySelector('.primary').disabled,'precise resource mode applicable '+outputMode);
  check(ed.outlinePreview.subs.length===({outer:1,combined:35,islands:34})[outputMode],'resource output has only requested contours '+outputMode);
  check(ed.outlinePreview.subs.some(s=>s.nodes.some(n=>n.cin||n.cout)),'resource output retains source Beziers '+outputMode);
  check(ed.state()===before&&ed.history.position===0,'resource preview leaves original definitions untouched '+outputMode);
  if(dialog.querySelector('.primary').disabled){errors.push(dialog.querySelector('[role=status]').textContent);dialog.close();await wait(20);continue;}
  dialog.querySelector('.primary').click();await wait(20);
  check(!dialog.open&&ed.doc.objs.length===count+1,'resource Apply succeeds '+outputMode);
  check(JSON.stringify(ed.doc.objs.slice(0,count))===originals,'resource Apply preserves original objects '+outputMode);
  ed.doUndo();check(ed.state()===before,'resource extraction Undo exact '+outputMode);
 }
 await openOutlineDialog(ed);const dialog=document.querySelector('.outline-dialog');
 const tol=dialog.querySelector('#outline-tolerance');tol.value='.2';tol.dispatchEvent(new Event('input'));
 await wait(160);
 const mode=dialog.querySelector('#outline-mode');mode.value='islands';mode.dispatchEvent(new Event('change'));
 check(dialog.querySelectorAll('.outline-choices input:disabled').length===0&&dialog.querySelector('.outline-choices').textContent.includes('Näherung'),'validated approximation remains visible and directly selectable');
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Alle exakten').click();
 check(dialog.querySelectorAll('.outline-choices input:checked').length===43,'select-all explicitly skips the one ambiguous island');
 check(!dialog.querySelector('.primary').disabled&&ed.outlinePreview.subs.length===43,'unambiguous islands remain applicable without an invented substitute');
 dialog.close();await wait(20);
 check(!ed.outlinePreview&&ed.history.position===0,'ambiguous-island inspection and cancellation make no document edit');
 return {errors,passed};
};
window.runSingleSourceScreenshotChecks=async()=>{
 await wait(50);ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
 ed.setSel(ed.doc.objs.filter(o=>o.id===187));ed.zoomSelection();
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),before=ed.state();
 const s=ed.prepareContourOffset(.1),c=s.plan.contours[2];
 const section=offsetContourSections(s.sources,s.plan,c.key,.1).find(p=>p.sub===33);
 check(!!section,'tolerance0.1 contour3 contains screenshot source187/sub34');
 openContourOffsetDialog(ed);const dialog=document.querySelector('.outline-tool-window');
 const tol=dialog.querySelector('#contour-offset-tolerance');tol.value='.1';tol.dispatchEvent(new Event('input'));
 const dist=dialog.querySelector('#contour-offset-distance');dist.value='.2';dist.dispatchEvent(new Event('input'));
 dialog.querySelectorAll('#contour-offset-contours input')[2].click();
 const mode=dialog.querySelector('#contour-offset-mode');mode.value='exclude';mode.dispatchEvent(new Event('change'));
 const choice=dialog.querySelector('#contour-offset-exclusion-section');choice.value=section.key;choice.dispatchEvent(new Event('change'));
 ed.outlinePreview.pick(pointAt(ed.outlinePreview.excluded.at(-1),.5));
 const pending=dialog.querySelector('#contour-offset-request-status').textContent;
 check(ed.state()===before&&ed.history.position===0,'screenshot selection and exclusion do not mutate document');
 for(let tries=0;tries<20;tries++){
  const rest=dialog.querySelector('#contour-offset-remainders input:not(:disabled):not(:checked)');if(!rest)break;rest.click();
 }
 const status=dialog.querySelector('#contour-offset-request-status').textContent;
 check(!dialog.querySelector('.primary').disabled,'exact screenshot request becomes applicable after individual remainder cleanup');
 check(!status.includes('Anforderung ausstehend'),'valid exact screenshot does not retain stale pending state');
 const savedConfirm=window.confirm;window.confirm=()=>true;
 if(!dialog.querySelector('.primary').disabled){
  dialog.querySelector('.primary').click();await wait(30);
  check(!dialog.open,'exact screenshot Apply closes successfully');
  const recipe=readContourOffset(ed.doc.objs.find(o=>o.id===187).shape);
  check(recipe?.excluded.some(p=>p.sub===33)&&recipe.edits.some(e=>e.token===c.key&&e.distance===-.2),'Apply persists source34 exclusion and requested0.2 inset');
  ed.doUndo();check(ed.state()===before,'exact screenshot Apply Undo restores original document');
 }else{dialog.close();await wait(30);}
 window.confirm=savedConfirm;
 return {errors,passed,pending,status};
};
window.runOffsetResourceChecks=async()=>{
  await wait(50);ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
 ed.setSel(ed.doc.objs.filter(o=>o.id===154||o.id===187));ed.zoomSelection();
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),before=ed.state();
 const session=ed.prepareContourOffset(.2),values=new Map();
 const good=[],bad=[];
 session.plan.contours.forEach((c,i)=>{try{offsetResults(session.sources,session.plan,new Map([[c.key,-.2]]),.2);good.push(i)}catch(error){bad.push({index:i,reason:String(error)})}});
 check(session.plan.contours.length===46,'resource detects 46 contours at 0.2 mm');
 check(good.length===41,'resource accepts 41 single 0.2 mm insets');
 check(session.plan.contours.filter(c=>c.blocked).length===1,'only genuinely ambiguous microface remains ownership-blocked');
 for(const i of good)values.set(session.plan.contours[i].key,-.2);
 const all=offsetResults(session.sources,session.plan,values,.2);
 check(all.preview.length===41,'all 41 accepted contours also pass together');
 openContourOffsetDialog(ed);const dialog=document.querySelector('.outline-tool-window');
 const tolerance=dialog.querySelector('#contour-offset-tolerance');tolerance.value='.2';tolerance.dispatchEvent(new Event('input'));
  const boxes=[...dialog.querySelectorAll('#contour-offset-contours input')];
 check(boxes.length===46&&!boxes[35].disabled&&!boxes[43].disabled,'formerly false-blocked large contours are selectable');
 boxes[good[0]].click();const previous=JSON.stringify(ed.outlinePreview.subs);
 boxes[31].click();
  check(JSON.stringify(ed.outlinePreview.subs)===previous&&boxes[good[0]].checked&&boxes[31].checked,'invalid request does not erase prior preview and stays visibly requested');
  check(dialog.querySelector('.primary').disabled&&dialog.querySelector('#contour-offset-exclusion-contour').value===session.plan.contours[31].key,'failed request becomes editable target and prevents stale Apply');
  boxes[31].click();
 for(const i of good.slice(1))boxes[i].click();
   check(dialog.querySelectorAll('#contour-offset-contours input:checked').length===41&&dialog.querySelector('.primary').disabled&&dialog.querySelector('#contour-offset-request-status').textContent.includes('Anforderung ausstehend'),'workspace stages all41 requests without presenting invalid output as valid');
 const combined=JSON.stringify(ed.outlinePreview.subs);boxes[31].click();
   check(JSON.stringify(ed.outlinePreview.subs)===combined&&dialog.querySelectorAll('#contour-offset-contours input:checked').length===42&&dialog.querySelector('.primary').disabled,'failed request with 41 valid selections retains last output but cannot apply it');
   boxes[31].click();
  check(ed.state()===before&&ed.history.position===0,'all preview clicks preserve exact source and Undo');
  check(dialog.querySelector('.primary').disabled&&dialog.querySelector('[role=status]').textContent.includes('gesperrt'),'unresolved new open results block Apply');
  for(let tries=0;tries<20000;tries++){
    const rest=dialog.querySelector('#contour-offset-remainders input:not(:disabled):not(:checked)');if(!rest)break;rest.click();
  }
   check(!dialog.querySelector('.primary').disabled,'explicit remainder cleanup restores valid Apply');
   const cleaned=offsetResults(session.sources,session.plan,values,.2,new Set(all.remainders.filter(p=>!p.protected).map(p=>p.key)));
   check(ed.outlinePreview.subs.length===cleaned.recipes.flatMap(r=>r?.result??[]).length,'validated cleaned result is fully previewed before Apply');
  const confirmations=[];window.confirm=message=>{confirmations.push(message);return true};
  const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.querySelector('.primary').click();await closed;
  check(confirmations.some(message=>message.includes('Layer-Kerf')),'resource requires explicit 0.06 mm layer-Kerf acknowledgment');
 const changed=ed.doc.objs.find(o=>o.id===187),recipe=readContourOffset(changed.shape);
 check(ed.doc.objs.length===project.pages[project.page||0].objs.length&&ed.doc.objs.some(o=>o.id===154)&&new Set(recipe.edits.map(e=>e.token)).size===41,'Apply retains original objects and stores 41 distinct contour recipes');
 check(ed.prepareContourOffset(.2).plan.contours.filter(c=>c.distance===-.2).length===41,'all 41 saved contour offsets reopen without stale ownership');
 ed.doUndo();check(ed.state()===before,'resource batch Undo restores exact document and selection');
  return {errors,passed,rejected:bad};
};
window.runPendingOriginalResourceChecks=async()=>{
 await wait(50);ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
 ed.setSel(ed.doc.objs.filter(o=>[155,156,157,158].includes(o.id)));ed.zoomSelection();
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),before=ed.state();
 const session=ed.prepareContourOffset(.2);check(session.plan.contours.length===46&&session.plan.unused===6,'authoritative original selection detects46 contours and6 ends');
 openContourOffsetDialog(ed);const dialog=document.querySelector('.outline-tool-window');
 const tolerance=dialog.querySelector('#contour-offset-tolerance');tolerance.value='.2';tolerance.dispatchEvent(new Event('input'));
 const distance=dialog.querySelector('#contour-offset-distance');distance.value='.5';distance.dispatchEvent(new Event('input'));
 for(const index of [36,43]){
   const boxes=[...dialog.querySelectorAll('#contour-offset-contours input')];boxes[index].click();
   check(dialog.querySelector('.primary').disabled,'invalid original contour'+(index+1)+' blocks Apply');
   check(dialog.querySelector('#contour-offset-exclusion-contour').value===session.plan.contours[index].key,'invalid original contour'+(index+1)+' is editing target');
   const mode=dialog.querySelector('#contour-offset-mode');mode.value='exclude';mode.dispatchEvent(new Event('change'));
   const choices=dialog.querySelector('#contour-offset-exclusion-section');
   check(choices.options.length>1,'original sections offered despite failed full offset'+(index+1));
   choices.value=choices.options[1].value;choices.dispatchEvent(new Event('change'));
   check(ed.outlinePreview.excluded.length>0,'original boundary of pending contour'+(index+1)+' can be highlighted');
   check(ed.state()===before&&ed.history.position===0,'pending original contour editing stays document-free'+(index+1));
   boxes[index].click();
 }
 const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.close();await closed;
 return {errors,passed};
};
window.runCrossOwnerPendingChecks=async()=>{
 await wait(50);ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
 ed.setSel(ed.doc.objs.filter(o=>[154,155,156,157,158].includes(o.id)));ed.zoomSelection();
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),before=ed.state();
 const s=ed.prepareContourOffset(.2);check(s.plan.contours.length===47,'all-five-source screenshot selection detects47 contours');
 openContourOffsetDialog(ed);const dialog=document.querySelector('.outline-tool-window');
 const tol=dialog.querySelector('#contour-offset-tolerance');tol.value='.2';tol.dispatchEvent(new Event('input'));
 const dist=dialog.querySelector('#contour-offset-distance');dist.value='.5';dist.dispatchEvent(new Event('input'));
 dialog.querySelectorAll('#contour-offset-contours input')[12].click();
 const mode=dialog.querySelector('#contour-offset-mode');mode.value='exclude';mode.dispatchEvent(new Event('change'));
 const section=dialog.querySelector('#contour-offset-exclusion-section');section.value=section.options[1].value;section.dispatchEvent(new Event('change'));
 const p=ed.outlinePreview.excluded[0].nodes[0];ed.outlinePreview.pick(p);
 const status=dialog.querySelector('#contour-offset-request-status');
 check(status.textContent.includes('Ausgabeobjekt wählen'),'cross-owner refusal is exposed in persistent request status');
 ed.outlinePreview.move(p);
 check(status.textContent.includes('Ausgabeobjekt wählen'),'hover hint cannot hide actual cross-owner refusal');
 check(dialog.querySelector('.primary').disabled&&ed.state()===before&&ed.history.position===0,'mixed-owner exclusion remains safely blocked without document mutation');
 const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.close();await closed;
 return {errors,passed};
};
window.runMixedAssemblyResourceChecks=async()=>{
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name);
 for(const number of [13,14])for(const hostId of [156,157]){
  await wait(50);ed.doc=loadDoc(structuredClone(project));ed.history=new History();ed.setTool('select');
  ed.setSel(ed.doc.objs.filter(o=>[154,155,156,157,158].includes(o.id)));ed.zoomSelection();await wait(30);
  const before=ed.state(),objectCount=ed.doc.objs.length,layers=JSON.stringify(ed.doc.layers),s=ed.prepareContourOffset(.2),c=s.plan.contours[number-1];
  const part=offsetContourSections(s.sources,s.plan,c.key,.2).find(p=>p.id===157&&p.sub===(number===13?6:5));
  check(!!part,'screenshot section recognized '+number+'/'+hostId);
  openContourOffsetDialog(ed);const dialog=document.querySelector('.outline-tool-window');
  const tol=dialog.querySelector('#contour-offset-tolerance');tol.value='.2';tol.dispatchEvent(new Event('input'));
  const dist=dialog.querySelector('#contour-offset-distance');dist.value='.5';dist.dispatchEvent(new Event('input'));
  dialog.querySelectorAll('#contour-offset-contours input')[number-1].click();
  const mode=dialog.querySelector('#contour-offset-mode');mode.value='exclude';mode.dispatchEvent(new Event('change'));
  const choice=dialog.querySelector('#contour-offset-exclusion-section');choice.value=part.key;choice.dispatchEvent(new Event('change'));
  ed.outlinePreview.pick(pointAt(ed.outlinePreview.excluded[0],.5));
  check(dialog.querySelector('.primary').disabled,'no implicit mixed-source assembly '+number+'/'+hostId);
  const owner=dialog.querySelector('#contour-offset-assembly-owner');owner.value=String(hostId);owner.dispatchEvent(new Event('change'));
  dialog.querySelector('#contour-offset-assembly').click();
  let removed=0;
  for(let tries=0;tries<100;tries++){
   const rest=dialog.querySelector('#contour-offset-remainders input:not(:disabled):not(:checked)');if(!rest)break;rest.click();removed++;
  }
  check(removed===(number===14?1:0),'only explicit unprotected remainder removal '+number+'/'+hostId);
  check(!dialog.querySelector('.primary').disabled,'complete screenshot request becomes applicable '+number+'/'+hostId);
  if(dialog.querySelector('.primary').disabled){errors.push('Blocked request detail '+number+'/'+hostId+': '+dialog.querySelector('#contour-offset-request-status').textContent);dialog.close();await wait(30);continue;}
  check(dialog.querySelector('#contour-offset-request-status').textContent.includes('Quellreste'),'changed source-kerf behavior explicitly warned '+number+'/'+hostId);
  const stagedAmounts=new Map([[c.key,-.5]]),stagedExclusions=new Map([[157,part.spans]]),stagedOwners=new Map([[c.key,hostId]]);
  const raw=offsetResults(s.sources,s.plan,stagedAmounts,.2,new Set(),stagedExclusions,stagedOwners);
  let refused=false;try{
   ed.applyContourOffset(s,stagedAmounts,false,false,{exclusions:stagedExclusions,assemblyOwners:stagedOwners,
    removeRemainders:new Set(raw.remainders.filter(r=>!r.protected).map(r=>r.key)),confirmedAssembly:true,confirmedClosureKerf:true,confirmedRemainderRemoval:true});
  }catch(error){refused=String(error).includes('Quellreste');}
  check(refused&&ed.state()===before&&ed.history.position===0,'editor independently requires open-source-output acknowledgment '+number+'/'+hostId);
  const prompts=[];window.confirm=text=>{prompts.push(text);return true};
  dialog.querySelector('.primary').click();await wait(30);
  if(dialog.open){errors.push('Apply failed '+number+'/'+hostId+': '+dialog.querySelector('[role=status]').textContent);dialog.close();await wait(30);continue;}
  const host=ed.doc.objs.find(o=>o.id===hostId),recipe=readContourOffset(host.shape);
  check(recipe?.result.some(p=>p.closed)&&recipe.edits.some(e=>e.token===c.key&&e.outputOwner===hostId),'selected output host persists closed screenshot assembly '+number+'/'+hostId);
  check(prompts.some(p=>p.includes('offene Linien ohne Layer-Kerf'))&&prompts.some(p=>p.includes('Layer-Kerf')),'source-remnant and closed-output kerf effects acknowledged '+number+'/'+hostId);
  check(JSON.stringify(ed.doc.layers)===layers&&ed.doc.objs.length===objectCount&&s.sources.every(source=>{
   const current=ed.doc.objs.find(o=>o.id===source.id);const saved=readContourOffset(current.shape);
   return saved?JSON.stringify(saved.source)===JSON.stringify(source.source):JSON.stringify(current.shape)===JSON.stringify(source.source);
  }),'layer settings and original definitions preserved '+number+'/'+hostId);
  openContourOffsetDialog(ed);const reopened=document.querySelector('.outline-tool-window');
  check(reopened.querySelector('#contour-offset-assembly').checked&&reopened.querySelector('#contour-offset-assembly-owner').value===String(hostId),'screenshot assembly reopens editable '+number+'/'+hostId);
  const closeAgain=new Promise(resolve=>reopened.addEventListener('close',resolve,{once:true}));reopened.close();await closeAgain;
  ed.doUndo();check(ed.state()===before,'screenshot assembly Undo restores exact project '+number+'/'+hostId);
 }
 return {errors,passed};
};
window.runFeatureChecks=async()=>{
  await wait(50);ed.doc=loadDoc(structuredClone(project));ed.setTool('select');ed.zoomPage();
 const statuses=[];
 for(const obj of ed.doc.objs){
  ed.setSel([obj]);openPathIslandsDialog(ed);const dialog=document.querySelector('dialog[open]');
  statuses.push({id:obj.id,kind:obj.shape.kind,disabled:[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Übernehmen').disabled,message:dialog.querySelector('[role=status]').textContent});
  const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.close();await closed;
 }
 return {errors:[],passed:['read-only project selection/dialog diagnostics completed'],statuses};
};
let expectedId;
const prepareOverlap=async(selected)=>{
  await wait(50);localStorage.removeItem('kizamubeam.overlap-picker');ed.doc=loadDoc(structuredClone(project));ed.setTool('select');ed.setSel([]);ed.zoomPage();
 for(const obj of ed.doc.objs)if(obj.shape.kind==='path')for(const sub of obj.shape.subs)for(const node of sub.nodes){
  const p=apply(obj.m,node.x,node.y),candidates=overlapCandidates(ed,p);
  if(candidates.length<2)continue;
  const screen=ed.toScreen(p),r=ed.canvas.getBoundingClientRect();
  if(screen.x<30||screen.y<30||screen.x>r.width-30||screen.y>r.height-30)continue;
  if(selected){ed.setSel([candidates[0]]);if(ed.hitHandle(screen.x,screen.y)<0&&!ed.hitRotateZone(screen.x,screen.y)&&!ed.hitPivot(screen.x,screen.y)){ed.setSel([]);continue;}}
  expectedId=candidates[1].id;return {x:r.left+screen.x,y:r.top+screen.y};
 }
 throw Error('No overlapping selectable curves found at sampled nodes');
};
window.prepareTrustedOverlap=()=>prepareOverlap(false);
window.prepareTrustedOverlapSelected=()=>prepareOverlap(true);
window.trustedOverlapMenu=()=>{const menu=document.querySelector('.overlap-picker'),b=menu?.querySelectorAll('button')[1],r=b?.getBoundingClientRect();return {open:!!menu,x:r?.left+10,y:r?.top+r?.height/2}};
window.checkTrustedOverlap=()=>({errors:ed.sel[0]?.id===expectedId?[]:['Resource overlap selection failed'],passed:ed.sel[0]?.id===expectedId?['actual resource + actual context-menu handler: trusted right hold selects second candidate']:[]});
`;
const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,outfile:'fixture.js',format:'esm',external:['node:module'],metafile:true,loader:{'.woff':'empty','.woff2':'empty'},plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/(?:^|\/)files$/},()=>({path:'files',namespace:'offline'}));b.onResolve({filter:/(?:^|\/)native$/},()=>({path:'native',namespace:'offline'}));
 b.onLoad({filter:/.*/,namespace:'offline'},({path})=>({contents:path==='native'?"export const hasNative=()=>false;export const native=()=>{throw Error('Forbidden')};":"export const objsPreviewSvg=()=>{throw Error('Forbidden')},saveDataUrl=objsPreviewSvg;",loader:'js'}));}}]});
for(const name of Object.keys(result.metafile.inputs))if(/src\/(main|ui|laser|machine|camera|agent)\.ts$/.test(name))throw Error('Forbidden dependency '+name);
for(const f of result.outputFiles)await writeFile(out+'/'+(f.path.endsWith('.css')?'fixture.css':'fixture.js'),f.contents);
await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0}canvas{width:100vw;height:90vh}</style><canvas></canvas><script type="module" src="fixture.js"></script>');
