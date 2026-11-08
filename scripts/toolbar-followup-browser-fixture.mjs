import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const mode=process.argv[2];if(!['overlay','toolbar'].includes(mode))throw Error('Choose overlay or toolbar');
const ui=await readFile('src/ui.ts','utf8'),defaults=/initToolbars\(\s*list,\s*\{([\s\S]*?)\n\s*\},/.exec(ui)[1];
const lines=ui.split('\n');const action=mode==='overlay'?lines.slice(lines.findIndex(l=>l.includes("id: 'camera-overlays'")),lines.findIndex(l=>l.includes("id: 'camera-overlays'"))+2).join('\n'):lines.filter(l=>l.includes("id: 'vectorfit'")||l.includes("id: 'isolate'")).join('\n');
const out='artifacts/toolbar-browser';await mkdir(out,{recursive:true});
const result=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import {initToolbars,refreshBars,upgradeBar,SEP} from './src/toolbars';
${mode==='overlay'?"import {cameraOverlaysVisible,toggleCameraOverlays} from './src/cameraOverlayVisibility';":''}
import './src/style.css';
const t=s=>s,V='View',W='Tools',calls=[],ed={isolation:null,sel:[{}],nodeTargets:()=>[{}],vectorFitTargets:()=>[{}],redraw(){calls.push('redraw')},emit(){refreshBars()},isolateSelection(){this.isolation={}},leaveIsolation(){this.isolation=null}};
const canEnterIsolation=()=>true,openVectorFitDialog=()=>calls.push('fit');
const features=[${action}],defaults={${defaults}};
const ids=new Set([...defaults.main,...defaults.tools].filter(id=>id!==SEP));const actions=[...ids].map(id=>features.find(a=>a.id===id)||({id,cat:W,icon:'select',label:id,run(){}}));
window.runFeatureChecks=()=>{const errors=[],passed=[],check=(ok,name)=>(ok?passed:errors).push(name);const old=['tool:node','tool:select','apps'];localStorage.setItem('kizamubeam.toolbars',JSON.stringify({v:5,bars:{main:['view3d','save'],tools:old},size:{main:'l',tools:'s'},hidden:['status'],groups:{}}));initToolbars(actions,defaults);
${mode==='overlay'?`
const b=document.querySelector('[data-action="camera-overlays"]');check(!!b&&!!b.querySelector('svg')&&!b.textContent.trim(),'camera icon appears in migrated main toolbar without text');check(b.getAttribute('aria-pressed')==='true','initial pressed state');b.click();check(!cameraOverlaysVisible()&&b.dataset.icon==='cameraOverlayOff'&&b.getAttribute('aria-pressed')==='false','toolbar toggles gate and icon');toggleCameraOverlays(ed);check(cameraOverlaysVisible()&&b.dataset.icon==='cameraOverlay','external toggle synchronizes icon');check(!document.querySelector('#menubar button'),'no extra menu text button');check(calls.length===2,'display redraw only');
`:`
for(const id of ['vectorfit','isolate']){const b=document.querySelector('[data-action="'+id+'"]');check(!!b&&!!b.querySelector('svg')&&!b.textContent.trim(),'visible SVG '+id);}
const order=[...document.querySelectorAll('#tools [data-action]')].map(b=>b.dataset.action);check(order.filter(id=>old.includes(id)).join()===old.join(),'custom order retained');const isolate=document.querySelector('[data-action="isolate"]');isolate.click();refreshBars();check(isolate.dataset.icon==='isolateExit'&&isolate.title==='Isolation verlassen','isolation exit symbol');isolate.click();refreshBars();check(isolate.dataset.icon==='isolate','isolation entry symbol restored');document.querySelector('[data-action="vectorfit"]').click();check(calls.includes('fit'),'fit command reachable');
`}
const version=${mode==='overlay'?7:8},id=${JSON.stringify(mode==='overlay'?'camera-overlays':'vectorfit')},bar=${JSON.stringify(mode==='overlay'?'main':'tools')};check(upgradeBar(bar,[],version).length===0,'deliberately removed current-version tools stay removed');check(document.querySelector('#tools').dataset.size==='s'&&document.querySelector('#status').hidden,'size and hidden preferences retained');return {errors,passed};};`},bundle:true,write:false,outfile:'fixture.js',format:'esm',loader:{'.woff':'empty','.woff2':'empty'}});
for(const f of result.outputFiles)await writeFile(out+'/'+(f.path.endsWith('.css')?'fixture.css':'fixture.js'),f.contents);
await writeFile(out+'/index.html','<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="menubar"></div><div id="toolbar"></div><div id="tools"></div><div id="numbar"></div><div id="palette"></div><div id="status"></div><script type="module" src="fixture.js"></script></html>');
