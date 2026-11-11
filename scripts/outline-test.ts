import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, newId, defaultLayer, IDENT, apply } = await import('../src/model');
const { outlinePlan, preciseOutlinePlan, outlineResult, outlineHoleAt } = await import('../src/outline');
const { flattenSub, SCALE } = await import('../src/clip');
const { segments } = await import('../src/curves');
const { outlineNetwork } = await import('../src/outlineNetwork');
const { outlineApproximation } = await import('../src/outlineApproximation');
const { buildGen, defaultParams } = await import('../src/generators');
const { GEAR } = await import('../src/generators/gear');
type Obj = import('../src/model').Obj;
type SubPath = import('../src/model').SubPath;
type E = import('../src/editor').Editor;
let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
const ring = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true,
  nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const path = (subs: SubPath[], layer = 0): Obj => ({ id: newId(), m: [...IDENT], layer, shape: { kind: 'path', subs } });
const rect = (x = 30, y = 30, w = 20, h = 20, layer = 0) => path([ring(x, y, w, h)], layer);
const line = (coords: number[][]) => path([{ closed: false, nodes: coords.map(([x, y]) => ({ x, y })) }]);
const area = (subs: SubPath[]) => Math.abs(subs.reduce((sum, s) => sum + s.nodes.reduce((a, p, i) => {
  const q = s.nodes[(i + 1) % s.nodes.length]; return a + (p.x * q.y - q.x * p.y) / 2;
}, 0), 0));
function editor(objects: Obj[]): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets:new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: false, snapObjects: false, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [], canvas: { style: {} } });
  ed.doc.objs = [...objects]; ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}

await test('default fills holes; click retains only chosen hole', () => {
  const p = outlinePlan([path([ring(0, 0, 100, 60), ring(10, 10, 10, 10), ring(60, 20, 20, 20)])]);
  assert.equal(area(outlineResult(p, new Set())), 6000); assert.equal(p.holes.length, 2);
  const first = outlineHoleAt(p, 15, 15); assert.ok(first >= 0);
  assert.equal(area(outlineResult(p, new Set([first]))), 5900);
  assert.equal(outlineHoleAt(p, -1, -1), -1);
});
await test('separate open objects collectively enclose an outline, without closing each object', async () => {
  const sources = [line([[0, 0], [100, 0]]), line([[100, 60], [100, 0]]),
    line([[100, 60], [0, 60]]), line([[0, 60], [0, 0]])];
  const ed = editor(sources), before = ed.state();
  const p = await ed.prepareOutline();
  assert.equal(p.plan.outer.length, 1); assert.equal(area(p.plan.outer), 6000);
  ed.applyOutline(p, new Set(), 1); assert.equal(ed.doc.objs.length, 5);
  ed.doUndo(); assert.equal(ed.state(), before);
});
await test('intersections and T junctions provide bounded faces, not implicit closing chords', () => {
  const p = outlinePlan([line([[-10, 0], [110, 0]]), line([[100, -10], [100, 70]]),
    line([[110, 60], [-10, 60]]), line([[0, 70], [0, -10]]), rect(20, 20, 10, 10)]);
  assert.equal(area(p.outer), 6000);
  assert.ok(outlineHoleAt(p, 25, 25) >= 0);
  assert.throws(() => outlinePlan([line([[0, 0], [100, 0], [100, 60], [0, 60]])]));
});
await test('open decoration does not invalidate a closed silhouette, gaps are not bridged', () => {
  const p = outlinePlan([rect(0, 0, 100, 60), line([[10, 10], [30, 30]])]);
  assert.equal(area(p.outer), 6000);
  assert.throws(() => outlinePlan([line([[0, 0], [100, 0], [100, 60], [0, 60], [0, 1]])]));
});
await test('explicit tolerance closes small gaps only on copies, including one open loop', async () => {
  const source = line([[0, 0], [100, 0], [100, 60], [0, 60], [0, 0.04]]);
  const ed = editor([source]), before = ed.state();
  const s = await ed.prepareOutline(0.01, true);
  assert.equal(s.plan.outer.length, 0); assert.equal(ed.state(), before);
  ed.updateOutline(s, 0.05);
  assert.equal(s.plan.outer.length, 1); assert.equal(area(s.plan.outer), 6000);
  assert.equal(ed.state(), before);
  ed.updateOutline(s, 0.01); assert.equal(s.plan.outer.length, 0);
  assert.throws(() => ed.updateOutline(s, NaN)); assert.equal(ed.state(), before);
  assert.throws(() => outlinePlan([source], 0.51));
});
await test('group transforms, duplicate edges and crossed open objects keep actual topology', () => {
  const lines = [line([[0, 0], [100, 0]]), line([[100, 0], [100, 60], [0, 60], [0, 0]]),
    line([[100, 0], [0, 0]]), line([[50, -10], [50, 70]])];
  const group: Obj = { id: newId(), m: [0, 1, -1, 0, 200, 100], layer: 0, shape: { kind: 'group', children: lines } };
  const before = JSON.stringify(group), p = outlinePlan([group]);
  assert.equal(p.outer.length, 1); assert.equal(area(p.outer), 6000);
  assert.equal(JSON.stringify(group), before);
});
await test('cross-layer union removes overlap edges without bridging disconnected exteriors', () => {
  const p = outlinePlan([rect(), rect(40, 30, 20, 20, 1), rect(100, 30, 20, 20, 2)]);
  assert.equal(p.outer.length, 2); assert.equal(area(p.outer), 1000); assert.equal(p.holes.length, 0);
});
await test('independent enclosed object can become a hole even if union would swallow it', () => {
  const p = outlinePlan([rect(0, 0, 100, 100), rect(20, 20, 20, 20, 1)]);
  assert.equal(p.holes.length, 1);
  assert.equal(area(outlineResult(p, new Set([outlineHoleAt(p, 30, 30)]))), 9600);
});
await test('nested hole and island can be selected independently', () => {
  const p = outlinePlan([path([ring(0, 0, 100, 100), ring(20, 20, 60, 60), ring(40, 40, 20, 20)])]);
  assert.equal(p.outer.length, 1); assert.equal(p.holes.length, 2);
  const annulus = outlineHoleAt(p, 25, 25), island = outlineHoleAt(p, 45, 45);
  assert.notEqual(annulus, island); assert.ok(annulus >= 0 && island >= 0);
  assert.equal(area(outlineResult(p, new Set([annulus]))), 6800);
  assert.equal(area(outlineResult(p, new Set([annulus, island]))), 6400);
});
await test('network mode preserves separate nested annulus and island choices', () => {
  const p = outlinePlan([path([ring(0, 0, 100, 100), ring(20, 20, 60, 60), ring(40, 40, 20, 20)]),
    line([[5, 5], [10, 10]])]);
  const annulus = outlineHoleAt(p, 25, 25), island = outlineHoleAt(p, 45, 45);
  assert.equal(p.holes.length, 2); assert.notEqual(annulus, island);
  assert.equal(area(outlineResult(p, new Set([annulus]))), 6800);
  assert.equal(area(outlineResult(p, new Set([annulus, island]))), 6400);
});
await test('overlapping enclosed regions form exclusive selectable faces', () => {
  const p = outlinePlan([rect(0, 0, 100, 100), rect(10, 10, 30, 20), rect(30, 10, 30, 20)]);
  assert.equal(p.holes.length, 3);
  const chosen = new Set([outlineHoleAt(p, 15, 15), outlineHoleAt(p, 35, 15), outlineHoleAt(p, 55, 15)]);
  assert.equal(chosen.size, 3); assert.equal(area(outlineResult(p, chosen)), 9000);
});
await test('areas touching the exterior cannot be mistaken for interior holes', () => {
  const p = outlinePlan([rect(0, 0, 100, 100), rect(0, 10, 20, 20)]);
  assert.equal(p.holes.length, 0);
});
await test('rotation, reversed winding and input data remain unchanged', () => {
  const source = path([ring(0, 0, 100, 60), ring(10, 10, 20, 20)]);
  source.m = [0, -1, 1, 0, 7, 200];
  if (source.shape.kind === 'path') source.shape.subs.forEach((s) => s.nodes.reverse());
  const before = JSON.stringify(source), p = outlinePlan([source]);
  assert.equal(area(p.outer), 6000); assert.equal(area(outlineResult(p, new Set([0]))), 5600);
  assert.equal(JSON.stringify(source), before);
});
await test('curved contours are bounded closed approximations', () => {
  const source = rect(); source.shape = { kind: 'ellipse', rx: 20, ry: 10 };
  const p = outlinePlan([source]); assert.ok(Math.abs(area(p.outer) - Math.PI * 200) < 2);
  assert.ok(p.outer.every((s) => s.closed && s.nodes.length > 3));
});
await test('closed two-node Bezier contours are accepted without changing their source', async () => {
  const source = path([{ closed: true, nodes: [
    { x: 0, y: 0, cout: { x: 10, y: -10 }, cin: { x: 10, y: 10 } },
    { x: 20, y: 0, cin: { x: 10, y: -10 }, cout: { x: 10, y: 10 } }] }]);
  const ed = editor([source]), before = ed.state();
  const session = await ed.prepareOutline(); assert.ok(area(session.plan.outer) > 100); assert.equal(ed.state(), before);
});
await test('work cap and invalid hole IDs reject rather than silently changing result', () => {
  assert.throws(() => outlinePlan(Array.from({ length: 33 }, () => rect())));
  assert.throws(() => outlineResult(outlinePlan([rect()]), new Set([0])));
});
await test('keep originals default is immutable, explicit output layer, exact Undo/Redo', async () => {
  const a = rect(), b = rect(40, 30, 20, 20, 1), ed = editor([a, b]), before = ed.state();
  const s = await ed.prepareOutline(); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
  const original = JSON.stringify([a, b]), result = ed.applyOutline(s, new Set(), 2);
  assert.equal(ed.doc.objs.length, 3); assert.equal(result.layer, 2);
  assert.equal(JSON.stringify([a, b]), original); assert.equal(ed.history.position, 1);
  const after = ed.state(); ed.doUndo(); assert.equal(ed.state(), before); ed.doRedo(); assert.equal(ed.state(), after);
});
await test('replacement requires explicit confirmation and is one exact Undo step', async () => {
  const ed = editor([rect(), rect(40)]), before = ed.state(), s = await ed.prepareOutline();
  assert.throws(() => ed.applyOutline(s, new Set(), 0, false)); assert.equal(ed.state(), before);
  ed.applyOutline(s, new Set(), 0, false, true); assert.equal(ed.doc.objs.length, 1); assert.equal(ed.history.position, 1);
  ed.doUndo(); assert.equal(ed.state(), before);
});
await test('parametric source survives keep; replacement undo restores exact parameters', async () => {
  const generated = buildGen(GEAR, defaultParams(GEAR));
  const source: Obj = { id: newId(), m: [1, 0, 0, 1, 100, 100], layer: 0, name: 'Gear', shape: generated.parts[0].shape };
  const ed = editor([source]), original = JSON.stringify(source), before = ed.state();
  ed.applyOutline(await ed.prepareOutline(), new Set(), 0); assert.equal(JSON.stringify(source), original);
  ed.doUndo(); assert.equal(ed.state(), before);
  ed.applyOutline(await ed.prepareOutline(), new Set(), 0, false, true); assert.equal(ed.doc.objs.length, 1);
  ed.doUndo(); assert.equal(ed.state(), before);
});
await test('unbounded paths, images, hidden group members and locked targets refuse without edits', async () => {
  for (const change of [(a: Obj) => { if (a.shape.kind === 'path') a.shape.subs[0].closed = false; },
    (a: Obj) => { a.shape = { kind: 'image', asset: 'no-load', w: 20, h: 20, adjust: {} } as Obj['shape']; },
    (a: Obj) => { a.shape = { kind: 'group', children: [{ ...rect(), hidden: true }] }; }]) {
    const a = rect(); change(a); const ed = editor([a]), before = ed.state();
    await assert.rejects(() => ed.prepareOutline()); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
  }
  const ed = editor([rect()]); ed.doc.layers[2] = { ...defaultLayer(2), locked: true };
  const s = await ed.prepareOutline(), before = ed.state();
  assert.throws(() => ed.applyOutline(s, new Set(), 2)); assert.equal(ed.state(), before);
});
await test('disabled source output is never implicitly enabled by selecting another layer', async () => {
  for (const sourceDisabled of [true, false]) {
    const a = rect(), ed = editor([a]);
    if (sourceDisabled) a.noLaser = true; else ed.doc.layers[0] = { ...defaultLayer(0), output: false };
    const result = ed.applyOutline(await ed.prepareOutline(), new Set(), 1);
    assert.equal(result.noLaser, true);
  }
});
await test('stale document, selection, tool and geometry reject previews', async () => {
  for (const change of [(ed: E) => ed.setSel([]), (ed: E) => { ed.doc = newDoc(); },
    (ed: E) => ed.setTool('node'), (ed: E) => { ed.sel[0].m[4]++; }]) {
    const ed = editor([rect()]), s = await ed.prepareOutline(); change(ed); const before = ed.state();
    assert.throws(() => ed.applyOutline(s, new Set(), 0)); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
  }
});
await test('async preparation rejects changed source before showing a preview', async () => {
  const ed = editor([rect()]); let finish!: (objs: Obj[]) => void;
  ed.withTextOutlines = () => new Promise<Obj[]>((resolve) => { finish = resolve; });
  const source = [...ed.sel], pending = ed.prepareOutline(); ed.setSel([]); finish(source);
  await assert.rejects(() => pending); assert.equal(ed.history.position, 0);
});
await test('new outline joins active isolation without adopting existing outsiders', async () => {
  const a = rect(), b = rect(100), ed = editor([a]); ed.doc.objs.push(b); ed.isolateSelection();
  const result = ed.applyOutline(await ed.prepareOutline(), new Set(), 0);
  assert.deepEqual(ed.viewObjects(), [a, result]); assert.equal(ed.selectable(b), false);
});
await test('three extraction modes distinguish exterior, exterior with islands, and islands only', () => {
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20),ring(60,60,10,10)])]);
  const all=new Set(p.holes.map((_,i)=>i));
  assert.equal(p.holes.length,2);assert.equal(p.outerError,false);assert.deepEqual(p.islandErrors,[false,false]);
  assert.equal(area(outlineResult(p,all,'outer')),10000);
  assert.equal(area(outlineResult(p,all,'combined')),9500);
  assert.equal(area(outlineResult(p,all,'islands')),500);
  assert.deepEqual(outlineResult(p,new Set(),'islands'),[]);
  assert.throws(()=>outlineResult(p,all,'wrong' as 'outer'));
});
await test('precision extraction restores original Bezier controls instead of polygonal chords', () => {
  const curve:SubPath={closed:true,nodes:[
    {x:20,y:20,cout:{x:30,y:5},cin:{x:30,y:35}},
    {x:40,y:20,cin:{x:30,y:5},cout:{x:30,y:35}}]};
  const source=path([ring(0,0,100,100),curve]);
  for(const matrix of [[...IDENT],[0,1,-1,0,120,5],[-1,.2,.1,1.5,120,5]] as import('../src/model').Mat[])for(const tolerance of [0,.01,.05,.2]){
    source.m=matrix;const before=JSON.stringify(source);
    const p=preciseOutlinePlan([source],tolerance);
    const result=outlineResult(p,new Set([0]),'islands');
    assert.equal(result.length,1);assert.equal(result[0].closed,true);
    const world:SubPath={...curve,nodes:curve.nodes.map(n=>({...apply(matrix,n.x,n.y),cin:apply(matrix,n.cin!.x,n.cin!.y),cout:apply(matrix,n.cout!.x,n.cout!.y)}))};
    const expected=segments(world),actual=segments(result[0]);assert.equal(actual.length,2);
    const close=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)<1e-8;
    for(const e of expected)assert.ok(actual.some(q=>close(q.a,e.a)&&close(q.b,e.b)&&close(q.c1,e.c1)&&close(q.c2,e.c2)||close(q.b,e.a)&&close(q.a,e.b)&&close(q.c2,e.c1)&&close(q.c1,e.c2)));
    assert.equal(JSON.stringify(source),before);
  }
});
await test('tolerance adds an explicit bounded bridge without moving the final source segment', () => {
  const source=line([[0,0],[10,0],[10,10],[0,10],[.04,.04]]),before=JSON.stringify(source);
  assert.equal(preciseOutlinePlan([source],.01,true).outer.length,0);
  const p=preciseOutlinePlan([source],.06),result=outlineResult(p,new Set(),'outer');
  assert.equal(p.connections?.length,1);assert.equal(result.length,1);
  assert.ok(result[0].nodes.some(n=>n.x===.04&&n.y===.04));
  assert.ok(segments(result[0]).some(s=>s.a.x===0&&s.a.y===10&&s.b.x===.04&&s.b.y===.04||s.b.x===0&&s.b.y===10&&s.a.x===.04&&s.a.y===.04));
  assert.equal(JSON.stringify(source),before);
});
await test('precision mode preserves nested annulus and inner island as separate selectable regions', () => {
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(20,20,60,60),ring(40,40,20,20)])]);
  assert.equal(p.holes.length,2);
  const annulus=outlineHoleAt(p,25,25),island=outlineHoleAt(p,45,45);
  assert.notEqual(annulus,island);
  assert.equal(area(outlineResult(p,new Set([annulus]),'islands')),3200);
  assert.equal(area(outlineResult(p,new Set([island]),'islands')),400);
});
await test('tiny real islands are not dropped by an area threshold', () => {
  const p=preciseOutlinePlan([path([ring(0,0,10,10),ring(1,1,.02,.02)])]);
  assert.equal(p.holes.length,1);
  assert.ok(Math.abs(area(outlineResult(p,new Set([0]),'islands'))-.0004)<1e-10);
});
await test('equal-distance tolerance targets are exposed rather than arbitrarily chosen', () => {
  const sources=[rect(0,0,40,40),line([[10,10],[10,15]]),line([[5,9.96],[15,9.96]]),line([[5,10.04],[15,10.04]])];
  const before=JSON.stringify(sources),network=outlineNetwork(sources,.05,true);
  assert.ok(network.ambiguousJoins?.some(p=>p.X===10000&&p.Y===10000));
  assert.ok(!network.paths.filter(p=>p.connection).some(p=>p.points.some(q=>q.X===10000&&q.Y===10000)));
  assert.equal(JSON.stringify(sources),before);
});
await test('precise endpoint joins do not depend on coordinate ordering or reflection', () => {
  for(const flip of [false,true]) {
    const sources=[rect(20,20,10,10),line([[19.96,20],[10,10]])];
    if(flip)for(const source of sources)source.m=[-1,0,0,1,60,0];
    const network=outlineNetwork(sources,.05,true);
    assert.equal(network.paths.filter(p=>p.connection).length,1);
  }
});
await test('short source edges lost by integer-grid detection are restored, not deleted', () => {
  const source=path([{closed:true,nodes:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20},{x:10,y:19.9992}]}]);
  const p=preciseOutlinePlan([source]),result=outlineResult(p,new Set(),'outer');
  assert.ok(result[0].nodes.some(n=>n.x===10&&n.y===19.9992));
  assert.ok(result[0].nodes.some(n=>n.x===10&&n.y===20));
});
await test('ambiguity blocks only affected requested output, never silently substitutes a polygon', () => {
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20),ring(60,60,10,10)])]);
  p.islandErrors![0]=true;
  assert.throws(()=>outlineResult(p,new Set([0]),'islands'),/outline-boundary/);
  assert.equal(outlineResult(p,new Set([1]),'islands').length,1);
  p.outerError=true;
  assert.throws(()=>outlineResult(p,new Set([1]),'combined'),/outline-boundary/);
  assert.equal(outlineResult(p,new Set([1]),'islands').length,1);
});
function makeApproximateCandidate(p:import('../src/outline').OutlinePlan,index:number,sub:number){
  p.islandErrors![index]=true;p.approximationEligible![index]=true;
  const polygon=p.holes[index].subs[0].nodes.map(n=>`${Math.round(n.x*SCALE)}:${Math.round(n.y*SCALE)}`).join('|');
  p.boundaryCache!.delete(polygon);
  // Simulate an untraceable source interval while keeping the independently
  // detected polygon. No private project geometry is embedded in this fixture.
  p.network!.edges=p.network!.edges.filter(e=>!e.sources.some(s=>p.network!.paths[s.path].sub===sub));
}
await test('approximation validates closed simple regions and retains tiny real polygons',()=>{
  for(const boundaries of [[ring(0,0,10,10)],[ring(0,0,10,10),ring(2,2,1,1)],[ring(0,0,.02,.02)]]){
    const before=JSON.stringify(boundaries);assert.ok(outlineApproximation({layer:0,subs:boundaries}));assert.equal(JSON.stringify(boundaries),before);
  }
});
await test('approximation refuses open, degenerate, self-crossing, touching and malformed boundaries',()=>{
  const invalid:SubPath[][]=[
    [{...ring(0,0,10,10),closed:false}],
    [{closed:true,nodes:[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]}],
    [{closed:true,nodes:[{x:0,y:0},{x:10,y:0},{x:5,y:0},{x:10,y:10},{x:0,y:10}]}],
    [ring(0,0,10,10),ring(0,2,1,1)],
    [ring(0,0,10,10),ring(20,20,1,1)],
    [{closed:true,nodes:[{x:NaN,y:0},{x:10,y:0},{x:0,y:10}]}],
    [{closed:true,nodes:[{x:0,y:0,cout:{x:1,y:1}},{x:10,y:0},{x:0,y:10}]}],
  ];
  for(const boundaries of invalid)assert.equal(outlineApproximation({layer:0,subs:boundaries}),null);
});
await test('only an individually approved untraceable island may fall back to its detected closed polyline',()=>{
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20)])]);makeApproximateCandidate(p,0,1);
  assert.throws(()=>outlineResult(p,new Set([0]),'islands'),/outline-boundary/);
  const result=outlineResult(p,new Set([0]),'islands',new Set([0]));
  assert.equal(result.length,1);assert.equal(result[0].closed,true);assert.equal(area(result),400);
  assert.ok(result[0].nodes.every(n=>!n.cin&&!n.cout));
  assert.throws(()=>outlineResult(p,new Set(),'islands',new Set([0])),/outline-selection/);
});
await test('approving one island cannot approximate an unresolved exterior or an invalid polygon',()=>{
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20)])]);makeApproximateCandidate(p,0,1);
  p.outerError=true;
  assert.throws(()=>outlineResult(p,new Set([0]),'combined',new Set([0])),/outline-boundary/);
  p.holes[0].subs[0].closed=false;
  assert.throws(()=>outlineResult(p,new Set([0]),'islands',new Set([0])),/outline-approximation-unsafe/);
});
await test('mixing a disjoint approximation with an exact curved island preserves the latter Beziers',()=>{
  const curve:SubPath={closed:true,nodes:[{x:60,y:60,cout:{x:70,y:45},cin:{x:70,y:75}},{x:80,y:60,cin:{x:70,y:45},cout:{x:70,y:75}}]};
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20),curve])]);
  const index=outlineHoleAt(p,15,15),other=outlineHoleAt(p,70,60);assert.notEqual(index,other);
  makeApproximateCandidate(p,index,1);
  const result=outlineResult(p,new Set([index,other]),'islands',new Set([index]));
  assert.equal(result.length,2);assert.ok(result.some(s=>s.nodes.some(n=>n.cin||n.cout)));
  assert.ok(result.some(s=>s.nodes.every(n=>!n.cin&&!n.cout)));
});
await test('approved approximation round-trips as ordinary durable path geometry',async()=>{
  const {loadDoc}=await import('../src/model');
  const source=path([ring(0,0,100,100),ring(10,10,20,20)]),ed=editor([source]),s=await ed.prepareOutline();
  makeApproximateCandidate(s.plan,0,1);
  const result=ed.applyOutline(s,new Set([0]),0,true,false,'islands',{islands:new Set([0]),confirmed:true});
  assert.equal(result.name,'Inselkonturen (mit Näherung)');
  const reopened=loadDoc(JSON.parse(JSON.stringify(ed.doc)));
  assert.deepEqual(reopened.objs.find(o=>o.id===result.id)!.shape,result.shape);
  assert.equal(reopened.objs.find(o=>o.id===result.id)!.name,result.name);
});
await test('approximation cannot silently absorb a neighboring exact island into a merged replacement',()=>{
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20),ring(30,10,20,20)])]);
  assert.equal(p.holes.length,2);makeApproximateCandidate(p,0,1);
  assert.throws(()=>outlineResult(p,new Set([0,1]),'islands',new Set([0])),/outline-boundary/);
});
await test('approximation information suffices for editor Apply while Undo restores exact originals',async()=>{
  const source=path([ring(0,0,100,100),ring(10,10,20,20)]),ed=editor([source]),before=ed.state();
  const s=await ed.prepareOutline();makeApproximateCandidate(s.plan,0,1);
  assert.equal(ed.state(),before);assert.equal(ed.history.position,0);
  const result=ed.applyOutline(s,new Set([0]),0,true,false,'islands',{islands:new Set([0])});
  assert.equal(result.shape.kind,'path');assert.equal(ed.doc.objs[0],source);
  assert.equal(area((result.shape as {subs:SubPath[]}).subs),400);
  ed.doUndo();assert.equal(ed.state(),before);
});
await test('batched precision-region union matches the preceding sequential union for every subset and output mode',async()=>{
  const ClipperLib=(await import('clipper-lib')).default;
  const {execute}=await import('../src/clip');
  for(const boundaries of [
    [ring(0,0,100,100),ring(10,10,10,10),ring(40,40,20,20),ring(70,70,10,10)],
    [ring(0,0,100,100),ring(20,20,60,60),ring(40,40,20,20)],
    [ring(0,0,100,100),ring(10,10,30,20),ring(30,10,30,20)],
  ]){
    const p=preciseOutlinePlan([path(boundaries)]),legacy={...p,network:undefined};
    for(let bits=0;bits<2**p.holes.length;bits++)for(const mode of ['outer','combined','islands'] as const){
      const selected=new Set(p.holes.flatMap((_,i)=>bits&(1<<i)?[i]:[]));
      const a=outlineResult(p,selected,mode).map(s=>flattenSub(s,IDENT)),b=outlineResult(legacy,selected,mode).map(s=>flattenSub(s,IDENT));
      const difference=execute(ClipperLib.ClipType.ctXor,a,b,ClipperLib.PolyFillType.pftNonZero);
      assert.equal(difference.length,0);
    }
  }
});
await test('boundary search and negative-result caches do not survive replacement of their network edges',()=>{
  const p=preciseOutlinePlan([path([ring(0,0,100,100),ring(10,10,20,20)])]),edges=p.network!.edges;
  p.boundaryCache!.clear();p.network!.edges=[];
  assert.throws(()=>outlineResult(p,new Set([0]),'islands'),/outline-boundary/);
  p.network!.edges=edges;
  assert.equal(area(outlineResult(p,new Set([0]),'islands')),400);
});
console.log(`Outline: ${count} checks passed without application/hardware startup.`);
if (process.argv[3]) {
  // Optional, read-only acceptance check for the user's frame_test.kzb;
  // the private drawing is deliberately not bundled into regression fixtures.
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { loadDoc } = await import('../src/model');
  const doc = loadDoc(JSON.parse(readFileSync(process.argv[3], 'utf8')));
  const sources = doc.objs.filter(o => o.id >= 154 && o.id <= 158);
  assert.deepEqual(sources.map(o => o.id), [154, 155, 156, 157, 158]);
  const before = JSON.stringify(sources), ed = editor(sources);
  for (const tolerance of [0.01, 0.05, 0.1, 0.2, 0.25]) {
    const plan = outlinePlan(sources, tolerance);
    console.log(JSON.stringify({ tolerance, outer: plan.outer.length, holes: plan.holes.length, looseEnds: plan.looseEnds, area: area(plan.outer) }));
  }
  const session = await ed.prepareOutline(0.2);
  assert.equal(JSON.stringify(sources), before);
  assert.equal(session.plan.outer.length, 1);
  const sampled=outlineResult(session.plan,new Set(),'outer').map(s=>flattenSub(s,IDENT));
  const sampledArea=Math.abs(sampled.reduce((sum,p)=>sum+p.reduce((a,v,i)=>{const q=p[(i+1)%p.length];return a+v.X*q.Y-q.X*v.Y},0),0))/(2*SCALE*SCALE);
  assert.ok(Math.abs(sampledArea - 1784.6455) < .02,`sampled area ${sampledArea}`);
  assert.ok(session.plan.outer.every(s => s.closed));
  console.log(JSON.stringify({ file: process.argv[3], ids: sources.map(o => o.id), outer: session.plan.outer.length,
    holes: session.plan.holes.length, area: area(session.plan.outer), points: session.plan.outer.map(s => s.nodes.length) }));
  if (process.argv[4]) {
    const { objectPaths } = await import('../src/ops');
    const ps = sources.flatMap(o => { const p = objectPaths(o); return [...p.closed, ...p.open]; });
    const all = ps.flat(), x = Math.min(...all.map(p => p.X)) / 1000, y = Math.min(...all.map(p => p.Y)) / 1000;
    const w = Math.max(...all.map(p => p.X)) / 1000 - x, h = Math.max(...all.map(p => p.Y)) / 1000 - y;
    const d = session.plan.outer.map(s => 'M' + s.nodes.map(p => `${p.x},${p.y}`).join('L') + 'Z').join('');
    const lines = ps.map(p => `<polyline points="${p.map(q => `${q.X / 1000},${q.Y / 1000}`).join(' ')}"/>`).join('');
    writeFileSync(process.argv[4], `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="${x-1} ${y-1} ${w+2} ${h+2}"><rect x="${x-1}" y="${y-1}" width="${w+2}" height="${h+2}" fill="#20252c"/><path d="${d}" fill="#405c7c" stroke="#00ffaa" stroke-width="0.12"/><g fill="none" stroke="white" stroke-width="0.05">${lines}</g></svg>`);
  }
}
