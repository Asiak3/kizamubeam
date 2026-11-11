// Isolated menu lifecycle/keyboard fixture. Does not import or start the application.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, process.argv[2] ?? 'artifacts/local-prototypes/browser');
// Exercise the actual menu row renderer and isolation tuples without importing the app UI.
const ui = readFileSync(resolve(root, 'src/ui.ts'), 'utf8');
const fillStart = ui.indexOf('  const fill = (list: HTMLElement, items: MenuItem[], checks: (() => void)[]) => {');
const fillEnd = ui.indexOf('  for (const [title, items] of menus)', fillStart);
const isolationRows = ui.split('\n').filter((line) => /^\s*\[t\('(Auswahl isolieren|Isolation verlassen)'\)/.test(line)).join('\n');
if (fillStart < 0 || fillEnd < 0 || isolationRows.split('\n').length !== 2) throw new Error('Menu fixture source boundaries changed');
const context = readFileSync(resolve(root, 'src/editorContext.ts'), 'utf8');
const isolationGate = context.match(/export const canEnterIsolation = [\s\S]*?;/)?.[0].replace('export ', '');
if (!isolationGate) throw new Error('Isolation gate fixture source boundary changed');
const entry = `
import { showEditorMenu, closeEditorMenu } from './src/contextMenu';
import { h } from './src/dom';
type Editor = any;
${isolationGate}
window.runContextMenuChecks = () => {
  const errors = [], check = (ok, name) => { if (!ok) errors.push(name); };
  let ran = 0, closed = 0, escaped = 0;
  const anchor = document.getElementById('anchor'); anchor.focus();
  const bubble = () => escaped++;
  document.addEventListener('keydown', bubble);
  const groups = [[{id:'copy',label:'Copy',run:()=>ran++}, {id:'delete',label:'Delete (disabled)',enabled:false,run:()=>ran+=100}],
    [{id:'tools',label:'Tools',run(){},items:[{id:'paste',label:'Paste',run:()=>ran++}]}]];
  showEditorMenu(innerWidth-2,innerHeight-2,groups,()=>closed++);
  let menu = document.querySelector('.editor-context-menu');
  check(!!menu, 'menu opens');
  const rect = menu.getBoundingClientRect();
  check(rect.left>=0 && rect.top>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1,'viewport bounds');
  check(document.activeElement.textContent.includes('Copy'),'first enabled item focused');
  check(menu.querySelector('kbd').textContent==='Ctrl+C','shared shortcut display');
  menu.querySelector('button:disabled').click(); check(ran===0,'disabled action blocked');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
  check(escaped===0 && ran===0,'Delete captured instead of reaching editor');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  check(document.activeElement.textContent.includes('Tools'),'arrows skip disabled items');
  document.activeElement.click();
  check(!menu.querySelector('.editor-context-submenu').hidden,'submenu opens');
  check(document.activeElement.textContent.includes('Paste'),'submenu focus');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check(!document.querySelector('.editor-context-menu') && closed===1,'Escape closes');
  check(document.activeElement===anchor,'focus restored');
  anchor.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
  check(escaped===1,'capture listener removed');
  showEditorMenu(20,20,groups,()=>closed++);
  document.querySelector('.editor-context-menu button').click();
  check(ran===1 && closed===2,'action closes once and runs once');
  showEditorMenu(20,20,groups,()=>closed++);
  showEditorMenu(30,30,groups,()=>closed++);
  check(document.querySelectorAll('.editor-context-menu').length===1,'single menu instance');
  document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  check(!document.querySelector('.editor-context-menu'),'outside click closes');
  showEditorMenu(20,20,groups);
  menu = document.querySelector('.editor-context-menu');
  menu.dispatchEvent(new Event('scroll'));
  check(menu.isConnected,'scrolling menu root keeps menu open');
  menu.querySelector('.editor-context-submenu').dispatchEvent(new Event('scroll'));
  check(menu.isConnected,'scrolling nested menu keeps menu open');
  document.getElementById('anchor').dispatchEvent(new Event('scroll'));
  check(!menu.isConnected,'scrolling external element closes menu');
  showEditorMenu(20,20,groups);
  document.dispatchEvent(new Event('scroll'));
  check(!document.querySelector('.editor-context-menu'),'scrolling document closes menu');
  const ed = { isolation: null, sel: [{}], selectable: () => true,
    isolateSelection() { this.isolation = {}; }, leaveIsolation() { this.isolation = null; } };
  const t = (label) => label, close = () => {};
  type MenuItem = any;
  ${ui.slice(fillStart, fillEnd)}
  const list = h('div'), checks = [];
  let checked = false;
  fill(list, [${isolationRows}
    ['Checked', '', () => {}, () => checked]], checks);
  document.body.append(list);
  const refresh = () => checks.forEach((update) => update());
  const [enter, leave, toggle] = list.querySelectorAll('button');
  refresh();
  check(!enter.disabled && !leave.getClientRects().length && leave.hidden && leave.disabled,'inactive isolation hides leave');
  enter.click(); checked = true; refresh();
  check(!!ed.isolation && enter.disabled && !leave.hidden && !leave.disabled && !!leave.getClientRects().length,'enter shows leave on next menu open');
  check(toggle.querySelector('.check-mark').textContent === '✓','enabled/visible updates preserve checked menus');
  leave.click(); refresh();
  check(!ed.isolation && leave.hidden && !enter.disabled,'leave hides itself on next menu open');
  ed.sel = []; refresh(); check(enter.disabled && leave.hidden,'empty selection disables enter without showing leave');
  list.remove();
  closeEditorMenu(); document.removeEventListener('keydown',bubble);
  return {errors,ran,closed};
};
document.getElementById('anchor').addEventListener('click',()=>showEditorMenu(40,60,[[{id:'copy',label:'Copy',run(){}}]]));
`;
const result = await build({ absWorkingDir: root, stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true,
  write: false, format: 'esm', platform: 'browser', metafile: true });
for (const file of Object.keys(result.metafile.inputs)) {
  if (/src\/(main|editor|laser|machine|camera|cameraui|native)\.ts$/.test(file)) throw new Error('Forbidden fixture import: ' + file);
}
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'fixture.js'), result.outputFiles[0].contents);
writeFileSync(resolve(out, 'style.css'), readFileSync(resolve(root, 'src/style.css')));
writeFileSync(resolve(out, 'index.html'), `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; media-src 'none'; img-src 'none'">
<title>Isolated context-menu checks</title><link rel="stylesheet" href="style.css">
<button id="anchor">Menu fixture</button><script type="module" src="fixture.js"></script></html>`);
console.log('Isolated context menu fixture written to ' + out);
