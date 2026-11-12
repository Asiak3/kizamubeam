import './core-fixtures-env';
import assert from 'node:assert/strict';
const {nearestSlotAnchor,guidedSlot,slotAnchorFromReference,slotContourPosition}=await import('../src/contourSlots');
const {cutSlots,resolvedSlots,readSlotRecipe}=await import('../src/slotPlacement');
const {getGenerator}=await import('../src/generators');
type Slot=import('../src/slotPlacement').PlacedSlot;
type Sub=import('../src/model').SubPath;
const rect:Sub={closed:true,nodes:[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}]};
const circle:Sub={closed:true,nodes:Array.from({length:1440},(_,i)=>({x:50*Math.cos(i*2*Math.PI/1440),y:50*Math.sin(i*2*Math.PI/1440)}))};
const values:Slot={x:0,y:0,angle:0,width:10,depth:12,clearance:0,factor:1};
const recipe=(base:Sub[],slots:Slot[])=>({source:{kind:'path' as const,subs:base},base,slots});
const near=(a:number,b:number,tol=0.02)=>assert.ok(Math.abs(a-b)<tol,`${a} ≠ ${b}`);
let count=0;
const test=(name:string,fn:()=>void)=>{fn();count++;console.log('PASS '+name);};
test('straight lip corners follow contour, depth is inward',()=>{
 const anchor=nearestSlotAnchor([rect],{x:40,y:0},1,'curve')!;assert.ok(anchor);
 const f=guidedSlot([rect],{...values,anchor});near(f.a.y,0);near(f.b.y,0);near(Math.hypot(f.a.x-f.b.x,f.a.y-f.b.y),10);assert.ok(f.normal.y>0.99);
 near(f.outline.nodes[2].y,12);assert.equal(cutSlots(recipe([rect],[{...values,anchor}])).length,1);
});
test('circle mouth contacts stay on circle; axis passes through center',()=>{
 const base=[circle],anchor=nearestSlotAnchor(base,{x:50,y:0},1,'curve')!;
 const f=guidedSlot(base,{...values,anchor});near(Math.hypot(f.a.x,f.a.y),50);near(Math.hypot(f.b.x,f.b.y),50);
 near(f.center.x*f.normal.y-f.center.y*f.normal.x,0);assert.ok(f.normal.x<-.99);assert.ok(f.curveOffset<0);
 near(f.outline.nodes[2].x,38,0.03);
});
test('curve versus chord reference gives different, reproducible depth',()=>{
 const base=[circle],anchor=nearestSlotAnchor(base,{x:50,y:0},1,'curve')!;
 const a=guidedSlot(base,{...values,width:30,anchor});const b=guidedSlot(base,{...values,width:30,anchor:{...anchor,reference:'chord'}});
 near(a.outline.nodes[2].x-b.outline.nodes[2].x,-a.curveOffset,0.002);assert.ok(Math.abs(a.curveOffset)>2);
});
test('noncircular smooth contour follows its local shape',()=>{
 const ellipse:Sub={closed:true,nodes:circle.nodes.map(p=>({x:p.x*1.7,y:p.y}))};
 const base=[ellipse],anchor=nearestSlotAnchor(base,{x:60.1,y:35.35},1,'curve')!;
 const f=guidedSlot(base,{...values,anchor});for(const p of [f.a,f.b])near(p.x*p.x/(85*85)+p.y*p.y/(50*50),1,0.002);
 assert.ok(Math.abs(f.normal.x)>.1&&Math.abs(f.normal.y)>.1);
});
test('curved hole boundary points into surrounding material',()=>{
 const base=[rect,{...circle,nodes:circle.nodes.map(p=>({x:p.x*.2+50,y:p.y*.2+40}))}];
 const anchor=nearestSlotAnchor(base,{x:60,y:40},1,'curve')!;const f=guidedSlot(base,{...values,width:3,depth:5,anchor});assert.ok(f.normal.x>.99);
});
test('far cursor, ambiguous boundaries, impossible width and invalid anchors reject',()=>{
 assert.equal(nearestSlotAnchor([rect],{x:40,y:40},1,'curve'),null);
 assert.throws(()=>guidedSlot([circle],{...values,width:200,anchor:{contour:0,fraction:0,reference:'curve'}}));
 assert.throws(()=>guidedSlot([rect],{...values,anchor:{contour:8,fraction:0,reference:'curve'}}));
});
test('XY reference plus arc distance and reverse direction',()=>{
 const base=[rect],a=slotAnchorFromReference(base,{x:20,y:0},30,1,'curve'),b=slotAnchorFromReference(base,{x:50,y:0},30,-1,'chord');
 const p=slotContourPosition(base,a),q=slotContourPosition(base,b);near(p.x,50);near(p.y,0);near(q.x,20);
 assert.throws(()=>slotAnchorFromReference(base,{x:20,y:20},10,1,'curve'));
 assert.throws(()=>slotAnchorFromReference(base,{x:20,y:0},1000,1,'curve'));
});
test('dependent cuts move transitively when their reference cut moves',()=>{
 const base=[rect];const first:Slot={...values,id:'A',width:4,anchor:slotAnchorFromReference(base,{x:20,y:0},0,1,'curve')};
 const second:Slot={...values,id:'B',width:4,anchor:{contour:0,fraction:0,reference:'curve',relative:{slotId:'A',edge:'end',distance:10,direction:1}}};
 const third:Slot={...values,id:'C',width:4,anchor:{contour:0,fraction:0,reference:'chord',relative:{slotId:'B',edge:'center',distance:10,direction:1}}};
 const r=recipe(base,[first,second,third]),before=resolvedSlots(r).map(s=>guidedSlot(base,s).center.x);
 first.anchor=slotAnchorFromReference(base,{x:25,y:0},0,1,'curve');const after=resolvedSlots(r).map(s=>guidedSlot(base,s).center.x);
 after.forEach((x,i)=>near(x-before[i],5));assert.ok(cutSlots(r).length);
 const loaded=readSlotRecipe({recipe:JSON.stringify(r)});assert.deepEqual(resolvedSlots(loaded),resolvedSlots(r));
});
test('cycles, missing parents and free reference cuts reject',()=>{
 const base=[rect],a:Slot={...values,id:'A',anchor:{contour:0,fraction:0,reference:'curve',relative:{slotId:'B',edge:'center',distance:10,direction:1}}};
 const b:Slot={...values,id:'B',anchor:{contour:0,fraction:0,reference:'curve',relative:{slotId:'A',edge:'start',distance:10,direction:1}}};
 assert.throws(()=>resolvedSlots(recipe(base,[a,b])));assert.throws(()=>resolvedSlots(recipe(base,[a])));assert.throws(()=>resolvedSlots(recipe(base,[a,{...values,id:'B'}])));
});
test('changing reference width moves edge-based followers but not center-based followers',()=>{
 const base=[rect],first:Slot={...values,id:'A',width:4,anchor:slotAnchorFromReference(base,{x:30,y:0},0,1,'curve')};
 const edge:Slot={...values,id:'B',width:2,anchor:{contour:0,fraction:0,reference:'curve',relative:{slotId:'A',edge:'end',distance:10,direction:1}}};
 const center:Slot={...values,id:'C',width:2,anchor:{contour:0,fraction:0,reference:'curve',relative:{slotId:'A',edge:'center',distance:25,direction:1}}};
 const r=recipe(base,[first,edge,center]),before=resolvedSlots(r).map(s=>guidedSlot(base,s).center.x);
 first.width=8;const after=resolvedSlots(r).map(s=>guidedSlot(base,s).center.x);near(after[1]-before[1],2);near(after[2]-before[2],0);
});
test('old free placement recipes roundtrip unchanged and output remains unchanged',()=>{
 const r=recipe([rect],[{...values,x:40,y:40}]),text=JSON.stringify(r),loaded=readSlotRecipe({recipe:text});
 assert.equal(JSON.stringify(loaded),text);assert.deepEqual(cutSlots(r),cutSlots(loaded));
 assert.ok(getGenerator('slot-placement'));assert.ok(getGenerator('slot-placement-contour'));
});
console.log(`Contour slots: ${count} checks passed.`);
