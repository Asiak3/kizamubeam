// Isolated actual-editor checks for independently reviewable feature branches.
// No application bootstrap, hardware, camera or native/file operations.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const feature = process.argv[2];
if (!['nodes', 'refit', 'isolation'].includes(feature)) throw Error('Choose nodes, refit or isolation');
const out = resolve(root, 'artifacts/feature-browser');
await mkdir(out, { recursive: true });
const result = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: 'ts', contents: `
import { Editor } from './src/editor';
import { newDoc, newId, defaultLayer } from './src/model';
import { History } from './src/history';
import { shapeSubs } from './src/geom';
${feature === 'refit' ? "import { openVectorFitDialog } from './src/vectorDialog';" : ''}
import './src/style.css';
Editor.prototype.restore=function(){};Editor.prototype.scheduleSave=function(){};
const ed=new Editor(document.querySelector('canvas'));window.editor=ed;
window.runFeatureChecks=async()=>{
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),frame=()=>new Promise(r=>requestAnimationFrame(r));
 await frame();await frame();ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);ed.setSel([]);
 const make=x=>({id:newId(),m:[1,0,0,1,x,30],layer:0,shape:{kind:'rect',w:30,h:30,r:0}});
 const a=make(30),b=make(100);ed.doc.objs=[a,b];ed.setSel([a,b]);ed.zoomBox({x:0,y:0,w:180,h:100});
 ${feature === 'nodes' ? `
 ed.setTool('node');ed.selectAllNodes();check(ed.selectedNodes().length===8,'all nodes across two objects');
 const before=ed.state();ed.nudgeNodes(2,3);check(ed.history.position===1&&shapeSubs(a.shape)[0].nodes[0].x===2&&shapeSubs(b.shape)[0].nodes[0].x===2,'multi-object nudge is one transaction');
 ed.doUndo();check(ed.state()===before,'Undo preserves exact source definitions');ed.doRedo();
 ed.clearNodeSel();const first=ed.doc.objs[0],second=ed.doc.objs[1];ed.segmentSelection(first).add('0:0');ed.segmentSelection(second).add('0:0');
 ed.emit('sel');await frame();ed.render();check(ed.segmentSelection(first).size===1&&ed.segmentSelection(second).size===1,'independent segment selections render on both objects');
 const undo=ed.history.position;ed.deleteNodes();check(ed.history.position===undo+1&&ed.doc.objs.length===2,'segment deletion retains separate objects');
 ed.doUndo();check(shapeSubs(ed.doc.objs[0].shape)[0].closed,'segment delete Undo restores closure');
 ` : feature === 'refit' ? `
 a.shape={kind:'path',subs:[{closed:false,nodes:Array.from({length:50},(_,x)=>({x,y:0}))}]};ed.setSel([a]);
 const before=ed.state();openVectorFitDialog(ed);let dlg=document.querySelector('dialog');await frame();
 check(!!dlg&&!!ed.vectorPreview,'dialog creates preview');check(ed.state()===before&&ed.history.position===0,'preview does not mutate source');
 dlg.querySelector('.primary').click();await frame();check(ed.history.position===1&&shapeSubs(a.shape)[0].nodes.length<50,'Apply simplifies in one step');
 ed.doUndo();check(ed.state()===before,'Undo restores original geometry');
 openVectorFitDialog(ed);dlg=document.querySelector('dialog');dlg.querySelector('.dialog-buttons .btn:not(.primary)').click();await frame();await frame();
 check(!ed.vectorPreview&&ed.state()===before,'Cancel clears preview without edit');
 ` : `
 ed.setSel([a]);const before=ed.state();check(ed.isolateSelection(),'enter isolation');await frame();ed.render();
 check(ed.hitTest({x:110,y:40})===null&&ed.hitTest({x:40,y:40})===a,'actual geometry hit tests exclude outsiders');
 check(ed.viewObjects().length===1&&ed.state()===before&&ed.history.position===0,'render scope is transient');
 ed.setSel([b]);check(ed.sel.length===0,'outsider cannot be selected');
 const c=make(140);ed.doc.objs.push(c);ed.setSel([c]);ed.emit('doc');check(ed.viewObjects().includes(c),'new objects adopted');
 ed.leaveIsolation();await frame();ed.render();check(ed.sel[0]===a&&ed.hitTest({x:110,y:40})===b,'exit restores selection and outside hit tests');
 ed.isolateSelection();ed.clearPageState();check(!ed.isolation,'page reset clears isolation');
 `}
 return {errors,passed};
};` }, bundle: true, write: false, outfile: 'fixture.js', format: 'esm', metafile: true,
 loader: { '.woff': 'empty', '.woff2': 'empty' }, external: ['node:module'], logLevel: 'error',
 plugins: [{ name: 'deny-external-boundaries', setup(b) {
   b.onResolve({ filter: /(?:^|\/)files$/ }, () => ({ path: 'files', namespace: 'offline' }));
   b.onResolve({ filter: /(?:^|\/)native$/ }, () => ({ path: 'native', namespace: 'offline' }));
   b.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path }) => ({ loader: 'js', contents: path === 'native'
     ? "export const hasNative=()=>false;export const native=()=>{throw Error('Native forbidden')};"
     : "const deny=()=>{throw Error('File operation forbidden')};export const objsPreviewSvg=deny,saveDataUrl=deny;" }));
 } }] });
for (const file of Object.keys(result.metafile.inputs)) if (/src\/(main|laser|machine|camera|cameraui|agent)\.ts$/.test(file)) throw Error('Forbidden import: ' + file);
for (const file of result.outputFiles) await writeFile(resolve(out, file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'), file.contents);
await writeFile(resolve(out, 'index.html'), `<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css">
<style>body{margin:0}canvas{width:100vw;height:95vh}</style><canvas></canvas>
<script>const deny=()=>{throw Error('External access forbidden')};window.fetch=deny;window.WebSocket=deny;</script><script type="module" src="fixture.js"></script></html>`);
console.log('Created ' + feature + ' fixture: ' + out);
