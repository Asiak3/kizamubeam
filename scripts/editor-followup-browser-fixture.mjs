// Isolated actual-editor fixtures for independently extracted follow-up PRs.
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url)), mode = process.argv[2];
if (!['pencil', 'outline', 'objects', 'drop', 'pinch'].includes(mode)) throw Error('Choose a feature scope');
const out = resolve(root, 'artifacts/feature-browser'); await mkdir(out, { recursive: true });
const outline = mode === 'outline' ? await readFile(resolve(root, 'scripts/outline-browser-checks.txt'), 'utf8') : '';
const contents = `
import { Editor } from './src/editor';
import { newDoc, newId, defaultLayer } from './src/model';
import { History } from './src/history';
${mode === 'outline' ? "import { openOutlineDialog } from './src/outlineDialog';" : ''}
${mode === 'objects' ? "import { buildObjectsPanel } from './src/objectsPanel';" : ''}
${mode === 'drop' ? "import { dispatchNativeFiles, installDomFileDrop } from './src/nativeFileDrop';\nimport { importSvg } from './src/importers';" : ''}
import './src/style.css';
Editor.prototype.restore=function(){};Editor.prototype.scheduleSave=function(){};
const ed=new Editor(document.querySelector('canvas'));window.editorPrototype=ed;
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),settle=async()=>{await frame();await frame();};
const make=x=>({id:newId(),m:[1,0,0,1,x,30],layer:0,shape:{kind:'rect',w:30,h:30,r:0}});
${mode === 'pencil' ? `
window.preparePencilCheck=async()=>{await settle();ed.doc=newDoc();ed.history=new History();ed.setSel([]);ed.setTool('pencil');ed.zoomPage();const r=ed.canvas.getBoundingClientRect();return {x:Math.round(r.left+100),y:Math.round(r.top+100)};};
window.checkPencilResult=()=>{const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name);
check(ed.doc.objs.length===1,'trusted mouse release creates a path');check(ed.history.position===1,'one Undo step');check(!ed.drag,'normal capture release preserves path');check(ed.hint.includes('Freihandpfad erstellt'),'completion reported');
ed.doUndo();check(!ed.doc.objs.length,'Undo removes path');ed.doRedo();check(ed.doc.objs.length===1,'Redo restores path');return {errors,passed};};
` : mode === 'outline' ? outline.replace('window.runOutlinePrototypeChecks', 'window.runFeatureChecks') : `
window.runFeatureChecks=async()=>{
const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name);await settle();ed.doc=newDoc();ed.history=new History();ed.doc.layers[0]=defaultLayer(0);ed.setSel([]);
${mode === 'objects' ? `
const a=make(30),child=make(0),group={...make(80),shape:{kind:'group',children:[child]}};ed.doc.objs=[a,group];
const body=document.createElement('div');body.id='objects';document.body.append(body);buildObjectsPanel(ed);await settle();
check(body.querySelectorAll('.ot-layer[data-layer]').length===1&&!body.querySelector('[data-id]'),'layers initially collapsed');body.querySelector('.ot-layer .ot-chev').click();
check(!!body.querySelector('[data-id="'+group.id+'"]')&&!body.querySelector('[data-id="'+child.id+'"]'),'groups initially collapsed');
body.querySelector('[data-id="'+group.id+'"] .ot-chev').click();ed.emit('doc');await settle();check(!!body.querySelector('[data-id="'+child.id+'"]'),'manual group expansion survives document refresh');
body.querySelector('.ot-layer .ot-chev').click();ed.emit('doc');await settle();check(!body.querySelector('[data-id]'),'manual layer collapse survives refresh');
const other=make(150);other.layer=4;ed.doc.objs.push(other);ed.emit('doc');await settle();check(body.querySelectorAll('.ot-layer[data-layer]').length===2&&!body.querySelector('[data-id="'+other.id+'"]'),'new layers start collapsed');
body.querySelector('.ot-layer .ot-chev').click();ed.setSel([child]);ed.emit('doc');await settle();check(!!body.querySelector('[data-id="'+child.id+'"]'),'reopening layer retains manual group expansion');
` : mode === 'pinch' ? `
ed.doc.objs=[make(30)];ed.zoomPage();await settle();const before=ed.state(),canvas=ed.canvas,r=canvas.getBoundingClientRect(),x=Math.round(r.left+r.width*.6),y=Math.round(r.top+r.height*.4),z=ed.view.zoom,p=ed.toWorld(x-r.left,y-r.top);
const wheel=new WheelEvent('wheel',{deltaY:-20,ctrlKey:true,clientX:x,clientY:y,cancelable:true});canvas.dispatchEvent(wheel);await settle();const q=ed.toWorld(x-r.left,y-r.top);
check(wheel.defaultPrevented&&ed.view.zoom>z,'Ctrl+wheel pinch zooms canvas, not page');check(Math.hypot(p.x-q.x,p.y-q.y)<1e-7,'pinch preserves pointer anchor');
const gesture=(name,scale)=>Object.assign(new Event(name,{cancelable:true}),{scale,clientX:x,clientY:y});canvas.dispatchEvent(gesture('gesturestart',1));const zg=ed.view.zoom;
canvas.dispatchEvent(gesture('gesturechange',1.2));const zw=ed.view.zoom;canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-20,ctrlKey:true,clientX:x,clientY:y,cancelable:true}));check(ed.view.zoom===zw,'gesture ownership prevents duplicate Ctrl+wheel zoom');canvas.dispatchEvent(gesture('gestureend',1.2));await settle();
check(ed.view.zoom>zg&&ed.state()===before&&ed.history.position===0,'gesture fallback leaves geometry and Undo unchanged');
` : `
const stage=document.createElement('div'),library=document.createElement('div');stage.style.cssText='position:fixed;left:20px;top:200px;width:200px;height:100px;z-index:1000;background:white';library.style.cssText='position:fixed;left:250px;top:200px;width:200px;height:100px;z-index:1000;background:white';document.body.append(stage,library);
const imported=[],lib=[],dropErrors=[];let pending=Promise.resolve();
const dispose=installDomFileDrop(stage,files=>pending=(async()=>{for(const f of files){imported.push(f.name);if(f.name.endsWith('.svg'))await ed.importVectors(importSvg(await f.text()),f.name);}})(),e=>dropErrors.push(String(e)));
const disposeLib=installDomFileDrop(library,async files=>{lib.push(...files.map(f=>f.name));},e=>dropErrors.push(String(e)));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"><rect x="1" y="1" width="18" height="8"/></svg>';
dispatchNativeFiles([{name:'shape.svg',bytes:new TextEncoder().encode(svg).buffer},{name:'image.png',bytes:new Uint8Array([137,80,78,71]).buffer}],40,220);await pending;
check(imported.join()==='shape.svg,image.png','native SVG/image Files reach shared workspace DOM handler');check(ed.doc.objs.length===1&&ed.history.position===1,'actual SVG parser/editor import creates geometry with one Undo');ed.doUndo();check(ed.doc.objs.length===0,'import Undo restores document');
dispatchNativeFiles([{name:'library.svg',bytes:new TextEncoder().encode(svg).buffer}],270,220);await settle();check(lib.join()==='library.svg'&&imported.length===2,'drop routes only to the target panel');
const internal=new DataTransfer();internal.setData('text/plain','kizamubeam-objects');const drag=new DragEvent('dragover',{dataTransfer:internal,cancelable:true});stage.dispatchEvent(drag);check(!drag.defaultPrevented&&dropErrors.length===0,'non-file internal drags remain untouched');dispose();disposeLib();stage.remove();library.remove();
`}
return {errors,passed};};`}
`;
const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: 'ts', contents }, bundle: true, write: false, outfile: 'fixture.js', format: 'esm', metafile: true, logLevel: 'error', external: ['node:module'], loader: { '.woff': 'empty', '.woff2': 'empty' },
plugins: [{ name: 'deny-external-boundaries', setup(b) {
  b.onResolve({ filter: /^\.\/dock$/ }, args => args.importer.endsWith('objectsPanel.ts') ? { path: 'dock', namespace: 'objects-test' } : undefined);
  b.onResolve({ filter: /^\.\/paramsPanel$/ }, args => args.importer.endsWith('objectsPanel.ts') ? { path: 'params', namespace: 'objects-test' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'objects-test' }, ({ path }) => ({ loader: 'js', contents: path === 'dock' ? 'export const isShown=()=>true,setBadge=()=>{},onWindowShow=()=>{};' : "export const openShowIfDialog=()=>{throw Error('Outside test scope')};" }));
  b.onResolve({ filter: /(?:^|\/)files$/ }, () => ({ path: 'files', namespace: 'offline' }));b.onResolve({ filter: /(?:^|\/)native$/ }, () => ({ path: 'native', namespace: 'offline' }));
  b.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path }) => ({ loader: 'js', contents: path === 'native' ? "export const hasNative=()=>false;export const native=()=>{throw Error('Native forbidden')};" : "const deny=()=>{throw Error('File operation forbidden')};export const objsPreviewSvg=deny,saveDataUrl=deny;" }));
} }] });
for (const file of Object.keys(bundle.metafile.inputs)) if (/src\/(main|ui|laser|machine|camera|cameraui|agent)\.ts$/.test(file)) throw Error('Forbidden import: ' + file);
for (const file of bundle.outputFiles) await writeFile(resolve(out, file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'), file.contents);
await writeFile(resolve(out, 'index.html'), `<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0;display:block}canvas{width:100vw;height:90vh}</style><canvas id="canvas"></canvas><script>const deny=()=>{throw Error('External access forbidden')};window.fetch=deny;window.WebSocket=deny;</script><script type="module" src="fixture.js"></script></html>`);
console.log('Created isolated ' + mode + ' fixture: ' + out);
