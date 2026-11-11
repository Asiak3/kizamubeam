import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/feature-browser';await mkdir(out,{recursive:true});
const contents=`
import {Editor} from './src/editor';import {newDoc,newId,defaultLayer} from './src/model';import {History} from './src/history';
import {loadOverlapSettings,openOverlapSettings} from './src/overlapPicker';import './src/style.css';
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
};`;
const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,outfile:'fixture.js',format:'esm',external:['node:module'],metafile:true,loader:{'.woff':'empty','.woff2':'empty'},plugins:[{name:'offline',setup(b){
b.onResolve({filter:/(?:^|\/)files$/},()=>({path:'files',namespace:'offline'}));b.onResolve({filter:/(?:^|\/)native$/},()=>({path:'native',namespace:'offline'}));
b.onLoad({filter:/.*/,namespace:'offline'},({path})=>({contents:path==='native'?"export const hasNative=()=>false;export const native=()=>{throw Error('Forbidden')};":"export const objsPreviewSvg=()=>{throw Error('Forbidden')},saveDataUrl=objsPreviewSvg;",loader:'js'}));}}]});
for(const name of Object.keys(result.metafile.inputs))if(/src\/(main|ui|laser|machine|camera|agent)\.ts$/.test(name))throw Error('Forbidden dependency '+name);
for(const f of result.outputFiles)await writeFile(out+'/'+(f.path.endsWith('.css')?'fixture.css':'fixture.js'),f.contents);
await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0}canvas{width:100vw;height:90vh}</style><canvas></canvas><script type="module" src="fixture.js"></script>');
