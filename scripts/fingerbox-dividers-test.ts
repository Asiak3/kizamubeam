import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { makeDividers, type DividerParams } from '../src/generators/fingerbox-dividers';
import { fingerboxParts } from '../src/generators/fingerbox-experiment';
import { distributeGaps } from '../src/generators/fingerbox-distribution';
import type { SubPath } from '../src/model';

type Fixture = { params: DividerParams; dividers: Record<string, number[][]>; holes: Record<string, number[][][]> };
const fixtures = JSON.parse(readFileSync('scripts/fingerbox-dividers-fixtures.json','utf8')) as Fixture[];
// Numerische Übereinstimmung der polygonalen Ecken; kollineare Zwischenpunkte ignorieren.
function canonical(points: number[][]): string {
  let a = points.map(([x,y])=>[x,y]); let changed=true;
  while (changed && a.length>3) {
    changed=false;
    for (let i=0;i<a.length;i++) {
      const p=a[(i+a.length-1)%a.length],q=a[i],r=a[(i+1)%a.length];
      if (Math.abs((q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]))<1e-7 && (q[0]-p[0])*(r[0]-q[0])+(q[1]-p[1])*(r[1]-q[1])>=0) { a.splice(i,1); changed=true; break; }
    }
  }
  return a.map(([x,y])=>`${Math.round(x*1e5)},${Math.round(y*1e5)}`).sort().join('|');
}
const path = (sp: SubPath) => canonical(sp.nodes.map((p)=>[p.x,p.y]));
for (const f of fixtures) {
  const r=makeDividers(f.params);
  assert.equal(r.dividers.length,Object.keys(f.dividers).length);
  for (const d of r.dividers) assert.equal(path(d.outline),canonical(f.dividers[d.key]),`${d.key}: ${JSON.stringify(f.params)}`);
  for (const k of ['bottom','front','back','left','right'] as const) {
    assert.deepEqual(r.holes[k].map(path).sort(),f.holes[k].map(canonical).sort(),`holes ${k}: ${JSON.stringify(f.params)}`);
  }
}
const mixed=makeDividers({...fixtures[0].params,ratiosX:'33mm:50mm*2:1',ratiosY:'1:1'});
assert.deepEqual(mixed.gapsX,[33,100,143]);
assert.deepEqual(mixed.gapsY,[91,91]);
assert.equal(mixed.dividers.length,3);
assert.equal(mixed.dividers.filter((d)=>d.key.startsWith('divx-')).length,2);
assert.equal(mixed.dividers.filter((d)=>d.key.startsWith('divy-')).length,1);
assert.throws(()=>makeDividers({...fixtures[0].params,ratiosX:'1000mm:1:1'}));
assert.throws(()=>makeDividers({...fixtures[0].params,dividerHeight:1}));
assert.throws(()=>makeDividers({...fixtures[0].params,top:'closed',dividerHeight:99}));
assert.doesNotThrow(()=>makeDividers({...fixtures[0].params,top:'closed',dividerHeight:90}));
// Sampling der montierten Platten (inkl. Kreuzung und Schlitzen): keine Durchdringung.
function inside(sp: SubPath, x:number,y:number): boolean {
  const pts=sp.nodes; let yes=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++) {const a=pts[i],b=pts[j]; if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) yes=!yes;}
  return yes;
}
for (const fixture of fixtures.slice(0,3)) for (const top of ['open','closed'] as const) {
  const p={...fixture.params,top}, {width:W,depth:D,height:H,thickness:t,dividerHeight:hd}=p;
  const result=makeDividers(p), base=new Map(fingerboxParts(p).map((x)=>[x.key,x.subs[0]]));
  const xx=distributeGaps(W,t,p.compartmentsX,p.ratiosX).centres;
  const yy=distributeGaps(D,t,p.compartmentsY,p.ratiosY).centres;
  const wall=(key:'bottom'|'front'|'back'|'left'|'right',u:number,v:number) => inside(base.get(key)!,u,v) && !result.holes[key].some((hole)=>inside(hole,u,v));
  const dx=result.dividers.filter((d)=>d.key.startsWith('divx-'));
  const dy=result.dividers.filter((d)=>d.key.startsWith('divy-'));
  let seed=3241;
  const rand=()=>((seed=seed*16807%2147483647)/2147483647);
  let overlap=0, missingShell=0;
  const check=(x:number,y:number,z:number)=>{
    let n=0;
    if(z<t && wall('bottom',x-W/2,y-D/2)) n++;
    if(top==='closed' && z>H-t && inside(base.get('top')!,x-W/2,y-D/2)) n++;
    if(y<t && wall('front',x-W/2,H/2-z)) n++;
    if(y>D-t && wall('back',x-W/2,H/2-z)) n++;
    if(x<t && wall('left',y-D/2,H/2-z)) n++;
    if(x>W-t && wall('right',y-D/2,H/2-z)) n++;
    xx.forEach((c,i)=>{if(Math.abs(x-c)<t/2 && inside(dx[i].outline,y-D/2,hd/2-z)) n++;});
    yy.forEach((c,i)=>{if(Math.abs(y-c)<t/2 && inside(dy[i].outline,x-W/2,hd/2-z)) n++;});
    if(n>1) overlap++;
    const shell=z<t || y<t || y>D-t || x<t || x>W-t || (top==='closed' && z>H-t);
    if(shell && n===0) missingShell++;
  };
  for(let i=0;i<60000;i++) check(rand()*W,rand()*D,rand()*H);
  for(const x of xx) for(const y of yy) for(let i=0;i<5000;i++) check(x+(rand()-0.5)*2*t,y+(rand()-0.5)*2*t,rand()*hd);
  assert.equal(overlap,0,`3D overlap ${overlap} ${JSON.stringify(p)}`);
  assert.equal(missingShell,0,`3D shell gaps ${missingShell} ${JSON.stringify(p)}`);
}

console.log(`ok   Fingerbox: ${fixtures.length} Vergleichsfälle für Trennwände und Schlitze`);
