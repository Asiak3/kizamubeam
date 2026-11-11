// Exercise the actual buildLayers function in isolation, without application startup.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const source = readFileSync('src/ui.ts', 'utf8');
let panel = source.slice(source.indexOf('function buildLayers(ed: Editor)'), source.indexOf('/** Kurzfassung der weiteren Einstellungen'));
if (process.argv.includes('--before-fix')) panel = panel.replace(
  /if \(!root\.contains\(focused\)[^\n]+render\(\);/,
  'if (!root.contains(document.activeElement)) render();');
if (!panel.includes('root.addEventListener')) throw Error('Layer panel extraction failed');
const entry = `
import { h, numInput } from './src/dom';
import { defaultLayer, PALETTE, layerLabel } from './src/model';
import { EditorObjects } from './src/editor/objects';
const $ = (s) => document.querySelector(s), t = (s) => s;
const layerSummary = () => '', imageLayerForm = () => { throw Error('Image form not in this fixture'); };
const openAdjustDialog = () => { throw Error('Dialog forbidden'); }, openLayerDialog = openAdjustDialog;
const frames = [], timers = [], requestAnimationFrame = (fn) => { frames.push(fn); }, setTimeout = (fn) => { timers.push(fn); };
${panel}
window.runLayerChecks = async () => {
  const errors = [], check = (ok, name) => { if (!ok) errors.push(name); };
  const layers = [defaultLayer(0), defaultLayer(1), defaultLayer(2)];
  layers.forEach((l, i) => { l.mode = 'line'; l.name = 'Test ' + i; });
  const listeners = [], root = document.querySelector('#layers'); let snapshots = 0;
  const ed = {activeLayer:1, currentLayer:1, usedLayers:()=>[0,1,2], layer:(i)=>layers[i],
    layerParts:()=>({vec:true,img:false}), on:(fn)=>listeners.push(fn), emit:(w)=>listeners.forEach(fn=>fn(w)),
    snapshot:()=>snapshots++, selectLayer:()=>{}, updateLayer(i, patch){Object.assign(layers[i],patch);this.emit('doc');},
    layerOrder:EditorObjects.prototype.layerOrder, moveLayer:EditorObjects.prototype.moveLayer};
  const frame = async () => { for (const fn of frames.splice(0)) fn(); };
  const order = () => [...root.querySelectorAll('tr td:nth-child(2)')].map(el => el.textContent).join(',');
  const arrow = (n) => root.querySelectorAll('.layer-tools button')[n];
  buildLayers(ed); check(order()==='Test 0,Test 1,Test 2','initial order');
  arrow(0).focus(); arrow(0).click(); await frame();
  check(order()==='Test 1,Test 0,Test 2','focused up button refreshes immediately');
  arrow(1).focus(); arrow(1).click(); await frame();
  check(order()==='Test 0,Test 1,Test 2','focused down button refreshes immediately');
  check(ed.activeLayer===1 && snapshots===2,'selected layer retained, one snapshot per move');
  const input = root.querySelector('input[type=text]'); input.focus(); input.value='Uncommitted';
  ed.emit('doc'); await frame(); check(root.contains(input) && input.value==='Uncommitted','active text edit retained');
  input.value='Renamed'; input.dispatchEvent(new Event('change',{bubbles:true})); await frame();
  check(root.contains(input),'change does not replace active field');
  document.querySelector('#outside').focus();
  check(document.activeElement===document.querySelector('#outside'),'focus leaves panel');
  root.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
  for (const fn of timers.splice(0)) fn(); await frame();
  check(order()==='Test 0,Renamed,Test 2','deferred text change refreshes on exit');
  const select = root.querySelector('select'); select.focus(); ed.emit('doc'); await frame();
  check(root.contains(select),'active mode selection retained');
  return {errors,snapshots,order:order(),names:layers.map(l=>l.name),input:input.outerHTML};
};`;
const result = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,
  write:false,format:'esm',platform:'browser',loader:{'.woff':'empty','.woff2':'empty'},logLevel:'error'});
const out = 'artifacts/local-prototypes/layers-browser'; mkdirSync(out,{recursive:true});
writeFileSync(out+'/fixture.js',result.outputFiles[0].contents);
writeFileSync(out+'/index.html','<!doctype html><meta charset="utf-8"><title>Isolated layer refresh checks</title><button id="outside">Outside</button><div id="layers"></div><script type="module" src="fixture.js"></script>');
console.log('Created '+out);
