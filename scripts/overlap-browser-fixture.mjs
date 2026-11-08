import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/feature-browser';await mkdir(out,{recursive:true});
const contents=`
import {Editor} from './src/editor';import {newDoc,newId,defaultLayer} from './src/model';import {History} from './src/history';
import {loadOverlapSettings,openOverlapSettings,OVERLAP_MOVE_PX} from './src/overlapPicker';import './src/style.css';
import {installEditorContext} from './src/editorContext';import {closeEditorMenu} from './src/contextMenu';
Editor.prototype.restore=function(){};Editor.prototype.scheduleSave=function(){};
localStorage.removeItem('kizamubeam.overlap-picker');
const ed=new Editor(document.querySelector('canvas'));window.editorPrototype=ed;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
window.prepareTrustedOverlap=async()=>{
 await wait(50);localStorage.removeItem('kizamubeam.overlap-picker');ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);ed.view={zoom:1,ox:0,oy:0};ed.setTool('select');ed.setSel([]);
 ed.doc.objs=['lower','upper'].map(name=>({id:newId(),name,layer:0,m:[1,0,0,1,40,40],shape:{kind:'rect',w:100,h:100,r:0}}));
 window.trustedContextCount=0;ed.onCanvasContext=()=>window.trustedContextCount++;
 const r=ed.canvas.getBoundingClientRect();return {x:r.left+80,y:r.top+80};
};
window.trustedOverlapMenu=()=>{
 const menu=document.querySelector('.overlap-picker'),b=menu?.querySelectorAll('button')[1],r=b?.getBoundingClientRect();
 return {open:!!menu,x:r?.left+10,y:r?.top+r?.height/2};
};
window.checkTrustedOverlap=()=>({errors:ed.sel[0]?.name==='lower'&&!document.querySelector('.overlap-picker')&&!ed.overlapHover&&ed.history.position===0&&window.trustedContextCount===0?[]:['trusted right hold selection failed'],passed:ed.sel[0]?.name==='lower'?['trusted right hold/release keeps chooser open; click selects lower object without context action or Undo']:[]});
window.runFeatureChecks=async()=>{
 await wait(50);const errors=[],passed=[],check=(v,n)=>(v?passed:errors).push(n);
 ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);ed.view={zoom:1,ox:0,oy:0};ed.setTool('select');
 const make=(name)=>({id:newId(),m:[1,0,0,1,40,40],layer:0,name,shape:{kind:'rect',w:100,h:100,r:0}});
 const a=make('<img onerror=alert(1)>'),b=make('Upper');ed.doc.objs=[a,b];ed.setSel([]);
 const canvas=ed.canvas,rect=canvas.getBoundingClientRect();canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;
 const event=(type,button=2,x=80,y=80)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,isPrimary:true,button,pointerId:1,clientX:rect.left+x,clientY:rect.top+y}));
 let contexts=0;ed.onCanvasContext=()=>contexts++;
 check(loadOverlapSettings().trigger==='right','long right click is default');
 event('pointerdown');event('contextmenu');await wait(600);
 let menu=document.querySelector('.overlap-picker');check(!!menu,'long right click opens chooser');
 check(ed.sel.length===0 && ed.history.position===0,'opening changes neither selection nor Undo');
 event('pointerup');
 const buttons=[...menu.querySelectorAll('button')];check(buttons.length===2 && !menu.querySelector('img'),'all overlaps listed; names safe text');
 buttons[1].dispatchEvent(new PointerEvent('pointerenter'));check(ed.overlapHover===a && ed.sel.length===0,'hover highlights lower object without selecting');
 buttons[1].click();check(ed.sel[0]===a && !document.querySelector('.overlap-picker') && !ed.overlapHover,'click selects lower object and closes');
 check(ed.history.position===0 && contexts===0,'no history or context action from long click');
 ed.setSel([]);event('pointerdown');event('pointerup');check(contexts===1 && !document.querySelector('.overlap-picker'),'short right click retains context menu');
 event('pointerdown');event('pointermove',2,90,80);event('pointerup',2,90,80);await wait(600);check(!document.querySelector('.overlap-picker'),'movement cancels long-click opening');
 event('pointerdown');await wait(600);event('pointerup');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check(!document.querySelector('.overlap-picker') && ed.sel.length===0,'Escape cancels without selection');
 event('pointerdown');await wait(600);event('pointerup');ed.emit('doc');check(!document.querySelector('.overlap-picker'),'document changes close stale chooser');
 openOverlapSettings();const dialog=document.querySelector('dialog'),select=dialog.querySelector('select'),delay=dialog.querySelector('input');select.value='left';delay.value='300';[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Übernehmen').click();
 check(loadOverlapSettings().trigger==='left' && loadOverlapSettings().delay===300,'settings persist trigger and hold duration');
 event('pointerdown',0);await wait(350);event('pointerup',0);check(!!document.querySelector('.overlap-picker'),'configured long left click opens chooser');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 localStorage.setItem('kizamubeam.overlap-picker',JSON.stringify({trigger:'off',delay:300}));event('pointerdown');await wait(350);event('pointerup');check(!document.querySelector('.overlap-picker'),'disabled preference prevents chooser');
  return {errors,passed};
};
// Real picker, editor pointer/keyboard and context-menu listeners with browser
// propagation/geometry. Synthetic events stub capture; native WKWebView is not simulated.
window.runOverlapRegressionChecks=async()=>{
 await wait(50);const errors=[],passed=[],check=(v,n)=>(v?passed:errors).push(n);
 const canvas=ed.canvas,rect=canvas.getBoundingClientRect();canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;
 const pointer=(type,init={})=>{const e=new PointerEvent(type,{bubbles:true,cancelable:true,isPrimary:true,button:2,pointerId:1,clientX:rect.left+80,clientY:rect.top+80,...init});canvas.dispatchEvent(e);return e};
 const context=(x=80)=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rect.left+x,clientY:rect.top+80});canvas.dispatchEvent(e);return e};
 const key=()=>{const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});document.dispatchEvent(e);return e};
 const noop=()=>{};installEditorContext(ed,{adjust:noop,trace:noop,background:noop,saveBitmap:noop,library:noop,preview:noop,objects:noop});
 const realContext=ed.onCanvasContext,realDown=ed.onDown,realSetSel=ed.setSel;
 let contexts=0,downs=[],selections=0,a,b;
 ed.onCanvasContext=e=>{contexts++;realContext(e)};
 ed.onDown=e=>{downs.push({button:e.button,ctrl:e.ctrlKey});realDown.call(ed,e)};
 ed.setSel=function(...args){selections++;return realSetSel.apply(this,args)};
 const platform=Object.getOwnPropertyDescriptor(navigator,'platform');
 const reset=(mac=false,trigger='right')=>{
  window.dispatchEvent(new Event('blur'));closeEditorMenu();ed.drag=null;ed.isolation=null;
  Object.defineProperty(navigator,'platform',{value:mac?'MacIntel':'Win32',configurable:true});
  localStorage.setItem('kizamubeam.overlap-picker',JSON.stringify({trigger,delay:250}));
  ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);ed.view={zoom:1,ox:0,oy:0};ed.setTool('select');
  [a,b]=['lower','upper'].map(name=>({id:newId(),name,layer:0,m:[1,0,0,1,40,40],shape:{kind:'rect',w:100,h:100,r:0}}));
  ed.doc.objs=[a,b];ed.setSel([b]);contexts=0;downs=[];selections=0;
 };
 const noEdit=()=>ed.history.position===0;
 const macPress={button:0,ctrlKey:true};
 try{
  reset(true);const state=ed.state();pointer('pointerdown',macPress);context();pointer('pointerup',macPress);context();
  check(contexts===1&&!!document.querySelector('.editor-context-menu'),'macOS short Ctrl-click opens real context menu exactly once (early and late contextmenu)');
  check(downs.length===1&&downs[0].button===2&&!downs[0].ctrl&&selections===0&&ed.sel[0]===b,'macOS short replay is secondary, never Ctrl-primary selection');
  check(noEdit()&&ed.state()===state,'short Ctrl-click leaves geometry and Undo unchanged');
  reset(true);pointer('pointerdown',macPress);context();await wait(300);pointer('pointerup',macPress);
  check(!!document.querySelector('.overlap-picker')&&contexts===0&&downs.length===0&&selections===0,'macOS Ctrl-hold opens chooser without early context or selection');
  document.querySelectorAll('.overlap-picker button')[1]?.click();
  check(ed.sel[0]===a&&!document.querySelector('.overlap-picker')&&noEdit(),'macOS Ctrl-hold confirms lower object without Undo');
  reset(true);pointer('pointerdown',macPress);context();pointer('pointermove',{...macPress,clientX:rect.left+80+OVERLAP_MOVE_PX});pointer('pointerup',macPress);context();
  check(contexts===1&&downs.length===1&&downs[0].button===2&&!downs[0].ctrl&&selections===0&&ed.sel[0]===b,'macOS movement cancellation also retains secondary replay and context fallback');
  for(const [mac,trigger,extra,label] of [[false,'right',{},'non-Mac Ctrl-click'],[true,'right',{shiftKey:true},'modified macOS Ctrl-click'],[true,'left',{},'Ctrl-click in left-trigger mode']]){
   reset(mac,trigger);const e=pointer('pointerdown',{...macPress,...extra});pointer('pointerup',{...macPress,...extra});await wait(300);
   check(!e.defaultPrevented&&downs[0]?.button===0&&downs[0]?.ctrl&&!document.querySelector('.overlap-picker'),label+' is not intercepted');
  }
  for(const trigger of ['right','left']){
   reset(false,trigger);const init={button:trigger==='left'?0:2};pointer('pointerdown',init);const escape=key();pointer('pointerup',init);context();await wait(300);
   check(escape.defaultPrevented&&ed.sel.length===1&&ed.sel[0]===b&&contexts===0&&!document.querySelector('.overlap-picker')&&noEdit(),'Escape during pending '+trigger+' hold consumes key without clearing selection');
   key();check(ed.sel.length===0,'next ordinary Escape still reaches real editor keyboard ('+trigger+')');
   reset(false,trigger);ed.setSel([a,b]);ed.isolateSelection();ed.setSel([b]);const isolation=ed.isolation;
   pointer('pointerdown',init);key();pointer('pointerup',init);
   check(ed.isolation===isolation&&ed.sel[0]===b&&noEdit(),'Escape during pending '+trigger+' hold does not leave isolation');
   key();check(ed.isolation===null,'next ordinary Escape exits isolation ('+trigger+')');
  }
  for(const early of [true,false])for(const distance of [3,OVERLAP_MOVE_PX,OVERLAP_MOVE_PX+4]){
   reset();pointer('pointerdown');if(early)context();pointer('pointermove',{clientX:rect.left+80+distance});
   if(distance>=OVERLAP_MOVE_PX){await wait(300);check(!document.querySelector('.overlap-picker'),'movement cancels timer at '+distance+' CSS px, early='+early)}
   if(!early)context(80+distance);pointer('pointerup',{clientX:rect.left+80+distance});
   check(contexts===1&&!!document.querySelector('.editor-context-menu'),'context fallback exists on release without another native contextmenu, '+distance+' CSS px, early='+early);context(80+distance);
   check(contexts===1&&!!document.querySelector('.editor-context-menu')&&noEdit(),'right context fallback exactly once after '+distance+' CSS px, early='+early);
  }
  reset(false,'left');pointer('pointerdown',{button:0});pointer('pointermove',{button:0,clientX:rect.left+85});await wait(300);pointer('pointerup',{button:0});
  check(!!document.querySelector('.overlap-picker')&&downs.length===0&&noEdit(),'5 CSS px trackpad jitter permits configured left hold');key();
  reset(false,'left');pointer('pointerdown',{button:0});pointer('pointermove',{button:0,clientX:rect.left+80+OVERLAP_MOVE_PX});
  check(ed.drag?.type==='move'&&ed.drag.moved&&downs.length===1,'left movement replays real editor drag at threshold');pointer('pointerup',{button:0,clientX:rect.left+80+OVERLAP_MOVE_PX});
  check(!document.querySelector('.overlap-picker')&&ed.history.position>0&&contexts===0,'left drag completes ordinary geometry/history edit without context menu');
  for(const type of ['pointercancel','lostpointercapture']){
   reset();pointer('pointerdown');context();pointer('pointermove',{clientX:rect.left+80+OVERLAP_MOVE_PX});pointer(type);pointer('pointerup');await wait(300);
   check(contexts===0&&!document.querySelector('.overlap-picker'),type+' cancels retained secondary fallback');
  }
 }finally{
  window.dispatchEvent(new Event('blur'));closeEditorMenu();ed.onDown=realDown;ed.setSel=realSetSel;ed.onCanvasContext=realContext;
  if(platform)Object.defineProperty(navigator,'platform',platform);else delete navigator.platform;
 }
 return {errors,passed};
};`;
const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,outfile:'fixture.js',format:'esm',external:['node:module'],metafile:true,loader:{'.woff':'empty','.woff2':'empty'},plugins:[{name:'offline',setup(b){
b.onResolve({filter:/(?:^|\/)files$/},()=>({path:'files',namespace:'offline'}));b.onResolve({filter:/(?:^|\/)native$/},()=>({path:'native',namespace:'offline'}));
b.onLoad({filter:/.*/,namespace:'offline'},({path})=>({contents:path==='native'?"export const hasNative=()=>false;export const native=()=>{throw Error('Forbidden')};":"export const objsPreviewSvg=()=>{throw Error('Forbidden')},saveDataUrl=objsPreviewSvg;",loader:'js'}));}}]});
for(const name of Object.keys(result.metafile.inputs))if(/src\/(main|ui|laser|machine|camera|agent)\.ts$/.test(name))throw Error('Forbidden dependency '+name);
for(const f of result.outputFiles)await writeFile(out+'/'+(f.path.endsWith('.css')?'fixture.css':'fixture.js'),f.contents);
await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0}canvas{width:100vw;height:90vh}</style><canvas></canvas><script type="module" src="fixture.js"></script>');
