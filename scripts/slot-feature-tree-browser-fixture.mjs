// node scripts/slot-feature-tree-browser-fixture.mjs; open the printed URL.
// Isolated real-DOM fixture: no application bootstrap, native APIs or hardware.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/slotFeatureTree.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser',
});
function tests() {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const selected = [], dropped = [];
  const tree = createSlotFeatureTree(value => selected.push(value), (...args) => dropped.push(args));
  document.body.append(tree.element);
  const recipe = {
    source: {}, base: [], groups: [{ id: 'g1', name: '<img src=x onerror=alert(1)>' }, { id: 'g2', name: 'Second group' }],
    slots: [{ id: 's1', groupId: 'g1' }, { id: 's2', groupId: 'g1' }, { id: 'orphan', groupId: 'missing' }],
    helpers: [{ id: 'h1', name: 'Construction line' }],
    order: [{ kind: 'group', id: 'g2' }, { kind: 'slot', id: 's2' }, { kind: 'group', id: 'g1' }, { kind: 'slot', id: 's1' }, { kind: 'slot', id: 's1' }, { kind: 'helper', id: 'absent' }],
  };
  const before = JSON.stringify(recipe);
  const row = id => [...tree.element.querySelectorAll('[role="treeitem"]')].find(el => el.dataset.id === id);
  const ids = () => [...tree.element.querySelectorAll('[role="treeitem"]')].map(el => el.dataset.id).join(',');
  tree.render(recipe, { kind: 'slot', id: 's2' }, new Set(['s1']));
  assert(ids() === 'g2,g1,s2,s1,orphan,h1', 'Order, nesting, orphan visibility and duplicate suppression');
  assert(!tree.element.querySelector('img'), 'Names must remain literal text');
  assert(row('g1').textContent === recipe.groups[0].name, 'Literal group name');
  assert(row('s2').parentElement.getAttribute('role') === 'group', 'Nested slots have group semantics');
  assert(row('g1').getAttribute('aria-owns') === row('s2').parentElement.id, 'Group owns nested slot container');
  assert(row('s1').getAttribute('aria-invalid') === 'true', 'Invalid state');
  assert(row('s2').getAttribute('aria-selected') === 'true' && row('s2').tabIndex === 0, 'Selected roving tabindex');
  assert([...tree.element.querySelectorAll('button')].filter(el => el.tabIndex === 0).length === 1, 'Single tab stop');
  row('s2').click();
  assert(selected.at(-1).id === 's2', 'Selection callback');
  tree.render(recipe, { kind: 'slot', id: 's2' });
  assert(document.activeElement === row('s2'), 'Focus survives render');
  const keyboard = key => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  keyboard('ArrowDown'); assert(selected.at(-1).id === 's1', 'Arrow down');
  keyboard('ArrowUp'); assert(selected.at(-1).id === 's2', 'Arrow up');
  keyboard('Home'); assert(selected.at(-1).id === 'g2', 'Home');
  keyboard('End'); assert(selected.at(-1).id === 'h1', 'End');
  const mime = 'application/x-kizamubeam-slot-feature';
  const drag = (target, type, transfer, y = 0) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y }));
  const transfer = new DataTransfer();
  drag(row('s1'), 'dragstart', transfer);
  assert(JSON.parse(transfer.getData(mime)).id === 's1', 'Private drag identity');
  drag(row('g2'), 'dragover', transfer, row('g2').getBoundingClientRect().top + 12);
  assert(row('g2').classList.contains('drop-into'), 'Drop preview');
  drag(row('g2'), 'drop', transfer, row('g2').getBoundingClientRect().top + 12);
  assert(dropped.at(-1)[0].id === 's1' && dropped.at(-1)[1].id === 'g2' && dropped.at(-1)[2] === 'into', 'Slot into group');
  assert(!row('g2').classList.contains('drop-into'), 'Drop clears preview');
  drag(row('s1'), 'dragstart', transfer);
  drag(row('s2'), 'drop', transfer);
  assert(dropped.at(-1)[1].id === 's2' && dropped.at(-1)[2] === 'before', 'Reorder before slot');
  drag(row('s1'), 'dragstart', transfer);
  drag(row('g2'), 'drop', transfer, row('g2').getBoundingClientRect().top + 1);
  assert(dropped.at(-1)[2] === 'before', 'Group top edge permits before');
  drag(row('s1'), 'dragstart', transfer); drag(tree.element, 'drop', transfer);
  assert(dropped.at(-1)[1] === null, 'Root drop');
  let count = dropped.length;
  for (const payload of ['bad json', 'null', '{"kind":"evil","id":"s1"}', '{"kind":"slot","id":42}', '{"kind":"slot","id":"missing"}']) {
    const bad = new DataTransfer(); bad.setData(mime, payload); drag(row('g1'), 'drop', bad);
  }
  assert(dropped.length === count, 'Malformed and absent identities rejected');
  drag(row('s1'), 'dragstart', transfer); drag(row('s1'), 'drop', transfer);
  assert(dropped.length === count, 'Self drop ignored');
  drag(row('s1'), 'dragstart', transfer);
  tree.render({ ...recipe, slots: recipe.slots.filter(slot => slot.id !== 's1') }, null);
  drag(row('g1'), 'drop', transfer);
  assert(dropped.length === count, 'Stale drag source rejected after render');
  assert(JSON.stringify(recipe) === before, 'No recipe mutation');
  const external = document.createElement('button'); document.body.append(external); external.focus();
  tree.render(recipe, null); assert(document.activeElement === external, 'Render never steals external focus');
  tree.dispose();
  count = selected.length; row('g1').click();
  assert(selected.length === count, 'Disposed listeners removed');
  const toggled = [], enhancedSelected = [], enhancedDrops = [];
  const enhanced = createSlotFeatureTree(value => enhancedSelected.push(value), (...args) => enhancedDrops.push(args), {
    onToggleVisibility: value => toggled.push(value),
  });
  document.body.append(enhanced.element);
  const enhancedRecipe = {
    ...recipe,
    helpers: [{ id: 'h1', name: '<unsafe helper>', groupId: 'g1' }],
    slots: [...recipe.slots, { id: 'mirror', groupId: 'g2', mirror: { slotId: 's1', axis: { kind: 'helper', helperId: 'h1' } } },
      { id: 'mirror2', mirror: { slotId: 'mirror', axis: { kind: 'edge', edge: 'edge-0' } } },
      { id: 'dangling', mirror: { slotId: 'missing', axis: { kind: 'edge', edge: 'edge-0' } } }],
  };
  const enhancedBefore = JSON.stringify(enhancedRecipe);
  const state = { hidden: new Set(['source:source', 'group:g1', 'slot:s1']), draftIds: new Set(['slot:s1', 'helper:h1']) };
  const enhancedRow = id => [...enhanced.element.querySelectorAll('[role="treeitem"][data-kind]')].find(el => el.dataset.id === id);
  const eye = id => enhancedRow(id).parentElement.querySelector('.slot-feature-visibility');
  enhanced.render(enhancedRecipe, { kind: 'slot', id: 's1' }, new Set(), state);
  assert(!row('source'), 'Legacy render has no body row');
  assert(enhancedRow('source').dataset.kind === 'source' && !enhancedRow('source').draggable, 'Body has independent non-draggable root');
  assert(enhanced.element.querySelectorAll('.slot-feature-visibility').length === enhanced.element.querySelectorAll('[role="treeitem"]').length, 'Every body/group/feature has an eye');
  assert(!enhanced.element.querySelector('button button'), 'Eye buttons are siblings, never nested buttons');
  assert(eye('source').getAttribute('aria-pressed') === 'false' && eye('s2').getAttribute('aria-pressed') === 'true', 'Scoped explicit visibility state');
  const branchFor = id => document.getElementById(enhancedRow(id).getAttribute('aria-owns'));
  assert(branchFor('s1').contains(enhancedRow('mirror')) && !branchFor('g2')?.contains(enhancedRow('mirror')), 'Mirror nested under parent irrespective of group');
  assert(branchFor('mirror').contains(enhancedRow('mirror2')), 'Chained mirrors nest recursively');
  assert(enhancedRow('dangling').getAttribute('aria-level') === '1', 'Dangling mirror remains visible');
  assert(enhancedRow('mirror').textContent.includes('mirror') && !enhancedRow('mirror').draggable, 'Mirror labeled and cannot be detached by drag');
  assert(!branchFor('g1').contains(enhancedRow('h1')) && enhancedRow('h1').getAttribute('aria-level') === '1', 'Construction helpers stay outside ALL feature groups');
  assert(enhancedRow('h1').textContent.includes('<unsafe helper>') && !enhanced.element.querySelector('unsafe'), 'Helper labels remain literal text');
  assert(enhancedRow('s1').dataset.draft === 'true' && enhancedRow('s1').querySelector('.slot-feature-draft').textContent.trim().length > 1, 'Draft has visible label and marker');
  enhancedRow('s2').click();
  enhanced.render(enhancedRecipe, { kind: 'slot', id: 's2' }, undefined, state);
  assert(enhancedRow('s1').dataset.draft === 'true' && enhancedRow('h1').dataset.draft === 'true', 'Draft markers survive tree selection');
  const selectionCount = enhancedSelected.length;
  eye('s1').click();
  assert(toggled.at(-1).kind === 'slot' && toggled.at(-1).id === 's1' && enhancedSelected.length === selectionCount, 'Eye toggles without selecting');
  eye('source').click();
  assert(toggled.at(-1).kind === 'source', 'Body eye callback');
  eye('h1').focus();
  enhanced.render(enhancedRecipe, { kind: 'slot', id: 's2' }, undefined, state);
  assert(document.activeElement === eye('h1'), 'Eye keyboard focus survives rerender');
  const eyeKey = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  eye('h1').dispatchEvent(eyeKey);
  assert(!eyeKey.defaultPrevented && enhancedSelected.length === selectionCount, 'Eye preserves native keyboard activation');
  drag(enhancedRow('mirror'), 'dragstart', transfer);
  const forgedMirror = new DataTransfer(); forgedMirror.setData(mime, JSON.stringify({ kind: 'slot', id: 'mirror' }));
  drag(enhancedRow('g2'), 'drop', forgedMirror, enhancedRow('g2').getBoundingClientRect().top + 12);
  assert(enhancedDrops.length === 0, 'Mirror group drops rejected, including forged payloads');
  const cycleRecipe = { ...enhancedRecipe, slots: [
    { id: 'a', mirror: { slotId: 'b' } }, { id: 'b', mirror: { slotId: 'a' } }, { id: 'self', mirror: { slotId: 'self' } },
  ] };
  enhanced.render(cycleRecipe, null, undefined, state);
  assert(['a', 'b', 'self'].every(id => enhanced.element.querySelectorAll(`[data-kind="slot"][data-id="${id}"]`).length === 1), 'Cycles terminate and every mirror appears exactly once');
  assert(JSON.stringify(enhancedRecipe) === enhancedBefore && state.hidden.size === 3 && state.draftIds.size === 2, 'Enhanced render never mutates recipe or state');
  enhanced.dispose();
  document.body.dataset.result = 'passed';
  const status = document.createElement('pre');
  status.textContent = 'PASS: ordering, root helpers, mirrors/cycles, body/feature eyes, drafts, literal names, ARIA, selection, keyboard, focus, drag/drop, malformed/stale identities, immutability, disposal.';
  document.body.append(status);
}
const html = `<!doctype html><meta charset="utf-8"><title>Slot feature tree isolated tests</title><script type="module">
import { createSlotFeatureTree } from '/tree.js';
try { (${tests})(); } catch (error) { document.body.dataset.result = 'failed'; document.body.textContent = error.stack; console.error(error); }
</script><body></body>`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/tree.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/tree.js' ? bundle.outputFiles[0].text : html);
});
server.listen(0, '127.0.0.1', () => console.log(`Slot feature tree fixture: http://127.0.0.1:${server.address().port}`));
