import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { defaultLayer, newDoc, Node, Obj, Pt } from '../src/model';
import { curvaturePreview, smoothAnchors } from '../src/editor/vector';
import { draftHandleMarks } from '../src/editor/render';
import { DEFAULT_GRID } from '../src/grid';

type Mat6 = [number, number, number, number, number, number];
class MockPath2D {
  ops: { op: string; args: number[] }[] = [];
  moveTo(x: number, y: number) { this.ops.push({ op: 'moveTo', args: [x, y] }); }
  lineTo(x: number, y: number) { this.ops.push({ op: 'lineTo', args: [x, y] }); }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number) { this.ops.push({ op: 'bezierCurveTo', args: [a, b, c, d, e, f] }); }
  closePath() { this.ops.push({ op: 'closePath', args: [] }); }
  rect(x: number, y: number, w: number, h: number) { this.ops.push({ op: 'rect', args: [x, y, w, h] }); }
  addPath(other: MockPath2D) { if (other?.ops) this.ops.push(...other.ops); }
}
class MockDOMMatrix {
  a: number; b: number; c: number; d: number; e: number; f: number;
  constructor(m: number[] = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = m; }
}
const g = globalThis as Record<string, unknown>;
g.Path2D ??= MockPath2D;
g.DOMMatrix ??= MockDOMMatrix;

let count=0;const test=(name:string,f:()=>void)=>{f();count++;console.log('PASS '+name)};
function editor(){
  const ed=Object.create(Editor.prototype) as Editor;
  Object.assign(ed,{doc:newDoc(),currentLayer:0,sel:[],tool:'curvature',draft:null,continuedFrom:null,drag:null,nodeSets:new Map(),segmentSets:new Map(),handleSets:new Map(),nodeSel:new Set(),history:new History(),batching:false,
    view:{zoom:1,ox:0,oy:0},canvas:{width:800,height:600,style:{},getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){}},dpr:1,grid:{...DEFAULT_GRID,show:false},filled:false,dark:false,centerMarks:'off',
    cursor:{x:0,y:0},snapHit:null,alignGuides:[],nodeEditObj:null,nodeHover:null,segHover:null,jointPicks:[],jointHover:null,jointHingeMode:false,
    trimHover:null,startHover:null,relPicks:[],relHover:null,measure:null,measureCircle:null,sketchEdit:null,builderSession:null,
    isolation:null,vectorPreview:null,hingePreview:null,patternPreview:null,outlinePreview:null,offsetPreview:null,arrayPreview:null,
    arrayCenter:null,laserPos:null,checkMarks:false,checkIssues:[],checkActive:null,overlapHover:null,pivot:null,rotateMode:false});
  ed.doc.layers[0]=defaultLayer(0);ed.emit=()=>{};ed.redraw=()=>{};return ed;
}
function mockCtx(){
  let cur: Mat6 = [1, 0, 0, 1, 0, 0];
  const stack: Mat6[] = [];
  const calls: { op: string; mat: Mat6; args: unknown[]; strokeStyle: string; fillStyle: string; lineWidth: number }[] = [];
  const rec = (op: string, ...args: unknown[]) => calls.push({ op, mat: [...cur] as Mat6, args, strokeStyle: String(ctx.strokeStyle), fillStyle: String(ctx.fillStyle), lineWidth: Number(ctx.lineWidth) });
  const ctx = {
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    save() { stack.push([...cur] as Mat6); },
    restore() { cur = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { cur = [a, b, c, d, e, f]; },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      const [m0, m1, m2, m3, m4, m5] = cur;
      cur = [m0 * a + m2 * b, m1 * a + m3 * b, m0 * c + m2 * d, m1 * c + m3 * d, m0 * e + m2 * f + m4, m1 * e + m3 * f + m5];
    },
    translate(x: number, y: number) { ctx.transform(1, 0, 0, 1, x, y); },
    scale(sx: number, sy: number) { ctx.transform(sx, 0, 0, sy, 0, 0); },
    rotate(a: number) { ctx.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); },
    setLineDash() {},
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) { rec('moveTo', x, y); },
    lineTo(x: number, y: number) { rec('lineTo', x, y); },
    rect(x: number, y: number, w: number, h: number) { rec('rect', x, y, w, h); },
    arc(x: number, y: number, r: number, a0: number, a1: number) { rec('arc', x, y, r, a0, a1); },
    fillRect(x: number, y: number, w: number, h: number) { rec('fillRect', x, y, w, h); },
    strokeRect(x: number, y: number, w: number, h: number) { rec('strokeRect', x, y, w, h); },
    fill() { rec('fill'); },
    stroke(p?: MockPath2D) { rec('stroke', p); },
    fillText() {},
    measureText(s: string) { return { width: s.length * 6 }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const keyEv=(key:string)=>({key,code:key,preventDefault(){},target:{tagName:'CANVAS'},ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false,defaultPrevented:false} as unknown as KeyboardEvent);
const finite=(nodes:{x:number;y:number;cin?:{x:number;y:number};cout?:{x:number;y:number}}[])=>
  nodes.every((n)=>Number.isFinite(n.x+n.y) && (!n.cin || Number.isFinite(n.cin.x+n.cin.y)) && (!n.cout || Number.isFinite(n.cout.x+n.cout.y)));
const nearPt=(a:Pt,b:Pt,eps=1e-9)=>Math.abs(a.x-b.x)<eps && Math.abs(a.y-b.y)<eps;

test('smoothAnchors interpolates open anchors without dangling end handles',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:0},{x:20,y:10}],false);
  assert.equal(out.length,3);assert.ok(finite(out));
  assert.equal(out[0].cin,undefined);assert.ok(out[0].cout);
  assert.ok(out[1].cin && out[1].cout && out[1].smooth);
  assert.ok(out[2].cin);assert.equal(out[2].cout,undefined);
});
test('two anchors stay straight',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:5}],false);
  assert.equal(out.length,2);assert.equal(out[0].cout,undefined);assert.equal(out[1].cin,undefined);
});
test('duplicate points guard against NaN',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:0,y:0},{x:10,y:0}],false);
  assert.ok(finite(out));
});
test('smoothAnchors deep-clones handles without mutating input draft nodes',()=>{
  const src:Node[]=[{x:0,y:0},{x:10,y:0,cin:{x:6,y:0},cout:{x:14,y:0}},{x:20,y:10}];
  const out=smoothAnchors(src,false);
  out[1].cout!.x=99;
  assert.deepEqual(src[1].cout,{x:14,y:0});
});
test('single manual handle survives and fills missing neighbor arm collinearly',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:0,cout:{x:14,y:0}},{x:20,y:10}],false);
  assert.deepEqual(out[1].cout,{x:14,y:0});
  assert.ok(out[1].cin && nearPt(out[1].cin,{x:10-10/3,y:0}));
  assert.equal(out[1].smooth,true);
});
test('auto handles scale proportionally to each adjacent span (like setNodeType)',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:0},{x:310,y:0}],false);
  assert.ok(out[1].cin && nearPt(out[1].cin,{x:10-10/3,y:0}));
  assert.ok(out[1].cout && nearPt(out[1].cout,{x:10+300/3,y:0}));
});
test('manual drag handles are preserved without clamping',()=>{
  const out=smoothAnchors([{x:0,y:0},{x:10,y:0,cout:{x:22,y:16},cin:{x:-2,y:-16}},{x:20,y:0}],false);
  assert.deepEqual(out[1].cout,{x:22,y:16});
  assert.deepEqual(out[1].cin,{x:-2,y:-16});
});
test('finishCurvature commits free manual handles unchanged',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0,cout:{x:22,y:16},cin:{x:-2,y:-16}},{x:20,y:0}],closed:false};ed.finishCurvature();
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.deepEqual(shape.subs[0].nodes[1].cout,{x:22,y:16});
  assert.deepEqual(shape.subs[0].nodes[1].cin,{x:-2,y:-16});
});
test('finishCurvature commits smoothed path with one Undo',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};ed.finishCurvature();
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.draft,null);assert.equal(ed.history.position,1);assert.equal(ed.sel.length,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs.length,1);assert.ok(finite(shape.subs[0].nodes));assert.ok(shape.subs[0].nodes[1].smooth);
});
test('closed draft wraps tangents and stays closed',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:5,y:8}],closed:true};ed.finishCurvature();
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
  assert.ok(shape.subs[0].nodes.every((n)=>n.cin && n.cout));
});
test('short draft discarded without Undo',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0}],closed:false};ed.finishCurvature();
  assert.equal(ed.doc.objs.length,0);assert.equal(ed.history.position,0);assert.equal(ed.draft,null);
});
test('undo restores empty doc',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};ed.finishCurvature();
  ed.doUndo();assert.equal(ed.doc.objs.length,0);
});
test('backspace pops last anchor during draw and delete does not delete selection',()=>{
  const ed=editor();
  ed.sel=[{id:99,m:[1,0,0,1,0,0],layer:0,shape:{kind:'rect',w:10,h:10,r:0}}];
  ed.doc.objs=[...ed.sel];
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  ed.onKey(keyEv('Delete'));
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.draft!.nodes.length,2);
  ed.onKey(keyEv('Backspace'));
  assert.equal(ed.draft!.nodes.length,1);
  ed.onKey(keyEv('Backspace'));
  assert.equal(ed.draft,null);assert.equal(ed.doc.objs.length,1);
});
test('escape discards draft without Undo',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  ed.onKey(keyEv('Escape'));
  assert.equal(ed.draft,null);assert.equal(ed.doc.objs.length,0);assert.equal(ed.history.position,0);
});
test('escape during linenode drag removes aborted node without leaving partial point',()=>{
  const ed=editor();
  const n0:Node={x:0,y:0},n1:Node={x:10,y:0,cout:{x:15,y:5},cin:{x:5,y:-5},smooth:true};
  ed.draft={nodes:[n0,n1],closed:false};
  ed.drag={type:'linenode',node:n1};
  ed.onKey(keyEv('Escape'));
  assert.equal(ed.drag,null);assert.equal(ed.draft!.nodes.length,1);assert.equal(ed.draft!.nodes[0],n0);
  ed.drag={type:'linenode',node:n0};
  ed.onKey(keyEv('Escape'));
  assert.equal(ed.draft,null);
});
test('setPage finishes curvature draft with finishCurvature instead of finishLine',()=>{
  const ed=editor();
  ed.doc.pages.push({name:'Page 2',objs:[]});
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};
  ed.setPage(1);
  assert.equal(ed.doc.page,1);
  const shape=ed.doc.pages[0].objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.ok(shape.subs[0].nodes[1].smooth && shape.subs[0].nodes[1].cout);
});
test('right-click commits smoothed path',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};ed.rightPress();
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.history.position,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.ok(shape.subs[0].nodes[1].cout);
});
test('curvaturePreview smooths ghost cursor at 2 placed anchors and closes over start anchor',()=>{
  const draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  const open=curvaturePreview(draft,{x:20,y:10},false);
  assert.equal(open.closed,false);assert.equal(open.nodes.length,3);
  assert.ok(open.nodes[1].cin && open.nodes[1].cout && open.nodes[1].smooth);
  const closed=curvaturePreview({nodes:[{x:0,y:0},{x:10,y:0},{x:5,y:8}],closed:false},{x:0.1,y:0.1},true);
  assert.equal(closed.closed,true);
  assert.ok(closed.nodes.every((n)=>n.cin && n.cout));
});
test('draftHandleMarks maps anchors and arms 1:1',()=>{
  const marks=draftHandleMarks([{x:0,y:0},{x:10,y:0,cin:{x:6,y:0},cout:{x:14,y:0}},{x:20,y:10}],3);
  assert.equal(marks.length,3);assert.deepEqual(marks[1].arms,[{x:6,y:0},{x:14,y:0}]);assert.deepEqual(marks[0].arms,[]);
});
test('draftHandleMarks excludes ghost node',()=>{
  const marks=draftHandleMarks([{x:0,y:0},{x:10,y:0},{x:20,y:10},{x:99,y:99}],3);
  assert.equal(marks.length,3);
});
test('render draws draft curve in world transform and anchors/handles in screen transform at exact toScreen coords',()=>{
  const ed=editor();
  const {ctx,calls}=mockCtx();
  ed.ctx=ctx;
  ed.view={zoom:2,ox:60,oy:40};
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};
  ed.cursor={x:30,y:10};
  ed.render();

  const curveStrokes=calls.filter((c)=>c.op==='stroke' && c.args[0] instanceof MockPath2D && (c.args[0] as MockPath2D).ops.some((o)=>o.op==='bezierCurveTo'));
  assert.equal(curveStrokes.length,1);
  assert.deepEqual(curveStrokes[0].mat,[2,0,0,2,60,40]);

  const preview=curvaturePreview(ed.draft,ed.cursor,false);
  const marks=draftHandleMarks(preview.nodes,ed.draft.nodes.length);
  const anchorRects=calls.filter((c)=>c.op==='fillRect' && c.args[2]===7 && c.args[3]===7);
  assert.equal(anchorRects.length,3);
  anchorRects.forEach((c,i)=>{
    assert.deepEqual(c.mat,[1,0,0,1,0,0]);
    const center={x:(c.args[0] as number)+3.5,y:(c.args[1] as number)+3.5};
    assert.ok(nearPt(center,ed.toScreen(marks[i].anchor)));
  });

  const expectedArms=marks.flatMap((m)=>m.arms.map((a)=>ed.toScreen(a)));
  const handleArcs=calls.filter((c)=>c.op==='arc' && c.args[2]===3.5);
  assert.equal(handleArcs.length,expectedArms.length);
  handleArcs.forEach((c,i)=>{
    assert.deepEqual(c.mat,[1,0,0,1,0,0]);
    assert.ok(nearPt({x:c.args[0] as number,y:c.args[1] as number},expectedArms[i]));
  });
});
test('smoothAnchors respects explicit corners but still arms smooth neighbors',()=>{
  const out=smoothAnchors([{x:0,y:0,smooth:false},{x:10,y:0},{x:20,y:0,smooth:false}],false);
  assert.equal(out[0].cin,undefined);assert.equal(out[0].cout,undefined);
  assert.equal(out[2].cin,undefined);assert.equal(out[2].cout,undefined);
  assert.ok(out[1].cin && out[1].cout);
});
test('finishCurvature keeps clicked corners straight',()=>{
  const ed=editor();ed.draft={nodes:[{x:0,y:0,smooth:false},{x:10,y:0,smooth:false},{x:20,y:0,smooth:false}],closed:false};ed.finishCurvature();
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.ok(shape.subs[0].nodes.every((n)=>!n.cin && !n.cout && n.smooth===false));
});
test('continuableSub accepts only simple open paths on the current layer',()=>{
  const ed=editor();
  const open:Obj={id:1,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  ed.doc.objs=[open];
  assert.ok(ed.continuableSub(open));
  const closed:Obj={id:2,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:true}]}};
  const multi:Obj={id:3,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false},{nodes:[{x:20,y:0},{x:30,y:0}],closed:false}]}};
  const marked:Obj={id:4,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',mark:'gen',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  const other:Obj={id:5,m:[1,0,0,1,0,0],layer:1,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  const rect:Obj={id:6,m:[1,0,0,1,0,0],layer:0,shape:{kind:'rect',w:10,h:10,r:0}};
  const locked:Obj={id:7,m:[1,0,0,1,0,0],layer:0,locked:true,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  ed.doc.objs.push(closed,multi,marked,other,rect,locked);
  for(const o of [closed,multi,marked,other,rect,locked])assert.equal(ed.continuableSub(o),null);
  const grouped:Obj={id:8,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  assert.equal(ed.continuableSub(grouped),null);
});
test('continuePath loads world nodes and swaps handles when reversing',()=>{
  const ed=editor();
  const orig:Obj={id:9,m:[1,0,0,1,5,5],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0,cout:{x:4,y:0},smooth:true},{x:10,y:0,cin:{x:6,y:0},smooth:true}],closed:false}]}};
  ed.doc.objs=[orig];
  assert.ok(ed.continuePath(orig,0));
  assert.equal(ed.continuedFrom,orig);assert.deepEqual(ed.sel,[]);
  assert.deepEqual([ed.draft!.nodes[0].x,ed.draft!.nodes[0].y],[15,5]);
  assert.deepEqual(ed.draft!.nodes[0].cout,{x:11,y:5});assert.equal(ed.draft!.nodes[0].cin,undefined);
  assert.deepEqual([ed.draft!.nodes[1].x,ed.draft!.nodes[1].y],[5,5]);
  assert.deepEqual(ed.draft!.nodes[1].cin,{x:9,y:5});assert.equal(ed.draft!.nodes[1].cout,undefined);
  const ed2=editor();ed2.doc.objs=[orig];
  assert.ok(ed2.continuePath(orig,-1));
  assert.deepEqual([ed2.draft!.nodes[0].x,ed2.draft!.nodes[0].y],[5,5]);
  assert.deepEqual(ed2.draft!.nodes[0].cout,{x:9,y:5});
});
test('continuation commit replaces the original in one Undo',()=>{
  const ed=editor();
  const orig:Obj={id:11,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  ed.doc.objs=[orig];
  assert.ok(ed.continuePath(orig,-1));
  ed.draft!.nodes.push({x:20,y:0,smooth:false});
  ed.finishCurvature();
  assert.equal(ed.doc.objs.length,1);assert.notEqual(ed.doc.objs[0],orig);assert.equal(ed.history.position,1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.doc.objs[0].id,11);
});
test('line continuation commit replaces the original in one Undo',()=>{
  const ed=editor();ed.tool='line';
  const orig:Obj={id:15,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  ed.doc.objs=[orig];
  assert.ok(ed.continuePath(orig,-1));
  ed.draft!.nodes.push({x:20,y:0});
  ed.finishLine();
  assert.equal(ed.doc.objs.length,1);assert.notEqual(ed.doc.objs[0],orig);assert.equal(ed.history.position,1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.doc.objs[0].id,15);
});
test('escape during continuation keeps the original',()=>{
  const ed=editor();
  const orig:Obj={id:12,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:10,y:0}],closed:false}]}};
  ed.doc.objs=[orig];
  assert.ok(ed.continuePath(orig,-1));
  ed.onKey(keyEv('Escape'));
  assert.equal(ed.draft,null);assert.equal(ed.continuedFrom,null);
  assert.equal(ed.doc.objs.length,1);assert.equal(ed.history.position,0);
});
test('continueHit finds the nearest open endpoint',()=>{
  const ed=editor();
  const o:Obj={id:13,m:[1,0,0,1,0,0],layer:0,shape:{kind:'path',subs:[{nodes:[{x:0,y:0},{x:100,y:0}],closed:false}]}};
  ed.doc.objs=[o];
  const s0=ed.toScreen({x:0,y:0}),s1=ed.toScreen({x:100,y:0});
  const h0=ed.continueHit(s0.x,s0.y),h1=ed.continueHit(s1.x,s1.y);
  assert.ok(h0 && h1);assert.equal(h0.o,o);assert.equal(h0.end,0);assert.equal(h1.o,o);assert.equal(h1.end,-1);
  assert.equal(ed.continueHit(s0.x+50,s0.y+50),null);
});
test('draftDropClose releases on the start anchor to close',()=>{
  const ed=editor();
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  assert.ok(ed.draftDropClose(s.x,s.y));
  assert.equal(ed.draft,null);
  assert.equal(ed.doc.objs.length,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
  assert.equal(shape.subs[0].nodes.length,3);
  assert.equal(ed.history.position,1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length,0);
});
test('draftDropClose far from start keeps the draft unless forced',()=>{
  const ed=editor();
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  assert.equal(ed.draftDropClose(200,200),false);
  assert.ok(ed.draft && !ed.draft.closed);
  assert.equal(ed.doc.objs.length,0);
  assert.equal(ed.history.position,0);
  assert.ok(ed.draftDropClose(200,200,true));
  assert.equal(ed.draft,null);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
  assert.equal(ed.history.position,1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length,0);
});
test('draftDropClose needs two anchors and the draw tool',()=>{
  const ed=editor();
  ed.draft={nodes:[{x:0,y:0}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  assert.equal(ed.draftDropClose(s.x,s.y),false);
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  ed.tool='select';
  assert.equal(ed.draftDropClose(s.x,s.y),false);
  assert.ok(ed.draft);
});
test('draftDropClose closes line drafts too',()=>{
  const ed=editor();ed.tool='line';
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  assert.ok(ed.draftDropClose(s.x,s.y));
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
});
test('render previews closed contour while linenode drag hovers the start anchor',()=>{
  const ed=editor();
  const {ctx,calls}=mockCtx();
  ed.ctx=ctx;
  ed.view={zoom:2,ox:60,oy:40};
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:10}],closed:false};
  ed.drag={type:'linenode',node:ed.draft.nodes[2]};
  ed.cursor={x:0.5,y:0.2};
  ed.render();
  const curveStrokes=calls.filter((c)=>c.op==='stroke' && c.args[0] instanceof MockPath2D && (c.args[0] as MockPath2D).ops.some((o)=>o.op==='bezierCurveTo'));
  assert.equal(curveStrokes.length,1);
  assert.ok((curveStrokes[0].args[0] as MockPath2D).ops.some((o)=>o.op==='closePath'));
});
const ptrEv=(x:number,y:number)=>({pointerId:1,button:0,clientX:x,clientY:y,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false} as unknown as PointerEvent);
test('render previews closed contour and handle arms throughout armed start-point drag even far from start',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  const {ctx,calls}=mockCtx();
  ed.ctx=ctx;
  ed.dpr=2;
  ed.view={zoom:2,ox:60,oy:40};
  ed.draft={nodes:[{x:0,y:0,smooth:false},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  ed.onMove(ptrEv(s.x+60,s.y));
  calls.length=0;
  ed.render();
  const curveStrokes=calls.filter((c)=>c.op==='stroke' && c.args[0] instanceof MockPath2D && (c.args[0] as MockPath2D).ops.some((o)=>o.op==='bezierCurveTo'));
  assert.equal(curveStrokes.length,1);
  assert.ok((curveStrokes[0].args[0] as MockPath2D).ops.some((o)=>o.op==='closePath'));
  const arcCalls=calls.filter((c)=>c.op==='arc');
  assert.equal(arcCalls.length,2);
  assert.deepEqual(arcCalls[0].mat,[2,0,0,2,0,0]);
});
test('render previews closed contour for line tool during armed start-point drag',()=>{
  const ed=editor();ed.tool='line';ed.snapObjects=false;ed.snapGrid=false;
  const {ctx,calls}=mockCtx();
  ed.ctx=ctx;
  ed.dpr=2;
  ed.view={zoom:2,ox:60,oy:40};
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  ed.onMove(ptrEv(s.x+60,s.y));
  calls.length=0;
  ed.render();
  const lineStrokes=calls.filter((c)=>c.op==='stroke' && c.args[0] instanceof MockPath2D && (c.args[0] as MockPath2D).ops.some((o)=>o.op==='lineTo'));
  assert.equal(lineStrokes.length,1);
  assert.ok((lineStrokes[0].args[0] as MockPath2D).ops.some((o)=>o.op==='closePath'));
});
test('press on start arms close instead of committing',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  assert.ok(ed.draft && !ed.draft.closed);
  assert.equal(ed.doc.objs.length,0);
  assert.equal(ed.draft.nodes.length,3);
  if(ed.drag?.type!=='linenode')throw Error('expected linenode drag');
  assert.ok(ed.drag.close);
});
test('release on start without dragging closes like a click',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  ed.draft={nodes:[{x:0,y:0},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  ed.onUp(ptrEv(s.x,s.y));
  assert.equal(ed.draft,null);
  assert.equal(ed.doc.objs.length,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
  assert.equal(shape.subs[0].nodes.length,3);
  assert.equal(ed.history.position,1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length,0);
});
test('tiny movement on armed close keeps start handles then closes',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  ed.draft={nodes:[{x:0,y:0,cin:{x:-2,y:0},cout:{x:2,y:0},smooth:true},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  ed.onMove(ptrEv(s.x+1,s.y));
  const n0=ed.draft!.nodes[0];
  assert.deepEqual(n0.cin,{x:-2,y:0});assert.deepEqual(n0.cout,{x:2,y:0});
  ed.onUp(ptrEv(s.x+1,s.y));
  assert.equal(ed.draft,null);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.deepEqual(shape.subs[0].nodes[0].cout,{x:2,y:0});
});
test('armed drag released far still closes via press origin',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  ed.draft={nodes:[{x:0,y:0,smooth:false},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  ed.onMove(ptrEv(s.x+50,s.y));
  const n0=ed.draft!.nodes[0];
  assert.equal(n0.smooth,true);assert.ok(n0.cout);
  ed.onUp(ptrEv(s.x+50,s.y));
  assert.equal(ed.draft,null);
  assert.equal(ed.doc.objs.length,1);
  const shape=ed.doc.objs[0].shape;if(shape.kind!=='path')throw Error();
  assert.equal(shape.subs[0].closed,true);
  assert.equal(shape.subs[0].nodes.length,3);
  assert.equal(ed.history.position,1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length,0);
});
test('foreign drag dropped far from start keeps the draft open',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  ed.draft={nodes:[{x:0,y:0,smooth:false},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  // Neuer Knoten per Drag abgesetzt (kein Start-Ursprung): fern loslassen hält offen.
  const last=ed.toScreen({x:10,y:10});
  ed.onDown(ptrEv(last.x,last.y));
  if(ed.drag?.type!=='linenode')throw Error('expected linenode drag');
  assert.ok(!ed.drag.close);
  ed.onMove(ptrEv(last.x+50,last.y));
  ed.onUp(ptrEv(last.x+50,last.y));
  assert.ok(ed.draft && !ed.draft.closed);
  assert.equal(ed.doc.objs.length,0);
});
test('Escape during armed close restores start handles',()=>{
  const ed=editor();ed.snapObjects=false;ed.snapGrid=false;
  ed.draft={nodes:[{x:0,y:0,cin:{x:-2,y:0},cout:{x:2,y:0},smooth:true},{x:10,y:0,smooth:false},{x:10,y:10,smooth:false}],closed:false};
  const s=ed.toScreen({x:0,y:0});
  ed.onDown(ptrEv(s.x,s.y));
  ed.onMove(ptrEv(s.x+50,s.y));
  assert.ok(!nearPt(ed.draft!.nodes[0].cout!,{x:2,y:0}));
  ed.onKey(keyEv('Escape'));
  assert.equal(ed.drag,null);
  assert.ok(ed.draft && !ed.draft.closed);
  assert.equal(ed.draft.nodes.length,3);
  assert.deepEqual(ed.draft.nodes[0].cin,{x:-2,y:0});
  assert.deepEqual(ed.draft.nodes[0].cout,{x:2,y:0});
  assert.equal(ed.draft.nodes[0].smooth,true);
  assert.equal(ed.doc.objs.length,0);
});
console.log(`${count} curvature groups passed`);
