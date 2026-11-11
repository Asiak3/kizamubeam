import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/feature-browser';await mkdir(out,{recursive:true});
const contents=`
import {Editor} from './src/editor';import {newDoc,newId,defaultLayer} from './src/model';import {History} from './src/history';
import './src/style.css';
Editor.prototype.restore=function(){};Editor.prototype.scheduleSave=function(){};
const ed=new Editor(document.querySelector('canvas'));window.editorPrototype=ed;

import {openPathIslandsDialog} from './src/pathIslandsDialog';
const ring=(x,w,y=40)=>({closed:true,start:true,nodes:[{x,y},{x:x+w,y},{x:x+w,y:y+w},{x,y:y+w}]});
window.runFeatureChecks=async()=>{
 await new Promise(r=>setTimeout(r,50));const errors=[],passed=[],check=(v,n)=>(v?passed:errors).push(n);
 ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);
 const obj={id:newId(),m:[1,0,0,1,0,0],layer:0,name:'retained',shape:{kind:'path',subs:[ring(40,40),ring(50,10,50),ring(82,40)]}};
 ed.doc.objs=[obj];ed.setSel([obj]);const before=ed.state();openPathIslandsDialog(ed);
 let dialog=document.querySelector('dialog'),inputs=dialog.querySelectorAll('input');
 check(dialog.querySelectorAll('svg path').length===2,'preview groups holes with exterior: '+dialog.querySelector('[role=status]').textContent);
 check(ed.state()===before&&ed.history.position===0,'preview does not modify source/history');
 inputs[0].value='3';inputs[0].dispatchEvent(new Event('input'));check(dialog.querySelectorAll('svg path').length===1,'distance setting keeps nearby islands together');
 inputs[0].value='0';inputs[0].dispatchEvent(new Event('input'));
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Abbrechen').click();check(ed.state()===before,'Cancel preserves exact source');
 openPathIslandsDialog(ed);dialog=document.querySelector('dialog');[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Übernehmen').click();
 check(ed.doc.objs.length===2&&ed.doc.objs[0].shape.subs.length===2&&ed.history.position===1,'Apply creates separate islands with holes and one Undo');
 ed.doUndo();check(ed.state()===before,'Undo exact restoration');ed.doRedo();check(ed.doc.objs.length===2,'Redo restores split');
 ed.setSel([ed.doc.objs[0]]);openPathIslandsDialog(ed);dialog=document.querySelector('dialog');ed.emit('doc');check([...dialog.querySelectorAll('button')].find(b=>b.textContent==='Übernehmen').disabled,'changed source invalidates preview');dialog.close();
 return {errors,passed};};`;
const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,outfile:'fixture.js',format:'esm',external:['node:module'],metafile:true,loader:{'.woff':'empty','.woff2':'empty'},plugins:[{name:'offline',setup(b){
b.onResolve({filter:/(?:^|\/)files$/},()=>({path:'files',namespace:'offline'}));b.onResolve({filter:/(?:^|\/)native$/},()=>({path:'native',namespace:'offline'}));
b.onLoad({filter:/.*/,namespace:'offline'},({path})=>({contents:path==='native'?"export const hasNative=()=>false;export const native=()=>{throw Error('Forbidden')};":"export const objsPreviewSvg=()=>{throw Error('Forbidden')},saveDataUrl=objsPreviewSvg;",loader:'js'}));}}]});
for(const name of Object.keys(result.metafile.inputs))if(/src\/(main|ui|laser|machine|camera|agent)\.ts$/.test(name))throw Error('Forbidden dependency '+name);
for(const f of result.outputFiles)await writeFile(out+'/'+(f.path.endsWith('.css')?'fixture.css':'fixture.js'),f.contents);
await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0}canvas{width:100vw;height:90vh}</style><canvas></canvas><script type="module" src="fixture.js"></script>');
