import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/feature-browser';await mkdir(out,{recursive:true});
const contents=`
import {Editor} from './src/editor';import {newDoc,newId,defaultLayer} from './src/model';import {History} from './src/history';
import './src/style.css';
Editor.prototype.restore=function(){};Editor.prototype.scheduleSave=function(){};
const ed=new Editor(document.querySelector('canvas'));window.editorPrototype=ed;

import {openFreehandEditDialog} from './src/freehandEditDialog';
window.runFeatureChecks=async()=>{
 await new Promise(r=>setTimeout(r,50));const errors=[],passed=[],check=(v,n)=>(v?passed:errors).push(n);
 ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);ed.view={zoom:1,ox:0,oy:0};
 const obj={id:newId(),m:[1,0,0,1,0,0],layer:0,name:'retained',shape:{kind:'path',subs:[{closed:false,start:true,nodes:[{x:40,y:40},{x:80,y:40},{x:120,y:40}]}]}};
 ed.doc.objs=[obj];ed.setSel([obj]);const before=ed.state();openFreehandEditDialog(ed);
 const dialog=document.querySelector('dialog');[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Werkzeug starten').click();check(ed.tool==='freehand-edit','dialog starts explicit edit tool');
 const event=(x,y,extra={})=>({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){},...extra});ed.canvas.setPointerCapture=()=>{};
 ed.onDown(event(120,40));ed.onMove(event(130,55));ed.onUp(event(145,65,{pointerId:2}));check(ed.drag?.type==='freehand-edit','unrelated release cannot finish stroke');
 ed.onUp(event(145,65));check(ed.doc.objs.length===1&&ed.history.position===1&&obj.shape.subs[0].nodes.length>3,'continuation edits existing path in one Undo');
 ed.doUndo();check(ed.state()===before,'Undo restores exact old path');
 ed.freehandMode='redraw';ed.onDown(event(40,40));ed.onMove(event(60,70));ed.onUp(event(80,40));check(ed.history.position===1&&ed.doc.objs[0].shape.subs[0].nodes.at(-1).x===120,'redraw preserves untouched tail');
 const changed=ed.state();ed.onDown(event(40,40));ed.onMove(event(50,80));ed.cancelDrag();check(ed.state()===changed,'Escape/cancel discards preview stroke');
 return {errors,passed};};`;
const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,outfile:'fixture.js',format:'esm',external:['node:module'],metafile:true,loader:{'.woff':'empty','.woff2':'empty'},plugins:[{name:'offline',setup(b){
b.onResolve({filter:/(?:^|\/)files$/},()=>({path:'files',namespace:'offline'}));b.onResolve({filter:/(?:^|\/)native$/},()=>({path:'native',namespace:'offline'}));
b.onLoad({filter:/.*/,namespace:'offline'},({path})=>({contents:path==='native'?"export const hasNative=()=>false;export const native=()=>{throw Error('Forbidden')};":"export const objsPreviewSvg=()=>{throw Error('Forbidden')},saveDataUrl=objsPreviewSvg;",loader:'js'}));}}]});
for(const name of Object.keys(result.metafile.inputs))if(/src\/(main|ui|laser|machine|camera|agent)\.ts$/.test(name))throw Error('Forbidden dependency '+name);
for(const f of result.outputFiles)await writeFile(out+'/'+(f.path.endsWith('.css')?'fixture.css':'fixture.js'),f.contents);
await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0}canvas{width:100vw;height:90vh}</style><canvas></canvas><script type="module" src="fixture.js"></script>');
