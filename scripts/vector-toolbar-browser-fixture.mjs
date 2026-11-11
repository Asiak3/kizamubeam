// Actual toolbar rendering + actual vector action declarations, without app startup.
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const ui = await readFile(resolve(root, 'src/ui.ts'), 'utf8');
const defaults = /initToolbars\(\s*list,\s*\{([\s\S]*?)\n\s*\},/.exec(ui)?.[1];
const declarations = ui.split('\n').filter(line => /^\s*(?:tool\('(?:node|pencil)'|\{ id: '(?:vectorfit|shape-builder|isolate)'|dyn:.*isolateExit)/.test(line)).join('\n');
if (!defaults || !declarations.includes('isolateExit') || !declarations.includes("tool('pencil', 'pencil'")) throw Error('Vector toolbar source boundaries changed');
const out = resolve(root, 'artifacts/local-prototypes/vector-toolbar');
await mkdir(out, { recursive: true });
const result = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: 'ts', contents: `
import { initToolbars, refreshBars, getAction, SEP, isBarHidden } from './src/toolbars';
import { ICONS } from './src/icons';
import './src/style.css';
const t=s=>s,W='Werkzeuge',calls=[],ed={tool:'select',sel:[{}],isolation:null,
 setTool(tool){this.tool=tool;calls.push(tool);},nodeTargets(){return this.sel;},
 isolateSelection(){this.isolation={};calls.push('isolate');},leaveIsolation(){this.isolation=null;calls.push('leave');}};
const canEnterIsolation=ed=>!ed.isolation&&!!ed.sel.length,openVectorFitDialog=()=>calls.push('fit'),beginShapeBuilder=()=>{ed.tool='builder';calls.push('builder');};
const sel1=()=>ed.sel.length>0;
const tool=(id,icon,label)=>({id:'tool:'+id,cat:W,icon,label,run:()=>ed.setTool(id),on:()=>ed.tool===id});
const featureActions=[${declarations}];
const defaults={${defaults}};
const ids=new Set([...defaults.main,...defaults.tools,'zoompage','zoomout','custom-action'].filter(id=>id!==SEP));
const actions=[...ids].map(id=>featureActions.find(a=>a.id===id)||({id,cat:W,icon:'select',label:id,run:()=>calls.push(id)}));
actions.find(a=>a.id==='grp:zoom').items=['zoompage','zoomout'];
const start=raw=>{document.querySelector('.ctx-menu')?.remove();raw?localStorage.setItem('kizamubeam.toolbars',JSON.stringify(raw)):localStorage.removeItem('kizamubeam.toolbars');initToolbars(actions,defaults);};
const button=id=>document.querySelector('#tools [data-action="'+id+'"]');
window.runVectorToolbarChecks=()=>{
 const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name),required=['tool:node','tool:pencil','vectorfit','shape-builder','isolate'];
 start(null);check(calls.length===0,'loading toolbar never executes an action');
 for(const id of required){const b=button(id);check(!!b&&!!b.querySelector('svg')&&!!b.title&&!b.hidden,'fresh toolbar shows labelled SVG '+id);}
 check(new Set(required.map(id=>getAction(id).icon)).size===5,'vector tools have distinct icons');
 button('tool:pencil').click();refreshBars();check(ed.tool==='pencil'&&button('tool:pencil').classList.contains('on'),'Pencil button selects tool and active state');
 button('tool:node').click();refreshBars();check(ed.tool==='node'&&button('tool:node').classList.contains('on'),'node button selects existing multi-object tool');
 ed.sel=[];refreshBars();check(button('vectorfit').disabled&&button('shape-builder').disabled&&button('isolate').disabled,'selection-dependent commands disabled without selection');
 ed.sel=[{}];refreshBars();button('vectorfit').click();button('shape-builder').click();refreshBars();check(calls.includes('fit')&&ed.tool==='builder'&&button('shape-builder').classList.contains('on'),'fit and builder use registered handlers');
 button('isolate').click();refreshBars();check(ed.isolation&&button('isolate').dataset.icon==='isolateExit'&&button('isolate').title==='Isolation verlassen','active isolation has exit icon and tooltip');
 ed.sel=[];refreshBars();check(!button('isolate').disabled,'isolation can always be left');button('isolate').click();refreshBars();check(!ed.isolation&&button('isolate').dataset.icon==='isolate','exit restores isolation icon');
 const old=['tool:line','custom-action','tool:node','tool:select'];
 start({v:5,bars:{main:['save','grp:zoom','undo'],tools:old},size:{main:'l',tools:'s'},hidden:['status'],groups:{'grp:zoom':'zoomout'}});
 const current=[...document.querySelector('#tools').children].map(el=>el.dataset.action);
 check(required.every(id=>!!button(id)),'v5 toolbar gains all vector tools');check(current.filter(id=>old.includes(id)).join('|')===old.join('|'),'migration preserves custom order');
 check(document.querySelector('#tools').dataset.size==='s'&&document.querySelector('#toolbar').dataset.size==='l'&&isBarHidden('status'),'sizes and hidden state retained');
 check(document.querySelector('#toolbar [data-action="grp:zoom"] button').dataset.cur==='zoomout','last-used group choice retained');
 button('vectorfit').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:100}));
 const remove=[...document.querySelectorAll('.ctx-menu button')].find(b=>b.textContent.includes('aus der Leiste entfernen'));if(!remove)throw Error('Remove action missing');remove.click();
 const saved=JSON.parse(localStorage.getItem('kizamubeam.toolbars'));check(saved.v===7&&!saved.bars.tools.includes('vectorfit'),'removal saves new config without removed action');
 start(saved);check(!button('vectorfit')&&!!button('tool:pencil'),'deliberate removal survives reload');
 check(new Set([...document.querySelectorAll('#tools [data-action]')].map(el=>el.dataset.action)).size===document.querySelectorAll('#tools [data-action]').length,'migration creates no duplicates');
 return {errors,passed};
};` }, bundle: true, write: false, outfile: 'fixture.js', format: 'esm', metafile: true, logLevel: 'error', loader: { '.woff': 'empty', '.woff2': 'empty' } });
for (const file of Object.keys(result.metafile.inputs)) if (/src\/(main|editor|ui|laser|machine|camera|cameraui|agent)\.ts$/.test(file)) throw Error('Forbidden dependency: ' + file);
for (const file of result.outputFiles) await writeFile(resolve(out, file.path.endsWith('.css') ? 'fixture.css' : 'fixture.js'), file.contents);
await writeFile(resolve(out, 'index.html'), `<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css">
<style>body{display:block;padding:12px}#tools{height:550px}#toolbar{display:flex}</style>
<div id="toolbar"></div><div id="tools"></div><div id="numbar"></div><div id="palette"></div><div id="status"></div>
<script>const deny=()=>{throw Error('External access forbidden')};window.fetch=deny;window.WebSocket=deny;</script><script type="module" src="fixture.js"></script></html>`);
console.log('Created isolated vector toolbar fixture: ' + out);
